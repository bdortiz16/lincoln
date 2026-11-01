// ════════════════════════════════════════════════════════════════════
// coinsenda-llave.ts — la llave RS256 con la que Lincoin firma ante Coinsenda.
//
// POR QUÉ ASÍ:
// Coinsenda autentica al negocio con una pareja de llaves: en su panel
// (Ajustes → Desarrollador → Clave pública de API) se registra la PÚBLICA, y
// con la PRIVADA se firman los tokens de la sesión. Nadie la genera en su
// computador ni la copia a mano: la crea el servidor (admin-data, solo el
// dueño y con su 2FA), la guarda CIFRADA con FIELD_ENC_KEY en
// private_config —que ni el navegador ni una sesión de cliente pueden leer—
// y de ahí no sale: ni a la pantalla, ni al chat, ni a un archivo. A la
// pantalla solo vuelve la pública, que es la que se pega en Coinsenda.
//
// Si algún día se prefiere manejarla como secreto de Supabase, el secreto
// COINSENDA_PRIVATE_KEY manda sobre lo guardado. Se acepta el PEM tal cual,
// el PEM con los saltos escritos como "\n", o el PEM en base64 (una línea).
// ════════════════════════════════════════════════════════════════════
import { encField, decField } from './field-crypto.ts'

export const LLAVE_COINSENDA = 'coinsenda_llave_api'
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const

export type LlaveCoinsenda = { publica: string; huella: string; at: string; por?: unknown }
type Guardada = LlaveCoinsenda & { privadaEnc: string; anteriores?: { huella: string; at: string; hasta: string }[] }

function b64(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const b64url = (buf: ArrayBuffer | Uint8Array) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const aPem = (tipo: string, der: ArrayBuffer) => `-----BEGIN ${tipo}-----\n${(b64(der).match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${tipo}-----\n`
function derDePem(texto: string): Uint8Array {
  const limpio = texto.replace(/-----[A-Z ]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(limpio), c => c.charCodeAt(0))
}

/** Huella corta de la pública (SHA-256 del DER, 8 bytes): sirve para
 *  confirmar a simple vista que la registrada en Coinsenda es la de acá. */
export async function huellaDe(spkiDer: ArrayBuffer | Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', spkiDer))
  return Array.from(h.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase()
}

/** Pareja nueva RSA 2048 / RS256. La privada sale ya cifrada. */
export async function generarParCoinsenda(): Promise<{ publica: string; huella: string; privadaEnc: string }> {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair
  const spki = await crypto.subtle.exportKey('spki', par.publicKey)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', par.privateKey)
  return { publica: aPem('PUBLIC KEY', spki), huella: await huellaDe(spki), privadaEnc: await encField(aPem('PRIVATE KEY', pkcs8)) }
}

// deno-lint-ignore no-explicit-any
async function leerGuardada(db: any): Promise<Guardada | null> {
  const { data } = await db.from('private_config').select('value').eq('key', LLAVE_COINSENDA).maybeSingle()
  try {
    const v = JSON.parse(String(data?.value ?? 'null'))
    return v && typeof v === 'object' && v.privadaEnc && v.publica ? v as Guardada : null
  } catch { return null }
}

/** Lo que puede ver el panel: la pública, su huella y quién la generó. Nunca la privada. */
// deno-lint-ignore no-explicit-any
export async function estadoLlaveCoinsenda(db: any): Promise<LlaveCoinsenda | null> {
  const g = await leerGuardada(db)
  return g ? { publica: g.publica, huella: g.huella, at: g.at, por: g.por ?? null } : null
}

/** Guarda la llave nueva. De la anterior queda solo la huella y las fechas,
 *  para saber después cuál estuvo registrada y hasta cuándo. */
// deno-lint-ignore no-explicit-any
export async function guardarLlaveCoinsenda(db: any, nueva: Omit<Guardada, 'anteriores'>): Promise<string | null> {
  const previa = await leerGuardada(db)
  const anteriores = previa
    ? [{ huella: previa.huella, at: previa.at, hasta: nueva.at }, ...(previa.anteriores ?? [])].slice(0, 10)
    : []
  const { error } = await db.from('private_config').upsert({ key: LLAVE_COINSENDA, value: JSON.stringify({ ...nueva, anteriores }) })
  return error ? error.message : null
}

/** La privada lista para firmar, o null si todavía no hay ninguna. */
// deno-lint-ignore no-explicit-any
export async function llavePrivadaCoinsenda(db: any): Promise<CryptoKey | null> {
  let texto = (Deno.env.get('COINSENDA_PRIVATE_KEY') ?? '').trim()
  if (texto && !texto.includes('BEGIN')) {
    try { const d = atob(texto.replace(/\s+/g, '')); if (d.includes('BEGIN')) texto = d } catch { /* no era base64 */ }
  }
  if (!texto) {
    const g = await leerGuardada(db)
    if (!g) return null
    texto = await decField(g.privadaEnc)
  }
  if (texto.includes('BEGIN RSA PRIVATE KEY')) {
    // PKCS#1 (lo que da `openssl genrsa`): Web Crypto solo importa PKCS#8.
    throw new Error('La llave de Coinsenda está en formato PKCS#1; hace falta PKCS#8 ("BEGIN PRIVATE KEY").')
  }
  return crypto.subtle.importKey('pkcs8', derDePem(texto), ALG, false, ['sign'])
}

/** Firma un JWT RS256. Los datos del token los pone quien llama, según la
 *  documentación de Autenticación de Coinsenda. */
export async function firmarJwtRS256(llave: CryptoKey, payload: Record<string, unknown>, cabecera: Record<string, unknown> = {}): Promise<string> {
  const parte = (o: Record<string, unknown>) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const cuerpo = `${parte({ alg: 'RS256', typ: 'JWT', ...cabecera })}.${parte(payload)}`
  const firma = await crypto.subtle.sign(ALG.name, llave, new TextEncoder().encode(cuerpo))
  return `${cuerpo}.${b64url(firma)}`
}
