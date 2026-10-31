// ══════════════════════════════════════════════════════════════════
//  contador — acceso a la contabilidad y la facturación de una empresa
//
//  El contador tiene SU cuenta en Lincoin (la que sea, menos admin). Entra
//  por "Empresas → Contabilidad", escribe el ID Lincoin de la empresa y
//  queda como solicitud. La empresa, desde su Contabilidad (botón
//  "Contador"), aprueba o rechaza. Aprobado, el contador ve la contabilidad
//  de esa empresa (movimientos, comprobantes, facturas) y opera su
//  facturación en Siigo: emitir y configurar, credenciales incluidas (eso lo
//  autoriza la función `facturacion`, con este mismo vínculo, y queda en el
//  audit_log de la empresa). Nada de saldos ni envíos.
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
//
//  Documentos contables (RUT, Cámara de Comercio, declaraciones, estados
//  financieros): los anexa el contador y la empresa los descarga en su
//  perfil. Sin empresaId (o con el propio) es la empresa; con empresaId, el
//  contador aprobado de esa empresa.
//    docs_listar    {empresaId?}                              — los dos
//    docs_subir     {empresaId, tipo, descripcion?, nombre, base64} — contador
//    docs_url       {empresaId?, id}                          — los dos
//    docs_borrar    {empresaId, id}                           — contador
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

// ── Documentos contables de la empresa ───────────────────────────────
// Bucket PRIVADO: cada descarga es una URL firmada que vence en minutos. En
// raw_data (base64) pesarían varios MB y viajarían con cada carga del panel;
// ahí solo va la lista (tipo, nombre, quién y cuándo).
const BUCKET_DOCS = 'empresa-documentos'
const MAX_DOC = 8 * 1024 * 1024
const TIPOS_DOC: Record<string, string> = {
  rut: 'RUT',
  camara_comercio: 'Cámara de Comercio',
  declaracion: 'Declaración',
  estados_financieros: 'Estados financieros',
  otro: 'Otro documento',
}
// El formato lo dice el contenido, no el nombre ni lo que diga el navegador:
// un .pdf que por dentro es otra cosa no entra. El tipo con el que se sirve
// lo pone este servidor.
const FORMATOS: Record<string, { mime: string; firma: (b: Uint8Array) => boolean }> = {
  pdf:  { mime: 'application/pdf', firma: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  jpg:  { mime: 'image/jpeg', firma: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  jpeg: { mime: 'image/jpeg', firma: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  png:  { mime: 'image/png', firma: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  webp: { mime: 'image/webp', firma: b => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', firma: b => b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04 },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', firma: b => b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04 },
  xls:  { mime: 'application/vnd.ms-excel', firma: b => b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0 },
}
type DocEmpresa = { id: string; tipo: string; descripcion: string; nombre: string; path: string; mime: string; size: number; subidoPor: { id: string; nombre: string }; at: string }

let bucketDocsListo = false
async function asegurarBucketDocs() {
  if (bucketDocsListo) return
  const { error } = await db.storage.getBucket(BUCKET_DOCS)
  if (error) {
    const { error: e2 } = await db.storage.createBucket(BUCKET_DOCS, { public: false, fileSizeLimit: MAX_DOC })
    if (e2 && !/already exists/i.test(e2.message)) throw e2
  }
  bucketDocsListo = true
}

// La lista sale de la fila de la empresa, pero una ruta solo cuenta si está
// en la carpeta de ESA empresa: la empresa puede editar su raw_data desde el
// navegador, y con una ruta ajena firmaríamos el archivo de otra.
const documentosDe = (emp: any): DocEmpresa[] => {
  const crudos = (emp?.raw_data as any)?.documentosContables
  return (Array.isArray(crudos) ? crudos : [])
    .filter((d: any) => d && d.id && typeof d.path === 'string' && d.path.startsWith(`${emp.id}/`) && !d.path.includes('..') && TIPOS_DOC[String(d.tipo)])
}

// El nombre con que se descarga: sin tildes ni signos raros, que algunos
// navegadores los cambian por guiones o cortan el nombre.
const nombreDescarga = (d: DocEmpresa) => {
  const ext = d.path.split('.').pop() ?? ''
  const base = String(d.nombre || TIPOS_DOC[d.tipo]).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 80) || d.tipo
  return ext ? `${base}.${ext}` : base
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
        await notificar(String(emp.id), 'Tu contador pide acceso', `${yo.nombre || yo.email} (${yo.email}) pide acceso a tu contabilidad y a tu facturación (ver movimientos, emitir facturas en tu Siigo y configurarla). Apruébalo o recházalo en Contabilidad → Contador.`)
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
      // comprobantes no tiene columna id: su clave es el folio. Con 'id' la
      // consulta fallaba («column comprobantes.id does not exist») y el
      // portal lo mostraba arriba de la contabilidad.
      const [tx, comps] = await Promise.all([leerTodo('transactions', 'created_at'), leerTodo('comprobantes', 'folio')])
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

    // El contador deja de trabajar con una empresa: sale de su lista de
    // aprobados (o retira la solicitud en espera) y la empresa se entera. La
    // configuración de Siigo, las facturas y la cola de emisión son de la
    // EMPRESA (van por su id): no se tocan. Si vuelve, pide acceso otra vez.
    if (accion === 'salir_empresa') {
      const empresaId = String(body.empresaId ?? '')
      const emp = empresaId ? await empresaPorId(empresaId) : null
      if (!emp) return json({ ok: false, error: 'La empresa ya no existe' }, 404)
      const aprobados = lista(emp.raw_data, 'contadores')
      const pendientes = lista(emp.raw_data, 'contadoresSolicitudes')
      if (!aprobados.some(c => c.id === yo.id) && !pendientes.some(c => c.id === yo.id)) return json({ ok: true })
      const err = await guardarVinculos(empresaId, aprobados.filter(c => c.id !== yo.id), pendientes.filter(c => c.id !== yo.id))
      if (err) return json({ ok: false, error: `No se pudo dejar la empresa: ${err}` }, 500)
      await db.from('audit_log').insert({ user_id: emp.id, action: 'empresa.contador_salio', metadata: { contadorId: yo.id, email: yo.email, at: new Date().toISOString() } })
      await notificar(String(emp.id), 'Tu contador dejó tu contabilidad', `${yo.nombre || yo.email} (${yo.email}) dejó de trabajar con tu contabilidad y tu facturación. Tu configuración de Siigo sigue guardada en tu cuenta, tal como estaba.`)
      return json({ ok: true })
    }

    // ── DOCUMENTOS CONTABLES (contador y empresa) ────────────────────────
    if (accion.startsWith('docs_')) {
      // A quién pertenecen: sin empresaId (o con el propio), a la empresa que
      // llama; con empresaId, a esa empresa, si tiene aprobado al que llama.
      const pedida = String(body.empresaId ?? '')
      const comoContador = !!pedida && pedida !== yo.id
      if (!comoContador && yo.role !== 'business') return json({ ok: false, error: 'Solo la empresa o su contador ven estos documentos' }, 403)
      const emp = await empresaPorId(comoContador ? pedida : yo.id)
      if (!emp) return json({ ok: false, error: 'La empresa ya no existe' }, 404)
      if (comoContador && !lista(emp.raw_data, 'contadores').some(c => c.id === yo.id)) return json({ ok: false, error: 'La empresa no ha aprobado tu acceso.' }, 403)
      const docs = documentosDe(emp)

      if (accion === 'docs_listar') {
        const orden = [...docs].sort((a, b) => String(b.at).localeCompare(String(a.at)))
        // La ruta del bucket no sale: la descarga va siempre por docs_url.
        return json({ ok: true, puedeSubir: comoContador, tipos: TIPOS_DOC, documentos: orden.map(({ path: _p, ...d }) => d) })
      }

      if (accion === 'docs_url') {
        const d = docs.find(x => x.id === String(body.id ?? ''))
        if (!d) return json({ ok: false, error: 'Ese documento ya no está' }, 404)
        const { data, error } = await db.storage.from(BUCKET_DOCS).createSignedUrl(d.path, 300, { download: nombreDescarga(d) })
        if (error || !data?.signedUrl) {
          console.error('[contador] docs_url:', error?.message)
          return json({ ok: false, error: 'No se pudo preparar la descarga. Intenta de nuevo.' }, 500)
        }
        return json({ ok: true, url: data.signedUrl })
      }

      // Anexar y retirar es del contador: la empresa los descarga.
      if (!comoContador) return json({ ok: false, error: 'Los documentos los anexa tu contador' }, 403)

      if (accion === 'docs_subir') {
        const tipo = String(body.tipo ?? '')
        if (!TIPOS_DOC[tipo]) return json({ ok: false, error: 'Elige qué documento es' }, 400)
        if (tipo === 'otro' && !String(body.descripcion ?? '').trim()) return json({ ok: false, error: 'Escribe qué documento es (por ejemplo «Certificado bancario»).' }, 400)
        const nombre = String(body.nombre ?? '').trim().slice(0, 120)
        const ext = (nombre.split('.').pop() ?? '').toLowerCase()
        const formato = FORMATOS[ext]
        if (!formato) return json({ ok: false, error: 'Tiene que ser un PDF, una foto (JPG, PNG, WEBP), un Excel o un Word.' }, 400)
        let bytes: Uint8Array
        try {
          const b64 = String(body.base64 ?? '').includes(',') ? String(body.base64).split(',')[1] : String(body.base64 ?? '')
          bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
        } catch { return json({ ok: false, error: 'No se pudo leer el archivo.' }, 400) }
        if (bytes.byteLength < 100) return json({ ok: false, error: 'El archivo llegó vacío o dañado.' }, 400)
        if (bytes.byteLength > MAX_DOC) return json({ ok: false, error: 'Puede pesar hasta 8 MB.' }, 400)
        if (!formato.firma(bytes)) return json({ ok: false, error: `El archivo no es un .${ext} de verdad (por dentro es otro formato). Guárdalo de nuevo como ${ext.toUpperCase()} y vuelve a intentarlo.` }, 400)
        if (docs.length >= 200) return json({ ok: false, error: 'Ya hay 200 documentos anexados. Retira los que sobran para anexar más.' }, 400)

        await asegurarBucketDocs()
        const id = crypto.randomUUID()
        const path = `${emp.id}/${id}-${tipo}.${ext}`
        const { error } = await db.storage.from(BUCKET_DOCS).upload(path, bytes, { contentType: formato.mime, upsert: false })
        if (error) {
          console.error('[contador] docs_subir:', error.message)
          return json({ ok: false, error: 'No se pudo guardar el documento. Intenta de nuevo en un momento.' }, 500)
        }
        const doc: DocEmpresa = {
          id, tipo, descripcion: String(body.descripcion ?? '').trim().slice(0, 120), nombre, path, mime: formato.mime, size: bytes.byteLength,
          subidoPor: { id: yo.id, nombre: yo.nombre || yo.email }, at: new Date().toISOString(),
        }
        // La lista se vuelve a leer justo antes de escribir: si dos archivos
        // se anexan a la vez, no se pisa el que llegó primero.
        const fresca = documentosDe(await empresaPorId(String(emp.id)))
        const err = await mergeRaw(db, String(emp.id), { documentosContables: [doc, ...fresca] })
        if (err) {
          await db.storage.from(BUCKET_DOCS).remove([path]).catch(() => {})
          return json({ ok: false, error: `No se pudo registrar el documento: ${err}` }, 500)
        }
        await db.from('audit_log').insert({ user_id: emp.id, action: 'empresa.documento_anexado', metadata: { contadorId: yo.id, email: yo.email, documentoId: id, tipo, nombre, at: doc.at } })
        const que = doc.descripcion ? `${TIPOS_DOC[tipo]} (${doc.descripcion})` : TIPOS_DOC[tipo]
        await notificar(String(emp.id), 'Tu contador anexó un documento', `${yo.nombre || yo.email} anexó ${que} a tu cuenta. Lo descargas en Mi perfil → Documentos contables.`, 'info', '/empresas_perfil')
        const { path: _p, ...visible } = doc
        return json({ ok: true, documento: visible })
      }

      if (accion === 'docs_borrar') {
        const id = String(body.id ?? '')
        const d = docs.find(x => x.id === id)
        if (!d) return json({ ok: true })
        const fresca = documentosDe(await empresaPorId(String(emp.id)))
        const err = await mergeRaw(db, String(emp.id), { documentosContables: fresca.filter(x => x.id !== id) })
        if (err) return json({ ok: false, error: `No se pudo retirar el documento: ${err}` }, 500)
        const { error: eRm } = await db.storage.from(BUCKET_DOCS).remove([d.path])
        if (eRm) console.error('[contador] docs_borrar:', eRm.message)
        await db.from('audit_log').insert({ user_id: emp.id, action: 'empresa.documento_retirado', metadata: { contadorId: yo.id, email: yo.email, documentoId: id, tipo: d.tipo, nombre: d.nombre, at: new Date().toISOString() } })
        return json({ ok: true })
      }

      return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
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
      await notificar(contadorId, 'Acceso aprobado', `${nombreEmpresa(emp)} aprobó tu acceso a su contabilidad y su facturación. Entra por Empresas → Contabilidad.`, 'success', '/portal_contabilidad')
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
