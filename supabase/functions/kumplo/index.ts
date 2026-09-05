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
  rutaEstado: string          // GET  — vuelve a leer el estado de una persona
  // De dónde sacar el resultado en la respuesta de Kumplo.
  campoId: string             // p. ej. 'data.id'
  campoRiesgo: string         // p. ej. 'data.risk.level'
  valoresAlto: string[]       // qué valores significan ALTO
  valoresMedio: string[]
  bloquearEnAlto: boolean     // si ALTO impide transferir
  soloEstosUsuarios: string[] // ids; vacío = todos. La prueba empieza acotada.
}

const CONFIG_POR_DEFECTO: Config = {
  activo: false,
  baseUrl: '',
  empresaId: '',
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  rutaCrear: '',
  rutaAml: '',
  rutaEstado: '',
  campoId: 'id',
  campoRiesgo: 'risk_level',
  valoresAlto: ['high', 'alto', 'critical', 'critico'],
  valoresMedio: ['medium', 'medio', 'moderate'],
  bloquearEnAlto: true,
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
  const r = await fetch(url, { method: metodo, headers, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) })
  const texto = await r.text().catch(() => '')
  let cuerpoJson: any = null
  try { cuerpoJson = texto ? JSON.parse(texto) : null } catch { /* respuesta no-JSON */ }
  return { ok: r.ok, status: r.status, body: cuerpoJson, texto: texto.slice(0, 500), url }
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
  riesgo?: 'bajo' | 'medio' | 'alto' | 'desconocido'
  estado?: string
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

async function auditar(accion: string, meta: unknown) {
  try { await db.from('audit_log').insert({ action: accion, metadata: meta as any }) } catch { /* la auditoría nunca frena la operación */ }
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
  const documento = String(p.document_number ?? raw.documentNumber ?? raw.cedula ?? '')

  const r = await llamarKumplo(c, c.rutaCrear, 'POST', {
    empresa_id: c.empresaId || undefined,
    referencia_externa: userId,          // para que Kumplo pueda devolver el vínculo
    nombre: p.name ?? raw.fullName ?? '',
    correo: p.email ?? '',
    documento,
    tipo_documento: raw.documentType ?? 'CC',
    telefono: p.phone ?? raw.phone ?? '',
    pais: raw.country ?? 'CO',
  })
  if (!r.ok) {
    await auditar('kumplo.alta_fallida', { userId, status: r.status, detalle: r.texto })
    return await guardarEstado(userId, { estado: 'error_alta', detalle: `Kumplo respondió ${r.status}: ${r.texto}` })
  }
  const id = String(leerRuta(r.body, c.campoId) ?? '')
  await auditar('kumplo.alta', { userId, kumploId: id })
  return await guardarEstado(userId, { id: id || undefined, estado: id ? 'inscrito' : 'inscrito_sin_id', detalle: id ? '' : 'Kumplo no devolvió un id en el campo configurado.' })
}

async function consultarAml(c: Config, userId: string): Promise<EstadoKumplo> {
  const previo = await leerEstado(userId)
  const id = previo.id
  if (!id) return await guardarEstado(userId, { estado: 'sin_id', detalle: 'Todavía no hay id de Kumplo para esta persona.' })

  const ruta = c.rutaAml.replace('{id}', encodeURIComponent(id))
  const r = await llamarKumplo(c, ruta, 'POST', { empresa_id: c.empresaId || undefined, usuario_id: id })
  if (!r.ok) {
    await auditar('kumplo.aml_fallida', { userId, status: r.status, detalle: r.texto })
    return await guardarEstado(userId, { estado: 'error_aml', detalle: `Kumplo respondió ${r.status}: ${r.texto}` })
  }
  const bruto = leerRuta(r.body, c.campoRiesgo)
  const riesgo = normalizarRiesgo(bruto, c)
  await auditar('kumplo.aml', { userId, kumploId: id, riesgo, bruto })
  return await guardarEstado(userId, {
    riesgo,
    estado: 'consultado',
    detalle: riesgo === 'desconocido'
      ? `Kumplo respondió, pero el campo "${c.campoRiesgo}" vino vacío. Revisa el mapeo.`
      : '',
    ultimaRespuesta: r.body,
  })
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
      if (c.activo && (!c.baseUrl || !c.rutaCrear || !c.rutaAml || !API_KEY)) {
        return json({
          error: 'Faltan datos para encender: dirección base, ruta de alta, ruta AML y la credencial en la Bóveda.',
          faltan: {
            baseUrl: !c.baseUrl, rutaCrear: !c.rutaCrear, rutaAml: !c.rutaAml, credencial: !API_KEY,
          },
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
      const r = await llamarKumplo(c, c.rutaEstado || c.rutaCrear, 'GET')
      return json({
        ok: r.ok, status: r.status, url: r.url,
        motivo: r.ok ? 'Kumplo respondió correctamente.' : `Kumplo respondió ${r.status}: ${r.texto}`,
      })
    }

    // ── Estado de una persona ────────────────────────────────────────────
    if (accion === 'estado') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      return json({ ok: true, activo: c.activo, enLaPrueba: enLaPrueba(c, uid), estado: await leerEstado(uid) })
    }

    // ── Vincular a mano un id que ya existe en Kumplo ─────────────────────
    if (accion === 'vincular') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const id = String(body.kumploId ?? '').trim()
      if (!id) return json({ error: 'Falta el id de Kumplo.' }, 400)
      await auditar('kumplo.vinculo_manual', { userId: uid, kumploId: id, por: yo.userId })
      // Se vincula y se consulta de una vez: un vínculo sin consulta no
      // aporta nada, y dejarlo a medias invita a olvidarlo.
      const c = await leerConfig()
      await guardarEstado(uid, { id, estado: 'vinculado' })
      const fin = c.activo ? await consultarAml(c, uid) : await leerEstado(uid)
      return json({ ok: true, estado: fin })
    }

    // ── Alta automática al inscribirse en Lincoin ─────────────────────────
    if (accion === 'inscribir') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'la integración está apagada' })
      if (!enLaPrueba(c, uid)) return json({ ok: true, omitido: 'esta cuenta no está en la prueba' })
      const previo = await leerEstado(uid)
      const conAlta = previo.id ? previo : await darDeAlta(c, uid)
      if (!conAlta.id) return json({ ok: false, estado: conAlta })
      return json({ ok: true, estado: await consultarAml(c, uid) })
    }

    // ── Volver a consultar el AML ─────────────────────────────────────────
    if (accion === 'aml') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: false, motivo: 'La integración está apagada.' })
      return json({ ok: true, estado: await consultarAml(c, uid) })
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
      const puede = e.riesgo !== 'alto'
      return json({
        ok: true, puede, riesgo: e.riesgo ?? 'desconocido',
        motivo: puede ? null : 'Riesgo alto — no se puede transferir. Comunícate con soporte.',
      })
    }

    // ── Listado para el panel ────────────────────────────────────────────
    if (accion === 'listado') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const { data } = await db.from('users').select('id, name, email, raw_data').limit(500)
      const filas = ((data ?? []) as any[])
        .map(u => ({ id: u.id, nombre: u.name, correo: u.email, kumplo: u.raw_data?.kumplo ?? null }))
        .filter(f => f.kumplo)
      return json({ ok: true, filas })
    }

    return json({ error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500)
  }
})
