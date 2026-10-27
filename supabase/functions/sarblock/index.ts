// ════════════════════════════════════════════════════════
// sarblock — verificación de antecedentes de beneficiarios con Sarblock.
//
// QUÉ HACE
//   Reemplaza, de forma progresiva, a la función `tusdatos`. Responde las
//   MISMAS acciones que la pantalla de Beneficiarios le pide a TusDatos
//   (estado, verificar_beneficiario, verificar_pendientes,
//   recoger_pendientes, hallazgos, archivar_beneficiario) y escribe la ficha
//   con la MISMA forma y en el MISMO lugar:
//   raw_data.tusdatos.beneficiarios[documento]. Así el bloqueo del envío
//   (mouv-proxy), la insignia, el detalle, el modal KYC y Siigo siguen
//   funcionando sin cambios. La ficha lleva `proveedor: 'sarblock'` y el
//   catálogo completo de la consulta, del que sale el PDF con marca Lincoin.
//
// EL VEREDICTO
//   Sarblock solo bloquea por listas restrictivas. Encima de su resultado se
//   aplica la matriz de riesgo de Lincoin (traductor.ts → reglasLincoin):
//   proceso penal como parte pasiva, antecedentes de Policía/Procuraduría/
//   Contraloría o prensa grave también bloquean. Gana el más estricto.
//
// TRANSICIÓN
//   Arranca APAGADA (system_config.sarblock_config). Mientras esté apagada,
//   o la cuenta no esté en `soloEstosUsuarios`, la pantalla sigue usando
//   TusDatos. Las fichas que ya hizo TusDatos se siguen leyendo; no se
//   vuelve a consultar a nadie (cada consulta cuesta un crédito).
//
// LA CREDENCIAL
//   SARBLOCK_ORG_API_KEY (sb_org_…) en los secrets. Nunca sale de acá.
//
// Lo que cobra: crear un check. Leerlo, reintentar fuentes caídas y releer
// las que quedaron "en curso" es gratis.
// ════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { setRawPath } from '../_shared/raw-data.ts'
import { requireMfaSession, igualSeguro } from '../_shared/admin-auth.ts'
import { traeSecretoDeLaBase } from '../_shared/webhook-auth.ts'
import { ClienteSarblock, ErrorSarblock, sujetoDe, saldoScreening, claveIdempotencia } from './cliente.ts'
import { traducir, fichaLanzada, terminado, hayQueReintentar, releerFicha } from './traductor.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SB_KEY = Deno.env.get('SARBLOCK_ORG_API_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ── Configuración ───────────────────────────────────────────────────────
const CONFIG_KEY = 'sarblock_config'
type Config = {
  activo: boolean
  // Ids de cuentas en la prueba. Vacío = todas.
  soloEstosUsuarios: string[]
  // Las mismas perillas que lee mouv-proxy para el riesgo medio.
  bloquear: boolean
  soloBloquearAlto: boolean
  // Consultas PAGADAS por cuenta y por día.
  topeDiario: number
}
const POR_DEFECTO: Config = { activo: false, soloEstosUsuarios: [], bloquear: true, soloBloquearAlto: false, topeDiario: 200 }

async function leerConfig(): Promise<Config> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
    return data?.value ? { ...POR_DEFECTO, ...JSON.parse(data.value) } : POR_DEFECTO
  } catch { return POR_DEFECTO }
}
const enLaPrueba = (c: Config, uid: string) => !c.soloEstosUsuarios?.length || c.soloEstosUsuarios.includes(uid)

async function auditar(action: string, metadata: Record<string, unknown>) {
  try { await db.from('audit_log').insert({ action, metadata }) } catch { /* nunca frena la consulta */ }
}

// ── Quién llama ─────────────────────────────────────────────────────────
type Yo = { userId: string | null; esAdmin: boolean; servicio?: boolean }
async function quienLlama(req: Request): Promise<Yo> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { userId: null, esAdmin: false }
  if (SERVICE_KEY && igualSeguro(jwt, SERVICE_KEY)) return { userId: null, esAdmin: true, servicio: true }
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    if (!user) return { userId: null, esAdmin: false }
    const { data } = await db.from('users').select('role').eq('id', user.id).single()
    return { userId: user.id, esAdmin: (data as any)?.role === 'admin' }
  } catch { return { userId: null, esAdmin: false } }
}
// Las acciones de administración exigen la sesión con segundo factor, igual
// que admin-data y tusdatos.
async function exigirAdmin(req: Request, yo: Yo): Promise<Response | null> {
  if (!yo.esAdmin) return json({ error: 'No autorizado' }, 401)
  if (yo.servicio) return null
  const mfa = await requireMfaSession(db, req, yo.userId)
  return mfa ? json({ error: mfa }, 403) : null
}

// ── La ficha ────────────────────────────────────────────────────────────
async function leerRaw(uid: string): Promise<any> {
  const { data } = await db.from('users').select('raw_data').eq('id', uid).single()
  return (data as any)?.raw_data ?? {}
}
// Solo ESTE beneficiario, en su ruta y bajo bloqueo de fila.
async function guardarFicha(uid: string, doc: string, ficha: Record<string, unknown>) {
  if (!uid || !doc) return
  await setRawPath(db, uid, ['tusdatos', 'beneficiarios', doc], ficha, false)
}
const soloDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

// Solo de SUS beneficiarios inscritos se pueden pedir antecedentes desde la
// cuenta del cliente: sin esto, cualquiera averiguaba de quién es un
// documento (y gastaba créditos) con solo escribirlo.
function docEnContactos(raw: any, documento: string): boolean {
  const d = soloDigitos(documento)
  if (!d) return false
  const contactos: any[] = Array.isArray(raw?.mouvContacts) ? raw.mouvContacts : []
  return contactos.some((x: any) => {
    const c = soloDigitos(x?.docNumber)
    return !!c && (c === d || c.slice(0, -1) === d || d.slice(0, -1) === c)
  })
}

// La aprobación de cumplimiento vale contra el veredicto que se tuvo a la
// vista (misma regla que tusdatos y mouv-proxy).
function aprobacionVigente(f: any): boolean {
  const d = f?.decisionManual
  if (!d || d.decision !== 'aprobar') return false
  if ((d.categoriaEntonces ?? null) !== (f?.categoria ?? null)) return false
  if ('nombreCoincideEntonces' in d && (d.nombreCoincideEntonces ?? null) !== (f?.nombreCoincide ?? null)) return false
  if ('documentoVigenteEntonces' in d && (d.documentoVigenteEntonces ?? null) !== (f?.documentoVigente ?? null)) return false
  return true
}
// Lo que ve el cliente: la decisión de cumplimiento resuelta, sin las notas
// internas de quién decidió y por qué.
function verFicha(f: any, esAdmin: boolean) {
  if (!f || typeof f !== 'object') return f
  const { decisionManual, historialDecisiones, ...resto } = f
  return { ...resto, aprobadoManual: aprobacionVigente(f), ...(esAdmin ? { decisionManual, historialDecisiones } : {}) }
}
// Una consulta NUEVA conserva la decisión de cumplimiento anterior: si el
// veredicto no cambió, la aprobación sigue valiendo (aprobacionVigente).
const conDecision = (nueva: Record<string, unknown>, previa: any) =>
  previa?.decisionManual ? { ...nueva, decisionManual: previa.decisionManual, historialDecisiones: previa.historialDecisiones } : nueva

// ── Tope diario ─────────────────────────────────────────────────────────
async function topeAgotado(uid: string, c: Config): Promise<boolean> {
  try {
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { count, error } = await db.from('audit_log').select('id', { count: 'exact', head: true })
      .eq('action', 'sarblock.lanzado').eq('metadata->>userId', uid).gte('created_at', desde)
    if (error) return false
    return (count ?? 0) >= (Number(c.topeDiario) > 0 ? Number(c.topeDiario) : 200)
  } catch { return false }
}

function cliente(): ClienteSarblock {
  if (!SB_KEY) throw new Error('Falta SARBLOCK_ORG_API_KEY en los secrets.')
  return new ClienteSarblock(SB_KEY)
}

// ── Lanzar ──────────────────────────────────────────────────────────────
async function lanzar(uid: string, d: { documento: string; tipoDocumento: string; nombre?: string }, c: Config, esAdmin: boolean) {
  const sujeto = sujetoDe(d.tipoDocumento, d.documento, d.nombre)
  if (!sujeto) return { ok: false, motivo: 'Tipo de documento no soportado, o empresa sin razón social.' }
  const doc = sujeto.idNumber
  const raw = await leerRaw(uid)
  const previa = raw?.tusdatos?.beneficiarios?.[doc]
  // Ya consultado (por Sarblock o por TusDatos) y no archivado: no se paga
  // otra vez.
  if (previa && previa.estado !== 'error' && previa.estado !== 'archivado') return { ok: true, documento: doc, yaExistia: true }
  if (!esAdmin && await topeAgotado(uid, c)) return { ok: false, tope: true, motivo: 'Llegaste al máximo de verificaciones por hoy. Las que faltan se completan mañana.' }
  try {
    const r = await cliente().crearCheck({ purpose: 'beneficiary', subject: sujeto, idempotencia: claveIdempotencia(uid, doc) })
    await guardarFicha(uid, doc, conDecision({ ...fichaLanzada({ documento: doc, tipoDocumento: d.tipoDocumento, nombre: d.nombre, checkId: r.id }) }, previa))
    await auditar('sarblock.lanzado', { userId: uid, documento: doc, checkId: r.id })
    return { ok: true, documento: doc, checkId: r.id }
  } catch (e) {
    const motivo = e instanceof ErrorSarblock ? `${e.tipo}: ${e.message}` : String((e as Error)?.message ?? e)
    // La ficha queda en error: "sin resultado no sale plata" la sigue
    // frenando en mouv-proxy, y el siguiente barrido la puede relanzar.
    await guardarFicha(uid, doc, conDecision({ proveedor: 'sarblock', documento: doc, tipoDocumento: d.tipoDocumento, estado: 'error', nombreInscrito: d.nombre, detalle: motivo.slice(0, 300), at: new Date().toISOString() }, previa))
    await auditar('sarblock.lanzamiento_fallido', { userId: uid, documento: doc, motivo: motivo.slice(0, 300) })
    return { ok: false, motivo }
  }
}

// ── Recoger ─────────────────────────────────────────────────────────────
const MAX_REINTENTOS = 3
async function recoger(uid: string) {
  const raw = await leerRaw(uid)
  const fichas: Record<string, any> = raw?.tusdatos?.beneficiarios ?? {}
  let cerrados = 0, reintentados = 0
  for (const [doc, f] of Object.entries(fichas)) {
    // Lo que sigue procesando, y lo que se cerró con fuentes que Sarblock
    // todavía esperaba (el mismo check se completa solo; leerlo es gratis).
    const enCursoAun = releerFicha(f)
    if (f?.proveedor !== 'sarblock' || !f.jobid || (f.estado !== 'procesando' && !enCursoAun)) continue
    try {
      const sb = cliente()
      const check = await sb.leerCheck(f.jobid)
      if (!terminado(check)) continue
      const n = Number(f.sarblockReintentos ?? 0)
      if (!enCursoAun && hayQueReintentar(check) && n < MAX_REINTENTOS) {
        await sb.reintentarFuentes(f.jobid)
        await guardarFicha(uid, doc, { ...f, sarblockReintentos: n + 1 })
        reintentados++
        continue
      }
      if (enCursoAun && check.aggregateOutcome === f.sarblock?.aggregateOutcome && JSON.stringify(check.catalog) === JSON.stringify(f.sarblock?.catalog)) continue
      const nueva = { ...traducir(check, { documento: doc, tipoDocumento: f.tipoDocumento, nombre: f.nombreInscrito }), lanzadoAt: f.lanzadoAt, ...(n ? { sarblockReintentos: n } : {}) }
      await guardarFicha(uid, doc, conDecision(nueva, f))
      await auditar('sarblock.consulta', { userId: uid, documento: doc, checkId: f.jobid, categoria: nueva.categoria, operable: nueva.operable, criterio: nueva.criterio })
      cerrados++
    } catch (e) {
      if (e instanceof ErrorSarblock && e.status === 429) break   // la próxima vuelta
      await auditar('sarblock.lectura_fallida', { userId: uid, documento: doc, motivo: String((e as Error)?.message ?? e).slice(0, 300) })
    }
  }
  return { ok: true, cerrados, reintentados }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const yo = await quienLlama(req)
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const accion = String(body.action ?? '')
    const uid = String(body.userId ?? yo.userId ?? '')
    const propio = () => !!uid && (yo.esAdmin || yo.userId === uid)

    // ── Barrido programado (pg_cron, cada 5 min) ─────────────────────────
    // Recoge lo que quedó en curso de las cuentas con consultas recientes,
    // sin depender de que alguien tenga la pantalla abierta.
    if (accion === 'barrido') {
      if (!yo.servicio && !(await traeSecretoDeLaBase(req, db))) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'apagado' })
      const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { data: filas } = await db.from('audit_log').select('metadata')
        .in('action', ['sarblock.lanzado', 'sarblock.consulta']).gte('created_at', desde).order('created_at', { ascending: false }).limit(1000)
      const cuentas = [...new Set(((filas ?? []) as any[]).map(f => String(f?.metadata?.userId ?? '')).filter(Boolean))].slice(0, 25)
      const inicio = Date.now()
      let cerrados = 0
      for (const cu of cuentas) {
        if (Date.now() - inicio > 110_000) break
        try { cerrados += (await recoger(cu)).cerrados } catch (e) { console.warn('[sarblock] barrido', cu, String((e as Error)?.message ?? e)) }
      }
      return json({ ok: true, cuentas: cuentas.length, cerrados })
    }

    if (accion === 'estado') {
      if (!propio()) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      const raw = await leerRaw(uid)
      const benefs: Record<string, any> = {}
      for (const [k, f] of Object.entries(raw?.tusdatos?.beneficiarios ?? {})) benefs[k] = verFicha(f, yo.esAdmin)
      return json({ ok: true, activo: c.activo, enLaPrueba: enLaPrueba(c, uid), proveedor: 'sarblock', beneficiarios: benefs })
    }

    if (accion === 'verificar_beneficiario') {
      if (!propio()) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo || !enLaPrueba(c, uid)) return json({ ok: true, omitido: 'Sarblock no está activo para esta cuenta' })
      if (!yo.esAdmin && !docEnContactos(await leerRaw(uid), String(body.documento ?? ''))) return json({ ok: false, motivo: 'Ese documento no es de un beneficiario inscrito.' }, 403)
      return json(await lanzar(uid, { documento: String(body.documento ?? ''), tipoDocumento: String(body.tipoDocumento ?? 'CC'), nombre: body.nombre }, c, yo.esAdmin))
    }

    if (accion === 'verificar_pendientes') {
      if (!propio()) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo || !enLaPrueba(c, uid)) return json({ ok: true, omitido: 'Sarblock no está activo para esta cuenta', pendientes: 0 })
      const raw = await leerRaw(uid)
      const fichas = raw?.tusdatos?.beneficiarios ?? {}
      const contactos: any[] = Array.isArray(raw?.mouvContacts) ? raw.mouvContacts : []
      const limite = Math.max(1, Math.min(10, Number(body.limite ?? 4) || 4))
      const faltan = contactos.filter(x => x?.accountKind !== 'wallet' && soloDigitos(x?.docNumber) && !fichas[soloDigitos(x.docNumber)])
      let lanzados = 0, tope = false
      for (const x of faltan.slice(0, limite)) {
        const r: any = await lanzar(uid, { documento: String(x.docNumber), tipoDocumento: String(x.docType ?? 'CC'), nombre: x.name }, c, yo.esAdmin)
        if (r.tope) { tope = true; break }
        if (r.ok && !r.yaExistia) lanzados++
      }
      return json({ ok: true, lanzados, pendientes: Math.max(0, faltan.length - limite), ...(tope ? { tope: true } : {}) })
    }

    if (accion === 'recoger_pendientes') {
      if (!propio()) return json({ error: 'No autorizado' }, 401)
      return json(await recoger(uid))
    }

    if (accion === 'hallazgos') {
      // Sarblock trae el catálogo entero en la misma respuesta: el detalle ya
      // está en la ficha. Las fichas viejas de TusDatos se leen igual.
      if (!propio()) return json({ error: 'No autorizado' }, 401)
      const f = (await leerRaw(uid))?.tusdatos?.beneficiarios?.[soloDigitos(body.documento)]
      return json(f ? { ok: true, hallazgos: f.hallazgos ?? [], deCache: true } : { ok: false, motivo: 'No hay consulta guardada para ese documento.' })
    }

    if (accion === 'archivar_beneficiario') {
      // Se archiva, no se borra: el resultado queda para cumplimiento.
      if (!propio()) return json({ error: 'No autorizado' }, 401)
      const doc = soloDigitos(body.documento)
      const f = (await leerRaw(uid))?.tusdatos?.beneficiarios?.[doc]
      if (f) await guardarFicha(uid, doc, { ...f, estado: 'archivado', archivadoAt: new Date().toISOString(), motivoArchivo: String(body.motivo ?? '').slice(0, 300) || null })
      return json({ ok: true })
    }

    // ── Administración ───────────────────────────────────────────────────
    if (accion === 'config_get') {
      const no = await exigirAdmin(req, yo); if (no) return no
      return json({ ok: true, config: await leerConfig(), credencial: SB_KEY ? 'configurada' : 'falta' })
    }
    if (accion === 'config_set') {
      const no = await exigirAdmin(req, yo); if (no) return no
      const c = { ...(await leerConfig()), ...(body.config ?? {}) } as Config
      await db.from('system_config').upsert({ key: CONFIG_KEY, value: JSON.stringify(c) }, { onConflict: 'key' })
      await auditar('sarblock.config', { por: yo.userId, activo: c.activo, cuentas: c.soloEstosUsuarios?.length ?? 0 })
      return json({ ok: true, config: c })
    }
    if (accion === 'uso') {
      const no = await exigirAdmin(req, yo); if (no) return no
      return json({ ok: true, saldo: saldoScreening(await cliente().consumo()) })
    }
    if (accion === 'retraducir') {
      // Vuelve a juzgar con la matriz vigente las fichas guardadas de una
      // cuenta, desde el catálogo que ya se pagó: no llama a Sarblock.
      const no = await exigirAdmin(req, yo); if (no) return no
      if (!uid) return json({ error: 'Falta userId' }, 400)
      const fichas: Record<string, any> = (await leerRaw(uid))?.tusdatos?.beneficiarios ?? {}
      let n = 0
      for (const [doc, f] of Object.entries(fichas)) {
        const s = f?.sarblock
        if (f?.proveedor !== 'sarblock' || f.estado !== 'finalizado' || !s?.catalog) continue
        const check = { id: s.checkId, status: 'COMPLETED', aggregateOutcome: s.aggregateOutcome, screeningRecordId: s.screeningRecordId, catalogVersion: s.catalogVersion, summary: s.summary, identity: s.identity, catalog: s.catalog, completedAt: f.at }
        await guardarFicha(uid, doc, conDecision({ ...traducir(check, { documento: doc, tipoDocumento: f.tipoDocumento, nombre: f.nombreInscrito }), lanzadoAt: f.lanzadoAt }, f))
        n++
      }
      await auditar('sarblock.retraducir', { por: yo.userId, userId: uid, fichas: n })
      return json({ ok: true, retraducidas: n })
    }

    return json({ error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
