// ════════════════════════════════════════════════════════
// tusdatos — la consulta de antecedentes, hecha por nosotros.
//
// QUÉ HACE
//   1. Lanza la consulta de un documento en TusDatos (/api/launch).
//   2. La consulta es ASÍNCRONA: devuelve un jobid y tarda ~1 minuto. El
//      resultado se recoge por su webhook (individualCompleted) o releyendo
//      /api/results/{jobid}.
//   3. Traduce el resultado a la categoría que usa Lincoin —bajo, medio,
//      alto— y la guarda en el perfil.
//   4. Con el veredicto negativo, Lincoin deja de permitir la transferencia.
//
// POR QUÉ LA HACEMOS NOSOTROS
//   Antes se le pedía el veredicto a Kumplo y Kumplo consultaba TusDatos.
//   Ese camino nunca devolvió el resultado, y desde acá no había forma de
//   saber si el problema era nuestro o suyo. Consultando directo, el
//   resultado es nuestro: lo vemos, lo guardamos y respondemos por él. A
//   Kumplo se le ENVÍA el detalle y el PDF para que su expediente quede
//   completo — al revés de como estaba.
//
// LO QUE TUSDATOS DEVUELVE Y CÓMO SE LEE
//   /api/results/{jobid} → { estado, id, nombre, validado, hallazgo,
//   hallazgos: 'Alto'|'Medio'|'Bajo'|…, error, errores, results }
//   'hallazgos' es la categoría ya calculada según la categorización que la
//   empresa configuró en su panel. Es la que mandamos usar: replicar ese
//   cálculo acá sería mantener dos criterios que se van a separar.
//
// UN VEREDICTO AUSENTE NO ES UN VEREDICTO EN CONTRA
//   Si la consulta falla, queda a medias, o el documento no se pudo validar,
//   NO se bloquea a nadie. Solo corta una categoría explícita. Esta regla ya
//   costó caro una vez: un 'desconocido' convertido en 'no puede operar'
//   rechazó a un cliente legítimo diciéndole que estaba restringido.
//
// LAS CREDENCIALES VIVEN EN LA BÓVEDA
//   TUSDATOS_USER + TUSDATOS_PASSWORD (Basic), o TUSDATOS_TOKEN (Bearer).
//   Nunca se guardan en la base ni se devuelven al panel.
//
// ARRANCA APAGADO.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TD_USER = Deno.env.get('TUSDATOS_USER') ?? ''
const TD_PASS = Deno.env.get('TUSDATOS_PASSWORD') ?? ''
const TD_TOKEN = Deno.env.get('TUSDATOS_TOKEN') ?? ''
// Secreto con el que TusDatos firma sus webhooks hacia nosotros (BearerAuth).
const TD_WEBHOOK = Deno.env.get('TUSDATOS_WEBHOOK_SECRET') ?? ''
// Credencial para ENVIARLE el resultado a Kumplo.
const KUMPLO_KEY = Deno.env.get('KUMPLO_API_KEY') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CONFIG_KEY = 'tusdatos_config'

type Config = {
  activo: boolean
  // Pruebas: http://docs.tusdatos.co — respuestas estáticas, no gasta créditos.
  // Producción: https://dash-board.tusdatos.co — gasta créditos del plan.
  baseUrl: string
  // 'medio' bloquea salvo que esto esté en true.
  soloBloquearAlto: boolean
  bloquear: boolean
  // Ids de cuentas en la prueba. Vacío = todas.
  soloEstosUsuarios: string[]
  // Cada /api/launch en producción GASTA UN CRÉDITO. Con esto se evita
  // relanzar un documento consultado hace poco.
  horasCache: number
  // Enviar el resultado y el PDF a Kumplo cuando la consulta termina.
  enviarAKumplo: boolean
  kumploBaseUrl: string
  kumploRutaResultado: string
}

const CONFIG_POR_DEFECTO: Config = {
  activo: false,
  baseUrl: 'https://dash-board.tusdatos.co',
  soloBloquearAlto: false,
  bloquear: true,
  soloEstosUsuarios: [],
  horasCache: 6,
  enviarAKumplo: false,
  kumploBaseUrl: 'https://tqscdruogiaqpbntfywh.supabase.co/functions/v1/super-handler',
  kumploRutaResultado: '/partner/aml-externo',
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

function hayCredencial(): boolean {
  return !!TD_TOKEN || (!!TD_USER && !!TD_PASS)
}

// Basic o Bearer, según lo que haya en la Bóveda. TusDatos acepta los dos y
// el token es preferible: no viaja la contraseña en cada petición.
function cabeceraAuth(): string {
  if (TD_TOKEN) return `Bearer ${TD_TOKEN}`
  return `Basic ${btoa(`${TD_USER}:${TD_PASS}`)}`
}

async function llamarTD(c: Config, ruta: string, metodo: 'GET' | 'POST', cuerpo?: unknown) {
  const url = `${c.baseUrl.replace(/\/+$/, '')}${ruta.startsWith('/') ? '' : '/'}${ruta}`
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: {
        Authorization: cabeceraAuth(),
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    })
    const texto = await r.text()
    let body: any = null
    try { body = JSON.parse(texto) } catch { /* puede no ser JSON */ }
    return { ok: r.ok, status: r.status, body, texto: texto.slice(0, 600), url }
  } catch (e) {
    // Status 0 = no se llegó. Se distingue a propósito de un rechazo de ellos.
    return { ok: false, status: 0, body: null, texto: `no se pudo contactar: ${(e as Error)?.message ?? 'error de red'}`, url }
  }
}

async function auditar(action: string, metadata: Record<string, unknown>) {
  try { await db.from('audit_log').insert({ action, metadata }) } catch { /* nunca frena la consulta */ }
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

function enLaPrueba(c: Config, userId: string): boolean {
  return !c.soloEstosUsuarios?.length || c.soloEstosUsuarios.includes(userId)
}

// ── Verificación reforzada para BAJAR una protección ─────────────────────
// Apagar la verificación de antecedentes deja pasar envíos que hoy se
// frenan. Encenderla no le hace daño a nadie; apagarla sí, y por eso solo
// esa dirección pide confirmar la identidad.
//
// Se reutiliza el mismo mecanismo del panel (admin-data): la marca vive en
// system_config bajo stepup_<uid> y la escribe quien verifica el código del
// correo. Un segundo mecanismo paralelo se desincroniza y termina siendo un
// candado que se abre solo.
const STEP_UP_TTL_MS = 30 * 60_000
function sessionIdOf(req: Request): string | null {
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    const part = jwt.split('.')[1]
    if (!part) return null
    const pad = part.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))?.session_id ?? null
  } catch { return null }
}
const SIN_SESION = '__sin_sesion__'

// Qué factores faltan. El del correo es el piso y se pide siempre; el de la
// app solo si la cuenta TIENE 2FA activo — exigir un código que ninguna app
// está generando sería un candado imposible de abrir.
async function faltaVerificar(req: Request, userId: string): Promise<string[]> {
  const sid = sessionIdOf(req) ?? SIN_SESION
  const vigente = (t: unknown) => !!t && (Date.now() - Number(t) < STEP_UP_TTL_MS)
  let est: any = {}
  let tiene2fa = false
  try {
    const { data } = await db.from('system_config').select('value').eq('key', `stepup_${userId}`).single()
    const todo = data?.value ? JSON.parse(data.value) : {}
    est = todo[sid] ?? todo[SIN_SESION] ?? {}
  } catch { /* sin marca: se pide todo */ }
  try {
    const { data } = await db.from('users').select('raw_data').eq('id', userId).single()
    tiene2fa = !!(data as any)?.raw_data?.mfaEnabled
  } catch { /* si no se puede saber, no se exige */ }
  const falta: string[] = []
  if (!vigente(est.email)) falta.push('email')
  if (tiene2fa && !vigente(est.app)) falta.push('app')
  return falta
}

// ── El expediente guardado ───────────────────────────────────────────────
type Ficha = {
  documento?: string
  tipoDocumento?: string
  nombre?: string
  // Lo que devuelve TusDatos
  jobid?: string
  reportId?: string
  validado?: boolean
  hallazgo?: boolean
  categoria?: 'alto' | 'medio' | 'bajo' | 'informativo' | 'ninguno' | 'sin_validar'
  // El veredicto de Lincoin. undefined = todavía no hay.
  operable?: boolean
  estado?: string             // procesando | finalizado | error | sin_documento
  detalle?: string
  // Conteo por severidad, del reporte JSON.
  altos?: number
  medios?: number
  bajos?: number
  // Códigos estables de los hallazgos (no el texto, que puede cambiar).
  codigos?: string[]
  fuentesConError?: string[]
  pdfUrl?: string
  enviadoAKumplo?: boolean
  // ── Identidad ──────────────────────────────────────────────────────────
  // Lo que el titular ESCRIBIÓ al inscribir, y lo que dice el documento.
  nombreInscrito?: string
  nombreReal?: string
  nombreCoincide?: boolean
  // Cuántas veces se ha vuelto a lanzar, y si la pidió un admin a mano.
  reintentos?: number
  manual?: boolean
  // Estado del documento en la Registraduría. Una cédula cancelada por
  // muerte o por suplantación no es un detalle: es la señal más fuerte de
  // que quien recibe no es quien dice ser.
  documentoVigente?: boolean
  estadoDocumento?: string
  // Por qué quedó bloqueado, en una línea. Vacío = no está bloqueado.
  bloqueo?: string
  at?: string
}

// ── ¿El nombre inscrito es el del documento? ─────────────────────────────
// Lo que se busca es detectar OTRA PERSONA, no castigar la ortografía. Un
// bloqueo por escribir "SAS" en vez de "S.A.S", o "Jhon" en vez de "John",
// no protege de nada: frena a un cliente legítimo y enseña a ignorar la
// alerta. Por eso la comparación tolera lo que una persona escribe mal de
// verdad y sigue siendo estricta con lo que importa.
//
// Qué se ignora a propósito:
//   · Tildes, puntos y signos — "S.A.S" y "SAS" son la misma cosa.
//   · Las formas jurídicas (SAS, LTDA, SA…) y las palabras de unión, que
//     aparecen o no según quién escriba y no identifican a nadie.
//   · Una letra de diferencia en palabras de cuatro o más — JHON/JOHN,
//     GONZALES/GONZALEZ.

// Formas jurídicas y palabras de relleno. No identifican a nadie: dos
// empresas distintas pueden ser ambas "SAS".
const RELLENO = new Set([
  'SAS', 'SA', 'SAC', 'LTDA', 'LTD', 'SCA', 'EU', 'BIC', 'ESAL', 'CIA', 'INC', 'CORP',
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'EN', 'SUCESION', 'SUC',
])

function normalizar(s: string): string[] {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // Los puntos se BORRAN, no se convierten en espacio: así "S.A.S" queda
    // "SAS" y no tres letras sueltas que el filtro de longitud descartaba —
    // por eso "panorama sas" no coincidía con "Panorama S.A.S".
    .replace(/[.'`´]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(x => x.length > 1 && !RELLENO.has(x))
}

// Distancia de edición, cortada en 2: más allá no hace falta saber cuánto.
// Cuenta el INTERCAMBIO de dos letras seguidas como UN error, no como dos.
// Es el error de tecleo más común —JHON por JOHN, ORITZ por ORTIZ— y sin
// esto quedaba a distancia 2 y bloqueaba a alguien por escribir rápido.
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2
  const m = a.length, n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
    if (Math.min(...d[i]) > 1) return 2
  }
  return d[m][n]
}

// Una parte del nombre "está" si aparece igual, o con una letra de
// diferencia cuando es larga. En palabras cortas no se tolera: con tres
// letras, un error de uno ya es otra palabra.
const estaEn = (t: string, lista: string[]) =>
  lista.includes(t) || (t.length >= 4 && lista.some(x => distancia(t, x) <= 1))

function nombreCoincide(inscrito: string, real: string): boolean | undefined {
  const a = normalizar(inscrito)
  const b = normalizar(real)
  // Sin uno de los dos no hay nada que comparar, y no se inventa un veredicto.
  if (!a.length || !b.length) return undefined
  const sobran = a.filter(t => !estaEn(t, b))
  const comunes = a.filter(t => estaEn(t, b))
  // Dos partes en común, salvo que el nombre real tenga una sola —una
  // empresa suele quedar en una palabra después de quitarle la forma
  // jurídica, y exigirle dos sería imposible de cumplir.
  return sobran.length === 0 && comunes.length >= Math.min(2, b.length)
}

// Códigos de la Registraduría que significan que la cédula NO está vigente.
// 21 muerte · 22 doble cedulación · 23 suplantación · 24 menor de edad ·
// 25/28 extranjería · 26 mala elaboración · 27 reasignación · 51-56 canceladas.
const ESTADO_DOC: Record<string, string> = {
  '0': 'Vigente', '1': 'Vigente',
  '12': 'Vigente con pérdida o suspensión de derechos políticos',
  '14': 'Vigente con interdicción judicial',
  '21': 'Cancelada por muerte', '22': 'Cancelada por doble cedulación',
  '23': 'Cancelada por suplantación', '24': 'Cancelada por menor de edad',
  '25': 'Cancelada por extranjería', '26': 'Cancelada por mala elaboración',
  '27': 'Cancelada por reasignación o cambio de sexo',
  '28': 'Cancelada por extranjería sin carta de naturaleza',
  '88': 'Pendiente — solicitud en reproceso', '99': 'Pendiente — en proceso de expedición',
}

// Validación exprés de la cédula. Es inmediata (no como la de antecedentes,
// que tarda un minuto) y dice si el documento está vigente. Lo que NO
// devuelve es el nombre real —a propósito, para no exponer datos del
// ciudadano—; ese sale de la consulta de antecedentes.
async function validarCedula(c: Config, documento: string) {
  const r = await llamarTD(c, '/api/v1/identity/validations', 'POST', {
    country: 'CO',
    document_data: { document_number: /^\d+$/.test(documento) ? Number(documento) : documento },
  })
  if (!r.ok || !r.body) return null
  const code = String(r.body?.data?.status_code ?? '')
  return {
    vigente: r.body?.document_status === true,
    estado: String(r.body?.data?.status ?? ESTADO_DOC[code] ?? '') || (code ? `Código ${code}` : ''),
    codigo: code,
  }
}

async function leerRaw(userId: string): Promise<any> {
  const { data } = await db.from('users').select('raw_data').eq('id', userId).single()
  return (data as any)?.raw_data ?? {}
}

async function guardarTitular(userId: string, parche: Ficha): Promise<Ficha> {
  const raw = { ...(await leerRaw(userId)) }
  const prev = raw.tusdatos ?? {}
  raw.tusdatos = { ...prev, ...parche, beneficiarios: prev.beneficiarios ?? {}, at: new Date().toISOString() }
  await db.from('users').update({ raw_data: raw }).eq('id', userId)
  return raw.tusdatos as Ficha
}

async function guardarBeneficiario(userId: string, documento: string, ficha: Ficha) {
  const raw = { ...(await leerRaw(userId)) }
  const td = { ...(raw.tusdatos ?? {}) }
  td.beneficiarios = { ...(td.beneficiarios ?? {}), [documento]: { ...(td.beneficiarios?.[documento] ?? {}), ...ficha } }
  raw.tusdatos = td
  await db.from('users').update({ raw_data: raw }).eq('id', userId)
}

// ── Traducir el resultado de TusDatos a nuestra categoría ────────────────
// 'hallazgos' ya viene calculado por TusDatos según la categorización que la
// empresa configuró en su panel. Se usa esa y no una propia: dos criterios
// para lo mismo terminan separándose y nadie sabe cuál manda.
function categoriaDe(res: any): Ficha['categoria'] {
  const h = String(res?.hallazgos ?? '').trim().toLowerCase()
  if (h.startsWith('alto')) return 'alto'
  if (h.startsWith('medio')) return 'medio'
  if (h.startsWith('bajo')) return 'bajo'
  if (h.startsWith('info')) return 'informativo'
  // Sin hallazgos: TusDatos manda cadena vacía o 'ninguno'. Que no haya nada
  // que reportar ES un resultado, y favorable.
  if (res?.hallazgo === false) return 'ninguno'
  return undefined
}

// El veredicto. Solo se niega con una categoría explícita — nunca por falta
// de información.
function operableDe(cat: Ficha['categoria'], c: Config): boolean | undefined {
  if (cat === 'alto') return false
  if (cat === 'medio') return c.soloBloquearAlto ? true : false
  if (cat === 'bajo' || cat === 'ninguno' || cat === 'informativo') return true
  return undefined
}

// ── Lanzar la consulta ───────────────────────────────────────────────────
// Cada lanzamiento en producción GASTA UN CRÉDITO, así que no se relanza un
// documento consultado hace poco: TusDatos ya devuelve lo previo sin cobrar
// cuando force es false, pero ni siquiera vale la pena preguntar.
async function lanzar(c: Config, d: { documento: string; tipoDocumento: string; nombre?: string; fechaExpedicion?: string; referencia: string }) {
  const tipo = (d.tipoDocumento || 'CC').toUpperCase()
  const cuerpo: Record<string, unknown> = {
    doc: /^\d+$/.test(d.documento) ? Number(d.documento) : d.documento,
    typedoc: tipo,
    force: false,
    webhook_reference: d.referencia.slice(0, 250),
  }
  // El nombre es obligatorio para pasaporte e internacional, y para NOMBRE el
  // documento ES el nombre.
  if (d.nombre && (tipo === 'PP' || tipo === 'INT' || tipo === 'NOMBRE')) cuerpo.name = d.nombre
  // La fecha de expedición es obligatoria en CE y PPT; en CC habilita fuentes
  // adicionales y permite validar que coincida con el documento.
  if (d.fechaExpedicion) cuerpo.fechaE = d.fechaExpedicion
  return await llamarTD(c, '/api/launch', 'POST', cuerpo)
}

// ── Recoger el resultado ─────────────────────────────────────────────────
// 200 = finalizado · 207 = procesando · 404 = el job expiró (2 h) · 500 = falló.
async function recoger(c: Config, jobid: string): Promise<{ estado: string; res: any; status: number }> {
  const r = await llamarTD(c, `/api/results/${encodeURIComponent(jobid)}`, 'GET')
  if (r.status === 207) return { estado: 'procesando', res: r.body, status: 207 }
  if (r.status === 404) return { estado: 'expirado', res: r.body, status: 404 }
  if (!r.ok) return { estado: 'error', res: r.body ?? { detalle: r.texto }, status: r.status }
  return { estado: String(r.body?.estado ?? 'finalizado'), res: r.body, status: r.status }
}

// El reporte JSON trae el detalle por severidad y los CÓDIGOS de cada
// hallazgo. Se guardan los códigos y no el texto: TusDatos avisa que el texto
// puede cambiar sin aviso y el código es estable.
async function detalle(c: Config, reportId: string) {
  const r = await llamarTD(c, `/api/report_json/${encodeURIComponent(reportId)}`, 'GET')
  if (!r.ok || !r.body) return null
  const d = r.body?.dict_hallazgos ?? {}
  const codigos = (arr: any): string[] => Array.isArray(arr) ? arr.map((x: any) => String(x?.codigo ?? '')).filter(Boolean) : []
  return {
    altos: Array.isArray(d.altos) ? d.altos.length : 0,
    medios: Array.isArray(d.medios) ? d.medios.length : 0,
    bajos: Array.isArray(d.bajos) ? d.bajos.length : 0,
    codigos: [...codigos(d.altos), ...codigos(d.medios), ...codigos(d.bajos)].slice(0, 60),
    fuentesConError: Array.isArray(r.body?.errores) ? r.body.errores.map((x: any) => String(x)).slice(0, 30) : [],
    crudo: r.body,
  }
}

// ── Enviarle a Kumplo el resultado y el PDF ──────────────────────────────
// Al revés de como estaba: la consulta la hacemos nosotros y el expediente de
// Kumplo se alimenta de ella. El PDF va por URL y no incrustado — TusDatos lo
// sirve autenticado y mandar megas en base64 por esta función es pedir un
// tiempo de espera agotado.
async function enviarAKumplo(c: Config, ficha: Ficha, empresaId: string, crudo: unknown) {
  if (!c.enviarAKumplo || !KUMPLO_KEY || !c.kumploBaseUrl || !c.kumploRutaResultado) return { ok: false, motivo: 'envío a Kumplo apagado o sin configurar' }
  const url = `${c.kumploBaseUrl.replace(/\/+$/, '')}${c.kumploRutaResultado.startsWith('/') ? '' : '/'}${c.kumploRutaResultado}`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KUMPLO_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresa: empresaId,
        fuente: 'tusdatos',
        documento: ficha.documento,
        tipoDocumento: ficha.tipoDocumento,
        nombre: ficha.nombre,
        categoria: ficha.categoria,
        operable: ficha.operable,
        validado: ficha.validado,
        hallazgos: { altos: ficha.altos ?? 0, medios: ficha.medios ?? 0, bajos: ficha.bajos ?? 0, codigos: ficha.codigos ?? [] },
        reportId: ficha.reportId,
        pdfUrl: ficha.pdfUrl,
        consultadoEn: ficha.at,
        detalle: crudo,
      }),
    })
    const t = await r.text()
    return { ok: r.ok, status: r.status, respuesta: t.slice(0, 400) }
  } catch (e) {
    return { ok: false, status: 0, respuesta: String((e as Error)?.message ?? e) }
  }
}

// ── Cerrar una consulta: recoger, traducir, guardar, avisar a Kumplo ─────
async function cerrar(c: Config, userId: string, jobid: string, doc: string, esBeneficiario: boolean): Promise<Ficha> {
  const { estado, res } = await recoger(c, jobid)

  if (estado === 'procesando') {
    const parche: Ficha = { documento: doc, jobid, estado: 'procesando' }
    if (esBeneficiario) await guardarBeneficiario(userId, doc, parche); else await guardarTitular(userId, parche)
    return parche
  }
  if (estado !== 'finalizado') {
    // Un job expirado o fallido NO es un veredicto: se anota y se deja sin
    // operable, para que nadie quede bloqueado por un problema técnico.
    const parche: Ficha = { documento: doc, jobid, estado: estado === 'expirado' ? 'expirado' : 'error', detalle: String(res?.estado ?? ''), at: new Date().toISOString() }
    if (esBeneficiario) await guardarBeneficiario(userId, doc, parche); else await guardarTitular(userId, parche)
    await auditar('tusdatos.consulta_fallida', { userId, documento: doc, jobid, estado })
    return parche
  }

  const reportId = String(res?.id ?? '')
  const validado = res?.validado === true
  let cat = categoriaDe(res)
  // Un documento que la Registraduría no validó no se puede categorizar: no
  // se sabe de quién son los antecedentes. No bloquea, pero se marca.
  if (!validado && !cat) cat = 'sin_validar'

  const det = reportId ? await detalle(c, reportId) : null

  // ── La identidad, antes que los antecedentes ───────────────────────────
  // De nada sirve saber que "Juan Pérez" está limpio si la cédula que
  // escribieron es de otra persona. Se compara lo inscrito contra el nombre
  // que devuelve la Registraduría, y se mira si el documento está vigente.
  const previa = esBeneficiario
    ? ((await leerRaw(userId))?.tusdatos?.beneficiarios ?? {})[doc]
    : (await leerRaw(userId))?.tusdatos
  const inscrito = String(previa?.nombreInscrito ?? previa?.nombre ?? '')
  const real = res?.nombre ? String(res.nombre) : ''
  const coincide = nombreCoincide(inscrito, real)

  const cedula = String(res?.typedoc ?? 'CC').toUpperCase() === 'CC' ? await validarCedula(c, doc) : null

  // Qué bloquea, y por qué. Se escribe el motivo: "bloqueado" sin razón
  // obliga a adivinar, y quien revisa el caso necesita saber qué mirar.
  const motivo =
    coincide === false ? `El nombre inscrito no corresponde al documento. Según la Registraduría es ${real}.`
      : cedula && cedula.vigente === false ? `El documento no está vigente: ${cedula.estado}.`
        : cat === 'alto' ? 'Hallazgos de riesgo alto.'
          : cat === 'medio' && !c.soloBloquearAlto ? 'Hallazgos de riesgo medio, en revisión de cumplimiento.'
            : ''

  const ficha: Ficha = {
    documento: doc,
    tipoDocumento: String(res?.typedoc ?? 'CC'),
    nombre: real || undefined,
    nombreInscrito: inscrito || undefined,
    nombreReal: real || undefined,
    nombreCoincide: coincide,
    documentoVigente: cedula ? cedula.vigente : undefined,
    estadoDocumento: cedula?.estado || undefined,
    bloqueo: motivo || undefined,
    jobid, reportId: reportId || undefined,
    validado,
    hallazgo: res?.hallazgo === true,
    categoria: cat,
    // Un nombre que no corresponde, o un documento cancelado, pesan más que
    // la categoría: no se sabe a quién se le está transfiriendo.
    operable: (coincide === false || cedula?.vigente === false) ? false : operableDe(cat, c),
    estado: 'finalizado',
    altos: det?.altos ?? 0,
    medios: det?.medios ?? 0,
    bajos: det?.bajos ?? 0,
    codigos: det?.codigos ?? [],
    fuentesConError: det?.fuentesConError ?? [],
    pdfUrl: reportId ? `${c.baseUrl.replace(/\/+$/, '')}/api/v2/report_pdf/${reportId}` : undefined,
    at: new Date().toISOString(),
  }

  if (esBeneficiario) await guardarBeneficiario(userId, doc, ficha); else await guardarTitular(userId, ficha)
  await auditar('tusdatos.consulta', { userId, documento: doc, categoria: cat, operable: ficha.operable, validado, reportId })

  // Y se le manda a Kumplo, que es lo que se invirtió: el expediente de allá
  // se alimenta de nuestra consulta.
  if (c.enviarAKumplo) {
    const raw = await leerRaw(userId)
    const empresaId = String(raw?.kumplo?.empresaId ?? '')
    if (empresaId) {
      const env = await enviarAKumplo(c, ficha, empresaId, det?.crudo ?? res)
      await auditar('tusdatos.enviado_a_kumplo', { userId, documento: doc, ok: env.ok, status: (env as any).status ?? null, respuesta: (env as any).respuesta ?? env.motivo })
      if (env.ok) {
        if (esBeneficiario) await guardarBeneficiario(userId, doc, { enviadoAKumplo: true })
        else await guardarTitular(userId, { enviadoAKumplo: true })
      }
    }
  }
  return ficha
}

// Lanza y, si alcanza, recoge. Si no, queda 'procesando' y lo recoge el
// webhook o la siguiente vuelta.
async function consultar(
  c: Config, userId: string, d: { documento: string; tipoDocumento: string; nombre?: string; fechaExpedicion?: string },
  esBeneficiario: boolean,
): Promise<{ ok: boolean; ficha?: Ficha; error?: string; message?: string }> {
  const doc = String(d.documento ?? '').replace(/[.,\s]/g, '').trim()
  if (!doc) return { ok: false, error: 'sin_documento', message: 'Falta el número de documento.' }

  const r = await lanzar(c, { ...d, documento: doc, referencia: `${userId}:${doc}` })

  // 403 = el titular no autorizó la consulta de su información. No es un
  // fallo nuestro ni un veredicto en contra: es un derecho suyo.
  if (r.status === 403) {
    const ficha: Ficha = { documento: doc, estado: 'sin_autorizacion', detalle: 'El titular no autoriza la consulta de su información.', at: new Date().toISOString() }
    if (esBeneficiario) await guardarBeneficiario(userId, doc, ficha); else await guardarTitular(userId, ficha)
    await auditar('tusdatos.sin_autorizacion', { userId, documento: doc })
    return { ok: true, ficha }
  }
  if (!r.ok) {
    await auditar('tusdatos.launch_fallido', { userId, documento: doc, status: r.status, detalle: r.texto })
    return { ok: false, error: 'launch_fallido', message: `TusDatos respondió ${r.status}: ${r.texto}` }
  }

  const jobid = String(r.body?.jobid ?? '')
  if (!jobid) return { ok: false, error: 'sin_jobid', message: 'TusDatos no devolvió un jobid.' }

  const inicial: Ficha = {
    documento: doc, tipoDocumento: (d.tipoDocumento || 'CC').toUpperCase(),
    nombre: r.body?.nombre ? String(r.body.nombre) : d.nombre,
    // Se guarda lo que ESCRIBIÓ el titular, separado de lo que diga el
    // documento. Sin guardarlo, al llegar el resultado ya no hay contra qué
    // comparar: el nombre real habría pisado al inscrito y la validación de
    // identidad se volvería una comparación de algo consigo mismo.
    nombreInscrito: d.nombre ? String(d.nombre) : undefined,
    jobid, validado: r.body?.validado === true, estado: 'procesando', at: new Date().toISOString(),
  }
  if (esBeneficiario) await guardarBeneficiario(userId, doc, inicial); else await guardarTitular(userId, inicial)

  return { ok: true, ficha: inicial }
}

// ── Estado del PROVEEDOR (status.tusdatos.co) ────────────────────────────
// Es distinto de nuestro healthcheck: uno dice si NOSOTROS llegamos con
// nuestra credencial; este dice si las fuentes oficiales están arriba. Una
// credencial perfecta y la Registraduría caída dan consultas incompletas, y
// sin esta pantalla eso se ve como "la integración falla".
//
// Se consulta DESDE EL SERVIDOR y se guarda: el navegador no puede por CORS,
// y preguntar en cada carga del panel sería golpearles la página.
const STATUS_KEY = 'tusdatos_status'
const STATUS_TTL_MS = 5 * 60_000

// Las páginas de estado suelen ser Statuspage o Instatus, y cada una expone
// su resumen en una ruta distinta. Se prueban en orden en vez de fijar una:
// si cambian de proveedor, esto sigue funcionando.
const RUTAS_STATUS = [
  'https://status.tusdatos.co/api/v2/summary.json',
  'https://status.tusdatos.co/summary.json',
  'https://status.tusdatos.co/api/v2/status.json',
]

function interpretarStatus(b: any): { global: string; componentes: any[] } | null {
  if (!b || typeof b !== 'object') return null
  // Statuspage: { status: { indicator, description }, components: [...] }
  // Instatus:   { page: {...}, activeIncidents, components: [...] }
  const ind = String(b?.status?.indicator ?? b?.page?.status ?? '').toLowerCase()
  const comps = Array.isArray(b?.components) ? b.components : []
  const norm = (s: string) => {
    const x = String(s ?? '').toLowerCase()
    if (/operational|up|none|operativo/.test(x)) return 'operativo'
    if (/major|critical|outage|down/.test(x)) return 'caido'
    if (/minor|degraded|partial|maintenance/.test(x)) return 'degradado'
    return 'desconocido'
  }
  const componentes = comps.map((c: any) => ({
    nombre: String(c?.name ?? '—'),
    estado: norm(c?.status),
    grupo: c?.group === true,
    padre: c?.group_id ?? null,
    id: String(c?.id ?? ''),
  }))
  let global = norm(ind)
  if (global === 'desconocido' && componentes.length) {
    global = componentes.some((c: any) => c.estado === 'caido') ? 'caido'
      : componentes.some((c: any) => c.estado === 'degradado') ? 'degradado' : 'operativo'
  }
  return { global, componentes }
}

async function leerStatusProveedor(forzar = false) {
  let guardado: any = null
  try {
    const { data } = await db.from('system_config').select('value').eq('key', STATUS_KEY).single()
    if (data?.value) guardado = JSON.parse(data.value)
  } catch { /* primera vez */ }

  const fresco = guardado?.at && (Date.now() - new Date(guardado.at).getTime()) < STATUS_TTL_MS
  if (fresco && !forzar) return { ...guardado, deCache: true }

  for (const url of RUTAS_STATUS) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      if (!r.ok) continue
      const b = await r.json().catch(() => null)
      const leido = interpretarStatus(b)
      if (!leido) continue
      const nuevo = { ...leido, url, at: new Date().toISOString(), alcanzado: true }
      await db.from('system_config').upsert({ key: STATUS_KEY, value: JSON.stringify(nuevo) }, { onConflict: 'key' })
      return nuevo
    } catch { /* siguiente ruta */ }
  }

  // No se pudo. Se devuelve lo ÚLTIMO QUE SÍ SUPIMOS, marcado como viejo. Un
  // "operativo" inventado sería peor que decir desde cuándo no hay datos.
  if (guardado) return { ...guardado, alcanzado: false, deCache: true }
  return { global: 'desconocido', componentes: [], at: null, alcanzado: false }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = new URL(req.url)

    // ── Webhook de TusDatos ───────────────────────────────────────────────
    // Nos avisan cuando una consulta individual termina, en vez de tener que
    // preguntar cada pocos segundos. Y el monitoreo continuo —que es lo que
    // de verdad importa a mediano plazo— avisa cuando alguien que salió
    // limpio aparece después en una lista.
    //
    // Se valida el secreto SIEMPRE. Un webhook abierto deja que cualquiera
    // nos escriba un veredicto, que es justo lo contrario del control.
    if (url.pathname.endsWith('/webhook')) {
      const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
      if (!TD_WEBHOOK || auth !== TD_WEBHOOK) {
        await auditar('tusdatos.webhook_rechazado', { motivo: 'credencial inválida' })
        return json({ error: 'no autorizado' }, 401)
      }
      const cuerpo = await req.json().catch(() => ({} as any))
      const evento = String(cuerpo?.event_name ?? '')
      await auditar('tusdatos.webhook', { evento, cuerpo: JSON.stringify(cuerpo).slice(0, 900) })

      const c = await leerConfig()

      // La consulta individual terminó. La referencia que mandamos al lanzar
      // —userId:documento— es la que nos dice a quién pertenece.
      if (evento === 'individualCompleted') {
        const ref = String(cuerpo?.webhook_reference ?? '')
        const [uid, doc] = ref.split(':')
        if (uid && doc) {
          const raw = await leerRaw(uid)
          const esBenef = !!raw?.tusdatos?.beneficiarios?.[doc]
          const jobid = String((esBenef ? raw.tusdatos.beneficiarios[doc] : raw?.tusdatos)?.jobid ?? '')
          if (jobid) await cerrar(c, uid, jobid, doc, esBenef)
        }
        return json({ ok: true })
      }

      // Monitoreo continuo: alguien que salió limpio apareció en una lista.
      // ESTA es la única razón para volver a consultar a alguien ya
      // consultado. Sin esto habría dos malos caminos: no volver a mirar
      // nunca —y quedarse con un veredicto viejo— o consultar cada tanto por
      // si acaso, gastando un crédito por persona cada vez.
      //
      // Se relanza para TODA cuenta que tenga a esa persona inscrita: el
      // mismo beneficiario puede estar en varias.
      if (evento === 'pepsMonitoring') {
        const dd = cuerpo?.data?.data ?? {}
        const doc = String(dd?.doc ?? '').replace(/\D/g, '')
        await auditar('tusdatos.monitoreo_alerta', {
          documento: doc, nombre: String(dd?.nombre ?? ''),
          hallazgos: JSON.stringify(dd?.hallazgos ?? []).slice(0, 600),
        })
        if (doc && c.activo) {
          const { data: filas } = await db
            .from('users').select('id, raw_data').not('raw_data->tusdatos', 'is', null).limit(2000)
          let relanzadas = 0
          for (const u of (filas ?? []) as any[]) {
            const td = u.raw_data?.tusdatos ?? {}
            const esBenef = !!(td.beneficiarios ?? {})[doc]
            const esTitular = String(td.documento ?? '') === doc
            if (!esBenef && !esTitular) continue
            const f = esBenef ? td.beneficiarios[doc] : td
            const r = await consultar(c, u.id, {
              documento: doc,
              tipoDocumento: String(f?.tipoDocumento ?? 'CC'),
              nombre: f?.nombreInscrito ?? f?.nombre ?? undefined,
            }, esBenef)
            if (r.ok) relanzadas += 1
            if (relanzadas >= 10) break   // el resto, en la siguiente alerta
          }
          await auditar('tusdatos.monitoreo_relanzado', { documento: doc, cuentas: relanzadas })
        }
        return json({ ok: true })
      }

      return json({ ok: true, ignorado: evento })
    }

    const body = await req.json().catch(() => ({} as any))
    const accion = String(body.action ?? '')
    const yo = await quienLlama(req)

    // ── Configuración (solo admin) ───────────────────────────────────────
    if (accion === 'config_get') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      return json({ ok: true, config: await leerConfig(), credencial: hayCredencial() ? 'configurada' : 'falta', webhook: TD_WEBHOOK ? 'configurado' : 'falta' })
    }

    if (accion === 'config_set') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const previa = await leerConfig()
      const c = { ...previa, ...(body.config ?? {}) } as Config
      if (c.activo && (!c.baseUrl || !hayCredencial())) {
        return json({ error: 'Faltan datos para encender: la dirección base y las credenciales en la Bóveda.' }, 400)
      }

      // BAJAR una protección pide confirmar la identidad; subirla no. Cuentan
      // como bajarla: apagar la verificación, dejar de frenar los envíos, o
      // pasar a bloquear solo el riesgo alto — las tres dejan pasar cosas que
      // antes se frenaban. Un panel abierto un minuto en un escritorio ajeno
      // alcanza para apagar el control de lavado de activos.
      const aflojando =
        (previa.activo && c.activo === false) ||
        (previa.bloquear !== false && c.bloquear === false) ||
        (!previa.soloBloquearAlto && c.soloBloquearAlto === true)

      if (aflojando && yo.userId) {
        const falta = await faltaVerificar(req, yo.userId)
        if (falta.length) {
          await auditar('tusdatos.config_bloqueada', { por: yo.userId, falta })
          return json({
            error: 'verificacion_requerida', falta,
            message: falta.includes('email') && falta.includes('app')
              ? 'Para bajar esta protección hay que confirmar el código del correo y el de la app.'
              : falta.includes('app')
                ? 'Para bajar esta protección hay que confirmar el código de la app.'
                : 'Para bajar esta protección hay que confirmar el código que llega al correo.',
          }, 403)
        }
      }

      await guardarConfig(c)
      await auditar('tusdatos.config', {
        activo: c.activo, bloquear: c.bloquear, soloBloquearAlto: c.soloBloquearAlto,
        aflojando, baseUrl: c.baseUrl, por: yo.userId,
      })
      return json({ ok: true, config: c, credencial: hayCredencial() ? 'configurada' : 'falta' })
    }

    // Probar: consulta el plan. Es la llamada más barata que confirma que la
    // credencial pasa y que se llega — no gasta créditos de consulta.
    if (accion === 'probar') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!hayCredencial()) return json({ ok: false, motivo: 'Faltan las credenciales de TusDatos en la Bóveda.' })
      const r = await llamarTD(c, '/api/plans?exclude=checks', 'GET')
      if (r.status === 0) return json({ ok: false, status: 0, url: r.url, motivo: `No se pudo contactar a TusDatos. Revisa la dirección base. (${r.texto})` })
      if (r.status === 401 || r.status === 403) return json({ ok: false, status: r.status, url: r.url, motivo: `TusDatos rechazó la credencial (${r.status}). Revisa el usuario y la contraseña, o el token, en la Bóveda.` })
      if (r.ok) {
        const saldo = r.body?.amount
        return json({ ok: true, status: r.status, url: r.url, motivo: `Conexión y credencial correctas.${typeof saldo === 'number' ? ` Consultas disponibles en el plan: ${saldo}.` : ''}`, plan: r.body })
      }
      return json({ ok: false, status: r.status, url: r.url, motivo: `TusDatos respondió ${r.status}: ${r.texto}` })
    }

    // ── Consultar al TITULAR ─────────────────────────────────────────────
    if (accion === 'verificar') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'la integración está apagada' })
      if (!enLaPrueba(c, uid)) return json({ ok: true, omitido: 'esta cuenta no está en la prueba' })

      const raw = await leerRaw(uid)
      const doc = String(body.documento ?? raw?.documentNumber ?? raw?.cedula ?? '').replace(/\D/g, '')
      if (!doc) {
        const { data: u } = await db.from('users').select('document_number, name').eq('id', uid).single()
        const doc2 = String((u as any)?.document_number ?? '').replace(/\D/g, '')
        if (!doc2) return json({ ok: true, estado: await guardarTitular(uid, { estado: 'sin_documento', detalle: 'La cuenta no tiene número de documento.' }) })
        const r = await consultar(c, uid, { documento: doc2, tipoDocumento: String(raw?.documentType ?? 'CC'), nombre: String((u as any)?.name ?? ''), fechaExpedicion: body.fechaExpedicion }, false)
        return json(r.ok ? { ok: true, ficha: r.ficha } : r, r.ok ? 200 : 200)
      }
      const r = await consultar(c, uid, { documento: doc, tipoDocumento: String(body.tipoDocumento ?? raw?.documentType ?? 'CC'), nombre: body.nombre, fechaExpedicion: body.fechaExpedicion }, false)
      return json(r.ok ? { ok: true, ficha: r.ficha } : r)
    }

    // ── Consultar un BENEFICIARIO ────────────────────────────────────────
    if (accion === 'verificar_beneficiario') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'la integración está apagada' })
      if (!enLaPrueba(c, uid)) return json({ ok: true, omitido: 'esta cuenta no está en la prueba' })
      const r = await consultar(c, uid, {
        documento: String(body.documento ?? ''),
        tipoDocumento: String(body.tipoDocumento ?? 'CC'),
        nombre: body.nombre ? String(body.nombre) : undefined,
        fechaExpedicion: body.fechaExpedicion ? String(body.fechaExpedicion) : undefined,
      }, true)
      return json(r.ok ? { ok: true, beneficiario: r.ficha } : r)
    }

    // ── Recoger resultados que quedaron procesando ───────────────────────
    // El webhook es el camino principal; esto es el respaldo, por si un envío
    // se pierde. Sin respaldo, una consulta perdida deja a alguien en
    // «verificando» para siempre.
    if (accion === 'recoger_pendientes') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'la integración está apagada', pendientes: 0 })

      const raw = await leerRaw(uid)
      const td = raw?.tusdatos ?? {}
      let cerrados = 0
      if (td.jobid && td.estado === 'procesando') {
        const f = await cerrar(c, uid, td.jobid, String(td.documento ?? ''), false)
        if (f.estado === 'finalizado') cerrados += 1
      }
      const benefs: Record<string, any> = td.beneficiarios ?? {}
      for (const [doc, f] of Object.entries(benefs)) {
        if ((f as any)?.estado !== 'procesando' || !(f as any)?.jobid) continue
        const r = await cerrar(c, uid, String((f as any).jobid), doc, true)
        if (r.estado === 'finalizado') cerrados += 1
        if (cerrados >= 6) break   // el resto en la siguiente vuelta
      }
      const despues = (await leerRaw(uid))?.tusdatos ?? {}
      const pend = Object.values(despues.beneficiarios ?? {}).filter((x: any) => x?.estado === 'procesando').length
        + (despues.estado === 'procesando' ? 1 : 0)
      return json({ ok: true, cerrados, pendientes: pend })
    }

    // ── Lanzar las que FALTAN, por lotes ─────────────────────────────────
    if (accion === 'verificar_pendientes') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'la integración está apagada', pendientes: 0 })
      if (!enLaPrueba(c, uid)) return json({ ok: true, omitido: 'esta cuenta no está en la prueba', pendientes: 0 })

      const raw = await leerRaw(uid)
      const contactos: any[] = Array.isArray(raw.mouvContacts) ? raw.mouvContacts : []
      const hechos: Record<string, any> = (raw.tusdatos ?? {}).beneficiarios ?? {}

      const vistos = new Set<string>()
      const faltan = contactos.filter((x: any) => {
        const doc = String(x?.docNumber ?? '').replace(/\D/g, '')
        if (!doc || hechos[doc] || vistos.has(doc)) return false
        vistos.add(doc)
        return true
      })

      // CADA LANZAMIENTO GASTA UN CRÉDITO del plan. El lote va chico a
      // propósito: si algo está mal configurado, se pierden cuatro consultas,
      // no sesenta.
      const LOTE = Math.min(Math.max(Number(body.limite ?? 4) || 4, 1), 8)
      let lanzados = 0
      for (const x of faltan.slice(0, LOTE)) {
        const r = await consultar(c, uid, {
          documento: String(x?.docNumber ?? ''),
          tipoDocumento: String(x?.docType ?? 'CC'),
          nombre: String(x?.name ?? ''),
        }, true)
        if (r.ok) lanzados += 1
      }
      // Y de paso se recogen las que ya hayan terminado.
      return json({ ok: true, lanzados, pendientes: Math.max(0, faltan.length - lanzados) })
    }

    // ── Lo guardado ──────────────────────────────────────────────────────
    if (accion === 'estado') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      const raw = await leerRaw(uid)
      const td = raw?.tusdatos ?? {}
      return json({
        ok: true, activo: c.activo, enLaPrueba: enLaPrueba(c, uid),
        titular: { ...td, beneficiarios: undefined },
        beneficiarios: td.beneficiarios ?? {},
      })
    }

    // ── El PDF del reporte ───────────────────────────────────────────────
    // Se devuelve en base64 porque TusDatos lo sirve autenticado: un enlace
    // directo no abriría desde el navegador sin la credencial, y la
    // credencial no sale de acá.
    if (accion === 'pdf') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const reportId = String(body.reportId ?? '').trim()
      if (!reportId) return json({ error: 'Falta el id del reporte.' }, 400)
      const c = await leerConfig()
      const r = await fetch(`${c.baseUrl.replace(/\/+$/, '')}/api/v2/report_pdf/${encodeURIComponent(reportId)}`, {
        headers: { Authorization: cabeceraAuth() },
      })
      // 202 = todavía se está armando. Ellos piden reintentar a los 10 s.
      if (r.status === 202) return json({ ok: false, enProceso: true, motivo: 'El PDF todavía se está generando. Vuelve a intentar en unos segundos.' })
      if (!r.ok) return json({ ok: false, motivo: `TusDatos respondió ${r.status} al pedir el PDF.` })
      const buf = new Uint8Array(await r.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192))
      return json({ ok: true, pdf: btoa(bin), nombre: `antecedentes-${reportId}.pdf` })
    }

    // ── Reenviar a Kumplo a mano ─────────────────────────────────────────
    if (accion === 'enviar_kumplo') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      const raw = await leerRaw(uid)
      const empresaId = String(raw?.kumplo?.empresaId ?? '')
      if (!empresaId) return json({ ok: false, motivo: 'Esta cuenta no tiene conectada su empresa de Kumplo.' })
      const doc = String(body.documento ?? '').replace(/\D/g, '')
      const ficha: Ficha = doc ? (raw?.tusdatos?.beneficiarios ?? {})[doc] : raw?.tusdatos
      if (!ficha?.reportId) return json({ ok: false, motivo: 'Todavía no hay un reporte para enviar.' })
      const env = await enviarAKumplo(c, ficha, empresaId, null)
      await auditar('tusdatos.enviado_a_kumplo', { userId: uid, documento: doc || ficha.documento, ok: env.ok, manual: true })
      return json(env)
    }

    // ── Compliance: los casos que hay que mirar ──────────────────────────
    // Un veredicto guardado en el perfil de cada usuario no sirve de nada si
    // nadie lo ve. Acá se juntan TODOS los beneficiarios de TODAS las
    // cuentas y se separan los que piden atención de los que están en orden.
    //
    // El orden importa: primero lo que ya está bloqueando una operación,
    // después lo que está a la espera. Una bandeja donde lo urgente aparece
    // mezclado con lo rutinario se deja de revisar en una semana.
    if (accion === 'compliance') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const { data: filas } = await db
        .from('users')
        .select('id, name, email, raw_data')
        .not('raw_data->tusdatos', 'is', null)
        .limit(2000)

      const casos: any[] = []
      for (const u of (filas ?? []) as any[]) {
        const td = u.raw_data?.tusdatos ?? {}
        const benefs: Record<string, any> = td.beneficiarios ?? {}
        // El titular también se revisa: no solo a quien recibe.
        const todos: [string, any][] = [
          ...(td.documento ? [[String(td.documento), { ...td, beneficiarios: undefined, esTitular: true }] as [string, any]] : []),
          ...Object.entries(benefs),
        ]
        for (const [doc, f] of todos) {
          if (!f || typeof f !== 'object') continue
          const cat = String(f.categoria ?? '')
          const est = String(f.estado ?? '')
          // Qué merece la atención de un humano.
          const alerta =
            f.nombreCoincide === false ? 'nombre_no_coincide'
              : f.documentoVigente === false ? 'documento_no_vigente'
                : cat === 'alto' ? 'riesgo_alto'
                  : cat === 'medio' ? 'riesgo_medio'
                    : cat === 'sin_validar' ? 'sin_validar'
                      : est === 'sin_autorizacion' ? 'sin_autorizacion'
                        : est === 'procesando' ? 'en_curso'
                          : est !== 'finalizado' && est ? 'consulta_fallida'
                            : null
          casos.push({
            userId: u.id, titular: u.name ?? u.email ?? u.id, esTitular: !!f.esTitular,
            documento: doc, tipoDocumento: f.tipoDocumento ?? 'CC',
            nombreInscrito: f.nombreInscrito ?? null, nombreReal: f.nombreReal ?? f.nombre ?? null,
            nombreCoincide: f.nombreCoincide ?? null,
            documentoVigente: f.documentoVigente ?? null, estadoDocumento: f.estadoDocumento ?? null,
            categoria: cat || null, estado: est || null, operable: f.operable ?? null,
            bloqueo: f.bloqueo ?? null,
            altos: f.altos ?? 0, medios: f.medios ?? 0, bajos: f.bajos ?? 0,
            reportId: f.reportId ?? null, enviadoAKumplo: !!f.enviadoAKumplo,
            at: f.at ?? null, alerta,
          })
        }
      }

      const peso: Record<string, number> = {
        nombre_no_coincide: 0, documento_no_vigente: 1, riesgo_alto: 2, riesgo_medio: 3,
        sin_validar: 4, consulta_fallida: 5, sin_autorizacion: 6, en_curso: 7,
      }
      const conAlerta = casos.filter(x => x.alerta).sort((a, b) =>
        (peso[a.alerta] ?? 9) - (peso[b.alerta] ?? 9) || String(b.at ?? '').localeCompare(String(a.at ?? '')))
      const enOrden = casos.filter(x => !x.alerta)

      return json({
        ok: true,
        resumen: {
          total: casos.length,
          bloqueados: casos.filter(x => x.operable === false).length,
          nombreNoCoincide: casos.filter(x => x.nombreCoincide === false).length,
          documentoNoVigente: casos.filter(x => x.documentoVigente === false).length,
          alto: casos.filter(x => x.categoria === 'alto').length,
          medio: casos.filter(x => x.categoria === 'medio').length,
          enCurso: casos.filter(x => x.estado === 'procesando').length,
          enOrden: enOrden.length,
        },
        casos: conAlerta.slice(0, 300),
        // Los que están en orden van aparte y recortados: la bandeja es para
        // lo que hay que mirar, no para el archivo.
        enOrden: enOrden.slice(0, 120),
      })
    }

    // ── Todo lo que el panel necesita, en UNA llamada ────────────────────
    // Repartido en seis peticiones, el panel se dibuja por pedazos y cada
    // tarjeta aparece cuando le toca. Una sola respuesta se pinta entera.
    if (accion === 'panel') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()

      // Ping propio, con la latencia medida. Es NUESTRO healthcheck: dice si
      // llegamos con nuestra credencial, no si las fuentes están arriba.
      let conexion: any = { ok: false, latencia: null, motivo: 'Sin credenciales en la Bóveda.' }
      if (hayCredencial() && c.baseUrl) {
        const t0 = Date.now()
        const r = await llamarTD(c, '/api/plans?exclude=checks', 'GET')
        conexion = {
          ok: r.ok, status: r.status, latencia: Date.now() - t0,
          plan: r.body ?? null,
          motivo: r.ok ? 'Operativa'
            : r.status === 0 ? 'No se pudo contactar a TusDatos.'
              : r.status === 401 || r.status === 403 ? 'Credencial rechazada.'
                : `Respondió ${r.status}.`,
        }
      }

      const proveedor = await leerStatusProveedor(body.forzarProveedor === true)

      // Las consultas guardadas, de todas las cuentas. Es la materia prima de
      // la cola, del historial y de las cifras del mes.
      const { data: filas } = await db
        .from('users').select('id, name, email, raw_data')
        .not('raw_data->tusdatos', 'is', null).limit(2000)

      const consultas: any[] = []
      for (const u of (filas ?? []) as any[]) {
        const td = u.raw_data?.tusdatos ?? {}
        const benefs: Record<string, any> = td.beneficiarios ?? {}
        const entradas: [string, any][] = [
          ...(td.documento ? [[String(td.documento), { ...td, beneficiarios: undefined, esTitular: true }] as [string, any]] : []),
          ...Object.entries(benefs),
        ]
        for (const [doc, f] of entradas) {
          if (!f || typeof f !== 'object') continue
          consultas.push({
            userId: u.id, titular: u.name ?? u.email ?? u.id, esTitular: !!f.esTitular,
            documento: doc, tipoDocumento: f.tipoDocumento ?? 'CC',
            nombre: f.nombreInscrito ?? f.nombreReal ?? f.nombre ?? null,
            categoria: f.categoria ?? null, estado: f.estado ?? null,
            operable: f.operable ?? null, nombreCoincide: f.nombreCoincide ?? null,
            documentoVigente: f.documentoVigente ?? null,
            fuentesConError: Array.isArray(f.fuentesConError) ? f.fuentesConError : [],
            reintentos: Number(f.reintentos ?? 0),
            reportId: f.reportId ?? null, jobid: f.jobid ?? null,
            manual: !!f.manual, at: f.at ?? null,
          })
        }
      }
      consultas.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))

      // La cola: lo que está esperando. Dos casos distintos y ambos cuentan —
      // la consulta que sigue corriendo, y la que terminó pero con fuentes
      // caídas, o sea con el resultado incompleto. Aprobar o rechazar con
      // datos parciales es peor que esperar.
      const cola = consultas.filter(x =>
        x.estado === 'procesando' || (x.estado === 'finalizado' && x.fuentesConError.length > 0))

      const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
      const desde30 = Date.now() - 30 * 24 * 3600_000
      const delMes = consultas.filter(x => x.at && new Date(x.at).getTime() >= desde30)
      const deHoy = consultas.filter(x => x.at && new Date(x.at).getTime() >= hoy.getTime())
      const finalizadas30 = delMes.filter(x => x.estado === 'finalizado')
      const bajo30 = finalizadas30.filter(x => x.categoria === 'bajo' || x.categoria === 'ninguno' || x.categoria === 'informativo').length

      return json({
        ok: true,
        conexion,
        credencial: hayCredencial() ? (TD_TOKEN ? 'token' : 'usuario') : 'falta',
        webhook: TD_WEBHOOK ? 'configurado' : 'falta',
        entorno: String(c.baseUrl ?? '').includes('docs.tusdatos') ? 'pruebas' : 'produccion',
        config: c,
        proveedor,
        consultasHoy: deHoy.length,
        cupo: typeof conexion?.plan?.amount === 'number' ? conexion.plan.amount : null,
        cola: cola.slice(0, 40),
        ultimas: consultas.slice(0, 12),
        mes: {
          consultas: delMes.length,
          bajoPct: finalizadas30.length ? Math.round((bajo30 / finalizadas30.length) * 1000) / 10 : null,
          enRevision: delMes.filter(x => x.categoria === 'medio' || x.nombreCoincide === false).length,
          bloqueadas: delMes.filter(x => x.operable === false).length,
        },
      })
    }

    // ── Volver a juzgar lo YA CONSULTADO, sin consultar de nuevo ─────────
    // La regla que compara el nombre inscrito con el del documento se hizo
    // más tolerante: ahora perdona tildes, la forma jurídica (S.A.S vs SAS),
    // una letra de más o de menos y dos letras intercambiadas. Pero los
    // veredictos ya guardados se calcularon con la regla vieja y siguen
    // bloqueando a gente que solo escribió distinto.
    //
    // Esto los vuelve a juzgar con los datos que YA ESTÁN guardados. No llama
    // a TusDatos y no gasta un solo crédito: el nombre real ya lo tenemos.
    if (accion === 'recalcular_nombres') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      const { data: filas } = await db
        .from('users').select('id, raw_data').not('raw_data->tusdatos', 'is', null).limit(2000)

      let revisados = 0, liberados = 0
      for (const u of (filas ?? []) as any[]) {
        const raw = { ...(u.raw_data ?? {}) }
        const td = { ...(raw.tusdatos ?? {}) }
        const benefs = { ...(td.beneficiarios ?? {}) }
        let cambio = false

        const rejuzgar = (f: any) => {
          if (!f || f.estado !== 'finalizado') return f
          const inscrito = String(f.nombreInscrito ?? '')
          const real = String(f.nombreReal ?? f.nombre ?? '')
          if (!inscrito || !real) return f
          revisados += 1
          const nuevo = nombreCoincide(inscrito, real)
          if (nuevo === f.nombreCoincide) return f
          cambio = true
          if (nuevo !== false) liberados += 1
          const motivo =
            nuevo === false ? `El nombre inscrito no corresponde a ese documento. Según la Registraduría es ${real}.`
              : f.documentoVigente === false ? `El documento no está vigente: ${f.estadoDocumento ?? ''}.`
                : f.categoria === 'alto' ? 'Hallazgos de riesgo alto.'
                  : f.categoria === 'medio' && !c.soloBloquearAlto ? 'Hallazgos de riesgo medio, en revisión de cumplimiento.'
                    : ''
          return {
            ...f, nombreCoincide: nuevo, bloqueo: motivo || undefined,
            operable: (nuevo === false || f.documentoVigente === false) ? false : operableDe(f.categoria, c),
          }
        }

        for (const [doc, f] of Object.entries(benefs)) benefs[doc] = rejuzgar(f)
        const titular = rejuzgar({ ...td, beneficiarios: undefined })
        if (cambio) {
          raw.tusdatos = { ...td, ...titular, beneficiarios: benefs }
          await db.from('users').update({ raw_data: raw }).eq('id', u.id)
        }
      }
      await auditar('tusdatos.recalculo_nombres', { por: yo.userId, revisados, liberados })
      return json({ ok: true, revisados, liberados })
    }

    // ── Consulta manual ──────────────────────────────────────────────────
    // Un documento suelto, sin inscribir beneficiario. Queda marcada como
    // manual y con quién la hizo: una consulta a una persona gasta un crédito
    // y toca datos suyos, así que tiene que quedar claro quién la pidió.
    if (accion === 'consulta_manual') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: false, motivo: 'La integración está apagada.' })
      if (!hayCredencial()) return json({ ok: false, motivo: 'Faltan las credenciales en la Bóveda.' })
      const uid = String(body.userId ?? yo.userId ?? '')
      const r = await consultar(c, uid, {
        documento: String(body.documento ?? ''),
        tipoDocumento: String(body.tipoDocumento ?? 'CC'),
        nombre: body.nombre ? String(body.nombre) : undefined,
        fechaExpedicion: body.fechaExpedicion ? String(body.fechaExpedicion) : undefined,
      }, true)
      if (!r.ok) return json({ ok: false, motivo: r.message ?? 'No se pudo lanzar la consulta.' })
      const doc = String(body.documento ?? '').replace(/\D/g, '')
      await guardarBeneficiario(uid, doc, { manual: true } as any)
      await auditar('tusdatos.consulta_manual', { por: yo.userId, documento: doc })
      // Se espera un poco y se recoge: para una consulta a mano vale la pena,
      // porque hay alguien mirando la pantalla.
      await new Promise(res => setTimeout(res, 8000))
      const fin = await cerrar(c, uid, String(r.ficha?.jobid ?? ''), doc, true)
      return json({ ok: true, ficha: fin })
    }

    // ── Reintentar una consulta ──────────────────────────────────────────
    if (accion === 'reintentar') {
      if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      const uid = String(body.userId ?? '')
      const doc = String(body.documento ?? '').replace(/\D/g, '')
      if (!uid || !doc) return json({ error: 'Falta el cliente o el documento.' }, 400)
      const raw = await leerRaw(uid)
      const f = (raw?.tusdatos?.beneficiarios ?? {})[doc] ?? (String(raw?.tusdatos?.documento ?? '') === doc ? raw.tusdatos : null)
      const esBenef = !!(raw?.tusdatos?.beneficiarios ?? {})[doc]

      // Si todavía hay un job vivo, se relee en vez de relanzar: relanzar
      // gasta un crédito y no adelanta nada.
      if (f?.jobid && f?.estado === 'procesando') {
        const fin = await cerrar(c, uid, String(f.jobid), doc, esBenef)
        return json({ ok: true, ficha: fin, releido: true })
      }
      const r = await consultar(c, uid, {
        documento: doc, tipoDocumento: String(f?.tipoDocumento ?? 'CC'),
        nombre: f?.nombreInscrito ?? f?.nombre ?? undefined,
      }, esBenef)
      if (r.ok) {
        const previos = Number(f?.reintentos ?? 0) + 1
        if (esBenef) await guardarBeneficiario(uid, doc, { reintentos: previos } as any)
        await auditar('tusdatos.reintento', { por: yo.userId, userId: uid, documento: doc, intento: previos })
      }
      return json(r.ok ? { ok: true, ficha: r.ficha } : { ok: false, motivo: r.message })
    }

    // ── Diagnóstico ──────────────────────────────────────────────────────
    if (accion === 'diagnostico') {
      const uid = String(body.userId ?? yo.userId ?? '')
      if (!uid || (!yo.esAdmin && yo.userId !== uid)) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      const raw = await leerRaw(uid)
      const contactos: any[] = Array.isArray(raw.mouvContacts) ? raw.mouvContacts : []
      const hechos = (raw.tusdatos ?? {}).beneficiarios ?? {}
      const pasos = [
        { paso: 'Credenciales en la Bóveda', ok: hayCredencial(), detalle: hayCredencial() ? (TD_TOKEN ? 'Token puesto.' : 'Usuario y contraseña puestos.') : 'FALTAN. Sin ellas no se puede consultar.' },
        { paso: 'Dirección base', ok: !!c.baseUrl, detalle: `${c.baseUrl || '—'} ${c.baseUrl.includes('docs.tusdatos') ? '(ambiente de PRUEBAS: respuestas estáticas, no gasta créditos)' : '(producción: gasta créditos)'}` },
        { paso: 'Integración encendida', ok: !!c.activo, detalle: c.activo ? 'Encendida.' : 'APAGADA. No se consulta a nadie.' },
        { paso: 'Cuenta dentro de la prueba', ok: enLaPrueba(c, uid), detalle: enLaPrueba(c, uid) ? 'Incluida.' : 'FUERA. La lista de cuentas no la incluye.' },
        { paso: 'Webhook configurado', ok: !!TD_WEBHOOK, detalle: TD_WEBHOOK ? 'Secreto puesto. Los resultados llegan solos.' : 'Sin secreto: los resultados hay que ir a buscarlos.' },
        { paso: 'Beneficiarios', ok: contactos.length > 0, detalle: `${contactos.length} inscritos · ${Object.keys(hechos).length} con resultado.` },
      ]
      const corte = pasos.find(p => !p.ok)
      let plan: any = null
      if (hayCredencial() && c.baseUrl) {
        const r = await llamarTD(c, '/api/plans?exclude=checks', 'GET')
        plan = { status: r.status, ok: r.ok, respuesta: JSON.stringify(r.body ?? r.texto).slice(0, 400) }
      }
      return json({ ok: true, pasos, corte: corte ? `${corte.paso}: ${corte.detalle}` : null, plan })
    }

    return json({ error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
