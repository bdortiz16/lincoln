// ════════════════════════════════════════════════════════════════════
// coinsenda.ts — cliente de la API de Coinsenda (Cuentas 3 y 4 de Bre-B y ACH).
//
// Hace lo mismo que su SDK oficial (@coinsenda/sdk 1.9, el que trae el
// repositorio que genera su Studio), pero con fetch y sin dependencias: las
// funciones de Supabase no necesitan axios ni el resto del paquete para estas
// pocas llamadas. Lo que se copió del SDK, a propósito igual:
//
//   · Servicios: https://{sub}.{dominio}/api, con `tx` para transaction y
//     auth en https://auth.{dominio}/auth. Producción es coinsenda.com.
//   · Inicio de sesión: un JWT RS256 de 5 minutos con el correo (o el
//     celular) de la cuenta, firmado con NUESTRA privada; POST /auth/pubkey
//     lo canjea por { jwt, refresh_token }. La pública es la que se registró
//     en Ajustes → Desarrollador.
//   · Cada llamada lleva `Authorization: Bearer <jwt>`. Los GET mandan
//     `country=international` y el `filter` en corchetes (como axios), y los
//     POST van envueltos en { data: { country, recaptcha_response, ... } },
//     que es lo que manda el SDK.
//   · `{id}` en la ruta es el userId que viene dentro del jwt.
//   · El SDK NO lanza con un 4xx: devuelve { status, data }. Aquí igual, y
//     sin respuesta de la red el status es 0.
// ════════════════════════════════════════════════════════════════════
import { firmarJwtRS256, llavePrivadaCoinsenda, type CuentaCoinsenda } from './coinsenda-llave.ts'

// Una configuración por cuenta (Cuenta 3 y Cuenta 4: dos cuentas distintas
// en Coinsenda, cada una con su correo, su llave y su billetera). La de la
// Cuenta 3 conserva el nombre de siempre.
export const CONFIG_COINSENDA = 'coinsenda_config'
const claveConfig = (cuenta: CuentaCoinsenda) => cuenta === 4 ? `${CONFIG_COINSENDA}_c4` : CONFIG_COINSENDA
// `cuenta` no se guarda: la pone configCoinsenda() al leer, para que el
// cliente firme con la llave de ESA cuenta.
export type ConfigCoinsenda = { cuenta: CuentaCoinsenda; email?: string | null; telefono?: string | null; dominio?: string; ultimaPrueba?: unknown }
export type RespuestaCoinsenda = { status: number; data: any; error?: string }

const DOMINIOS = new Set(['coinsenda.com', 'bitsenda.com'])
const SUBDOMINIO: Record<string, string> = { transaction: 'tx', farming: 'farm' }

export function urlServicio(servicio: string, dominio: string): string {
  // Solo para el banco de pruebas local (un Coinsenda simulado): nunca se
  // define en Supabase. Con él, las llamadas van a <base>/<servicio>/...
  const prueba = Deno.env.get('COINSENDA_URL_PRUEBA') ?? ''
  if (prueba) return `${prueba.replace(/\/$/, '')}/${servicio}${servicio === 'auth' ? '/auth' : '/api'}`
  if (!DOMINIOS.has(dominio)) throw new Error(`Dominio de Coinsenda no permitido: ${dominio}`)
  return `https://${SUBDOMINIO[servicio] ?? servicio}.${dominio}${servicio === 'auth' ? '/auth' : '/api'}`
}

// El schema PÚBLICO con que Coinsenda valida un método (sin sesión):
// https://<servicio>.<dominio>/api-docs/openapi3.json. Se usa para entender
// un 465 remotequeryguard_7 ("Payload does not match the method"): el 9 nov
// la Cuenta 4 rechazó así un retiro con el mismo formato que el 5 nov sí
// aceptaba, y sin el schema no se sabía qué campo cambió. Devuelve el
// requestBody del método con sus $ref de components resueltos (un nivel), en
// texto y recortado; null si no se pudo leer. Nunca lanza.
// El documento se guarda 10 min en memoria de la función: lo pide cada 465 de
// schema y no cambia en minutos.
const openapiCache = new Map<string, { doc: any; at: number }>()
async function leerOpenapi(dominio: string, servicio: string): Promise<{ doc: any } | { error: string }> {
  if (Deno.env.get('COINSENDA_URL_PRUEBA')) return { error: 'banco de pruebas: sin schema público' }
  if (!DOMINIOS.has(dominio)) return { error: `dominio no permitido: ${dominio}` }
  const clave = `${servicio}|${dominio}`
  const c = openapiCache.get(clave)
  if (c && Date.now() - c.at < 10 * 60_000) return { doc: c.doc }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const r = await fetch(`https://${SUBDOMINIO[servicio] ?? servicio}.${dominio}/api-docs/openapi3.json`, { signal: ctrl.signal })
    if (!r.ok) return { error: `openapi3.json respondió ${r.status}` }
    const doc = await r.json()
    openapiCache.set(clave, { doc, at: Date.now() })
    return { doc }
  } catch (e) { return { error: `no se pudo leer el schema: ${String((e as Error)?.message ?? e).slice(0, 120)}` } }
  finally { clearTimeout(t) }
}
const operacionPost = (doc: any, ruta: string) => doc?.paths?.[ruta]?.post ?? doc?.paths?.[ruta.replace(/^\/api/, '')]?.post ?? null
const resolverRefs = (doc: any, x: any, prof = 0): any => {
  if (!x || typeof x !== 'object' || prof > 6) return x
  const schemas = doc?.components?.schemas ?? {}
  if (typeof x.$ref === 'string') return { $ref: x.$ref, ...resolverRefs(doc, schemas[x.$ref.split('/').pop()], prof + 1) }
  if (Array.isArray(x)) return x.map((y) => resolverRefs(doc, y, prof + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(x)) out[k] = resolverRefs(doc, v, prof + 1)
  return out
}

export async function esquemaMetodo(dominio: string, servicio: string, ruta: string): Promise<string | null> {
  try {
    const l = await leerOpenapi(dominio, servicio)
    if ('error' in l) return l.error
    const op = operacionPost(l.doc, ruta)
    if (!op) return `el schema no trae ${ruta}`
    return JSON.stringify(resolverRefs(l.doc, op.requestBody ?? op.parameters ?? op)).slice(0, 4000)
  } catch (e) { return `no se pudo leer el schema: ${String((e as Error)?.message ?? e).slice(0, 120)}` }
}

// Los campos que un POST acepta dentro de `data`, SOLO si el schema está
// cerrado (additionalProperties: false); null si está abierto o no se pudo
// leer (entonces no hay nada que quitar).
export async function camposDelMetodo(dominio: string, servicio: string, ruta: string): Promise<Set<string> | null> {
  try {
    const l = await leerOpenapi(dominio, servicio)
    if ('error' in l) return null
    const op = operacionPost(l.doc, ruta)
    const cuerpo = resolverRefs(l.doc, op?.requestBody?.content?.['application/json']?.schema)
    const data = cuerpo?.properties?.data
    if (!data || data.additionalProperties !== false || !data.properties || typeof data.properties !== 'object') return null
    return new Set(Object.keys(data.properties))
  } catch { return null }
}

// 465 remotequeryguard_7: el validador de schema rechazó el cuerpo ANTES de
// procesarlo (no se creó ni se cambió nada).
const rechazoDeSchema = (r: RespuestaCoinsenda) => {
  if (r.status !== 465) return false
  const e = r.data?.error && typeof r.data.error === 'object' ? r.data.error : (r.data ?? {})
  return String(e.code ?? e.error_code ?? '') === 'remotequeryguard_7' || /does not match the method/i.test(String(e.message ?? e.error ?? ''))
}

// deno-lint-ignore no-explicit-any
export async function configCoinsenda(db: any, cuenta: CuentaCoinsenda): Promise<ConfigCoinsenda> {
  const { data } = await db.from('private_config').select('value').eq('key', claveConfig(cuenta)).maybeSingle()
  let c: Partial<ConfigCoinsenda> = {}
  try { const v = JSON.parse(String(data?.value ?? '{}')); if (v && typeof v === 'object') c = v } catch { /* vacío */ }
  return { ...c, cuenta, dominio: DOMINIOS.has(String(c.dominio)) ? String(c.dominio) : 'coinsenda.com' }
}
// deno-lint-ignore no-explicit-any
export async function guardarConfigCoinsenda(db: any, cuenta: CuentaCoinsenda, cambios: Partial<Omit<ConfigCoinsenda, 'cuenta'>>): Promise<string | null> {
  const { cuenta: _c, ...actual } = await configCoinsenda(db, cuenta)
  const { error } = await db.from('private_config').upsert({ key: claveConfig(cuenta), value: JSON.stringify({ ...actual, ...cambios }) })
  return error ? error.message : null
}

// El `filter` como lo serializa axios 1.x, que es lo que usa el SDK:
// filter[where][state][inq][0]=pending, espacios como "+", y ':' '$' ','
// sin escapar. Así el servidor de ellos recibe exactamente lo de siempre.
function codificar(v: string): string {
  return encodeURIComponent(v).replace(/%3A/gi, ':').replace(/%24/g, '$').replace(/%2C/gi, ',').replace(/%20/g, '+')
}
export function aQuery(params: Record<string, unknown>): string {
  const pares: string[] = []
  const recorrer = (clave: string, v: unknown) => {
    if (v === undefined) return
    if (v !== null && typeof v === 'object') {
      for (const [k, sub] of Object.entries(v as Record<string, unknown>)) recorrer(`${clave}[${k}]`, sub)
      return
    }
    pares.push(`${codificar(clave)}=${codificar(v === null ? '' : String(v))}`)
  }
  for (const [k, v] of Object.entries(params)) recorrer(k, v)
  return pares.join('&')
}

function payloadDe(jwt: string): Record<string, any> {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4)))
  } catch { return {} }
}

// Sesión por dominio y cuenta, en memoria de la función: dura lo que viva la
// instancia y se renueva sola un minuto antes de vencer.
const sesiones = new Map<string, { jwt: string; refresh: string | null; vence: number; userId: string | null }>()

export class ClienteCoinsenda {
  // deno-lint-ignore no-explicit-any
  constructor(private db: any, private cfg: ConfigCoinsenda, private espera = 30_000) {}

  private get dominio() { return this.cfg.dominio ?? 'coinsenda.com' }
  private get identidad(): Record<string, string> {
    if (this.cfg.email) return { email: String(this.cfg.email) }
    if (this.cfg.telefono) return { phone_number: String(this.cfg.telefono) }
    throw new Error(`Falta el correo de la Cuenta ${this.cfg.cuenta} de Coinsenda (Admin → Coinsenda).`)
  }
  // La cuenta va en la clave: cada cuenta firma con su llave y su sesión no
  // se le presta a la otra.
  private get claveSesion() { return `${this.cfg.cuenta}|${this.dominio}|${JSON.stringify(this.identidad)}` }
  get cuenta(): CuentaCoinsenda { return this.cfg.cuenta }

  private async http(url: string, init: RequestInit): Promise<RespuestaCoinsenda> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.espera)
    try {
      const r = await fetch(url, { ...init, signal: ctrl.signal })
      const texto = await r.text()
      let data: any = null
      try { data = texto ? JSON.parse(texto) : null } catch { data = { error: { message: texto.slice(0, 300) } } }
      return { status: r.status, data }
    } catch (e) {
      return { status: 0, data: null, error: ctrl.signal.aborted ? `sin respuesta en ${Math.round(this.espera / 1000)} s` : String((e as Error)?.message ?? e) }
    } finally { clearTimeout(t) }
  }

  /** Firma la aserción y la canjea por una sesión. */
  async login(): Promise<RespuestaCoinsenda> {
    // Cada cuenta firma con SU llave. (Se probó que la Cuenta 4 usara la de la
    // Cuenta 3, creyendo que la subcuenta compartía la clave; no era así —
    // tenía otra registrada— y se quitó el 1 nov.)
    const llave = await llavePrivadaCoinsenda(this.db, this.cfg.cuenta)
    if (!llave) return { status: 0, data: null, error: `Todavía no hay llave de la API de la Cuenta ${this.cfg.cuenta} (Admin → Coinsenda → Generar llave).` }
    const iat = Math.floor(Date.now() / 1000)
    const signed_token = await firmarJwtRS256(llave, { ...this.identidad, iat, exp: iat + 300 })
    const r = await this.http(`${urlServicio('auth', this.dominio)}/pubkey`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { signed_token } }),
    })
    const d = r.data?.data?.data ?? r.data?.data ?? r.data
    if (r.status >= 200 && r.status < 300 && d?.jwt) {
      const p = payloadDe(String(d.jwt))
      sesiones.set(this.claveSesion, {
        jwt: String(d.jwt), refresh: d.refresh_token ? String(d.refresh_token) : null,
        vence: p.exp ? Number(p.exp) * 1000 : Date.now() + 5 * 60_000,
        userId: (p.userId ?? p.usr ?? p.id ?? p.sub ?? null) as string | null,
      })
    }
    return r
  }

  private async sesion() {
    const s = sesiones.get(this.claveSesion)
    if (s && s.vence - Date.now() > 60_000) return s
    if (s?.refresh) {
      const r = await this.http(`${urlServicio('auth', this.dominio)}/oauth/grant/refresh-token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.jwt}` },
        body: JSON.stringify({ data: { refresh_token: s.refresh } }),
      })
      const d = r.data?.data?.data ?? r.data?.data ?? r.data
      if (r.status >= 200 && r.status < 300 && d?.jwt) {
        const p = payloadDe(String(d.jwt))
        const nueva = { jwt: String(d.jwt), refresh: d.refresh_token ? String(d.refresh_token) : s.refresh, vence: p.exp ? Number(p.exp) * 1000 : Date.now() + 5 * 60_000, userId: (p.userId ?? p.usr ?? p.id ?? p.sub ?? s.userId) as string | null }
        sesiones.set(this.claveSesion, nueva)
        return nueva
      }
    }
    const r = await this.login()
    const n = sesiones.get(this.claveSesion)
    if (!n || n.vence <= Date.now()) throw new Error(describirFallo(r, 'iniciar sesión'))
    return n
  }

  async userId(): Promise<string | null> { return (await this.sesion()).userId }

  /** Una llamada como las del SDK. `filter` va en el query (GET); `data`, envuelto (POST). */
  async pedir(servicio: string, metodo: 'GET' | 'POST', ruta: string, opts: { filter?: unknown; data?: Record<string, unknown> } = {}): Promise<RespuestaCoinsenda> {
    const s = await this.sesion()
    const rutaFinal = ruta.includes('{id}') && s.userId ? ruta.replace('{id}', encodeURIComponent(s.userId)) : ruta
    let url = `${urlServicio(servicio, this.dominio)}${rutaFinal}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.jwt}` }
    if (metodo === 'GET') {
      const q = aQuery({ country: 'international', filter: opts.filter })
      if (q) url += `?${q}`
      return this.http(url, { method: 'GET', headers })
    }
    // `recaptcha_response` va porque el SDK oficial lo pone en todo POST.
    const data: Record<string, unknown> = { country: 'international', recaptcha_response: 'BYPASS_RECAPTCHA_DEV', ...(opts.data ?? {}) }
    const r = await this.http(url, { method: 'POST', headers, body: JSON.stringify({ data }) })
    // SCHEMA CERRADO (9 nov): Coinsenda pasó «crear retiro» a
    // additionalProperties:false y desde entonces responde 465
    // remotequeryguard_7 a todo cuerpo con un campo que no esté en su lista
    // (antes los ignoraba; el 5 nov se creaban retiros con este mismo cuerpo).
    // El rechazo es del validador, ANTES de procesar: no se creó nada. Se lee
    // el schema público del método, se quitan los campos que no acepta (p. ej.
    // recaptcha_response, que pone el SDK) y se reintenta UNA vez. Si el
    // schema está abierto o no se puede leer, se devuelve el rechazo tal cual.
    if (!rechazoDeSchema(r)) return r
    const campos = await camposDelMetodo(this.dominio, servicio, ruta)
    if (!campos) return r
    const sobran = Object.keys(data).filter((k) => !campos.has(k))
    if (!sobran.length) return r
    const limpio = Object.fromEntries(Object.entries(data).filter(([k]) => campos.has(k)))
    try { await this.db.from('audit_log').insert({ user_id: null, action: 'coinsenda.campos_quitados', metadata: { cuenta: this.cfg.cuenta, ruta, sobran, at: new Date().toISOString() } }) } catch { /* el registro es un extra */ }
    return this.http(url, { method: 'POST', headers, body: JSON.stringify({ data: limpio }) })
  }
}

export const exitoso = (r: RespuestaCoinsenda) => r.status >= 200 && r.status < 300
/** El jwt de una respuesta de /pubkey, venga anidado como venga. */
export const jwtDe = (r: RespuestaCoinsenda): string | null => {
  const d = r.data?.data?.data ?? r.data?.data ?? r.data
  return d?.jwt ? String(d.jwt) : null
}

/** El motivo de un fallo, aplanado como lo hace su repositorio: { error: { message, code } }. */
export function describirFallo(r: RespuestaCoinsenda, que: string): string {
  if (r.status === 0) return `Coinsenda no respondió al ${que}${r.error ? ` (${r.error})` : ''}.`
  const e = r.data?.error && typeof r.data.error === 'object' ? r.data.error : (r.data ?? {})
  const motivo = String(e.message ?? e.error ?? '').slice(0, 300)
  const codigo = e.code ?? e.error_code ?? null
  return `Coinsenda respondió ${r.status} al ${que}${motivo ? `: ${motivo}` : ''}${codigo ? ` [${codigo}]` : ''}`
}

// ════════════════════════════════════════════════════════════════════
// ENVÍOS (Cuentas 3 y 4 de Bre-B y de ACH)
//
// Un envío en Coinsenda son tres identificadores y dos llamadas:
//   · account_id           → la billetera COP de Lincoin de donde sale;
//   · withdraw_account_id  → el destino, INSCRITO antes (una llave Bre-B o una
//                            cuenta de banco; sin inscribir no hay envío);
//   · withdraw_provider_id → el medio (breb o bank), con su costo.
// Se CREA el retiro (nace 'pending' y no mueve plata) y se CONFIRMA (ahí sale).
// Después recorre confirmed → accepted, o termina en rejected. No hay webhooks:
// el estado se relee del retiro por su id.
//
// OJO con el monto: Coinsenda descuenta su costo DEL monto ("amount es lo que
// se debita, no lo que llega"). Para que al beneficiario le llegue lo que el
// cliente pidió, se crea por el monto MÁS el costo de Coinsenda.
// ════════════════════════════════════════════════════════════════════

const esCopC = (x: any) => String(x?.currency && typeof x.currency === 'object' ? (x.currency.currency ?? '') : (x?.currency ?? '')).toLowerCase() === 'cop'
const listaDe = (r: RespuestaCoinsenda): any[] => Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : []
const objetoDe = (r: RespuestaCoinsenda): any => {
  const d = r.data?.data ?? r.data
  return Array.isArray(d) ? d[0] ?? null : d
}
const numero = (v: unknown): number => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : NaN }
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** La billetera COP de donde salen los envíos: la predeterminada, nunca la de la tarjeta. */
export async function billeteraCop(cli: ClienteCoinsenda): Promise<{ id: string; disponible: number; tipo: string; nombre: string } | { error: string }> {
  const uid = await cli.userId()
  const r = await cli.pedir('account', 'GET', '/users/{id}/accounts', { filter: { id: uid } })
  if (!exitoso(r)) return { error: describirFallo(r, 'leer las billeteras') }
  const cands = listaDe(r).filter(b => esCopC(b) && String(b?.type ?? '') !== 'card_mirror' && b?.enabled !== false && b?.visible !== false && b?.id)
  const orden = (b: any) => (b?.default === true ? 0 : 2) + (String(b?.type) === 'payment' ? 0 : String(b?.type) === 'trade' ? 0.5 : 1)
  const b = cands.sort((x, y) => orden(x) - orden(y))[0]
  if (!b) return { error: 'La cuenta de Coinsenda no tiene una billetera COP habilitada.' }
  return { id: String(b.id), disponible: numero(b.available), tipo: String(b.type ?? ''), nombre: String(b.name ?? '') }
}

/** El medio COP de un tipo ('breb' o 'bank'). Se leen todos: con el filtro
 *  enabled/visible en la consulta, Coinsenda no devolvía los de COP. */
export async function proveedorCop(cli: ClienteCoinsenda, tipo: 'breb' | 'bank'): Promise<any | { error: string }> {
  const r = await cli.pedir('withdraw', 'GET', '/withdrawProviders', { filter: { limit: 200 } })
  if (!exitoso(r)) return { error: describirFallo(r, 'leer los medios de envío') }
  const cands = listaDe(r).filter(p => esCopC(p) && String(p?.provider_type ?? '') === tipo && p?.enabled !== false && p?.id)
  const p = cands.sort((a, b) => (a?.visible === false ? 1 : 0) - (b?.visible === false ? 1 : 0))[0]
  return p ?? { error: `La cuenta de Coinsenda no tiene habilitado el envío ${tipo === 'breb' ? 'Bre-B' : 'bancario'} en COP.` }
}

/** El costo de Coinsenda para un envío: fijo + porcentaje (en puntos: "1" = 1 %).
 *  Claves de provider.costs: breb → 'breb'; bancaria → 'pp' (otro banco; hoy
 *  igual a 'op' y a 'same_bank'). */
export function costoCoinsenda(p: any, tipo: 'breb' | 'bank'): { fijo: number; pct: number } | null {
  const c = p?.provider?.costs ?? p?.costs ?? null
  if (!c || typeof c !== 'object') return null
  const e = tipo === 'breb' ? c.breb : (c.pp ?? c.op ?? c.same_bank)
  if (!e || typeof e !== 'object') return null
  const fijo = numero(e.fixed ?? 0), pct = numero(e.percent ?? 0)
  return Number.isFinite(fijo) && Number.isFinite(pct) ? { fijo, pct } : null
}
/** Lo que hay que pedirle a Coinsenda para que al beneficiario le llegue `neto`. */
export function montoBruto(neto: number, costo: { fijo: number; pct: number }): number {
  return Math.ceil((neto + costo.fijo) / (1 - costo.pct / 100))
}

/** La llave Bre-B como la manda la app de Coinsenda (normalizeBrebAlias):
 *  correo tal cual; celular tal cual; número sin @; alias con @. */
export function aliasBreb(raw: string): string {
  const v = String(raw ?? '').trim()
  if (!v) return v
  const sinArroba = v.replace(/^@/, '')
  if (sinArroba.includes('@')) return sinArroba
  const dig = sinArroba.replace(/\D/g, '')
  if (/^[+\d\s().-]+$/.test(sinArroba) && /^(57)?3\d{9}$/.test(dig)) return v
  if (/^\d+$/.test(sinArroba)) return v.startsWith('@') ? `@${sinArroba}` : sinArroba
  return `@${sinArroba}`
}

/** El titular de una llave según el directorio Bre-B de Coinsenda. */
export async function resolverLlave(cli: ClienteCoinsenda, alias: string): Promise<{ encontrada: boolean; nombre?: string; documento?: string; error?: string; status: number; crudo?: any }> {
  const r = await cli.pedir('withdraw', 'POST', '/withdrawAccounts/resolve-breb-alias-public', { data: { alias } })
  const err = r.data?.error && typeof r.data.error === 'object' ? r.data.error : (r.data?.data?.error ?? null)
  if (!exitoso(r) || err) {
    if (String(err?.code ?? '') === 'withdrawaccount_23') return { encontrada: false, status: r.status }
    return { encontrada: false, status: r.status, error: describirFallo(r, 'consultar la llave Bre-B') }
  }
  const d = objetoDe(r) ?? {}
  const nombre = [d.name ?? d.first_name ?? d.names, d.surname ?? d.last_name ?? d.surnames].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ') || String(d.full_name ?? d.holder_name ?? '').trim()
  const documento = String(d.id_number ?? d.document_number ?? d.document ?? d.nit ?? '').replace(/\D/g, '')
  return { encontrada: true, status: r.status, ...(nombre ? { nombre } : {}), ...(documento ? { documento } : {}), crudo: d }
}

/** Todas las cuentas destino, de a 200 por id (el guardia de Coinsenda corta
 *  cada lista en 200 sin avisar). Se filtra después: con where sobre
 *  visible/state la cuenta no devolvía todo. */
async function destinosInscritos(cli: ClienteCoinsenda): Promise<any[] | { error: string }> {
  const todos: any[] = []
  let ultimo: string | null = null
  for (let pagina = 0; pagina < 10; pagina++) {
    const filtro: Record<string, unknown> = { order: 'id ASC', limit: 200, ...(ultimo ? { where: { id: { gt: ultimo } } } : {}) }
    const r = await cli.pedir('withdraw', 'GET', '/users/{id}/withdrawAccounts', { filter: filtro })
    if (!exitoso(r)) return { error: describirFallo(r, 'leer las cuentas destino') }
    const l = listaDe(r)
    todos.push(...l)
    if (l.length < 200) return todos
    ultimo = l[l.length - 1]?.id ? String(l[l.length - 1].id) : null
    if (!ultimo) break
  }
  return todos
}
const destinoUsable = (w: any) => w?.visible !== false && !['rejected', 'canceled', 'cancelled'].includes(String(w?.state ?? '').toLowerCase())

/** La llave Bre-B inscrita en Coinsenda (la reusa si ya estaba). */
export async function destinoBreb(cli: ClienteCoinsenda, prov: any, alias: string, etiqueta: string): Promise<{ id: string; nuevo: boolean } | { error: string; status?: number; crudo?: any }> {
  const lista = await destinosInscritos(cli)
  if (!Array.isArray(lista)) return lista
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/^@/, '')
  const ya = lista.filter(w => String(w?.provider_type ?? '') === 'breb' && (!w?.currency || esCopC(w)) && destinoUsable(w) && norm(w?.info?.account_id) === norm(alias))
    .sort((a, b) => String(b?.updated_at ?? '').localeCompare(String(a?.updated_at ?? '')))[0]
  if (ya?.id) return { id: String(ya.id), nuevo: false }
  const r = await cli.pedir('withdraw', 'POST', '/withdrawAccounts/add-new-withdraw-account', { data: {
    currency: 'cop', provider_type: 'breb', internal: prov?.internal ?? false,
    info_needed: { label: etiqueta.slice(0, 40) || alias, account_id: alias, country: 'colombia' },
  } })
  const d = objetoDe(r)
  if (!exitoso(r) || !d?.id) return { error: describirFallo(r, 'inscribir la llave Bre-B'), status: r.status, crudo: r.data }
  return { id: String(d.id), nuevo: true }
}

// Lo que Coinsenda llama banco, tipo de cuenta y tipo de documento son claves
// de SU catálogo (info_needed del medio bancario). Lincoin guarda nombres
// ("Bancolombia", "ahorros", "CC"): se cruzan por la clave o por el nombre
// visible. Si no hay cruce claro, no se adivina: el envío no arranca.
const claveCatalogo = (cat: Record<string, any> | null | undefined, prueba: (clave: string, nombre: string) => boolean): string | null => {
  if (!cat || typeof cat !== 'object') return null
  for (const [k, v] of Object.entries(cat)) {
    if (k === 'ui_name' || k === 'ui_type') continue
    if (prueba(sinTildes(k), sinTildes(String((v as any)?.ui_name ?? '')))) return k
  }
  return null
}
const nombreBanco = (s: string) => sinTildes(s).replace(/\b(banco|bank|s\.?a\.?s?|colombia)\b/g, '').replace(/[^a-z0-9]/g, '')
export function bancoCoinsenda(prov: any, banco: string): string | null {
  const objetivo = nombreBanco(banco)
  if (!objetivo) return null
  return claveCatalogo(prov?.info_needed?.bank_name, (k, n) => nombreBanco(k) === objetivo || (!!n && nombreBanco(n) === objetivo))
}
export function tipoCuentaCoinsenda(prov: any, bancoClave: string, tipo: string): string | null {
  const ahorros = /ahorro|saving/.test(sinTildes(tipo))
  const re = ahorros ? /ahorro|saving/ : /corriente|checking|current/
  const k = claveCatalogo(prov?.info_needed?.account_type, (cl, n) => re.test(cl) || re.test(n))
  const compatibles = prov?.info_needed?.bank_name?.[bancoClave]?.compatible_account_types
  if (k && Array.isArray(compatibles) && !compatibles.includes(k)) return null
  return k
}
const DOC_COINSENDA: Record<string, [RegExp, string]> = {
  CC: [/ciudadan|^cc$/, 'cedula_ciudadania'], NIT: [/^nit$|nit/, 'nit'], CE: [/extranjer|^ce$/, 'cedula_extranjeria'],
  PP: [/pasaporte|passport/, 'pasaporte'], PA: [/pasaporte|passport/, 'pasaporte'], TI: [/tarjeta/, 'tarjeta_identidad'],
  PPT: [/ppt|permiso/, 'ppt'], PEP: [/pep|permiso/, 'pep'],
}
export function tipoDocCoinsenda(prov: any, docTipo: string): string | null {
  const m = DOC_COINSENDA[String(docTipo ?? '').toUpperCase().trim()]
  if (!m) return null
  const cat = prov?.info_needed?.id_type
  if (cat && typeof cat === 'object') return claveCatalogo(cat, (k, n) => m[0].test(k) || m[0].test(n))
  return m[1]
}
/** Nombres y apellidos de un titular escrito en una sola línea. Empresa: la razón social en los dos. */
export function partirNombre(completo: string, empresa: boolean): { name: string; surname: string } {
  const t = String(completo ?? '').trim().replace(/\s+/g, ' ')
  if (empresa || !t) return { name: t, surname: t }
  const p = t.split(' ')
  if (p.length === 1) return { name: p[0], surname: p[0] }
  if (p.length === 2) return { name: p[0], surname: p[1] }
  if (p.length === 3) return { name: p[0], surname: p.slice(1).join(' ') }
  return { name: p.slice(0, 2).join(' '), surname: p.slice(2).join(' ') }
}

/** La cuenta de banco inscrita en Coinsenda (la reusa si ya estaba). */
export async function destinoBanco(cli: ClienteCoinsenda, prov: any, d: {
  banco: string; tipoCuenta: string; numero: string; docTipo: string; docNumero: string; titular: string; correo?: string | null
}): Promise<{ id: string; nuevo: boolean } | { error: string; status?: number; crudo?: any; datos?: boolean }> {
  const bancoK = bancoCoinsenda(prov, d.banco)
  if (!bancoK) return { error: `El banco «${d.banco}» no está en el catálogo de la Cuenta ${cli.cuenta}.`, datos: true }
  const tipoK = tipoCuentaCoinsenda(prov, bancoK, d.tipoCuenta)
  if (!tipoK) return { error: `La Cuenta ${cli.cuenta} no acepta cuentas ${d.tipoCuenta} de ese banco.`, datos: true }
  const docK = tipoDocCoinsenda(prov, d.docTipo)
  if (!docK) return { error: `La Cuenta ${cli.cuenta} no reconoce el tipo de documento «${d.docTipo}».`, datos: true }
  const numeroCta = String(d.numero ?? '').replace(/\D/g, '')
  const lista = await destinosInscritos(cli)
  if (!Array.isArray(lista)) return lista
  const ya = lista.filter(w => String(w?.provider_type ?? '') === 'bank' && destinoUsable(w)
    && String(w?.info?.bank_name ?? '') === bancoK && String(w?.info?.account_number ?? '').replace(/\D/g, '') === numeroCta)
    .sort((a, b) => String(b?.updated_at ?? '').localeCompare(String(a?.updated_at ?? '')))[0]
  if (ya?.id) return { id: String(ya.id), nuevo: false }
  // A nombre de cuál identidad del negocio se inscribe (como en su app).
  const ids = await cli.pedir('identity', 'GET', '/users/{id}/identities', { filter: { limit: 200 } })
  const identidad = listaDe(ids)[0]
  const empresa = docK === 'nit'
  const { name, surname } = partirNombre(d.titular, empresa)
  const valores: Record<string, unknown> = {
    account_number: numeroCta, account_type: tipoK, bank_name: bancoK, country: prov?.country,
    email: d.correo ?? undefined, id_number: String(d.docNumero ?? '').replace(/\D/g, ''), id_type: docK,
    label: bancoK, name, surname,
  }
  const pide = prov?.info_needed && typeof prov.info_needed === 'object' ? Object.keys(prov.info_needed) : Object.keys(valores)
  const info: Record<string, unknown> = {}
  for (const k of pide) if (k in valores && valores[k] != null && valores[k] !== '') info[k] = typeof valores[k] === 'string' ? String(valores[k]).trim() : valores[k]
  info.thirdPartyId = true
  const r = await cli.pedir('withdraw', 'POST', '/withdrawAccounts/add-new-withdraw-account', { data: {
    currency: 'cop', provider_type: 'bank', internal: prov?.internal ?? false,
    ...(identidad?.id ? { identity_id: String(identidad.id) } : {}), info_needed: info,
  } })
  const w = objetoDe(r)
  if (!exitoso(r) || !w?.id) return { error: describirFallo(r, 'inscribir la cuenta bancaria'), status: r.status, crudo: r.data }
  return { id: String(w.id), nuevo: true }
}

/** Crea el retiro. Nace 'pending': todavía no mueve plata. */
export async function crearRetiro(cli: ClienteCoinsenda, x: { cuenta: string; destino: string; proveedor: string; monto: number }): Promise<{ ok: true; id: string; estado: string; crudo: any } | { ok: false; status: number; error: string; crudo: any; enviado: Record<string, unknown> }> {
  const enviado = { account_id: x.cuenta, amount: String(Math.round(x.monto)), withdraw_account_id: x.destino, withdraw_provider_id: x.proveedor }
  const r = await cli.pedir('withdraw', 'POST', '/withdraws/add-new-withdraw-public', { data: enviado })
  const w = objetoDe(r)
  if (exitoso(r) && w?.id) return { ok: true, id: String(w.id), estado: String(w.state ?? 'pending'), crudo: w }
  // `enviado` (sin llaves ni sesión: solo ids y monto) para comparar con el
  // schema cuando Coinsenda dice que no cuadra.
  return { ok: false, status: r.status, error: describirFallo(r, 'crear el retiro'), crudo: r.data ?? r.error ?? null, enviado }
}

export type DesenlaceConfirmar = 'salio' | 'aceptado' | 'rechazado' | 'no_salio' | 'desconocido'
/** Confirma el retiro: es lo que manda la plata. Volver a confirmar el MISMO
 *  retiro no paga dos veces (es el mismo id), por eso la conciliación puede
 *  reintentarlo cuando no hubo respuesta. */
export async function confirmarRetiro(cli: ClienteCoinsenda, id: string): Promise<{ desenlace: DesenlaceConfirmar; estado?: string; status: number; error?: string; crudo: any }> {
  const r = await cli.pedir('withdraw', 'POST', '/withdraws/add-update-withdraw', { data: { withdraw_id: id, state: 'confirmed' } })
  const w = objetoDe(r)
  const estado = String(w?.state ?? '').toLowerCase()
  if (exitoso(r)) {
    if (estado === 'accepted') return { desenlace: 'aceptado', estado, status: r.status, crudo: w }
    if (estado === 'confirmed') return { desenlace: 'salio', estado, status: r.status, crudo: w }
    if (estado === 'rejected') return { desenlace: 'rechazado', estado, status: r.status, crudo: w }
    // 200 sin estado claro: no se sabe si salió. Lo resuelve la conciliación.
    return { desenlace: 'desconocido', estado, status: r.status, crudo: r.data }
  }
  // Sin respuesta, error del servidor, tiempo o límite: no se sabe.
  if (r.status === 0 || r.status >= 500 || r.status === 408 || r.status === 429) {
    return { desenlace: 'desconocido', status: r.status, error: describirFallo(r, 'confirmar el retiro'), crudo: r.data ?? r.error ?? null }
  }
  // Un 4xx claro: la confirmación no pasó, el retiro sigue sin mover plata.
  return { desenlace: 'no_salio', status: r.status, error: describirFallo(r, 'confirmar el retiro'), crudo: r.data }
}

/** Un retiro por id: su estado actual. */
export async function leerRetiro(cli: ClienteCoinsenda, id: string): Promise<{ ok: true; existe: boolean; estado?: string; crudo?: any } | { ok: false; error: string }> {
  const r = await cli.pedir('withdraw', 'GET', '/users/{id}/withdraws', { filter: { where: { id }, limit: 1 } })
  if (!exitoso(r)) return { ok: false, error: describirFallo(r, 'leer el retiro') }
  // Se toma el retiro con ESE id, no el primero de la lista. Si Coinsenda
  // ignora el filtro (ya pasó con otros filtros, ver destinosInscritos),
  // devuelve otros retiros del usuario: un 'rejected' ajeno reembolsaba un
  // envío pagado y un 'accepted' ajeno completaba uno rechazado (revisión
  // del 6 nov). Sin coincidencia exacta, no existe.
  const w = listaDe(r).find((x: any) => String(x?.id ?? '') === String(id))
  if (!w) return { ok: true, existe: false }
  return { ok: true, existe: true, estado: String(w.state ?? '').toLowerCase(), crudo: w }
}
