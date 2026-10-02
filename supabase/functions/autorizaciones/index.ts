// ══════════════════════════════════════════════════════════════════
//  autorizaciones — una empresa autoriza a las personas que operan con ella
//
//  Una cuenta Persona nace con "identificación pendiente" y solo puede
//  recibir dinero de una empresa registrada que la haya autorizado. Para
//  eso la persona escribe el ID Lincoin de la empresa y manda su nombre,
//  su documento y una foto sosteniendo el documento. La empresa ve la
//  solicitud con la foto, la aprueba (fijándole un tope mensual) o la
//  rechaza, y puede revocarla después.
//
//  Dónde vive cada cosa:
//    · empresa.raw_data.personasSolicitudes  [{id, email, nombre, docType, docNumber, at}]
//    · empresa.raw_data.personasAutorizadas  [{id, email, nombre, docType, docNumber, topeMensual, at}]
//    · persona.raw_data.empresaAutorizante   {id, nombre}   (espejo, solo lectura)
//    · persona.raw_data.autorizacion         {estado, empresaId, empresaNombre, nombre, docType, docNumber, at}
//    · persona.documents.autorizacionFoto    la foto (base64), como los demás documentos
//  Todo lo escribe este servidor: la persona no puede autorizarse sola ni
//  cambiar su tope, y la empresa no ve la foto de nadie que no le pidió.
//
//  Cambiar de empresa: la persona manda una solicitud nueva; cuando la
//  nueva empresa aprueba, la anterior queda reemplazada. Nunca se queda sin
//  empresa por el camino.
//
//  Acciones (todas con JWT):
//    Persona:  solicitar {codigoEmpresa, nombre, docType, docNumber, foto}
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
type Solicitud = { id: string; email: string; nombre: string; docType: string; docNumber: string; at: string }
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

      const { data: emp } = await db.from('users').select('*').eq('role', 'business').eq('raw_data->>ownReferralCode', codigo).limit(1).maybeSingle()
      if (!emp) return json({ ok: false, error: 'No hay una empresa con ese ID. Pídele a la empresa que lo copie de su panel (Personas autorizadas).' }, 404)

      const autorizadas = lista<Autorizada>(emp.raw_data, 'personasAutorizadas')
      if (autorizadas.some(a => a.id === yo.id)) return json({ ok: true, estado: 'autorizada', empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) } })
      const solicitudes = lista<Solicitud>(emp.raw_data, 'personasSolicitudes').filter(s => s.id !== yo.id)
      const sol: Solicitud = { id: yo.id, email: yo.email, nombre, docType, docNumber, at: new Date().toISOString() }
      solicitudes.unshift(sol)
      const e1 = await guardarEmpresa(String(emp.id), autorizadas, solicitudes.slice(0, 50))
      if (e1) return json({ ok: false, error: `No se pudo guardar la solicitud: ${e1}` }, 500)
      const e2 = await guardarPersona(yo.id,
        { autorizacion: { estado: 'pendiente', empresaId: String(emp.id), empresaNombre: nombreEmpresa(emp), nombre, docType, docNumber, at: sol.at } },
        { autorizacionFoto: foto })
      if (e2) return json({ ok: false, error: `No se pudo guardar tu foto: ${e2}` }, 500)
      // El nombre y el documento quedan también en el perfil de la persona.
      await db.from('users').update({ full_name: nombre }).eq('id', yo.id)
      await db.from('audit_log').insert({ user_id: emp.id, action: 'empresa.persona_solicitud', metadata: { personaId: yo.id, email: yo.email, nombre, docType, docNumber, at: sol.at } })
      await notificar(String(emp.id), 'Una persona pide tu autorización', `${nombre} (${docType} ${docNumber}) pide operar con tu empresa. Revisa su foto y apruébala o recházala en Personas autorizadas.`)
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
      const { data: p } = await db.from('users').select('documents').eq('id', personaId).maybeSingle()
      return json({ ok: true, foto: String((p?.documents as any)?.autorizacionFoto ?? '') || null })
    }

    if (accion === 'aprobar') {
      const s = solicitudes.find(x => x.id === personaId)
      if (!s) return json({ ok: false, error: 'Esa solicitud ya no está' }, 404)
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
      await guardarPersona(personaId, {
        empresaAutorizante: { id: yo.id, nombre: nombreEmpresa(emp) },
        autorizacion: { estado: 'autorizada', empresaId: yo.id, empresaNombre: nombreEmpresa(emp), nombre: s.nombre, docType: s.docType, docNumber: s.docNumber, at: new Date().toISOString() },
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
      if (s) {
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
      if (a) {
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
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500)
  }
})
