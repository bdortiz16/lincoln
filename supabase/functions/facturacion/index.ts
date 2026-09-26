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
async function siigo(metodo: 'GET' | 'POST', ruta: string, opts: { token?: string; partner?: string; body?: unknown }): Promise<Resp> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (opts.partner) headers['Partner-Id'] = opts.partner
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  try {
    const ctrl = new AbortController()
    const reloj = setTimeout(() => ctrl.abort(), 25000)
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
  if (r.status === 0) return `No se pudo llegar a Siigo: ${r.texto}`
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
type Contraparte = { identification: string; check_digit?: string; nombre: string; esDefault: boolean; esEmpresa: boolean }
function contraparteDe(comp: any, cfg: any): Contraparte {
  const rd = comp?.detalle?.raw_data ?? {}
  const doc = String(rd.docNumber ?? rd.documentNumber ?? rd.beneficiaryDoc ?? rd.beneficiaryDocument ?? rd.senderDoc ?? '').replace(/\D/g, '')
  const tipoDoc = String(rd.docType ?? rd.documentType ?? rd.beneficiaryDocType ?? '').toUpperCase()
  const nombre = String(rd.beneficiary ?? rd.beneficiaryName ?? rd.senderName ?? rd.recipientName ?? comp?.contraparte ?? '').trim()
  if (doc) {
    // Es empresa si el tipo dice NIT; si no hay tipo, por la longitud (una
    // cédula no llega a 9 dígitos salvo las muy nuevas, que van a 10).
    const esEmpresa = tipoDoc ? tipoDoc === 'NIT' : doc.length === 9
    const partes = esEmpresa ? partirNit(doc) : { identification: doc }
    return { ...partes, nombre: nombre || doc, esDefault: false, esEmpresa }
  }
  return { identification: String(cfg.cliente_default_nit || '222222222222').replace(/\D/g, ''), nombre: cfg.cliente_default_nombre || 'Consumidor final', esDefault: true, esEmpresa: false }
}

async function asegurarCliente(token: string, partner: string, cfg: any, cp: Contraparte, rol: 'Customer' | 'Supplier' = 'Customer'): Promise<{ ok: true } | { ok: false; error: string }> {
  const busca = await siigo('GET', `/v1/customers?identification=${encodeURIComponent(cp.identification)}`, { token, partner })
  const hay = Array.isArray(busca.data?.results) ? busca.data.results.length > 0 : Array.isArray(busca.data) ? busca.data.length > 0 : false
  if (busca.ok && hay) return { ok: true }
  if (!busca.ok) return { ok: false, error: `Buscando al cliente en Siigo — ${motivoDe(busca)}` }
  if (!cfg.crear_clientes) return { ok: false, error: `El cliente ${cp.identification} no existe en Siigo y "crear clientes" está apagado.` }
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
    }
    : {
      type: rol, person_type: 'Person', id_type: '13',
      identification: cp.identification,
      name: [partes[0] ?? cp.nombre, partes.slice(1).join(' ') || '.'], branch_office: 0, active: true,
      vat_responsible: false, fiscal_responsibilities: [{ code: 'R-99-PN' }],
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
  let clase: 'FV' | 'DS' = regla ?? (esSalida ? 'DS' : 'FV')
  // El documento soporte siempre es UN ítem por el monto total (el del
  // motivo, o el general de terceros), aunque el modelo sea rotación.
  let cfgEmision: any = clase === 'DS' ? { ...cfg, modelo: 'psp' } : cfg
  if (reglaMotivo) {
    if (reglaMotivo.emite === 'DS' && reglaMotivo.item) {
      clase = 'DS'
      cfgEmision = { ...cfg, modelo: 'psp', item_terceros: reglaMotivo.item }
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
  // El documento soporte va A NOMBRE DEL BENEFICIARIO del envío, con el
  // nombre y documento con que se le envió. Nunca a un "consumidor final":
  // si el envío no trae documento, no se emite y se dice.
  if (clase === 'DS' && cp.esDefault) {
    const e = 'El envío no trae el documento del beneficiario, y el documento soporte va a su nombre. Revisá el beneficiario en la lista.'
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
  const { items, total, error: errorItems } = itemsDe(cfgEmision, monto, ctx)
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
      observations, items,
      payments: [{ id: Number(cfg.ds_payment_id), value: total, due_date: hoy }],
    }
  // En compras (documento soporte) Siigo exige el TIPO de cada ítem:
  // "Product" o "Service". Sale del catálogo, que trae el tipo de cada
  // producto tal como está en Siigo.
  if (clase === 'DS') {
    const productos: any[] = Array.isArray(cfg.catalogos?.productos) ? cfg.catalogos.productos : []
    for (const it of (cuerpo as any).items) {
      const p = productos.find((x: any) => String(x.code) === String(it.code))
      const t = String(p?.type ?? '')
      it.type = /service|servicio/i.test(t) ? 'Service' : 'Product'
    }
  }
  const ruta = clase === 'FV' ? '/v1/invoices' : '/v1/purchases'
  const r = await siigo('POST', ruta, { token: t.token, partner, body: cuerpo })
  if (!r.ok) {
    const e = `Siigo rechazó ${clase === 'FV' ? 'la factura' : 'el documento soporte'} — ${motivoDe(r)}`
    await marcar({ factura_estado: 'error', factura_error: e, factura_tipo: clase, factura_detalle: { enviado: cuerpo, respuesta: r.data ?? r.texto } })
    return { ok: false, error: e }
  }
  const d = r.data ?? {}
  const numero = d.name ?? (d.number != null ? `${d.prefix ?? ''}${d.number}` : null) ?? String(d.id ?? '')
  await marcar({
    factura_estado: 'emitida', factura_error: null, factura_tipo: clase,
    factura_proveedor: 'siigo', factura_id: d.id != null ? String(d.id) : null,
    factura_numero: numero, factura_cufe: d.stamp?.cufe ?? null, factura_url: d.public_url ?? null,
    factura_at: new Date().toISOString(), factura_detalle: { enviado: cuerpo, respuesta: d },
  })
  return { ok: true, estado: 'emitida', tipo: clase, numero, cufe: d.stamp?.cufe ?? null, url: d.public_url ?? null }
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
    const userId = yo.userId

    if (accion === 'config_get') {
      return json({ ok: true, config: await publica(await leerConfig(userId), await resumenDe(userId)), disparadores: DISPARADORES })
    }

    if (accion === 'config_set') {
      const c = body.config ?? {}
      const fila: Record<string, unknown> = { user_id: userId, proveedor: 'siigo', updated_at: new Date().toISOString() }
      const copiar = ['username', 'partner_id', 'product_code', 'product_description', 'cliente_default_nit', 'cliente_default_nombre', 'observaciones']
      for (const k of copiar) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : String(c[k]).trim()
      for (const k of ['document_id', 'seller_id', 'payment_id', 'ds_document_id', 'ds_payment_id']) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : Number(c[k])
      for (const k of ['activo', 'crear_clientes', 'stamp', 'mail']) if (k in c) fila[k] = !!c[k]
      if (Array.isArray(c.disparadores)) fila.disparadores = c.disparadores.filter((d: any) => typeof d === 'string' && d in DISPARADORES)
      // El modelo de negocio y sus parámetros.
      if ('modelo' in c) {
        fila.modelo = c.modelo === 'rotacion' || c.modelo === 'psp' ? c.modelo : null
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
      if (Array.isArray(c.operaciones) && (fila.modelo === 'rotacion' || fila.modelo === 'psp')) {
        const d: Record<string, string> = {}
        for (const k of c.operaciones) if (typeof k === 'string' && k in DISPARADORES) d[k] = fila.modelo === 'rotacion' ? 'FV' : 'DS'
        fila.documentos = d
        fila.disparadores = Object.keys(d)
      }
      // Por motivo del envío: documento soporte con qué ítem, o nada.
      if (c.motivos && typeof c.motivos === 'object' && !Array.isArray(c.motivos)) {
        const m: Record<string, { emite: 'DS' | 'no'; item: string | null }> = {}
        for (const [k, v] of Object.entries(c.motivos as Record<string, any>)) {
          if (!(k in MOTIVOS_ENVIO) || !v || typeof v !== 'object') continue
          m[k] = { emite: v.emite === 'DS' ? 'DS' : 'no', item: v.item ? String(v.item).trim().slice(0, 100) : null }
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
        if (motivosDS.length) clases.add('DS')
        for (const [k, v] of motivosDS) if (!v.item) faltan.push(`el ítem del motivo "${MOTIVOS_ENVIO[k] ?? k}"`)
        if (!Object.keys(reglas).length && !motivosDS.length) faltan.push('qué operaciones emiten')
        if (clases.has('FV')) for (const k of ['document_id', 'seller_id', 'payment_id']) if (!actual[k]) faltan.push(`${k} (factura de venta)`)
        if (clases.has('DS')) for (const k of ['ds_document_id', 'ds_payment_id']) if (!actual[k]) faltan.push(`${k} (documento soporte)`)
        if (modelo === 'rotacion') {
          if (!(Number(actual.utilidad_pct) > 0)) faltan.push('el porcentaje de utilidad')
          if (!actual.item_terceros) faltan.push('el ítem de servicio para terceros')
          if (!actual.item_comision) faltan.push('el ítem de comisión')
        } else if (modelo === 'psp') {
          // En PSP el ítem va por motivo: basta con que un motivo emita
          // documento soporte con su ítem (ya validado arriba).
          if (!motivosDS.length) faltan.push('al menos un motivo de envío con documento soporte')
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
      let { data: comp } = await db.from('comprobantes').select('folio').eq('transaction_id', txId).maybeSingle()
      if (!comp) {
        const rd = ((tx as any).raw_data ?? {}) as Record<string, any>
        const t = String((tx as any).type)
        const contraparte = (t === 'dispersion' || t === 'send') ? (rd.beneficiary ?? rd.bank ?? null)
          : t === 'pay_received' ? (rd.senderName ?? null) : t === 'pay_sent' ? (rd.recipientName ?? null)
            : t === 'load' ? (rd.method ?? rd.bank ?? null) : null
        const fila = {
          transaction_id: txId, user_id: userId, tipo: t, monto: String((tx as any).amount), moneda: (tx as any).currency,
          contraparte, estado_al_emitir: (tx as any).status,
          detalle: { id: txId, type: t, amount: (tx as any).amount, currency: (tx as any).currency, status: (tx as any).status, raw_data: rd },
        }
        const ins = await db.from('comprobantes').insert(fila).select('folio').maybeSingle()
        if (ins.error && ins.error.code !== '23505') return json({ ok: false, error: `No se pudo crear el comprobante: ${ins.error.message}` }, 500)
        comp = ins.data ?? (await db.from('comprobantes').select('folio').eq('transaction_id', txId).maybeSingle()).data
        if (!comp) return json({ ok: false, error: 'No se pudo crear el comprobante del movimiento.' }, 500)
      }
      return json(await emitir(Number((comp as any).folio), { forzar: true }))
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
