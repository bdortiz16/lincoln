// ── Firma, cifrado y reglas del secreto rotativo (puro, sin base) ─────────
// Ver docs/superpowers/specs/2026-11-12-api-empresas-design.md y la guía
// para el sistema externo en docs/api-empresas.md (mismo algoritmo).

export const GRACIA_MS = 5 * 60_000          // la generación anterior vale 5 min tras rotar
export const VIDA_MS = 24 * 3600_000         // cada generación vence a las 24 h
export const VENTANA_HORA_MS = 5 * 60_000    // X-Hora: ±5 min
export const NONCE_MS = 10 * 60_000          // los nonces se guardan 10 min

const enc = new TextEncoder()

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')

function b64urlDecode(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b + '='.repeat((4 - b.length % 4) % 4))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
function b64urlEncode(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(texto)))
}

// METODO \n RUTA \n QUERY_ORDENADA \n X-Hora \n X-Nonce \n SHA256_HEX(cuerpo)
// La query se ordena por clave y luego por valor; cada par va como k=v sin
// volver a codificar (lo que llegue decodificado por URLSearchParams).
export async function textoAFirmar(metodo: string, ruta: string, query: URLSearchParams, hora: string, nonce: string, cuerpo: string): Promise<string> {
  const pares = [...query.entries()].sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)
  const q = pares.map(([k, v]) => `${k}=${v}`).join('&')
  return [metodo.toUpperCase(), ruta, q, hora, nonce, await sha256Hex(cuerpo)].join('\n')
}

export async function firmar(secretoB64url: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', b64urlDecode(secretoB64url), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(texto)))
}

export function horaValida(hora: string, ahora = Date.now()): boolean {
  const t = Date.parse(hora)
  return Number.isFinite(t) && Math.abs(ahora - t) <= VENTANA_HORA_MS
}

export function generarSecreto(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
}
export function generarLlaveId(): string {
  return 'lk_' + hex(crypto.getRandomValues(new Uint8Array(6)).buffer)
}

// AES-GCM con la clave de API_SECRETOS_KEY (base64 de 32 bytes).
// Salida: base64(iv) "." base64(cifrado+tag).
async function claveAes(claveB64: string): Promise<CryptoKey> {
  const raw = unb64(claveB64)
  if (raw.length !== 32) throw new Error('API_SECRETOS_KEY debe ser base64 de 32 bytes')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function cifrar(claveB64: string, texto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await claveAes(claveB64), enc.encode(texto))
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`
}
export async function descifrar(claveB64: string, cifrado: string): Promise<string> {
  const [iv, ct] = cifrado.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await claveAes(claveB64), unb64(ct))
  return new TextDecoder().decode(pt)
}

export type Gen = { generacion: number; expira_at: string; reemplazado_at: string | null }

// ¿Sirve esta generación para firmar?
//   · reemplazada hace más de la gracia → alguien sigue usando un secreto
//     viejo mientras otro ya rotó: dos usuarios del mismo secreto (robo);
//   · vencida → 24 h sin rotar.
export function evaluarGeneracion(gens: Gen[], g: number, ahora = Date.now()): 'ok' | 'vencida' | 'reuso' | 'desconocida' {
  const x = gens.find(y => Number(y.generacion) === Number(g))
  if (!x) return 'desconocida'
  if (x.reemplazado_at && ahora - Date.parse(x.reemplazado_at) > GRACIA_MS) return 'reuso'
  if (Date.parse(x.expira_at) <= ahora) return 'vencida'
  return 'ok'
}
