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
//   FINITY_BASE_URL       opcional, default https://sandbox.finity.com.co
//                         (producción: https://api.finity.com.co)
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

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ADMIN_PASS     = (Deno.env.get('ADMIN_PASS') ?? '').trim()
// trim(): al pegar credenciales desde WhatsApp/correo se cuelan espacios
// o saltos de línea — y Finity rechaza el valor con basura invisible.
const FINITY_ID      = (Deno.env.get('FINITY_CLIENT_ID') ?? '').trim()
const FINITY_SECRET  = (Deno.env.get('FINITY_CLIENT_SECRET') ?? '').trim()
// Default: servidor REAL (el de la doc). El sandbox (sandbox.finity.com.co)
// devuelve datos de EJEMPLO (id placeholder, tasa inventada) — solo úsalo
// seteando FINITY_BASE_URL explícitamente para pruebas.
// ─── Servidores (doc oficial: servers[]) ───
//   Producción: https://api.finity.com.co       (tasa REAL)
//   Sandbox:    https://sandbox.finity.com.co   (datos de PRUEBA — portal)
// Modo AUTO (sin FINITY_BASE_URL): se intenta PRODUCCIÓN primero y, si
// rechaza las credenciales, se cae al sandbox. El día que Finity habilite
// las credenciales de producción, la app pasa a la tasa real SOLA.
// Si FINITY_BASE_URL está seteado, se usa ese servidor y nada más.
// (trim + sin barras finales: "https://.../" producía //v0/... → 404)
// Confirmados por la doc oficial (api-finity-docs.readme.io, OpenAPI servers):
//   Producción: https://api.finity.com.co
//   Sandbox:    https://sandbox.dev.finity.com.co  (¡lleva .dev!)
const PROD_BASE      = 'https://api.finity.com.co'
const SANDBOX_BASE   = 'https://sandbox.dev.finity.com.co'
const FINITY_BASE_ENV = (Deno.env.get('FINITY_BASE_URL') ?? '').trim().replace(/\/+$/, '')
// Servidor activo (se resuelve al obtener el primer token)
let FINITY_BASE = FINITY_BASE_ENV || PROD_BASE

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  for (const path of list) {
    const res = await finityFetch(`${path}${qs}`, init)
    last = { res, path }
    if (res.status !== 404 && res.status !== 405) {
      WORKING[resource] = path
      return last
    }
  }
  return last!
}

// ─── Token OAuth con caché en memoria (se renueva solo) ───
let tokenCache: { token: string; exp: number; base: string } | null = null

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
    // Un servidor que no responde no puede colgar el proxy entero. 6s por
    // servidor → PROD + SANDBOX peor caso ~12s, bajo el timeout del frontend
    // (22s) para que un Finity lento no dispare "tardando" en falso.
    signal: AbortSignal.timeout(6000),
  }).catch(() => null)
  if (!res) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    console.warn(`[finity] token rechazado por ${base}:`, res.status, JSON.stringify(body).slice(0, 200))
    return null
  }
  return { token: body.access_token, ttl: (Number(body.expires_in) || 300) * 1000 }
}

async function getFinityToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 30_000) {
    FINITY_BASE = tokenCache.base
    return tokenCache.token
  }
  // Con FINITY_BASE_URL fijado: solo ese servidor. Sin él (modo AUTO):
  // producción primero, sandbox de respaldo.
  const candidates = FINITY_BASE_ENV ? [FINITY_BASE_ENV] : [PROD_BASE, SANDBOX_BASE]
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

async function finityFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return finityFetchAbs(`${FINITY_BASE}${path}`, init)
}

// Igual que finityFetch pero contra una URL absoluta (para sondear el
// backend del portal prod.finity.com.co:444, que expone rutas que la API
// de socios api.finity.com.co no tiene).
async function finityFetchAbs(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getFinityToken()
  return fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(15000),
  })
}

// ─── Login del PORTAL de Finity (prod.finity.com.co:444) ───
// El saldo de la plataforma NO existe en la API de socios; solo el backend
// del portal lo expone (GET /convert/copBalance, /status…), y exige el JWT
// que devuelve su propio login (data.signed). Se inicia sesión con las
// credenciales del portal guardadas como secrets y se cachea el token.
const PORTAL_BASE     = 'https://prod.finity.com.co:444'
const PORTAL_EMAIL    = (Deno.env.get('FINITY_PORTAL_EMAIL') ?? '').trim()
// Se recorta solo un salto de línea/retorno final (típico al pegar el
// secret), NO espacios que podrían ser parte real de la contraseña.
const PORTAL_PASSWORD = (Deno.env.get('FINITY_PORTAL_PASSWORD') ?? '').replace(/[\r\n]+$/, '')

// El portal autentica las rutas de saldo con una COOKIE (no con Bearer):
//   Cookie: plentiapp-prod-server-only=<JWT>   (== data.signed del login)
const PORTAL_COOKIE_NAME = 'plentiapp-prod-server-only'
// Se cachea la cookie completa ("nombre=valor") lista para reenviar.
let portalTokenCache: { cookie: string; exp: number } | null = null
// Detalle del último intento de login (para diagnosticar en el admin).
let lastPortalLogin: { status: number | string; snippet: string } | null = null

async function getPortalToken(): Promise<string | null> {
  if (portalTokenCache && Date.now() < portalTokenCache.exp - 30_000) return portalTokenCache.cookie
  if (!PORTAL_EMAIL || !PORTAL_PASSWORD) return null
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
    signal: AbortSignal.timeout(12000),
  }).catch((e) => { lastPortalLogin = { status: 'throw', snippet: String(e).slice(0, 200) }; return null })
  if (!res) return null
  const text = await res.text().catch(() => '')
  let body: any = {}
  try { body = JSON.parse(text) } catch { /* respuesta no-JSON */ }
  lastPortalLogin = { status: res.status, snippet: text.slice(0, 300) }
  const token = body?.data?.signed ?? body?.signed ?? body?.data?.token ?? body?.data?.access_token ?? body?.access_token ?? body?.token
  if (!res.ok || !token) {
    console.warn('[finity-portal] login rechazado:', res.status, text.slice(0, 200))
    return null
  }
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
// Dos modos (mismo patrón que didit-kyc/tatum-wallet en la app Empresas):
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

async function validCaller(req: Request, payload: Record<string, unknown>): Promise<{ ok: boolean; userId?: string; internal?: boolean }> {
  const auth = req.headers.get('authorization') ?? ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return { ok: false }

  // (0) Llamada INTERNA servidor-a-servidor (mouv-proxy dispersa ACH,
  // gasfree convierte en segundo plano): se identifican con el
  // service-role key, que nunca sale del backend. `internal:true` es lo
  // ÚNICO que autoriza crear retiros/cuentas externas — el cliente pasa
  // por mouv-proxy, que debita el saldo ANTES de llamar aquí.
  if (SERVICE_KEY && jwt === SERVICE_KEY) {
    const uid = String(payload.user_id ?? '')
    return { ok: true, userId: uid || undefined, internal: true }
  }
  // Admin explícito (AdminBypass) también cuenta como interno de confianza.
  if (ADMIN_PASS && auth === `AdminBypass ${ADMIN_PASS}`) return { ok: true, internal: true }

  // (a) JWT real de Supabase. Si el usuario es admin, se marca `internal`
  // (confianza plena) para que el panel de admin pueda dejar de usar la
  // anon-key y autenticar con su propia sesión.
  const { data } = await db.auth.getUser(jwt)
  if (data?.user) {
    const { data: prof } = await db.from('users').select('role').eq('id', data.user.id).maybeSingle()
    const isAdmin = (prof as any)?.role === 'admin'
    return { ok: true, userId: data.user.id, internal: isAdmin }
  }

  // (b) anon key del proyecto + user_id existente en public.users
  if (isProjectAnonKey(jwt)) {
    const uid = String(payload.user_id ?? '')
    if (!uid) return { ok: false }
    const { data: u } = await db.from('users').select('id').eq('id', uid).maybeSingle()
    if (u) return { ok: true, userId: uid }
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
function extractRate(d: any): number | null {
  if (d == null) return null
  const cand = d.rate ?? d.value ?? d.price ?? d.cop ?? d.exchange_rate ?? d.exchangeRate
    ?? d.data?.rate ?? d.data?.value ?? d.data?.price
    ?? (Array.isArray(d) ? (d[0]?.rate ?? d[0]?.value) : undefined)
    ?? (Array.isArray(d?.data) ? (d.data[0]?.rate ?? d.data[0]?.value) : undefined)
  const n = Number(cand)
  return Number.isFinite(n) && n > 0 ? n : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })

  try {
    if (!FINITY_ID || !FINITY_SECRET) {
      return json(200, { error: 'finity_not_configured', message: 'Faltan los secrets FINITY_CLIENT_ID / FINITY_CLIENT_SECRET.' })
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
    const READ_ACTIONS = new Set(['ping', 'rates', 'discover', 'snapshot_finity'])

    const caller = await validCaller(req, payload)
    if (!caller.ok && !READ_ACTIONS.has(action)) {
      // 'proxy v3' en el mensaje: si el panel muestra 'unauthorized' pelado,
      // la función desplegada es una versión vieja.
      return json(401, { error: 'unauthorized', message: 'unauthorized (proxy v5.2)' })
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
      return json(200, { ok: true, base: FINITY_BASE, message: `Credenciales válidas — conectado a ${modo}. (proxy v5.2)` })
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

      const token = await getPortalToken()
      if (!token) {
        return json(200, {
          ok: false, usdt: null, cop: null,
          error: PORTAL_EMAIL && PORTAL_PASSWORD
            ? 'El login del portal Finity fue rechazado (revisa FINITY_PORTAL_EMAIL / FINITY_PORTAL_PASSWORD).'
            : 'Faltan credenciales del portal Finity (define los secrets FINITY_PORTAL_EMAIL y FINITY_PORTAL_PASSWORD).',
          needsPortalCreds: !(PORTAL_EMAIL && PORTAL_PASSWORD),
          loginDebug: lastPortalLogin,
          emailUsed: PORTAL_EMAIL ? `${PORTAL_EMAIL.slice(0, 3)}…@${PORTAL_EMAIL.split('@')[1] ?? ''}` : null,
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
      const { res, path } = await finityTry('externalAccounts')
      return json(200, { ok: res.ok, status: res.status, path, data: await res.json().catch(() => null) })
    }

    if (action === 'create_external_account') {
      const { res, path } = await finityTry('externalAccounts', {
        method: 'POST',
        body: JSON.stringify(payload.data ?? {}),
      })
      const data = await res.json().catch(() => null)
      await logAudit(caller.userId!, 'finity.external_account.create', { status: res.status, path, data: payload.data })
      return json(200, { ok: res.ok, status: res.status, path, data })
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
      if (!eaId && !accDigits) return json(200, { ok: false, error: 'missing_ref', message: 'Falta finityId o número de cuenta.' })

      // Guard cross-usuario: ¿alguien más (o el mismo, en otro contacto) sigue
      // teniendo esta cuenta inscrita? Se comparan finityId e igual número.
      let stillUsed = 0
      try {
        // Lincoin guarda los contactos en raw_data.mouvContacts (nombre
        // histórico); se revisa también la clave vieja finityContacts.
        const { data: rows } = await db.from('users').select('contacts:raw_data->mouvContacts, legacy:raw_data->finityContacts')
        for (const r of (rows ?? []) as any[]) {
          const list = [
            ...(Array.isArray(r?.contacts) ? r.contacts : []),
            ...(Array.isArray(r?.legacy) ? r.legacy : []),
          ]
          const used = list.some((c: any) => {
            if (c?.accountKind === 'wallet') return false
            const fid = String(c?.finityId ?? '')
            const cd = String(c?.accountNumber ?? '').replace(/\D/g, '')
            return (eaId && fid === eaId) || (accDigits && cd && cd === accDigits)
          })
          if (used) stillUsed++
        }
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
      // 404 = ya no existe en Finity → tratamos el borrado como idempotente/ok.
      const okDel = !!last && (last.res.ok || last.res.status === 404)
      await logAudit(caller.userId!, 'finity.external_account.delete', { status: last?.res.status, path: last?.path, finityId: eaId, ok: okDel })
      return json(200, { ok: okDel, deletedInFinity: okDel, status: last?.res.status, path: last?.path, data })
    }

    if (action === 'create_withdrawal') {
      // SEGURIDAD: crear un retiro mueve dinero de la cuenta Finity de la
      // empresa (una sola cuenta compartida). Solo llamadas INTERNAS de
      // confianza: mouv-proxy (service-role, que YA debitó el saldo del
      // cliente) o un admin real (JWT con role='admin' / AdminBypass). Un
      // cliente con anon-key + user_id ya NO puede drenar la tesorería.
      if (!caller.internal) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      const { res, path } = await finityTry('withdrawalOrders', {
        method: 'POST',
        body: JSON.stringify(payload.data ?? {}),
      })
      const data = await res.json().catch(() => null)
      await logAudit(caller.userId!, 'finity.withdrawal.create', { status: res.status, path, data: payload.data, response: data })
      return json(200, { ok: res.ok, status: res.status, path, data })
    }

    if (action === 'withdrawal_status') {
      const id = String(payload.id ?? '')
      if (!id) return json(400, { error: 'missing_id' })
      const base = WORKING['withdrawalOrders'] ?? CANDIDATES.withdrawalOrders[0]
      const r = await finityFetch(`${base}/${encodeURIComponent(id)}`)
      return json(200, { ok: r.ok, status: r.status, data: await r.json().catch(() => null) })
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
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-transaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            type: 'CUSTOM_EMAIL',
            to: u.email,
            subject: String(payload.subject ?? 'Lincoin'),
            title: String(payload.title ?? 'Notificación'),
            message: String(payload.message ?? ''),
          }),
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
        // 1) Deduplicar: conservar el id menor, borrar el resto (misma orden).
        rows.sort((a, b) => Number(a.id) - Number(b.id))
        const keep = rows[0]
        const dupIds = rows.slice(1).map(r => r.id)
        if (dupIds.length) await db.from('transactions').delete().in('id', dupIds)

        // 2) Estado real desde Finity.
        let realState: string | null = null
        try {
          const r = await finityFetch(`${base}/${encodeURIComponent(oid)}`)
          const d = await r.json().catch(() => null) as any
          realState = d?.state ?? d?.status ?? d?.data?.state ?? d?.data?.status ?? d?.order?.state ?? d?.order?.status ?? null
        } catch { /* si Finity no responde, no se toca el estado */ }
        if (realState == null) {
          results.push({ oid, kept: keep.id, deleted: dupIds.length, note: 'sin_respuesta_finity' })
          continue
        }

        const mapped = mapState(realState)
        if (mapped !== keep.status) {
          if (mapped === 'Rechazado' && keep.status !== 'Rechazado') {
            // Devolver saldo UNA sola vez.
            const { data: u } = await db.from('users').select('balances').eq('id', keep.user_id).single()
            if (u) {
              const bals = (u.balances as Record<string, number>) ?? {}
              const refunded = parseFloat(((Number(bals[keep.currency] ?? 0)) + Number(keep.amount)).toFixed(2))
              await db.from('users').update({ balances: { ...bals, [keep.currency]: refunded } }).eq('id', keep.user_id)
            }
          }
          await db.from('transactions').update({ status: mapped }).eq('id', keep.id)
          // Disparar el correo de "pago completado/rechazado" directo (sin
          // depender del trigger de la base). notify-transaction deduplica
          // con su propio flag, así que no se manda repetido.
          try {
            const { data: full } = await db.from('transactions').select('*').eq('id', keep.id).single()
            if (full) {
              await fetch(`${SUPABASE_URL}/functions/v1/notify-transaction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
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
      return json(200, { ok: res.ok, status: res.status, path, base: FINITY_BASE, sandbox: FINITY_BASE !== PROD_BASE, data: await res.json().catch(() => null) })
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
      const returnUrl = (Deno.env.get('FINITY_RETURN_URL') ?? Deno.env.get('APP_BASE_URL') ?? 'https://lincoln-psi.vercel.app').trim().replace(/\/+$/, '')
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
      const pending = (pend ?? []).filter((t: any) => (t.raw_data ?? {}).source === 'finity_payment_link')
      if (!pending.length) return json(200, { ok: true, credited: 0, note: 'sin cobros pendientes' })
      // Movimientos recientes de Finity.
      const { res } = await finityTry('movements', {})
      const md: any = await res.json().catch(() => null)
      const rows: any[] = Array.isArray(md) ? md : Array.isArray(md?.data) ? md.data : Array.isArray(md?.items) ? md.items : []
      const isRecarga = (m: any) => /recarga|pse|payment.?link|deposit|top.?up|cobro/i.test(JSON.stringify(m?.type ?? m?.concept ?? m?.description ?? ''))
      const isDone = (m: any) => /complet|success|paid|aprobad|settled/i.test(String(m?.status ?? m?.state ?? ''))
      const amountOf = (m: any) => Number(m?.origin_amount ?? m?.amount ?? m?.original_amount ?? m?.monto ?? 0)
      let credited = 0
      // Un mismo movimiento REAL de Finity solo puede pagar UN cobro. Sin esto,
      // dos cobros pendientes del mismo monto (o un cobro nunca pagado + una
      // recarga real por el mismo valor) hacían match contra el MISMO
      // movimiento y se acreditaba dos veces (dinero creado de la nada).
      const consumed = new Set<string>()
      const movId = (m: any) => String(m?.id ?? m?.reference ?? m?.movement_id ?? JSON.stringify(m))
      for (const tx of pending) {
        const rd = (tx.raw_data ?? {}) as any
        const gross = Number(rd.grossCop ?? tx.amount ?? 0)
        // 1) por id del link (lo más fiable) o 2) por monto bruto + completada.
        // El id del link es preferente; el monto es respaldo — y siempre se
        // exige que el movimiento NO se haya usado ya para otro cobro.
        const match = rows.find(m => {
          if (consumed.has(movId(m))) return false
          const byId = rd.reference && JSON.stringify(m).includes(String(rd.reference))
          const byAmt = isRecarga(m) && isDone(m) && Math.abs(amountOf(m) - gross) <= Math.max(2, gross * 0.005)
          return byId || byAmt
        })
        if (!match) continue
        consumed.add(movId(match))
        // CAS: reclamar la acreditación.
        const { data: claimed } = await db.from('transactions').update({
          status: 'Completado', raw_data: { ...rd, payinStatus: 'PAID', finityMovement: match?.id ?? null, paidAt: new Date().toISOString() },
        }).eq('id', tx.id).eq('status', 'Pendiente').select('id')
        if (!claimed?.length) continue
        const col = String(tx.currency ?? 'COP')
        const { data: u } = await db.from('users').select('balances').eq('id', uid).single()
        const bals: Record<string, number> = (u?.balances as any) ?? {}
        const nb = parseFloat((Number(bals[col] ?? 0) + Number(tx.amount ?? 0)).toFixed(2))
        await db.from('users').update({ balances: { ...bals, [col]: nb } }).eq('id', uid)
        await logAudit(uid, 'finity.payin.credited', { txId: tx.id, amount: tx.amount, movement: match?.id ?? null })
        credited++
      }
      return json(200, { ok: true, credited })
    }

    // Estado de un link de cobro (para acreditar cuando el pago confirme).
    if (action === 'payment_link_status') {
      const id = String(payload.id ?? payload.reference ?? '')
      if (!id) return json(400, { error: 'missing_id' })
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
      return json(200, {
        error: 'finity_auth_failed',
        base: FINITY_BASE,
        message: `Finity no entregó token contra ${FINITY_BASE} → ${msg.replace('finity_auth_failed:', 'HTTP ')}`,
      })
    }
    return json(500, { error: 'internal', message: msg })
  }
})

// Toda dispersión queda en el audit trail (admin_actions) — plata que sale.
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
