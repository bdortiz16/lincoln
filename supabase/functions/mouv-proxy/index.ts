// ─────────────────────────────────────────────
// mouv-proxy — Proxy server-side para la API de Mouv Platform
// (rails de pago colombianos: BREB, ACH, PSE). Reemplaza a finity-proxy.
//
// Autenticación: API key de Mouv (mvk_live_...) enviada como
//   Authorization: Bearer <MOUV_API_KEY>
// La key vive SOLO como secret de la edge function (MOUV_API_KEY) — nunca
// llega al cliente. Base URL: https://consola.mouvlatam.com/api
//
// Confirmado de la doc (developer.mouvlatam.com/introduction):
//   GET /api/wallets/balance  → saldo de la wallet
//   Rails: BREB (alias/celular/correo/cédula, tope $12M COP),
//          ACH (Ahorros/Corriente/Depósito, tope $2.000M COP),
//          PSE (recaudo entrante → link).
//   Sin prefijo de versión (/api/...).
//
// ⏳ PENDIENTE (esperando los cURL de la doc): los endpoints y bodies de
//    los retiros BREB y ACH, y del recaudo PSE. Ver acciones payout_breb /
//    payout_ach más abajo — hoy devuelven 'not_implemented' a propósito
//    para NO inventar un contrato de un endpoint que mueve plata.
// ─────────────────────────────────────────────
import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const MOUV_API_KEY = (Deno.env.get('MOUV_API_KEY') ?? '').trim()
// Overridable por si mañana cambia el host o hay sandbox; default = prod.
const MOUV_BASE = (Deno.env.get('MOUV_BASE_URL') ?? 'https://consola.mouvlatam.com/api').replace(/\/+$/, '')
const ADMIN_PASS = Deno.env.get('ADMIN_PASS') ?? ''

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Llamada autenticada a Mouv. Timeout duro para no colgar el proxy si Mouv
// no responde. Devuelve { ok, status, data, path } sin lanzar.
async function mouvFetch(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; path: string }> {
  try {
    const r = await fetch(`${MOUV_BASE}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${MOUV_API_KEY}`,
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(20000),
    })
    const text = await r.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: r.ok, status: r.status, data, path }
  } catch (e) {
    return { ok: false, status: 0, data: { error: (e as Error)?.message ?? String(e) }, path }
  }
}

// Registro de auditoría best-effort (no bloquea la operación).
async function logAudit(userId: string | null, action: string, metadata: Record<string, unknown>) {
  try {
    await db.from('audit_log').insert({ user_id: userId, action, metadata })
  } catch { /* la tabla puede no existir en este proyecto — no romper */ }
}

// Valida quién llama: admin-bypass (header compartido) o un usuario real con
// JWT válido. Balance y payouts son sensibles → siempre requieren caller.
async function validCaller(req: Request, payload: any): Promise<{ ok: boolean; userId: string | null; admin: boolean }> {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (ADMIN_PASS && authHeader === `AdminBypass ${ADMIN_PASS}`) return { ok: true, userId: null, admin: true }
  const jwt = authHeader.replace('Bearer ', '').trim()
  if (jwt) {
    try {
      const { data: { user } } = await Promise.race([
        db.auth.getUser(jwt),
        new Promise<any>((_, rej) => setTimeout(() => rej(new Error('auth_timeout')), 3000)),
      ]) as any
      if (user?.id) {
        const { data: u } = await db.from('users').select('id, role').eq('id', user.id).maybeSingle()
        return { ok: true, userId: user.id, admin: (u as any)?.role === 'admin' }
      }
    } catch { /* jwt inválido/vencido → cae abajo */ }
  }
  // Respaldo: user_id explícito que exista (medio-auth, como en otros proxies)
  const uid = payload?.user_id ?? payload?.userId
  if (uid) {
    const { data } = await db.from('users').select('id, role').eq('id', uid).maybeSingle()
    if (data) return { ok: true, userId: uid, admin: (data as any)?.role === 'admin' }
  }
  return { ok: false, userId: null, admin: false }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!MOUV_API_KEY) {
    return json(200, { error: 'mouv_not_configured', message: 'Falta el secret MOUV_API_KEY en la edge function.' })
  }

  const payload = await req.json().catch(() => ({}))
  const action = String(payload.action ?? '')

  const caller = await validCaller(req, payload)
  if (!caller.ok) return json(401, { error: 'unauthorized', message: 'unauthorized (mouv-proxy v1)' })

  // ── ping: verifica credenciales golpeando el saldo ──
  if (action === 'ping') {
    const r = await mouvFetch('/wallets/balance')
    return json(200, {
      ok: r.ok,
      status: r.status,
      base: MOUV_BASE,
      message: r.ok ? 'Credenciales Mouv válidas — conectado.' : `Mouv respondió ${r.status}.`,
      data: r.data,
    })
  }

  // ── balance: saldo de la wallet ──
  if (action === 'balance') {
    const r = await mouvFetch('/wallets/balance')
    return json(200, { ok: r.ok, status: r.status, path: r.path, data: r.data })
  }

  // ── payouts BREB / ACH — PENDIENTE del contrato exacto de la doc ──
  // Cuando tenga el cURL de cada uno, acá van los POST reales con su body.
  if (action === 'payout_breb' || action === 'payout_ach') {
    await logAudit(caller.userId, `mouv.${action}.attempt`, { note: 'endpoint pendiente de contrato' })
    return json(200, {
      error: 'not_implemented',
      message: 'Los retiros BREB/ACH aún no están cableados: falta el endpoint y el body exactos de la documentación de Mouv.',
    })
  }

  return json(200, { error: 'unknown_action', message: `Acción no soportada: ${action}` })
})
