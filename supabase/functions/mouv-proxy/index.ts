// ─────────────────────────────────────────────
// mouv-proxy — Proxy server-side para la API de Mouv Platform
// (rails de pago colombianos: BREB, ACH, PSE). Reemplaza a mouv-proxy.
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

// ══════════════════════════════════════════════════════════════════
//  PUNTO ÚNICO DE INTEGRACIÓN CON MOUV — dispersión BREB / ACH
//  ------------------------------------------------------------------
//  Cuando tengas el cURL exacto de la doc de Mouv, DESCOMENTA el bloque
//  del riel correspondiente y ajusta el `path` y el `body` a lo que pida
//  la doc. Debe devolver ok:true SOLO si Mouv aceptó el payout.
//  Mientras esté sin cablear devuelve notImplemented y el edge reintegra
//  el saldo del cliente automáticamente (no se mueve plata).
//
//  `recipient` que llega del front:
//    BREB → { keyType: 'cedula'|'celular'|'correo'|'alfanumerico', key, holderName?, reference? }
//    ACH  → { bankCode, accountType: 'ahorros'|'corriente'|'deposito',
//             accountNumber, documentType, documentNumber, holderName, reference? }
// ══════════════════════════════════════════════════════════════════
async function mouvPayout(
  rail: 'BREB' | 'ACH',
  recipient: Record<string, any>,
  amountCop: number,
): Promise<{ ok: boolean; status: number; data: any; providerRef?: string; notImplemented?: boolean }> {
  if (rail === 'BREB') {
    // ── PEGA AQUÍ EL cURL DE BRE-B ──────────────────────────────────
    // const r = await mouvFetch('/PATH_DE_LA_DOC', {
    //   method: 'POST',
    //   body: JSON.stringify({
    //     key_type: recipient.keyType,       // ajusta el nombre real del campo
    //     key: recipient.key,
    //     amount: amountCop,
    //     currency: 'COP',
    //     reference: recipient.reference ?? undefined,
    //   }),
    // })
    // return { ok: r.ok, status: r.status, data: r.data, providerRef: r.data?.id ?? r.data?.transaction_id }
  } else {
    // ── PEGA AQUÍ EL cURL DE ACH ────────────────────────────────────
    // const r = await mouvFetch('/PATH_DE_LA_DOC', {
    //   method: 'POST',
    //   body: JSON.stringify({
    //     bank_code: recipient.bankCode,
    //     account_type: recipient.accountType,
    //     account_number: recipient.accountNumber,
    //     document_type: recipient.documentType,
    //     document_number: recipient.documentNumber,
    //     holder_name: recipient.holderName,
    //     amount: amountCop,
    //     currency: 'COP',
    //     reference: recipient.reference ?? undefined,
    //   }),
    // })
    // return { ok: r.ok, status: r.status, data: r.data, providerRef: r.data?.id ?? r.data?.transaction_id }
  }
  // Sin cablear todavía → el edge reintegra el saldo.
  return { ok: false, status: 0, data: { error: 'not_implemented' }, notImplemented: true }
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

  // ── ping / balance: saldo de la wallet COMPARTIDA — SOLO ADMIN ──
  // Los clientes NUNCA pueden ver el saldo total de la wallet Mouv; ellos
  // solo disponen del saldo interno que el admin les cargó (Cargues). Por
  // eso estas dos acciones exigen caller.admin.
  if (action === 'ping') {
    if (!caller.admin) return json(403, { error: 'forbidden', message: 'Solo admin.' })
    const r = await mouvFetch('/wallets/balance')
    return json(200, {
      ok: r.ok,
      status: r.status,
      base: MOUV_BASE,
      message: r.ok ? 'Credenciales Mouv válidas — conectado.' : `Mouv respondió ${r.status}.`,
      data: r.data,
    })
  }

  if (action === 'balance') {
    if (!caller.admin) return json(403, { error: 'forbidden', message: 'Solo admin.' })
    const r = await mouvFetch('/wallets/balance')
    return json(200, { ok: r.ok, status: r.status, path: r.path, data: r.data })
  }

  // ── dispersión BREB / ACH ──
  // El cliente dispersa contra su SALDO INTERNO del riel (COP_BREB / COP_ACH),
  // el que el admin le cargó — nunca contra el total de la wallet compartida.
  // Flujo seguro: valida saldo → debita → registra tx → llama a Mouv →
  // si Mouv falla (o aún no está cableado) REINTEGRA el saldo (no se mueve
  // plata). Así un cliente jamás gasta más de lo que se le cargó.
  if (action === 'payout_breb' || action === 'payout_ach') {
    const rail: 'BREB' | 'ACH' = action === 'payout_breb' ? 'BREB' : 'ACH'
    const railCol = action === 'payout_breb' ? 'COP_BREB' : 'COP_ACH'
    const userId = caller.userId ?? payload.userId ?? payload.user_id
    if (!userId) return json(400, { error: 'missing_user', message: 'Falta el usuario.' })

    const amount = Number(payload.amount)
    if (!isFinite(amount) || amount <= 0) return json(400, { error: 'bad_amount', message: 'Monto inválido.' })

    const recipient = (payload.recipient ?? {}) as Record<string, any>
    // Validación mínima del destinatario según el riel
    if (rail === 'BREB') {
      if (!recipient.key || !recipient.keyType) return json(400, { error: 'bad_recipient', message: 'Falta la llave Bre-B (tipo y valor).' })
    } else {
      if (!recipient.bankCode || !recipient.accountNumber || !recipient.accountType || !recipient.documentNumber)
        return json(400, { error: 'bad_recipient', message: 'Faltan datos de la cuenta ACH (banco, tipo, número y documento).' })
    }

    // 1) Leer saldo interno del riel
    const { data: u } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
    if (!u) return json(404, { error: 'user_not_found', message: 'Usuario no encontrado.' })
    const bals: Record<string, number> = (u.balances as any) ?? {}
    const current = Number(bals[railCol] ?? 0)
    if (current < amount) return json(400, { error: 'insufficient_funds', message: `Saldo ${rail} insuficiente. Disponible: ${current.toLocaleString('es-CO')} COP.` })

    // 2) Debitar el saldo interno (read-check-write; sistema temporal/manual)
    const afterDebit = Number((current - amount).toFixed(2))
    const { error: debErr } = await db.from('users').update({ balances: { ...bals, [railCol]: afterDebit } }).eq('id', userId)
    if (debErr) return json(500, { error: 'debit_failed', message: 'No se pudo reservar el saldo. Intenta de nuevo.' })

    // 3) Registrar la transacción (type 'dispersion' — NO colisiona con la
    //    cola de retiros del admin, que es type 'send' + 'Pendiente').
    const { data: txIns } = await db.from('transactions').insert({
      user_id: userId, type: 'dispersion', amount, currency: railCol, status: 'Procesando',
      raw_data: { source: 'mouv_payout', rail, recipient, requestedAt: new Date().toISOString() },
    }).select('id').maybeSingle()
    const txId = (txIns as any)?.id ?? null

    // 4) Llamar a Mouv (punto único de integración — ver mouvPayout)
    const pay = await mouvPayout(rail, recipient, amount)

    if (pay.ok) {
      if (txId) await db.from('transactions').update({
        status: 'Completado',
        raw_data: { source: 'mouv_payout', rail, recipient, providerRef: pay.providerRef ?? null, settledAt: new Date().toISOString() },
      }).eq('id', txId)
      await logAudit(userId, `mouv.${action}.ok`, { amount, rail, providerRef: pay.providerRef ?? null })
      return json(200, { ok: true, providerRef: pay.providerRef ?? null, newBalance: afterDebit })
    }

    // 5) Falló o aún no está cableado → REINTEGRAR el saldo
    const { data: u2 } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
    const bals2: Record<string, number> = (u2?.balances as any) ?? {}
    const restored = Number((Number(bals2[railCol] ?? 0) + amount).toFixed(2))
    await db.from('users').update({ balances: { ...bals2, [railCol]: restored } }).eq('id', userId)
    if (txId) await db.from('transactions').update({
      status: pay.notImplemented ? 'Rechazado' : 'Fallido',
      raw_data: { source: 'mouv_payout', rail, recipient, error: pay.data?.error ?? 'payout_failed', refunded: true, failedAt: new Date().toISOString() },
    }).eq('id', txId)
    await logAudit(userId, `mouv.${action}.fail`, { amount, rail, notImplemented: !!pay.notImplemented, status: pay.status })

    if (pay.notImplemented) {
      return json(200, { error: 'not_implemented', refunded: true, newBalance: restored,
        message: 'La dispersión con Mouv aún no está cableada (falta el endpoint exacto de la doc). Tu saldo NO fue afectado.' })
    }
    return json(200, { error: 'payout_failed', refunded: true, newBalance: restored, status: pay.status, data: pay.data,
      message: `Mouv rechazó la dispersión (HTTP ${pay.status}). Tu saldo fue devuelto.` })
  }

  return json(200, { error: 'unknown_action', message: `Acción no soportada: ${action}` })
})
