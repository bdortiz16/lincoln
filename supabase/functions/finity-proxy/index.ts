// ════════════════════════════════════════════════════════
// finity-proxy — Puente Lincoin ⇄ Finity (riel bancario para PAGAR y
// DISPERSAR a cuentas bancarias colombianas desde Lincoin Empresas).
//
// Finity es una API machine-to-machine con OAuth2 client_credentials:
//   POST {BASE}/v0/oauth/token
//   body JSON: { grant_type: "client_credentials", client_id, client_secret }
//   → { access_token, expires_in, ... }
// (Confirmado en api-finity-docs.readme.io/reference/getaccesstoken)
//
// El navegador NUNCA ve las credenciales: viven como secrets acá y el
// frontend llama esta función con el JWT de Supabase del usuario.
//
// Secrets necesarios (Edge Functions → Manage secrets):
//   FINITY_CLIENT_ID      m2m-client-...
//   FINITY_CLIENT_SECRET  (el secret del portal — NUNCA en el código)
//   FINITY_BASE_URL       opcional y casi nunca necesario: el servidor es
//                         https://api.finity.com.co (el único dominio activo
//                         desde el 23 nov). Solo se respeta un sandbox puesto
//                         a propósito; cualquier otro valor se ignora.
//
// Acciones (POST { action, ...params }):
//   ping                 → valida credenciales: obtiene token y responde ok
//   balance              → saldo de la cuenta Finity
//   movements            → movimientos
//   external_accounts    → listar cuentas bancarias destino registradas
//   create_external_account → registrar cuenta destino { ...datos }
//   create_withdrawal    → crear orden de retiro/dispersión { ...datos }
//   withdrawal_status    → estado de una orden { id }
//
// ⚠️ PATHS: los de abajo son la MEJOR SUPOSICIÓN según el índice de la
// doc (External Accounts / Withdrawal Orders / Account Balance /
// Movements). CONFIRMAR contra las páginas reales (botón "Copy Page")
// y ajustar FINITY_PATHS antes de usar en serio. La acción `ping` no
// depende de ningún path más que el de token — esa sí es definitiva.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cabecerasInternas } from '../_shared/webhook-auth.ts'
import { equipoPermite } from '../_shared/equipo.ts'
import { requireMfaSession } from '../_shared/admin-auth.ts'
import { mergeRaw } from '../_shared/raw-data.ts'
import { cuerpoCuentaFinity, esCuentaAchFinity, BANK_CODES_CO } from '../_shared/cuenta-finity.ts'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Comparación de secretos en tiempo constante: con === el tiempo de respuesta
// delataba cuántos caracteres del inicio coincidían.
function igualSeguro(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''))
  let d = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return d === 0
}
// trim(): al pegar credenciales desde WhatsApp/correo se cuelan espacios
// o saltos de línea — y Finity rechaza el valor con basura invisible.
const FINITY_ID      = (Deno.env.get('FINITY_CLIENT_ID') ?? '').trim()
const FINITY_SECRET  = (Deno.env.get('FINITY_CLIENT_SECRET') ?? '').trim()
// Servidor REAL (el de la doc). Un sandbox devuelve datos de EJEMPLO (id
// placeholder, tasa inventada): solo con FINITY_BASE_URL puesto a propósito.
// (trim + sin barras finales: "https://.../" producía //v0/... → 404)
const PROD_BASE      = 'https://api.finity.com.co'
// 23 nov: Finity avisó que el ÚNICO dominio de su API que queda activo es
// https://api.finity.com.co, y las inscripciones de cuentas dejaron de
// llegarle. Dos caminos podían mandarlas a otro lado sin que nadie lo viera:
//   1. El secret FINITY_BASE_URL, si quedó con un dominio viejo, reemplazaba
//      al de producción para TODO (token, inscripciones, envíos).
//   2. El modo AUTO: si producción no daba el token en 6 s (un momento lento),
//      se pedía al sandbox, y con ese token toda la instancia hablaba con el
//      servidor de PRUEBAS mientras durara: la cuenta "se inscribía" (con un
//      id del sandbox) y al Finity real no llegaba nada.
// Ahora: producción siempre. FINITY_BASE_URL solo cuenta si es el mismo
// dominio de producción o un sandbox puesto A PROPÓSITO (contiene
// "sandbox"); cualquier otro valor se ignora y el diagnóstico lo dice.
const FINITY_BASE_RAW = (Deno.env.get('FINITY_BASE_URL') ?? '').trim().replace(/\/+$/, '')
const baseValida = (u: string): boolean => {
  try {
    const h = new URL(u).hostname.toLowerCase()
    return h === 'api.finity.com.co' || h.includes('sandbox')
  } catch { return false }
}
const FINITY_BASE_ENV = FINITY_BASE_RAW && baseValida(FINITY_BASE_RAW) ? FINITY_BASE_RAW : ''
// Lo que se ignoró, para decirlo en el diagnóstico del panel.
const FINITY_BASE_IGNORADA = FINITY_BASE_RAW && !FINITY_BASE_ENV ? FINITY_BASE_RAW : null
if (FINITY_BASE_IGNORADA) console.warn(`[finity] FINITY_BASE_URL=${FINITY_BASE_IGNORADA} no es el dominio activo de Finity: se usa ${PROD_BASE}`)
// Servidor activo: producción, salvo un sandbox explícito.
let FINITY_BASE = FINITY_BASE_ENV || PROD_BASE

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Crédito/reintegro ATÓMICO (bloqueo de fila vía adjust_balances) — evita la
// carrera de duplicación en reconcile (pentest #3). El respaldo manual (leer y
// escribir) es SOLO para una base sin la RPC: ante cualquier otro error la
// respuesta pudo haberse perdido con el ajuste ya hecho, y repetirlo a mano
// acreditaría dos veces (o, si la lectura falla, pisaría todos los saldos).
async function creditBalanceAtomic(userId: string, col: string, delta: number): Promise<void> {
  const { data: adj, error } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [col]: delta } })
  if (!error && !(adj as any)?.error) return
  if (!error) throw new Error(`Ajuste de saldo rechazado: ${(adj as any)?.error}`)
  if (!/42883|PGRST202|could not find the function|function .* does not exist/i.test(`${error?.code ?? ''} ${error?.message ?? ''}`)) {
    throw new Error(`Ajuste de saldo incierto: ${error?.message ?? 'sin detalle'}`)
  }
  const { data: u, error: leerErr } = await db.from('users').select('balances').eq('id', userId).single()
  if (leerErr || !u || typeof (u as any).balances !== 'object' || (u as any).balances === null) throw new Error('No se pudo leer el saldo')
  const bals: Record<string, number> = (u?.balances as any) ?? {}
  const nb = parseFloat((Number(bals[col] ?? 0) + delta).toFixed(2))
  await db.from('users').update({ balances: { ...bals, [col]: nb } }).eq('id', userId)
}

// Paths de la API (v0). Solo el token está confirmado; para el resto se
// prueban VARIOS candidatos y se cachea el que responda (≠404/405).
// La acción `discover` sondea todo y reporta qué existe — así la ruta
// real se descubre sola contra el sandbox sin depender de la doc.
const FINITY_TOKEN_PATH = '/v0/oauth/token' // ✅ confirmado en la doc

const CANDIDATES: Record<string, string[]> = {
  balance: [
    '/v0/account-balance', '/v0/account/balance', '/v0/balances',
    '/v0/balance', '/v0/accounts/balance',
  ],
  movements: [
    '/v0/movements', '/v0/movement', '/v0/transactions',
  ],
  externalAccounts: [
    '/v0/external-accounts', '/v0/external_accounts', '/v0/externalaccounts',
  ],
  withdrawalOrders: [
    '/v0/withdrawal-orders', '/v0/withdrawal_orders', '/v0/withdrawals',
    '/v0/withdrawal-order', '/v0/payouts', '/v0/transfers',
    '/v0/disbursements', '/v0/payments', '/v0/orders',
  ],
  rates: [
    '/v0/rates', '/v0/exchange-rates', '/v0/exchange_rates',
    '/v0/exchange-rate', '/v0/fx/rates',
  ],
  // ✅ CONFIRMADO en la doc (Currency Conversion, proceso de 2 pasos):
  //   Paso 1: POST /v0/convert/internal
  //           { fromAsset:'USD', toAsset:'COP', amount, exchange_rate_id, expires_at }
  //           (exchange_rate_id = el id que devuelve /v0/rates; expira en ~30 s)
  //           → crea la conversión en estado UNCONFIRMED
  //   Paso 2: POST de confirmación (página "Confirm internal conversion").
  convert: [
    '/v0/convert/internal',
  ],
}

// Ruta que ya respondió por recurso (cache en memoria del worker)
const WORKING: Record<string, string> = {}

// Prueba candidatos en orden (el cacheado primero) y devuelve la primera
// respuesta utilizable. 404/405 = ruta inexistente → sigue probando.
async function finityTry(resource: string, init: RequestInit = {}, qs = ''): Promise<{ res: Response; path: string }> {
  const list = [
    ...(WORKING[resource] ? [WORKING[resource]] : []),
    ...(CANDIDATES[resource] ?? []).filter(p => p !== WORKING[resource]),
  ]
  let last: { res: Response; path: string } | null = null
  // Se recuerda una ruta SOLO si respondió bien (2xx). Antes se recordaba la
  // primera que no fuera 404/405: si la buena fallaba un momento, la
  // siguiente candidata (que no existe y contesta 403 Forbidden) quedaba
  // fijada y las llamadas siguientes de esa instancia iban a una ruta que
  // no existe.
  // Cualquier otra respuesta (400/403/409/5xx) es la respuesta real de esa
  // ruta y se devuelve tal cual, sin probar más rutas.
  for (const path of list) {
    const res = await finityFetch(`${path}${qs}`, init)
    last = { res, path }
    if (res.ok) {
      WORKING[resource] = path
      return last
    }
    if (res.status === 404 || res.status === 405) continue
    return last
  }
  return last!
}

// ─── Token OAuth con caché en memoria (se renueva solo) ───
let tokenCache: { token: string; exp: number; base: string } | null = null

// El último rechazo del token, para el diagnóstico (sin credenciales).
let ultimoRechazoToken: { base: string; status: number; cuerpo: string; at: string } | null = null

// Pide token a UN servidor. Devuelve null si ese servidor rechaza.
async function tokenFrom(base: string): Promise<{ token: string; ttl: number } | null> {
  const res = await fetch(`${base}${FINITY_TOKEN_PATH}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: FINITY_ID,
      client_secret: FINITY_SECRET,
    }),
    // Un servidor que no responde no puede colgar el proxy entero. Ya no hay
    // segundo servidor al que caer (ver PROD_BASE): 10 s para el único.
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    ultimoRechazoToken = { base, status: 0, cuerpo: `sin respuesta: ${String((e as Error)?.message ?? e).slice(0, 120)}`, at: new Date().toISOString() }
    return null
  })
  if (!res) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    console.warn(`[finity] token rechazado por ${base}:`, res.status, JSON.stringify(body).slice(0, 200))
    ultimoRechazoToken = { base, status: res.status, cuerpo: JSON.stringify(body).slice(0, 200), at: new Date().toISOString() }
    return null
  }
  return { token: body.access_token, ttl: (Number(body.expires_in) || 300) * 1000 }
}

async function getFinityToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 30_000) {
    FINITY_BASE = tokenCache.base
    return tokenCache.token
  }
  // Un solo servidor: producción, o el sandbox puesto a propósito. Sin
  // respaldo al sandbox: ver el comentario de PROD_BASE.
  const candidates = [FINITY_BASE_ENV || PROD_BASE]
  for (const base of candidates) {
    const t = await tokenFrom(base)
    if (t) {
      FINITY_BASE = base
      tokenCache = { token: t.token, exp: Date.now() + t.ttl, base }
      if (base === PROD_BASE) console.log('[finity] ✅ conectado a PRODUCCIÓN')
      return t.token
    }
  }
  throw new Error(`finity_auth_failed:401:{"message":"Ningún servidor aceptó las credenciales (${candidates.join(', ')})"}`)
}

// El MOTIVO humano de un rechazo, tal como lo escribe Finity ("CUENTA Y NIT
// NO CORRESPONDEN"). Se busca en todo el cuerpo: primero las claves que solo
// significan motivo; si no, las genéricas. Nunca devuelve JSON ni códigos.
const CLAVES_MOTIVO = ['rejectionreason', 'rejection_reason', 'rejectreason', 'reject_reason', 'rejectedreason', 'rejected_reason', 'failurereason', 'failure_reason', 'failedreason', 'failed_reason', 'statusreason', 'status_reason', 'statusdetail', 'status_detail', 'statusdescription', 'status_description', 'errormessage', 'error_message', 'errordescription', 'error_description', 'declinereason', 'decline_reason', 'motivo', 'motivo_rechazo', 'motivorechazo', 'motivo_de_rechazo', 'observation', 'observations', 'observacion', 'observaciones', 'cause', 'causa', 'detail', 'details']
const CLAVES_MOTIVO_DEBIL = ['reason', 'description', 'message', 'mensaje', 'note', 'notes']
function digMotivoRechazo(o: any): string | null {
  const limpio = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (s.length < 3 || s.length > 300) return null
    if (/[{}\[\]]|http\s*\d|status\s*code|\bnull\b|undefined/i.test(s)) return null
    return s
  }
  let debil: string | null = null
  const seen = new Set<any>(); const stack = [o]
  while (stack.length) {
    const c = stack.pop()
    if (!c || typeof c !== 'object' || seen.has(c)) continue
    seen.add(c)
    for (const [k, v] of Object.entries(c)) {
      const key = k.toLowerCase()
      if (CLAVES_MOTIVO.includes(key)) { const s = limpio(v); if (s) return s }
      if (!debil && CLAVES_MOTIVO_DEBIL.includes(key)) debil = limpio(v)
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return debil
}

async function finityFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return finityFetchAbs(`${FINITY_BASE}${path}`, init)
}

// Igual que finityFetch pero contra una URL absoluta (para sondear el
// backend del portal prod.finity.com.co:444, que expone rutas que la API
// de socios api.finity.com.co no tiene).
async function finityFetchAbs(url: string, init: RequestInit = {}): Promise<Response> {
  const pedir = async () => fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${await getFinityToken()}`,
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(15000),
  })
  const res = await pedir()
  // Token rechazado ("Invalid or expired token"): el token vive en la memoria
  // de ESTA instancia y no se renovaba hasta vencer. Si Finity deja un solo
  // token activo por credencial, otra instancia que pide uno nuevo deja el
  // nuestro inválido (visto el 2026-10-30: 401 en dos envíos Bre-B · Cuenta 2
  // seguidos). Un 401 no procesó nada, así que se pide otro y se reintenta
  // UNA vez. Con un cuerpo de un solo uso (stream) no se puede repetir.
  if (res.status === 401 && (init.body == null || typeof init.body === 'string')) {
    console.warn('[finity] 401: se renueva el token y se reintenta una vez')
    tokenCache = null
    return pedir()
  }
  return res
}

// ─── Login del PORTAL de Finity (prod.finity.com.co:444) ───
// El saldo de la plataforma NO existe en la API de socios; solo el backend
// del portal lo expone (GET /convert/copBalance, /status…), y exige el JWT
// que devuelve su propio login (data.signed). Se inicia sesión con las
// credenciales del portal guardadas como secrets y se cachea el token.
// 22 nov: Finity avisó que el ÚNICO dominio que queda activo es
// https://api.finity.com.co. El backend del portal estaba en
// prod.finity.com.co:444 y dejó de responder (el login se quedaba sin
// respuesta y la bolsa no mostraba saldo). Si alguna ruta cambió, se ajusta
// con la variable FINITY_PORTAL_BASE en Supabase (no es secreta) sin tocar
// código; a dónde va hoy el login se ve en portal.finity.com.co → DevTools →
// Red → login.
const PORTAL_BASE = ((Deno.env.get('FINITY_PORTAL_BASE') ?? '').trim().replace(/\/+$/, '')) || 'https://api.finity.com.co'
// Los secrets del portal se leen EN CADA LLAMADA (no al arrancar): así, apenas
// se agregan/cambian en Supabase, la función los toma sin necesidad de que la
// instancia se reinicie. `.trim()` en el email; en la contraseña solo se
// recorta el salto de línea final típico al pegar, no espacios internos.
function portalEmail(): string { return (Deno.env.get('FINITY_PORTAL_EMAIL') ?? '').trim() }
function portalPassword(): string { return (Deno.env.get('FINITY_PORTAL_PASSWORD') ?? '').replace(/[\r\n]+$/, '') }

// El portal autentica las rutas de saldo con una COOKIE (no con Bearer):
//   Cookie: plentiapp-prod-server-only=<JWT>   (== data.signed del login)
const PORTAL_COOKIE_NAME = 'plentiapp-prod-server-only'
// Se cachea la cookie completa ("nombre=valor") lista para reenviar.
let portalTokenCache: { cookie: string; exp: number } | null = null
// Detalle del último intento de login (para diagnosticar en el admin).
let lastPortalLogin: { status: number | string; snippet: string; frenadoHasta?: number } | null = null

// ── Freno de logins rechazados (22 nov) ────────────────────────────
// El panel relee las bolsas cada 30 s por pestaña abierta, y cada lectura
// sin sesión intentaba entrar al portal otra vez. Con la contraseña mala eso
// es un login fallido cada 30 s, y un portal puede bloquear la cuenta por
// intentos. Tras un rechazo se deja de intentar un rato (lo dice el panel);
// el botón de actualizar de la bolsa prueba ya (forzar). Va en private_config
// porque guarda lo que contestó el portal y system_config lo lee el navegador.
const FRENO_LOGIN_KEY = 'finity_portal_login_freno'
async function leerFrenoLogin(): Promise<{ hasta: number; status: number | string; snippet: string } | null> {
  try {
    const { data } = await db.from('private_config').select('value').eq('key', FRENO_LOGIN_KEY).maybeSingle()
    const v = data?.value ? JSON.parse(String(data.value)) : null
    return v && Number(v.hasta) > Date.now() ? { hasta: Number(v.hasta), status: v.status, snippet: String(v.snippet ?? '') } : null
  } catch { return null }
}
async function ponerFrenoLogin(status: number | string, snippet: string) {
  // Un rechazo de credenciales o un bloqueo (4xx): 15 min. Una falla de red o
  // del portal (5xx, sin respuesta): 2 min, es pasajera.
  const espera = typeof status === 'number' && status >= 400 && status < 500 ? 15 * 60_000 : 2 * 60_000
  try {
    await db.from('private_config').upsert({ key: FRENO_LOGIN_KEY, value: JSON.stringify({ hasta: Date.now() + espera, status, snippet: snippet.slice(0, 300), at: new Date().toISOString() }) }, { onConflict: 'key' })
  } catch { /* el freno es una protección; si falla, no tumba la lectura */ }
}
async function quitarFrenoLogin() {
  try { await db.from('private_config').delete().eq('key', FRENO_LOGIN_KEY) } catch { /* */ }
}

// Lo que contestó el portal, dicho para el panel.
function motivoLoginPortal(l: { status: number | string; snippet: string; frenadoHasta?: number } | null): string {
  if (!l) return 'El login del portal Finity fue rechazado.'
  const st = l.status
  const txt = String(l.snippet ?? '').replace(/\s+/g, ' ').trim()
  let motivo: string
  if (/authorization header/i.test(txt)) motivo = `En ${PORTAL_BASE.replace(/^https?:\/\//, '')} no está el ingreso del portal: ese servidor es la API de Finity y pide su autorización, no el correo y la contraseña del portal. No es la contraseña. Para la ruta nueva del login, mirá en portal.finity.com.co → DevTools → Red a qué dirección va el pedido "login" y ponela en FINITY_PORTAL_BASE.`
  else if (st === 'throw') motivo = `El servidor del portal de Finity (${PORTAL_BASE.replace(/^https?:\/\//, '')}) no respondió en 20 s: está caído, lo movieron o no acepta conexiones desde Supabase. Si portal.finity.com.co abre bien en el navegador, revisá en DevTools → Red a qué dirección va el login y, si cambió, poné esa dirección en la variable FINITY_PORTAL_BASE de Supabase. Los envíos no dependen de esto: usan la API de Finity.`
  else if (st === 429 || st === 423 || /bloque|blocked|locked|too many|demasiad/i.test(txt)) motivo = 'Finity bloqueó el ingreso por intentos: hay que desbloquear la cuenta en portal.finity.com.co.'
  else if (st === 400 || st === 401 || /contrase|password|credencial|credential|incorrect|inv[aá]lid/i.test(txt)) motivo = 'Finity rechazó el correo o la contraseña del portal. Si la contraseña se cambió o venció en portal.finity.com.co, hay que actualizar el secret FINITY_PORTAL_PASSWORD en Supabase.'
  else if (st === 403) motivo = 'El portal de Finity negó el ingreso (403): puede ser su protección de seguridad o la cuenta bloqueada.'
  else if (typeof st === 'number' && st >= 500) motivo = `El portal de Finity tiene una falla (${st}).`
  else motivo = 'El login del portal Finity fue rechazado.'
  const hora = l.frenadoHasta ? new Date(l.frenadoHasta).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' }) : null
  return `${motivo}${txt ? ` Respuesta del portal (${st}): ${txt.slice(0, 160)}` : ` (${st})`}${hora ? ` · Para no bloquear la cuenta no se reintenta hasta las ${hora}; el botón de actualizar prueba ya.` : ''}`
}

// Saldo por la API de socios, con su token OAuth (el mismo de los envíos).
// Primero la ruta oficial /v0/account/{COP|USD}; si falta alguna cifra, las
// otras rutas /v0 de saldo (solo una lista con la moneda de cada fila) y las
// del portal a través de la API. Se guarda 60 s si funcionó y 5 min si no:
// el panel relee cada 30 s por pestaña abierta (el botón ↻ fuerza).
let saldoApiCache: { hasta: number; r: { cop: number | null; usdt: number | null; intentos: Record<string, any> } } | null = null
async function saldoPorApi(amountOf: (d: any) => number | null, deepFind: (o: any, t: string[]) => number | null, forzar = false) {
  if (!forzar && saldoApiCache && Date.now() < saldoApiCache.hasta) return saldoApiCache.r
  const intentos: Record<string, any> = {}
  let cop: number | null = null, usdt: number | null = null
  // La ruta OFICIAL (doc de Finity, "Get account balance by asset"):
  // GET /v0/account/{asset} con asset COP o USD, con el token de la API.
  for (const [asset, campo] of [['COP', 'cop'], ['USD', 'usdt']] as const) {
    try {
      const r = await finityFetch(`/v0/account/${asset}`, { signal: AbortSignal.timeout(10000) })
      const raw = await r.json().catch(() => null)
      intentos[`account_${asset}`] = { status: r.status, raw }
      if (!r.ok) continue
      const n = amountOf(raw) ?? deepFind(raw, ['available', 'balance', 'amount'])
      if (n == null) continue
      if (campo === 'cop') cop = n; else usdt = n
    } catch (e) { intentos[`account_${asset}`] = { status: 'throw', err: String(e).slice(0, 120) } }
  }
  if (cop != null && usdt != null) {
    const r = { cop, usdt, intentos }
    saldoApiCache = { hasta: Date.now() + 60_000, r }
    return r
  }
  try {
    const { res, path } = await finityTry('balance')
    const raw = await res.json().catch(() => null)
    intentos.v0 = { path, status: res.status, raw }
    const filas = !res.ok ? null : Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.balances) ? raw.balances : null
    for (const f of filas ?? []) {
      const moneda = String(f?.asset ?? f?.currency ?? f?.coin ?? f?.symbol ?? '').toUpperCase()
      const n = amountOf(f)
      if (n == null) continue
      if (moneda.startsWith('COP')) cop = cop ?? n
      else if (moneda.startsWith('USD')) usdt = usdt ?? n
    }
  } catch (e) { intentos.v0 = { status: 'throw', err: String(e).slice(0, 120) } }
  for (const [k, path] of [['copBalance', '/convert/copBalance'], ['action', '/homeFinity/action']] as const) {
    if ((k === 'copBalance' && cop != null) || (k === 'action' && usdt != null)) continue
    try {
      const r = await finityFetch(path, { signal: AbortSignal.timeout(10000) })
      const raw = await r.json().catch(() => null)
      intentos[k] = { status: r.status, raw }
      if (!r.ok) continue
      if (k === 'copBalance') cop = amountOf(raw) ?? deepFind(raw, ['cop', 'balance'])
      else {
        const fb = raw?.data?.userFreeBalance ?? raw?.userFreeBalance
        const n = Number(typeof fb === 'string' ? fb.replace(/,/g, '') : fb)
        usdt = fb != null && Number.isFinite(n) ? n : deepFind(raw, ['userfreebalance', 'freebalance'])
      }
    } catch (e) { intentos[k] = { status: 'throw', err: String(e).slice(0, 120) } }
  }
  const r = { cop, usdt, intentos }
  saldoApiCache = { hasta: Date.now() + (cop != null || usdt != null ? 60_000 : 5 * 60_000), r }
  return r
}

async function getPortalToken(opts: { forzar?: boolean } = {}): Promise<string | null> {
  if (portalTokenCache && Date.now() < portalTokenCache.exp - 30_000) return portalTokenCache.cookie
  const PORTAL_EMAIL = portalEmail(), PORTAL_PASSWORD = portalPassword()
  if (!PORTAL_EMAIL || !PORTAL_PASSWORD) return null
  if (!opts.forzar) {
    const freno = await leerFrenoLogin()
    if (freno) { lastPortalLogin = { status: freno.status, snippet: freno.snippet, frenadoHasta: freno.hasta }; return null }
  }
  const res = await fetch(`${PORTAL_BASE}/auth/login`, {
    method: 'POST',
    // Se replican EXACTAMENTE los headers de navegador del portal — su
    // gateway rechaza (403 INVALID_DATA) requests que no los traigan.
    headers: {
      'accept': '*/*',
      'accept-language': 'es-US,es;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': 'application/json',
      'origin': 'https://portal.finity.com.co',
      'priority': 'u=1, i',
      'referer': 'https://portal.finity.com.co/',
      'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ email: PORTAL_EMAIL, password: PORTAL_PASSWORD, remember_me: false }),
    signal: AbortSignal.timeout(20000),
  }).catch((e) => { lastPortalLogin = { status: 'throw', snippet: String(e).slice(0, 200) }; return null })
  if (!res) { await ponerFrenoLogin('throw', lastPortalLogin?.snippet ?? ''); return null }
  const text = await res.text().catch(() => '')
  let body: any = {}
  try { body = JSON.parse(text) } catch { /* respuesta no-JSON */ }
  lastPortalLogin = { status: res.status, snippet: text.slice(0, 300) }
  const token = body?.data?.signed ?? body?.signed ?? body?.data?.token ?? body?.data?.access_token ?? body?.access_token ?? body?.token
  if (!res.ok || !token) {
    console.warn('[finity-portal] login rechazado:', res.status, text.slice(0, 200))
    await ponerFrenoLogin(res.status, text)
    return null
  }
  await quitarFrenoLogin()
  // La cookie de auth: se prefiere la que el login setee vía Set-Cookie; si
  // no la expone, se arma con el token del body (data.signed).
  let cookieVal = token
  const setCookie = res.headers.get('set-cookie') ?? ''
  const m = setCookie.match(new RegExp(`${PORTAL_COOKIE_NAME}=([^;]+)`))
  if (m) cookieVal = m[1]
  const cookie = `${PORTAL_COOKIE_NAME}=${cookieVal}`
  // TTL: si el JWT trae exp lo respetamos; si no, 30 min.
  let ttl = 30 * 60 * 1000
  try {
    const seg = token.split('.')[1]
    const payload = JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload?.exp) ttl = payload.exp * 1000 - Date.now()
  } catch { /* token opaco → TTL por defecto */ }
  portalTokenCache = { cookie, exp: Date.now() + Math.max(60_000, ttl) }
  return cookie
}

// GET/POST contra el portal con el JWT del login (Bearer) + headers de
// navegador (el gateway también los exige en las rutas de saldo).
async function portalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookie = await getPortalToken() // devuelve "plentiapp-prod-server-only=<jwt>"
  return fetch(`${PORTAL_BASE}${path}`, {
    ...init,
    headers: {
      'accept': '*/*',
      'accept-language': 'es-US,es;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'content-type': 'application/json',
      'cookie': cookie ?? '',
      'origin': 'https://portal.finity.com.co',
      'referer': 'https://portal.finity.com.co/',
      'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(12000),
  })
}

// ─── Validación del caller ───
// Dos modos (mismo patrón que tatum-wallet en la app Empresas):
//  a) JWT de usuario de Supabase válido (panel admin) → userId del token.
//  b) anon key + payload.user_id de un usuario EXISTENTE en public.users
//     (la app Empresas usa auth propia y llama con la anon key).
// ⚠️ Antes de pasar a credenciales de PRODUCCIÓN de Finity, endurecer el
// modo (b): exigir un flag users.finity_enabled y/o verificación por PIN.
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const PROJECT_REF = (() => { try { return new URL(SUPABASE_URL).hostname.split('.')[0] } catch { return '' } })()

// ¿El bearer es la anon key de ESTE proyecto? Comparación directa contra el
// env y, de respaldo, decodificando el JWT (role=anon + ref del proyecto).
// La comparación exacta resultó frágil (keys rotadas / publishable) y
// devolvía 401 aunque la app fuera legítima.
function isProjectAnonKey(jwt: string): boolean {
  if (ANON_KEY && jwt === ANON_KEY) return true
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const p = JSON.parse(atob(b64))
    const ref = String(p.ref ?? '') || String(p.iss ?? '')
    return p.role === 'anon' && (!PROJECT_REF || ref.includes(PROJECT_REF))
  } catch {
    return false
  }
}

// ── FIRMA DEL SERVIDOR EN LOS COBROS POR LINK ──────────────────────
// Un cliente puede insertar filas en `transactions` con su sesión. Un "cobro
// por link" inventado (source finity_payment_link, la referencia y el monto que
// quisiera) se acreditaba en la conciliación si su referencia aparecía como
// texto dentro de cualquier movimiento del proveedor. Los cobros que crea ESTE
// servidor llevan una firma (HMAC con la llave de servicio).
async function firmaCobro(userId: string, amount: number, currency: string, reference: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`cobro|${userId}|${Number(amount)}|${currency}|${reference}`)))
  return Array.from(sig.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ¿Ese id de cobro o de retiro es de QUIEN pregunta? Tener sesión válida no
// alcanza: sin esto, un cliente cualquiera podía consultar los montos y
// destinos de los cobros y retiros de otro con solo cambiar el id.
// Los llamantes internos (mouv-proxy conciliando) pasan sin restricción.
async function esMiReferencia(caller: { userId?: string; internal?: boolean }, id: string): Promise<boolean> {
  if (caller.internal) return true
  const uid = String(caller.userId ?? '')
  if (!uid || !id) return false
  // El id va dentro de un filtro .or(): con comas o puntos se le podían
  // agregar condiciones y la pregunta "¿es tuyo?" respondía que sí.
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(id)) return false
  try {
    const { data } = await db.from('transactions').select('id')
      .eq('user_id', uid)
      .or(`raw_data->>providerRef.eq.${id},raw_data->>reference.eq.${id}`)
      .limit(1)
    return !!(data && data.length)
  } catch { return false }   // ante la duda, no se muestra
}

// Qué permiso del equipo pide cada acción a un admin humano. Lo que no figura
// (convertir, crear retiros, sondear el proveedor) queda para el dueño y para
// las llamadas internas del servidor.
const PERMISO_FINITY: Record<string, string | string[]> = {
  // 'fn.*': las casillas del colaborador que leen la bolsa (_shared/equipo.ts).
  treasury_balances: ['plata.ver', 'tesoreria', 'fn.billetera', 'fn.tesoreria', 'fn.lincoin'],
  // Inscripciones a Finity (23 nov): ver por qué no llegan, reintentar las
  // pendientes y reanudar la pausa. Leen nombres y cuentas (enmascaradas) de
  // los beneficiarios de los clientes.
  inscripciones_diag: ['plata.ver', 'tesoreria', 'fn.billetera', 'fn.tesoreria', 'fn.fallos', 'fn.cumplimiento'],
  inscribir_pendientes: ['plata.mover', 'tesoreria', 'fn.billetera', 'fn.tesoreria', 'fn.fallos', 'fn.cumplimiento'],
  inscripciones_reanudar: ['plata.mover', 'tesoreria', 'fn.fallos'],
  // El botón de Cumplimiento (AdminReinscribirFinity): quien atiende fallos o cumplimiento.
  reinscribir_pendientes: ['plata.mover', 'tesoreria', 'fn.fallos', 'fn.cumplimiento'],
}

async function validCaller(req: Request, payload: Record<string, unknown>): Promise<{ ok: boolean; userId?: string; internal?: boolean; viaJwt?: boolean; servicio?: boolean }> {
  const auth = req.headers.get('authorization') ?? ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return { ok: false }

  // (0) Llamada INTERNA servidor-a-servidor (mouv-proxy dispersa ACH,
  // gasfree convierte en segundo plano): se identifican con el
  // service-role key, que nunca sale del backend. `internal:true` es lo
  // ÚNICO que autoriza crear retiros/cuentas externas — el cliente pasa
  // por mouv-proxy, que debita el saldo ANTES de llamar aquí.
  if (SERVICE_KEY && igualSeguro(jwt, SERVICE_KEY)) {
    const uid = String(payload.user_id ?? '')
    return { ok: true, userId: uid || undefined, internal: true, viaJwt: true, servicio: true }
  }
  // (El "AdminBypass <password>" se eliminó: era un secreto compartido que
  //  viajaba en el bundle del frontend. El admin real entra por JWT abajo.)

  // (a) JWT real de Supabase. Si el usuario es admin, se marca `internal`
  // (confianza plena) para que el panel de admin pueda dejar de usar la
  // anon-key y autenticar con su propia sesión. viaJwt = identidad PROBADA.
  const { data } = await db.auth.getUser(jwt)
  if (data?.user) {
    const { data: prof } = await db.from('users').select('role').eq('id', data.user.id).maybeSingle()
    const isAdmin = (prof as any)?.role === 'admin'
    return { ok: true, userId: data.user.id, internal: isAdmin, viaJwt: true }
  }

  // (b) anon key del proyecto + user_id existente (medio-auth): NO prueba
  // identidad (viaJwt:false) → no autoriza acciones sensibles.
  if (isProjectAnonKey(jwt)) {
    const uid = String(payload.user_id ?? '')
    if (!uid) return { ok: false }
    const { data: u } = await db.from('users').select('id').eq('id', uid).maybeSingle()
    if (u) return { ok: true, userId: uid, viaJwt: false }
  }
  return { ok: false }
}

// Extrae los saldos USDt y COP (Peso Finity) de la respuesta de balance de
// Finity, sin conocer el shape exacto (array de assets, objeto por moneda,
// o anidado). Para mostrarlos en el admin.
function extractBalances(d: any): { usdt: number | null; cop: number | null } {
  let usdt: number | null = null
  let cop: number | null = null
  const consider = (cur: unknown, val: unknown) => {
    const c = String(cur ?? '').toUpperCase()
    const n = Number(val)
    if (!Number.isFinite(n)) return
    if (usdt == null && /USDT|USDC|USD|DOLAR|DÓLAR|DIGITAL/.test(c)) usdt = n
    else if (cop == null && /COP|PESO|FINITY/.test(c)) cop = n
  }
  const scan = (obj: any, depth = 0) => {
    if (obj == null || depth > 4) return
    if (Array.isArray(obj)) {
      for (const it of obj) {
        if (it && typeof it === 'object') {
          const cur = it.currency ?? it.asset ?? it.symbol ?? it.code ?? it.name ?? it.ticker
          const val = it.balance ?? it.available ?? it.amount ?? it.total ?? it.value
          if (val != null) consider(cur, val)
        }
      }
      return
    }
    if (typeof obj === 'object') {
      if (Array.isArray(obj.balances)) return scan(obj.balances, depth + 1)
      if (Array.isArray(obj.data)) return scan(obj.data, depth + 1)
      if (Array.isArray(obj.accounts)) return scan(obj.accounts, depth + 1)
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number' || (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)))) consider(k, v)
        else if (v && typeof v === 'object') {
          const cur = (v as any).currency ?? (v as any).asset ?? k
          const val = (v as any).balance ?? (v as any).available ?? (v as any).amount ?? (v as any).total
          if (val != null) consider(cur, val)
          else scan(v, depth + 1)
        }
      }
    }
  }
  scan(d)
  return { usdt, cop }
}

// Extrae la tasa numérica de la respuesta de Finity (mismo criterio que el
// cliente). Para el snapshot programado de la gráfica.
// ── Ajuste de la tasa (los "puntos" que se le bajan) ──────────────────────
//
// La tasa del proveedor llega tal cual. Lo que Lincoin cobra por encima se
// expresa restándole PESOS a esa tasa: si Finity da 3.097,75 y el ajuste es 5,
// la tasa que se usa —y la que se muestra— es 3.092,75. Esos 5 pesos por dólar
// son el margen.
//
// Se aplica ACÁ, donde nace la tasa, y no en la pantalla: así el cliente nunca
// ve una tasa distinta de la que se le va a aplicar, y no hay dos números que
// puedan quedar desalineados. El cálculo real del abono hace lo mismo en
// gasfree, leyendo esta misma clave.
const AJUSTE_KEY = 'otc_rate_ajuste'

type AjusteTasa = { finityCop: number; mouvCop: number }

async function leerAjuste(db: any): Promise<AjusteTasa> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', AJUSTE_KEY).maybeSingle()
    const v = data?.value ? JSON.parse(data.value) : null
    const n = (x: any) => { const k = Number(x); return Number.isFinite(k) && k >= 0 ? k : 0 }
    return { finityCop: n(v?.finityCop), mouvCop: n(v?.mouvCop) }
  } catch { return { finityCop: 0, mouvCop: 0 } }
}

async function esAdmin(db: any, userId?: string): Promise<boolean> {
  if (!userId) return false
  try {
    const { data } = await db.from('users').select('role').eq('id', userId).maybeSingle()
    return String(data?.role ?? '') === 'admin'
  } catch { return false }
}

// Nunca deja la tasa en cero o negativa: un ajuste mal escrito (500 en vez de
// 5) no puede convertir una conversión en un regalo. Si el ajuste se comiera
// la tasa, no se aplica y se sigue con la del proveedor.
export function aplicarAjuste(rate: number, ajusteCop: number): number {
  if (!(rate > 0) || !(ajusteCop > 0)) return rate
  const r = rate - ajusteCop
  return r > 0 ? r : rate
}

function extractRate(d: any): number | null {
  if (d == null) return null
  const cand = d.rate ?? d.value ?? d.price ?? d.cop ?? d.exchange_rate ?? d.exchangeRate
    ?? d.data?.rate ?? d.data?.value ?? d.data?.price
    ?? (Array.isArray(d) ? (d[0]?.rate ?? d[0]?.value) : undefined)
    ?? (Array.isArray(d?.data) ? (d.data[0]?.rate ?? d.data[0]?.value) : undefined)
  const n = Number(cand)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ─── Inscribir una cuenta destino en Finity ───
// La usan la acción create_external_account (pantalla del cliente, panel,
// mouv-proxy al enviar) y el reintento del servidor (inscribir_pendientes).
// Devuelve lo mismo que la acción: { ok, status, path, data, id, … }.
async function inscribirCuentaFinity(userId: string, dataIn: any): Promise<Record<string, any>> {
  const cuenta = (dataIn as any)?.account ?? {}
  // Limpieza en el SERVIDOR, venga de donde venga (app vieja en caché,
  // panel admin): Finity exige solo dígitos, de 6 a 20. Guiones, puntos
  // y espacios se quitan aquí, y lo que no alcanza ni se envía.
  if ((dataIn as any)?.account) {
    cuenta.account_number = String(cuenta.account_number ?? '').replace(/\D/g, '')
    // Finity acepta CC | CE | NIT | PASSPORT | PPT (doc oficial, 23 nov).
    // Un "PAS"/"PASAPORTE" de una pantalla vieja se traduce aquí.
    if (['PAS', 'PASAPORTE'].includes(String(cuenta.account_holder_id_type ?? '').toUpperCase())) {
      cuenta.account_holder_id_type = 'PASSPORT'
    }
    if (['CC', 'NIT'].includes(String(cuenta.account_holder_id_type ?? '').toUpperCase())) {
      cuenta.account_holder_id_number = String(cuenta.account_holder_id_number ?? '').replace(/\D/g, '')
    }
    if (cuenta.account_number.length < 6 || cuenta.account_number.length > 20) {
      return { ok: false, status: 400, path: null, data: { message: `El número de cuenta debe tener entre 6 y 20 dígitos (tiene ${cuenta.account_number.length}). Revísalo con el banco.` } }
    }
  }
  const accDigits = String(cuenta.account_number ?? '').replace(/\D/g, '')

  // 1) FRENO GENERAL. Si Finity ya contestó 403/429 hace poco, no se le
  //    vuelve a pegar hasta que pase la espera: insistir es justo lo que
  //    hace que un proveedor bloquee (pasó el 6 y el 7 de octubre).
  const freno = await leerFrenoInscripciones()
  // Los mensajes de esta acción los ve el cliente (estado del contacto):
  // sin el nombre del aliado.
  if (freno) {
    return { ok: false, status: 429, frenado: true, path: null, data: { message: `Inscripciones en pausa hasta ${new Date(freno.hasta).toISOString()} (el banco respondió ${freno.http}). Se reintenta sola.` } }
  }

  // 2) ¿YA ESTÁ INSCRITA? Se busca en la lista (de caché) por número de
  //    cuenta y documento. Si está, se devuelve esa: ni se duplica ni se
  //    gasta una llamada de creación.
  if (accDigits) {
    // La lista puede ser grande y lenta. Si no contesta en 12 s se sigue
    // sin ella: antes su espera más la de la creación pasaban del límite
    // del navegador y la inscripción se perdía sin dejar rastro.
    const lista = await Promise.race([
      listaCuentasFinity().catch(() => null),
      new Promise<null>(r => setTimeout(() => r(null), 12_000)),
    ]) ?? { ok: false, status: 0, path: '', data: null, cache: false }
    const filas = filasDe(lista.data)
    const docDigits = String(cuenta.account_holder_id_number ?? '').replace(/\D/g, '')
    const ya = filas.find((x: any) => {
      const n = String(x?.account_number ?? x?.account?.account_number ?? '').replace(/\D/g, '')
      if (!n || n !== accDigits) return false
      const d = String(x?.account_holder_id_number ?? x?.account?.account_holder_id_number ?? '').replace(/\D/g, '')
      return !docDigits || !d || d === docDigits
    })
    if (ya) return { ok: true, status: 200, path: lista.path, data: ya, id: idDeCuenta(ya), reutilizada: true }
  }

  // 3) La MISMA cuenta rechazada hace menos de 10 min no se vuelve a
  //    mandar: la respuesta va a ser la misma.
  if (accDigits) {
    const { data: previo } = await db.from('admin_actions')
      .select('created_at, metadata')
      .eq('action', 'finity.external_account.create')
      .filter('metadata->enviado->account->>account_number', 'eq', String(cuenta.account_number ?? ''))
      .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const st = Number((previo as any)?.metadata?.status ?? 0)
    // Solo si se manda EXACTAMENTE lo mismo: si el cliente corrigió el
    // documento o el nombre, eso sí tiene que llegar a Finity.
    // jsonb reordena las claves: se compara con las claves ordenadas.
    const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v
    const igual = (a: any, b: any) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null))
    if (previo && st >= 400 && st !== 403 && st !== 429 && igual((previo as any).metadata?.enviado, dataIn)) {
      let dataPrev: any = null
      try { dataPrev = JSON.parse(String((previo as any).metadata?.respuesta ?? 'null')) } catch { /* */ }
      return { ok: false, status: st, repetida: true, path: (previo as any).metadata?.path ?? null, data: dataPrev ?? { message: 'Rechazada hace menos de 10 minutos; se reintenta más tarde.' } }
    }
  }

  // Una sola ruta y 40 s: Finity tarda ~9 s en crear y a veces mucho más
  // (valida con el banco). Con el corte de 15 s de antes, la creación se
  // abortaba a medias y no quedaba ni rastro en la auditoría.
  const path = WORKING['externalAccounts'] ?? '/v0/external-accounts'
  let res: Response
  try {
    res = await finityFetch(path, {
      method: 'POST',
      body: JSON.stringify(dataIn ?? {}),
      signal: AbortSignal.timeout(40_000),
    })
  } catch (e) {
    const err = String((e as Error)?.message ?? e)
    // Si lo que falló fue el TOKEN, a Finity no llegó nada: no hubo creación
    // posible. Antes se registraba igual que un "no respondió a tiempo" y la
    // causa (credenciales o dominio) quedaba escondida (23 nov).
    const sinToken = /finity_auth_failed/.test(err)
    // Sin respuesta: Finity PUDO haberla creado. Se invalida la lista para
    // que el próximo intento la encuentre ahí en vez de duplicarla.
    listaCache = null
    await logAudit(userId, 'finity.external_account.create', {
      status: 0, path, ok: false, enviado: dataIn, idCreado: null,
      error: err.slice(0, 200), ...(sinToken ? { sinToken: true, base: FINITY_BASE } : {}),
    })
    return sinToken
      ? { ok: false, status: 0, path, sinToken: true, data: { message: 'No se pudo conectar con el banco para inscribir la cuenta. Se reintenta solo en unos minutos.' } }
      : { ok: false, status: 0, path, sinRespuesta: true, data: { message: 'El banco no respondió a tiempo. Se reintenta solo en unos minutos.' } }
  }
  const data = await res.json().catch(() => null)
  if (res.status === 403 || res.status === 429) await ponerFrenoInscripciones(res.status)
  if (res.ok) listaCache = null
  // Se audita también LA RESPUESTA, no solo lo enviado. Sin esto, una
  // cuenta que se quedaba "en validación" no se podía diagnosticar: había
  // registro de lo que se mandó y ninguno de lo que contestó el banco.
  const idCreado = idDeCuenta(data)
  await logAudit(userId, 'finity.external_account.create', {
    status: res.status, path, ok: res.ok,
    enviado: dataIn,
    idCreado,
    respuesta: JSON.stringify(data ?? {}).slice(0, 600),
  })
  // El id va también arriba, ya resuelto: si Finity lo anida
  // ({ data: { id } }) y el navegador no lo encuentra, cree que la cuenta
  // sigue sin inscribir y la vuelve a crear — así quedaron cuentas
  // creadas 20 y 41 veces y Finity bloqueó la API.
  return { ok: res.ok, status: res.status, path, data, id: idCreado }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })

  try {
    if (!FINITY_ID || !FINITY_SECRET) {
      return json(200, { error: 'finity_not_configured', message: 'El servicio de cobros no está disponible en este momento. Escríbenos a soporte@lincoin.me.' })
    }

    const payload = await req.json().catch(() => ({}))
    const action = String(payload.action ?? '')

    // Acciones de SOLO LECTURA (tasa, ping, discover): SIN gate de auth.
    // Son datos no sensibles (una tasa pública, un sondeo de rutas) y
    // cualquier comparación de llaves resultó frágil (keys rotadas,
    // publishable vs legacy, admin seed sin fila en users). Todo lo que
    // MUEVE PLATA (withdrawal, convert, external accounts) sigue
    // exigiendo un usuario real.
    // external_accounts sale de las READ públicas: lista los datos bancarios
    // (nombre, documento, cuenta) de los destinos registrados — exige caller.
    // treasury_balances SALE de las READ públicas: expone los saldos de la
    // tesorería (USDt + COP de la empresa) → solo admin/interno.
    // 'discover' (sondea decenas de rutas del proveedor por llamada) y
    // 'snapshot_finity' (escribe en fx_rate_snapshots) ya no son públicas:
    // solo el equipo o el servidor. Las tasas programadas las guarda fx-snapshot.
    const READ_ACTIONS = new Set(['ping', 'rates'])

    const caller = await validCaller(req, payload)
    // Ser admin ya no alcanza: un miembro del equipo opera acá solo lo que su
    // rol permite (_shared/equipo.ts). Si no alcanza, pierde la confianza de
    // `internal` y queda como un usuario más. El ACH es Colombia: pide CO.
    if (caller.ok && caller.internal && !caller.servicio && caller.userId) {
      const g = await equipoPermite(db, caller.userId, PERMISO_FINITY[action], { pais: 'CO' })
      if (!g.ok) caller.internal = false
    }
    // Y la sesión del admin tiene que haber pasado el 2FA: `internal` abre
    // retiros y envíos Bre-B directo desde la bolsa de Finity, y con solo la
    // contraseña (sin el código) se podían ordenar.
    if (caller.ok && caller.internal && !caller.servicio && caller.userId) {
      if (await requireMfaSession(db, req, caller.userId)) caller.internal = false
    }
    if (!caller.ok && !READ_ACTIONS.has(action)) {
      // 'proxy v3' en el mensaje: si el panel muestra 'unauthorized' pelado,
      // la función desplegada es una versión vieja.
      return json(401, { error: 'unauthorized', message: 'unauthorized (proxy v5.2)' })
    }

    // ── Gates de seguridad (pentest H3) ──────────────────────────────────
    // INTERNO/ADMIN: leer movimientos/saldo de la empresa o convertir sobre la
    // tesorería compartida. Nunca un cliente (ni con anon-key + user_id).
    const INTERNAL_ONLY = new Set(['movements', 'convert', 'convert_confirm', 'balance', 'breb_crear', 'breb_confirmar', 'motivo_rechazo', 'discover', 'snapshot_finity'])
    if (INTERNAL_ONLY.has(action) && !caller.internal) {
      return json(403, { error: 'forbidden', message: 'Operación restringida.' })
    }
    // Las que SACAN plata de la bolsa de Finity (retiros, envíos Bre-B,
    // conversiones) las piden solo otras funciones con la llave de servicio
    // (mouv-proxy y gasfree, después de debitar al cliente y con sus
    // candados). Con un JWT de admin se podía mandar Bre-B de la bolsa de
    // Lincoin a cualquier llave sin débito en el libro ni código por
    // operación. Ningún panel las usa directo.
    const SOLO_SERVICIO = new Set(['create_withdrawal', 'breb_crear', 'breb_confirmar', 'convert', 'convert_confirm'])
    if (SOLO_SERVICIO.has(action) && !caller.servicio) {
      return json(403, { error: 'forbidden', message: 'Operación restringida.' })
    }
    // IDENTIDAD PROBADA (JWT real, no un user_id en el body): gestionar cuentas
    // externas y crear cobros. Bloquea al atacante que solo tiene la llave
    // pública + el id de una víctima.
    // Acciones que leen o MUTAN datos/saldo de una cuenta: exigen identidad
    // PROBADA (JWT real o service-role interno), nunca un user_id suelto en el
    // body. Sin esto, cualquiera con la anon key + el UUID de una víctima podía
    // enumerar sus retiros (fuga) y forzar cambios de estado/reembolsos en su
    // cuenta (IDOR). Los reconciliadores mueven saldo → aquí adentro.
    // 'email_event' entró acá porque era una PUERTA TRASERA a los correos:
    // con la sola llave pública + el id de cualquier usuario se podía hacer
    // que Lincoin le mandara a esa persona un correo con asunto, título y
    // mensaje ELEGIDOS POR QUIEN LLAMA — y salía firmado desde nuestro
    // dominio. Peor que el hueco de los webhooks: ahí el texto era nuestro,
    // acá lo escribe el atacante. Además esta función reenvía a
    // notify-transaction con el service key, o sea que autenticaba al
    // atacante por él.
    //
    // 'payment_link_status' y 'withdrawal_status' consultaban a Finity por un
    // id suelto, sin mirar de quién era: montos, destinos y estados de cobros
    // y retiros ajenos, a la vista de cualquiera con la llave pública.
    const NEEDS_IDENTITY = new Set(['external_accounts', 'create_external_account', 'delete_external_account', 'create_payment_link', 'reconcile_withdrawals', 'reconcile_payin', 'email_event', 'payment_link_status', 'withdrawal_status'])
    if (NEEDS_IDENTITY.has(action) && !(caller.viaJwt || caller.internal)) {
      return json(403, { error: 'forbidden', message: 'Vuelve a iniciar sesión para continuar.' })
    }
    // NOTA DE SEGURIDAD (pendiente de rework): create_withdrawal/convert se
    // pueden llamar directo con la anon-key + user_id (medio-auth), sin pasar
    // por el débito de saldo de mouv-proxy. El camino correcto es que TODO
    // retiro/conversión del cliente pase por mouv-proxy (que debita antes) y
    // que finity-proxy exija caller.internal para esas acciones. No se fuerza
    // aquí todavía porque el convertidor y la mesa OTC del cliente aún llaman
    // finity-proxy directo; migrar esos flujos es el fix de raíz.

    if (action === 'ping') {
      await getFinityToken()
      const modo = FINITY_BASE === PROD_BASE ? 'PRODUCCIÓN (tasa real)' : 'SANDBOX (datos de prueba)'
      return json(200, {
        ok: true, base: FINITY_BASE, baseIgnorada: FINITY_BASE_IGNORADA,
        message: `Credenciales válidas — conectado a ${modo} (${FINITY_BASE}).${FINITY_BASE_IGNORADA ? ` Se ignoró FINITY_BASE_URL=${FINITY_BASE_IGNORADA}: no es el dominio activo de Finity; bórrala en Supabase.` : ''} (proxy v5.3)`,
      })
    }

    if (action === 'balance') {
      const { res, path } = await finityTry('balance')
      return json(200, { ok: res.ok, status: res.status, path, data: await res.json().catch(() => null) })
    }

    // ── Saldos de la plataforma Finity (USDt + Peso Finity/COP) para
    //    mostrarlos en el admin. Solo el backend del PORTAL los expone
    //    (prod.finity.com.co:444), con el JWT de su propio login. Se inicia
    //    sesión con las credenciales del portal (secrets) y se leen:
    //      GET /convert/copBalance  → saldo COP (Peso Finity)
    //      GET /status              → trae el saldo USDt (y más)
    if (action === 'treasury_balances') {
      // Saldos de la empresa → solo admin/interno (nunca un cliente).
      if (!caller.internal) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      const amountOf = (d: any): number | null => {
        if (d == null) return null
        if (typeof d === 'number') return Number.isFinite(d) ? d : null
        if (typeof d === 'string') { const n = Number(d.replace(/,/g, '')); return Number.isFinite(n) ? n : null }
        const c = d.balance ?? d.available ?? d.available_balance ?? d.availableBalance
          ?? d.amount ?? d.total ?? d.value ?? d.copBalance ?? d.usdBalance ?? d.usdtBalance
          ?? d.data?.balance ?? d.data?.available ?? d.data?.amount ?? d.data?.total ?? d.data?.value
          ?? d.data?.copBalance ?? d.data?.usdBalance ?? d.data?.usdtBalance
          ?? (Array.isArray(d.data) ? (d.data[0]?.balance ?? d.data[0]?.available ?? d.data[0]?.amount) : undefined)
          ?? (Array.isArray(d) ? (d[0]?.balance ?? d[0]?.available ?? d[0]?.amount) : undefined)
        const n = Number(c)
        return Number.isFinite(n) ? n : null
      }
      // Busca recursivamente en un objeto la primera clave cuyo nombre
      // contenga alguno de los términos y cuyo valor sea numérico.
      const deepFind = (obj: any, terms: string[], depth = 0): number | null => {
        if (obj == null || depth > 5) return null
        if (Array.isArray(obj)) {
          for (const it of obj) { const v = deepFind(it, terms, depth + 1); if (v != null) return v }
          return null
        }
        if (typeof obj !== 'object') return null
        for (const [k, val] of Object.entries(obj)) {
          const kl = k.toLowerCase()
          if (terms.some(t => kl.includes(t))) {
            const n = Number(typeof val === 'string' ? val.replace(/,/g, '') : val)
            if (Number.isFinite(n)) return n
          }
        }
        for (const val of Object.values(obj)) {
          const v = deepFind(val, terms, depth + 1); if (v != null) return v
        }
        return null
      }

      // 22 nov: el saldo sale de la API de socios, por la ruta oficial
      // GET /v0/account/{COP|USD} (doc de Finity), con el token de los
      // envíos. El portal (con su usuario y contraseña) queda de respaldo:
      // su servidor viejo dejó de existir cuando Finity dejó un solo dominio.
      const forzar = payload?.forzar === true
      const b = await saldoPorApi(amountOf, deepFind, forzar)
      if (b.cop != null || b.usdt != null) {
        return json(200, { ok: true, usdt: b.usdt, cop: b.cop, sandbox: false, source: 'api', raw: b.intentos })
      }
      // forzar: lo pide el botón de actualizar de la bolsa (salta el freno).
      const token = await getPortalToken({ forzar })
      if (!token) {
        return json(200, {
          ok: false, usdt: null, cop: null,
          error: (portalEmail() && portalPassword())
            ? `${motivoLoginPortal(lastPortalLogin)} Tampoco se pudo leer por la API de socios (${Object.entries(b.intentos).map(([k, v]: [string, any]) => `${k}: ${v?.status ?? '—'}`).join(', ')}).`
            : 'Faltan credenciales del portal Finity (define los secrets FINITY_PORTAL_EMAIL y FINITY_PORTAL_PASSWORD).',
          needsPortalCreds: !(portalEmail() && portalPassword()),
          loginDebug: lastPortalLogin,
          emailUsed: portalEmail() ? `${portalEmail().slice(0, 3)}…@${portalEmail().split('@')[1] ?? ''}` : null,
          raw: { login: lastPortalLogin },
        })
      }

      // Rutas confirmadas del portal:
      //   GET /convert/copBalance → saldo COP (Peso Finity)
      //   GET /homeFinity/action  → data.userFreeBalance = saldo USDt
      const probes: { key: string; path: string }[] = [
        { key: 'copBalance', path: '/convert/copBalance' },
        { key: 'action', path: '/homeFinity/action' },
      ]
      const results: Record<string, any> = {}
      for (const p of probes) {
        try {
          const r = await portalFetch(p.path)
          const raw = await r.json().catch(() => null)
          results[p.key] = { status: r.status, raw }
        } catch (e) { results[p.key] = { status: 'throw', err: String(e).slice(0, 120) } }
      }

      // COP: del copBalance directo.
      const cop = amountOf(results.copBalance?.raw)
        ?? deepFind(results.copBalance?.raw, ['cop', 'balance'])
      // USDt: data.userFreeBalance del action (viene como string, p.ej. "8328.12745800").
      const a = results.action?.raw
      const freeBal = a?.data?.userFreeBalance ?? a?.userFreeBalance
        ?? a?.data?.freeBalance ?? a?.data?.balance
      let usdt: number | null = null
      if (freeBal != null) {
        const n = Number(typeof freeBal === 'string' ? freeBal.replace(/,/g, '') : freeBal)
        usdt = Number.isFinite(n) ? n : null
      }
      if (usdt == null) usdt = deepFind(a, ['userfreebalance', 'freebalance', 'usdt', 'balance'])

      return json(200, {
        ok: usdt != null || cop != null,
        usdt: usdt ?? null,
        cop: cop ?? null,
        sandbox: false,
        source: 'portal',
        status: {
          copBalance: results.copBalance?.status,
          action: results.action?.status,
        },
        raw: results,
      })
    }

    if (action === 'movements') {
      const qs = payload.query ? `?${new URLSearchParams(payload.query as Record<string, string>)}` : ''
      const { res, path } = await finityTry('movements', {}, qs)
      return json(200, { ok: res.ok, status: res.status, path, data: await res.json().catch(() => null) })
    }

    if (action === 'external_accounts') {
      // La lista es UNA sola (Finity es una cuenta de empresa): se sirve de
      // caché 45 s para todos. Antes cada navegador abierto la pedía cada
      // 15 s, cientos de llamadas por hora a la misma ruta de Finity.
      const lista = await listaCuentasFinity(caller.internal && payload?.fresca === true)
      // Un CLIENTE recibe solo SUS cuentas. La lista de Finity es una sola para
      // toda la empresa: antes se devolvía entera y cualquier sesión veía
      // nombre, documento y número de cuenta de los beneficiarios de todos los
      // demás clientes. El servidor y el admin (internal) la reciben completa.
      if (!caller.internal) {
        const { data: yo } = await db.from('users').select('raw_data').eq('id', String(caller.userId ?? '')).maybeSingle()
        const contactos: any[] = Array.isArray((yo as any)?.raw_data?.mouvContacts) ? (yo as any).raw_data.mouvContacts : []
        const ids = new Set(contactos.flatMap((c: any) => [c?.finityId, c?.mouvId]).filter(Boolean).map((x: any) => String(x)))
        const cuentas = new Set(contactos.map((c: any) => String(c?.accountNumber ?? '').replace(/\D/g, '')).filter(Boolean))
        const esMia = (r: any) => ids.has(String(r?.id ?? r?.external_account_id ?? r?.account_id ?? ''))
          || cuentas.has(String(r?.account_number ?? r?.account?.account_number ?? '').replace(/\D/g, ''))
        const d: any = lista.data
        const filtrada = Array.isArray(d) ? d.filter(esMia)
          : (d && typeof d === 'object')
            ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? (v as any[]).filter(esMia) : v]))
            : d
        return json(200, { ok: lista.ok, status: lista.status, path: lista.path, data: filtrada, ...(lista.cache ? { cache: true } : {}) })
      }
      if (lista.cache) return json(200, { ok: lista.ok, status: lista.status, path: lista.path, data: lista.data, cache: true })
      const { res, path, data } = { res: { ok: lista.ok, status: lista.status }, path: lista.path, data: lista.data }
      // Se audita un RESUMEN de los estados que devuelve el proveedor: qué
      // campos trae cada cuenta y con qué valor. Sin esto no se puede resolver
      // una discrepancia entre su portal y Lincoin más que adivinando qué
      // campo mirar — que fue exactamente el problema con una cuenta que allá
      // estaba en revisión y acá salía aprobada.
      try {
        const d: any = data
        const filas: any[] = Array.isArray(d) ? d : (d?.data ?? d?.results ?? d?.items ?? d?.accounts ?? [])
        if (Array.isArray(filas) && filas.length) {
          await logAudit(caller.userId!, 'finity.external_accounts.estados', {
            total: filas.length,
            // Solo las claves que suenan a estado, para no volcar datos
            // bancarios en la auditoría.
            campos: Array.from(new Set(filas.flatMap((r: any) =>
              Object.keys(r ?? {}).filter(k => /status|estado|state|verif/i.test(k))))),
            muestra: filas.slice(0, 12).map((r: any) => ({
              id: r?.id ?? r?.external_account_id ?? null,
              cuenta: String(r?.account_number ?? r?.account?.account_number ?? '').slice(-4),
              verification_status: r?.verification_status ?? null,
              status: r?.status ?? null,
              estado: r?.estado ?? null,
              state: r?.state ?? null,
            })),
          })
        }
      } catch { /* la auditoría nunca puede tumbar la consulta */ }
      return json(200, { ok: res.ok, status: res.status, path, data })
    }

    // ── Reintentar inscripciones pendientes (botón del admin) ──────────────
    // La inscripción en Finity de una cuenta ACH la reintentaba SOLO la
    // página de Beneficiarios del cliente, con su sesión. Cuando Finity
    // rechaza un rato (23 nov: 403 desde las 10:20 am), las cuentas quedan
    // sin id hasta que cada cliente vuelva a entrar. Esto las inscribe desde
    // el servidor, de a una, por el mismo camino (create_external_account:
    // freno, dedupe y auditoría incluidos) y se detiene en el primer
    // rechazo de Finity para no hacer que bloquee la cuenta.
    if (action === 'reinscribir_pendientes') {
      if (!caller.internal || caller.servicio) return json(403, { error: 'forbidden', message: 'Solo el equipo puede reintentar inscripciones.' })
      const soloContar = payload.soloContar === true
      const freno = await leerFrenoInscripciones()
      // Pendiente: cuenta bancaria de Colombia, sin id de Finity, que no
      // quedó rechazada por datos (400/422: repetirla da lo mismo). La
      // búsqueda, el cuerpo y la escritura del contacto son los mismos que
      // usa inscribir_pendientes (tarea programada y panel de Tesorería).
      let lista: Pendiente[]
      try { lista = (await inscripcionesPendientes()).lista.filter(p => ![400, 422].includes(Number(p.contacto?.regHttp)) || rechazoPorBancoResuelto(p.contacto)) }
      catch (e) { return json(200, { ok: false, error: String((e as Error)?.message ?? e) }) }
      lista.sort((a, b) => String(b.contacto?.createdAt ?? '').localeCompare(String(a.contacto?.createdAt ?? '')))
      if (soloContar || freno) return json(200, { ok: true, pendientes: lista.length, pausaHasta: freno?.hasta ?? null, pausaHttp: freno?.http ?? null, inscritas: 0, intentadas: 0 })

      const inicio = Date.now()
      const maximo = Math.min(Math.max(1, Number(payload.max) || 15), 30)
      let inscritas = 0, intentadas = 0, sinBanco = 0
      let detenido: { http: number; mensaje: string } | null = null
      for (const p of lista) {
        if (intentadas >= maximo || Date.now() - inicio > 100_000) break
        const cu = cuerpoCuentaFinity(p.contacto)
        if ('motivo' in cu) { sinBanco++; continue }
        intentadas++
        const intentoAt = new Date().toISOString()
        // Directo, sin volver a llamar a esta misma función por HTTP: mismo
        // camino (freno, dedupe y auditoría) que create_external_account.
        const rr: any = await inscribirCuentaFinity(p.userId, cu.body)
        const dd = rr?.data ?? {}
        const fid = rr?.id ?? dd.id ?? dd.external_account_id ?? dd.account_id ?? dd?.account?.id ?? dd?.data?.id ?? null
        const http = Number(rr?.status) || 0
        const cambio = rr?.ok && fid
          ? { mouvId: String(fid), finityId: String(fid), status: 'en_proceso', lastError: null, regIntentoAt: intentoAt, regHttp: http || 201, inscritaPor: 'equipo' }
          : { lastError: `[${new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' })}] HTTP ${http || '—'} (reintento del equipo): ${JSON.stringify(dd).slice(0, 220)}`, regIntentoAt: intentoAt, regHttp: http }
        // Lectura fresca justo antes de escribir: el cliente puede estar
        // editando su lista; solo se toca la fila de este beneficiario.
        await actualizarContacto(p.userId, String(p.contacto?.id), cambio)
        if (rr?.ok && fid) { inscritas++; continue }
        // Finity frenó (o ya hay pausa): parar acá. Insistir es lo que hace
        // que bloquee la credencial.
        if (rr?.frenado || rr?.sinToken || http === 403 || http === 429 || http === 401) { detenido = { http, mensaje: String(dd?.message ?? '').slice(0, 200) }; break }
      }
      await logAudit(caller.userId!, 'finity.reinscribir_pendientes', { pendientes: lista.length, intentadas, inscritas, sinBanco, detenido })
      const frenoAhora = await leerFrenoInscripciones()
      return json(200, { ok: true, pendientes: lista.length, intentadas, inscritas, sinBanco, detenido, pausaHasta: frenoAhora?.hasta ?? null, pausaHttp: frenoAhora?.http ?? null })
    }

    if (action === 'create_external_account') {
      return json(200, await inscribirCuentaFinity(caller.userId!, payload.data))
    }

    // ── Por qué no llegan las inscripciones (23 nov) ──
    // Conexión (dominio y token), pausa, los últimos intentos con lo que
    // contestó Finity, y las cuentas que siguen sin inscribir.
    if (action === 'inscripciones_diag') {
      if (!caller.internal) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      let conexion: Record<string, unknown>
      try {
        await getFinityToken()
        conexion = { ok: true, base: FINITY_BASE }
      } catch (e) {
        conexion = { ok: false, base: FINITY_BASE_ENV || PROD_BASE, error: String((e as Error)?.message ?? e).slice(0, 300), rechazo: ultimoRechazoToken }
      }
      let pausa: Record<string, unknown> | null = null
      try {
        const { data } = await db.from('system_config').select('value').eq('key', FRENO_KEY).maybeSingle()
        const v = data?.value ? JSON.parse(data.value) : null
        if (v && Number(v.hasta) > Date.now()) pausa = { hasta: new Date(Number(v.hasta)).toISOString(), http: Number(v.http) || null, seguidos: Number(v.seguidos ?? 0) }
      } catch { /* sin pausa legible */ }
      const { data: filas } = await db.from('admin_actions')
        .select('created_at, admin_email, metadata')
        .eq('action', 'finity.external_account.create')
        .order('created_at', { ascending: false }).limit(30)
      const intentos = ((filas ?? []) as any[]).map(f => {
        const m = f.metadata ?? {}
        const acc = m.enviado?.account ?? {}
        return {
          at: f.created_at, quien: f.admin_email ?? null,
          status: Number(m.status ?? 0), ok: m.ok === true, id: m.idCreado ?? null,
          cuenta: enmascarar(acc.account_number), banco: nombreBancoDeCodigo(acc.financial_institution_code),
          titular: acc.account_holder_fullname ?? null, tipoDoc: acc.account_holder_id_type ?? null,
          motivo: m.ok === true ? null : motivoDeRespuesta(m),
        }
      })
      let pendientes: any[] = [], totalPendientes = 0, truncado = false, errorPendientes: string | null = null
      try {
        const r = await inscripcionesPendientes()
        truncado = r.truncado
        totalPendientes = r.lista.length
        pendientes = r.lista.slice(0, 150).map(p => {
          const cu = cuerpoCuentaFinity(p.contacto)
          return {
            userId: p.userId, cliente: p.cliente,
            contacto: String(p.contacto?.name ?? ''), banco: String(p.contacto?.bank ?? ''),
            cuenta: enmascarar(p.contacto?.accountNumber), creada: p.contacto?.createdAt ?? null,
            ultimoIntento: p.contacto?.regIntentoAt ?? null, http: p.contacto?.regHttp ?? null,
            ultimoError: p.contacto?.lastError ? String(p.contacto.lastError).slice(0, 260) : null,
            datosIncompletos: 'motivo' in cu ? cu.motivo : null,
            listaParaReintento: puedeReintentarRegistro(p.contacto) || rechazoPorBancoResuelto(p.contacto),
          }
        })
      } catch (e) { errorPendientes = String((e as Error)?.message ?? e) }
      return json(200, {
        ok: true, conexion, baseIgnorada: FINITY_BASE_IGNORADA, pausa,
        intentos, pendientes, totalPendientes, truncado, errorPendientes,
      })
    }

    // ── Inscribir desde el servidor las cuentas que quedaron pendientes ──
    // La tarea programada (finity-inscripciones.yml) la corre con la llave
    // de servicio; la mesa, desde el panel. De a pocas: cada inscripción puede
    // tardar hasta ~50 s y la función tiene un tiempo máximo.
    if (action === 'inscribir_pendientes') {
      if (!caller.internal) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      const freno = await leerFrenoInscripciones()
      if (freno) return json(200, { ok: true, frenado: true, hasta: new Date(freno.hasta).toISOString(), http: freno.http, intentadas: 0, inscritas: 0 })
      const limite = Math.max(1, Math.min(5, Number(payload.limite ?? 3) || 3))
      // Desde el panel se puede saltar la espera por cuenta ("Inscribir
      // ahora"); el reintento programado la respeta. Igual, un rechazo
      // idéntico de hace menos de 10 min no se vuelve a mandar (ver
      // inscribirCuentaFinity).
      const forzar = payload.forzar === true && !caller.servicio
      const soloUsuario = payload.userId ? String(payload.userId) : null
      const soloContacto = payload.contactoId ? String(payload.contactoId) : null
      let lista: Pendiente[]
      try { lista = (await inscripcionesPendientes()).lista }
      catch (e) { return json(500, { ok: false, error: String((e as Error)?.message ?? e) }) }
      const candidatas = lista
        .filter(p => (!soloUsuario || p.userId === soloUsuario) && (!soloContacto || String(p.contacto?.id) === soloContacto))
        .filter(p => forzar || puedeReintentarRegistro(p.contacto) || rechazoPorBancoResuelto(p.contacto))
        // Las más viejas primero: llevan más tiempo esperando.
        .sort((a, b) => String(a.contacto?.createdAt ?? '').localeCompare(String(b.contacto?.createdAt ?? '')))
      const resultados: any[] = []
      const t0 = Date.now()
      for (const p of candidatas.slice(0, limite)) {
        if (Date.now() - t0 > 90_000) break   // margen antes del tiempo máximo de la función
        const intentoAt = new Date().toISOString()
        const cu = cuerpoCuentaFinity(p.contacto)
        let cambios: Record<string, unknown>
        let res: Record<string, any>
        if ('motivo' in cu) {
          // Sin datos completos no se llama a Finity: diría 400 igual.
          res = { ok: false, status: 400, data: { message: cu.motivo } }
          cambios = { lastError: `[registro bancario] ${cu.motivo}. Edita el beneficiario.`, regIntentoAt: intentoAt, regHttp: 400 }
        } else {
          res = await inscribirCuentaFinity(p.userId, cu.body)
          const fid = res?.id ?? res?.data?.id ?? res?.data?.external_account_id ?? res?.data?.account_id ?? null
          cambios = res?.ok && fid
            ? { finityId: String(fid), mouvId: String(fid), status: 'en_proceso', lastError: null, regIntentoAt: intentoAt, regHttp: Number(res.status) || 201, inscritaPor: 'servidor' }
            : { lastError: `[registro bancario] HTTP ${res?.status ?? '—'}: ${JSON.stringify(res?.data ?? res).slice(0, 260)}`, regIntentoAt: intentoAt, regHttp: Number(res?.status) || 0 }
        }
        const errGuardar = await actualizarContacto(p.userId, String(p.contacto?.id), cambios)
        resultados.push({
          userId: p.userId, cliente: p.cliente, contacto: String(p.contacto?.name ?? ''), cuenta: enmascarar(p.contacto?.accountNumber),
          ok: !!cambios.finityId, status: Number(res?.status ?? 0), reutilizada: !!res?.reutilizada,
          motivo: cambios.finityId ? null : (digMotivoRechazo(res?.data) ?? res?.data?.message ?? null),
          guardado: errGuardar === null ? true : errGuardar === 'sin_cambio' ? 'ya_estaba' : false,
        })
        // Finity frenó: no se insiste con las demás.
        if (res?.frenado || res?.status === 403 || res?.status === 429 || res?.sinToken) break
      }
      if (!caller.servicio && caller.userId) {
        await logAudit(caller.userId, 'finity.inscribir_pendientes', {
          pendientes: lista.length, candidatas: candidatas.length, intentadas: resultados.length,
          inscritas: resultados.filter(r => r.ok).length, forzar,
        })
      }
      return json(200, {
        ok: true, pendientes: lista.length, candidatas: candidatas.length,
        intentadas: resultados.length, inscritas: resultados.filter(r => r.ok).length, resultados,
      })
    }

    // ── Quitar la pausa de inscripciones a mano ──
    // La pausa protege de que Finity bloquee por insistir. Si la mesa ya sabe
    // que se resolvió (habló con Finity, corrigió la credencial), la quita sin
    // esperar. Si Finity vuelve a responder 403/429, la pausa vuelve sola.
    if (action === 'inscripciones_reanudar') {
      if (!caller.internal || caller.servicio) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      const { error } = await db.from('system_config').upsert({ key: FRENO_KEY, value: JSON.stringify({ hasta: 0, http: null, quitadaPor: caller.userId, quitadaAt: Date.now() }) }, { onConflict: 'key' })
      if (error) return json(500, { ok: false, error: error.message })
      await logAudit(caller.userId!, 'finity.inscripciones_reanudar', {})
      return json(200, { ok: true })
    }

    // Des-inscribir una cuenta destino en Finity al eliminar el contacto.
    // OJO: Finity es UNA sola cuenta de empresa (no hay subcuenta por usuario),
    // así que la misma cuenta bancaria puede estar inscrita por VARIOS usuarios
    // de Lincoin apuntando a la misma external account. Antes de borrarla allá,
    // se verifica que NINGÚN otro usuario la siga teniendo — si no, se rompen
    // sus envíos. El front ya quitó su copia local antes de llamar aquí, por
    // eso el conteo sobre el estado actual es fiable.
    if (action === 'delete_external_account') {
      const eaId = String(payload.finityId ?? '').trim()
      const accDigits = String(payload.accountNumber ?? '').replace(/\D/g, '')
      if (!eaId && !accDigits) return json(200, { ok: false, error: 'missing_ref', message: 'Falta la referencia de la cuenta o su número.' })

      // Guard cross-usuario: ¿alguien más (o el mismo, en otro contacto) sigue
      // teniendo esta cuenta inscrita? Se comparan finityId e igual número.
      let stillUsed = 0
      try {
        // Lincoin guarda los contactos en raw_data.mouvContacts (nombre
        // histórico); se revisa también la clave vieja finityContacts.
        //
        // Se pregunta a la base por contención (¿alguna cuenta tiene un
        // contacto con este finityId / este número?), no leyendo todas las
        // cuentas: esa lectura volvía solo las primeras 1.000 y, con más
        // clientes, se borraba en Finity una cuenta que otro todavía usaba.
        const preguntas: Record<string, unknown>[] = []
        for (const k of ['mouvContacts', 'finityContacts']) {
          if (eaId) preguntas.push({ [k]: [{ finityId: eaId }] })
          if (accDigits) preguntas.push({ [k]: [{ accountNumber: accDigits }] })
          // El número se guarda como lo escribió el cliente (puede traer
          // guiones o espacios): también se pregunta tal cual llegó.
          const tal = String(payload.accountNumber ?? '').trim()
          if (tal && tal !== accDigits) preguntas.push({ [k]: [{ accountNumber: tal }] })
        }
        const conteos = await Promise.all(preguntas.map(async (contiene) => {
          const { data, error } = await db.from('users').select('id, contacts:raw_data->mouvContacts, legacy:raw_data->finityContacts').contains('raw_data', contiene).limit(50)
          if (error) throw error
          // Mismo criterio que antes: una billetera cripto no cuenta.
          return ((data ?? []) as any[]).filter(r => [
            ...(Array.isArray(r?.contacts) ? r.contacts : []),
            ...(Array.isArray(r?.legacy) ? r.legacy : []),
          ].some((c: any) => c?.accountKind !== 'wallet' && ((eaId && String(c?.finityId ?? '') === eaId) || (accDigits && String(c?.accountNumber ?? '').replace(/\D/g, '') === accDigits)))).map(r => String(r.id))
        }))
        stillUsed = new Set(conteos.flat()).size
      } catch { stillUsed = 1 /* si la consulta falla, por seguridad NO borramos en Finity */ }

      if (stillUsed > 0) {
        await logAudit(caller.userId!, 'finity.external_account.delete.skipped', { finityId: eaId, accountDigits: accDigits, stillUsed })
        return json(200, { ok: true, deletedInFinity: false, reason: 'still_used', message: 'La cuenta sigue inscrita por otro usuario — se quitó solo de tu lista.' })
      }
      if (!eaId) {
        // Sin id de Finity no hay qué des-inscribir (quedó solo local).
        return json(200, { ok: true, deletedInFinity: false, reason: 'no_finity_id' })
      }

      // DELETE /v0/external-accounts/{id} — probar las variantes de ruta.
      let last: { res: Response; path: string } | null = null
      const bases = [
        ...(WORKING['externalAccounts'] ? [WORKING['externalAccounts']] : []),
        ...CANDIDATES.externalAccounts.filter(p => p !== WORKING['externalAccounts']),
      ]
      for (const base of bases) {
        const path = `${base}/${encodeURIComponent(eaId)}`
        const res = await finityFetch(path, { method: 'DELETE' })
        last = { res, path }
        if (res.status !== 404 && res.status !== 405) break
      }
      const data = last ? await last.res.json().catch(() => null) : null
      // Un 404 NO prueba que se borró. 9 nov: todas las rutas de borrado
      // respondieron 404, se dio por «des-inscrita en el banco», y al volver a
      // inscribirla Finity devolvió la MISMA cuenta (con la cédula errada del
      // titular): el 404 era de la ruta, no de la cuenta. Ahora, tras un 404,
      // se mira la lista fresca: solo si la cuenta ya no está, se da por borrada.
      let okDel = !!last && last.res.ok
      let sigueEnFinity: boolean | null = null
      if (last && last.res.status === 404) {
        const lista = await listaCuentasFinity(true).catch(() => null)
        if (lista?.ok) {
          sigueEnFinity = filasDe(lista.data).some((r: any) => String(r?.id ?? r?.external_account_id ?? r?.account_id ?? '') === eaId)
          okDel = !sigueEnFinity
        }
      }
      if (okDel) listaCache = null
      await logAudit(caller.userId!, 'finity.external_account.delete', { status: last?.res.status, path: last?.path, finityId: eaId, ok: okDel, sigueEnFinity })
      return json(200, { ok: okDel, deletedInFinity: okDel, status: last?.res.status, path: last?.path, data,
        ...(!okDel ? { message: 'El banco no permitió des-inscribir esta cuenta: sigue registrada allá con los datos anteriores. Si hay que corregir el titular, se pide al equipo de Lincoin.' } : {}) })
    }

    if (action === 'create_withdrawal') {
      // SEGURIDAD: crear un retiro mueve dinero de la cuenta Finity de la
      // empresa (una sola cuenta compartida). Solo llamadas INTERNAS de
      // confianza: mouv-proxy (service-role, que YA debitó el saldo del
      // cliente) o un admin real (JWT con role='admin' / AdminBypass). Un
      // cliente con anon-key + user_id ya NO puede drenar la tesorería.
      if (!caller.internal) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      // UNA sola ruta, la confirmada, y un solo intento. Antes un 404 hacía
      // probar /v0/withdrawals, /payouts, /transfers… con el MISMO cuerpo:
      // hasta 9 POST de plata por un envío. Y con 45 s de espera: Finity ya
      // tardó 9 s en crear una cuenta, y cortar a los 15 s convertía un
      // retiro lento pero hecho en un "falló" que se reembolsaba.
      const path = WORKING['withdrawalOrders'] ?? '/v0/withdrawal-orders'
      let res: Response
      try {
        res = await finityFetch(path, { method: 'POST', body: JSON.stringify(payload.data ?? {}), signal: AbortSignal.timeout(45000) })
      } catch (e) {
        const desconocido = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError' || !String((e as Error)?.message ?? '').startsWith('finity_auth_failed')
        await logAudit(caller.userId!, 'finity.withdrawal.create', { status: 0, path, data: payload.data, error: String((e as Error)?.message ?? e).slice(0, 200), desenlaceDesconocido: desconocido })
        return json(200, { ok: false, status: 0, path, desenlaceDesconocido: desconocido, error: desconocido ? 'sin_respuesta' : 'finity_auth_failed' })
      }
      const data = await res.json().catch(() => null)
      await logAudit(caller.userId!, 'finity.withdrawal.create', { status: res.status, path, data: payload.data, response: data })
      return json(200, { ok: res.ok, status: res.status, path, data, ...(res.status >= 500 ? { desenlaceDesconocido: true } : {}) })
    }

    // ── Bre-B por Finity (la "Cuenta 2" de Bre-B) ────────────────────────
    // Dos pasos: CREAR arma la transferencia y devuelve el titular de la llave
    // y el costo, sin mover plata; CONFIRMAR es lo que la manda. Solo las
    // llama mouv-proxy, que ya debitó el saldo del cliente.
    //
    // Por eso el trato del error es distinto en cada uno: si crear falla o no
    // contesta, no salió nada y se puede devolver el saldo. Si confirmar no
    // contesta, no se sabe — puede haber salido.
    if (action === 'breb_crear') {
      if (!caller.internal) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      const path = '/v0/breb-transfers'
      let res: Response
      try {
        res = await finityFetch(path, { method: 'POST', body: JSON.stringify(payload.data ?? {}), signal: AbortSignal.timeout(30000) })
      } catch (e) {
        await logAudit(caller.userId!, 'finity.breb.crear', { status: 0, path, data: payload.data, error: String((e as Error)?.message ?? e).slice(0, 200) })
        return json(200, { ok: false, status: 0, path, sinRespuesta: true })
      }
      const data = await res.json().catch(() => null)
      await logAudit(caller.userId!, 'finity.breb.crear', { status: res.status, path, data: payload.data, response: data })
      return json(200, { ok: res.ok, status: res.status, path, data })
    }

    if (action === 'breb_confirmar') {
      if (!caller.internal) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      const id = String(payload.transaction_id ?? '').trim()
      if (!/^[\w-]{6,100}$/.test(id)) return json(400, { error: 'missing_id' })
      const path = '/v0/breb-transfers/confirm'
      let res: Response
      try {
        res = await finityFetch(path, { method: 'POST', body: JSON.stringify({ transaction_id: id }), signal: AbortSignal.timeout(45000) })
      } catch (e) {
        // Un token rechazado es un no: la confirmación ni se mandó.
        const desconocido = !String((e as Error)?.message ?? '').startsWith('finity_auth_failed')
        await logAudit(caller.userId!, 'finity.breb.confirmar', { status: 0, path, id, error: String((e as Error)?.message ?? e).slice(0, 200), desenlaceDesconocido: desconocido })
        return json(200, { ok: false, status: 0, path, desenlaceDesconocido: desconocido, error: desconocido ? 'sin_respuesta' : 'finity_auth_failed' })
      }
      const data = await res.json().catch(() => null)
      await logAudit(caller.userId!, 'finity.breb.confirmar', { status: res.status, path, id, response: data })
      return json(200, { ok: res.ok, status: res.status, path, data, ...(res.status >= 500 || res.status === 408 ? { desenlaceDesconocido: true } : {}) })
    }

    if (action === 'withdrawal_status') {
      const id = String(payload.id ?? '')
      if (!id) return json(400, { error: 'missing_id' })
      if (!(await esMiReferencia(caller, id))) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      const enc = encodeURIComponent(id)
      // El id de la dispersión ACH es un MOVEMENT id (mvm-…): en Finity vive bajo
      // /v0/movements/{id} (así lo muestra el portal: "Detalle del movimiento").
      // Antes sólo se consultaba /v0/withdrawal-orders/{id} y no encontraba el
      // estado → la dispersión quedaba atascada en 'Procesando'. Se prueba el
      // DETALLE en movements y órdenes de retiro; gana la 1ª 2xx utilizable.
      const detailBases = [
        ...(CANDIDATES.movements ?? []),
        ...(WORKING['withdrawalOrders'] ? [WORKING['withdrawalOrders']] : []),
        ...(CANDIDATES.withdrawalOrders ?? []),
      ]
      let lastStatus = 0, lastData: any = null
      // Se leen TODOS los detalles que respondan (movimiento y orden de
      // retiro): el estado suele venir en el movimiento, pero el MOTIVO del
      // rechazo puede venir solo en la orden. El primero va en `data` (como
      // siempre) y los demás en `extra`, para quien quiera excavar en todos.
      const cuerpos: { path: string; data: any }[] = []
      for (const base of detailBases) {
        const r = await finityFetch(`${base}/${enc}`)
        if (r.status === 404 || r.status === 405 || r.status === 0) continue
        const data = await r.json().catch(() => null)
        if (r.ok && data && typeof data === 'object') {
          cuerpos.push({ path: `${base}/{id}`, data })
          if (cuerpos.length >= 2) break
          continue
        }
        lastStatus = r.status; lastData = data
      }
      if (cuerpos.length) {
        return json(200, { ok: true, status: 200, path: cuerpos[0].path, data: cuerpos[0].data, extra: cuerpos.slice(1) })
      }
      // Respaldo: buscar el movimiento por id en la LISTA de movimientos
      // (endpoint confirmado que ya usa reconcile_payin).
      try {
        const { res } = await finityTry('movements', {})
        const body = await res.json().catch(() => null) as any
        const arr: any[] = Array.isArray(body) ? body : (Array.isArray(body?.data) ? body.data : (Array.isArray(body?.movements) ? body.movements : (Array.isArray(body?.items) ? body.items : [])))
        const match = arr.find(m => [m?.id, m?.reference, m?.movement_id, m?.movementId, m?.external_id].map(x => String(x ?? '')).includes(id))
        if (match) return json(200, { ok: true, status: 200, path: 'movements[list]', data: match })
      } catch { /* respaldo best-effort */ }
      return json(200, { ok: false, status: lastStatus, data: lastData })
    }

    // ── Motivo de un rechazo: TODO lo que Finity sabe de ese movimiento ──
    // El portal de Finity muestra "Motivo de rechazo: NUMERO CUENTA NO
    // EXISTE", pero el detalle de la API de socios no lo trae. Acá se junta
    // todo lo que responda sobre ese id: el detalle en cada ruta conocida, el
    // movimiento dentro del listado y el detalle en el backend del portal
    // (el mismo que alimenta esa pantalla). Solo lectura; solo interno.
    if (action === 'motivo_rechazo') {
      const id = String(payload.id ?? '').trim()
      if (!/^[\w-]{6,100}$/.test(id)) return json(400, { error: 'missing_id' })
      const enc = encodeURIComponent(id)
      const cuerpos: { fuente: string; path: string; status: number; data?: any }[] = []
      const leer = async (fuente: string, path: string, pedir: () => Promise<Response>) => {
        try {
          const r = await pedir()
          const data = r.ok ? await r.json().catch(() => null) : null
          cuerpos.push({ fuente, path, status: r.status, ...(data && typeof data === 'object' ? { data } : {}) })
        } catch { cuerpos.push({ fuente, path, status: -1 }) }
      }
      for (const base of [...(CANDIDATES.movements ?? []), ...(CANDIDATES.withdrawalOrders ?? []).slice(0, 2)]) {
        await leer('api', `${base}/{id}`, () => finityFetch(`${base}/${enc}`, { signal: AbortSignal.timeout(10000) }))
      }
      try {
        const { res, path } = await finityTry('movements', {})
        const body = await res.json().catch(() => null) as any
        const arr: any[] = Array.isArray(body) ? body : (Array.isArray(body?.data) ? body.data : (Array.isArray(body?.movements) ? body.movements : (Array.isArray(body?.items) ? body.items : [])))
        const match = arr.find(m => [m?.id, m?.reference, m?.movement_id, m?.movementId, m?.external_id].map(x => String(x ?? '')).includes(id))
        cuerpos.push({ fuente: 'api', path: `${path}[lista]`, status: match ? res.status : 404, ...(match ? { data: match } : {}) })
      } catch { cuerpos.push({ fuente: 'api', path: 'movements[lista]', status: -1 }) }
      if (await getPortalToken()) {
        for (const p of ['/movements/', '/movement/', '/transactions/', '/transaction/', '/withdrawals/', '/withdraw/']) {
          await leer('portal', `${p}{id}`, () => portalFetch(`${p}${enc}`, { signal: AbortSignal.timeout(8000) }))
        }
      } else {
        cuerpos.push({ fuente: 'portal', path: 'login', status: 0 })
      }
      return json(200, { ok: true, cuerpos })
    }

    // ── Enviar un correo de evento al PROPIO usuario (ej. "Contacto
    //    aprobado"). El destinatario se lee de la base por el userId del
    //    caller — el cliente nunca elige a quién se le manda. Reenvía a
    //    notify-transaction (que tiene Resend) con el service role. ────────
    if (action === 'email_event') {
      const uid = String(caller.userId ?? '')
      if (!uid) return json(400, { error: 'missing_userId' })
      const { data: u } = await db.from('users').select('email').eq('id', uid).single()
      if (!u?.email) return json(200, { ok: false, error: 'no_email' })
      // El texto lo arma el SERVIDOR a partir de una lista cerrada de eventos.
      // Antes el navegador mandaba asunto, título y mensaje en HTML, y Lincoin
      // los enviaba tal cual desde no-reply@lincoin.me: cualquier cliente podía
      // fabricar un correo con formularios y enlaces "de Lincoin" (phishing
      // contra el buzón compartido de su propia empresa). Lo que escribe el
      // cliente —el nombre del contacto— va escapado.
      const evento = String(payload.evento ?? '')
      const escapar = (v: unknown) => String(v ?? '').slice(0, 120)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      const EVENTOS: Record<string, () => { subject: string; title: string; message: string }> = {
        contacto_aprobado: () => ({
          subject: 'Lincoin · Contacto aprobado',
          title: 'Contacto aprobado',
          message: `La cuenta de <strong>${escapar(payload.nombre)}</strong> quedó aprobada. Ya puedes transferirle.`,
        }),
      }
      const armar = EVENTOS[evento]
      if (!armar) return json(400, { ok: false, error: 'evento_desconocido' })
      const correo = armar()
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-transaction`, {
          method: 'POST',
          headers: await cabecerasInternas(db),
          body: JSON.stringify({ type: 'CUSTOM_EMAIL', to: u.email, ...correo }),
        })
        return json(200, { ok: r.ok })
      } catch (e) {
        return json(200, { ok: false, error: (e as Error)?.message })
      }
    }

    // ── Reconciliar retiros: sincroniza el estado REAL de cada orden desde
    //    Finity y elimina duplicados de la MISMA orden. NUNCA decide por
    //    monto (todos los envíos pueden valer lo mismo) — el estado lo
    //    dicta Finity por cada ID de orden. Ojo: 'CONFIRMED' en el momento
    //    de crear la orden significa "Finity la aceptó", NO "ya se pagó";
    //    por eso solo se marca Completado con señales fuertes de pago
    //    (completed/settled/paid/liquidada), y todo lo demás queda
    //    Pendiente hasta que Finity confirme el pago. Corrige en AMBOS
    //    sentidos: pone Completado el que ya salió, y devuelve a Pendiente
    //    el que se marcó Completado por error.
    if (action === 'reconcile_withdrawals') {
      const uid = String(caller.userId ?? '')
      if (!uid) return json(400, { error: 'missing_userId' })

      const { data: sends, error: loadErr } = await db
        .from('transactions')
        .select('id, user_id, amount, currency, status, raw_data')
        .eq('type', 'send')
        .eq('user_id', uid)
        .in('status', ['Pendiente', 'Completado'])
      if (loadErr) return json(200, { ok: false, error: loadErr.message })

      // Agrupar por ID de orden Finity (embebido en raw_data.reason, ej.
      // "Envío de dinero · Orden mvm-7393-... · CONFIRMED").
      const orderOf = (t: any): string | null => {
        const m = String(t?.raw_data?.reason ?? '').match(/Orden\s+([A-Za-z0-9_-]+)/)
        return m ? m[1] : null
      }
      const groups = new Map<string, any[]>()
      for (const t of (sends as any[]) ?? []) {
        const oid = orderOf(t)
        if (!oid) continue
        if (!groups.has(oid)) groups.set(oid, [])
        groups.get(oid)!.push(t)
      }

      const base = WORKING['withdrawalOrders'] ?? CANDIDATES.withdrawalOrders[0]
      const mapState = (raw: unknown): 'Completado' | 'Rechazado' | 'Pendiente' => {
        const s = String(raw ?? '').toLowerCase()
        // Solo señales FUERTES de pago efectivo → Completado.
        if (/complet|settle|liquidad|pagad|\bpaid\b|success|finaliz|dispersad/.test(s)) return 'Completado'
        if (/reject|rechaz|\bfail|fall|declin|cancel|anul|return|devuel|error/.test(s)) return 'Rechazado'
        return 'Pendiente' // pending, processing, created, CONFIRMED, in_progress, etc.
      }

      const results: any[] = []
      for (const [oid, rows] of groups) {
        // 1) Duplicados de la misma orden: ya NO se borran (revisión del 6 nov).
        //    Los ids son uuid y `Number(uuid)` daba NaN, así que la fila que se
        //    conservaba era cualquiera y se podía borrar la que el servidor
        //    debitó; la orden además sale de un texto que escribe el cliente.
        //    Se conserva la Completado si hay, y las demás solo se anotan.
        rows.sort((a, b) => (a.status === 'Completado' ? 0 : 1) - (b.status === 'Completado' ? 0 : 1) || String(a.id).localeCompare(String(b.id)))
        const keep = rows[0]
        const dupIds = rows.slice(1).map(r => r.id)
        if (dupIds.length) await logAudit(uid, 'finity.withdrawal.duplicados_sin_borrar', { orden: oid, conservada: keep.id, otras: dupIds })

        // 2) Estado real desde Finity.
        let realState: string | null = null
        let motivoProveedor: string | null = null
        try {
          const r = await finityFetch(`${base}/${encodeURIComponent(oid)}`)
          const d = await r.json().catch(() => null) as any
          realState = d?.state ?? d?.status ?? d?.data?.state ?? d?.data?.status ?? d?.order?.state ?? d?.order?.status ?? null
          motivoProveedor = digMotivoRechazo(d)
        } catch { /* si Finity no responde, no se toca el estado */ }
        if (realState == null) {
          results.push({ oid, kept: keep.id, deleted: dupIds.length, note: 'sin_respuesta_finity' })
          continue
        }

        const mapped = mapState(realState)
        // Un retiro Completado no vuelve atrás desde aquí: pasarlo a Pendiente
        // lo devolvía a la cola de Tesorería y podía terminar en un segundo
        // pago manual (revisión del 6 nov). Si Finity lo da por rechazado
        // después de completado, lo mira una persona.
        if (keep.status === 'Completado' && mapped !== 'Completado') {
          if (mapped === 'Rechazado') await logAudit(String(keep.user_id), 'finity.withdrawal.completado_luego_rechazado', { txId: keep.id, orden: oid, finityState: realState })
          results.push({ oid, kept: keep.id, finityState: realState, mapped, note: 'completado_no_se_baja' })
          continue
        }
        if (mapped !== keep.status) {
          if (mapped === 'Rechazado' && keep.status !== 'Rechazado') {
            // CAS ANTI DOBLE-REEMBOLSO: reclamar el rechazo+reembolso ANTES de
            // tocar el saldo. `keep.status` viene del snapshot del inicio del
            // request; dos llamadas concurrentes lo leían 'Pendiente' y ambas
            // acreditaban. Ahora solo la que gane el claim (raw_data.refunded
            // pasa de null a true, y el estado no era ya Rechazado) acredita —
            // la otra sale sin duplicar. creditBalanceAtomic es atómico por
            // llamada pero NO idempotente; el claim es lo que da idempotencia.
            const krd = (keep.raw_data ?? {}) as Record<string, unknown>
            const { data: claimed } = await db.from('transactions')
              .update({ status: 'Rechazado', raw_data: { ...krd, refunded: true, reconciledAt: new Date().toISOString(), finityState: realState, providerError: motivoProveedor } })
              .eq('id', keep.id).neq('status', 'Rechazado').filter('raw_data->>refunded', 'is', null)
              .select('id')
            // Estas filas 'send' con "Orden …" las escribía el navegador (flujo
            // viejo): cualquiera podía crear una con la orden rechazada de otro
            // y el monto que quisiera, y se le "devolvía". Ya no se reembolsa
            // solo: queda marcada para que el equipo lo revise.
            if (claimed?.length) {
              await db.from('transactions').update({ raw_data: { ...krd, refunded: null, revisionManual: true, finityState: realState, providerError: motivoProveedor } }).eq('id', keep.id)
              await logAudit(String(keep.user_id), 'finity.withdrawal.rechazado_revisar', { txId: keep.id, orden: oid, amount: keep.amount })
            }
          } else {
            await db.from('transactions').update({ status: mapped }).eq('id', keep.id)
          }
          // Disparar el correo de "pago completado/rechazado" directo (sin
          // depender del trigger de la base). notify-transaction deduplica
          // con su propio flag, así que no se manda repetido.
          try {
            const { data: full } = await db.from('transactions').select('*').eq('id', keep.id).single()
            if (full) {
              await fetch(`${SUPABASE_URL}/functions/v1/notify-transaction`, {
                method: 'POST',
                headers: await cabecerasInternas(db),
                body: JSON.stringify({ type: 'UPDATE', table: 'transactions', record: full }),
              })
            }
          } catch { /* correo best-effort */ }
        }
        console.log(`[finity-reconcile] orden ${oid}: finity="${realState}" → ${mapped} (tx ${keep.id}, ${dupIds.length} dup borrados)`)
        results.push({ oid, kept: keep.id, deleted: dupIds.length, finityState: realState, mapped })
      }

      return json(200, { ok: true, reconciled: results.length, results })
    }

    // ── Tasa de cambio en tiempo real (Exchange Rates) ──
    // Incluye `base` y `sandbox`: el convertidor NUNCA debe tratar una tasa
    // de SANDBOX (datos de prueba) como tasa Finity real.
    if (action === 'rates') {
      const qs = payload.query ? `?${new URLSearchParams(payload.query as Record<string, string>)}` : ''
      const { res, path } = await finityTry('rates', {}, qs)
      const data = await res.json().catch(() => null)
      // La tasa sale de acá YA ajustada: el cliente no ve una y se le aplica
      // otra. `rateBruta` solo viaja para el admin, que necesita ver contra
      // qué está ajustando; al cliente no le corresponde el margen.
      const aj = await leerAjuste(db)
      const bruta = extractRate(data)
      const neta = bruta != null ? aplicarAjuste(bruta, aj.finityCop) : null
      const salida = (bruta != null && neta != null && neta !== bruta && data && typeof data === 'object')
        ? { ...data, rate: neta, value: neta }
        : data
      return json(200, {
        ok: res.ok, status: res.status, path, base: FINITY_BASE,
        sandbox: FINITY_BASE !== PROD_BASE,
        data: salida,
        ajusteCop: aj.finityCop,
        // rateBruta viaja al admin y a los llamantes INTERNOS (service-role:
        // otc-mesa la necesita como precio de referencia para cotizar con su
        // propio margen). Nunca al cliente: el margen no le corresponde.
        ...(caller.internal || await esAdmin(db, caller.userId) ? { rateBruta: bruta } : {}),
      })
    }

    // ── Snapshot programado de la tasa USD→COP (para la gráfica). Pensado
    //    para llamarse por cron cada 5 min: consulta la tasa REAL de Finity
    //    y guarda un punto en fx_rate_snapshots. Solo guarda si NO es
    //    sandbox y la tasa es válida. ────────────────────────────────────
    if (action === 'snapshot_finity') {
      if (FINITY_BASE !== PROD_BASE) return json(200, { ok: false, skipped: 'sandbox' })
      const qs = `?${new URLSearchParams({ from: 'USD', to: 'COP' })}`
      const { res } = await finityTry('rates', {}, qs)
      const data = await res.json().catch(() => null)
      const rate = extractRate(data)
      if (!rate) return json(200, { ok: false, skipped: 'no_rate' })
      const { error } = await db.from('fx_rate_snapshots').insert({ from_currency: 'USD', to_currency: 'COP', rate, source: 'FINITY' })
      if (error) return json(200, { ok: false, error: error.message })
      return json(200, { ok: true, rate })
    }

    // ── LINK DE COBRO (Payment Link) — recaudo entrante ───────────────
    // POST /v0/payment-link/create { destination_amount, amount, currency,
    //   exchange_rate_id? } → 201 { id, payment_link, ..., status:UNCONFIRMED }
    // El comercio RECIBE `destination_amount` en `currency` (COP); el pagador
    // paga `amount` en el activo origen (USD). Se obtiene la tasa primero para
    // el exchange_rate_id y para calcular el monto origen. copAmount = COP a
    // recibir. Registra la transacción como Pendiente (se acredita al pago).
    if (action === 'create_payment_link') {
      const copAmount = Math.round(Number(payload.copAmount ?? payload.amount ?? 0))
      // Mínimo por cobro y costo FIJO al cliente (override por secret).
      const PAYIN_MIN_COP = Number(Deno.env.get('PAYIN_LINK_MIN_COP') ?? '100000') || 100000
      const PAYIN_FEE_COP = Number(Deno.env.get('PAYIN_LINK_FEE_COP') ?? '2500') || 2500
      if (!(copAmount >= PAYIN_MIN_COP)) return json(400, { error: 'bad_amount', message: `El monto mínimo es $${PAYIN_MIN_COP.toLocaleString('es-CO')} COP.` })
      // Contrato Finity VERIFICADO contra su respuesta real: cobro COP→COP.
      // `amount` = lo que paga quien te paga (COP). `destination_amount` es
      // requerido pero Finity lo recalcula al neto (amount − comisión − IVA).
      // No requiere tasa ni exchange_rate_id (misma moneda).
      // return_url/redirect_url: para que el botón "volver a la tienda" del
      // checkout regrese a Lincoin (no a Finity). No está en el esquema
      // documentado; si Finity lo ignora, no afecta; si lo valida estricto y
      // rechaza, se quita. Override con FINITY_RETURN_URL.
      const returnUrl = (Deno.env.get('FINITY_RETURN_URL') ?? Deno.env.get('APP_BASE_URL') ?? 'https://lincoin.me').trim().replace(/\/+$/, '')
      const body: Record<string, unknown> = {
        amount: copAmount, destination_amount: copAmount, currency: 'COP',
        return_url: returnUrl, redirect_url: returnUrl, success_url: returnUrl, cancel_url: returnUrl,
        merchant_name: 'Lincoin', store_name: 'Lincoin',
      }
      let r = await finityFetch('/v0/payment-link/create', { method: 'POST', body: JSON.stringify(body) })
      let data = await r.json().catch(() => null) as any
      // Si Finity rechaza por campos extra (return_url…), reintentar limpio.
      if (!r.ok) {
        r = await finityFetch('/v0/payment-link/create', { method: 'POST', body: JSON.stringify({ amount: copAmount, destination_amount: copAmount, currency: 'COP' }) })
        data = await r.json().catch(() => null) as any
      }
      await logAudit(caller.userId ?? null, 'finity.payment_link.create', { status: r.status, copAmount, response: data })
      const linkId = String(data?.id ?? '')
      if (!r.ok || !linkId) {
        return json(200, { ok: false, status: r.status, error: 'link_failed', message: 'No se pudo crear el cobro.', data })
      }
      // La URL del link no siempre viene en la respuesta de create → se busca
      // en varios nombres y, si falta, se consulta el cobro por su id.
      const pickLink = (o: any): string | null => o?.payment_link ?? o?.link ?? o?.url ?? o?.checkout_url ?? o?.checkoutUrl ?? o?.payment_url ?? o?.short_url ?? o?.data?.payment_link ?? o?.data?.url ?? null
      let link = pickLink(data)
      // CONFIRMAR el cobro genera la URL final (doc: Confirm payment link):
      // POST /v0/payment-link/{external_id}/confirm → { payment_link, ... }.
      // El create deja el cobro UNCONFIRMED sin URL; recién al confirmar sale.
      let confirmData: any = null
      if (!link) {
        const c = await finityFetch(`/v0/payment-link/${linkId}/confirm`, { method: 'POST', body: JSON.stringify({}) })
        confirmData = await c.json().catch(() => null)
        if (c.ok) link = pickLink(confirmData)
      }
      // Costo AL CLIENTE fijo ($2.500): recibe el bruto menos la tarifa
      // Lincoin (el costo real de Finity lo absorbe Lincoin). netCop es lo
      // que se acredita en ACH.
      const netCop = Math.max(0, copAmount - PAYIN_FEE_COP)
      const costs = data?.costs ?? null
      const uid = caller.userId ?? String(payload.user_id ?? '')
      if (uid) {
        try {
          await db.from('transactions').insert({
            // El cobro por link (recaudo Finity) se acredita en el riel ACH.
            user_id: uid, type: 'load', amount: Math.round(netCop), currency: 'COP_ACH', status: 'Pendiente',
            raw_data: { source: 'finity_payment_link', method: 'LINK', reference: linkId, providerRef: linkId,
              firmaServidor: await firmaCobro(uid, Math.round(netCop), 'COP_ACH', String(linkId ?? '')),
              link, title: 'Cobro por link · ACH', grossCop: copAmount, netCop, feeCop: PAYIN_FEE_COP, finityCosts: costs,
              expiresAt: data?.expires_at ?? null, createdAt: new Date().toISOString() },
          })
        } catch { /* el link ya se creó; el registro es best-effort */ }
      }
      return json(200, { ok: true, link, reference: linkId, status: link ? 'CONFIRMED' : (data?.status ?? 'UNCONFIRMED'),
        grossCop: copAmount, netCop, feeCop: PAYIN_FEE_COP, expiresAt: data?.expires_at ?? null,
        ...(link ? {} : { confirmResponse: confirmData }) })
    }

    // ── RECONCILIAR cobros por link: acreditar el Saldo Lincoin cuando la
    // recarga PSE aparece COMPLETADA en los movimientos de Finity. Sin
    // webhook: se cotejan los cobros 'load' Pendientes del usuario contra las
    // recargas (PSE/payment link) completadas en Finity por monto bruto y
    // recencia. Idempotente (CAS por estado).
    if (action === 'reconcile_payin') {
      const uid = caller.userId ?? String(payload.user_id ?? '')
      if (!uid) return json(400, { error: 'missing_user' })
      // Cobros pendientes de este usuario creados por link.
      const { data: pend } = await db.from('transactions')
        .select('id, amount, currency, status, raw_data, created_at')
        .eq('user_id', uid).eq('type', 'load').eq('status', 'Pendiente')
        .order('created_at', { ascending: true }).limit(20)
      // Los que quedaron en revisión manual (crédito fallido o incierto) no se
      // vuelven a acreditar solos: los resuelve un admin.
      const pending = (pend ?? []).filter((t: any) => (t.raw_data ?? {}).source === 'finity_payment_link' && !(t.raw_data ?? {}).revisionManual)
      if (!pending.length) return json(200, { ok: true, credited: 0, note: 'sin cobros pendientes' })
      // Movimientos recientes de Finity.
      const { res } = await finityTry('movements', {})
      const md: any = await res.json().catch(() => null)
      const rows: any[] = Array.isArray(md) ? md : Array.isArray(md?.data) ? md.data : Array.isArray(md?.items) ? md.items : []
      // El movimiento tiene que estar TERMINADO. Antes estas dos funciones
      // existían pero no se usaban: bastaba con que la referencia del link
      // apareciera en cualquier movimiento —también un intento de pago PSE
      // pendiente o fallido— para acreditar el cobro, y el cliente retiraba
      // plata que nunca entró. El estado se compara entero: un /complet/ suelto
      // aceptaba "INCOMPLETE".
      const ESTADOS_PAGADO = new Set(['COMPLETE', 'COMPLETED', 'COMPLETADO', 'COMPLETADA', 'SUCCESS', 'SUCCEEDED', 'SUCCESSFUL', 'PAID', 'PAGADO', 'PAGADA', 'APROBADO', 'APROBADA', 'APPROVED', 'SETTLED', 'LIQUIDADO'])
      const isDone = (m: any) => ESTADOS_PAGADO.has(String(m?.status ?? m?.state ?? '').trim().toUpperCase())
      const amountOf = (m: any) => Number(m?.origin_amount ?? m?.amount ?? m?.original_amount ?? m?.monto ?? 0)
      // La referencia tiene que ser el VALOR de un campo del movimiento, no un
      // pedazo de texto en cualquier parte del JSON.
      const traeReferencia = (o: any, ref: string, prof = 0): boolean => {
        if (!o || typeof o !== 'object' || prof > 4) return false
        for (const v of Object.values(o)) {
          if ((typeof v === 'string' || typeof v === 'number') && String(v) === ref) return true
          if (v && typeof v === 'object' && traeReferencia(v, ref, prof + 1)) return true
        }
        return false
      }
      let credited = 0
      // Un mismo movimiento REAL de Finity solo puede pagar UN cobro. Sin esto,
      // dos cobros pendientes del mismo monto (o un cobro nunca pagado + una
      // recarga real por el mismo valor) hacían match contra el MISMO
      // movimiento y se acreditaba dos veces (dinero creado de la nada).
      const consumed = new Set<string>()
      const movId = (m: any) => String(m?.id ?? m?.reference ?? m?.movement_id ?? JSON.stringify(m))
      for (const tx of pending) {
        const rd = (tx.raw_data ?? {}) as any
        // SEGURIDAD (pentest M1): SOLO se acredita si el movimiento REAL de
        // Finity referencia el id EXACTO de ESTE link de cobro. Antes también
        // hacía match por MONTO (±0.5%) contra los movimientos GLOBALES de la
        // cuenta compartida → un atacante creaba un cobro nunca pagado del
        // mismo valor y se robaba el depósito de otro. El monto ya NO basta.
        if (!rd.reference) continue
        // Solo cobros creados por este servidor, con una referencia de verdad
        // (una de 1-2 caracteres aparecía dentro de cualquier movimiento).
        if (String(rd.reference).length < 12) continue
        if (String(rd.firmaServidor ?? '') !== await firmaCobro(uid, Number(tx.amount ?? 0), String(tx.currency ?? ''), String(rd.reference))) {
          await logAudit(uid, 'finity.payin.sin_firma', { txId: tx.id })
          continue
        }
        const match = rows.find(m => {
          if (consumed.has(movId(m))) return false
          return traeReferencia(m, String(rd.reference))
        })
        if (!match) continue
        if (!isDone(match)) continue   // pendiente o fallido: todavía no hay plata
        // Lo que entró tiene que cubrir lo que se va a acreditar. Si Finity no
        // trae un monto legible, no se acredita solo: queda para el admin.
        const montoMov = amountOf(match)
        if (!(montoMov > 0) || montoMov < Number(tx.amount ?? 0)) {
          await logAudit(uid, 'finity.payin.monto_no_cuadra', { txId: tx.id, esperado: tx.amount, movimiento: montoMov, movement: match?.id ?? null })
          continue
        }
        consumed.add(movId(match))
        // CAS: reclamar la acreditación.
        const { data: claimed } = await db.from('transactions').update({
          status: 'Completado', raw_data: { ...rd, payinStatus: 'PAID', finityMovement: match?.id ?? null, paidAt: new Date().toISOString() },
        }).eq('id', tx.id).eq('status', 'Pendiente').select('id')
        if (!claimed?.length) continue
        const col = String(tx.currency ?? 'COP')
        try { await creditBalanceAtomic(uid, col, Number(tx.amount ?? 0)) }   // atómico (pentest #3)
        catch (e) {
          const msg = String((e as Error)?.message ?? e).slice(0, 200)
          // INCIERTO = se perdió la respuesta: el saldo PUDO haber subido. Se
          // deja Completado y en revisión: devolverla a Pendiente hacía que la
          // siguiente consulta del cliente la acreditara otra vez (revisión
          // del 6 nov). Un "no" claro de la base sí vuelve a Pendiente, en
          // revisión (no se reintenta sola).
          if (/incierto/i.test(msg)) {
            await db.from('transactions').update({ raw_data: { ...rd, payinStatus: 'PAID', finityMovement: match?.id ?? null, revisionManual: true, creditoIncierto: msg } }).eq('id', tx.id).eq('status', 'Completado')
            await logAudit(uid, 'finity.payin.credito_incierto', { txId: tx.id, motivo: msg })
          } else {
            await db.from('transactions').update({ status: 'Pendiente', raw_data: { ...rd, revisionManual: true, creditoFallido: msg } }).eq('id', tx.id)
            await logAudit(uid, 'finity.payin.credito_fallido', { txId: tx.id, motivo: msg })
          }
          continue
        }
        await logAudit(uid, 'finity.payin.credited', { txId: tx.id, amount: tx.amount, movement: match?.id ?? null })
        credited++
      }
      return json(200, { ok: true, credited })
    }

    // Estado de un link de cobro (para acreditar cuando el pago confirme).
    if (action === 'payment_link_status') {
      const id = String(payload.id ?? payload.reference ?? '')
      if (!id) return json(400, { error: 'missing_id' })
      if (!(await esMiReferencia(caller, id))) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      for (const p of [`/v0/payment-link/${id}`, `/v0/payment-link/status/${id}`, `/v0/payment-links/${id}`]) {
        const r = await finityFetch(p, { method: 'GET' })
        if (r.ok) return json(200, { ok: true, path: p, data: await r.json().catch(() => null) })
        if (r.status && r.status !== 404) return json(200, { ok: false, path: p, status: r.status, data: await r.json().catch(() => null) })
      }
      return json(200, { ok: false, error: 'not_found' })
    }

    // ── Conversión de divisas (Currency Conversion): USD(T) → COP ──
    // Paso 1 de la conversión (doc: Create internal conversion):
    // POST /v0/convert/internal { fromAsset, toAsset, amount, exchange_rate_id }
    // → conversión en estado UNCONFIRMED
    if (action === 'convert') {
      const { res, path } = await finityTry('convert', {
        method: 'POST',
        body: JSON.stringify(payload.data ?? {}),
      })
      const data = await res.json().catch(() => null)
      await logAudit(caller.userId!, 'finity.convert', { status: res.status, path, data: payload.data, response: data })
      return json(200, { ok: res.ok, status: res.status, path, data })
    }

    // Paso 2 (doc: Confirm internal conversion): POST /v0/convert/confirm { id }
    // 200 = SUCCESS · 400 = no confirmable o timeout (la cotización expira ~30 s)
    if (action === 'convert_confirm') {
      const id = String(payload.id ?? '')
      if (!id) return json(400, { error: 'missing_id' })
      const r = await finityFetch('/v0/convert/confirm', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
      const data = await r.json().catch(() => null)
      await logAudit(caller.userId!, 'finity.convert.confirm', { status: r.status, id, response: data })
      return json(200, { ok: r.ok, status: r.status, data })
    }

    // ── Diagnóstico: sondea TODOS los candidatos y reporta qué existe ──
    // (404 = no existe · 200/401/400/422 = el endpoint SÍ existe)
    if (action === 'discover') {
      const report: Record<string, Array<{ path: string; status: number }>> = {}
      for (const [resource, paths] of Object.entries(CANDIDATES)) {
        report[resource] = []
        for (const path of paths) {
          try {
            const r = await finityFetch(path)
            report[resource].push({ path, status: r.status })
          } catch {
            report[resource].push({ path, status: -1 })
          }
        }
      }
      return json(200, { ok: true, base: FINITY_BASE, report })
    }

    return json(400, { error: 'unknown_action', action })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    console.error('[finity] exception:', msg)
    if (msg.startsWith('finity_auth_failed')) {
      // El detalle —nombre del proveedor, su dominio, el código HTTP— se
      // queda en el log de arriba, que solo ve el equipo. Lo que viaja al
      // navegador lo lee el cliente en la mesa OTC, y ahí nombrar al
      // proveedor y su dominio es regalarlo.
      return json(200, {
        error: 'finity_auth_failed',
        message: 'No pudimos conectar con la red de pagos en este momento. Intenta de nuevo en unos minutos.',
      })
    }
    // Igual con las excepciones sueltas: el mensaje crudo puede traer la URL
    // del proveedor o su respuesta literal.
    return json(500, { error: 'internal', message: 'No pudimos completar la operación. Intenta de nuevo o escríbenos a soporte@lincoin.me.' })
  }
})

// Toda dispersión queda en el audit trail (admin_actions) — plata que sale.


// El id de una cuenta externa, venga como venga en la respuesta de Finity.
function idDeCuenta(d: any): string | null {
  const c = [d?.id, d?.external_account_id, d?.account_id, d?.account?.id, d?.data?.id, d?.data?.external_account_id, d?.data?.account?.id, d?.result?.id]
  const v = c.find(x => x != null && String(x).trim() !== '')
  return v != null ? String(v) : null
}
// ─── Protección de la ruta de cuentas externas ─────────────────────────────
// Finity bloqueó la creación de cuentas (403) después de ráfagas de llamadas.
// Tres frenos, todos del lado del servidor (el navegador de cada cliente no
// sabe lo que hacen los demás):
//   · la lista se sirve de caché 45 s para todos;
//   · antes de crear se mira si ya existe en esa lista;
//   · un 403/429 pone en pausa TODAS las creaciones 30 min (system_config),
//     y se avisa a los admins una sola vez.
let listaCache: { at: number; ok: boolean; status: number; path: string; data: any } | null = null
// `forzar` (solo llamadas internas): sin la copia de 45 s. Inscribir o borrar
// una cuenta limpia la copia SOLO de la instancia que atendió esa llamada;
// otra instancia puede seguir con la lista vieja, sin la cuenta recién
// inscrita (9 nov: «La cuenta destino no coincide con el beneficiario
// verificado» a un beneficiario nuevo). mouv-proxy la pide fresca antes de
// bloquear un envío por una cuenta que no aparece.
async function listaCuentasFinity(forzar = false): Promise<{ ok: boolean; status: number; path: string; data: any; cache: boolean }> {
  if (!forzar && listaCache && Date.now() - listaCache.at < 45_000) return { ...listaCache, cache: true }
  const { res, path } = await finityTry('externalAccounts')
  const data = await res.json().catch(() => null)
  if (res.ok) listaCache = { at: Date.now(), ok: true, status: res.status, path, data }
  return { ok: res.ok, status: res.status, path, data, cache: false }
}
function filasDe(d: any): any[] {
  if (Array.isArray(d)) return d
  for (const k of ['data', 'results', 'items', 'accounts', 'external_accounts']) if (Array.isArray(d?.[k])) return d[k]
  return []
}
const FRENO_KEY = 'finity_inscripciones_freno'
async function leerFrenoInscripciones(): Promise<{ hasta: number; http: number } | null> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', FRENO_KEY).maybeSingle()
    const v = data?.value ? JSON.parse(data.value) : null
    return v && Number(v.hasta) > Date.now() ? { hasta: Number(v.hasta), http: Number(v.http) } : null
  } catch { return null }
}
async function ponerFrenoInscripciones(http: number) {
  const ahora = Date.now()
  try {
    const { data } = await db.from('system_config').select('value').eq('key', FRENO_KEY).maybeSingle()
    const prev = data?.value ? JSON.parse(data.value) : null
    // Cada bloqueo seguido dobla la espera: 30 min, 1 h, 2 h… hasta 6 h.
    const seguidos = prev && ahora - Number(prev.hasta ?? 0) < 60 * 60_000 ? Number(prev.seguidos ?? 0) + 1 : 0
    const espera = Math.min(30 * 60_000 * 2 ** seguidos, 6 * 3600_000)
    await db.from('system_config').upsert({ key: FRENO_KEY, value: JSON.stringify({ hasta: ahora + espera, http, desde: ahora, seguidos }) }, { onConflict: 'key' })
    if (!prev || Number(prev.hasta ?? 0) < ahora) {
      await fetch(`${SUPABASE_URL}/functions/v1/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ action: 'enviar', rol: 'admin', permiso: ['plata.mover', 'tesoreria', 'fn.fallos'], titulo: 'Finity bloqueó las inscripciones', cuerpo: `Finity respondió ${http} al inscribir cuentas. Lincoin pausó los intentos ${Math.round(espera / 60000)} min. Inscríbelas a mano en el portal mientras tanto.`, tag: 'finity-freno', url: '/admin' }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {})
    }
  } catch { /* el freno es una protección; si falla, no tumba la llamada */ }
}

// ─── Inscripciones pendientes (23 nov) ───
// Hasta hoy, una cuenta ACH cuya primera inscripción fallaba (sin respuesta,
// pausa, token) solo se reintentaba cuando el CLIENTE volvía a abrir su
// pantalla de beneficiarios: el reintento corría en su navegador. Si no
// volvía, a Finity no le llegaba nunca. Ahora el servidor las busca y las
// inscribe solo (tarea programada) o cuando la mesa lo pide desde el panel.

// La misma espera que la pantalla del cliente (ESPERA_REGISTRO_MS en
// ContactsSection): un rechazo por datos se repite igual, no se insiste.
function esperaRegistroMs(http?: number | null): number {
  if (http === 400 || http === 409 || http === 422) return 6 * 3600_000
  if (http === 401 || http === 403 || http === 429) return 30 * 60_000
  return 5 * 60_000
}
function puedeReintentarRegistro(c: any): boolean {
  if (!c?.regIntentoAt) return true
  const t = new Date(c.regIntentoAt).getTime()
  return !Number.isFinite(t) || Date.now() - t >= esperaRegistroMs(Number(c.regHttp) || 0)
}

// Rechazada por un banco sin código (nuestro "no tiene código ACH" o el 400
// de Finity "financial_institution_code should not be empty") y que AHORA sí
// arma el cuerpo completo: el cruce de bancos se corrigió (23 nov, "BANCO
// DAVIVIENDA"), así que reintentar ya no da lo mismo. No espera las 6 h.
function rechazoPorBancoResuelto(c: any): boolean {
  const e = String(c?.lastError ?? '')
  if (!/no tiene código ACH|financial_institution_code/i.test(e)) return false
  return !('motivo' in cuerpoCuentaFinity(c))
}

type Pendiente = { userId: string; cliente: string; contacto: any }
// Los beneficiarios ACH de Colombia que todavía no tienen id de Finity, de
// todos los clientes. Se recorre por páginas: no se baja la base entera.
async function inscripcionesPendientes(): Promise<{ lista: Pendiente[]; truncado: boolean }> {
  const lista: Pendiente[] = []
  const PAGINA = 500, TOPE = 20_000
  for (let off = 0; off < TOPE; off += PAGINA) {
    const { data, error } = await db.from('users')
      .select('id, email, full_name, company_name, contactos:raw_data->mouvContacts')
      .order('id', { ascending: true }).range(off, off + PAGINA - 1)
    if (error) throw new Error(`No se pudieron leer los beneficiarios: ${error.message}`)
    for (const u of (data ?? []) as any[]) {
      const cs: any[] = Array.isArray(u.contactos) ? u.contactos : []
      for (const c of cs) {
        if (!esCuentaAchFinity(c) || c?.finityId || c?.mouvId) continue
        lista.push({ userId: String(u.id), cliente: String(u.company_name || u.full_name || u.email || u.id), contacto: c })
      }
    }
    if (!data || data.length < PAGINA) return { lista, truncado: false }
  }
  return { lista, truncado: true }
}

// Cambia UN contacto con lectura fresca (el cliente pudo editar su lista
// mientras tanto). Si ya tiene id de Finity (lo inscribió su pantalla en
// paralelo), no se toca.
async function actualizarContacto(userId: string, contactoId: string, cambios: Record<string, unknown>): Promise<string | null> {
  const { data } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
  const lst: any[] = Array.isArray((data as any)?.raw_data?.mouvContacts) ? (data as any).raw_data.mouvContacts : []
  let cambio = false
  const nuevo = lst.map((c: any) => {
    if (c?.id !== contactoId || c?.finityId || c?.mouvId) return c
    cambio = true
    return { ...c, ...cambios }
  })
  if (!cambio) return 'sin_cambio'
  return await mergeRaw(db, userId, { mouvContacts: nuevo })
}

// "1007" → "Bancolombia (1007)", para leer los intentos sin tabla a mano.
const nombreBancoDeCodigo = (cod: unknown): string | null => {
  const c = String(cod ?? '').trim()
  if (!c) return null
  const n = Object.keys(BANK_CODES_CO).find(k => BANK_CODES_CO[k] === c && k !== 'Nu')
  return n ? `${n} (${c})` : c
}
const enmascarar = (n: unknown) => { const d = String(n ?? '').replace(/\D/g, ''); return d ? `••••${d.slice(-4)}` : '—' }

// El motivo legible de una respuesta guardada en la auditoría.
function motivoDeRespuesta(m: any): string | null {
  if (m?.sinToken) return 'No se pudo conectar con Finity (token rechazado o sin respuesta).'
  if (m?.error) return String(m.error).slice(0, 200)
  let d: any = null
  try { d = JSON.parse(String(m?.respuesta ?? 'null')) } catch { d = null }
  if (!d) return null
  const msg = Array.isArray(d?.message) ? d.message.join(' · ') : (digMotivoRechazo(d) ?? (typeof d?.message === 'string' ? d.message : null))
  return msg ? String(msg).slice(0, 240) : null
}

async function logAudit(userId: string, action: string, metadata: Record<string, unknown>) {
  try {
    const { data: u } = await db.from('users').select('email, admin_role').eq('id', userId).maybeSingle()
    await db.from('admin_actions').insert({
      admin_id: userId,
      admin_email: (u as any)?.email ?? null,
      admin_role: (u as any)?.admin_role ?? 'business',
      action,
      target_type: 'finity',
      target_id: null,
      metadata,
    })
  } catch (e) {
    console.warn('[finity] audit log failed:', e)
  }
}
