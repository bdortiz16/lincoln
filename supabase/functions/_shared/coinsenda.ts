// ════════════════════════════════════════════════════════════════════
// coinsenda.ts — cliente de la API de Coinsenda (Cuenta 3 de Bre-B y ACH).
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
import { firmarJwtRS256, llavePrivadaCoinsenda } from './coinsenda-llave.ts'

export const CONFIG_COINSENDA = 'coinsenda_config'
export type ConfigCoinsenda = { email?: string | null; telefono?: string | null; dominio?: string; ultimaPrueba?: unknown }
export type RespuestaCoinsenda = { status: number; data: any; error?: string }

const DOMINIOS = new Set(['coinsenda.com', 'bitsenda.com'])
const SUBDOMINIO: Record<string, string> = { transaction: 'tx', farming: 'farm' }

export function urlServicio(servicio: string, dominio: string): string {
  if (!DOMINIOS.has(dominio)) throw new Error(`Dominio de Coinsenda no permitido: ${dominio}`)
  return `https://${SUBDOMINIO[servicio] ?? servicio}.${dominio}${servicio === 'auth' ? '/auth' : '/api'}`
}

// deno-lint-ignore no-explicit-any
export async function configCoinsenda(db: any): Promise<ConfigCoinsenda> {
  const { data } = await db.from('private_config').select('value').eq('key', CONFIG_COINSENDA).maybeSingle()
  let c: ConfigCoinsenda = {}
  try { const v = JSON.parse(String(data?.value ?? '{}')); if (v && typeof v === 'object') c = v } catch { /* vacío */ }
  return { ...c, dominio: DOMINIOS.has(String(c.dominio)) ? String(c.dominio) : 'coinsenda.com' }
}
// deno-lint-ignore no-explicit-any
export async function guardarConfigCoinsenda(db: any, cambios: Partial<ConfigCoinsenda>): Promise<string | null> {
  const actual = await configCoinsenda(db)
  const { error } = await db.from('private_config').upsert({ key: CONFIG_COINSENDA, value: JSON.stringify({ ...actual, ...cambios }) })
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
    throw new Error('Falta el correo de la cuenta de Coinsenda (Admin → Coinsenda).')
  }
  private get claveSesion() { return `${this.dominio}|${JSON.stringify(this.identidad)}` }

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
    const llave = await llavePrivadaCoinsenda(this.db)
    if (!llave) return { status: 0, data: null, error: 'Todavía no hay llave de la API (Admin → Coinsenda → Generar llave).' }
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
    const body = { data: { country: 'international', recaptcha_response: 'BYPASS_RECAPTCHA_DEV', ...(opts.data ?? {}) } }
    return this.http(url, { method: 'POST', headers, body: JSON.stringify(body) })
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
