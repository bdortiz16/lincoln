// ════════════════════════════════════════════════════════
// kumplo — puente entre Lincoin y Kumplo (expediente + AML).
//
// QUÉ HACE
//   1. Al inscribirse alguien en Lincoin, lo da de alta en Kumplo.
//   2. Le pide a Kumplo la consulta AML.
//   3. Guarda el resultado en el perfil y, si el riesgo es ALTO, Lincoin
//      deja de permitirle transferir.
//
// POR QUÉ ES UN ADAPTADOR CONFIGURABLE Y NO CÓDIGO A LA MEDIDA
//   No conozco la API de Kumplo, y adivinar rutas y nombres de campos sería
//   escribir algo que falla el día que se conecte de verdad. Así que TODO lo
//   que depende de ellos —la dirección base, las rutas, cómo mandan la
//   credencial, y en qué campo viene el riesgo— se configura desde el panel.
//   El día que Kumplo entregue su documentación se llenan esos campos y
//   funciona, sin tocar código.
//
// LA CREDENCIAL VIVE EN LA BÓVEDA
//   La llave de Kumplo se lee de KUMPLO_API_KEY. Nunca se guarda en la base
//   ni se devuelve al panel: el panel solo ve si está puesta o no.
//
// ARRANCA APAGADO. Mientras 'activo' sea false esta función no llama a nadie
// y no bloquea a nadie — es una prueba, y una prueba no puede dejar sin
// operar a un cliente real por un error de configuración.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const API_KEY = Deno.env.get('KUMPLO_API_KEY') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CONFIG_KEY = 'kumplo_config'

type Config = {
  activo: boolean
  baseUrl: string
  empresaId: string
  // Cómo viaja la credencial. Kumplo dirá cuál usa.
  authHeader: string          // 'Authorization', 'x-api-key', …
  authPrefix: string          // 'Bearer ', 'ApiKey ', o vacío
  // Rutas. Se les puede meter {id} y {documento}, que se reemplazan.
  rutaCrear: string           // POST — da de alta a la persona
  rutaAml: string             // POST — pide la consulta AML
  rutaEstado: string          // GET  — vuelve a leer el veredicto guardado
  // De dónde sacar el resultado en la respuesta de Kumplo.
  campoId: string             // p. ej. 'data.id'
  campoRiesgo: string         // p. ej. 'data.riesgo'
  campoOperable: string       // p. ej. 'data.operable' — el veredicto que manda
  valoresAlto: string[]       // qué valores significan ALTO
  valoresMedio: string[]
  bloquearEnAlto: boolean     // si el veredicto negativo impide transferir
  // Kumplo marca 'medio' como NO operable (queda en revisión del Oficial).
  // Con esto en true se ignora eso y solo bloquea el riesgo ALTO.
  soloBloquearAlto: boolean
  soloEstosUsuarios: string[] // ids; vacío = todos. La prueba empieza acotada.
}

// Los valores que entregó Kumplo en su especificación vienen ya puestos, para
// no tener que transcribirlos a mano. Siguen siendo editables: el día que
// cambien una ruta se corrige acá, no en el código.
const CONFIG_POR_DEFECTO: Config = {
  activo: false,
  baseUrl: 'https://tqscdruogiaqpbntfywh.supabase.co/functions/v1/super-handler',
  empresaId: '',
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  rutaCrear: '/partner/persona',
  rutaAml: '/partner/aml',
  rutaEstado: '/partner/estado?documento={documento}',
  campoId: 'data.id',
  campoRiesgo: 'data.riesgo',
  campoOperable: 'data.operable',
  valoresAlto: ['alto', 'high', 'critical', 'critico'],
  valoresMedio: ['medio', 'medium', 'moderate'],
  bloquearEnAlto: true,
  soloBloquearAlto: false,
  soloEstosUsuarios: [],
}

async function leerConfig(): Promise<Config> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', CONFIG_KEY).single()
    if (!data?.value) return CONFIG_POR_DEFECTO
    return { ...CONFIG_POR_DEFECTO, ...JSON.parse(data.value) }
  } catch { return CONFIG_POR_DEFECTO }
}

async function guardarConfig(c: Config) {
  await db.from('system_config').upsert({ key: CONFIG_KEY, value: JSON.stringify(c) }, { onConflict: 'key' })
}

// Lee 'data.risk.level' dentro de un objeto cualquiera. Sin esto habría que
// saber de antemano la forma exacta de la respuesta de Kumplo.
function leerRuta(obj: any, ruta: string): any {
  if (!ruta) return undefined
  return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function normalizarRiesgo(valor: unknown, c: Config): 'bajo' | 'medio' | 'alto' | 'desconocido' {
  const v = String(valor ?? '').trim().toLowerCase()
  if (!v) return 'desconocido'
  if (c.valoresAlto.map(x => x.toLowerCase()).includes(v)) return 'alto'
  if (c.valoresMedio.map(x => x.toLowerCase()).includes(v)) return 'medio'
  // Un número también sirve: muchos proveedores devuelven un puntaje 0-100.
  const n = Number(v)
  if (Number.isFinite(n)) return n >= 70 ? 'alto' : n >= 40 ? 'medio' : 'bajo'
  return 'bajo'
}

async function llamarKumplo(c: Config, ruta: string, metodo: 'GET' | 'POST', cuerpo?: unknown) {
  const url = `${c.baseUrl.replace(/\/+$/, '')}/${String(ruta).replace(/^\/+/, '')}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_KEY) headers[c.authHeader || 'Authorization'] = `${c.authPrefix ?? ''}${API_KEY}`
  try {
    const r = await fetch(url, { method: metodo, headers, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) })
    const texto = await r.text().catch(() => '')
    let cuerpoJson: any = null
    try { cuerpoJson = texto ? JSON.parse(texto) : null } catch { /* respuesta no-JSON */ }
    return { ok: r.ok, status: r.status, body: cuerpoJson, texto: texto.slice(0, 500), url }
  } catch (e) {
    // status 0 = ni siquiera se pudo llegar. Distinto de "llegó y dijo que no".
    return { ok: false, status: 0, body: null, texto: `no se pudo contactar: ${(e as Error)?.message ?? 'error de red'}`, url }
  }
}

// Reemplaza los marcadores de una ruta: {documento} y {empresa}. Existen para
// que, si Kumplo pide alguno en la URL en vez de en el cuerpo, se resuelva
// desde el panel sin tocar código.
function rutaCon(_c: Config, ruta: string, documento: string, empresa = ''): string {
  return String(ruta)
    .replace('{documento}', encodeURIComponent(documento))
    .replace('{empresa}', encodeURIComponent(empresa))
}

// ── Identidad de quien llama ──────────────────────────────────────────────
async function quienLlama(req: Request): Promise<{ userId: string | null; esAdmin: boolean }> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { userId: null, esAdmin: false }
  if (SERVICE_KEY && jwt === SERVICE_KEY) return { userId: null, esAdmin: true }
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    if (!user) return { userId: null, esAdmin: false }
    const { data } = await db.from('users').select('role').eq('id', user.id).single()
    return { userId: user.id, esAdmin: (data as any)?.role === 'admin' }
  } catch { return { userId: null, esAdmin: false } }
}

type EstadoKumplo = {
  id?: string
  // El id de la empresa EN KUMPLO, de ESTE titular. Va por cuenta, no global:
  // cada negocio en Lincoin tiene su propia cuenta en Kumplo, y es el titular
  // quien la conecta pegando su código. La credencial sí es una sola —esa es
  // la infraestructura— y por eso Kumplo la manda en cada llamada.
  empresaId?: string
  documento?: string
  riesgo?: 'bajo' | 'medio' | 'alto' | 'desconocido'
  // El veredicto que Kumplo pide usar. Manda sobre 'riesgo': ellos ya
  // resolvieron ahí lo que significa cada nivel, incluido que 'medio' queda
  // en revisión del Oficial y no opera.
  operable?: boolean
  estado?: string             // aprobado | revision | bloqueado | procesando | …
  motivo?: string
  nombreDocumento?: string    // el nombre REAL del documento, según la fuente
  nombreCoincide?: boolean
  validado?: boolean
  jobId?: string
  at?: string
  detalle?: string
  ultimaRespuesta?: unknown
}

async function leerEstado(userId: string): Promise<EstadoKumplo> {
  const { data } = await db.from('users').select('raw_data').eq('id', userId).single()
  return ((data as any)?.raw_data?.kumplo ?? {}) as EstadoKumplo
}

async function guardarEstado(userId: string, parche: EstadoKumplo) {
  const { data } = await db.from('users').select('raw_data').eq('id', userId).single()
  const raw = { ...((data as any)?.raw_data ?? {}) }
  raw.kumplo = { ...(raw.kumplo ?? {}), ...parche, at: new Date().toISOString() }
  await db.from('users').update({ raw_data: raw }).eq('id', userId)
  return raw.kumplo as EstadoKumplo
}

// Los beneficiarios cuelgan de raw_data.kumplo, que ya es escritura solo del
// servidor. Así no hace falta proteger otra clave: si el cliente pudiera
// escribirla, se aprobaría solo a quien quisiera.
async function guardarBeneficiario(userId: string, documento: string, ficha: unknown) {
  const { data } = await db.from('users').select('raw_data').eq('id', userId).single()
  const raw = { ...((data as any)?.raw_data ?? {}) }
  const k = { ...(raw.kumplo ?? {}) }
  k.beneficiarios = { ...(k.beneficiarios ?? {}), [documento]: ficha }
  raw.kumplo = k
  await db.from('users').update({ raw_data: raw }).eq('id', userId)
}

async function auditar(accion: string, meta: unknown) {
  try { await db.from('audit_log').insert({ action: accion, metadata: meta as any }) } catch { /* la auditoría nunca frena la operación */ }
}

// El veredicto final, en un solo sitio. Kumplo dice explícitamente que lo que
// hay que usar es 'operable': ahí ya resolvieron que 'medio' queda en revisión
// del Oficial y no opera, y que un documento sin validar tampoco.
//
// 'soloBloquearAlto' existe porque esa decisión es de negocio, no técnica:
// dejar operar a quien está en revisión es una postura legítima, pero tiene
// que ser una elección consciente y no un descuido.
function veredicto(e: EstadoKumplo, c: Config): { puede: boolean; riesgo: string; estado: string; motivo: string | null } {
  const riesgo = String(e.riesgo ?? 'desconocido')
  const estado = String(e.estado ?? '')
  // Sin veredicto todavía (recién inscrito, o la consulta sigue procesando)
  // NO se bloquea: es una prueba, y esperar no puede costarle una operación a
  // un cliente legítimo.
  if (!e.riesgo && e.operable === undefined) return { puede: true, riesgo, estado, motivo: null }
  if (estado === 'procesando') return { puede: true, riesgo, estado, motivo: null }

  const puede = c.soloBloquearAlto ? riesgo !== 'alto' : e.operable !== false
  if (puede) return { puede: true, riesgo, estado, motivo: null }
  const motivo = riesgo === 'alto'
    ? 'Riesgo alto — no se puede transferir. Comunícate con soporte.'
    : riesgo === 'desconocido'
      ? 'No pudimos validar tu documento. Comunícate con soporte.'
      : 'Tu cuenta está en revisión de cumplimiento. Comunícate con soporte.'
  return { puede: false, riesgo, estado, motivo }
}

// ¿Esta persona entra en la prueba? La lista vacía significa "todos".
function enLaPrueba(c: Config, userId: string): boolean {
  return c.soloEstosUsuarios.length === 0 || c.soloEstosUsuarios.includes(userId)
}

// ── Alta + consulta AML ───────────────────────────────────────────────────
async function darDeAlta(c: Config, userId: string): Promise<EstadoKumplo> {
  const { data: u } = await db.from('users').select('email, name, document_number, phone, raw_data').eq('id', userId).single()
  const p: any = u ?? {}
  const raw = p.raw_data ?? {}
  const documento = String(p.document_number ?? raw.documentNumber ?? raw.cedula ?? '').trim()
  if (!documento) {
    return await guardarEstado(userId, { estado: 'sin_documento', detalle: 'La cuenta no tiene número de documento; Kumplo lo necesita para el alta.' })
  }
  const empresa = String((raw.kumplo ?? {}).empresaId ?? '').trim()
  if (!empresa) {
    return await guardarEstado(userId, { estado: 'sin_conectar', detalle: 'Falta conectar la cuenta de Kumplo.' })
  }

  // Nombres de campo EXACTOS de la especificación de Kumplo. No son un
  // capricho: mandar 'tipo_documento' en vez de 'tipoDocumento' hace que la
  // consulta salga con datos vacíos y devuelva "desconocido".
  const r = await llamarKumplo(c, c.rutaCrear, 'POST', {
    // 'empresa' decide bajo QUÉ cuenta de Kumplo cae la persona. Va en cada
    // llamada, no en la configuración de la credencial: una sola llave sirve
    // para varias empresas. Sin esto, el alta cae en el vacío.
    empresa,
    externalRef: userId,
    nombre: String(p.name ?? raw.fullName ?? '').toUpperCase(),
    documento,
    tipoDocumento: String(raw.documentType ?? 'CC').toUpperCase(),
    correo: p.email ?? '',
    telefono: String(p.phone ?? raw.phone ?? ''),
    pais: raw.country ?? 'Colombia',
  })
  if (!r.ok) {
    await auditar('kumplo.alta_fallida', { userId, status: r.status, detalle: r.texto })
    return await guardarEstado(userId, { documento, estado: 'error_alta', detalle: `Kumplo respondió ${r.status}: ${r.texto}` })
  }
  const id = String(leerRuta(r.body, c.campoId) ?? '')
  const yaExistia = leerRuta(r.body, 'data.existe') === true
  await auditar('kumplo.alta', { userId, kumploId: id, yaExistia })
  return await guardarEstado(userId, {
    id: id || undefined, documento,
    estado: id ? (yaExistia ? 'ya_existia' : 'inscrito') : 'inscrito_sin_id',
    detalle: id ? '' : `Kumplo no devolvió un id en el campo "${c.campoId}".`,
  })
}

// ¿Esta respuesta trae un VEREDICTO de verdad, o solo dice que la persona
// existe? La diferencia importa: alguien ya registrado en Kumplo pero sin
// consulta hecha no tiene ni 'operable' ni 'riesgo', e 'interpretar' —que no
// asume que un veredicto ausente es favorable— lo dejaría como no operable
// sin que nadie haya consultado nada. Eso sería bloquear a un inocente.
function hayVeredicto(cuerpo: any, c: Config): boolean {
  if (String(cuerpo?.data?.estado ?? '').toLowerCase() === 'procesando') return false
  if (typeof leerRuta(cuerpo, c.campoOperable) === 'boolean') return true
  const r = leerRuta(cuerpo, c.campoRiesgo)
  return r !== undefined && r !== null && String(r).trim() !== ''
}

// Traduce una respuesta de Kumplo —de /partner/aml o de /partner/estado— al
// estado que guarda Lincoin. Las dos traen el mismo formato.
function interpretar(cuerpo: any, c: Config, documento: string): EstadoKumplo {
  const d = cuerpo?.data ?? {}
  const estado = String(d.estado ?? '').toLowerCase()
  if (estado === 'procesando') {
    return { documento, estado: 'procesando', jobId: d.jobId ? String(d.jobId) : undefined, detalle: 'Kumplo todavía está procesando la consulta.' }
  }
  const riesgo = normalizarRiesgo(leerRuta(cuerpo, c.campoRiesgo), c)
  const operableBruto = leerRuta(cuerpo, c.campoOperable)
  return {
    documento,
    riesgo,
    // Si Kumplo no manda 'operable', se deduce del riesgo. No se asume que sí
    // puede operar: un veredicto ausente no es un veredicto favorable.
    operable: typeof operableBruto === 'boolean' ? operableBruto : (riesgo === 'bajo'),
    estado: estado || 'consultado',
    motivo: d.motivo ? String(d.motivo) : '',
    nombreDocumento: d.nombreDocumento ? String(d.nombreDocumento) : undefined,
    nombreCoincide: typeof d.nombreCoincide === 'boolean' ? d.nombreCoincide : undefined,
    validado: typeof d.validado === 'boolean' ? d.validado : undefined,
    id: d.id ? String(d.id) : undefined,
    detalle: riesgo === 'desconocido' && estado !== 'procesando'
      ? 'El documento no pudo ser validado por la fuente. Revisa el número.'
      : '',
    ultimaRespuesta: cuerpo,
  }
}

async function consultarAml(c: Config, userId: string): Promise<EstadoKumplo> {
  const previo = await leerEstado(userId)
  const { data: u } = await db.from('users').select('name, document_number, raw_data').eq('id', userId).single()
  const p: any = u ?? {}
  const raw = p.raw_data ?? {}
  const documento = String(previo.documento ?? p.document_number ?? raw.documentNumber ?? raw.cedula ?? '').trim()
  if (!documento) {
    return await guardarEstado(userId, { estado: 'sin_documento', detalle: 'La cuenta no tiene número de documento.' })
  }
  const empresa = String(previo.empresaId ?? '').trim()
  if (!empresa) {
    return await guardarEstado(userId, { estado: 'sin_conectar', detalle: 'Falta conectar la cuenta de Kumplo.' })
  }

  // La consulta va por DOCUMENTO, no por el id de Kumplo: así lo definieron.
  const r = await llamarKumplo(c, c.rutaAml, 'POST', {
    empresa,
    documento,
    tipoDocumento: String(raw.documentType ?? 'CC').toUpperCase(),
    nombre: String(p.name ?? raw.fullName ?? '').toUpperCase(),
  })
  if (!r.ok) {
    await auditar('kumplo.aml_fallida', { userId, status: r.status, detalle: r.texto })
    return await guardarEstado(userId, { documento, estado: 'error_aml', detalle: `Kumplo respondió ${r.status}: ${r.texto}` })
  }

  let leido = interpretar(r.body, c, documento)

  // La fuente de Kumplo es ASÍNCRONA. Ellos esperan hasta ~15 s por dentro;
  // si aun así no terminó, se espera un poco y se relee UNA vez. Más que eso
  // agotaría el tiempo de esta función — si sigue procesando se guarda así y
  // la próxima revisión (o el botón del usuario) lo recoge.
  if (leido.estado === 'procesando' && c.rutaEstado) {
    await new Promise(res => setTimeout(res, 6000))
    const rr = await llamarKumplo(c, rutaCon(c, c.rutaEstado, documento, empresa), 'GET')
    if (rr.ok) leido = interpretar(rr.body, c, documento)
  }

  await auditar('kumplo.aml', { userId, documento, riesgo: leido.riesgo, operable: leido.operable, estado: leido.estado })
  return await guardarEstado(userId, leido)
}

// Relee el último veredicto guardado en Kumplo, sin volver a lanzar la
// consulta. Es lo que hay que usar cuando quedó 'procesando'.
async function releerEstado(c: Config, userId: string): Promise<EstadoKumplo> {
  const previo = await leerEstado(userId)
  const documento = String(previo.documento ?? '').trim()
  if (!documento || !c.rutaEstado) return previo
  const r = await llamarKumplo(c, rutaCon(c, c.rutaEstado, documento, String(previo.empresaId ?? '')), 'GET')
  if (!r.ok) return await guardarEstado(userId, { detalle: `Kumplo respondió ${r.status}: ${r.texto}` })
  return await guardarEstado(userId, interpretar(r.body, c, documento))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({} as any))
    const accion = String(body.action ?? '')
    const yo = await quienLlama(req)

    // ── Configuración (solo admin) ───────────────────────────────────────
    if (accion === 'config_get') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      // La llave NUNCA sale de la Bóveda: solo se dice si está puesta.
      return json({ ok: true, config: c, credencial: API_KEY ? 'configurada' : 'falta' })
    }

    if (accion === 'config_set') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const actual = await leerConfig()
      const c: Config = { ...actual, ...(body.config ?? {}) }
      // No se puede encender sin lo mínimo para funcionar: encender algo que
      // no puede responder solo produce clientes bloqueados sin motivo.
      // El id de la empresa NO se pide acá: lo pone cada titular en su propia
      // configuración, porque cada negocio tiene su cuenta en Kumplo. Lo que
      // se arma en este panel es la infraestructura, que es una sola.
      if (c.activo && (!c.baseUrl || !c.rutaCrear || !c.rutaAml || !API_KEY)) {
        return json({
          error: 'Faltan datos para encender: dirección base, ruta de alta, ruta AML y la credencial en la Bóveda.',
          faltan: { baseUrl: !c.baseUrl, rutaCrear: !c.rutaCrear, rutaAml: !c.rutaAml, credencial: !API_KEY },
        }, 400)
      }
      await guardarConfig(c)
      await auditar('kumplo.config', { activo: c.activo, baseUrl: c.baseUrl, por: yo.userId })
      return json({ ok: true, config: c, credencial: API_KEY ? 'configurada' : 'falta' })
    }

    // Prueba de conexión: pega contra la dirección base y cuenta qué pasó.
    if (accion === 'probar') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.baseUrl) return json({ ok: false, motivo: 'Falta la dirección base de Kumplo.' })
      if (!API_KEY) return json({ ok: false, motivo: 'Falta la credencial de Kumplo en la Bóveda.' })

      // Se consulta a propósito por un documento que NO existe. Lo que se está
      // probando es si Kumplo contesta y si acepta la credencial — no si
      // encuentra a alguien.
      const r = await llamarKumplo(c, rutaCon(c, c.rutaEstado || c.rutaCrear, '0'), 'GET')

      // 404 "persona no encontrada" es la respuesta ESPERADA de esta prueba:
      // significa que se llegó, que la credencial pasó y que el endpoint
      // funciona. Antes esto se reportaba como fallo y hacía pensar que la
      // integración estaba rota cuando estaba perfecta.
      if (r.status === 0) {
        return json({ ok: false, status: 0, url: r.url, motivo: `No se pudo contactar a Kumplo. Revisa la dirección base. (${r.texto})` })
      }
      if (r.status === 401 || r.status === 403) {
        return json({ ok: false, status: r.status, url: r.url, motivo: `Kumplo rechazó la credencial (${r.status}). Revisa la llave en la Bóveda y cómo la esperan (cabecera y prefijo).` })
      }
      if (r.ok || r.status === 404) {
        return json({
          ok: true, status: r.status, url: r.url,
          motivo: r.status === 404
            ? 'Conexión y credencial correctas. Kumplo respondió «persona no encontrada» porque la prueba consulta un documento inexistente a propósito — eso es exactamente lo que se esperaba.'
            : 'Kumplo respondió correctamente.',
        })
      }
      if (r.status >= 500) {
        return json({ ok: false, status: r.status, url: r.url, motivo: `Se llegó a Kumplo pero respondió un error de su lado (${r.status}): ${r.texto}` })
      }
      return json({ ok: false, status: r.status, url: r.url, motivo: `Kumplo respondió ${r.status}: ${r.texto}` })
    }

    // ── Estado de una persona ────────────────────────────────────────────
    if (accion === 'estado') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      const e = await leerEstado(uid)
      return json({ ok: true, activo: c.activo, enLaPrueba: enLaPrueba(c, uid), conectado: !!e.empresaId, estado: e })
    }

    // ── El titular CONECTA su cuenta de Kumplo ────────────────────────────
    // Esta es la única acción que ejecuta el usuario, y es la que arma el
    // vínculo: pega el código EMP-… que Kumplo le dio a SU negocio. La
    // credencial y las rutas son infraestructura nuestra —una sola para
    // todos—; el id de la empresa es de cada quien, por eso Kumplo lo pide
    // en cada llamada.
    //
    // Al conectar se dispara de una vez el alta y la consulta: dejarlo
    // conectado pero sin consultar sería quedarse a mitad de camino.
    if (accion === 'conectar') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const empresaId = String(body.empresaId ?? '').trim()
      if (!empresaId) return json({ error: 'Falta el id de tu empresa en Kumplo.' }, 400)

      const c = await leerConfig()
      await guardarEstado(uid, { empresaId, estado: 'conectado' })
      await auditar('kumplo.conectado', { userId: uid, empresaId, por: yo.userId })
      if (!c.activo) return json({ ok: true, estado: await leerEstado(uid), omitido: 'la integración está apagada' })

      const previo = await leerEstado(uid)
      const conAlta = previo.id ? previo : await darDeAlta(c, uid)
      // Un alta que no devuelve id casi siempre significa que la persona YA
      // está en Kumplo. Lo que falta entonces no es inscribirla de nuevo, sino
      // consultarla: se sigue igual. Solo se corta si no hay qué consultar.
      if (!conAlta.id && (conAlta.estado === 'sin_documento' || conAlta.estado === 'sin_conectar')) {
        return json({ ok: true, estado: conAlta })
      }
      return json({ ok: true, estado: await consultarAml(c, uid) })
    }

    // Desconectar: quita el vínculo y el veredicto. Solo el titular o el admin.
    if (accion === 'desconectar') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const { data } = await db.from('users').select('raw_data').eq('id', uid).single()
      const raw = { ...((data as any)?.raw_data ?? {}) }
      delete raw.kumplo
      await db.from('users').update({ raw_data: raw }).eq('id', uid)
      await auditar('kumplo.desconectado', { userId: uid, por: yo.userId })
      return json({ ok: true, estado: {} })
    }


    // ── Verificar un BENEFICIARIO ─────────────────────────────────────────
    // Cuando el titular inscribe a quien le va a enviar plata, esos datos
    // —nombre, tipo y número de documento, y el banco o la llave— se mandan a
    // Kumplo: registra al beneficiario con su cuenta bancaria y consulta el
    // documento contra TusDatos. Vuelve si se puede operar con esa persona.
    //
    // El veredicto se guarda DENTRO de raw_data.kumplo, que ya es escritura
    // solo del servidor. Si el cliente pudiera escribirlo, se aprobaría solo
    // a los beneficiarios que quisiera y el control dejaría de existir.
    if (accion === 'verificar_beneficiario') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)

      const documento = String(body.documento ?? '').replace(/\D/g, '').trim()
      const nombre = String(body.nombre ?? '').trim().toUpperCase()
      const tipoDocumento = String(body.tipoDocumento ?? 'CC').toUpperCase()
      if (!documento || !nombre) return json({ error: 'Falta el nombre o el documento del beneficiario.' }, 400)

      // El riel decide qué es "la cuenta": en ACH es el número de la cuenta
      // bancaria con su tipo; en Bre-B es la llave y de qué clase es. Kumplo
      // registra al beneficiario CON su cuenta, así que mandarle solo el
      // documento dejaría el registro a medias.
      const riel = String(body.riel ?? '').toUpperCase() === 'BREB' ? 'BREB' : 'ACH'
      const tipoPersona = String(body.tipoPersona ?? 'persona').toLowerCase() === 'empresa' ? 'empresa' : 'persona'
      const banco = String(body.banco ?? '').trim() || (riel === 'BREB' ? 'Bre-B' : '')
      const cuenta = String(body.cuenta ?? '').trim()
      const tipoCuenta = body.tipoCuenta ? String(body.tipoCuenta).trim() : null
      const tipoLlave = body.tipoLlave ? String(body.tipoLlave).trim() : null

      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'la integración está apagada' })
      if (!enLaPrueba(c, uid)) return json({ ok: true, omitido: 'esta cuenta no está en la prueba' })

      const mio = await leerEstado(uid)
      const empresa = String(mio.empresaId ?? '').trim()
      if (!empresa) return json({ ok: false, error: 'sin_conectar', message: 'Conecta tu cuenta de Kumplo antes de inscribir beneficiarios.' })

      // 0) ¿Kumplo ya conoce este documento? Mucha gente ya está registrada
      // allá. En ese caso no se vuelve a inscribir —sería crear un duplicado
      // por nada— y hay dos caminos:
      //   · ya le hicieron la consulta → se toma ese veredicto y listo.
      //   · está registrado pero sin consultar → se lanza la consulta ahora.
      // Con 'forzar' se salta el atajo y se consulta de nuevo aunque haya
      // veredicto guardado: es lo que hace el botón de volver a revisar.
      const forzar = body.forzar === true
      let yaRegistrado = false
      let idBenef = ''
      let deCache: EstadoKumplo | null = null
      if (c.rutaEstado) {
        const pre = await llamarKumplo(c, rutaCon(c, c.rutaEstado, documento, empresa), 'GET')
        if (pre.ok) {
          yaRegistrado = true
          idBenef = String(leerRuta(pre.body, c.campoId) ?? '')
          if (hayVeredicto(pre.body, c) && !forzar) deCache = interpretar(pre.body, c, documento)
        }
        // 404 = no lo conocen todavía. Cualquier otro fallo (su lado caído, la
        // credencial) no se interpreta como "no existe": se sigue el camino
        // normal, que tolera que ya esté.
      }

      if (deCache) {
        const fichaPrevia = {
          nombre, documento, tipoDocumento, tipoPersona,
          riel, banco: banco || null, cuenta: cuenta || null,
          tipoCuenta, tipoLlave,
          id: idBenef || undefined,
          riesgo: deCache.riesgo, operable: deCache.operable, estado: deCache.estado,
          motivo: deCache.motivo ?? null,
          nombreDocumento: deCache.nombreDocumento ?? null,
          nombreCoincide: deCache.nombreCoincide ?? null,
          yaEstaba: true,
          at: new Date().toISOString(),
        }
        await guardarBeneficiario(uid, documento, fichaPrevia)
        await auditar('kumplo.beneficiario', { userId: uid, documento, riesgo: deCache.riesgo, operable: deCache.operable, yaEstaba: true })
        return json({ ok: true, beneficiario: fichaPrevia, yaEstaba: true })
      }

      // 1) Alta del beneficiario en Kumplo, con su cuenta bancaria. Se salta
      // si Kumplo ya lo tiene.
      if (!yaRegistrado) {
        const alta = await llamarKumplo(c, c.rutaCrear, 'POST', {
          empresa,
          externalRef: `${uid}:${documento}`,
          nombre, documento, tipoDocumento,
          tipoPersona,
          pais: 'Colombia',
          datosBancarios: {
            riel,
            banco,
            cuenta,
            ...(tipoCuenta ? { tipoCuenta } : {}),
            ...(tipoLlave ? { tipoLlave } : {}),
          },
        })
        if (alta.ok) idBenef = String(leerRuta(alta.body, c.campoId) ?? '')
        else {
          // No se corta acá. La causa más común de un alta rechazada es que la
          // persona YA ESTÁ en Kumplo, y en ese caso lo que falta no es
          // inscribirla otra vez sino consultarla. Queda auditado y se sigue.
          await auditar('kumplo.beneficiario_alta_fallida', { userId: uid, documento, status: alta.status, detalle: alta.texto })
        }
      }

      // 2) Consulta AML del beneficiario — se hace igual, esté o no registrado.
      const aml = await llamarKumplo(c, c.rutaAml, 'POST', { empresa, documento, tipoDocumento, nombre, tipoPersona })
      // Se guarda la respuesta TAL CUAL, recortada. Sin esto, cuando Kumplo
      // devuelve algo que no esperábamos, el veredicto queda en "sin
      // resultado" y no hay forma de saber qué mandaron sin volver a
      // consultar a ciegas.
      await auditar('kumplo.beneficiario_respuesta', {
        userId: uid, documento, status: aml.status, ok: aml.ok,
        respuesta: JSON.stringify(aml.body ?? aml.texto ?? '').slice(0, 900),
      })
      const leido = aml.ok ? interpretar(aml.body, c, documento)
        : { documento, estado: 'error_aml', detalle: `Kumplo respondió ${aml.status}: ${aml.texto}` } as EstadoKumplo

      // 3) Reintento único si quedó procesando, igual que con el titular.
      let fin = leido
      if (fin.estado === 'procesando' && c.rutaEstado) {
        await new Promise(res => setTimeout(res, 6000))
        const rr = await llamarKumplo(c, rutaCon(c, c.rutaEstado, documento, empresa), 'GET')
        if (rr.ok) fin = interpretar(rr.body, c, documento)
      }

      const ficha = {
        nombre, documento, tipoDocumento, tipoPersona,
        riel, banco: banco || null, cuenta: cuenta || null,
        tipoCuenta, tipoLlave,
        id: idBenef || undefined,
        yaEstaba: yaRegistrado || undefined,
        riesgo: fin.riesgo, operable: fin.operable, estado: fin.estado,
        motivo: fin.motivo ?? null,
        nombreDocumento: fin.nombreDocumento ?? null,
        nombreCoincide: fin.nombreCoincide ?? null,
        detalle: fin.detalle || null,
        // La respuesta de Kumplo, recortada. Queda GUARDADA con el
        // beneficiario: para revisar un caso no hay que volver a consultar ni
        // ir a buscar en la auditoría de ese día.
        respuesta: JSON.stringify((fin as any).ultimaRespuesta ?? aml.body ?? '').slice(0, 700),
        at: new Date().toISOString(),
      }
      await guardarBeneficiario(uid, documento, ficha)
      await auditar('kumplo.beneficiario', { userId: uid, documento, riesgo: fin.riesgo, operable: fin.operable })
      return json({ ok: true, beneficiario: ficha })
    }

    // Estado guardado de los beneficiarios de esta cuenta.
    if (accion === 'beneficiarios') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const e = await leerEstado(uid)
      return json({ ok: true, beneficiarios: (e as any).beneficiarios ?? {} })
    }

    // ── Alta automática al inscribirse en Lincoin ─────────────────────────
    if (accion === 'inscribir') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'la integración está apagada' })
      if (!enLaPrueba(c, uid)) return json({ ok: true, omitido: 'esta cuenta no está en la prueba' })
      const yaCon = await leerEstado(uid)
      // Sin cuenta de Kumplo conectada no hay a dónde registrar a nadie. No es
      // un error: es que el titular todavía no la conectó.
      if (!yaCon.empresaId) return json({ ok: true, omitido: 'la cuenta de Kumplo no está conectada' })
      const previo = yaCon
      const conAlta = previo.id ? previo : await darDeAlta(c, uid)
      // Igual que al conectar: si el alta no dio id lo más probable es que ya
      // estuviera registrada. Se consulta de todas formas.
      if (!conAlta.id && (conAlta.estado === 'sin_documento' || conAlta.estado === 'sin_conectar')) {
        return json({ ok: true, estado: conAlta })
      }
      return json({ ok: true, estado: await consultarAml(c, uid) })
    }

    // ── Volver a consultar el AML ─────────────────────────────────────────
    if (accion === 'aml') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: false, motivo: 'La integración está apagada.' })
      // Si quedó procesando, se RELEE en vez de relanzar: volver a pedir la
      // consulta gasta una petición y no adelanta nada.
      const prev = await leerEstado(uid)
      const fin = prev.estado === 'procesando' ? await releerEstado(c, uid) : await consultarAml(c, uid)
      return json({ ok: true, estado: fin })
    }

    // ── ¿Puede transferir? Lo pregunta el resto del sistema ───────────────
    // Fuera de la prueba, o con la integración apagada, SIEMPRE deja operar.
    // Una integración de prueba no puede convertirse en un freno accidental.
    if (accion === 'puede_operar') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid) return json({ ok: true, puede: true })
      const c = await leerConfig()
      if (!c.activo || !c.bloquearEnAlto || !enLaPrueba(c, uid)) return json({ ok: true, puede: true })
      const e = await leerEstado(uid)
      return json({ ok: true, ...veredicto(e, c) })
    }

    // ── Listado para el panel ────────────────────────────────────────────
    if (accion === 'listado') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const { data } = await db.from('users').select('id, name, email, raw_data').limit(500)
      const filas = ((data ?? []) as any[])
        .map(u => ({ id: u.id, nombre: u.name, correo: u.email, kumplo: u.raw_data?.kumplo ?? null }))
        .filter(f => f.kumplo && (f.kumplo.empresaId || f.kumplo.riesgo))
      return json({ ok: true, filas })
    }

    return json({ error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500)
  }
})
