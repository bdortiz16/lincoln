// ════════════════════════════════════════════════════════════════════
// field-crypto.ts — cifrado de campos sensibles, UNA sola vez.
//
// POR QUÉ EXISTE ESTE ARCHIVO:
// Esta lógica vivía copiada en admin-data, gasfree y mouv-proxy. Al
// cambiar el formato de guardado (se le agregó una huella de llave) se
// actualizó una copia y las otras dos se quedaron entendiendo solo el
// formato viejo: devolvían el TEXTO CIFRADO como si fuera el secreto y la
// verificación del 2FA fallaba siempre, con el código correcto. Nada lo
// detectó — ni el build ni el verificador de tipos — porque cada copia
// era, por sí sola, código válido.
//
// La única forma de que eso no se repita es que haya UNA implementación.
// Si mañana hay que cambiar el formato, se cambia aquí y las tres
// funciones quedan al día por construcción.
//
// FORMATOS QUE SE LEEN (en este orden):
//   'enc:v2:<huella>:<datos>'  ← el que se escribe hoy
//   'enc:v1:<datos>'           ← anterior, sin huella
//   cualquier otra cosa        ← texto plano heredado, se devuelve igual
//
// La HUELLA son 8 hex derivados de la misma llave. No revela nada (es un
// hash truncado) y permite saber al instante si un dato quedó cifrado con
// una llave DISTINTA a la actual, en vez de descubrirlo cuando alguien ya
// no puede entrar.
// ════════════════════════════════════════════════════════════════════

export const FIELD_ENC_KEY = Deno.env.get('FIELD_ENC_KEY') ?? ''

let _keyPromise: Promise<CryptoKey> | null = null
function fieldKey(): Promise<CryptoKey> {
  if (!_keyPromise) {
    _keyPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(FIELD_ENC_KEY))
      .then(raw => crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']))
  }
  return _keyPromise
}

let _fpPromise: Promise<string> | null = null
export function keyFp(): Promise<string> {
  if (!_fpPromise) {
    _fpPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode('fp:' + FIELD_ENC_KEY))
      .then(raw => Array.from(new Uint8Array(raw).slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(''))
  }
  return _fpPromise
}

/** El dato está cifrado con una llave distinta a la actual. */
export class KeyMismatchError extends Error {
  constructor() { super('key_mismatch') }
}

/**
 * Cifra un valor. SIN llave NO cifra ni devuelve nada: lanza. Antes
 * devolvía el texto plano en silencio, que es peor que fallar — se
 * guardaban secretos en claro sin que nadie se enterara.
 */
export async function encField(plain: string): Promise<string> {
  if (!plain) return plain
  if (!FIELD_ENC_KEY) throw new Error('FIELD_ENC_KEY missing')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await fieldKey(), new TextEncoder().encode(plain)))
  const buf = new Uint8Array(iv.length + ct.length)
  buf.set(iv); buf.set(ct, iv.length)
  return `enc:v2:${await keyFp()}:` + btoa(String.fromCharCode(...buf))
}

/**
 * Descifra un valor guardado en cualquiera de los formatos. Lanza
 * KeyMismatchError si la huella no corresponde a la llave actual — así
 * "no se puede leer" se distingue de "el código está mal", que es la
 * diferencia entre reactivar el 2FA y volver a intentarlo.
 */
export async function decField(v: string): Promise<string> {
  if (typeof v !== 'string' || !v.startsWith('enc:v')) return v   // texto plano heredado
  if (!FIELD_ENC_KEY) throw new Error('FIELD_ENC_KEY missing')
  let payload: string
  if (v.startsWith('enc:v2:')) {
    const rest = v.slice(7)
    const sep = rest.indexOf(':')
    if (sep < 0) throw new Error('bad_ciphertext')
    if (rest.slice(0, sep) !== await keyFp()) throw new KeyMismatchError()
    payload = rest.slice(sep + 1)
  } else if (v.startsWith('enc:v1:')) {
    payload = v.slice(7)
  } else {
    throw new Error('bad_ciphertext')
  }
  const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await fieldKey(), bytes.slice(12))
  return new TextDecoder().decode(pt)
}
