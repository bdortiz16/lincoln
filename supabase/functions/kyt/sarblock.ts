// ════════════════════════════════════════════════════════
// Sarblock — análisis de wallets (docs.sarblock.com/reference/wallets)
//
// POR QUÉ ESTÁ ACÁ
//   23 nov 2026: el dueño pasó el KYT de wallets a Sarblock. MistTrack cobra
//   cada llamada y una consulta nuestra hacía entre 4 y 6 (puntaje,
//   etiquetas, resumen, perfil, contrapartes; el reporte, tres más). Un
//   análisis de Sarblock cuesta 1 crédito, y repetir la misma dirección
//   dentro de 24 h devuelve el mismo análisis sin cobrar (reused: true).
//   Queda "híbrido": Sarblock para EVM y TRON; MistTrack solo para las redes
//   que Sarblock no analiza (BTC, SOL, TON…) y para el análisis profundo que
//   alguien pide a propósito (rutas por saltos, contrapartes).
//
// EL CONTRATO (de su documentación)
//   POST /wallets/analyses   { address, network?, force? } → 202
//                            { id, walletId, status, reused }. COBRA 1 crédito.
//   GET  /wallets/analyses/:id → el análisis; `result` solo con COMPLETE.
//   Es asíncrono siempre: se pide y se lee hasta COMPLETE o FAILED. La
//   lectura es la fuente de verdad. Límite de la llave: 60 peticiones/min.
//   Errores con la forma { statusCode, type, message }.
//
// El fetch se inyecta para probar sin red y sin gastar créditos.
// ════════════════════════════════════════════════════════

export const SARBLOCK_URL = 'https://api.sarblock.com/api/org/v1'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class ErrorSarblock extends Error {
  constructor(
    public status: number,
    public tipo: string,
    mensaje: string,
    public retryAfter: number | null = null,
  ) { super(mensaje) }
}

// ── Redes ─────────────────────────────────────────────────────────
// El padrón usa los códigos de MistTrack (TRX, BNB, MATIC…); Sarblock los
// suyos. Sarblock analiza igual todas las redes de la familia (EVM o TRON);
// la red que se manda es la principal. Lo que no está acá (BTC, SOL, TON,
// LTC, DOGE…) Sarblock no lo analiza y sigue yendo a MistTrack.
export const RED_SARBLOCK: Record<string, string> = {
  ETH: 'ETH', TRX: 'TRON', BNB: 'BSC', BASE: 'BASE', ARB: 'ARBITRUM',
  MATIC: 'POLYGON', AVAX: 'AVALANCHE', OP: 'OPTIMISM',
}
export const redSarblock = (coin: string): string | null =>
  RED_SARBLOCK[String(coin ?? '').trim().toUpperCase()] ?? null

// ── Llamadas ──────────────────────────────────────────────────────
async function llamar(
  f: Fetch, key: string, metodo: 'GET' | 'POST', ruta: string,
  cuerpo?: unknown, idempotencia?: string,
): Promise<{ datos: any; texto: string }> {
  const ctrl = new AbortController()
  const reloj = setTimeout(() => ctrl.abort(), 20000)
  let r: Response
  try {
    r = await f(`${SARBLOCK_URL}${ruta}`, {
      method: metodo,
      signal: ctrl.signal,
      headers: {
        'x-api-key': key,
        Accept: 'application/json',
        ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencia ? { 'idempotency-key': idempotencia.slice(0, 200) } : {}),
      },
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    })
  } finally { clearTimeout(reloj) }
  const texto = await r.text()
  let datos: any = null
  try { datos = texto ? JSON.parse(texto) : null } catch { /* cuerpo no JSON */ }
  if (!r.ok) {
    const ra = Number(r.headers.get('retry-after'))
    throw new ErrorSarblock(
      r.status,
      String(datos?.type ?? `HTTP_${r.status}`),
      String(datos?.message ?? (texto.slice(0, 200) || `Sarblock respondió ${r.status}`)),
      Number.isFinite(ra) && ra > 0 ? ra : null,
    )
  }
  return { datos, texto }
}

// Encola el análisis. COBRA 1 crédito, salvo que devuelva uno que ya existía
// (de las últimas 24 h, uno en curso o la misma idempotency-key): reused.
export async function pedirAnalisis(
  f: Fetch, key: string,
  d: { address: string; network: string; force?: boolean; idempotencia: string },
): Promise<{ id: string; walletId: string | null; status: string; reused: boolean }> {
  const { datos } = await llamar(f, key, 'POST', '/wallets/analyses', {
    address: d.address, network: d.network, ...(d.force ? { force: true } : {}),
  }, d.idempotencia)
  if (!datos?.id) throw new ErrorSarblock(0, 'RESPUESTA_INVALIDA', 'Sarblock no devolvió el id del análisis.')
  return { id: String(datos.id), walletId: datos.walletId ?? null, status: String(datos.status ?? 'QUEUED'), reused: datos.reused === true }
}

// Lee el análisis. Gratis. Devuelve también el texto TAL CUAL llegó: es lo
// que se archiva como respaldo (re-serializarlo cambiaría la huella).
export async function leerAnalisis(f: Fetch, key: string, id: string): Promise<{ analisis: any; texto: string }> {
  const { datos, texto } = await llamar(f, key, 'GET', `/wallets/analyses/${encodeURIComponent(id)}`)
  return { analisis: datos, texto }
}

export const terminado = (a: any) => a?.status === 'COMPLETE' || a?.status === 'FAILED'

// Pide y espera el resultado, sondeando como pide la documentación (2–5 s,
// por debajo de 60 por minuto). Si no termina en `esperaMs`, vuelve con el
// análisis en curso: pedirlo otra vez es gratis (devuelve el mismo).
export async function analizarYEsperar(
  f: Fetch, key: string,
  d: { address: string; network: string; force?: boolean; idempotencia: string },
  esperaMs = 25000,
  dormir: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms)),
): Promise<{ pedido: { id: string; walletId: string | null; reused: boolean }; analisis: any; texto: string; enCurso: boolean }> {
  const pedido = await pedirAnalisis(f, key, d)
  const pasos = [1500, 2000, 3000, 3000, 4000, 5000, 5000, 5000]
  let gastado = 0
  let ultimo = await leerAnalisis(f, key, pedido.id)
  for (const p of pasos) {
    if (terminado(ultimo.analisis) || gastado + p > esperaMs) break
    await dormir(p)
    gastado += p
    ultimo = await leerAnalisis(f, key, pedido.id)
  }
  return {
    pedido: { id: pedido.id, walletId: pedido.walletId ?? ultimo.analisis?.walletId ?? null, reused: pedido.reused },
    analisis: ultimo.analisis, texto: ultimo.texto, enCurso: !terminado(ultimo.analisis),
  }
}

// ── Lectura del resultado ─────────────────────────────────────────
// Lo que la función kyt necesita, sacado de un análisis COMPLETE. Se guarda
// en el padrón (respuesta_cruda.analisis) y se rearma de ahí: no hay una
// segunda copia que pueda quedar distinta.
export type SenalSarblock = {
  code: string; severity: string | null; network: string | null
  category: string | null; entity: string | null; exposureUsd: number | null
}
export type ResultadoSarblock = {
  proveedor: 'sarblock'
  analisisId: string; walletId: string | null
  address: string | null; family: string | null; network: string | null
  requestedAt: string | null; completedAt: string | null
  recomendacion: string | null      // CLEAR | MONITOR | REVIEW | BLOCK
  riskLevel: string | null          // NONE | LOW | MEDIUM | HIGH | CRITICAL
  score: { value: number | null; level: string | null; floor: number | null; confidence: string | null }
  degraded: boolean
  senales: SenalSarblock[]
  chequeos: { total: number | null; clean: number | null; flagged: string[] }
  exposicion: { exchangeSharePct: number | null; attributedEntity: string | null }
  redesActivas: string[]
  sancionada: boolean
}

const num = (v: any): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v)
const txt = (v: any): string | null => (typeof v === 'string' && v.trim()) ? v.trim() : null

export function leerResultado(a: any): ResultadoSarblock | null {
  if (!a || a.status !== 'COMPLETE' || !a.result) return null
  const r = a.result
  const senales: SenalSarblock[] = (Array.isArray(r.signals) ? r.signals : []).map((s: any) => ({
    code: String(s?.code ?? '').trim() || 'SIN_CODIGO',
    severity: txt(s?.severity), network: txt(s?.network), category: txt(s?.category),
    entity: txt(s?.entity), exposureUsd: num(s?.exposureUsd),
  }))
  return {
    proveedor: 'sarblock',
    analisisId: String(a.id), walletId: txt(a.walletId),
    address: txt(a.address), family: txt(a.family), network: txt(a.network),
    requestedAt: txt(a.requestedAt), completedAt: txt(a.completedAt),
    recomendacion: txt(r.recommendation), riskLevel: txt(r.riskLevel),
    score: {
      value: num(r.score?.value), level: txt(r.score?.level),
      floor: num(r.score?.floor), confidence: txt(r.score?.confidence),
    },
    degraded: r.degraded === true,
    senales,
    chequeos: {
      total: num(r.checks?.total), clean: num(r.checks?.clean),
      flagged: Array.isArray(r.checks?.flagged) ? r.checks.flagged.map((x: any) => String(x)) : [],
    },
    exposicion: { exchangeSharePct: num(r.exposure?.exchangeSharePct), attributedEntity: txt(r.exposure?.attributedEntity) },
    redesActivas: Array.isArray(r.activeNetworks) ? r.activeNetworks.map((x: any) => String(x)) : [],
    // Sancionada solo si una señal lo dice. El piso de 90 NO alcanza: según
    // la documentación lo fija "una sanción o un congelamiento", y decir
    // "sancionada" de una wallet congelada sería afirmar algo que no se sabe.
    sancionada: senales.some(s => /SANCTION/i.test(s.code) || /SANCTION/i.test(s.category ?? '')),
  }
}

// Por qué falló un análisis o una llamada, en palabras para Cumplimiento.
export function motivoSarblock(e: unknown): { codigo: string; mensaje: string; referencia: string | null } {
  const m = motivoBase(e)
  // La referencia es el estado y el tipo tal cual los devolvió (ej.
  // "403 · FORBIDDEN"): sirve para saber por qué sin nombrar al proveedor.
  const referencia = e instanceof ErrorSarblock ? `${e.status || 'sin estado'} · ${e.tipo}` : 'sin respuesta'
  return { ...m, referencia }
}
function motivoBase(e: unknown): { codigo: string; mensaje: string } {
  if (e instanceof ErrorSarblock) {
    if (e.status === 402) return { codigo: 'sin_creditos', mensaje: 'Sarblock no tiene créditos de análisis disponibles (402).' }
    if (e.status === 401 || e.status === 403) return { codigo: 'llave', mensaje: `La llave de Sarblock no está autorizada para analizar wallets (${e.status}): revisa que tenga los permisos wallets:analyze y wallets:read.` }
    if (e.status === 429) return { codigo: 'limite', mensaje: 'Sarblock pidió esperar: se alcanzó el límite de consultas por minuto (429).' }
    if (e.status === 400) return { codigo: 'rechazada', mensaje: `Sarblock rechazó la dirección: ${e.message}` }
    return { codigo: 'error', mensaje: `Sarblock respondió ${e.status || 'sin estado'}: ${e.message}` }
  }
  return { codigo: 'red', mensaje: `No se pudo hablar con Sarblock: ${String((e as Error)?.message ?? e).slice(0, 160)}` }
}

// Clave de idempotencia: un reintento tras un corte de red no cobra otro
// análisis. Una por red, dirección y día; con `force` lleva la hora, porque
// la misma clave devolvería el análisis viejo en vez de pedir uno nuevo.
export function claveAnalisis(coin: string, address: string, force = false, ahora = new Date()): string {
  const base = `kyt-${String(coin).toUpperCase()}-${String(address).trim().toLowerCase()}-${ahora.toISOString().slice(0, 10)}`
  return force ? `${base}-f${ahora.getTime()}` : base
}

// ── Probar la llave sin gastar créditos ───────────────────────────
// 23 nov: la primera consulta real dio "no habilitado" (401/403): la llave
// sirve para el screening de beneficiarios pero no tenía permiso de wallets.
// Esto lo dice desde el panel sin pagar un análisis:
//   · GET /wallets?limit=1 → si hay permiso de lectura (wallets:read). Gratis.
//   · GET /me              → los permisos de la llave, si los informa.
//   · GET /usage           → los créditos que quedan, si los informa.
// wallets:analyze no se puede probar sin cobrar un análisis: se lee de /me.
export async function probarLlave(f: Fetch, key: string): Promise<{
  lectura: { ok: boolean; status: number; tipo: string | null; mensaje: string }
  permisos: string[] | null
  analizar: boolean | null
  creditos: number | null
}> {
  let lectura: { ok: boolean; status: number; tipo: string | null; mensaje: string }
  try {
    await llamar(f, key, 'GET', '/wallets?limit=1')
    lectura = { ok: true, status: 200, tipo: null, mensaje: 'La llave puede leer wallets (wallets:read).' }
  } catch (e) {
    const x = e as ErrorSarblock
    lectura = { ok: false, status: x?.status ?? 0, tipo: x?.tipo ?? null, mensaje: motivoSarblock(e).mensaje }
  }
  let permisos: string[] | null = null
  try {
    const { datos } = await llamar(f, key, 'GET', '/me')
    // La forma de /me no está en la página de wallets: se buscan los nombres
    // que suelen traer los permisos, sin suponer uno.
    const cand = [datos?.permissions, datos?.scopes, datos?.key?.permissions, datos?.key?.scopes, datos?.apiKey?.permissions, datos?.apiKey?.scopes]
    const lista = cand.find(v => Array.isArray(v))
    if (lista) permisos = (lista as any[]).map(v => String(typeof v === 'string' ? v : (v?.name ?? v?.scope ?? JSON.stringify(v))))
  } catch { /* sin /me: se dice "no se sabe" */ }
  let creditos: number | null = null
  try {
    const { datos } = await llamar(f, key, 'GET', '/usage')
    const n = Number(datos?.wallets?.totalRemaining ?? datos?.screening?.totalRemaining ?? datos?.credits?.totalRemaining)
    creditos = Number.isFinite(n) ? n : null
  } catch { /* sin /usage */ }
  const analizar = permisos ? permisos.some(p => /wallets:analy[sz]e|wallets:\*|^\*$/i.test(p)) : null
  return { lectura, permisos, analizar, creditos }
}
