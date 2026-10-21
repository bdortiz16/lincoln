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
      // El código no es único en la base: si dos empresas lo comparten no se
      // adivina a cuál pedirle acceso.
      const { data: emps } = await db.from('users').select('*').eq('role', 'business').eq('raw_data->>ownReferralCode', codigo).limit(2)
      if ((emps ?? []).length > 1) return json({ ok: false, error: 'Ese ID está repetido. Pídele a la empresa que se comunique con soporte.' }, 409)
      const emp = (emps ?? [])[0]
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
      // Solo cuentan los accesos que la EMPRESA tiene aprobados en su lista.
      // El esquema anterior confiaba en raw_data.contadorDe del propio
      // contador, que él mismo puede editar: con apuntarlo a cualquier empresa
      // veía toda su contabilidad.
      const aprobadas = (ap.data ?? []).map((e: any) => ({ id: String(e.id), nombre: nombreEmpresa(e) }))
      return json({ ok: true, aprobadas, pendientes: (pe.data ?? []).map((e: any) => ({ id: String(e.id), nombre: nombreEmpresa(e) })) })
    }

    if (accion === 'datos') {
      let empresaId = String(body.empresaId ?? '')
      if (!empresaId) {
        const { data: ap } = await db.from('users').select('id').eq('role', 'business').contains('raw_data', { contadores: [{ id: yo.id }] }).limit(1)
        empresaId = String(ap?.[0]?.id ?? '')
      }
      if (!empresaId) return json({ ok: false, error: 'Todavía no tienes acceso aprobado a ninguna empresa.' }, 403)
      const emp = await empresaPorId(empresaId)
      if (!emp) return json({ ok: false, error: 'La empresa ya no existe' }, 404)
      // La aprobación la da la lista de la empresa, no el perfil del contador.
      const aprobado = lista(emp.raw_data, 'contadores').some(c => c.id === yo.id)
      if (!aprobado) return json({ ok: false, error: 'La empresa no ha aprobado tu acceso.' }, 403)

      // POR PÁGINAS: la API devuelve como mucho 1.000 filas por consulta. Con
      // .limit(5000) una empresa con más de 1.000 movimientos veía vacíos los
      // meses viejos y un "saldo inicial" equivocado en el Excel.
      const leerTodo = async (tabla: string, columnaOrden: string) => {
        const filas: any[] = []
        for (let desde = 0; desde < 20000; desde += 1000) {
          // Orden fijo: sin él, las páginas pueden repetir o saltarse filas.
          const { data, error } = await db.from(tabla).select('*').eq('user_id', empresaId)
            .order(columnaOrden, { ascending: false }).range(desde, desde + 999)
          if (error) return { data: filas, error }
          filas.push(...(data ?? []))
          if (!data || data.length < 1000) break
        }
        return { data: filas, error: null as any }
      }
      const [tx, comps] = await Promise.all([leerTodo('transactions', 'created_at'), leerTodo('comprobantes', 'id')])
      if (tx.error) return json({ ok: false, error: `Movimientos: ${tx.error.message}` }, 500)
      // La ficha del titular para el estado de cuenta: identificación,
      // dirección y representante legal. Nada de documentos, fecha de
      // nacimiento ni PEP: eso es de cumplimiento, no de la contadora.
      const e = emp as any, raw = (e.raw_data ?? {}) as any
      const txt = (...vs: unknown[]) => { for (const v of vs) { const s = String(v ?? '').trim(); if (s) return s } return '' }
      const nit = txt(e.tax_id, e.nit, raw.taxId, raw.nit)
      return json({
        ok: true,
        empresa: {
          id: String(emp.id), nombre: nombreEmpresa(emp), email: String(emp.email ?? ''), nit,
          tipoDocumento: txt(e.tax_id_type, raw.taxIdType) || (nit ? 'NIT' : ''),
          telefono: txt(e.phone, raw.phone, raw.telefono),
          pais: txt(e.company_country, raw.companyCountry),
          ciudad: txt(e.company_city, raw.companyCity),
          direccion: txt(e.company_address, raw.companyAddress),
          representante: txt(e.rep_legal_name, raw.repLegalName, [e.rep_first_name, e.rep_last_name].filter(Boolean).join(' ')),
          representanteDoc: [txt(e.rep_doc_type, raw.repDocType), txt(e.rep_doc_number, raw.repDocNumber)].filter(Boolean).join(' '),
          idLincoin: codigoDe(emp),
          clienteDesde: e.created_at ?? null,
        },
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
    console.error('[contador]', (e as Error)?.message ?? e)
    return json({ ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }, 500)
  }
})
