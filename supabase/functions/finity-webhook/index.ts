// ════════════════════════════════════════════════════════
// finity-webhook — Receptor de eventos de Finity (portal → Webhook).
//
// Configuración en el portal de Finity (portal.finity.com.co/webhooks):
//   URL:    https://<PROJECT>.supabase.co/functions/v1/finity-webhook
//   Secret: el mismo valor guardado en el secret FINITY_WEBHOOK_SECRET
//
// ⚠️ IMPORTANTE: en Supabase → Edge Functions → finity-webhook →
// Settings, DESACTIVAR "Verify JWT" — Finity llama desde afuera sin
// token de Supabase.
//
// Qué hace:
//   1. Guarda TODO evento en finity_webhook_events (auditoría + para
//      aprender el formato real de los payloads de Finity).
//   2. Si el evento trae número de cuenta + estado (aprobación/rechazo de
//      external account), actualiza el contacto del cliente que tenga esa
//      cuenta inscrita (raw_data.finityContacts) — el badge en la app
//      cambia solo, sin polling.
//   3. Si el evento trae un ID de orden de retiro + estado (rechazo/éxito
//      de una dispersión ya creada), busca la transacción 'Pendiente' que
//      guardó ese ID (el ID de Finity queda embebido en raw_data.reason,
//      ej. "... · Orden po_123 · CONFIRMED") y actúa sola: si Finity
//      rechazó, devuelve el saldo al cliente automáticamente; si Finity
//      confirmó, marca la transacción como Completada. Antes esto exigía
//      que un admin lo detectara a mano en el portal de Finity y lo
//      rechazara manualmente en el Admin de CuyPay para que se devolviera
//      el saldo.
//      ⚠️ Los nombres de campo (id/status) son una interpretación
//      razonable del formato típico de Finity — TODAVÍA no se ha visto un
//      evento real de este tipo. Por eso solo actúa si encuentra un match
//      inequívoco (ID exacto + una única transacción Pendiente); si no,
//      el evento igual queda guardado en finity_webhook_events para
//      ajustar la extracción con el payload real.
//   4. Siempre responde 200 rápido (los webhooks reintentan si no).
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = (Deno.env.get('FINITY_WEBHOOK_SECRET') ?? '').trim()

const db = createClient(SUPABASE_URL, SERVICE_KEY)

// ¿La petición trae el secret? Finity puede mandarlo en distintos headers
// según su implementación — se aceptan los nombres comunes. Si no hay
// secret configurado, se aceptan todos (fase de aprendizaje) pero quedan
// marcados como no verificados.
function verifySecret(req: Request): boolean {
  if (!WEBHOOK_SECRET) return false
  const candidates = [
    req.headers.get('x-webhook-secret'),
    req.headers.get('x-finity-secret'),
    req.headers.get('x-secret'),
    req.headers.get('x-signature'),
    req.headers.get('x-webhook-signature'),
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''),
  ]
  return candidates.some(v => v && v === WEBHOOK_SECRET)
}

const normalizeStatus = (v: unknown): string | null => {
  const s = String(v ?? '').toLowerCase()
  if (!s) return null
  if (/aprob|approv|active|activa|verified|complete|enabled|success/.test(s)) return 'aprobada'
  if (/rechaz|reject|denied|declin|fail/.test(s)) return 'rechazada'
  if (/proces|pend|review|revis|created|unconfirmed/.test(s)) return 'en_proceso'
  return null
}

// Busca recursivamente un número de cuenta y un estado dentro del payload
// (sin conocer el shape exacto de los eventos de Finity).
function extractAccountEvent(obj: unknown, depth = 0): { account: string | null; status: string | null; finityId: string | null } {
  const out = { account: null as string | null, status: null as string | null, finityId: null as string | null }
  if (obj == null || typeof obj !== 'object' || depth > 5) return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = k.toLowerCase()
    if (out.account == null && /account.?number|numero.?de.?cuenta|n_cuenta/.test(key) && (typeof v === 'string' || typeof v === 'number')) {
      out.account = String(v)
    }
    if (out.status == null && /^(status|estado|state|verification_status)$/.test(key)) {
      out.status = normalizeStatus(v)
    }
    if (out.finityId == null && /^(id|external_account_id|account_id)$/.test(key) && typeof v === 'string') {
      out.finityId = v
    }
    if (typeof v === 'object' && v !== null) {
      const inner = extractAccountEvent(v, depth + 1)
      out.account ??= inner.account
      out.status ??= inner.status
      out.finityId ??= inner.finityId
    }
  }
  return out
}

// Busca recursivamente un ID de orden de retiro/dispersión + estado dentro
// del payload. Distinto de extractAccountEvent: ese busca un NÚMERO DE
// CUENTA (para el badge de contactos); esto busca el ID de la ORDEN que
// CuyPay recibió al crearla (po_..., ver "Orden {id}" en raw_data.reason).
function extractWithdrawalEvent(obj: unknown, depth = 0): { orderId: string | null; status: string | null } {
  const out = { orderId: null as string | null, status: null as string | null }
  if (obj == null || typeof obj !== 'object' || depth > 5) return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = k.toLowerCase()
    if (out.orderId == null && /^(id|withdrawal_id|withdrawalorderid|order_id|orderid|po_id|transfer_id|transferid)$/.test(key) && (typeof v === 'string' || typeof v === 'number')) {
      out.orderId = String(v)
    }
    if (out.status == null && /^(status|estado|state)$/.test(key)) {
      out.status = normalizeStatus(v)
    }
    if (typeof v === 'object' && v !== null) {
      const inner = extractWithdrawalEvent(v, depth + 1)
      out.orderId ??= inner.orderId
      out.status ??= inner.status
    }
  }
  return out
}

Deno.serve(async (req) => {
  // Finity puede probar la URL con GET al configurar — responder OK.
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response(JSON.stringify({ ok: true, service: 'finity-webhook' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }

  let payload: unknown = null
  try { payload = await req.json() } catch { /* body no-JSON: se guarda vacío */ }
  const verified = verifySecret(req)

  // 1) Guardar SIEMPRE el evento (aunque no lo entendamos todavía)
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { if (!/^(cookie|authorization)$/i.test(k)) headers[k] = v })
  try {
    await db.from('finity_webhook_events').insert({
      event_type: String((payload as any)?.event ?? (payload as any)?.type ?? (payload as any)?.event_type ?? 'unknown'),
      verified,
      payload: payload ?? {},
      headers,
    })
  } catch (e) {
    console.error('[finity-webhook] no pude guardar el evento:', (e as Error)?.message)
  }

  // 2) Reacción: aprobación/rechazo de cuenta inscrita → actualizar el
  //    contacto del cliente que tenga ese número de cuenta.
  try {
    const ev = extractAccountEvent(payload)
    if (ev.account && ev.status) {
      const { data: users } = await db
        .from('users')
        .select('id, raw_data')
        .not('raw_data->finityContacts', 'is', null)
        .limit(500)
      for (const u of (users as any[]) ?? []) {
        const list: any[] = u?.raw_data?.finityContacts ?? []
        if (!Array.isArray(list) || list.length === 0) continue
        let touched = false
        const next = list.map(c => {
          if (String(c?.accountNumber ?? '') === ev.account) {
            touched = true
            return { ...c, status: ev.status, finityId: c.finityId ?? ev.finityId ?? null }
          }
          return c
        })
        if (touched) {
          await db.from('users').update({ raw_data: { ...u.raw_data, finityContacts: next } }).eq('id', u.id)
          console.log(`[finity-webhook] contacto ${ev.account} → ${ev.status} (user ${u.id})`)
        }
      }
    }
  } catch (e) {
    console.error('[finity-webhook] reacción falló (evento guardado igual):', (e as Error)?.message)
  }

  // 3) Reacción: rechazo/confirmación de una orden de retiro (dispersión)
  //    ya creada → localizar la transacción 'Pendiente' que guardó ese ID
  //    de Finity y actuar sola (devolver saldo si rechazó, marcar
  //    Completado si confirmó). Solo actúa si el match es inequívoco.
  try {
    const ev = extractWithdrawalEvent(payload)
    if (ev.orderId && ev.status && (ev.status === 'rechazada' || ev.status === 'aprobada')) {
      const { data: candidates, error: findErr } = await db
        .from('transactions')
        .select('id, user_id, amount, currency, raw_data')
        .eq('type', 'send')
        .filter('raw_data->>reason', 'ilike', `%Orden ${ev.orderId}%`)
        .eq('status', 'Pendiente')
      if (findErr) {
        console.error('[finity-webhook] no pude buscar la transacción de la orden:', findErr.message)
      } else if (!candidates || candidates.length < 1) {
        console.warn(`[finity-webhook] orden ${ev.orderId} (${ev.status}): 0 transacciones Pendiente encontradas — nada que actualizar`)
      } else {
        // Puede haber MÁS de una fila 'Pendiente' con la misma orden (por el
        // bug histórico que duplicaba movimientos). Antes exigíamos
        // exactamente 1 y, si no, no tocábamos NADA — por eso el estado se
        // quedaba pegado en Pendiente aunque Finity ya hubiera confirmado.
        // Ahora actuamos sobre TODAS las filas de esa orden. En una sola
        // orden real, todas son la misma operación: marcarlas Completado es
        // idempotente; para un rechazo, se devuelve el saldo UNA sola vez.
        const ids = (candidates as any[]).map(c => c.id)
        if (ev.status === 'rechazada') {
          const tx = candidates[0] as any
          const { data: u } = await db.from('users').select('balances').eq('id', tx.user_id).single()
          if (u) {
            const bals = (u.balances as Record<string, number>) ?? {}
            const refunded = parseFloat(((Number(bals[tx.currency] ?? 0)) + Number(tx.amount)).toFixed(2))
            await db.from('users').update({ balances: { ...bals, [tx.currency]: refunded } }).eq('id', tx.user_id)
          }
          await db.from('transactions').update({ status: 'Rechazado' }).in('id', ids)
          console.log(`[finity-webhook] orden ${ev.orderId} RECHAZADA — saldo devuelto 1 vez, ${ids.length} fila(s) marcada(s) Rechazado (tx ${ids.join(',')})`)
        } else {
          await db.from('transactions').update({ status: 'Completado' }).in('id', ids)
          console.log(`[finity-webhook] orden ${ev.orderId} CONFIRMADA — ${ids.length} fila(s) marcada(s) Completado (tx ${ids.join(',')})`)
        }
      }
    }
  } catch (e) {
    console.error('[finity-webhook] reacción de orden de retiro falló (evento guardado igual):', (e as Error)?.message)
  }

  // 4) Responder rápido y siempre 200
  return new Response(JSON.stringify({ ok: true, verified }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
})
