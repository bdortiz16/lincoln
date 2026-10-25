import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mergeRaw } from '../_shared/raw-data.ts'
import { reclamarCandado, soltarCandado } from '../_shared/candado.ts'
import { FIELD_ENC_KEY, encField, decField, keyFp, KeyMismatchError } from '../_shared/field-crypto.ts'
import { liquidacionDe, type CierreOtc } from '../_shared/liquidacion-lincoin.ts'
import { CUPO_DEF, TIPOS_DOC_CUPO, cupoGeneral, claveBeneficiario, clavesBeneficiario, cupoVigente, tipoCupo, enviosDelMes, usadoPara, normDoc, type EnvioMes } from '../_shared/cupos.ts'
import { leerPorPaginas } from '../_shared/paginas.ts'

// La librería de passkeys se carga SOLO cuando se usa. Con un import normal,
// un tropiezo del CDN al arrancar tumbaría la función entera —y con ella el
// panel y el 2FA de todos los clientes— por una funcionalidad que casi nunca
// se toca. Así, si falla, solo falla el passkey.
let webauthnMod: any = null
async function webauthn(): Promise<any> {
  if (!webauthnMod) webauthnMod = await import('https://esm.sh/@simplewebauthn/server@13.3.3')
  return webauthnMod
}

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
const esCopMon = (m: unknown) => /^COP/i.test(String(m ?? ''))
// Texto del cliente dentro de un correo en HTML: escapado, para que un nombre
// no pueda meter enlaces ni etiquetas en un correo que sale de Lincoin.
const escHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch])

// Lo que NUNCA viaja al navegador del panel: material de 2FA y de acceso de
// cada cuenta. Antes la descarga general lo mandaba entero a cualquier rol
// —también a "Solo lectura"— y el panel lo guardaba en el navegador: hashes
// de códigos de respaldo, secretos TOTP (cifrados o, en cuentas viejas, en
// claro), el hash del código del correo y el de la contraseña vieja. Es el
// mismo material que permitió el ingreso de septiembre de 2026.
// mfaEnabled sí viaja: el panel muestra si la cuenta tiene 2FA.
const CLAVES_CREDENCIALES = ['mfaBackupHashes', 'totpSecret', 'totpSecretEnc', 'otp', 'passwordHash', 'mfaSessions', 'mfaLastCounter', 'mfaFactorId', 'trustedDevices', 'passkeys']
function sinCredenciales(rd: unknown): unknown {
  if (!rd || typeof rd !== 'object') return rd
  const out = { ...(rd as Record<string, unknown>) }
  for (const k of CLAVES_CREDENCIALES) delete out[k]
  return out
}

function slimRawData(rd: unknown, limit = 2000): unknown {
  if (!rd || typeof rd !== 'object') return rd
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rd as Record<string, unknown>)) {
    out[k] = (typeof v === 'string' && (v.startsWith('data:') || v.length > limit)) ? PROOF_MARKER : v
  }
  return out
}

// ── Usuarios para el panel ────────────────────────────────────────────────
// Lo que viaja al navegador del admin: sin los hashes de clave/PIN ni el
// secreto 2FA de columna, y sin los blobs gigantes de raw_data.
const COLUMNAS_QUE_NO_VIAJAN = ['password_hash', 'pin_hash', 'two_factor_secret']
function usuarioParaPanel(u: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = { ...u, raw_data: sinCredenciales(slimRawData(u.raw_data, 20000)) }
  for (const k of COLUMNAS_QUE_NO_VIAJAN) delete o[k]
  return o
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idsValidos = (v: unknown, tope: number): string[] =>
  Array.from(new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(x => UUID_RE.test(x)))).slice(0, tope)

// Usuarios por id, en tandas: un .in() con cientos de ids arma una URL que
// PostgREST rechaza.
async function usuariosPorId(ids: string[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('users').select('*').in('id', ids.slice(i, i + 150))
    out.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return out
}

// Lo que Lincoin les debe a los clientes en cada moneda (suma de saldos de
// todos menos el equipo). Lo suma la base (admin_obligaciones); si esa
// función todavía no existe se suma aquí por páginas, con tope, y se avisa
// que es parcial. Sumarlo en el navegador con la lista del panel daba de
// menos en silencio apenas había más de 1.000 cuentas.
let obligacionesRespaldo: { at: number; valor: Record<string, number>; parcial: boolean } | null = null
async function obligacionesTodas(): Promise<{ valor: Record<string, number>; parcial: boolean } | null> {
  const { data, error } = await db.rpc('admin_obligaciones')
  if (!error && data && typeof data === 'object') {
    const valor: Record<string, number> = {}
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) valor[k] = Number(v) || 0
    return { valor, parcial: false }
  }
  if (obligacionesRespaldo && Date.now() - obligacionesRespaldo.at < 120_000) return obligacionesRespaldo
  const valor: Record<string, number> = {}
  let parcial = false
  for (let off = 0; ; off += 1000) {
    if (off >= 30000) { parcial = true; break }
    const { data: filas, error: e2 } = await db.from('users').select('id, role, balances, crypto_balances').order('id').range(off, off + 999)
    if (e2) return null
    for (const f of (filas ?? []) as any[]) {
      if (f.role === 'admin') continue
      const b = { ...(f.balances && typeof f.balances === 'object' ? f.balances : {}), ...(f.crypto_balances && typeof f.crypto_balances === 'object' ? f.crypto_balances : {}) }
      for (const [k, v] of Object.entries(b)) { const n = Number(v); if (isFinite(n)) valor[k] = (valor[k] ?? 0) + n }
    }
    if (!filas || filas.length < 1000) break
  }
  obligacionesRespaldo = { at: Date.now(), valor, parcial }
  return obligacionesRespaldo
}

// Cifrado de campos sensibles: la implementación vive en _shared para que
// NO pueda volver a haber tres copias que se desincronicen.

// ── Códigos de respaldo ───────────────────────────────────────────────────
// Se guardan HASHEADOS, no cifrados. Un hash no depende de ninguna llave, así
// que aunque FIELD_ENC_KEY cambie o se pierda, estos códigos SIEMPRE siguen
// sirviendo para entrar.
//
// INCIDENTE DE SEPTIEMBRE 2026 — por qué ya no es un SHA-256 a secas:
// mientras public.users fue legible para cualquier sesión, alguien copió los
// hashes de respaldo de la cuenta admin. Eran SHA-256 sin sal de un código de
// 8 símbolos sobre 32 posibles (2^40): una tarjeta gráfica los rompe en
// minutos. El 5 de septiembre entraron al panel con dos de esos códigos.
//
// Ahora: el código tiene 10 símbolos (2^50) y el hash es PBKDF2-SHA256 con
// sal propia y 150.000 vueltas. Romper UN código por fuerza bruta pasa de
// minutos a siglos. Los hashes viejos (64 hex) se siguen reconociendo para
// no dejar a nadie afuera, pero el tablero de seguridad pide regenerarlos.
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // sin O/0/I/1
const BACKUP_LEN = 10
const BACKUP_ITER = 150_000
function normalizeBackup(c: string): string {
  return String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map(h => parseInt(h, 16)))
async function pbkdf2Backup(code: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('lincoin-backup:' + normalizeBackup(code)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256)
  return hex(bits)
}
async function hashBackup(code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${BACKUP_ITER}$${hex(salt)}$${await pbkdf2Backup(code, salt, BACKUP_ITER)}`
}
// Hash del formato viejo (SHA-256 sin sal). Solo para RECONOCER los que ya
// existen; nunca se vuelve a generar uno así.
async function hashBackupLegacy(code: string): Promise<string> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lincoin-backup:' + normalizeBackup(code)))
  return hex(raw)
}
const esHashLegacy = (h: string) => /^[0-9a-f]{64}$/i.test(String(h ?? ''))
// Devuelve la posición del hash que corresponde al código, o -1.
async function matchBackup(code: string, hashes: string[]): Promise<number> {
  let legacy: string | null = null
  for (let i = 0; i < hashes.length; i++) {
    const h = String(hashes[i] ?? '')
    if (esHashLegacy(h)) {
      legacy ??= await hashBackupLegacy(code)
      if (h.toLowerCase() === legacy) return i
      continue
    }
    const partes = h.split('$')
    if (partes.length !== 4 || partes[0] !== 'pbkdf2') continue
    const iter = parseInt(partes[1], 10)
    if (!(iter > 0) || !/^[0-9a-f]{32}$/i.test(partes[2])) continue
    if ((await pbkdf2Backup(code, unhex(partes[2]), iter)) === partes[3].toLowerCase()) return i
  }
  return -1
}
function newBackupCodes(n = 8): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(BACKUP_LEN))
    const s = Array.from(bytes).map(b => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join('')
    out.push(s.slice(0, BACKUP_LEN / 2) + '-' + s.slice(BACKUP_LEN / 2))
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

// Escalones del ingreso, en orden:
//   'email' = pasó el código del correo
//   'app'   = pasó además el código de la app, pero le falta la llave
//   'full'  = pasó TODO lo que su cuenta exige
// Solo 'full' habilita la sesión, así el orden no se puede saltar mandando
// directamente el último paso.
async function rememberMfaSession(req: Request, userId: string, stage: 'email' | 'app' | 'full' = 'full') {
  const sid = sessionIdOf(req)
  if (!sid) return
  try {
    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
    const raw = { ...((u as any)?.raw_data ?? {}) }
    const list: any[] = Array.isArray(raw.mfaSessions) ? raw.mfaSessions : []
    const rest = list.filter((x: any) => x?.sid !== sid)
    raw.mfaSessions = [{ sid, at: new Date().toISOString(), stage }, ...rest].slice(0, 5)
    await mergeRaw(db, userId, { mfaSessions: raw.mfaSessions })
  } catch { /* si no se puede anotar, la acción sensible pedirá 2FA de nuevo */ }
}

// ¿Esta sesión ya superó el código del CORREO (primer paso)? Vale 15 minutos.
async function emailStagePassed(req: Request, userId: string): Promise<boolean> {
  const sid = sessionIdOf(req)
  if (!sid) return true   // token sin claim de sesión: no se puede distinguir
  try {
    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
    const list: any[] = Array.isArray((u as any)?.raw_data?.mfaSessions) ? (u as any).raw_data.mfaSessions : []
    const hit = list.find((x: any) => x?.sid === sid && ['email', 'app', 'full'].includes(String(x?.stage)))
    return !!hit && (Date.now() - new Date(hit.at).getTime() < 15 * 60_000)
  } catch { return false }
}

// ¿Esta sesión ya pasó el código de la APP? Es lo que la llave exige tener
// atrás: sin esto, quien tuviera la llave entraría saltándose el 2FA.
async function appStagePassed(req: Request, userId: string): Promise<boolean> {
  const sid = sessionIdOf(req)
  if (!sid) return true   // token sin claim de sesión: no se puede distinguir
  try {
    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
    const list: any[] = Array.isArray((u as any)?.raw_data?.mfaSessions) ? (u as any).raw_data.mfaSessions : []
    const hit = list.find((x: any) => x?.sid === sid && ['app', 'full'].includes(String(x?.stage)))
    return !!hit && (Date.now() - new Date(hit.at).getTime() < 15 * 60_000)
  } catch { return false }
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
    const hit = list.find((x: any) => x?.sid === sid && (x?.stage ?? 'full') === 'full')
    if (!hit) return 'Esta sesión no verificó el segundo factor. Vuelve a iniciar sesión e ingresa tu código.'
    if (Date.now() - new Date(hit.at).getTime() > MFA_SESSION_TTL_MS) {
      return 'La verificación en dos pasos de esta sesión venció. Vuelve a iniciar sesión.'
    }
    return null
  } catch {
    // Si no se pudo comprobar, NO se deja pasar: una acción sensible con el
    // 2FA sin verificar es peor que pedir que se reintente.
    return 'No pudimos comprobar la verificación en dos pasos. Intenta de nuevo.'
  }
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
  // Dos operaciones con el MISMO código a la vez leían el contador viejo y
  // pasaban las dos: el candado deja una sola.
  if ((await reclamarCandado(db, `totp:${adminUserId}:${counter}`, 600, adminUserId, 'admin_otp')) === 'ocupado') return 'Ese código ya se usó. Espera al siguiente que muestre tu app.'
  await mergeRaw(db, adminUserId, { mfaLastCounter: counter })
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
// ── Reverso de un cargue con un ajuste ─────────────────────────────────
// Un cargue hecho por error se corrige con un DÉBITO (ajuste). Sin vincularlos,
// el cargue seguía sumando en "cargado" y su utilidad en la de Lincoin (y se
// facturaba), y el débito quedaba suelto: descuadre. Vinculado, el cargue
// guarda raw_data.reverso = { ajustes, montoCop, anulado } y el ajuste
// raw_data.reversaDe = id del cargue. Si el débito cubre todo lo acreditado
// el cargue queda ANULADO; si cubre una parte, se corrige en proporción
// (liquidacionDe en _shared/liquidacion-lincoin.ts).
async function idsMismaPersona(userId: string): Promise<string[]> {
  const { data: u } = await db.from('users').select('email').eq('id', userId).maybeSingle()
  if (!(u as any)?.email) return [userId]
  const { data: h } = await db.from('users').select('id').eq('email', (u as any).email)
  return Array.from(new Set([userId, ...((h ?? []) as any[]).map(x => String(x.id))]))
}
async function vincularAjuste(ajusteId: string, cargueId: string | null, adminId: string | null, auto = false): Promise<{ ok: true; aviso?: string; anulado?: boolean } | { ok: false; error: string; status: number }> {
  const { data: aj } = await db.from('transactions').select('id, user_id, type, amount, currency, status, created_at, raw_data').eq('id', ajusteId).maybeSingle()
  if (!aj || (aj as any).type !== 'adjustment') return { ok: false, error: 'No se encontró ese ajuste.', status: 404 }
  const a = aj as any
  const rdA = (a.raw_data ?? {}) as Record<string, any>
  if (String(rdA.direction ?? 'debit') !== 'debit') return { ok: false, error: 'Solo un débito revierte un cargue.', status: 400 }
  const ahora = new Date().toISOString()
  const OTRO_CAMBIO = { ok: false as const, error: 'Otro cambio se hizo al mismo tiempo sobre este cargue. Recarga e intenta de nuevo.', status: 409 }
  // Escritura CONDICIONADA del cargue: solo si su reverso sigue como lo
  // leímos (vinculadoAt cambia en cada escritura y hace de versión). Antes se
  // leía y se reescribía sin condición: dos vínculos a la vez se pisaban, uno
  // de los ajustes se perdía o el total pasaba de lo acreditado.
  const escribirCargue = async (cId: string, rdPrevio: Record<string, any>, rdNuevo: Record<string, any>): Promise<boolean> => {
    const version = rdPrevio?.reverso?.vinculadoAt
    let q = db.from('transactions').update({ raw_data: rdNuevo }).eq('id', cId)
    q = version ? q.filter('raw_data->reverso->>vinculadoAt', 'eq', String(version)) : q.filter('raw_data->>reverso', 'is', null)
    const { data } = await q.select('id')
    return Array.isArray(data) && data.length > 0
  }
  const quitarDe = async (cId: string): Promise<boolean> => {
    const { data: c } = await db.from('transactions').select('id, amount, raw_data').eq('id', cId).maybeSingle()
    if (!c) return true
    const rdC = ((c as any).raw_data ?? {}) as Record<string, any>
    const lista: any[] = Array.isArray(rdC.reverso?.ajustes) ? rdC.reverso.ajustes.filter((x: any) => String(x?.id) !== String(a.id)) : []
    const { reverso: _r, ...resto } = rdC
    const credit = Number(rdC.acct?.creditedCop ?? (c as any).amount) || 0
    const monto = lista.reduce((s, x) => s + (Number(x?.montoCop) || 0), 0)
    return await escribirCargue(cId, rdC, lista.length ? { ...resto, reverso: { ...rdC.reverso, ajustes: lista, montoCop: monto, anulado: credit > 0 ? monto >= credit - 1 : false, vinculadoAt: ahora } } : resto)
  }
  if (!cargueId) {
    // Desvincular a mano = "este débito NO revierte ese cargue". Queda
    // anotado (noRevierte) para que el vínculo automático no lo vuelva a
    // pegar en la próxima recarga de Contabilidad.
    if (rdA.reversaDe && !(await quitarDe(String(rdA.reversaDe)))) return OTRO_CAMBIO
    const { reversaDe: _x, reversaAuto: _y, ...restoA } = rdA
    await db.from('transactions').update({ raw_data: { ...restoA, noRevierte: true, noRevierteAt: ahora, noRevierteBy: adminId } }).eq('id', a.id)
    return { ok: true }
  }
  if (rdA.reversaDe && String(rdA.reversaDe) !== cargueId) return { ok: false, error: 'Este ajuste ya está vinculado a otro cargue. Desvincúlalo primero.', status: 409 }
  const { data: cg } = await db.from('transactions').select('id, user_id, type, amount, currency, status, created_at, raw_data').eq('id', cargueId).maybeSingle()
  const c = cg as any
  const rdC = (c?.raw_data ?? {}) as Record<string, any>
  if (!c || c.type !== 'load' || !['admin_cargue', 'admin_backfill'].includes(String(rdC.source ?? ''))) return { ok: false, error: 'No se encontró ese cargue.', status: 404 }
  if (String(c.currency) !== String(a.currency)) return { ok: false, error: `El cargue es en ${c.currency} y el ajuste en ${a.currency}: un débito solo revierte un cargue del mismo saldo.`, status: 400 }
  const misIds = await idsMismaPersona(String(c.user_id))
  if (!misIds.includes(String(a.user_id))) return { ok: false, error: 'El ajuste y el cargue son de clientes distintos.', status: 400 }
  const credit = Number(rdC.acct?.creditedCop ?? c.amount) || 0
  const otros: any[] = Array.isArray(rdC.reverso?.ajustes) ? rdC.reverso.ajustes.filter((x: any) => String(x?.id) !== String(a.id)) : []
  const monto = otros.reduce((s, x) => s + (Number(x?.montoCop) || 0), 0) + (Number(a.amount) || 0)
  if (monto > credit + 1) return { ok: false, error: `Con este ajuste se revertirían $${Math.round(monto).toLocaleString('es-CO')} de un cargue de $${Math.round(credit).toLocaleString('es-CO')}. Elegí otro cargue.`, status: 400 }
  const anulado = monto >= credit - 1
  // Primero se RESERVA el ajuste (solo si sigue suelto o ya era de este
  // cargue): el mismo débito no puede quedar en dos cargues a la vez.
  const { noRevierte: _n, noRevierteAt: _na, noRevierteBy: _nb, ...rdALimpio } = rdA
  const { data: reservado } = await db.from('transactions')
    .update({ raw_data: { ...rdALimpio, reversaDe: String(c.id), reversaAuto: auto } })
    .eq('id', a.id).or(`raw_data->>reversaDe.is.null,raw_data->>reversaDe.eq.${String(c.id)}`).select('id')
  if (!Array.isArray(reservado) || !reservado.length) return OTRO_CAMBIO
  const okC = await escribirCargue(String(c.id), rdC, { ...rdC, reverso: { ajustes: [...otros, { id: a.id, montoCop: Number(a.amount) || 0, at: a.created_at, ...(auto ? { auto: true } : {}) }], montoCop: monto, anulado, vinculadoPor: adminId, vinculadoAt: ahora } })
  if (!okC) {
    // El cargue cambió en el medio: se suelta el ajuste como estaba.
    await db.from('transactions').update({ raw_data: rdA }).eq('id', a.id)
    return OTRO_CAMBIO
  }
  // ¿Ya tenía factura de Lincoin? Eso no se deshace solo: hay que anularla o
  // emitir una nota crédito en Siigo.
  let aviso: string | undefined
  try {
    const { data: f } = await db.from('facturas_lincoin').select('estado, numero').eq('transaction_id', String(c.id)).maybeSingle()
    if ((f as any)?.estado === 'emitida') aviso = `Este cargue ya tenía la factura ${(f as any).numero ?? ''}. ${anulado ? 'Anúlala' : 'Corrígela con una nota crédito'} en Siigo.`
  } catch { /* sin tabla de facturas */ }
  return { ok: true, anulado, ...(aviso ? { aviso } : {}) }
}

// ── Vincular SOLO el débito que revierte un cargue ─────────────────────
// Cuando el operador se equivoca, acredita un cargue y después descuenta.
// Ese débito se vincula SOLO cuando no hay duda: un único cargue del mismo
// cliente y saldo, anterior al débito (hasta 60 días), al que le queda por
// revertir EXACTAMENTE el monto del débito (±1 peso) → el cargue se anula.
//
// Todo lo demás se SUGIERE y lo decide el operador: dos cargues que cuadran
// exacto (¿cuál de los dos?) o un débito menor a un cargue de las últimas 72
// horas (puede ser una corrección… o una comisión, un retiro manual). Antes
// esto último se vinculaba solo como "corrección", y un débito ajeno de 2 M
// cambiaba la utilidad y la factura de un cargue de 50 M.
async function autoVincularAjuste(aj: { id: string; user_id: string; amount: number | string; currency: string; created_at: string; noRevierte?: unknown }, adminId: string | null): Promise<{ cargueId?: string; anulado?: boolean; aviso?: string; motivo?: string }> {
  if (aj.noRevierte === true || aj.noRevierte === 'true') return { motivo: 'Marcado como un ajuste que no revierte ningún cargue.' }
  const monto = Number(aj.amount) || 0
  if (!(monto > 0)) return { motivo: 'El débito no tiene monto.' }
  const ids = await idsMismaPersona(String(aj.user_id))
  const tDebito = Date.parse(aj.created_at)
  const desde = new Date(tDebito - 60 * 86400_000).toISOString()
  const { data } = await db.from('transactions')
    .select('id, amount, created_at, acct:raw_data->acct, reverso:raw_data->reverso, source:raw_data->>source')
    .in('user_id', ids).eq('type', 'load').eq('status', 'Completado').eq('currency', aj.currency)
    .lte('created_at', aj.created_at).gte('created_at', desde)
    .order('created_at', { ascending: false }).limit(200)
  const cargues = ((data ?? []) as any[])
    .filter(c => c.source === 'admin_cargue' || c.source === 'admin_backfill')
    .map(c => { const credit = Number(c.acct?.creditedCop ?? c.amount) || 0; return { id: String(c.id), at: String(c.created_at), credit, resta: credit - (Number(c.reverso?.montoCop ?? 0) || 0) } })
    .filter(c => c.resta > 0)
  const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`
  const dia = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'America/Bogota' })
  if (!cargues.length) return { motivo: `No hay cargues de ${aj.currency} de este cliente en los 60 días anteriores al débito.` }
  const exactos = cargues.filter(c => Math.abs(c.resta - monto) <= 1)
  if (exactos.length > 1) {
    return { motivo: `Hay ${exactos.length} cargues con ${fmt(monto)} exactos por revertir (${exactos.slice(0, 3).map(c => dia(c.at)).join(', ')}): elige a mano cuál corrige.` }
  }
  if (!exactos.length) {
    const cercanos = cargues.filter(c => tDebito - Date.parse(c.at) <= 72 * 3600_000 && c.resta >= monto - 1)
    const lista = cargues.slice(0, 4).map(c => `${dia(c.at)} por ${fmt(c.resta)}`).join(', ')
    return { motivo: cercanos.length === 1
      ? `Ningún cargue tiene ${fmt(monto)} exactos. Puede ser una corrección parcial del cargue del ${dia(cercanos[0].at)} (${fmt(cercanos[0].resta)}): si lo es, vincúlalo a mano.`
      : cercanos.length > 1
        ? `Ningún cargue tiene ${fmt(monto)} exactos y hay ${cercanos.length} cargues en las 72 horas anteriores que podrían ser: elígelo a mano.`
        : `Ningún cargue de los 60 días anteriores tiene ${fmt(monto)} por revertir. Los más cercanos: ${lista}.` }
  }
  const r = await vincularAjuste(String(aj.id), exactos[0].id, adminId, true)
  if ('error' in r) return { motivo: r.error }
  return { cargueId: exactos[0].id, anulado: r.anulado, ...(r.aviso ? { aviso: r.aviso } : {}) }
}

// Los débitos sueltos (de antes de que existiera el vínculo), de un cliente o
// de todos, por páginas: antes se tomaban los 300 ajustes más nuevos ANTES de
// descartar los ya vinculados, y los débitos viejos nunca se revisaban.
async function autoVincularPendientes(userIds: string[] | null, adminId: string | null): Promise<{ revisados: number; vinculados: number; avisos: string[]; sinVincular: { id: string; monto: number; motivo: string }[] }> {
  const filas: any[] = []
  for (let off = 0; off < 20000; off += 1000) {
    let q = db.from('transactions')
      .select('id, user_id, amount, currency, created_at, reversaDe:raw_data->>reversaDe, direction:raw_data->>direction, noRevierte:raw_data->noRevierte')
      .eq('type', 'adjustment').eq('status', 'Completado')
      .filter('raw_data->>reversaDe', 'is', null)
    if (userIds) q = q.in('user_id', userIds)
    const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(off, off + 999)
    if (error) break
    filas.push(...((data ?? []) as any[]))
    if (!data || data.length < 1000) break
  }
  // Del más viejo al más nuevo: un cargue con dos débitos se revierte en orden.
  const sueltos = filas.filter(a => !a.reversaDe && String(a.direction ?? 'debit') === 'debit' && a.noRevierte !== true)
  const out = { revisados: sueltos.length, vinculados: 0, avisos: [] as string[], sinVincular: [] as { id: string; monto: number; motivo: string }[] }
  for (const a of sueltos) {
    const r = await autoVincularAjuste(a, adminId)
    if (r.cargueId) { out.vinculados++; if (r.aviso) out.avisos.push(r.aviso) }
    else out.sinVincular.push({ id: String(a.id), monto: Number(a.amount) || 0, motivo: r.motivo ?? '' })
  }
  return out
}

// ── Cupo mensual por beneficiario: el estado de cada contacto ─────────────
// La misma cuenta que aplica mouv-proxy al enviar (_shared/cupos.ts).
type EstadoCupo = { clave: string; claves: string[]; tipo: 'persona' | 'empresa'; cupo: number; usado: number; disponible: number; origen: 'general' | 'aprobado'; nombre: string; doc: string; destinos: string[] }
function estadoCupoContacto(c: any, contactos: any[], envios: EnvioMes[], general: { persona: number; empresa: number }, aprobados: Map<string, number>): EstadoCupo {
  const doc = normDoc(c?.docNumber)
  const mismos = doc ? contactos.filter(x => normDoc(x?.docNumber) === doc) : [c]
  const destinos = mismos.flatMap(x => [x?.brebKey, x?.accountNumber]).filter(Boolean).map(String)
  const clave = claveBeneficiario(doc, c?.brebKey ?? c?.accountNumber)
  // Todas las claves con que se pudo pedir o aprobar el cupo (documento y
  // cada destino): las mismas que busca mouv-proxy al enviar.
  const claves = clavesBeneficiario(doc, destinos)
  // "Empresa" solo si además el documento tiene forma de NIT de empresa: la
  // ficha la escribe el cliente (misma regla que aplica el envío).
  const declarado = (String(c?.kind ?? '') === 'empresa' || /^NIT$/i.test(String(c?.docType ?? ''))) ? 'empresa' : 'persona'
  const tipo = tipoCupo(declarado, doc)
  let aprobado: number | null = null
  for (const k of claves) { const n = aprobados.get(k); if (n != null && (aprobado == null || n > aprobado)) aprobado = n }
  const cupo = cupoVigente(aprobado, general[tipo])
  const usado = usadoPara(envios, doc, destinos)
  return { clave, claves, tipo, cupo, usado, disponible: Math.max(0, cupo - usado), origen: cupo > general[tipo] ? 'aprobado' : 'general', nombre: String(c?.name ?? c?.holderName ?? '').trim(), doc, destinos }
}
// Los cupos aprobados de la PERSONA (todas sus cuentas del mismo correo): el
// uso se suma por persona, la aprobación también vale por persona.
async function cuposAprobadosDe(userId: string): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  try {
    const ids = await idsMismaPersona(userId)
    const { data } = await db.from('cupos_beneficiario').select('beneficiario_clave, cupo_mensual').in('user_id', ids)
    for (const r of (data ?? []) as any[]) {
      const n = Number(r.cupo_mensual), k = String(r.beneficiario_clave)
      if (n > 0 && (!m.has(k) || n > (m.get(k) as number))) m.set(k, n)
    }
  } catch { /* sin tabla: rige el general */ }
  return m
}
const esTipoDocCupo = (t: string) => Object.prototype.hasOwnProperty.call(TIPOS_DOC_CUPO, t)
const BUCKET_CUPOS = 'cupo-documentos'
const MIME_CUPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']

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

// ── Passkey (WebAuthn) ───────────────────────────────────────────────────
// La llave vive dentro del dispositivo (Face ID, huella, o una llave USB) y
// NUNCA sale de él: el navegador solo devuelve una firma. Por eso no se puede
// fotografiar, ni copiar del portapapeles, ni escribir en una página falsa —
// la firma está atada al dominio real, así que una copia de lincoin.me no
// sirve. Es la única defensa que aguanta que el atacante tenga la contraseña,
// el 2FA y los códigos de respaldo.
//
// Las credenciales se guardan en system_config (solo service_role), no en el
// perfil: ni un admin autenticado las toca desde el navegador.
const RP_ID = Deno.env.get('PASSKEY_RP_ID') ?? 'lincoin.me'
const RP_NAME = 'Lincoin'
const ORIGENES = (Deno.env.get('PASSKEY_ORIGINS') ?? 'https://lincoin.me,https://www.lincoin.me')
  .split(',').map(o => o.trim()).filter(Boolean)

function passkeyKey(userId: string) { return `passkeys_${userId}` }
function challengeKey(userId: string) { return `passkey_challenge_${userId}` }

type Passkey = { id: string; publicKey: string; counter: number; nombre: string; at: string }

async function passkeysDe(userId: string): Promise<Passkey[]> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', passkeyKey(userId)).single()
    return data?.value ? JSON.parse(data.value) : []
  } catch { return [] }
}
async function guardarPasskeys(userId: string, list: Passkey[]) {
  await db.from('system_config').upsert({ key: passkeyKey(userId), value: JSON.stringify(list.slice(0, 10)) }, { onConflict: 'key' })
}

// El desafío se guarda en la base porque las edge functions no comparten
// memoria entre invocaciones: lo que se genera en una petición tiene que
// poder comprobarse en la siguiente. Vive 5 minutos y es de un solo uso.
async function guardarChallenge(userId: string, challenge: string) {
  await db.from('system_config').upsert({
    key: challengeKey(userId),
    value: JSON.stringify({ challenge, exp: Date.now() + 5 * 60_000 }),
  }, { onConflict: 'key' })
}
async function tomarChallenge(userId: string): Promise<string | null> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', challengeKey(userId)).single()
    if (!data?.value) return null
    const c = JSON.parse(data.value)
    await db.from('system_config').delete().eq('key', challengeKey(userId))   // un solo uso
    if (!c?.challenge || Date.now() > Number(c.exp ?? 0)) return null
    return String(c.challenge)
  } catch { return null }
}

// ── Verificación reforzada ───────────────────────────────────────────────
// Que la sesión haya pasado el 2FA AL ENTRAR no alcanza para lo que mueve
// dinero. Una sesión abierta hace horas —o robada— sigue siendo válida. Esto
// exige volver a probar los factores AHORA, con vencimiento corto:
//
//   · el código del correo   (siempre)
//   · el código de la app    (siempre)
//   · la llave del dispositivo (solo si la cuenta tiene alguna registrada)
//
// Se anota por SESIÓN, no por cuenta: verificar en el computador no habilita
// el teléfono. Vive en system_config y no en el perfil, para no pelear con
// las escrituras de raw_data.
const STEP_UP_TTL_MS = 30 * 60_000
function stepUpKey(userId: string) { return `stepup_${userId}` }
type StepUpSesion = { email?: number; app?: number; passkey?: number }

async function leerStepUp(userId: string): Promise<Record<string, StepUpSesion>> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', stepUpKey(userId)).single()
    return data?.value ? JSON.parse(data.value) : {}
  } catch { return {} }
}

// Si el token no trae id de sesión (GoTrue antiguo), se anota bajo una clave
// común en vez de descartar la marca. Queda más flojo —no distingue
// dispositivos— pero no deja al titular dando vueltas verificando algo que
// nunca se guarda, que es la única falla peor que la anterior.
const SIN_SESION = '__sin_sesion__'

async function marcarFactor(req: Request, userId: string, factor: 'email' | 'app' | 'passkey') {
  const sid = sessionIdOf(req) ?? SIN_SESION
  try {
    const todo = await leerStepUp(userId)
    const vivas: Record<string, StepUpSesion> = {}
    // Se descartan las sesiones cuyos factores ya vencieron: sin esta poda la
    // fila crecería sola con cada dispositivo que alguna vez entró.
    for (const [s, v] of Object.entries(todo)) {
      const ult = Math.max(Number(v?.email ?? 0), Number(v?.app ?? 0), Number(v?.passkey ?? 0))
      if (Date.now() - ult < STEP_UP_TTL_MS) vivas[s] = v
    }
    vivas[sid] = { ...(vivas[sid] ?? {}), [factor]: Date.now() }
    await db.from('system_config').upsert({ key: stepUpKey(userId), value: JSON.stringify(vivas) }, { onConflict: 'key' })
  } catch { /* si no se puede anotar, la acción sensible vuelve a pedirlo */ }
}

// ── Cierre por inactividad ───────────────────────────────────────────────
// El panel se cierra solo a la media hora sin uso. El navegador lo hace por
// su cuenta, pero eso es solo la pantalla: quien tenga el token guardado
// podría seguir llamando la API con la sesión "cerrada". Por eso el corte
// vive TAMBIÉN aquí, que es donde de verdad importa.
//
// Para no escribir en la base en cada petición, la marca de "visto" se
// refresca cada 5 minutos como mucho. El navegador manda una señal cuando
// hay actividad pero no llamadas —alguien leyendo una pantalla quieta— para
// que estar trabajando no cuente como estar ausente.
const IDLE_MAX_MS = 30 * 60_000
const IDLE_WRITE_MS = 5 * 60_000
function actividadKey(userId: string) { return `actividad_${userId}` }

async function sesionInactiva(req: Request, userId: string): Promise<boolean> {
  const sid = sessionIdOf(req) ?? SIN_SESION
  const ahora = Date.now()
  try {
    const { data } = await db.from('system_config').select('value').eq('key', actividadKey(userId)).single()
    const todo: Record<string, number> = data?.value ? JSON.parse(data.value) : {}
    const visto = Number(todo[sid] ?? 0)
    if (visto && ahora - visto > IDLE_MAX_MS) return true
    if (!visto || ahora - visto > IDLE_WRITE_MS) {
      const vivas: Record<string, number> = {}
      for (const [s, t] of Object.entries(todo)) if (ahora - Number(t) < IDLE_MAX_MS) vivas[s] = Number(t)
      vivas[sid] = ahora
      await db.from('system_config').upsert({ key: actividadKey(userId), value: JSON.stringify(vivas) }, { onConflict: 'key' })
    }
    return false
  } catch {
    // Si no se puede leer la marca, NO se echa a nadie: dejar al titular sin
    // panel por un fallo de la base es peor que media hora de más.
    return false
  }
}

// Qué factores le FALTAN a esta sesión para operar. Vacío = puede seguir.
async function stepUpFalta(req: Request, userId: string): Promise<string[]> {
  const sid = sessionIdOf(req) ?? SIN_SESION
  const vigente = (t: unknown) => !!t && (Date.now() - Number(t) < STEP_UP_TTL_MS)
  const tienePasskey = (await passkeysDe(userId)).length > 0
  // El código de la app solo se puede exigir si la cuenta TIENE 2FA activo.
  // Pedirlo cuando no lo hay dejaba un candado imposible de abrir: la pantalla
  // pedía un código que ninguna app estaba generando.
  let tiene2fa = false
  try {
    const { data } = await db.from('users').select('raw_data').eq('id', userId).single()
    tiene2fa = !!(data as any)?.raw_data?.mfaEnabled
  } catch { /* si no se puede saber, no se exige */ }
  const est: StepUpSesion = (await leerStepUp(userId))[sid] ?? {}
  const falta: string[] = []
  // El del correo es el piso: se pide siempre, haya o no 2FA y haya o no llave.
  if (!vigente(est.email)) falta.push('email')
  if (tiene2fa && !vigente(est.app)) falta.push('app')
  if (tienePasskey && !vigente(est.passkey)) falta.push('passkey')
  return falta
}

// La llave pública es binaria; se guarda en base64url para que quepa en el
// JSON de system_config y vuelva a salir idéntica.
function bytesAB64u(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64uABytes(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── Bloqueo de la cuenta de admin tras intentos fallidos ─────────────────
// A los 2 fallos la cuenta queda bloqueada y se avisa al titular por correo
// con quién lo intentó (IP, ubicación aproximada, dispositivo, hora) y un
// enlace para desbloquearla. El estado vive en system_config, no en el perfil:
// así ni siquiera un admin autenticado puede quitárselo desde el navegador.
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'no-reply@lincoin.me'
const MAX_FALLOS_ADMIN = 2

function lockKey(userId: string) { return `admin_lock_${userId}` }

// ── ¿Esta cuenta es la del panel? ────────────────────────────────────────
// TODO lo que sigue —lista blanca de país/IP, bloqueo a los 2 fallos, foto,
// correo de alerta— es blindaje del PANEL DE ADMINISTRACIÓN. Los clientes
// comparten los mismos endpoints de 2FA, así que sin esta pregunta el
// blindaje les caía encima a ellos: un cliente en México quedaba fuera por
// la lista blanca, y a los dos códigos errados le salía "la cuenta se
// bloqueó" aunque nada se hubiera bloqueado. Se pregunta una sola vez por
// invocación y se recuerda.
const cacheRol = new Map<string, boolean>()
async function esAdminUid(userId: string): Promise<boolean> {
  if (!userId) return false
  const y = cacheRol.get(userId)
  if (y !== undefined) return y
  try {
    const { data } = await db.from('users').select('role').eq('id', userId).single()
    const r = (data as any)?.role === 'admin'
    cacheRol.set(userId, r)
    return r
  } catch { return false }
}

// La lista blanca solo se aplica a la cuenta del panel. Para un cliente
// siempre devuelve null: su 2FA no depende de desde qué país se conecte.
async function accessDeniedAdmin(req: Request, userId: string): Promise<string | null> {
  if (!(await esAdminUid(userId))) return null
  return await accessDenied(req)
}

// Registra un fallo de verificación y BLOQUEA al llegar al tope. Es el único
// sitio que cuenta: antes el conteo estaba repartido entre el paso del correo,
// el de la app y el de respaldo, cada uno con su propia cuenta, y solo uno
// disparaba el bloqueo — fallar cuatro veces el primero no bloqueaba nada.
//
// Devuelve si la cuenta QUEDÓ bloqueada de verdad, no si se llegó al número.
// Antes devolvía solo el conteo y quien llamaba concluía "bloqueada" con
// n >= 2 — para un cliente eso era mentira: nunca se escribía el bloqueo,
// pero se le mostraba la pantalla de cuenta bloqueada.
// Los fallos de verificación de UNA cuenta desde `desdeIso`, contando solo
// los posteriores a su último acierto. Se filtra EN LA CONSULTA (por usuario)
// y del más nuevo al más viejo: antes se traían 200-300 fallos de TODAS las
// cuentas, sin orden, y se filtraba después — con volumen, los de esta cuenta
// quedaban fuera de la muestra y el límite de intentos no frenaba nada.
//
// Un acierto ya no BORRA los fallos (se perdía la evidencia en la auditoría):
// deja una marca 'auth.mfa_reset' y se cuenta desde ahí.
async function fallosRecientes(userId: string, desdeIso: string): Promise<{ created_at: string; metadata: any }[]> {
  let desde = desdeIso
  try {
    const { data: ok } = await db.from('audit_log').select('created_at')
      .eq('action', 'auth.mfa_reset').contains('metadata', { userId }).gte('created_at', desdeIso)
      .order('created_at', { ascending: false }).limit(1)
    const ult = String(((ok ?? []) as any[])[0]?.created_at ?? '')
    if (ult && ult > desde) desde = ult
  } catch { /* sin marca: se cuenta desde el inicio de la ventana */ }
  const { data } = await db.from('audit_log').select('metadata, created_at')
    .eq('action', 'auth.mfa_failed').contains('metadata', { userId }).gt('created_at', desde)
    .order('created_at', { ascending: false }).limit(100)
  return (data ?? []) as any[]
}
async function reiniciarFallos(req: Request, userId: string) {
  await auditAdmin(req, 'auth.mfa_reset', { userId })
}

async function registerAdminFailure(
  req: Request, userId: string, motivo: string, tipo: string, foto?: string | null,
): Promise<{ fallos: number; bloqueada: boolean }> {
  await auditAdmin(req, 'auth.mfa_failed', { userId, motivo, tipo })
  try {
    if (!(await esAdminUid(userId))) return { fallos: 0, bloqueada: false }
    const desde = new Date(Date.now() - 30 * 60_000).toISOString()
    const n = (await fallosRecientes(userId, desde)).length
    if (n >= MAX_FALLOS_ADMIN) {
      const { data: uu } = await db.from('users').select('email').eq('id', userId).single()
      await lockAdminAndAlert(req, userId, String((uu as any)?.email ?? ''), motivo, foto ?? null)
      return { fallos: n, bloqueada: !!(await adminLock(userId)) }
    }
    return { fallos: n, bloqueada: false }
  } catch { return { fallos: 0, bloqueada: false } }
}

async function adminLock(userId: string): Promise<any | null> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', lockKey(userId)).single()
    return data?.value ? JSON.parse(data.value) : null
  } catch { return null }
}

async function clearAdminLock(userId: string) {
  try { await db.from('system_config').delete().eq('key', lockKey(userId)) } catch { /* */ }
}

async function sha256Hex(v: string): Promise<string> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Bloquea y avisa. 'foto' es opcional: base64 sin cabecera (JPEG).
async function lockAdminAndAlert(req: Request, userId: string, email: string, motivo: string, foto?: string | null) {
  const yaBloqueada = await adminLock(userId)
  if (yaBloqueada) return
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
  const ip = ipOf(req)
  const geo = await geoOf(ip)
  const ua = req.headers.get('user-agent') ?? 'desconocido'
  const cuando = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' })

  await db.from('system_config').upsert({
    key: lockKey(userId),
    value: JSON.stringify({ at: new Date().toISOString(), motivo, ip, geo, userAgent: ua, tokenHash: await sha256Hex(token) }),
  }, { onConflict: 'key' })
  await auditAdmin(req, 'security.admin_locked', { userId, motivo, ip })

  // La IP desde donde se intentó queda bloqueada también: sin esto, quien
  // esté probando sigue pudiendo operar contra el resto del sistema aunque la
  // cuenta esté cerrada. Se desbloquea desde Monitoreo cuando haga falta.
  if (ip) {
    try {
      const list = await blockedIps()
      if (!list.some(b => b.ip === ip)) {
        list.unshift({ ip, at: new Date().toISOString(), reason: `bloqueo de la cuenta de admin (${motivo})`, attempts: MAX_FALLOS_ADMIN, geo })
        await saveBlockedIps(list)
        await auditAdmin(req, 'auth.ip_blocked', { ip, porBloqueoDeCuenta: true })
      }
    } catch { /* el bloqueo de la cuenta no depende de esto */ }
  }

  if (!RESEND_KEY) return
  const url = `${SUPABASE_URL}/functions/v1/admin-data?action=unlock&u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`
  const fila = (k: string, v: string) =>
    `<tr><td style="padding:7px 12px;color:#878E88;font-size:13px">${k}</td><td style="padding:7px 12px;color:#F4F4F2;font-size:13px;font-weight:600">${v}</td></tr>`
  const html = `
    <div style="background:#0C0E0D;padding:28px;font-family:Archivo,system-ui,sans-serif">
      <p style="font-size:20px;font-weight:800;color:#F4F4F2;margin:0 0 4px">Lincoin<span style="color:#4ADE80">.</span></p>
      <p style="color:#F87171;font-weight:800;font-size:16px;margin:18px 0 6px">Se bloqueó el acceso al panel</p>
      <p style="color:#878E88;font-size:13px;line-height:1.6;margin:0 0 16px">
        Hubo ${MAX_FALLOS_ADMIN} intentos fallidos de ingreso. La cuenta quedó bloqueada por seguridad.
        Si fuiste tú, desbloquéala con el botón. Si no, <b style="color:#F4F4F2">no la desbloquees</b> y cambia la contraseña.
      </p>
      <table style="width:100%;background:#121413;border-radius:10px;border-collapse:collapse;margin-bottom:18px">
        ${fila('Cuándo', cuando)}
        ${fila('Motivo', motivo)}
        ${fila('IP', ip ?? 'no registrada')}
        ${fila('Ubicación aproximada', geo?.approx ?? 'no disponible')}
        ${fila('Operador', geo?.org ?? '—')}
        ${fila('Dispositivo', ua.slice(0, 90))}
        ${fila('Imagen de cámara', foto ? 'adjunta a este correo' : 'no disponible')}
      </table>
      <a href="${url}" style="display:inline-block;background:#4ADE80;color:#0C0E0D;font-weight:800;font-size:14px;text-decoration:none;padding:13px 22px;border-radius:10px">Desbloquear mi cuenta</a>
      <p style="color:rgba(244,244,242,0.45);font-size:11px;margin:18px 0 0">
        El enlace sirve una sola vez. La ubicación se deduce de la IP: llega a ciudad o región, no es una dirección exacta.
      </p>
    </div>`
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM_EMAIL}>`, to: [email],
        subject: '⚠️ Se bloqueó el acceso a tu panel de Lincoin',
        html,
        ...(foto ? { attachments: [{ filename: 'intento-de-acceso.jpg', content: foto }] } : {}),
      }),
    })
  } catch { /* el aviso nunca rompe el bloqueo */ }
}

// ── Aviso de ingreso ─────────────────────────────────────────────────────
// Cada vez que alguien entra —titular de una cuenta de cliente o el admin—
// le llega un correo con desde dónde se abrió. No impide nada por sí solo;
// lo que hace es que un ingreso ajeno se note EL MISMO DÍA en vez de
// descubrirse semanas después revisando movimientos. Es la diferencia entre
// enterarse y no enterarse.
//
// Se manda UNA VEZ POR SESIÓN: un refresco de la página no vuelve a avisar,
// pero entrar desde otro dispositivo sí.
const AVISO_LOGIN_KEY = 'aviso_login'
const AVISO_TTL_MS = 12 * 3600 * 1000

// Traduce el user-agent a algo legible. No es exacto ni pretende serlo: el
// titular necesita reconocer "mi iPhone" o "no es mío", no una ficha técnica.
function dispositivoDe(ua: string): string {
  const s = ua || ''
  const so = /iPhone/i.test(s) ? 'iPhone'
    : /iPad/i.test(s) ? 'iPad'
    : /Android/i.test(s) ? 'Android'
    : /Mac OS X|Macintosh/i.test(s) ? 'Mac'
    : /Windows/i.test(s) ? 'Windows'
    : /Linux/i.test(s) ? 'Linux' : 'dispositivo desconocido'
  const nav = /Edg\//i.test(s) ? 'Edge'
    : /OPR\/|Opera/i.test(s) ? 'Opera'
    : /Chrome\//i.test(s) ? 'Chrome'
    : /Firefox\//i.test(s) ? 'Firefox'
    : /Safari\//i.test(s) ? 'Safari' : ''
  return nav ? `${so} · ${nav}` : so
}

type ResultadoAviso = { ok: boolean; motivo: string; destino?: string }

async function avisarIngreso(req: Request, userId: string, forzar = false): Promise<ResultadoAviso> {
  const sid = sessionIdOf(req) ?? SIN_SESION
  try {
    // Dedupe por sesión: recargar la página no puede llenarle el buzón a nadie.
    const { data: prev } = await db.from('system_config').select('value').eq('key', AVISO_LOGIN_KEY).single()
    const todo: Record<string, number> = prev?.value ? JSON.parse(prev.value) : {}
    const clave = `${userId}:${sid}`
    if (!forzar && todo[clave] && Date.now() - Number(todo[clave]) < AVISO_TTL_MS) {
      return { ok: false, motivo: 'ya se avisó de esta sesión' }
    }
    const vivas: Record<string, number> = {}
    for (const [k, t] of Object.entries(todo)) if (Date.now() - Number(t) < AVISO_TTL_MS) vivas[k] = Number(t)
    vivas[clave] = Date.now()
    await db.from('system_config').upsert({ key: AVISO_LOGIN_KEY, value: JSON.stringify(vivas) }, { onConflict: 'key' })

    const { data: u } = await db.from('users').select('email, name, role, raw_data').eq('id', userId).single()
    const correo = String((u as any)?.email ?? '')
    if (!correo) return { ok: false, motivo: 'la cuenta no tiene correo registrado' }

    const ip = ipOf(req)
    const geo = await geoOf(ip)
    const ua = req.headers.get('user-agent') ?? ''
    const esAdmin = (u as any)?.role === 'admin'
    const cuando = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' })
    await auditAdmin(req, 'auth.aviso_ingreso', { userId, ip, pais: geo?.countryCode ?? null })

    if (!RESEND_KEY) return { ok: false, motivo: 'falta la llave de envío de correo en la Bóveda', destino: correo }
    const fila = (k: string, v: string) =>
      `<tr><td style="padding:7px 12px;color:#878E88;font-size:13px">${k}</td><td style="padding:7px 12px;color:#F4F4F2;font-size:13px;font-weight:600">${v}</td></tr>`
    const nombre = String((u as any)?.name ?? '').split(' ')[0] || '';
    const html = `
      <div style="background:#0C0E0D;padding:28px;font-family:Archivo,system-ui,sans-serif">
        <p style="font-size:20px;font-weight:800;color:#F4F4F2;margin:0 0 4px">Lincoin<span style="color:#4ADE80">.</span></p>
        <p style="color:#F4F4F2;font-weight:800;font-size:16px;margin:18px 0 6px">
          Se abrió tu cuenta${esAdmin ? ' de administración' : ''}
        </p>
        <p style="color:#878E88;font-size:13px;line-height:1.6;margin:0 0 16px">
          ${nombre ? `Hola ${nombre}. ` : ''}Alguien acaba de entrar a tu cuenta de Lincoin.
          Si fuiste tú, no tienes que hacer nada.
        </p>
        <table style="width:100%;background:#121413;border-radius:10px;border-collapse:collapse;margin-bottom:18px">
          ${fila('Cuándo', cuando)}
          ${fila('IP', ip ?? 'no registrada')}
          ${fila('Ubicación aproximada', geo?.approx ?? 'no disponible')}
          ${fila('Operador', geo?.org ?? '—')}
          ${fila('Dispositivo', dispositivoDe(ua))}
        </table>
        <p style="color:#F87171;font-size:13px;line-height:1.6;margin:0">
          <b>¿No fuiste tú?</b> Cambia tu contraseña ahora mismo${esAdmin ? '' : ' y escríbenos'}.
          ${esAdmin ? 'Revisa las llaves y la lista de acceso en Seguridad.' : ''}
        </p>
        <p style="color:rgba(244,244,242,0.45);font-size:11px;margin:18px 0 0">
          La ubicación se deduce de la IP: llega a ciudad o región, no es una dirección exacta.
          Este aviso se manda una vez por dispositivo — recargar la página no vuelve a enviarlo.
        </p>
      </div>`
    // La respuesta del proveedor SE MIRA. Antes se ignoraba, así que un
    // rechazo —dominio sin verificar, destinatario no permitido, llave
    // vencida— se veía exactamente igual que un envío correcto: nada.
    const envio = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM_EMAIL}>`, to: [correo],
        subject: esAdmin ? 'Ingreso al panel de administración' : 'Nuevo ingreso a tu cuenta Lincoin',
        html,
      }),
    })
    if (!envio.ok) {
      const detalle = (await envio.text().catch(() => '')).slice(0, 300)
      await auditAdmin(req, 'auth.aviso_ingreso_fallido', { userId, status: envio.status, detalle })
      return { ok: false, motivo: `el proveedor rechazó el envío (${envio.status}): ${detalle}`, destino: correo }
    }
    return { ok: true, motivo: 'enviado', destino: correo }
  } catch (e) {
    // El aviso NUNCA puede impedir un ingreso, pero el motivo sí queda.
    try { await auditAdmin(req, 'auth.aviso_ingreso_fallido', { userId, error: (e as Error)?.message }) } catch { /* */ }
    return { ok: false, motivo: `error interno: ${(e as Error)?.message ?? 'desconocido'}` }
  }
}

// ── Seguridad de acceso: IP, geolocalización y bloqueo ────────────────────
// La IP de quien llama. Primero la que pone Cloudflare (cf-connecting-ip):
// el cliente no la puede escribir, porque Cloudflare la reemplaza. El primer
// valor de X-Forwarded-For sí lo puede inventar el navegador, y de esa IP
// dependen la lista blanca del panel, los bloqueos y la auditoría. Sin la de
// Cloudflare se sigue con lo de antes.
function ipOf(req: Request): string | null {
  const cf = (req.headers.get('cf-connecting-ip') ?? '').trim()
  if (cf) return cf
  const fwd = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return fwd || req.headers.get('x-real-ip') || null
}

// La CADENA COMPLETA de reenvío, no solo el primer salto. Hace falta para
// distinguir la IP de quien realmente se conectó de la de un nodo de
// infraestructura en medio: si entre el navegador y la función hay un proxy,
// aquí se ve, y una IP europea en un acceso desde Colombia deja de ser un
// misterio. Se guarda como texto plano, sin interpretar.
function ipChainOf(req: Request): Record<string, string | null> {
  return {
    xForwardedFor: req.headers.get('x-forwarded-for'),
    cfConnectingIp: req.headers.get('cf-connecting-ip'),
    xRealIp: req.headers.get('x-real-ip'),
    cfIpCountry: req.headers.get('cf-ipcountry'),
    xVercelForwardedFor: req.headers.get('x-vercel-forwarded-for'),
    forwarded: req.headers.get('forwarded'),
  }
}

// Geolocalización aproximada por IP. IMPORTANTE: una IP da CIUDAD/REGIÓN como
// mucho — normalmente la del nodo del operador, no la del edificio. No es una
// dirección exacta y no debe presentarse como tal.
type Geo = { city?: string; region?: string; country?: string; countryCode?: string; org?: string; approx?: string; lat?: number; lon?: number }
const GEO_CACHE_KEY = 'ip_geo_cache'
async function geoOf(ip: string | null): Promise<Geo | null> {
  if (!ip || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return null
  try {
    const { data } = await db.from('system_config').select('value').eq('key', GEO_CACHE_KEY).single()
    const cache = data?.value ? JSON.parse(data.value) : {}
    // Se reconsulta si la entrada guardada NO trae el código de país: la caché
    // se llenó antes de que ese campo existiera, y devolverla tal cual dejaba
    // el país vacío — con la lista blanca encendida, eso dejaba a todos fuera.
    // También se reconsulta si falta la coordenada: la caché vieja se llenó
    // antes de que el mapa existiera, y sin lat/lon el punto no se puede
    // dibujar en ninguna parte.
    if (cache[ip]?.countryCode && typeof cache[ip]?.lat === 'number') return cache[ip]
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2500)
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctl.signal }).then(x => x.json()).catch(() => null)
    clearTimeout(t)
    if (!r?.success) return null
    const geo: Geo = {
      city: r.city ?? undefined, region: r.region ?? undefined, country: r.country ?? undefined,
      countryCode: r.country_code ?? undefined,
      org: r.connection?.isp ?? undefined,
      approx: [r.city, r.region, r.country].filter(Boolean).join(', ') || undefined,
      lat: typeof r.latitude === 'number' ? r.latitude : undefined,
      lon: typeof r.longitude === 'number' ? r.longitude : undefined,
    }
    // Caché acotada: evita pegarle al servicio por cada evento repetido.
    const keys = Object.keys(cache)
    if (keys.length > 250) for (const k of keys.slice(0, 100)) delete cache[k]
    cache[ip] = geo
    await db.from('system_config').upsert({ key: GEO_CACHE_KEY, value: JSON.stringify(cache) }, { onConflict: 'key' })
    return geo
  } catch { return null }
}

// ── Lista blanca de acceso al panel ──────────────────────────────────────
// Solo deja entrar al panel desde los países o las IPs autorizadas. Es la
// defensa que funciona AUNQUE el atacante tenga contraseña, 2FA y códigos de
// respaldo: si no está en el sitio permitido, no llega ni a la pantalla del
// código. Arranca DESACTIVADA a propósito — se enciende desde el panel, ya
// viendo cuál es tu IP, para no encerrar a nadie por sorpresa.
const ACCESS_POLICY_KEY = 'admin_access_policy'
type AccessPolicy = { enabled: boolean; countries: string[]; ips: string[] }
const DEFAULT_POLICY: AccessPolicy = { enabled: false, countries: ['CO'], ips: [] }

async function accessPolicy(): Promise<AccessPolicy> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', ACCESS_POLICY_KEY).single()
    if (!data?.value) return DEFAULT_POLICY
    const p = JSON.parse(data.value)
    return {
      enabled: !!p.enabled,
      countries: Array.isArray(p.countries) ? p.countries.map((c: any) => String(c).toUpperCase()) : [],
      ips: Array.isArray(p.ips) ? p.ips.map((i: any) => String(i)) : [],
    }
  } catch { return DEFAULT_POLICY }
}

// Devuelve un mensaje si esta conexión NO puede entrar al panel; null si sí.
async function accessDenied(req: Request): Promise<string | null> {
  const pol = await accessPolicy()
  if (!pol.enabled) return null
  const ip = ipOf(req)
  if (!ip) return null                       // sin IP no se castiga a nadie
  if (pol.ips.includes(ip)) return null      // IP autorizada explícitamente
  const geo = await geoOf(ip)
  const cc = String(geo?.countryCode ?? '').toUpperCase()
  if (cc && pol.countries.includes(cc)) return null
  if (!cc) {
    // No se pudo averiguar el país (el servicio de geolocalización no
    // respondió, o la IP no está en su base). Se DEJA PASAR y se anota: una
    // caída de un servicio ajeno no puede dejar al titular sin panel. El
    // resto de candados —contraseña, los dos códigos, el bloqueo por
    // intentos— siguen en pie.
    await auditAdmin(req, 'security.acceso_sin_geo', { ip })
    return null
  }
  await auditAdmin(req, 'security.acceso_fuera_de_zona', { ip, pais: cc, geo })
  // Mensaje deliberadamente parco: no se le dice desde dónde sí se podría.
  return 'Este acceso no está autorizado desde esta conexión.'
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

async function verifyAdmin(req: Request): Promise<{ ok: boolean; error?: string; userId?: string; email?: string; acceso?: Acceso }> {
  const authHeader = req.headers.get('Authorization') ?? ''

  // Identidad de admin SOLO por JWT real de Supabase (role='admin'). Se eliminó
  // el esquema "AdminBypass <password>": esa contraseña compartida viajaba en el
  // bundle público del frontend (VITE_ADMIN_PASSWORD) y cualquiera podía
  // extraerla y tomar control total. El admin entra con su cuenta real.
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
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

    const acceso = await accesoDe(user.id, String(user.email ?? ''))
    return { ok: true, userId: user.id, email: String(user.email ?? ''), acceso }
  } catch {
    return { ok: false, error: 'Auth check failed' }
  }
}

// Qué rol y qué países tiene esta cuenta.
//
// EL DUEÑO NO SE PUEDE QUEDAR AFUERA. Si no hay fila en admin_miembros y el
// correo es el de ADMIN_EMAIL, se trata como dueño con todos los países. Sin
// esa salvedad, el día que se aplique la migración nadie —ni el dueño— podría
// entrar a crear la primera fila: el arranque dependería de algo que todavía
// no existe.
//
// Una cuenta admin SIN fila y que NO es ADMIN_EMAIL queda en 'lectura' sin
// países: ve el panel, no ve datos. Es el lado seguro del error — alguien
// avisa que no ve nada, nadie avisa que ve de más.
async function accesoDe(userId: string, email: string): Promise<Acceso> {
  const TODO: Acceso = { rol: 'dueno', paises: [], todosLosPaises: true }

  const { data: m, error } = await db.from('admin_miembros')
    .select('rol, paises, activo').eq('id', userId).maybeSingle()

  // La tabla todavía no existe (migración sin correr). Antes de esta función
  // TODO admin veía todo; una migración que no se corrió no puede quitarle el
  // acceso a nadie. CUALQUIER OTRO error de la base es distinto: antes también
  // daba dueño, y un tropiezo de la base convertía a cualquier admin en dueño.
  // Ahí se cae al lado seguro (solo lectura) hasta que la base responda.
  const tablaAusente = (e: any) => /does not exist|42P01|PGRST205|schema cache|could not find the table/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`)
  const SOLO_LECTURA: Acceso = { rol: 'lectura', paises: [], todosLosPaises: false }
  if (error) return tablaAusente(error) ? TODO : SOLO_LECTURA

  if (m && (m as any).activo) {
    const rol = String((m as any).rol) as Rol
    return {
      rol,
      paises: Array.isArray((m as any).paises) ? (m as any).paises.map(String) : [],
      todosLosPaises: rol === 'dueno',
    }
  }

  // Fila desactivada: el acceso se le quitó a propósito. Sin respaldo — si lo
  // hubiera, desactivar a alguien no haría nada.
  if (m && !(m as any).activo) return { rol: 'lectura', paises: [], todosLosPaises: false, desactivado: true }

  // ── Sin fila. Acá se decide si la restricción está ENCENDIDA ──
  //
  // La regla: los permisos por miembro empiezan a regir cuando alguien
  // empieza a usarlos. Si la tabla está vacía, el sistema todavía no está
  // configurado y todos siguen como antes; en cuanto hay aunque sea un
  // miembro cargado, una cuenta sin fila es alguien a quien no se le dio
  // acceso todavía.
  //
  // Lo aprendí rompiéndolo: la primera versión dejaba en 'lectura' a
  // cualquiera sin fila, y como el respaldo dependía de un secreto
  // (ADMIN_EMAIL) cuyo valor por defecto es de OTRO dominio, el panel se
  // quedó sin datos apenas se desplegó la función. Un permiso nuevo no puede
  // depender de que alguien haya configurado algo que todavía no sabía que
  // existía.
  const { count, error: errCount } = await db.from('admin_miembros')
    .select('id', { count: 'exact', head: true })
  if (errCount) return tablaAusente(errCount) ? TODO : SOLO_LECTURA
  if (!count) return TODO

  const esDuenoPorCorreo = !!ADMIN_EMAIL && email.toLowerCase() === String(ADMIN_EMAIL).toLowerCase()
  if (esDuenoPorCorreo) return TODO
  return { rol: 'lectura', paises: [], todosLosPaises: false }
}

// ════════════════════════════════════════════════════════
//  EQUIPO: QUÉ PUEDE HACER CADA UNO Y SOBRE QUÉ PAÍSES
//
//  Esto vive en el servidor a propósito. Un filtro que vive en el navegador
//  no es una frontera: es una sugerencia que cualquiera desactiva con la
//  consola abierta. Si "este miembro solo ve Colombia" va a significar algo,
//  tiene que significarlo acá.
// ════════════════════════════════════════════════════════

type Rol = 'dueno' | 'operaciones' | 'cumplimiento' | 'lectura'

interface Acceso {
  rol: Rol
  paises: string[]      // códigos ISO; para 'dueno' no se miran
  todosLosPaises: boolean
  // Miembro dado de baja: no opera NADA, ni consulta. Antes quedaba en
  // 'lectura' y seguía viendo clientes y saldos.
  desactivado?: boolean
}

// Los permisos son gruesos a propósito: cuatro roles que alguien puede
// explicar en una frase valen más que veinte casillas que nadie revisa.
const PERMISOS_POR_ROL: Record<Rol, Set<string>> = {
  dueno:        new Set(['*']),
  operaciones:  new Set(['clientes.ver', 'clientes.editar', 'plata.ver', 'plata.mover']),
  cumplimiento: new Set(['clientes.ver', 'plata.ver', 'cumplimiento']),
  lectura:      new Set(['clientes.ver', 'plata.ver']),
}

// Qué permiso exige cada acción.
//
// LO QUE NO ESTÁ EN ESTA TABLA SE NIEGA a todo el que no sea dueño. Es
// deliberado: cuando se agregue una acción nueva y alguien se olvide de
// anotarla acá, lo que pasa es que no funciona para el equipo — no que quede
// abierta. Entre romperse y filtrarse, que se rompa.
const PERMISO_DE_ACCION: Record<string, string> = {
  // Saber quién soy: lo tienen los cuatro roles. Sin esto, un miembro no
  // podría ni enterarse de qué países le tocan, y el panel quedaría en blanco
  // sin decir por qué.
  mi_acceso: 'clientes.ver',
  // Dejar constancia del propio ingreso: lo hacen los cuatro roles. Sin esto
  // el ingreso de cualquiera que no fuera el dueño se anotaba como permiso
  // denegado.
  log_login: 'clientes.ver',
  // Salud del 2FA de las cuentas (correos y estado, ningún secreto).
  mfa_health: 'cumplimiento',

  // Consultar
  admin_logins: 'plata.ver',
  command_map: 'plata.ver',
  get_tx_proof: 'plata.ver',
  conciliar_movimientos: 'plata.mover',
  otc_ajuste_get: 'plata.ver',
  limites_envio_get: 'plata.ver',
  movimientos_cliente: 'clientes.ver',
  // Clientes por páginas: el panel ya no baja la base entera.
  usuarios_buscar: 'clientes.ver',
  usuarios_por_id: 'clientes.ver',
  // Contabilidad: el tablero y la facturación de Lincoin. Configurar Siigo
  // (credenciales) queda para el dueño: fact_lincoin_set no figura acá.
  contabilidad_resumen: 'plata.ver',
  contabilidad_cliente: 'plata.ver',
  contabilidad_vincular_ajuste: 'plata.mover',
  contabilidad_autovincular: 'plata.mover',
  // Cupos por beneficiario: los decide Cumplimiento.
  cupos_admin_get: 'cumplimiento',
  cupos_pendientes: 'cumplimiento',
  cupos_config_set: 'cumplimiento',
  cupo_resolver: 'cumplimiento',
  cupo_quitar: 'cumplimiento',
  fact_lincoin_get: 'plata.ver',
  fact_lincoin_lista: 'plata.ver',
  fact_lincoin_probar: 'plata.mover',
  fact_lincoin_emitir: 'plata.mover',
  fact_lincoin_al_dia: 'plata.mover',
  email_incidencias: 'clientes.ver',
  email_incidencia_resuelta: 'clientes.editar',

  // Mover plata
  admin_credit_balance: 'plata.mover',
  admin_credit_crypto: 'plata.mover',
  approve_rail_move: 'plata.mover',
  reject_rail_move: 'plata.mover',
  otc_ajuste_set: 'plata.mover',
  // Los topes de envío son un control de cumplimiento: los ajusta Compliance
  // (el dueño también, como todo).
  limites_envio_set: 'cumplimiento',
  limite_cliente_set: 'cumplimiento',

  // Clientes
  set_kyc_status: 'cumplimiento',

  // Cumplimiento y auditoría
  list_audit: 'cumplimiento',
  security_audit: 'cumplimiento',
  security_series: 'cumplimiento',
  security_stats: 'cumplimiento',
  log_incident: 'cumplimiento',

  // Solo el dueño (no figuran con permiso propio: caen en la negación por
  // defecto). delete_user, force_delete_by_email, save_config, block_ip,
  // unblock_ip, log_key_rotation, access_policy_get/set, equipo_*.
}

const PAIS_POR_MONEDA: Record<string, string> = {
  COP: 'CO', COP_BREB: 'CO', COP_ACH: 'CO',
  BRL: 'BR', MXN: 'MX',
  USD: 'US', USDT: 'US', USDT_TRON: 'US', USDC: 'US', EURC: 'US',
}

// Normaliza lo que haya en raw_data.country — viene escrito a mano y llega
// como "Colombia", "colombia", "CO", "COL"…
//
// NO se usa para esconder clientes: la lista de clientes no se filtra por
// país. Queda para etiquetar y para agrupar en el panel.
function paisAcodigo(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('col') || s === 'co') return 'CO'
  if (s.startsWith('bra') || s === 'br') return 'BR'
  if (s.startsWith('mex') || s.startsWith('méx') || s === 'mx') return 'MX'
  if (s.startsWith('est') || s.startsWith('usa') || s.startsWith('united') || s === 'us') return 'US'
  return null
}

// Los movimientos no tienen columna de país: se deduce de la moneda y del
// riel, que es de donde realmente sale. Si no se puede deducir, devuelve null
// y ESO NO SIGNIFICA "no mostrar" — ver el comentario de `visibleEnPais`.
function paisDeMovimiento(tx: Record<string, unknown>): string | null {
  const m = String(tx.currency ?? '').toUpperCase()
  if (PAIS_POR_MONEDA[m]) return PAIS_POR_MONEDA[m]
  const rd = (tx.raw_data ?? {}) as Record<string, unknown>
  const riel = String(rd.rail ?? rd.riel ?? rd.wallet ?? '').toUpperCase()
  if (riel.includes('BREB') || riel.includes('ACH') || riel.includes('COP')) return 'CO'
  if (riel.includes('PIX') || riel.includes('BRL')) return 'BR'
  return null
}

// LO QUE NO TIENE PAÍS NO DESAPARECE.
//
// Hoy muchos clientes vienen sin país y el panel asumía "Colombia" cuando
// faltaba. Si filtrara a secas, esas personas se volverían invisibles en
// TODAS las vistas y nadie notaría que existen: ni para atenderlas, ni para
// detectar algo raro en su cuenta. Un dato que falta no es permiso para
// esconder a alguien.
//
// Así que lo no atribuible se muestra a cualquiera que tenga al menos un
// país, marcado aparte, para que alguien lo asigne. El día que opere más de
// un país de verdad, esto se endurece — y cuando eso pase habrá que decidirlo
// a propósito, no descubrirlo.
function visibleEnPais(paisDelDato: string | null, acceso: Acceso): boolean {
  if (acceso.todosLosPaises) return true
  if (!acceso.paises.length) return false
  if (!paisDelDato) return true
  return acceso.paises.includes(paisDelDato)
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
    await db.from('audit_log').insert({ user_id: byId, action, metadata: { ...metadata, byEmail, ip, ipChain: ipChainOf(req), geo, userAgent, hadSession: !!byEmail, at: new Date().toISOString() } })
  } catch { /* best-effort — nunca romper la operación */ }
}

// El usuario del JWT, si es válido.
async function usuarioDelToken(req: Request): Promise<{ id: string; email: string } | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    return user?.id ? { id: String(user.id), email: String(user.email ?? '') } : null
  } catch { return null }
}

// true SOLO si el JWT de quien llama es el de ESE userId. Las acciones de
// autoservicio (2FA, perfil, conversiones, cupos) son de la propia cuenta.
//
// Antes esto era "propio O admin", y como corre ANTES del control del panel,
// cualquier cuenta admin —un miembro de "Solo lectura", uno dado de baja, una
// cuenta bloqueada o una sesión fuera de la lista blanca— podía mover saldo,
// cambiar el 2FA o bloquear el ingreso de cualquier usuario. Lo que un admin
// hace sobre la cuenta de OTRO pasa ahora por adminSobreOtro.
async function verifySelfOrAdmin(req: Request, userId: string): Promise<boolean> {
  const u = await usuarioDelToken(req)
  return !!u && u.id === String(userId)
}

// Un admin actuando sobre la cuenta de OTRO desde las acciones de autoservicio
// pasa por los mismos candados que el resto del panel: miembro activo, el
// permiso de su rol, sesión con 2FA, cuenta sin bloqueo y lista blanca de
// acceso. Devuelve la respuesta de rechazo lista para devolver, o null.
async function adminSobreOtro(req: Request, permisos: string[], accion: string): Promise<{ ok: true; admin: { userId: string; acceso: Acceso } } | { ok: false; res: Response }> {
  const v = await verifyAdmin(req)
  if (!v.ok || !v.userId) return { ok: false, res: json({ error: 'No autorizado' }, 401) }
  const acceso = v.acceso ?? { rol: 'lectura' as Rol, paises: [], todosLosPaises: false }
  if (acceso.desactivado) return { ok: false, res: json({ error: 'Tu acceso al panel fue desactivado.', permisoDenegado: true }, 403) }
  const tiene = PERMISOS_POR_ROL[acceso.rol] ?? new Set<string>()
  if (!(tiene.has('*') || permisos.some(p => tiene.has(p)))) {
    await auditAdmin(req, 'auth.permiso_denegado', { accion, rol: acceso.rol, userId: v.userId })
    return { ok: false, res: json({ error: 'Tu rol no permite esta operación.', permisoDenegado: true }, 403) }
  }
  { const den = await accessDenied(req); if (den) return { ok: false, res: json({ error: den, accessDenied: true }, 403) } }
  if (await adminLock(v.userId)) return { ok: false, res: json({ error: 'La cuenta está bloqueada por seguridad. Revisa tu correo para desbloquearla.', locked: true }, 423) }
  const mfaErr = await requireMfaSession(req, v.userId)
  if (mfaErr) return { ok: false, res: json({ error: mfaErr, needs2fa: true }, 403) }
  return { ok: true, admin: { userId: v.userId, acceso } }
}

// Error para quien NO es del equipo: el detalle (mensajes de la base, nombres
// de tablas) queda en el log del servidor, no en la pantalla del cliente.
function errorGenerico(contexto: string, detalle: unknown, status = 500): Response {
  console.error(`[admin-data] ${contexto}:`, String((detalle as any)?.message ?? detalle ?? '').slice(0, 300))
  return json({ error: 'No se pudo completar la operación. Intenta de nuevo en un momento.' }, status)
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

    // Desbloqueo desde el correo. No lleva sesión a propósito: el titular
    // está bloqueado justamente porque no puede entrar. La credencial es el
    // token de un solo uso que se le envió, comparado por hash.
    if (pingUrl.searchParams.get('action') === 'unlock') {
      const uid = pingUrl.searchParams.get('u') ?? ''
      const tok = pingUrl.searchParams.get('t') ?? ''
      const pag = (titulo: string, texto: string, ok: boolean) => new Response(
        `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
         <body style="margin:0;background:#0C0E0D;font-family:Archivo,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
           <div style="text-align:center;padding:28px;max-width:380px">
             <p style="font-size:22px;font-weight:800;color:#F4F4F2;margin:0 0 18px">Lincoin<span style="color:#4ADE80">.</span></p>
             <p style="font-size:17px;font-weight:800;color:${ok ? '#4ADE80' : '#F87171'};margin:0 0 8px">${titulo}</p>
             <p style="font-size:13px;color:#878E88;line-height:1.6;margin:0">${texto}</p>
           </div></body></html>`,
        { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } })
      if (!uid || !tok) return pag('Enlace incompleto', 'Vuelve a abrir el enlace del correo.', false)
      const lock = await adminLock(uid)
      if (!lock) return pag('La cuenta ya está activa', 'No hay ningún bloqueo pendiente. Puedes iniciar sesión.', true)
      if (lock.tokenHash !== await sha256Hex(tok)) {
        await auditAdmin(req, 'security.unlock_token_invalido', { userId: uid })
        return pag('Enlace inválido o ya usado', 'Cada enlace sirve una sola vez. Si necesitas otro, intenta iniciar sesión para generar uno nuevo.', false)
      }
      await clearAdminLock(uid)
      await auditAdmin(req, 'security.admin_unlocked', { userId: uid })
      return pag('Cuenta desbloqueada', 'Ya puedes iniciar sesión. Si no fuiste tú quien pidió esto, cambia la contraseña de inmediato.', true)
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
          const { data: recent } = await db.from('audit_log').select('created_at')
            .eq('action', 'auth.failed_login').contains('metadata', { ip }).gte('created_at', sinceH)
            .order('created_at', { ascending: false }).limit(100)
          const fails = (recent ?? []).length
          // Tope de escritura: este endpoint es público, así que sin un límite
          // se le podía inundar la auditoría a punta de peticiones. Pasado el
          // tope la IP ya está bloqueada y no hace falta seguir anotando.
          if (fails < 40) await auditAdmin(req, 'auth.failed_login', { email, reason })
          // El bloqueo automático de IP es SOLO para intentos contra la cuenta
          // del panel. En Colombia media ciudad sale por la misma IP del
          // operador: bloquearla porque un cliente escribió mal su código tres
          // veces dejaba afuera a todos los demás detrás de esa IP.
          let contraAdmin = false
          try {
            const { data: ue } = await db.from('users').select('role').eq('email', email).maybeSingle()
            contraAdmin = (ue as any)?.role === 'admin'
          } catch { /* si no se puede saber, no se bloquea */ }
          if (contraAdmin && fails >= 3) {
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

      // Segundo paso del ingreso: el código que llegó al correo. Solo aquí se
      // marca la sesión como verificada — ni el código de la app por sí solo
      // la abre.
      if (selfServiceBody.action === 'mfa_verify_email' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        { const den = await accessDeniedAdmin(req, String(selfServiceBody.userId)); if (den) return json({ ok: false, error: 'access_denied', message: den }, 403) }
        if (await adminLock(String(selfServiceBody.userId))) {
          return json({ ok: false, error: 'account_locked', message: 'La cuenta está bloqueada por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
        }
        const uidE = String(selfServiceBody.userId)
        const codeE = String(selfServiceBody.code ?? '').replace(/\D/g, '')

        const sinceE = new Date(Date.now() - 15 * 60_000).toISOString()
        const fallosE = (await fallosRecientes(uidE, sinceE)).filter((r: any) => r?.metadata?.tipo === 'correo')
        if (fallosE.length >= 5) {
          const viejo = fallosE.map((r: any) => new Date(r.created_at).getTime()).sort((a, b) => a - b)[0]
          const faltan = Math.max(1, Math.ceil((viejo + 15 * 60_000 - Date.now()) / 60_000))
          return json({ ok: false, error: 'too_many_attempts', message: `Demasiados intentos. Vuelve a intentar en ${faltan} minuto${faltan === 1 ? '' : 's'}.` }, 429)
        }

        if (!/^\d{6}$/.test(codeE)) return json({ ok: false, message: 'El código son 6 dígitos.' })
        const r = await fetch(`${SUPABASE_URL}/functions/v1/email-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ action: 'verify', userId: uidE, code: codeE }),
        }).then(x => x.json()).catch(() => null)
        if (!r?.ok) {
          // Un código YA USADO, VENCIDO o inexistente NO es un código
          // equivocado: es el mismo dueño tocando dos veces, o volviendo tarde.
          // Contarlo como fallo llevaría a bloquear la cuenta del titular por
          // un doble toque — el bloqueo existe para quien ADIVINA, no para
          // quien acierta dos veces seguidas.
          const inocente = ['used', 'no_code', 'expired'].includes(String(r?.error ?? ''))
          if (inocente) return json({ ok: false, message: r?.message ?? 'Solicita un código nuevo.' })
          const f = await registerAdminFailure(req, uidE, 'código incorrecto', 'correo', selfServiceBody.foto ?? null)
          if (f.bloqueada) {
            return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
          }
          return json({ ok: false, message: r?.message ?? 'Código incorrecto o vencido.' })
        }
        // Primer paso superado. NO abre la sesión: falta el código de la app.
        await rememberMfaSession(req, uidE, 'email')
        await marcarFactor(req, uidE, 'email')
        return json({ ok: true, needsAppCode: true })
      }

      // Arranca el ingreso: manda el código al correo del titular. NO devuelve
      // a qué dirección se envió — quien está entrando ya debería saberlo, y
      // mostrarlo le confirmaría el correo a quien no es el dueño.
      if (selfServiceBody.action === 'mfa_start_login' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        { const den = await accessDeniedAdmin(req, String(selfServiceBody.userId)); if (den) return json({ ok: false, error: 'access_denied', message: den }, 403) }
        if (await adminLock(String(selfServiceBody.userId))) {
          return json({ ok: false, error: 'account_locked', message: 'La cuenta está bloqueada por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
        }
        const r = await fetch(`${SUPABASE_URL}/functions/v1/email-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ action: 'send', userId: String(selfServiceBody.userId) }),
        }).then(x => x.json()).catch(() => null)
        // Cuántos pasos tiene este ingreso: 2 normalmente, 3 si la cuenta
        // tiene llave. La pantalla lo necesita para no mentirle al titular
        // diciendo "2 de 2" cuando todavía le falta uno.
        if (r?.ok) {
          const pasos = (await passkeysDe(String(selfServiceBody.userId))).length ? 3 : 2
          return json({ ok: true, throttled: !!r.throttled, pasos })
        }
        await auditAdmin(req, 'auth.email_2fa_unavailable', { userId: String(selfServiceBody.userId), motivo: r?.error ?? 'sin respuesta' })
        return json({ ok: false, error: 'email_code_unavailable', message: 'No se pudo iniciar la verificación. Intenta de nuevo.' })
      }

      // Reenviar el código del correo si no llegó.
      if (selfServiceBody.action === 'mfa_resend_email' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        { const den = await accessDeniedAdmin(req, String(selfServiceBody.userId)); if (den) return json({ ok: false, error: 'access_denied', message: den }, 403) }
        if (await adminLock(String(selfServiceBody.userId))) {
          return json({ ok: false, error: 'account_locked', message: 'La cuenta está bloqueada por seguridad.' }, 423)
        }
        const r = await fetch(`${SUPABASE_URL}/functions/v1/email-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ action: 'send', userId: String(selfServiceBody.userId) }),
        }).then(x => x.json()).catch(() => null)
        return json({ ok: !!r?.ok, throttled: !!r?.throttled, message: r?.message ?? null })
      }

      // ¿Esta SESIÓN ya superó el 2FA? Lo decide el servidor, no una marca
      // del navegador. La app guardaba 'mfa_ok' en sessionStorage y confiaba
      // en ella al restaurar: escribirla a mano en la consola abría el panel
      // sin código. Ahora esa marca solo sirve de pista y la respuesta buena
      // sale de aquí — el id de sesión viaja firmado dentro del JWT.
      if (selfServiceBody.action === 'mfa_session_ok' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const err = await requireMfaSession(req, String(selfServiceBody.userId))
        // El motivo viaja para que la pantalla diga POR QUÉ vuelve a pedir el
        // código (sesión distinta, vencida, no se pudo comprobar). Son los
        // mismos textos que ya ve el usuario en las acciones sensibles.
        return json({ ok: true, verified: !err, motivo: err })
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
        const txUid = String(selfServiceBody.tx.user_id)
        const propio = await verifySelfOrAdmin(req, txUid)
        let txRow = selfServiceBody.tx
        if (!propio) {
          // Un admin registrando un movimiento a nombre de otro: con los
          // candados del panel y el permiso de mover plata.
          const g = await adminSobreOtro(req, ['plata.mover'], 'insert_transaction')
          if ('res' in g) return g.res
        } else if (!(await verifyAdmin(req)).ok) {
          // El CLIENTE solo registra sus SOLICITUDES (depósito con
          // comprobante, retiro, conversión vieja), y quedan en Pendiente:
          // lo que pasa a Completado lo decide el servidor o Tesorería. Antes
          // se aceptaba cualquier tipo no bloqueado, con cualquier estado y
          // cualquier raw_data: un 'load' Completado con source:'admin_cargue'
          // y un `acct` inventado entraba a Contabilidad como cargue de
          // Lincoin, se facturaba y se podía vincular a débitos reales.
          const TIPOS_CLIENTE = new Set(['load', 'send', 'convert'])
          if (!TIPOS_CLIENTE.has(String(txRow.type))) return json({ error: 'Tipo de movimiento no permitido' }, 403)
          const monto = Number(txRow.amount)
          if (!Number.isFinite(monto) || monto <= 0) return json({ error: 'Monto inválido' }, 400)
          if (!/^[A-Z0-9_]{2,20}$/i.test(String(txRow.currency ?? ''))) return json({ error: 'Moneda inválida' }, 400)
          // Solo los datos que la pantalla de verdad manda para mostrar la
          // solicitud. Nada que lean los procesos que mueven saldo o la
          // contabilidad (source, acct, lincoin, reverso, firmas, fases…).
          const CLAVES_CLIENTE = new Set([
            'initials', 'title', 'date', 'createdAt', 'userName', 'userRole', 'method', 'proofUrl',
            'bank', 'account', 'beneficiary', 'reason', 'documentType', 'documentNumber', 'cashReference',
            'fee', 'couponCode', 'targetAmount', 'targetCurrency', 'destCurrency', 'note', 'country', 'network',
          ])
          const rdIn = (txRow.raw_data && typeof txRow.raw_data === 'object') ? txRow.raw_data as Record<string, unknown> : {}
          const rd: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(rdIn)) {
            if (!CLAVES_CLIENTE.has(k)) continue
            // Textos acotados: el comprobante (proofUrl) puede ser una imagen
            // en base64 y se deja pasar entera; lo demás es texto corto.
            rd[k] = typeof v === 'string' && k !== 'proofUrl' ? v.slice(0, 500) : v
          }
          txRow = { user_id: txUid, type: String(txRow.type), amount: monto, currency: String(txRow.currency), status: 'Pendiente', raw_data: rd }
        } else {
          // Admin con su propia cuenta: igual pasa por los candados del panel.
          const g = await adminSobreOtro(req, ['plata.mover'], 'insert_transaction')
          if ('res' in g) return g.res
        }
        const { data: inserted, error: insErr } = await db.from('transactions').insert(txRow).select('id').single()
        if (insErr) return errorGenerico('insert_transaction', insErr)
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
        const objetivo = String(selfServiceBody.user.id)
        const yo = await usuarioDelToken(req)
        if (!yo) return json({ error: 'No autorizado' }, 401)
        const esPropia = yo.id === objetivo
        // El upsert corre con service-role (la RLS no aplica). Si el caller NO
        // es admin se SANEAN los valores de escalación: role solo puede ser
        // personal/business (nunca 'admin'), kyc_status nunca puede quedar
        // aprobado/verificado por el propio usuario (eso lo fija el flujo KYC
        // server-side), y se quitan flags de bloqueo/límites. El onboarding
        // legítimamente fija role=personal/business y kyc_status=pending/
        // in_review, así que esos SÍ pasan. Balances no se tocan: el flujo
        // legacy de retiro del cliente aún los persiste por esta vía.
        const userRow = { ...selfServiceBody.user }
        const { data: filaActual } = await db.from('users').select('id, role, email').eq('id', objetivo).maybeSingle()
        // ADMIN EDITANDO A OTRO: esta acción corre antes del control de roles y
        // con service role, así que cualquier cuenta admin —también "Solo
        // lectura"— podía escribir el saldo de un cliente sin permiso, sin 2FA
        // y sin auditoría. El saldo de otro se mueve SOLO por las acciones de
        // tesorería; acá se exige el permiso de editar clientes (o el de
        // cumplimiento para el KYC) y los candados del panel.
        if (!esPropia) {
          const g = await adminSobreOtro(req, ['clientes.editar', 'cumplimiento'], 'save_user')
          if ('res' in g) return g.res
          const permisos = PERMISOS_POR_ROL[g.admin.acceso.rol] ?? new Set<string>()
          const puede = (p: string) => permisos.has('*') || permisos.has(p)
          // La fila de otro ADMIN solo la toca el dueño: un miembro de
          // Operaciones podía cambiarle el correo (a donde llegan sus códigos)
          // o el rol al dueño y dejarlo afuera del panel.
          if ((filaActual as any)?.role === 'admin' && !permisos.has('*')) {
            await auditAdmin(req, 'auth.permiso_denegado', { accion: 'save_user_admin', rol: g.admin.acceso.rol, userId: g.admin.userId, objetivo })
            return json({ error: 'Solo el dueño puede editar la cuenta de otro administrador.', permisoDenegado: true }, 403)
          }
          delete (userRow as any).balances
          delete (userRow as any).crypto_balances
          if (userRow.kyc_status != null && !puede('cumplimiento')) delete (userRow as any).kyc_status
          // El rol de administrador NO se da por acá, nunca: lo da el
          // servidor o la base. Entre Persona y Empresa sí puede moverse a un
          // cliente (no a otro admin, ver arriba).
          if (userRow.role != null && (!puede('clientes.editar') || !['personal', 'business'].includes(String(userRow.role)))) delete (userRow as any).role
          for (const k of ['is_admin', 'admin_role']) delete (userRow as any)[k]
        } else {
          // LA PROPIA CUENTA — también la de un admin. Antes un admin que se
          // editaba a sí mismo no pasaba por ningún saneamiento: con service
          // role podía escribirse saldos, KYC o cualquier columna, sin 2FA y
          // sin auditoría. El propio perfil se guarda igual para todos.
          //
          // El ROL no lo cambia el propio usuario, nunca. Antes se aceptaba
          // personal/business "para el onboarding", pero la fila ya existe
          // desde el registro con su rol: lo único que hacía era dejar que
          // una sesión con el rol mal en memoria convirtiera una empresa en
          // Persona en la base (este upsert corre con service-role y el
          // guardia de la base no lo frena). Solo se acepta si la fila NO
          // existe todavía (alta), y aun ahí solo personal/business.
          if (userRow.role != null) {
            if (filaActual || !['personal', 'business'].includes(String(userRow.role))) delete (userRow as any).role
          }
          // El CORREO tampoco: a esa dirección llegan los códigos de ingreso,
          // los avisos de bloqueo y el enlace de desbloqueo. Cambiarlo acá
          // (con solo la contraseña) dejaba el paso del correo tan protegido
          // como la contraseña. En el alta se toma el de la cuenta de acceso.
          if (filaActual) delete (userRow as any).email
          else (userRow as any).email = yo.email || (userRow as any).email
          if (userRow.kyc_status != null && !['pending', 'in_review', 'not_started', 'incomplete', 'rejected'].includes(String(userRow.kyc_status))) delete (userRow as any).kyc_status
          for (const k of ['is_blocked', 'is_admin', 'admin_role', 'limits', 'status', 'kyc_verified_at', 'assigned_currency', 'didit_session_id']) delete (userRow as any)[k]

          // ── CANDADO ANTI AUTO-CRÉDITO (CRÍTICO 2) ──────────────────────────
          // Un usuario NO puede SUBIRSE el saldo por esta vía (sería inflar
          // dinero que no existe y luego retirarlo). Se permite BAJARLO (el
          // flujo legacy de retiro debita por aquí). Los aumentos legítimos
          // (conversiones) van por apply_conversion, que valida la tasa. Se
          // reconstruye cada columna de saldo tomando el valor de la base y
          // aplicando SOLO las bajadas del cliente; cualquier subida se ignora.
          if (userRow.balances != null || userRow.crypto_balances != null) {
            const { data: cur } = await db.from('users').select('balances, crypto_balances').eq('id', objetivo).maybeSingle()
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
          const { data: curRaw } = await db.from('users').select('raw_data').eq('id', objetivo).maybeSingle()
          const dbRaw = (((curRaw as any)?.raw_data) ?? {}) as Record<string, any>
          const incoming = ((userRow as any).raw_data ?? {}) as Record<string, any>
          // Claves que SOLO escribe el servidor. Faltaban 'tusdatos' y
          // 'kumplo', que son el veredicto AML: como este upsert corre con
          // service role, rodeaba el candado que las protege en la base
          // (ese trigger deja pasar al service role a propósito). Un cliente
          // podía mandarse a sí mismo un 'operable: true' y el gate de
          // dispersión, que lee justo ese objeto, lo dejaba pasar.
          // Igual con los límites y las banderas de bloqueo: quien está
          // bloqueado no puede desbloquearse guardando su propio perfil.
          const SERVER_OWNED = ['gasfreeIndex', 'gasfreeHdIndex', 'gasfreeAddress', 'gasfreeEoa', 'gasfreeAddresses', 'gasfreeCredited', 'gasfreeCreditedTxs', 'gasfreeCreditedCount', 'mfaEnabled', 'mfaFactorId', 'totpSecret', 'totpSecretEnc', 'mfaBackupHashes', 'mfaSessions', 'mfaLastCounter', 'otp', 'subWallets', 'tusdatos', 'kumplo', 'blacklisted', 'isBlocked', 'complianceHold', 'limits', 'otcConfig', 'passwordHash', 'trustedDevices', '__role']
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
        if (saveErr) return esPropia ? errorGenerico('save_user', saveErr) : json({ error: saveErr.message }, 500)
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

        // La parte de Lincoin, en pesos, calculada acá con la misma tasa que
        // validó la conversión: lo que el cliente dejó de recibir frente al
        // monto justo. Queda guardada para Contabilidad y la factura (el
        // `fee` lo manda el navegador y no sirve como dato contable).
        let lincoin: Record<string, number> | null = null
        if (bS !== bT && (bS === 'COP' || bT === 'COP') && expected > 0) {
          const dif = Math.max(0, expected - amtT)
          const r2 = (n: number) => Math.round(n * 100) / 100
          lincoin = bT === 'COP'
            ? { totalCop: r2(expected), utilidadCop: r2(dif), usd: amtS }
            : { totalCop: r2(amtS), utilidadCop: r2(dif * amtS / expected), usd: amtT }
        }
        let txId: number | null = null
        try {
          const { data: ins } = await db.from('transactions').insert({
            user_id: userId, type: 'convert', amount: amtS, currency: src, status: 'Completado',
            raw_data: { initials: 'CV', title: `${src} a ${tgt}`, targetAmount: amtT, targetCurrency: tgt, destCurrency: tgt, fee, couponCode: selfServiceBody.coupon ?? null, createdAt: new Date().toISOString(), ...(lincoin ? { lincoin } : {}) },
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
      // ── Mover saldo entre rieles del propio cliente (atómico) ────────────
      // Antes el navegador calculaba los saldos nuevos y los guardaba con
      // save_user, que solo acepta BAJADAS: al mover COP → Bre-B se aplicaba
      // la resta y se perdía la suma, y un saldo viejo en memoria podía borrar
      // un crédito reciente. Ahora es un solo ajuste en la base, con deltas.
      // ── Solicitud "Saldo Lincoin → ACH" (la aprueba Tesorería) ───────────
      // El DÉBITO y la SOLICITUD en un solo paso del servidor. Antes el
      // navegador insertaba la fila y después se descontaba él mismo, con un
      // guardado cuyo error se tragaba: Tesorería aprobaba (o "devolvía" al
      // rechazar) sin saber si el descuento se había hecho. La fila queda
      // marcada `debitado` y aprobar/rechazar lo exigen.
      // ── CUPO MENSUAL POR BENEFICIARIO (lo que ve y pide el cliente) ──────
      // Estado del cupo de cada beneficiario inscrito: cuánto lleva en el mes,
      // cuánto le queda y si tiene una solicitud de aumento.
      if (selfServiceBody.action === 'cupos_estado' && selfServiceBody.userId) {
        const uid = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uid))) {
          const g = await adminSobreOtro(req, ['clientes.ver'], 'cupos_estado')
          if ('res' in g) return g.res
        }
        const { data: u } = await db.from('users').select('raw_data').eq('id', uid).maybeSingle()
        const contactos: any[] = Array.isArray((u as any)?.raw_data?.mouvContacts) ? (u as any).raw_data.mouvContacts : []
        const general = await cupoGeneral(db)
        const idsP = await idsMismaPersona(uid)
        let envios: EnvioMes[] = []
        try { envios = await enviosDelMes(db, idsP) } catch (e) { return errorGenerico('cupos_estado', e) }
        const aprobados = await cuposAprobadosDe(uid)
        let sols: any[] = []
        try {
          const { data } = await db.from('cupo_solicitudes').select('id, beneficiario_clave, estado, created_at, cupo_aprobado, nota_revision, monto_solicitado').in('user_id', idsP).order('created_at', { ascending: false }).limit(300)
          sols = (data ?? []) as any[]
        } catch { sols = [] }
        const porContacto: Record<string, any> = {}
        for (const c of contactos) {
          if (!c?.id) continue
          const e = estadoCupoContacto(c, contactos, envios, general, aprobados)
          const sol = sols.find(x => e.claves.includes(String(x.beneficiario_clave))) ?? null
          const { claves: _c, destinos: _d, ...publico } = e
          porContacto[String(c.id)] = { ...publico, solicitud: sol ? { estado: sol.estado, at: sol.created_at, cupoAprobado: sol.cupo_aprobado ?? null, nota: sol.nota_revision ?? null, montoSolicitado: sol.monto_solicitado ?? null } : null }
        }
        return json({ ok: true, general, porContacto, documentos: TIPOS_DOC_CUPO })
      }

      // Un documento para la solicitud (se sube uno por uno: un PDF de 5 MB
      // por pedido, no tres juntos). Queda en un bucket PRIVADO; Cumplimiento
      // lo abre con una URL firmada que vence.
      if (selfServiceBody.action === 'cupo_subir_doc' && selfServiceBody.userId) {
        const uid = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uid))) return json({ ok: false, error: 'No autorizado' }, 401)
        const tipo = String(selfServiceBody.tipo ?? '')
        if (!esTipoDocCupo(tipo)) return json({ ok: false, error: 'Tipo de documento no válido.' }, 400)
        const mime = String(selfServiceBody.mime ?? '').toLowerCase()
        if (!MIME_CUPOS.includes(mime)) return json({ ok: false, error: 'El documento tiene que ser un PDF o una imagen (JPG, PNG, WEBP).' }, 400)
        let bytes: Uint8Array
        try {
          const b64 = String(selfServiceBody.base64 ?? '').includes(',') ? String(selfServiceBody.base64).split(',')[1] : String(selfServiceBody.base64 ?? '')
          const bin = atob(b64)
          bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0))
        } catch { return json({ ok: false, error: 'No se pudo leer el archivo.' }, 400) }
        if (!bytes.byteLength) return json({ ok: false, error: 'El archivo llegó vacío.' }, 400)
        if (bytes.byteLength > 5 * 1024 * 1024) return json({ ok: false, error: 'Cada documento puede pesar hasta 5 MB.' }, 400)
        const limpio = String(selfServiceBody.nombre ?? tipo).replace(/[^\w.\-]/g, '_').slice(-60)
        const path = `${uid}/pendientes/${crypto.randomUUID()}-${tipo}-${limpio}`
        const { error } = await db.storage.from(BUCKET_CUPOS).upload(path, bytes, { contentType: mime, upsert: false })
        if (error) {
          console.error('[admin-data] cupo_subir_doc:', error.message)
          return json({ ok: false, error: 'No se pudo guardar el documento. Intenta de nuevo en un momento.' }, 500)
        }
        return json({ ok: true, path, tipo, nombre: String(selfServiceBody.nombre ?? limpio).slice(0, 120) })
      }

      // La solicitud de aumento: queda EN PROCESO hasta que Cumplimiento la
      // revise. El RUT es obligatorio; cámara de comercio y origen de fondos,
      // opcionales.
      if (selfServiceBody.action === 'cupo_solicitar' && selfServiceBody.userId) {
        const uid = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uid))) return json({ ok: false, error: 'No autorizado' }, 401)
        const { data: u } = await db.from('users').select('raw_data, full_name, company_name, email').eq('id', uid).maybeSingle()
        const contactos: any[] = Array.isArray((u as any)?.raw_data?.mouvContacts) ? (u as any).raw_data.mouvContacts : []
        const c = contactos.find(x => String(x?.id) === String(selfServiceBody.contactoId ?? ''))
        if (!c) return json({ ok: false, error: 'No encontramos ese beneficiario en tu lista.' }, 404)
        const docs: any[] = (Array.isArray(selfServiceBody.documentos) ? selfServiceBody.documentos : [])
          .filter((d: any) => d && typeof d.path === 'string' && d.path.startsWith(`${uid}/pendientes/`) && !d.path.includes('..') && esTipoDocCupo(String(d.tipo)))
          .map((d: any) => ({ tipo: String(d.tipo), path: String(d.path), nombre: String(d.nombre ?? '').slice(0, 120) }))
        // Cada documento tiene que EXISTIR en el bucket y ser del tipo que dice
        // (el tipo va en el nombre que le puso el servidor al subirlo). Antes
        // bastaba con mandar una ruta inventada para cumplir "adjuntó el RUT".
        const validos: any[] = []
        for (const d of docs) {
          const corte = d.path.lastIndexOf('/')
          const carpeta = d.path.slice(0, corte), archivo = d.path.slice(corte + 1)
          if (!archivo.slice(37).startsWith(`${d.tipo}-`)) continue
          try {
            const { data: hay } = await db.storage.from(BUCKET_CUPOS).list(carpeta, { search: archivo, limit: 5 })
            if (Array.isArray(hay) && hay.some((x: any) => x?.name === archivo)) validos.push(d)
          } catch { /* sin poder comprobarlo, no cuenta */ }
        }
        if (!validos.some(d => d.tipo === 'rut')) return json({ ok: false, error: 'Adjunta el RUT: es obligatorio para pedir el aumento.' }, 400)
        const monto = selfServiceBody.montoSolicitado != null && String(selfServiceBody.montoSolicitado).trim() !== '' ? Math.round(Number(String(selfServiceBody.montoSolicitado).replace(/[^\d]/g, ''))) : null
        if (monto != null && !(monto > 0)) return json({ ok: false, error: 'El cupo que pides tiene que ser un monto en pesos.' }, 400)
        const general = await cupoGeneral(db)
        const idsP = await idsMismaPersona(uid)
        let envios: EnvioMes[] = []
        try { envios = await enviosDelMes(db, idsP) } catch { envios = [] }
        const e = estadoCupoContacto(c, contactos, envios, general, await cuposAprobadosDe(uid))
        const { data: abierta, error: eAb } = await db.from('cupo_solicitudes').select('id').in('user_id', idsP).in('beneficiario_clave', e.claves.length ? e.claves : [e.clave]).eq('estado', 'en_proceso').limit(1)
        if (eAb) return errorGenerico('cupo_solicitar', eAb)
        const yaEnProceso = { ok: false, error: 'Ya tienes una solicitud de aumento en proceso para este beneficiario. Cumplimiento la está revisando.' }
        if (Array.isArray(abierta) && abierta.length) return json(yaEnProceso, 409)
        const { data: ins, error } = await db.from('cupo_solicitudes').insert({
          user_id: uid, beneficiario_clave: e.clave, contacto_id: String(c.id), beneficiario_nombre: e.nombre || null, beneficiario_doc: e.doc || null,
          beneficiario_tipo: e.tipo, cupo_actual: e.cupo, usado_mes: e.usado, monto_solicitado: monto,
          motivo: String(selfServiceBody.motivo ?? '').trim().slice(0, 1000) || null, documentos: validos, estado: 'en_proceso',
        }).select('id').single()
        // Dos envíos del formulario a la vez: el índice único de solicitudes
        // en proceso deja pasar solo una.
        if (error && (String((error as any).code) === '23505' || /duplicate key/i.test(error.message))) return json(yaEnProceso, 409)
        if (error) return errorGenerico('cupo_solicitar', error)
        await db.from('audit_log').insert({ user_id: uid, action: 'cupo.solicitud', metadata: { id: (ins as any)?.id, clave: e.clave, cupoActual: e.cupo, montoSolicitado: monto, documentos: validos.map(d => d.tipo) } }).then(() => {}, () => {})
        // Aviso a Cumplimiento por correo (si está configurado).
        if (RESEND_KEY && ADMIN_EMAIL) {
          const cliente = escHtml((u as any)?.company_name || (u as any)?.full_name || (u as any)?.email || uid)
          fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: `Lincoin <${FROM_EMAIL}>`, to: [ADMIN_EMAIL], subject: `Solicitud de aumento de cupo · ${cliente}`,
              html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#15181A">${cliente} pidió aumentar el cupo mensual de <b>${escHtml(e.nombre) || 'un beneficiario'}</b> (${e.tipo}, cupo actual ${e.cupo.toLocaleString('es-CO')} COP${monto ? `, pide ${monto.toLocaleString('es-CO')} COP` : ''}). Adjuntó: ${validos.map(d => TIPOS_DOC_CUPO[d.tipo]?.nombre ?? d.tipo).join(', ')}.</p><p style="font-family:Arial,sans-serif;font-size:13px;color:#5C625E">Se revisa en Admin → Cumplimiento → Cupos por beneficiario.</p>` }),
            signal: AbortSignal.timeout(8000),
          }).catch(() => {})
        }
        return json({ ok: true, id: (ins as any)?.id, estado: 'en_proceso' })
      }

      // ── Solicitud de RETIRO / envío manual (la aprueba Tesorería) ────────
      // El DÉBITO y la SOLICITUD en un solo paso del servidor. Antes el
      // navegador se descontaba el saldo con un guardado "dispara y olvida" y
      // después insertaba él mismo la fila 'send' Pendiente: un cliente podía
      // insertar la fila SIN descontarse nada, y al rechazarla Tesorería le
      // "devolvía" plata que nunca salió (o al aprobarla se le pagaba). La
      // fila queda marcada `debitado` y la base solo devuelve o paga esas.
      if (selfServiceBody.action === 'solicitar_retiro' && selfServiceBody.userId) {
        const uidR = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uidR))) return json({ ok: false, error: 'No autorizado' }, 401)
        const monto = Number(selfServiceBody.amount)
        if (!Number.isFinite(monto) || monto <= 0) return json({ ok: false, error: 'Monto inválido.' }, 400)
        const moneda = String(selfServiceBody.currency ?? '').toUpperCase()
        const col = String(selfServiceBody.debitKey ?? moneda).toUpperCase()
        if (!/^[A-Z0-9_]{2,20}$/.test(moneda) || !/^[A-Z0-9_]{2,20}$/.test(col)) return json({ ok: false, error: 'Moneda inválida.' }, 400)
        // Una cuenta bloqueada o en lista negra no retira, aunque llame directo.
        const { data: uR } = await db.from('users').select('is_blocked, raw_data, full_name, role').eq('id', uidR).maybeSingle()
        if (!uR) return json({ ok: false, error: 'Usuario no encontrado.' }, 404)
        const rawR = ((uR as any).raw_data ?? {}) as Record<string, any>
        if ((uR as any).is_blocked === true || rawR.blacklisted === true || rawR.isBlocked === true) {
          return json({ ok: false, error: 'Esta cuenta está bloqueada y no puede realizar operaciones. Contacta a soporte.' }, 403)
        }
        // El mismo botón apretado dos veces (o un reintento tras perder la
        // respuesta) no descuenta dos veces.
        const idem = String(selfServiceBody.idemKey ?? '').replace(/[^\w-]/g, '').slice(0, 80)
        const claveR = idem ? `retiro:${uidR}:${idem}` : ''
        if (claveR) {
          const c = await reclamarCandado(db, claveR, 86_400, uidR, 'solicitar_retiro')
          if (c === 'ocupado') return json({ ok: false, duplicado: true, error: 'Ya hay una solicitud igual en curso. Revisa tus movimientos antes de repetirla.' }, 409)
          if (c === 'error') return json({ ok: false, error: 'No pudimos registrar la solicitud en este momento. No se descontó nada; intenta de nuevo.' }, 503)
        }
        const soltarR = async () => { if (claveR) await soltarCandado(db, claveR) }
        const { data: adjR, error: eAdjR } = await db.rpc('adjust_balances', { p_user_id: uidR, p_fiat: { [col]: -monto } })
        if (eAdjR) { await soltarR(); return errorGenerico('solicitar_retiro debito', eAdjR) }
        if ((adjR as any)?.error) {
          await soltarR()
          return json({ ok: false, error: (adjR as any).error === 'insufficient' ? 'Saldo insuficiente en la cuenta de la que sale el retiro.' : 'No se pudo descontar el saldo. No se cambió nada.' }, 400)
        }
        const t = (v: unknown, n = 200) => v == null ? undefined : String(v).slice(0, n)
        const extraIn = (selfServiceBody.extra && typeof selfServiceBody.extra === 'object') ? selfServiceBody.extra as Record<string, unknown> : {}
        const extra: Record<string, unknown> = {}
        for (const k of ['cashReference', 'method', 'country', 'network', 'destCurrency', 'note']) if (extraIn[k] != null) extra[k] = t(extraIn[k])
        const ahoraR = new Date().toISOString()
        const { data: insR, error: insErrR } = await db.from('transactions').insert({
          user_id: uidR, type: 'send', amount: monto, currency: moneda, status: 'Pendiente',
          raw_data: {
            initials: 'EN', title: `Envío ${moneda}`, date: new Date().toLocaleDateString('es-CO'), createdAt: ahoraR,
            userName: (uR as any).full_name ?? null, userRole: (uR as any).role ?? null,
            bank: t(selfServiceBody.bank), account: t(selfServiceBody.account), beneficiary: t(selfServiceBody.beneficiary), reason: t(selfServiceBody.reason, 500),
            ...(selfServiceBody.documentType ? { documentType: t(selfServiceBody.documentType, 20) } : {}),
            ...(selfServiceBody.documentNumber ? { documentNumber: t(selfServiceBody.documentNumber, 30) } : {}),
            ...extra,
            debitado: true, debitadoCol: col, debitadoAt: ahoraR, servidor: true,
          },
        }).select('id').single()
        if (insErrR) {
          // Sin solicitud no puede quedar descontado: se devuelve.
          const { data: devR, error: eDevR } = await db.rpc('adjust_balances', { p_user_id: uidR, p_fiat: { [col]: monto } })
          if (eDevR || (devR as any)?.error) await auditAdmin(req, 'retiro.devolucion_fallida', { userId: uidR, col, monto, error: eDevR?.message ?? (devR as any)?.error ?? null })
          await soltarR()
          console.error('[admin-data] solicitar_retiro insert:', insErrR.message)
          return json({ ok: false, error: 'No pudimos registrar la solicitud y no se descontó tu saldo. Intenta de nuevo.' }, 500)
        }
        return json({ ok: true, id: (insR as any)?.id ?? null, balances: (adjR as any)?.balances ?? null })
      }

      if (selfServiceBody.action === 'solicitar_mover_ach' && selfServiceBody.userId) {
        const uidS = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uidS))) return json({ ok: false, error: 'No autorizado' }, 401)
        const monto = Math.round(Number(selfServiceBody.amount))
        if (!(monto > 0)) return json({ ok: false, error: 'Monto inválido.' }, 400)
        const { data: adj, error: eAdj } = await db.rpc('adjust_balances', { p_user_id: uidS, p_fiat: { COP: -monto } })
        if (eAdj) return json({ ok: false, error: 'No se pudo descontar el saldo. No se cambió nada; intenta de nuevo.' }, 500)
        if ((adj as any)?.error) return json({ ok: false, error: (adj as any).error === 'insufficient' ? 'Saldo insuficiente en tu Saldo Lincoin.' : String((adj as any).error) }, 400)
        const { data: uS } = await db.from('users').select('full_name').eq('id', uidS).maybeSingle()
        const ahoraS = new Date().toISOString()
        const { data: insS, error: insErrS } = await db.from('transactions').insert({
          user_id: uidS, type: 'rail_move', amount: monto, currency: 'COP', status: 'Pendiente',
          raw_data: {
            initials: 'AC', fromRail: 'COP', toRail: 'COP_ACH',
            title: 'Saldo Lincoin → ACH · en aprobación',
            date: new Date().toLocaleDateString('es-CO'), createdAt: ahoraS,
            userName: (uS as any)?.full_name ?? null,
            debitado: true, debitadoAt: ahoraS, servidor: true,
          },
        }).select('id').single()
        if (insErrS) {
          // Sin solicitud no puede quedar descontado: se devuelve.
          await db.rpc('adjust_balances', { p_user_id: uidS, p_fiat: { COP: monto } })
          return json({ ok: false, error: 'No pudimos registrar la solicitud y no se descontó tu saldo. Intenta de nuevo.' }, 500)
        }
        return json({ ok: true, id: (insS as any)?.id ?? null, balances: (adj as any)?.balances ?? null })
      }

      if (selfServiceBody.action === 'mover_saldo' && selfServiceBody.userId) {
        const uidM = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uidM))) return json({ error: 'No autorizado' }, 401)
        const op = String(selfServiceBody.op ?? '')
        const ahora = new Date().toISOString()
        if (op === 'breb') {
          const monto = Math.round(Number(selfServiceBody.amount))
          const dir = String(selfServiceBody.dir ?? '')
          if (!(monto > 0) || !['to_breb', 'from_breb'].includes(dir)) return json({ ok: false, error: 'Monto o dirección inválidos.' }, 400)
          const delta = dir === 'to_breb' ? { COP: -monto, COP_BREB: monto } : { COP: monto, COP_BREB: -monto }
          const { data: adj, error: eAdj } = await db.rpc('adjust_balances', { p_user_id: uidM, p_fiat: delta })
          if (eAdj) return json({ ok: false, error: 'No se pudo mover el saldo. No se descontó nada.' }, 500)
          if ((adj as any)?.error) return json({ ok: false, error: (adj as any).error === 'insufficient' ? 'Saldo insuficiente en la cuenta de origen.' : String((adj as any).error) }, 400)
          const { data: u } = await db.from('users').select('full_name').eq('id', uidM).maybeSingle()
          await db.from('transactions').insert({
            user_id: uidM, type: 'breb_move', amount: monto, currency: 'COP', status: 'Completado',
            raw_data: { initials: 'BB', title: dir === 'to_breb' ? 'Peso Lincoin → BreB Lincoin' : 'BreB Lincoin → Peso Lincoin', date: new Date().toLocaleDateString('es-CO'), createdAt: ahora, userName: (u as any)?.full_name ?? null, servidor: true },
          })
          return json({ ok: true, balances: (adj as any)?.balances ?? null })
        }
        if (op === 'consolidar_usdt') {
          // Los montos salen de la BASE, no del navegador.
          const { data: u } = await db.from('users').select('balances, full_name').eq('id', uidM).maybeSingle()
          const bal = ((u as any)?.balances ?? {}) as Record<string, any>
          const claves = ['USDT_TRON', 'USDT_BSC', 'USDT']
          const delta: Record<string, number> = {}
          let total = 0
          for (const k of claves) { const v = Number(bal[k] ?? 0); if (v > 0) { delta[k] = -v; total += v } }
          if (!(total > 0.000001)) return json({ ok: true, total: 0 })
          delta.USD = Number(total.toFixed(8))
          const { data: adj, error: eAdj } = await db.rpc('adjust_balances', { p_user_id: uidM, p_fiat: delta })
          if (eAdj || (adj as any)?.error) return json({ ok: false, error: 'No se pudo consolidar. No se movió nada.' }, 500)
          await db.from('transactions').insert({
            user_id: uidM, type: 'load', amount: total, currency: 'USD', status: 'Completado',
            raw_data: { initials: '₮', title: 'USDT acreditados al Dólar digital', date: new Date().toLocaleDateString('es-CO'), createdAt: ahora, userName: (u as any)?.full_name ?? null, source: 'USDT_CONSOLIDATION', servidor: true },
          })
          return json({ ok: true, total, balances: (adj as any)?.balances ?? null })
        }
        if (op === 'debitar_solicitud') {
          // Débito de una solicitud que ya quedó registrada (p. ej. paso de
          // saldo a ACH en aprobación): se exige la fila y que sea del cliente.
          const txId = String(selfServiceBody.txId ?? '')
          const { data: tx } = await db.from('transactions').select('id, user_id, type, amount, currency, status, raw_data').eq('id', txId).maybeSingle()
          // Solo una solicitud de paso de saldo (rail_move) PROPIA y Pendiente.
          // Antes servía cualquier fila propia: si el débito fallaba se le ponía
          // 'Rechazado' a la que fuera (un envío, por ejemplo), y lo rechazado
          // deja de contar en el cupo mensual del beneficiario.
          if (!tx || String((tx as any).user_id) !== uidM || (tx as any).type !== 'rail_move' || (tx as any).status !== 'Pendiente') return json({ ok: false, error: 'Solicitud no encontrada.' }, 404)
          if ((tx as any).raw_data?.debitado) return json({ ok: true, ya: true })
          // Se debita la moneda de la SOLICITUD, no la que diga el navegador.
          const col = String((tx as any).currency ?? 'COP')
          if (!/^COP(_[A-Z]+)?$/.test(col)) return json({ ok: false, error: 'Solicitud no válida.' }, 400)
          const monto = Number((tx as any).amount ?? 0)
          if (!(monto > 0)) return json({ ok: false, error: 'Monto inválido.' }, 400)
          // Marca primero (CAS) para no debitar dos veces la misma solicitud.
          const { data: marcada } = await db.from('transactions')
            .update({ raw_data: { ...((tx as any).raw_data ?? {}), debitado: true, debitadoCol: col, debitadoAt: ahora } })
            .eq('id', txId).filter('raw_data->>debitado', 'is', null).select('id')
          if (!marcada?.length) return json({ ok: true, ya: true })
          const { data: adj, error: eAdj } = await db.rpc('adjust_balances', { p_user_id: uidM, p_fiat: { [col]: -monto } })
          if (eAdj || (adj as any)?.error) {
            await db.from('transactions').update({ raw_data: { ...((tx as any).raw_data ?? {}) }, status: 'Rechazado' }).eq('id', txId).eq('type', 'rail_move').eq('status', 'Pendiente')
            return json({ ok: false, error: (adj as any)?.error === 'insufficient' ? 'Saldo insuficiente.' : 'No se pudo descontar el saldo.' }, 400)
          }
          return json({ ok: true, balances: (adj as any)?.balances ?? null })
        }
        return json({ ok: false, error: 'Operación inválida.' }, 400)
      }

      if (selfServiceBody.action === 'mfa_set' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const secret = String(selfServiceBody.secret ?? '')
        if (!/^[A-Z2-7]{16,64}$/i.test(secret)) return json({ error: 'Secreto inválido' }, 400)
        const factorId = String(selfServiceBody.factorId ?? 'local')
        const { data: u } = await db.from('users').select('raw_data').eq('id', selfServiceBody.userId).single()
        const raw = { ...((u as any)?.raw_data ?? {}) }
        // Si YA tiene 2FA, reemplazarlo exige una sesión que lo haya pasado.
        // Antes bastaba la contraseña: con ella se ponía un secreto propio,
        // se "verificaba" y quedaba la sesión completa — el 2FA no protegía.
        if (raw.mfaEnabled) {
          const falta = await requireMfaSession(req, String(selfServiceBody.userId))
          if (falta) return json({ error: 'Para cambiar tu verificación en dos pasos, primero ingresa con tu código actual.' }, 403)
        }
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
        { const den = await accessDeniedAdmin(req, String(selfServiceBody.userId)); if (den) return json({ ok: false, error: 'access_denied', message: den }, 403) }
        if (await adminLock(String(selfServiceBody.userId))) {
          return json({ ok: false, error: 'account_locked', message: 'La cuenta está bloqueada por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
        }
        const code = String(selfServiceBody.code ?? '')
        const uidV = String(selfServiceBody.userId)

        // ── Límite de intentos ────────────────────────────────────────────
        // Sin esto, el código de 6 dígitos se podía probar sin freno. Con la
        // ventana de ±2 hay 5 códigos válidos a la vez sobre un millón: unos
        // 200.000 intentos de media, cuestión de horas para un script. El
        // 2FA existe precisamente para el caso en que YA te robaron la
        // contraseña, así que dejarlo sin freno le quitaba casi todo el valor.
        //
        // El conteo del CÓDIGO DE LA APP y el del CÓDIGO DE RESPALDO son
        // SEPARADOS a propósito: el de respaldo es la vía de recuperación, y
        // si quedara bloqueado por los fallos del otro dejaría de servir para
        // lo único que existe. Su espacio es 32^8, así que aguanta un límite
        // más holgado sin volverse adivinable.
        const VENTANA_MIN = 15
        const esRespaldo = !/^\d{6}$/.test(String(code ?? '').trim())
        const sinceMfa = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString()
        const mios = (await fallosRecientes(uidV, sinceMfa)).filter((r: any) => (r?.metadata?.tipo === 'respaldo') === esRespaldo)
        const tope = esRespaldo ? 10 : 5
        if (mios.length >= tope) {
          // Cuánto falta de verdad, contado desde el fallo más viejo que
          // todavía pesa — decir "espera 15 minutos" cuando faltan 2 es
          // hacerle perder el tiempo a quien sí es el dueño de la cuenta.
          const masViejo = mios.map((r: any) => new Date(r.created_at).getTime()).sort((a, b) => a - b)[0]
          const faltan = Math.max(1, Math.ceil((masViejo + VENTANA_MIN * 60_000 - Date.now()) / 60_000))
          return json({
            ok: false, error: 'too_many_attempts', minutosRestantes: faltan,
            message: esRespaldo
              ? `Demasiados códigos de respaldo incorrectos. Vuelve a intentar en ${faltan} minuto${faltan === 1 ? '' : 's'}.`
              : `Demasiados códigos incorrectos. Vuelve a intentar en ${faltan} minuto${faltan === 1 ? '' : 's'}, o entra con uno de tus códigos de respaldo.`,
          }, 429)
        }
        let bloqueada = false
        const noteMfaFail = async (motivo: string) => {
          const f = await registerAdminFailure(req, uidV, motivo, esRespaldo ? 'respaldo' : 'app', selfServiceBody.foto ?? null)
          bloqueada = f.bloqueada
        }

        const { data: u } = await db.from('users').select('raw_data').eq('id', selfServiceBody.userId).single()
        const raw = ((u as any)?.raw_data ?? {}) as Record<string, any>
        // ¿Es la cuenta del panel? Sale SOLO de la tabla (users.role). Antes
        // también se miraba raw_data.__role, que escribe el propio usuario.
        const esAdmin = await esAdminUid(uidV)
        const etapaLogin = String(selfServiceBody.stage ?? '') === 'login'

        // ── Código de RESPALDO ────────────────────────────────────────────
        // Se prueba primero porque no es de 6 dígitos y porque tiene que
        // funcionar aunque el secreto TOTP esté ilegible — ese es justo el
        // caso para el que existe. Es de un solo uso: al acertar se consume.
        const hashes: string[] = Array.isArray(raw.mfaBackupHashes) ? raw.mfaBackupHashes : []
        const normalized = normalizeBackup(code)
        // 8 símbolos: códigos emitidos antes de septiembre 2026. 10: los nuevos.
        if (hashes.length && (normalized.length === 8 || normalized.length === BACKUP_LEN) && !/^\d{6}$/.test(code.trim())) {
          // El ORDEN se comprueba ANTES de gastar el código. Para un admin:
          //   · en el ingreso, el código del correo tiene que estar pasado;
          //   · sin etapa (re-verificación dentro del panel), solo se refresca
          //     una sesión que ya era completa — igual que con el código de la
          //     app. Antes un código de respaldo sin 'login' abría la sesión
          //     completa saltándose el correo y la llave.
          if (esAdmin && etapaLogin && !(await emailStagePassed(req, uidV))) {
            return json({ ok: false, error: 'email_step_missing', message: 'Completa la verificación anterior.' })
          }
          if (esAdmin && !etapaLogin && (await requireMfaSession(req, uidV)) !== null) {
            return json({ ok: false, error: 'login_incompleto', message: 'Inicia sesión completa (correo, app y llave) antes de esta verificación.' })
          }
          const idx = await matchBackup(code, hashes)
          if (idx >= 0) {
            // Un código de respaldo vale UNA vez, también si llegan dos pedidos
            // con el mismo código al mismo tiempo (los dos lo leían vigente).
            const unaVez = await reclamarCandado(db, `respaldo:${uidV}:${String(hashes[idx]).slice(-32)}`, 3600, uidV, 'mfa_respaldo')
            if (unaVez === 'ocupado') return json({ ok: false, error: 'code_reused', message: 'Ese código de respaldo ya se usó.' })
            if (unaVez === 'error') return json({ ok: false, message: 'No pudimos verificar el código. Intenta de nuevo.' })
            const rest = hashes.filter((_, i) => i !== idx)
            await mergeRaw(db, selfServiceBody.userId, { mfaBackupHashes: rest })
            await auditAdmin(req, 'mfa_backup_code_used', { userId: selfServiceBody.userId, remaining: rest.length })
            await reiniciarFallos(req, uidV)
            await marcarFactor(req, uidV, 'app')
            // Si la cuenta tiene llave, el código de respaldo tampoco la
            // reemplaza: la sesión queda a medio abrir hasta que firme.
            // Solo para el panel: ver el comentario del mismo paso abajo.
            if (esAdmin && (await passkeysDe(uidV)).length) {
              await rememberMfaSession(req, uidV, 'app')
              return json({ ok: true, usedBackup: true, remaining: rest.length, needsPasskey: true })
            }
            await rememberMfaSession(req, String(selfServiceBody.userId), 'full')
            return json({ ok: true, usedBackup: true, remaining: rest.length })
          }
          await noteMfaFail('código de respaldo inválido')
          if (bloqueada) return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
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
          if (bloqueada) return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
          return json({ ok: false })
        }
        // Un código ya usado NO vale una segunda vez, aunque su ventana siga
        // abierta. Es lo que cierra la reutilización del código capturado.
        // Un código ya usado por la MISMA sesión que ya quedó verificada es un
        // reenvío del pedido, no un intento: se responde igual que el
        // original. Contarlo como fallo bloqueaba la cuenta del admin y la IP
        // de la oficina. Desde OTRA sesión sí cuenta como fallo.
        // ── El MISMO pedido, repetido ─────────────────────────────────────
        // Caso real: cada ingreso quedaba "login_2fa_completo" y, medio
        // segundo después (o a la vez), el mismo código otra vez → "ya
        // utilizado". La red reintenta el POST (conexión cortada antes de la
        // respuesta) y el navegador se queda con la respuesta del REINTENTO:
        // la persona ve un rechazo de un código que sí entró.
        // Si ESTA MISMA sesión ya quedó verificada con ESTE código, el
        // repetido responde lo mismo que el original. Un código capturado y
        // usado desde OTRA sesión sigue rechazado: su sesión no está
        // verificada.
        //
        // Lo mismo vale para la confirmación de un ENVÍO en la misma sesión:
        // quien acaba de entrar con un código y enseguida envía ve el MISMO
        // código en su app, y se le rechazaba como "ya usado" (se mostraba
        // "Código incorrecto"). Desde la misma sesión ya verificada se acepta;
        // desde otra, sigue rechazado.
        const sidV = sessionIdOf(req)
        const mismaSesionYaVerificada = async (): Promise<boolean> => {
          if (!sidV) return false
          // El original puede estar terminando en paralelo: se espera un poco
          // (hasta ~2 s) a que anote la sesión antes de decidir. Solo se
          // llega acá con el MISMO contador del último código aceptado.
          for (let i = 0; i < 8; i++) {
            const { data: f } = await db.from('users').select('raw_data').eq('id', uidV).single()
            const rd = ((f as any)?.raw_data ?? {}) as Record<string, any>
            const ses: any[] = Array.isArray(rd.mfaSessions) ? rd.mfaSessions : []
            const hit = ses.find((x: any) => x?.sid === sidV && (x?.stage ?? 'full') === 'full')
            if (hit && Number(rd.mfaLastCounter ?? -1) === counter && Date.now() - new Date(hit.at).getTime() < 5 * 60_000) return true
            await new Promise(r => setTimeout(r, 250))
          }
          return false
        }
        const lastCounter = Number(raw.mfaLastCounter ?? -1)
        if (Number.isFinite(lastCounter) && counter <= lastCounter) {
          if (counter === lastCounter && await mismaSesionYaVerificada()) {
            await auditAdmin(req, 'auth.mfa_repetido_aceptado', { userId: uidV, operacion: !etapaLogin })
            return json({ ok: true, repetido: true })
          }
          // No es un repetido de la misma sesión: es un código ya gastado
          // usado desde OTRA sesión (p. ej. uno capturado). Ese sí cuenta
          // como fallo, para que reenviarlo una y otra vez llegue al bloqueo.
          await noteMfaFail('código ya utilizado desde otra sesión')
          if (bloqueada) return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
          return json({ ok: false, error: 'code_reused', message: 'Ese código ya se usó. Espera al siguiente que muestre tu app.' })
        }
        // Dos pedidos con el MISMO código a la vez leían el contador viejo y
        // pasaban los dos. El candado (llave primaria en la base) deja uno.
        if ((await reclamarCandado(db, `totp:${uidV}:${counter}`, 600, uidV, 'mfa_totp')) === 'ocupado') {
          if (await mismaSesionYaVerificada()) {
            await auditAdmin(req, 'auth.mfa_repetido_aceptado', { userId: uidV, simultaneo: true })
            return json({ ok: true, repetido: true })
          }
          await noteMfaFail('código ya utilizado desde otra sesión (simultáneo)')
          if (bloqueada) return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
          return json({ ok: false, error: 'code_reused', message: 'Ese código ya se usó. Espera al siguiente que muestre tu app.' })
        }
        await mergeRaw(db, uidV, { mfaLastCounter: counter })
        // Un acierto reinicia la cuenta de fallos: quien acaba de demostrar que
        // es el dueño no debe arrastrar un contador que lo bloquee después.
        // (Se marca; ya no se borran los fallos de la auditoría.)
        await reiniciarFallos(req, uidV)

        // ── Orden del ingreso: PRIMERO el correo, DESPUÉS la app ──────────
        // El código del correo es el paso indispensable. Este es el segundo:
        // solo se acepta si el del correo ya se superó en esta misma sesión,
        // así el orden no se puede saltar llamando directo a este paso.
        // ⚠️ La verificación doble (correo + app) es SOLO para el panel de
        // administración. Un cliente con 2FA entra con el código de su app,
        // como siempre: exigirle un paso que su pantalla no tiene lo dejaba
        // encerrado sin manera de avanzar.
        if (etapaLogin) {
          if (esAdmin && !(await emailStagePassed(req, uidV))) {
            return json({ ok: false, error: 'email_step_missing', message: 'Completa la verificación anterior.' })
          }
          await marcarFactor(req, uidV, 'app')
          // ── Tercer paso: la llave ────────────────────────────────────────
          // Si la cuenta tiene una llave registrada, el código de la app NO
          // termina el ingreso. La sesión queda en 'app' —que no habilita
          // nada— hasta que el dispositivo firme.
          // SOLO PARA EL PANEL. Las llaves son del administrador: firmar con
          // ellas (passkey_auth_*) exige rol admin. Una cuenta que fue admin
          // y pasó a cliente conservaba su llave guardada, y aquí se le
          // pedía igual: el código correcto la dejaba a medio entrar,
          // esperando una llave que el servidor no la deja usar, y la
          // pantalla decía "código incorrecto" con el código bueno.
          if (esAdmin && (await passkeysDe(uidV)).length) {
            await rememberMfaSession(req, uidV, 'app')
            return json({ ok: true, needsPasskey: true })
          }
          await rememberMfaSession(req, uidV, 'full')
          await auditAdmin(req, 'auth.login_2fa_completo', { userId: uidV })
          return json({ ok: true })
        }

        // Queda constancia de QUÉ sesión superó el 2FA: es lo que después
        // exigen las acciones sensibles. Un ADMIN sin stage (re-verificación
        // dentro del panel) solo REFRESCA una sesión que ya era completa: si
        // no, llamar sin 'login' dejaba la sesión completa saltándose el
        // correo y la llave.
        if (esAdmin && (await requireMfaSession(req, uidV)) !== null) {
          await marcarFactor(req, uidV, 'app')
          return json({ ok: false, error: 'login_incompleto', message: 'Inicia sesión completa (correo, app y llave) antes de esta verificación.' })
        }
        await rememberMfaSession(req, uidV)
        await marcarFactor(req, uidV, 'app')
        return json({ ok: true })
      }

      // ── Aviso de ingreso ─────────────────────────────────────────────────
      // Lo llama el navegador apenas la sesión queda abierta de verdad, tanto
      // para un cliente como para el admin. El servidor decide si manda el
      // correo (uno por sesión) y saca la IP y el dispositivo de ESTA
      // petición — no de lo que diga la pantalla, que se puede falsear.
      if (selfServiceBody.action === 'notify_login' && selfServiceBody.userId) {
        const uidN = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uidN))) return json({ error: 'No autorizado' }, 401)
        // 'forzar' lo usa el botón de prueba del panel: salta el dedupe para
        // poder comprobar el envío sin tener que volver a entrar.
        const forzar = !!selfServiceBody.forzar && (await esAdminUid(uidN))
        const r = await avisarIngreso(req, uidN, forzar)
        return json({ ok: true, enviado: r.ok, motivo: r.motivo, destino: r.destino ?? null })
      }

      // ── Señal de vida ────────────────────────────────────────────────────
      // La manda el panel cuando hay actividad real pero no llamadas a la API
      // —alguien leyendo una pantalla quieta—. Sin esto, estar trabajando en
      // una pantalla que no consulta nada contaría como estar ausente.
      if (selfServiceBody.action === 'touch_session' && selfServiceBody.userId) {
        const uidT = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uidT))) return json({ error: 'No autorizado' }, 401)
        if (!(await esAdminUid(uidT))) return json({ ok: true })   // el corte es solo del panel
        const fuera = await sesionInactiva(req, uidT)
        return json({ ok: !fuera, sesionInactiva: fuera })
      }

      // ── ¿Qué le falta a esta sesión para operar? ─────────────────────────
      // Lo consulta la pantalla antes de abrir Tesorería o de administrar las
      // llaves. La respuesta la decide el servidor: la pantalla no puede
      // darse por verificada sola.
      if (selfServiceBody.action === 'step_up_status' && selfServiceBody.userId) {
        const uidS = String(selfServiceBody.userId)
        if (!(await verifySelfOrAdmin(req, uidS))) return json({ error: 'No autorizado' }, 401)
        if (!(await esAdminUid(uidS))) return json({ error: 'No autorizado' }, 401)
        return json({
          ok: true,
          falta: await stepUpFalta(req, uidS),
          tienePasskey: (await passkeysDe(uidS)).length > 0,
          minutos: Math.round(STEP_UP_TTL_MS / 60_000),
        })
      }

      // ── PASSKEY ─────────────────────────────────────────────────────────
      // Una llave que vive DENTRO del dispositivo (Face ID, huella, o una
      // llave USB) y nunca sale de él: el navegador solo devuelve una firma,
      // atada al dominio real. No se puede fotografiar, ni copiar del
      // portapapeles, ni robar con una página falsa — que es exactamente
      // como se pierden una contraseña, un código de 6 dígitos y unos
      // códigos de respaldo. Es la única capa que aguanta que el atacante
      // tenga las tres cosas.
      //
      // Solo para la cuenta del panel, y solo desde una sesión que ya superó
      // el 2FA: dar de alta una llave desde una sesión a medio verificar
      // sería regalarle al intruso la puerta definitiva.
      if (String(selfServiceBody.action ?? '').startsWith('passkey_') && selfServiceBody.userId) {
        const uidP = String(selfServiceBody.userId)
        const accion = String(selfServiceBody.action)
        if (!(await verifySelfOrAdmin(req, uidP))) return json({ error: 'No autorizado' }, 401)
        if (!(await esAdminUid(uidP))) return json({ error: 'No autorizado' }, 401)

        let W: any
        try { W = await webauthn() }
        catch { return json({ ok: false, error: 'passkey_no_disponible', message: 'El servicio de llaves no está disponible en este momento. Entra con tu código.' }, 503) }

        const publico = (l: Passkey[]) => l.map(p => ({ id: p.id, nombre: p.nombre, at: p.at }))

        // ── Alta y administración: exigen sesión con 2FA superado ─────────
        if (accion === 'passkey_list' || accion === 'passkey_register_options'
          || accion === 'passkey_register_verify' || accion === 'passkey_delete') {
          const mfaErr = await requireMfaSession(req, uidP)
          if (mfaErr) return json({ ok: false, error: 'needs_2fa', message: mfaErr }, 403)

          // Dar de alta o quitar una llave exige volver a probar el correo Y
          // el código de la app, aquí y ahora. Una sesión abierta hace horas
          // —o robada— no basta para cambiar la puerta de entrada.
          //
          // La LLAVE no se exige a propósito, aunque ya haya una registrada:
          // esta pantalla es justo donde se sale de un dispositivo perdido.
          // Exigirla convertiría perder el teléfono en perder el panel.
          if (accion !== 'passkey_list') {
            const falta = (await stepUpFalta(req, uidP)).filter(f => f !== 'passkey')
            if (falta.length) {
              return json({ ok: false, error: 'step_up', falta, message: 'Verifica tu identidad para administrar tus llaves.' }, 403)
            }
          }

          if (accion === 'passkey_list') {
            return json({ ok: true, passkeys: publico(await passkeysDe(uidP)), rpId: RP_ID })
          }

          if (accion === 'passkey_delete') {
            const id = String(selfServiceBody.passkeyId ?? '')
            const list = (await passkeysDe(uidP)).filter(p => p.id !== id)
            await guardarPasskeys(uidP, list)
            await auditAdmin(req, 'security.passkey_eliminada', { userId: uidP, id: id.slice(0, 12) })
            return json({ ok: true, passkeys: publico(list) })
          }

          if (accion === 'passkey_register_options') {
            const { data: uu } = await db.from('users').select('email, name').eq('id', uidP).single()
            const yaTiene = await passkeysDe(uidP)
            const options = await W.generateRegistrationOptions({
              rpName: RP_NAME,
              rpID: RP_ID,
              userID: new TextEncoder().encode(uidP),
              userName: String((uu as any)?.email ?? 'admin'),
              userDisplayName: String((uu as any)?.name ?? 'Lincoin'),
              attestationType: 'none',
              // Sin esto, registrar dos veces desde el mismo teléfono creaba
              // una llave duplicada en vez de avisar que ya estaba.
              excludeCredentials: yaTiene.map(p => ({ id: p.id })),
              authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
            })
            await guardarChallenge(uidP, options.challenge)
            return json({ ok: true, options })
          }

          // passkey_register_verify
          const challenge = await tomarChallenge(uidP)
          if (!challenge) return json({ ok: false, message: 'La solicitud venció. Vuelve a intentarlo.' })
          let v: any
          try {
            v = await W.verifyRegistrationResponse({
              response: selfServiceBody.credential,
              expectedChallenge: challenge,
              expectedOrigin: ORIGENES,
              expectedRPID: RP_ID,
              requireUserVerification: true,
            })
          } catch (e) {
            return json({ ok: false, message: `La llave no se pudo registrar: ${(e as Error).message}` })
          }
          const info: any = v?.registrationInfo
          if (!v?.verified || !info) return json({ ok: false, message: 'La llave no se pudo verificar.' })
          const c: any = info.credential ?? {}
          const idNueva = String(c.id ?? (info.credentialID ? bytesAB64u(new Uint8Array(info.credentialID)) : ''))
          const pubRaw = c.publicKey ?? info.credentialPublicKey
          if (!idNueva || !pubRaw) return json({ ok: false, message: 'La llave no se pudo leer.' })
          const nombre = String(selfServiceBody.nombre ?? '').trim().slice(0, 40) || 'Este dispositivo'
          const lista = (await passkeysDe(uidP)).filter(p => p.id !== idNueva)
          lista.unshift({
            id: idNueva,
            publicKey: bytesAB64u(new Uint8Array(pubRaw)),
            counter: Number(c.counter ?? info.counter ?? 0),
            nombre,
            at: new Date().toISOString(),
          })
          await guardarPasskeys(uidP, lista)
          await auditAdmin(req, 'security.passkey_registrada', { userId: uidP, nombre })
          return json({ ok: true, passkeys: publico(lista) })
        }

        // ── Ingreso con la llave ──────────────────────────────────────────
        if (accion === 'passkey_auth_options' || accion === 'passkey_auth_verify') {
          { const den = await accessDeniedAdmin(req, uidP); if (den) return json({ ok: false, error: 'access_denied', message: den }, 403) }
          if (await adminLock(uidP)) {
            return json({ ok: false, error: 'account_locked', message: 'La cuenta está bloqueada por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
          }
          const lista = await passkeysDe(uidP)
          if (!lista.length) return json({ ok: false, error: 'sin_passkey' })

          if (accion === 'passkey_auth_options') {
            const options = await W.generateAuthenticationOptions({
              rpID: RP_ID,
              allowCredentials: lista.map(p => ({ id: p.id })),
              userVerification: 'required',
            })
            await guardarChallenge(uidP, options.challenge)
            return json({ ok: true, options })
          }

          // passkey_auth_verify
          const challenge = await tomarChallenge(uidP)
          if (!challenge) return json({ ok: false, message: 'La solicitud venció. Vuelve a intentarlo.' })
          const cred: any = selfServiceBody.credential
          const guardada = lista.find(p => p.id === String(cred?.id ?? ''))
          if (!guardada) {
            const f = await registerAdminFailure(req, uidP, 'llave no registrada', 'passkey', null)
            if (f.bloqueada) return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
            return json({ ok: false, message: 'Esa llave no está registrada en esta cuenta.' })
          }
          let a: any
          try {
            a = await W.verifyAuthenticationResponse({
              response: cred,
              expectedChallenge: challenge,
              expectedOrigin: ORIGENES,
              expectedRPID: RP_ID,
              credential: { id: guardada.id, publicKey: b64uABytes(guardada.publicKey), counter: guardada.counter },
              requireUserVerification: true,
            })
          } catch (e) {
            const f = await registerAdminFailure(req, uidP, `firma rechazada: ${(e as Error).message}`, 'passkey', selfServiceBody.foto ?? null)
            if (f.bloqueada) return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
            return json({ ok: false, message: 'La llave no se pudo verificar.' })
          }
          if (!a?.verified) {
            const f = await registerAdminFailure(req, uidP, 'firma inválida', 'passkey', selfServiceBody.foto ?? null)
            if (f.bloqueada) return json({ ok: false, error: 'account_locked', message: 'La cuenta se bloqueó por seguridad. Revisa el correo del titular para desbloquearla.' }, 423)
            return json({ ok: false, message: 'La llave no se pudo verificar.' })
          }
          // El contador que lleva el propio dispositivo: si vuelve más bajo que
          // el guardado, la librería lo rechaza. Es lo que delata una copia.
          guardada.counter = Number(a.authenticationInfo?.newCounter ?? guardada.counter)
          await guardarPasskeys(uidP, lista)

          // La llave es el ÚLTIMO paso, no un atajo: exige que esta misma
          // sesión ya haya pasado el código del correo Y el de la app. Sin
          // esto, quien tuviera la llave entraría saltándose los otros dos.
          if (String(selfServiceBody.stage ?? '') === 'login') {
            if (!(await emailStagePassed(req, uidP)) || !(await appStagePassed(req, uidP))) {
              return json({ ok: false, error: 'email_step_missing', message: 'Completa la verificación anterior.' })
            }
          } else if ((await requireMfaSession(req, uidP)) !== null) {
            // Sin etapa (re-verificación dentro del panel) la llave solo
            // REFRESCA una sesión que ya era completa. Antes abría la sesión
            // completa sin el correo ni el código de la app.
            return json({ ok: false, error: 'login_incompleto', message: 'Inicia sesión completa (correo, app y llave) antes de esta verificación.' })
          }
          await reiniciarFallos(req, uidP)
          await rememberMfaSession(req, uidP, 'full')
          await marcarFactor(req, uidP, 'passkey')
          await auditAdmin(req, 'auth.login_passkey', { userId: uidP, llave: guardada.nombre })
          return json({ ok: true })
        }

        return json({ error: 'Acción desconocida' }, 400)
      }

      // ── 2FA: SALUD — ¿algún secreto quedó ilegible? ──────────────────────
      // Revisa todas las cuentas con 2FA activo e informa cuántas tienen el
      // secreto ilegible (llave distinta) y cuántas se quedaron sin códigos de
      // respaldo. Es lo que convierte "me quedé afuera" en un aviso ANTES de
      // que pase. No devuelve ningún secreto: solo correos y conteos.
      if (selfServiceBody.action === 'mfa_health') {
        // Lista correos de todas las cuentas con 2FA: con el permiso de
        // cumplimiento y los candados del panel, no con solo role='admin'.
        { const g = await adminSobreOtro(req, ['cumplimiento'], 'mfa_health'); if ('res' in g) return g.res }
        // Solo las cuentas con 2FA, por páginas: con la base entera de una vez
        // PostgREST devolvía las primeras 1.000 y el resto no se revisaba.
        // Solo las claves que se miran: raw_data entero (contactos, avisos…)
        // de miles de cuentas no entra en la memoria de la función.
        const { filas: rows } = await leerPorPaginas(() => db.from('users')
          .select('id, email, enc:raw_data->>totpSecretEnc, plano:raw_data->>totpSecret, resp:raw_data->mfaBackupHashes')
          .eq('raw_data->>mfaEnabled', 'true'))
        for (const r of rows) r.raw_data = { mfaEnabled: true, totpSecretEnc: r.enc ?? undefined, totpSecret: r.plano ?? undefined, mfaBackupHashes: r.resp ?? undefined }
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
        // Lista por cuenta para el tablero: no basta con el conteo, hay que
        // poder ver CUÁL le falta el respaldo. Solo correo y estado — ningún
        // secreto sale de acá.
        const cuentas: Array<{ email: string; conRespaldo: boolean; problema: string | null }> = []
        for (const r of (rows ?? []) as any[]) {
          const raw = r.raw_data ?? {}
          if (!raw.mfaEnabled) continue
          const hashes: string[] = Array.isArray(raw.mfaBackupHashes) ? raw.mfaBackupHashes : []
          const malo = affected.find(a => a.email === r.email)
          // Códigos del formato viejo (SHA-256 sin sal): rompibles por fuerza
          // bruta si alguien copió la fila. Hay que regenerarlos.
          const debil = hashes.some(esHashLegacy)
          cuentas.push({ email: String(r.email ?? ''), conRespaldo: hashes.length > 0, problema: malo ? malo.motivo : (debil ? 'respaldo débil: regenerar' : null) })
        }
        return json({ ok: true, total, unreadable, keyMismatch, noBackup, legacyPlain, affected: affected.slice(0, 25), cuentas: cuentas.slice(0, 200) })
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
        // Se prefiere el mensaje del servidor de códigos: "ese código ya se
        // usó" es una instrucción; "incorrecto o vencido" deja adivinando.
        if (!otpRes?.ok) return json({ error: otpRes?.message ?? 'Código de correo incorrecto o vencido.' }, 403)
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

      // Borrar la PROPIA cuenta. Solo con la cuenta en cero y sin envíos en
      // curso, y SIN borrar los movimientos: son el historial contable y de
      // cumplimiento de lo que pasó por Lincoin, y no dependen de que la
      // persona siga siendo cliente. Antes se borraba todo, con plata adentro
      // o con envíos saliendo, y bastaba la sesión.
      if (selfServiceBody.action === 'delete_self') {
        const selfUser = await usuarioDelToken(req)
        if (!selfUser) return json({ error: 'Unauthorized' }, 401)
        const { data: selfProfile } = await db.from('users').select('role, balances, crypto_balances, raw_data').eq('id', selfUser.id).maybeSingle()
        if ((selfProfile as any)?.role === 'admin') return json({ error: 'Una cuenta de administración no se borra desde aquí. Pídeselo al dueño del panel.' }, 403)
        // Con 2FA activo, la sesión tiene que haberlo pasado: la contraseña
        // sola no alcanza para borrar una cuenta.
        { const mfaErr = await requireMfaSession(req, selfUser.id); if (mfaErr) return json({ error: mfaErr, needs2fa: true }, 403) }
        const conSaldo = [ (selfProfile as any)?.balances, (selfProfile as any)?.crypto_balances ]
          .some(b => b && typeof b === 'object' && Object.values(b).some(v => Math.abs(Number(v) || 0) > 0.009))
        if (conSaldo) return json({ error: 'Tu cuenta todavía tiene saldo. Retíralo o conviértelo antes de cerrarla.' }, 409)
        const { data: enCurso } = await db.from('transactions').select('id').eq('user_id', selfUser.id)
          .in('status', ['Pendiente', 'Procesando']).limit(1)
        if (Array.isArray(enCurso) && enCurso.length) return json({ error: 'Tienes movimientos en curso. Espera a que terminen antes de cerrar la cuenta.' }, 409)
        const selfIndex: number | undefined = (selfProfile as any)?.raw_data?.gasfreeHdIndex
        await auditAdmin(req, 'cuenta.cerrada_por_titular', { userId: selfUser.id })
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
          return json({ error: 'Tu perfil se cerró, pero la cuenta de acceso no se pudo borrar. Contacta soporte para liberar el correo.' }, 500)
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
    // Un miembro dado de baja no opera ni consulta, tampoco por GET.
    if (auth.acceso?.desactivado) {
      await auditAdmin(req, 'auth.permiso_denegado', { accion: String(selfServiceBody?.action ?? req.method), motivo: 'miembro desactivado', userId: auth.userId })
      return json({ error: 'Tu acceso al panel fue desactivado.', permisoDenegado: true }, 403)
    }
    // La política de acceso también corta una sesión ya abierta: si la sesión
    // se mueve a una conexión no autorizada, deja de servir.
    { const den = await accessDenied(req); if (den) return json({ error: den, accessDenied: true }, 403) }
    // Media hora sin usar el panel y la sesión deja de servir, aunque el token
    // siga vigente. Un computador que quedó abierto no es una sesión válida.
    if (await sesionInactiva(req, String(auth.userId ?? ''))) {
      await auditAdmin(req, 'auth.sesion_cerrada_por_inactividad', { userId: auth.userId })
      return json({ error: 'La sesión se cerró por inactividad. Vuelve a iniciar sesión.', sesionInactiva: true }, 403)
    }
    // Una cuenta bloqueada no opera ni con la sesión ya abierta.
    if (auth.userId && await adminLock(auth.userId)) {
      return json({ error: 'La cuenta está bloqueada por seguridad. Revisa tu correo para desbloquearla.', locked: true }, 423)
    }

    if (req.method === 'POST') {
      const body = selfServiceBody ?? {}

      // ── PERMISO DEL MIEMBRO ───────────────────────────────────────────
      // Acá se decide si esta persona puede pedir esto, antes que cualquier
      // otra cosa. Lo que no está en PERMISO_DE_ACCION se niega a todo el
      // que no sea dueño: una acción nueva sin anotar falla, no filtra.
      {
        const acceso = auth.acceso ?? { rol: 'lectura' as Rol, paises: [], todosLosPaises: false }
        const accion = String(body.action ?? '')
        const permisos = PERMISOS_POR_ROL[acceso.rol] ?? new Set<string>()
        const necesita = PERMISO_DE_ACCION[accion]
        const puede = permisos.has('*') || (!!necesita && permisos.has(necesita))
        if (!puede) {
          await auditAdmin(req, 'auth.permiso_denegado', { accion, rol: acceso.rol, userId: auth.userId })
          return json({
            error: 'Tu rol no permite esta operación.',
            permisoDenegado: true, rol: acceso.rol,
          }, 403)
        }
      }

      // Acciones que cambian dinero, cuentas o la propia seguridad: exigen
      // que ESTA sesión haya pasado el 2FA, no solo la contraseña. Las de
      // consulta se dejan fuera a propósito, para no dejar al admin sin panel
      // si algo del 2FA falla — lo que se protege es lo que hace daño.
      const SENSITIVE_ADMIN_ACTIONS = new Set([
        // Mueven dinero
        'admin_credit_balance', 'admin_credit_crypto',
        'approve_rail_move', 'reject_rail_move',
        // Cambian cuentas o el estado de cumplimiento
        // ('save_user' NO va aquí: se resuelve antes, en la zona self-service
        //  que también usan los clientes con su propia cuenta. Ahí lo que
        //  protege es SERVER_OWNED + el trigger de columnas sensibles.)
        'delete_user', 'force_delete_by_email', 'set_kyc_status',
        // Cambian la configuración o la propia seguridad
        'save_config', 'block_ip', 'unblock_ip', 'log_key_rotation',
        // Facturan ante la DIAN o cambian las credenciales de Siigo
        'fact_lincoin_set', 'fact_lincoin_emitir',
        // Quién entra al panel y con qué rol
        'equipo_guardar', 'equipo_desactivar',
        // Cumplimiento: cupos por beneficiario
        'cupo_resolver', 'cupos_config_set', 'cupo_quitar',
        // Contabilidad: vincular un débito cambia la utilidad y la factura
        'contabilidad_vincular_ajuste', 'contabilidad_autovincular',
      ])
      // Reconstruir movimientos escribe en la base; solo consultar, no.
      const sensiblePorParametro = body.action === 'conciliar_movimientos' && !!body.reparar
      if (SENSITIVE_ADMIN_ACTIONS.has(String(body.action)) || sensiblePorParametro) {
        const mfaErr = await requireMfaSession(req, auth.userId)
        if (mfaErr) return json({ error: mfaErr, needs2fa: true }, 403)
      }

      // TESORERÍA: además del 2FA de la sesión, exige la verificación
      // reforzada —correo + código de la app, y la llave si la cuenta tiene
      // alguna— hecha hace menos de media hora. Es lo que impide que una
      // sesión robada, ya abierta, mueva plata: el atacante tendría que
      // volver a tener el correo, el teléfono y la llave física en el momento.
      const TESORERIA_ACTIONS = new Set([
        'admin_credit_balance', 'admin_credit_crypto',
        'approve_rail_move', 'reject_rail_move',
      ])
      if (TESORERIA_ACTIONS.has(String(body.action))) {
        const falta = await stepUpFalta(req, String(auth.userId ?? ''))
        if (falta.length) {
          return json({ error: 'Verifica tu identidad para operar en Tesorería.', stepUp: true, falta }, 403)
        }
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
        // "Ingresos de administrador": solo los ingresos de admin verificados
        // y las acciones del panel. Un login de cliente con IP no va acá.
        const withIp = (acts ?? []).filter((a: any) => a?.action === 'auth.admin_login' || (typeof a?.action === 'string' && a.action.startsWith('admin.') && a?.metadata?.ip))
          .map((a: any) => ({ action: a.action, at: a.metadata?.at ?? a.created_at, byEmail: a.metadata?.byEmail ?? null, ip: a.metadata?.ip ?? null, userAgent: a.metadata?.userAgent ?? null, hadSession: a.metadata?.hadSession }))
        return json({ ok: true, admins, activity: withIp })
      }

      // ── Quién soy y qué puedo ver ─────────────────────────────────────
      // Lo pide el panel al entrar, para saber qué países ofrecer y qué
      // secciones dibujar. Es un REFLEJO de lo que ya decidió el servidor,
      // no la decisión: mentirle a esta respuesta no abre ninguna puerta,
      // porque cada acción se vuelve a verificar de todos modos.
      if (body.action === 'mi_acceso') {
        const a = auth.acceso ?? { rol: 'lectura' as Rol, paises: [], todosLosPaises: false }
        // Los países salen de la misma configuración que ya usa el panel, para
        // que no queden dos listas que se desincronizan.
        let estados: Record<string, string> = {}
        try {
          const { data: cfg } = await db.from('app_config').select('settings').eq('id', 1).maybeSingle()
          estados = ((cfg as any)?.settings?.countryStatus ?? {}) as Record<string, string>
        } catch { /* sin config, se usa el valor por defecto de abajo */ }
        const CATALOGO = [
          { code: 'CO', nombre: 'Colombia' },
          { code: 'US', nombre: 'Estados Unidos' },
          { code: 'MX', nombre: 'México' },
          { code: 'BR', nombre: 'Brasil' },
        ]
        const paises = CATALOGO
          .map((c) => ({ ...c, estado: estados[c.nombre] ?? (c.code === 'CO' ? 'on' : 'soon') }))
          .filter((c) => a.todosLosPaises || a.paises.includes(c.code))

        try {
          await db.from('admin_miembros')
            .update({ ultimo_acceso_at: new Date().toISOString() }).eq('id', auth.userId)
        } catch { /* el último acceso es informativo, no bloquea entrar */ }

        return json({
          ok: true, rol: a.rol, todosLosPaises: a.todosLosPaises,
          permisos: [...(PERMISOS_POR_ROL[a.rol] ?? [])],
          paises,
        })
      }

      // ── El equipo (solo el dueño) ─────────────────────────────────────
      if (body.action === 'equipo_listar') {
        const { data, error } = await db.from('admin_miembros')
          .select('*').order('creado_at', { ascending: true })
        if (error) return json({ ok: false, error: error.message }, 500)
        return json({ ok: true, miembros: data ?? [] })
      }

      if (body.action === 'equipo_guardar') {
        const email = String(body.email ?? '').toLowerCase().trim()
        const rol = String(body.rol ?? '') as Rol
        if (!email) return json({ ok: false, error: 'falta_email' }, 400)
        if (!['dueno', 'operaciones', 'cumplimiento', 'lectura'].includes(rol)) {
          return json({ ok: false, error: 'rol_invalido' }, 400)
        }
        const paises = Array.isArray(body.paises) ? body.paises.map((p: unknown) => String(p).toUpperCase()) : []

        // El permiso se le da a una CUENTA QUE YA EXISTE. Esto no crea
        // accesos: la persona tiene que tener su cuenta en Lincoin con rol
        // admin. Si no existe, se dice claro en vez de guardar una fila
        // huérfana que no sirve para nada y que nadie entiende después.
        const { data: cuenta } = await db.from('users')
          .select('id, role, name').ilike('email', email).maybeSingle()
        if (!cuenta) {
          return json({ ok: false, error: 'sin_cuenta', message: 'Esa persona todavía no tiene cuenta en Lincoin. Que se registre primero.' }, 400)
        }
        if ((cuenta as any).role !== 'admin') {
          return json({ ok: false, error: 'sin_rol_admin', message: 'Esa cuenta existe pero no tiene rol de administrador. Cambiáselo primero en Clientes.' }, 400)
        }

        const fila = {
          id: (cuenta as any).id,
          email,
          nombre: String(body.nombre ?? (cuenta as any).name ?? '').slice(0, 120) || null,
          rol,
          paises: rol === 'dueno' ? [] : paises,   // al dueño no se le miran
          activo: body.activo === false ? false : true,
          actualizado_at: new Date().toISOString(),
          creado_por: auth.userId,
        }
        const { error } = await db.from('admin_miembros').upsert(fila, { onConflict: 'id' })
        if (error) return json({ ok: false, error: error.message }, 500)

        await auditAdmin(req, 'equipo.guardado', { email, rol, paises: fila.paises, activo: fila.activo })
        return json({ ok: true })
      }

      if (body.action === 'equipo_desactivar') {
        const id = String(body.id ?? '')
        if (!id) return json({ ok: false, error: 'falta_id' }, 400)
        // Nadie se quita el acceso a sí mismo por accidente: quedaría un panel
        // sin dueño y sin forma de volver a entrar salvo tocando la base.
        if (id === auth.userId) {
          return json({ ok: false, error: 'no_a_vos_mismo', message: 'No podés quitarte el acceso a vos mismo.' }, 400)
        }
        const { error } = await db.from('admin_miembros')
          .update({ activo: false, actualizado_at: new Date().toISOString() }).eq('id', id)
        if (error) return json({ ok: false, error: error.message }, 500)
        await auditAdmin(req, 'equipo.desactivado', { id })
        return json({ ok: true })
      }

      // ── Correos que NO están llegando ─────────────────────────────────
      // Cuando una dirección rebota en duro o alguien marca un correo como
      // spam, Resend la suprime y deja de mandarle -- pero a nosotros nos
      // sigue contestando que aceptó el envío. La app le dice a esa persona
      // "revisá tu correo" para un correo que nunca va a salir, y ella no
      // puede avisarnos: el correo es justo el canal que se rompió.
      //
      // Esta lista es la única forma de enterarse. Sale de resend-webhook.
      if (body.action === 'email_incidencias') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const { data, error } = await db.from('email_incidencias')
          .select('*').eq('resuelto', false)
          .order('creado_at', { ascending: false }).limit(100)
        if (error) return json({ ok: false, error: error.message }, 500)

        // Una misma dirección puede rebotar muchas veces. Interesa la
        // dirección, no cada rebote: 40 filas del mismo correo no son 40
        // problemas, y ver la lista así hace que nadie la mire.
        const porEmail = new Map<string, any>()
        for (const r of (data ?? [])) {
          const k = String((r as any).email ?? '').toLowerCase()
          const ya = porEmail.get(k)
          if (!ya) porEmail.set(k, { ...(r as any), veces: 1 })
          else {
            ya.veces++
            // Un rebote duro manda sobre uno blando aunque sea más viejo: es
            // el que dice que esa dirección no va a funcionar nunca más.
            if ((r as any).dureza === 'hard' && ya.dureza !== 'hard') {
              ya.dureza = 'hard'; ya.tipo = (r as any).tipo; ya.motivo = (r as any).motivo
            }
          }
        }
        return json({ ok: true, incidencias: [...porEmail.values()] })
      }

      // Marcar resuelto = "ya la saqué de la lista de supresión de Resend y
      // confirmé que le llega". No lo arregla solo: sacarla de la supresión
      // es un paso a mano en Resend, y esto solo deja constancia.
      if (body.action === 'email_incidencia_resuelta') {
        const v = await verifyAdmin(req)
        if (!v.ok) return json({ error: 'No autorizado' }, 401)
        const email = String(body.email ?? '').toLowerCase().trim()
        if (!email) return json({ ok: false, error: 'falta_email' }, 400)
        const { error } = await db.from('email_incidencias')
          .update({ resuelto: true, resuelto_at: new Date().toISOString(), resuelto_por: v.userId ?? null })
          // Comodines escapados: un '%' marcaba resueltas TODAS las incidencias.
          .eq('resuelto', false).ilike('email', email.replace(/[\\%_]/g, ch => `\\${ch}`))
        if (error) return json({ ok: false, error: error.message }, 500)
        return json({ ok: true })
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
        // Historial de cambios del 2FA: lo escribe el trigger trg_audit_mfa_change
        // (migración 2026_lock_mfa_credentials.sql). Responde "¿cuándo se
        // apagó y quién lo apagó?" sin tener que entrar a la base.
        const mfaChanges = all.filter((r: any) => r.action === 'security.mfa_changed' || r.action === 'security.mfa_disabled')
          .slice(0, 15).map((r: any) => ({
            at: at(r),
            cuenta: r?.metadata?.cuenta ?? r?.metadata?.byEmail ?? null,
            antes: r?.metadata?.antes ?? null,
            despues: r?.metadata?.despues ?? (r.action === 'security.mfa_disabled' ? 'false' : null),
            porRol: r?.metadata?.rolDeLaSesion ?? null,
            ip: r?.metadata?.ip ?? null,
          }))
        const rot = all.find((r: any) => r.action === 'security.key_rotation')
        return json({
          ok: true,
          failedToday: failedToday.length,
          failedByIp: Object.values(byIpMap).sort((a: any, b: any) => b.count - a.count),
          blockedIps: await blockedIps(),
          access,
          incidents,
          mfaChanges,
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

      // ── Mapa de conexiones ───────────────────────────────────────────────
      // Cada punto es una IP REAL sacada de la auditoría y de la lista de
      // bloqueos, ubicada con la geolocalización que ya se venía usando.
      // No hay puntos de ejemplo: un mapa de seguridad con conexiones
      // inventadas enseña a ignorarlo, y el día que aparezca una de verdad
      // se va a ver igual que el relleno.
      if (body.action === 'command_map') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const dias = Math.min(Math.max(Number(body.dias ?? 30) || 30, 1), 90)
        const desde = new Date(Date.now() - dias * 86400_000).toISOString()

        // Un ingreso "de admin" es SOLO auth.admin_login: se escribe después
        // de verifyAdmin, o sea con el rol admin comprobado en public.users.
        // Los otros dos eventos (2FA completo, passkey) los genera cualquier
        // cliente que entra con su código; contarlos como admin hacía que el
        // mapa mostrara a empresas y personas como "Admins", y eso se leía
        // como una escalada de privilegios que no existía.
        const ADMIN = ['auth.admin_login']
        const CLIENTE = ['auth.aviso_ingreso', 'auth.login_2fa_completo', 'auth.login_passkey']
        const FALLO = ['auth.failed_login', 'auth.mfa_failed']
        const { data: ev } = await db.from('audit_log')
          .select('action, metadata, created_at, user_id')
          .in('action', [...ADMIN, ...CLIENTE, ...FALLO])
          .gte('created_at', desde).order('created_at', { ascending: false }).limit(1500)

        type Punto = {
          ip: string; tipo: 'admin' | 'usuario' | 'fallido' | 'bloqueada'
          sesiones: number; primera: string; ultima: string
          userId?: string | null; nombre?: string | null; correo?: string | null
          rol?: 'admin' | 'empresa' | 'personal' | null
          ciudad?: string | null; pais?: string | null; isp?: string | null
          lat?: number | null; lon?: number | null; motivo?: string | null
          adminReal?: boolean
        }
        const porIp = new Map<string, Punto>()
        const orden = { bloqueada: 3, admin: 2, usuario: 1, fallido: 0 } as const

        for (const r of (ev ?? []) as any[]) {
          const ip = String(r?.metadata?.ip ?? '')
          if (!ip) continue
          const tipo: Punto['tipo'] = ADMIN.includes(r.action) ? 'admin'
            : CLIENTE.includes(r.action) ? 'usuario' : 'fallido'
          const y = porIp.get(ip)
          if (!y) {
            porIp.set(ip, {
              ip, tipo, sesiones: 1, primera: r.created_at, ultima: r.created_at,
              userId: r.user_id ?? r?.metadata?.userId ?? null,
              // El correo del evento. Es el respaldo cuando el registro no
              // quedó con user_id (una sesión que no se pudo resolver, un
              // intento fallido): sin esto el punto se queda sin nombre y el
              // mapa muestra "Admins" para todo, que es lo que no deja saber
              // si la IP es del equipo o de una empresa.
              correo: r?.metadata?.byEmail ?? r?.metadata?.email ?? null,
              adminReal: tipo === 'admin',
            })
          } else {
            if (!y.correo) y.correo = r?.metadata?.byEmail ?? r?.metadata?.email ?? null
            if (!y.userId) y.userId = r.user_id ?? r?.metadata?.userId ?? null
            y.sesiones++
            if (r.created_at < y.primera) y.primera = r.created_at
            if (r.created_at > y.ultima) y.ultima = r.created_at
            if (tipo === 'admin') y.adminReal = true
            // Manda el tipo más relevante: una IP con ingresos de admin es de
            // admin aunque también tenga fallos.
            if (orden[tipo] > orden[y.tipo]) y.tipo = tipo
          }
        }

        // Los bloqueos mandan sobre cualquier otro tipo.
        for (const b of await blockedIps()) {
          const y = porIp.get(b.ip)
          if (y) { y.tipo = 'bloqueada'; y.motivo = b.reason ?? null }
          else porIp.set(b.ip, { ip: b.ip, tipo: 'bloqueada', sesiones: b.attempts ?? 0, primera: b.at, ultima: b.at, motivo: b.reason ?? null })
        }

        // Nombre del titular, para que el punto diga QUIÉN y no solo un id.
        const ids = [...new Set([...porIp.values()].map(p => p.userId).filter(Boolean))] as string[]
        if (ids.length) {
          // Se trae también el ROL y la razón social: en el mapa, "Admins" a
          // secas no deja saber si esa IP es del equipo o de una empresa
          // cliente, que es justo lo que hay que distinguir de un vistazo.
          const { data: us } = await db.from('users').select('id, name, email, company_name, role').in('id', ids.slice(0, 200))
          const mapa = new Map((us ?? []).map((u: any) => [u.id, u]))
          for (const p of porIp.values()) {
            const u = p.userId ? mapa.get(p.userId) : null
            if (u) {
              const x = u as any
              p.nombre = x.company_name ?? x.name ?? null
              p.correo = x.email ?? p.correo ?? null
              p.rol = x.role === 'admin' ? 'admin' : x.role === 'business' ? 'empresa' : 'personal'
            }
          }
        }
        // Los que quedaron sin id pero con correo: se resuelven por correo.
        // Es el caso de los ingresos que no alcanzaron a asociar la sesión.
        {
          const correos = [...new Set([...porIp.values()].filter(p => !p.nombre && p.correo).map(p => String(p.correo)))]
          if (correos.length) {
            const { data: us2 } = await db.from('users').select('id, name, email, company_name, role').in('email', correos.slice(0, 200))
            const porCorreo = new Map((us2 ?? []).map((u: any) => [String(u.email).toLowerCase(), u]))
            for (const p of porIp.values()) {
              if (p.nombre || !p.correo) continue
              const x = porCorreo.get(String(p.correo).toLowerCase()) as any
              if (x) {
                p.nombre = x.company_name ?? x.name ?? null
                p.userId = p.userId ?? x.id
                p.rol = x.role === 'admin' ? 'admin' : x.role === 'business' ? 'empresa' : 'personal'
              }
            }
          }
        }

        // El tipo final lo decide el ROL REAL del titular en public.users, no
        // el evento: un punto es "admin" solo si la cuenta es admin o si hubo
        // un auth.admin_login (que ya pasó por verifyAdmin). Una cuenta
        // empresa o personal que entró con su código es "usuario", siempre.
        for (const p of porIp.values()) {
          if (p.tipo === 'bloqueada' || p.tipo === 'fallido') continue
          p.tipo = (p.rol === 'admin' || p.adminReal) ? 'admin' : 'usuario'
        }
        for (const p of porIp.values()) delete p.adminReal

        // Geolocalización: se limita a las más recientes para no encadenar
        // cientos de consultas externas en una sola petición.
        const lista = [...porIp.values()].sort((a, b) => String(b.ultima).localeCompare(String(a.ultima))).slice(0, 80)
        for (const p of lista) {
          const g = await geoOf(p.ip)
          p.ciudad = g?.city ?? null; p.pais = g?.country ?? null
          p.isp = g?.org ?? null
          p.lat = typeof g?.lat === 'number' ? g.lat : null
          p.lon = typeof g?.lon === 'number' ? g.lon : null
        }
        return json({ ok: true, puntos: lista, dias })
      }

      // ── Intentos de ingreso, día por día (14 días) ──────────────────────
      // Lo que hace útil a esta gráfica no es el total: es ver el DÍA que se
      // sale de la fila. Un pico de fallidos sobre una base plana es un
      // intento de entrar; el mismo número repartido en dos semanas es gente
      // que escribe mal su contraseña.
      if (body.action === 'security_series') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const desde = new Date(Date.now() - 13 * 86400_000)
        desde.setHours(0, 0, 0, 0)
        const FALLOS = ['auth.failed_login', 'auth.mfa_failed']
        // Solo el ingreso de admin verificado cuenta como acceso de admin.
        const EXITOS = ['auth.admin_login']
        const { data } = await db.from('audit_log').select('action, created_at')
          .in('action', [...FALLOS, ...EXITOS])
          .gte('created_at', desde.toISOString()).limit(5000)
        const dias: Record<string, { ok: number; fail: number }> = {}
        for (let i = 0; i < 14; i++) {
          dias[new Date(desde.getTime() + i * 86400_000).toISOString().slice(0, 10)] = { ok: 0, fail: 0 }
        }
        for (const r of (data ?? []) as any[]) {
          const k = String(r.created_at ?? '').slice(0, 10)
          if (!dias[k]) continue
          if (FALLOS.includes(r.action)) dias[k].fail++
          else dias[k].ok++
        }
        return json({ ok: true, serie: Object.entries(dias).map(([dia, v]) => ({ dia, ...v })) })
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
        // Solo lo que se revisa (el equipo, las cuentas con 2FA y los secretos
        // viejos en claro), por páginas y con las claves justas de raw_data.
        const { filas: rows } = await leerPorPaginas(() => db.from('users')
          .select('id, email, role, raw_data:raw_data->>mfaEnabled, enc:raw_data->>totpSecretEnc, plano:raw_data->>totpSecret, resp:raw_data->mfaBackupHashes')
          .or('role.eq.admin,raw_data->>mfaEnabled.eq.true,raw_data->>totpSecret.not.is.null'))
        for (const u of rows) u.raw_data = { mfaEnabled: u.raw_data === 'true', totpSecretEnc: u.enc ?? undefined, totpSecret: u.plano ?? undefined, mfaBackupHashes: u.resp ?? undefined }
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

        // Correos repetidos: los cuenta la base (admin_correos_duplicados); sin
        // esa función, se leen solo los correos, por páginas.
        let dupes: [string, number][] = []
        {
          const { data: dup, error: eDup } = await db.rpc('admin_correos_duplicados')
          if (!eDup && Array.isArray(dup)) dupes = (dup as any[]).map(d => [String(d.email), Number(d.n)] as [string, number])
          else {
            const { filas: correos } = await leerPorPaginas(() => db.from('users').select('id, email'))
            const porCorreo: Record<string, number> = {}
            for (const u of correos) { const e = String(u.email ?? '').toLowerCase(); if (e) porCorreo[e] = (porCorreo[e] ?? 0) + 1 }
            dupes = Object.entries(porCorreo).filter(([, n]) => n > 1)
          }
        }
        if (dupes.length) add('dup_emails', 'alta', `${dupes.length} correo(s) con más de una cuenta`,
          `Filas duplicadas hacen que el login lea una y el panel otra: ${dupes.map(([e, n]) => `${e} (${n})`).join(', ')}.`,
          'Deja solo la fila que tiene cuenta de acceso real y borra la sobrante.', dupes.length)

        // Filas con rol admin que NO tienen usuario de Auth: no pueden iniciar
        // sesión, pero cuentan como admin en cualquier consulta por rol.
        // Se pregunta por cada admin (son pocos): la primera página de 200
        // cuentas de acceso dejaba fuera a casi todos cuando hay miles, y los
        // marcaba huérfanos sin serlo.
        try {
          const huerfanos: any[] = []
          for (const a of admins) {
            const { data: au, error: eAu } = await db.auth.admin.getUserById(String(a.id))
            if (eAu && !/not.?found|no.*encontr/i.test(String(eAu.message ?? ''))) throw eAu
            if (!au?.user) huerfanos.push(a)
          }
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

      // Política de acceso: leer. Incluye la IP y el país DESDE DONDE se está
      // consultando, para poder encenderla sin quedar afuera por sorpresa.
      // ── Ajuste de la tasa OTC: los "puntos" que se le bajan al proveedor ──
      // Se guarda en pesos por dólar. Si Finity da 3.097,75 y el ajuste es 5,
      // la tasa que se muestra Y con la que se abona es 3.092,75; esos 5 pesos
      // por dólar son el margen de Lincoin.
      if (body.action === 'otc_ajuste_get') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const { data } = await db.from('system_config').select('value').eq('key', 'otc_rate_ajuste').maybeSingle()
        let v: any = null
        try { v = (data as any)?.value ? JSON.parse((data as any).value) : null } catch { v = null }
        const n = (x: any) => { const k = Number(x); return Number.isFinite(k) && k >= 0 ? k : 0 }
        return json({ ok: true, ajuste: { finityCop: n(v?.finityCop), mouvCop: n(v?.mouvCop), at: v?.at ?? null, por: v?.por ?? null } })
      }

      // Guardar el ajuste. Cambia cuánto recibe cada cliente por cada dólar
      // que convierte, así que es una acción sensible: exige el segundo factor
      // de la sesión, igual que el resto de lo que toca dinero.
      if (body.action === 'otc_ajuste_set') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const mfaErr = await requireMfaSession(req, auth.userId)
        if (mfaErr) return json({ error: mfaErr, needs2fa: true }, 403)
        // Tope duro. Un dedazo acá —500 en vez de 5— le quitaría a cada
        // cliente 500 pesos por dólar sin que nadie lo note hasta el reclamo.
        const TOPE = 200
        const lee = (x: any) => {
          const n = Number(String(x ?? '').replace(',', '.'))
          if (!Number.isFinite(n) || n < 0) return 0
          return Math.min(n, TOPE)
        }
        const finityCop = lee(body.finityCop)
        const mouvCop = lee(body.mouvCop)
        if (Number(body.finityCop) > TOPE || Number(body.mouvCop) > TOPE) {
          return json({ error: `El ajuste no puede pasar de ${TOPE} pesos por dólar.` }, 400)
        }
        const valor = { finityCop, mouvCop, at: new Date().toISOString(), por: String(auth.userId ?? '') }
        const { error } = await db.from('system_config').upsert({ key: 'otc_rate_ajuste', value: JSON.stringify(valor) }, { onConflict: 'key' })
        if (error) return json({ error: error.message }, 500)
        await auditAdmin(req, 'otc.ajuste_tasa', { finityCop, mouvCop })
        return json({ ok: true, ajuste: valor })
      }

      // ── TODOS los movimientos de UN cliente ───────────────────────────
      // La carga general del panel trae solo los 200 movimientos más
      // recientes de TODA la plataforma (más los pendientes). Con eso, al
      // abrir un cliente se veía apenas lo que cayera en esa ventana: los
      // cargues y movimientos más viejos "no existían". Esto trae el
      // historial completo de esa cuenta, con el mismo filtro por país que
      // la carga general.
      // ── CUPOS POR BENEFICIARIO (Cumplimiento) ─────────────────────────
      // El oficial de cumplimiento ve las solicitudes con sus documentos y
      // decide el cupo. También fija los cupos generales.
      // Solo el número de solicitudes por revisar, para el aviso del menú.
      // Sin documentos ni URLs firmadas: se pregunta cada minuto.
      if (body.action === 'cupos_pendientes') {
        const { count, error } = await db.from('cupo_solicitudes').select('id', { count: 'exact', head: true }).eq('estado', 'en_proceso')
        if (error) return json({ ok: true, pendientes: 0, falta: /does not exist|42P01|schema cache/i.test(error.message) })
        return json({ ok: true, pendientes: count ?? 0 })
      }
      if (body.action === 'cupos_admin_get') {
        const general = await cupoGeneral(db)
        const leerTabla = async (q: any) => { const { data, error } = await q; if (error) throw new Error(error.message); return (data ?? []) as any[] }
        let enProceso: any[] = [], resueltas: any[] = [], aprobados: any[] = []
        try {
          enProceso = await leerTabla(db.from('cupo_solicitudes').select('*').eq('estado', 'en_proceso').order('created_at', { ascending: true }).limit(300))
          resueltas = await leerTabla(db.from('cupo_solicitudes').select('*').neq('estado', 'en_proceso').order('revisado_at', { ascending: false }).limit(100))
          aprobados = await leerTabla(db.from('cupos_beneficiario').select('*').order('aprobado_at', { ascending: false }).limit(500))
        } catch (e) {
          return json({ ok: true, general, falta: /does not exist|42P01|schema cache/i.test((e as Error).message), error: (e as Error).message, solicitudes: [], aprobados: [] })
        }
        const ids = Array.from(new Set([...enProceso, ...resueltas, ...aprobados].map(x => String(x.user_id))))
        const nombres = new Map<string, any>()
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await db.from('users').select('id, email, full_name, company_name').in('id', ids.slice(i, i + 200))
          for (const u of (data ?? []) as any[]) nombres.set(String(u.id), u)
        }
        const quien = (id: string) => { const u = nombres.get(id); return u ? (u.company_name || u.full_name || u.email) : id }
        // Lo usado HOY en el mes, para decidir con el dato fresco. Con la misma
        // cuenta que corta el envío: el documento Y todos los destinos de ese
        // beneficiario en la ficha del cliente (antes, para las claves por
        // documento no se miraban los destinos y salía menos de lo real).
        const usoActual = new Map<string, EnvioMes[]>()
        const contactosDe = new Map<string, any[]>()
        for (const uid of Array.from(new Set(enProceso.map(x => String(x.user_id))))) {
          try { usoActual.set(uid, await enviosDelMes(db, await idsMismaPersona(uid))) } catch { usoActual.set(uid, []) }
          try {
            const { data: uc } = await db.from('users').select('raw_data').eq('id', uid).maybeSingle()
            contactosDe.set(uid, Array.isArray((uc as any)?.raw_data?.mouvContacts) ? (uc as any).raw_data.mouvContacts : [])
          } catch { contactosDe.set(uid, []) }
        }
        const firmar = async (docs: any[]) => {
          const out: any[] = []
          for (const d of Array.isArray(docs) ? docs : []) {
            try { const { data } = await db.storage.from(BUCKET_CUPOS).createSignedUrl(String(d.path), 3600); out.push({ ...d, url: data?.signedUrl ?? null, nombreTipo: TIPOS_DOC_CUPO[d.tipo]?.nombre ?? d.tipo }) }
            catch { out.push({ ...d, url: null, nombreTipo: TIPOS_DOC_CUPO[d.tipo]?.nombre ?? d.tipo }) }
          }
          return out
        }
        const solicitudes: any[] = []
        for (const sx of [...enProceso, ...resueltas]) {
          const envios = usoActual.get(String(sx.user_id))
          let usadoHoy: number | null = null
          if (envios) {
            const cts = contactosDe.get(String(sx.user_id)) ?? []
            const ct = cts.find(x => String(x?.id) === String(sx.contacto_id ?? ''))
            usadoHoy = ct
              ? estadoCupoContacto(ct, cts, envios, { persona: 0, empresa: 0 }, new Map()).usado
              : usadoPara(envios, sx.beneficiario_doc, String(sx.beneficiario_clave).startsWith('dest:') ? [String(sx.beneficiario_clave).slice(5)] : [])
          }
          solicitudes.push({ ...sx, cliente: quien(String(sx.user_id)), usadoHoy, documentos: await firmar(sx.documentos) })
        }
        return json({ ok: true, general, solicitudes, aprobados: aprobados.map(a => ({ ...a, cliente: quien(String(a.user_id)) })) })
      }

      if (body.action === 'cupos_config_set') {
        const lee = (x: any) => { const k = Number(String(x ?? '').replace(/[^\d]/g, '')); return Number.isFinite(k) && k >= 1_000_000 && k <= 100_000_000_000 ? k : null }
        const persona = lee(body.persona), empresa = lee(body.empresa)
        if (!persona || !empresa) return json({ ok: false, error: 'Escribe los cupos en pesos (mínimo 1.000.000).' }, 400)
        const antes = await cupoGeneral(db)
        const valor = { persona, empresa, at: new Date().toISOString(), por: String(auth.userId ?? '') }
        const { error } = await db.from('system_config').upsert({ key: 'cupos_beneficiario', value: JSON.stringify(valor) }, { onConflict: 'key' })
        if (error) return json({ ok: false, error: error.message }, 500)
        await auditAdmin(req, 'cupos.general', { antes, despues: valor })
        return json({ ok: true, general: { persona, empresa } })
      }

      if (body.action === 'cupo_resolver') {
        const id = Number(body.id)
        const { data: sol } = await db.from('cupo_solicitudes').select('*').eq('id', id).maybeSingle()
        if (!sol) return json({ ok: false, error: 'No se encontró la solicitud.' }, 404)
        if ((sol as any).estado !== 'en_proceso') return json({ ok: false, error: 'Esa solicitud ya fue revisada.' }, 409)
        const aprobar = body.aprobar === true
        const nota = String(body.nota ?? '').trim().slice(0, 1000) || null
        const ahora = new Date().toISOString()
        const sx = sol as any
        let cupo: number | null = null
        if (aprobar) {
          cupo = Math.round(Number(String(body.cupo ?? '').replace(/[^\d]/g, '')))
          if (!(cupo > 0) || cupo > 100_000_000_000) return json({ ok: false, error: 'Escribe el cupo mensual aprobado en pesos.' }, 400)
          // Un "aumento" tiene que AUMENTAR: el cupo que rige nunca baja del
          // general (cupoVigente), así que aprobar uno menor no haría nada y
          // confundiría al cliente.
          const gen = await cupoGeneral(db)
          const base = String(sx.beneficiario_tipo) === 'empresa' ? gen.empresa : gen.persona
          if (cupo <= base) return json({ ok: false, error: `El cupo aprobado tiene que ser mayor al general (${base.toLocaleString('es-CO')} COP).` }, 400)
        } else if (!nota) {
          return json({ ok: false, error: 'Escribe el motivo del rechazo: es lo que verá el cliente.' }, 400)
        }
        // PRIMERO se cierra la solicitud (solo si sigue en proceso) y DESPUÉS
        // se escribe el cupo. Al revés, dos oficiales a la vez (uno aprueba,
        // otro rechaza) dejaban la solicitud "rechazada" con el cupo aprobado
        // vigente.
        const { data: hecho } = await db.from('cupo_solicitudes').update({
          estado: aprobar ? 'aprobada' : 'rechazada', cupo_aprobado: cupo, nota_revision: nota, revisado_por: String(auth.userId ?? ''), revisado_at: ahora,
        }).eq('id', sx.id).eq('estado', 'en_proceso').select('id')
        if (!hecho || !(hecho as any[]).length) return json({ ok: false, error: 'Otra persona la revisó al mismo tiempo. Recarga.' }, 409)
        if (aprobar) {
          const { error: eUp } = await db.from('cupos_beneficiario').upsert({
            user_id: sx.user_id, beneficiario_clave: sx.beneficiario_clave, beneficiario_nombre: sx.beneficiario_nombre, beneficiario_doc: sx.beneficiario_doc,
            beneficiario_tipo: sx.beneficiario_tipo, cupo_mensual: cupo, solicitud_id: sx.id, aprobado_por: String(auth.userId ?? ''), aprobado_at: ahora,
          }, { onConflict: 'user_id,beneficiario_clave' })
          if (eUp) {
            // Sin cupo escrito, la solicitud vuelve a quedar por revisar.
            await db.from('cupo_solicitudes').update({ estado: 'en_proceso', cupo_aprobado: null, revisado_por: null, revisado_at: null }).eq('id', sx.id)
            return json({ ok: false, error: `No se pudo guardar el cupo (${eUp.message}). La solicitud sigue en proceso.` }, 500)
          }
        }
        await auditAdmin(req, aprobar ? 'cupos.aprobado' : 'cupos.rechazado', { id: sx.id, userId: sx.user_id, clave: sx.beneficiario_clave, cupo, cupoAnterior: sx.cupo_actual, nota })
        // Aviso al cliente en su teléfono (si tiene notificaciones).
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/push`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ action: 'enviar', user_ids: [sx.user_id], titulo: aprobar ? 'Cupo aprobado' : 'Solicitud de cupo revisada',
              cuerpo: aprobar ? `Aprobamos un cupo mensual de ${cupo!.toLocaleString('es-CO')} COP para ${sx.beneficiario_nombre || 'tu beneficiario'}.` : `Tu solicitud de aumento de cupo para ${sx.beneficiario_nombre || 'tu beneficiario'} no fue aprobada: ${nota}`,
              tag: `cupo-${sx.id}`, url: '/beneficiarios' }),
            signal: AbortSignal.timeout(8000),
          })
        } catch { /* el aviso es un extra */ }
        return json({ ok: true })
      }

      if (body.action === 'cupo_quitar') {
        const uid = String(body.userId ?? ''), clave = String(body.clave ?? '')
        if (!uid || !clave) return json({ ok: false, error: 'Falta el cupo a quitar.' }, 400)
        const { error } = await db.from('cupos_beneficiario').delete().eq('user_id', uid).eq('beneficiario_clave', clave)
        if (error) return json({ ok: false, error: error.message }, 500)
        await auditAdmin(req, 'cupos.quitado', { userId: uid, clave })
        return json({ ok: true })
      }

      // ── CONTABILIDAD: cargues y conversiones, por cliente y por mes ─────
      // Lo que se le cargó a cada cliente, lo que convirtió, lo que ganó
      // Lincoin en cada operación y si ya tiene factura. Se lee TODO (por
      // páginas), no la ventana de 200 de la carga general: un total que solo
      // suma lo reciente no sirve para contabilidad. La utilidad la calcula
      // liquidacionDe, la misma que usa la factura.
      if (body.action === 'contabilidad_resumen' || body.action === 'contabilidad_cliente') {
        const accC: Acceso = auth.acceso ?? { rol: 'lectura', paises: [], todosLosPaises: false }
        const fecha = (v: unknown) => typeof v === 'string' && v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null
        const desde = fecha(body.desde), hasta = fecha(body.hasta)
        const delCliente = body.action === 'contabilidad_cliente'
        let ids: string[] | null = null
        if (delCliente) {
          const uid = String(body.userId ?? '')
          if (!/^[0-9a-f-]{36}$/i.test(uid)) return json({ error: 'userId inválido' }, 400)
          ids = [uid]
          // Mismo criterio que movimientos_cliente: filas duplicadas del mismo correo.
          const { data: yo } = await db.from('users').select('email').eq('id', uid).maybeSingle()
          if ((yo as any)?.email) {
            const { data: hermanos } = await db.from('users').select('id').eq('email', (yo as any).email)
            if (Array.isArray(hermanos) && hermanos.length) ids = Array.from(new Set([uid, ...hermanos.map((h: any) => String(h.id))]))
          }
        }
        const TOPE = 40000
        const leer = async (tipos: string[], columnas: string): Promise<{ filas: any[]; truncado: boolean }> => {
          const filas: any[] = []
          for (let off = 0; off < TOPE; off += 1000) {
            let q = db.from('transactions').select(columnas).in('type', tipos).eq('status', 'Completado')
            if (ids) q = q.in('user_id', ids)
            if (desde) q = q.gte('created_at', desde)
            if (hasta) q = q.lt('created_at', hasta)
            const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(off, off + 999)
            if (error) throw new Error(error.message)
            filas.push(...((data ?? []) as any[]))
            if (!data || data.length < 1000) return { filas, truncado: false }
          }
          return { filas, truncado: true }
        }
        // Solo lo que factura Lincoin: cargues, conversiones y los ajustes que
        // corrigen un cargue. Los envíos y pagos del cliente no son
        // contabilidad de Lincoin: viven en Clientes → ficha → Envíos y pagos.
        let ops: { filas: any[]; truncado: boolean }
        try {
          ops = await leer(['load', 'convert', 'adjustment'],
            'id, user_id, type, amount, currency, status, created_at, source:raw_data->>source, recordOnly:raw_data->recordOnly, acct:raw_data->acct, feeCop:raw_data->feeCop, grossCop:raw_data->grossCop, utilityCop:raw_data->utilityCop, gasfree:raw_data->gasfree, fromAmount:raw_data->fromAmount, fromCurrency:raw_data->>fromCurrency, destAmount:raw_data->destAmount, mouvRate:raw_data->mouvRate, otcCloseId:raw_data->>otcCloseId, otcRef:raw_data->>otcRef, lincoin:raw_data->lincoin, rail:raw_data->>rail, note:raw_data->>note, reverso:raw_data->reverso, reversaDe:raw_data->>reversaDe, reversaAuto:raw_data->reversaAuto, direction:raw_data->>direction, noRevierte:raw_data->noRevierte, targetCurrency:raw_data->>targetCurrency, destCurrency:raw_data->>destCurrency')
        } catch (e) {
          return json({ error: `No se pudieron leer los movimientos: ${(e as Error).message}` }, 500)
        }
        const visible = (t: any) => accC.todosLosPaises || visibleEnPais(paisDeMovimiento({ currency: t.currency, raw_data: { rail: t.rail } }), accC)
        const filasOps = ops.filas.filter(visible)

        // Los cierres de la mesa, para estimar la utilidad de sus conversiones.
        const idsCierre = Array.from(new Set(filasOps.map(t => String(t.otcCloseId ?? '')).filter(Boolean)))
        const cierres = new Map<string, CierreOtc>()
        for (let i = 0; i < idsCierre.length; i += 200) {
          const { data } = await db.from('otc_closes').select('id, side, from_amount, to_amount, rate_final, rate_fuente').in('id', idsCierre.slice(i, i + 200))
          for (const c of (data ?? []) as any[]) cierres.set(String(c.id), c)
        }
        // Las facturas de Lincoin ya emitidas o intentadas, por operación.
        const facturas = new Map<string, any>()
        let conFacturas = true
        for (let off = 0; off < TOPE; off += 1000) {
          let q = db.from('facturas_lincoin').select('transaction_id, estado, numero, total, utilidad, error, emitida_at')
          if (ids) q = q.in('user_id', ids)
          const { data, error } = await q.order('id', { ascending: true }).range(off, off + 999)
          if (error) { conFacturas = false; break }
          for (const f of (data ?? []) as any[]) facturas.set(String(f.transaction_id), f)
          if (!data || data.length < 1000) break
        }

        // Bogotá (UTC−5) para el mes: una operación de las 9 p. m. del 31 es
        // de ese mes, no del siguiente.
        const mesDe = (iso: string) => new Date(Date.parse(iso) - 5 * 3600_000).toISOString().slice(0, 7)
        const r2 = (n: number) => Math.round(n * 100) / 100
        // Todo lo que suma sale de liquidacionDe (con el reverso ya aplicado):
        // un cargue anulado vale 0 y un ajuste vinculado a un cargue NO se
        // cuenta aparte (ya está adentro del cargue). Así la utilidad cuadra.
        const nuevo = () => ({
          cargues: 0, anulados: 0, corregidos: 0, cargadoCop: 0, cargadoTotalCop: 0, usdCargado: 0, usdLlego: 0, utilidadCargues: 0, comisionBrebCop: 0,
          conversiones: 0, convertidoCop: 0, convertidoClienteCop: 0, usdConvertido: 0, utilidadConversiones: 0,
          utilidadEstimada: 0, sinUtilidad: 0, ajustes: 0, ajustadoCop: 0, ajustesVinculados: 0,
          // La utilidad neta se abre en lo que se ganó y lo que se perdió: una
          // sola operación en pérdida (p. ej. un cargue errado) se come la
          // utilidad de muchas, y sin esto parecía que "no sumaba".
          gananciaCop: 0, perdidaCop: 0, enPerdida: 0,
          facturadas: 0, facturadoCop: 0, porFacturar: 0, facturasConError: 0, facturasDeAnulados: 0,
          ultima: '' as string,
        })
        type Suma = ReturnType<typeof nuevo>
        const total = nuevo()
        const porMes = new Map<string, Suma>()
        const porCliente = new Map<string, Suma>()
        const de = (m: Map<string, Suma>, k: string) => { let s = m.get(k); if (!s) { s = nuevo(); m.set(k, s) } return s }
        // En el detalle de un cliente, sus filas duplicadas (mismo correo)
        // suman a él: es la misma persona.
        const claveCliente = (t: any) => delCliente ? String(body.userId) : String(t.user_id)
        const sumar = (fn: (s: Suma) => void, t: any) => {
          fn(total); fn(de(porMes, mesDe(String(t.created_at)))); fn(de(porCliente, claveCliente(t)))
          const c = de(porCliente, claveCliente(t)); if (String(t.created_at) > c.ultima) c.ultima = String(t.created_at)
        }
        const detalle: any[] = []
        const sueltos: any[] = []
        // Un débito que revierte un cargue se cuenta UNA sola vez: adentro del
        // cargue (que queda anulado o corregido), nunca además como débito
        // suelto. Se reconoce por su marca (reversaDe) o porque algún cargue lo
        // tiene en su reverso — lo que pase primero; antes, si solo estaba una
        // de las dos marcas, el débito se restaba otra vez aparte.
        const ajustesEnReversos = new Set<string>()
        for (const t of filasOps) if (t.type === 'load' && t.reverso && Array.isArray(t.reverso.ajustes)) for (const x of t.reverso.ajustes) if (x?.id != null) ajustesEnReversos.add(String(x.id))
        const rielDe = (t: any) => {
          const r = String(t.rail ?? t.currency ?? '').toUpperCase()
          return r === 'COP_ACH' || r === 'ACH' ? 'ACH' : r === 'COP_BREB' || r === 'BREB' ? 'Bre-B' : r === 'COP' ? 'Saldo Lincoin' : String(t.currency ?? '')
        }
        const idsDelPeriodo = new Set<string>()
        for (const t of filasOps) {
          idsDelPeriodo.add(String(t.id))
          if (t.type === 'adjustment') {
            const vinculado = !!t.reversaDe || ajustesEnReversos.has(String(t.id))
            const esDebito = String(t.direction ?? 'debit') === 'debit'
            if (vinculado) sumar(s => { s.ajustesVinculados++ }, t)
            else sumar(s => { s.ajustes++; s.ajustadoCop += esCopMon(t.currency) ? Number(t.amount) || 0 : 0 }, t)
            if (delCliente) {
              const fila = { id: t.id, type: t.type, amount: t.amount, currency: t.currency, riel: rielDe(t), created_at: t.created_at, nota: t.note ?? null, liq: null, factura: null, reversaDe: t.reversaDe ?? null, reversaAuto: t.reversaAuto === true, vinculado, esDebito, noRevierte: t.noRevierte === true, sugerencias: [] as any[] }
              detalle.push(fila)
              if (!vinculado && esDebito) sueltos.push(fila)
            }
            continue
          }
          const liq = liquidacionDe(t, t.otcCloseId ? cierres.get(String(t.otcCloseId)) ?? null : null)
          // Un 'load' que no es un cargue del admin es un depósito del propio
          // cliente: no es un cargue de Lincoin y no se cuenta acá.
          if (!liq) continue
          const f = facturas.get(String(t.id)) ?? null
          const u = liq.utilidadCop ?? 0
          sumar(s => {
            if (liq.tipo === 'cargue') {
              if (liq.anulado) { s.anulados++; if (f?.estado === 'emitida') s.facturasDeAnulados++; return }
              s.cargues++; if (liq.reversadoCop) s.corregidos++
              s.cargadoCop += liq.tercerosCop ?? 0; s.cargadoTotalCop += liq.totalCop ?? liq.tercerosCop ?? 0
              s.usdCargado += liq.usd ?? 0; s.usdLlego += liq.usdLlego ?? liq.usd ?? 0; s.utilidadCargues += u; s.comisionBrebCop += liq.comisionBrebCop ?? 0
            } else {
              s.conversiones++; s.convertidoCop += liq.totalCop ?? liq.tercerosCop ?? 0; s.convertidoClienteCop += liq.tercerosCop ?? 0
              s.usdConvertido += liq.usd ?? 0; s.utilidadConversiones += u
            }
            if (u >= 0) s.gananciaCop += u; else { s.perdidaCop += u; s.enPerdida++ }
            if (liq.fuente === 'estimada') s.utilidadEstimada += u
            if (liq.fuente === 'sin_dato' && liq.facturable) s.sinUtilidad++
            if (f?.estado === 'emitida') { s.facturadas++; s.facturadoCop += Number(f.total) || 0 }
            else if (f?.estado === 'error') s.facturasConError++
            else if (liq.facturable && u > 0) s.porFacturar++
          }, t)
          if (delCliente) detalle.push({
            id: t.id, type: t.type, amount: t.amount, currency: t.currency, riel: rielDe(t), created_at: t.created_at,
            ref: t.otcRef ?? null, nota: t.note ?? null, liq,
            reverso: t.reverso && typeof t.reverso === 'object' ? { ajustes: Array.isArray(t.reverso.ajustes) ? t.reverso.ajustes : [], montoCop: t.reverso.montoCop ?? null } : null,
            factura: f ? { estado: f.estado, numero: f.numero ?? null, total: f.total ?? null, error: f.error ?? null, emitida_at: f.emitida_at ?? null } : null,
          })
        }
        // A qué cargue puede corresponder cada débito suelto: del mismo saldo,
        // anterior al débito y con lo que le queda por revertir >= el débito.
        // Se buscan TODOS los cargues del cliente, no solo los del período: el
        // error pudo ser el mes pasado. Primero el que cuadra exacto.
        if (delCliente && sueltos.length && ids) {
          const { data: cs } = await db.from('transactions').select('id, amount, currency, created_at, status, acct:raw_data->acct, reverso:raw_data->reverso, source:raw_data->>source')
            .in('user_id', ids).eq('type', 'load').eq('status', 'Completado').order('created_at', { ascending: false }).limit(500)
          const cargues = ((cs ?? []) as any[]).filter(c => c.source === 'admin_cargue' || c.source === 'admin_backfill').map(c => {
            const credit = Number(c.acct?.creditedCop ?? c.amount) || 0
            const ya = Number(c.reverso?.montoCop ?? 0) || 0
            return { id: c.id, currency: c.currency, created_at: c.created_at, credit, resta: Math.max(0, credit - ya) }
          })
          for (const a of sueltos) {
            const m = Number(a.amount) || 0
            a.sugerencias = cargues
              .filter(c => c.currency === a.currency && c.created_at <= a.created_at && c.resta >= m - 1)
              .map(c => ({ ...c, exacto: Math.abs(c.resta - m) <= 1 }))
              .sort((x, y) => Number(y.exacto) - Number(x.exacto) || String(y.created_at).localeCompare(String(x.created_at)))
              .slice(0, 6)
          }
        }
        const redondear = (s: Suma) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])) as Suma

        // Quién es cada cliente (nombre y documento para la factura).
        const idsCli = Array.from(porCliente.keys())
        const fichas = new Map<string, any>()
        for (let i = 0; i < idsCli.length; i += 200) {
          const { data } = await db.from('users').select('id, email, full_name, company_name, role, tax_id, doc_number').in('id', idsCli.slice(i, i + 200))
          for (const u of (data ?? []) as any[]) fichas.set(String(u.id), u)
        }
        const clientes = idsCli.map(id => {
          const u = fichas.get(id) ?? {}
          return {
            userId: id, nombre: u.company_name || u.full_name || u.email || id, email: u.email ?? null, rol: u.role ?? null,
            documento: u.tax_id || u.doc_number || null, ...redondear(porCliente.get(id)!),
          }
        }).sort((a, b) => (b.cargadoTotalCop + b.convertidoCop) - (a.cargadoTotalCop + a.convertidoCop))
        const meses = Array.from(porMes.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([mes, s]) => ({ mes, ...redondear(s) }))
        // Los estados de factura del MISMO período y alcance que el resto del
        // tablero: antes contaba todas las facturas de la historia junto a
        // "por facturar" del mes, y los dos números no se podían comparar.
        const estados: Record<string, number> = {}
        for (const [txId, f] of facturas.entries()) if (idsDelPeriodo.has(txId)) estados[String(f.estado)] = (estados[String(f.estado)] ?? 0) + 1
        return json({
          ok: true, generado_at: new Date().toISOString(), desde, hasta,
          truncado: ops.truncado, conFacturas,
          totales: { ...redondear(total), clientes: clientes.length },
          meses, clientes, facturas: estados,
          ...(delCliente ? { cliente: clientes.find(c => c.userId === String(body.userId)) ?? clientes[0] ?? null, ids, detalle: detalle.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) } : {}),
        })
      }

      // ── Vincular solos los débitos viejos que cuadran exacto con un cargue ─
      if (body.action === 'contabilidad_autovincular') {
        const uid = String(body.userId ?? '')
        const ids = /^[0-9a-f-]{36}$/i.test(uid) ? await idsMismaPersona(uid) : null
        const r = await autoVincularPendientes(ids, auth.userId ?? null)
        if (r.vinculados) await auditAdmin(req, 'admin.ajustes_autovinculados', { userId: uid || null, ...r })
        return json({ ok: true, ...r })
      }

      // ── Vincular (o desvincular) un débito al cargue que corrige ─────────
      if (body.action === 'contabilidad_vincular_ajuste') {
        const ajusteId = String(body.ajusteId ?? '')
        if (!ajusteId) return json({ ok: false, error: 'Falta el ajuste.' }, 400)
        const r = await vincularAjuste(ajusteId, body.cargueId ? String(body.cargueId) : null, auth.userId ?? null)
        if ('error' in r) return json({ ok: false, error: r.error }, r.status)
        await auditAdmin(req, body.cargueId ? 'admin.ajuste_vinculado' : 'admin.ajuste_desvinculado', { ajusteId, cargueId: body.cargueId ?? null, anulado: r.anulado ?? null })
        return json(r)
      }

      // ── Facturación de LINCOIN en Siigo ─────────────────────────────────
      // La hace la función facturacion (ahí viven Siigo y las credenciales
      // cifradas). Acá solo se decide quién puede pedir qué y se le pasa el
      // pedido con la llave del servicio. La access key nunca vuelve.
      const ACCION_FACTURACION_LINCOIN: Record<string, string> = {
        fact_lincoin_get: 'lincoin_config_get', fact_lincoin_set: 'lincoin_config_set', fact_lincoin_probar: 'lincoin_probar',
        fact_lincoin_emitir: 'lincoin_emitir', fact_lincoin_al_dia: 'lincoin_al_dia', fact_lincoin_lista: 'lincoin_facturas',
      }
      if (ACCION_FACTURACION_LINCOIN[String(body.action)]) {
        const sub = String(body.action).replace('fact_lincoin_', '')
        const cuerpo: Record<string, unknown> = { action: ACCION_FACTURACION_LINCOIN[String(body.action)], adminId: auth.userId ?? null }
        for (const k of ['config', 'cambiarActivo', 'transactionId', 'utilidad', 'estado', 'userId', 'limite']) if (k in body) cuerpo[k] = body[k]
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/facturacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(sub === 'emitir' ? 140_000 : 60_000),
          })
          const texto = await r.text()
          let d: any = null
          try { d = JSON.parse(texto) } catch { d = null }
          if (!d) return json({ ok: false, error: `La facturación no respondió bien (HTTP ${r.status}).` }, 502)
          if (sub === 'set' || sub === 'emitir') await auditAdmin(req, `admin.factura_lincoin_${sub}`, { transactionId: body.transactionId ?? null, ok: !!d.ok, cambiarActivo: body.cambiarActivo ?? null })
          return json(d, r.ok ? 200 : r.status)
        } catch (e) {
          return json({ ok: false, error: /timeout|abort/i.test(String((e as Error)?.message)) ? 'Siigo tardó demasiado. La factura PUDO haberse creado: recargá la lista antes de reintentar.' : `No se pudo llamar a la facturación: ${(e as Error)?.message}` }, 502)
        }
      }

      if (body.action === 'movimientos_cliente') {
        const uid = String(body.userId ?? '')
        if (!/^[0-9a-f-]{36}$/i.test(uid)) return json({ error: 'userId inválido' }, 400)
        const accM: Acceso = auth.acceso ?? { rol: 'lectura', paises: [], todosLosPaises: false }
        // La misma persona puede tener filas de usuario duplicadas (mismo
        // correo, ids distintos: el login creó un perfil con el id del auth y
        // otro quedó con el id real). Sus movimientos pueden estar bajo
        // cualquiera de esos ids; se traen los de todos, como en la app del
        // cliente (gasfree my_transactions).
        let ids: string[] = [uid]
        const { data: yo } = await db.from('users').select('email').eq('id', uid).maybeSingle()
        if ((yo as any)?.email) {
          const { data: hermanos } = await db.from('users').select('id').eq('email', (yo as any).email)
          if (Array.isArray(hermanos) && hermanos.length) ids = Array.from(new Set([uid, ...hermanos.map((h: any) => String(h.id))]))
        }
        const filas: Record<string, unknown>[] = []
        const PAGINA = 1000
        // Si el historial pasa del tope se dice: la pantalla no puede llamar
        // "completo" a algo que quedó cortado.
        let truncado = true
        for (let desde = 0; desde < 10000; desde += PAGINA) {
          const { data, error } = await db.from('transactions').select('*').in('user_id', ids)
            .order('created_at', { ascending: false }).range(desde, desde + PAGINA - 1)
          if (error) return json({ error: error.message }, 500)
          filas.push(...((data ?? []) as Record<string, unknown>[]))
          if (!data || data.length < PAGINA) { truncado = false; break }
        }
        const visibles = filas.filter(t => accM.todosLosPaises || visibleEnPais(paisDeMovimiento(t), accM))
        return json({ ok: true, total: visibles.length, truncado, ids, transactions: visibles.map(t => ({ ...t, raw_data: slimRawData(t.raw_data) })) })
      }

      // ── Límites por envío ACH ──────────────────────────────────────────
      // General por tipo de cuenta + excepciones por cliente. Los aplica
      // mouv-proxy (topeAchDe) en el momento del envío; acá solo se guardan.
      // El tope del PROVEEDOR es el techo: ningún otro puede pasarlo.
      if (body.action === 'limites_envio_get') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const { data } = await db.from('system_config').select('value').eq('key', 'limites_envio').maybeSingle()
        let v: any = {}
        try { v = (data as any)?.value ? JSON.parse((data as any).value) : {} } catch { v = {} }
        const n = (x: any) => { const k = Number(x); return Number.isFinite(k) && k > 0 ? k : null }
        const { data: filas } = await db.from('system_config').select('key, value').like('key', 'limite_envio:%')
        const ids = (filas ?? []).map((f: any) => String(f.key).slice('limite_envio:'.length))
        const { data: us } = ids.length ? await db.from('users').select('id, email, full_name, company_name, role').in('id', ids) : { data: [] as any[] }
        const porId = new Map((us ?? []).map((u: any) => [u.id, u]))
        const excepciones = (filas ?? []).map((f: any) => {
          const id = String(f.key).slice('limite_envio:'.length)
          let x: any = {}
          try { x = JSON.parse(f.value) } catch { /* */ }
          const u: any = porId.get(id) ?? {}
          return { userId: id, achMax: n(x.achMax), nota: x.nota ?? null, at: x.at ?? null, email: u.email ?? null, nombre: u.company_name || u.full_name || null, tipo: u.role === 'business' ? 'empresa' : 'persona' }
        }).filter((e: any) => e.achMax)
        return json({ ok: true, limites: { achEmpresa: n(v.achEmpresa) ?? 500_000_000, achPersona: n(v.achPersona) ?? 50_000_000, achProveedor: n(v.achProveedor), at: v.at ?? null }, excepciones })
      }

      if (body.action === 'limites_envio_set' || body.action === 'limite_cliente_set') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const mfaErr = await requireMfaSession(req, auth.userId)
        if (mfaErr) return json({ error: mfaErr, needs2fa: true }, 403)
        // Pesos enteros, al menos el mínimo por envío. El techo de 10.000 M
        // es contra el dedazo (un cero de más), no una regla del negocio.
        const lee = (x: any): number | null => {
          if (x === null || x === undefined || String(x).trim() === '') return null
          const k = Number(String(x).replace(/[^\d]/g, ''))
          return Number.isFinite(k) && k > 0 ? k : NaN
        }
        const valido = (k: number | null) => k === null || (Number.isFinite(k) && k >= 5000 && k <= 10_000_000_000)
        const { data: prev } = await db.from('system_config').select('value').eq('key', 'limites_envio').maybeSingle()
        let g: any = {}
        try { g = (prev as any)?.value ? JSON.parse((prev as any).value) : {} } catch { g = {} }

        if (body.action === 'limites_envio_set') {
          const achEmpresa = lee(body.achEmpresa), achPersona = lee(body.achPersona), achProveedor = lee(body.achProveedor)
          if (!valido(achEmpresa) || !valido(achPersona) || !valido(achProveedor) || achEmpresa === null || achPersona === null) {
            return json({ error: 'Escribe montos en pesos entre 5.000 y 10.000.000.000.' }, 400)
          }
          if (achProveedor && (achEmpresa > achProveedor || achPersona > achProveedor)) {
            return json({ error: `Ningún tope puede pasar el del proveedor (${achProveedor.toLocaleString('es-CO')} COP).` }, 400)
          }
          const valor = { achEmpresa, achPersona, achProveedor, at: new Date().toISOString(), por: String(auth.userId ?? '') }
          const { error } = await db.from('system_config').upsert({ key: 'limites_envio', value: JSON.stringify(valor) }, { onConflict: 'key' })
          if (error) return json({ error: error.message }, 500)
          await auditAdmin(req, 'limites.envio_general', { antes: g, despues: valor })
          return json({ ok: true, limites: valor })
        }

        // Excepción de UN cliente. achMax vacío = quitarla (vuelve al general).
        const uid = String(body.userId ?? '')
        if (!uid) return json({ error: 'Falta el cliente.' }, 400)
        const { data: cli } = await db.from('users').select('id, email').eq('id', uid).maybeSingle()
        if (!cli) return json({ error: 'Cliente no encontrado.' }, 404)
        const achMax = lee(body.achMax)
        if (!valido(achMax)) return json({ error: 'Escribe un monto en pesos entre 5.000 y 10.000.000.000.' }, 400)
        const prov = Number(g.achProveedor) > 0 ? Number(g.achProveedor) : null
        if (achMax && prov && achMax > prov) {
          return json({ error: `No puede pasar el tope del proveedor (${prov.toLocaleString('es-CO')} COP).` }, 400)
        }
        const key = `limite_envio:${uid}`
        if (achMax === null) {
          // Sin revisar el error decía "Excepción quitada" aunque no se hubiera borrado.
          const { error: delErr } = await db.from('system_config').delete().eq('key', key)
          if (delErr) return json({ error: `No se pudo quitar la excepción: ${delErr.message}` }, 500)
        } else {
          const valor = { achMax, nota: String(body.nota ?? '').slice(0, 200) || null, at: new Date().toISOString(), por: String(auth.userId ?? '') }
          const { error } = await db.from('system_config').upsert({ key, value: JSON.stringify(valor) }, { onConflict: 'key' })
          if (error) return json({ error: error.message }, 500)
        }
        await auditAdmin(req, 'limites.envio_cliente', { userId: uid, email: (cli as any).email ?? null, achMax })
        return json({ ok: true })
      }

      if (body.action === 'access_policy_get') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const ip = ipOf(req)
        const geo = await geoOf(ip)
        return json({ ok: true, policy: await accessPolicy(), tuIp: ip, tuPais: geo?.countryCode ?? null, tuUbicacion: geo?.approx ?? null })
      }

      // Política de acceso: guardar. Es una acción sensible — exige que la
      // sesión haya pasado el segundo factor.
      if (body.action === 'access_policy_set') {
        if (!(await verifyAdmin(req)).ok) return json({ error: 'No autorizado' }, 401)
        const mfaErr = await requireMfaSession(req, auth.userId)
        if (mfaErr) return json({ error: mfaErr, needs2fa: true }, 403)
        const p = body.policy ?? {}
        const ip = ipOf(req)
        const geo = await geoOf(ip)
        // APAGAR o AFLOJAR el candado exige verificarse de nuevo: el código
        // del correo siempre, y el de la app si la cuenta tiene 2FA activo.
        // Apretarlo (encenderlo, agregar un país o una IP) no pide nada: lo
        // que hay que dificultar es bajar la guardia, no subirla.
        {
          const actual = await accessPolicy()
          const quita = (a: string[], b: string[]) => a.some(x => !b.includes(x))
          const afloja = (actual.enabled && !p.enabled)
            || quita(actual.countries, Array.isArray(p.countries) ? p.countries.map((c: any) => String(c).toUpperCase()) : [])
            || quita(actual.ips, Array.isArray(p.ips) ? p.ips.map((i: any) => String(i)) : [])
          if (afloja) {
            // La LLAVE no se exige aquí: si el dispositivo se perdió, el
            // titular tiene que poder seguir manejando su propio acceso.
            const falta = (await stepUpFalta(req, String(auth.userId ?? ''))).filter(f => f !== 'passkey')
            if (falta.length) {
              return json({ error: 'Verifica tu identidad para bajar esta protección.', stepUp: true, falta }, 403)
            }
          }
        }
        const pol: AccessPolicy = {
          enabled: !!p.enabled,
          countries: Array.isArray(p.countries) ? p.countries.map((c: any) => String(c).toUpperCase().slice(0, 2)).filter(Boolean).slice(0, 20) : [],
          ips: Array.isArray(p.ips) ? p.ips.map((i: any) => String(i).trim()).filter(Boolean).slice(0, 50) : [],
        }
        // Red de seguridad: al ENCENDERLA, si la conexión actual no quedaría
        // permitida, se agrega sola. Encender un candado desde afuera de la
        // puerta es la forma más rápida de quedarse sin panel.
        if (pol.enabled && ip) {
          const cc = String(geo?.countryCode ?? '').toUpperCase()
          const permitido = pol.ips.includes(ip) || (cc && pol.countries.includes(cc))
          if (!permitido) pol.ips.unshift(ip)
        }
        await db.from('system_config').upsert({ key: ACCESS_POLICY_KEY, value: JSON.stringify(pol) }, { onConflict: 'key' })
        await auditAdmin(req, 'security.access_policy_set', { ...pol })
        return json({ ok: true, policy: pol })
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

      // ── Conciliación: envíos que salieron pero no dejaron movimiento ─────
      // El vigilante de lo que ya pasó una vez. Cada dispersión deja DOS
      // rastros: la fila en 'transactions' —lo que ve el cliente— y una
      // entrada en la auditoría. Si el envío ocurrió pero la fila no se
      // escribió, el cliente ve un hueco y nadie más se entera.
      //
      // Acá se cruzan los dos rastros y se listan los envíos sin movimiento.
      // Con reparar:true se reconstruye la fila desde la auditoría.
      if (body.action === 'conciliar_movimientos') {
        const dias = Math.min(Math.max(Number(body.dias ?? 30) || 30, 1), 180)
        const desde = new Date(Date.now() - dias * 86400_000).toISOString()

        const { data: eventos } = await db.from('audit_log')
          .select('id, user_id, action, metadata, created_at')
          .in('action', ['mouv.payout_breb.ok', 'mouv.payout_ach.ok', 'finity.payout_ach.ok', 'mouv.tx_insert_failed'])
          .gte('created_at', desde).order('created_at', { ascending: false }).limit(1000)

        // POR PÁGINAS: la API devuelve como mucho 1.000 filas por consulta,
        // así que con .limit(3000) se leían solo 1.000 y el resto de los envíos
        // EXISTENTES se reportaban como "huérfanos" — y Reconstruir los
        // duplicaba.
        const txs: any[] = []
        for (let desdeFila = 0; desdeFila < 20000; desdeFila += 1000) {
          const { data: pag, error: pagErr } = await db.from('transactions')
            .select('id, user_id, amount, currency, created_at, raw_data')
            .eq('type', 'dispersion').gte('created_at', desde)
            .order('created_at', { ascending: false }).range(desdeFila, desdeFila + 999)
          if (pagErr) return json({ ok: false, error: `No se pudieron leer los movimientos: ${pagErr.message}` }, 500)
          txs.push(...((pag ?? []) as any[]))
          if (!pag || pag.length < 1000) break
        }

        const porRef = new Set<string>()
        const porUsuarioMonto = new Set<string>()
        for (const t of txs) {
          const ref = String(t?.raw_data?.providerRef ?? '')
          if (ref) porRef.add(ref)
          // Clave de respaldo para los envíos sin referencia del proveedor:
          // usuario + monto + día. No es perfecta —dos envíos idénticos el
          // mismo día colisionan— pero se prefiere no reportar de más.
          porUsuarioMonto.add(`${t.user_id}|${Math.round(Number(t.amount ?? 0))}|${String(t.created_at ?? '').slice(0, 10)}`)
        }

        const huerfanos: any[] = []
        for (const e of (eventos ?? []) as any[]) {
          const m = (e.metadata ?? {}) as any
          const ref = String(m.providerRef ?? '')
          const monto = Math.round(Number(m.amount ?? 0))
          const dia = String(e.created_at ?? '').slice(0, 10)
          if (ref && porRef.has(ref)) continue
          if (!ref && porUsuarioMonto.has(`${e.user_id}|${monto}|${dia}`)) continue
          huerfanos.push({
            auditId: e.id, userId: e.user_id, accion: e.action, at: e.created_at,
            amount: monto, providerRef: ref || null,
            railCol: m.railCol ?? (String(e.action).includes('breb') ? 'COP_BREB' : 'COP_ACH'),
            recipient: m.recipient ?? null, motivo: m.motivo ?? null,
          })
        }

        if (!body.reparar) {
          return json({ ok: true, dias, revisados: (eventos ?? []).length, huerfanos: huerfanos.slice(0, 100), total: huerfanos.length })
        }

        // Reparar: se crea la fila que falta, marcada como reconstruida para
        // que nadie la confunda con un registro de primera mano.
        let creados = 0
        for (const h of huerfanos.slice(0, 200)) {
          if (!h.userId || !h.amount) continue
          // Última comprobación, fila por fila, justo antes de crearla: ni un
          // envío con esa referencia ni una reconstrucción previa del mismo
          // evento. Dos clics en Reconstruir no pueden duplicar nada.
          if (h.providerRef) {
            const { data: ya } = await db.from('transactions').select('id').eq('type', 'dispersion').filter('raw_data->>providerRef', 'eq', String(h.providerRef)).limit(1)
            if (ya?.length) continue
          }
          {
            const { data: yaRec } = await db.from('transactions').select('id').filter('raw_data->>desdeAuditoria', 'eq', String(h.auditId)).limit(1)
            if (yaRec?.length) continue
          }
          const { error } = await db.from('transactions').insert({
            user_id: h.userId, type: 'dispersion', amount: h.amount, currency: h.railCol,
            status: String(h.accion).endsWith('.ok') ? 'Completado' : 'Procesando',
            created_at: h.at,
            raw_data: {
              source: 'conciliacion', title: h.railCol === 'COP_BREB' ? 'Dispersión Bre-B' : 'Dispersión ACH',
              providerRef: h.providerRef, recipient: h.recipient,
              beneficiary: h.recipient?.holderName ?? null,
              reconstruido: true, desdeAuditoria: h.auditId, reconstruidoAt: new Date().toISOString(),
            },
          })
          if (!error) creados++
        }
        await auditAdmin(req, 'conciliacion.movimientos_reconstruidos', { creados, de: huerfanos.length, dias })
        return json({ ok: true, dias, creados, total: huerfanos.length })
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
        await auditAdmin(req, 'admin.set_kyc_status', { userId: body.userId, kycStatus: body.kycStatus })
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

      // Acreditar o descontar a mano el saldo de dólares o euros digitales de un
      // cliente. Mismos candados que el cargue en pesos: solo USDC y EURC, el
      // código 2FA del admin para ESTA operación, un id por operación para que
      // un reintento no acredite dos veces, y constancia en la auditoría.
      if (body.action === 'admin_credit_crypto' && body.userId && body.currency && body.amount != null) {
        const cur = String(body.currency).toUpperCase()
        if (!['USDC', 'EURC'].includes(cur)) return json({ success: false, error: 'Solo se pueden ajustar saldos de USDC o EURC.' }, 400)
        const delta: number = parseFloat(body.amount)
        if (!isFinite(delta) || delta === 0 || Math.abs(delta) > 10_000_000) return json({ success: false, error: 'Monto inválido' }, 400)
        const otpErr = await requireAdminOtp(auth.userId, body.otp)
        if (otpErr) return json({ success: false, error: otpErr, needs2fa: true }, 403)
        const opId = String(body.opId ?? body.cargueId ?? '').replace(/[^\w-]/g, '').slice(0, 80)
        const claveOp = opId ? `cripto:${body.userId}:${opId}` : ''
        if (claveOp) {
          const c = await reclamarCandado(db, claveOp, 86_400, String(auth.userId ?? ''), 'admin_credit_crypto')
          if (c === 'ocupado') return json({ success: false, duplicado: true, error: 'Esta operación ya se aplicó (o se está aplicando). Revisa el saldo antes de repetirla.' }, 409)
          if (c === 'error') return json({ success: false, error: 'No se pudo asegurar la operación contra duplicados. No se aplicó nada; intenta de nuevo.' }, 503)
        }
        // Suma ATÓMICA en la base. Antes: leer todos los saldos cripto, sumar y
        // escribir el objeto entero — un movimiento cripto del cliente en el
        // medio se deshacía, y un descuento mayor al saldo quedaba en 0 sin
        // avisar.
        const { data: adjC, error: adjCErr } = await db.rpc('adjust_balances', { p_user_id: body.userId, p_fiat: {}, p_crypto: { [cur]: delta } })
        if (adjCErr) {
          await auditAdmin(req, 'admin.cripto_saldo_incierto', { userId: body.userId, currency: cur, delta, error: adjCErr.message })
          return json({ success: false, error: 'No hubo respuesta clara al aplicar el saldo. Revisa el saldo del cliente ANTES de repetir.' }, 502)
        }
        if ((adjC as any)?.error) {
          if (claveOp) await soltarCandado(db, claveOp)
          return json({ success: false, error: (adjC as any).error === 'insufficient' ? 'El cliente no tiene saldo suficiente para ese descuento. No se cambió nada.' : 'No se pudo aplicar el saldo. No se cambió nada.' }, 400)
        }
        const newBal = Number((adjC as any)?.crypto_balances?.[cur] ?? (adjC as any)?.balances?.[cur] ?? 0)
        await db.from('transactions').insert({
          user_id: body.userId, type: delta > 0 ? 'otc_deposit' : 'adjustment', amount: Math.abs(delta), currency: cur,
          status: 'Completado',
          raw_data: { source: 'admin_manual', direction: delta > 0 ? 'credit' : 'debit', note: String(body.note ?? (delta > 0 ? 'Depósito acreditado manualmente' : 'Ajuste manual')).slice(0, 300), creditedAt: new Date().toISOString(), opId: opId || null },
        })
        await auditAdmin(req, 'admin.ajuste_cripto', { userId: body.userId, currency: cur, delta, nuevoSaldo: newBal, opId: opId || null })
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
        // UN cargue se aplica UNA vez. La pantalla manda un id por cargue y lo
        // repite si reintenta: si la respuesta se perdió y el admin vuelve a
        // apretar, el segundo pedido no acredita otra vez.
        const cargueId = String(body.cargueId ?? '').replace(/[^\w-]/g, '').slice(0, 80)
        const claveCargue = cargueId ? `cargue:${body.userId}:${cargueId}` : ''
        if (claveCargue) {
          const c = await reclamarCandado(db, claveCargue, 86_400, String(auth.userId ?? ''), 'admin_credit_balance')
          if (c === 'ocupado') return json({ success: false, duplicado: true, error: 'Este cargue ya se aplicó (o se está aplicando). Revisa el saldo del cliente antes de repetirlo.' }, 409)
          if (c === 'error') return json({ success: false, error: 'No se pudo asegurar el cargue contra duplicados (la base no respondió). No se aplicó nada; intenta de nuevo.' }, 503)
        }
        const soltar = async () => { if (claveCargue) await soltarCandado(db, claveCargue) }
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
        const { data: txIns, error: txInsErr } = await db.from('transactions').insert({
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
            // "No, es otro ajuste": queda anotado para que el vínculo
            // automático de Contabilidad no lo pegue después a un cargue.
            ...(delta < 0 && String(body.reversaDe ?? '').trim() === 'no' ? { noRevierte: true } : {}),
            ...(feeCop > 0 ? { grossCop: delta, feeCop, feePct: BREB_CARGUE_FEE_PCT, feeConcept: 'Comisión por recepción Bre-B' } : {}),
            // Contabilidad de la operación: queda GUARDADA con el movimiento,
            // así la utilidad es un dato del cargue y no una resta posterior.
            ...(acct ? { acct: { ...acct, creditedCop: credit, feeCopBreb: feeCop, utilityCop } } : {}),
            note: body.note ?? (recordOnly ? 'Registro histórico (no afecta saldo)' : delta > 0
              ? (feeCop > 0 ? `Cargue Bre-B · comisión ${BREB_CARGUE_FEE_PCT}% por recepción` : 'Cargue manual')
              : 'Ajuste manual'),
            creditedAt: new Date().toISOString(),
          },
        }).select('id').single()
        if (txInsErr) { await soltar(); return json({ success: false, error: `No se registró el movimiento (${txInsErr.message}) — el saldo NO fue modificado.` }, 500) }
        let newBal = parseFloat(Number(bals[cur] ?? 0).toFixed(2))
        if (!recordOnly) {
          // SUMA atómica sobre la base, no "saldo leído + monto". Antes se
          // escribía el objeto de saldos ENTERO con la copia leída al
          // principio: si en el medio el cliente enviaba plata por otro riel,
          // ese débito se deshacía. Y un descuento mayor al saldo se dejaba en
          // 0 en silencio, con el movimiento registrando el monto completo.
          const { data: adj, error: adjErr } = await db.rpc('adjust_balances', { p_user_id: body.userId, p_fiat: { [cur]: credit } })
          const motivoAdj = (adj as any)?.error
          if (motivoAdj || (adjErr && !/function .* does not exist|42883|PGRST202/i.test(`${adjErr.code ?? ''} ${adjErr.message ?? ''}`))) {
            if (motivoAdj) {
              // La base dijo que no: no se movió nada. Se borra el movimiento.
              await db.from('transactions').delete().eq('id', (txIns as any)?.id)
              await soltar()
              return json({ success: false, error: motivoAdj === 'insufficient' ? 'El cliente no tiene saldo suficiente en ese riel para el descuento. No se cambió nada.' : `No se pudo aplicar al saldo (${motivoAdj}). No se cambió nada.` }, 400)
            }
            // Error de transporte: puede haberse aplicado. No se borra el
            // movimiento ni se suelta el candado; se avisa para revisar.
            await auditAdmin(req, 'admin.cargue_saldo_incierto', { userId: body.userId, rail: cur, credit, txId: (txIns as any)?.id ?? null, error: adjErr?.message ?? null })
            return json({ success: false, error: 'No hubo respuesta clara al aplicar el saldo. Revisa el saldo del cliente ANTES de repetir: el movimiento quedó registrado.' }, 502)
          }
          if (adjErr) {
            // Base sin adjust_balances: camino viejo, con la escritura revisada.
            newBal = parseFloat(Math.max(0, (bals[cur] ?? 0) + credit).toFixed(2))
            const { error: upErr } = await db.from('users').update({ balances: { ...bals, [cur]: newBal } }).eq('id', body.userId)
            if (upErr) {
              await db.from('transactions').delete().eq('id', (txIns as any)?.id)
              await soltar()
              return json({ success: false, error: `No se pudo aplicar al saldo (${upErr.message}). No se cambió nada.` }, 500)
            }
          } else {
            newBal = parseFloat(Number((adj as any)?.balances?.[cur] ?? newBal).toFixed(2))
          }
        }
        if (acct) await auditAdmin(req, 'admin.cargue_contable', { userId: body.userId, rail: cur, ...acct, creditedCop: credit, utilityCop })
        // Un descuento que corrige un cargue hecho por error: se vincula ya,
        // para que Contabilidad lo reste de ese cargue (y de su utilidad) en
        // vez de dejarlo suelto. Si no se puede vincular, el descuento igual
        // quedó aplicado: se avisa y se vincula después desde Contabilidad.
        // Sin elegir (o "automático"): si el débito es igual a lo que le
        // queda a un cargue reciente del mismo saldo, se vincula solo. "no" =
        // el operador dijo que es otro ajuste.
        let reverso: { ok: boolean; aviso?: string; error?: string; auto?: boolean; cargueId?: string } | null = null
        if (delta < 0 && (txIns as any)?.id) {
          const elegido = String(body.reversaDe ?? '').trim()
          if (elegido && elegido !== 'no' && elegido !== 'auto') {
            const v = await vincularAjuste(String((txIns as any).id), elegido, auth.userId ?? null)
            reverso = 'error' in v ? { ok: false, error: v.error } : { ok: true, cargueId: elegido, ...(v.aviso ? { aviso: v.aviso } : {}) }
          } else if (elegido !== 'no') {
            const v = await autoVincularAjuste({ id: String((txIns as any).id), user_id: String(body.userId), amount: Math.abs(credit), currency: cur, created_at: new Date().toISOString() }, auth.userId ?? null)
            if (v.cargueId) reverso = { ok: true, auto: true, cargueId: v.cargueId, ...(v.aviso ? { aviso: v.aviso } : {}) }
          }
        }
        return json({ success: true, newBalance: newBal, recordOnly, grossCop: Math.abs(delta), feeCop, netCop: Math.abs(credit), feePct: feeCop > 0 ? BREB_CARGUE_FEE_PCT : 0, acct: acct ? { ...acct, creditedCop: credit, feeCopBreb: feeCop, utilityCop } : null, ...(reverso ? { reverso } : {}) })
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
        const amt = Number(tx.amount ?? 0)
        const aprobar = body.action === 'approve_rail_move'
        // Los rieles los escribía el navegador: solo existe COP → COP_ACH. Una
        // fila que diga otra cosa no se acredita ni se "devuelve" a ningún lado.
        if (String(rd.fromRail ?? 'COP') !== 'COP' || String(rd.toRail ?? 'COP_ACH') !== 'COP_ACH') {
          return json({ success: false, error: 'Esta solicitud tiene rieles que no corresponden (solo Saldo Lincoin → ACH). No se movió nada; revísala a mano.' }, 400)
        }
        // Las solicitudes nuevas las crea el servidor con el débito hecho
        // (`debitado`). Una sin esa marca y sin el débito confirmado por quien
        // la resuelve no se toca: aprobarla acreditaría plata que nunca se
        // descontó, y rechazarla "devolvería" lo mismo.
        if (!rd.debitado && body.confirmoDebito !== true) {
          return json({ success: false, sinDebitoVerificado: true, error: 'Esta solicitud no tiene el débito verificado por el servidor (se creó desde una versión anterior de la app). Confirma en el historial del cliente que el Saldo Lincoin se descontó antes de resolverla.' }, 409)
        }
        const rail = aprobar ? 'COP_ACH' : 'COP'
        const ahora = new Date().toISOString()
        // RECLAMAR ANTES DE ACREDITAR. Antes se miraba el estado y después se
        // escribía: dos clics (o dos pestañas) leían "Pendiente" los dos y
        // acreditaban dos veces. El update condicional solo lo gana uno.
        const { data: reclamada } = await db.from('transactions').update({
          status: aprobar ? 'Completado' : 'Rechazado',
          raw_data: aprobar
            ? { ...rd, approvedAt: ahora, title: 'Saldo Lincoin → ACH · aprobado' }
            : { ...rd, rejectedAt: ahora, rejectReason: body.reason ?? 'Rechazado por administración', title: 'Saldo Lincoin → ACH · rechazado (reembolsado)' },
        }).eq('id', tx.id).eq('status', 'Pendiente').select('id')
        if (!reclamada?.length) return json({ success: true, already: true })
        // Abono atómico (sin leer-y-escribir el saldo entero).
        let nuevo: number | null = null
        const { data: adj, error: adjErr } = await db.rpc('adjust_balances', { p_user_id: tx.user_id, p_fiat: { [rail]: amt } })
        if (!adjErr && !(adj as any)?.error) {
          nuevo = Number((adj as any)?.balances?.[rail] ?? 0)
        } else if (adjErr) {
          const { data: u } = await db.from('users').select('balances').eq('id', tx.user_id).single()
          const bals: Record<string, number> = (u?.balances as any) ?? {}
          nuevo = parseFloat(((bals[rail] ?? 0) + amt).toFixed(2))
          const { error: upErr } = await db.from('users').update({ balances: { ...bals, [rail]: nuevo } }).eq('id', tx.user_id)
          if (upErr) nuevo = null
        }
        if (nuevo == null) {
          // No se pudo abonar: la solicitud vuelve a Pendiente para reintentar.
          await db.from('transactions').update({ status: 'Pendiente', raw_data: rd }).eq('id', tx.id)
          return json({ success: false, error: 'No se pudo abonar el saldo. La solicitud sigue pendiente; intenta de nuevo.' }, 500)
        }
        return json(aprobar ? { success: true, newBalance: nuevo } : { success: true, refunded: true })
      }

      // credit_conversion_fee YA NO EXISTE. Sumaba la comisión al saldo de la
      // cuenta "casa" leyendo y reescribiendo el saldo entero, sin validar el
      // monto (negativos o NaN pasaban) y buscando esa cuenta por un correo
      // que el propio usuario puede cambiar. La parte de Lincoin de cada
      // conversión ya queda guardada en la fila (raw_data.lincoin) por
      // apply_conversion, que es de donde la lee Contabilidad.
      if (body.action === 'credit_conversion_fee') {
        return json({ success: false, error: 'Esta operación ya no existe: la comisión queda registrada en la propia conversión.' }, 410)
      }

      // Comprobante de UNA transacción, bajo demanda (ver slimRawData)
      if (body.action === 'get_tx_proof' && body.txId != null) {
        const { data: tx } = await db.from('transactions').select('raw_data').eq('id', body.txId).single()
        return json({ raw_data: tx?.raw_data ?? {} })
      }

      // ── CLIENTES POR PÁGINAS ────────────────────────────────────────────
      // Búsqueda en el servidor: nombre, correo, razón social, documento, NIT,
      // ID Lincoin o id. Devuelve una página y los conteos por tipo de cuenta.
      // La hace la base (admin_buscar_usuarios); si esa función todavía no
      // existe, una consulta más simple sin conteos por tipo.
      if (body.action === 'usuarios_buscar') {
        const q = String(body.q ?? '').trim().slice(0, 80)
        const tipo = ['todos', 'empresas', 'personas', 'contadores', 'pendientes'].includes(String(body.tipo)) ? String(body.tipo) : 'todos'
        const porPagina = Math.min(100, Math.max(1, Math.floor(Number(body.porPagina) || 50)))
        const pagina = Math.max(0, Math.floor(Number(body.pagina) || 0))
        const { data, error } = await db.rpc('admin_buscar_usuarios', { p_q: q || null, p_tipo: tipo, p_limit: porPagina, p_offset: pagina * porPagina })
        if (!error && data && typeof data === 'object') {
          const d = data as { total?: number; conteos?: Record<string, number>; usuarios?: Record<string, unknown>[] }
          return json({ ok: true, total: Number(d.total) || 0, conteos: d.conteos ?? null, pagina, porPagina, usuarios: (d.usuarios ?? []).map(usuarioParaPanel) })
        }
        // Respaldo sin la función de la base: filtra por texto y por tipo
        // simple; "contadores" no se puede saber sin ella.
        const limpio = q.replace(/[,()"\\%*]/g, ' ').trim()
        let consulta = db.from('users').select('*', { count: 'exact' })
        if (limpio) consulta = consulta.or(['email', 'full_name', 'company_name'].map(c => `${c}.ilike.*${limpio}*`).join(','))
        if (tipo === 'empresas') consulta = consulta.eq('role', 'business')
        if (tipo === 'pendientes') consulta = consulta.in('kyc_status', ['pending', 'in_review'])
        const { data: filas, count, error: e2 } = await consulta.order('created_at', { ascending: false, nullsFirst: false }).range(pagina * porPagina, pagina * porPagina + porPagina - 1)
        if (e2) return json({ ok: false, error: e2.message }, 500)
        const sinEquipo = ((filas ?? []) as Record<string, unknown>[]).filter(u => u.role !== 'admin')
        return json({ ok: true, total: Math.max(0, (count ?? 0) - (((filas ?? []) as any[]).length - sinEquipo.length)), conteos: null, pagina, porPagina, usuarios: sinEquipo.map(usuarioParaPanel), sinFuncionBase: true })
      }

      // Usuarios puntuales (los que el panel tiene abiertos o necesita para
      // nombrar un movimiento), hasta 200 por llamada.
      if (body.action === 'usuarios_por_id') {
        const ids = idsValidos(body.ids, 200)
        if (!ids.length) return json({ ok: true, usuarios: [] })
        return json({ ok: true, usuarios: (await usuariosPorId(ids)).map(usuarioParaPanel) })
      }

      // Un POST con una acción que no existe ya NO cae a la descarga general
      // (antes devolvía todos los usuarios y movimientos). Sin acción, sí:
      // es lo mismo que el GET.
      if (String(body.action ?? '').trim()) return json({ error: 'Acción desconocida o incompleta.' }, 400)
    }

    // La descarga general exige poder ver clientes (los cuatro roles lo
    // tienen; un miembro dado de baja ya quedó afuera arriba).
    {
      const permisosG = PERMISOS_POR_ROL[(auth.acceso?.rol ?? 'lectura') as Rol] ?? new Set<string>()
      if (!(permisosG.has('*') || permisosG.has('clientes.ver'))) return json({ error: 'Tu rol no permite esta operación.', permisoDenegado: true }, 403)
    }

    // GET (or POST without body) — fetch all users and recent transactions
    // ⚠️ Los ids de transactions son UUID ALEATORIOS. Ordenar por `id` (como
    // antes) devolvía 200 filas en orden lexicográfico de UUID = aleatorio en el
    // tiempo: al pasar de 200 transacciones, las SOLICITUDES NUEVAS (rail_move a
    // ACH, cargas, retiros) tenían solo ~200/N de chance de venir → "no llegaban"
    // a Tesorería para aprobar. Ahora se ordena por created_at (columna indexada)
    // Y ADEMÁS se traen SIEMPRE todas las pendientes, sin que el tope las tape.
    //
    // USUARIOS: el conjunto de trabajo, no la base entera. Con 100.000
    // clientes el panel no puede bajarlos todos cada 30 s, y PostgREST corta
    // en 1.000 filas sin avisar: el resto desaparecía del panel en silencio.
    // Viaja lo que el panel tiene a la vista: el equipo, los pendientes de
    // revisión, los de OTC, los últimos registrados, los dueños de los
    // movimientos cargados y los que el panel pidió por id (?incluir=). Lo
    // demás se busca en el servidor (usuarios_buscar).
    const incluir = idsValidos(new URL(req.url).searchParams.get('incluir'), 200)
    const conteo = (f: (q: any) => any) => f(db.from('users').select('id', { count: 'exact', head: true })).then((r: any) => r.count ?? null)
    const [txRes, pendingRes, equipoRes, pendKycRes, otcRes, recientesRes, pedidos, nTotal, nEquipo, nEmpresas, nPendientes, nVerificados, nBloqueados, obligaciones] = await Promise.all([
      db.from('transactions').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('transactions').select('*').eq('status', 'Pendiente').order('created_at', { ascending: false }).limit(500),
      db.from('users').select('*').eq('role', 'admin').limit(500),
      db.from('users').select('*').in('kyc_status', ['pending', 'in_review']).order('created_at', { ascending: false, nullsFirst: false }).limit(500),
      db.from('users').select('*').eq('raw_data->>otcEnabled', 'true').limit(1000),
      db.from('users').select('*').order('created_at', { ascending: false, nullsFirst: false }).limit(300),
      incluir.length ? usuariosPorId(incluir) : Promise.resolve([] as Record<string, unknown>[]),
      conteo(q => q),
      conteo(q => q.eq('role', 'admin')),
      conteo(q => q.eq('role', 'business')),
      conteo(q => q.in('kyc_status', ['pending', 'in_review'])),
      conteo(q => q.in('kyc_status', ['verified', 'approved'])),
      conteo(q => q.eq('is_blocked', true)),
      obligacionesTodas().catch(() => null),
    ])
    const usuariosPorIdMap = new Map<string, Record<string, unknown>>()
    for (const r of [equipoRes.data, pendKycRes.data, otcRes.data, recientesRes.data, pedidos]) {
      for (const u of (r ?? []) as Record<string, unknown>[]) usuariosPorIdMap.set(String(u.id), u)
    }

    // Une recientes + pendientes, deduplicando por id (una pendiente reciente
    // aparece en ambas — se conserva una sola vez).
    const txById = new Map<string, Record<string, unknown>>()
    for (const t of (txRes.data ?? [])) txById.set(String((t as any).id), t)
    for (const t of (pendingRes.data ?? [])) txById.set(String((t as any).id), t)
    const allTx = Array.from(txById.values())

    // Los dueños de los movimientos cargados, para que cada fila tenga nombre.
    const faltan = Array.from(new Set(allTx.map(t => String((t as any).user_id ?? '')).filter(id => UUID_RE.test(id) && !usuariosPorIdMap.has(id))))
    for (const u of await usuariosPorId(faltan)) usuariosPorIdMap.set(String(u.id), u)
    const usersRes = { data: Array.from(usuariosPorIdMap.values()) }

    // ── FILTRO POR PAÍS ────────────────────────────────────────────────
    // Esta es LA vía por la que el panel trae clientes y movimientos, así que
    // es acá donde el "este miembro solo ve Colombia" tiene que ser cierto.
    // Recortar en el navegador no sería una frontera: los datos ya habrían
    // viajado y estarían en la memoria de la pestaña.
    const acc: Acceso = auth.acceso ?? { rol: 'lectura', paises: [], todosLosPaises: false }

    // LOS CLIENTES NO SE FILTRAN POR PAÍS.
    //
    // Un cliente es un cliente: la misma persona aparece en todos lados y lo
    // que cambia según el país son sus MONEDAS Y BILLETERAS — COP, Bre-B y ACH
    // en Colombia; BRL y PIX en Brasil; USD/USDT arriba de todo.
    //
    // La primera versión de esto filtraba también la lista de clientes y fue
    // un error: escondía personas enteras en vez de acotar sobre qué opera
    // cada una, y dejó el panel sin clientes apenas se desplegó.
    const usuariosVisibles = usersRes.data ?? []

    // Los movimientos SÍ: un movimiento pertenece a un riel y un riel es de un
    // país. Es lo que hace que "operar Colombia" signifique algo.
    //
    // Lo que no se puede atribuir a ningún país se MUESTRA, no se esconde: un
    // dato que falta no es permiso para ocultarle a un operador un movimiento
    // que quizás tiene que atender.
    const movimientosVisibles = allTx.filter((t: Record<string, unknown>) =>
      acc.todosLosPaises || visibleEnPais(paisDeMovimiento(t), acc),
    )

    const clientesTotal = nTotal != null && nEquipo != null ? nTotal - nEquipo : null
    const clientesCargados = usuariosVisibles.filter((u: Record<string, unknown>) => u.role !== 'admin').length
    const payload = {
      // Usuarios: solo se quitan blobs base64 gigantes (>20 KB) — los campos
      // normales (contactos, wallets, notificaciones) pasan intactos.
      users:        usuariosVisibles.map(usuarioParaPanel),
      // Conteos de TODA la base, para que los tableros no cuenten solo los
      // que vinieron en la lista.
      resumenUsuarios: { clientes: clientesTotal, empresas: nEmpresas, pendientes: nPendientes, verificados: nVerificados, bloqueados: nBloqueados, cargados: clientesCargados, parcial: clientesTotal != null && clientesTotal > clientesCargados },
      obligaciones: obligaciones ? obligaciones.valor : null,
      obligacionesParciales: obligaciones ? obligaciones.parcial : null,
      transactions: movimientosVisibles.map((t: Record<string, unknown>) => ({ ...t, raw_data: slimRawData(t.raw_data) })),
      // Para que el panel pueda decir "estás viendo solo Colombia" en vez de
      // dejar creer que eso es todo lo que hay.
      alcance: { rol: acc.rol, paises: acc.paises, todos: acc.todosLosPaises },
    }
    const body = JSON.stringify(payload)
    console.log(`[admin-data] respuesta: ${payload.users.length} usuarios, ${payload.transactions.length} tx (rol ${acc.rol}), ${(body.length / 1024).toFixed(0)} KB`)
    return new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('[admin-data] error no controlado:', String((e as any)?.message ?? e).slice(0, 500))
    return json({ error: 'Error interno. Intenta de nuevo en un momento.' }, 500)
  }
})
