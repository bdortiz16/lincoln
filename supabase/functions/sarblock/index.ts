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
import { traducir, fichaLanzada, terminado, hayQueReintentar, releerFicha, rejuzgar, CRITERIO } from './traductor.ts'
import { buscar as padronBuscar, guardar as padronGuardar, anotarUso, fichaParaCuenta, docPadron } from './padron.ts'
import * as R from './risk.ts'
import { normDoc } from '../_shared/cupos.ts'

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
// ¿Es el mismo nombre escrito? (sin tildes, mayúsculas ni signos). Ojo: esto
// no decide si el nombre corresponde al documento —eso es compararNombres—,
// solo si el cliente escribió lo mismo que la ficha ya tiene.
const claveNombre = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const mismoNombre = (a: unknown, b: unknown) => claveNombre(a) === claveNombre(b)

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
  if (previa && previa.estado !== 'error' && previa.estado !== 'archivado') {
    // Se volvió a inscribir con OTRO nombre (p. ej. para corregirlo): el
    // nombre se compara otra vez contra el oficial desde la consulta ya
    // pagada, sin llamar a Sarblock. Antes la ficha quedaba con el nombre
    // viejo y el bloqueo por identidad seguía (caso Arnu, 2026-10-28).
    const nuevo = String(d.nombre ?? '').trim()
    if (nuevo && previa.proveedor === 'sarblock' && previa.estado === 'finalizado' && !mismoNombre(nuevo, previa.nombreInscrito)) {
      const r = rejuzgar(previa, { documento: doc, tipoDocumento: d.tipoDocumento, nombre: nuevo })
      if (r) {
        const ficha = { ...r, nombreInscrito: nuevo }
        await guardarFicha(uid, doc, conDecision(ficha, previa))
        await auditar('sarblock.nombre_rejuzgado', { userId: uid, documento: doc, antes: previa.nombreInscrito ?? null, ahora: nuevo, nombreCoincide: ficha.nombreCoincide ?? null, categoria: ficha.categoria, operable: ficha.operable })
        return { ok: true, documento: doc, yaExistia: true, rejuzgado: true }
      }
    }
    return { ok: true, documento: doc, yaExistia: true }
  }
  // Lincoin Risk: otra cuenta ya consultó a esta persona en los últimos 90
  // días. Se reutiliza sin costo (y no cuenta para el tope); el nombre se
  // compara contra el oficial con lo que escribió ESTA cuenta.
  const enPadron = await padronBuscar(db, d.tipoDocumento, doc)
  if (enPadron) {
    const ficha = fichaParaCuenta(enPadron.ficha, d.nombre, { documento: doc, tipoDocumento: d.tipoDocumento, dePadron: true, padronAt: enPadron.consultado_at })
    await guardarFicha(uid, doc, conDecision(ficha, previa))
    await anotarUso(db, d.tipoDocumento, doc, uid)
    await auditar('sarblock.reutilizado', { userId: uid, documento: doc, categoria: ficha.categoria })
    return { ok: true, documento: doc, reutilizado: true }
  }
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
// JSON con las llaves en orden, para comparar sin que importe el orden.
const estable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x)
async function recoger(uid: string) {
  const raw = await leerRaw(uid)
  const fichas: Record<string, any> = raw?.tusdatos?.beneficiarios ?? {}
  let cerrados = 0, reintentados = 0
  for (const [doc, f] of Object.entries(fichas)) {
    // Una ficha juzgada con una versión anterior de la matriz se vuelve a
    // juzgar con la vigente, desde lo que ya se pagó: gratis y sin esperar.
    if (f?.proveedor === 'sarblock' && f.estado === 'finalizado' && f.criterio !== CRITERIO && f.sarblock?.catalog) {
      const nueva = rejuzgar(f, { documento: doc, tipoDocumento: f.tipoDocumento, nombre: f.nombreInscrito })
      if (nueva) {
        await guardarFicha(uid, doc, conDecision(nueva, f))
        await auditar('sarblock.rejuzgado', { userId: uid, documento: doc, de: f.criterio ?? null, a: CRITERIO, categoria: nueva.categoria, operable: nueva.operable })
        cerrados++
      }
      continue
    }
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
      // Se compara con llaves ordenadas: la ficha guardada vuelve de la base
      // (jsonb) con las llaves de cada objeto reordenadas, y comparando el
      // texto tal cual nunca daba igual. Cada lectura reescribía la ficha y
      // el padrón (visto el 2026-10-28: 555 escrituras en 6 h, dos fichas).
      if (enCursoAun && check.aggregateOutcome === f.sarblock?.aggregateOutcome && estable(check.catalog) === estable(f.sarblock?.catalog)) continue
      const nueva = { ...traducir(check, { documento: doc, tipoDocumento: f.tipoDocumento, nombre: f.nombreInscrito }), lanzadoAt: f.lanzadoAt, ...(n ? { sarblockReintentos: n } : {}) }
      await guardarFicha(uid, doc, conDecision(nueva, f))
      // Al padrón: este crédito ya se pagó, que no lo pague nadie más.
      await padronGuardar(db, f.tipoDocumento, doc, nueva, uid, 'sarblock')
      await auditar('sarblock.consulta', { userId: uid, documento: doc, checkId: f.jobid, categoria: nueva.categoria, operable: nueva.operable, criterio: nueva.criterio })
      cerrados++
    } catch (e) {
      if (e instanceof ErrorSarblock && e.status === 429) break   // la próxima vuelta
      await auditar('sarblock.lectura_fallida', { userId: uid, documento: doc, motivo: String((e as Error)?.message ?? e).slice(0, 300) })
    }
  }
  return { ok: true, cerrados, reintentados }
}

// ── Lincoin Risk prepago ────────────────────────────────────────────────
// La empresa consulta a una persona o empresa sin inscribirla. Cada consulta
// usa 1 de su bolsillo, salga del padrón o de Sarblock. Si ya la consultó y
// sigue vigente, se le muestra la suya sin gastar. Todo queda en su
// historial (risk_consultas, risk_busquedas), que no se borra.
async function nombreDe(id: string | null): Promise<string | null> {
  if (!id) return null
  const { data } = await db.from('users').select('full_name, name, email').eq('id', id).maybeSingle()
  return (data as any)?.full_name || (data as any)?.name || (data as any)?.email || null
}
// Nombre y NIT para el PDF ("Consultado por …"). Mismo criterio que
// facturación: columnas primero y, si están vacías, lo que dejó el registro
// en raw_data.
async function empresaDe(uid: string) {
  // Solo esas dos llaves de raw_data: el objeto entero pesa y no hace falta.
  const { data } = await db.from('users').select('company_name, full_name, name, tax_id, rdEmpresa:raw_data->>companyName, rdNit:raw_data->>taxId').eq('id', uid).maybeSingle()
  const u = (data ?? {}) as any
  return { nombre: String(u.company_name || u.rdEmpresa || u.full_name || u.name || ''), nit: String(u.tax_id || u.rdNit || '') }
}
const vista = (r: any, cfg: R.ConfigRisk, empresa?: { nombre: string; nit: string }) =>
  ({ ...R.fila(r), grupo: R.grupoDe(r), vence: R.vencimiento(cfg, r.at), ...(empresa ? { empresa } : {}) })

async function risk(req: Request, yo: Yo, uid: string, accion: string, body: Record<string, any>): Promise<Response | Record<string, unknown>> {
  // ── Admin ──────────────────────────────────────────────────────────────
  if (accion.startsWith('admin_risk_') || accion === 'admin_sarblock_uso') {
    const no = await exigirAdmin(req, yo); if (no) return no
    const cfg = await R.leerConfigRisk(db)
    const por = await nombreDe(yo.userId) ?? 'admin'
    if (accion === 'admin_risk_resumen') {
      let saldoSarblock: number | null = null
      try { saldoSarblock = saldoScreening(await cliente().consumo()) } catch { /* sin saldo a la vista */ }
      return { ok: true, config: cfg, ...(await R.resumen(db, cfg)), saldoSarblock }
    }
    // Lo que queda en Sarblock y en qué se gastó este periodo. Leerlo es
    // gratis. AML de beneficiarios y Lincoin Risk comparten estos créditos.
    if (accion === 'admin_sarblock_uso') {
      let u: any
      try { u = await cliente().consumo() } catch (e) { return { ok: false, motivo: `No se pudo leer el consumo en Sarblock: ${String((e as Error)?.message ?? e).slice(0, 160)}` } }
      const s = u?.screening ?? {}, cr = u?.credits ?? {}
      const desde = String(u?.period?.start ?? new Date(Date.now() - 30 * 86400_000).toISOString())
      const [aml, risk] = await Promise.all([
        db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'sarblock.lanzado').gte('created_at', desde),
        db.from('risk_consultas').select('id', { count: 'exact', head: true }).not('check_id', 'is', null).gte('at', desde),
      ])
      return { ok: true,
        plan: u?.period?.planCode ?? null, desde, renueva: cr.renewsAt ?? u?.period?.end ?? null,
        incluidas: Number(s.included ?? cr.planIncluded ?? 0), consumidas: Number(s.consumed ?? 0), reservadas: Number(s.reserved ?? 0),
        quedan: saldoScreening(u), adicionales: Math.max(0, saldoScreening(u) - Number(s.planRemaining ?? cr.planRemaining ?? 0)),
        enAml: aml.count ?? 0, enRisk: risk.count ?? 0 }
    }
    if (accion === 'admin_risk_config') {
      const nueva = R.normalizarConfig(cfg, body.config ?? {})
      const { error } = await db.from('system_config').upsert({ key: R.CONFIG_KEY_RISK, value: JSON.stringify(nueva) }, { onConflict: 'key' })
      if (error) return { ok: false, motivo: 'No se pudo guardar la configuración.' }
      await auditar('risk.config', { por: yo.userId, antes: cfg, despues: nueva })
      return { ok: true, config: nueva }
    }
    if (accion === 'admin_risk_cliente') {
      const cli = String(body.cliente ?? '')
      const [emp, saldo, compras, movs, consultas] = await Promise.all([
        empresaDe(cli), R.saldoDe(db, cli),
        db.from('risk_compras').select('*').eq('user_id', cli).order('at', { ascending: false }).limit(100),
        db.from('risk_movimientos').select('*').eq('user_id', cli).order('at', { ascending: false }).limit(50),
        db.from('risk_consultas').select('id', { count: 'exact', head: true }).eq('user_id', cli),
      ])
      return { ok: true, nombre: emp.nombre || cli, saldo,
        compras: ((compras.data ?? []) as any[]).map(c => ({ id: c.id, at: c.at, cantidad: c.cantidad, precioUnit: Number(c.precio_unit), subtotal: Number(c.subtotal), iva: Number(c.iva), total: Number(c.total), bolsillo: c.bolsillo, por: c.por })),
        movimientos: movs.data ?? [], consultas: consultas.count ?? 0 }
    }
    if (accion === 'admin_risk_compra_proveedor') {
      const unidades = Math.floor(Number(body.unidades) || 0), costoTotal = Number(body.costoTotal)
      if (unidades <= 0 || !Number.isFinite(costoTotal) || costoTotal < 0) return { ok: false, motivo: 'Escribe las unidades y el costo total.' }
      const { error } = await db.from('risk_caja').insert({ unidades, costo_total: costoTotal, nota: String(body.nota ?? '').slice(0, 200) || null, por })
      if (error) return { ok: false, motivo: 'No se pudo registrar la compra.' }
      await auditar('risk.caja', { por: yo.userId, unidades, costoTotal })
      return { ok: true }
    }
    if (accion === 'admin_risk_ajuste') {
      const cli = String(body.cliente ?? ''), cantidad = Math.trunc(Number(body.cantidad) || 0), motivo = String(body.motivo ?? '').trim().slice(0, 300)
      if (!cli || !cantidad || !motivo) return { ok: false, motivo: 'Elige el cliente, la cantidad (+/-) y escribe el motivo.' }
      const r = await R.mover(db, cli, 'ajuste', cantidad, motivo, por, null)
      if (r.error) return { ok: false, motivo: 'El ajuste dejaría el saldo en negativo.' }
      await auditar('risk.ajuste', { por: yo.userId, userId: cli, cantidad, motivo, saldo: r.saldo })
      return { ok: true, saldo: r.saldo }
    }
    // ── Historiales de TODAS las empresas ──────────────────────────────
    // Cumplimiento ve todo lo que se consultó y buscó, de quién y cuándo.
    // La lista no trae la ficha (pesa); el detalle se abre con
    // admin_risk_ver, que queda en la auditoría: son antecedentes de
    // personas reales.
    if (accion === 'admin_risk_consultas' || accion === 'admin_risk_busquedas') {
      const esConsultas = accion === 'admin_risk_consultas'
      const pagina = Math.max(1, Number(body.pagina) || 1), porPagina = 30
      let q = db.from(esConsultas ? 'risk_consultas' : 'risk_busquedas')
        .select(esConsultas ? `user_id, ${R.COLS}` : '*', { count: 'exact' })
      if (body.cliente) q = q.eq('user_id', String(body.cliente))
      const texto = String(body.q ?? '').trim().replace(/[%,()]/g, '')
      if (texto) q = q.or(esConsultas
        ? `documento.ilike.%${texto}%,nombre_oficial.ilike.%${texto}%,nombre_escrito.ilike.%${texto}%`
        : `documento.ilike.%${texto}%,nombre.ilike.%${texto}%`)
      if (body.desde) q = q.gte('at', String(body.desde))
      if (body.hasta) q = q.lte('at', `${String(body.hasta).slice(0, 10)}T23:59:59.999Z`)
      if (esConsultas) {
        if (body.nivel === 'alto') q = q.or('operable.eq.false,categoria.eq.alto')
        // Ojo con los NULL: neq('operable', false) deja fuera las filas sin
        // valor, por eso va con or(... is.null ...).
        else if (body.nivel === 'medio') q = q.eq('categoria', 'medio').or('operable.is.null,operable.eq.true')
        else if (body.nivel === 'bajo') q = q.eq('estado', 'lista').or('categoria.is.null,categoria.not.in.(alto,medio)').or('operable.is.null,operable.eq.true')
        if (body.riesgo) q = q.contains('riesgos', [String(body.riesgo)])
        if (body.estado) q = q.eq('estado', String(body.estado))
        if (body.origen === 'sarblock') q = q.eq('de_cache', false)
        else if (body.origen === 'padron') q = q.eq('de_cache', true)
      } else if (body.resultado) q = q.eq('resultado', String(body.resultado))
      const { data, count, error } = await q.order('at', { ascending: false }).range((pagina - 1) * porPagina, pagina * porPagina - 1)
      if (error) return { ok: false, motivo: 'No se pudo leer el historial.' }
      const filas = (data ?? []) as any[]
      const ids = [...new Set(filas.map(f => f.user_id))]
      const empresas: Record<string, string> = {}
      if (ids.length) {
        const { data: us } = await db.from('users').select('id, company_name, full_name, name, email, rdEmpresa:raw_data->>companyName').in('id', ids)
        for (const u of (us ?? []) as any[]) empresas[u.id] = u.company_name || u.rdEmpresa || u.full_name || u.name || u.email || u.id
      }
      return { ok: true, total: count ?? 0, pagina, paginas: Math.max(1, Math.ceil((count ?? 0) / porPagina)),
        filas: filas.map(f => esConsultas
          ? { ...vista(f, cfg), cliente: f.user_id, empresa: empresas[f.user_id] ?? f.user_id }
          : { id: f.id, at: f.at, por: f.por, tipoDocumento: f.tipo_documento, documento: f.documento, nombre: f.nombre, resultado: f.resultado, consultaId: f.consulta_id, cliente: f.user_id, empresa: empresas[f.user_id] ?? f.user_id }) }
    }
    if (accion === 'admin_risk_ver') {
      const { data: r } = await db.from('risk_consultas').select('*').eq('id', String(body.consultaId ?? '')).maybeSingle()
      if (!r) return { ok: false, motivo: 'No existe esa consulta.' }
      await auditar('risk.admin_ver', { por: yo.userId, consultaId: (r as any).id, userId: (r as any).user_id, documento: (r as any).documento })
      return { ok: true, consulta: vista(r, cfg, await empresaDe((r as any).user_id)) }
    }
    return { ok: false, error: `Acción desconocida: ${accion}` }
  }

  // ── Cliente ────────────────────────────────────────────────────────────
  if (!uid || !(yo.esAdmin || yo.userId === uid)) return json({ error: 'No autorizado' }, 401)
  const cfg = await R.leerConfigRisk(db)
  const por = await nombreDe(yo.userId)

  if (accion === 'risk_cuenta') {
    const [saldo, u, compras, empresa] = await Promise.all([
      R.saldoDe(db, uid),
      db.from('users').select('balances').eq('id', uid).maybeSingle(),
      db.from('risk_compras').select('id, at, cantidad, total, bolsillo').eq('user_id', uid).order('at', { ascending: false }).limit(5),
      empresaDe(uid),
    ])
    const pesos = ((u.data as any)?.balances ?? {}) as Record<string, number>
    return { ok: true, saldo, aviso: saldo <= cfg.avisoClienteConsultas, umbral: cfg.avisoClienteConsultas,
      tienda: { activo: cfg.activo, precioPorConsulta: cfg.precioPorConsulta, minimoCompra: cfg.minimoCompra, ivaPct: cfg.ivaPct,
        bolsillos: Object.entries(cfg.bolsillos).filter(([, v]) => v.activo).map(([k, v]) => ({ clave: k, etiqueta: v.etiqueta, saldo: Number(pesos[k] ?? 0) })) },
      compras: compras.data ?? [], empresa }
  }

  if (accion === 'risk_comprar') {
    const cantidad = Math.floor(Number(body.cantidad) || 0)
    const bolsillo = String(body.bolsillo ?? '')
    const { data: u } = await db.from('users').select('balances').eq('id', uid).maybeSingle()
    const error = R.validarCompra(cfg, cantidad, bolsillo, Number((u as any)?.balances?.[bolsillo] ?? 0))
    if (error) return { ok: false, motivo: error }
    const q = R.cotizar(cfg, cantidad)
    // Débito de pesos + compra + saldo de consultas: una sola transacción.
    const { data: r, error: e } = await db.rpc('risk_comprar', { p_user_id: uid, p_cantidad: q.cantidad, p_bolsillo: bolsillo,
      p_precio_unit: q.precioUnit, p_subtotal: q.subtotal, p_iva: q.iva, p_total: q.total, p_por: por })
    if (e || (r as any)?.error) {
      await auditar('risk.compra_fallida', { userId: uid, cantidad, bolsillo, motivo: e?.message ?? (r as any)?.error })
      return { ok: false, motivo: (r as any)?.error === 'insufficient' ? 'No tienes saldo suficiente en ese bolsillo.' : 'No se pudo completar la compra. No se debitó nada.' }
    }
    await auditar('risk.compra', { userId: uid, por: yo.userId, cantidad, bolsillo, total: q.total, compraId: (r as any).compra_id })
    return { ok: true, compra: { id: (r as any).compra_id, at: new Date().toISOString(), ...q, bolsillo, por }, saldo: (r as any).saldo }
  }

  if (accion === 'risk_consultar') {
    const c = await leerConfig()
    if (!c.activo || !cfg.activo) return { ok: false, motivo: 'La consulta de antecedentes no está disponible en este momento.' }
    if (body.autorizado !== true) return { ok: false, motivo: 'Confirma que tienes autorización o una finalidad legítima para consultar estos datos.' }
    const juridica = body.tipoPersona === 'juridica'
    const tipo = juridica ? 'NIT' : String(body.tipoDocumento ?? 'CC').toUpperCase()
    const nombre = String(body.nombre ?? '').trim() || undefined
    const sujeto = sujetoDe(tipo, String(body.documento ?? ''), nombre)
    if (!sujeto) return { ok: false, motivo: juridica ? 'Escribe el NIT y la razón social.' : 'Revisa el tipo y el número de documento.' }
    const doc = sujeto.idNumber
    // Ya la consultó y sigue vigente: se muestra la suya, sin gastar.
    const { data: previa } = await db.from('risk_consultas').select('*').eq('user_id', uid).eq('tipo_documento', tipo).eq('documento', doc)
      .eq('estado', 'lista').order('at', { ascending: false }).limit(1).maybeSingle()
    if (previa && R.vencimiento(cfg, (previa as any).at).estado !== 'vencida') {
      await R.anotarBusqueda(db, uid, { por, tipoDocumento: tipo, documento: doc, nombre: (previa as any).nombre_oficial ?? nombre ?? null, resultado: 'existente', consultaId: (previa as any).id })
      return { ok: true, existente: true, consulta: vista(previa, cfg, await empresaDe(uid)), saldo: await R.saldoDe(db, uid) }
    }
    const resultado = previa ? 'renovada' : 'nueva'
    const id = crypto.randomUUID()
    // Se reserva la consulta ANTES de gastar en Sarblock: con saldo 1, dos
    // consultas al tiempo no pueden pasar las dos.
    const m = await R.mover(db, uid, 'consumo', -1, `Consulta ${tipo} ${doc}`, por, id)
    if (m.error) {
      await R.anotarBusqueda(db, uid, { por, tipoDocumento: tipo, documento: doc, nombre: nombre ?? null, resultado: 'sin_saldo' })
      return { ok: false, sinSaldo: true, motivo: 'No te quedan consultas. Compra un paquete para seguir consultando.' }
    }
    const base = { id, user_id: uid, por, por_id: yo.userId, tipo_persona: juridica ? 'juridica' : 'natural', tipo_documento: tipo, documento: doc, nombre_escrito: nombre ?? null }
    const enPadron = await padronBuscar(db, tipo, doc, cfg.vigenciaDias)
    if (enPadron) {
      const ficha = fichaParaCuenta(enPadron.ficha, nombre, { documento: doc, tipoDocumento: tipo })
      const fila = { ...base, de_cache: true, estado: 'lista', ficha, nombre_oficial: ficha.nombreReal ?? null, categoria: ficha.categoria ?? null, operable: ficha.operable ?? null, riesgos: R.tiposDeRiesgo(ficha), despachos: R.despachos(ficha) }
      const { data: ins, error } = await db.from('risk_consultas').insert(fila).select('*').single()
      if (error) { await R.mover(db, uid, 'devolucion', 1, 'No se pudo guardar la consulta: se devuelve', null, id); return { ok: false, motivo: 'No se pudo consultar en este momento.' } }
      await anotarUso(db, tipo, doc, uid)
      await R.anotarBusqueda(db, uid, { por, tipoDocumento: tipo, documento: doc, nombre: fila.nombre_oficial ?? nombre ?? null, resultado, consultaId: id })
      await auditar('sarblock.risk_manual', { userId: uid, tipo, documento: doc, deCache: true, consultaId: id })
      return { ok: true, consulta: vista(ins, cfg, await empresaDe(uid)), saldo: m.saldo }
    }
    try {
      const sb = cliente()
      if (saldoScreening(await sb.consumo()) <= 0) throw new Error('caja')
      const r = await sb.crearCheck({ purpose: 'beneficiary', subject: sujeto, idempotencia: `risk-${uid}-${tipo}-${doc}-${new Date().toISOString().slice(0, 10)}` })
      const { error } = await db.from('risk_consultas').insert({ ...base, check_id: r.id, estado: 'consultando' })
      if (error) throw new Error(error.message)
      await R.anotarBusqueda(db, uid, { por, tipoDocumento: tipo, documento: doc, nombre: nombre ?? null, resultado, consultaId: id })
      await auditar('sarblock.risk_lanzado', { userId: uid, tipo, documento: doc, checkId: r.id, consultaId: id })
      return { ok: true, enCurso: true, consultaId: id, saldo: m.saldo }
    } catch (e) {
      await R.mover(db, uid, 'devolucion', 1, 'La consulta no se pudo lanzar: se devuelve', null, id)
      await auditar('sarblock.risk_fallido', { userId: uid, tipo, documento: doc, motivo: String((e as Error)?.message ?? e).slice(0, 300) })
      return { ok: false, motivo: 'No se pudo consultar en este momento. Intenta de nuevo en unos minutos. No se usó ninguna consulta.' }
    }
  }

  if (accion === 'risk_resultado') {
    const { data: q } = await db.from('risk_consultas').select('*').eq('id', String(body.consultaId ?? '')).eq('user_id', uid).maybeSingle()
    if (!q) return { ok: false, motivo: 'No existe esa consulta.' }
    const cq = q as any
    if (cq.estado !== 'consultando') return { ok: true, consulta: vista(cq, cfg, await empresaDe(uid)), saldo: await R.saldoDe(db, uid) }
    const check = await cliente().leerCheck(String(cq.check_id))
    if (!terminado(check)) return { ok: true, enCurso: true, consultaId: cq.id }
    const ficha = traducir(check, { documento: cq.documento, tipoDocumento: cq.tipo_documento, nombre: cq.nombre_escrito ?? undefined })
    let cambio: Record<string, unknown>
    if (ficha.estado !== 'finalizado') {
      cambio = { estado: 'fallida', actualizado_at: new Date().toISOString() }
    } else {
      cambio = { estado: 'lista', ficha, nombre_oficial: ficha.nombreReal ?? null, categoria: ficha.categoria ?? null, operable: ficha.operable ?? null,
        riesgos: R.tiposDeRiesgo(ficha), despachos: R.despachos(ficha), actualizado_at: new Date().toISOString() }
    }
    // Solo quien la pasa de "consultando" la cierra: dos lecturas al tiempo
    // no devuelven dos veces.
    const { data: upd } = await db.from('risk_consultas').update(cambio).eq('id', cq.id).eq('estado', 'consultando').select('*')
    const cerrada = (upd as any[])?.[0]
    if (cerrada) {
      if (ficha.estado !== 'finalizado') await R.mover(db, uid, 'devolucion', 1, 'Consulta fallida: se devuelve la consulta', null, cq.id)
      else await padronGuardar(db, cq.tipo_documento, cq.documento, ficha, uid, 'manual')
      await auditar('sarblock.risk_manual', { userId: uid, tipo: cq.tipo_documento, documento: cq.documento, deCache: false, categoria: ficha.categoria ?? null, consultaId: cq.id, estado: cambio.estado })
    }
    const { data: final } = await db.from('risk_consultas').select('*').eq('id', cq.id).single()
    return { ok: true, consulta: vista(final, cfg, await empresaDe(uid)), saldo: await R.saldoDe(db, uid) }
  }

  // Mientras se escribe la cédula: ¿ya está consultada? (no gasta, no anota)
  if (accion === 'risk_existente') {
    const tipo = body.tipoPersona === 'juridica' ? 'NIT' : String(body.tipoDocumento ?? 'CC').toUpperCase()
    const s = sujetoDe(tipo, String(body.documento ?? ''), tipo === 'NIT' ? 'x' : undefined)
    if (!s) return { ok: true, existe: false }
    const { data: r } = await db.from('risk_consultas').select(R.COLS).eq('user_id', uid).eq('tipo_documento', tipo).eq('documento', s.idNumber)
      .eq('estado', 'lista').order('at', { ascending: false }).limit(1).maybeSingle()
    return r ? { ok: true, existe: true, consulta: vista(r, cfg) } : { ok: true, existe: false }
  }

  // Abrir una consulta guardada. Desde la búsqueda se anota en el historial.
  if (accion === 'risk_ver') {
    const { data: r } = await db.from('risk_consultas').select('*').eq('id', String(body.consultaId ?? '')).eq('user_id', uid).maybeSingle()
    if (!r) return { ok: false, motivo: 'No existe esa consulta.' }
    const x = r as any
    if (body.desdeBusqueda) await R.anotarBusqueda(db, uid, { por, tipoDocumento: x.tipo_documento, documento: x.documento, nombre: x.nombre_oficial, resultado: 'existente', consultaId: x.id })
    return { ok: true, consulta: vista(x, cfg, await empresaDe(uid)) }
  }

  if (accion === 'risk_registradas') {
    return { ok: true, ...R.filtrarRegistradas(await R.registradas(db, uid, cfg), { q: body.q, nivel: body.nivel, riesgo: body.riesgo, vence: body.vence, pagina: body.pagina }), tipos: R.TIPOS_RIESGO }
  }

  if (accion === 'risk_busquedas') {
    const pagina = Math.max(1, Number(body.pagina) || 1), porPagina = 25
    let q = db.from('risk_busquedas').select('*', { count: 'exact' }).eq('user_id', uid)
    const texto = String(body.q ?? '').trim().replace(/[%,()]/g, '')
    if (texto) q = q.or(`documento.ilike.%${texto}%,nombre.ilike.%${texto}%`)
    const { data, count } = await q.order('at', { ascending: false }).range((pagina - 1) * porPagina, pagina * porPagina - 1)
    return { ok: true, total: count ?? 0, pagina, paginas: Math.max(1, Math.ceil((count ?? 0) / porPagina)),
      filas: ((data ?? []) as any[]).map(b => ({ id: b.id, at: b.at, por: b.por, tipoDocumento: b.tipo_documento, documento: b.documento, nombre: b.nombre, resultado: b.resultado, consultaId: b.consulta_id })) }
  }

  // Mapa: los despachos de cada persona registrada. El municipio y el
  // departamento se sacan en la pantalla (lib/ubicacion.ts), con la lista
  // del DANE que ya tiene la app.
  if (accion === 'risk_mapa') {
    const todas = await R.registradas(db, uid, cfg)
    return { ok: true, personas: todas.map(c => c.despachos) }
  }

  return { ok: false, error: `Acción desconocida: ${accion}` }
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
      // Un NIT con DV pegado tiene su ficha por los 9 dígitos base.
      const fichaDe = (x: any) => fichas[soloDigitos(x.docNumber)] ?? fichas[docPadron(String(x.docNumber), String(x.docType ?? 'CC'))]
      // Ficha de Sarblock con OTRO nombre que el inscrito: se borró y se
      // volvió a inscribir corregido. lanzar() lo vuelve a juzgar gratis. Si
      // otro contacto con el mismo documento sí tiene el nombre de la ficha,
      // no se toca (si no, dos contactos se la quitarían cada vuelta).
      const renombrado = (x: any) => {
        const f = fichaDe(x)
        if (!f || f.proveedor !== 'sarblock' || f.estado !== 'finalizado' || !x.name || mismoNombre(x.name, f.nombreInscrito)) return false
        const d = soloDigitos(x.docNumber)
        return !contactos.some((o: any) => soloDigitos(o?.docNumber) === d && mismoNombre(o?.name, f.nombreInscrito))
      }
      // Archivada = la de un beneficiario borrado; si vuelve a estar inscrito
      // se retoma (del padrón, sin costo, si sigue vigente).
      const faltan = contactos.filter(x => x?.accountKind !== 'wallet' && soloDigitos(x?.docNumber)
        && (!fichaDe(x) || fichaDe(x).estado === 'archivado' || renombrado(x)))
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
      // Un NIT llega con el DV pegado y la ficha está por los 9 dígitos base:
      // sin esto no se archivaba, y al volver a inscribirlo se reutilizaba
      // la ficha vieja con el nombre viejo.
      const fichas = (await leerRaw(uid))?.tusdatos?.beneficiarios ?? {}
      const doc = fichas[soloDigitos(body.documento)] ? soloDigitos(body.documento) : normDoc(body.documento)
      const f = fichas[doc]
      if (f) await guardarFicha(uid, doc, { ...f, estado: 'archivado', archivadoAt: new Date().toISOString(), motivoArchivo: String(body.motivo ?? '').slice(0, 300) || null })
      return json({ ok: true })
    }

    // ── Lincoin Risk prepago (risk.ts) ───────────────────────────────────
    if (accion.startsWith('risk_') || accion.startsWith('admin_risk_') || accion === 'admin_sarblock_uso') { const r = await risk(req, yo, uid, accion, body); return r instanceof Response ? r : json(r) }

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
        if (f?.proveedor !== 'sarblock' || f.estado !== 'finalizado') continue
        const nueva = rejuzgar(f, { documento: doc, tipoDocumento: f.tipoDocumento, nombre: f.nombreInscrito })
        if (!nueva) continue
        await guardarFicha(uid, doc, conDecision(nueva, f))
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
