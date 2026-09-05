import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { FIELD_ENC_KEY, encField, decField, keyFp, KeyMismatchError } from '../_shared/field-crypto.ts'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ADMIN_EMAIL   = Deno.env.get('ADMIN_EMAIL')               ?? 'admin@lincoin.com'

// Service-role client: bypasses RLS on all queries
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Los comprobantes de depósito viajan como imágenes base64 dentro de
// raw_data (varios MB cada uno). Mandarlos en el listado hacía que el
// admin tardara/agotara el timeout. Se reemplazan por un marcador y el
// panel los pide uno a uno con action=get_tx_proof al abrir el detalle.
const PROOF_MARKER = '__stored__'
function slimRawData(rd: unknown, limit = 2000): unknown {
  if (!rd || typeof rd !== 'object') return rd
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rd as Record<string, unknown>)) {
    out[k] = (typeof v === 'string' && (v.startsWith('data:') || v.length > limit)) ? PROOF_MARKER : v
  }
  return out
}

// Cifrado de campos sensibles: la implementación vive en _shared para que
// NO pueda volver a haber tres copias que se desincronicen.

// ── Códigos de respaldo ───────────────────────────────────────────────────
// Se guardan HASHEADOS (SHA-256), no cifrados. Un hash no depende de ninguna
// llave, así que aunque FIELD_ENC_KEY cambie o se pierda, estos códigos
// SIEMPRE siguen sirviendo para entrar. Es la red que faltaba: hasta ahora la
// única vía de acceso dependía de una llave reversible.
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // sin O/0/I/1
function normalizeBackup(c: string): string {
  return String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
async function hashBackup(code: string): Promise<string> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lincoin-backup:' + normalizeBackup(code)))
  return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function newBackupCodes(n = 8): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const s = Array.from(bytes).map(b => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join('')
    out.push(s.slice(0, 4) + '-' + s.slice(4))
  }
  return out
}

// TOTP nativo (SHA1/6/30, ventana ±2) — para verificar el 2FA en el servidor.
function base32Decode(s: string): Uint8Array {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(s ?? '').replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0, value = 0; const out: number[] = []
  for (const ch of clean) {
    const idx = alph.indexOf(ch); if (idx < 0) continue
    value = (value << 5) | idx; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return new Uint8Array(out)
}
// Devuelve el CONTADOR de la ventana que acertó, o -1 si ninguna. Se
// necesita el número (no un booleano) para rechazar el mismo código usado
// dos veces: un código sigue siendo válido ~2,5 min, y en ese rato alguien
// que lo vio por encima del hombro o lo capturó podía reutilizarlo.
async function verifyTOTPServer(secret: string, token: string): Promise<number> {
  const code = String(token ?? '').replace(/\D/g, '')
  if (code.length !== 6) return -1
  const key = base32Decode(secret); if (!key.length) return -1
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  for (let w = -2; w <= 2; w++) {
    const counter = Math.floor(now / 30) + w
    const b = new ArrayBuffer(8); const dv = new DataView(b)
    dv.setUint32(0, Math.floor(counter / 0x100000000)); dv.setUint32(4, counter >>> 0)
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', ck, b))
    const off = hmac[hmac.length - 1] & 0x0f
    const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]
    if ((bin % 1000000).toString().padStart(6, '0') === code) return counter
  }
  return -1
}

// ── 2FA REAL: verificada en el SERVIDOR, no solo en la pantalla ───────────
// El 2FA se pedía únicamente en la interfaz. El servidor solo miraba
// "¿JWT válido + role='admin'?", así que quien tuviera la CONTRASEÑA podía
// pedir un token con signInWithPassword y llamar a las acciones sensibles
// directamente, sin pasar jamás por el código de 6 dígitos.
//
// Ahora, al verificar el 2FA se anota la SESIÓN que lo hizo, y las acciones
// sensibles exigen que la sesión que llama sea una de esas. El id de sesión
// viaja dentro del JWT firmado por Supabase: no se puede inventar ni quitar
// sin invalidar la firma, que getUser() ya comprobó.
const MFA_SESSION_TTL_MS = 24 * 3600 * 1000

function sessionIdOf(req: Request): string | null {
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    const part = jwt.split('.')[1]
    if (!part) return null
    const pad = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))
    return payload?.session_id ?? null
  } catch { return null }
}

async function rememberMfaSession(req: Request, userId: string) {
  const sid = sessionIdOf(req)
  if (!sid) return
  try {
    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
    const raw = { ...((u as any)?.raw_data ?? {}) }
    const list: any[] = Array.isArray(raw.mfaSessions) ? raw.mfaSessions : []
    const rest = list.filter((x: any) => x?.sid !== sid)
    raw.mfaSessions = [{ sid, at: new Date().toISOString() }, ...rest].slice(0, 5)
    await db.from('users').update({ raw_data: raw }).eq('id', userId)
  } catch { /* si no se puede anotar, la acción sensible pedirá 2FA de nuevo */ }
}

// Devuelve un mensaje de error si la sesión que llama NO pasó por el 2FA.
// null = puede continuar.
async function requireMfaSession(req: Request, userId: string | undefined): Promise<string | null> {
  if (!userId) return null
  try {
    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
    const raw = (u as any)?.raw_data ?? {}
    // Cuenta sin 2FA activo → nada cambia respecto a antes. El 2FA se activa
    // desde el panel; no se le puede exigir a quien todavía no lo tiene.
    if (!raw.mfaEnabled) return null
    const sid = sessionIdOf(req)
    // Token sin claim de sesión (GoTrue antiguo): no se puede distinguir, y
    // bloquear aquí dejaría al admin sin panel. No es forjable de todos modos.
    if (!sid) return null
    const list: any[] = Array.isArray(raw.mfaSessions) ? raw.mfaSessions : []
    const hit = list.find((x: any) => x?.sid === sid)
    if (!hit) return 'Esta sesión no verificó el segundo factor. Vuelve a iniciar sesión e ingresa tu código.'
    if (Date.now() - new Date(hit.at).getTime() > MFA_SESSION_TTL_MS) {
      return 'La verificación en dos pasos de esta sesión venció. Vuelve a iniciar sesión.'
    }
    return null
  } catch { return null }
}

// Exige el código 2FA del admin para ESTA operación concreta (no basta con
// que la sesión lo haya pasado al entrar). Se usa en el cargue: mueve dinero
// real y queda con contabilidad, así que se confirma una por una.
async function requireAdminOtp(adminUserId: string | undefined, code: unknown): Promise<string | null> {
  if (!adminUserId) return 'No se pudo identificar al administrador.'
  const otp = String(code ?? '').replace(/\D/g, '')
  const { data: u } = await db.from('users').select('raw_data').eq('id', adminUserId).single()
  const raw = ((u as any)?.raw_data ?? {}) as Record<string, any>
  if (!raw.mfaEnabled) return 'Activa tu 2FA en Seguridad para poder hacer cargues. Sin segundo factor no se autoriza mover saldo.'
  if (otp.length !== 6) return 'Falta tu código de 6 dígitos.'
  let secret = ''
  try { secret = raw.totpSecretEnc ? await decField(String(raw.totpSecretEnc)) : String(raw.totpSecret ?? '') } catch { secret = '' }
  if (!secret) return 'No se pudo leer tu segundo factor. Reactiva el 2FA en Seguridad.'
  const counter = await verifyTOTPServer(secret, otp)
  if (counter < 0) return 'Código incorrecto o vencido.'
  const last = Number(raw.mfaLastCounter ?? -1)
  if (Number.isFinite(last) && counter <= last) return 'Ese código ya se usó. Espera al siguiente que muestre tu app.'
  await db.from('users').update({ raw_data: { ...raw, mfaLastCounter: counter } }).eq('id', adminUserId)
  return null
}

// ── Contabilidad de un cargue ─────────────────────────────────────────────
// El COP que se le acredita al cliente NO se escribe a mano: se DERIVA de la
// operación real, y el servidor rehace la cuenta (nunca confía en los números
// que llegan de la pantalla).
//
//   usdtGross  → lo que envió el cliente
//   usdtNet    → lo que llegó de verdad al proveedor
//   feeUsdt    → la diferencia: el costo de red/proveedor
//   sellRate   → a cómo se vendieron esos USDT (COP por USDT)
//   clientRate → a cómo se le paga al cliente (COP por USDT)
//   feeBearer  → quién asume el fee: 'lincoin' (se le paga al cliente sobre
//                lo que envió) o 'cliente' (se le paga sobre lo que llegó)
type Acct = {
  usdtGross: number; usdtNet: number; feeUsdt: number
  sellRate: number; clientRate: number; feeBearer: 'lincoin' | 'cliente'
  revenueCop: number; copToClient: number; feeCostCop: number
}
function computeAcct(input: any): { acct: Acct } | { error: string } {
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : NaN }
  const usdtGross = n(input?.usdtGross)
  const usdtNet = n(input?.usdtNet)
  const sellRate = n(input?.sellRate)
  const clientRate = n(input?.clientRate)
  const feeBearer: 'lincoin' | 'cliente' = input?.feeBearer === 'cliente' ? 'cliente' : 'lincoin'
  if (!(usdtGross > 0)) return { error: 'Falta cuántos USDT envió el cliente.' }
  if (!(usdtNet > 0)) return { error: 'Falta cuántos USDT llegaron al proveedor.' }
  if (usdtNet > usdtGross + 0.000001) return { error: 'Al proveedor no pueden llegar más USDT de los que envió el cliente.' }
  if (!(sellRate > 0)) return { error: 'Falta la tasa a la que vendiste los USDT.' }
  if (!(clientRate > 0)) return { error: 'Falta la tasa a la que le pagas al cliente.' }
  const feeUsdt = Number((usdtGross - usdtNet).toFixed(6))
  const baseCliente = feeBearer === 'lincoin' ? usdtGross : usdtNet
  return {
    acct: {
      usdtGross, usdtNet, feeUsdt, sellRate, clientRate, feeBearer,
      // Lo que ENTRA: solo se vendió lo que de verdad llegó.
      revenueCop: Math.round(usdtNet * sellRate),
      // Lo que se le paga al cliente, antes de la comisión del riel.
      copToClient: Math.round(baseCliente * clientRate),
      // El fee de red valorado a la tasa de venta: lo que costó en pesos.
      feeCostCop: Math.round(feeUsdt * sellRate),
    },
  }
}

// ── Seguridad de acceso: IP, geolocalización y bloqueo ────────────────────
function ipOf(req: Request): string | null {
  const fwd = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return fwd || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || null
}

// Geolocalización aproximada por IP. IMPORTANTE: una IP da CIUDAD/REGIÓN como
// mucho — normalmente la del nodo del operador, no la del edificio. No es una
// dirección exacta y no debe presentarse como tal.
type Geo = { city?: string; region?: string; country?: string; org?: string; approx?: string }
const GEO_CACHE_KEY = 'ip_geo_cache'
async function geoOf(ip: string | null): Promise<Geo | null> {
  if (!ip || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return null
  try {
    const { data } = await db.from('system_config').select('value').eq('key', GEO_CACHE_KEY).single()
    const cache = data?.value ? JSON.parse(data.value) : {}
    if (cache[ip]) return cache[ip]
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2500)
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctl.signal }).then(x => x.json()).catch(() => null)
    clearTimeout(t)
    if (!r?.success) return null
    const geo: Geo = {
      city: r.city ?? undefined, region: r.region ?? undefined, country: r.country ?? undefined,
      org: r.connection?.isp ?? undefined,
      approx: [r.city, r.region, r.country].filter(Boolean).join(', ') || undefined,
    }
    // Caché acotada: evita pegarle al servicio por cada evento repetido.
    const keys = Object.keys(cache)
    if (keys.length > 250) for (const k of keys.slice(0, 100)) delete cache[k]
    cache[ip] = geo
    await db.from('system_config').upsert({ key: GEO_CACHE_KEY, value: JSON.stringify(cache) }, { onConflict: 'key' })
    return geo
  } catch { return null }
}

const BLOCKED_IPS_KEY = 'blocked_ips'
type BlockedIp = { ip: string; at: string; reason: string; attempts: number; geo?: Geo | null }
async function blockedIps(): Promise<BlockedIp[]> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', BLOCKED_IPS_KEY).single()
    return data?.value ? JSON.parse(data.value) : []
  } catch { return [] }
}
async function saveBlockedIps(list: BlockedIp[]) {
  await db.from('system_config').upsert({ key: BLOCKED_IPS_KEY, value: JSON.stringify(list.slice(0, 500)) }, { onConflict: 'key' })
}
async function isIpBlocked(req: Request): Promise<boolean> {
  const ip = ipOf(req)
  if (!ip) return false
  return (await blockedIps()).some(b => b.ip === ip)
}

async function verifyAdmin(req: Request): Promise<{ ok: boolean; error?: string; userId?: string }> {
  const authHeader = req.headers.get('Authorization') ?? ''

  // Identidad de admin SOLO por JWT real de Supabase (role='admin'). Se eliminó
  // el esquema "AdminBypass <password>": esa contraseña compartida viajaba en el
  // bundle público del frontend (VITE_ADMIN_PASSWORD) y cualquiera podía
  // extraerla y tomar control total. El admin entra con su cuenta real.
  const jwt = authHeader.replace('Bearer ', '').trim()
  if (!jwt) return { ok: false, error: 'No authorization token' }

  try {
    const authResult = await Promise.race([
      db.auth.getUser(jwt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('auth_timeout')), 3000)),
    ])
    const { data: { user }, error: authErr } = authResult as any
    if (authErr || !user) return { ok: false, error: 'Invalid or expired token' }
    // El rol SOLO sale de la tabla. Antes bastaba con que el correo del token
    // fuera ADMIN_EMAIL para conceder admin AUNQUE la fila no tuviera
    // role='admin' — es decir, quitarle el rol a esa cuenta en la base no le
    // quitaba nada. La identidad y el permiso deben venir de la misma fuente.
    const { data: profile } = await db.from('users').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return { ok: false, error: 'Forbidden: admin only' }
    return { ok: true, userId: user.id }
  } catch {
    return { ok: false, error: 'Auth check failed' }
  }
}

// Auditoría DURABLE de acciones sensibles del admin (borrado de cuentas, etc.).
// Antes un borrado no dejaba rastro en la app: solo en los logs de Supabase,
// que CADUCAN. Ahora queda para siempre en audit_log con quién, cuándo e IP.
async function auditAdmin(req: Request, action: string, metadata: Record<string, unknown>) {
  try {
    let byEmail: string | null = null, byId: string | null = null
    try {
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
      if (jwt) { const { data } = await db.auth.getUser(jwt); byEmail = data?.user?.email ?? null; byId = data?.user?.id ?? null }
    } catch { /* sin identidad */ }
    const ip = ipOf(req)
    const userAgent = req.headers.get('user-agent') ?? null
    // Ubicación aproximada por IP (ciudad/región), cacheada. Nunca bloquea:
    // si el servicio no responde, el evento se guarda igual sin geo.
    const geo = await geoOf(ip)
    await db.from('audit_log').insert({ user_id: byId, action, metadata: { ...metadata, byEmail, ip, geo, userAgent, hadSession: !!byEmail, at: new Date().toISOString() } })
  } catch { /* best-effort — nunca romper la operación */ }
}

// true si quien llama es admin, O si su JWT resuelve al MISMO userId que
// pide la acción (para insert_transaction: cualquier cliente puede
// insertar SU PROPIA transacción, nunca la de otro).
async function verifySelfOrAdmin(req: Request, userId: string): Promise<boolean> {
  if ((await verifyAdmin(req)).ok) return true
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    return user?.id === userId
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Ping SIN auth: para verificar qué versión está desplegada desde el
    // navegador. No expone ningún dato.
    const pingUrl = new URL(req.url)
    if (pingUrl.searchParams.get('action') === 'ping') {
      return json({ ok: true, version: 'admin-data v4 (slim + ping)' })
    }

    // ⚠️ El body se parsea ANTES del gate de admin — 'delete_self' e
    // 'insert_transaction' son deliberadamente self-service (cualquier
    // usuario autenticado puede borrar SU PROPIA cuenta o insertar SU
    // PROPIA transacción), y cada una hace su propia verificación interna
    // (self o admin). Antes el gate de admin corría primero e
    // incondicionalmente, así que un usuario normal (no-admin) que
    // llamara 'delete_self' recibía 401 sin llegar nunca a esa lógica —
    // quedaba efectivamente inalcanzable para quien de verdad la necesita.
    let selfServiceBody: any = null
    if (req.method === 'POST') {
      selfServiceBody = await req.json().catch(() => ({}))

      // ── Intento de ingreso FALLIDO ────────────────────────────────────
      // Va SIN autenticación a propósito: quien falla el login justamente no
      // tiene sesión. Solo escribe en auditoría; no devuelve ningún dato.
      // Al 3.er fallo desde la misma IP en una hora, la IP queda bloqueada.
      if (selfServiceBody.action === 'log_failed_login') {
        const ip = ipOf(req)
        const email = String(selfServiceBody.email ?? '').slice(0, 120)
        const reason = String(selfServiceBody.reason ?? 'credenciales').slice(0, 60)
        let blocked = false
        if (!ip) await auditAdmin(req, 'auth.failed_login', { email, reason })
        if (ip) {
          const sinceH = new Date(Date.now() - 3600_000).toISOString()
          const { data: recent } = await db.from('audit_log').select('metadata, created_at')
            .eq('action', 'auth.failed_login').gte('created_at', sinceH).limit(200)
          const fails = (recent ?? []).filter((r: any) => r?.metadata?.ip === ip).length
          // Tope de escritura: este endpoint es público, así que sin un límite
          // se le podía inundar la auditoría a punta de peticiones. Pasado el
          // tope la IP ya está bloqueada y no hace falta seguir anotando.
          if (fails < 40) await auditAdmin(req, 'auth.failed_login', { email, reason })
          if (fails >= 3) {
            const list = await blockedIps()
            if (!list.some(b => b.ip === ip)) {
              list.unshift({ ip, at: new Date().toISOString(), reason: `${fails} intentos fallidos en 1 h`, attempts: fails, geo: await geoOf(ip) })
              await saveBlockedIps(list)
              await auditAdmin(req, 'auth.ip_blocked', { ip, attempts: fails, email })
            }
            blocked = true
          }
        }
        return json({ ok: true, blocked })
      }

      // ¿Esta SESIÓN ya superó el 2FA? Lo decide el servidor, no una marca
      // del navegador. La app guardaba 'mfa_ok' en sessionStorage y confiaba
      // en ella al restaurar: escribirla a mano en la consola abría el panel
      // sin código. Ahora esa marca solo sirve de pista y la respuesta buena
      // sale de aquí — el id de sesión viaja firmado dentro del JWT.
      if (selfServiceBody.action === 'mfa_session_ok' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const err = await requireMfaSession(req, String(selfServiceBody.userId))
        return json({ ok: true, verified: !err })
      }

      // Consulta previa al login: dice si esta IP está bloqueada. Sirve para
      // frenar el intento en la pantalla; el bloqueo DURO vive en las acciones
      // que mueven dinero, que es donde importa.
      if (selfServiceBody.action === 'login_gate') {
        return json({ ok: true, blocked: await isIpBlocked(req) })
      }

      // Insertar la PROPIA transacción — la RLS de public.transactions solo
      // deja insertar a admins (tx_insert_admin), así que un cliente normal
      // nunca podía crear su registro de envío/depósito/conversión: el
      // insert fallaba en silencio y la fila optimista se quedaba en
      // memoria del navegador para siempre, sin existir de verdad en la DB.
      if (selfServiceBody.action === 'insert_transaction' && selfServiceBody.tx?.user_id) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.tx.user_id))) return json({ error: 'No autorizado' }, 401)
        let txRow = selfServiceBody.tx
        // Un no-admin NO puede forjar filas que OTROS procesos leen para mover
        // saldo: dispersion+providerRef dispara un reembolso vía reconcile, y
        // rail_move Pendiente lo aprueba el admin acreditando el riel. Se
        // BLOQUEAN esos tipos server-authored y se neutralizan los campos
        // sensibles del raw_data. Los tipos informativos del cliente (load,
        // send, convert, pay_*) siguen permitidos — la app los inserta así.
        if (!(await verifyAdmin(req)).ok) {
          const BLOCKED_TYPES = new Set(['dispersion', 'rail_move', 'breb_move', 'adjustment', 'referral_payout', 'admin_hot_withdrawal', 'fee_income', 'internal'])
          if (BLOCKED_TYPES.has(String(txRow.type))) return json({ error: 'Tipo de movimiento no permitido' }, 403)
          const rd = { ...(txRow.raw_data ?? {}) }
          for (const k of ['providerRef', 'refunded', 'fromRail', 'toRail', 'gasfreeCredited', 'convertPhase', 'needsReview']) delete (rd as any)[k]
          txRow = { ...txRow, raw_data: rd }
        }
        const { data: inserted, error: insErr } = await db.from('transactions').insert(txRow).select('id').single()
        if (insErr) return json({ error: insErr.message }, 500)
        return json({ success: true, id: inserted?.id })
      }

      // Guarda el PROPIO perfil (o el de otro, si quien llama es admin) con
      // el service-role key. Fallback de saveUser() en el cliente: pasa
      // exactamente lo mismo que con insert_transaction — si el upsert
      // directo falla (RLS, sesión sin JWT real, etc.), el saldo/perfil
      // solo quedaba en memoria de esa pestaña y nunca llegaba a la fila
      // real. No agrega ningún permiso nuevo: un usuario con JWT real ya
      // puede escribir su propia fila de todas formas vía RLS
      // (auth.uid()=id) — esto solo la deja llegar cuando ese camino falla.
      if (selfServiceBody.action === 'save_user' && selfServiceBody.user?.id) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.user.id))) return json({ error: 'No autorizado' }, 401)
        // El upsert corre con service-role (la RLS no aplica). Si el caller NO
        // es admin se SANEAN los valores de escalación: role solo puede ser
        // personal/business (nunca 'admin'), kyc_status nunca puede quedar
        // aprobado/verificado por el propio usuario (eso lo fija el flujo KYC
        // server-side), y se quitan flags de bloqueo/límites. El onboarding
        // legítimamente fija role=personal/business y kyc_status=pending/
        // in_review, así que esos SÍ pasan. Balances no se tocan: el flujo
        // legacy de retiro del cliente aún los persiste por esta vía.
        const userRow = { ...selfServiceBody.user }
        if (!(await verifyAdmin(req)).ok) {
          if (userRow.role != null && !['personal', 'business'].includes(String(userRow.role))) delete (userRow as any).role
          if (userRow.kyc_status != null && !['pending', 'in_review', 'not_started', 'incomplete', 'rejected'].includes(String(userRow.kyc_status))) delete (userRow as any).kyc_status
          for (const k of ['is_blocked', 'is_admin', 'limits', 'status']) delete (userRow as any)[k]

          // ── CANDADO ANTI AUTO-CRÉDITO (CRÍTICO 2) ──────────────────────────
          // Un usuario NO puede SUBIRSE el saldo por esta vía (sería inflar
          // dinero que no existe y luego retirarlo). Se permite BAJARLO (el
          // flujo legacy de retiro debita por aquí). Los aumentos legítimos
          // (conversiones) van por apply_conversion, que valida la tasa. Se
          // reconstruye cada columna de saldo tomando el valor de la base y
          // aplicando SOLO las bajadas del cliente; cualquier subida se ignora.
          if (userRow.balances != null || userRow.crypto_balances != null) {
            const { data: cur } = await db.from('users').select('balances, crypto_balances').eq('id', selfServiceBody.user.id).maybeSingle()
            const clampNoIncrease = (incoming: Record<string, any> | null | undefined, current: Record<string, any> | null | undefined) => {
              const base: Record<string, number> = { ...((current && typeof current === 'object') ? current : {}) }
              if (incoming && typeof incoming === 'object') {
                for (const [k, v] of Object.entries(incoming)) {
                  const nv = Number(v), cv = Number(base[k] ?? 0)
                  // Solo se acepta si NO aumenta (baja o igual). Subidas → se
                  // conserva el valor real de la base.
                  if (isFinite(nv) && nv <= cv + 1e-9) base[k] = nv
                }
              }
              return base
            }
            if (userRow.balances != null)        userRow.balances        = clampNoIncrease(userRow.balances, (cur as any)?.balances)
            if (userRow.crypto_balances != null) userRow.crypto_balances = clampNoIncrease(userRow.crypto_balances, (cur as any)?.crypto_balances)
          }
        }
        // ── BLINDAJE server-side de campos que administra SOLO el servidor ──
        // La wallet GasFree (índice/dirección/contador), el 2FA (TOTP) y el OTP
        // NUNCA se cambian por save_user — se toman SIEMPRE de la base. Así
        // ningún guardado de perfil/contactos (ni un cliente con bug, ni una
        // sesión sin JWT) puede deshabilitar el 2FA ni mover la wallet. El 2FA
        // solo cambia por las acciones dedicadas (mfa_set / mfa_disable).
        if (userRow.raw_data !== undefined) {
          const { data: curRaw } = await db.from('users').select('raw_data').eq('id', selfServiceBody.user.id).maybeSingle()
          const dbRaw = (((curRaw as any)?.raw_data) ?? {}) as Record<string, any>
          const incoming = ((userRow as any).raw_data ?? {}) as Record<string, any>
          const SERVER_OWNED = ['gasfreeIndex', 'gasfreeHdIndex', 'gasfreeAddress', 'gasfreeEoa', 'gasfreeAddresses', 'gasfreeCredited', 'gasfreeCreditedTxs', 'gasfreeCreditedCount', 'mfaEnabled', 'mfaFactorId', 'totpSecret', 'totpSecretEnc', 'mfaBackupHashes', 'mfaSessions', 'mfaLastCounter', 'otp', 'subWallets']
          const merged: Record<string, any> = { ...dbRaw, ...incoming }
          for (const k of SERVER_OWNED) { if (k in dbRaw) merged[k] = dbRaw[k]; else delete merged[k] }
          // COLECCIONES del cliente (contactos, wallets, notificaciones): tienen
          // su propio escritor DIRIGIDO (updateUserRawData manda solo esa clave).
          // Un guardado de PERFIL COMPLETO no debe reescribirlas desde una copia
          // vieja (multi-dispositivo) → se BORRABAN los contactos. Se detecta el
          // "perfil completo" porque trae columnas de perfil (email/nombre/
          // balances); un patch dirigido solo trae {id, raw_data}. Solo en el
          // perfil completo se fuerzan estas colecciones desde la base.
          const isFullProfileSave = userRow.email !== undefined || userRow.full_name !== undefined || userRow.balances !== undefined || userRow.kyc_status !== undefined
          if (isFullProfileSave) {
            const CLIENT_COLLECTIONS = ['mouvContacts', 'walletContacts', 'notifications', 'notifiedEvents']
            for (const k of CLIENT_COLLECTIONS) { if (k in dbRaw) merged[k] = dbRaw[k]; else delete merged[k] }
          }
          ;(userRow as any).raw_data = merged
        }
        const { error: saveErr } = await db.from('users').upsert(userRow)
        if (saveErr) return json({ error: saveErr.message }, 500)
        return json({ success: true })
      }

      // ── Conversión SERVER-AUTORITATIVA (anti auto-crédito) ───────────────
      // Aplica DELTAS (nunca saldos absolutos del cliente), valida sin
      // sobregiro y que el monto recibido sea PLAUSIBLE según la tasa real
      // (fx_rate_snapshots). Así el cliente no puede pedir "convierte $1 →
      // $1.000.000" ni escribirse un saldo arbitrario. Enruta cripto vs fiat
      // a su columna correcta.
      if (selfServiceBody.action === 'apply_conversion' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const userId = String(selfServiceBody.userId)
        const src = String(selfServiceBody.src ?? '')
        const tgt = String(selfServiceBody.tgt ?? '')
        const amtS = Number(selfServiceBody.amtS)
        const amtT = Number(selfServiceBody.amtT)
        const fee  = Number(selfServiceBody.fee ?? 0)
        if (!/^[A-Z0-9_]+$/i.test(src) || !/^[A-Z0-9_]+$/i.test(tgt) || src === tgt ||
            !isFinite(amtS) || !isFinite(amtT) || amtS <= 0 || amtT <= 0) {
          return json({ error: 'Parámetros de conversión inválidos' }, 400)
        }
        const CRYPTO = new Set(['USDT', 'USDC', 'ETH', 'BNB', 'TRX', 'USDT_BSC', 'USDT_TRON', 'USDC_BSC', 'USDC_BASE', 'USDC_MATIC'])
        const { data: u } = await db.from('users').select('balances, crypto_balances').eq('id', userId).single()
        if (!u) return json({ error: 'Usuario no encontrado' }, 404)
        const fiat: Record<string, number> = { ...((u as any).balances ?? {}) }
        const cry:  Record<string, number> = { ...((u as any).crypto_balances ?? {}) }
        const bal = (k: string) => Number((CRYPTO.has(k) ? cry[k] : fiat[k]) ?? 0)
        const setBal = (k: string, v: number) => { if (CRYPTO.has(k)) cry[k] = v; else fiat[k] = v }
        if (bal(src) + 1e-9 < amtS) return json({ error: 'Saldo insuficiente' }, 400)

        // Plausibilidad del monto recibido según la tasa real.
        const baseOf = (k: string) => (/^USD/.test(k) || k === 'USD') ? 'USD' : /^COP/.test(k) ? 'COP' : /^EUR/.test(k) ? 'EUR' : k
        const bS = baseOf(src), bT = baseOf(tgt)
        let expected: number | null = null
        if (bS === bT) {
          // Mover ENTRE RIELES COP (Saldo Lincoin ↔ ACH ↔ Bre-B) a 1:1 por aquí
          // saltaría el respaldo por riel (arbitraje de un riel sin fondos a uno
          // retirable). Eso va por el flujo "Mover saldo" (rail_move, con
          // aprobación/respaldo). Aquí solo se permite 1:1 cuando es la MISMA
          // moneda exacta o un cash-out de dólar digital (USDT ↔ USD).
          if (bS === 'COP' && src !== tgt) {
            return json({ error: 'Para mover saldo entre rieles COP usa la opción "Mover saldo", no la conversión.' }, 400)
          }
          expected = amtS // 1:1 (ej. dólar digital ↔ cuenta USD)
        } else {
          const { data: snaps } = await db.from('fx_rate_snapshots')
            .select('from_currency, to_currency, rate, captured_at')
            .or(`and(from_currency.eq.${bS},to_currency.eq.${bT}),and(from_currency.eq.${bT},to_currency.eq.${bS})`)
            .order('captured_at', { ascending: false }).limit(1)
          const row: any = (snaps ?? [])[0]
          if (row && Number(row.rate) > 0) {
            expected = row.from_currency === bS ? amtS * Number(row.rate) : amtS / Number(row.rate)
          }
        }
        // Con fx_rate_snapshots ya bloqueada a solo-admin, la tasa es de fiar.
        // Si NO hay tasa para el par (y no es 1:1 misma base), se RECHAZA — ya
        // no hay banda amplia de respaldo que se pudiera abusar.
        if (expected == null) {
          return json({ error: 'No hay tasa vigente para esa conversión. Intenta más tarde.' }, 400)
        }
        // El monto RECIBIDO nunca puede superar el justo (una conversión real
        // cobra comisión → recibes MENOS o igual). Antes el tope multiplicativo
        // (1.001×) dejaba una micro-ganancia que, en ida y vuelta, se componía
        // y acuñaba dinero. Ahora el tope es `expected` con un epsilon ABSOLUTO
        // mínimo (por redondeo de floats), así una conversión nunca deja más de
        // lo enviado a la tasa. El piso 0.60 permite comisiones de hasta ~40%.
        const absEps = Math.max(1, expected * 1e-6)
        if (!(amtT >= expected * 0.60 && amtT <= expected + absEps)) {
          return json({ error: 'El monto de la conversión no coincide con la tasa vigente.' }, 400)
        }

        // Aplicar los deltas de forma ATÓMICA (bloqueo de fila) para evitar la
        // carrera de duplicación con otra operación concurrente. Fallback a la
        // escritura del objeto completo si la RPC aún no está desplegada.
        const fiatD: Record<string, number> = {}; const cryD: Record<string, number> = {}
        const addD = (k: string, v: number) => { const o = CRYPTO.has(k) ? cryD : fiatD; o[k] = (o[k] ?? 0) + v }
        addD(src, -amtS); addD(tgt, amtT)
        const { data: adj, error: adjErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: fiatD, p_crypto: cryD })
        if (!adjErr) {
          if ((adj as any)?.error) {
            return json({ error: (adj as any).error === 'insufficient' ? 'Saldo insuficiente' : 'No se pudo aplicar la conversión.' }, 400)
          }
        } else {
          setBal(src, Number((bal(src) - amtS).toFixed(8)))
          setBal(tgt, Number((bal(tgt) + amtT).toFixed(8)))
          const { error: upErr } = await db.from('users').update({ balances: fiat, crypto_balances: cry }).eq('id', userId)
          if (upErr) return json({ error: upErr.message }, 500)
        }

        let txId: number | null = null
        try {
          const { data: ins } = await db.from('transactions').insert({
            user_id: userId, type: 'convert', amount: amtS, currency: src, status: 'Completado',
            raw_data: { initials: 'CV', title: `${src} a ${tgt}`, targetAmount: amtT, targetCurrency: tgt, destCurrency: tgt, fee, couponCode: selfServiceBody.coupon ?? null, createdAt: new Date().toISOString() },
          }).select('id').single()
          txId = (ins as any)?.id ?? null
        } catch { /* best-effort */ }
        return json({ success: true, id: txId, balances: { ...fiat, ...cry } })
      }

      // ── Resolver un código de referido a { id, name } para un pago P2P.
      //    Lo puede pedir CUALQUIER usuario autenticado (no expone saldos ni
      //    PII). Reemplaza el escaneo cliente de toda la tabla users, que la
      //    RLS estricta deja de permitir a los no-admin. ─────────────────────
      if (selfServiceBody.action === 'lookup_recipient') {
        const authHeader = req.headers.get('Authorization') ?? ''
        // Cualquier usuario AUTENTICADO (JWT real) — no expone saldos ni PII.
        let authed = false
        const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
        if (jwt) { try { const { data } = await db.auth.getUser(jwt); authed = !!data?.user } catch { /* inválido */ } }
        if (!authed) return json({ error: 'No autorizado' }, 401)
        const code = String(selfServiceBody.code ?? '').toUpperCase().trim()
        if (code.length < 4) return json({ found: false })
        const { data: u } = await db.from('users')
          .select('id, full_name')
          .eq('raw_data->>ownReferralCode', code)
          .neq('role', 'admin')
          .limit(1)
          .maybeSingle()
        if (!u) return json({ found: false })
        return json({ found: true, id: (u as any).id, name: (u as any).full_name ?? 'Usuario Lincoin' })
      }

      // ── 2FA: guardar el secreto TOTP CIFRADO (nunca en texto plano) ──────
      // El cliente verifica el primer código localmente (prueba que configuró
      // bien su app) y aquí solo se almacena el secreto cifrado con la llave
      // del servidor. Se borra cualquier totpSecret plano previo.
      if (selfServiceBody.action === 'mfa_set' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const secret = String(selfServiceBody.secret ?? '')
        if (!/^[A-Z2-7]{16,64}$/i.test(secret)) return json({ error: 'Secreto inválido' }, 400)
        const factorId = String(selfServiceBody.factorId ?? 'local')
        const { data: u } = await db.from('users').select('raw_data').eq('id', selfServiceBody.userId).single()
        const raw = { ...((u as any)?.raw_data ?? {}) }
        try { raw.totpSecretEnc = await encField(secret) }
        catch { return json({ error: 'La Bóveda no está disponible para guardar el secreto. No se activó el 2FA.' }, 503) }
        raw.mfaEnabled = true
        raw.mfaFactorId = factorId
        delete raw.totpSecret   // nunca dejar el secreto en claro
        // Códigos de respaldo: se entregan UNA sola vez al activar y solo se
        // guarda su hash. Son la vía de entrada que NO depende de la llave de
        // cifrado, así que una rotación de llave ya no deja a nadie afuera.
        const codes = newBackupCodes()
        raw.mfaBackupHashes = await Promise.all(codes.map(hashBackup))
        const { error } = await db.from('users').update({ raw_data: raw }).eq('id', selfServiceBody.userId)
        if (error) return json({ error: error.message }, 500)
        return json({ success: true, backupCodes: codes })
      }

      // ── 2FA: verificar un código contra el secreto CIFRADO (server-side).
      // Reemplaza la verificación local del cliente (que ya no tiene el
      // secreto en claro). Acepta legacy en texto plano.
      if (selfServiceBody.action === 'mfa_verify' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const code = String(selfServiceBody.code ?? '')
        const uidV = String(selfServiceBody.userId)

        // ── Límite de intentos ────────────────────────────────────────────
        // Sin esto, el código de 6 dígitos se podía probar sin freno. Con la
        // ventana de ±2 hay 5 códigos válidos a la vez sobre un millón: unos
        // 200.000 intentos de media, cuestión de horas para un script. El
        // 2FA existe precisamente para el caso en que YA te robaron la
        // contraseña, así que dejarlo sin freno le quitaba casi todo el valor.
        const sinceMfa = new Date(Date.now() - 15 * 60_000).toISOString()
        const { data: recentMfa } = await db.from('audit_log').select('metadata')
          .eq('action', 'auth.mfa_failed').gte('created_at', sinceMfa).limit(200)
        const failsMfa = (recentMfa ?? []).filter((r: any) => r?.metadata?.userId === uidV).length
        if (failsMfa >= 5) {
          return json({ ok: false, error: 'too_many_attempts', message: 'Demasiados códigos incorrectos. Espera 15 minutos antes de volver a intentar.' }, 429)
        }
        const noteMfaFail = async (motivo: string) => { await auditAdmin(req, 'auth.mfa_failed', { userId: uidV, motivo }) }

        const { data: u } = await db.from('users').select('raw_data').eq('id', selfServiceBody.userId).single()
        const raw = ((u as any)?.raw_data ?? {}) as Record<string, any>

        // ── Código de RESPALDO ────────────────────────────────────────────
        // Se prueba primero porque no es de 6 dígitos y porque tiene que
        // funcionar aunque el secreto TOTP esté ilegible — ese es justo el
        // caso para el que existe. Es de un solo uso: al acertar se consume.
        const hashes: string[] = Array.isArray(raw.mfaBackupHashes) ? raw.mfaBackupHashes : []
        const normalized = normalizeBackup(code)
        if (hashes.length && normalized.length === 8 && !/^\d{6}$/.test(code.trim())) {
          const h = await hashBackup(code)
          const idx = hashes.indexOf(h)
          if (idx >= 0) {
            const rest = hashes.filter((_, i) => i !== idx)
            await db.from('users').update({ raw_data: { ...raw, mfaBackupHashes: rest } }).eq('id', selfServiceBody.userId)
            await auditAdmin(req, 'mfa_backup_code_used', { userId: selfServiceBody.userId, remaining: rest.length })
            await rememberMfaSession(req, String(selfServiceBody.userId))
            return json({ ok: true, usedBackup: true, remaining: rest.length })
          }
          await noteMfaFail('código de respaldo inválido')
          return json({ ok: false, error: 'backup_invalid' })
        }

        let secret = ''
        // Se distinguen los fallos que antes se veían IGUAL que "código
        // incorrecto": que no haya secreto guardado, y que sí lo haya pero el
        // servidor no lo pueda descifrar (llave de cifrado distinta a la que
        // se usó al activar el 2FA). Solo se informa el TIPO de fallo, nunca
        // el secreto ni nada de la Bóveda.
        let decErr: 'none' | 'key' | 'other' = 'none'
        try { secret = raw.totpSecretEnc ? await decField(String(raw.totpSecretEnc)) : String(raw.totpSecret ?? '') }
        catch (e) { decErr = (e instanceof KeyMismatchError) ? 'key' : 'other'; secret = '' }
        if (!secret) {
          return json({
            ok: false,
            error: decErr === 'none' ? 'no_secret' : 'secret_unreadable',
            keyMismatch: decErr === 'key',
            hasBackupCodes: hashes.length > 0,
          })
        }
        const counter = await verifyTOTPServer(secret, code)
        if (counter < 0) {
          await noteMfaFail('código incorrecto')
          return json({ ok: false })
        }
        // Un código ya usado NO vale una segunda vez, aunque su ventana siga
        // abierta. Es lo que cierra la reutilización del código capturado.
        const lastCounter = Number(raw.mfaLastCounter ?? -1)
        if (Number.isFinite(lastCounter) && counter <= lastCounter) {
          await noteMfaFail('código ya utilizado')
          return json({ ok: false, error: 'code_reused', message: 'Ese código ya se usó. Espera al siguiente que muestre tu app.' })
        }
        await db.from('users').update({ raw_data: { ...raw, mfaLastCounter: counter } }).eq('id', uidV)
        // Queda constancia de QUÉ sesión superó el 2FA: es lo que después
        // exigen las acciones sensibles.
        await rememberMfaSession(req, uidV)
        return json({ ok: true })
      }

      // ── 2FA: SALUD — ¿algún secreto quedó ilegible? ──────────────────────
      // Revisa todas las cuentas con 2FA activo e informa cuántas tienen el
      // secreto ilegible (llave distinta) y cuántas se quedaron sin códigos de
      // respaldo. Es lo que convierte "me quedé afuera" en un aviso ANTES de
      // que pase. No devuelve ningún secreto: solo correos y conteos.
      if (selfServiceBody.action === 'mfa_health') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const { data: rows } = await db.from('users').select('id, email, raw_data')
        let total = 0, unreadable = 0, keyMismatch = 0, noBackup = 0, legacyPlain = 0
        const affected: Array<{ email: string; motivo: string }> = []
        for (const r of (rows ?? []) as any[]) {
          const raw = r.raw_data ?? {}
          if (!raw.mfaEnabled) continue
          total++
          const hashes: string[] = Array.isArray(raw.mfaBackupHashes) ? raw.mfaBackupHashes : []
          if (!hashes.length) noBackup++
          if (!raw.totpSecretEnc && raw.totpSecret) { legacyPlain++; continue }
          try {
            const s = raw.totpSecretEnc ? await decField(String(raw.totpSecretEnc)) : ''
            if (!s) { unreadable++; affected.push({ email: r.email, motivo: 'sin secreto' }) }
          } catch (e) {
            unreadable++
            if (e instanceof KeyMismatchError) keyMismatch++
            affected.push({ email: r.email, motivo: e instanceof KeyMismatchError ? 'cifrado con otra llave' : 'ilegible' })
          }
        }
        return json({ ok: true, total, unreadable, keyMismatch, noBackup, legacyPlain, affected: affected.slice(0, 25) })
      }

      // ── 2FA: DESACTIVAR — la ÚNICA vía para apagar el 2FA. Exige un CÓDIGO
      // DE CORREO verificado server-side (salvo admin), para que nadie lo apague
      // sin acceso al correo del titular. save_user NO puede tocar el 2FA (está
      // en la lista SERVER_OWNED), así que esta es la única puerta.
      if (selfServiceBody.action === 'mfa_disable' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)

        // ⚠️ Apagar el 2FA es la operación que deja la cuenta con SOLO la
        // contraseña. Antes el admin estaba EXENTO del código de correo, así
        // que cualquier sesión suya —en cualquier dispositivo, con solo la
        // contraseña— podía desactivarlo. Ahora se exigen las dos cosas, sin
        // excepción por rol:
        //
        //   1) que ESTA sesión haya superado el 2FA (con el código de la app
        //      o uno de respaldo). Un dispositivo nuevo que solo tiene la
        //      contraseña no puede.
        //   2) un código enviado al correo del titular.
        //
        // Quien roba la contraseña no tiene ni el teléfono ni el correo.
        const mfaSessErr = await requireMfaSession(req, String(selfServiceBody.userId))
        if (mfaSessErr) return json({ error: `Para desactivar el 2FA primero verifícalo en este dispositivo. ${mfaSessErr}`, needs2fa: true }, 403)

        const code = String(selfServiceBody.emailCode ?? '')
        if (!/^\d{6}$/.test(code)) return json({ error: 'Falta el código de correo (6 dígitos).' }, 400)
        const otpRes = await fetch(`${SUPABASE_URL}/functions/v1/email-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ action: 'verify', userId: selfServiceBody.userId, code }),
        }).then(r => r.json()).catch(() => null)
        if (!otpRes?.ok) return json({ error: 'Código de correo incorrecto o vencido.' }, 403)
        const { data: u } = await db.from('users').select('raw_data').eq('id', selfServiceBody.userId).single()
        const raw = { ...((u as any)?.raw_data ?? {}) }
        raw.mfaEnabled = false
        delete raw.mfaFactorId
        delete raw.totpSecret
        delete raw.totpSecretEnc
        delete raw.mfaBackupHashes   // los códigos viejos no sirven para el 2FA nuevo
        const { error } = await db.from('users').update({ raw_data: raw }).eq('id', selfServiceBody.userId)
        if (error) return json({ error: error.message }, 500)
        await auditAdmin(req, 'security.mfa_disabled', { userId: selfServiceBody.userId })
        return json({ success: true })
      }

      // Self-delete: any authenticated user can delete their own account
      if (selfServiceBody.action === 'delete_self') {
        const jwt = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
        const { data: { user: selfUser } } = await db.auth.getUser(jwt ?? '')
        if (!selfUser) return json({ error: 'Unauthorized' }, 401)
        const { data: selfProfile } = await db.from('users').select('raw_data').eq('id', selfUser.id).single()
        const selfIndex: number | undefined = selfProfile?.raw_data?.gasfreeHdIndex
        await db.from('transactions').delete().eq('user_id', selfUser.id)
        await db.from('users').delete().eq('id', selfUser.id)
        const { error: selfDelErr } = await db.auth.admin.deleteUser(selfUser.id)
        // ⚠️ Antes este error solo se logueaba y la función igual devolvía
        // success:true — la fila de public.users quedaba borrada pero el
        // usuario de Supabase Auth se quedaba huérfano con el mismo email,
        // así que un reintento de registro con ese correo fallaba sin que
        // nadie supiera por qué ("no se elimina de verdad"). Ahora se
        // reporta el error de verdad (el perfil ya se borró igual, pero al
        // menos se sabe que hay que limpiar el auth user a mano o con
        // force_delete_by_email).
        if (selfDelErr) {
          console.warn('[admin-data] delete_self auth error:', selfDelErr.message)
          return json({ error: `Perfil eliminado, pero la cuenta de acceso no se pudo borrar: ${selfDelErr.message}. Contacta soporte para liberar el correo.` }, 500)
        }
        if (typeof selfIndex === 'number') {
          const { data: blCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_used_indices').single()
          const blacklist: number[] = JSON.parse(blCfg?.value ?? '[]')
          if (!blacklist.includes(selfIndex)) blacklist.push(selfIndex)
          blacklist.sort((a, b) => a - b)
          await db.from('system_config').upsert({ key: 'gasfree_used_indices', value: JSON.stringify(blacklist) })
          const { data: ctrCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_hd_counter').single()
          const current = ctrCfg?.value ? parseInt(ctrCfg.value) : 0
          if (selfIndex > current) {
            await db.from('system_config').upsert({ key: 'gasfree_hd_counter', value: String(selfIndex) })
          }
        }
        return json({ success: true })
      }
    }

    // Todo lo que sigue de aquí en adelante SÍ es admin-only — se aplica
    // el gate ahora que las acciones self-service ya tuvieron su chance.
    const auth = await verifyAdmin(req)
    if (!auth.ok) return json({ error: auth.error }, 401)

    if (req.method === 'POST') {
      const body = selfServiceBody ?? {}

      // Acciones que cambian dinero, cuentas o la propia seguridad: exigen
      // que ESTA sesión haya pasado el 2FA, no solo la contraseña. Las de
      // consulta se dejan fuera a propósito, para no dejar al admin sin panel
      // si algo del 2FA falla — lo que se protege es lo que hace daño.
      const SENSITIVE_ADMIN_ACTIONS = new Set([
        // Mueven dinero
        'admin_credit_balance', 'admin_credit_crypto', 'credit_conversion_fee',
        'approve_rail_move', 'reject_rail_move',
        // Cambian cuentas o el estado de cumplimiento
        // ('save_user' NO va aquí: se resuelve antes, en la zona self-service
        //  que también usan los clientes con su propia cuenta. Ahí lo que
        //  protege es SERVER_OWNED + el trigger de columnas sensibles.)
        'delete_user', 'force_delete_by_email', 'set_kyc_status',
        // Cambian la configuración o la propia seguridad
        'save_config', 'block_ip', 'unblock_ip', 'log_key_rotation',
      ])
      if (SENSITIVE_ADMIN_ACTIONS.has(String(body.action))) {
        const mfaErr = await requireMfaSession(req, auth.userId)
        if (mfaErr) return json({ error: mfaErr, needs2fa: true }, 403)
      }

      // ── Registro de AUDITORÍA (admin-only) — quién cambió qué y cuándo ──
      // Lee audit_log (cambios de proveedor de tesorería, payouts, etc.). Sirve
      // para investigar, p. ej., quién configuró la dirección de un proveedor.
      // ── Ingresos de admin: última vez de ingreso + actividad con IP ──
      // last_sign_in_at lo trae Supabase Auth (no requiere logging propio).
      // La actividad con IP sale de audit_log (acciones sensibles + logins).
      if (body.action === 'admin_logins') {
        // Correos con rol admin en public.users.
        const { data: adminRows } = await db.from('users').select('id, email, role, created_at').eq('role', 'admin')
        const adminIds = new Set((adminRows ?? []).map((r: any) => r.id))
        const adminEmails = new Set((adminRows ?? []).map((r: any) => String(r.email ?? '').toLowerCase()))
        if (ADMIN_EMAIL) adminEmails.add(String(ADMIN_EMAIL).toLowerCase())
        // Datos de Supabase Auth (last_sign_in_at, created_at).
        const admins: any[] = []
        try {
          const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
          for (const u of (list?.users ?? [])) {
            if (adminIds.has(u.id) || adminEmails.has(String(u.email ?? '').toLowerCase())) {
              admins.push({ id: u.id, email: u.email, last_sign_in_at: (u as any).last_sign_in_at ?? null, created_at: u.created_at ?? null })
            }
          }
        } catch (e) { /* si Auth admin falla, seguimos con lo de public.users */ }
        // Actividad reciente con IP (logins + acciones sensibles).
        const { data: acts } = await db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100)
        const withIp = (acts ?? []).filter((a: any) => a?.metadata?.ip || a?.action === 'auth.admin_login')
          .map((a: any) => ({ action: a.action, at: a.metadata?.at ?? a.created_at, byEmail: a.metadata?.byEmail ?? null, ip: a.metadata?.ip ?? null, userAgent: a.metadata?.userAgent ?? null, hadSession: a.metadata?.hadSession }))
        return json({ ok: true, admins, activity: withIp })
      }

      // ── Panel de seguridad: datos REALES de acceso ────────────────────
      // Reemplaza los tres recuadros que estaban en "demo": rotación de
      // llaves, intentos fallidos / IPs bloqueadas, e historial de accesos
      // (con IP y ubicación aproximada).
      if (body.action === 'security_stats') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
        const { data: rows } = await db.from('audit_log').select('*')
          .order('created_at', { ascending: false }).limit(500)
        const all = rows ?? []
        const at = (r: any) => r?.metadata?.at ?? r?.created_at
        const failed = all.filter((r: any) => r.action === 'auth.failed_login')
        const failedToday = failed.filter((r: any) => new Date(at(r)) >= startOfDay)
        // Fallidos agrupados por IP (para ver de dónde vienen).
        const byIpMap: Record<string, any> = {}
        for (const f of failedToday) {
          const ip = f?.metadata?.ip ?? 'desconocida'
          byIpMap[ip] ??= { ip, count: 0, geo: f?.metadata?.geo ?? null, lastAt: at(f), emails: [] as string[] }
          byIpMap[ip].count++
          const em = f?.metadata?.email
          if (em && !byIpMap[ip].emails.includes(em)) byIpMap[ip].emails.push(em)
        }
        // Historial de accesos: cada ingreso al panel, con IP y ubicación.
        const access = all.filter((r: any) => r.action === 'auth.admin_login').slice(0, 40).map((r: any) => ({
          at: at(r), email: r?.metadata?.byEmail ?? null, ip: r?.metadata?.ip ?? null,
          geo: r?.metadata?.geo ?? null, userAgent: r?.metadata?.userAgent ?? null,
        }))
        // Incidentes de servicio: caídas y recuperaciones que registró el
        // monitoreo. Se emparejan aquí para poder mostrar la duración.
        const incRows = all.filter((r: any) => r.action === 'ops.incident')
        const incidents: any[] = []
        for (const r of incRows) {
          const m = r.metadata ?? {}
          if (m.kind !== 'down') continue
          const up = incRows.find((u: any) => u.metadata?.kind === 'up' && u.metadata?.service === m.service && new Date(at(u)) > new Date(at(r)))
          incidents.push({
            service: m.service, at: at(r),
            resolvedAt: up ? at(up) : null,
            minutes: up ? Math.max(1, Math.round((new Date(at(up)).getTime() - new Date(at(r)).getTime()) / 60000)) : null,
          })
          if (incidents.length >= 20) break
        }
        const rot = all.find((r: any) => r.action === 'security.key_rotation')
        return json({
          ok: true,
          failedToday: failedToday.length,
          failedByIp: Object.values(byIpMap).sort((a: any, b: any) => b.count - a.count),
          blockedIps: await blockedIps(),
          access,
          incidents,
          keyRotation: rot ? { at: at(rot), byEmail: rot?.metadata?.byEmail ?? null, note: rot?.metadata?.note ?? null } : null,
        })
      }

      // El monitoreo avisa cuando un servicio se cae o se recupera. Queda en
      // auditoria para poder armar el historial de incidentes.
      if (body.action === 'log_incident' && body.service && body.kind) {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        await auditAdmin(req, 'ops.incident', { service: String(body.service).slice(0, 60), kind: String(body.kind) === 'up' ? 'up' : 'down' })
        return json({ ok: true })
      }

      // ── AGENTE DE SEGURIDAD ───────────────────────────────────────────
      // Corre chequeos REALES contra el estado vivo del sistema y devuelve
      // hallazgos concretos, cada uno con severidad y cómo arreglarlo.
      //
      // No "protege" nada por sí mismo: encuentra lo que está flojo. La
      // diferencia con una lista de buenas prácticas es que cada punto se
      // verifica contra los datos, no se asume.
      if (body.action === 'security_audit') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        type Sev = 'critica' | 'alta' | 'media' | 'baja'
        const f: Array<{ id: string; sev: Sev; title: string; detail: string; fix: string; count?: number }> = []
        const add = (id: string, sev: Sev, title: string, detail: string, fix: string, count?: number) =>
          f.push({ id, sev, title, detail, fix, count })

        // 1) Defensas que viven en la base: ¿están PUESTAS o solo escritas?
        let posture: any = null
        try {
          const { data } = await db.rpc('security_posture')
          posture = data ?? null
        } catch { /* la función aún no está instalada */ }
        if (!posture) {
          add('posture_missing', 'media', 'No se puede verificar el blindaje de la base',
            'Falta instalar la función security_posture(), así que no hay forma de comprobar desde aquí si los triggers y la RLS están realmente aplicados.',
            'Ejecuta supabase/migrations/2026_security_posture.sql en el SQL Editor.')
        } else {
          if (!posture.rawDataGuard) add('raw_guard', 'critica', 'El blindaje de raw_data NO está instalado',
            'Sin ese trigger, un cliente puede escribir desde su navegador los campos que solo el servidor debería tocar: el contador de depósitos acreditados (acreditarse dinero que nunca entró), su propio 2FA y los códigos de respaldo.',
            'Ejecuta supabase/migrations/2026_guard_raw_data_server_keys.sql en el SQL Editor.')
          if (!posture.sensitiveColsGuard) add('cols_guard', 'critica', 'El candado de columnas sensibles NO está instalado',
            'Sin él, un cliente podría cambiar su propio rol, su saldo o su estado de KYC con una escritura directa.',
            'Ejecuta la sección guard_users_sensitive_cols del esquema en el SQL Editor.')
          if (!posture.adjustBalancesRpc) add('adjust_rpc', 'alta', 'Falta la RPC atómica de saldos',
            'Sin adjust_balances, los débitos caen al camino de respaldo leer-y-escribir, donde dos operaciones a la vez pueden duplicar fondos.',
            'Instala la función adjust_balances del esquema.')
          if (!posture.rlsUsers) add('rls_users', 'critica', 'La tabla de usuarios está SIN RLS',
            'Cualquiera con la llave pública podría leer o escribir filas de otros clientes.',
            'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY, y revisa que existan sus políticas.')
          if (!posture.rlsTransactions) add('rls_tx', 'critica', 'La tabla de movimientos está SIN RLS',
            'Los movimientos de todos los clientes quedarían legibles por cualquiera con la llave pública.',
            'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY.')
          if (posture.rlsSystemConfig === false) add('rls_syscfg', 'alta', 'system_config está SIN RLS',
            'Ahí viven la wallet del proveedor, las IPs bloqueadas y los contadores de la Bóveda.',
            'ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY (solo service_role debe leer/escribir).')
        }

        // 2) Llave de cifrado de campos: sin ella el 2FA no se puede guardar.
        if (!FIELD_ENC_KEY) add('enc_key', 'alta', 'Falta la llave de cifrado de campos',
          'Sin FIELD_ENC_KEY no se puede activar el 2FA de nadie (se rechaza antes que guardar un secreto en claro).',
          'Define FIELD_ENC_KEY en la Bóveda. Una vez definida NO se cambia: rotarla deja ilegibles los 2FA existentes.')

        // 3) Cuentas: admins sin 2FA, secretos ilegibles, correos duplicados,
        //    filas de admin sin cuenta de acceso real.
        const { data: allUsers } = await db.from('users').select('id, email, role, raw_data')
        const rows = (allUsers ?? []) as any[]
        const admins = rows.filter(u => u.role === 'admin')
        const adminsNo2fa = admins.filter(u => !u?.raw_data?.mfaEnabled)
        if (adminsNo2fa.length) add('admin_no_2fa', 'critica', `${adminsNo2fa.length} admin(s) sin 2FA`,
          `Con solo la contraseña se entra al panel: ${adminsNo2fa.map(a => a.email).join(', ')}.`,
          'Cada admin lo activa en Seguridad → Activar 2FA, y guarda sus códigos de respaldo.', adminsNo2fa.length)

        const con2fa = rows.filter(u => u?.raw_data?.mfaEnabled)
        let ilegibles = 0
        for (const u of con2fa) {
          const enc = u?.raw_data?.totpSecretEnc
          if (!enc) { if (!u?.raw_data?.totpSecret) ilegibles++; continue }
          try { if (!(await decField(String(enc)))) ilegibles++ } catch { ilegibles++ }
        }
        if (ilegibles) add('mfa_unreadable', 'critica', `${ilegibles} cuenta(s) con 2FA ilegible`,
          'Tienen el 2FA activo pero el servidor no puede leer su secreto: por más que el código sea correcto, no van a poder entrar.',
          'Desactiva y reactiva su 2FA. Revisa el detalle en el botón de salud del 2FA.', ilegibles)

        const sinRespaldo = con2fa.filter(u => !Array.isArray(u?.raw_data?.mfaBackupHashes) || !u.raw_data.mfaBackupHashes.length)
        if (sinRespaldo.length) add('no_backup_codes', 'media', `${sinRespaldo.length} cuenta(s) con 2FA y sin códigos de respaldo`,
          'Si pierden el teléfono o el secreto queda ilegible, no tienen forma de entrar sin tocar la base a mano.',
          'Que desactiven y reactiven el 2FA: al activarlo se entregan 8 códigos.', sinRespaldo.length)

        const porCorreo: Record<string, number> = {}
        for (const u of rows) { const e = String(u.email ?? '').toLowerCase(); if (e) porCorreo[e] = (porCorreo[e] ?? 0) + 1 }
        const dupes = Object.entries(porCorreo).filter(([, n]) => n > 1)
        if (dupes.length) add('dup_emails', 'alta', `${dupes.length} correo(s) con más de una cuenta`,
          `Filas duplicadas hacen que el login lea una y el panel otra: ${dupes.map(([e, n]) => `${e} (${n})`).join(', ')}.`,
          'Deja solo la fila que tiene cuenta de acceso real y borra la sobrante.', dupes.length)

        // Filas con rol admin que NO tienen usuario de Auth: no pueden iniciar
        // sesión, pero cuentan como admin en cualquier consulta por rol.
        try {
          const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
          const authIds = new Set((list?.users ?? []).map((u: any) => u.id))
          const huerfanos = admins.filter(a => !authIds.has(a.id))
          if (huerfanos.length) add('admin_orphan', 'alta', `${huerfanos.length} fila(s) de admin sin cuenta de acceso`,
            `No pueden iniciar sesión pero pesan como admin en la base: ${huerfanos.map(a => a.email).join(', ')}. Suelen ser semillas de instalación que quedaron olvidadas.`,
            'Bórralas si no operan, después de comprobar que no tienen movimientos.', huerfanos.length)
        } catch { /* Auth admin no disponible */ }

        const planos = rows.filter(u => u?.raw_data?.totpSecret)
        if (planos.length) add('totp_plain', 'alta', `${planos.length} secreto(s) de 2FA en texto plano`,
          'Quedaron de un esquema anterior. Quien lea esa fila puede generar sus códigos.',
          'Que esas cuentas desactiven y reactiven el 2FA: al hacerlo se guarda cifrado.', planos.length)

        // 4) Presión sobre el acceso: fallos e IPs bloqueadas.
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
        const { data: fails } = await db.from('audit_log').select('metadata, created_at')
          .eq('action', 'auth.failed_login').gte('created_at', startOfDay.toISOString()).limit(400)
        const nFails = (fails ?? []).length
        if (nFails >= 20) add('login_pressure', 'media', `${nFails} intentos de ingreso fallidos hoy`,
          'Un volumen así suele ser alguien probando contraseñas, no un despiste.',
          'Revisa las IPs en Monitoreo y bloquea las que no reconozcas.', nFails)
        const blocked = await blockedIps()
        if (blocked.length) add('blocked_now', 'baja', `${blocked.length} IP(s) bloqueadas ahora`,
          `Bloqueos activos: ${blocked.slice(0, 5).map(b => b.ip).join(', ')}.`,
          'Si alguna es tuya (o de tu oficina), desbloquéala en Monitoreo.', blocked.length)

        // 5) La wallet del proveedor debe estar fijada en la Bóveda.
        const provFinity = (Deno.env.get('PROVIDER_WALLET_FINITY') ?? '').trim()
        const provMouv = (Deno.env.get('PROVIDER_WALLET_MOUV') ?? '').trim()
        if (!provFinity && !provMouv) add('provider_unlocked', 'critica', 'La wallet del proveedor NO está fijada en la Bóveda',
          'Mientras no esté fijada, la dirección de destino se puede cambiar desde el panel — que es exactamente por donde se desvía el dinero.',
          'Define PROVIDER_WALLET_FINITY (y PROVIDER_WALLET_MOUV) en la Bóveda. Quedan bloqueadas y solo se cambian desde ahí.')

        const peso: Record<Sev, number> = { critica: 30, alta: 15, media: 6, baja: 2 }
        const score = Math.max(0, 100 - f.reduce((s, x) => s + peso[x.sev], 0))
        const orden: Sev[] = ['critica', 'alta', 'media', 'baja']
        f.sort((a, b) => orden.indexOf(a.sev) - orden.indexOf(b.sev))
        await auditAdmin(req, 'security.audit_run', { findings: f.length, score })
        return json({ ok: true, score, findings: f, posture, checkedAt: new Date().toISOString() })
      }

      // Desbloquear una IP (solo admin, queda auditado).
      if (body.action === 'unblock_ip' && body.ip) {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const list = (await blockedIps()).filter(b => b.ip !== String(body.ip))
        await saveBlockedIps(list)
        await auditAdmin(req, 'auth.ip_unblocked', { ip: String(body.ip) })
        return json({ ok: true, blockedIps: list })
      }

      // Bloquear una IP a mano.
      if (body.action === 'block_ip' && body.ip) {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const ip = String(body.ip).trim()
        const list = await blockedIps()
        if (!list.some(b => b.ip === ip)) {
          list.unshift({ ip, at: new Date().toISOString(), reason: String(body.reason ?? 'bloqueo manual').slice(0, 80), attempts: 0, geo: await geoOf(ip) })
          await saveBlockedIps(list)
          await auditAdmin(req, 'auth.ip_blocked', { ip, manual: true })
        }
        return json({ ok: true, blockedIps: list })
      }

      // Dejar constancia de una rotación de llaves/API.
      if (body.action === 'log_key_rotation') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        await auditAdmin(req, 'security.key_rotation', { note: String(body.note ?? '').slice(0, 200) || null })
        return json({ ok: true })
      }

      // Registrar un INGRESO de admin (lo llama el front tras un login exitoso).
      // Deja rastro DURABLE con IP y hora — Supabase solo guarda last_sign_in_at
      // (una sola fecha) y sus logs caducan.
      if (body.action === 'log_login') {
        await auditAdmin(req, 'auth.admin_login', { note: 'ingreso al panel admin' })
        return json({ ok: true })
      }

      if (body.action === 'list_audit') {
        const limit = Math.min(Number(body.limit ?? 200) || 200, 500)
        let rows: any[] = []
        let res = await db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit)
        if (res.error) res = await db.from('audit_log').select('*').order('id', { ascending: false }).limit(limit)
        if (!res.error) rows = res.data ?? []
        return json({ ok: true, audit: rows })
      }

      if (body.action === 'save_config') {
        const { settings } = body
        if (!settings) return json({ error: 'Missing settings' }, 400)
        const { error } = await db.from('app_config').upsert({ id: 1, settings })
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true })
      }


      // Admin: manually set kyc_status for a user
      if (body.action === 'set_kyc_status' && body.userId && body.kycStatus) {
        const allowed = ['verified', 'in_review', 'rejected', 'pending', 'in_progress']
        if (!allowed.includes(body.kycStatus)) return json({ error: 'Invalid kycStatus' }, 400)
        const { error: kycErr } = await db.from('users')
          .update({ kyc_status: body.kycStatus })
          .eq('id', body.userId)
        if (kycErr) return json({ error: kycErr.message }, 500)
        return json({ success: true })
      }

      if (body.action === 'delete_user' && body.userId) {
        const uid: string = body.userId

        // 0. Read gasfreeHdIndex + email/rol BEFORE deleting (para el counter y
        //    para el registro DURABLE de auditoría de quién borró a quién).
        const { data: deletedUser } = await db.from('users').select('raw_data, email, role').eq('id', uid).single()
        const deletedIndex: number | undefined = deletedUser?.raw_data?.gasfreeHdIndex
        await auditAdmin(req, 'admin.delete_user', {
          deletedUserId: uid,
          deletedEmail: (deletedUser as any)?.email ?? null,
          deletedRole: (deletedUser as any)?.role ?? null,
          gasfreeIndex: deletedIndex ?? null,
        })

        // 1. Delete all transactions for this user
        await db.from('transactions').delete().eq('user_id', uid)

        // 2. Delete from public.users
        await db.from('users').delete().eq('id', uid)

        // 3. Delete from Supabase Auth (service-role admin API)
        const { error: authDelErr } = await db.auth.admin.deleteUser(uid)
        if (authDelErr) {
          // No fallar la respuesta — el perfil ya se borró, así que no
          // puede iniciar sesión — pero SÍ avisar: si esto falla, el email
          // queda "huérfano" en Supabase Auth y bloquea un registro nuevo
          // con el mismo correo hasta que se borre con force_delete_by_email
          // o a mano en el Dashboard → Authentication → Users.
          console.warn('[admin-data] auth.admin.deleteUser error:', authDelErr.message)
          return json({ success: true, authWarning: `El perfil se borró, pero la cuenta de acceso (Supabase Auth) no: ${authDelErr.message}. El correo seguirá bloqueado para un registro nuevo hasta limpiarla.` })
        }

        // 4. Add the deleted user's gasfreeHdIndex to the permanent blacklist so it
        //    is never assigned to a new user, even after the user row is gone.
        if (typeof deletedIndex === 'number') {
          const { data: blCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_used_indices').single()
          const blacklist: number[] = JSON.parse(blCfg?.value ?? '[]')
          if (!blacklist.includes(deletedIndex)) blacklist.push(deletedIndex)
          blacklist.sort((a, b) => a - b)
          await db.from('system_config').upsert({ key: 'gasfree_used_indices', value: JSON.stringify(blacklist) })
          // Also bump counter so getUserIndex starts above the deleted index
          const { data: ctrCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_hd_counter').single()
          const current = ctrCfg?.value ? parseInt(ctrCfg.value) : 0
          if (deletedIndex > current) {
            await db.from('system_config').upsert({ key: 'gasfree_hd_counter', value: String(deletedIndex) })
          }
        }

        return json({ success: true })
      }

      // Libera un correo "huérfano": borra el usuario de Supabase Auth que
      // tenga ese email (y cualquier fila de public.users que haya quedado,
      // por si acaso) aunque ya no exista perfil — para cuando un delete
      // anterior (delete_self o delete_user) borró el perfil pero falló al
      // borrar la cuenta de Auth, y el correo quedó bloqueado para un
      // registro nuevo sin que nadie lo notara.
      if (body.action === 'force_delete_by_email' && body.email) {
        const email = String(body.email).trim().toLowerCase()
        await db.from('users').delete().eq('email', email)
        let found: any = null
        for (let page = 1; page <= 20 && !found; page++) {
          const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
          if (error) return json({ error: error.message }, 500)
          found = (data?.users ?? []).find((u: any) => (u.email ?? '').toLowerCase() === email)
          if (!data?.users || data.users.length < 200) break
        }
        if (!found) return json({ success: true, note: 'No había ningún usuario de Auth con ese correo — ya estaba libre para registrarse.' })
        const { error: delErr } = await db.auth.admin.deleteUser(found.id)
        if (delErr) return json({ error: delErr.message }, 500)
        return json({ success: true, deletedAuthUserId: found.id })
      }

      // Manually credit or debit a user's crypto balance
      if (body.action === 'admin_credit_crypto' && body.userId && body.currency && body.amount != null) {
        const { data: u } = await db.from('users').select('crypto_balances').eq('id', body.userId).single()
        const bals: Record<string, number> = (u?.crypto_balances as any) ?? {}
        const cur: string = body.currency
        const delta: number = parseFloat(body.amount)
        const newBal = parseFloat(Math.max(0, (bals[cur] ?? 0) + delta).toFixed(8))
        await db.from('users').update({ crypto_balances: { ...bals, [cur]: newBal } }).eq('id', body.userId)
        if (delta > 0) {
          await db.from('transactions').insert({
            user_id: body.userId, type: 'otc_deposit', amount: delta, currency: body.currency,
            status: 'Completado',
            raw_data: { source: 'admin_manual', note: body.note ?? 'Depósito acreditado manualmente por admin', creditedAt: new Date().toISOString() },
          })
        }
        return json({ success: true, newBalance: newBal })
      }

      // Cargues — acreditar (o descontar) manualmente el saldo FIAT de un
      // cliente en un riel específico: COP (Saldo Lincoin), COP_BREB (Bre-B)
      // o COP_ACH (ACH). Temporal, mientras Mouv apifica el conversor: el
      // admin recibe el pago por el grupo cerrado y aquí refleja el saldo.
      // body: { action:'admin_credit_balance', userId, currency, amount, note? }
      // Cargues Bre-B: al cliente se le cobra el 0,10% POR RECIBIR en su
      // cuenta Bre-B (override con el secret BREB_CARGUE_FEE_PCT, en %).
      // Ej: cargue de 40.000.000 → comisión 40.000 → se acreditan 39.960.000.
      if (body.action === 'admin_credit_balance' && body.userId && body.currency && body.amount != null) {
        const ALLOWED = ['COP', 'COP_BREB', 'COP_ACH']
        const cur: string = body.currency
        if (!ALLOWED.includes(cur)) return json({ success: false, error: `Riel no permitido: ${cur}` }, 400)
        const { data: u } = await db.from('users').select('balances').eq('id', body.userId).single()
        if (!u) return json({ success: false, error: 'Usuario no encontrado' }, 404)
        const bals: Record<string, number> = (u?.balances as any) ?? {}
        const recordOnlyEarly = body.recordOnly === true

        // ── 2FA por operación ──────────────────────────────────────────
        // No basta con que la sesión lo haya pasado al entrar: cada cargue
        // mueve dinero real, así que se confirma uno por uno. El registro
        // histórico (recordOnly) no toca saldo y queda fuera.
        if (!recordOnlyEarly) {
          const otpErr = await requireAdminOtp(auth.userId, body.otp)
          if (otpErr) return json({ success: false, error: otpErr, needs2fa: true }, 403)
        }

        // ── Contabilidad ───────────────────────────────────────────────
        // Si viene el detalle de la operación, el COP a acreditar lo DERIVA
        // el servidor. Antes se escribía a mano y "lo que sobraba" se
        // llamaba utilidad sin que nadie supiera de dónde salía.
        let acct: Acct | null = null
        let delta: number = parseFloat(body.amount)
        if (body.acct && !recordOnlyEarly) {
          const r = computeAcct(body.acct)
          if ('error' in r) return json({ success: false, error: r.error }, 400)
          acct = r.acct
          // El monto lo manda la cuenta, no la pantalla: así el número que
          // se acredita y el que queda en la contabilidad son el mismo.
          delta = acct.copToClient
        }
        if (!isFinite(delta) || delta === 0) return json({ success: false, error: 'Monto inválido' }, 400)
        const BREB_CARGUE_FEE_PCT = Number(Deno.env.get('BREB_CARGUE_FEE_PCT') ?? '0.10') || 0.10
        let feeCop = 0
        let credit = delta
        if (cur === 'COP_BREB' && delta > 0) {
          feeCop = Math.round(delta * BREB_CARGUE_FEE_PCT / 100)
          credit = delta - feeCop
        }
        // recordOnly=true → SOLO registra el movimiento histórico, sin tocar
        // el saldo (para cuadrar cargues viejos que se acreditaron sin fila
        // en transacciones y el resumen de Movimientos no los veía). En modo
        // registro no se aplica comisión: se anota el monto tal cual.
        const recordOnly = recordOnlyEarly
        if (recordOnly) { feeCop = 0; credit = delta }

        // Utilidad REAL: lo que entró por la venta menos lo que de verdad se
        // le acreditó al cliente. El fee de red ya está descontado porque
        // 'revenueCop' solo cuenta los USDT que llegaron.
        const utilityCop = acct ? Math.round(acct.revenueCop - credit) : null
        // ATÓMICO: primero el movimiento — si el registro falla, NO se toca
        // el saldo (un cargue sin rastro en el historial es un descuadre).
        const { error: txInsErr } = await db.from('transactions').insert({
          user_id: body.userId,
          type: delta > 0 ? 'load' : 'adjustment',
          // El movimiento del cliente muestra lo NETO acreditado.
          amount: Math.abs(credit),
          currency: cur,
          status: 'Completado',
          raw_data: {
            source: recordOnly ? 'admin_backfill' : 'admin_cargue',
            rail: cur,
            direction: delta > 0 ? 'credit' : 'debit',
            ...(recordOnly ? { recordOnly: true } : {}),
            ...(feeCop > 0 ? { grossCop: delta, feeCop, feePct: BREB_CARGUE_FEE_PCT, feeConcept: 'Comisión por recepción Bre-B' } : {}),
            // Contabilidad de la operación: queda GUARDADA con el movimiento,
            // así la utilidad es un dato del cargue y no una resta posterior.
            ...(acct ? { acct: { ...acct, creditedCop: credit, feeCopBreb: feeCop, utilityCop } } : {}),
            note: body.note ?? (recordOnly ? 'Registro histórico (no afecta saldo)' : delta > 0
              ? (feeCop > 0 ? `Cargue Bre-B · comisión ${BREB_CARGUE_FEE_PCT}% por recepción` : 'Cargue manual (Mouv)')
              : 'Ajuste manual'),
            creditedAt: new Date().toISOString(),
          },
        })
        if (txInsErr) return json({ success: false, error: `No se registró el movimiento (${txInsErr.message}) — el saldo NO fue modificado.` }, 500)
        let newBal = parseFloat(Number(bals[cur] ?? 0).toFixed(2))
        if (!recordOnly) {
          newBal = parseFloat(Math.max(0, (bals[cur] ?? 0) + credit).toFixed(2))
          await db.from('users').update({ balances: { ...bals, [cur]: newBal } }).eq('id', body.userId)
        }
        if (acct) await auditAdmin(req, 'admin.cargue_contable', { userId: body.userId, rail: cur, ...acct, creditedCop: credit, utilityCop })
        return json({ success: true, newBalance: newBal, recordOnly, grossCop: Math.abs(delta), feeCop, netCop: Math.abs(credit), feePct: feeCop > 0 ? BREB_CARGUE_FEE_PCT : 0, acct: acct ? { ...acct, creditedCop: credit, feeCopBreb: feeCop, utilityCop } : null })
      }

      // ── Solicitudes "Mover Saldo Lincoin → ACH" (aprobación manual) ──
      // El cliente pide mover COP (Saldo Lincoin) a su riel ACH; el COP ya
      // quedó DEBITADO al crear la solicitud. El admin manda el respaldo al
      // proveedor por fuera y aquí aprueba (acredita COP_ACH) o rechaza
      // (reembolsa al Saldo Lincoin). Idempotente por estado.
      if ((body.action === 'approve_rail_move' || body.action === 'reject_rail_move') && body.txId) {
        const { data: tx } = await db.from('transactions').select('*').eq('id', body.txId).single()
        if (!tx || tx.type !== 'rail_move') return json({ success: false, error: 'Solicitud no encontrada' }, 404)
        if (tx.status !== 'Pendiente') return json({ success: true, already: true, status: tx.status })
        const rd = (tx.raw_data ?? {}) as Record<string, any>
        const { data: u } = await db.from('users').select('balances').eq('id', tx.user_id).single()
        const bals: Record<string, number> = (u?.balances as any) ?? {}
        const amt = Number(tx.amount ?? 0)
        if (body.action === 'approve_rail_move') {
          const toRail = String(rd.toRail ?? 'COP_ACH')
          const newBal = parseFloat(((bals[toRail] ?? 0) + amt).toFixed(2))
          await db.from('users').update({ balances: { ...bals, [toRail]: newBal } }).eq('id', tx.user_id)
          await db.from('transactions').update({
            status: 'Completado',
            raw_data: { ...rd, approvedAt: new Date().toISOString(), title: 'Saldo Lincoin → ACH · aprobado' },
          }).eq('id', tx.id)
          return json({ success: true, newBalance: newBal })
        }
        const fromRail = String(rd.fromRail ?? 'COP')
        const refunded = parseFloat(((bals[fromRail] ?? 0) + amt).toFixed(2))
        await db.from('users').update({ balances: { ...bals, [fromRail]: refunded } }).eq('id', tx.user_id)
        await db.from('transactions').update({
          status: 'Rechazado',
          raw_data: { ...rd, rejectedAt: new Date().toISOString(), rejectReason: body.reason ?? 'Rechazado por administración', title: 'Saldo Lincoin → ACH · rechazado (reembolsado)' },
        }).eq('id', tx.id)
        return json({ success: true, refunded: true })
      }

      // Credit conversion fee to admin's balance (called by performConversion for all users)
      // body: { action: 'credit_conversion_fee', currency, amount, fromUserId, note? }
      if (body.action === 'credit_conversion_fee' && body.currency && body.amount != null) {
        const ADMIN_EMAIL = Deno.env.get('VITE_ADMIN_EMAIL') || 'admin@lincoin.com'
        const { data: adminUser } = await db.from('users').select('id, balances, crypto_balances').eq('email', ADMIN_EMAIL).single()
        if (!adminUser) return json({ success: false, reason: 'admin not found' })

        const fee: number  = parseFloat(body.amount)
        const cur: string  = body.currency
        const isCrypto     = ['USDT', 'USDC', 'ETH', 'BNB', 'TRX', 'USDT_BSC', 'USDT_TRON', 'USDC_BSC', 'USDC_MATIC', 'USDC_BASE'].includes(cur)

        if (isCrypto) {
          const bals: Record<string, number> = (adminUser.crypto_balances as any) ?? {}
          const newBal = parseFloat(((bals[cur] ?? 0) + fee).toFixed(8))
          await db.from('users').update({ crypto_balances: { ...bals, [cur]: newBal } }).eq('id', adminUser.id)
        } else {
          const bals: Record<string, number> = (adminUser.balances as any) ?? {}
          const newBal = parseFloat(((bals[cur] ?? 0) + fee).toFixed(4))
          await db.from('users').update({ balances: { ...bals, [cur]: newBal } }).eq('id', adminUser.id)
        }

        // Log fee transaction for audit trail
        await db.from('transactions').insert({
          user_id: adminUser.id, type: 'fee_income', amount: fee, currency: cur, status: 'Completado',
          raw_data: { source: 'conversion_fee', fromUserId: body.fromUserId ?? null, note: body.note ?? `Comisión de conversión`, creditedAt: new Date().toISOString() },
        })
        return json({ success: true })
      }

      // Comprobante de UNA transacción, bajo demanda (ver slimRawData)
      if (body.action === 'get_tx_proof' && body.txId != null) {
        const { data: tx } = await db.from('transactions').select('raw_data').eq('id', body.txId).single()
        return json({ raw_data: tx?.raw_data ?? {} })
      }

      // POST with no recognized action → fall through to data fetch (same as GET)
    }

    // GET (or POST without body) — fetch all users and recent transactions
    // ⚠️ Los ids de transactions son UUID ALEATORIOS. Ordenar por `id` (como
    // antes) devolvía 200 filas en orden lexicográfico de UUID = aleatorio en el
    // tiempo: al pasar de 200 transacciones, las SOLICITUDES NUEVAS (rail_move a
    // ACH, cargas, retiros) tenían solo ~200/N de chance de venir → "no llegaban"
    // a Tesorería para aprobar. Ahora se ordena por created_at (columna indexada)
    // Y ADEMÁS se traen SIEMPRE todas las pendientes, sin que el tope las tape.
    const [usersRes, txRes, pendingRes] = await Promise.all([
      db.from('users').select('*'),
      db.from('transactions').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('transactions').select('*').eq('status', 'Pendiente').order('created_at', { ascending: false }).limit(500),
    ])

    // Une recientes + pendientes, deduplicando por id (una pendiente reciente
    // aparece en ambas — se conserva una sola vez).
    const txById = new Map<string, Record<string, unknown>>()
    for (const t of (txRes.data ?? [])) txById.set(String((t as any).id), t)
    for (const t of (pendingRes.data ?? [])) txById.set(String((t as any).id), t)
    const allTx = Array.from(txById.values())

    const payload = {
      // Usuarios: solo se quitan blobs base64 gigantes (>20 KB) — los campos
      // normales (contactos, wallets, notificaciones) pasan intactos.
      users:        (usersRes.data ?? []).map((u: Record<string, unknown>) => ({ ...u, raw_data: slimRawData(u.raw_data, 20000) })),
      transactions: allTx.map((t: Record<string, unknown>) => ({ ...t, raw_data: slimRawData(t.raw_data) })),
    }
    const body = JSON.stringify(payload)
    console.log(`[admin-data] respuesta: ${payload.users.length} usuarios, ${payload.transactions.length} tx, ${(body.length / 1024).toFixed(0)} KB`)
    return new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
