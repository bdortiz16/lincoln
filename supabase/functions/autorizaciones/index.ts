// ══════════════════════════════════════════════════════════════════
//  autorizaciones — una empresa autoriza a las personas que operan con ella
//
//  Una cuenta Persona nace con "identificación pendiente" y solo puede
//  recibir dinero de una empresa registrada que la haya autorizado. Para
//  eso la persona escribe el ID Lincoin de la empresa y manda su nombre,
//  su documento, una foto sosteniéndolo, el documento por las dos caras,
//  el RUT, la cámara de comercio y la declaración de renta (estas dos, si
//  le aplican) y de dónde vienen sus fondos. La empresa ve la solicitud con
//  todo eso, la aprueba (fijándole un tope mensual) o la rechaza, y puede
//  revocarla después.
//
//  Dónde vive cada cosa:
//    · empresa.raw_data.personasSolicitudes  [{id, email, nombre, docType, docNumber, origenFondos, at}]
//    · empresa.raw_data.personasAutorizadas  [{id, email, nombre, docType, docNumber, topeMensual, at}]
//    · persona.raw_data.empresaAutorizante   {id, nombre}   (espejo, solo lectura)
//    · persona.raw_data.autorizacion         {estado, empresaId, empresaNombre, nombre, docType, docNumber, expediente, at}
//    · persona.documents.autorizacionFoto    la foto (base64), como los demás documentos
//    · bucket privado autorizacion-documentos   cédula, RUT, cámara y declaración
//    · audit_log empresa.persona_solicitud   copia del expediente que vio cada empresa
//  Todo lo escribe este servidor: la persona no puede autorizarse sola ni
//  cambiar su tope, y la empresa no ve los documentos de nadie que no le pidió.
//
//  Cambiar de empresa: la persona manda una solicitud nueva; cuando la
//  nueva empresa aprueba, la anterior queda reemplazada. Nunca se queda sin
//  empresa por el camino.
//
//  Acciones (todas con JWT):
//    Persona:  subir_doc {tipo, nombre, mime, base64}  → {path}   (uno por pedido)
//              solicitar {codigoEmpresa, nombre, docType, docNumber, foto, documentos, noAplica, origenFondos}
//              estado {}
//    Empresa:  listar {}  ·  ver_foto {personaId}  ·  aprobar {personaId, topeMensual}
//              rechazar {personaId}  ·  revocar {personaId}  ·  tope {personaId, topeMensual}
//    Admin:    admin_listar {empresaId}
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mergeRaw } from '../_shared/raw-data.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Quien = { id: string; email: string; role: string; nombre: string; raw: Record<string, any> }
type OrigenFondos = { fuente: string; fuenteTexto: string; detalle: string; declaraLicitud: true }
type Solicitud = { id: string; email: string; nombre: string; docType: string; docNumber: string; origenFondos?: OrigenFondos; at: string }
type DocExpediente = { tipo: string; path: string; nombre: string }

// ── Expediente de la persona ─────────────────────────────────────────
// Los documentos van a un bucket PRIVADO: la empresa los abre con una URL
// firmada que vence. En la fila del usuario (documents, en base64) pesarían
// varios MB y viajarían con cada carga del perfil.
const BUCKET = 'autorizacion-documentos'
const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
const TIPOS_DOC: Record<string, string> = {
  doc_frente: 'Documento · frente',
  doc_reverso: 'Documento · reverso',
  rut: 'RUT',
  camara_comercio: 'Cámara de comercio',
  declaracion_renta: 'Declaración de renta',
}
// La cámara de comercio y la declaración de renta no las tiene todo el
// mundo: quien no las tiene lo dice expresamente, y eso queda en el expediente.
const OPCIONALES = ['camara_comercio', 'declaracion_renta']
const FUENTES: Record<string, string> = {
  salario: 'Salario',
  honorarios: 'Honorarios o prestación de servicios',
  negocio: 'Ventas de mi negocio',
  pension: 'Pensión',
  inversiones: 'Rentas o inversiones',
  familia: 'Ayuda de familiares o remesas',
  otro: 'Otro',
}
// El pasaporte no tiene reverso.
const requeridos = (docType: string, noAplica: Record<string, boolean>) => [
  'doc_frente', ...(docType === 'PAS' ? [] : ['doc_reverso']), 'rut',
  ...OPCIONALES.filter(t => !noAplica[t]),
]

let bucketListo = false
async function asegurarBucket() {
  if (bucketListo) return
  const { error } = await db.storage.getBucket(BUCKET)
  if (error) {
    const { error: e2 } = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 5 * 1024 * 1024 })
    if (e2 && !/already exists/i.test(e2.message)) throw e2
  }
  bucketListo = true
}

// Los documentos que de verdad están en el bucket, son de esta persona y
// son del tipo que dicen (el tipo va en el nombre que les puso este
// servidor al subirlos). Una ruta inventada no cuenta.
async function documentosValidos(personaId: string, crudos: unknown): Promise<DocExpediente[]> {
  const docs = (Array.isArray(crudos) ? crudos : [])
    .filter((d: any) => d && typeof d.path === 'string' && d.path.startsWith(`${personaId}/`) && !d.path.includes('..') && TIPOS_DOC[String(d.tipo)])
    .map((d: any) => ({ tipo: String(d.tipo), path: String(d.path), nombre: String(d.nombre ?? '').slice(0, 120) }))
  const validos: DocExpediente[] = []
  for (const d of docs) {
    const corte = d.path.lastIndexOf('/')
    const carpeta = d.path.slice(0, corte), archivo = d.path.slice(corte + 1)
    if (!archivo.slice(37).startsWith(`${d.tipo}-`)) continue
    try {
      const { data: hay } = await db.storage.from(BUCKET).list(carpeta, { search: archivo, limit: 5 })
      if (Array.isArray(hay) && hay.some((x: any) => x?.name === archivo)) validos.push(d)
    } catch { /* sin poder comprobarlo, no cuenta */ }
  }
  // Uno por tipo: el último que mandó.
  const porTipo = new Map<string, DocExpediente>()
  for (const d of validos) porTipo.set(d.tipo, d)
  return [...porTipo.values()]
}
type Autorizada = Solicitud & { topeMensual: number | null; codigo?: string }

async function quienLlama(req: Request): Promise<Quien | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  const { data: { user }, error } = await db.auth.getUser(jwt)
  if (error || !user) return null
  const { data: fila } = await db.from('users').select('id, email, role, full_name, raw_data').eq('id', user.id).maybeSingle()
  if (!fila) return null
  return { id: String(fila.id), email: String(fila.email ?? user.email ?? ''), role: String(fila.role ?? ''), nombre: String(fila.full_name ?? ''), raw: (fila.raw_data ?? {}) as Record<string, any> }
}

const nombreEmpresa = (f: any): string => String(f?.company_name || f?.full_name || f?.email || '')
const codigoDe = (f: any): string => String(f?.raw_data?.ownReferralCode || String(f?.id ?? '').slice(-6)).toUpperCase()
const lista = <T,>(raw: any, k: string): T[] => Array.isArray(raw?.[k]) ? raw[k].filter((x: any) => x && x.id) : []

async function empresaPorId(id: string) {
  const { data } = await db.from('users').select('*').eq('id', id).maybeSingle()
  return data && data.role === 'business' ? data : null
}

// Aviso al usuario: campana del panel (raw_data.notifications) y teléfono
// (función push). Es un extra: si falla, el vínculo ya quedó guardado.
async function notificar(userId: string, titulo: string, mensaje: string, tipo: 'info' | 'success' = 'info', url = '/empresas_personas_autorizadas') {
  try {
    const { data: cur } = await db.from('users').select('raw_data').eq('id', userId).single()
    const raw = { ...((cur?.raw_data as any) ?? {}) }
    const lista: any[] = Array.isArray(raw.notifications) ? raw.notifications : []
    raw.notifications = [...lista, { id: Date.now(), type: tipo, title: titulo, message: mensaje, read: false, date: new Date().toLocaleDateString('es-CO') }].slice(-60)
    await mergeRaw(db, userId, { notifications: raw.notifications })
  } catch { /* la campana es un extra */ }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'enviar', user_ids: [userId], titulo, cuerpo: mensaje, tag: `autorizacion-${userId}`, url, insistir: true }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el push es un extra */ }
}

// Escribe SOLO las claves del vínculo, sobre la fila fresca.
async function guardarEmpresa(empresaId: string, autorizadas: Autorizada[], solicitudes: Solicitud[]) {
  return mergeRaw(db, empresaId, { personasAutorizadas: autorizadas, personasSolicitudes: solicitudes })
}
async function guardarPersona(personaId: string, patchRaw: Record<string, unknown>, patchDocs?: Record<string, unknown>, kyc?: string) {
  const { data: cur } = await db.from('users').select('raw_data, documents').eq('id', personaId).single()
  const upd: Record<string, unknown> = { raw_data: { ...((cur?.raw_data as any) ?? {}), ...patchRaw } }
  if (patchDocs) upd.documents = { ...((cur?.documents as any) ?? {}), ...patchDocs }
  if (kyc) upd.kyc_status = kyc
  const { error } = await db.from('users').update(upd).eq('id', personaId)
  return error ? error.message : null
}

// ¿Hay constancia ESCRITA POR ESTE SERVIDOR del vínculo? Las listas
// personasSolicitudes / personasAutorizadas viven en el raw_data de la
// empresa, y esa fila la puede editar la propia empresa: con meter el id de
// cualquiera en su lista, aprobaba (kyc_status = approved) o reseteaba a
// quien quisiera, o veía la foto con documento de un tercero. audit_log solo
// lo escribe el servidor (con la llave de servicio): ahí queda la prueba.
async function constancia(empresaId: string, personaId: string, accion: string): Promise<boolean> {
  if (!empresaId || !personaId) return false
  try {
    const { data } = await db.from('audit_log').select('id')
      .eq('user_id', empresaId).eq('action', accion).eq('metadata->>personaId', personaId).limit(1)
    return Array.isArray(data) && data.length > 0
  } catch { return false }
}
// La ÚLTIMA solicitud que mandó la persona, sea a quien sea: solo esa empresa
// puede aprobarla. Una solicitud vieja a otra empresa no sirve.
async function ultimaSolicitudA(personaId: string): Promise<string | null> {
  try {
    const { data } = await db.from('audit_log').select('user_id')
      .eq('action', 'empresa.persona_solicitud').eq('metadata->>personaId', personaId)
      .order('created_at', { ascending: false }).limit(1)
    return data?.[0]?.user_id ? String(data[0].user_id) : null
  } catch { return null }
}
// La persona tiene que ser una cuenta Persona de verdad, y no la propia empresa.
async function esPersona(personaId: string, yoId: string): Promise<{ id: string; raw: Record<string, any> } | null> {
  if (!personaId || personaId === yoId) return null
  const { data } = await db.from('users').select('id, role, raw_data').eq('id', personaId).maybeSingle()
  if (!data || String((data as any).role ?? '') !== 'personal') return null
  return { id: String((data as any).id), raw: ((data as any).raw_data ?? {}) as Record<string, any> }
}

// ¿Qué empresa la autoriza hoy? (la que la tiene en personasAutorizadas)
async function empresaDe(personaId: string) {
  const { data } = await db.from('users').select('id, full_name, company_name, email, raw_data').eq('role', 'business')
    .contains('raw_data', { personasAutorizadas: [{ id: personaId }] }).limit(1)
  const e = data?.[0]
  if (!e) return null
  const a = lista<Autorizada>(e.raw_data, 'personasAutorizadas').find(x => x.id === personaId)
  return { id: String(e.id), nombre: nombreEmpresa(e), topeMensual: a?.topeMensual ?? null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)
  let body: Record<string, any> = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'Cuerpo inválido' }, 400) }
  const accion = String(body.action ?? '')
  const yo = await quienLlama(req)
  if (!yo) return json({ ok: false, error: 'Sesión inválida' }, 401)

  try {
    // ── ADMIN ────────────────────────────────────────────────────────────
    if (accion === 'admin_listar') {
      if (yo.role !== 'admin') return json({ ok: false, error: 'Solo administración' }, 403)
      const emp = await empresaPorId(String(body.empresaId ?? ''))
      if (!emp) return json({ ok: false, error: 'Empresa no encontrada' }, 404)
      return json({ ok: true, empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) }, autorizadas: lista<Autorizada>(emp.raw_data, 'personasAutorizadas'), solicitudes: lista<Solicitud>(emp.raw_data, 'personasSolicitudes') })
    }

    // ── LA PERSONA ───────────────────────────────────────────────────────
    // Un documento del expediente. Se sube uno por pedido (un PDF de 5 MB a
    // la vez, no cinco juntos) y queda en el bucket privado.
    if (accion === 'subir_doc') {
      if (yo.role !== 'personal') return json({ ok: false, error: 'Solo una cuenta Persona sube documentos' }, 403)
      const tipo = String(body.tipo ?? '')
      if (!TIPOS_DOC[tipo]) return json({ ok: false, error: 'Tipo de documento no válido.' }, 400)
      const mime = String(body.mime ?? '').toLowerCase()
      if (!MIME_OK.includes(mime)) return json({ ok: false, error: `${TIPOS_DOC[tipo]}: tiene que ser un PDF o una foto (JPG, PNG, WEBP).` }, 400)
      let bytes: Uint8Array
      try {
        const b64 = String(body.base64 ?? '').includes(',') ? String(body.base64).split(',')[1] : String(body.base64 ?? '')
        const bin = atob(b64)
        bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0))
      } catch { return json({ ok: false, error: `${TIPOS_DOC[tipo]}: no se pudo leer el archivo.` }, 400) }
      if (bytes.byteLength < 1000) return json({ ok: false, error: `${TIPOS_DOC[tipo]}: el archivo llegó vacío o dañado.` }, 400)
      if (bytes.byteLength > 5 * 1024 * 1024) return json({ ok: false, error: `${TIPOS_DOC[tipo]}: puede pesar hasta 5 MB.` }, 400)
      await asegurarBucket()
      const limpio = String(body.nombre ?? tipo).replace(/[^\w.\-]/g, '_').slice(-60)
      const path = `${yo.id}/${crypto.randomUUID()}-${tipo}-${limpio}`
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
      if (error) {
        console.error('[autorizaciones] subir_doc:', error.message)
        return json({ ok: false, error: `No se pudo guardar ${TIPOS_DOC[tipo]}. Intenta de nuevo en un momento.` }, 500)
      }
      return json({ ok: true, tipo, path, nombre: String(body.nombre ?? limpio).slice(0, 120) })
    }

    if (accion === 'solicitar') {
      if (yo.role !== 'personal') return json({ ok: false, error: 'Solo una cuenta Persona pide autorización' }, 403)
      const codigo = String(body.codigoEmpresa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const nombre = String(body.nombre ?? '').trim().slice(0, 120)
      const docType = String(body.docType ?? '').trim().slice(0, 12)
      const docNumber = String(body.docNumber ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 30)
      const foto = String(body.foto ?? '')
      if (codigo.length < 4) return json({ ok: false, error: 'Escribe el ID Lincoin de la empresa' }, 400)
      if (nombre.length < 5 || !nombre.includes(' ')) return json({ ok: false, error: 'Escribe tu nombre completo, como aparece en el documento' }, 400)
      if (!docType || docNumber.length < 5) return json({ ok: false, error: 'Escribe tu tipo y número de documento' }, 400)
      if (!foto.startsWith('data:image/') || foto.length < 5000) return json({ ok: false, error: 'Falta la foto sosteniendo tu documento' }, 400)
      if (foto.length > 2_500_000) return json({ ok: false, error: 'La foto es muy pesada. Toma una más liviana.' }, 400)

      // Origen de los fondos: de dónde viene la plata que va a manejar, y la
      // declaración de que es lícita.
      const of = (body.origenFondos ?? {}) as Record<string, unknown>
      const fuente = String(of.fuente ?? '')
      const detalle = String(of.detalle ?? '').trim().slice(0, 300)
      if (!FUENTES[fuente]) return json({ ok: false, error: 'Cuéntanos de dónde vienen tus fondos.' }, 400)
      if (fuente === 'otro' && detalle.length < 5) return json({ ok: false, error: 'Describe de dónde vienen tus fondos.' }, 400)
      if (of.declaraLicitud !== true) return json({ ok: false, error: 'Falta tu declaración de que los fondos vienen de actividades lícitas.' }, 400)
      const origenFondos: OrigenFondos = { fuente, fuenteTexto: FUENTES[fuente], detalle, declaraLicitud: true }

      // Los documentos: cada uno tiene que estar en el bucket. Quien no tiene
      // cámara de comercio o no declara renta lo marca, y queda escrito.
      const na = (body.noAplica ?? {}) as Record<string, unknown>
      const noAplica: Record<string, boolean> = Object.fromEntries(OPCIONALES.map(t => [t, na[t] === true]))
      const documentos = await documentosValidos(yo.id, body.documentos)
      const faltan = requeridos(docType, noAplica).filter(t => !documentos.some(d => d.tipo === t))
      if (faltan.length) {
        return json({ ok: false, error: `Falta adjuntar: ${faltan.map(t => TIPOS_DOC[t]).join(', ')}.` }, 400)
      }
      // Si marcó "no aplica" pero igual lo adjuntó, vale el documento.
      for (const d of documentos) if (noAplica[d.tipo]) noAplica[d.tipo] = false

      // El código lo escribe cada cuenta en su perfil y no es único en la base:
      // si dos empresas lo comparten no se adivina a cuál mandar la foto.
      const { data: emps } = await db.from('users').select('*').eq('role', 'business').eq('raw_data->>ownReferralCode', codigo).limit(2)
      if ((emps ?? []).length > 1) return json({ ok: false, error: 'Ese ID está repetido. Pídele a la empresa que se comunique con soporte.' }, 409)
      const emp = (emps ?? [])[0]
      if (!emp) return json({ ok: false, error: 'No hay una empresa con ese ID. Pídele a la empresa que lo copie de su panel (Personas autorizadas).' }, 404)
      if (String(emp.id) === yo.id) return json({ ok: false, error: 'Ese ID es el tuyo.' }, 400)

      const autorizadas = lista<Autorizada>(emp.raw_data, 'personasAutorizadas')
      if (autorizadas.some(a => a.id === yo.id)) return json({ ok: true, estado: 'autorizada', empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) } })
      const solicitudes = lista<Solicitud>(emp.raw_data, 'personasSolicitudes').filter(s => s.id !== yo.id)
      const sol: Solicitud = { id: yo.id, email: yo.email, nombre, docType, docNumber, origenFondos, at: new Date().toISOString() }
      solicitudes.unshift(sol)
      const e1 = await guardarEmpresa(String(emp.id), autorizadas, solicitudes.slice(0, 50))
      if (e1) return json({ ok: false, error: `No se pudo guardar la solicitud: ${e1}` }, 500)
      const expediente = { documentos, noAplica, origenFondos, at: sol.at }
      const e2 = await guardarPersona(yo.id,
        { autorizacion: { estado: 'pendiente', empresaId: String(emp.id), empresaNombre: nombreEmpresa(emp), nombre, docType, docNumber, expediente, at: sol.at } },
        { autorizacionFoto: foto })
      if (e2) return json({ ok: false, error: `No se pudo guardar tu foto: ${e2}` }, 500)
      // El nombre y el documento quedan también en el perfil de la persona.
      await db.from('users').update({ full_name: nombre }).eq('id', yo.id)
      // La copia que ve ESTA empresa: si la persona después le pide a otra,
      // lo que esta revisó no cambia.
      await db.from('audit_log').insert({ user_id: emp.id, action: 'empresa.persona_solicitud', metadata: { personaId: yo.id, email: yo.email, nombre, docType, docNumber, expediente, at: sol.at } })
      await notificar(String(emp.id), 'Una persona pide tu autorización', `${nombre} (${docType} ${docNumber}) pide operar con tu empresa. Revisa sus documentos y apruébala o recházala en Personas autorizadas.`)
      return json({ ok: true, estado: 'pendiente', empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) } })
    }

    if (accion === 'estado') {
      if (yo.role !== 'personal') return json({ ok: false, error: 'Solo cuentas Persona' }, 403)
      const actual = await empresaDe(yo.id)
      const { data: pe } = await db.from('users').select('id, full_name, company_name, email').eq('role', 'business').contains('raw_data', { personasSolicitudes: [{ id: yo.id }] }).limit(1)
      const pend = pe?.[0] ? { id: String(pe[0].id), nombre: nombreEmpresa(pe[0]) } : null
      // Consumo del mes: retiros a banco/Bre-B completados o en curso.
      const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0)
      const { data: tx } = await db.from('transactions').select('amount, status').eq('user_id', yo.id).eq('type', 'dispersion').gte('created_at', ini.toISOString())
      const usado = (tx ?? []).filter((t: any) => ['Completado', 'Procesando', 'Pendiente'].includes(String(t.status))).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)
      return json({ ok: true, autorizada: actual, pendiente: pend, usadoMes: usado, datos: yo.raw.autorizacion ?? null })
    }

    // ── LA EMPRESA ───────────────────────────────────────────────────────
    if (yo.role !== 'business') return json({ ok: false, error: 'Solo una cuenta Empresa' }, 403)
    const emp = await empresaPorId(yo.id)
    if (!emp) return json({ ok: false, error: 'No se encontró tu empresa' }, 404)
    let autorizadas = lista<Autorizada>(emp.raw_data, 'personasAutorizadas')
    let solicitudes = lista<Solicitud>(emp.raw_data, 'personasSolicitudes')
    const personaId = String(body.personaId ?? '')

    if (accion === 'listar') {
      // Códigos ID de cada persona, para cargarles saldo o enviarles.
      const ids = [...autorizadas, ...solicitudes].map(x => x.id)
      const { data: filas } = ids.length ? await db.from('users').select('id, raw_data, kyc_status').in('id', ids) : { data: [] as any[] }
      const codigo: Record<string, string> = {}
      for (const f of (filas ?? []) as any[]) codigo[String(f.id)] = codigoDe(f)
      return json({ ok: true, miId: codigoDe(emp), autorizadas: autorizadas.map(a => ({ ...a, codigo: codigo[a.id] ?? '' })), solicitudes: solicitudes.map(s => ({ ...s, codigo: codigo[s.id] ?? '' })) })
    }

    if (accion === 'ver_foto') {
      if (![...autorizadas, ...solicitudes].some(x => x.id === personaId)) return json({ ok: false, error: 'Esa persona no te pidió autorización' }, 403)
      // La lista la puede editar la empresa: la foto (con el documento en la
      // mano) solo sale si el servidor registró que esa persona se la pidió.
      if (!(await esPersona(personaId, yo.id)) || !(await constancia(yo.id, personaId, 'empresa.persona_solicitud'))) {
        return json({ ok: false, error: 'Esa persona no te pidió autorización' }, 403)
      }
      const { data: p } = await db.from('users').select('documents').eq('id', personaId).maybeSingle()
      // El expediente que esta empresa recibió: la copia del servidor en
      // audit_log, la de la solicitud más reciente que le hizo esta persona.
      let expediente: any = null
      try {
        const { data: fila } = await db.from('audit_log').select('metadata')
          .eq('user_id', yo.id).eq('action', 'empresa.persona_solicitud').eq('metadata->>personaId', personaId)
          .order('created_at', { ascending: false }).limit(1)
        expediente = (fila?.[0] as any)?.metadata?.expediente ?? null
      } catch { expediente = null }
      const documentos: any[] = []
      for (const d of (Array.isArray(expediente?.documentos) ? expediente.documentos : []) as DocExpediente[]) {
        let url: string | null = null
        try { const { data } = await db.storage.from(BUCKET).createSignedUrl(String(d.path), 3600); url = data?.signedUrl ?? null } catch { url = null }
        documentos.push({ tipo: d.tipo, nombreTipo: TIPOS_DOC[d.tipo] ?? d.tipo, nombre: d.nombre, url, esPdf: /\.pdf$/i.test(d.path) })
      }
      return json({
        ok: true,
        foto: String((p?.documents as any)?.autorizacionFoto ?? '') || null,
        documentos,
        noAplica: Object.entries(expediente?.noAplica ?? {}).filter(([, v]) => v === true).map(([k]) => TIPOS_DOC[k] ?? k),
        origenFondos: expediente?.origenFondos ?? null,
        // Solicitudes de antes de pedir el expediente: no lo tienen.
        sinExpediente: !expediente,
      })
    }

    if (accion === 'aprobar') {
      const s = solicitudes.find(x => x.id === personaId)
      if (!s) return json({ ok: false, error: 'Esa solicitud ya no está' }, 404)
      // Aprobar marca a la persona como identificada (kyc_status). Solo vale si
      // es una cuenta Persona, si no es la propia empresa y si su ÚLTIMA
      // solicitud registrada por el servidor es a esta empresa.
      if (!(await esPersona(personaId, yo.id)) || (await ultimaSolicitudA(personaId)) !== yo.id) {
        return json({ ok: false, error: 'Esa solicitud ya no está' }, 404)
      }
      const tope = body.topeMensual == null || body.topeMensual === '' ? null : Math.max(0, Math.round(Number(body.topeMensual) || 0))
      solicitudes = solicitudes.filter(x => x.id !== personaId)
      // El ID Lincoin de la persona queda en el vínculo: es lo que la empresa
      // usa para cargarle saldo o enviarle desde "A persona Lincoin".
      const { data: pf } = await db.from('users').select('id, raw_data').eq('id', personaId).maybeSingle()
      autorizadas = [{ ...s, codigo: codigoDe(pf ?? { id: personaId }), topeMensual: tope, at: new Date().toISOString() } as Autorizada, ...autorizadas.filter(x => x.id !== personaId)]
      const e1 = await guardarEmpresa(yo.id, autorizadas, solicitudes)
      if (e1) return json({ ok: false, error: e1 }, 500)
      // Reemplaza a la empresa anterior, si la había: la persona queda con UNA.
      const { data: otras } = await db.from('users').select('id, raw_data').eq('role', 'business').neq('id', yo.id).contains('raw_data', { personasAutorizadas: [{ id: personaId }] })
      for (const o of (otras ?? []) as any[]) {
        await guardarEmpresa(String(o.id), lista<Autorizada>(o.raw_data, 'personasAutorizadas').filter(x => x.id !== personaId), lista<Solicitud>(o.raw_data, 'personasSolicitudes'))
      }
      // El expediente que mandó la persona se conserva al aprobar.
      const expedientePrevio = (pf as any)?.raw_data?.autorizacion?.expediente
      await guardarPersona(personaId, {
        empresaAutorizante: { id: yo.id, nombre: nombreEmpresa(emp) },
        autorizacion: { estado: 'autorizada', empresaId: yo.id, empresaNombre: nombreEmpresa(emp), nombre: s.nombre, docType: s.docType, docNumber: s.docNumber, ...(expedientePrevio ? { expediente: expedientePrevio } : {}), at: new Date().toISOString() },
      }, undefined, 'approved')
      await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.persona_aprobada', metadata: { personaId, email: s.email, topeMensual: tope, at: new Date().toISOString() } })
      await notificar(personaId, 'Autorización aprobada', `${nombreEmpresa(emp)} te autorizó. Ya puedes recibir dinero de la empresa${tope ? ` y retirar hasta $ ${tope.toLocaleString('es-CO')} COP al mes` : ''}.`, 'success', '/portal_personas')
      return json({ ok: true, autorizadas, solicitudes })
    }

    if (accion === 'rechazar') {
      const s = solicitudes.find(x => x.id === personaId)
      solicitudes = solicitudes.filter(x => x.id !== personaId)
      const e1 = await guardarEmpresa(yo.id, autorizadas, solicitudes)
      if (e1) return json({ ok: false, error: e1 }, 500)
      // A la persona solo se le escribe si de verdad le pidió a esta empresa.
      if (s && (await esPersona(personaId, yo.id)) && (await constancia(yo.id, personaId, 'empresa.persona_solicitud'))) {
        // Si no tiene otra empresa aprobada, vuelve a "pendiente".
        const otra = await empresaDe(personaId)
        if (!otra) await guardarPersona(personaId, { autorizacion: { ...(s as any), estado: 'rechazada', empresaId: yo.id, empresaNombre: nombreEmpresa(emp) } })
        await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.persona_rechazada', metadata: { personaId, email: s.email, at: new Date().toISOString() } })
        await notificar(personaId, 'Solicitud rechazada', `${nombreEmpresa(emp)} no aprobó tu solicitud. Revisa tus datos y tu foto, y vuelve a pedirla.`, 'info', '/portal_personas')
      }
      return json({ ok: true, autorizadas, solicitudes })
    }

    if (accion === 'revocar') {
      const a = autorizadas.find(x => x.id === personaId)
      autorizadas = autorizadas.filter(x => x.id !== personaId)
      const e1 = await guardarEmpresa(yo.id, autorizadas, solicitudes)
      if (e1) return json({ ok: false, error: e1 }, 500)
      // Revocar devuelve a la persona a "identificación pendiente": solo la
      // empresa que de verdad la aprobó (constancia del servidor, o el espejo
      // que escribió el servidor en la persona) puede hacerlo.
      const pr = a ? await esPersona(personaId, yo.id) : null
      const laAprobo = !!pr && ((await constancia(yo.id, personaId, 'empresa.persona_aprobada')) || String(pr.raw?.empresaAutorizante?.id ?? '') === yo.id)
      if (a && laAprobo) {
        const otra = await empresaDe(personaId)
        if (!otra) await guardarPersona(personaId, { empresaAutorizante: null, autorizacion: { ...(a as any), estado: 'revocada' } }, undefined, 'pending')
        await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.persona_revocada', metadata: { personaId, email: a.email, at: new Date().toISOString() } })
        await notificar(personaId, 'Autorización retirada', `${nombreEmpresa(emp)} retiró tu autorización. Puedes pedirla a otra empresa desde Mi perfil.`, 'info', '/portal_personas')
      }
      return json({ ok: true, autorizadas, solicitudes })
    }

    if (accion === 'tope') {
      const a = autorizadas.find(x => x.id === personaId)
      if (!a) return json({ ok: false, error: 'Esa persona no está autorizada' }, 404)
      const tope = body.topeMensual == null || body.topeMensual === '' ? null : Math.max(0, Math.round(Number(body.topeMensual) || 0))
      autorizadas = autorizadas.map(x => x.id === personaId ? { ...x, topeMensual: tope } : x)
      const e1 = await guardarEmpresa(yo.id, autorizadas, solicitudes)
      if (e1) return json({ ok: false, error: e1 }, 500)
      return json({ ok: true, autorizadas, solicitudes })
    }

    return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    console.error('[autorizaciones]', (e as Error)?.message ?? e)
    return json({ ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }, 500)
  }
})
