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

// Todos los valores de claves tipo id/referencia del aviso (cualquier nivel),
// los más específicos primero (orden de retiro, movimiento) y el `id` suelto
// al final. Solo texto corto y sin espacios: los ids de Finity (mvm-…, uuid).
function idsDelAviso(obj: unknown): string[] {
  const especificos: string[] = [], sueltos: string[] = []
  const RE_ESPECIFICA = /^(withdrawal_?order_?id|withdrawalorderid|order_?id|orderid|movement_?id|movementid|transaction_?id|transactionid|withdrawal_?id|withdrawalid|reference|reference_?id|external_?id|externalid)$/i
  const NO_ES = /^(user|customer|company|account|destination|external_account|wallet|owner|client|event|webhook|delivery)_?id$/i
  const ver = (o: unknown, nivel: number) => {
    if (!o || typeof o !== 'object' || nivel > 4) return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if ((typeof v === 'string' || typeof v === 'number') && !NO_ES.test(k)) {
        const t = String(v).trim()
        if (!/^[\w.:-]{4,120}$/.test(t)) continue
        if (RE_ESPECIFICA.test(k)) especificos.push(t)
        else if (k.toLowerCase() === 'id') sueltos.push(t)
      } else if (v && typeof v === 'object') ver(v, nivel + 1)
    }
  }
  ver(obj, 0)
  return Array.from(new Set([...especificos, ...sueltos])).slice(0, 12)
}
function estadosDelAviso(obj: unknown): string[] {
  const out: string[] = []
  const ver = (o: unknown, nivel: number) => {
    if (!o || typeof o !== 'object' || nivel > 4) return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' && /^(status|state|estado|kaminstatus|kamin_status|transaction_status|transfer_status)$/i.test(k) && v.trim()) out.push(v.trim().toUpperCase())
      else if (v && typeof v === 'object') ver(v, nivel + 1)
    }
  }
  ver(obj, 0)
  return out.slice(0, 10)
}

async function audit(event: string, metadata: Record<string, unknown>) {
  try {
    await db.from('admin_actions').insert({
      admin_id: null, admin_email: 'finity-webhook', admin_role: 'system',
      action: event, target_type: 'finity_webhook', target_id: null, metadata,
    })
  } catch (e) { console.warn('[finity-webhook] audit failed:', e) }
}

// Un aviso que llega y se RECHAZA (sin secreto configurado, o con otro) antes
// no dejaba rastro: el 3 nov el portal de Finity mostraba los avisos enviados
// y aquí no había nada, sin forma de saber si llegaban y se rechazaban o no
// llegaban. Se anota el motivo y qué encabezados traía (solo los NOMBRES,
// nunca valores ni el cuerpo), uno cada 10 minutos como mucho para que
// alguien que mande basura no llene la tabla.
let ultimoRechazo = 0
async function auditRechazo(motivo: string, req: Request) {
  if (Date.now() - ultimoRechazo < 10 * 60_000) return
  ultimoRechazo = Date.now()
  const url = new URL(req.url)
  await audit('finity.webhook.rechazado', {
    motivo, traeSecretEnUrl: url.searchParams.has('secret'),
    encabezados: Array.from(req.headers.keys()).filter(k => !/^(authorization|cookie|apikey)$/i.test(k)).slice(0, 30),
  })
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
    await auditRechazo('sin_secreto_configurado', req)
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
    // En tiempo constante: con === la demora delataba cuánto del secreto
    // coincidía.
    const igual = (a: string, b: string) => {
      const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b)
      let d = x.length ^ y.length
      for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0)
      return d === 0
    }
    const okAuth = candidates.some(v => igual(v, SECRET) || igual(v.toLowerCase(), hex) || igual(v, b64))
    if (!okAuth) { await auditRechazo(candidates.length ? 'secreto_no_coincide' : 'sin_secreto_en_el_aviso', req); return json(401, { error: 'unauthorized' }) }
  }

  let payload: unknown = null
  try { payload = JSON.parse(rawBody) } catch { /* no-json */ }
  if (!payload) return json(400, { error: 'bad_payload' })

  await audit('finity.webhook.received', { payload })

  // ── DESTRABAR conversiones: CUALQUIER evento de Finity puede significar que
  // el USDt de una conversión pendiente ya llegó/se registró en el proveedor.
  // El autopiloto esperaba justo eso antes de convertir. Se relanza SIEMPRE (es
  // barato e idempotente: si no hay conversiones pendientes, no hace nada; y el
  // autopiloto usa CAS por fase, nunca doble-acredita). Así "llegan los USDT y la
  // conversión se hace sola", sin depender de que el cliente tenga la app abierta
  // y sin adivinar el nombre exacto del tipo de evento.
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/gasfree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'kick_pending_converts' }),
    })
  } catch (e) { console.warn('[finity-webhook] kick_pending_converts failed:', e) }

  // ── Conciliación de órdenes de retiro (dispersión ACH) ──
  // TODOS los identificadores del aviso, no el primero. Incidente (3 nov):
  // Finity avisó WITHDRAW_COP FAILED de pagos que el cliente seguía viendo
  // "Completado". dig() devolvía el primer `id` que encontraba —el de arriba,
  // que puede ser el del EVENTO— antes de bajar a `data`, donde viene el de
  // la orden de retiro: el aviso no coincidía con ningún envío, se respondía
  // 200 y no pasaba nada. Ahora se prueban todos (la orden, el movimiento, la
  // referencia…) y mouv-proxy busca el envío por cualquiera de ellos.
  const ids = idsDelAviso(payload)
  const orderId = ids[0] ?? null
  // El estado del aviso: el primero que diga algo (FAILED, COMPLETED…). No
  // decide nada solo: sirve para marcar a revisión si Finity avisa un
  // rechazo y la consulta no lo confirma.
  const estados = estadosDelAviso(payload)
  const status = (estados.find(e => /FAIL|REJECT|RECHAZ|CANCEL|DECLIN|RETURN|DEVUEL|REVERS|EXPIR/.test(e)) ?? estados.find(e => /COMPLET|SUCCESS|PAID|SETTLE/.test(e)) ?? estados[0] ?? '').toUpperCase()
  if (!ids.length) {
    await audit('finity.webhook.sin_id', { status, estados })
    return json(200, { ok: true, matched: false })
  }

  // EL AVISO NO DECIDE NADA. Antes este webhook reembolsaba por su cuenta, sin
  // las protecciones de la conciliación: no miraba la firma del servidor, tomaba
  // cualquiera de dos filas con la misma referencia, ignoraba si el crédito
  // fallaba (la fila quedaba "reembolsada" sin plata) y su respaldo podía
  // escribir el saldo de una sola moneda borrando las demás. Y clasificaba con
  // regex que leían UNSUCCESSFUL como éxito.
  //
  // Ahora le pide a mouv-proxy que concilie ESA referencia: allá se le vuelve a
  // preguntar a Finity el estado y se aplica la misma regla que usa el
  // vigilante — un solo camino para mover la plata.
  let r: Response
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/mouv-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'vigilar_finity', ref: orderId, refs: ids, estadoAviso: status }),
      signal: AbortSignal.timeout(60000),
    })
  } catch (e) {
    await audit('finity.webhook.conciliar_fallo', { orderId, status, error: String((e as Error)?.message ?? e).slice(0, 200) })
    // 5xx: que Finity reintente el aviso. El vigilante también lo atrapa.
    return json(502, { ok: false, orderId, error: 'conciliacion_no_disponible' })
  }
  const out = await r.json().catch(() => null) as any
  await audit('finity.webhook.conciliado', { orderId, ids, status, httpStatus: r.status, revisadas: out?.revisadas ?? null, results: out?.results ?? null })
  if (!r.ok) return json(502, { ok: false, orderId, error: 'conciliacion_fallo' })
  return json(200, { ok: true, matched: Number(out?.revisadas ?? 0) > 0, orderId, results: out?.results ?? [] })
})
