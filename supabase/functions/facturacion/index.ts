// ══════════════════════════════════════════════════════════════════
//  facturacion — la conexión de cada cliente con SU Siigo, y la factura
//  que se emite sola cuando una operación se completa.
//
//  QUIÉN FACTURA A QUIÉN
//    El cliente de Lincoin (una empresa) conecta su propia cuenta de Siigo.
//    Cuando le entra plata —un depósito, un pago recibido— Lincoin emite en
//    SU Siigo la factura de venta correspondiente, a la contraparte si la
//    operación trae documento, o al "consumidor final" que el cliente
//    configuró si no. Lincoin no factura nada acá: solo opera el Siigo del
//    cliente con las credenciales que el cliente puso.
//
//  LAS CREDENCIALES
//    El access_key se guarda cifrado con field-crypto y NUNCA vuelve a la
//    pantalla. La pantalla ve "hay una guardada" y "la última prueba fue el
//    …". Se descifra solo acá, para hablar con Siigo.
//
//  NADA SE ADIVINA
//    Una factura en Siigo necesita ids que solo existen en la cuenta del
//    cliente: tipo de documento, vendedor, forma de pago, producto. "Probar
//    conexión" los trae y el cliente elige. Si Siigo rechaza algo, el error
//    se guarda TEXTUAL y se muestra: "no se pudo" no le sirve a nadie;
//    "customer: identification is required" sí.
//
//  CONTRATO DE SIIGO (api.siigo.com, documentación pública):
//    POST /auth                          { username, access_key } + Partner-Id
//    GET  /v1/document-types?type=FV     tipos de factura de venta
//    GET  /v1/users                      vendedores
//    GET  /v1/payment-types?document_type=FV
//    GET  /v1/products                   productos/servicios
//    GET  /v1/customers?identification=  ¿existe la contraparte?
//    POST /v1/customers                  crearla
//    POST /v1/invoices                   FACTURA DE VENTA (stamp = DIAN, mail = correo)
//    GET  /v1/document-types?type=DS|FC  tipos de documento soporte / compra
//    GET  /v1/payment-types?document_type=FC
//    GET  /v1/taxes                      impuestos, para los ítems
//    POST /v1/purchases                  DOCUMENTO SOPORTE (compra a no obligado a facturar)
//  Los ids de esos catálogos son de CADA cuenta: no hay valores por defecto.
//
//  QUÉ SALE POR CADA OPERACIÓN
//    `documentos` = { tipoDeOperacion: 'FV' | 'DS' }. Plata que ENTRA → factura
//    de venta a quien pagó. Plata que SALE a alguien que no factura → documento
//    soporte a quien se le pagó. Lo decide el cliente, por tipo de operación.
//    `items` = las líneas del documento, con el valor calculado a partir del
//    monto de la operación (todo, un porcentaje, o un valor fijo).
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encField, decField, KeyMismatchError } from '../_shared/field-crypto.ts'
import { municipioPorCodigo, municipioPorNombre, lugarFueraDeColombia } from '../_shared/municipios.ts'
import { domicilioEmpresa } from '../_shared/rues.ts'
import { traeSecretoDeLaBase } from '../_shared/webhook-auth.ts'
import { liquidacionDe, type Liquidacion } from '../_shared/liquidacion-lincoin.ts'
import { mergeRaw } from '../_shared/raw-data.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SIIGO = 'https://api.siigo.com'
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Los motivos de un envío (los que se preguntan al confirmar). Por motivo se
// decide si sale documento soporte y con qué ítem. Copia de lib/motivosEnvio.ts.
const MOTIVOS_ENVIO: Record<string, string> = {
  proveedores: 'Pago a proveedores', servicios: 'Pago de servicios', nomina: 'Pago de nómina',
  gastos: 'Gastos generales', compensacion: 'Transferencia a mi cuenta de compensación', otro: 'Otro',
}

// Tipos de operación que pueden generar factura, con su nombre en pantalla.
export const DISPARADORES: Record<string, string> = {
  load: 'Depósitos', pay_received: 'Pagos recibidos', otc_deposit: 'Depósitos OTC',
  dispersion: 'Envíos a beneficiarios', send: 'Retiros', pay_sent: 'Pagos enviados', convert: 'Conversiones',
}

async function quienLlama(req: Request): Promise<{ userId: string | null; servicio: boolean }> {
  // El cron de la base (facturas_al_dia) se identifica con la clave que ella
  // misma generó (private_config 'aviso_secret'), no con una llave copiada.
  if (await traeSecretoDeLaBase(req, db)) return { userId: null, servicio: true }
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { userId: null, servicio: false }
  if (SERVICE_KEY && jwt === SERVICE_KEY) return { userId: null, servicio: true }
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    return { userId: user?.id ?? null, servicio: false }
  } catch { return { userId: null, servicio: false } }
}

// ── Hablar con Siigo ──────────────────────────────────────────────
// Devuelve SIEMPRE qué pasó: estado HTTP y cuerpo. Un error tragado acá se
// convierte en "no se facturó" sin motivo, que es lo que se quiere evitar.
type Resp = { ok: boolean; status: number; data: any; texto: string }
// LÍMITE DE CONSULTAS DE SIIGO. Siigo contesta 429 «requests_limit · Rate
// limit is exceeded. Try again in N seconds» cuando se le pregunta mucho en
// poco tiempo. Con la emisión en lote se llegaba rápido (cada factura son
// varias consultas) y 36 facturas quedaron en error al buscar al cliente.
// Ahora se espera lo que Siigo pide y se reintenta una vez; mientras tanto,
// las demás consultas de esta instancia también esperan. Un 429 se rechaza
// antes de procesar nada, así que reintentar (incluso un POST) no duplica.
let siigoEsperarHasta = 0
const SIIGO_ESPERA_MAX_MS = 20_000
function esperaDe429(r: Resp, retryAfter: string | null): number {
  const m = /try again in\s*(\d+)\s*sec/i.exec(r.texto) ?? /(\d+)\s*seconds?/i.exec(String(retryAfter ?? ''))
  const seg = m ? Number(m[1]) : Number(retryAfter) || 15
  return Math.min(Math.max((seg + 1) * 1000, 2000), SIIGO_ESPERA_MAX_MS)
}
async function siigo(metodo: 'GET' | 'POST' | 'PUT', ruta: string, opts: { token?: string; partner?: string; body?: unknown; ms?: number }): Promise<Resp> {
  for (let intento = 0; ; intento++) {
    const espera = siigoEsperarHasta - Date.now()
    if (espera > 0) await new Promise(r => setTimeout(r, Math.min(espera, SIIGO_ESPERA_MAX_MS)))
    const { r, retryAfter } = await siigoUnaVez(metodo, ruta, opts)
    if (r.status !== 429 || intento >= 1) return r
    siigoEsperarHasta = Date.now() + esperaDe429(r, retryAfter)
  }
}
async function siigoUnaVez(metodo: 'GET' | 'POST' | 'PUT', ruta: string, opts: { token?: string; partner?: string; body?: unknown; ms?: number }): Promise<{ r: Resp; retryAfter: string | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (opts.partner) headers['Partner-Id'] = opts.partner
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  try {
    const ctrl = new AbortController()
    // Crear un documento (y más con envío a la DIAN) puede tardar bastante
    // más que una consulta: el que llama fija el tiempo cuando hace falta.
    const reloj = setTimeout(() => ctrl.abort(), opts.ms ?? 25000)
    const r = await fetch(`${SIIGO}${ruta}`, { method: metodo, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal })
    clearTimeout(reloj)
    const texto = await r.text().catch(() => '')
    let data: any = null
    try { data = texto ? JSON.parse(texto) : null } catch { data = null }
    return { r: { ok: r.ok, status: r.status, data, texto: texto.slice(0, 2000) }, retryAfter: r.headers.get('retry-after') }
  } catch (e) {
    return { r: { ok: false, status: 0, data: null, texto: (e as Error)?.message ?? 'red' }, retryAfter: null }
  }
}

// Lo ya confirmado en Siigo, mientras viva la instancia: que un cliente
// existe y el ítem (con su IVA). Ahorra consultas en los lotes.
const SIIGO_CACHE_CLIENTE_MS = 30 * 60_000
const SIIGO_CACHE_PRODUCTO_MS = 10 * 60_000
const clientesEnSiigo = new Map<string, number>()
const productosSiigo = new Map<string, { hasta: number; r: Resp }>()
const siigoVisto = (m: Map<string, number>, k: string) => (m.get(k) ?? 0) > Date.now()

const MSG_RESOLUCION_DIAN = 'La resolución de facturación de la DIAN del comprobante de Siigo venció o se le acabó el rango de numeración (Siigo: invalid_dian_resolution). No se creó ninguna factura. Hay que cargar la resolución nueva en Siigo (o elegir en Configuración otro comprobante de factura con resolución vigente) y después volver a emitir desde «Sin factura».'
const esErrorResolucion = (e: unknown) => /invalid_dian_resolution/i.test(String(e ?? ''))
// El comprobante de factura elegido no está habilitado en Siigo para
// mandarse a la DIAN (MEXITECH, 2026-10-30: «document_settings · The send
// cannot be used, you must verify the document settings · stamp.send»).
// Siigo no crea nada, y todas las que siguen fallan igual.
const MSG_COMPROBANTE_NO_ELECTRONICO = 'El comprobante de factura elegido en Configuración no está habilitado en tu Siigo para enviarse a la DIAN como factura electrónica (Siigo: document_settings · stamp.send). No se creó ninguna factura. En Configuración elige el comprobante de factura ELECTRÓNICA de tu Siigo (o habilita la facturación electrónica de ese comprobante en Siigo) y vuelve a emitir desde «Sin factura».'
const esErrorComprobante = (e: unknown) => /document_settings|habilitado en tu Siigo para enviarse a la DIAN/i.test(String(e ?? ''))

// El motivo de Siigo, en una línea legible.
function motivoDe(r: Resp): string {
  if (r.status === 0) return /abort/i.test(r.texto)
    ? 'Siigo no contestó a tiempo (se esperó más de un minuto). OJO: el documento puede haberse creado igual en Siigo. Antes de emitir de nuevo, revisá en Siigo Nube si ya existe, para no duplicarlo.'
    : `No se pudo llegar a Siigo: ${r.texto}`
  const d = r.data
  const errs = Array.isArray(d?.Errors) ? d.Errors : Array.isArray(d?.errors) ? d.errors : null
  // La resolución de facturación de la DIAN venció o se le acabó el rango de
  // numeración (XATECH, 2026-10-30, después de la FV-2-1000). No es de
  // Lincoin ni se arregla reintentando: se dice qué hacer, en español.
  if (errs?.some((e: any) => /invalid_dian_resolution/i.test(String(e?.Code ?? e?.code ?? '')))) return MSG_RESOLUCION_DIAN
  if (errs?.some((e: any) => /document_settings/i.test(String(e?.Code ?? e?.code ?? '')))) return MSG_COMPROBANTE_NO_ELECTRONICO
  if (errs?.length) return `HTTP ${r.status}: ${errs.map((e: any) => [e.Code ?? e.code, e.Message ?? e.message, e.Params?.join?.(',') ?? e.params?.join?.(',')].filter(Boolean).join(' · ')).join(' | ')}`.slice(0, 600)
  const m = d?.message ?? d?.Message ?? d?.error ?? d?.error_description
  return `HTTP ${r.status}${m ? `: ${String(m).slice(0, 400)}` : r.texto ? `: ${r.texto.slice(0, 300)}` : ''}`
}

// Token por cliente, mientras viva la instancia. Siigo lo da por 24 h.
const tokens = new Map<string, { token: string; hasta: number }>()
async function tokenDe(userId: string, cfg: any, forzar = false): Promise<{ token: string } | { error: string }> {
  const c = tokens.get(userId)
  if (!forzar && c && c.hasta > Date.now()) return { token: c.token }
  if (!cfg?.username || !cfg?.access_key_enc) return { error: 'Faltan las credenciales de Siigo (usuario y access key).' }
  let key: string
  try { key = await decField(cfg.access_key_enc) }
  catch (e) { return { error: e instanceof KeyMismatchError ? 'La access key quedó cifrada con otra llave. Volvé a guardarla.' : 'No se pudo leer la access key guardada.' } }
  const r = await siigo('POST', '/auth', { partner: cfg.partner_id || 'Lincoin', body: { username: cfg.username, access_key: key } })
  const token = r.data?.access_token
  if (!r.ok || !token) return { error: `Siigo no aceptó las credenciales — ${motivoDe(r)}` }
  const seg = Number(r.data?.expires_in) || 86400
  tokens.set(userId, { token, hasta: Date.now() + Math.max(60, seg - 120) * 1000 })
  return { token }
}

async function leerConfig(userId: string) {
  const { data } = await db.from('facturacion_config').select('*').eq('user_id', userId).maybeSingle()
  return (data as any) ?? null
}

// Lo que ve la pantalla: nunca la access key, ni pedazos de ella. Antes iba
// una "pista" (largo, primeros 4 y últimos 3 caracteres): siete caracteres de
// una credencial son siete menos por adivinar, y la veía cualquiera con
// acceso a la pantalla. Solo se dice si hay una guardada.
async function publica(cfg: any, resumen?: any) {
  if (!cfg) return { existe: false, activo: false, tieneAccessKey: false, disparadores: ['load', 'pay_received'], stamp: true, mail: true, crear_clientes: true, cliente_default_nit: '222222222222', cliente_default_nombre: 'Consumidor final', resumen }
  const { access_key_enc, ...resto } = cfg
  return { existe: true, ...resto, tieneAccessKey: !!access_key_enc, resumen }
}

async function resumenDe(userId: string) {
  const { data } = await db.from('comprobantes').select('factura_estado').eq('user_id', userId).limit(5000)
  const filas = (data ?? []) as any[]
  const n = (s: string) => filas.filter(f => f.factura_estado === s).length
  return { emitidas: n('emitida'), errores: n('error'), pendientes: n('pendiente'), omitidas: n('omitida'), comprobantes: filas.length }
}

// ¿Está llegando el aviso automático? Cada operación que se completa debe
// tener comprobante (lo crea notify-transaction al recibir el trigger de la
// base). Si las últimas completadas no lo tienen, el trigger no está
// llamando a la función, y sin eso nada se emite solo.
async function chequeoAutomatico(userId: string): Promise<{ sinComprobante: number; ultimos: number } | null> {
  try {
    const ids = (await completadasSinComprobante(userId)).sin.map(t => String(t.id))
    const { data: txs } = await db.from('transactions').select('id').eq('user_id', userId).eq('status', 'Completado')
      .in('type', Object.keys(DISPARADORES)).gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()).limit(20)
    return { sinComprobante: ids.length, ultimos: ((txs ?? []) as any[]).length }
  } catch { return null }
}

// Las operaciones completadas de los últimos 14 días que no tienen
// comprobante: son las que el aviso automático (trigger → notify-transaction)
// no alcanzó. El comprobante lo crea notify-transaction al completarse; si
// no está, nada más se disparó para esa operación.
async function completadasSinComprobante(userId: string): Promise<{ sin: any[] }> {
  const desde = new Date(Date.now() - 14 * 86400000).toISOString()
  const { data: txs } = await db.from('transactions').select('id, user_id, type, amount, currency, status, raw_data, created_at').eq('user_id', userId).eq('status', 'Completado')
    .in('type', Object.keys(DISPARADORES)).gte('created_at', desde).order('created_at', { ascending: false }).limit(20)
  const lista = (txs ?? []) as any[]
  if (!lista.length) return { sin: [] }
  const { data: comps } = await db.from('comprobantes').select('transaction_id').in('transaction_id', lista.map(t => String(t.id)))
  const con = new Set(((comps ?? []) as any[]).map(c => String(c.transaction_id)))
  return { sin: lista.filter(t => !con.has(String(t.id))) }
}

// El comprobante de una operación completada, creándolo si no existe (mismo
// formato que notify-transaction). Devuelve el folio.
async function asegurarComprobante(tx: any, userId: string): Promise<{ folio: number } | { error: string }> {
  const txId = String(tx.id)
  const { data: comp } = await db.from('comprobantes').select('folio').eq('transaction_id', txId).maybeSingle()
  if (comp) return { folio: Number((comp as any).folio) }
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const t = String(tx.type)
  const contraparte = (t === 'dispersion' || t === 'send') ? (rd.beneficiary ?? rd.bank ?? null)
    : t === 'pay_received' ? (rd.senderName ?? null) : t === 'pay_sent' ? (rd.recipientName ?? null)
      : t === 'load' ? (rd.method ?? rd.bank ?? null) : null
  const fila = {
    transaction_id: txId, user_id: userId, tipo: t, monto: String(tx.amount), moneda: tx.currency,
    contraparte, estado_al_emitir: tx.status,
    detalle: { id: txId, type: t, amount: tx.amount, currency: tx.currency, status: tx.status, raw_data: rd },
  }
  const ins = await db.from('comprobantes').insert(fila).select('folio').maybeSingle()
  if (ins.error && ins.error.code !== '23505') return { error: `No se pudo crear el comprobante: ${ins.error.message}` }
  const otra = ins.data ?? (await db.from('comprobantes').select('folio').eq('transaction_id', txId).maybeSingle()).data
  return otra ? { folio: Number((otra as any).folio) } : { error: 'No se pudo crear el comprobante del movimiento.' }
}

// Ponerse al día: a cada operación completada sin comprobante se le crea el
// comprobante y, si la facturación automática está activa, se emite con las
// reglas normales (motivo del envío, tipo de operación). Así el documento
// sale aunque el trigger de la base haya fallado para esa operación. Se
// hace de a pocas por vuelta: cada emisión puede tardar un minuto.
async function reconciliar(userId: string, tope = 3): Promise<{ creados: number; emitidos: number; errores: string[]; pendientes: number }> {
  const cfg = await leerConfig(userId)
  const { sin } = await completadasSinComprobante(userId)
  const out = { creados: 0, emitidos: 0, errores: [] as string[], pendientes: 0 }
  let hechos = 0
  for (const tx of sin) {
    if (hechos >= tope) { out.pendientes++; continue }
    const c = await asegurarComprobante(tx, userId)
    if ('error' in c) { out.errores.push(c.error); continue }
    out.creados++
    if (cfg?.activo) {
      // Reclamar la emisión: si otra vuelta (el botón y la carga de la
      // pantalla a la vez) ya la tomó, no se emite dos veces.
      const { data: mio } = await db.from('comprobantes').update({ factura_estado: 'pendiente', factura_error: 'En emisión…' }).eq('folio', c.folio).is('factura_estado', null).select('folio')
      if (!mio || !(mio as any[]).length) continue
      hechos++
      const r = await emitir(c.folio)
      if (r?.ok && r.estado === 'emitida') out.emitidos++
      else if (r && !r.ok) out.errores.push(String(r.error ?? 'error'))
    }
  }
  return out
}

// Ponerse al día de verdad: además de las operaciones SIN comprobante
// (reconciliar), los comprobantes que quedaron sin emitir —estado vacío o
// 'pendiente'— porque el aviso automático se cortó a mitad (el correo falló,
// la función se reinició, Siigo tardó). Antes esos no los reintentaba nadie:
// solo se veían si alguien entraba a Contabilidad y apretaba Reintentar.
// No toca 'error' (casi siempre falta configurar algo: reintentar no lo
// arregla) ni 'emitiendo' (Siigo pudo haberlo creado: se revisa a mano para
// no duplicar ante la DIAN). Tope por vuelta y por tiempo: cada emisión
// puede tardar un minuto.
async function ponerseAlDia(userId: string, opts: { tope?: number; hastaMs?: number } = {}): Promise<{ creados: number; emitidos: number; reintentados: number; errores: string[] }> {
  const fin = opts.hastaMs ?? Date.now() + 100_000
  const tope = opts.tope ?? 3
  const cfg = await leerConfig(userId)
  const out = { creados: 0, emitidos: 0, reintentados: 0, errores: [] as string[] }
  if (!cfg?.activo) return out
  // Una cola de lote cuyo relevo se perdió se retoma (en su propia llamada).
  await reanudarCola(userId).catch(e => console.error('[facturacion] reanudar cola', userId, String((e as Error)?.message ?? e)))
  const r = await reconciliar(userId, tope)
  out.creados = r.creados; out.emitidos = r.emitidos; out.errores.push(...r.errores)
  let hechos = r.emitidos + r.errores.length
  const desde = new Date(Date.now() - 14 * 86400000).toISOString()
  const reposo = new Date(Date.now() - 5 * 60_000).toISOString()   // no pisar un aviso que está corriendo
  const { data: atascados } = await db.from('comprobantes').select('folio, factura_estado')
    .eq('user_id', userId).in('tipo', Object.keys(DISPARADORES))
    .or('factura_estado.is.null,factura_estado.eq.pendiente')
    .gte('emitido_at', desde).lt('emitido_at', reposo)
    .order('emitido_at', { ascending: true }).limit(20)
  for (const c of (atascados ?? []) as any[]) {
    if (hechos >= tope || Date.now() > fin) break
    hechos++
    out.reintentados++
    const e = await emitir(Number(c.folio))
    if (e?.ok && e.estado === 'emitida') out.emitidos++
    else if (e && !e.ok) out.errores.push(String(e.error ?? 'error'))
  }
  return out
}

// ── Catálogos ─────────────────────────────────────────────────────
async function traerCatalogos(token: string, partner: string) {
  const lista = (r: Resp): any[] => Array.isArray(r.data) ? r.data : Array.isArray(r.data?.results) ? r.data.results : []
  // Los productos vienen paginados. Se traen TODAS las páginas: un producto
  // creado ayer puede quedar en la segunda, y "no me sale el ítem nuevo" es
  // exactamente lo que pasa cuando solo se lee la primera.
  const todasLasPaginas = async (ruta: string, max = 20): Promise<Resp> => {
    const acumulado: any[] = []
    let ultima: Resp | null = null
    for (let page = 1; page <= max; page++) {
      const r = await siigo('GET', `${ruta}${ruta.includes('?') ? '&' : '?'}page=${page}&page_size=100`, { token, partner })
      ultima = r
      if (!r.ok) break
      const parte = lista(r)
      acumulado.push(...parte)
      const total = Number(r.data?.pagination?.total_results)
      if (parte.length < 100 || (Number.isFinite(total) && acumulado.length >= total)) break
    }
    if (!ultima) return { ok: false, status: 0, data: null, texto: 'sin respuesta' }
    return { ...ultima, ok: ultima.ok || acumulado.length > 0, data: acumulado }
  }
  const [doc, docDs, docFc, usr, pag, pagFc, prod, imp] = await Promise.all([
    siigo('GET', '/v1/document-types?type=FV', { token, partner }),
    // El documento soporte: Siigo lo lista como su propio tipo (DS) o, según
    // la cuenta, entre los comprobantes de compra (FC). Se piden los dos y
    // el cliente elige el que en SU Siigo está configurado como documento
    // soporte. No se adivina cuál es.
    siigo('GET', '/v1/document-types?type=DS', { token, partner }),
    siigo('GET', '/v1/document-types?type=FC', { token, partner }),
    siigo('GET', '/v1/users', { token, partner }),
    siigo('GET', '/v1/payment-types?document_type=FV', { token, partner }),
    siigo('GET', '/v1/payment-types?document_type=FC', { token, partner }),
    todasLasPaginas('/v1/products'),
    siigo('GET', '/v1/taxes', { token, partner }),
  ])
  const fuentes: Record<string, { ok: boolean; status: number; motivo: string | null; n: number }> = {}
  const anota = (k: string, r: Resp, arr: any[]) => { fuentes[k] = { ok: r.ok, status: r.status, motivo: r.ok ? null : motivoDe(r), n: arr.length } }
  const tipoDoc = (d: any, clase: string) => ({ id: d.id, code: d.code, name: d.name, clase, electronic: d.electronic_type ?? d.electronic ?? null })
  const documentos = lista(doc).map((d: any) => tipoDoc(d, 'FV'))
  const vistos = new Set<string>()
  const documentos_ds = [...lista(docDs).map((d: any) => tipoDoc(d, 'DS')), ...lista(docFc).map((d: any) => tipoDoc(d, 'FC'))]
    .filter(d => { const k = String(d.id); if (vistos.has(k)) return false; vistos.add(k); return true })
  const vendedores = lista(usr).map((u: any) => ({ id: u.id, nombre: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id), username: u.username, activo: u.active }))
  const pagos = lista(pag).map((p: any) => ({ id: p.id, name: p.name, type: p.type }))
  const pagos_ds = lista(pagFc).map((p: any) => ({ id: p.id, name: p.name, type: p.type }))
  // Con los IMPUESTOS de cada producto: el IVA lo decide el ítem en Siigo,
  // no una etiqueta nuestra. Sin esto se le decía "sin IVA" a un ítem que
  // en Siigo tiene IVA, y la factura salía con IVA igual.
  const productos = lista(prod).map((p: any) => ({
    id: p.id, code: p.code, name: p.name, type: p.type, active: p.active,
    // Cómo lo clasifica Siigo (Taxed / Exempt / Excluded) y si el precio ya
    // trae el impuesto: se guardan para mostrarlos cuando "sin IVA" no cuadra
    // con lo que el usuario ve en su Siigo.
    tax_classification: p.tax_classification ?? null, tax_included: p.tax_included ?? null,
    taxes: (Array.isArray(p.taxes) ? p.taxes : []).map((t: any) => ({ id: t.id, name: t.name, type: t.type, percentage: Number(t.percentage) || 0 })),
  }))
  const impuestos = lista(imp).map((t: any) => ({ id: t.id, name: t.name, type: t.type, percentage: Number(t.percentage) || 0 }))
  anota('documentos', doc, documentos); anota('vendedores', usr, vendedores); anota('pagos', pag, pagos); anota('productos', prod, productos)
  // Para el documento soporte basta con que UNA de las dos listas haya
  // respondido; si ninguna, se guarda el motivo de la de compras.
  anota('documentos_ds', docDs.ok || docFc.ok ? { ...docFc, ok: true } : docFc, documentos_ds)
  anota('pagos_ds', pagFc, pagos_ds); anota('impuestos', imp, impuestos)
  return { documentos, documentos_ds, vendedores, pagos, pagos_ds, productos, impuestos, fuentes, traido_at: new Date().toISOString() }
}

// ── Qué documento sale por cada tipo de operación ─────────────────
// Lo nuevo (`documentos`) manda. Si no está, la regla vieja: los
// disparadores marcados emitían factura de venta.
// Envíos que factura el modelo Comisión (los mismos que ofrece Configuración).
const ENVIOS_COMISION = ['dispersion', 'send', 'pay_sent']
// Los modelos de MANDATO: por cada envío, una factura de venta con dos
// ítems: ingresos recibidos para terceros por el valor transferido completo
// (sin IVA) y la comisión con el IVA incluido (base + IVA = comisión). Solo
// envíos. Comisión la factura al ORDENANTE; PSP / pasarela, al BENEFICIARIO
// (a quien se le transfiere). Antes PSP era otra cosa (documento soporte por
// motivo y comisión a mano en depósitos); Lincoin lo redefinió así.
const esMandato = (cfg: any) => ['comision', 'psp'].includes(String(cfg?.modelo ?? ''))

// «Retefuente comisiones 11 %» del catálogo de la cuenta (en el Siigo de
// MEXITECH, el impuesto 41). Se busca por tipo y nombre en lo que devolvió
// GET /v1/taxes; si no aparece así, el 41 si es una retención.
function retencionComisiones(cfg: any): { id: number; name: string; percentage: number } | null {
  const lista: any[] = Array.isArray(cfg?.catalogos?.impuestos) ? cfg.catalogos.impuestos : []
  const esRetencion = (t: any) => /retefuente|retenci/i.test(`${t?.type ?? ''} ${t?.name ?? ''}`)
  const t = lista.find(x => esRetencion(x) && /comisi/i.test(String(x?.name ?? '')) && Math.abs((Number(x?.percentage) || 0) - 11) < 0.01)
    ?? lista.find(x => Number(x?.id) === 41 && esRetencion(x))
  return t ? { id: Number(t.id), name: String(t.name ?? ''), percentage: Number(t.percentage) || 11 } : null
}
// Con retención, ¿el pago que valida Siigo es el total menos la retención?
// Se aprende de la primera respuesta de Siigo (null = todavía no se sabe).
let siigoPagoNeto: boolean | null = null

function documentosDe(cfg: any): Record<string, 'FV' | 'DS'> {
  // MODELO COMISIÓN (y PSP): solo se facturan envíos. Una configuración
  // guardada cuando el modelo facturaba depósitos (Depósitos, Pagos
  // recibidos) dejaba TODOS los envíos en "no aplica": en XATECH ningún envío
  // se facturaba solo al completarse, y la pantalla de Configuración ya no
  // mostraba esas casillas para corregirlo. Ahora solo cuentan los envíos
  // marcados y, si no hay ninguno marcado, se facturan todos los envíos.
  if (esMandato(cfg)) {
    const marcados = Object.keys(documentosGuardados(cfg)).filter(k => ENVIOS_COMISION.includes(k))
    return Object.fromEntries((marcados.length ? marcados : ENVIOS_COMISION).map(k => [k, 'FV' as const]))
  }
  return documentosGuardados(cfg)
}
function documentosGuardados(cfg: any): Record<string, 'FV' | 'DS'> {
  const d = cfg?.documentos
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const out: Record<string, 'FV' | 'DS'> = {}
    for (const [k, v] of Object.entries(d)) if (k in DISPARADORES && (v === 'FV' || v === 'DS')) out[k] = v
    return out
  }
  const out: Record<string, 'FV' | 'DS'> = {}
  for (const k of Array.isArray(cfg?.disparadores) ? cfg.disparadores : []) if (k in DISPARADORES) out[k] = 'FV'
  return out
}

// ── Los ítems del documento ──────────────────────────────────────
// Cada línea: un producto de Siigo, una descripción con plantilla, cantidad,
// y el VALOR: el monto de la operación, un porcentaje de él, o un fijo. Con
// impuesto, el total que se paga incluye el impuesto (Siigo lo exige así).
type ItemCfg = { code: string; description?: string; quantity?: number; valor?: 'monto' | 'porcentaje' | 'fijo'; porcentaje?: number; fijo?: number; tax_id?: number | null }
const r2 = (n: number) => Math.round(n * 100) / 100

// ── Los dos modelos de negocio ───────────────────────────────────
//
//  ROTACIÓN DE CAPITAL. El cliente recibe plata de terceros, la rota y cobra
//  una comisión. Por cada ENTRADA sale una factura de venta con DOS ítems que
//  suman exacto lo recibido:
//    · "Servicio para terceros", sin IVA: el monto menos la utilidad.
//    · "Comisión", con IVA: la base que, más el IVA, da la utilidad.
//  Con 15.000.000 y 1 %: utilidad 150.000 → terceros 14.850.000; comisión
//  126.050,42 + IVA 23.949,58 = 150.000. Total 15.000.000.
//
//  El IVA se calcula acá, con la misma tarifa que se le manda a Siigo en el
//  ítem, y el ítem de terceros absorbe el redondeo: así el total de la
//  factura es el monto de la operación al centavo, y el pago cuadra.
//
//  PSP (PASARELA). El cliente paga a terceros por cuenta de alguien. Por cada
//  SALIDA sale un documento soporte al beneficiario por el monto total, con
//  el ítem de servicio para terceros, sin IVA. La factura de la comisión al
//  cliente de quien vino el negocio la hace el usuario en Siigo.
// El impuesto que un producto tiene configurado EN SIIGO. Es el que Siigo
// va a aplicar, se le mande lo que se le mande.
function ivaDelProducto(cfg: any, code: string): { id: number; name: string; percentage: number } | null {
  const productos: any[] = Array.isArray(cfg.catalogos?.productos) ? cfg.catalogos.productos : []
  const p = productos.find((x: any) => String(x.code) === String(code))
  const taxes: any[] = Array.isArray(p?.taxes) ? p.taxes : []
  const conValor = taxes.filter(t => (Number(t.percentage) || 0) > 0)
  const iva = conValor.find(t => /iva/i.test(String(t.name ?? '')) || /iva/i.test(String(t.type ?? ''))) ?? conValor[0]
  return iva ? { id: Number(iva.id), name: String(iva.name ?? ''), percentage: Number(iva.percentage) || 0 } : null
}

function itemsDelModelo(cfg: any, monto: number, ctx: Record<string, string>): { items: any[]; total: number; error?: string } | null {
  const modelo = String(cfg.modelo ?? '')
  if (modelo !== 'rotacion' && modelo !== 'psp') return null
  const plantilla = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k) => ctx[k] ?? `{${k}}`)
  const terceros = String(cfg.item_terceros ?? '').trim()
  if (!terceros) return { items: [], total: 0 }
  // El servicio para terceros NO lleva IVA. Si el ítem elegido tiene IVA en
  // Siigo, Siigo se lo va a cobrar sí o sí: no se emite y se dice por qué.
  const ivaTerceros = ivaDelProducto(cfg, terceros)
  if (ivaTerceros) return { items: [], total: 0, error: `El ítem de servicio para terceros (${terceros}) tiene ${ivaTerceros.name || 'IVA'} ${ivaTerceros.percentage} % en Siigo, y ese servicio va sin IVA. Elegí otro ítem en Configuración o quitale el impuesto en Siigo.` }
  const descT = plantilla(cfg.desc_terceros || 'Servicio para terceros · {contraparte} · Comprobante Lincoin {numero}').slice(0, 500)

  if (modelo === 'psp') {
    return { items: [{ code: terceros, description: descT, quantity: 1, price: r2(monto) }], total: r2(monto) }
  }

  const comision = String(cfg.item_comision ?? '').trim()
  const pct = Number(cfg.utilidad_pct) || 0
  if (!comision || pct <= 0) return { items: [], total: 0 }
  // El IVA de la comisión: el del ítem en Siigo. Si el ítem no tiene, el que
  // se eligió en Configuración (y se manda en la línea para que aplique).
  const impuestos: any[] = Array.isArray(cfg.catalogos?.impuestos) ? cfg.catalogos.impuestos : []
  const ivaElegido = cfg.iva_tax_id ? impuestos.find((t: any) => Number(t.id) === Number(cfg.iva_tax_id)) : null
  const iva = ivaDelProducto(cfg, comision) ?? (ivaElegido ? { id: Number(ivaElegido.id), name: String(ivaElegido.name ?? ''), percentage: Number(ivaElegido.percentage) || 0 } : null)
  const tarifa = iva ? iva.percentage / 100 : 0
  const utilidad = r2(monto * pct / 100)
  const baseComision = r2(utilidad / (1 + tarifa))
  const ivaComision = r2(baseComision * tarifa)
  // El de terceros absorbe la diferencia de redondeo: total = monto exacto.
  const valorTerceros = r2(monto - baseComision - ivaComision)
  const descC = plantilla(cfg.desc_comision || 'Comisión {utilidad} % · Comprobante Lincoin {numero}').slice(0, 500)
  return {
    items: [
      { code: terceros, description: descT, quantity: 1, price: valorTerceros },
      { code: comision, description: descC, quantity: 1, price: baseComision, ...(iva ? { taxes: [{ id: iva.id }] } : {}) },
    ],
    total: r2(valorTerceros + baseComision + ivaComision),
  }
}

// Factura de venta de un envío (PSP, por motivo): una línea con el ítem del
// motivo y el total igual al monto enviado. Si el ítem tiene IVA en Siigo,
// el IVA va INCLUIDO en ese monto (base = monto / (1 + tarifa)).
function itemsFacturaMotivo(cfg: any, code: string, monto: number, ctx: Record<string, string>): { items: any[]; total: number; error?: string } {
  const plantilla = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k) => ctx[k] ?? `{${k}}`)
  const iva = ivaDelProducto(cfg, code)
  const tarifa = iva ? iva.percentage / 100 : 0
  const base = r2(monto / (1 + tarifa))
  const ivaV = r2(base * tarifa)
  const desc = plantilla(cfg.desc_terceros || '{tipo} · {contraparte} · Comprobante Lincoin {numero}').slice(0, 500)
  return { items: [{ code, description: desc, quantity: 1, price: base, ...(iva ? { taxes: [{ id: iva.id }] } : {}) }], total: r2(base + ivaV) }
}

function itemsDe(cfg: any, monto: number, ctx: Record<string, string>): { items: any[]; total: number; error?: string } {
  const delModelo = itemsDelModelo(cfg, monto, ctx)
  if (delModelo) return delModelo
  const lista: ItemCfg[] = Array.isArray(cfg.items) && cfg.items.length ? cfg.items
    : cfg.product_code ? [{ code: cfg.product_code, description: cfg.product_description, quantity: 1, valor: 'monto' }] : []
  const impuestos: any[] = Array.isArray(cfg.catalogos?.impuestos) ? cfg.catalogos.impuestos : []
  const plantilla = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k) => ctx[k] ?? `{${k}}`)
  let total = 0
  const items = lista.filter(i => i && String(i.code ?? '').trim()).map(i => {
    const qty = Math.max(1, Number(i.quantity) || 1)
    const valor = i.valor ?? 'monto'
    const precio = valor === 'porcentaje' ? monto * (Number(i.porcentaje) || 0) / 100 : valor === 'fijo' ? (Number(i.fijo) || 0) : monto
    const price = Math.round(precio * 100) / 100
    const tax = i.tax_id ? impuestos.find((t: any) => Number(t.id) === Number(i.tax_id)) : null
    const pct = tax ? Number(tax.percentage) || 0 : 0
    total += price * qty * (1 + pct / 100)
    return {
      code: String(i.code).trim(),
      description: plantilla(i.description || `${ctx.tipo} · Lincoin`).slice(0, 500),
      quantity: qty, price,
      ...(i.tax_id ? { taxes: [{ id: Number(i.tax_id) }] } : {}),
    }
  })
  return { items, total: Math.round(total * 100) / 100 }
}

// ── NIT: el dígito de verificación (módulo 11 de la DIAN) ────────
// En Lincoin el NIT se inscribe COMPLETO (10 dígitos). Siigo lo quiere
// partido: `identification` con los 9 base y `check_digit` aparte. Solo se
// parte si el décimo dígito es de verdad el DV de los otros nueve.
const PESOS_NIT = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
function dvNit(base: string): number | null {
  const d = String(base ?? '').replace(/\D/g, '')
  if (!d.length || d.length > 15) return null
  let suma = 0
  for (let i = 0; i < d.length; i++) suma += Number(d[d.length - 1 - i]) * PESOS_NIT[i]
  const r = suma % 11
  return r > 1 ? 11 - r : r
}
// ── La cuenta no se factura a sí misma ─────────────────────────────
// XATECH tenía facturas a nombre de XATECH: sus pagos propios llevaban a la
// misma empresa como ordenante, y la factura de la comisión salía a su
// nombre. Una empresa no se factura a sí misma. Se compara el documento sin
// dígito de verificación (un NIT llega con o sin DV).
const baseDoc = (s: unknown) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length === 10 ? d.slice(0, 9) : d }
// El NIT de la empresa (o el documento de la persona) dueña de la cuenta,
// con la misma regla que la ficha del cliente en las facturas de Lincoin.
async function documentosPropios(userId: string): Promise<Set<string>> {
  const { data: u } = await db.from('users').select('*').eq('id', userId).maybeSingle()
  const x: any = u ?? {}
  const rd = (x.raw_data ?? {}) as Record<string, any>
  const docEmpresa = baseDoc(x.tax_id ?? rd.taxId ?? rd.nit)
  const docPersona = baseDoc(x.doc_number ?? rd.docNumber)
  const esEmpresa = !!docEmpresa && (x.role === 'business' || !!(x.company_name ?? rd.companyName))
  return new Set([docEmpresa, esEmpresa ? '' : docPersona].filter(d => d.length >= 6))
}
const MSG_MISMA_EMPRESA = (doc: string) => `El cliente de la factura (${doc}) es la misma empresa que factura: una empresa no se factura a sí misma. No se emitió.`

function partirNit(doc: string): { identification: string; check_digit?: string } {
  if (doc.length === 10 && dvNit(doc.slice(0, 9)) === Number(doc[9])) return { identification: doc.slice(0, 9), check_digit: doc[9] }
  if (doc.length === 9) { const dv = dvNit(doc); return dv === null ? { identification: doc } : { identification: doc, check_digit: String(dv) } }
  return { identification: doc }
}

// ── La contraparte de una operación ──────────────────────────────
// Dirección del tercero como la pide Siigo: calle, y la ciudad con códigos
// DANE (state_code = departamento, city_code = municipio) y país. La DIAN
// rechaza el documento soporte si el tercero no tiene país ("Falta o es
// inválido el país del tercero", regla vista en DS-1-10).
type Direccion = { address: string; city: { country_code: string; state_code: string; city_code: string } }
type Contraparte = { identification: string; check_digit?: string; nombre: string; esDefault: boolean; esEmpresa: boolean; direccion: Direccion | null; email?: string | null }
// Sin calle no se inventa una: Siigo exige texto en address y la DIAN solo
// valida el país, así que va dicho tal cual.
const SIN_CALLE = 'Sin direccion informada'
// Siigo rechaza la dirección con caracteres fuera de su alfabeto
// ("invalid_alphanumeric_value · The field Address has an invalid
// characters"): tildes, ñ, el punto medio. Se deja letras, números, espacio
// y la puntuación de una dirección colombiana (# - . , ).
function limpiarDireccion(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ñÑ]/g, m => m === 'ñ' ? 'n' : 'N')
    .replace(/[·•|/]/g, '-')
    .replace(/[^A-Za-z0-9 #.,\-]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 256)
}
function direccionDe(rd: Record<string, any>): Direccion | null {
  const r = rd?.recipient && typeof rd.recipient === 'object' ? rd.recipient : {}
  const address = String(r.address ?? rd.address ?? '').trim()
  const city = String(r.cityCode ?? rd.cityCode ?? '').replace(/\D/g, '').padStart(5, '0')
  const state = String(r.stateCode ?? rd.stateCode ?? city.slice(0, 2)).replace(/\D/g, '').padStart(2, '0')
  if (city.length !== 5 || city === '00000') return null
  return { address: limpiarDireccion(address || SIN_CALLE) || SIN_CALLE, city: { country_code: 'Co', state_code: state, city_code: city } }
}
// La dirección del beneficiario inscrito con ese documento (raw_data
// .mouvContacts del usuario). El NIT puede estar inscrito con dígito de
// verificación y acá venir sin él: se compara por los dígitos base.
async function direccionDelBeneficiario(userId: string, identification: string, cfg: any, esEmpresa = false): Promise<Direccion | null> {
  ultimoDiagnosticoLugar = ''
  const { data } = await db.from('users').select('raw_data, city, company_city').eq('id', userId).maybeSingle()
  const raw = (data as any)?.raw_data ?? {}
  const contactos: any[] = Array.isArray(raw.mouvContacts) ? raw.mouvContacts : []
  const base = identification.replace(/\D/g, '')
  const mismoDoc = (d: string) => d && (d === base || (d.length === base.length + 1 && d.slice(0, -1) === base))
  const hit = contactos.find(c => mismoDoc(String(c?.docNumber ?? '').replace(/\D/g, '')))
  const deFicha = hit ? direccionDe({ recipient: { address: hit.address, cityCode: hit.cityCode, stateCode: hit.stateCode } }) : null
  if (deFicha) return deFicha
  const calle = limpiarDireccion(String(hit?.address ?? '').trim().slice(0, 200)) || SIN_CALLE
  // ── Empresa: el domicilio de la Cámara de Comercio (RUES) ────────────
  // Una empresa no tiene lugar de expedición; su ciudad es donde se
  // matriculó. Se consulta por NIT (Datos Abiertos y el portal RUES) y, si
  // aparece, queda guardado en la ficha del beneficiario para no volver a
  // consultarlo y para que se vea en Beneficiarios. Se intenta primero para
  // una empresa y, como respaldo, para cualquiera cuando la cédula no da
  // ciudad: una persona inscrita con tipo equivocado, o un comerciante
  // natural matriculado, también están en el RUES.
  let diagRUES = ''
  const porRUES = async (): Promise<Direccion | null> => {
    const r = await domicilioEmpresa(base)
    if (r.domicilio?.municipio) {
      const m = r.domicilio.municipio
      const direccion = limpiarDireccion(r.domicilio.direccion ?? '') || calle
      if (hit) {
        const actualizado = { ...hit, cityCode: m.codigo, cityName: `${m.nombre}, ${m.deptoNombre}`, stateCode: m.depto, ...(hit.address ? {} : { address: direccion }), direccionFuente: `${r.domicilio.fuente} (Cámara de Comercio${r.domicilio.camara ? ` de ${r.domicilio.camara}` : ''})` }
        // Se relee la fila JUSTO antes de guardar: entre la lectura de arriba y
        // acá pasó la consulta al RUES (segundos), y guardar la copia vieja
        // borraba los beneficiarios inscritos en ese rato. Solo se cambia ESTE
        // contacto, por id, sobre la lista fresca.
        const { data: fresca } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
        const rawF = ((fresca as any)?.raw_data ?? {}) as Record<string, any>
        const listaF: any[] = Array.isArray(rawF.mouvContacts) ? rawF.mouvContacts : []
        if (listaF.some(c => c?.id && c.id === hit.id)) {
          const { cityCode, cityName, stateCode, direccionFuente } = actualizado as any
          await db.from('users').update({ raw_data: { ...rawF, mouvContacts: listaF.map(c => c?.id === hit.id ? { ...c, cityCode, cityName, stateCode, direccionFuente, ...(c.address ? {} : { address: direccion }) } : c) } }).eq('id', userId).then(() => {}, () => {})
        }
      }
      return { address: direccion, city: { country_code: 'Co', state_code: m.depto, city_code: m.codigo } }
    }
    diagRUES = r.diagnostico
    return null
  }
  // Último recurso, para no frenar la emisión (decisión del cliente): la
  // ciudad configurada, si no la de la empresa, si no Bogotá D.C., y en la
  // dirección queda dicho que la ciudad no se verificó. No se guarda en la
  // ficha: si la persona da su ciudad, se pone y manda.
  const ultimoRecurso = (): Direccion => {
    const u = data as any
    const ext = municipioPorCodigo(cfg?.ciudad_exterior)
      ?? municipioPorNombre(u?.company_city) ?? municipioPorNombre(u?.city)
      ?? municipioPorNombre(raw?.companyCity) ?? municipioPorNombre(raw?.city)
      ?? municipioPorCodigo('11001')!
    return { address: limpiarDireccion(`${calle} - Ciudad no verificada`), city: { country_code: 'Co', state_code: ext.depto, city_code: ext.codigo } }
  }
  if (esEmpresa) {
    const d = await porRUES()
    if (d) return d
    ultimoDiagnosticoLugar = `Es una empresa: la ciudad sale del domicilio de la Cámara de Comercio (RUES), y no se pudo obtener — ${diagRUES}`
    return ultimoRecurso()
  }
  // Sin ciudad en la ficha: la del lugar de expedición de la cédula, que
  // la Registraduría devolvió en la consulta de antecedentes (TusDatos).
  const benef: Record<string, any> = raw.tusdatos?.beneficiarios ?? {}
  const doc = Object.keys(benef).find(k => mismoDoc(k.replace(/\D/g, '')))
  const f = doc ? benef[doc] : null
  let lugar = String(f?.lugarExpedicion ?? '')
  let m = f ? (municipioPorCodigo(f.lugarExpedicionCodigo) ?? municipioPorNombre(lugar)) : null
  if (!m && !(lugar && lugarFueraDeColombia(lugar))) {
    // La ficha no lo trae todavía: se le pide a la función de antecedentes,
    // que vuelve a leer el reporte (sin gastar crédito) y dice qué encontró.
    const r = await lugarDeExpedicion(userId, base)
    ultimoDiagnosticoLugar = r.diagnostico
    lugar = r.lugar || lugar
    m = r.codigo ? municipioPorCodigo(r.codigo) : null
  }
  if (m) return { address: calle, city: { country_code: 'Co', state_code: m.depto, city_code: m.codigo } }
  // Cédula expedida en el exterior (consulado): de ahí no sale un municipio
  // colombiano. Decisión del cliente: el tercero va con la ciudad
  // configurada para estos casos o, si no hay, con la de su empresa. El
  // lugar real de expedición queda escrito en la dirección, para que el
  // documento no diga más de lo que se sabe.
  if (lugar && lugarFueraDeColombia(lugar)) {
    const u = data as any
    // Orden: la configurada → la de la empresa (perfil) → Bogotá D.C. El
    // cliente pidió que no se frene por esto; Bogotá es el último recurso y
    // queda dicho en la dirección.
    const ext = municipioPorCodigo(cfg?.ciudad_exterior)
      ?? municipioPorNombre(u?.company_city) ?? municipioPorNombre(u?.city)
      ?? municipioPorNombre(raw?.companyCity) ?? municipioPorNombre(raw?.city)
      ?? municipioPorCodigo('11001')!
    ultimoDiagnosticoLugar = ''
    return { address: limpiarDireccion(`${calle} - Cedula expedida en ${lugar}`), city: { country_code: 'Co', state_code: ext.depto, city_code: ext.codigo } }
  }
  // Respaldo: el RUES también para quien no se reconoció como empresa.
  const diagCedula = ultimoDiagnosticoLugar
  const d = await porRUES()
  if (d) return d
  // Sin ciudad en ninguna fuente (ni Registraduría, ni RUI, Sisbén o RUES,
  // ni registro mercantil): último recurso.
  ultimoDiagnosticoLugar = `${diagCedula}${diagCedula ? ' ' : ''}Tampoco aparece en el registro mercantil (RUES): ${diagRUES}`
  return ultimoRecurso()
}
// Qué contestó la consulta del lugar de expedición, para ponerlo en el error
// cuando no alcanza: dice si la Registraduría no lo trajo, si trajo un
// nombre que no corresponde a un municipio único, o si no hay consulta.
let ultimoDiagnosticoLugar = ''
async function lugarDeExpedicion(userId: string, documento: string): Promise<{ codigo: string | null; lugar: string; diagnostico: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/tusdatos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'lugar_expedicion', userId, documento }),
      signal: AbortSignal.timeout(20000),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d?.ok) return { codigo: null, lugar: '', diagnostico: `Antecedentes: ${d?.motivo ?? d?.error ?? `HTTP ${r.status}`}.` }
    const lugar = String(d.lugarExpedicion ?? '')
    if (d.lugarExpedicionCodigo) return { codigo: String(d.lugarExpedicionCodigo), lugar, diagnostico: '' }
    if (lugar) return { codigo: null, lugar, diagnostico: lugarFueraDeColombia(lugar)
      ? `La cédula se expidió en el exterior («${lugar}», en un consulado), así que no hay municipio colombiano que tomar de la Registraduría.`
      : `La Registraduría dice que la cédula se expidió en «${lugar}», y ese nombre corresponde a más de un municipio de la lista DANE (o a ninguno).` }
    const claves: string[] = Array.isArray(d.claves) ? d.claves : []
    const secciones: string[] = Array.isArray(d.seccionesReporte) ? d.seccionesReporte : []
    const vol = d.secciones && typeof d.secciones === 'object' ? Object.entries(d.secciones as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(' ‖ ') : ''
    return { codigo: null, lugar: '', diagnostico: d.esEmpresa
      ? `Es una empresa: la ciudad saldría del domicilio de la Cámara de Comercio (RUES) o de la dirección seccional del RUT (DIAN), y el reporte de antecedentes no lo trae bajo una clave reconocible. Claves parecidas: ${claves.length ? claves.slice(0, 40).join(' · ') : 'ninguna'}. Contenido de las secciones: ${vol || 'ninguna'}.`
      : `El reporte de antecedentes no trae el lugar de expedición bajo una clave reconocible. Claves parecidas: ${claves.length ? claves.slice(0, 12).join(' · ') : 'ninguna'}. Secciones del reporte: ${secciones.join(', ') || 'ninguna'}.` }
  } catch (e) {
    return { codigo: null, lugar: '', diagnostico: `No se pudo consultar antecedentes: ${(e as Error)?.message ?? e}.` }
  }
}
function contraparteDe(comp: any, cfg: any): Contraparte {
  const rd = comp?.detalle?.raw_data ?? {}
  const rc = rd.recipient ?? {}
  const doc = String(rd.docNumber ?? rd.documentNumber ?? rd.beneficiaryDoc ?? rd.beneficiaryDocument ?? rd.senderDoc ?? rc.documentNumber ?? rc.docNumber ?? '').replace(/\D/g, '')
  const tipoDoc = String(rd.docType ?? rd.documentType ?? rd.beneficiaryDocType ?? rc.documentType ?? rc.docType ?? '').toUpperCase()
  const nombre = String(rd.beneficiary ?? rd.beneficiaryName ?? rd.senderName ?? rd.recipientName ?? rc.holderName ?? rc.name ?? comp?.contraparte ?? '').trim()
  if (doc) {
    // Es empresa si el tipo dice NIT; si no hay tipo, por la longitud (una
    // cédula no llega a 9 dígitos salvo las muy nuevas, que van a 10). Y si
    // el nombre es una razón social (SAS, LTDA, S.A.…), es empresa aunque
    // se haya inscrito con el tipo equivocado.
    const pareceRazonSocial = /\b(S\.?\s?A\.?\s?S\.?|LTDA\.?|S\.?\s?A\.?|E\.?\s?U\.?|S\.?\s?C\.?\s?A\.?|S\.?\s?EN\s?C\.?|SOCIEDAD|COMPANIA|COMPAÑIA|CIA\.?|CORPORACION|FUNDACION|ASOCIACION|COOPERATIVA)\b\.?$/i.test(nombre.replace(/[.,]+$/, '').trim()) || /\bS\.?A\.?S\b/i.test(nombre)
    const esEmpresa = tipoDoc === 'NIT' || (!tipoDoc && doc.length === 9) || (doc.length === 9 && pareceRazonSocial)
    const partes = esEmpresa ? partirNit(doc) : { identification: doc }
    return { ...partes, nombre: nombre || doc, esDefault: false, esEmpresa, direccion: direccionDe(rd) }
  }
  return { identification: String(cfg.cliente_default_nit || '222222222222').replace(/\D/g, ''), nombre: cfg.cliente_default_nombre || 'Consumidor final', esDefault: true, esEmpresa: false, direccion: null }
}

const SIN_DIRECCION = (cp: Contraparte, donde: string) =>
  `El beneficiario ${cp.nombre} (${cp.identification}) no tiene ciudad ${donde}, y la DIAN rechaza el documento soporte sin el país del tercero («Falta o es inválido el país del tercero»). ${cp.esEmpresa ? '' : 'Tampoco se pudo tomar del lugar de expedición de la cédula'}${ultimoDiagnosticoLugar ? `${cp.esEmpresa ? '' : ' — '}${ultimoDiagnosticoLugar}` : ''} Elegí la ciudad en Beneficiarios → abrí la ficha → Ciudad y dirección, y emití de nuevo.`

async function asegurarCliente(token: string, partner: string, cfg: any, cp: Contraparte, rol: 'Customer' | 'Supplier' = 'Customer'): Promise<{ ok: true } | { ok: false; error: string }> {
  const busca = await siigo('GET', `/v1/customers?identification=${encodeURIComponent(cp.identification)}`, { token, partner })
  const lista: any[] = Array.isArray(busca.data?.results) ? busca.data.results : Array.isArray(busca.data) ? busca.data : []
  if (!busca.ok) return { ok: false, error: `Buscando al cliente en Siigo — ${motivoDe(busca)}` }
  const existente = lista.find(x => String(x?.identification ?? '') === cp.identification) ?? lista[0]
  if (existente) {
    // Ya existe. Si no tiene país (los que se crearon antes de saber que la
    // DIAN lo exige), se le completa con la dirección del beneficiario.
    const conPais = !!existente.address?.city?.country_code
    if (conPais || rol !== 'Supplier') return { ok: true }
    if (!cp.direccion) return { ok: false, error: SIN_DIRECCION(cp, 'en Siigo') }
    const idType = existente.id_type?.code ?? existente.id_type ?? (cp.esEmpresa ? '31' : '13')
    const cuerpo: Record<string, unknown> = {
      type: existente.type ?? rol, person_type: existente.person_type ?? (cp.esEmpresa ? 'Company' : 'Person'), id_type: String(idType),
      identification: existente.identification ?? cp.identification,
      ...(existente.check_digit ? { check_digit: String(existente.check_digit) } : {}),
      name: Array.isArray(existente.name) ? existente.name : [String(existente.name ?? cp.nombre)],
      ...(existente.commercial_name ? { commercial_name: existente.commercial_name } : {}),
      branch_office: existente.branch_office ?? 0, active: existente.active ?? true,
      vat_responsible: existente.vat_responsible ?? false,
      fiscal_responsibilities: (Array.isArray(existente.fiscal_responsibilities) && existente.fiscal_responsibilities.length ? existente.fiscal_responsibilities : [{ code: 'R-99-PN' }]).map((f: any) => ({ code: f.code ?? f })),
      address: cp.direccion,
      ...(Array.isArray(existente.phones) && existente.phones.length ? { phones: existente.phones.map((p: any) => ({ ...(p.indicative ? { indicative: p.indicative } : {}), ...(p.number ? { number: p.number } : {}), ...(p.extension ? { extension: p.extension } : {}) })) } : {}),
      ...(Array.isArray(existente.contacts) && existente.contacts.length ? { contacts: existente.contacts.map((k: any) => ({ first_name: k.first_name ?? cp.nombre, ...(k.last_name ? { last_name: k.last_name } : {}), ...(k.email ? { email: k.email } : {}), ...(k.phone ? { phone: k.phone } : {}) })) } : {}),
    }
    const upd = await siigo('PUT', `/v1/customers/${encodeURIComponent(String(existente.id))}`, { token, partner, body: cuerpo })
    if (!upd.ok) return { ok: false, error: `Completando la ciudad del tercero ${cp.identification} en Siigo — ${motivoDe(upd)}` }
    return { ok: true }
  }
  // El documento soporte necesita el país del tercero: sin dirección no se
  // crea un tercero incompleto que la DIAN va a rechazar.
  if (rol === 'Supplier' && !cp.direccion) return { ok: false, error: SIN_DIRECCION(cp, 'inscritas') }
  // Si no existe, se crea SIEMPRE con los datos de la operación: el flujo es
  // "toma los datos de la transferencia, guarda al tercero y emite". Una
  // casilla para apagarlo solo producía documentos en error.
  // Empresa (NIT, id_type 31, con dígito de verificación aparte) o persona
  // (cédula, id_type 13). Se crea con lo mínimo que Siigo exige y sin
  // inventar lo que no se sabe: la responsabilidad fiscal va en "no
  // responsable" (R-99-PN), que es lo que aplica mientras nadie diga otra
  // cosa. Si Siigo pide más, lo dice y se ve en la columna FACTURA.
  const partes = cp.nombre.split(/\s+/).filter(Boolean)
  // Con correo, como contacto: es a donde Siigo manda la factura (mail.send).
  const contacto = cp.email ? { contacts: [{ first_name: partes[0] ?? cp.nombre, last_name: partes.slice(1).join(' ') || '.', email: cp.email }] } : {}
  const cuerpo = cp.esEmpresa && !cp.esDefault
    ? {
      type: rol, person_type: 'Company', id_type: '31',
      identification: cp.identification, ...(cp.check_digit ? { check_digit: cp.check_digit } : {}),
      name: [cp.nombre], commercial_name: cp.nombre, branch_office: 0, active: true,
      vat_responsible: false, fiscal_responsibilities: [{ code: 'R-99-PN' }],
      ...(cp.direccion ? { address: cp.direccion } : {}), ...contacto,
    }
    : {
      type: rol, person_type: 'Person', id_type: '13',
      identification: cp.identification,
      name: [partes[0] ?? cp.nombre, partes.slice(1).join(' ') || '.'], branch_office: 0, active: true,
      vat_responsible: false, fiscal_responsibilities: [{ code: 'R-99-PN' }],
      ...(cp.direccion ? { address: cp.direccion } : {}), ...contacto,
    }
  const crea = await siigo('POST', '/v1/customers', { token, partner, body: cuerpo })
  if (!crea.ok) return { ok: false, error: `Creando al cliente ${cp.identification} en Siigo — ${motivoDe(crea)}` }
  return { ok: true }
}

// Siigo rechaza con 409 "duplicated_document" un documento muy parecido a
// otro emitido segundos antes (mismo cliente, mismo valor, mismo día), aunque
// sean dos operaciones distintas — p. ej. dos envíos del mismo monto a
// beneficiarios diferentes. No es un error de configuración: pasado un rato
// lo acepta. Se deja 'pendiente' y ponerse_al_dia lo reintenta solo, hasta 4
// intentos; después queda en error para que alguien lo mire.
const esDuplicadoSiigo = (motivo: string) => /duplicated_document/i.test(motivo)
const REINTENTOS_DUPLICADO = 4
// En la cola del lote, una duplicada se reintenta pasado este tiempo.
const ESPERA_DUPLICADO_MS = 90_000

// ¿Un envío anterior de este comprobante pudo crear la factura sin que
// Lincoin se enterara? Sin respuesta (0: se cortó a los 70 s), un error de
// Siigo (5xx) o un "duplicado" (409, que puede ser la de este mismo
// movimiento, creada en el intento que no contestó). Un 4xx de validación no
// crea nada. Antes, con cualquiera de estos el comprobante quedaba en error
// o pendiente y el siguiente intento mandaba otra: la contadora de XATECH
// encontró facturas duplicadas.
const envioIncierto = (det: any) => Array.isArray(det?.intentos) && det.intentos.some((i: any) => {
  if (i?.ruta && i.ruta !== '/v1/invoices') return false
  const s = Number(i?.status)
  return s === 0 || s >= 500 || s === 409
})

// La marca "Lincoin LC-…" es con lo que se encuentra la factura en Siigo
// cuando no llegó la respuesta. Siigo guarda 500 caracteres de observación:
// se recorta el texto libre, nunca la marca (un texto de observaciones largo
// la dejaba afuera y la factura ya creada no se encontraba).
function observacionConMarca(antes: unknown[], marca: string, despues: unknown[] = []): string {
  const fijo = [marca, ...despues.filter(Boolean).map(String)].join(' · ')
  const libre = antes.filter(Boolean).map(String).join(' · ')
  if (!libre) return fijo.slice(0, 500)
  const cabe = 500 - fijo.length - 3
  return cabe > 0 ? `${libre.slice(0, cabe)} · ${fijo}` : fijo.slice(0, 500)
}

// CANDADO SIN `or`. PostgREST (antes de la 14.x, issue #3707) falla con
// «column comprobantes.factura_estado does not exist» en un UPDATE con
// or=(…) que devuelve filas: vuelve a aplicar el `or` sobre lo devuelto. El
// candado de la factura usaba ese `or` y, con el error, seguía de largo: no
// bloqueaba nada ni marcaba 'emitiendo', y dos emisiones a la vez del mismo
// movimiento (el «ponerse al día» del cron y el de la pantalla, la cola y un
// clic) mandaban dos facturas a la DIAN. Ahora se prueba condición por
// condición con filtros simples —cada UPDATE es atómico: si dos compiten,
// uno solo lo toma— y un error NO deja seguir.
async function actualizarSiAlguna(tabla: string, patch: Record<string, unknown>, base: (q: any) => any, alternativas: ((q: any) => any)[], col: string): Promise<{ tomado: boolean; error?: string }> {
  for (const alt of alternativas) {
    const { data, error } = await alt(base(db.from(tabla).update(patch))).select(col)
    if (error) return { tomado: false, error: error.message }
    if (Array.isArray(data) && data.length) return { tomado: true }
  }
  return { tomado: false }
}
// Desde qué estados se puede tomar un comprobante para emitir. Desde la cola,
// solo si sigue en cola (un «Detener» justo antes la devolvió a como estaba).
// Un 'emitiendo' de más de 3 min se da por caído.
const ESTADOS_EMITIBLES = ['error', 'omitida', 'pendiente', 'anulada', 'en_cola']
function candadoFactura(desdeCola: boolean): ((q: any) => any)[] {
  const hace3 = new Date(Date.now() - 180000).toISOString()
  const caido = (q: any) => q.eq('factura_estado', 'emitiendo').lt('factura_at', hace3)
  return desdeCola
    ? [(q: any) => q.eq('factura_estado', 'en_cola'), caido]
    : [(q: any) => q.is('factura_estado', null), (q: any) => q.in('factura_estado', ESTADOS_EMITIBLES), caido]
}
const MSG_SIN_CANDADO = (e: string) => `No se pudo apartar el comprobante para emitir (${e}). No se mandó nada a Siigo: intenta de nuevo en un momento.`

// Desde cuándo buscar en Siigo la factura de un comprobante: una semana antes
// del último intento, pero nunca antes de que existiera el comprobante.
function desdeParaBuscar(comp: any): string {
  const intentos = [comp?.factura_detalle?.intento?.at, comp?.factura_at].map(x => Date.parse(String(x ?? ''))).filter(Number.isFinite)
  let desde = (intentos.length ? Math.min(...intentos) : Date.now()) - 7 * 86400000
  const creado = Date.parse(String(comp?.emitido_at ?? ''))
  if (Number.isFinite(creado)) desde = Math.max(desde, creado)
  return new Date(desde).toISOString()
}

// ── Emitir la factura de UN comprobante ──────────────────────────
async function emitir(folio: number, opts: { forzar?: boolean; desdeCola?: boolean } = {}): Promise<any> {
  const { data: comp } = await db.from('comprobantes').select('*').eq('folio', folio).maybeSingle()
  if (!comp) return { ok: false, error: 'comprobante_no_encontrado' }
  const userId = String((comp as any).user_id ?? '')
  const cfg = await leerConfig(userId)
  const marcar = async (patch: Record<string, unknown>) => {
    await db.from('comprobantes').update({ ...patch, factura_intentos: Number((comp as any).factura_intentos ?? 0) + 1 }).eq('folio', folio)
  }
  // Una factura anulada no se marca "no aplica" por estar pausada la
  // facturación: se perdería que estuvo facturada y anulada.
  if ((!cfg || !cfg.activo) && opts.forzar && ((comp as any).factura_estado === 'anulada' || Array.isArray((comp as any).factura_detalle?.anteriores))) return { ok: false, error: 'La facturación está pausada. Activala en Contabilidad → Configuración para volver a emitir.' }
  if (!cfg || !cfg.activo) { await marcar({ factura_estado: 'omitida', factura_error: 'Facturación automática no activa.' }); return { ok: true, estado: 'omitida' } }
  const tipo = String((comp as any).tipo ?? '')
  const reglas = documentosDe(cfg)
  const regla = reglas[tipo] ?? null
  // EL MOTIVO DEL ENVÍO MANDA. Si la operación trae motivo (se pregunta al
  // confirmar cada envío) y ese motivo tiene regla en Configuración, esa
  // regla decide: documento soporte con el ítem que se ligó, o nada.
  const motivoTx = String((comp as any)?.detalle?.raw_data?.motivo ?? '')
  const reglaMotivo = motivoTx && cfg.motivos && typeof cfg.motivos === 'object' ? (cfg.motivos as any)[motivoTx] : null
  // Sin regla (emisión forzada a mano): por la dirección de la plata. Una
  // salida es documento soporte; una entrada, factura de venta.
  const esSalida = ['dispersion', 'send', 'pay_sent', 'otc_withdraw'].includes(tipo)
  // MODELO COMISIÓN: por cada movimiento marcado, una factura de venta solo
  // por la comisión (% de Configuración), IVA INCLUIDO (base + IVA = la
  // comisión), a la contraparte del movimiento. La arma emitirComision, que
  // lee el IVA del ítem en vivo y reintenta con la tarifa que aplica Siigo.
  if (esMandato(cfg)) {
    if (!opts.forzar && !regla) {
      await marcar({ factura_estado: 'omitida', factura_error: `El tipo "${DISPARADORES[tipo] ?? tipo}" no cobra comisión (Configuración → qué movimientos cobran comisión).` })
      return { ok: true, estado: 'omitida' }
    }
    if ((comp as any).factura_estado === 'emitida' && (comp as any).factura_numero) return { ok: true, estado: 'emitida', numero: (comp as any).factura_numero }
    // VOLVER A EMITIR una factura anulada (con nota crédito en Siigo): al
    // mismo cliente y con el mismo porcentaje que la anulada, ya con el
    // cálculo vigente — sea un envío o un depósito facturado antes.
    const detAnt: any = (comp as any).factura_detalle ?? {}
    const clienteAnt: any = detAnt?.comision?.cliente ?? null
    // También si el reemplazo ya se intentó y falló (queda en error, con la
    // anulada en el historial): se reintenta igual, no como movimiento nuevo.
    const yaFueAnulada = (comp as any).factura_estado === 'anulada' || ((comp as any).factura_estado === 'error' && Array.isArray(detAnt?.anteriores) && detAnt.anteriores.length > 0)
    // Un DEPÓSITO no se factura en este modelo, tampoco para reemplazar una
    // anulada (la FV-2-725 de XATECH era un depósito: anulada queda). No se
    // toca su estado: marcarla "no aplica" borraría que estuvo anulada.
    if (opts.forzar && yaFueAnulada && !esSalida) return { ok: false, error: 'En el modelo Comisión los depósitos no llevan factura: la anulada queda anulada.' }
    if (opts.forzar && yaFueAnulada && clienteAnt?.identification) {
      return emitirComision(userId, String((comp as any).transaction_id), {
        identification: String(clienteAnt.identification), nombre: clienteAnt.nombre ? String(clienteAnt.nombre) : undefined,
        pct: Number(detAnt?.comision?.pct) || undefined, reemplazo: true,
      })
    }
    // A quién. PSP / pasarela: al BENEFICIARIO, con el nombre y documento
    // con que se le envió (el pago es por cuenta suya).
    if (esSalida && String(cfg.modelo) === 'psp') {
      const ben = contraparteDe(comp, cfg)
      if (ben.esDefault) {
        const e = 'El envío no trae el documento del beneficiario, y en PSP la factura va a su nombre. Revisá el beneficiario en la lista y emití de nuevo.'
        await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: 'FV' }); return { ok: false, error: e }
      }
      return emitirComision(userId, String((comp as any).transaction_id), { identification: ben.identification, nombre: ben.nombre, esEmpresa: ben.esEmpresa, auto: !opts.forzar })
    }
    // Comisión: al ordenante (el cliente por cuenta de quien se pagó), que se
    // elige al enviar y viaja en raw_data.recipient.ordenante.
    const rdC: any = (comp as any)?.detalle?.raw_data ?? {}
    const ord: any = rdC?.recipient?.ordenante ?? rdC?.ordenante ?? null
    if (esSalida) {
      const docOrd = String(ord?.doc ?? '').replace(/\D/g, '')
      if (!docOrd) {
        const e = 'El envío no tiene ordenante, y la factura de la comisión va a su nombre. Emitila a mano eligiendo el cliente.'
        await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: 'FV' }); return { ok: false, error: e }
      }
      return emitirComision(userId, String((comp as any).transaction_id), { identification: docOrd, nombre: String(ord?.nombre ?? ''), esEmpresa: String(ord?.docTipo ?? '') === 'NIT', auto: !opts.forzar })
    }
    // Solo envíos: en Comisión y en PSP un cargue o depósito no se factura.
    {
      const e = `En el modelo ${String(cfg.modelo) === 'psp' ? 'PSP / pasarela' : 'Comisión'} solo se facturan los envíos; los cargues y depósitos no llevan factura.`
      await marcar({ factura_estado: 'omitida', factura_error: e }); return { ok: true, estado: 'omitida' }
    }
  }
  let clase: 'FV' | 'DS' = regla ?? (esSalida ? 'DS' : 'FV')
  // El documento soporte siempre es UN ítem por el monto total (el del
  // motivo, o el general de terceros), aunque el modelo sea rotación.
  let cfgEmision: any = clase === 'DS' ? { ...cfg, modelo: 'psp' } : cfg
  // Factura de venta por motivo: al beneficiario del envío, por el monto
  // total, con el ítem ligado al motivo (IVA incluido si el ítem lo tiene).
  let itemFacturaMotivo: string | null = null
  if (reglaMotivo) {
    if (reglaMotivo.emite === 'DS' && reglaMotivo.item) {
      clase = 'DS'
      cfgEmision = { ...cfg, modelo: 'psp', item_terceros: reglaMotivo.item }
    } else if (reglaMotivo.emite === 'FV' && reglaMotivo.item) {
      clase = 'FV'
      itemFacturaMotivo = String(reglaMotivo.item)
    } else if (!opts.forzar) {
      await marcar({ factura_estado: 'omitida', factura_error: `El motivo "${MOTIVOS_ENVIO[motivoTx] ?? motivoTx}" está configurado para no emitir documento.` })
      return { ok: true, estado: 'omitida' }
    }
  } else if (!opts.forzar && !regla) {
    await marcar({ factura_estado: 'omitida', factura_error: motivoTx
      ? `El motivo "${MOTIVOS_ENVIO[motivoTx] ?? motivoTx}" no tiene documento configurado (Configuración → envíos por motivo).`
      : `El tipo "${DISPARADORES[tipo] ?? tipo}" no emite documento (Configuración → qué sale por cada operación).` })
    return { ok: true, estado: 'omitida' }
  }
  // Ya emitida: no se emite dos veces.
  if ((comp as any).factura_estado === 'emitida' && (comp as any).factura_numero) return { ok: true, estado: 'emitida', numero: (comp as any).factura_numero }
  // El documento en Siigo va en pesos. Una operación en otra moneda no se
  // convierte con una tasa inventada.
  const moneda = String((comp as any).moneda ?? '').toUpperCase()
  if (moneda && !/^COP/.test(moneda)) { const e = `La operación es en ${moneda} y el documento en Siigo va en pesos. No hay tasa de cambio configurada.`; await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase }); return { ok: false, error: e } }
  const necesarios = clase === 'FV' ? ['document_id', 'seller_id', 'payment_id'] : ['ds_document_id', 'ds_payment_id']
  const faltan = necesarios.filter(k => !cfg[k])
  if (faltan.length) { const e = `Falta elegir en Configuración (${clase === 'FV' ? 'factura de venta' : 'documento soporte'}): ${faltan.join(', ')}.`; await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase }); return { ok: false, error: e } }

  const partner = cfg.partner_id || 'Lincoin'
  const t = await tokenDe(userId, cfg)
  if ('error' in t) { await marcar({ factura_estado: 'error', factura_error: t.error, factura_tipo: clase }); return { ok: false, error: t.error } }

  const cp = contraparteDe(comp, cfg)
  // A nombre de la misma empresa (un envío a una cuenta propia, un depósito
  // desde ella): no se emite. Una anulada no se toca.
  if (!cp.esDefault && (await documentosPropios(userId)).has(baseDoc(cp.identification))) {
    const e = MSG_MISMA_EMPRESA(cp.identification)
    if ((comp as any).factura_estado === 'anulada') return { ok: false, error: e }
    await marcar({ factura_estado: 'omitida', factura_error: e })
    return { ok: true, estado: 'omitida', aviso: e }
  }
  // Si el envío no trae la dirección (se hizo antes de que el beneficiario
  // la tuviera), se toma de la lista de beneficiarios, por documento. Así
  // completar la ficha alcanza para emitir de nuevo un envío viejo.
  if (!cp.direccion && !cp.esDefault) cp.direccion = await direccionDelBeneficiario(userId, cp.identification, cfg, cp.esEmpresa)
  // El documento soporte va A NOMBRE DEL BENEFICIARIO del envío, con el
  // nombre y documento con que se le envió. Nunca a un "consumidor final":
  // si el envío no trae documento, no se emite y se dice.
  if ((clase === 'DS' || itemFacturaMotivo) && cp.esDefault) {
    const e = `El envío no trae el documento del beneficiario, y ${clase === 'DS' ? 'el documento soporte' : 'la factura'} va a su nombre. Revisá el beneficiario en la lista.`
    await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase }); return { ok: false, error: e }
  }
  const cli = await asegurarCliente(t.token, partner, cfg, cp, clase === 'DS' ? 'Supplier' : 'Customer')
  if (!cli.ok) { await marcar({ factura_estado: 'error', factura_error: cli.error, factura_tipo: clase }); return { ok: false, error: cli.error } }

  // El monto como número para Siigo, desde el texto que guardó el comprobante.
  const monto = Number(String((comp as any).monto ?? '0').replace(/,/g, ''))
  if (!Number.isFinite(monto) || monto <= 0) { const e = `Monto inválido en el comprobante: ${(comp as any).monto}`; await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase }); return { ok: false, error: e } }
  const hoy = new Date().toISOString().slice(0, 10)
  const ctx = {
    tipo: DISPARADORES[tipo] ?? tipo, numero: String((comp as any).numero ?? ''), contraparte: cp.nombre,
    monto: monto.toLocaleString('es-CO', { maximumFractionDigits: 2 }), fecha: hoy,
    utilidad: String(Number(cfg.utilidad_pct) || 0),
  }
  const { items, total, error: errorItems } = itemFacturaMotivo ? itemsFacturaMotivo(cfg, itemFacturaMotivo, monto, ctx) : itemsDe(cfgEmision, monto, ctx)
  if (errorItems) { await marcar({ factura_estado: 'error', factura_error: errorItems, factura_tipo: clase }); return { ok: false, error: errorItems } }
  if (!items.length) { const e = 'No hay ítems configurados para el documento (Configuración → ítems).'; await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase }); return { ok: false, error: e } }
  if (total <= 0) { const e = 'Los ítems suman cero: revisá el valor de cada uno en Configuración.'; await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase }); return { ok: false, error: e } }
  const observations = observacionConMarca([cfg.observaciones], `Comprobante Lincoin ${(comp as any).numero}`)
  const cuerpo = clase === 'FV'
    ? {
      document: { id: Number(cfg.document_id) },
      date: hoy,
      customer: { identification: cp.identification, branch_office: 0 },
      seller: Number(cfg.seller_id),
      stamp: { send: !!cfg.stamp },
      mail: { send: !!cfg.mail },
      observations, items,
      payments: [{ id: Number(cfg.payment_id), value: total, due_date: hoy }],
    }
    : {
      document: { id: Number(cfg.ds_document_id) },
      date: hoy,
      supplier: { identification: cp.identification, branch_office: 0 },
      // Siigo exige en compras la referencia del documento del proveedor,
      // también para el documento soporte ("The field provider_invoice is
      // required"). Un beneficiario que no factura no tiene una; va el
      // comprobante de Lincoin, que es el soporte real y es trazable.
      provider_invoice: { prefix: 'LC', number: String(folio) },
      observations, items,
      payments: [{ id: Number(cfg.ds_payment_id), value: total, due_date: hoy }],
      // Documento soporte ELECTRÓNICO: "stamp" en true lo reporta a la DIAN.
      // Si no se manda, Siigo lo deja en false y no lo transmite.
      stamp: { send: cfg.stamp !== false },
    }
  // En compras (documento soporte) Siigo exige el TIPO de cada línea, y no
  // es el tipo del producto: es cómo se contabiliza la línea. "Product" vale
  // para productos y servicios del catálogo (los otros valores son activo
  // fijo y cuenta contable). Siigo rechazó "Service", textual:
  // "parameters_exclusive · Invalid value for parameter: type".
  if (clase === 'DS') {
    for (const it of (cuerpo as any).items) it.type = 'Product'
  }
  // El documento soporte: Siigo lo documenta como una compra con el tipo de
  // comprobante DS, pero /v1/purchases contestó "invalid_document" con ese
  // id. Como su documentación no se puede consultar desde acá, se prueban
  // las rutas candidatas en orden y se queda la que responda. Un endpoint
  // inexistente contesta 404 y no crea nada; un 400 de validación tampoco.
  // Cada intento queda en factura_detalle, para ver qué dijo cada uno.
  // Confirmado en el portal de clientes de Siigo ("Gestionar documentos
  // soporte en API"): POST /v1/purchase-support-documents, con el tipo de
  // comprobante de GET /v1/document-types?type=DS. /v1/purchases queda de
  // respaldo por si una cuenta vieja lo resolviera así.
  // Última revisión de la pausa, justo antes de mandar a Siigo: armar el
  // documento (tercero, RUES, catálogos) puede tardar más de un minuto, y
  // una pausa puesta en ese rato tiene que frenar este envío.
  const vigente = await leerConfig(userId)
  if (!vigente?.activo) {
    await marcar({ factura_estado: 'omitida', factura_error: 'Facturación pausada antes de enviar el documento a Siigo.' })
    return { ok: true, estado: 'omitida' }
  }
  // Un intento anterior que quedó a medias o sin respuesta clara: Siigo pudo
  // haber creado la factura. Antes de mandar otra se busca en Siigo por la
  // marca del comprobante; si está, se registra esa. (Solo factura de venta:
  // el documento soporte se consulta por otra ruta.)
  if (clase === 'FV') {
    const detD: any = (comp as any).factura_detalle ?? {}
    const aMedias = (comp as any).factura_estado === 'emitiendo' && !(Date.parse(String((comp as any).factura_at ?? '')) > Date.now() - 180000)
    if (aMedias || envioIncierto(detD)) {
      const idents = [...new Set([detD?.enviado?.customer?.identification, cp.identification].map(x => String(x ?? '').replace(/\D/g, '')).filter(Boolean))]
      const excluir = new Set<string>((Array.isArray(detD.anteriores) ? detD.anteriores : []).map((a: any) => String(a?.id ?? '')).filter(Boolean))
      if ((comp as any).factura_estado === 'anulada' && (comp as any).factura_id) excluir.add(String((comp as any).factura_id))
      const b = await facturaDelComprobanteEnSiigo(userId, t.token, partner, idents, desdeParaBuscar(comp), String((comp as any).numero ?? ''), null, excluir)
      if (!b.ok) return { ok: false, error: `Un intento anterior de esta factura no tuvo respuesta clara de Siigo y pudo haberse creado. No se pudo revisar en Siigo (${b.motivo ?? 'sin respuesta'}), así que no se reenvió para no duplicarla. Intenta en unos minutos.` }
      if (b.factura) {
        const f0 = b.factura
        const numero0 = f0.name ?? (f0.number != null ? `${f0.prefix ?? ''}${f0.number}` : null) ?? String(f0.id ?? '')
        const { lote: _sale, ...restoD } = detD
        await marcar({
          factura_estado: 'emitida', factura_error: null, factura_tipo: 'FV', factura_proveedor: 'siigo',
          factura_id: f0.id != null ? String(f0.id) : null, factura_numero: numero0, factura_cufe: f0.stamp?.cufe ?? null, factura_url: f0.public_url ?? null,
          factura_at: new Date().toISOString(), factura_detalle: { ...restoD, respuesta: f0, adoptada: true },
        })
        return { ok: true, estado: 'emitida', tipo: 'FV', numero: numero0, adoptada: true, aviso: 'Ya estaba emitida en Siigo: se registró esa, no se emitió otra.' }
      }
    }
  }
  // CANDADO, igual que en emitirComision: el automático y un «reintentar» a
  // mano (o un segundo aviso de la misma operación) no pueden mandar dos
  // documentos a la DIAN por el mismo comprobante. Un 'emitiendo' de más de
  // 3 min se da por caído.
  {
    const lock = await actualizarSiAlguna('comprobantes', { factura_estado: 'emitiendo', factura_error: null, factura_at: new Date().toISOString() },
      q => q.eq('folio', folio), candadoFactura(!!opts.desdeCola), 'folio')
    if (lock.error) return { ok: false, error: MSG_SIN_CANDADO(lock.error) }
    if (!lock.tomado) return { ok: false, error: 'Este documento ya se está emitiendo o ya salió. Espera un momento y recarga.' }
  }
  const RUTAS_DS = ['/v1/purchase-support-documents', '/v1/purchases']
  const intentos: { ruta: string; status: number; respuesta: any }[] = []
  let r: Resp
  if (clase === 'FV') {
    r = await siigo('POST', '/v1/invoices', { token: t.token, partner, body: cuerpo, ms: 70000 })
    intentos.push({ ruta: '/v1/invoices', status: r.status, respuesta: r.data ?? r.texto })
  } else {
    const rutas = [cfg.ds_ruta, ...RUTAS_DS].filter((x, i, a) => x && a.indexOf(x) === i) as string[]
    r = { ok: false, status: 0, data: null, texto: 'sin intento' }
    for (const ruta of rutas) {
      // El documento soporte llama a la referencia del proveedor
      // `supplier_receipt_number` (prefijo 1-6 alfanumérico, número 1-11
      // dígitos); la factura de compra la llama `provider_invoice`. Mismo
      // dato, nombre distinto según la ruta.
      const { provider_invoice, ...resto } = cuerpo as any
      const cuerpoRuta = ruta.includes('support') ? { ...resto, supplier_receipt_number: provider_invoice } : cuerpo
      r = await siigo('POST', ruta, { token: t.token, partner, body: cuerpoRuta, ms: 70000 })
      intentos.push({ ruta, status: r.status, respuesta: r.data ?? r.texto, enviado: cuerpoRuta } as any)
      if (r.ok) {
        if (cfg.ds_ruta !== ruta) await db.from('facturacion_config').update({ ds_ruta: ruta }).eq('user_id', userId).then(() => {}, () => {})
        break
      }
      // 404/405: la ruta no existe, se prueba la siguiente. Un 400 que no sea
      // por el tipo de comprobante es un error real del cuerpo: no se insiste.
      const motivo = motivoDe(r)
      if (r.status !== 404 && r.status !== 405 && !/document\.id|invalid_document/i.test(motivo)) break
    }
  }
  if (!r.ok) {
    if (intentos.length > 1) {
      // Se muestra el intento más informativo: el que no fue 404.
      const util = [...intentos].reverse().find(i => i.status !== 404 && i.status !== 405) ?? intentos[0]
      r = { ok: false, status: util.status, data: typeof util.respuesta === 'object' ? util.respuesta : null, texto: typeof util.respuesta === 'string' ? util.respuesta : JSON.stringify(util.respuesta ?? '') }
    }
    let e = r.status === 0
      // Sin respuesta: Siigo pudo haberlo creado. Antes de reintentar hay que
      // buscarlo en Siigo, o sale duplicado ante la DIAN.
      ? `Siigo no respondió a tiempo: ${clase === 'FV' ? 'la factura' : 'el documento soporte'} PUDO haberse creado. Revisa en Siigo antes de reintentar.`
      : `Siigo rechazó ${clase === 'FV' ? 'la factura' : 'el documento soporte'} — ${motivoDe(r)}`
    // Si el problema es el tipo de comprobante, decir cuál se mandó y cuáles
    // otros hay: la lista de Siigo trae varios y el id de uno no sirve para
    // el endpoint del otro.
    if (/document\.id|invalid_document/i.test(e)) {
      const lista: any[] = clase === 'FV' ? (cfg.catalogos?.documentos ?? []) : (cfg.catalogos?.documentos_ds ?? [])
      const idEnviado = clase === 'FV' ? cfg.document_id : cfg.ds_document_id
      const usado = lista.find((d: any) => String(d.id) === String(idEnviado))
      const otros = lista.filter((d: any) => String(d.id) !== String(idEnviado)).map((d: any) => `${d.clase ? d.clase + ' · ' : ''}${d.code ? d.code + ' · ' : ''}${d.name} (id ${d.id})`)
      e += ` · Se envió el comprobante ${usado ? `«${usado.clase ? usado.clase + ' · ' : ''}${usado.code ? usado.code + ' · ' : ''}${usado.name}» (id ${usado.id})` : `id ${idEnviado}`}.`
      e += otros.length ? ` Otros que devolvió Siigo: ${otros.join('; ')}. Elegí otro en Configuración.` : ' Siigo no devolvió otro comprobante de ese tipo.'
    }
    if (intentos.length > 1) e += ` · Rutas probadas: ${intentos.map(i => `${i.ruta} → HTTP ${i.status}`).join(', ')}.`
    if (r.status === 409 && esDuplicadoSiigo(motivoDe(r)) && Number((comp as any).factura_intentos ?? 0) + 1 < REINTENTOS_DUPLICADO) {
      const espera = `Siigo lo tomó como duplicado de otro documento parecido emitido segundos antes. Se reintenta solo en unos minutos. (${e})`
      await marcar({ factura_estado: 'pendiente', factura_error: espera, factura_tipo: clase, factura_detalle: { enviado: cuerpo, intentos } })
      return { ok: false, error: espera, reintento: true }
    }
    await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase, factura_detalle: { enviado: cuerpo, intentos } })
    return { ok: false, error: e }
  }
  const d = r.data ?? {}
  const numero = d.name ?? (d.number != null ? `${d.prefix ?? ''}${d.number}` : null) ?? String(d.id ?? '')
  await marcar({
    factura_estado: 'emitida', factura_error: null, factura_tipo: clase,
    factura_proveedor: 'siigo', factura_id: d.id != null ? String(d.id) : null,
    factura_numero: numero, factura_cufe: d.stamp?.cufe ?? null, factura_url: d.public_url ?? null,
    factura_at: new Date().toISOString(), factura_detalle: { enviado: cuerpo, respuesta: d, intentos },
  })
  return { ok: true, estado: 'emitida', tipo: clase, numero, cufe: d.stamp?.cufe ?? null, url: d.public_url ?? null }
}

// ── Anulaciones con NOTA CRÉDITO ────────────────────────────────────────
// Una factura electrónica no se borra en Siigo: se anula con una nota
// crédito, y la factura sigue existiendo, sin la marca `annulled` y con el
// mismo estado ante la DIAN. Por eso Lincoin no se enteraba: la contadora
// anulaba en Siigo y aquí la factura seguía "emitida", sin poder volver a
// emitirla. Ahora se le pregunta a Siigo por las notas crédito (cada una
// trae `invoice.id`, la factura a la que apunta) y, si cubren el total de
// la factura, el comprobante queda anulado y se puede volver a emitir.
type NotaCredito = { id: string; nombre: string; fecha: string | null; total: number }
async function notasCreditoDesde(token: string, partner: string, desde: string, soloFactura?: string): Promise<Map<string, NotaCredito[]>> {
  const m = new Map<string, NotaCredito[]>()
  // Se piden de a 100; si Siigo no acepta ese tamaño, se sigue con el suyo.
  let tam: number | null = 100
  for (let pagina = 1; pagina <= 200; pagina++) {
    const ruta = `/v1/credit-notes?date_start=${encodeURIComponent(desde)}&page=${pagina}${tam ? `&page_size=${tam}` : ''}`
    let r = await siigo('GET', ruta, { token, partner })
    if (!r.ok && pagina === 1 && tam && r.status === 400) {
      tam = null
      r = await siigo('GET', `/v1/credit-notes?date_start=${encodeURIComponent(desde)}&page=1`, { token, partner })
    }
    if (!r.ok) throw new Error(`No se pudieron leer las notas crédito de Siigo — ${motivoDe(r)}`)
    const lista: any[] = Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data) ? r.data : []
    for (const nc of lista) {
      const fid = String(nc?.invoice?.id ?? '')
      if (!fid || (soloFactura && fid !== soloFactura)) continue
      const nombre = String(nc?.name ?? (nc?.number != null ? `${nc?.prefix ?? 'NC'}-${nc.number}` : nc?.id ?? ''))
      m.set(fid, [...(m.get(fid) ?? []), { id: String(nc?.id ?? ''), nombre, fecha: nc?.date ?? null, total: Number(nc?.total) || 0 }])
    }
    const totalRes = Number(r.data?.pagination?.total_results ?? NaN)
    const porPagina = tam ?? (Number(r.data?.pagination?.page_size) || lista.length)
    if (!lista.length || lista.length < porPagina || (Number.isFinite(totalRes) && pagina * porPagina >= totalRes)) break
  }
  return m
}

// Lo que costó la factura: lo que contestó Siigo al crearla o, si no, lo que
// se le mandó a pagar.
function totalDeFactura(det: any): number | null {
  const t = Number(det?.respuesta_creacion?.total ?? det?.respuesta?.total)
  if (Number.isFinite(t) && t > 0) return t
  const pagos = Array.isArray(det?.enviado?.payments) ? det.enviado.payments : []
  const s = pagos.reduce((a: number, p: any) => a + (Number(p?.value) || 0), 0)
  return s > 0 ? s : null
}

// Factura de mandato armada con el cálculo viejo (antes del 28-oct-2026): la
// línea de terceros iba por monto − comisión. Se reconoce por lo que se le
// mandó a Siigo: dos ítems y el primero (terceros) por menos que el monto.
function facturaMalCalculada(c: any): { transferido: number; terceros: number; faltante: number } | null {
  if (!c || c.factura_estado !== 'emitida' || c.factura_tipo === 'DS') return null
  const det = c.factura_detalle ?? {}
  const items = det?.enviado?.items
  if (!det?.comision || !Array.isArray(items) || items.length !== 2) return null
  const transferido = Number(String(c.monto ?? '0').replace(/,/g, ''))
  const terceros = Number(items[0]?.price)
  if (!Number.isFinite(transferido) || !Number.isFinite(terceros) || !(terceros < transferido - 0.5)) return null
  return { transferido, terceros, faltante: r2(transferido - terceros) }
}

// Marca como anulado un comprobante cuyas notas crédito cubren la factura.
// La factura anulada queda en el historial (`anteriores`) con sus notas, y
// los datos para volver a emitirla (cliente y porcentaje) se conservan.
async function aplicarNotasCredito(c: any, notas: NotaCredito[]): Promise<'anulada' | 'parcial' | null> {
  if (!notas.length) return null
  const det = c.factura_detalle ?? {}
  const sumaNC = r2(notas.reduce((a, n) => a + n.total, 0))
  const totalF = totalDeFactura(det)
  const nombres = notas.map(n => n.nombre).join(', ')
  if (totalF == null || sumaNC < totalF - 1) {
    // Nota crédito parcial (una devolución, un ajuste): la factura sigue
    // vigente. Se deja anotado para que se vea en el detalle.
    if (JSON.stringify(det.notas_credito ?? null) === JSON.stringify(notas)) return 'parcial'
    await db.from('comprobantes').update({ factura_detalle: { ...det, notas_credito: notas, notas_credito_parciales: true } }).eq('folio', c.folio)
    return 'parcial'
  }
  const fechas = notas.map(n => n.fecha).filter(Boolean).join(', ')
  const anteriores = Array.isArray(det.anteriores) ? det.anteriores : []
  const yaEsta = anteriores.some((a: any) => a?.id && a.id === c.factura_id)
  await db.from('comprobantes').update({
    factura_estado: 'anulada',
    factura_error: `Anulada en Siigo con ${notas.length === 1 ? 'la nota crédito' : 'las notas crédito'} ${nombres}${fechas ? ` (${fechas})` : ''}. Se puede volver a emitir.`,
    factura_detalle: {
      ...det, notas_credito: notas, notas_credito_parciales: false,
      anteriores: yaEsta ? anteriores : [...anteriores, { id: c.factura_id ?? null, numero: c.factura_numero ?? null, cufe: c.factura_cufe ?? null, total: totalF, emitida_at: c.factura_at ?? null, notas_credito: notas, anulada_detectada_at: new Date().toISOString() }],
    },
  }).eq('folio', c.folio).eq('factura_estado', 'emitida')
  return 'anulada'
}

// Revisa contra Siigo todas las facturas emitidas de la cuenta (desde la más
// vieja) y marca las anuladas con nota crédito.
async function sincronizarAnulaciones(userId: string): Promise<{ revisadas: number; anuladas: string[]; parciales: string[]; error?: string }> {
  const out = { revisadas: 0, anuladas: [] as string[], parciales: [] as string[] }
  const cfg = await leerConfig(userId)
  if (!cfg) return { ...out, error: 'Siigo no está configurado.' }
  const filas: any[] = []
  for (let desde = 0; desde < 20000; desde += 1000) {
    const { data, error } = await db.from('comprobantes').select('*')
      .eq('user_id', userId).eq('factura_estado', 'emitida').not('factura_id', 'is', null)
      .order('folio', { ascending: true }).range(desde, desde + 999)
    if (error) return { ...out, error: error.message }
    filas.push(...((data ?? []) as any[]).filter(f => f.factura_tipo !== 'DS'))
    if (!data || data.length < 1000) break
  }
  out.revisadas = filas.length
  if (!filas.length) return out
  const t = await tokenDe(userId, cfg)
  if ('error' in t) return { ...out, error: t.error }
  const masVieja = filas.map(f => String(f.factura_at ?? '')).filter(Boolean).sort()[0]
  // Un día antes: la fecha de la factura puede ser la del día anterior en
  // Colombia, y la nota crédito siempre es posterior a la factura.
  const desde = masVieja ? new Date(Date.parse(masVieja) - 86_400_000).toISOString().slice(0, 10) : new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  let porFactura: Map<string, NotaCredito[]>
  try { porFactura = await notasCreditoDesde(t.token, cfg.partner_id || 'Lincoin', desde) }
  catch (e) { return { ...out, error: String((e as Error)?.message ?? e) } }
  for (const c of filas) {
    const notas = porFactura.get(String(c.factura_id))
    if (!notas) continue
    const r = await aplicarNotasCredito(c, notas)
    if (r === 'anulada') out.anuladas.push(String(c.factura_numero ?? c.numero))
    if (r === 'parcial') out.parciales.push(String(c.factura_numero ?? c.numero))
  }
  return out
}

// ── Factura de COMISIÓN por un depósito (modelo PSP), a mano ─────────────
// El cliente elige a quién se le factura (quien mandó la plata) y el
// porcentaje (por defecto el de Configuración). La factura lleva UN ítem: el
// de comisión, con el IVA que tiene en Siigo. Y la comisión es con IVA
// INCLUIDO: con 10.000.000 y 0,6 % la comisión es 60.000, y la factura se
// arma para que base + IVA = 60.000 (base 50.420,17 + IVA 9.579,83), no
// 60.000 + IVA. Siigo calcula el IVA sobre la base que se le manda, con la
// tarifa del ítem, así que el total puede diferir del objetivo en un
// centavo de redondeo; el pago va por lo que Siigo va a calcular.
// `cola`: los datos del lote con que se encoló (emisión en segundo plano). Si
// Siigo la toma como duplicada, vuelve a la cola con espera en vez de quedar
// 'pendiente': el cron reintenta los 'pendiente' con las reglas automáticas,
// que no saben del cliente elegido en el lote.
async function emitirComision(userId: string, txId: string, d: { identification: string; nombre?: string; esEmpresa?: boolean; pct?: number; auto?: boolean; reemplazo?: boolean; cola?: Record<string, any> }): Promise<any> {
  const cfg = await leerConfig(userId)
  if (!cfg) return { ok: false, error: 'Primero configurá Siigo en Contabilidad → Configuración.' }
  const { data: tx } = await db.from('transactions').select('id, user_id, type, amount, currency, status, raw_data').eq('id', txId).maybeSingle()
  if (!tx || String((tx as any).user_id) !== userId) return { ok: false, error: 'movimiento_no_encontrado' }
  if (String((tx as any).status) !== 'Completado') return { ok: false, error: `La operación está en "${(tx as any).status}". Solo se factura cuando queda Completada.` }
  const c = await asegurarComprobante(tx, userId)
  if ('error' in c) return { ok: false, error: c.error }
  const { data: comp } = await db.from('comprobantes').select('*').eq('folio', c.folio).maybeSingle()
  if (!comp) return { ok: false, error: 'comprobante_no_encontrado' }
  if ((comp as any).factura_estado === 'emitida' && (comp as any).factura_numero) return { ok: false, error: `Este movimiento ya tiene la factura ${(comp as any).factura_numero}.` }
  // Solo envíos, también al reemplazar una anulada: en el modelo Comisión un
  // depósito no lleva factura (antes un depósito anulado se podía volver a
  // facturar, y aparecía en «Emitir en lote»).
  if (esMandato(cfg) && !['dispersion', 'send', 'pay_sent', 'otc_withdraw'].includes(String((tx as any).type))) {
    return { ok: false, error: 'En el modelo Comisión solo se facturan los envíos; los cargues y depósitos no llevan factura.' }
  }
  // Lo que ya pasó con este movimiento (facturas anuladas, sus notas
  // crédito) no se pierde al guardar la factura nueva.
  const detPrevio = ((comp as any).factura_detalle ?? {}) as Record<string, unknown>
  const historia: Record<string, unknown> = {}
  if (Array.isArray(detPrevio.anteriores)) historia.anteriores = detPrevio.anteriores
  // A quién y cuándo se intentó mandar tampoco se pierde con un error: si
  // Siigo no contestó, el próximo intento busca la factura con esto. Se borra
  // cuando la factura queda registrada.
  if (detPrevio.intento) historia.intento = detPrevio.intento
  const marcar = async (patch: Record<string, unknown>) => {
    const p = patch.factura_detalle && typeof patch.factura_detalle === 'object' ? { ...patch, factura_detalle: { ...(patch.factura_detalle as Record<string, unknown>), ...historia } } : patch
    await db.from('comprobantes').update({ ...p, factura_intentos: Number((comp as any).factura_intentos ?? 0) + 1 }).eq('folio', c.folio)
  }
  const falla = async (e: string, extra: Record<string, unknown> = {}) => { await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: 'FV', ...extra }); return { ok: false, error: e } }

  const moneda = String((comp as any).moneda ?? '').toUpperCase()
  if (moneda && !/^COP/.test(moneda)) return falla(`La operación es en ${moneda} y la factura en Siigo va en pesos.`)
  const faltan = ['document_id', 'seller_id', 'payment_id'].filter(k => !cfg[k])
  if (faltan.length) return falla(`Falta elegir en Configuración (factura de venta): ${faltan.join(', ')}.`)
  const item = String(cfg.item_comision ?? '').trim()
  if (!item) return falla('Falta elegir en Configuración el ítem de comisión (con IVA).')
  const pct = Number(d.pct ?? cfg.utilidad_pct) || 0
  if (!(pct > 0)) return falla('Falta el porcentaje de comisión (Configuración → comisión sobre depósitos, o escribilo al emitir).')
  const identification = String(d.identification ?? '').replace(/\D/g, '')
  if (!identification) return falla('Falta el documento del cliente al que se le factura.')
  // A nombre de la misma empresa: no se factura. Queda «no aplica» con el
  // motivo; una anulada (o su reemplazo fallido) no se toca, o se perdería
  // que estuvo facturada y anulada.
  if ((await documentosPropios(userId)).has(baseDoc(identification))) {
    const e = MSG_MISMA_EMPRESA(identification)
    const conHistoria = (comp as any).factura_estado === 'anulada' || (Array.isArray(detPrevio.anteriores) && detPrevio.anteriores.length > 0)
    if (conHistoria) return { ok: false, error: e }
    await marcar({ factura_estado: 'omitida', factura_error: e })
    return { ok: true, estado: 'omitida', aviso: e }
  }

  const partner = cfg.partner_id || 'Lincoin'
  const t = await tokenDe(userId, cfg)
  if ('error' in t) return falla(t.error)

  // El cliente de la factura: si ya existe en Siigo se usa tal cual; si no,
  // se crea con nombre, documento y la ciudad que se encuentre (ficha del
  // beneficiario, RUES para empresas, o el respaldo).
  const esEmpresa = d.esEmpresa ?? (identification.length === 9)
  const partes = esEmpresa ? partirNit(identification) : { identification }
  const cp: Contraparte = { ...partes, nombre: String(d.nombre ?? '').trim() || identification, esDefault: false, esEmpresa, direccion: null }
  // En paralelo: ¿el cliente ya existe en Siigo? y el ítem en vivo. La
  // dirección (que puede pedir el RUES, lento) solo se busca si hay que
  // CREAR al cliente: uno que ya existe no la necesita para la factura.
  // Lo ya confirmado en Siigo (el cliente existe, el ítem y su IVA) no se
  // vuelve a preguntar en cada factura de un lote: el ordenante suele ser el
  // mismo en todas, y cada consulta cuenta para el límite por minuto.
  const cliYaVisto = siigoVisto(clientesEnSiigo, `${userId}|${cp.identification}`)
  const prodGuardado = productosSiigo.get(`${userId}|${item}`)
  const [buscaCli, rpProd] = await Promise.all([
    cliYaVisto ? Promise.resolve(null) : siigo('GET', `/v1/customers?identification=${encodeURIComponent(cp.identification)}`, { token: t.token, partner }),
    prodGuardado && prodGuardado.hasta > Date.now() ? Promise.resolve(prodGuardado.r) : siigo('GET', `/v1/products?code=${encodeURIComponent(item)}`, { token: t.token, partner }),
  ])
  if (rpProd.ok) productosSiigo.set(`${userId}|${item}`, { hasta: Date.now() + SIIGO_CACHE_PRODUCTO_MS, r: rpProd })
  const listaCli: any[] = !buscaCli ? [] : Array.isArray(buscaCli.data?.results) ? buscaCli.data.results : Array.isArray(buscaCli.data) ? buscaCli.data : []
  const yaExiste = cliYaVisto || (!!buscaCli?.ok && listaCli.some(x => String(x?.identification ?? '') === cp.identification))
  if (!yaExiste) {
    cp.direccion = await direccionDelBeneficiario(userId, cp.identification, cfg, cp.esEmpresa)
    const cli = await asegurarCliente(t.token, partner, cfg, cp, 'Customer')
    if (!cli.ok) return falla(cli.error)
  }
  clientesEnSiigo.set(`${userId}|${cp.identification}`, Date.now() + SIIGO_CACHE_CLIENTE_MS)

  const monto = Number(String((comp as any).monto ?? '0').replace(/,/g, ''))
  if (!Number.isFinite(monto) || monto <= 0) return falla(`Monto inválido en el comprobante: ${(comp as any).monto}`)
  const impuestos: any[] = Array.isArray(cfg.catalogos?.impuestos) ? cfg.catalogos.impuestos : []
  const ivaElegido = cfg.iva_tax_id ? impuestos.find((x: any) => Number(x.id) === Number(cfg.iva_tax_id)) : null
  // El impuesto del ítem, EN VIVO desde Siigo (GET /v1/products?code=): el
  // catálogo guardado puede ser de antes de ponerle el IVA. Si Siigo no
  // contesta, se usa el catálogo.
  let ivaVivo: { id: number; name: string; percentage: number } | null = null
  let notaVivo = ''
  {
    const rp = rpProd
    const lista: any[] = Array.isArray(rp.data?.results) ? rp.data.results : Array.isArray(rp.data) ? rp.data : []
    const p = lista.find((x: any) => String(x.code) === item) ?? lista[0]
    if (rp.ok && p) {
      const taxes: any[] = Array.isArray(p.taxes) ? p.taxes : []
      const conValor = taxes.filter(x => (Number(x.percentage) || 0) > 0)
      const tx0 = conValor.find(x => /iva/i.test(String(x.name ?? '')) || /iva/i.test(String(x.type ?? ''))) ?? conValor[0]
      if (tx0) ivaVivo = { id: Number(tx0.id), name: String(tx0.name ?? ''), percentage: Number(tx0.percentage) || 0 }
      notaVivo = `Siigo (en vivo) dice que el ítem ${item} tiene ${taxes.length ? taxes.map(x => `${x.name} ${x.percentage ?? 0} %`).join(', ') : 'ningún impuesto'}${p.tax_classification ? ` (clasificación ${p.tax_classification})` : ''}.`
    } else notaVivo = `No se pudo leer el ítem ${item} en vivo (${motivoDe(rp)}); se usó el catálogo guardado.`
  }
  const iva = ivaVivo ?? ivaDelProducto(cfg, item) ?? (ivaElegido ? { id: Number(ivaElegido.id), name: String(ivaElegido.name ?? ''), percentage: Number(ivaElegido.percentage) || 0 } : null)
  const tarifaCatalogo = iva ? iva.percentage / 100 : 0
  const comision = r2(monto * pct / 100)
  const hoy = new Date().toISOString().slice(0, 10)
  const ctx: Record<string, string> = {
    tipo: DISPARADORES[String((comp as any).tipo)] ?? String((comp as any).tipo), numero: String((comp as any).numero ?? ''), contraparte: cp.nombre,
    monto: monto.toLocaleString('es-CO', { maximumFractionDigits: 2 }), fecha: hoy, utilidad: String(pct),
  }
  const plantilla = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k) => ctx[k] ?? `{${k}}`)
  // MODELO COMISIÓN = factura de MANDATO con dos ítems:
  //   1) Ingresos recibidos para terceros = el monto COMPLETO transferido,
  //      sin IVA.
  //   2) Comisión por intermediación: base tal que base + IVA = comisión.
  // 10.000.000 con 1 % → 10.000.000 + 84.033,61 + IVA 15.966,39 =
  // 10.100.000. Antes la línea de terceros era monto − comisión, para que el
  // total diera el monto exacto: así la factura decía que se transfirió
  // menos de lo que se transfirió, y la comisión quedaba descontada en vez
  // de cobrada aparte. En PSP (depósito a mano) sigue solo la comisión.
  const mandato = esMandato(cfg)
  const itemTerceros = String(cfg.item_terceros ?? '').trim()
  if (mandato && !itemTerceros) return falla('Falta elegir en Configuración el ítem de ingresos recibidos para terceros (sin IVA).')
  if (mandato) {
    const ivaT = ivaDelProducto(cfg, itemTerceros)
    if (ivaT) return falla(`El ítem de ingresos para terceros (${itemTerceros}) tiene ${ivaT.name || 'IVA'} ${ivaT.percentage} % en Siigo, y va sin IVA. Elegí otro ítem o quitale el impuesto en Siigo.`)
  }
  // El TERCERO de la línea de ingresos para terceros es a quien se le
  // transfirió la plata (el beneficiario del envío), con su nombre y
  // documento — no el cliente de la factura. Siigo lo permite por ítem
  // (items[].customer) cuando el tipo de documento tiene "customer_by_item".
  // La comisión queda a nombre del cliente. Si el beneficiario no existe en
  // Siigo se crea, igual que al cliente. Sin documento del beneficiario, o si
  // es el mismo cliente (un depósito), la línea queda con el cliente.
  let terceroLinea: { identification: string; branch_office: number } | null = null
  let notaTercero = ''
  if (mandato) {
    const benef = contraparteDe(comp, cfg)
    if (!benef.esDefault && benef.identification && benef.identification !== cp.identification) {
      const claveB = `${userId}|${benef.identification}`
      const cliB = siigoVisto(clientesEnSiigo, claveB) ? { ok: true as const } : await asegurarCliente(t.token, partner, cfg, benef, 'Customer')
      if (cliB.ok) clientesEnSiigo.set(claveB, Date.now() + SIIGO_CACHE_CLIENTE_MS)
      if (cliB.ok) terceroLinea = { identification: benef.identification, branch_office: 0 }
      else notaTercero = `No se pudo registrar en Siigo al beneficiario ${benef.nombre} (${benef.identification}) como tercero de la línea: ${cliB.error}`
      ctx.beneficiario = benef.nombre
    }
  }
  const descripcion = plantilla(cfg.desc_comision || (mandato ? 'Comisión por intermediación en recaudo y dispersión' : 'Comisión {utilidad} % sobre {monto} · Comprobante Lincoin {numero}')).slice(0, 500)
  const descTerceros = plantilla(cfg.desc_terceros || 'Ingresos recibidos para terceros').slice(0, 500)
  const observations = mandato
    ? observacionConMarca([cfg.observaciones || `Factura en desarrollo del contrato de mandato con ${cp.nombre}. Ítem 1: ingresos recibidos para terceros por cuenta del mandante; no constituyen ingreso propio (art. 29 ET). Ítem 2: comisión por intermediación en recaudo y dispersión de pagos, gravada con IVA.`], `Operación según liquidación Lincoin ${(comp as any).numero}`)
    : observacionConMarca([cfg.observaciones], `Comprobante Lincoin ${(comp as any).numero}`, [`Comisión ${pct} % sobre ${ctx.monto} COP (IVA incluido)`])
  // La tarifa que manda es la que SIIGO aplica al ítem, no la del catálogo
  // guardado (puede estar viejo, o Siigo no devolver el impuesto en la lista
  // de productos). Se arma con la del catálogo; si Siigo rechaza el pago
  // porque su total es otro ("The total invoice calculated is X"), de ese X
  // se deduce la tarifa real, se recalcula la base para que base + IVA siga
  // dando la comisión, y se reintenta una vez.
  // RETENCIÓN EN LA FUENTE (PSP / pasarela): si el cliente es persona
  // jurídica con NIT colombiano, la comisión lleva «Retefuente comisiones
  // 11 %», calculada solo sobre la base de la comisión, nunca sobre los
  // terceros (2.440.000 al 0,6 %: base 12.302,52 → retención 1.353,28).
  // Persona natural o del exterior: sin retención. Si el catálogo guardado
  // no la trae, no se emite: saldría sin la retención que corresponde.
  const pideRetencion = String(cfg.modelo ?? '') === 'psp' && cp.esEmpresa && /^\d{9}$/.test(cp.identification)
  const ret = pideRetencion ? retencionComisiones(cfg) : null
  if (pideRetencion && !ret) return falla('El cliente es persona jurídica y la comisión lleva «Retefuente comisiones 11 %», pero esa retención no está en el catálogo de tu Siigo guardado en Lincoin. Actualizá los catálogos en Configuración («Guardar y probar conexión») y emití de nuevo.')
  // El pago, cuando Siigo dijo cuál es el total que espera (con retención).
  let pagoSegunSiigo: number | null = null
  const armar = (tarifa: number) => {
    const base = r2(comision / (1 + tarifa))
    const ivaV = r2(base * tarifa)
    // Mandato: los terceros son el monto transferido, completo; la comisión
    // (base + IVA) va aparte y se suma.
    const terceros = mandato ? r2(monto) : 0
    const bruto = r2(terceros + base + ivaV)
    const retV = ret ? r2(base * ret.percentage / 100) : 0
    // Con retención, el pago es lo que el cliente transfiere (total menos la
    // retención), salvo que Siigo haya dicho que espera otra cifra.
    const total = retV ? r2(pagoSegunSiigo ?? (siigoPagoNeto === false ? bruto : bruto - retV)) : bruto
    // El impuesto va SIEMPRE en la línea cuando hay tarifa: Siigo no aplica
    // por su cuenta el IVA del producto en una factura por API (con 60.000
    // calculó el total sin IVA y rechazó el pago). Los terceros van sin
    // `taxes` (sin IVA 0 %).
    const taxesComision = [...(iva && tarifa > 0 ? [{ id: iva.id }] : []), ...(ret ? [{ id: ret.id }] : [])]
    const items = [
      ...(mandato ? [{ code: itemTerceros, description: descTerceros, quantity: 1, price: terceros, ...(terceroLinea ? { customer: terceroLinea } : {}) }] : []),
      { code: item, description: descripcion, quantity: 1, price: base, ...(taxesComision.length ? { taxes: taxesComision } : {}) },
    ]
    const cuerpo = {
      document: { id: Number(cfg.document_id) }, date: hoy,
      customer: { identification: cp.identification, branch_office: 0 },
      seller: Number(cfg.seller_id),
      stamp: { send: !!cfg.stamp }, mail: { send: !!cfg.mail },
      observations, items,
      payments: [{ id: Number(cfg.payment_id), value: total, due_date: hoy }],
    }
    return { base, ivaV, total, terceros, cuerpo, retV, bruto }
  }
  // Automática (modelo Comisión): la pausa se revisa de nuevo justo antes de
  // mandar la factura a Siigo.
  if (d.auto) {
    const vigente = await leerConfig(userId)
    if (!vigente?.activo) { await marcar({ factura_estado: 'omitida', factura_error: 'Facturación pausada antes de enviar la factura a Siigo.' }); return { ok: true, estado: 'omitida' } }
  }
  // UN 'EMITIENDO' QUE QUEDÓ A MEDIAS (se cerró la pantalla durante un lote,
  // la función se cortó): Siigo pudo haber creado la factura. Antes de
  // reenviar se busca en Siigo; si está, se adopta y no se manda otra a la
  // DIAN. Si no se puede preguntar, no se reenvía.
  const intentoPrevio: any = (detPrevio as any)?.intento ?? null
  // (Si se encoló estando así, la marca de la cola dice cómo estaba.)
  const quedoAMedias = ((comp as any).factura_estado === 'emitiendo' && !(Date.parse(String((comp as any).factura_at ?? '')) > Date.now() - 180000))
    || ((comp as any).factura_estado === 'en_cola' && (detPrevio as any)?.lote?.estado_previo === 'emitiendo')
  // Lo mismo si un intento anterior quedó sin respuesta clara (Siigo no
  // contestó, 5xx, "duplicado"): quedó en error o pendiente, pero la factura
  // pudo haberse creado. Se busca por la marca, a nombre del cliente de ese
  // intento y del de ahora (en «Corregir y reintentar» se puede elegir otro).
  if (quedoAMedias || envioIncierto(detPrevio)) {
    const identV = String(intentoPrevio?.cliente ?? cp.identification)
    const totalV = Number.isFinite(Number(intentoPrevio?.total)) ? Number(intentoPrevio.total) : armar(tarifaCatalogo).total
    const idents = [...new Set([intentoPrevio?.cliente, (detPrevio as any)?.enviado?.customer?.identification, cp.identification].map(x => String(x ?? '').replace(/\D/g, '')).filter(Boolean))]
    // Las anuladas de este movimiento llevan la misma marca: no cuentan.
    const excluir = new Set<string>((Array.isArray(detPrevio.anteriores) ? detPrevio.anteriores as any[] : []).map((a: any) => String(a?.id ?? '')).filter(Boolean))
    if ((comp as any).factura_estado === 'anulada' && (comp as any).factura_id) excluir.add(String((comp as any).factura_id))
    // Por total, solo para el que quedó a medias (las facturas viejas podían
    // tener la marca recortada); si no, dos envíos iguales al mismo cliente
    // se confundirían.
    const b = await facturaDelComprobanteEnSiigo(userId, t.token, partner, idents, desdeParaBuscar(comp), String((comp as any).numero ?? ''), quedoAMedias ? totalV : null, excluir)
    if (!b.ok) {
      const e = quedoAMedias
        ? 'Esta factura quedó a medias y no se pudo revisar en Siigo si ya salió. No se reenvió para no duplicarla: revísala en Siigo Nube (Ventas → Facturas) o intenta en unos minutos.'
        : `Un intento anterior de esta factura no tuvo respuesta clara de Siigo y pudo haberse creado. No se pudo revisar en Siigo (${b.motivo ?? 'sin respuesta'}), así que no se reenvió para no duplicarla. Intenta en unos minutos.`
      // Desde la cola: vuelve a 'emitiendo' (no a error), para que el
      // próximo intento también revise en Siigo antes de mandar nada.
      if (quedoAMedias && (comp as any).factura_estado === 'en_cola') await db.from('comprobantes').update({ factura_estado: 'emitiendo', factura_error: e }).eq('folio', c.folio).eq('factura_estado', 'en_cola')
      return { ok: false, error: e }
    }
    if (b.factura) {
      const f0 = b.factura
      const numero0 = f0.name ?? (f0.number != null ? `${f0.prefix ?? ''}${f0.number}` : null) ?? String(f0.id ?? '')
      const identF = String(f0.customer?.identification ?? identV)
      delete historia.intento
      await marcar({
        factura_estado: 'emitida', factura_error: null, factura_tipo: 'FV', factura_proveedor: 'siigo',
        factura_id: f0.id != null ? String(f0.id) : null, factura_numero: numero0, factura_cufe: f0.stamp?.cufe ?? null, factura_url: f0.public_url ?? null,
        factura_at: new Date().toISOString(),
        factura_detalle: { respuesta: f0, adoptada: true, comision: { pct, comision, total: Number(f0.total) || totalV, cliente: { identification: identF, ...(identF === cp.identification ? { nombre: cp.nombre } : {}) } } },
      })
      return { ok: true, estado: 'emitida', tipo: 'FV', numero: numero0, adoptada: true, aviso: 'Ya estaba emitida en Siigo: se registró esa, no se emitió otra.' }
    }
  }
  // CANDADO: dos clics (o el automático y uno a mano, o la cola) no pueden
  // emitir dos facturas del mismo movimiento ante la DIAN. Se toma el
  // comprobante en 'emitiendo' solo si nadie lo tiene; un 'emitiendo' de hace
  // más de 3 min se da por caído (y ya se revisó arriba que no salió). Se
  // anota a quién y por cuánto, para poder buscarla si este intento se corta.
  {
    const ahoraLock = new Date().toISOString()
    historia.intento = { cliente: cp.identification, total: armar(tarifaCatalogo).total, at: ahoraLock }
    const lock = await actualizarSiAlguna('comprobantes', { factura_estado: 'emitiendo', factura_error: null, factura_at: ahoraLock, factura_detalle: { ...detPrevio, intento: historia.intento } },
      q => q.eq('folio', c.folio), candadoFactura(!!d.cola), 'folio')
    if (lock.error) return { ok: false, error: MSG_SIN_CANDADO(lock.error) }
    if (!lock.tomado) return { ok: false, error: 'Esta factura ya se está emitiendo o ya salió. Espera un momento y recarga.' }
  }
  const intentos: any[] = []
  let tarifa = tarifaCatalogo
  let arm = armar(tarifa)
  let r = await siigo('POST', '/v1/invoices', { token: t.token, partner, body: arm.cuerpo, ms: 70000 })
  intentos.push({ ruta: '/v1/invoices', status: r.status, respuesta: r.data ?? r.texto, enviado: arm.cuerpo, tarifa })
  if (!r.ok) {
    const m = /total invoice calculated is\s*([\d.,]+)/i.exec(motivoDe(r))
    const totalSiigo = m ? Number(m[1].replace(/,/g, '')) : NaN
    if (Number.isFinite(totalSiigo) && arm.retV > 0 && (Math.abs(totalSiigo - arm.bruto) < 1 || Math.abs(totalSiigo - (arm.bruto - arm.retV)) < 1)) {
      // Con retención: Siigo dice si el pago va con o sin descontarla. Se
      // manda su cifra (un rechazo por total no crea nada) y se recuerda.
      siigoPagoNeto = Math.abs(totalSiigo - arm.bruto) >= 1
      pagoSegunSiigo = totalSiigo
      arm = armar(tarifa)
      r = await siigo('POST', '/v1/invoices', { token: t.token, partner, body: arm.cuerpo, ms: 70000 })
      intentos.push({ ruta: '/v1/invoices', status: r.status, respuesta: r.data ?? r.texto, enviado: arm.cuerpo, tarifa, nota: `Pago ajustado al total que calculó Siigo con la retención (${totalSiigo})` })
    } else if (Number.isFinite(totalSiigo) && arm.base > 0 && !arm.retV) {
      const tarifaReal = Math.round(((totalSiigo - arm.terceros) / arm.base - 1) * 10000) / 10000
      // Nunca se cae a "sin IVA" si el ítem tiene IVA: eso facturaría la
      // comisión entera como base (60.000 sin impuesto). Solo se ajusta a
      // otra tarifa positiva que Siigo diga aplicar.
      if (tarifaReal > 0.0001 && tarifaReal < 1 && Math.abs(tarifaReal - tarifa) > 0.0001) {
        tarifa = tarifaReal
        arm = armar(tarifa)
        r = await siigo('POST', '/v1/invoices', { token: t.token, partner, body: arm.cuerpo, ms: 70000 })
        intentos.push({ ruta: '/v1/invoices', status: r.status, respuesta: r.data ?? r.texto, enviado: arm.cuerpo, tarifa, nota: `Tarifa deducida del total que calculó Siigo (${totalSiigo})` })
      }
    }
  }
  if (!r.ok && terceroLinea && /customer_by_item|items?\.?\[?\d*\]?\.?customer|customer.*item/i.test(motivoDe(r))) {
    notaTercero = `El tipo de documento de Siigo no admite tercero por ítem (activá "Manejar terceros por ítem" en la configuración del documento); la línea de terceros quedó a nombre del cliente.`
    terceroLinea = null
    arm = armar(tarifa)
    r = await siigo('POST', '/v1/invoices', { token: t.token, partner, body: arm.cuerpo, ms: 70000 })
    intentos.push({ ruta: '/v1/invoices', status: r.status, respuesta: r.data ?? r.texto, enviado: arm.cuerpo, tarifa, nota: 'Sin tercero por ítem' })
  }
  const { base, ivaV, total, cuerpo } = arm
  if (!r.ok && r.status === 409 && esDuplicadoSiigo(motivoDe(r)) && (d.cola ? Number(d.cola.duplicadas ?? 0) < REINTENTOS_DUPLICADO : Number((comp as any).factura_intentos ?? 0) + 1 < REINTENTOS_DUPLICADO)) {
    const espera = `Siigo la tomó como duplicado de otra factura parecida emitida segundos antes (mismo cliente y valor). Se reintenta sola en unos minutos.`
    if (d.cola) {
      await marcar({ factura_estado: 'en_cola', factura_error: espera, factura_tipo: 'FV', factura_detalle: { enviado: cuerpo, intentos, lote: { ...d.cola, duplicadas: Number(d.cola.duplicadas ?? 0) + 1, no_antes: Date.now() + ESPERA_DUPLICADO_MS } } })
      return { ok: false, error: espera, reintento: true }
    }
    await marcar({ factura_estado: 'pendiente', factura_error: espera, factura_tipo: 'FV', factura_detalle: { enviado: cuerpo, intentos } })
    return { ok: false, error: espera, reintento: true }
  }
  if (!r.ok) return falla(`Siigo rechazó la factura de comisión — ${motivoDe(r)} · Se mandó base ${base} con tarifa ${(tarifa * 100).toFixed(2)} % (${intentos.length} intento${intentos.length === 1 ? '' : 's'}). ${notaVivo}${intentos.length > 1 ? ' Se reintentó con la tarifa que Siigo aplica y tampoco.' : ''}`, { factura_detalle: { enviado: cuerpo, intentos, comision: { pct, comision, base, iva: ivaV, total, tarifa, ...(ret ? { retencion: { id: ret.id, nombre: ret.name, pct: ret.percentage, valor: arm.retV } } : {}), cliente: { identification: cp.identification, nombre: cp.nombre } } } })
  const resp = r.data ?? {}
  const numero = resp.name ?? (resp.number != null ? `${resp.prefix ?? ''}${resp.number}` : null) ?? String(resp.id ?? '')
  delete historia.intento
  await marcar({
    factura_estado: 'emitida', factura_error: null, factura_tipo: 'FV',
    factura_proveedor: 'siigo', factura_id: resp.id != null ? String(resp.id) : null,
    factura_numero: numero, factura_cufe: resp.stamp?.cufe ?? null, factura_url: resp.public_url ?? null,
    factura_at: new Date().toISOString(),
    factura_detalle: { enviado: cuerpo, respuesta: resp, respuesta_creacion: resp, intentos, comision: { pct, comision, base, iva: ivaV, total, tarifa, ...(ret ? { retencion: { id: ret.id, nombre: ret.name, pct: ret.percentage, valor: arm.retV } } : {}), cliente: { identification: cp.identification, nombre: cp.nombre } } },
  })
  return { ok: true, estado: 'emitida', tipo: 'FV', numero, total, base, iva: ivaV, comision, tarifa, cufe: resp.stamp?.cufe ?? null, url: resp.public_url ?? null, ...(notaTercero ? { aviso: notaTercero } : {}) }
}

// ── ¿La factura de este comprobante YA está en Siigo? ──────────────────
// Para un comprobante que quedó 'emitiendo' (se cerró la pantalla durante un
// lote, la función se cortó): Siigo pudo haberla creado. Se buscan las
// facturas del cliente desde el día del intento: la que lleve la marca del
// comprobante en la observación ("Lincoin LC-000978"); si ninguna la lleva
// (la observación se recorta a 500 caracteres), una del mismo total que
// ningún otro comprobante tenga registrada. ok:false = no se pudo preguntar.
// Se busca a nombre de cada cliente dado (el del intento anterior y el de
// ahora) y no cuentan las de `excluir` (las anuladas de este movimiento, que
// llevan la misma marca).
const llevaMarca = (x: any, numero: string) => {
  if (!numero) return false
  const marca = `Lincoin ${numero}`
  const o = String(x?.observations ?? '')
  const i = o.indexOf(marca)
  return i >= 0 && !/\d/.test(o.charAt(i + marca.length))
}
async function facturaDelComprobanteEnSiigo(userId: string, token: string, partner: string, identificaciones: string | string[], desdeIso: string, numero: string, total: number | null, excluir: Set<string> = new Set()): Promise<{ ok: boolean; factura: any | null; motivo?: string }> {
  const d = new Date(Date.parse(desdeIso) || Date.now())
  const desde = new Date(d.getTime() - 86400000).toISOString().slice(0, 10)
  const idents = [...new Set((Array.isArray(identificaciones) ? identificaciones : [identificaciones]).filter(Boolean))]
  const delCliente: any[] = []
  for (const identificacion of idents) {
    for (let page = 1; page <= 10; page++) {
      const r = await siigo('GET', `/v1/invoices?customer_identification=${encodeURIComponent(identificacion)}&date_start=${desde}&page=${page}&page_size=100`, { token, partner, ms: 30000 })
      if (!r.ok) return { ok: false, factura: null, motivo: motivoDe(r) }
      const res: any[] = Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data) ? r.data : []
      delCliente.push(...res.filter(x => !x?.customer?.identification || String(x.customer.identification) === identificacion))
      if (!res.length || page * 100 >= Number(r.data?.pagination?.total_results ?? 0)) break
    }
  }
  const libres = delCliente.filter(x => !(x?.id != null && excluir.has(String(x.id))))
  // Si hay varias con la marca (ya se duplicó), la primera que salió.
  const conMarca = libres.filter(x => llevaMarca(x, numero))
    .sort((a, b) => String(a?.date ?? '').localeCompare(String(b?.date ?? '')) || (Number(a?.number) || 0) - (Number(b?.number) || 0))[0]
  if (conMarca) return { ok: true, factura: conMarca }
  if (total == null || !Number.isFinite(total)) return { ok: true, factura: null }
  // Una con la marca de OTRO comprobante es de ese otro, aunque el total sea igual.
  const mismos = libres.filter(x => x?.id != null && Math.abs(Number(x?.total) - total) < 1 && !/Lincoin LC-\d/.test(String(x?.observations ?? '')))
  if (!mismos.length) return { ok: true, factura: null }
  const { data: usadas } = await db.from('comprobantes').select('factura_id').eq('user_id', userId).in('factura_id', mismos.map(x => String(x.id)))
  const ya = new Set(((usadas ?? []) as any[]).map(u => String(u.factura_id)))
  return { ok: true, factura: mismos.find(x => !ya.has(String(x.id))) ?? null }
}

// ── Facturas duplicadas en Siigo ───────────────────────────────────────
// La contadora de XATECH encontró facturas duplicadas: el mismo movimiento
// facturado dos veces (un intento que Siigo creó sin contestar a tiempo, y
// el reintento). Se leen las facturas de Siigo desde una fecha y se agrupan
// por la marca del comprobante ("Lincoin LC-000123"):
// - dos o más vigentes (sin nota crédito que las cubra) con la misma marca:
//   duplicada; queda la registrada en Lincoin y la otra se anula en Siigo;
// - una vigente que Lincoin no tiene registrada: el próximo «Emitir» la
//   duplicaría; se puede registrar;
// - sin marca, del mismo cliente y total que una de Lincoin: posible
//   duplicada (una hecha a mano en Siigo por un movimiento que Lincoin
//   también facturó). Solo para revisar.
// Solo lee Siigo: anular es con nota crédito, y lo hace la contadora.
const MARCA_LC = /Lincoin (LC-\d+)/
const resumenFactura = (f: any, notas: Map<string, NotaCredito[]>) => {
  const ns = notas.get(String(f?.id)) ?? []
  const total = Number(f?.total) || 0
  return {
    id: String(f?.id ?? ''), numero: String(f?.name ?? `${f?.prefix ?? ''}${f?.number ?? ''}`), fecha: f?.date ?? null, total,
    cliente: String(f?.customer?.identification ?? ''),
    anulada: ns.length > 0 && r2(ns.reduce((a, n) => a + n.total, 0)) >= total - 1,
    notas_credito: ns.map(n => n.nombre),
  }
}
async function revisarDuplicadas(userId: string, dias: number): Promise<any> {
  const cfg = await leerConfig(userId)
  if (!cfg) return { ok: false, error: 'Primero configurá Siigo en Contabilidad → Configuración.' }
  const t = await tokenDe(userId, cfg)
  if ('error' in t) return { ok: false, error: t.error }
  const partner = cfg.partner_id || 'Lincoin'
  const nDias = Math.min(Math.max(Math.round(Number(dias)) || 30, 1), 180)
  const desde = new Date(Date.now() - nDias * 86400000).toISOString().slice(0, 10)
  const facturas: any[] = []
  let completo = true
  for (let page = 1; ; page++) {
    // Tope: 6.000 facturas por revisión (cada página cuenta para el límite).
    if (page > 60) { completo = false; break }
    const r = await siigo('GET', `/v1/invoices?date_start=${desde}&page=${page}&page_size=100`, { token: t.token, partner, ms: 30000 })
    if (!r.ok) return { ok: false, error: `No se pudieron leer las facturas de Siigo — ${motivoDe(r)}` }
    const res: any[] = Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data) ? r.data : []
    facturas.push(...res)
    if (!res.length || page * 100 >= Number(r.data?.pagination?.total_results ?? 0)) break
  }
  let notas: Map<string, NotaCredito[]>
  try { notas = await notasCreditoDesde(t.token, partner, desde) }
  catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) } }

  const porLc = new Map<string, any[]>()
  for (const f of facturas) {
    const m = MARCA_LC.exec(String(f?.observations ?? ''))
    if (m) porLc.set(m[1], [...(porLc.get(m[1]) ?? []), f])
  }
  const lcs = [...porLc.keys()]
  const comps = new Map<string, any>()
  for (let i = 0; i < lcs.length; i += 200) {
    const { data, error } = await db.from('comprobantes').select('folio, numero, transaction_id, tipo, monto, moneda, emitido_at, factura_estado, factura_id, factura_numero, factura_detalle')
      .eq('user_id', userId).in('numero', lcs.slice(i, i + 200))
    if (error) return { ok: false, error: error.message }
    for (const c of (data ?? []) as any[]) comps.set(String(c.numero), c)
  }
  const duplicadas: any[] = []
  const sinRegistrar: any[] = []
  // Vigentes a nombre de la misma empresa: se anulan con nota crédito.
  const propios = await documentosPropios(userId)
  const aSiMisma: any[] = []
  const deLincoinPorClave = new Map<string, any[]>()
  for (const [lc, fs] of porLc) {
    const c = comps.get(lc)
    // Una marca de otra cuenta (o de un comprobante que no existe) no es nuestra.
    if (!c) continue
    const anteriores = new Set((Array.isArray(c.factura_detalle?.anteriores) ? c.factura_detalle.anteriores : []).map((a: any) => String(a?.id ?? '')))
    const lista = fs.map(f => ({ ...resumenFactura(f, notas), registrada: String(f?.id) === String(c.factura_id ?? ''), anterior: anteriores.has(String(f?.id)) }))
      .sort((a, b) => String(a.fecha ?? '').localeCompare(String(b.fecha ?? '')) || a.numero.localeCompare(b.numero, 'es', { numeric: true }))
    const vigentes = lista.filter(f => !f.anulada)
    const mov = {
      folio: c.folio, comprobante: lc, transaction_id: c.transaction_id, tipo: DISPARADORES[String(c.tipo)] ?? String(c.tipo),
      monto: c.monto, moneda: c.moneda, fecha: c.emitido_at, estado: c.factura_estado, registrada: c.factura_numero ?? null,
    }
    const propias = vigentes.filter(f => propios.has(baseDoc(f.cliente)))
    if (propias.length) aSiMisma.push({ ...mov, facturas: propias })
    if (vigentes.length >= 2) duplicadas.push({ ...mov, facturas: lista })
    else if (vigentes.length === 1 && !vigentes[0].registrada && c.factura_estado !== 'emitida' && c.factura_estado !== 'emitiendo') sinRegistrar.push({ ...mov, factura: vigentes[0] })
    for (const f of vigentes) {
      const k = `${f.cliente}|${Math.round(f.total)}`
      deLincoinPorClave.set(k, [...(deLincoinPorClave.get(k) ?? []), { ...f, comprobante: lc }])
    }
  }
  const posibles: any[] = []
  for (const f of facturas) {
    if (MARCA_LC.test(String(f?.observations ?? ''))) continue
    const rf = resumenFactura(f, notas)
    if (rf.anulada) continue
    const pares = deLincoinPorClave.get(`${rf.cliente}|${Math.round(rf.total)}`)
    if (pares?.length) posibles.push({ factura: rf, de_lincoin: pares })
  }
  return { ok: true, desde, dias: nDias, revisadas: facturas.length, completo, duplicadas, sin_registrar: sinRegistrar, a_si_misma: aSiMisma, posibles }
}

// Registra en Lincoin facturas que están en Siigo y Lincoin no tenía (las
// "sin registrar" de la revisión), para que no se vuelvan a emitir. Todo se
// revisa de nuevo acá: que la factura exista, lleve la marca de ESE
// comprobante, no esté anulada y el comprobante no tenga ya otra.
async function registrarDeSiigo(userId: string, pedidas: any[]): Promise<any> {
  const cfg = await leerConfig(userId)
  if (!cfg) return { ok: false, error: 'Primero configurá Siigo en Contabilidad → Configuración.' }
  const t = await tokenDe(userId, cfg)
  if ('error' in t) return { ok: false, error: t.error }
  const partner = cfg.partner_id || 'Lincoin'
  const lista = (Array.isArray(pedidas) ? pedidas : []).slice(0, 200).map(p => ({ folio: Number(p?.folio), id: String(p?.factura_id ?? '') })).filter(p => Number.isFinite(p.folio) && p.id)
  const registradas: string[] = []
  const errores: string[] = []
  const leidas: { p: { folio: number; id: string }; comp: any; f: any }[] = []
  for (const p of lista) {
    const { data: comp } = await db.from('comprobantes').select('*').eq('folio', p.folio).eq('user_id', userId).maybeSingle()
    if (!comp) { errores.push(`Folio ${p.folio}: no es un comprobante de esta cuenta.`); continue }
    const r = await siigo('GET', `/v1/invoices/${encodeURIComponent(p.id)}`, { token: t.token, partner, ms: 30000 })
    if (!r.ok) { errores.push(`${(comp as any).numero}: no se pudo leer la factura en Siigo — ${motivoDe(r)}`); continue }
    if (!llevaMarca(r.data, String((comp as any).numero ?? ''))) { errores.push(`${(comp as any).numero}: la factura ${r.data?.name ?? p.id} no lleva la marca de este comprobante.`); continue }
    leidas.push({ p, comp, f: r.data })
  }
  if (!leidas.length) return { ok: true, registradas, errores }
  const masVieja = leidas.map(x => String(x.f?.date ?? '')).filter(Boolean).sort()[0] ?? new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
  let notas: Map<string, NotaCredito[]>
  try { notas = await notasCreditoDesde(t.token, partner, masVieja) }
  catch (e) { return { ok: false, error: String((e as Error)?.message ?? e), registradas, errores } }
  for (const { p, comp, f } of leidas) {
    const c: any = comp
    const det: any = c.factura_detalle ?? {}
    if (resumenFactura(f, notas).anulada) { errores.push(`${c.numero}: la factura ${f.name ?? p.id} está anulada con nota crédito.`); continue }
    if ((Array.isArray(det.anteriores) ? det.anteriores : []).some((a: any) => String(a?.id) === p.id)) { errores.push(`${c.numero}: la factura ${f.name ?? p.id} es la anulada de este movimiento.`); continue }
    const numero = f.name ?? (f.number != null ? `${f.prefix ?? ''}${f.number}` : null) ?? p.id
    const { lote: _sale, intento: _int, ...resto } = det
    const comision = det.comision || esMandato(cfg)
      ? { comision: { ...(det.comision ?? {}), total: Number(f.total) || det.comision?.total, cliente: { ...(det.comision?.cliente ?? {}), identification: String(f.customer?.identification ?? det.comision?.cliente?.identification ?? '') } } }
      : {}
    const u = await actualizarSiAlguna('comprobantes', {
      factura_estado: 'emitida', factura_error: null, factura_tipo: 'FV', factura_proveedor: 'siigo',
      factura_id: String(f.id), factura_numero: numero, factura_cufe: f.stamp?.cufe ?? null, factura_url: f.public_url ?? null,
      factura_at: new Date().toISOString(),
      factura_detalle: { ...resto, respuesta: f, adoptada: true, adoptada_por: 'revision_duplicadas', ...comision },
    }, q => q.eq('folio', c.folio).eq('user_id', userId), [(q: any) => q.is('factura_estado', null), (q: any) => q.in('factura_estado', ESTADOS_EMITIBLES)], 'folio')
    if (u.tomado) registradas.push(`${c.numero} → ${numero}`)
    else errores.push(u.error ? `${c.numero}: no se pudo guardar (${u.error}).` : `${c.numero}: ya tiene factura o se está emitiendo; no se cambió.`)
  }
  return { ok: true, registradas, errores }
}

// ── Cola de emisión (lote) ─────────────────────────────────────────────
// «Emitir en lote» deja los comprobantes en 'en_cola', con lo necesario
// (cliente, porcentaje) en factura_detalle.lote, y el servidor los emite uno
// por uno en segundo plano. Antes la cola corría en el navegador: al
// cerrarse la pantalla en un lote de 144 se detuvo a mitad, y la que estaba
// saliendo quedó 'emitiendo' sin saber si Siigo la creó.
// Cada vuelta trabaja ~90 s (una función vive 150 s como mucho) y le pasa el
// relevo a una llamada nueva. Si el relevo se pierde, la retoman la app
// (al_dia, config_get) o el cron de facturas al día, mirando el latido.
const COLA_VUELTA_MS = 90_000
const COLA_LATIDO_MS = 150_000
// Cada vez que la cola toma un comprobante cuenta una pasada; con muchas, se
// deja (error, o sin marca de cola) para que la cola siempre termine.
const COLA_MAX_PASADAS = 12
// Si Siigo frena por el límite de consultas (429), la factura vuelve a la cola
// y se reintenta pasado un minuto (la ventana del límite), hasta estas veces.
const COLA_MAX_LIMITES = 6
const COLA_ESPERA_LIMITE_MS = 60_000
const esLimiteSiigo = (e: unknown) => /HTTP 429|requests_limit|rate limit/i.test(String(e ?? ''))
// Pausa entre una factura y la siguiente: reparte las consultas en el minuto.
const COLA_PAUSA_MS = 1_500
const SALIDAS = ['dispersion', 'send', 'pay_sent', 'otc_withdraw']
const claveCola = (userId: string) => `facturacion_cola:${userId}`

// Igual que saveSystemConfig de gasfree: upsert y, si la tabla no tiene la
// clave única, update o insert.
async function guardarSistema(clave: string, valor: string): Promise<void> {
  const up = await db.from('system_config').upsert({ key: clave, value: valor })
  if (up.error) {
    const upd = await db.from('system_config').update({ value: valor }).eq('key', clave).select('key')
    if (!upd.error && !(upd.data?.length)) await db.from('system_config').insert({ key: clave, value: valor })
  }
}
async function colaViva(userId: string): Promise<boolean> {
  const { data } = await db.from('system_config').select('value').eq('key', claveCola(userId)).maybeSingle()
  return Date.now() - Number((data as any)?.value ?? 0) < COLA_LATIDO_MS
}

// Encolar: el servidor decide cómo se emite cada uno (no le cree al
// navegador): en Comisión, una anulada se vuelve a emitir al cliente y con
// el porcentaje de la anulada; un envío va a su ordenante o, si no tiene, al
// cliente elegido; un depósito no se factura. En PSP, un depósito va al
// cliente elegido. En los demás modelos, con las reglas de Configuración.
async function encolarLote(userId: string, body: any): Promise<any> {
  const cfg = await leerConfig(userId)
  if (!cfg) return { ok: false, error: 'Primero configurá Siigo en Contabilidad → Configuración.' }
  if (!cfg.activo) return { ok: false, error: 'La facturación está pausada. Activala en Contabilidad → Configuración para emitir.' }
  const modelo = String(cfg.modelo ?? '')
  const ids = Array.from(new Set((Array.isArray(body.transactionIds) ? body.transactionIds : []).map((x: unknown) => String(x ?? '')).filter(Boolean))).slice(0, 1000) as string[]
  if (!ids.length) return { ok: false, error: 'No hay movimientos para emitir.' }
  const pct = Number(body.comisionPct ?? cfg.utilidad_pct) || 0
  const cl = body.cliente && typeof body.cliente === 'object' ? body.cliente : null
  const docCl = String(cl?.identification ?? '').replace(/\D/g, '')
  const elegido = docCl.length >= 5 ? { identification: docCl, nombre: String(cl?.nombre ?? '').trim().slice(0, 200), esEmpresa: typeof cl?.esEmpresa === 'boolean' ? cl.esEmpresa : docCl.length === 9 } : null
  // La misma empresa no se factura a sí misma: ni como cliente elegido ni
  // como ordenante de un envío.
  const propios = await documentosPropios(userId)
  if (elegido && propios.has(baseDoc(elegido.identification))) return { ok: false, error: `${elegido.nombre || elegido.identification} es la misma empresa que factura: una empresa no se factura a sí misma. Elige el cliente por cuenta de quien se hizo el pago.` }
  const omitidos: { id: string; motivo: string }[] = []
  let encolados = 0
  const ahoraIso = new Date().toISOString()
  for (let i = 0; i < ids.length; i += 150) {
    const parte = ids.slice(i, i + 150)
    const [{ data: txs }, { data: comps }] = await Promise.all([
      db.from('transactions').select('id, user_id, type, amount, currency, status, raw_data').in('id', parte),
      db.from('comprobantes').select('folio, transaction_id, factura_estado, factura_error, factura_at, factura_detalle').eq('user_id', userId).in('transaction_id', parte),
    ])
    const txPorId = new Map(((txs ?? []) as any[]).map(t => [String(t.id), t]))
    const compPorTx = new Map(((comps ?? []) as any[]).map(c => [String(c.transaction_id), c]))
    for (const id of parte) {
      const no = (motivo: string) => { omitidos.push({ id, motivo }) }
      const tx = txPorId.get(id)
      if (!tx || String(tx.user_id) !== userId) { no('Movimiento no encontrado.'); continue }
      if (String(tx.status) !== 'Completado') { no(`La operación está en "${tx.status}".`); continue }
      let comp = compPorTx.get(id)
      if (!comp) {
        const c = await asegurarComprobante(tx, userId)
        if ('error' in c) { no(c.error); continue }
        comp = (await db.from('comprobantes').select('folio, transaction_id, factura_estado, factura_error, factura_at, factura_detalle').eq('folio', c.folio).maybeSingle()).data
        if (!comp) { no('No se pudo leer el comprobante.'); continue }
      }
      const est: string | null = comp.factura_estado ?? null
      if (est === 'emitida') { no('Ya tiene factura.'); continue }
      if (est === 'en_cola') { no('Ya está en la cola.'); continue }
      if (est === 'emitiendo' && Date.parse(String(comp.factura_at ?? '')) > Date.now() - 180000) { no('Se está emitiendo ahora.'); continue }
      const det: any = comp.factura_detalle ?? {}
      const salida = SALIDAS.includes(String(tx.type))
      let lote: Record<string, unknown>
      if (esMandato(cfg)) {
        const yaFueAnulada = est === 'anulada' || (est === 'error' && Array.isArray(det.anteriores) && det.anteriores.length > 0)
        if (!/^COP/i.test(String(tx.currency ?? ''))) { no('La factura en Siigo va en pesos y la operación no es en COP.'); continue }
        if (yaFueAnulada && !salida) { no(`En el modelo ${modelo === 'psp' ? 'PSP' : 'Comisión'} los depósitos no llevan factura: la anulada queda anulada.`); continue }
        if (yaFueAnulada) {
          const ca = det?.comision?.cliente
          if (!ca?.identification) { no('No se sabe a qué cliente iba la factura anulada: emítela desde el movimiento.'); continue }
          if (propios.has(baseDoc(ca.identification))) { no('La factura anulada iba a nombre de la misma empresa: no se vuelve a emitir.'); continue }
          lote = { modo: 'reemitir', cliente: { identification: String(ca.identification), nombre: String(ca.nombre ?? '') }, pct: Number(det?.comision?.pct) || pct, reemplazo: true }
        } else {
          if (!salida) { no(`En el modelo ${modelo === 'psp' ? 'PSP' : 'Comisión'} los depósitos no llevan factura.`); continue }
          const rd: any = tx.raw_data ?? {}
          let cli: { identification: string; nombre: string; esEmpresa: boolean } | null
          if (modelo === 'psp') {
            // PSP: al beneficiario del envío, con el documento con que se le
            // envió. Sin documento no hay a quién facturar.
            const ben = contraparteDe({ detalle: { raw_data: rd }, tipo: tx.type }, cfg)
            if (ben.esDefault) { no('El envío no trae el documento del beneficiario, y en PSP la factura va a su nombre.'); continue }
            cli = { identification: ben.identification, nombre: ben.nombre, esEmpresa: ben.esEmpresa }
          } else {
            const o: any = rd?.recipient?.ordenante ?? rd?.ordenante ?? null
            const docO = String(o?.doc ?? '').replace(/\D/g, '')
            cli = docO ? { identification: docO, nombre: String(o?.nombre ?? ''), esEmpresa: String(o?.docTipo ?? '') === 'NIT' } : elegido
          }
          if (!cli) { no('No tiene ordenante y no se eligió a qué cliente facturarlo.'); continue }
          if (propios.has(baseDoc(cli.identification))) { no(modelo === 'psp' ? 'El beneficiario es la misma empresa (un pago a una cuenta propia): no se factura.' : 'El ordenante es la misma empresa (un pago propio): no se factura.'); continue }
          if (!(pct > 0)) { no('Falta el porcentaje de comisión.'); continue }
          lote = { modo: 'comision', cliente: cli, pct }
        }
      } else {
        lote = { modo: 'directo' }
      }
      let q = db.from('comprobantes').update({
        factura_estado: 'en_cola', factura_error: null,
        factura_detalle: { ...det, lote: { ...lote, estado_previo: est, error_previo: comp.factura_error ?? null, encolado_at: ahoraIso } },
      }).eq('folio', comp.folio)
      q = est == null ? q.is('factura_estado', null) : q.eq('factura_estado', est)
      const { data: tomada, error: eUp } = await q.select('folio')
      if (eUp || !tomada?.length) { no(eUp ? eUp.message : 'Cambió mientras se encolaba; recarga.'); continue }
      encolados++
    }
  }
  // La cola arranca en una llamada propia: encolar muchos puede haber gastado
  // buena parte del tiempo de esta.
  const corriendo = encolados > 0 ? (await colaViva(userId)) || await relevarCola(userId) : false
  return { ok: true, encolados, omitidos, corriendo }
}

// Emite UN comprobante de la cola. Devuelve qué pasó para la cuenta de la
// vuelta; el resultado de verdad queda en el comprobante.
async function emitirDeCola(userId: string, f: any): Promise<'emitida' | 'error' | 'espera' | 'otro' | 'resolucion' | 'comprobante'> {
  const det: any = f.factura_detalle ?? {}
  const lote: any = det.lote ?? {}
  const pasadas = Number(lote.pasadas ?? 0) + 1
  if (pasadas > COLA_MAX_PASADAS) {
    if (f.factura_estado === 'en_cola') {
      await db.from('comprobantes').update({ factura_estado: 'error', factura_error: `No se pudo emitir desde la cola después de ${pasadas - 1} intentos. Reintenta desde el movimiento.` }).eq('folio', f.folio).eq('factura_estado', 'en_cola')
    } else {
      // Un 'emitiendo' a medias que no se pudo revisar en Siigo: sale de la
      // cola pero sigue 'emitiendo', para que el próximo intento revise antes.
      const { lote: _sale, ...resto } = det
      await db.from('comprobantes').update({ factura_detalle: resto, factura_error: 'Quedó a medias y no se pudo revisar en Siigo si salió. Revísala en Siigo Nube antes de reintentar.' }).eq('folio', f.folio).eq('factura_estado', f.factura_estado)
    }
    return 'error'
  }
  await db.from('comprobantes').update({ factura_detalle: { ...det, lote: { ...lote, pasadas } } }).eq('folio', f.folio).eq('factura_estado', f.factura_estado)
  let r: any
  try {
    if (lote.modo === 'directo') r = await emitir(Number(f.folio), { forzar: true, desdeCola: true })
    else r = await emitirComision(userId, String(f.transaction_id), {
      identification: String(lote.cliente?.identification ?? ''), nombre: lote.cliente?.nombre ? String(lote.cliente.nombre) : undefined,
      esEmpresa: typeof lote.cliente?.esEmpresa === 'boolean' ? lote.cliente.esEmpresa : undefined,
      pct: Number(lote.pct) || undefined, reemplazo: !!lote.reemplazo, cola: { ...lote, pasadas },
    })
  } catch (e) { r = { ok: false, error: String((e as Error)?.message ?? e) } }
  if (r?.ok && (r.estado === 'emitida' || r.numero)) return 'emitida'
  if (r?.reintento) return 'espera'
  if (!r?.ok && esErrorResolucion(r?.error)) return 'resolucion'
  if (!r?.ok && esErrorComprobante(r?.error)) return 'comprobante'
  // Frenada por el límite de consultas de Siigo: no se creó nada (un 429 se
  // rechaza antes de procesar). Vuelve a la cola y se reintenta en un minuto,
  // en vez de quedar en error como las 36 de un lote de XATECH.
  if (!r?.ok && esLimiteSiigo(r?.error) && Number(lote.limites ?? 0) < COLA_MAX_LIMITES) {
    const { data: tras } = await db.from('comprobantes').select('factura_estado, factura_detalle').eq('folio', f.folio).maybeSingle()
    const est = String((tras as any)?.factura_estado ?? '')
    if (est === 'error' || est === 'en_cola') {
      await db.from('comprobantes').update({
        factura_estado: 'en_cola', factura_error: 'Siigo pidió esperar (límite de consultas por minuto). Se reintenta sola en un momento.',
        factura_detalle: { ...((tras as any)?.factura_detalle ?? {}), lote: { ...lote, pasadas, limites: Number(lote.limites ?? 0) + 1, no_antes: Date.now() + COLA_ESPERA_LIMITE_MS } },
      }).eq('folio', f.folio).eq('factura_estado', est)
      return 'espera'
    }
  }
  // Si contestó sin tomarla (operación no completada, falta configuración),
  // sigue 'en_cola': pasa a error con el motivo, o la cola la repetiría.
  const { data: ahora } = await db.from('comprobantes').select('factura_estado').eq('folio', f.folio).maybeSingle()
  if ((ahora as any)?.factura_estado === 'en_cola') {
    await db.from('comprobantes').update({ factura_estado: 'error', factura_error: String(r?.error ?? 'No se pudo emitir.') }).eq('folio', f.folio).eq('factura_estado', 'en_cola')
  }
  return r?.ok ? 'otro' : 'error'
}

// Lo que la cola tiene por hacer: lo encolado, y lo que ella misma dejó
// 'emitiendo' hace más de 5 min (se cortó a mitad: se revisa en Siigo).
async function pendientesDeCola(userId: string): Promise<any[]> {
  const viejo = new Date(Date.now() - 300_000).toISOString()
  const { data } = await db.from('comprobantes').select('folio, transaction_id, factura_estado, factura_at, factura_detalle')
    .eq('user_id', userId).or(`factura_estado.eq.en_cola,and(factura_estado.eq.emitiendo,factura_at.lt.${viejo})`)
    .order('folio', { ascending: true }).limit(100)
  return ((data ?? []) as any[]).filter(f => f.factura_estado === 'en_cola' || f.factura_detalle?.lote)
}

async function procesarCola(userId: string): Promise<{ emitidas: number; errores: number; quedan: number; relevo: boolean }> {
  const inicio = Date.now()
  const out = { emitidas: 0, errores: 0, quedan: 0, relevo: false }
  await guardarSistema(claveCola(userId), String(inicio))
  const cfg = await leerConfig(userId)
  // Pausada: la cola espera; al activarla la retoman la app o el cron.
  if (!cfg?.activo) { await guardarSistema(claveCola(userId), '0'); return out }
  const vistos = new Set<number>()
  while (Date.now() - inicio < COLA_VUELTA_MS) {
    const filas = (await pendientesDeCola(userId)).filter(f => !vistos.has(Number(f.folio)))
    if (!filas.length) break
    const ahora = Date.now()
    const lista = filas.find(f => !(Number(f.factura_detalle?.lote?.no_antes) > ahora))
    if (!lista) {
      // Solo quedan duplicadas esperando a Siigo: se espera acá si alcanza.
      const prox = Math.min(...filas.map(f => Number(f.factura_detalle?.lote?.no_antes) || ahora))
      if (prox - inicio > COLA_VUELTA_MS) break
      await new Promise(r => setTimeout(r, Math.max(1000, prox - Date.now())))
      continue
    }
    vistos.add(Number(lista.folio))
    const r = await emitirDeCola(userId, lista)
    if (r === 'emitida') out.emitidas++
    else if (r === 'error') out.errores++
    else if (r === 'resolucion' || r === 'comprobante') {
      // La resolución DIAN está vencida o agotada, o el comprobante no es de
      // factura electrónica: TODAS las que siguen van a fallar igual. Salen
      // de la cola con el motivo, sin llamar a Siigo, y la cola para. Se
      // vuelven a emitir desde «Sin factura» cuando se arregle en Siigo o en
      // Configuración.
      out.errores++
      await cancelarCola(userId, r === 'resolucion' ? MSG_RESOLUCION_DIAN : MSG_COMPROBANTE_NO_ELECTRONICO)
      break
    }
    await guardarSistema(claveCola(userId), String(Date.now()))
    if (Date.now() - inicio < COLA_VUELTA_MS) await new Promise(res => setTimeout(res, COLA_PAUSA_MS))
  }
  out.quedan = (await pendientesDeCola(userId)).length
  if (out.quedan > 0) out.relevo = await relevarCola(userId)
  else await guardarSistema(claveCola(userId), '0')
  return out
}

// El relevo: una llamada nueva a esta misma función, que contesta enseguida
// y sigue con la cola en segundo plano.
async function relevarCola(userId: string): Promise<boolean> {
  await guardarSistema(claveCola(userId), '0')
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/facturacion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'cola_seguir', userId }),
      signal: AbortSignal.timeout(20000),
    })
    return r.ok
  } catch (e) {
    console.error('[facturacion] relevo de la cola', userId, String((e as Error)?.message ?? e))
    return false
  }
}

// Si hay cola y nadie la está trabajando (se perdió un relevo), se retoma.
async function reanudarCola(userId: string): Promise<boolean> {
  const { count } = await db.from('comprobantes').select('folio', { count: 'exact', head: true }).eq('user_id', userId).eq('factura_estado', 'en_cola')
  if (!count || await colaViva(userId)) return false
  return relevarCola(userId)
}

// Detener: lo que sigue en cola vuelve a como estaba antes de encolarlo.
// Con `motivo` (la cola se cortó sola, p. ej. por la resolución DIAN), las que
// no tenían factura quedan en error con ese motivo, a la vista en «Sin
// factura»; una anulada vuelve a anulada, o se perdería que estuvo anulada.
async function cancelarCola(userId: string, motivo?: string): Promise<number> {
  let n = 0
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const { data } = await db.from('comprobantes').select('folio, factura_detalle').eq('user_id', userId).eq('factura_estado', 'en_cola').limit(200)
    const filas = (data ?? []) as any[]
    for (const f of filas) {
      const { lote, ...resto } = (f.factura_detalle ?? {}) as any
      const previo = lote?.estado_previo ?? null
      const conMotivo = !!motivo && previo !== 'anulada'
      const { data: u } = await db.from('comprobantes').update({ factura_estado: conMotivo ? 'error' : previo, factura_error: conMotivo ? motivo : lote?.error_previo ?? null, factura_detalle: resto })
        .eq('folio', f.folio).eq('factura_estado', 'en_cola').select('folio')
      if (u?.length) n++
    }
    if (filas.length < 200) break
  }
  return n
}

// Clientes de Siigo, para elegir a quién se le factura la comisión. Por
// documento la API filtra; por nombre no, así que se traen páginas y se
// filtra acá (tope razonable).
async function buscarClientes(userId: string, q: string): Promise<{ ok: boolean; clientes?: any[]; error?: string }> {
  const cfg = await leerConfig(userId)
  if (!cfg) return { ok: false, error: 'Primero configurá Siigo.' }
  const partner = cfg.partner_id || 'Lincoin'
  const t = await tokenDe(userId, cfg)
  if ('error' in t) return { ok: false, error: t.error }
  const fila = (x: any) => ({ id: x.id ?? null, identification: String(x.identification ?? ''), nombre: Array.isArray(x.name) ? x.name.join(' ') : String(x.name ?? x.commercial_name ?? ''), comercial: x.commercial_name ?? null, esEmpresa: String(x.person_type ?? '') === 'Company' || String(x.id_type?.code ?? x.id_type ?? '') === '31', activo: x.active !== false })
  const digitos = q.replace(/\D/g, '')
  if (digitos.length >= 5 && digitos.length === q.replace(/[\s.\-]/g, '').length) {
    const r = await siigo('GET', `/v1/customers?identification=${encodeURIComponent(digitos.length === 10 ? digitos.slice(0, 9) : digitos)}`, { token: t.token, partner })
    if (!r.ok) return { ok: false, error: `Siigo — ${motivoDe(r)}` }
    const lista: any[] = Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data) ? r.data : []
    return { ok: true, clientes: lista.map(fila) }
  }
  const n = q.trim().toLowerCase()
  const out: any[] = []
  for (let page = 1; page <= 8 && out.length < 30; page++) {
    const r = await siigo('GET', `/v1/customers?page=${page}&page_size=100`, { token: t.token, partner })
    if (!r.ok) return { ok: false, error: `Siigo — ${motivoDe(r)}` }
    const lista: any[] = Array.isArray(r.data?.results) ? r.data.results : []
    for (const x of lista) { const f = fila(x); if (!n || f.nombre.toLowerCase().includes(n) || String(f.comercial ?? '').toLowerCase().includes(n) || f.identification.includes(n)) out.push(f) }
    const total = Number(r.data?.pagination?.total_results ?? 0)
    if (!lista.length || page * 100 >= total) break
  }
  return { ok: true, clientes: out.slice(0, 30) }
}

// Lo que el contador puede pedir sin que quede en el audit_log de la empresa:
// solo lee (todo lo demás cambia la facturación o emite ante la DIAN).
const ACCIONES_DE_LECTURA = new Set(['config_get', 'documento', 'documento_pdf', 'duplicadas', 'comprobantes', 'ordenantes_get', 'buscar_clientes', 'facturas', 'probar'])

async function esContadorDe(contadorId: string, empresaId: string): Promise<boolean> {
  const [{ data: emp }, { data: yo }] = await Promise.all([
    db.from('users').select('role, raw_data').eq('id', empresaId).maybeSingle(),
    db.from('users').select('role, raw_data').eq('id', contadorId).maybeSingle(),
  ])
  if (!emp || (emp as any).role !== 'business') return false
  const lista: any[] = Array.isArray((emp as any).raw_data?.contadores) ? (emp as any).raw_data.contadores : []
  if (lista.some(c => c && String(c.id) === contadorId)) return true
  // Accesos del esquema anterior (cuenta con rol contador).
  return (yo as any)?.role === 'contador' && String((yo as any)?.raw_data?.contadorDe ?? '') === empresaId
}

// ══════════════════════════════════════════════════════════════════
//  FACTURAS DE LINCOIN (la empresa) A SUS CLIENTES
//
//  Todo lo de arriba opera el Siigo de CADA cliente. Esto es otra cosa: el
//  Siigo de Lincoin, que le factura a cada cliente por cada cargue y cada
//  conversión. Es una factura de MANDATO con dos líneas:
//    1) Ingresos recibidos para terceros = lo que es del cliente, sin IVA.
//    2) Comisión de Lincoin = la utilidad de la operación, IVA INCLUIDO
//       (base + IVA = utilidad).
//  Total = terceros + utilidad. La utilidad sale de liquidacionDe (la misma
//  cuenta que muestra el tablero de Contabilidad); si la operación no la
//  guardó, o es una estimación (mesa OTC), queda en 'revision' y un admin la
//  confirma: no se factura un número que nadie verificó.
//
//  Config: una sola fila en facturacion_lincoin (credenciales cifradas como
//  las del cliente). Facturas: facturas_lincoin, una por operación
//  (transaction_id UNIQUE) con candado 'emitiendo' para no duplicar ante la
//  DIAN. Solo la llama el sistema: admin-data (con permisos) y el aviso de
//  operación completada (notify-transaction), los dos con la llave del
//  servicio.
// ══════════════════════════════════════════════════════════════════
const CLAVE_TOKEN_LINCOIN = '__lincoin__'
const OPERACIONES_LINCOIN: Record<string, string> = { cargue: 'Cargues', conversion: 'Conversiones' }
const ESTADOS_REEMITIBLES = 'pendiente,error,revision,omitida'
const faltaTablaLincoin = (m: string) => /42P01|does not exist|schema cache|PGRST20[45]/i.test(m)
const MIGRACION_LINCOIN = 'Falta correr la migración 2026_zz9_facturacion_lincoin.sql en la base.'

async function leerConfigLincoin(): Promise<{ cfg: any | null; falta: boolean }> {
  const { data, error } = await db.from('facturacion_lincoin').select('*').eq('id', 1).maybeSingle()
  if (error) return { cfg: null, falta: faltaTablaLincoin(error.message) }
  return { cfg: data ?? null, falta: false }
}

async function publicaLincoin(cfg: any) {
  if (!cfg) return { existe: false, activo: false, tieneAccessKey: false, operaciones: Object.keys(OPERACIONES_LINCOIN), stamp: true, mail: true }
  // Sin pista de la access key (ver publica): solo si hay una guardada.
  const { access_key_enc, ...resto } = cfg
  return { existe: true, ...resto, tieneAccessKey: !!access_key_enc }
}

// ── ¿La factura YA está en Siigo? ─────────────────────────────────────
// Cuando Siigo no contestó a tiempo (o la función se cortó a mitad del
// envío), la factura PUDO haberse creado. Reenviarla a ciegas es mandar dos
// a la DIAN por la misma operación. Antes de cualquier reintento se busca:
// facturas del cliente desde el día del primer intento cuya observación
// lleve la marca de ESTA operación (y el mismo total, si se sabe).
// ok:false = no se pudo preguntar → NO se reenvía; se pide revisar a mano.
async function buscarFacturaLincoinEnSiigo(token: string, partner: string, identificacion: string, desdeIso: string, marca: string, total: number | null): Promise<{ ok: boolean; factura: any | null }> {
  const d = new Date(Date.parse(desdeIso) || Date.now())
  const desde = new Date(d.getTime() - 2 * 86400000).toISOString().slice(0, 10)
  const ruta = `/v1/invoices?customer_identification=${encodeURIComponent(identificacion)}&date_start=${desde}&page_size=100`
  const r = await siigo('GET', ruta, { token, partner, ms: 30000 })
  if (!r.ok) return { ok: false, factura: null }
  const lista: any[] = Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data) ? r.data : []
  const hit = lista.find((x: any) =>
    String(x?.observations ?? '').includes(marca) &&
    (total == null || !Number.isFinite(Number(x?.total)) || Math.abs(Number(x.total) - total) < 1)) ?? null
  return { ok: true, factura: hit }
}
const MSG_INCIERTA = 'Siigo no confirmó si la factura se creó. Antes de volver a enviarla se busca en Siigo: usa «Verificar y reintentar» (o revísala en Siigo Nube → Ventas → Facturas).'

async function resumenLincoin(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (let off = 0; off < 40000; off += 1000) {
    const { data, error } = await db.from('facturas_lincoin').select('estado').order('id', { ascending: true }).range(off, off + 999)
    if (error) break
    for (const f of (data ?? []) as any[]) out[String(f.estado)] = (out[String(f.estado)] ?? 0) + 1
    if (!data || data.length < 1000) break
  }
  return out
}

// El cliente de Lincoin como cliente de la factura: su NIT (empresa) o su
// documento (persona), su nombre y su correo. La dirección se busca solo si
// hay que CREARLO en Siigo (la de su ficha; para una empresa, el RUES; si no
// aparece, Bogotá con la ciudad marcada como no verificada).
async function clienteLincoin(userId: string): Promise<{ cp: Contraparte; u: any } | { error: string }> {
  const { data: u } = await db.from('users').select('*').eq('id', userId).maybeSingle()
  if (!u) return { error: 'No se encontró la ficha del cliente.' }
  const rd = ((u as any).raw_data ?? {}) as Record<string, any>
  const x = u as any
  const docEmpresa = String(x.tax_id ?? rd.taxId ?? '').replace(/\D/g, '')
  const docPersona = String(x.doc_number ?? rd.docNumber ?? '').replace(/\D/g, '')
  const esEmpresa = !!docEmpresa && (x.role === 'business' || !!(x.company_name ?? rd.companyName))
  const doc = esEmpresa ? docEmpresa : (docPersona || docEmpresa)
  if (!doc) return { error: 'El cliente no tiene NIT ni documento en su ficha. Completalo en Clientes y emití de nuevo.' }
  const nombre = String(esEmpresa
    ? (x.company_name ?? rd.companyName ?? x.full_name ?? '')
    : (x.full_name ?? ([x.first_name ?? rd.firstName, x.last_name ?? rd.lastName].filter(Boolean).join(' ') || ''))).trim() || doc
  const partes = esEmpresa ? partirNit(doc) : { identification: doc }
  return { cp: { ...partes, nombre, esDefault: false, esEmpresa, direccion: null, email: x.email ? String(x.email) : null }, u }
}

async function direccionLincoin(u: any, cp: Contraparte): Promise<Direccion> {
  const rd = (u?.raw_data ?? {}) as Record<string, any>
  let calle = limpiarDireccion(String((cp.esEmpresa ? (u?.company_address ?? rd.companyAddress ?? u?.address) : (u?.address ?? rd.address)) ?? '')) || SIN_CALLE
  let m = cp.esEmpresa
    ? (municipioPorNombre(u?.company_city) ?? municipioPorNombre(rd.companyCity) ?? municipioPorNombre(u?.city))
    : (municipioPorNombre(u?.city) ?? municipioPorNombre(rd.city))
  if (!m && cp.esEmpresa) {
    const r = await domicilioEmpresa(cp.identification)
    if (r.domicilio?.municipio) {
      m = r.domicilio.municipio as any
      if (calle === SIN_CALLE && r.domicilio.direccion) calle = limpiarDireccion(r.domicilio.direccion) || SIN_CALLE
    }
  }
  if (m) return { address: calle, city: { country_code: 'Co', state_code: m.depto, city_code: m.codigo } }
  const bogota = municipioPorCodigo('11001')!
  return { address: limpiarDireccion(`${calle} - Ciudad no verificada`), city: { country_code: 'Co', state_code: bogota.depto, city_code: bogota.codigo } }
}

// Emite (o deja anotado por qué no) la factura de Lincoin de UNA operación.
// manual = la pide un admin: se emite aunque la automática esté pausada o la
// operación sea anterior a "desde". utilidad = la que confirmó o corrigió el
// admin (obligatoria cuando la registrada falta o es estimada).
async function emitirLincoin(txId: string, opts: { manual?: boolean; utilidad?: number | null; adminId?: string | null } = {}): Promise<any> {
  const { cfg, falta } = await leerConfigLincoin()
  if (falta) return { ok: false, error: MIGRACION_LINCOIN }
  if (!cfg) return { ok: false, error: 'Primero configurá el Siigo de Lincoin en Contabilidad → Facturación.' }
  if (!opts.manual && !cfg.activo) return { ok: true, estado: 'omitida', motivo: 'La facturación de Lincoin está pausada.' }
  const { data: tx } = await db.from('transactions').select('id, user_id, type, amount, currency, status, created_at, raw_data').eq('id', txId).maybeSingle()
  if (!tx) return { ok: false, error: 'movimiento_no_encontrado' }
  const t = tx as any
  const rd = (t.raw_data ?? {}) as Record<string, any>
  let cierre: any = null
  if (rd.otcCloseId) {
    const { data } = await db.from('otc_closes').select('id, side, from_amount, to_amount, rate_final, rate_fuente').eq('id', String(rd.otcCloseId)).maybeSingle()
    cierre = data ?? null
  }
  const liq: Liquidacion | null = liquidacionDe(t, cierre)
  if (!liq) return { ok: false, error: String(t.status) !== 'Completado' ? `La operación está en "${t.status}". Solo se factura cuando queda Completada.` : 'Esta operación no es un cargue ni una conversión.' }
  const ops: string[] = Array.isArray(cfg.operaciones) ? cfg.operaciones : Object.keys(OPERACIONES_LINCOIN)
  if (!opts.manual && !ops.includes(liq.tipo)) return { ok: true, estado: 'omitida', motivo: `Las ${OPERACIONES_LINCOIN[liq.tipo]?.toLowerCase() ?? liq.tipo} no se facturan solas (Configuración).` }
  if (!opts.manual && cfg.desde && Date.parse(String(t.created_at)) < Date.parse(String(cfg.desde))) return { ok: true, estado: 'omitida', motivo: 'Operación anterior a la fecha desde la que se factura sola.' }

  // La fila de la factura: una por operación. Si ya existe, se usa esa.
  const ahora = () => new Date().toISOString()
  const ins = await db.from('facturas_lincoin').upsert({
    transaction_id: String(t.id), user_id: String(t.user_id), tipo: liq.tipo, operacion_at: t.created_at, moneda: 'COP',
    total: liq.totalCop, terceros: liq.tercerosCop, utilidad: liq.utilidadCop, utilidad_fuente: liq.fuente,
  }, { onConflict: 'transaction_id', ignoreDuplicates: true })
  if (ins.error) return { ok: false, error: faltaTablaLincoin(ins.error.message) ? MIGRACION_LINCOIN : `No se pudo registrar la factura: ${ins.error.message}` }
  const { data: filaD } = await db.from('facturas_lincoin').select('*').eq('transaction_id', String(t.id)).maybeSingle()
  const fila = filaD as any
  if (!fila) return { ok: false, error: 'No se pudo leer la factura de la operación.' }
  if (fila.estado === 'emitida' && fila.numero) return { ok: true, estado: 'emitida', numero: fila.numero, yaEstaba: true }
  if (fila.estado === 'emitiendo' && Date.parse(String(fila.updated_at)) > Date.now() - 180000) return { ok: false, error: 'Esta factura se está emitiendo. Esperá un momento y recargá.' }
  // La automática solo trabaja las nuevas o las que quedaron 'pendiente'. Un
  // error o una revisión los mira una persona: reintentarlos solo no los arregla.
  if (!opts.manual && fila.estado !== 'pendiente') return { ok: true, estado: fila.estado }
  // 'incierta' o un 'emitiendo' viejo: Siigo pudo haberla creado. Se verifica
  // en Siigo antes de mandar nada (más abajo, ya con la credencial).
  const porVerificar = fila.estado === 'incierta' || fila.estado === 'emitiendo'
  const marcar = async (patch: Record<string, unknown>, cuenta = true) => {
    // Una incierta no se "olvida": si ahora no se puede emitir (falta la
    // utilidad, cambió algo), sigue incierta — pasar a 'revision' o 'error'
    // haría que el próximo intento la mande sin verificar en Siigo.
    const p0 = porVerificar && !['emitida', 'incierta', 'emitiendo'].includes(String(patch.estado ?? ''))
      ? { ...patch, estado: 'incierta' } : patch
    await db.from('facturas_lincoin').update({ ...p0, ...(cuenta ? { intentos: Number(fila.intentos ?? 0) + 1 } : {}), updated_at: ahora() }).eq('id', fila.id)
  }

  // ── Cuánto y de qué ────────────────────────────────────────────────
  if (!liq.facturable) { await marcar({ estado: 'omitida', error: liq.nota }, false); return { ok: true, estado: 'omitida', motivo: liq.nota } }
  let utilidad = liq.utilidadCop, terceros = liq.tercerosCop, totalOp = liq.totalCop
  let fuente: string = liq.fuente
  if (opts.utilidad != null) {
    const uM = r2(Number(opts.utilidad))
    if (!Number.isFinite(uM) || uM <= 0) return { ok: false, error: 'La utilidad tiene que ser un valor mayor que cero.' }
    if (liq.fijo === 'total') {
      if (totalOp == null) return { ok: false, error: 'No se sabe cuánto pagó el cliente en esta operación: no se puede armar la factura.' }
      terceros = r2(totalOp - uM)
    } else {
      if (terceros == null) return { ok: false, error: 'No se sabe cuánto recibió el cliente en esta operación: no se puede armar la factura.' }
      totalOp = r2(terceros + uM)
    }
    utilidad = uM
    fuente = 'manual'
  } else if (liq.fuente !== 'registrada') {
    const e = liq.fuente === 'estimada'
      ? `${liq.nota} Utilidad estimada: ${Number(liq.utilidadCop ?? 0).toLocaleString('es-CO')} COP.`
      : `${liq.nota} Escribí la utilidad de Lincoin para emitirla.`
    await marcar({ estado: 'revision', error: e, total: liq.totalCop, terceros: liq.tercerosCop, utilidad: liq.utilidadCop, utilidad_fuente: liq.fuente }, false)
    return { ok: false, revision: true, error: e, sugerida: liq.utilidadCop }
  }
  if (utilidad == null || utilidad <= 0) {
    const e = `Sin utilidad para Lincoin en esta operación (${Number(utilidad ?? 0).toLocaleString('es-CO')} COP): no hay comisión que facturar.`
    await marcar({ estado: 'omitida', error: e, utilidad, utilidad_fuente: fuente }, false)
    return { ok: true, estado: 'omitida', motivo: e }
  }
  if (terceros == null || totalOp == null || terceros < 0) return { ok: false, error: 'Los valores de la operación no cuadran (terceros negativo o faltante). Revisá el movimiento.' }

  const falla = async (e: string, extra: Record<string, unknown> = {}) => { await marcar({ estado: 'error', error: e, total: totalOp, terceros, utilidad, utilidad_fuente: fuente, ...extra }); return { ok: false, error: e } }
  const faltan = ['document_id', 'seller_id', 'payment_id', 'item_terceros', 'item_comision'].filter(k => !cfg[k])
  if (faltan.length) return falla(`Falta elegir en Configuración: ${faltan.join(', ')}.`)
  const itemT = String(cfg.item_terceros).trim(), itemC = String(cfg.item_comision).trim()
  const ivaT = ivaDelProducto(cfg, itemT)
  if (ivaT) return falla(`El ítem de ingresos para terceros (${itemT}) tiene ${ivaT.name || 'IVA'} ${ivaT.percentage} % en Siigo, y va sin IVA. Elegí otro ítem o quitale el impuesto en Siigo.`)

  const partner = cfg.partner_id || 'Lincoin'
  const tk = await tokenDe(CLAVE_TOKEN_LINCOIN, cfg)
  if ('error' in tk) return falla(tk.error)
  const cli = await clienteLincoin(String(t.user_id))
  if ('error' in cli) return falla(cli.error)
  const cp = cli.cp

  // ¿Ya existe en Siigo? y el IVA del ítem de comisión EN VIVO, en paralelo.
  const [buscaCli, rpProd] = await Promise.all([
    siigo('GET', `/v1/customers?identification=${encodeURIComponent(cp.identification)}`, { token: tk.token, partner }),
    siigo('GET', `/v1/products?code=${encodeURIComponent(itemC)}`, { token: tk.token, partner }),
  ])
  const listaCli: any[] = Array.isArray(buscaCli.data?.results) ? buscaCli.data.results : Array.isArray(buscaCli.data) ? buscaCli.data : []
  if (!(buscaCli.ok && listaCli.some(x => String(x?.identification ?? '') === cp.identification))) {
    cp.direccion = await direccionLincoin(cli.u, cp)
    const a = await asegurarCliente(tk.token, partner, cfg, cp, 'Customer')
    if ('error' in a) return falla(a.error)
  }
  let iva: { id: number; name: string; percentage: number } | null = null
  {
    const lista: any[] = Array.isArray(rpProd.data?.results) ? rpProd.data.results : Array.isArray(rpProd.data) ? rpProd.data : []
    const p = lista.find((x: any) => String(x.code) === itemC) ?? null
    const conValor = (Array.isArray(p?.taxes) ? p.taxes : []).filter((x: any) => (Number(x.percentage) || 0) > 0)
    const t0 = conValor.find((x: any) => /iva/i.test(String(x.name ?? '')) || /iva/i.test(String(x.type ?? ''))) ?? conValor[0]
    if (t0) iva = { id: Number(t0.id), name: String(t0.name ?? ''), percentage: Number(t0.percentage) || 0 }
  }
  if (!iva) iva = ivaDelProducto(cfg, itemC)
  if (!iva && cfg.iva_tax_id) {
    const imp: any[] = Array.isArray(cfg.catalogos?.impuestos) ? cfg.catalogos.impuestos : []
    const e = imp.find((x: any) => Number(x.id) === Number(cfg.iva_tax_id))
    if (e) iva = { id: Number(e.id), name: String(e.name ?? ''), percentage: Number(e.percentage) || 0 }
  }
  if (!iva) return falla(`El ítem de comisión (${itemC}) no tiene IVA en Siigo y no se eligió uno en Configuración. La comisión va gravada: ponele el IVA al ítem en Siigo.`)

  const hoy = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10)
  const fechaOp = new Date(Date.parse(String(t.created_at)) - 5 * 3600_000).toISOString().slice(0, 10)
  const ctx: Record<string, string> = {
    tipo: liq.tipo === 'cargue' ? 'Cargue' : 'Conversión', fecha: fechaOp, cliente: cp.nombre,
    usd: liq.usd != null ? `${liq.usd.toLocaleString('es-CO', { maximumFractionDigits: 2 })} USD` : '',
    ref: String(rd.otcRef ?? String(t.id).slice(0, 8)),
  }
  const plantilla = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k) => ctx[k] ?? '').replace(/\s+·\s+·/g, ' ·').trim()
  const descT = plantilla(cfg.desc_terceros || 'Ingresos recibidos para terceros · {tipo} {fecha}').slice(0, 500)
  const descC = plantilla(cfg.desc_comision || 'Comisión Lincoin · {tipo} {fecha}').slice(0, 500)
  // La marca de la operación va PRIMERO: es con lo que se la reconoce en
  // Siigo si un envío queda sin respuesta, y al final la cortaba el tope de
  // 500 caracteres cuando la observación configurada es larga.
  const marcaOp = `${ctx.tipo} del ${fechaOp} · ref ${ctx.ref}`
  const observations = [
    marcaOp,
    cfg.observaciones || `Factura en desarrollo del contrato de mandato con ${cp.nombre}. Ítem 1: ingresos recibidos para terceros, valor de la operación que corresponde al cliente; no constituye ingreso propio de Lincoin. Ítem 2: comisión de Lincoin por la operación, IVA incluido.`,
  ].filter(Boolean).join(' · ').slice(0, 500)
  const armar = (tarifa: number) => {
    const base = r2(utilidad! / (1 + tarifa))
    const ivaV = r2(base * tarifa)
    // Los terceros absorben el redondeo: el total es el de la operación.
    const tercerosV = r2(totalOp! - base - ivaV)
    const items = [
      ...(tercerosV >= 0.01 ? [{ code: itemT, description: descT, quantity: 1, price: tercerosV }] : []),
      { code: itemC, description: descC, quantity: 1, price: base, taxes: [{ id: iva!.id }] },
    ]
    const total = r2(Math.max(0, tercerosV) + base + ivaV)
    return {
      base, ivaV, tercerosV, total,
      cuerpo: {
        document: { id: Number(cfg.document_id) }, date: hoy,
        customer: { identification: cp.identification, branch_office: 0 },
        seller: Number(cfg.seller_id),
        stamp: { send: cfg.stamp !== false }, mail: { send: cfg.mail !== false },
        observations, items,
        payments: [{ id: Number(cfg.payment_id), value: total, due_date: hoy }],
      },
    }
  }

  // Antes de reenviar una incierta: ¿ya está en Siigo? Si está, se adopta
  // (queda 'emitida' con sus datos). Si no se pudo preguntar, no se envía.
  if (porVerificar) {
    const b = await buscarFacturaLincoinEnSiigo(tk.token, partner, cp.identification, String(fila.updated_at ?? fila.created_at ?? t.created_at), marcaOp, totalOp)
    if (!b.ok) {
      await marcar({ estado: 'incierta', error: `${MSG_INCIERTA} (No se pudo consultar Siigo ahora.)` }, false)
      return { ok: false, incierta: true, error: 'No se pudo verificar en Siigo si la factura ya existe. No se reenvió. Revísala en Siigo Nube antes de reintentar.' }
    }
    if (b.factura) {
      const d0 = b.factura
      const numero0 = d0.name ?? (d0.number != null ? `${d0.prefix ?? ''}${d0.number}` : null) ?? String(d0.id ?? '')
      await marcar({
        estado: 'emitida', error: null, numero: numero0, siigo_id: d0.id != null ? String(d0.id) : null,
        cufe: d0.stamp?.cufe ?? null, url: d0.public_url ?? null, emitida_at: ahora(),
        detalle: { adoptada: true, respuesta: d0, ...(opts.adminId ? { por: opts.adminId } : {}) },
      }, false)
      return { ok: true, estado: 'emitida', numero: numero0, adoptada: true }
    }
  }

  // Pausa de última hora (solo la automática) y CANDADO: un solo envío a la
  // DIAN por operación, aunque lleguen el aviso, el cron y un clic a la vez.
  if (!opts.manual) {
    const v = await leerConfigLincoin()
    if (!v.cfg?.activo) { await marcar({ estado: 'pendiente', error: 'Facturación pausada antes de enviar a Siigo.' }, false); return { ok: true, estado: 'pendiente' } }
  }
  {
    const hace3 = new Date(Date.now() - 180000).toISOString()
    // Sin `or` (ver actualizarSiAlguna): con él, este candado fallaba siempre.
    // 'incierta' y el 'emitiendo' viejo solo llegan acá después de verificar
    // en Siigo que la factura NO existe (arriba).
    const lock = await actualizarSiAlguna('facturas_lincoin', { estado: 'emitiendo', error: null, updated_at: ahora() }, q => q.eq('id', fila.id), [
      (q: any) => q.in('estado', [...ESTADOS_REEMITIBLES.split(','), ...(porVerificar ? ['incierta'] : [])]),
      (q: any) => q.eq('estado', 'emitiendo').lt('updated_at', hace3),
    ], 'id')
    if (lock.error) return { ok: false, error: `No se pudo tomar la factura: ${lock.error}` }
    if (!lock.tomado) return { ok: false, error: 'Esta factura ya se está emitiendo o ya salió. Recargá la lista.' }
  }
  const intentos: any[] = []
  let tarifa = iva.percentage / 100
  let arm = armar(tarifa)
  let r = await siigo('POST', '/v1/invoices', { token: tk.token, partner, body: arm.cuerpo, ms: 70000 })
  intentos.push({ status: r.status, respuesta: r.data ?? r.texto, tarifa })
  if (!r.ok) {
    // Siigo dice el total que calculó: de ahí sale la tarifa que aplica de
    // verdad (el catálogo puede estar viejo). Se reintenta una vez.
    const m = /total invoice calculated is\s*([\d.,]+)/i.exec(motivoDe(r))
    const totalSiigo = m ? Number(m[1].replace(/,/g, '')) : NaN
    if (Number.isFinite(totalSiigo) && arm.base > 0) {
      const tReal = Math.round(((totalSiigo - Math.max(0, arm.tercerosV)) / arm.base - 1) * 10000) / 10000
      if (tReal > 0.0001 && tReal < 1 && Math.abs(tReal - tarifa) > 0.0001) {
        tarifa = tReal
        arm = armar(tarifa)
        r = await siigo('POST', '/v1/invoices', { token: tk.token, partner, body: arm.cuerpo, ms: 70000 })
        intentos.push({ status: r.status, respuesta: r.data ?? r.texto, tarifa, nota: `Tarifa deducida del total de Siigo (${totalSiigo})` })
      }
    }
  }
  const valores = { total: arm.total, terceros: arm.tercerosV, utilidad, base: arm.base, iva: arm.ivaV, utilidad_fuente: fuente }
  if (!r.ok) {
    // Sin respuesta (o un error del lado de Siigo): la factura PUDO crearse.
    // Queda 'incierta' — no es un 'error' que se reintenta con un botón:
    // antes de reenviarla se busca en Siigo.
    if (r.status === 0 || r.status >= 500) {
      await marcar({ estado: 'incierta', error: MSG_INCIERTA, ...valores, detalle: { enviado: arm.cuerpo, intentos, liq } })
      return { ok: false, incierta: true, error: MSG_INCIERTA }
    }
    if (r.status === 409 && esDuplicadoSiigo(motivoDe(r)) && Number(fila.intentos ?? 0) + 1 < REINTENTOS_DUPLICADO) {
      await marcar({ estado: 'pendiente', error: 'Siigo la tomó como duplicada de otra factura parecida emitida segundos antes. Se reintenta sola en unos minutos.', ...valores, detalle: { enviado: arm.cuerpo, intentos, liq } })
      return { ok: false, reintento: true, error: 'Siigo la tomó como duplicada; se reintenta sola.' }
    }
    return falla(`Siigo rechazó la factura — ${motivoDe(r)}`, { ...valores, detalle: { enviado: arm.cuerpo, intentos, liq } })
  }
  const d = r.data ?? {}
  const numero = d.name ?? (d.number != null ? `${d.prefix ?? ''}${d.number}` : null) ?? String(d.id ?? '')
  await marcar({
    estado: 'emitida', error: null, numero, siigo_id: d.id != null ? String(d.id) : null,
    cufe: d.stamp?.cufe ?? null, url: d.public_url ?? null, emitida_at: ahora(), ...valores,
    detalle: { enviado: arm.cuerpo, respuesta: d, intentos, liq, ...(opts.adminId ? { por: opts.adminId } : {}) },
  })
  return { ok: true, estado: 'emitida', numero, ...valores, cufe: d.stamp?.cufe ?? null, url: d.public_url ?? null }
}

// Las operaciones que quedaron sin factura: completadas desde "desde", sin
// fila en facturas_lincoin, o en 'pendiente' (pausa, duplicado de Siigo).
// No toca 'error' ni 'revision' (piden a alguien) ni 'emitiendo' reciente.
async function ponerseAlDiaLincoin(opts: { tope?: number; hastaMs?: number; dias?: number } = {}): Promise<{ emitidas: number; revisadas: number; errores: string[]; restan: number }> {
  const out = { emitidas: 0, revisadas: 0, errores: [] as string[], restan: 0 }
  // Un 'emitiendo' de hace más de 10 minutos es un envío que se cortó a mitad
  // (la función se reinició o Siigo no contestó): pasa a 'incierta', que se
  // ve en el panel y se verifica en Siigo antes de reintentar. Nunca se
  // reintenta solo.
  try {
    await db.from('facturas_lincoin').update({ estado: 'incierta', error: MSG_INCIERTA, updated_at: new Date().toISOString() })
      .eq('estado', 'emitiendo').lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString())
  } catch { /* la próxima vuelta */ }
  const { cfg } = await leerConfigLincoin()
  if (!cfg?.activo) return out
  const fin = opts.hastaMs ?? Date.now() + 100_000
  const tope = opts.tope ?? 3
  const limite = Math.max(Date.parse(String(cfg.desde ?? '')) || 0, Date.now() - (opts.dias ?? 14) * 86400000)
  const { data: txs } = await db.from('transactions').select('id, user_id, type, amount, currency, status, created_at, raw_data')
    .in('type', ['load', 'convert']).eq('status', 'Completado')
    .gte('created_at', new Date(limite).toISOString()).lt('created_at', new Date(Date.now() - 60_000).toISOString())
    .order('created_at', { ascending: false }).limit(1000)
  const ops: string[] = Array.isArray(cfg.operaciones) ? cfg.operaciones : Object.keys(OPERACIONES_LINCOIN)
  const candidatas = ((txs ?? []) as any[]).filter(t => { const l = liquidacionDe(t); return l && ops.includes(l.tipo) })
  if (!candidatas.length) return out
  const estado = new Map<string, any>()
  for (let i = 0; i < candidatas.length; i += 200) {
    const { data: filas } = await db.from('facturas_lincoin').select('transaction_id, estado, updated_at').in('transaction_id', candidatas.slice(i, i + 200).map(t => String(t.id)))
    for (const f of (filas ?? []) as any[]) estado.set(String(f.transaction_id), f)
  }
  const reposo = Date.now() - 5 * 60_000
  // De la más vieja a la más nueva: la que lleva más tiempo esperando, primero.
  const pendientes = candidatas.filter(t => {
    const f = estado.get(String(t.id))
    return !f || (f.estado === 'pendiente' && Date.parse(String(f.updated_at)) < reposo)
  }).reverse()
  let hechas = 0
  for (const t of pendientes) {
    if (hechas >= tope || Date.now() > fin) { out.restan++; continue }
    hechas++
    try {
      const r = await emitirLincoin(String(t.id))
      if (r?.ok && r.estado === 'emitida') out.emitidas++
      else if (r?.revision) out.revisadas++
      else if (r && !r.ok && !r.reintento) out.errores.push(String(r.error ?? 'error'))
    } catch (e) { out.errores.push(String((e as Error)?.message ?? e)) }
  }
  return out
}

function enSegundoPlano(p: Promise<unknown>, etiqueta: string): boolean {
  const seguro = p.then(r => console.log(`[facturacion] ${etiqueta}`, JSON.stringify(r ?? {}).slice(0, 500)), e => console.error(`[facturacion] ${etiqueta}`, String((e as Error)?.message ?? e)))
  const rt = (globalThis as any).EdgeRuntime
  if (rt && typeof rt.waitUntil === 'function') { rt.waitUntil(seguro); return true }
  return false
}

async function accionLincoin(accion: string, body: any): Promise<Response> {
  if (accion === 'lincoin_config_get') {
    const { cfg, falta } = await leerConfigLincoin()
    if (falta) return json({ ok: false, error: MIGRACION_LINCOIN, falta: true })
    return json({ ok: true, config: await publicaLincoin(cfg), resumen: await resumenLincoin(), operaciones: OPERACIONES_LINCOIN })
  }

  if (accion === 'lincoin_config_set') {
    const c = body.config ?? {}
    const { cfg: actualCfg, falta } = await leerConfigLincoin()
    if (falta) return json({ ok: false, error: MIGRACION_LINCOIN }, 500)
    const fila: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString(), updated_by: body.adminId ?? null }
    for (const k of ['username', 'partner_id', 'item_terceros', 'item_comision', 'desc_terceros', 'desc_comision', 'observaciones']) {
      if (k in c) fila[k] = c[k] == null || String(c[k]).trim() === '' ? null : String(c[k]).trim().slice(0, 500)
    }
    for (const k of ['document_id', 'seller_id', 'payment_id', 'iva_tax_id']) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : Number(c[k])
    for (const k of ['stamp', 'mail']) if (k in c) fila[k] = !!c[k]
    if (Array.isArray(c.operaciones)) fila.operaciones = c.operaciones.filter((o: any) => typeof o === 'string' && o in OPERACIONES_LINCOIN)
    if ('desde' in c) fila.desde = c.desde && !isNaN(Date.parse(String(c.desde))) ? new Date(String(c.desde)).toISOString() : null
    if (typeof c.access_key === 'string' && c.access_key.replace(/\s+/g, '')) {
      try { fila.access_key_enc = await encField(c.access_key.replace(/\s+/g, '')) }
      catch { return json({ ok: false, error: 'No se pudo cifrar la access key: falta FIELD_ENC_KEY en el servidor.' }, 500) }
      tokens.delete(CLAVE_TOKEN_LINCOIN)
    }
    const cambiaActivo = body.cambiarActivo === true && 'activo' in c
    if (cambiaActivo) fila.activo = !!c.activo
    if (fila.activo === true) {
      const a = { ...(actualCfg ?? {}), ...fila } as any
      const faltan: string[] = []
      if (!a.username) faltan.push('usuario')
      if (!a.access_key_enc) faltan.push('access key')
      for (const [k, n] of [['document_id', 'tipo de factura'], ['seller_id', 'vendedor'], ['payment_id', 'forma de pago'], ['item_terceros', 'ítem de ingresos para terceros'], ['item_comision', 'ítem de comisión']]) if (!a[k]) faltan.push(n)
      if (!(Array.isArray(a.operaciones) ? a.operaciones : []).length) faltan.push('qué operaciones se facturan')
      if (!a.ultimo_test_ok) faltan.push('probar la conexión')
      if (faltan.length) return json({ ok: false, error: `Para activar falta: ${faltan.join(', ')}.` }, 400)
      if (a.item_terceros) {
        const ivaT = ivaDelProducto(a, String(a.item_terceros))
        if (ivaT) return json({ ok: false, error: `El ítem de ingresos para terceros (${a.item_terceros}) tiene ${ivaT.name || 'IVA'} ${ivaT.percentage} % en Siigo y va sin IVA.` }, 400)
      }
      // Sin "desde", se factura de ahora en adelante: activar no puede
      // mandar a la DIAN de golpe todas las operaciones viejas.
      if (!a.desde) fila.desde = new Date().toISOString()
    }
    const { error } = await db.from('facturacion_lincoin').upsert(fila, { onConflict: 'id' })
    if (error) return json({ ok: false, error: faltaTablaLincoin(error.message) ? MIGRACION_LINCOIN : error.message }, 500)
    if (cambiaActivo) await db.from('audit_log').insert({ user_id: body.adminId ?? null, action: fila.activo ? 'facturacion_lincoin.activada' : 'facturacion_lincoin.pausada', metadata: { at: new Date().toISOString() } }).then(() => {}, () => {})
    const { cfg } = await leerConfigLincoin()
    return json({ ok: true, config: await publicaLincoin(cfg) })
  }

  if (accion === 'lincoin_probar') {
    const { cfg, falta } = await leerConfigLincoin()
    if (falta) return json({ ok: false, error: MIGRACION_LINCOIN })
    if (!cfg) return json({ ok: false, error: 'Primero guardá el usuario y la access key.' })
    const t = await tokenDe(CLAVE_TOKEN_LINCOIN, cfg, true)
    const ahora = new Date().toISOString()
    if ('error' in t) {
      await db.from('facturacion_lincoin').update({ ultimo_test_at: ahora, ultimo_test_ok: false, ultimo_error: t.error }).eq('id', 1)
      const v = await leerConfigLincoin()
      return json({ ok: false, error: t.error, config: await publicaLincoin(v.cfg) })
    }
    const cat = await traerCatalogos(t.token, cfg.partner_id || 'Lincoin')
    const problemas = Object.entries(cat.fuentes).filter(([k, f]) => !f.ok && ['documentos', 'vendedores', 'pagos', 'productos', 'impuestos'].includes(k)).map(([k, f]) => `${k}: ${f.motivo}`)
    await db.from('facturacion_lincoin').update({ ultimo_test_at: ahora, ultimo_test_ok: true, catalogos: cat, ultimo_error: problemas.length ? `Conectó, pero: ${problemas.join(' | ')}` : null }).eq('id', 1)
    const v = await leerConfigLincoin()
    return json({ ok: true, aviso: problemas.length ? problemas.join(' | ') : null, config: await publicaLincoin(v.cfg) })
  }

  if (accion === 'lincoin_emitir') {
    const txId = String(body.transactionId ?? '')
    if (!txId) return json({ ok: false, error: 'falta_transactionId' }, 400)
    const u = body.utilidad != null && body.utilidad !== '' ? Number(body.utilidad) : null
    return json(await emitirLincoin(txId, { manual: true, utilidad: u, adminId: body.adminId ?? null }))
  }

  // Del aviso de operación completada. Responde enseguida y emite en
  // segundo plano, con una espera: un cargue se registra ANTES de tocar el
  // saldo y se borra si el saldo no se pudo aplicar; no se factura algo que
  // a los segundos puede no existir.
  if (accion === 'lincoin_auto') {
    const txId = String(body.transactionId ?? '')
    if (!txId) return json({ ok: false, error: 'falta_transactionId' }, 400)
    const p = new Promise(res => setTimeout(res, 20_000)).then(() => emitirLincoin(txId))
    if (!enSegundoPlano(p, `lincoin auto ${txId}`)) await p
    return json({ ok: true, enCola: true })
  }

  if (accion === 'lincoin_al_dia') {
    const p = ponerseAlDiaLincoin({ tope: 10, hastaMs: Date.now() + 140_000, dias: 120 })
    if (!enSegundoPlano(p, 'lincoin al día')) return json({ ok: true, ...(await p) })
    return json({ ok: true, enSegundoPlano: true })
  }

  if (accion === 'lincoin_facturas') {
    const lim = Math.min(Math.max(Number(body.limite) || 300, 1), 2000)
    let q = db.from('facturas_lincoin').select('id, transaction_id, user_id, tipo, operacion_at, total, terceros, utilidad, base, iva, utilidad_fuente, estado, numero, cufe, url, error, intentos, created_at, updated_at, emitida_at')
    if (body.estado) q = q.eq('estado', String(body.estado))
    if (body.userId) q = q.eq('user_id', String(body.userId))
    const { data, error } = await q.order('created_at', { ascending: false }).limit(lim)
    if (error) return json({ ok: false, error: faltaTablaLincoin(error.message) ? MIGRACION_LINCOIN : error.message })
    const filas = (data ?? []) as any[]
    const ids = Array.from(new Set(filas.map(f => String(f.user_id)).filter(Boolean)))
    const nombres = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data: us } = await db.from('users').select('id, email, full_name, company_name').in('id', ids.slice(i, i + 200))
      for (const u of (us ?? []) as any[]) nombres.set(String(u.id), u)
    }
    return json({ ok: true, facturas: filas.map(f => { const u = nombres.get(String(f.user_id)); return { ...f, cliente: u ? (u.company_name || u.full_name || u.email) : null } }) })
  }
  return json({ error: 'accion_desconocida' }, 400)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const accion = String(body.action ?? '')
    const yo = await quienLlama(req)

    // ── Emisión: solo la llama el sistema (notify-transaction) ──
    if (accion === 'emitir') {
      if (!yo.servicio) return json({ error: 'no_autorizado' }, 401)
      const folio = Number(body.folio)
      if (!folio) return json({ ok: false, error: 'falta_folio' }, 400)
      return json(await emitir(folio))
    }

    // ── Ponerse al día (sistema): lo llama notify-transaction después de
    //    cada operación completada, y sirve para un cron. Con userId, solo
    //    esa cuenta; sin él, todas las que tienen la facturación activa.
    if (accion === 'ponerse_al_dia') {
      if (!yo.servicio) return json({ error: 'no_autorizado' }, 401)
      const hastaMs = Date.now() + 110_000
      const uid = String(body.userId ?? '')
      let ids: string[] = uid ? [uid] : []
      if (!uid) {
        const { data: activos } = await db.from('facturacion_config').select('user_id').eq('activo', true).limit(200)
        ids = ((activos ?? []) as any[]).map(a => String(a.user_id))
      }
      const resultados: Record<string, unknown> = {}
      for (const id of ids) {
        if (Date.now() > hastaMs) break
        try { resultados[id] = await ponerseAlDia(id, { tope: uid ? 3 : 2, hastaMs }) }
        catch (e) { resultados[id] = { error: String((e as Error)?.message ?? e) } }
      }
      // El cron general también pone al día las facturas de Lincoin.
      let lincoin: unknown = null
      if (!uid && Date.now() < hastaMs - 20_000) {
        try { lincoin = await ponerseAlDiaLincoin({ tope: 3, hastaMs }) }
        catch (e) { lincoin = { error: String((e as Error)?.message ?? e) } }
      }
      return json({ ok: true, cuentas: ids.length, resultados, lincoin })
    }

    // ── Cola del lote (sistema): el relevo que se pasa la cola a sí misma.
    //    Contesta enseguida; la vuelta sigue en segundo plano.
    if (accion === 'cola_seguir') {
      if (!yo.servicio) return json({ error: 'no_autorizado' }, 401)
      const uid = String(body.userId ?? '')
      if (!uid) return json({ ok: false, error: 'falta_userId' }, 400)
      if (await colaViva(uid)) return json({ ok: true, yaCorre: true })
      await guardarSistema(claveCola(uid), String(Date.now()))
      const p = procesarCola(uid)
      if (!enSegundoPlano(p, `cola ${uid}`)) return json({ ok: true, ...(await p) })
      return json({ ok: true, enSegundoPlano: true })
    }

    // ── Facturas de Lincoin a sus clientes: solo el sistema (admin-data ya
    //    revisó el permiso del admin; notify-transaction y el cron).
    if (accion.startsWith('lincoin_')) {
      if (!yo.servicio) return json({ error: 'no_autorizado' }, 401)
      return await accionLincoin(accion, body)
    }

    if (!yo.userId) return json({ error: 'no_autorizado' }, 401)
    let userId = yo.userId

    // Contador con acceso aprobado: opera la facturación de la empresa como
    // la empresa misma (emitir, lote, configurar el modelo y las credenciales
    // de Siigo). Antes solo podía consultar; Lincoin lo abrió para que la
    // contadora facture sin pedirle a la empresa cada factura. El vínculo se
    // lee de la fila de la EMPRESA, que solo escribe la función `contador`;
    // lo que cambia algo queda en el audit_log de la empresa con quién fue.
    const empresaPedida = String(body.empresaId ?? '')
    if (empresaPedida && empresaPedida !== userId) {
      if (!(await esContadorDe(userId, empresaPedida))) return json({ ok: false, error: 'La empresa no ha aprobado tu acceso.' }, 403)
      if (!ACCIONES_DE_LECTURA.has(accion)) {
        await db.from('audit_log').insert({ user_id: empresaPedida, action: 'facturacion.por_contador', metadata: { contadorId: userId, accion, transactionId: body.transactionId ?? null, folio: body.folio ?? null, n: Array.isArray(body.transactionIds) ? body.transactionIds.length : null, at: new Date().toISOString() } }).then(() => {}, () => {})
      }
      userId = empresaPedida
    }

    // ── Ponerse al día (la propia cuenta): lo pide la app de la empresa al
    //    entrar y cada 10 min, en cualquier pantalla. Antes solo pasaba al
    //    abrir Contabilidad, y si el aviso automático de una operación no
    //    llegaba, esa operación se quedaba sin comprobante ni factura.
    //    Responde enseguida; el trabajo sigue en segundo plano.
    if (accion === 'al_dia') {
      const cfgA = await leerConfig(userId)
      if (!cfgA?.activo) return json({ ok: true, activo: false })
      const p = ponerseAlDia(userId).then(r => { if (r.creados || r.emitidos || r.errores.length) console.log('[facturacion] al día', userId, JSON.stringify(r)) }, e => console.error('[facturacion] al día', String((e as Error)?.message ?? e)))
      const rt = (globalThis as any).EdgeRuntime
      if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p); else await p
      return json({ ok: true, activo: true })
    }

    if (accion === 'config_get') {
      const chequeo = await chequeoAutomatico(userId)
      // Si hay operaciones sin comprobante o comprobantes que quedaron sin
      // emitir, se ponen al día en segundo plano (el runtime de Supabase deja
      // terminar la promesa después de responder). La pantalla, al recargar,
      // ya las ve.
      const { count: sinEmitir } = await db.from('comprobantes').select('folio', { count: 'exact', head: true })
        .eq('user_id', userId).in('tipo', Object.keys(DISPARADORES)).or('factura_estado.is.null,factura_estado.eq.pendiente')
        .lt('emitido_at', new Date(Date.now() - 5 * 60_000).toISOString())
      if ((chequeo && chequeo.sinComprobante > 0) || (sinEmitir ?? 0) > 0) {
        const p = ponerseAlDia(userId).then(r => console.log('[facturacion] ponerse al día', userId, JSON.stringify(r)), e => console.error('[facturacion] ponerse al día', String((e as Error)?.message ?? e)))
        const rt = (globalThis as any).EdgeRuntime
        if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p)
      }
      // Anulaciones hechas en Siigo (notas crédito): se revisan al abrir
      // Contabilidad, como mucho cada 15 minutos por cuenta.
      {
        const clave = `facturacion_nc_sync:${userId}`
        const { data: ult } = await db.from('system_config').select('value').eq('key', clave).maybeSingle()
        if (!ult || Date.now() - Number((ult as any).value) > 15 * 60_000) {
          await guardarSistema(clave, String(Date.now()))
          const p = sincronizarAnulaciones(userId).then(r => { if (r.anuladas.length || r.error) console.log('[facturacion] anulaciones', userId, JSON.stringify(r)) }, e => console.error('[facturacion] anulaciones', String((e as Error)?.message ?? e)))
          const rt = (globalThis as any).EdgeRuntime
          if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p)
        }
      }
      // Una cola de lote que quedó sin trabajar (se perdió el relevo).
      {
        const pc = reanudarCola(userId).then(v => { if (v) console.log('[facturacion] cola reanudada', userId) }, e => console.error('[facturacion] reanudar cola', String((e as Error)?.message ?? e)))
        const rt = (globalThis as any).EdgeRuntime
        if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(pc)
      }
      return json({ ok: true, config: await publica(await leerConfig(userId), await resumenDe(userId)), disparadores: DISPARADORES, chequeo })
    }

    if (accion === 'config_set') {
      const c = body.config ?? {}
      const fila: Record<string, unknown> = { user_id: userId, proveedor: 'siigo', updated_at: new Date().toISOString() }
      const copiar = ['username', 'partner_id', 'product_code', 'product_description', 'cliente_default_nit', 'cliente_default_nombre', 'observaciones']
      // Ciudad para cédulas expedidas en el exterior: un código DANE válido o
      // nada. Solo se escribe si se eligió (o si había una y se quita), para
      // que un guardado cualquiera no falle mientras no se corra la
      // migración 2026_facturacion_ciudad.sql.
      if ('ciudad_exterior' in c) {
        const cod = municipioPorCodigo(c.ciudad_exterior)?.codigo ?? null
        if (cod) fila.ciudad_exterior = cod
        else if ((await leerConfig(userId))?.ciudad_exterior) fila.ciudad_exterior = null
      }
      for (const k of copiar) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : String(c[k]).trim()
      for (const k of ['document_id', 'seller_id', 'payment_id', 'ds_document_id', 'ds_payment_id']) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : Number(c[k])
      // `activo` solo cambia cuando se pide a propósito (el botón Activar /
      // Pausar manda cambiarActivo). Un guardado cualquiera de la ventana de
      // configuración traía el `activo` que había al abrirla, y si alguien la
      // tenía abierta desde antes de pausar, al guardar la volvía a activar.
      const cambiaActivo = body.cambiarActivo === true && 'activo' in c
      if (cambiaActivo) fila.activo = !!c.activo
      for (const k of ['crear_clientes', 'stamp', 'mail']) if (k in c) fila[k] = !!c[k]
      if (Array.isArray(c.disparadores)) fila.disparadores = c.disparadores.filter((d: any) => typeof d === 'string' && d in DISPARADORES)
      // El modelo de negocio y sus parámetros.
      if ('modelo' in c) {
        fila.modelo = c.modelo === 'rotacion' || c.modelo === 'psp' || c.modelo === 'comision' ? c.modelo : null
        // Quitar el modelo con la facturación activa dejaría una activación
        // sin reglas. Primero se pausa.
        if (!fila.modelo && fila.activo !== false) {
          const actual = await leerConfig(userId)
          if (actual?.activo) return json({ ok: false, error: 'Pausá la facturación antes de eliminar el modelo.' }, 400)
        }
      }
      if ('utilidad_pct' in c) fila.utilidad_pct = c.utilidad_pct == null || c.utilidad_pct === '' ? null : Math.max(0, Number(c.utilidad_pct) || 0)
      for (const k of ['item_terceros', 'item_comision', 'desc_terceros', 'desc_comision']) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : String(c[k]).trim().slice(0, 500)
      if ('iva_tax_id' in c) fila.iva_tax_id = c.iva_tax_id == null || c.iva_tax_id === '' ? null : Number(c.iva_tax_id)
      // Con modelo, qué documento sale se deriva: rotación → factura de venta
      // por cada entrada marcada; PSP → documento soporte por cada salida.
      if (Array.isArray(c.operaciones) && (fila.modelo === 'rotacion' || fila.modelo === 'psp' || fila.modelo === 'comision')) {
        const d: Record<string, string> = {}
        for (const k of c.operaciones) if (typeof k === 'string' && k in DISPARADORES) d[k] = 'FV'
        fila.documentos = d
        fila.disparadores = Object.keys(d)
      }
      // Por motivo del envío: documento soporte con qué ítem, o nada.
      if (c.motivos && typeof c.motivos === 'object' && !Array.isArray(c.motivos)) {
        const m: Record<string, { emite: 'DS' | 'FV' | 'no'; item: string | null }> = {}
        for (const [k, v] of Object.entries(c.motivos as Record<string, any>)) {
          if (!(k in MOTIVOS_ENVIO) || !v || typeof v !== 'object') continue
          m[k] = { emite: v.emite === 'DS' ? 'DS' : v.emite === 'FV' ? 'FV' : 'no', item: v.item ? String(v.item).trim().slice(0, 100) : null }
        }
        fila.motivos = m
        // El ítem general de terceros, si no lo hay, toma el del primer
        // motivo con documento soporte: es el respaldo para un envío viejo
        // que no traiga motivo.
        const primero = Object.values(m).find(v => v.emite === 'DS' && v.item)
        if (primero && !(typeof c.item_terceros === 'string' && c.item_terceros.trim())) fila.item_terceros = primero.item
      }
      // Qué documento sale por cada operación. Los disparadores viejos se
      // mantienen en sincronía: son las claves con documento.
      if (c.documentos && typeof c.documentos === 'object' && !Array.isArray(c.documentos)) {
        const d: Record<string, string> = {}
        for (const [k, v] of Object.entries(c.documentos)) if (k in DISPARADORES && (v === 'FV' || v === 'DS')) d[k] = v
        fila.documentos = d
        fila.disparadores = Object.keys(d)
      }
      // Los ítems del documento, saneados uno por uno.
      if (Array.isArray(c.items)) {
        const items = c.items
          .filter((i: any) => i && typeof i.code === 'string' && i.code.trim())
          .slice(0, 20)
          .map((i: any) => ({
            code: String(i.code).trim(),
            description: String(i.description ?? '').slice(0, 500),
            quantity: Math.max(1, Number(i.quantity) || 1),
            valor: ['monto', 'porcentaje', 'fijo'].includes(i.valor) ? i.valor : 'monto',
            porcentaje: Math.max(0, Number(i.porcentaje) || 0),
            fijo: Math.max(0, Number(i.fijo) || 0),
            tax_id: i.tax_id ? Number(i.tax_id) : null,
          }))
        fila.items = items
        // El primero también en el campo viejo, para lo que todavía lo lea.
        if (items.length) { fila.product_code = items[0].code; fila.product_description = items[0].description || null }
      }
      // La access key solo se toca si viene una nueva. Vacío = se conserva.
      // Sin NINGÚN espacio: una access key pegada desde un correo o un PDF
      // suele traer un salto de línea en el medio, y Siigo la rechaza entera.
      if (typeof c.access_key === 'string' && c.access_key.replace(/\s+/g, '')) {
        try { fila.access_key_enc = await encField(c.access_key.replace(/\s+/g, '')) }
        catch { return json({ ok: false, error: 'No se pudo cifrar la access key: falta FIELD_ENC_KEY en el servidor.' }, 500) }
        tokens.delete(userId)
      }
      // Activar exige que todo lo necesario esté elegido. Activar a medias
      // solo produce facturas en error.
      if (fila.activo === true) {
        const actual = { ...(await leerConfig(userId) ?? {}), ...fila }
        const faltan: string[] = []
        if (!actual.username) faltan.push('usuario')
        if (!actual.access_key_enc) faltan.push('access key')
        const reglas = documentosDe(actual)
        const clases = new Set(Object.values(reglas))
        const modelo = String(actual.modelo ?? '')
        if (!modelo) faltan.push('el modelo de negocio')
        // Los motivos que emiten documento soporte necesitan su ítem, y el
        // comprobante DS aunque el modelo sea rotación.
        // En los modelos de mandato los motivos de envío no aplican (un PSP
        // de antes guardaba motivos con documento soporte).
        const motivosCfg: Record<string, any> = !esMandato(actual) && actual.motivos && typeof actual.motivos === 'object' ? actual.motivos : {}
        const motivosDS = Object.entries(motivosCfg).filter(([, v]) => v?.emite === 'DS')
        const motivosFV = Object.entries(motivosCfg).filter(([, v]) => v?.emite === 'FV')
        if (motivosDS.length) clases.add('DS')
        if (motivosFV.length) clases.add('FV')
        for (const [k, v] of [...motivosDS, ...motivosFV]) if (!v.item) faltan.push(`el ítem del motivo "${MOTIVOS_ENVIO[k] ?? k}"`)
        if (!Object.keys(reglas).length && !motivosDS.length && !motivosFV.length) faltan.push('qué operaciones emiten')
        if (clases.has('FV')) for (const k of ['document_id', 'seller_id', 'payment_id']) if (!actual[k]) faltan.push(`${k} (factura de venta)`)
        if (clases.has('DS')) for (const k of ['ds_document_id', 'ds_payment_id']) if (!actual[k]) faltan.push(`${k} (documento soporte)`)
        if (modelo === 'rotacion') {
          if (!(Number(actual.utilidad_pct) > 0)) faltan.push('el porcentaje de utilidad')
          if (!actual.item_terceros) faltan.push('el ítem de servicio para terceros')
          if (!actual.item_comision) faltan.push('el ítem de comisión')
        } else if (modelo === 'comision' || modelo === 'psp') {
          if (!(Number(actual.utilidad_pct) > 0)) faltan.push('el porcentaje de comisión')
          if (!actual.item_comision) faltan.push('el ítem de comisión')
          if (!actual.item_terceros) faltan.push('el ítem de ingresos recibidos para terceros')
          if (!Object.keys(reglas).length) faltan.push('qué movimientos cobran comisión')
        } else {
          const items = Array.isArray(actual.items) ? actual.items : []
          if (!items.length && !actual.product_code) faltan.push('al menos un ítem')
        }
        if (faltan.length) return json({ ok: false, error: `Para activar falta: ${faltan.join(', ')}.` }, 400)
      }
      const { error } = await db.from('facturacion_config').upsert(fila, { onConflict: 'user_id' })
      if (error) {
        // Qué migración falta, según lo que falte: la tabla entera, o una
        // columna nueva. Decir el archivo equivocado manda a correr algo que
        // ya se corrió.
        if (/relation .* does not exist|42P01/i.test(error.message)) return json({ ok: false, error: 'Falta correr la migración 2026_facturacion.sql en la base.' }, 500)
        if (/column|schema cache|PGRST204/i.test(error.message)) return json({ ok: false, error: `Falta correr la migración 2026_facturacion_modelo.sql en la base (${error.message}).` }, 500)
        return json({ ok: false, error: error.message }, 500)
      }
      if (cambiaActivo) {
        await db.from('audit_log').insert({ user_id: userId, action: fila.activo ? 'facturacion.activada' : 'facturacion.pausada', metadata: { at: new Date().toISOString(), ...(userId !== yo.userId ? { contadorId: yo.userId } : {}) } }).then(() => {}, () => {})
      }
      // El modelo, también en la ficha de la cuenta: el envío lo lee de ahí
      // para pedir el ordenante. Antes lo escribía el navegador de la
      // empresa; si lo cambia el contador, tiene que escribirlo el servidor.
      if ('modelo' in c) await mergeRaw(db, userId, { facturacionModelo: fila.modelo ?? null }).catch(() => {})
      return json({ ok: true, config: await publica(await leerConfig(userId), await resumenDe(userId)) })
    }

    if (accion === 'probar') {
      const cfg = await leerConfig(userId)
      if (!cfg) return json({ ok: false, error: 'Primero guardá el usuario y la access key.' })
      const partner = cfg.partner_id || 'Lincoin'
      const t = await tokenDe(userId, cfg, true)
      const ahora = new Date().toISOString()
      if ('error' in t) {
        await db.from('facturacion_config').update({ ultimo_test_at: ahora, ultimo_test_ok: false, ultimo_error: t.error }).eq('user_id', userId)
        return json({ ok: false, error: t.error, config: await publica(await leerConfig(userId)) })
      }
      const cat = await traerCatalogos(t.token, partner)
      const conProblemas = Object.entries(cat.fuentes).filter(([, f]) => !f.ok).map(([k, f]) => `${k}: ${f.motivo}`)
      await db.from('facturacion_config').update({
        ultimo_test_at: ahora, ultimo_test_ok: true, catalogos: cat,
        ultimo_error: conProblemas.length ? `Conectó, pero: ${conProblemas.join(' | ')}` : null,
      }).eq('user_id', userId)
      return json({ ok: true, catalogos: cat, aviso: conProblemas.length ? conProblemas.join(' | ') : null, config: await publica(await leerConfig(userId), await resumenDe(userId)) })
    }

    if (accion === 'reintentar') {
      const folio = Number(body.folio)
      if (!folio) return json({ ok: false, error: 'falta_folio' }, 400)
      const { data: comp } = await db.from('comprobantes').select('user_id').eq('folio', folio).maybeSingle()
      if (!comp || String((comp as any).user_id) !== userId) return json({ ok: false, error: 'comprobante_no_encontrado' }, 404)
      return json(await emitir(folio, { forzar: true }))
    }

    // ── Emitir a mano el documento de UN movimiento ──────────────────
    // Para los que quedaron sin documento: completados antes de activar,
    // omitidos por la regla, o sin comprobante todavía. Si el movimiento no
    // tiene comprobante, se le crea acá (mismo formato que al completarse).
    if (accion === 'emitir_movimiento') {
      const txId = String(body.transactionId ?? '')
      if (!txId) return json({ ok: false, error: 'falta_transactionId' }, 400)
      const { data: tx } = await db.from('transactions').select('id, user_id, type, amount, currency, status, raw_data').eq('id', txId).maybeSingle()
      if (!tx || String((tx as any).user_id) !== userId) return json({ ok: false, error: 'movimiento_no_encontrado' }, 404)
      if (String((tx as any).status) !== 'Completado') return json({ ok: false, error: `La operación está en "${(tx as any).status}". Solo se emite cuando queda Completada.` })
      const r = await asegurarComprobante(tx, userId)
      if ('error' in r) return json({ ok: false, error: r.error }, 500)
      return json(await emitir(r.folio, { forzar: true }))
    }

    // ── Ponerse al día: comprobantes y documentos que el aviso automático
    //    no alcanzó a crear ──────────────────────────────────────────────
    if (accion === 'reconciliar') {
      const anul = await sincronizarAnulaciones(userId).catch(e => ({ revisadas: 0, anuladas: [] as string[], parciales: [] as string[], error: String((e as Error)?.message ?? e) }))
      return json({ ok: true, ...(await reconciliar(userId)), anulaciones: anul })
    }

    // ── Factura de comisión por un depósito (PSP), a mano ──────────────
    if (accion === 'emitir_comision') {
      const txId = String(body.transactionId ?? '')
      if (!txId) return json({ ok: false, error: 'falta_transactionId' }, 400)
      return json(await emitirComision(userId, txId, {
        identification: String(body.clienteIdentification ?? ''), nombre: body.clienteNombre ? String(body.clienteNombre) : undefined,
        esEmpresa: typeof body.clienteEsEmpresa === 'boolean' ? body.clienteEsEmpresa : undefined,
        pct: body.comisionPct != null && body.comisionPct !== '' ? Number(body.comisionPct) : undefined,
      }))
    }
    if (accion === 'buscar_clientes') {
      return json(await buscarClientes(userId, String(body.q ?? '')))
    }

    // ── Emisión en lote: se encola y el servidor emite en segundo plano,
    //    aunque se cierre la pantalla. Detener devuelve lo que falta a como
    //    estaba.
    if (accion === 'lote_encolar') {
      return json(await encolarLote(userId, body))
    }
    if (accion === 'lote_cancelar') {
      return json({ ok: true, cancelados: await cancelarCola(userId) })
    }

    // ── Los comprobantes de la cuenta, para la tabla de Contabilidad. La
    //    empresa los lee directo de la base; el contador no puede (RLS), y
    //    para ver salir las facturas del lote necesita leerlos seguido.
    if (accion === 'comprobantes') {
      const cols = 'transaction_id, folio, numero, enviado_at, factura_estado, factura_numero, factura_url, factura_error, factura_tipo, factura_at'
      const filas: any[] = []
      for (let desde = 0; desde < 20000; desde += 1000) {
        const { data, error } = await db.from('comprobantes').select(cols).eq('user_id', userId).order('folio', { ascending: false }).range(desde, desde + 999)
        if (error) return json({ ok: false, error: error.message }, 500)
        filas.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      return json({ ok: true, comprobantes: filas })
    }

    // ── Los ordenantes (modelo Comisión). La empresa los edita desde su
    //    navegador en su propia ficha; el contador no puede escribir la
    //    ficha de la empresa, así que pasa por acá. Solo se toca esa clave.
    if (accion === 'ordenantes_get' || accion === 'ordenantes_set') {
      if (accion === 'ordenantes_set') {
        const lista = (Array.isArray(body.ordenantes) ? body.ordenantes : []).slice(0, 200)
          .map((o: any) => ({
            id: String(o?.id ?? '').slice(0, 80), nombre: String(o?.nombre ?? '').trim().slice(0, 200),
            docTipo: ['NIT', 'CC', 'CE', 'PP'].includes(String(o?.docTipo)) ? String(o.docTipo) : 'NIT',
            doc: String(o?.doc ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 20),
            ...(o?.correo ? { correo: String(o.correo).trim().slice(0, 200) } : {}),
          }))
          .filter((o: any) => o.id && o.doc && o.nombre)
        const err = await mergeRaw(db, userId, { ordenantes: lista })
        if (err) return json({ ok: false, error: `No se pudieron guardar los ordenantes: ${err}` }, 500)
      }
      const { data: u } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
      const l = (u as any)?.raw_data?.ordenantes
      return json({ ok: true, ordenantes: Array.isArray(l) ? l.filter((o: any) => o && o.id && o.doc) : [] })
    }

    // ── Revisar facturas duplicadas en Siigo (solo lee) y registrar las
    //    que Siigo tiene y Lincoin no, para que no se vuelvan a emitir.
    if (accion === 'duplicadas') {
      return json(await revisarDuplicadas(userId, Number(body.dias ?? 30)))
    }
    if (accion === 'duplicadas_registrar') {
      return json(await registrarDeSiigo(userId, body.facturas))
    }

    // ── El documento de UN movimiento, para verlo desde el detalle ──────
    // Devuelve lo que se guardó al emitir (tipo, número, CUFE/CUDE, fecha,
    // ítems) y, si Siigo responde, refresca el estado ante la DIAN: el sello
    // electrónico puede llegar minutos después de crear el documento. Si
    // Siigo no contesta, se muestra lo guardado y se dice que no se pudo
    // actualizar — nunca se inventa un estado.
    if (accion === 'documento' || accion === 'documento_pdf') {
      const txId = String(body.transactionId ?? '')
      if (!txId) return json({ ok: false, error: 'falta_transactionId' }, 400)
      const { data: comp, error: eComp } = await db.from('comprobantes').select('*').eq('transaction_id', txId).maybeSingle()
      if (eComp) return json({ ok: false, error: /does not exist|42P01|schema cache/i.test(eComp.message) ? 'sin_tabla' : eComp.message })
      if (!comp || String((comp as any).user_id) !== userId) return json({ ok: true, comprobante: null, documento: null })
      const c = comp as any
      const clase: 'FV' | 'DS' = c.factura_tipo === 'DS' ? 'DS' : 'FV'
      const rutaDoc = clase === 'DS' ? '/v1/purchase-support-documents' : '/v1/invoices'
      const cfg = await leerConfig(userId)
      const partner = cfg?.partner_id || 'Lincoin'

      // PDF: Siigo lo entrega en base64 para la factura de venta
      // (GET /v1/invoices/{id}/pdf). Para el documento soporte no documenta
      // esa ruta; se intenta la equivalente y, si no existe, se dice.
      if (accion === 'documento_pdf') {
        if (c.factura_estado !== 'emitida' || !c.factura_id) return json({ ok: false, error: 'Este movimiento no tiene un documento emitido en Siigo.' })
        const t = await tokenDe(userId, cfg)
        if ('error' in t) return json({ ok: false, error: t.error })
        const r = await siigo('GET', `${rutaDoc}/${encodeURIComponent(String(c.factura_id))}/pdf`, { token: t.token, partner })
        const b64 = r.data?.base64 ?? r.data?.pdf_base64 ?? null
        if (r.ok && typeof b64 === 'string' && b64.length > 100) return json({ ok: true, base64: b64, nombre: `${c.factura_numero ?? clase}.pdf` })
        const e = r.status === 404 || r.status === 405
          ? `Siigo no entrega por API el PDF del ${clase === 'DS' ? 'documento soporte' : 'documento'} (HTTP ${r.status} en ${rutaDoc}/{id}/pdf). Se descarga desde Siigo Nube: ${clase === 'DS' ? 'Compras → Documento soporte' : 'Ventas → Facturas'} → ${c.factura_numero ?? ''} → Imprimir o descargar.`
          : `Siigo no entregó el PDF — ${motivoDe(r)}`
        return json({ ok: false, error: e })
      }

      let actualizado = false, avisoSiigo: string | null = null
      let d: any = c.factura_detalle?.respuesta ?? null
      // Lo que la DIAN contestó, si se puede pedir. Siigo lo expone para la
      // factura en GET /v1/invoices/{id}/stamp/errors; para el documento
      // soporte se prueba la ruta equivalente y, si no existe, se dice.
      let selloErrores: { mensajes: string[]; aviso: string | null } | null = null
      if ((c.factura_estado === 'emitida' || c.factura_estado === 'anulada') && c.factura_id && cfg) {
        const t = await tokenDe(userId, cfg)
        if ('error' in t) avisoSiigo = t.error
        else {
          const r = await siigo('GET', `${rutaDoc}/${encodeURIComponent(String(c.factura_id))}`, { token: t.token, partner })
          if (r.ok && r.data && typeof r.data === 'object') {
            // La consulta del documento soporte vuelve SIN ítems y con total
            // 0 (Siigo no los devuelve en el GET), así que no puede pisar lo
            // que contestó al crearlo. Se guarda la respuesta de creación
            // aparte y se toma de la consulta solo lo que cambia: sello,
            // estado, enlace.
            // Los documentos consultados antes de este arreglo ya tienen la
            // respuesta pisada; la de creación sobrevive en `intentos`.
            const intentoOk = Array.isArray(c.factura_detalle?.intentos) ? c.factura_detalle.intentos.find((i: any) => i && i.status >= 200 && i.status < 300 && i.respuesta && typeof i.respuesta === 'object') : null
            const creacion = c.factura_detalle?.respuesta_creacion ?? intentoOk?.respuesta ?? c.factura_detalle?.respuesta ?? null
            const g = r.data
            d = creacion && typeof creacion === 'object'
              ? { ...creacion, ...g,
                items: Array.isArray(g.items) && g.items.length ? g.items : creacion.items,
                payments: Array.isArray(g.payments) && g.payments.length ? g.payments : creacion.payments,
                total: Number(g.total) > 0 ? g.total : creacion.total,
                stamp: g.stamp ?? creacion.stamp }
              : g
            const cambios: Record<string, unknown> = {}
            const cufe = d.stamp?.cufe ?? d.stamp?.cude ?? null
            if (cufe && cufe !== c.factura_cufe) cambios.factura_cufe = cufe
            if (d.public_url && d.public_url !== c.factura_url) cambios.factura_url = d.public_url
            const numero = d.name ?? (d.number != null ? `${d.prefix ?? ''}${d.number}` : null)
            if (numero && numero !== c.factura_numero) cambios.factura_numero = numero
            // Anulado en Siigo (la factura trae `annulled`; el documento
            // soporte se elimina y desaparece, ver el 404 abajo).
            if (d.annulled === true || /anul|cancel/i.test(String(d.status ?? ''))) {
              cambios.factura_estado = 'anulada'
              cambios.factura_error = `Anulado en Siigo${d.status ? ` (estado «${d.status}»)` : ''}.`
            } else if (c.factura_estado === 'anulada' && !(Array.isArray(c.factura_detalle?.notas_credito) && c.factura_detalle.notas_credito_parciales === false)) {
              // Solo se revierte una anulación que se leyó de la marca de
              // Siigo; la que viene de una nota crédito no se deshace porque
              // la factura siga existiendo (siempre sigue).
              cambios.factura_estado = 'emitida'; cambios.factura_error = null
            }
            cambios.factura_detalle = { ...(c.factura_detalle ?? {}), respuesta_creacion: creacion ?? g, respuesta: d, respuesta_consulta: g, consultado_at: new Date().toISOString() }
            await db.from('comprobantes').update(cambios).eq('folio', c.folio).then(() => {}, () => {})
            Object.assign(c, cambios)
            actualizado = true
            // ¿Se anuló con nota crédito? La factura no lo dice: se pregunta
            // por las notas crédito que apuntan a ella.
            if (clase === 'FV' && c.factura_estado === 'emitida') {
              try {
                const fechaF = String(d.date ?? c.factura_at ?? '').slice(0, 10)
                const desdeNC = fechaF ? new Date(Date.parse(fechaF) - 86_400_000).toISOString().slice(0, 10) : new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
                const ncs = (await notasCreditoDesde(t.token, partner, desdeNC, String(c.factura_id))).get(String(c.factura_id)) ?? []
                if (ncs.length) {
                  await aplicarNotasCredito(c, ncs)
                  const { data: fresco } = await db.from('comprobantes').select('*').eq('folio', c.folio).maybeSingle()
                  if (fresco) Object.assign(c, fresco)
                }
              } catch (e) { avisoSiigo = String((e as Error)?.message ?? e) }
            }
            // Rechazado por la DIAN: pedir el detalle del rechazo.
            if (/reject|rechaz|error|fail/i.test(String(d.stamp?.status ?? ''))) {
              const re = await siigo('GET', `${rutaDoc}/${encodeURIComponent(String(c.factura_id))}/stamp/errors`, { token: t.token, partner })
              const lista = Array.isArray(re.data?.errors) ? re.data.errors : Array.isArray(re.data) ? re.data : null
              selloErrores = re.ok && lista
                ? { mensajes: lista.map((x: any) => typeof x === 'string' ? x : [x.code ?? x.Code, x.message ?? x.Message ?? x.description].filter(Boolean).join(' · ')).filter(Boolean), aviso: null }
                : { mensajes: [], aviso: `Siigo no entregó el detalle del rechazo por API (${motivoDe(re)} en ${rutaDoc}/{id}/stamp/errors). Se ve en Siigo Nube: ${clase === 'DS' ? 'Compras → Documento soporte' : 'Ventas → Facturas'} → ${c.factura_numero ?? ''} → Ver inconsistencias.` }
              if (selloErrores.mensajes.length) {
                const det = { ...(c.factura_detalle ?? {}), respuesta: d, rechazo_dian: selloErrores.mensajes, consultado_at: new Date().toISOString() }
                await db.from('comprobantes').update({ factura_detalle: det }).eq('folio', c.folio).then(() => {}, () => {})
              }
            }
          } else if (r.status === 404 && c.factura_estado === 'emitida') {
            // Siigo ya no lo tiene: se eliminó/anuló allá. Queda registrado
            // así, con el número que tuvo, y el movimiento vuelve a poder
            // emitirse.
            const cambios = { factura_estado: 'anulada', factura_error: `Eliminado en Siigo: al consultarlo contestó HTTP 404 (${motivoDe(r).replace(/^HTTP \d+:?\s*/, '')}).`, factura_detalle: { ...(c.factura_detalle ?? {}), consultado_at: new Date().toISOString(), consulta_status: 404 } }
            await db.from('comprobantes').update(cambios).eq('folio', c.folio).then(() => {}, () => {})
            Object.assign(c, cambios)
            actualizado = true
          } else if (r.status !== 404) avisoSiigo = `No se pudo consultar el documento en Siigo — ${motivoDe(r)}`
        }
      }
      if (!selloErrores && Array.isArray(c.factura_detalle?.rechazo_dian)) selloErrores = { mensajes: c.factura_detalle.rechazo_dian, aviso: null }
      const items = Array.isArray(d?.items) ? d.items.map((it: any) => ({
        code: it.code ?? null, description: it.description ?? null, quantity: it.quantity ?? null, price: it.price ?? null, total: it.total ?? null,
        taxes: Array.isArray(it.taxes) ? it.taxes.map((x: any) => ({ name: x.name ?? null, percentage: x.percentage ?? null, value: x.value ?? null })) : [],
      })) : []
      const stamp = d?.stamp && typeof d.stamp === 'object' ? { status: d.stamp.status ?? null, cufe: d.stamp.cufe ?? null, cude: d.stamp.cude ?? null, observations: d.stamp.observations ?? null, errors: d.stamp.errors ?? null } : null
      const contraparte = d?.supplier ?? d?.customer ?? null
      // Lo que Lincoin le mandó a Siigo (ítems con su precio), para cotejar
      // contra lo que Siigo contestó: si los totales no coinciden, se ve.
      const enviado = c.factura_detalle?.enviado ?? null
      const enviadoResumen = enviado && typeof enviado === 'object' ? {
        fecha: enviado.date ?? null,
        items: Array.isArray(enviado.items) ? enviado.items.map((it: any) => ({ code: it.code ?? null, description: it.description ?? null, quantity: it.quantity ?? null, price: it.price ?? null })) : [],
        total: Array.isArray(enviado.payments) ? enviado.payments.reduce((s: number, p: any) => s + (Number(p.value) || 0), 0) : null,
      } : null
      // ¿La factura es (o era) a nombre de la misma empresa? Entonces no se
      // ofrece volver a emitirla, y se dice por qué.
      const clienteFact = c.factura_detalle?.comision?.cliente?.identification ?? enviado?.customer?.identification ?? null
      const mismaEmpresa = !!clienteFact && (await documentosPropios(userId)).has(baseDoc(clienteFact))
      return json({
        ok: true,
        comprobante: { folio: c.folio, numero: c.numero, tipo: c.tipo, monto: c.monto, moneda: c.moneda, emitido_at: c.emitido_at },
        documento: c.factura_estado ? {
          estado: c.factura_estado, tipo: clase, numero: c.factura_numero ?? null, id: c.factura_id ?? null,
          cufe: c.factura_cufe ?? null, url: c.factura_url ?? null, error: c.factura_error ?? null, fecha: c.factura_at ?? null,
          siigo: d ? { fecha: d.date ?? null, total: d.total ?? null, balance: d.balance ?? null, observations: d.observations ?? null, stamp, contraparte: contraparte ? { identification: contraparte.identification ?? null, name: contraparte.name ?? contraparte.commercial_name ?? null } : null, items } : null,
          enviado: enviadoResumen,
          rechazo_dian: selloErrores,
          // El PDF por API solo existe para la factura de venta.
          pdf_api: clase === 'FV',
          notas_credito: Array.isArray(c.factura_detalle?.notas_credito) ? c.factura_detalle.notas_credito : [],
          anteriores: Array.isArray(c.factura_detalle?.anteriores) ? c.factura_detalle.anteriores.map((a: any) => ({ numero: a?.numero ?? null, total: a?.total ?? null, notas_credito: a?.notas_credito ?? [] })) : [],
          mal_calculada: facturaMalCalculada(c),
          // Se puede volver a emitir al mismo cliente de la factura anulada, y
          // así va a quedar: terceros por el monto completo + la comisión.
          // Modelo Comisión: un depósito no lleva factura (ni para reemplazar
          // una anulada). La pantalla no ofrece emitirla.
          solo_envios: esMandato(cfg) && !SALIDAS.includes(String(c.tipo ?? '')),
          misma_empresa: mismaEmpresa,
          reemision: !mismaEmpresa && !(esMandato(cfg) && !SALIDAS.includes(String(c.tipo ?? ''))) && (c.factura_estado === 'anulada' || (c.factura_estado === 'error' && Array.isArray(c.factura_detalle?.anteriores) && c.factura_detalle.anteriores.length > 0)) && c.factura_detalle?.comision?.cliente?.identification ? (() => {
            const monto = Number(String(c.monto ?? '0').replace(/,/g, '')) || 0
            const pct = Number(c.factura_detalle.comision.pct) || 0
            const comision = r2(monto * pct / 100)
            return { cliente: { identification: String(c.factura_detalle.comision.cliente.identification), nombre: c.factura_detalle.comision.cliente.nombre ?? null }, pct, terceros: r2(monto), comision, total: r2(monto + comision) }
          })() : null,
          respuesta_cruda: d ? JSON.stringify(d).slice(0, 6000) : null,
          actualizado, aviso: avisoSiigo,
        } : null,
      })
    }

    if (accion === 'facturas') {
      const { data } = await db.from('comprobantes')
        .select('folio, numero, transaction_id, tipo, monto, moneda, emitido_at, factura_estado, factura_tipo, factura_numero, factura_cufe, factura_url, factura_error, factura_at, factura_intentos')
        .eq('user_id', userId).order('emitido_at', { ascending: false }).limit(2000)
      return json({ ok: true, facturas: data ?? [] })
    }

    return json({ error: 'accion_desconocida' }, 400)
  } catch (e) {
    return json({ error: 'interno', mensaje: (e as Error)?.message ?? String(e) }, 500)
  }
})
