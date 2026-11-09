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
import { ClienteSarblock, ErrorSarblock, sujetoDe, saldoScreening, claveIdempotencia, documentoInvalido } from './cliente.ts'
import { traducir, fichaLanzada, terminado, hayQueReintentar, releerFicha, rejuzgar, CRITERIO, soloTrasladoRues, type RuesTraslado } from './traductor.ts'
import { buscar as padronBuscar, guardar as padronGuardar, anotarUso, fichaParaCuenta, docPadron } from './padron.ts'
import * as R from './risk.ts'
import { normDoc } from '../_shared/cupos.ts'
import { equipoPermite } from '../_shared/equipo.ts'
import { razonSocialPorNit, matriculaVigentePorNit } from '../_shared/rues.ts'
import { reclamarCandado, soltarCandado } from '../_shared/candado.ts'
import * as K from './cartera.ts'

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
type Yo = { userId: string | null; esAdmin: boolean; servicio?: boolean; mfaFalta?: string | null }
async function quienLlama(req: Request): Promise<Yo> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { userId: null, esAdmin: false }
  if (SERVICE_KEY && igualSeguro(jwt, SERVICE_KEY)) return { userId: null, esAdmin: true, servicio: true }
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    if (!user) return { userId: null, esAdmin: false }
    const { data } = await db.from('users').select('role').eq('id', user.id).single()
    // Ser admin no alcanza: del equipo, solo Cumplimiento (y el dueño) opera
    // acá. Antes un miembro de Tesorería o de "Solo lectura" podía leer los
    // veredictos AML o cambiar su configuración llamando directo.
    const esAdminRol = (data as any)?.role === 'admin'
      && (await equipoPermite(db, user.id, 'cumplimiento', { email: user.email ?? null })).ok
    if (!esAdminRol) return { userId: user.id, esAdmin: false }
    // Admin solo con la sesión que pasó el 2FA. Sin esto, en su propia cuenta
    // un admin con solo la contraseña se saltaba el "solo beneficiarios
    // inscritos" y el tope diario (consultas pagadas por Lincoin).
    const mfa = await requireMfaSession(db, req, user.id)
    return { userId: user.id, esAdmin: !mfa, mfaFalta: mfa }
  } catch { return { userId: null, esAdmin: false } }
}
// Las acciones de administración exigen la sesión con segundo factor, igual
// que admin-data y tusdatos.
async function exigirAdmin(req: Request, yo: Yo): Promise<Response | null> {
  if (!yo.esAdmin) return yo.mfaFalta ? json({ error: yo.mfaFalta }, 403) : json({ error: 'No autorizado' }, 401)
  if (yo.servicio) return null
  const mfa = await requireMfaSession(db, req, yo.userId)
  return mfa ? json({ error: mfa }, 403) : null
}

// Actuar sobre la cuenta `uid`. La propia, sin más. La de OTRO, solo un admin
// de Cumplimiento con la sesión que pasó el 2FA (o el servidor). Antes bastaba
// ser admin: con solo la contraseña de un miembro de Cumplimiento se leían las
// fichas AML de cualquier cliente, se lanzaban consultas pagadas a su nombre
// y se le gastaban sus consultas de Risk.
async function sobreCuenta(req: Request, yo: Yo, uid: string): Promise<Response | null> {
  if (!uid) return json({ error: 'No autorizado' }, 401)
  if (yo.userId && yo.userId === uid) return null
  return await exigirAdmin(req, yo)
}

// Las consultas de Risk se idempotentan por día (la clave del check lleva la
// fecha UTC): un "en curso" de HOY es el mismo check, por viejo que sea.
const inicioDelDiaUtc = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`

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
// De dos fichas del MISMO documento (un NIT: la de TusDatos quedó por el
// número con DV, la de Sarblock va por los 9 dígitos base), la que manda:
// la vigente; si las dos lo están, la más reciente. Antes mandaba siempre la
// del número exacto, y una ficha vieja tapaba a la nueva.
const vigenteF = (f: any) => !!f && f.estado !== 'archivado'
const fichaQueManda = (a: any, b: any) =>
  vigenteF(a) && vigenteF(b) ? ((Date.parse(String(b.at ?? '')) || 0) > (Date.parse(String(a.at ?? '')) || 0) ? b : a)
    : vigenteF(a) ? a : vigenteF(b) ? b : (a ?? b)
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

// ── El cupo de Sarblock ────────────────────────────────────────────────
// Sarblock deja 60 llamadas por minuto para TODA la organización (producción
// y pruebas comparten la llave). El 2026-10-29 los sondeos automáticos de
// beneficiarios lo agotaron y las consultas que pagaba un cliente en Lincoin
// Risk fallaban con 429. Ahora:
//   · cada llamada a Sarblock queda en el log con la acción que la pidió,
//     para saber quién gasta el cupo;
//   · un 429 deja una pausa (system_config.sarblock_pausa) durante la cual
//     lo automático (sondeos, barrido, lecturas de resultado) no llama a
//     Sarblock, y el cupo queda para lo que pide una persona;
//   · la consulta de Risk espera lo que pide Sarblock y reintenta una vez.
let accionEnCurso = ''
const PAUSA_KEY = 'sarblock_pausa'
let pausa = { hasta: 0, leido: 0 }
async function pausadoHasta(): Promise<number> {
  if (Date.now() - pausa.leido < 5000) return pausa.hasta
  try {
    const { data } = await db.from('system_config').select('value').eq('key', PAUSA_KEY).maybeSingle()
    pausa = { hasta: Number(JSON.parse(String((data as any)?.value ?? '{}'))?.hasta ?? 0) || 0, leido: Date.now() }
  } catch { pausa = { ...pausa, leido: Date.now() } }
  return pausa.hasta
}
const enPausa = async () => (await pausadoHasta()) > Date.now()
async function marcarPausa(segundos: number) {
  const hasta = Date.now() + Math.min(Math.max(segundos, 5), 120) * 1000
  if (hasta <= pausa.hasta) return
  pausa = { hasta, leido: Date.now() }
  try { await db.from('system_config').upsert({ key: PAUSA_KEY, value: JSON.stringify({ hasta, por: accionEnCurso }) }, { onConflict: 'key' }) } catch { /* la pausa en memoria igual vale */ }
}
const esLimite = (e: unknown) => e instanceof ErrorSarblock && e.status === 429
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchContado(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, init)
  let ruta = url
  try { ruta = new URL(url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id') } catch { /* tal cual */ }
  console.log(`[sarblock] api ${init?.method ?? 'GET'} ${ruta} ${r.status} accion=${accionEnCurso}`)
  if (r.status === 429) {
    const ra = Number(r.headers.get('retry-after'))
    await marcarPausa(Number.isFinite(ra) && ra > 0 ? ra : 60)
  }
  return r
}

function cliente(): ClienteSarblock {
  if (!SB_KEY) throw new Error('Falta SARBLOCK_ORG_API_KEY en los secrets.')
  return new ClienteSarblock(SB_KEY, fetchContado)
}

// El saldo se lee antes de cada consulta de Risk. Leerlo es gratis en
// créditos pero no en cupo: se guarda un minuto (solo si alcanza).
let saldoVisto = { valor: 0, at: 0 }
async function saldoParaConsultar(sb: ClienteSarblock): Promise<number> {
  if (saldoVisto.valor > 0 && Date.now() - saldoVisto.at < 60_000) return saldoVisto.valor
  saldoVisto = { valor: saldoScreening(await sb.consumo()), at: Date.now() }
  return saldoVisto.valor
}
// Lo que pide una persona: si Sarblock está al tope, espera lo que indique
// (hasta 10 s) y reintenta una vez.
async function conCupo<T>(fn: () => Promise<T>): Promise<T> {
  const falta = (await pausadoHasta()) - Date.now()
  if (falta > 0 && falta <= 10_000) await esperar(falta)
  try { return await fn() } catch (e) {
    if (!esLimite(e)) throw e
    await esperar(Math.min(Math.max(Number((e as ErrorSarblock).retryAfter ?? 5), 1), 10) * 1000)
    return await fn()
  }
}

// ── Lanzar ──────────────────────────────────────────────────────────────
async function lanzar(uid: string, d: { documento: string; tipoDocumento: string; nombre?: string }, c: Config, esAdmin: boolean, forzar = false) {
  const sujeto = sujetoDe(d.tipoDocumento, d.documento, d.nombre)
  if (!sujeto) return { ok: false, motivo: 'Tipo de documento no soportado, o empresa sin razón social.' }
  const doc = sujeto.idNumber
  const raw = await leerRaw(uid)
  const previa = raw?.tusdatos?.beneficiarios?.[doc]
  // RECONSULTA FORZADA (solo Cumplimiento, solo identidad sin validar).
  // 9 nov: Sarblock devolvió NOT_FOUND con el nombre oficial lleno. Para
  // volver a preguntar no había camino: la ficha terminada, el padrón (90
  // días) y la clave de idempotencia del día devolvían siempre el mismo
  // resultado. Se limita a 'sin_validar' porque cada una se paga y es el
  // único caso en que otra consulta puede dar algo distinto (la fuente de
  // identidad pudo fallar esa vez).
  const forzada = forzar && esAdmin && previa?.estado === 'finalizado' && previa?.categoria === 'sin_validar'
  if (forzar && !forzada) return { ok: false, motivo: 'Solo se puede volver a consultar un beneficiario con la identidad sin validar.' }
  if (forzada) await auditar('sarblock.reconsulta_forzada', { userId: uid, documento: doc, identidadAnterior: previa?.sarblock?.identity ?? null })
  // Documento que Sarblock rechaza seguro (una cédula de 11 dígitos): no se
  // llama. La ficha queda en 'documento_invalido', que el envío sigue
  // frenando ("sin resultado no sale plata") pero que ya no se reintenta, y
  // la pantalla dice qué corregir en vez de "se está reintentando".
  const invalido = documentoInvalido(d.tipoDocumento, doc)
  if (invalido && previa?.estado !== 'finalizado') {
    if (previa?.estado !== 'documento_invalido') {
      await guardarFicha(uid, doc, conDecision({ proveedor: 'sarblock', documento: doc, tipoDocumento: d.tipoDocumento, estado: 'documento_invalido', nombreInscrito: d.nombre, detalle: invalido, at: new Date().toISOString() }, previa))
      await auditar('sarblock.documento_invalido', { userId: uid, documento: doc, motivo: invalido })
    }
    return { ok: false, documentoInvalido: true, motivo: invalido }
  }
  // Ya consultado (por Sarblock o por TusDatos) y no archivado: no se paga
  // otra vez. 'documento_invalido' se vuelve a mirar: si el rechazo fue por
  // otra regla de Sarblock, se intenta otra vez cuando alguien lo pide.
  if (!forzada && previa && previa.estado !== 'error' && previa.estado !== 'archivado' && previa.estado !== 'documento_invalido') {
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
    // Una ficha que NO se puede rejuzgar gratis —la de la época de TusDatos,
    // o una de Sarblock sin el resultado guardado— con OTRO nombre: TusDatos
    // ya no corre, así que nadie la volvía a juzgar y el bloqueo por nombre
    // quedaba para siempre aunque el cliente corrigiera el nombre (caso
    // Mexite, 2026-10-30). Se consulta de nuevo: del padrón si está, si no
    // una consulta nueva. Solo si se sabe con qué nombre se juzgó: una ficha
    // vieja sin ese dato no dispara consultas en masa.
    const reconsultar = !!nuevo && previa.estado === 'finalizado' && !!previa.nombreInscrito && !mismoNombre(nuevo, previa.nombreInscrito)
    if (!reconsultar) return { ok: true, documento: doc, yaExistia: true }
    await auditar('sarblock.reconsulta_por_nombre', { userId: uid, documento: doc, antes: previa.nombreInscrito ?? null, ahora: nuevo, proveedorAnterior: previa.proveedor ?? 'tusdatos' })
  }
  // Lincoin Risk: otra cuenta ya consultó a esta persona en los últimos 90
  // días. Se reutiliza sin costo (y no cuenta para el tope); el nombre se
  // compara contra el oficial con lo que escribió ESTA cuenta.
  // Un NIT: la ficha nueva va por los 9 dígitos base; la de la época de
  // TusDatos quedó por el número con DV y, si no se archiva, la pantalla, el
  // envío y la bandeja siguen leyendo el veredicto viejo.
  const archivarLaConDv = async () => {
    const conDv = soloDigitos(d.documento)
    const vieja = conDv && conDv !== doc ? raw?.tusdatos?.beneficiarios?.[conDv] : null
    if (!vigenteF(vieja)) return
    await guardarFicha(uid, conDv, { ...vieja, estado: 'archivado', archivadoAt: new Date().toISOString(), motivoArchivo: `reemplazada por la consulta de Sarblock del NIT ${doc}` })
    await auditar('sarblock.ficha_con_dv_archivada', { userId: uid, documento: conDv, nit: doc })
  }
  const enPadron = forzada ? null : await padronBuscar(db, d.tipoDocumento, doc)
  if (enPadron) {
    const ficha = fichaParaCuenta(enPadron.ficha, d.nombre, { documento: doc, tipoDocumento: d.tipoDocumento, dePadron: true, padronAt: enPadron.consultado_at })
    await guardarFicha(uid, doc, conDecision(ficha, previa))
    await archivarLaConDv()
    await anotarUso(db, d.tipoDocumento, doc, uid)
    await auditar('sarblock.reutilizado', { userId: uid, documento: doc, categoria: ficha.categoria })
    await alCerrarAml(uid, doc, ficha)
    return { ok: true, documento: doc, reutilizado: true }
  }
  if (!esAdmin && await topeAgotado(uid, c)) return { ok: false, tope: true, motivo: 'Llegaste al máximo de verificaciones por hoy. Las que faltan se completan mañana.' }
  try {
    // La clave es por día: forzada, con la del día Sarblock devolvería el
    // mismo check de esta mañana. Se le agrega el momento.
    const idem = forzada ? `${claveIdempotencia(uid, doc)}-f${Date.now().toString(36)}` : claveIdempotencia(uid, doc)
    const r = await cliente().crearCheck({ purpose: 'beneficiary', subject: sujeto, idempotencia: idem })
    await guardarFicha(uid, doc, conDecision({ ...fichaLanzada({ documento: doc, tipoDocumento: d.tipoDocumento, nombre: d.nombre, checkId: r.id }) }, previa))
    await archivarLaConDv()
    await auditar('sarblock.lanzado', { userId: uid, documento: doc, checkId: r.id })
    return { ok: true, documento: doc, checkId: r.id }
  } catch (e) {
    const motivo = e instanceof ErrorSarblock ? `${e.tipo}: ${e.message}` : String((e as Error)?.message ?? e)
    // INVALID_INPUT es un dato mal inscrito: no se arregla esperando. Antes
    // quedaba en 'error' y se reintentaba ocho veces, todas iguales.
    if (e instanceof ErrorSarblock && e.tipo === 'INVALID_INPUT') {
      const texto = `${e.message}. Borra el beneficiario e inscríbelo con los datos correctos.`
      await guardarFicha(uid, doc, conDecision({ proveedor: 'sarblock', documento: doc, tipoDocumento: d.tipoDocumento, estado: 'documento_invalido', nombreInscrito: d.nombre, detalle: texto.slice(0, 300), at: new Date().toISOString() }, previa))
      await auditar('sarblock.lanzamiento_fallido', { userId: uid, documento: doc, motivo: motivo.slice(0, 300) })
      return { ok: false, documentoInvalido: true, motivo: texto }
    }
    // La ficha queda en error: "sin resultado no sale plata" la sigue
    // frenando en mouv-proxy, y el siguiente barrido la puede relanzar.
    // Se cuentan los intentos: verificar_pendientes la relanza con espera
    // creciente, y desde el octavo la pantalla dice "en revisión".
    const intentos = (previa?.estado === 'error' ? Number(previa.intentos ?? 0) : 0) + 1
    await guardarFicha(uid, doc, conDecision({ proveedor: 'sarblock', documento: doc, tipoDocumento: d.tipoDocumento, estado: 'error', nombreInscrito: d.nombre, detalle: motivo.slice(0, 300), intentos, at: new Date().toISOString() }, previa))
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
  // En pausa por el cupo, lo automático espera a la próxima vuelta.
  if (await enPausa()) return { ok: true, cerrados: 0, reintentados: 0, pausado: true }
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
      const ruesTraslado = terminado(check) ? await trasladoVigente(check, f.tipoDocumento, doc) : null
      const nueva = { ...traducir(check, { documento: doc, tipoDocumento: f.tipoDocumento, nombre: f.nombreInscrito, ruesTraslado }), lanzadoAt: f.lanzadoAt, ...(n ? { sarblockReintentos: n } : {}) }
      await guardarFicha(uid, doc, conDecision(nueva, f))
      // Al padrón: este crédito ya se pagó, que no lo pague nadie más.
      await padronGuardar(db, f.tipoDocumento, doc, nueva, uid, 'sarblock')
      await auditar('sarblock.consulta', { userId: uid, documento: doc, checkId: f.jobid, categoria: nueva.categoria, operable: nueva.operable, criterio: nueva.criterio })
      await alCerrarAml(uid, doc, nueva)
      cerrados++
    } catch (e) {
      if (e instanceof ErrorSarblock && e.status === 429) break   // la próxima vuelta
      await auditar('sarblock.lectura_fallida', { userId: uid, documento: doc, motivo: String((e as Error)?.message ?? e).slice(0, 300) })
    }
  }
  return { ok: true, cerrados, reintentados }
}

// ── Cartera en Sarblock (cartera.ts) ────────────────────────────────────
// Empresas como clientes y sus beneficiarios bajo cada una. Nada de esto
// frena la AML: si falla, queda anotado y la próxima vuelta lo reintenta.
let cfgCartera = { valor: K.POR_DEFECTO_CARTERA, leido: 0 }
async function configCartera(): Promise<K.ConfigCartera> {
  if (Date.now() - cfgCartera.leido < 30_000) return cfgCartera.valor
  cfgCartera = { valor: await K.leerConfigCartera(db), leido: Date.now() }
  return cfgCartera.valor
}
async function cuentaCartera(uid: string): Promise<any> {
  const { data } = await db.from('users').select(K.COLS_CUENTA).eq('id', uid).maybeSingle()
  return data
}
// Una AML terminada: si la empresa ya es cliente en Sarblock, el
// beneficiario queda bajo ella.
async function alCerrarAml(uid: string, doc: string, ficha: any) {
  try {
    const c = await configCartera()
    if (!c.activo || !c.beneficiarios || await enPausa()) return
    const u = await cuentaCartera(uid)
    const k = u?.sb?.kyc
    if (!K.clienteListo(k)) return
    const reg = await K.registrarBeneficiario(cliente(), db, uid, k.customerId, doc, ficha, u?.sb?.beneficiarios?.[doc])
    if (reg) await auditar(reg.id ? 'sarblock.cartera_beneficiario' : 'sarblock.cartera_beneficiario_fallido', { userId: uid, documento: doc, beneficiarioId: reg.id ?? null, error: reg.error ?? null })
  } catch (e) { console.warn('[sarblock] cartera beneficiario', String((e as Error)?.message ?? e)) }
}
// Una consulta de Risk terminada: el consultado queda como cliente en
// Sarblock. Nunca frena la consulta ni lanza otro screening.
async function alCerrarRisk(fila: any, ficha: any) {
  try {
    const c = await configCartera()
    if (!c.activo || !c.risk || !fila || await enPausa()) return
    const reg = await K.registrarClienteRisk(cliente(), db, fila, ficha)
    if (reg) await auditar(reg.id ? 'sarblock.cartera_risk' : 'sarblock.cartera_risk_fallido', { userId: fila.user_id, consultaId: fila.id, documento: fila.documento, clienteId: reg.id ?? null, existia: reg.existia ?? false, error: reg.error ?? null })
  } catch (e) { console.warn('[sarblock] cartera risk', String((e as Error)?.message ?? e)) }
}
// Una cuenta: avanza su alta (y la paga si `pagar`) y registra sus
// beneficiarios pendientes, hasta `maxBenef`.
async function carteraCuenta(uid: string, pagar: boolean, maxBenef = 25) {
  const sb = cliente()
  const u = await cuentaCartera(uid)
  if (!u) return { ok: false, motivo: 'No existe la cuenta.' }
  const tenia = !!(u.sb?.kyc?.checkId || u.sb?.kyc?.customerId)
  const k: any = await K.altaCliente(sb, db, uid, u, pagar)
  if ('motivo' in k) return { ok: false, motivo: k.motivo }
  if (!tenia) await auditar('sarblock.cartera_alta', { userId: uid, checkId: k.checkId ?? null, fase: k.fase })
  let registrados = 0, fallidos = 0
  if (K.clienteListo(k)) {
    const raw = await leerRaw(uid)
    const fichas = raw?.tusdatos?.beneficiarios ?? {}
    const regs = raw?.sarblock?.beneficiarios ?? {}
    for (const doc of K.beneficiariosPendientes(fichas, regs).slice(0, maxBenef)) {
      const r = await K.registrarBeneficiario(sb, db, uid, k.customerId, doc, fichas[doc], regs[doc])
      if (r?.id) registrados++; else if (r) fallidos++
    }
    if (registrados || fallidos) await auditar('sarblock.cartera_beneficiarios', { userId: uid, registrados, fallidos })
  }
  return { ok: true, fase: k.fase, customerId: k.customerId ?? null, error: k.error ?? null, registrados, fallidos }
}
// En el barrido: avanza lo que está en curso (gratis), da de alta las
// cuentas nuevas si la alta automática está encendida (paga) y registra
// beneficiarios pendientes. Con tope de tiempo y de cuentas.
async function carteraVuelta(hastaMs: number) {
  const c = await configCartera()
  if (!c.activo || await enPausa()) return { omitido: true }
  let avanzadas = 0, altas = 0
  // Solo las que esperan su screening (o cuya alta falló después de
  // pagarlo): el resto ya es cliente y sus beneficiarios nuevos entran al
  // cerrar su AML (alCerrarAml). Sarblock deja 60 llamadas por minuto para
  // toda la organización: no se relee la cartera entera en cada vuelta.
  const { data: enCurso } = await db.from('users').select('id')
    .in('raw_data->sarblock->kyc->>fase', ['screening', 'error']).is('raw_data->sarblock->kyc->>customerId', null)
    .in('role', K.ROLES_CLIENTE).limit(10)
  for (const u of (enCurso ?? []) as any[]) {
    if (Date.now() > hastaMs) break
    try { await carteraCuenta(u.id, false, c.beneficiarios ? 10 : 0); avanzadas++ } catch (e) { if (esLimite(e)) break }
  }
  if (c.altaAutomatica && c.altaDesde) {
    const { data: nuevas } = await db.from('users').select('id').in('role', K.ROLES_CLIENTE).in('kyc_status', K.KYC_VERIFICADO)
      .gte('created_at', c.altaDesde).is('raw_data->sarblock->kyc', null).limit(5)
    for (const u of (nuevas ?? []) as any[]) {
      if (Date.now() > hastaMs) break
      try { if ((await carteraCuenta(u.id, true)).ok) altas++ } catch (e) { if (esLimite(e)) break }
    }
  }
  return { avanzadas, altas }
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

// Si lo único que encontró Sarblock es una matrícula cancelada por traslado
// de domicilio, se busca en el RUES la matrícula nueva. Con ella vigente, el
// traductor no cuenta ese hallazgo (9 nov: empresa trasladada de
// Dosquebradas a Pereira, marcada riesgo alto). Sin respuesta del RUES: null,
// y el hallazgo cuenta como siempre.
async function trasladoVigente(check: any, tipo: string, doc: string): Promise<RuesTraslado | null> {
  if (String(tipo).toUpperCase() !== 'NIT' || !soloTrasladoRues(check?.catalog ?? [])) return null
  const m = await matriculaVigentePorNit(doc).catch(() => null)
  if (!m) { await auditar('sarblock.traslado_no_confirmado', { documento: doc }); return null }
  await auditar('sarblock.traslado_confirmado', { documento: doc, camara: m.camara, matricula: m.matricula, renovado: m.renovado })
  return { ...m, verificadoAt: new Date().toISOString() }
}

// La razón social de un NIT en el RUES, con 30 min de memoria: la pantalla
// la pide mientras se escribe y el servidor otra vez al consultar.
const razonesVistas = new Map<string, { r: Awaited<ReturnType<typeof razonSocialPorNit>>; at: number }>()
async function razonSocialRues(documento: string) {
  const d = String(documento ?? '').replace(/\D/g, '')
  const nit = d.length === 10 ? d.slice(0, 9) : d
  const v = razonesVistas.get(nit)
  if (v && Date.now() - v.at < 30 * 60_000) return v.r
  const r = await razonSocialPorNit(nit)
  razonesVistas.set(nit, { r, at: Date.now() })
  return r
}

// Cierra UNA consulta de Risk con el resultado de su check: lista, no
// verificada (se devuelve) o fallida (se devuelve). La usan la pantalla
// (risk_resultado) y el barrido. Solo cierra quien la pasa de "consultando":
// dos cierres al tiempo no devuelven dos veces.
async function cerrarConsultaRisk(cq: any, check: any) {
  const ruesTraslado = terminado(check) ? await trasladoVigente(check, cq.tipo_documento, cq.documento) : null
  const ficha = traducir(check, { documento: cq.documento, tipoDocumento: cq.tipo_documento, nombre: cq.nombre_escrito ?? undefined, ruesTraslado })
  // Una persona cuyo documento la Registraduría no encontró, sin ninguna
  // coincidencia: no hubo revisión real (no se sabe de quién serían los
  // antecedentes). Queda "no verificado" y se le devuelve la consulta.
  const noVerificado = ficha.estado === 'finalizado' && cq.tipo_persona === 'natural' && ficha.documentoNoEncontrado === true && !ficha.hallazgo
  let cambio: Record<string, unknown>
  if (ficha.estado !== 'finalizado') {
    cambio = { estado: 'fallida', actualizado_at: new Date().toISOString() }
  } else if (noVerificado) {
    cambio = { estado: 'no_verificado', ficha, categoria: ficha.categoria ?? null, operable: ficha.operable ?? null, riesgos: [], despachos: [], actualizado_at: new Date().toISOString() }
  } else {
    cambio = { estado: 'lista', ficha, nombre_oficial: ficha.nombreReal ?? null, categoria: ficha.categoria ?? null, operable: ficha.operable ?? null,
      riesgos: R.tiposDeRiesgo(ficha), despachos: R.despachos(ficha), actualizado_at: new Date().toISOString() }
  }
  // Solo quien la pasa de "consultando" la cierra: dos lecturas al tiempo
  // no devuelven dos veces.
  const { data: upd } = await db.from('risk_consultas').update(cambio).eq('id', cq.id).eq('estado', 'consultando').select('*')
  const cerrada = (upd as any[])?.[0]
  if (cerrada) {
    if (ficha.estado !== 'finalizado') await R.mover(db, cq.user_id, 'devolucion', 1, 'Consulta fallida: se devuelve la consulta', null, cq.id)
    else if (noVerificado) await R.mover(db, cq.user_id, 'devolucion', 1, 'Documento no encontrado en la Registraduría: se devuelve la consulta', null, cq.id)
    else await padronGuardar(db, cq.tipo_documento, cq.documento, ficha, cq.user_id, 'manual')
    await auditar('sarblock.risk_manual', { userId: cq.user_id, tipo: cq.tipo_documento, documento: cq.documento, deCache: false, categoria: ficha.categoria ?? null, consultaId: cq.id, estado: cambio.estado })
    if (cambio.estado === 'lista') await alCerrarRisk(cerrada, ficha)
  }
}

// Consultas de Risk que se quedaron "consultando" más de un día. Nadie las
// cerraba: si el cliente no volvía a abrirlas, la consulta pagada quedaba
// perdida. Se le pregunta a Sarblock una última vez: si terminó, se cierra
// con su resultado; si no, se da por fallida y se DEVUELVE la consulta. El
// cierre exige pasar de "consultando" (cerrarConsultaRisk y el update de
// abajo): una sola devolución aunque corran dos barridos.
async function cerrarRiskAtascadas(hasta: number): Promise<number> {
  const limite = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data } = await db.from('risk_consultas').select('*').eq('estado', 'consultando').lt('at', limite).order('at', { ascending: true }).limit(20)
  let n = 0
  for (const cq of (data ?? []) as any[]) {
    if (Date.now() > hasta) break
    let check: any = null
    if (cq.check_id) {
      try { check = await cliente().leerCheck(String(cq.check_id)) } catch (e) { if (esLimite(e)) break }
    }
    if (check && terminado(check)) { await cerrarConsultaRisk(cq, check); n++; continue }
    const { data: upd } = await db.from('risk_consultas').update({ estado: 'fallida', actualizado_at: new Date().toISOString() })
      .eq('id', cq.id).eq('estado', 'consultando').select('id')
    if ((upd as any[])?.length) {
      await R.mover(db, cq.user_id, 'devolucion', 1, 'La consulta no terminó en 24 horas: se devuelve', null, cq.id)
      await auditar('sarblock.risk_vencida', { userId: cq.user_id, consultaId: cq.id, documento: cq.documento })
      n++
    }
  }
  return n
}

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
    // Una consulta YA cerrada con la matrícula cancelada por traslado como
    // único hallazgo: se confirma la matrícula nueva en el RUES y se vuelve a
    // juzgar desde el catálogo guardado (no llama a Sarblock). También el
    // padrón, para que nadie más la reciba como riesgo alto.
    if (accion === 'admin_risk_traslado') {
      const { data: r } = await db.from('risk_consultas').select('*').eq('id', String(body.consultaId ?? '')).maybeSingle()
      const f = (r as any)?.ficha
      if (!r || !f?.sarblock?.catalog) return { ok: false, motivo: 'No existe esa consulta o no tiene el resultado guardado.' }
      if (!soloTrasladoRues(f.sarblock.catalog)) return { ok: false, motivo: 'El hallazgo de esta consulta no es solo una matrícula cancelada por traslado.' }
      const tr = await trasladoVigente({ catalog: f.sarblock.catalog }, (r as any).tipo_documento, (r as any).documento)
      if (!tr) return { ok: false, motivo: 'El RUES no muestra una matrícula vigente para este NIT. Se mantiene el resultado.' }
      const nueva = rejuzgar({ ...f, ruesTraslado: tr }, { documento: (r as any).documento, tipoDocumento: (r as any).tipo_documento, nombre: (r as any).nombre_escrito ?? undefined })
      if (!nueva) return { ok: false, motivo: 'No se pudo volver a juzgar.' }
      const cambio = { ficha: nueva, categoria: nueva.categoria ?? null, operable: nueva.operable ?? null, riesgos: R.tiposDeRiesgo(nueva), despachos: R.despachos(nueva), actualizado_at: new Date().toISOString() }
      // Todas las consultas de ese documento, no solo la abierta.
      await db.from('risk_consultas').update(cambio).eq('tipo_documento', (r as any).tipo_documento).eq('documento', (r as any).documento).eq('estado', 'lista')
      await padronGuardar(db, (r as any).tipo_documento, (r as any).documento, nueva, (r as any).user_id, 'manual')
      await auditar('sarblock.traslado_rejuzgado', { por: yo.userId, consultaId: (r as any).id, documento: (r as any).documento, antes: (r as any).categoria ?? null, ahora: nueva.categoria ?? null, camara: tr.camara, matricula: tr.matricula })
      const { data: r2 } = await db.from('risk_consultas').select('*').eq('id', (r as any).id).maybeSingle()
      return { ok: true, consulta: vista(r2 ?? r, cfg, await empresaDe((r as any).user_id)) }
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
  { const no = await sobreCuenta(req, yo, uid); if (no) return no }
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
    // Comprar descuenta PESOS del cliente: lo decide solo el titular. Antes un
    // admin podía convertir el saldo de cualquier cliente en consultas.
    if (yo.userId !== uid) return json({ error: 'Solo el titular de la cuenta puede comprar consultas.' }, 403)
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
    let nombre = String(body.nombre ?? '').trim() || undefined
    // Una empresa sin razón social escrita: se busca en el RUES por el NIT
    // ANTES de cobrar. Antes había que escribirla a mano y, sin ella, la
    // consulta de una empresa no salía (2026-11).
    if (juridica && !nombre) {
      const rues = await razonSocialRues(String(body.documento ?? ''))
      if (!rues.razonSocial) return { ok: false, motivo: 'No encontramos la razón social de ese NIT en el RUES. Escríbela para consultar. No se usó ninguna consulta.' }
      nombre = rues.razonSocial
    }
    // El tipo lo elige el cliente; si el número dice claramente otra cosa, se
    // le pregunta ANTES de cobrar (visto el 2026-10-30: un NIT consultado como
    // cédula gastó una consulta sin resultado). Si confirma, se consulta igual.
    if (body.confirmarTipo !== true) {
      const probable = R.tipoProbable(String(body.documento ?? ''))
      if (probable.seguro && !juridica && tipo === 'CC' && probable.tipo === 'empresa') {
        return { ok: false, confirmarTipo: 'empresa', nit: probable.nit, motivo: `Este número parece un NIT de empresa (${probable.nit}). Si lo consultas como cédula, la consulta se gasta sin resultado.` }
      }
      if (probable.seguro && juridica && probable.tipo === 'persona') {
        return { ok: false, confirmarTipo: 'persona', motivo: 'Este número parece una cédula de persona, no un NIT de empresa.' }
      }
    }
    const sujeto = sujetoDe(tipo, String(body.documento ?? ''), nombre)
    if (!sujeto) return { ok: false, motivo: juridica ? 'Escribe el NIT y la razón social.' : 'Revisa el tipo y el número de documento.' }
    const doc = sujeto.idNumber
    // A una persona ya consultada no se le cobra otra vez (pedido del dueño,
    // 2026-11). Leer "¿ya hay una?" no alcanza con dos pedidos al tiempo
    // (doble clic, dos operadores, dos pestañas): los dos leen "no hay" y se
    // cobran dos. El candado deja pasar a uno solo mientras se lanza; cuando
    // la fila "consultando" ya está escrita, la ve el siguiente.
    const llave = `risk:${uid}:${tipo}:${doc}`
    if (await reclamarCandado(db, llave, 90, uid, 'risk_consultar') === 'ocupado') {
      return { ok: false, motivo: 'Esa persona ya se está consultando en este momento. Espera unos segundos y vuelve a escribir su documento: no se usó ninguna consulta.' }
    }
    const lanzar = async () => {
      // Ya se está consultando (la lanzó otro operador hace un momento): se
      // espera esa, sin cobrar otra.
      // Se mira todo el DÍA (UTC), no solo 30 minutos: la clave con la que se
      // le pide el check a Sarblock es la misma todo el día, así que lanzar
      // otra vez devolvía EL MISMO check y se cobraba dos veces un resultado.
      const { data: enVuelo } = await db.from('risk_consultas').select('id').eq('user_id', uid).eq('tipo_documento', tipo).eq('documento', doc)
        .eq('estado', 'consultando').gte('at', inicioDelDiaUtc()).order('at', { ascending: false }).limit(1).maybeSingle()
      if (enVuelo) return { ok: true, enCurso: true, yaEnCurso: true, consultaId: (enVuelo as any).id, saldo: await R.saldoDe(db, uid) }
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
        await alCerrarRisk(ins, ficha)
        return { ok: true, consulta: vista(ins, cfg, await empresaDe(uid)), saldo: m.saldo }
      }
      try {
        const sb = cliente()
        if ((await conCupo(() => saldoParaConsultar(sb))) <= 0) throw new Error('caja')
        // customer_onboarding: la misma revisión y el mismo costo, y su
        // screeningRecordId sirve para dar de alta al consultado como
        // cliente en Sarblock sin pagar otra (cartera.ts).
        const r = await conCupo(() => sb.crearCheck({ purpose: 'customer_onboarding', subject: sujeto, idempotencia: `risk-${uid}-${tipo}-${doc}-${new Date().toISOString().slice(0, 10)}` }))
        const { error } = await db.from('risk_consultas').insert({ ...base, check_id: r.id, estado: 'consultando' })
        if (error) throw new Error(error.message)
        await R.anotarBusqueda(db, uid, { por, tipoDocumento: tipo, documento: doc, nombre: nombre ?? null, resultado, consultaId: id })
        await auditar('sarblock.risk_lanzado', { userId: uid, tipo, documento: doc, checkId: r.id, consultaId: id })
        return { ok: true, enCurso: true, consultaId: id, saldo: m.saldo }
      } catch (e) {
        await R.mover(db, uid, 'devolucion', 1, 'La consulta no se pudo lanzar: se devuelve', null, id)
        await auditar('sarblock.risk_fallido', { userId: uid, tipo, documento: doc, motivo: String((e as Error)?.message ?? e).slice(0, 300) })
        if (esLimite(e)) {
          const seg = Math.max(5, Math.ceil(((await pausadoHasta()) - Date.now()) / 1000))
          return { ok: false, motivo: `El servicio de consulta está recibiendo muchas solicitudes. Intenta de nuevo en ${seg} segundos. No se usó ninguna consulta.` }
        }
        return { ok: false, motivo: 'No se pudo consultar en este momento. Intenta de nuevo en unos minutos. No se usó ninguna consulta.' }
      }
    }
    try { return await lanzar() } finally { await soltarCandado(db, llave) }
  }

  if (accion === 'risk_resultado') {
    const { data: q } = await db.from('risk_consultas').select('*').eq('id', String(body.consultaId ?? '')).eq('user_id', uid).maybeSingle()
    if (!q) return { ok: false, motivo: 'No existe esa consulta.' }
    const cq = q as any
    if (cq.estado !== 'consultando') return { ok: true, consulta: vista(cq, cfg, await empresaDe(uid)), saldo: await R.saldoDe(db, uid) }
    // La pantalla pregunta cada pocos segundos: en pausa se le dice que siga
    // esperando sin gastar cupo.
    if (await enPausa()) return { ok: true, enCurso: true, consultaId: cq.id }
    let check: any
    try { check = await cliente().leerCheck(String(cq.check_id)) } catch (e) {
      if (esLimite(e)) return { ok: true, enCurso: true, consultaId: cq.id }
      throw e
    }
    if (!terminado(check)) return { ok: true, enCurso: true, consultaId: cq.id }
    await cerrarConsultaRisk(cq, check)
    const { data: final } = await db.from('risk_consultas').select('*').eq('id', cq.id).single()
    return { ok: true, consulta: vista(final, cfg, await empresaDe(uid)), saldo: await R.saldoDe(db, uid) }
  }
  // Mientras se escribe un NIT: la razón social del RUES, para no tener que
  // escribirla. No gasta consultas (es información pública del registro).
  if (accion === 'risk_razon_social') {
    const r = await razonSocialRues(String(body.documento ?? ''))
    return { ok: true, razonSocial: r.razonSocial, estado: r.estado }
  }

  // Mientras se escribe la cédula: ¿ya está consultada? (no gasta, no anota)
  // Para no consultar dos veces a la misma persona se mira también el mismo
  // número con OTRO tipo (una cédula consultada como CC y ahora escrita como
  // CE, o una empresa buscada como persona): se avisa, y quien consulta
  // decide si es la misma. Y si se está consultando ahora mismo, se dice.
  if (accion === 'risk_existente') {
    const tipo = body.tipoPersona === 'juridica' ? 'NIT' : String(body.tipoDocumento ?? 'CC').toUpperCase()
    const s = sujetoDe(tipo, String(body.documento ?? ''), tipo === 'NIT' ? 'x' : undefined)
    if (!s) return { ok: true, existe: false }
    const { data } = await db.from('risk_consultas').select(R.COLS).eq('user_id', uid).eq('documento', s.idNumber)
      .in('estado', ['lista', 'consultando']).order('at', { ascending: false }).limit(20)
    const filas = (data ?? []) as any[]
    const reciente = Date.parse(inicioDelDiaUtc())
    const mismo = filas.find(r => r.estado === 'lista' && r.tipo_documento === tipo)
    const enCurso = filas.find(r => r.estado === 'consultando' && r.tipo_documento === tipo && Date.parse(r.at) >= reciente)
    const otro = filas.find(r => r.estado === 'lista' && r.tipo_documento !== tipo)
    if (enCurso) return { ok: true, existe: false, enCurso: { id: enCurso.id, at: enCurso.at, por: enCurso.por } }
    if (mismo) return { ok: true, existe: true, consulta: vista(mismo, cfg) }
    if (otro) return { ok: true, existe: true, otroTipo: true, consulta: vista(otro, cfg) }
    return { ok: true, existe: false }
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
    accionEnCurso = accion
    const uid = String(body.userId ?? yo.userId ?? '')

    // ── Barrido programado (pg_cron, cada 5 min) ─────────────────────────
    // Recoge lo que quedó en curso de las cuentas con consultas recientes,
    // sin depender de que alguien tenga la pantalla abierta.
    if (accion === 'barrido') {
      if (!yo.servicio && !(await traeSecretoDeLaBase(req, db))) return json({ error: 'No autorizado' }, 401)
      const c = await leerConfig()
      if (!c.activo) return json({ ok: true, omitido: 'apagado' })
      if (await enPausa()) return json({ ok: true, omitido: 'pausa por el cupo de Sarblock' })
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
      let riskCerradas = 0
      try { riskCerradas = await cerrarRiskAtascadas(inicio + 120_000) } catch (e) { console.warn('[sarblock] barrido risk', String((e as Error)?.message ?? e)) }
      let cartera: unknown = null
      try { cartera = await carteraVuelta(inicio + 130_000) } catch (e) { console.warn('[sarblock] barrido cartera', String((e as Error)?.message ?? e)) }
      return json({ ok: true, cuentas: cuentas.length, cerrados, riskCerradas, cartera })
    }

    if (accion === 'estado') {
      { const no = await sobreCuenta(req, yo, uid); if (no) return no }
      const c = await leerConfig()
      const raw = await leerRaw(uid)
      const benefs: Record<string, any> = {}
      for (const [k, f] of Object.entries(raw?.tusdatos?.beneficiarios ?? {})) benefs[k] = verFicha(f, yo.esAdmin)
      return json({ ok: true, activo: c.activo, enLaPrueba: enLaPrueba(c, uid), proveedor: 'sarblock', beneficiarios: benefs })
    }

    if (accion === 'verificar_beneficiario') {
      { const no = await sobreCuenta(req, yo, uid); if (no) return no }
      const c = await leerConfig()
      if (!c.activo || !enLaPrueba(c, uid)) return json({ ok: true, omitido: 'Sarblock no está activo para esta cuenta' })
      if (!yo.esAdmin && !docEnContactos(await leerRaw(uid), String(body.documento ?? ''))) return json({ ok: false, motivo: 'Ese documento no es de un beneficiario inscrito.' }, 403)
      return json(await lanzar(uid, { documento: String(body.documento ?? ''), tipoDocumento: String(body.tipoDocumento ?? 'CC'), nombre: body.nombre }, c, yo.esAdmin, body.forzar === true))
    }

    if (accion === 'verificar_pendientes') {
      { const no = await sobreCuenta(req, yo, uid); if (no) return no }
      const c = await leerConfig()
      if (!c.activo || !enLaPrueba(c, uid)) return json({ ok: true, omitido: 'Sarblock no está activo para esta cuenta', pendientes: 0 })
      // Lo lanza un sondeo automático: en pausa espera a la próxima vuelta.
      if (await enPausa()) return json({ ok: true, omitido: 'pausa por el cupo de Sarblock', pausado: true })
      const raw = await leerRaw(uid)
      const fichas = raw?.tusdatos?.beneficiarios ?? {}
      const contactos: any[] = Array.isArray(raw?.mouvContacts) ? raw.mouvContacts : []
      const limite = Math.max(1, Math.min(10, Number(body.limite ?? 4) || 4))
      // Un NIT con DV pegado tiene su ficha por los 9 dígitos base. Si en una
      // de las dos llaves quedó una ficha ARCHIVADA (la del beneficiario
      // borrado) y en la otra la vigente, manda la vigente.
      const fichaDe = (x: any) => fichaQueManda(fichas[soloDigitos(x.docNumber)], fichas[docPadron(String(x.docNumber), String(x.docType ?? 'CC'))])
      // Ficha con OTRO nombre que el inscrito: se borró y se volvió a
      // inscribir corregido. lanzar() la vuelve a juzgar (gratis si es de
      // Sarblock; con una consulta nueva si es de la época de TusDatos). Si
      // otro contacto con el mismo documento sí tiene el nombre de la ficha,
      // no se toca (si no, dos contactos se la quitarían cada vuelta).
      const renombrado = (x: any) => {
        const f = fichaDe(x)
        if (!f || f.estado !== 'finalizado' || !x.name || mismoNombre(x.name, f.nombreInscrito)) return false
        // Las de TusDatos solo si se sabe con qué nombre se juzgaron.
        if (f.proveedor !== 'sarblock' && !f.nombreInscrito) return false
        const d = soloDigitos(x.docNumber)
        return !contactos.some((o: any) => soloDigitos(o?.docNumber) === d && mismoNombre(o?.name, f.nombreInscrito))
      }
      // Una ficha en error (el lanzamiento falló: Sarblock caído, sin saldo,
      // un timeout) se relanza sola. Antes no entraba aquí ni en el barrido:
      // quedaba en "SIN RESULTADO" para siempre con Enviar apagado, aunque la
      // pantalla dijera que se estaba reintentando (caso Ider Luna,
      // 2026-11-05). Espera creciente (5, 10, 20… min, tope 6 h) para no
      // martillar a Sarblock, y desde el octavo intento queda para
      // Cumplimiento. Un error de Sarblock no cobra el crédito.
      const errorVencido = (f: any) => {
        if (f?.estado !== 'error') return false
        const n = Number(f.intentos ?? 1)
        if (n >= 8) return false
        const espera = Math.min(5 * 60_000 * 2 ** (n - 1), 6 * 3600_000)
        return Date.now() - (Date.parse(f.at) || 0) >= espera
      }
      // Archivada = la de un beneficiario borrado; si vuelve a estar inscrito
      // se retoma (del padrón, sin costo, si sigue vigente).
      const faltan = contactos.filter(x => x?.accountKind !== 'wallet' && soloDigitos(x?.docNumber)
        && (!fichaDe(x) || fichaDe(x).estado === 'archivado' || errorVencido(fichaDe(x)) || renombrado(x)))
      let lanzados = 0, tope = false
      for (const x of faltan.slice(0, limite)) {
        const r: any = await lanzar(uid, { documento: String(x.docNumber), tipoDocumento: String(x.docType ?? 'CC'), nombre: x.name }, c, yo.esAdmin)
        if (r.tope) { tope = true; break }
        if (r.ok && !r.yaExistia) lanzados++
      }
      return json({ ok: true, lanzados, pendientes: Math.max(0, faltan.length - limite), ...(tope ? { tope: true } : {}) })
    }

    if (accion === 'recoger_pendientes') {
      { const no = await sobreCuenta(req, yo, uid); if (no) return no }
      return json(await recoger(uid))
    }

    if (accion === 'hallazgos') {
      // Sarblock trae el catálogo entero en la misma respuesta: el detalle ya
      // está en la ficha. Las fichas viejas de TusDatos se leen igual.
      { const no = await sobreCuenta(req, yo, uid); if (no) return no }
      const f = (await leerRaw(uid))?.tusdatos?.beneficiarios?.[soloDigitos(body.documento)]
      return json(f ? { ok: true, hallazgos: f.hallazgos ?? [], deCache: true } : { ok: false, motivo: 'No hay consulta guardada para ese documento.' })
    }

    if (accion === 'archivar_beneficiario') {
      // Se archiva, no se borra: el resultado queda para cumplimiento.
      { const no = await sobreCuenta(req, yo, uid); if (no) return no }
      // Un NIT llega con el DV pegado y la ficha está por los 9 dígitos base:
      // sin esto no se archivaba, y al volver a inscribirlo se reutilizaba
      // la ficha vieja con el nombre viejo.
      // Se archivan LAS DOS si están: la de la época de TusDatos (con DV) y
      // la de Sarblock (base). Con una sola, la otra seguía mandando.
      const rawArch = await leerRaw(uid)
      const fichas = rawArch?.tusdatos?.beneficiarios ?? {}
      // Archivar abre la puerta a borrar el contacto (la base solo protege los
      // de ficha 'finalizado'). Se puede a propósito —un beneficiario inscrito
      // con el tipo de documento equivocado tiene que poder corregirse—, pero
      // si la ficha era de riesgo ALTO o documento no vigente, sus datos
      // bancarios no se pueden perder con el contacto: van copiados en la
      // ficha archivada, para Cumplimiento.
      const d0 = soloDigitos(body.documento)
      const contactosDelDoc = (Array.isArray(rawArch?.mouvContacts) ? rawArch.mouvContacts : [])
        .filter((x: any) => { const c = soloDigitos(x?.docNumber); return !!c && (c === d0 || c.slice(0, -1) === d0 || d0.slice(0, -1) === c) })
        .slice(0, 5)
      for (const doc of new Set([d0, normDoc(body.documento)])) {
        const f = doc ? fichas[doc] : null
        if (!vigenteF(f)) continue
        const sensible = f?.categoria === 'alto' || f?.documentoVigente === false || f?.operable === false
        await guardarFicha(uid, doc, { ...f, estado: 'archivado', archivadoAt: new Date().toISOString(), motivoArchivo: String(body.motivo ?? '').slice(0, 300) || null,
          archivadoPor: yo.userId ?? 'servidor', ...(sensible && contactosDelDoc.length ? { contactosArchivados: contactosDelDoc } : {}) })
        if (sensible) await auditar('sarblock.beneficiario_sensible_archivado', { userId: uid, por: yo.userId ?? null, documento: doc, categoria: f?.categoria ?? null, documentoVigente: f?.documentoVigente ?? null, contactos: contactosDelDoc.length })
      }
      return json({ ok: true })
    }

    // ── Lincoin Risk prepago (risk.ts) ───────────────────────────────────
    if (accion.startsWith('risk_') || accion.startsWith('admin_risk_') || accion === 'admin_sarblock_uso') { const r = await risk(req, yo, uid, accion, body); return r instanceof Response ? r : json(r) }

    // ── Cartera en Sarblock (cartera.ts) ─────────────────────────────────
    if (accion.startsWith('cartera_')) {
      const no = await exigirAdmin(req, yo); if (no) return no
      if (accion === 'cartera_config_get') return json({ ok: true, config: await K.leerConfigCartera(db) })
      if (accion === 'cartera_config_set') {
        const previa = await K.leerConfigCartera(db)
        const nueva = K.normalizarConfigCartera(previa, body.config ?? {})
        const { error } = await db.from('system_config').upsert({ key: K.CONFIG_KEY_CARTERA, value: JSON.stringify(nueva) }, { onConflict: 'key' })
        if (error) return json({ ok: false, motivo: 'No se pudo guardar la configuración.' })
        cfgCartera = { valor: nueva, leido: Date.now() }
        await auditar('sarblock.cartera_config', { por: yo.userId, antes: previa, despues: nueva })
        return json({ ok: true, config: nueva })
      }
      // Las cuentas verificadas con su estado en Sarblock. Solo lectura.
      if (accion === 'cartera_lista') {
        const pagina = Math.max(1, Number(body.pagina) || 1), porPagina = 50
        // Sin las fichas AML (pesan: traen el catálogo de cada consulta).
        let q = db.from('users').select(K.COLS_CUENTA, { count: 'exact' })
          .in('role', K.ROLES_CLIENTE).in('kyc_status', K.KYC_VERIFICADO)
        const texto = String(body.q ?? '').trim().replace(/[%,()]/g, '')
        if (texto) q = q.or(`company_name.ilike.%${texto}%,full_name.ilike.%${texto}%,email.ilike.%${texto}%,tax_id.ilike.%${texto}%,doc_number.ilike.%${texto}%`)
        if (body.filtro === 'sin') q = q.is('raw_data->sarblock->kyc', null)
        else if (body.filtro === 'con') q = q.not('raw_data->sarblock->kyc', 'is', null)
        const { data, count, error } = await q.order('created_at', { ascending: false }).range((pagina - 1) * porPagina, pagina * porPagina - 1)
        if (error) return json({ ok: false, motivo: 'No se pudo leer la cartera.' })
        const filas = ((data ?? []) as any[]).map(u => {
          const k = u.sb?.kyc ?? null, regs = u.sb?.beneficiarios ?? {}
          const d = K.datosDeCuenta(u)
          return { id: u.id, nombre: u.company_name || u.rdEmpresa || u.full_name || u.name || u.email, documento: u.tax_id || u.rdNit || u.doc_number || null,
            tipo: u.role === 'business' ? 'juridica' : 'natural', creado: u.created_at,
            sarblock: k ? { fase: k.fase, customerId: k.customerId ?? null, nivel: k.nivel ?? null, estado: k.clienteStatus ?? null, error: k.error ?? null, actualizado: k.actualizado ?? null } : null,
            faltaDato: 'motivo' in d ? d.motivo : null,
            beneficiarios: { registrados: Object.values(regs).filter((r: any) => r?.id).length,
              conError: Object.values(regs).filter((r: any) => !r?.id && r?.error).length } }
        })
        return json({ ok: true, total: count ?? 0, pagina, paginas: Math.max(1, Math.ceil((count ?? 0) / porPagina)), filas })
      }
      // Dar de alta (o avanzar) UNA cuenta. Si no tiene proceso, COBRA un
      // crédito: la pantalla lo confirma antes.
      if (accion === 'cartera_alta') {
        if (!uid) return json({ ok: false, motivo: 'Falta la cuenta.' })
        if (body.confirmado !== true) return json({ ok: false, motivo: 'Confirma que se gasta una consulta de Sarblock.' })
        const r = await carteraCuenta(uid, true)
        await auditar('sarblock.cartera_alta_manual', { por: yo.userId, userId: uid, ...r })
        return json(r)
      }
      // Lote: las cuentas verificadas que aún no están en Sarblock, hasta 20
      // por vez (cada una cobra un crédito).
      if (accion === 'cartera_alta_lote') {
        if (body.confirmado !== true) return json({ ok: false, motivo: 'Confirma cuántas consultas de Sarblock se gastan.' })
        const cantidad = Math.max(1, Math.min(20, Math.floor(Number(body.cantidad) || 0)))
        const { data: sin } = await db.from('users').select(K.COLS_CUENTA).in('role', K.ROLES_CLIENTE).in('kyc_status', K.KYC_VERIFICADO)
          .is('raw_data->sarblock->kyc', null).order('created_at', { ascending: true }).limit(cantidad * 2)
        let lanzadas = 0, omitidas = 0
        const errores: { id: string; motivo: string }[] = []
        const inicio = Date.now()
        for (const u of (sin ?? []) as any[]) {
          if (lanzadas >= cantidad || Date.now() - inicio > 100_000) break
          if ('motivo' in K.datosDeCuenta(u)) { omitidas++; continue }
          try {
            const r = await carteraCuenta(u.id, true)
            if (r.ok) lanzadas++; else errores.push({ id: u.id, motivo: String(r.motivo ?? '') })
          } catch (e) { if (esLimite(e)) break; errores.push({ id: u.id, motivo: String((e as Error)?.message ?? e).slice(0, 160) }) }
        }
        await auditar('sarblock.cartera_lote', { por: yo.userId, pedidas: cantidad, lanzadas, omitidas, errores: errores.length })
        return json({ ok: true, lanzadas, omitidas, errores })
      }
      // Las consultas de Risk ya hechas (últimos 3 meses: después Sarblock
      // ya no acepta el screening para el alta). No lanza screenings: si
      // Sarblock no acepta la consulta vieja, queda anotado.
      if (accion === 'cartera_risk_lote') {
        const desde = new Date(Date.now() - 88 * 86400_000).toISOString()
        const { data: filas } = await db.from('risk_consultas').select('id, user_id, tipo_persona, tipo_documento, documento, nombre_escrito, nombre_oficial, ficha')
          .eq('estado', 'lista').gte('at', desde).is('ficha->sarblockCliente', null).order('at', { ascending: false }).limit(40)
        let registrados = 0, existian = 0, fallidos = 0
        const inicio = Date.now()
        for (const f of (filas ?? []) as any[]) {
          if (Date.now() - inicio > 100_000) break
          try {
            const r = await K.registrarClienteRisk(cliente(), db, f, f.ficha)
            if (r?.existia) existian++; else if (r?.id) registrados++; else if (r) fallidos++
          } catch (e) { if (esLimite(e)) break; fallidos++ }
        }
        await auditar('sarblock.cartera_risk_lote', { por: yo.userId, revisadas: (filas ?? []).length, registrados, existian, fallidos })
        return json({ ok: true, revisadas: (filas ?? []).length, registrados, existian, fallidos })
      }
      // Avanzar y registrar beneficiarios de una cuenta que ya está (gratis).
      if (accion === 'cartera_avanzar') {
        if (!uid) return json({ ok: false, motivo: 'Falta la cuenta.' })
        return json(await carteraCuenta(uid, false))
      }
      return json({ error: `Acción desconocida: ${accion}` }, 400)
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
