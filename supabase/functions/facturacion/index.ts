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
async function siigo(metodo: 'GET' | 'POST' | 'PUT', ruta: string, opts: { token?: string; partner?: string; body?: unknown; ms?: number }): Promise<Resp> {
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
    return { ok: r.ok, status: r.status, data, texto: texto.slice(0, 2000) }
  } catch (e) {
    return { ok: false, status: 0, data: null, texto: (e as Error)?.message ?? 'red' }
  }
}

// El motivo de Siigo, en una línea legible.
function motivoDe(r: Resp): string {
  if (r.status === 0) return /abort/i.test(r.texto)
    ? 'Siigo no contestó a tiempo (se esperó más de un minuto). OJO: el documento puede haberse creado igual en Siigo. Antes de emitir de nuevo, revisá en Siigo Nube si ya existe, para no duplicarlo.'
    : `No se pudo llegar a Siigo: ${r.texto}`
  const d = r.data
  const errs = Array.isArray(d?.Errors) ? d.Errors : Array.isArray(d?.errors) ? d.errors : null
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

// Lo que ve la pantalla: nunca la access key. Sí una PISTA de la guardada
// —cuántos caracteres, cómo empieza y cómo termina— para que quien la pegó
// pueda compararla con la del portal de Siigo sin que nadie la vea entera.
async function publica(cfg: any, resumen?: any) {
  if (!cfg) return { existe: false, activo: false, tieneAccessKey: false, disparadores: ['load', 'pay_received'], stamp: true, mail: true, crear_clientes: true, cliente_default_nit: '222222222222', cliente_default_nombre: 'Consumidor final', resumen }
  const { access_key_enc, ...resto } = cfg
  let access_key_pista: { largo: number; inicio: string; fin: string } | null = null
  if (access_key_enc) {
    try {
      const k = await decField(access_key_enc)
      access_key_pista = { largo: k.length, inicio: k.slice(0, 4), fin: k.slice(-3) }
    } catch { access_key_pista = null }
  }
  return { existe: true, ...resto, tieneAccessKey: !!access_key_enc, access_key_pista, resumen }
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
function documentosDe(cfg: any): Record<string, 'FV' | 'DS'> {
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
type Contraparte = { identification: string; check_digit?: string; nombre: string; esDefault: boolean; esEmpresa: boolean; direccion: Direccion | null }
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
  const doc = String(rd.docNumber ?? rd.documentNumber ?? rd.beneficiaryDoc ?? rd.beneficiaryDocument ?? rd.senderDoc ?? '').replace(/\D/g, '')
  const tipoDoc = String(rd.docType ?? rd.documentType ?? rd.beneficiaryDocType ?? '').toUpperCase()
  const nombre = String(rd.beneficiary ?? rd.beneficiaryName ?? rd.senderName ?? rd.recipientName ?? comp?.contraparte ?? '').trim()
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
  const cuerpo = cp.esEmpresa && !cp.esDefault
    ? {
      type: rol, person_type: 'Company', id_type: '31',
      identification: cp.identification, ...(cp.check_digit ? { check_digit: cp.check_digit } : {}),
      name: [cp.nombre], commercial_name: cp.nombre, branch_office: 0, active: true,
      vat_responsible: false, fiscal_responsibilities: [{ code: 'R-99-PN' }],
      ...(cp.direccion ? { address: cp.direccion } : {}),
    }
    : {
      type: rol, person_type: 'Person', id_type: '13',
      identification: cp.identification,
      name: [partes[0] ?? cp.nombre, partes.slice(1).join(' ') || '.'], branch_office: 0, active: true,
      vat_responsible: false, fiscal_responsibilities: [{ code: 'R-99-PN' }],
      ...(cp.direccion ? { address: cp.direccion } : {}),
    }
  const crea = await siigo('POST', '/v1/customers', { token, partner, body: cuerpo })
  if (!crea.ok) return { ok: false, error: `Creando al cliente ${cp.identification} en Siigo — ${motivoDe(crea)}` }
  return { ok: true }
}

// ── Emitir la factura de UN comprobante ──────────────────────────
async function emitir(folio: number, opts: { forzar?: boolean } = {}): Promise<any> {
  const { data: comp } = await db.from('comprobantes').select('*').eq('folio', folio).maybeSingle()
  if (!comp) return { ok: false, error: 'comprobante_no_encontrado' }
  const userId = String((comp as any).user_id ?? '')
  const cfg = await leerConfig(userId)
  const marcar = async (patch: Record<string, unknown>) => {
    await db.from('comprobantes').update({ ...patch, factura_intentos: Number((comp as any).factura_intentos ?? 0) + 1 }).eq('folio', folio)
  }
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
  if (String(cfg.modelo ?? '') === 'comision') {
    if (!opts.forzar && !regla) {
      await marcar({ factura_estado: 'omitida', factura_error: `El tipo "${DISPARADORES[tipo] ?? tipo}" no cobra comisión (Configuración → qué movimientos cobran comisión).` })
      return { ok: true, estado: 'omitida' }
    }
    if ((comp as any).factura_estado === 'emitida' && (comp as any).factura_numero) return { ok: true, estado: 'emitida', numero: (comp as any).factura_numero }
    // A quién: en un ENVÍO, al ordenante (el cliente por cuenta de quien se
    // pagó), que se elige al enviar y viaja en raw_data.recipient.ordenante.
    // En un DEPÓSITO, a quien mandó la plata (la contraparte).
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
    const cpC = contraparteDe(comp, cfg)
    if (cpC.esDefault) {
      const e = 'El depósito no trae el documento de quien mandó la plata, y la factura de comisión va a su nombre. Emitila a mano eligiendo el cliente.'
      await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: 'FV' }); return { ok: false, error: e }
    }
    return emitirComision(userId, String((comp as any).transaction_id), { identification: cpC.identification, nombre: cpC.nombre, esEmpresa: cpC.esEmpresa, auto: !opts.forzar })
  }
  // PSP: un depósito no se factura por el monto. Se factura la COMISIÓN, a
  // mano, porque hay que elegir a qué cliente (el que mandó la plata) va la
  // factura. Eso lo hace «Emitir factura» en Contabilidad (emitir_comision).
  if (String(cfg.modelo ?? '') === 'psp' && !esSalida) {
    const e = 'En PSP los depósitos se facturan a mano: la factura es por tu comisión (IVA incluido) y hay que elegir el cliente. Usá «Emitir factura» en el movimiento.'
    if (!opts.forzar) { await marcar({ factura_estado: 'omitida', factura_error: e }); return { ok: true, estado: 'omitida' } }
    return { ok: false, error: e }
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
  const observations = [cfg.observaciones, `Comprobante Lincoin ${(comp as any).numero}`].filter(Boolean).join(' · ').slice(0, 500)
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
    let e = `Siigo rechazó ${clase === 'FV' ? 'la factura' : 'el documento soporte'} — ${motivoDe(r)}`
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

// ── Factura de COMISIÓN por un depósito (modelo PSP), a mano ─────────────
// El cliente elige a quién se le factura (quien mandó la plata) y el
// porcentaje (por defecto el de Configuración). La factura lleva UN ítem: el
// de comisión, con el IVA que tiene en Siigo. Y la comisión es con IVA
// INCLUIDO: con 10.000.000 y 0,6 % la comisión es 60.000, y la factura se
// arma para que base + IVA = 60.000 (base 50.420,17 + IVA 9.579,83), no
// 60.000 + IVA. Siigo calcula el IVA sobre la base que se le manda, con la
// tarifa del ítem, así que el total puede diferir del objetivo en un
// centavo de redondeo; el pago va por lo que Siigo va a calcular.
async function emitirComision(userId: string, txId: string, d: { identification: string; nombre?: string; esEmpresa?: boolean; pct?: number; auto?: boolean }): Promise<any> {
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
  const marcar = async (patch: Record<string, unknown>) => {
    await db.from('comprobantes').update({ ...patch, factura_intentos: Number((comp as any).factura_intentos ?? 0) + 1 }).eq('folio', c.folio)
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
  const [buscaCli, rpProd] = await Promise.all([
    siigo('GET', `/v1/customers?identification=${encodeURIComponent(cp.identification)}`, { token: t.token, partner }),
    siigo('GET', `/v1/products?code=${encodeURIComponent(item)}`, { token: t.token, partner }),
  ])
  const listaCli: any[] = Array.isArray(buscaCli.data?.results) ? buscaCli.data.results : Array.isArray(buscaCli.data) ? buscaCli.data : []
  const yaExiste = buscaCli.ok && listaCli.some(x => String(x?.identification ?? '') === cp.identification)
  if (!yaExiste) {
    cp.direccion = await direccionDelBeneficiario(userId, cp.identification, cfg, cp.esEmpresa)
    const cli = await asegurarCliente(t.token, partner, cfg, cp, 'Customer')
    if (!cli.ok) return falla(cli.error)
  }

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
  // MODELO COMISIÓN = factura de MANDATO por el valor TOTAL del movimiento,
  // con dos ítems (como la FEV 723 que hizo el cliente a mano):
  //   1) Ingresos recibidos para terceros = monto − comisión, sin IVA.
  //   2) Comisión por intermediación: base tal que base + IVA = comisión.
  // 10.000.000 con 100.000 de comisión → 9.900.000 + 84.033,61 + IVA
  // 15.966,39 = 10.000.000. En PSP (depósito a mano) sigue solo la comisión.
  const mandato = String(cfg.modelo ?? '') === 'comision'
  const itemTerceros = String(cfg.item_terceros ?? '').trim()
  if (mandato && !itemTerceros) return falla('Falta elegir en Configuración el ítem de ingresos recibidos para terceros (sin IVA).')
  if (mandato) {
    const ivaT = ivaDelProducto(cfg, itemTerceros)
    if (ivaT) return falla(`El ítem de ingresos para terceros (${itemTerceros}) tiene ${ivaT.name || 'IVA'} ${ivaT.percentage} % en Siigo, y va sin IVA. Elegí otro ítem o quitale el impuesto en Siigo.`)
  }
  const descripcion = plantilla(cfg.desc_comision || (mandato ? 'Comisión por intermediación en recaudo y dispersión' : 'Comisión {utilidad} % sobre {monto} · Comprobante Lincoin {numero}')).slice(0, 500)
  const descTerceros = plantilla(cfg.desc_terceros || 'Ingresos recibidos para terceros').slice(0, 500)
  const observations = (mandato
    ? [cfg.observaciones || `Factura en desarrollo del contrato de mandato con ${cp.nombre}. Ítem 1: ingresos recibidos para terceros por cuenta del mandante; no constituyen ingreso propio (art. 29 ET). Ítem 2: comisión por intermediación en recaudo y dispersión de pagos, gravada con IVA.`, `Operación según liquidación Lincoin ${(comp as any).numero}`]
    : [cfg.observaciones, `Comprobante Lincoin ${(comp as any).numero}`, `Comisión ${pct} % sobre ${ctx.monto} COP (IVA incluido)`]).filter(Boolean).join(' · ').slice(0, 500)
  // La tarifa que manda es la que SIIGO aplica al ítem, no la del catálogo
  // guardado (puede estar viejo, o Siigo no devolver el impuesto en la lista
  // de productos). Se arma con la del catálogo; si Siigo rechaza el pago
  // porque su total es otro ("The total invoice calculated is X"), de ese X
  // se deduce la tarifa real, se recalcula la base para que base + IVA siga
  // dando la comisión, y se reintenta una vez.
  const armar = (tarifa: number) => {
    const base = r2(comision / (1 + tarifa))
    const ivaV = r2(base * tarifa)
    // Mandato: los terceros absorben el redondeo, así el total es el monto exacto.
    const terceros = mandato ? r2(monto - base - ivaV) : 0
    const total = r2(terceros + base + ivaV)
    // El impuesto va SIEMPRE en la línea cuando hay tarifa: Siigo no aplica
    // por su cuenta el IVA del producto en una factura por API (con 60.000
    // calculó el total sin IVA y rechazó el pago).
    const items = [
      ...(mandato ? [{ code: itemTerceros, description: descTerceros, quantity: 1, price: terceros }] : []),
      { code: item, description: descripcion, quantity: 1, price: base, ...(iva && tarifa > 0 ? { taxes: [{ id: iva.id }] } : {}) },
    ]
    const cuerpo = {
      document: { id: Number(cfg.document_id) }, date: hoy,
      customer: { identification: cp.identification, branch_office: 0 },
      seller: Number(cfg.seller_id),
      stamp: { send: !!cfg.stamp }, mail: { send: !!cfg.mail },
      observations, items,
      payments: [{ id: Number(cfg.payment_id), value: total, due_date: hoy }],
    }
    return { base, ivaV, total, terceros, cuerpo }
  }
  // Automática (modelo Comisión): la pausa se revisa de nuevo justo antes de
  // mandar la factura a Siigo.
  if (d.auto) {
    const vigente = await leerConfig(userId)
    if (!vigente?.activo) { await marcar({ factura_estado: 'omitida', factura_error: 'Facturación pausada antes de enviar la factura a Siigo.' }); return { ok: true, estado: 'omitida' } }
  }
  const intentos: any[] = []
  let tarifa = tarifaCatalogo
  let arm = armar(tarifa)
  let r = await siigo('POST', '/v1/invoices', { token: t.token, partner, body: arm.cuerpo, ms: 70000 })
  intentos.push({ ruta: '/v1/invoices', status: r.status, respuesta: r.data ?? r.texto, enviado: arm.cuerpo, tarifa })
  if (!r.ok) {
    const m = /total invoice calculated is\s*([\d.,]+)/i.exec(motivoDe(r))
    const totalSiigo = m ? Number(m[1].replace(/,/g, '')) : NaN
    if (Number.isFinite(totalSiigo) && arm.base > 0) {
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
  const { base, ivaV, total, cuerpo } = arm
  if (!r.ok) return falla(`Siigo rechazó la factura de comisión — ${motivoDe(r)} · Se mandó base ${base} con tarifa ${(tarifa * 100).toFixed(2)} % (${intentos.length} intento${intentos.length === 1 ? '' : 's'}). ${notaVivo}${intentos.length > 1 ? ' Se reintentó con la tarifa que Siigo aplica y tampoco.' : ''}`, { factura_detalle: { enviado: cuerpo, intentos, comision: { pct, comision, base, iva: ivaV, total, tarifa, cliente: { identification: cp.identification, nombre: cp.nombre } } } })
  const resp = r.data ?? {}
  const numero = resp.name ?? (resp.number != null ? `${resp.prefix ?? ''}${resp.number}` : null) ?? String(resp.id ?? '')
  await marcar({
    factura_estado: 'emitida', factura_error: null, factura_tipo: 'FV',
    factura_proveedor: 'siigo', factura_id: resp.id != null ? String(resp.id) : null,
    factura_numero: numero, factura_cufe: resp.stamp?.cufe ?? null, factura_url: resp.public_url ?? null,
    factura_at: new Date().toISOString(),
    factura_detalle: { enviado: cuerpo, respuesta: resp, respuesta_creacion: resp, intentos, comision: { pct, comision, base, iva: ivaV, total, tarifa, cliente: { identification: cp.identification, nombre: cp.nombre } } },
  })
  return { ok: true, estado: 'emitida', tipo: 'FV', numero, total, base, iva: ivaV, comision, tarifa, cufe: resp.stamp?.cufe ?? null, url: resp.public_url ?? null }
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

    if (!yo.userId) return json({ error: 'no_autorizado' }, 401)
    let userId = yo.userId

    // Contador con acceso aprobado: puede CONSULTAR el documento de un
    // movimiento de la empresa (nada más). El vínculo se lee de la fila de
    // la empresa, que solo escribe la función `contador`.
    const empresaPedida = String(body.empresaId ?? '')
    if (empresaPedida && empresaPedida !== userId) {
      if (accion !== 'documento' && accion !== 'documento_pdf') return json({ ok: false, error: 'no_autorizado' }, 403)
      if (!(await esContadorDe(userId, empresaPedida))) return json({ ok: false, error: 'La empresa no ha aprobado tu acceso.' }, 403)
      userId = empresaPedida
    }

    if (accion === 'config_get') {
      const chequeo = await chequeoAutomatico(userId)
      // Si hay operaciones completadas sin comprobante, se ponen al día en
      // segundo plano (el runtime de Supabase deja terminar la promesa
      // después de responder). La pantalla, al recargar, ya las ve.
      if (chequeo && chequeo.sinComprobante > 0) {
        const p = reconciliar(userId).then(r => console.log('[facturacion] reconciliar', userId, JSON.stringify(r)), e => console.error('[facturacion] reconciliar', String((e as Error)?.message ?? e)))
        const rt = (globalThis as any).EdgeRuntime
        if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p)
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
        for (const k of c.operaciones) if (typeof k === 'string' && k in DISPARADORES) d[k] = fila.modelo === 'psp' ? 'DS' : 'FV'
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
        const motivosCfg: Record<string, any> = actual.motivos && typeof actual.motivos === 'object' ? actual.motivos : {}
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
        } else if (modelo === 'comision') {
          if (!(Number(actual.utilidad_pct) > 0)) faltan.push('el porcentaje de comisión')
          if (!actual.item_comision) faltan.push('el ítem de comisión')
          if (!actual.item_terceros) faltan.push('el ítem de ingresos recibidos para terceros')
          if (!Object.keys(reglas).length) faltan.push('qué movimientos cobran comisión')
        } else if (modelo === 'psp') {
          // En PSP el ítem va por motivo: basta con que un motivo emita
          // documento soporte con su ítem (ya validado arriba).
          if (!motivosDS.length && !motivosFV.length) faltan.push('al menos un motivo de envío con documento soporte o factura')
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
        await db.from('audit_log').insert({ user_id: userId, action: fila.activo ? 'facturacion.activada' : 'facturacion.pausada', metadata: { at: new Date().toISOString() } }).then(() => {}, () => {})
      }
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
      return json({ ok: true, ...(await reconciliar(userId)) })
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
            } else if (c.factura_estado === 'anulada') {
              cambios.factura_estado = 'emitida'; cambios.factura_error = null
            }
            cambios.factura_detalle = { ...(c.factura_detalle ?? {}), respuesta_creacion: creacion ?? g, respuesta: d, respuesta_consulta: g, consultado_at: new Date().toISOString() }
            await db.from('comprobantes').update(cambios).eq('folio', c.folio).then(() => {}, () => {})
            Object.assign(c, cambios)
            actualizado = true
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
