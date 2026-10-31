// ══════════════════════════════════════════════════════════════════
//  autorizaciones — los OPERADORES: clientes de nuestros clientes
//
//  Un operador es el cliente de una empresa registrada en Lincoin. Abre su
//  cuenta (rol 'personal' en la base) como persona natural o como empresa, y
//  nace con "identificación pendiente": solo puede recibir dinero de una
//  empresa cuando esa empresa lo aceptó Y Cumplimiento de Lincoin lo aprobó.
//
//  El camino:
//    1. El operador escribe el ID Lincoin de la empresa y manda sus datos,
//       una foto sosteniendo su documento, el documento por las dos caras,
//       RUT, cámara de comercio, declaración de renta y el origen de sus
//       fondos (si es empresa, los del representante legal y los de la
//       empresa).                                       → etapa 'empresa'
//    2. La empresa lo ACEPTA como su cliente (o lo rechaza). Ve sus datos y
//       la foto; los documentos no.                     → etapa 'cumplimiento'
//    3. El oficial de cumplimiento (admin) revisa el expediente, le FIJA EL
//       TOPE mensual y lo aprueba, o lo rechaza con un motivo. Solo ahí entra
//       a personasAutorizadas, que es la lista que miran la carga de saldo
//       (lincoin_cargar_cliente) y los envíos (mouv-proxy).
//  El tope lo cambia solo Cumplimiento. La empresa puede dejar de trabajar
//  con su cliente (revocar); Cumplimiento también.
//
//  Dónde vive cada cosa:
//    · empresa.raw_data.personasSolicitudes  [{id, email, nombre, docType, docNumber, tipoOperador, representante, origenFondos, estado, aceptadaAt, at}]
//    · empresa.raw_data.personasAutorizadas  [{…, topeMensual, aprobadaPor, at}]
//    · operador.raw_data.empresaAutorizante  {id, nombre}   (espejo, solo lectura)
//    · operador.raw_data.autorizacion        {estado, empresaId, empresaNombre, …, expediente, motivo, at}
//    · operador.documents.autorizacionFoto   la foto (base64)
//    · bucket privado autorizacion-documentos   documento, RUT, cámara y declaración
//    · audit_log empresa.persona_solicitud   copia del expediente de cada solicitud
//  Todas esas claves las escribe solo este servidor (la base las protege).
//
//  Acciones (todas con JWT):
//    Operador: subir_doc {tipo, nombre, mime, base64} → {path}   (uno por pedido)
//              solicitar {codigoEmpresa, tipoOperador, nombre, docType, docNumber, representante?, foto, documentos, origenFondos}
//              estado {}
//    Empresa:  listar {} · ver_foto {personaId} · aceptar {personaId} · rechazar {personaId} · revocar {personaId}
//    Admin:    admin_operadores {} · admin_expediente {personaId, empresaId}
//              admin_aprobar {personaId, empresaId, topeMensual} · admin_rechazar {personaId, empresaId, motivo}
//              admin_tope {personaId, empresaId, topeMensual} · admin_revocar {personaId, empresaId, motivo}
//              admin_listar {empresaId}
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mergeRaw } from '../_shared/raw-data.ts'
import { leerPorPaginas } from '../_shared/paginas.ts'
import { equipoPermite } from '../_shared/equipo.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
const ADMIN_EMAIL  = Deno.env.get('ADMIN_EMAIL') ?? ''
const FROM_EMAIL   = Deno.env.get('FROM_EMAIL') ?? 'no-reply@lincoin.me'
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const escHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch])

type Quien = { id: string; email: string; role: string; nombre: string; raw: Record<string, any> }
type OrigenFondos = { fuente: string; fuenteTexto: string; detalle: string; declaraLicitud: true }
type Representante = { nombre: string; docType: string; docNumber: string }
type TipoOperador = 'persona' | 'empresa'
type Etapa = 'empresa' | 'cumplimiento'
type Solicitud = {
  id: string; email: string; nombre: string; docType: string; docNumber: string; at: string
  tipoOperador?: TipoOperador; representante?: Representante; origenFondos?: OrigenFondos
  estado?: Etapa; aceptadaAt?: string
}
type Autorizada = Solicitud & { topeMensual: number | null; codigo?: string; aprobadaPor?: string }
type DocExpediente = { tipo: string; path: string; nombre: string }

// Las solicitudes de antes no traen etapa: esperaban a la empresa.
const etapa = (s?: Solicitud | null): Etapa => s?.estado === 'cumplimiento' ? 'cumplimiento' : 'empresa'

// ── Expediente del operador ──────────────────────────────────────────
// Los documentos van a un bucket PRIVADO: Cumplimiento los abre con una URL
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
// Todos son obligatorios, para persona y para empresa (en empresa, el
// documento es el del representante legal).
const REQUERIDOS = Object.keys(TIPOS_DOC)
// Las de persona y las de empresa (aportes de socios, financiación).
const FUENTES: Record<string, string> = {
  salario: 'Salario',
  honorarios: 'Honorarios o prestación de servicios',
  negocio: 'Ventas o servicios del negocio',
  pension: 'Pensión',
  inversiones: 'Rentas o inversiones',
  familia: 'Ayuda de familiares o remesas',
  aportes: 'Aportes de socios',
  financiacion: 'Préstamos o financiación',
  otro: 'Otro',
}

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

// Los documentos que de verdad están en el bucket, son de este operador y
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
const leerTope = (v: unknown): number | null => v == null || v === '' ? null : Math.max(0, Math.round(Number(String(v).replace(/[^\d]/g, '')) || 0))
const cop = (n: number) => `$ ${n.toLocaleString('es-CO')}`

async function empresaPorId(id: string) {
  if (!id) return null
  const { data } = await db.from('users').select('*').eq('id', id).maybeSingle()
  return data && data.role === 'business' ? data : null
}

// Aviso al usuario: campana del panel (raw_data.notifications) y teléfono
// (función push). Es un extra: si falla, el vínculo ya quedó guardado.
async function notificar(userId: string, titulo: string, mensaje: string, tipo: 'info' | 'success' = 'info', url = '/empresas_clientes') {
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

// Aviso a Cumplimiento: correo (si está configurado) y la campana de cada
// admin. Sin esto, un operador aceptado por su empresa esperaría sin que
// nadie se entere.
async function avisarCumplimiento(asunto: string, html: string, mensaje: string) {
  if (RESEND_KEY && ADMIN_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `Lincoin <${FROM_EMAIL}>`, to: [ADMIN_EMAIL], subject: asunto, html }),
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* el correo es un extra */ }
  }
  try {
    const { data: admins } = await db.from('users').select('id').eq('role', 'admin').limit(20)
    for (const a of (admins ?? []) as any[]) await notificar(String(a.id), asunto, mensaje, 'info', '/admin')
  } catch { /* la campana es un extra */ }
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

// ¿Hay constancia ESCRITA POR ESTE SERVIDOR del vínculo? audit_log solo lo
// escribe el servidor (con la llave de servicio): ahí queda la prueba de que
// el operador le pidió a esa empresa, de que ella lo aceptó y de que
// Cumplimiento lo aprobó, aunque las listas de la empresa digan otra cosa.
async function constancia(empresaId: string, personaId: string, accion: string): Promise<boolean> {
  if (!empresaId || !personaId) return false
  try {
    const { data } = await db.from('audit_log').select('id')
      .eq('user_id', empresaId).eq('action', accion).eq('metadata->>personaId', personaId).limit(1)
    return Array.isArray(data) && data.length > 0
  } catch { return false }
}
// La ÚLTIMA solicitud que mandó el operador, sea a quien sea: solo esa empresa
// puede aceptarla. Una solicitud vieja a otra empresa no sirve.
async function ultimaSolicitudA(personaId: string): Promise<string | null> {
  try {
    const { data } = await db.from('audit_log').select('user_id')
      .eq('action', 'empresa.persona_solicitud').eq('metadata->>personaId', personaId)
      .order('created_at', { ascending: false }).limit(1)
    return data?.[0]?.user_id ? String(data[0].user_id) : null
  } catch { return null }
}
// El expediente de la solicitud más reciente del operador a esa empresa.
async function expedienteDe(empresaId: string, personaId: string): Promise<any> {
  try {
    const { data: fila } = await db.from('audit_log').select('metadata')
      .eq('user_id', empresaId).eq('action', 'empresa.persona_solicitud').eq('metadata->>personaId', personaId)
      .order('created_at', { ascending: false }).limit(1)
    return (fila?.[0] as any)?.metadata?.expediente ?? null
  } catch { return null }
}
// El operador tiene que ser una cuenta 'personal' de verdad, y no la propia empresa.
async function esPersona(personaId: string, yoId: string): Promise<{ id: string; raw: Record<string, any> } | null> {
  if (!personaId || personaId === yoId) return null
  const { data } = await db.from('users').select('id, role, raw_data').eq('id', personaId).maybeSingle()
  if (!data || String((data as any).role ?? '') !== 'personal') return null
  return { id: String((data as any).id), raw: ((data as any).raw_data ?? {}) as Record<string, any> }
}

// ¿Qué empresa lo autoriza hoy? (la que lo tiene en personasAutorizadas)
async function empresaDe(personaId: string) {
  const { data } = await db.from('users').select('id, full_name, company_name, email, raw_data').eq('role', 'business')
    .contains('raw_data', { personasAutorizadas: [{ id: personaId }] }).limit(1)
  const e = data?.[0]
  if (!e) return null
  const a = lista<Autorizada>(e.raw_data, 'personasAutorizadas').find(x => x.id === personaId)
  return { id: String(e.id), nombre: nombreEmpresa(e), topeMensual: a?.topeMensual ?? null }
}

// Quita el vínculo de un operador con una empresa (revocar). Si no le queda
// otra empresa, vuelve a "identificación pendiente".
async function quitarAutorizacion(empresaId: string, emp: any, a: Autorizada, motivo: string | null, por: 'empresa' | 'cumplimiento') {
  const autorizadas = lista<Autorizada>(emp.raw_data, 'personasAutorizadas').filter(x => x.id !== a.id)
  const e1 = await guardarEmpresa(empresaId, autorizadas, lista<Solicitud>(emp.raw_data, 'personasSolicitudes'))
  if (e1) return e1
  const otra = await empresaDe(a.id)
  if (!otra) {
    const pr = await esPersona(a.id, empresaId)
    await guardarPersona(a.id, { empresaAutorizante: null, autorizacion: { ...(pr?.raw?.autorizacion ?? {}), ...(a as any), estado: 'revocada', motivo, por, at: new Date().toISOString() } }, undefined, 'pending')
  }
  return null
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
    // ── CUMPLIMIENTO (admin) ─────────────────────────────────────────────
    if (accion.startsWith('admin_')) {
      if (yo.role !== 'admin') return json({ ok: false, error: 'Solo administración' }, 403)
      // Los operadores de las empresas los aprueba Cumplimiento: del equipo,
      // solo ese rol (y el dueño).
      if (!(await equipoPermite(db, yo.id, 'cumplimiento', { email: yo.email })).ok) {
        return json({ ok: false, error: 'Tu rol no permite esta operación.' }, 403)
      }

      if (accion === 'admin_listar') {
        const emp = await empresaPorId(String(body.empresaId ?? ''))
        if (!emp) return json({ ok: false, error: 'Empresa no encontrada' }, 404)
        return json({ ok: true, empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) }, autorizadas: lista<Autorizada>(emp.raw_data, 'personasAutorizadas'), solicitudes: lista<Solicitud>(emp.raw_data, 'personasSolicitudes') })
      }

      // Todos los operadores de todas las empresas: los que esperan a
      // Cumplimiento, los que aún esperan a su empresa y los aprobados.
      if (accion === 'admin_operadores') {
        const { data: emps, error } = await db.from('users')
          .select('id, company_name, full_name, email, sol:raw_data->personasSolicitudes, aut:raw_data->personasAutorizadas')
          .eq('role', 'business')
        if (error) return json({ ok: false, error: 'No se pudo consultar.' }, 500)
        const pendientes: any[] = [], enEmpresa: any[] = [], autorizados: any[] = []
        for (const e of (emps ?? []) as any[]) {
          const empresa = { id: String(e.id), nombre: nombreEmpresa(e) }
          for (const s of lista<Solicitud>({ s: e.sol }, 's')) (etapa(s) === 'cumplimiento' ? pendientes : enEmpresa).push({ ...s, empresa })
          for (const a of lista<Autorizada>({ a: e.aut }, 'a')) autorizados.push({ ...a, empresa })
        }
        // Los ID Lincoin de los operadores, para buscarlos.
        const ids = [...new Set([...pendientes, ...enEmpresa, ...autorizados].map(x => String(x.id)))]
        const codigo: Record<string, string> = {}
        for (let i = 0; i < ids.length; i += 200) {
          const { data: filas } = await db.from('users').select('id, raw_data->ownReferralCode').in('id', ids.slice(i, i + 200))
          for (const f of (filas ?? []) as any[]) codigo[String(f.id)] = String(f.ownReferralCode || String(f.id).slice(-6)).toUpperCase()
        }
        const conCodigo = (x: any) => ({ ...x, codigo: codigo[String(x.id)] ?? x.codigo ?? '' })
        const t = (v: unknown) => Date.parse(String(v ?? '')) || 0
        return json({
          ok: true,
          pendientes: pendientes.map(conCodigo).sort((a, b) => t(a.aceptadaAt ?? a.at) - t(b.aceptadaAt ?? b.at)),
          enEmpresa: enEmpresa.map(conCodigo).sort((a, b) => t(b.at) - t(a.at)),
          autorizados: autorizados.map(conCodigo).sort((a, b) => t(b.at) - t(a.at)),
        })
      }

      const personaId = String(body.personaId ?? '')
      const empresaId = String(body.empresaId ?? '')
      const emp = await empresaPorId(empresaId)
      if (!emp) return json({ ok: false, error: 'Empresa no encontrada' }, 404)
      let autorizadas = lista<Autorizada>(emp.raw_data, 'personasAutorizadas')
      let solicitudes = lista<Solicitud>(emp.raw_data, 'personasSolicitudes')
      const pr = await esPersona(personaId, empresaId)
      if (!pr) return json({ ok: false, error: 'Operador no encontrado' }, 404)

      // El expediente completo: foto, documentos (enlace firmado de una hora)
      // y origen de fondos.
      if (accion === 'admin_expediente') {
        const { data: p } = await db.from('users').select('documents, email, raw_data->ownReferralCode').eq('id', personaId).maybeSingle()
        const expediente = (await expedienteDe(empresaId, personaId)) ?? pr.raw?.autorizacion?.expediente ?? null
        const documentos: any[] = []
        for (const d of (Array.isArray(expediente?.documentos) ? expediente.documentos : []) as DocExpediente[]) {
          let url: string | null = null
          try { const { data } = await db.storage.from(BUCKET).createSignedUrl(String(d.path), 3600); url = data?.signedUrl ?? null } catch { url = null }
          documentos.push({ tipo: d.tipo, nombreTipo: TIPOS_DOC[d.tipo] ?? d.tipo, nombre: d.nombre, url, esPdf: /\.pdf$/i.test(d.path) })
        }
        const s = solicitudes.find(x => x.id === personaId) ?? autorizadas.find(x => x.id === personaId) ?? null
        return json({
          ok: true,
          foto: String((p?.documents as any)?.autorizacionFoto ?? '') || null,
          documentos,
          origenFondos: expediente?.origenFondos ?? s?.origenFondos ?? null,
          solicitud: s,
          email: (p as any)?.email ?? s?.email ?? '',
          codigo: String((p as any)?.ownReferralCode || personaId.slice(-6)).toUpperCase(),
          sinExpediente: !expediente,
        })
      }

      if (accion === 'admin_aprobar') {
        const s = solicitudes.find(x => x.id === personaId)
        if (!s) return json({ ok: false, error: 'Esa solicitud ya no está.' }, 404)
        if (etapa(s) !== 'cumplimiento' || !(await constancia(empresaId, personaId, 'empresa.persona_aceptada'))) {
          return json({ ok: false, error: 'La empresa todavía no ha aceptado a este operador.' }, 409)
        }
        if ((await ultimaSolicitudA(personaId)) !== empresaId) return json({ ok: false, error: 'El operador ya pidió autorización a otra empresa.' }, 409)
        const tope = leerTope(body.topeMensual)
        if (!tope) return json({ ok: false, error: 'Fija el tope mensual del operador.' }, 400)
        const ahora = new Date().toISOString()
        const { estado: _e, ...resto } = s
        solicitudes = solicitudes.filter(x => x.id !== personaId)
        autorizadas = [{ ...resto, codigo: codigoDe({ id: personaId, raw_data: pr.raw }), topeMensual: tope, aprobadaPor: yo.id, at: ahora } as Autorizada, ...autorizadas.filter(x => x.id !== personaId)]
        const e1 = await guardarEmpresa(empresaId, autorizadas, solicitudes)
        if (e1) return json({ ok: false, error: e1 }, 500)
        // Reemplaza a la empresa anterior, si la había: el operador queda con UNA.
        const { data: otras } = await db.from('users').select('id, raw_data').eq('role', 'business').neq('id', empresaId).contains('raw_data', { personasAutorizadas: [{ id: personaId }] })
        for (const o of (otras ?? []) as any[]) {
          await guardarEmpresa(String(o.id), lista<Autorizada>(o.raw_data, 'personasAutorizadas').filter(x => x.id !== personaId), lista<Solicitud>(o.raw_data, 'personasSolicitudes'))
        }
        await guardarPersona(personaId, {
          empresaAutorizante: { id: empresaId, nombre: nombreEmpresa(emp) },
          autorizacion: { ...(pr.raw?.autorizacion ?? {}), estado: 'autorizada', empresaId, empresaNombre: nombreEmpresa(emp), nombre: s.nombre, docType: s.docType, docNumber: s.docNumber, motivo: null, at: ahora },
        }, undefined, 'approved')
        // La constancia que la empresa necesita para poder revocarlo después.
        await db.from('audit_log').insert({ user_id: empresaId, action: 'empresa.persona_aprobada', metadata: { personaId, email: s.email, topeMensual: tope, por: yo.id, cumplimiento: true, at: ahora } })
        await db.from('audit_log').insert({ user_id: yo.id, action: 'cumplimiento.operador_aprobado', metadata: { personaId, empresaId, topeMensual: tope, at: ahora } })
        await notificar(personaId, 'Cuenta aprobada', `Cumplimiento aprobó tu cuenta. Ya operas con ${nombreEmpresa(emp)} con un tope de ${cop(tope)} COP al mes.`, 'success', '/portal_personas')
        await notificar(empresaId, 'Cliente aprobado', `${s.nombre} fue aprobado por Cumplimiento. Ya puedes cargarle saldo.`, 'success')
        return json({ ok: true })
      }

      if (accion === 'admin_rechazar') {
        const s = solicitudes.find(x => x.id === personaId)
        if (!s) return json({ ok: false, error: 'Esa solicitud ya no está.' }, 404)
        const motivo = String(body.motivo ?? '').trim().slice(0, 400)
        if (motivo.length < 5) return json({ ok: false, error: 'Escribe el motivo del rechazo: el operador lo ve.' }, 400)
        solicitudes = solicitudes.filter(x => x.id !== personaId)
        const e1 = await guardarEmpresa(empresaId, autorizadas, solicitudes)
        if (e1) return json({ ok: false, error: e1 }, 500)
        if (!(await empresaDe(personaId))) {
          await guardarPersona(personaId, { autorizacion: { ...(pr.raw?.autorizacion ?? {}), estado: 'rechazada', empresaId, empresaNombre: nombreEmpresa(emp), motivo, por: 'cumplimiento', at: new Date().toISOString() } })
        }
        await db.from('audit_log').insert({ user_id: yo.id, action: 'cumplimiento.operador_rechazado', metadata: { personaId, empresaId, motivo, at: new Date().toISOString() } })
        await notificar(personaId, 'Solicitud rechazada', `Cumplimiento no aprobó tu cuenta: ${motivo}`, 'info', '/portal_personas')
        await notificar(empresaId, 'Cliente no aprobado', `Cumplimiento no aprobó a ${s.nombre}.`)
        return json({ ok: true })
      }

      if (accion === 'admin_tope') {
        const a = autorizadas.find(x => x.id === personaId)
        if (!a) return json({ ok: false, error: 'Ese operador no está aprobado con esta empresa.' }, 404)
        const tope = leerTope(body.topeMensual)
        if (!tope) return json({ ok: false, error: 'Escribe el tope mensual.' }, 400)
        autorizadas = autorizadas.map(x => x.id === personaId ? { ...x, topeMensual: tope } : x)
        const e1 = await guardarEmpresa(empresaId, autorizadas, solicitudes)
        if (e1) return json({ ok: false, error: e1 }, 500)
        await db.from('audit_log').insert({ user_id: yo.id, action: 'cumplimiento.operador_tope', metadata: { personaId, empresaId, antes: a.topeMensual ?? null, topeMensual: tope, at: new Date().toISOString() } })
        await notificar(personaId, 'Tope mensual actualizado', `Tu tope mensual ahora es de ${cop(tope)} COP.`, 'info', '/portal_personas')
        return json({ ok: true })
      }

      if (accion === 'admin_revocar') {
        const a = autorizadas.find(x => x.id === personaId)
        if (!a) return json({ ok: false, error: 'Ese operador no está aprobado con esta empresa.' }, 404)
        const motivo = String(body.motivo ?? '').trim().slice(0, 400)
        if (motivo.length < 5) return json({ ok: false, error: 'Escribe el motivo: queda en el registro.' }, 400)
        const e1 = await quitarAutorizacion(empresaId, emp, a, motivo, 'cumplimiento')
        if (e1) return json({ ok: false, error: e1 }, 500)
        await db.from('audit_log').insert({ user_id: yo.id, action: 'cumplimiento.operador_revocado', metadata: { personaId, empresaId, motivo, at: new Date().toISOString() } })
        await notificar(personaId, 'Cuenta suspendida', `Cumplimiento retiró tu autorización con ${nombreEmpresa(emp)}: ${motivo}`, 'info', '/portal_personas')
        await notificar(empresaId, 'Cliente suspendido', `Cumplimiento retiró la autorización de ${a.nombre}.`)
        return json({ ok: true })
      }

      return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
    }

    // ── EL OPERADOR ──────────────────────────────────────────────────────
    // Un documento del expediente. Se sube uno por pedido (un PDF de 5 MB a
    // la vez, no cinco juntos) y queda en el bucket privado.
    if (accion === 'subir_doc') {
      if (yo.role !== 'personal') return json({ ok: false, error: 'Solo una cuenta de operador sube documentos' }, 403)
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
      if (yo.role !== 'personal') return json({ ok: false, error: 'Solo una cuenta de operador pide autorización' }, 403)
      const codigo = String(body.codigoEmpresa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const tipoOperador: TipoOperador = body.tipoOperador === 'empresa' ? 'empresa' : 'persona'
      const nombre = String(body.nombre ?? '').trim().slice(0, 120)
      const docType = tipoOperador === 'empresa' ? 'NIT' : String(body.docType ?? '').trim().slice(0, 12)
      const docNumber = String(body.docNumber ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 30)
      const foto = String(body.foto ?? '')
      if (codigo.length < 4) return json({ ok: false, error: 'Escribe el ID Lincoin de la empresa' }, 400)
      let representante: Representante | undefined
      if (tipoOperador === 'empresa') {
        if (nombre.length < 3) return json({ ok: false, error: 'Escribe la razón social, como aparece en la cámara de comercio' }, 400)
        if (docNumber.replace(/\D/g, '').length < 9) return json({ ok: false, error: 'Escribe el NIT completo, con el dígito de verificación' }, 400)
        const r = (body.representante ?? {}) as Record<string, unknown>
        representante = {
          nombre: String(r.nombre ?? '').trim().slice(0, 120),
          docType: String(r.docType ?? 'CC').trim().slice(0, 12),
          docNumber: String(r.docNumber ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 30),
        }
        if (representante.nombre.length < 5 || !representante.nombre.includes(' ')) return json({ ok: false, error: 'Escribe el nombre completo del representante legal' }, 400)
        if (representante.docNumber.length < 5) return json({ ok: false, error: 'Escribe el documento del representante legal' }, 400)
      } else {
        if (nombre.length < 5 || !nombre.includes(' ')) return json({ ok: false, error: 'Escribe tu nombre completo, como aparece en el documento' }, 400)
        if (!docType || docNumber.length < 5) return json({ ok: false, error: 'Escribe tu tipo y número de documento' }, 400)
      }
      const quienFoto = tipoOperador === 'empresa' ? 'del representante legal sosteniendo su documento' : 'sosteniendo tu documento'
      if (!foto.startsWith('data:image/') || foto.length < 5000) return json({ ok: false, error: `Falta la foto ${quienFoto}` }, 400)
      if (foto.length > 2_500_000) return json({ ok: false, error: 'La foto es muy pesada. Toma una más liviana.' }, 400)

      // Origen de los fondos: de dónde viene la plata que va a manejar, y la
      // declaración de que es lícita.
      const of = (body.origenFondos ?? {}) as Record<string, unknown>
      const fuente = String(of.fuente ?? '')
      const detalle = String(of.detalle ?? '').trim().slice(0, 300)
      if (!FUENTES[fuente]) return json({ ok: false, error: 'Cuéntanos de dónde vienen los fondos.' }, 400)
      if (fuente === 'otro' && detalle.length < 5) return json({ ok: false, error: 'Describe de dónde vienen los fondos.' }, 400)
      if (of.declaraLicitud !== true) return json({ ok: false, error: 'Falta la declaración de que los fondos vienen de actividades lícitas.' }, 400)
      const origenFondos: OrigenFondos = { fuente, fuenteTexto: FUENTES[fuente], detalle, declaraLicitud: true }

      // Los documentos: todos obligatorios, y cada uno tiene que estar en el bucket.
      const documentos = await documentosValidos(yo.id, body.documentos)
      const faltan = REQUERIDOS.filter(t => !documentos.some(d => d.tipo === t))
      if (faltan.length) {
        return json({ ok: false, error: `Falta adjuntar: ${faltan.map(t => TIPOS_DOC[t]).join(', ')}.` }, 400)
      }

      // El código lo escribe cada cuenta en su perfil y no es único en la base:
      // si dos empresas lo comparten no se adivina a cuál mandar la solicitud.
      const { data: emps } = await db.from('users').select('*').eq('role', 'business').eq('raw_data->>ownReferralCode', codigo).limit(2)
      if ((emps ?? []).length > 1) return json({ ok: false, error: 'Ese ID está repetido. Pídele a la empresa que se comunique con soporte.' }, 409)
      const emp = (emps ?? [])[0]
      if (!emp) return json({ ok: false, error: 'No hay una empresa con ese ID. Pídele a la empresa que lo copie de su panel (Clientes).' }, 404)
      if (String(emp.id) === yo.id) return json({ ok: false, error: 'Ese ID es el tuyo.' }, 400)

      const autorizadas = lista<Autorizada>(emp.raw_data, 'personasAutorizadas')
      if (autorizadas.some(a => a.id === yo.id)) return json({ ok: true, estado: 'autorizada', empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) } })
      const solicitudes = lista<Solicitud>(emp.raw_data, 'personasSolicitudes').filter(s => s.id !== yo.id)
      const sol: Solicitud = { id: yo.id, email: yo.email, nombre, docType, docNumber, tipoOperador, ...(representante ? { representante } : {}), origenFondos, estado: 'empresa', at: new Date().toISOString() }
      solicitudes.unshift(sol)
      const e1 = await guardarEmpresa(String(emp.id), autorizadas, solicitudes.slice(0, 50))
      if (e1) return json({ ok: false, error: `No se pudo guardar la solicitud: ${e1}` }, 500)
      const expediente = { documentos, origenFondos, tipoOperador, ...(representante ? { representante } : {}), at: sol.at }
      const e2 = await guardarPersona(yo.id,
        { tipoOperador, autorizacion: { estado: 'pendiente', empresaId: String(emp.id), empresaNombre: nombreEmpresa(emp), nombre, docType, docNumber, tipoOperador, ...(representante ? { representante } : {}), expediente, motivo: null, at: sol.at } },
        { autorizacionFoto: foto })
      if (e2) return json({ ok: false, error: `No se pudo guardar tu foto: ${e2}` }, 500)
      // El nombre (o la razón social) queda también en el perfil.
      await db.from('users').update({ full_name: nombre }).eq('id', yo.id)
      // La copia del servidor: lo que Cumplimiento revisa para esta empresa,
      // aunque el operador después le pida a otra.
      await db.from('audit_log').insert({ user_id: emp.id, action: 'empresa.persona_solicitud', metadata: { personaId: yo.id, email: yo.email, nombre, docType, docNumber, tipoOperador, expediente, at: sol.at } })
      await notificar(String(emp.id), 'Un cliente pide operar contigo', `${nombre} (${docType} ${docNumber}) pide operar con tu empresa. Acéptalo o recházalo en Clientes; después lo revisa Cumplimiento.`)
      return json({ ok: true, estado: 'pendiente', empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) } })
    }

    if (accion === 'estado') {
      if (yo.role !== 'personal') return json({ ok: false, error: 'Solo cuentas de operador' }, 403)
      const actual = await empresaDe(yo.id)
      const { data: pe } = await db.from('users').select('id, full_name, company_name, email, sol:raw_data->personasSolicitudes').eq('role', 'business').contains('raw_data', { personasSolicitudes: [{ id: yo.id }] }).limit(1)
      const s = pe?.[0] ? lista<Solicitud>({ s: (pe[0] as any).sol }, 's').find(x => x.id === yo.id) : null
      const pend = pe?.[0] ? { id: String(pe[0].id), nombre: nombreEmpresa(pe[0]), etapa: etapa(s) } : null
      // Consumo del mes: retiros a banco/Bre-B completados o en curso.
      const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0)
      const { data: tx } = await db.from('transactions').select('amount, status').eq('user_id', yo.id).eq('type', 'dispersion').gte('created_at', ini.toISOString())
      const usado = (tx ?? []).filter((t: any) => ['Completado', 'Procesando', 'Pendiente'].includes(String(t.status))).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)
      return json({ ok: true, autorizada: actual, pendiente: pend, usadoMes: usado, datos: yo.raw.autorizacion ?? null })
    }

    // ── LA EMPRESA (nuestro cliente) ─────────────────────────────────────
    if (yo.role !== 'business') return json({ ok: false, error: 'Solo una cuenta Empresa' }, 403)
    const emp = await empresaPorId(yo.id)
    if (!emp) return json({ ok: false, error: 'No se encontró tu empresa' }, 404)
    let autorizadas = lista<Autorizada>(emp.raw_data, 'personasAutorizadas')
    let solicitudes = lista<Solicitud>(emp.raw_data, 'personasSolicitudes')
    const personaId = String(body.personaId ?? '')

    if (accion === 'listar') {
      // Códigos ID de cada operador, para cargarles saldo o enviarles.
      // De a 150 ids y solo el código: con miles de clientes, un .in() con
      // todos armaba una URL que el servidor rechaza, y raw_data entero de
      // cada uno pesaba megas.
      const ids = [...autorizadas, ...solicitudes].map(x => x.id)
      const codigo: Record<string, string> = {}
      for (let i = 0; i < ids.length; i += 150) {
        const { data: filas } = await db.from('users').select('id, ref:raw_data->>ownReferralCode').in('id', ids.slice(i, i + 150))
        for (const f of (filas ?? []) as any[]) codigo[String(f.id)] = codigoDe({ id: f.id, raw_data: { ownReferralCode: f.ref } })
      }
      // El origen de fondos es para Cumplimiento: a la empresa no se le manda.
      const sinOrigen = <T extends Solicitud>(x: T) => { const { origenFondos: _o, ...r } = x; return r }
      // Cuánto lleva cada aprobado contra su tope este mes: la misma cuenta
      // que ve el operador en su portal (retiros a banco/Bre-B en curso o hechos).
      // De a 150 clientes y por páginas: con muchos, los movimientos del mes
      // pasan de las 1.000 filas que PostgREST devuelve de una vez.
      const usado: Record<string, number> = {}
      if (autorizadas.length && body.sinUso !== true) {
        const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0)
        const idsA = autorizadas.map(a => a.id)
        for (let i = 0; i < idsA.length; i += 150) {
          await leerPorPaginas(() => db.from('transactions').select('id, user_id, amount, status').in('user_id', idsA.slice(i, i + 150)).eq('type', 'dispersion').gte('created_at', ini.toISOString()), { alLote: (lote) => {
            for (const t of lote) {
              if (!['Completado', 'Procesando', 'Pendiente'].includes(String(t.status))) continue
              usado[String(t.user_id)] = (usado[String(t.user_id)] ?? 0) + (Number(t.amount) || 0)
            }
          } })
        }
      }
      return json({ ok: true, miId: codigoDe(emp), autorizadas: autorizadas.map(a => ({ ...sinOrigen(a), codigo: codigo[a.id] ?? '', ...(body.sinUso === true ? {} : { usadoMes: usado[a.id] ?? 0 }) })), solicitudes: solicitudes.map(s => ({ ...sinOrigen(s), estado: etapa(s), codigo: codigo[s.id] ?? '' })) })
    }

    // La empresa ve la foto del operador sosteniendo su documento, para saber
    // que es su cliente. Los documentos los revisa Cumplimiento.
    if (accion === 'ver_foto') {
      if (![...autorizadas, ...solicitudes].some(x => x.id === personaId)) return json({ ok: false, error: 'Ese operador no te pidió autorización' }, 403)
      if (!(await esPersona(personaId, yo.id)) || !(await constancia(yo.id, personaId, 'empresa.persona_solicitud'))) {
        return json({ ok: false, error: 'Ese operador no te pidió autorización' }, 403)
      }
      const { data: p } = await db.from('users').select('documents').eq('id', personaId).maybeSingle()
      return json({ ok: true, foto: String((p?.documents as any)?.autorizacionFoto ?? '') || null })
    }

    // Aceptar a un operador como cliente. 'aprobar' era el nombre de antes:
    // se acepta igual, y el tope que mande se ignora (lo fija Cumplimiento).
    if (accion === 'aceptar' || accion === 'aprobar') {
      const s = solicitudes.find(x => x.id === personaId)
      if (!s) return json({ ok: false, error: 'Esa solicitud ya no está' }, 404)
      if (etapa(s) === 'cumplimiento') return json({ ok: true, autorizadas, solicitudes })
      const pr = await esPersona(personaId, yo.id)
      if (!pr || (await ultimaSolicitudA(personaId)) !== yo.id) return json({ ok: false, error: 'Esa solicitud ya no está' }, 404)
      const ahora = new Date().toISOString()
      solicitudes = solicitudes.map(x => x.id === personaId ? { ...x, estado: 'cumplimiento' as Etapa, aceptadaAt: ahora } : x)
      const e1 = await guardarEmpresa(yo.id, autorizadas, solicitudes)
      if (e1) return json({ ok: false, error: e1 }, 500)
      await guardarPersona(personaId, { autorizacion: { ...(pr.raw?.autorizacion ?? {}), estado: 'cumplimiento', empresaId: yo.id, empresaNombre: nombreEmpresa(emp), aceptadaAt: ahora } })
      await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.persona_aceptada', metadata: { personaId, email: s.email, at: ahora } })
      await notificar(personaId, 'Tu empresa te aceptó', `${nombreEmpresa(emp)} te aceptó como cliente. Ahora el equipo de cumplimiento de Lincoin revisa tus documentos y fija tu tope mensual.`, 'success', '/portal_personas')
      const quien = escHtml(s.nombre), empresaTxt = escHtml(nombreEmpresa(emp))
      await avisarCumplimiento(
        `Operador por revisar · ${s.nombre}`,
        `<p style="font-family:Arial,sans-serif;font-size:14px;color:#15181A">${empresaTxt} aceptó a <b>${quien}</b> (${escHtml(s.tipoOperador === 'empresa' ? 'empresa' : 'persona')}, ${escHtml(s.docType)} ${escHtml(s.docNumber)}) como su cliente. Falta revisar sus documentos, fijarle el tope mensual y aprobarlo.</p><p style="font-family:Arial,sans-serif;font-size:13px;color:#5C625E">Se revisa en Admin → Cumplimiento → Operadores.</p>`,
        `${nombreEmpresa(emp)} aceptó a ${s.nombre}. Revísalo en Cumplimiento → Operadores.`,
      )
      return json({ ok: true, autorizadas, solicitudes })
    }

    if (accion === 'rechazar') {
      const s = solicitudes.find(x => x.id === personaId)
      solicitudes = solicitudes.filter(x => x.id !== personaId)
      const e1 = await guardarEmpresa(yo.id, autorizadas, solicitudes)
      if (e1) return json({ ok: false, error: e1 }, 500)
      // Al operador solo se le escribe si de verdad le pidió a esta empresa.
      const pr = s ? await esPersona(personaId, yo.id) : null
      if (s && pr && (await constancia(yo.id, personaId, 'empresa.persona_solicitud'))) {
        // Si no tiene otra empresa aprobada, queda "rechazada".
        const otra = await empresaDe(personaId)
        if (!otra) await guardarPersona(personaId, { autorizacion: { ...(pr.raw?.autorizacion ?? {}), estado: 'rechazada', empresaId: yo.id, empresaNombre: nombreEmpresa(emp), motivo: null, por: 'empresa', at: new Date().toISOString() } })
        await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.persona_rechazada', metadata: { personaId, email: s.email, at: new Date().toISOString() } })
        await notificar(personaId, 'Solicitud rechazada', `${nombreEmpresa(emp)} no te aceptó como cliente. Revisa tus datos y vuelve a pedirla.`, 'info', '/portal_personas')
      }
      return json({ ok: true, autorizadas, solicitudes })
    }

    if (accion === 'revocar') {
      const a = autorizadas.find(x => x.id === personaId)
      if (!a) {
        autorizadas = autorizadas.filter(x => x.id !== personaId)
        return json({ ok: true, autorizadas, solicitudes })
      }
      // Solo la empresa con la que de verdad quedó aprobado (constancia del
      // servidor, o el espejo que escribió el servidor) puede quitarlo.
      const pr = await esPersona(personaId, yo.id)
      const suya = !!pr && ((await constancia(yo.id, personaId, 'empresa.persona_aprobada')) || String(pr.raw?.empresaAutorizante?.id ?? '') === yo.id)
      if (!suya) return json({ ok: false, error: 'Ese operador no está aprobado con tu empresa' }, 403)
      const e1 = await quitarAutorizacion(yo.id, emp, a, null, 'empresa')
      if (e1) return json({ ok: false, error: e1 }, 500)
      autorizadas = autorizadas.filter(x => x.id !== personaId)
      await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.persona_revocada', metadata: { personaId, email: a.email, at: new Date().toISOString() } })
      await notificar(personaId, 'Autorización retirada', `${nombreEmpresa(emp)} dejó de operar contigo. Puedes pedir autorización a otra empresa desde Detalles de mi cuenta.`, 'info', '/portal_personas')
      return json({ ok: true, autorizadas, solicitudes })
    }

    if (accion === 'tope') return json({ ok: false, error: 'El tope mensual lo fija el equipo de cumplimiento de Lincoin.' }, 403)

    return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    console.error('[autorizaciones]', (e as Error)?.message ?? e)
    return json({ ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }, 500)
  }
})
