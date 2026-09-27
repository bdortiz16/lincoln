// ── Domicilio de una empresa por NIT ────────────────────────────────────
// La DIAN exige el país (y Siigo la ciudad) del tercero, y una empresa no
// tiene "lugar de expedición". Su ciudad es el domicilio con que se
// matriculó en la Cámara de Comercio, que está en el RUES (Registro Único
// Empresarial y Social, de Confecámaras). Dos fuentes, en orden:
//
//   1. Datos Abiertos Colombia: extracto del RUES publicado por Confecámaras
//      (recurso c82u-588k), consultable por NIT sin credencial. Puede estar
//      desactualizado (no se actualiza seguido), pero para el domicilio de
//      una empresa registrada alcanza.
//   2. El buscador del portal RUES (elasticprd.rues.org.co): pide el cuerpo
//      cifrado con AES en el formato de CryptoJS (OpenSSL "Salted__", clave
//      derivada con MD5), con la clave que usa el propio portal. Si el
//      portal cambia la clave o el formato, esta fuente deja de responder y
//      se dice; no se adivina.
//
// Nada se inventa: si ninguna fuente trae el municipio, se devuelve null
// con el diagnóstico de qué contestó cada una.

import { municipioPorNombre, municipioPorCodigo, type Municipio } from './municipios.ts'

export type DomicilioEmpresa = {
  fuente: 'datos.gov.co' | 'rues'
  razonSocial: string | null
  municipio: Municipio | null
  municipioTexto: string | null
  departamentoTexto: string | null
  direccion: string | null
  camara: string | null
  matricula: string | null
  estado: string | null
}

const CLAVE_RUES = 'ac1244b5-8bee-47b2-a4a5-924a748d907f'

// ── MD5 (para derivar la clave como OpenSSL/CryptoJS) ───────────────────
// WebCrypto no trae MD5; esta es la implementación de referencia (RFC 1321),
// compacta, solo para EVP_BytesToKey.
function md5(bytes: Uint8Array): Uint8Array {
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const len = bytes.length
  const padLen = (((len + 8) >> 6) + 1) << 6
  const msg = new Uint8Array(padLen)
  msg.set(bytes)
  msg[len] = 0x80
  const bits = len * 8
  msg[padLen - 8] = bits & 0xff; msg[padLen - 7] = (bits >>> 8) & 0xff; msg[padLen - 6] = (bits >>> 16) & 0xff; msg[padLen - 5] = (bits >>> 24) & 0xff
  msg[padLen - 4] = Math.floor(bits / 2 ** 32) & 0xff
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const M = new Uint32Array(16)
  const rotl = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) >>> 0
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = msg[off + i * 4] | (msg[off + i * 4 + 1] << 8) | (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24)
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D; D = C; C = B
      B = (B + rotl(F, S[i])) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  for (const [i, v] of [a0, b0, c0, d0].entries()) { out[i * 4] = v & 0xff; out[i * 4 + 1] = (v >>> 8) & 0xff; out[i * 4 + 2] = (v >>> 16) & 0xff; out[i * 4 + 3] = (v >>> 24) & 0xff }
  return out
}

// OpenSSL EVP_BytesToKey con MD5, sin iteraciones: es lo que hace CryptoJS
// cuando se le pasa una contraseña (no una clave) a AES.encrypt.
function evpBytesToKey(pass: Uint8Array, salt: Uint8Array, keyLen: number, ivLen: number): { key: Uint8Array; iv: Uint8Array } {
  const total = keyLen + ivLen
  const out = new Uint8Array(total)
  let prev = new Uint8Array(0)
  let n = 0
  while (n < total) {
    const entrada = new Uint8Array(prev.length + pass.length + salt.length)
    entrada.set(prev); entrada.set(pass, prev.length); entrada.set(salt, prev.length + pass.length)
    prev = md5(entrada)
    out.set(prev.subarray(0, Math.min(16, total - n)), n)
    n += 16
  }
  return { key: out.subarray(0, keyLen), iv: out.subarray(keyLen, total) }
}

const b64enc = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const b64dec = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

// CryptoJS.AES.encrypt(texto, contraseña).toString(): base64 de
// "Salted__" + sal(8) + AES-256-CBC(PKCS7).
export async function cifrarComoCryptoJS(texto: string, contrasena: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(8))
  const { key, iv } = evpBytesToKey(new TextEncoder().encode(contrasena), salt, 32, 16)
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, new TextEncoder().encode(texto)))
  const out = new Uint8Array(16 + ct.length)
  out.set(new TextEncoder().encode('Salted__')); out.set(salt, 8); out.set(ct, 16)
  return b64enc(out)
}

export async function descifrarComoCryptoJS(b64: string, contrasena: string): Promise<string | null> {
  try {
    const raw = b64dec(b64.replace(/\s+/g, ''))
    if (new TextDecoder().decode(raw.subarray(0, 8)) !== 'Salted__') return null
    const salt = raw.subarray(8, 16)
    const { key, iv } = evpBytesToKey(new TextEncoder().encode(contrasena), salt, 32, 16)
    const k = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt'])
    const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, k, raw.subarray(16))
    return new TextDecoder().decode(pt)
  } catch { return null }
}

// ── Leer municipio/departamento/dirección de un registro cualquiera ────
// Las dos fuentes nombran los campos distinto (y no hay documentación
// estable), así que se busca por lo que la clave dice, no por un nombre
// fijo. Se prefiere una clave exacta a una parcial.
function campo(reg: Record<string, unknown>, patrones: RegExp[]): string | null {
  const entradas = Object.entries(reg)
  for (const p of patrones) {
    const hit = entradas.find(([k, v]) => p.test(k) && typeof v === 'string' && v.trim())
    if (hit) return String(hit[1]).trim()
  }
  return null
}
function normalizarRegistro(reg: Record<string, unknown>, fuente: DomicilioEmpresa['fuente']): DomicilioEmpresa {
  const muniTxt = campo(reg, [/^(nom_?)?municipio(_comercial)?$/i, /^ciudad(_comercial)?$/i, /municipio|ciudad/i])
  const deptoTxt = campo(reg, [/^(nom_?)?departamento(_comercial)?$/i, /^dpto/i, /departamento|dpto/i])
  const codMuni = campo(reg, [/^cod(igo)?_?(dane_?)?(municipio|mpio|ciudad)/i, /^(municipio|mpio)_?(codigo|cod)$/i])
  const muni = (codMuni && /^\d{5}$/.test(codMuni.replace(/\D/g, '')) ? municipioPorCodigo(codMuni.replace(/\D/g, '')) : null)
    ?? (muniTxt ? municipioPorNombre(deptoTxt ? `${muniTxt} - ${deptoTxt}` : muniTxt) : null)
  return {
    fuente,
    razonSocial: campo(reg, [/^razon_?social$/i, /^nombre(_empresa)?$/i, /razon|nombre/i]),
    municipio: muni, municipioTexto: muniTxt, departamentoTexto: deptoTxt,
    direccion: campo(reg, [/^dir(eccion)?_?comercial$/i, /^direccion$/i, /direcc|^dir_/i]),
    camara: campo(reg, [/camara/i]),
    matricula: campo(reg, [/^(num_?|numero_?)?matricula$/i, /^matricula/i]),
    estado: campo(reg, [/^estado(_matricula)?$/i, /estado/i]),
  }
}

async function conTiempo(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...init, signal: ctrl.signal }) } finally { clearTimeout(t) }
}

// 1. Datos Abiertos (Socrata). El NIT va sin dígito de verificación.
async function datosAbiertos(nit: string): Promise<{ ok: true; d: DomicilioEmpresa; crudo: string } | { ok: false; motivo: string }> {
  const r = await conTiempo(`https://www.datos.gov.co/resource/c82u-588k.json?nit=${encodeURIComponent(nit)}&$limit=5`, { headers: { Accept: 'application/json' } }).catch(e => ({ ok: false, status: 0, text: async () => String((e as Error)?.message ?? e) }) as unknown as Response)
  const texto = await r.text().catch(() => '')
  if (!r.ok) return { ok: false, motivo: `HTTP ${r.status}${texto ? `: ${texto.slice(0, 160)}` : ''}` }
  let lista: unknown
  try { lista = JSON.parse(texto) } catch { return { ok: false, motivo: `respuesta no es JSON: ${texto.slice(0, 120)}` } }
  if (!Array.isArray(lista) || !lista.length) return { ok: false, motivo: 'sin registros para ese NIT' }
  // Si hay varios (sucursales), el que tenga matrícula activa primero.
  const regs = lista.filter(x => x && typeof x === 'object') as Record<string, unknown>[]
  const activo = regs.find(x => /activ/i.test(String(campo(x, [/estado/i]) ?? ''))) ?? regs[0]
  return { ok: true, d: normalizarRegistro(activo, 'datos.gov.co'), crudo: JSON.stringify(activo).slice(0, 1200) }
}

// 2. El buscador del portal RUES, con el cuerpo cifrado como lo cifra el
//    propio front. La respuesta puede venir en claro o cifrada igual.
async function portalRUES(nit: string): Promise<{ ok: true; d: DomicilioEmpresa; crudo: string } | { ok: false; motivo: string }> {
  const dataBody = await cifrarComoCryptoJS(JSON.stringify({ nit }), CLAVE_RUES)
  const r = await conTiempo('https://elasticprd.rues.org.co/api/ConsultasRUES/BusquedaAvanzadaRM', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://www.rues.org.co', Referer: 'https://www.rues.org.co/' },
    body: JSON.stringify({ dataBody }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String((e as Error)?.message ?? e) }) as unknown as Response)
  const texto = await r.text().catch(() => '')
  if (!r.ok) return { ok: false, motivo: `HTTP ${r.status}${texto ? `: ${texto.slice(0, 160)}` : ''}` }
  let cuerpo: unknown = null
  try { cuerpo = JSON.parse(texto) } catch { cuerpo = texto }
  // Cifrada: un string base64 (en la raíz o en un campo) que empieza por
  // "Salted__" en base64 (U2FsdGVkX1).
  const candidatos: string[] = []
  const buscarCifrado = (x: unknown, prof = 0) => {
    if (prof > 4) return
    if (typeof x === 'string' && x.startsWith('U2FsdGVkX1')) candidatos.push(x)
    else if (x && typeof x === 'object') for (const v of Object.values(x as Record<string, unknown>)) buscarCifrado(v, prof + 1)
  }
  buscarCifrado(cuerpo)
  for (const c of candidatos) {
    const claro = await descifrarComoCryptoJS(c, CLAVE_RUES)
    if (claro) { try { cuerpo = JSON.parse(claro) } catch { cuerpo = claro } ; break }
  }
  // El registro: el primer objeto con algo que parezca NIT/razón social,
  // esté en la raíz, en "registros", "data", "hits"…
  let reg: Record<string, unknown> | null = null
  const buscarReg = (x: unknown, prof = 0) => {
    if (reg || prof > 5 || !x || typeof x !== 'object') return
    if (Array.isArray(x)) { for (const v of x) buscarReg(v, prof + 1); return }
    const o = x as Record<string, unknown>
    const claves = Object.keys(o).join(' ')
    if (/razon|nit|matricula/i.test(claves) && /munic|ciudad|dpto|depart/i.test(claves)) { reg = o; return }
    for (const v of Object.values(o)) buscarReg(v, prof + 1)
  }
  buscarReg(cuerpo)
  if (!reg) return { ok: false, motivo: `respondió sin registro reconocible: ${(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)).slice(0, 300)}` }
  return { ok: true, d: normalizarRegistro(reg, 'rues'), crudo: JSON.stringify(reg).slice(0, 1200) }
}

export async function domicilioEmpresa(nitConOSinDv: string): Promise<{ domicilio: DomicilioEmpresa | null; diagnostico: string; crudo: string | null }> {
  const digitos = String(nitConOSinDv ?? '').replace(/\D/g, '')
  const nit = digitos.length === 10 ? digitos.slice(0, 9) : digitos
  if (nit.length < 8) return { domicilio: null, diagnostico: 'NIT inválido.', crudo: null }
  const notas: string[] = []
  for (const [nombre, fn] of [['datos.gov.co', datosAbiertos], ['portal RUES', portalRUES]] as const) {
    try {
      const r = await fn(nit)
      if (r.ok) {
        if (r.d.municipio) return { domicilio: r.d, diagnostico: `${nombre}: ${r.d.municipio.nombre}, ${r.d.municipio.deptoNombre}${r.d.razonSocial ? ` (${r.d.razonSocial})` : ''}.`, crudo: r.crudo }
        notas.push(`${nombre}: trajo el registro${r.d.razonSocial ? ` de ${r.d.razonSocial}` : ''} pero sin un municipio reconocible (municipio «${r.d.municipioTexto ?? ''}», departamento «${r.d.departamentoTexto ?? ''}»). Registro: ${r.crudo.slice(0, 500)}`)
      } else notas.push(`${nombre}: ${r.motivo}`)
    } catch (e) { notas.push(`${nombre}: ${(e as Error)?.message ?? e}`) }
  }
  return { domicilio: null, diagnostico: notas.join(' ‖ '), crudo: null }
}
