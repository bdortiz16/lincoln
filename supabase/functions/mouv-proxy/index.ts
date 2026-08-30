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
// Dispersión REAL cableada (quickstart de la doc):
//   POST /api/transfers/resolve-key  → titular oficial de la llave (SARLAFT)
//   POST /api/transfers/send         → retiro BREB (destino inline) / ACH
//   Valores en CENTAVOS. Ver mouvPayout. ACH aún con destino best-guess.
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
//  DISPERSIÓN REAL CON MOUV — POST /api/transfers/send (destino inline)
//  ------------------------------------------------------------------
//  Contrato (quickstart de la doc):
//   BREB → { amount, destination:{ brebKey:{ type, value } }, targetName,
//            targetDocument, reference }  → 201 { id, status:'PENDING', rail }
//   `targetName` + `targetDocument` son OBLIGATORIOS SARLAFT: se sacan de
//   POST /api/transfers/resolve-key { keyValue } → recipient.fullName / idValue.
//
//  `recipient` que llega del front:
//    BREB → { keyType:'celular'|'cedula'|'correo'|'alfanumerico', key, holderName?, reference? }
//    ACH  → { bankCode, accountType:'ahorros'|'corriente'|'deposito',
//             accountNumber, documentType, documentNumber, holderName, reference? }
//
//  UNIDAD: Mouv trabaja en CENTAVOS (confirmado contra el saldo real:
//  availableCents 3.173.093.200 = $31.730.932). El `amount` que llega a
//  mouvPayout viene en PESOS y se multiplica ×100 antes de enviarlo.
// ══════════════════════════════════════════════════════════════════

// Mapea el tipo de llave interno → el enum de Mouv (fallback; lo ideal es
// usar el keyType que devuelve resolve-key, que es autoritativo).
function brebTypeToMouv(t: string): string {
  switch ((t || '').toLowerCase()) {
    case 'celular': return 'PHONE'
    case 'correo': return 'EMAIL'
    case 'cedula': return 'DOCUMENT'
    case 'alfanumerico': return 'ALPHANUMERIC'
    default: return 'PHONE'
  }
}

async function mouvPayout(
  rail: 'BREB' | 'ACH',
  recipient: Record<string, any>,
  amountCop: number,
): Promise<{ ok: boolean; status: number; data: any; providerRef?: string; notImplemented?: boolean; targetName?: string; targetDocument?: string }> {
  // Mouv trabaja en CENTAVOS (confirmado contra el saldo real). El monto que
  // llega es en PESOS → se convierte a centavos para /transfers/send.
  const amountCents = Math.round(amountCop * 100)
  // Los contactos pueden traer placeholders ("—", "-") en nombre/documento;
  // NO sirven para SARLAFT ni para Mouv → tratarlos como ausentes.
  const cleanField = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim()
    return s && s !== '—' && s !== '-' && s !== 'N/A' ? s : undefined
  }
  if (rail === 'BREB') {
    // 1) Resolver la llave para obtener el titular oficial (SARLAFT).
    let targetName: string | undefined = cleanField(recipient.holderName)
    let targetDocument: string | undefined = cleanField(recipient.documentNumber ?? recipient.docNumber)
    let keyType = brebTypeToMouv(recipient.keyType)
    try {
      const rk = await mouvFetch('/transfers/resolve-key', {
        method: 'POST', body: JSON.stringify({ keyValue: recipient.key }),
      })
      const rd: any = rk.data ?? {}
      if (rk.ok && rd.found) {
        targetName = rd.recipient?.fullName ?? targetName
        targetDocument = rd.recipient?.idValue ?? targetDocument
        keyType = rd.keyType ?? keyType   // autoritativo
      } else if (rk.ok && rd.found === false) {
        return { ok: false, status: rk.status, data: { error: 'breb_key_not_found', message: 'La llave Bre-B no existe o no está activa.' } }
      }
    } catch { /* si resolve falla seguimos con los datos del contacto */ }

    if (!targetName || !targetDocument) {
      return { ok: false, status: 0, data: { error: 'missing_sarlaft', message: 'No se pudo obtener el titular de la llave (nombre/documento requeridos por SARLAFT).' } }
    }

    // Referencia ÚNICA por envío: si Mouv dedupe por referencia (409 Conflict
    // al repetir {monto, destino, referencia}), un reintento tras reembolso o
    // dos envíos iguales chocarían. El sufijo corto evita la colisión.
    const refBase = cleanField(recipient.reference) ?? 'Pago Lincoin'
    const refUniq = `${refBase} ${Date.now().toString(36).slice(-5)}`
    const r = await mouvFetch('/transfers/send', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountCents,
        destination: { brebKey: { type: keyType, value: recipient.key } },
        targetName,
        targetDocument,
        reference: refUniq,
      }),
    })
    // Devolver el titular RESUELTO (oficial, de resolve-key) para que el
    // comprobante muestre el nombre/documento reales del beneficiario.
    return { ok: r.ok, status: r.status, data: r.data, providerRef: r.data?.id, targetName, targetDocument }
  }

  // ── ACH — mismo endpoint /transfers/send con destino de cuenta bancaria.
  // ⚠️ La forma EXACTA del destino ACH no está en el quickstart (la página
  // "Retiros ACH" → /api-reference/transfers/send la tiene). Este body es la
  // forma más probable; ajústalo aquí cuando veas esa página.
  const r = await mouvFetch('/transfers/send', {
    method: 'POST',
    body: JSON.stringify({
      amount: amountCents,
      destination: {
        bankAccount: {
          bankCode: recipient.bankCode,
          accountType: (recipient.accountType || '').toUpperCase(),  // AHORROS | CORRIENTE | DEPOSITO
          accountNumber: recipient.accountNumber,
        },
      },
      targetName: recipient.holderName,
      targetDocument: recipient.documentNumber,
      reference: recipient.reference ?? 'Pago Lincoin',
    }),
  })
  return { ok: r.ok, status: r.status, data: r.data, providerRef: r.data?.id, targetName: recipient.holderName, targetDocument: recipient.documentNumber }
}

// ── Cotización de comisión Mouv (Bre-B) ────────────────────────────
// POST /api/transfers/quote { amount(cents), keyValue } →
// { feeBreakdown:{ fixedFee, variableFee, subtotalFee, ivaAmount,
//   totalCharged }, totalCost, canAfford }  (valores en CENTAVOS)
// La comisión SE COBRA AL CLIENTE: el débito del riel es monto + comisión.
async function mouvQuoteBreb(amountCop: number, keyValue: string): Promise<{ ok: boolean; feeCop: number; fixedCop: number; variableCop: number; ivaCop: number; raw: any }> {
  const r = await mouvFetch('/transfers/quote', {
    method: 'POST',
    body: JSON.stringify({ amount: Math.round(amountCop * 100), keyValue }),
  })
  const d: any = r.data ?? {}
  const fb = d.feeBreakdown ?? {}
  const toP = (v: any) => (Number(v) || 0) / 100
  return {
    ok: r.ok,
    feeCop: toP(fb.totalCharged ?? d.totalCharged),
    fixedCop: toP(fb.fixedFee), variableCop: toP(fb.variableFee), ivaCop: toP(fb.ivaAmount),
    raw: d,
  }
}

// ── FINITY (riel ACH) ──────────────────────────────────────────────
// ACH va por Finity (precio fijo por transferencia, más barato que el
// 0,10% de Mouv). Se llama a la edge function finity-proxy (restaurada),
// que maneja OAuth y los paths. El costo REAL viene en la respuesta de la
// orden (costs.{commission,iva,total}) y SE COBRA AL CLIENTE.
const BANK_CODES_CO: Record<string, string> = {
  'Banco de Bogotá': '1001', 'Banco Popular': '1002', 'Itaú': '1006', 'Bancolombia': '1007',
  'Citibank': '1009', 'GNB Sudameris': '1012', 'BBVA Colombia': '1013', 'Scotiabank Colpatria': '1019',
  'Banco de Occidente': '1023', 'Banco Caja Social': '1032', 'Banco Agrario': '1040', 'Davivienda': '1051',
  'Banco AV Villas': '1052', 'Banco Pichincha': '1060', 'Bancoomeva': '1061', 'Banco Falabella': '1062',
  'Coopcentral': '1066', 'Lulo Bank': '1070', 'Nequi': '1507', 'Daviplata': '1551',
  'Movii': '1801', 'Nu Colombia': '1809', 'Nu': '1809',
}
async function finityCall(action: string, userId: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/finity-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action, user_id: userId, ...extra }),
  })
  return r.json().catch(() => null)
}
// Precio por transferencia ACH que SE COBRA AL CLIENTE: $2.500 COP por
// envío (override con el secret ACH_FEE_COP). Finity no devuelve costs en
// la orden — doc oficial: { id, status, amount, destination_account }.
const ACH_FEE_COP = Number(Deno.env.get('ACH_FEE_COP') ?? '2500') || 2500
// Comisión FIJA por envío Bre-B que se le cobra al cliente ($1.200 por
// defecto; override con el secret BREB_FEE_COP). El costo real de Mouv
// (fija + variable + IVA) lo absorbe Lincoin — al cliente además ya se le
// cobró el 0,10% al RECIBIR el cargue en su cuenta Bre-B (admin-data).
const BREB_FEE_COP = Number(Deno.env.get('BREB_FEE_COP') ?? '1200') || 1200

async function finityPayoutAch(userId: string, recipient: Record<string, any>, amountCop: number):
  Promise<{ ok: boolean; providerRef?: string; state?: string; feeCop: number; costs?: any; error?: any; destinationId?: string; amountMismatch?: Record<string, unknown> | null }> {
  // 1) Cuenta destino en Finity (destination_id). Reusar si el contacto ya
  //    la trae; si no, registrarla ahora.
  let destId: string | null = recipient.finityId ?? null
  if (!destId) {
    const body = {
      data: {
        account: {
          geo: 'CO',
          account_type: recipient.accountType === 'corriente' || recipient.accountType === 'CORRIENTE' || recipient.accountType === 'checking' ? 'checking' : 'savings',
          account_number: String(recipient.accountNumber ?? ''),
          financial_institution_code: BANK_CODES_CO[String(recipient.bankCode ?? '')] ?? String(recipient.bankCode ?? ''),
          account_holder_fullname: String(recipient.holderName ?? ''),
          account_holder_id_type: String(recipient.documentType ?? 'CC') === 'PAS' ? 'CE' : String(recipient.documentType ?? 'CC'),
          account_holder_id_number: String(recipient.documentNumber ?? ''),
        },
      },
    }
    const ea = await finityCall('create_external_account', userId, body)
    destId = ea?.data?.id ?? ea?.data?.external_account_id ?? ea?.data?.account_id ?? null
    if (!ea?.ok || !destId) return { ok: false, feeCop: 0, error: { step: 'destino', httpStatus: ea?.status ?? null, path: ea?.path ?? null, body: ea?.data ?? null } }
  }
  // 2) Orden de retiro:
  //    POST /v0/withdrawal-orders { destination_id, amount, currency:'COP' }
  //    ⚠️ amount va en PESOS ENTEROS — NO en centavos. VERIFICADO CONTRA
  //    PRODUCCIÓN: una dispersión de $10.000 enviada como 1.000.000
  //    (pesos × 100, como decía la doc de "unidades menores") creó en
  //    Finity un retiro REAL de COP $1.000.000. NUNCA multiplicar aquí.
  //    → 201 { id, status: PROCESSING|COMPLETED|FAILED, destination_account }
  //    (NO devuelve costs — el precio por transferencia es ACH_FEE_COP.)
  const requestedCop = Math.round(amountCop)
  const w = await finityCall('create_withdrawal', userId, { data: { amount: requestedCop, currency: 'COP', destination_id: destId } })
  const od: any = w?.data ?? {}
  // El error DEBE conservar status/path/cuerpo — con '{}' pelado es
  // imposible saber si fue ruta (404), auth (401) o validación (400).
  if (!w?.ok || !od.id) return {
    ok: false, feeCop: 0, destinationId: destId ?? undefined,
    error: { step: 'retiro', httpStatus: w?.status ?? null, path: w?.path ?? null, body: (od && Object.keys(od).length > 0) ? od : (w?.data ?? w ?? null) },
  }
  // CONTROL DE MONTO (post-orden): si Finity ecoa un amount y NO coincide
  // con lo pedido (±1 peso; también se detecta el patrón ×100 / ÷100), se
  // deja constancia para auditoría y se marca la orden para revisión —
  // exactamente el tipo de discrepancia que produjo el retiro de $1.000.000
  // por una dispersión de $10.000.
  let amountMismatch: Record<string, unknown> | null = null
  const echoed = Number(od.amount ?? od.data?.amount)
  if (Number.isFinite(echoed) && echoed > 0 && Math.abs(echoed - requestedCop) > 1) {
    amountMismatch = {
      requestedCop, providerAmount: echoed,
      pattern: Math.abs(echoed - requestedCop * 100) <= 1 ? 'x100' : Math.abs(echoed - requestedCop / 100) <= 1 ? '/100' : 'otro',
    }
    await logAudit(userId, 'finity.withdrawal.amount_mismatch', { providerRef: String(od.id), ...amountMismatch })
  }
  return { ok: true, providerRef: String(od.id), state: od.status ?? od.state ?? 'PROCESSING', feeCop: ACH_FEE_COP, destinationId: destId ?? undefined, amountMismatch }
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

  // ── treasury_balances: saldo de la wallet COMPARTIDA para el panel admin ──
  // Usa el endpoint confirmado GET /api/wallets/balance. Devuelve el crudo +
  // un parseo best-effort (los nombres exactos de los campos se ajustan al
  // ver la respuesta real). SOLO ADMIN.
  if (action === 'treasury_balances') {
    if (!caller.admin) return json(403, { error: 'forbidden', message: 'Solo admin.' })
    const r = await mouvFetch('/wallets/balance')
    if (!r.ok) return json(200, { error: `Mouv respondió ${r.status}.`, status: r.status, raw: r.data })
    const d: any = r.data ?? {}
    // Estructura real (doc): { currency, wallets:[{rail:'BREB'|'ACH',
    //   availableCents, totalCents, maxTransferAmount,...}], consolidated:{availableCents} }
    // El valor va en PESOS (mismo criterio que /transfers: amount en pesos).
    const toNum = (v: any): number | null => {
      if (typeof v === 'number') return v
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
      return null
    }
    // Los *Cents vienen en CENTAVOS (confirmado: 3.173.093.200 = $31.730.932).
    const centsToPesos = (v: any): number | null => { const n = toNum(v); return n === null ? null : n / 100 }
    const wallets: any[] = Array.isArray(d?.wallets) ? d.wallets : []
    const railAmt = (rail: string): number | null => {
      const w = wallets.find(x => String(x?.rail ?? '').toUpperCase() === rail)
      return w ? centsToPesos(w.availableCents) : null
    }
    const breb = railAmt('BREB')
    const ach = railAmt('ACH')
    const total = centsToPesos(d?.consolidated?.availableCents) ?? ((breb ?? 0) + (ach ?? 0) || null)
    return json(200, { ok: true, status: r.status, source: 'mouv', total, breb, ach, cop: total, raw: d })
  }

  // ── Conciliación ACH SIN webhook ──────────────────────────
  // Mientras el webhook del proveedor no esté activo, la app pregunta el
  // estado real de las órdenes de retiro de las dispersiones ACH que
  // siguen 'Procesando' y actualiza: COMPLETED → Completado ·
  // FAILED/CANCELLED → Rechazado + REEMBOLSO (monto + comisión) al riel.
  // Idempotente (flag refunded). La llama el frontend al abrir Movimientos.
  if (action === 'reconcile_ach') {
    const userId = caller.userId ?? payload.userId ?? payload.user_id
    if (!userId) return json(400, { error: 'missing_user' })
    const { data: rows } = await db.from('transactions')
      .select('id, user_id, amount, currency, status, raw_data')
      .eq('type', 'dispersion').eq('user_id', userId).eq('status', 'Procesando')
      .limit(20)
    const out: any[] = []
    for (const tx of (rows ?? []) as any[]) {
      const rd = (tx.raw_data ?? {}) as Record<string, any>
      const ref = String(rd.providerRef ?? '')
      if (!ref) continue
      const st = await finityCall('withdrawal_status', String(userId), { id: ref })
      const d = (st?.data ?? {}) as any
      const s = String(d.status ?? d.state ?? '').toUpperCase()
      if (/COMPLETED|SUCCESS|PAID|SETTLED/.test(s)) {
        await db.from('transactions').update({
          status: 'Completado',
          raw_data: { ...rd, providerStatus: s, reconciledAt: new Date().toISOString() },
        }).eq('id', tx.id)
        out.push({ id: tx.id, result: 'completed' })
      } else if (/FAILED|REJECT|CANCEL|RETURNED/.test(s)) {
        if (rd.refunded) { out.push({ id: tx.id, result: 'already_refunded' }); continue }
        const refund = Number(tx.amount ?? 0) + Number(rd.feeCop ?? 0)
        const railCol = String(tx.currency ?? 'COP_ACH')
        const { data: u } = await db.from('users').select('balances').eq('id', userId).single()
        const bals: Record<string, number> = (u?.balances as any) ?? {}
        const nb = parseFloat(((bals[railCol] ?? 0) + refund).toFixed(2))
        await db.from('users').update({ balances: { ...bals, [railCol]: nb } }).eq('id', userId)
        await db.from('transactions').update({
          status: 'Rechazado',
          raw_data: { ...rd, refunded: true, refundCop: refund, providerStatus: s, reconciledAt: new Date().toISOString() },
        }).eq('id', tx.id)
        out.push({ id: tx.id, result: 'refunded', refund })
      } else {
        out.push({ id: tx.id, result: 'still_processing', providerStatus: s || null })
      }
    }
    return json(200, { ok: true, checked: (rows ?? []).length, results: out })
  }

  // ── Cotización de comisión para el paso Confirmar del cliente ──
  // BREB → comisión FIJA Lincoin ($1.200 por envío; el costo Mouv lo
  //        absorbe Lincoin — al cliente ya se le cobró 0,10% al recibir
  //        el cargue). No depende de cotizar a Mouv en vivo.
  // ACH → precio fijo por transferencia (Finity), ACH_FEE_COP.
  if (action === 'payout_quote') {
    const amount = Number(payload.amount)
    if (!isFinite(amount) || amount <= 0) return json(400, { error: 'bad_amount' })
    const rail = String(payload.rail ?? 'BREB').toUpperCase()
    if (rail === 'BREB') {
      return json(200, { ok: true, rail: 'BREB', provider: 'lincoin', feeCop: BREB_FEE_COP, fixedCop: BREB_FEE_COP, variableCop: 0, ivaCop: 0, totalCop: amount + BREB_FEE_COP })
    }
    // ACH: comisión FIJA única ($2.500) — SIN componente variable.
    return json(200, { ok: true, rail: 'ACH', provider: 'finity', feeCop: ACH_FEE_COP, fixedCop: ACH_FEE_COP, variableCop: 0, ivaCop: 0, totalCop: amount + ACH_FEE_COP })
  }

  // ── dispersión BREB (Mouv) / ACH (Finity) ──
  // El cliente dispersa contra su SALDO INTERNO del riel (COP_BREB / COP_ACH).
  // La COMISIÓN al cliente:
  //   BREB → $1.200 fijos por envío (BREB_FEE_COP); se debita monto + 1.200.
  //   ACH  → precio fijo Finity (ACH_FEE_COP); se debita monto + tarifa.
  // Si el proveedor falla, se REINTEGRA todo lo debitado.
  if (action === 'payout_breb' || action === 'payout_ach') {
    const rail: 'BREB' | 'ACH' = action === 'payout_breb' ? 'BREB' : 'ACH'
    const railCol = action === 'payout_breb' ? 'COP_BREB' : 'COP_ACH'
    const userId = caller.userId ?? payload.userId ?? payload.user_id
    if (!userId) return json(400, { error: 'missing_user', message: 'Falta el usuario.' })

    const amount = Number(payload.amount)
    if (!isFinite(amount) || amount <= 0) return json(400, { error: 'bad_amount', message: 'Monto inválido.' })
    if (Math.round(amount) !== amount) return json(400, { error: 'bad_amount', message: 'El monto debe ser en pesos enteros.' })

    // ── PROTOCOLOS DE SEGURIDAD (estándar fintech) ──
    // (1) Tope por operación: ninguna dispersión individual puede superar el
    //     límite (PAYOUT_MAX_COP, default $20.000.000; override por secret).
    const PAYOUT_MAX_COP = Number(Deno.env.get('PAYOUT_MAX_COP') ?? '20000000') || 20000000
    if (amount > PAYOUT_MAX_COP) {
      return json(400, { error: 'over_limit', message: `El monto supera el límite por operación (${PAYOUT_MAX_COP.toLocaleString('es-CO')} COP). Para montos mayores usa la Mesa OTC.` })
    }
    // (2) Idempotencia / anti doble-clic: si YA existe una dispersión idéntica
    //     (mismo usuario, riel y monto) creada hace menos de 2 minutos y que
    //     no fue rechazada, se bloquea el reenvío — dos toques al botón
    //     Confirmar no pueden ejecutar la operación dos veces.
    try {
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString()
      const { data: dup } = await db.from('transactions')
        .select('id, status, created_at')
        .eq('user_id', userId).eq('type', 'dispersion').eq('currency', railCol).eq('amount', amount)
        .gte('created_at', since)
        .in('status', ['Procesando', 'Completado'])
        .limit(1)
      if (dup && dup.length > 0) {
        await logAudit(userId, `mouv.${action}.duplicate_blocked`, { amount, rail, existingTx: dup[0].id })
        return json(200, { error: 'duplicate', message: 'Ya hay una dispersión idéntica en curso (hace menos de 2 minutos). Revisa tus Movimientos antes de volver a enviar.' })
      }
    } catch { /* si la verificación falla no se bloquea el envío legítimo */ }

    const recipient = (payload.recipient ?? {}) as Record<string, any>
    // Validación mínima del destinatario según el riel
    if (rail === 'BREB') {
      if (!recipient.key || !recipient.keyType) return json(400, { error: 'bad_recipient', message: 'Falta la llave Bre-B (tipo y valor).' })
    } else {
      if (!recipient.bankCode || !recipient.accountNumber || !recipient.accountType || !recipient.documentNumber)
        return json(400, { error: 'bad_recipient', message: 'Faltan datos de la cuenta ACH (banco, tipo, número y documento).' })
    }

    // 1) Comisión que SE COBRA AL CLIENTE
    //    BREB → FIJA Lincoin ($1.200 por envío, BREB_FEE_COP). El costo
    //           real de Mouv lo absorbe Lincoin; el 0,10% ya se cobró al
    //           recibir el cargue Bre-B.
    //    ACH  → precio fijo por transferencia Finity (ACH_FEE_COP).
    let feeCop = 0
    let feeDetail: Record<string, unknown> = {}
    if (rail === 'BREB') {
      feeCop = BREB_FEE_COP
      feeDetail = { feeCop, feeFixedCop: BREB_FEE_COP, feeVariableCop: 0, feeIvaCop: 0, feeProvider: 'lincoin' }
    } else {
      feeCop = ACH_FEE_COP
      feeDetail = { feeCop, feeProvider: 'finity' }
    }
    const totalDebit = Number((amount + feeCop).toFixed(2))

    // 2) Leer saldo interno del riel y validar monto + comisión
    const { data: u } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
    if (!u) return json(404, { error: 'user_not_found', message: 'Usuario no encontrado.' })
    const bals: Record<string, number> = (u.balances as any) ?? {}
    const current = Number(bals[railCol] ?? 0)
    if (current < totalDebit) return json(400, { error: 'insufficient_funds', message: `Saldo ${rail} insuficiente para monto + comisión (${totalDebit.toLocaleString('es-CO')} COP). Disponible: ${current.toLocaleString('es-CO')} COP.` })

    // 3) Debitar monto + comisión (read-check-write)
    const afterDebit = Number((current - totalDebit).toFixed(2))
    const { error: debErr } = await db.from('users').update({ balances: { ...bals, [railCol]: afterDebit } }).eq('id', userId)
    if (debErr) return json(500, { error: 'debit_failed', message: 'No se pudo reservar el saldo. Intenta de nuevo.' })

    // 3) Registrar la transacción (type 'dispersion' — NO colisiona con la
    //    cola de retiros del admin, que es type 'send' + 'Pendiente').
    //    Los campos amigables (title/beneficiary/bank/account) son los que
    //    lee el comprobante del cliente — sin ellos salía "dispersion" crudo
    //    y sin beneficiario.
    const railLabel = rail === 'BREB' ? 'Bre-B' : 'ACH'
    const keyTypeLabel = ({ celular: 'Celular', cedula: 'Cédula', correo: 'Correo', alfanumerico: 'Llave' } as Record<string, string>)[String(recipient.keyType ?? '')] ?? 'Llave'
    const prettyBase = {
      source: 'mouv_payout', rail,
      title: `Dispersión ${railLabel}`,
      beneficiary: recipient.holderName ?? null,
      bank: rail === 'BREB' ? `Bre-B · ${keyTypeLabel}` : (recipient.bankCode ?? 'ACH'),
      account: rail === 'BREB' ? (recipient.key ?? null) : (recipient.accountNumber ?? null),
      ...(recipient.documentNumber ? { documentNumber: recipient.documentNumber } : {}),
      ...(recipient.documentType ? { documentType: recipient.documentType } : {}),
      ...(recipient.reference ? { reason: recipient.reference } : {}),
      recipient,
    }
    const { data: txIns } = await db.from('transactions').insert({
      user_id: userId, type: 'dispersion', amount, currency: railCol, status: 'Procesando',
      raw_data: { ...prettyBase, ...feeDetail, requestedAt: new Date().toISOString() },
    }).select('id').maybeSingle()
    const txId = (txIns as any)?.id ?? null

    // 4) Llamar al PROVEEDOR del riel: BREB → Mouv · ACH → Finity
    if (rail === 'BREB') {
      const pay = await mouvPayout(rail, recipient, amount)
      if (pay.ok) {
        if (txId) await db.from('transactions').update({
          status: 'Completado',
          raw_data: {
            ...prettyBase, ...feeDetail,
            ...(pay.targetName ? { beneficiary: pay.targetName } : {}),
            ...(pay.targetDocument ? { documentNumber: pay.targetDocument } : {}),
            providerRef: pay.providerRef ?? null,
            settledAt: new Date().toISOString(),
          },
        }).eq('id', txId)
        await logAudit(userId, `mouv.${action}.ok`, { amount, feeCop, rail, providerRef: pay.providerRef ?? null })
        return json(200, { ok: true, providerRef: pay.providerRef ?? null, feeCop, newBalance: afterDebit })
      }
      // Falló → REINTEGRAR monto + comisión
      const { data: u2 } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
      const bals2: Record<string, number> = (u2?.balances as any) ?? {}
      const restored = Number((Number(bals2[railCol] ?? 0) + totalDebit).toFixed(2))
      await db.from('users').update({ balances: { ...bals2, [railCol]: restored } }).eq('id', userId)
      if (txId) await db.from('transactions').update({
        status: 'Fallido',
        raw_data: { ...prettyBase, ...feeDetail, error: pay.data ?? 'payout_failed', httpStatus: pay.status, refunded: true, failedAt: new Date().toISOString() },
      }).eq('id', txId)
      await logAudit(userId, `mouv.${action}.fail`, { amount, rail, status: pay.status, data: pay.data ?? null })
      const mouvDetail = (() => {
        try {
          const s = typeof pay.data === 'string' ? pay.data : JSON.stringify(pay.data ?? null)
          return s && s !== 'null' && s !== '{}' ? ` Detalle técnico: ${s.slice(0, 350)}` : ''
        } catch { return '' }
      })()
      return json(200, { error: 'payout_failed', refunded: true, newBalance: restored, status: pay.status, data: pay.data,
        message: `Mouv rechazó la dispersión (HTTP ${pay.status}).${mouvDetail} Tu saldo fue devuelto.` })
    }

    // ── ACH vía FINITY ──
    const fin = await finityPayoutAch(userId, recipient, amount)
    if (fin.ok) {
      // El precio por transferencia (ACH_FEE_COP) ya se debitó junto al monto.
      const newBalance = afterDebit
      // Guardar el finityId en el contacto del usuario (reuso en próximos envíos)
      if (fin.destinationId) {
        try {
          const { data: u4 } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
          const raw4 = (u4?.raw_data ?? {}) as Record<string, any>
          const list = Array.isArray(raw4.mouvContacts) ? raw4.mouvContacts : []
          const next = list.map((c: any) => String(c?.accountNumber ?? '') === String(recipient.accountNumber ?? '') ? { ...c, finityId: fin.destinationId } : c)
          if (JSON.stringify(next) !== JSON.stringify(list)) await db.from('users').update({ raw_data: { ...raw4, mouvContacts: next } }).eq('id', userId)
        } catch { /* best-effort */ }
      }
      if (txId) await db.from('transactions').update({
        // Finity CONFIRMED = orden aceptada (aún no pagada) → Procesando.
        status: 'Procesando',
        raw_data: {
          ...prettyBase, feeProvider: 'finity', feeCop: fin.feeCop, costs: fin.costs ?? null,
          providerRef: fin.providerRef ?? null, state: fin.state ?? null,
          ...(fin.amountMismatch ? { amountMismatch: fin.amountMismatch, needsReview: true } : {}),
          acceptedAt: new Date().toISOString(),
        },
      }).eq('id', txId)
      await logAudit(userId, `finity.${action}.ok`, { amount, feeCop: fin.feeCop, providerRef: fin.providerRef ?? null })
      return json(200, { ok: true, provider: 'finity', providerRef: fin.providerRef ?? null, feeCop: fin.feeCop, newBalance })
    }
    // Finity falló → REINTEGRAR monto + comisión (todo lo debitado)
    const { data: u5 } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
    const bals5: Record<string, number> = (u5?.balances as any) ?? {}
    const restored5 = Number((Number(bals5[railCol] ?? 0) + totalDebit).toFixed(2))
    await db.from('users').update({ balances: { ...bals5, [railCol]: restored5 } }).eq('id', userId)
    if (txId) await db.from('transactions').update({
      status: 'Fallido',
      raw_data: { ...prettyBase, feeProvider: 'finity', error: fin.error ?? 'finity_failed', refunded: true, failedAt: new Date().toISOString() },
    }).eq('id', txId)
    await logAudit(userId, `finity.${action}.fail`, { amount, error: JSON.stringify(fin.error ?? {}).slice(0, 200) })
    // Incluir el DETALLE crudo del proveedor: sin él es imposible saber si
    // rechazó por saldo, unidades, cuenta destino o validación.
    const detail = (() => { try { return JSON.stringify(fin.error ?? fin).slice(0, 350) } catch { return String(fin.error ?? 'sin detalle') } })()
    return json(200, { error: 'payout_failed', provider: 'finity', refunded: true, newBalance: restored5, data: fin.error,
      message: `El riel rechazó la transferencia ACH y tu saldo fue devuelto. Detalle técnico: ${detail}` })
  }

  return json(200, { error: 'unknown_action', message: `Acción no soportada: ${action}` })
})
