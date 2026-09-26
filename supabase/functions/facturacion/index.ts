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
//    POST /v1/invoices                   emitir (stamp = DIAN, mail = correo)
//  Los ids de esos catálogos son de CADA cuenta: no hay valores por defecto.
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

// Lo que ve la pantalla: nunca la access key.
function publica(cfg: any, resumen?: any) {
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

// ── Catálogos ─────────────────────────────────────────────────────
async function traerCatalogos(token: string, partner: string) {
  const lista = (r: Resp): any[] => Array.isArray(r.data) ? r.data : Array.isArray(r.data?.results) ? r.data.results : []
  const [doc, usr, pag, prod] = await Promise.all([
    siigo('GET', '/v1/document-types?type=FV', { token, partner }),
    siigo('GET', '/v1/users', { token, partner }),
    siigo('GET', '/v1/payment-types?document_type=FV', { token, partner }),
    siigo('GET', '/v1/products?page=1&page_size=100', { token, partner }),
  ])
  const fuentes: Record<string, { ok: boolean; status: number; motivo: string | null; n: number }> = {}
  const anota = (k: string, r: Resp, arr: any[]) => { fuentes[k] = { ok: r.ok, status: r.status, motivo: r.ok ? null : motivoDe(r), n: arr.length } }
  const documentos = lista(doc).map((d: any) => ({ id: d.id, code: d.code, name: d.name, electronic: d.electronic_type ?? d.electronic ?? null }))
  const vendedores = lista(usr).map((u: any) => ({ id: u.id, nombre: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id), username: u.username, activo: u.active }))
  const pagos = lista(pag).map((p: any) => ({ id: p.id, name: p.name, type: p.type }))
  const productos = lista(prod).map((p: any) => ({ id: p.id, code: p.code, name: p.name, type: p.type, active: p.active }))
  anota('documentos', doc, documentos); anota('vendedores', usr, vendedores); anota('pagos', pag, pagos); anota('productos', prod, productos)
  return { documentos, vendedores, pagos, productos, fuentes, traido_at: new Date().toISOString() }
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

async function asegurarCliente(token: string, partner: string, cfg: any, cp: Contraparte): Promise<{ ok: true } | { ok: false; error: string }> {
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
      type: 'Customer', person_type: 'Company', id_type: '31',
      identification: cp.identification, ...(cp.check_digit ? { check_digit: cp.check_digit } : {}),
      name: [cp.nombre], commercial_name: cp.nombre, branch_office: 0, active: true,
      vat_responsible: false, fiscal_responsibilities: [{ code: 'R-99-PN' }],
    }
    : {
      type: 'Customer', person_type: 'Person', id_type: '13',
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
  const dispara = Array.isArray(cfg.disparadores) ? cfg.disparadores : []
  const tipo = String((comp as any).tipo ?? '')
  if (!opts.forzar && !dispara.includes(tipo)) { await marcar({ factura_estado: 'omitida', factura_error: `El tipo "${DISPARADORES[tipo] ?? tipo}" no está entre los que se facturan.` }); return { ok: true, estado: 'omitida' } }
  // Ya emitida: no se emite dos veces.
  if ((comp as any).factura_estado === 'emitida' && (comp as any).factura_numero) return { ok: true, estado: 'emitida', numero: (comp as any).factura_numero }
  const faltan = ['document_id', 'seller_id', 'payment_id', 'product_code'].filter(k => !cfg[k])
  if (faltan.length) { const e = `Falta elegir en Configuración: ${faltan.join(', ')}.`; await marcar({ factura_estado: 'error', factura_error: e }); return { ok: false, error: e } }

  const partner = cfg.partner_id || 'Lincoin'
  const t = await tokenDe(userId, cfg)
  if ('error' in t) { await marcar({ factura_estado: 'error', factura_error: t.error }); return { ok: false, error: t.error } }

  const cp = contraparteDe(comp, cfg)
  const cli = await asegurarCliente(t.token, partner, cfg, cp)
  if (!cli.ok) { await marcar({ factura_estado: 'error', factura_error: cli.error }); return { ok: false, error: cli.error } }

  // El monto como número para Siigo, desde el texto que guardó el comprobante.
  const monto = Number(String((comp as any).monto ?? '0').replace(/,/g, ''))
  if (!Number.isFinite(monto) || monto <= 0) { const e = `Monto inválido en el comprobante: ${(comp as any).monto}`; await marcar({ factura_estado: 'error', factura_error: e }); return { ok: false, error: e } }
  const hoy = new Date().toISOString().slice(0, 10)
  const descripcion = (cfg.product_description || `${DISPARADORES[tipo] ?? tipo} · Lincoin`)
    .replace('{numero}', String((comp as any).numero)).replace('{tipo}', DISPARADORES[tipo] ?? tipo).replace('{contraparte}', cp.nombre)
  const cuerpo = {
    document: { id: Number(cfg.document_id) },
    date: hoy,
    customer: { identification: cp.identification, branch_office: 0 },
    seller: Number(cfg.seller_id),
    stamp: { send: !!cfg.stamp },
    mail: { send: !!cfg.mail },
    observations: [cfg.observaciones, `Comprobante Lincoin ${(comp as any).numero}`].filter(Boolean).join(' · ').slice(0, 500),
    items: [{ code: String(cfg.product_code), description: descripcion.slice(0, 500), quantity: 1, price: monto }],
    payments: [{ id: Number(cfg.payment_id), value: monto, due_date: hoy }],
  }
  const r = await siigo('POST', '/v1/invoices', { token: t.token, partner, body: cuerpo })
  if (!r.ok) {
    const e = `Siigo rechazó la factura — ${motivoDe(r)}`
    await marcar({ factura_estado: 'error', factura_error: e, factura_detalle: { enviado: cuerpo, respuesta: r.data ?? r.texto } })
    return { ok: false, error: e }
  }
  const d = r.data ?? {}
  const numero = d.name ?? (d.number != null ? `${d.prefix ?? ''}${d.number}` : null) ?? String(d.id ?? '')
  await marcar({
    factura_estado: 'emitida', factura_error: null,
    factura_proveedor: 'siigo', factura_id: d.id != null ? String(d.id) : null,
    factura_numero: numero, factura_cufe: d.stamp?.cufe ?? null, factura_url: d.public_url ?? null,
    factura_at: new Date().toISOString(), factura_detalle: { enviado: cuerpo, respuesta: d },
  })
  return { ok: true, estado: 'emitida', numero, cufe: d.stamp?.cufe ?? null, url: d.public_url ?? null }
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
      return json({ ok: true, config: publica(await leerConfig(userId), await resumenDe(userId)), disparadores: DISPARADORES })
    }

    if (accion === 'config_set') {
      const c = body.config ?? {}
      const fila: Record<string, unknown> = { user_id: userId, proveedor: 'siigo', updated_at: new Date().toISOString() }
      const copiar = ['username', 'partner_id', 'product_code', 'product_description', 'cliente_default_nit', 'cliente_default_nombre', 'observaciones']
      for (const k of copiar) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : String(c[k]).trim()
      for (const k of ['document_id', 'seller_id', 'payment_id']) if (k in c) fila[k] = c[k] == null || c[k] === '' ? null : Number(c[k])
      for (const k of ['activo', 'crear_clientes', 'stamp', 'mail']) if (k in c) fila[k] = !!c[k]
      if (Array.isArray(c.disparadores)) fila.disparadores = c.disparadores.filter((d: any) => typeof d === 'string' && d in DISPARADORES)
      // La access key solo se toca si viene una nueva. Vacío = se conserva.
      if (typeof c.access_key === 'string' && c.access_key.trim()) {
        try { fila.access_key_enc = await encField(c.access_key.trim()) }
        catch { return json({ ok: false, error: 'No se pudo cifrar la access key: falta FIELD_ENC_KEY en el servidor.' }, 500) }
        tokens.delete(userId)
      }
      // Activar exige que todo lo necesario esté elegido. Activar a medias
      // solo produce facturas en error.
      if (fila.activo === true) {
        const actual = { ...(await leerConfig(userId) ?? {}), ...fila }
        const faltan = ['username', 'document_id', 'seller_id', 'payment_id', 'product_code'].filter(k => !actual[k])
        if (!actual.access_key_enc) faltan.unshift('access_key')
        if (faltan.length) return json({ ok: false, error: `Para activar falta: ${faltan.join(', ')}.` }, 400)
      }
      const { error } = await db.from('facturacion_config').upsert(fila, { onConflict: 'user_id' })
      if (error) {
        if (/does not exist|42P01|schema cache/i.test(error.message)) return json({ ok: false, error: 'Falta correr la migración 2026_facturacion.sql en la base.' }, 500)
        return json({ ok: false, error: error.message }, 500)
      }
      return json({ ok: true, config: publica(await leerConfig(userId), await resumenDe(userId)) })
    }

    if (accion === 'probar') {
      const cfg = await leerConfig(userId)
      if (!cfg) return json({ ok: false, error: 'Primero guardá el usuario y la access key.' })
      const partner = cfg.partner_id || 'Lincoin'
      const t = await tokenDe(userId, cfg, true)
      const ahora = new Date().toISOString()
      if ('error' in t) {
        await db.from('facturacion_config').update({ ultimo_test_at: ahora, ultimo_test_ok: false, ultimo_error: t.error }).eq('user_id', userId)
        return json({ ok: false, error: t.error, config: publica(await leerConfig(userId)) })
      }
      const cat = await traerCatalogos(t.token, partner)
      const conProblemas = Object.entries(cat.fuentes).filter(([, f]) => !f.ok).map(([k, f]) => `${k}: ${f.motivo}`)
      await db.from('facturacion_config').update({
        ultimo_test_at: ahora, ultimo_test_ok: true, catalogos: cat,
        ultimo_error: conProblemas.length ? `Conectó, pero: ${conProblemas.join(' | ')}` : null,
      }).eq('user_id', userId)
      return json({ ok: true, catalogos: cat, aviso: conProblemas.length ? conProblemas.join(' | ') : null, config: publica(await leerConfig(userId), await resumenDe(userId)) })
    }

    if (accion === 'reintentar') {
      const folio = Number(body.folio)
      if (!folio) return json({ ok: false, error: 'falta_folio' }, 400)
      const { data: comp } = await db.from('comprobantes').select('user_id').eq('folio', folio).maybeSingle()
      if (!comp || String((comp as any).user_id) !== userId) return json({ ok: false, error: 'comprobante_no_encontrado' }, 404)
      return json(await emitir(folio, { forzar: true }))
    }

    if (accion === 'facturas') {
      const { data } = await db.from('comprobantes')
        .select('folio, numero, transaction_id, tipo, monto, moneda, emitido_at, factura_estado, factura_numero, factura_cufe, factura_url, factura_error, factura_at, factura_intentos')
        .eq('user_id', userId).order('emitido_at', { ascending: false }).limit(2000)
      return json({ ok: true, facturas: data ?? [] })
    }

    return json({ error: 'accion_desconocida' }, 400)
  } catch (e) {
    return json({ error: 'interno', mensaje: (e as Error)?.message ?? String(e) }, 500)
  }
})
