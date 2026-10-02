// ══════════════════════════════════════════════════════════════════
//  contador — acceso de solo lectura a la contabilidad de una empresa
//
//  El contador tiene SU cuenta en Lincoin (la que sea, menos admin). Entra
//  por "Empresas → Contabilidad", escribe el ID Lincoin de la empresa y
//  queda como solicitud. La empresa, desde su Contabilidad (botón
//  "Contador"), aprueba o rechaza. Aprobado, el contador ve la contabilidad
//  de esa empresa: movimientos, comprobantes, facturas. Nada operable.
//
//  El vínculo vive en la fila de la EMPRESA (raw_data.contadores y
//  raw_data.contadoresSolicitudes) y solo lo escribe este servidor. Que viva
//  del lado de la empresa importa: el contador puede editar su propio
//  raw_data desde el navegador, así que su fila no sirve como prueba de nada.
//
//  Por qué la aprobación: el ID Lincoin son 6 caracteres que la empresa
//  reparte a sus clientes. Sin aprobación, cualquiera que lo tuviera —o lo
//  adivinara— leería la contabilidad completa.
//
//  Acciones (todas con JWT):
//    solicitar      {codigoEmpresa}   — el contador pide acceso
//    estado         {}                — el contador ve sus vínculos
//    datos          {empresaId?}      — el contador pide la contabilidad
//    listar_accesos {}                — la empresa ve solicitudes y contadores
//    aprobar        {contadorId}      — la empresa aprueba una solicitud
//    rechazar       {contadorId}      — la empresa la descarta
//    revocar_acceso {contadorId}      — la empresa quita un acceso aprobado
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

type Quien = { id: string; email: string; role: string; nombre: string; raw: Record<string, unknown> }
type Vinculo = { id: string; email: string; nombre: string; at: string }

async function quienLlama(req: Request): Promise<Quien | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  const { data: { user }, error } = await db.auth.getUser(jwt)
  if (error || !user) return null
  const { data: fila } = await db.from('users').select('id, email, role, full_name, raw_data').eq('id', user.id).maybeSingle()
  if (!fila) return null
  return { id: String(fila.id), email: String(fila.email ?? user.email ?? ''), role: String(fila.role ?? ''), nombre: String(fila.full_name ?? ''), raw: (fila.raw_data ?? {}) as Record<string, unknown> }
}

const codigoDe = (fila: any): string => String(fila?.raw_data?.ownReferralCode || String(fila?.id ?? '').slice(-6)).toUpperCase()
const nombreEmpresa = (fila: any): string => String(fila?.company_name || fila?.full_name || fila?.email || '')
const lista = (raw: any, k: string): Vinculo[] => Array.isArray(raw?.[k]) ? raw[k].filter((x: any) => x && x.id) : []

async function empresaPorId(id: string) {
  const { data } = await db.from('users').select('*').eq('id', id).maybeSingle()
  return data && data.role === 'business' ? data : null
}

// Aviso al usuario: en la campana del panel (raw_data.notifications) y en
// el teléfono (función push). Es un extra: si falla, el vínculo ya quedó.
async function notificar(userId: string, titulo: string, mensaje: string, tipo: 'info' | 'success' = 'info', url = '/empresas_contabilidad') {
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
      body: JSON.stringify({ action: 'enviar', user_ids: [userId], titulo, cuerpo: mensaje, tag: `contador-${userId}`, url, insistir: true }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el push es un extra */ }
}

// Escribe SOLO las dos claves del vínculo, sobre la fila fresca.
async function guardarVinculos(empresaId: string, contadores: Vinculo[], solicitudes: Vinculo[]) {
  return mergeRaw(db, empresaId, { contadores, contadoresSolicitudes: solicitudes })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'Cuerpo inválido' }, 400) }
  const accion = String(body.action ?? '')

  const yo = await quienLlama(req)
  if (!yo) return json({ ok: false, error: 'Sesión inválida' }, 401)
  if (yo.role === 'admin') return json({ ok: false, error: 'El panel de administración no entra por acá' }, 403)

  try {
    // ── EL CONTADOR ──────────────────────────────────────────────────────
    if (accion === 'solicitar') {
      const codigo = String(body.codigoEmpresa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (codigo.length < 4) return json({ ok: false, error: 'Escribe el ID Lincoin de la empresa' }, 400)
      const { data: emp } = await db.from('users').select('*').eq('role', 'business').eq('raw_data->>ownReferralCode', codigo).limit(1).maybeSingle()
      if (!emp) return json({ ok: false, error: 'No hay una empresa con ese ID. Pídele a la empresa que lo copie de su panel (Contabilidad → Contador).' }, 404)
      if (String(emp.id) === yo.id) return json({ ok: false, error: 'Ese es tu propio ID' }, 400)

      const aprobados = lista(emp.raw_data, 'contadores')
      if (aprobados.some(c => c.id === yo.id)) return json({ ok: true, estado: 'aprobado', empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) } })
      const pendientes = lista(emp.raw_data, 'contadoresSolicitudes')
      if (!pendientes.some(c => c.id === yo.id)) {
        pendientes.unshift({ id: yo.id, email: yo.email, nombre: yo.nombre || yo.email, at: new Date().toISOString() })
        const err = await guardarVinculos(String(emp.id), aprobados, pendientes.slice(0, 20))
        if (err) return json({ ok: false, error: `No se pudo guardar la solicitud: ${err}` }, 500)
        await db.from('audit_log').insert({ user_id: emp.id, action: 'empresa.contador_solicitud', metadata: { contadorId: yo.id, email: yo.email, at: new Date().toISOString() } })
        // La empresa se entera en el momento: campana del panel y teléfono.
        await notificar(String(emp.id), 'Tu contador pide acceso', `${yo.nombre || yo.email} (${yo.email}) pide ver tu contabilidad. Apruébalo o recházalo en Contabilidad → Contador.`)
      }
      return json({ ok: true, estado: 'pendiente', empresa: { id: String(emp.id), nombre: nombreEmpresa(emp) } })
    }

    if (accion === 'estado') {
      const [ap, pe] = await Promise.all([
        db.from('users').select('id, full_name, company_name, email').eq('role', 'business').contains('raw_data', { contadores: [{ id: yo.id }] }),
        db.from('users').select('id, full_name, company_name, email').eq('role', 'business').contains('raw_data', { contadoresSolicitudes: [{ id: yo.id }] }),
      ])
      const aprobadas = (ap.data ?? []).map((e: any) => ({ id: String(e.id), nombre: nombreEmpresa(e) }))
      // Accesos creados con el esquema anterior (cuenta con rol contador).
      const legado = String(yo.raw.contadorDe ?? '')
      if (yo.role === 'contador' && legado && !aprobadas.some(a => a.id === legado)) {
        const emp = await empresaPorId(legado)
        if (emp) aprobadas.push({ id: legado, nombre: nombreEmpresa(emp) })
      }
      return json({ ok: true, aprobadas, pendientes: (pe.data ?? []).map((e: any) => ({ id: String(e.id), nombre: nombreEmpresa(e) })) })
    }

    if (accion === 'datos') {
      let empresaId = String(body.empresaId ?? '')
      if (!empresaId) {
        const { data: ap } = await db.from('users').select('id').eq('role', 'business').contains('raw_data', { contadores: [{ id: yo.id }] }).limit(1)
        empresaId = String(ap?.[0]?.id ?? (yo.role === 'contador' ? (yo.raw.contadorDe ?? '') : ''))
      }
      if (!empresaId) return json({ ok: false, error: 'Todavía no tienes acceso aprobado a ninguna empresa.' }, 403)
      const emp = await empresaPorId(empresaId)
      if (!emp) return json({ ok: false, error: 'La empresa ya no existe' }, 404)
      const aprobado = lista(emp.raw_data, 'contadores').some(c => c.id === yo.id) || (yo.role === 'contador' && String(yo.raw.contadorDe ?? '') === empresaId)
      if (!aprobado) return json({ ok: false, error: 'La empresa no ha aprobado tu acceso.' }, 403)

      const [tx, comps] = await Promise.all([
        db.from('transactions').select('*').eq('user_id', empresaId).order('created_at', { ascending: false }).limit(5000),
        db.from('comprobantes').select('*').eq('user_id', empresaId).limit(5000),
      ])
      if (tx.error) return json({ ok: false, error: `Movimientos: ${tx.error.message}` }, 500)
      return json({
        ok: true,
        empresa: { id: String(emp.id), nombre: nombreEmpresa(emp), email: String(emp.email ?? ''), nit: String((emp as any).tax_id ?? (emp as any).nit ?? (emp as any).raw_data?.nit ?? '') },
        transactions: tx.data ?? [],
        comprobantes: comps.error ? [] : (comps.data ?? []),
        comprobantesError: comps.error ? comps.error.message : null,
      })
    }

    // ── LA EMPRESA ───────────────────────────────────────────────────────
    if (yo.role !== 'business') return json({ ok: false, error: 'Solo una cuenta Empresa' }, 403)
    const emp = await empresaPorId(yo.id)
    if (!emp) return json({ ok: false, error: 'No se encontró tu empresa' }, 404)
    let contadores = lista(emp.raw_data, 'contadores')
    let solicitudes = lista(emp.raw_data, 'contadoresSolicitudes')

    if (accion === 'listar_accesos') {
      return json({ ok: true, miId: codigoDe(emp), contadores, solicitudes })
    }

    const contadorId = String(body.contadorId ?? '')
    if (accion === 'aprobar') {
      const s = solicitudes.find(c => c.id === contadorId)
      if (!s) return json({ ok: false, error: 'Esa solicitud ya no está' }, 404)
      if (contadores.length >= 5) return json({ ok: false, error: 'Ya tienes 5 contadores con acceso. Quita uno para aprobar otro.' }, 400)
      solicitudes = solicitudes.filter(c => c.id !== contadorId)
      if (!contadores.some(c => c.id === contadorId)) contadores = [{ ...s, at: new Date().toISOString() }, ...contadores]
      const err = await guardarVinculos(yo.id, contadores, solicitudes)
      if (err) return json({ ok: false, error: err }, 500)
      await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.contador_aprobado', metadata: { contadorId, email: s.email, at: new Date().toISOString() } })
      await notificar(contadorId, 'Acceso aprobado', `${nombreEmpresa(emp)} aprobó tu acceso a su contabilidad. Entra por Empresas → Contabilidad.`, 'success', '/portal_contabilidad')
      return json({ ok: true, contadores, solicitudes })
    }

    if (accion === 'rechazar') {
      const s = solicitudes.find(c => c.id === contadorId)
      solicitudes = solicitudes.filter(c => c.id !== contadorId)
      const err = await guardarVinculos(yo.id, contadores, solicitudes)
      if (err) return json({ ok: false, error: err }, 500)
      if (s) await notificar(contadorId, 'Solicitud rechazada', `${nombreEmpresa(emp)} no aprobó tu acceso a su contabilidad.`, 'info', '/portal_contabilidad')
      return json({ ok: true, contadores, solicitudes })
    }

    if (accion === 'revocar_acceso') {
      const c = contadores.find(x => x.id === contadorId)
      contadores = contadores.filter(x => x.id !== contadorId)
      const err = await guardarVinculos(yo.id, contadores, solicitudes)
      if (err) return json({ ok: false, error: err }, 500)
      // Cuenta del esquema anterior (creada por la empresa, rol contador):
      // solo existía para esto, se elimina del todo.
      const { data: u } = await db.from('users').select('id, role, raw_data').eq('id', contadorId).maybeSingle()
      if (u && u.role === 'contador' && String((u.raw_data as any)?.contadorDe ?? '') === yo.id) {
        await db.from('users').delete().eq('id', contadorId)
        await db.auth.admin.deleteUser(contadorId).catch(() => {})
      }
      await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.contador_revocado', metadata: { contadorId, email: c?.email ?? null, at: new Date().toISOString() } })
      if (c) await notificar(contadorId, 'Acceso retirado', `${nombreEmpresa(emp)} retiró tu acceso a su contabilidad.`, 'info', '/portal_contabilidad')
      return json({ ok: true, contadores, solicitudes })
    }

    return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500)
  }
})
