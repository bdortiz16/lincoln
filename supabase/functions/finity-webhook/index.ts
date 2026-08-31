// ════════════════════════════════════════════════════════
// finity-webhook — Receptor de webhooks del proveedor ACH (Finity).
//
// CONFIGURACIÓN (portal de Finity → Webhooks):
//   URL:  https://<project-ref>.supabase.co/functions/v1/finity-webhook
//   (opcional pero recomendado) agrega ?secret=TU_SECRETO a la URL y setea
//   el mismo valor en Supabase → Edge Functions → Secrets como
//   FINITY_WEBHOOK_SECRET — si el secret está seteado, se EXIGE.
//
// Qué hace con cada evento:
//   1. AUDITORÍA: guarda el payload completo en admin_actions (best-effort).
//   2. CONCILIACIÓN de órdenes de retiro (dispersiones ACH): si el evento
//      trae el id de una withdrawal-order que coincide con el providerRef
//      de una transacción 'dispersion' del sistema:
//        · COMPLETED/SUCCESS → la transacción pasa a 'Completado'.
//        · FAILED/REJECTED/CANCELLED → pasa a 'Rechazado' y se REEMBOLSA
//          al cliente el monto + comisión en su riel (idempotente).
//   Cualquier otro evento (recargas, conversiones, cuentas aprobadas) queda
//   registrado en auditoría — la sincronización de cuentas la hace la app.
//
// El payload de Finity puede variar de forma: el parser busca id/estado en
// las claves más comunes (id, order_id, withdrawal_order_id, data.id...,
// status, state, event) de manera tolerante.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET       = (Deno.env.get('FINITY_WEBHOOK_SECRET') ?? '').trim()

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-finity-signature',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Busca recursivamente (máx 3 niveles) el primer valor string/number de
// alguna de las claves dadas.
function dig(obj: unknown, keys: string[], depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 3) return null
  const rec = obj as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  for (const v of Object.values(rec)) {
    const found = dig(v, keys, depth + 1)
    if (found) return found
  }
  return null
}

async function audit(event: string, metadata: Record<string, unknown>) {
  try {
    await db.from('admin_actions').insert({
      admin_id: null, admin_email: 'finity-webhook', admin_role: 'system',
      action: event, target_type: 'finity_webhook', target_id: null, metadata,
    })
  } catch (e) { console.warn('[finity-webhook] audit failed:', e) }
}

// HMAC-SHA256 del cuerpo con el secret — la forma usual en que los
// proveedores "firman" los webhooks. Se devuelve en hex y base64.
async function hmacOf(body: string, secret: string): Promise<{ hex: string; b64: string }> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  const hex = Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')
  const b64 = btoa(String.fromCharCode(...sig))
  return { hex, b64 }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const rawBody = await req.text().catch(() => '')

  // SEGURIDAD (pentest #8): FALLA CERRADO. Sin secret configurado, este webhook
  // podía dispararse por cualquiera (POST anónimo) y forzar un REEMBOLSO de una
  // dispersión ya pagada → doble-gasto. Si no hay FINITY_WEBHOOK_SECRET, no se
  // procesa nada.
  if (!SECRET) {
    console.error('[finity-webhook] FINITY_WEBHOOK_SECRET no configurado — rechazando (fail-closed)')
    return json(503, { error: 'webhook_not_configured' })
  }

  // Autenticación del webhook (secret obligatorio, validado abajo).
  // Se acepta CUALQUIERA de estas formas, porque cada proveedor firma
  // distinto: (a) ?secret= en la URL, (b) el secret plano en un header,
  // (c) la firma HMAC-SHA256 del cuerpo (hex o base64, con o sin
  // prefijo "sha256=") en los headers de firma usuales.
  if (SECRET) {
    const url = new URL(req.url)
    const candidates = [
      url.searchParams.get('secret'),
      req.headers.get('x-webhook-secret'),
      req.headers.get('x-finity-signature'),
      req.headers.get('x-signature'),
      req.headers.get('x-hub-signature-256'),
      req.headers.get('webhook-signature'),
      req.headers.get('signature'),
    ].filter((v): v is string => !!v).map(v => v.trim().replace(/^sha256=/i, ''))
    const { hex, b64 } = await hmacOf(rawBody, SECRET)
    const okAuth = candidates.some(v => v === SECRET || v.toLowerCase() === hex || v === b64)
    if (!okAuth) return json(401, { error: 'unauthorized' })
  }

  let payload: unknown = null
  try { payload = JSON.parse(rawBody) } catch { /* no-json */ }
  if (!payload) return json(400, { error: 'bad_payload' })

  await audit('finity.webhook.received', { payload })

  // ── Conciliación de órdenes de retiro (dispersión ACH) ──
  const orderId = dig(payload, ['withdrawal_order_id', 'order_id', 'withdrawalOrderId', 'orderId', 'id'])
  const status  = (dig(payload, ['status', 'state', 'event_type', 'event']) ?? '').toUpperCase()
  if (!orderId || !status) return json(200, { ok: true, matched: false })

  const isDone   = /COMPLETED|SUCCESS|PAID|SETTLED/.test(status)
  const isFailed = /FAILED|REJECT|CANCEL|RETURNED|ERROR/.test(status)
  if (!isDone && !isFailed) return json(200, { ok: true, matched: false, note: `estado ${status} sin acción` })

  // Buscar la transacción de dispersión con ese providerRef.
  const { data: rows } = await db
    .from('transactions')
    .select('id, user_id, amount, currency, status, raw_data')
    .eq('type', 'dispersion')
    .filter('raw_data->>providerRef', 'eq', orderId)
    .limit(2)
  const tx = (rows ?? [])[0] as any
  if (!tx) return json(200, { ok: true, matched: false, orderId, status })

  const rd = (tx.raw_data ?? {}) as Record<string, any>

  if (isDone) {
    // NO marcar Completado si ya se reembolsó/rechazó (Finity puede mandar un
    // FAILED transitorio y luego un COMPLETED — sin este guardia el cliente
    // se quedaba con el reembolso Y el pago).
    if (tx.status === 'Rechazado' || rd.refunded) {
      return json(200, { ok: true, matched: true, result: 'already_refunded_ignored' })
    }
    if (tx.status !== 'Completado') {
      await db.from('transactions').update({
        status: 'Completado',
        raw_data: { ...rd, webhookStatus: status, webhookAt: new Date().toISOString() },
      }).eq('id', tx.id).neq('status', 'Rechazado')
      await audit('finity.webhook.withdrawal.completed', { txId: tx.id, orderId, status })
    }
    return json(200, { ok: true, matched: true, result: 'completed' })
  }

  // FALLÓ: reembolso IDEMPOTENTE de monto + comisión al riel del cliente.
  if (tx.status === 'Rechazado' || rd.refunded) {
    return json(200, { ok: true, matched: true, result: 'already_refunded' })
  }
  // CAS: reclamar el reembolso ANTES de tocar el saldo. El update solo afecta
  // filas que aún NO están Rechazadas; si otra ejecución (reconcile_ach o un
  // segundo webhook) ya reclamó, updRows viene vacío y NO se acredita de
  // nuevo. Sin esto, webhook + reconcile reembolsaban dos veces.
  const railCol = String(tx.currency ?? 'COP_ACH')
  const refund = Number(tx.amount ?? 0) + Number(rd.feeCop ?? rd.feeDetail?.feeCop ?? 0)
  const { data: claimed } = await db.from('transactions').update({
    status: 'Rechazado',
    raw_data: { ...rd, refunded: true, refundCop: refund, webhookStatus: status, webhookAt: new Date().toISOString() },
  }).eq('id', tx.id).neq('status', 'Rechazado').filter('raw_data->>refunded', 'is', null).select('id')
  if (!claimed?.length) {
    return json(200, { ok: true, matched: true, result: 'refund_already_claimed' })
  }
  const { data: u } = await db.from('users').select('balances').eq('id', tx.user_id).single()
  const bals: Record<string, number> = (u?.balances as any) ?? {}
  const newBal = parseFloat(((bals[railCol] ?? 0) + refund).toFixed(2))
  await db.from('users').update({ balances: { ...bals, [railCol]: newBal } }).eq('id', tx.user_id)
  await audit('finity.webhook.withdrawal.failed_refunded', { txId: tx.id, orderId, status, refund })
  return json(200, { ok: true, matched: true, result: 'refunded', refund })
})
