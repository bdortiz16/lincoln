// ════════════════════════════════════════════════════════
// otc-mesa — cierres de la Mesa OTC manual y su conversacion.
//
// QUE ES
//   La mesa automatica (riel ACH) convierte sola. Esta es la MANUAL: el
//   cliente pide un cierre, la mesa confirma a que tasa lo toma, se dan
//   instrucciones de pago, el cliente paga, la mesa libera. Todo eso se
//   conversa, y la conversacion vive pegada a la orden.
//
// POR QUE TODO PASA POR ACA Y NO POR PostgREST
//   Las dos tablas estan cerradas a anon y authenticated. La app Empresas usa
//   auth propia y llama con la anon key, asi que dejar las tablas abiertas por
//   RLS significaria confiar en un user_id que viaja en el body. Aca se valida
//   el caller y se filtra por dueno en cada lectura.
//
// LO QUE EL CLIENTE NUNCA VE
//   notas_internas y el margen de la tasa. `cotizar` devuelve la tasa YA
//   ajustada (la misma que se le va a aplicar), nunca la bruta del proveedor.
//
// UNA COTIZACION NO ES UN PRECIO CERRADO
//   `rate_cotizada` es lo que el cliente vio al pedir. `rate_final` es lo que
//   la mesa toma. Se guardan separadas porque no son lo mismo: la operacion
//   tarda minutos y se negocia, y decirle al cliente que el numero de la
//   pantalla es el de ejecucion seria prometer algo que no se sostiene.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
//          (todos automaticos en Supabase)
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { equipoPermite } from '../_shared/equipo.ts'
import { requireMfaSession, igualSeguro } from '../_shared/admin-auth.ts'
import { nombreCuenta } from '../_shared/nombre-cuenta.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })

const PROJECT_REF = (() => { try { return new URL(SUPABASE_URL).hostname.split('.')[0] } catch { return '' } })()

// ─── Estados ────────────────────────────────────────────
// El orden importa: es el que ordena la bandeja y el que decide que
// transiciones son legales.
// 'anulada' = un cierre COMPLETADO que la mesa anuló después (admin-data
// otc_anular_cierre: le descuenta al cliente lo acreditado). Es final: no se
// reabre, no se le sube comprobante ni se vuelve a completar.
const ESTADOS = ['abierta', 'en_proceso', 'esperando_pago', 'pagada', 'completada', 'cancelada', 'anulada'] as const
type Estado = typeof ESTADOS[number]

// Estados en los que la operacion sigue viva. Se usa para el badge del panel
// y para impedir que se creen cierres nuevos sin limite.
const VIVOS: Estado[] = ['abierta', 'en_proceso', 'esperando_pago', 'pagada']

// Cuantos cierres abiertos puede tener una misma cuenta a la vez. No es una
// regla de riesgo, es de operacion: sin tope, un cliente puede tapar la
// bandeja con veinte solicitudes y la mesa deja de ver las reales.
const MAX_VIVOS_POR_CLIENTE = 5

// ─── Validacion del caller ──────────────────────────────
// Mismo patron que finity-proxy:
//   0) service_role  → llamada interna
//   a) JWT real de Supabase → identidad PROBADA; admin si users.role='admin'
//   b) anon key + user_id existente → medio-auth, solo acciones de cliente
function isProjectAnonKey(jwt: string): boolean {
  if (ANON_KEY && jwt === ANON_KEY) return true
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const p = JSON.parse(atob(b64))
    const ref = String(p.ref ?? '') || String(p.iss ?? '')
    return p.role === 'anon' && (!PROJECT_REF || ref.includes(PROJECT_REF))
  } catch { return false }
}

type Caller = { ok: boolean; userId?: string; admin?: boolean; viaJwt?: boolean; nombre?: string }

async function validCaller(req: Request, payload: Record<string, unknown>): Promise<Caller> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { ok: false }

  // Tiempo constante: con === el tiempo de respuesta delata cuántos
  // caracteres de la llave de servicio van bien.
  if (SERVICE_KEY && igualSeguro(jwt, SERVICE_KEY)) {
    return { ok: true, userId: String(payload.user_id ?? '') || undefined, admin: true, viaJwt: true, nombre: 'Sistema' }
  }

  const { data } = await db.auth.getUser(jwt)
  if (data?.user) {
    const { data: prof } = await db.from('users').select('role, full_name, email').eq('id', data.user.id).maybeSingle()
    // Ser admin no alcanza: la mesa OTC mueve plata, y del equipo solo la
    // opera quien tiene 'plata.mover' (Operaciones y el dueño). Tesorería no.
    // El colaborador, con la casilla de Cierres OTC ('fn.otc').
    // Y la sesión tiene que haber pasado el 2FA: completar un cierre acredita
    // saldo, y con solo la contraseña del admin se podía.
    const admin = String((prof as any)?.role ?? '') === 'admin'
      && (await equipoPermite(db, data.user.id, ['plata.mover', 'fn.otc'], { email: (prof as any)?.email ?? data.user.email ?? null })).ok
      && !(await requireMfaSession(db, req, data.user.id))
    return {
      ok: true, userId: data.user.id, admin, viaJwt: true,
      nombre: (prof as any)?.full_name ?? (prof as any)?.email ?? 'Mesa Lincoin',
    }
  }

  if (isProjectAnonKey(jwt)) {
    const uid = String(payload.user_id ?? '')
    if (!uid) return { ok: false }
    const { data: u } = await db.from('users').select('id, full_name, email').eq('id', uid).maybeSingle()
    if (u) return { ok: true, userId: uid, viaJwt: false, nombre: (u as any).full_name ?? (u as any).email ?? null }
  }
  return { ok: false }
}

// ─── Tasa ───────────────────────────────────────────────
// Margen de la mesa manual, en POR CIENTO sobre el precio de referencia.
//
// NO hay margen global configurable: el margen de la mesa manual se pacta POR
// CLIENTE. Lo de aca es solo el valor con el que arranca una cuenta a la que
// todavia no se le puso el suyo, para no dejarla sin margen por olvido.
const MARGEN_KEY = 'otc_manual_config'   // la clave sigue viva: guarda el plazo
const MARGEN_DEFAULT = 0.5
// Tope de cordura: un margen mal escrito (25 en vez de 0,25) no puede quedarse
// con la cuarta parte de la operacion sin que nadie lo note.
const MARGEN_MAX = 5

// Minutos que tiene el cliente para pagar y subir el comprobante desde que la
// mesa fija la tasa. Una tasa acordada no se sostiene indefinidamente mientras
// el mercado se mueve.
const VENTANA_DEFAULT = 5
const VENTANA_MIN = 2      // menos que esto no alcanza ni para abrir el banco
const VENTANA_MAX = 120

// ─── Horario de la mesa ─────────────────────────────────────
// La mesa manual la atienden PERSONAS. Fuera de hora no hay quien cotice ni
// quien libere, y una solicitud creada un domingo a las once de la noche se
// queda con el plazo de pago corriendo contra nadie: al cliente se le vence
// sola y queda pensando que el servicio anda mal.
//
// Por eso el horario se DECLARA y se hace valer EN EL SERVIDOR. Esconder el
// boton no alcanza: una pestana abierta desde el viernes lo sigue teniendo, y
// una pestana vieja no es permiso para abrir la mesa.
//
// La hora es la de Colombia. Comparar contra la hora del navegador seria dejar
// que el reloj del cliente decida si la mesa esta abierta.
const TZ_MESA = 'America/Bogota'
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const
const DIA_NOMBRE: Record<string, string> = {
  // Con tildes: el cliente lo lee en "Vuelve a abrir el miércoles…".
  dom: 'domingo', lun: 'lunes', mar: 'martes', mie: 'miércoles',
  jue: 'jueves', vie: 'viernes', sab: 'sábado',
}
type Franja = { activo: boolean; desde: string; hasta: string }
// Por defecto: lunes a viernes 8-18, sabado 9-13, domingo cerrado. Es un punto
// de partida razonable, no una decision: se edita desde el panel.
const HORARIO_DEFAULT: Record<string, Franja> = {
  lun: { activo: true,  desde: '08:00', hasta: '18:00' },
  mar: { activo: true,  desde: '08:00', hasta: '18:00' },
  mie: { activo: true,  desde: '08:00', hasta: '18:00' },
  jue: { activo: true,  desde: '08:00', hasta: '18:00' },
  vie: { activo: true,  desde: '08:00', hasta: '18:00' },
  sab: { activo: true,  desde: '09:00', hasta: '13:00' },
  dom: { activo: false, desde: '09:00', hasta: '13:00' },
}

const esHora = (v: unknown): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? ''))
const aMin = (hhmm: string): number => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

function normalizarHorario(v: any): Record<string, Franja> {
  const out: Record<string, Franja> = { ...HORARIO_DEFAULT }
  if (!v || typeof v !== 'object') return out
  for (const d of DIAS) {
    const f = v[d]
    if (!f || typeof f !== 'object') continue
    const desde = esHora(f.desde) ? String(f.desde) : HORARIO_DEFAULT[d].desde
    const hasta = esHora(f.hasta) ? String(f.hasta) : HORARIO_DEFAULT[d].hasta
    out[d] = { activo: !!f.activo, desde, hasta }
  }
  return out
}

async function horarioMesa(): Promise<Record<string, Franja>> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', MARGEN_KEY).maybeSingle()
    const v = data?.value ? JSON.parse(data.value) : null
    return normalizarHorario(v?.horario)
  } catch { return { ...HORARIO_DEFAULT } }
}

// Que dia y que hora es AHORA en Colombia, sin depender de la zona del server.
function ahoraEnBogota(): { dia: string; min: number; hhmm: string } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MESA, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => f.find(p => p.type === t)?.value ?? ''
  const mapa: Record<string, string> = { Sun: 'dom', Mon: 'lun', Tue: 'mar', Wed: 'mie', Thu: 'jue', Fri: 'vie', Sat: 'sab' }
  const dia = mapa[get('weekday')] ?? 'lun'
  // A medianoche este formato devuelve "24": es el mismo instante que las 00.
  const h = get('hour') === '24' ? 0 : Number(get('hour'))
  const m = Number(get('minute'))
  return { dia, min: h * 60 + m, hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
}

type EstadoMesa = { abierta: boolean; dia: string; hhmm: string; hoy: Franja | null; proxima: string | null }

async function estadoMesa(): Promise<EstadoMesa> {
  const hor = await horarioMesa()
  const { dia, min, hhmm } = ahoraEnBogota()
  const hoy = hor[dia] ?? null
  const abierta = !!hoy?.activo && min >= aMin(hoy.desde) && min < aMin(hoy.hasta)

  // Cuando vuelve a abrir. Decir "cerrado" sin decir hasta cuando obliga a
  // escribir para preguntar algo que la pantalla ya sabe.
  let proxima: string | null = null
  if (!abierta) {
    const i = DIAS.indexOf(dia as any)
    for (let k = 0; k < 8; k++) {
      const d = DIAS[(i + k) % 7]
      const f = hor[d]
      if (!f?.activo) continue
      // Hoy solo sirve si todavia no paso la hora de apertura.
      if (k === 0 && min >= aMin(f.desde)) continue
      proxima = k === 0 ? `hoy a las ${f.desde}`
        : k === 1 ? `mañana a las ${f.desde}`
        : `el ${DIA_NOMBRE[d]} a las ${f.desde}`
      break
    }
  }
  return { abierta, dia, hhmm, hoy, proxima }
}

async function ventanaPago(): Promise<number> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', MARGEN_KEY).maybeSingle()
    const v = data?.value ? JSON.parse(data.value) : null
    const n = Number(v?.ventanaMin)
    if (Number.isFinite(n) && n >= VENTANA_MIN && n <= VENTANA_MAX) return n
    return VENTANA_DEFAULT
  } catch { return VENTANA_DEFAULT }
}

// Cancela los cierres a los que se les vencio el plazo. Se ejecuta al leer, no
// por cron: asi no hace falta infraestructura extra y el estado que se muestra
// siempre esta al dia con el reloj.
//
// VENCIDO NO SIGNIFICA QUE NO PAGO. Puede haber enviado el dinero sobre la hora
// y no haber llegado a subir el comprobante. Por eso el mensaje que queda le
// dice que escriba, y el hilo sigue abierto.
async function caducarVencidos(): Promise<void> {
  try {
    const { data } = await db.from('otc_closes')
      .update({
        status: 'cancelada', cancelada_at: ahora(), updated_at: ahora(),
        motivo_cierre: 'Venció el plazo para subir el comprobante',
      })
      .eq('status', 'esperando_pago')
      .lt('vence_at', ahora())
      .select('id')
    for (const c of data ?? []) {
      await escribirMensaje((c as any).id, 'sistema',
        'Se venció el plazo para subir el comprobante y la solicitud quedó cancelada. '
        + 'Si YA enviaste el dinero, escribe por aquí antes de montar otra: la mesa lo verifica y lo resuelve sobre esta misma solicitud.')
    }
  } catch { /* nunca frena la lectura */ }
}

// El margen que le toca a ESTE cliente.
//
// CERO ES UN VALOR, NO UN VACIO. Un cliente con 0% de comision tiene que pagar
// 0%: si se resolviera con `??` sobre un numero que puede ser 0, o con un `||`,
// el cero caeria al valor por defecto y se le cobraria un margen que nadie le
// nego.
// raw_data.otcConfig lo escribe SOLO el servidor/admin: la migración de
// blindaje lo agrega a las claves protegidas de raw_data. Mientras no esté
// corrida, un cliente podría ponerse su propio margen; por eso este número se
// toma de la base y nunca del pedido.
async function margenDe(userId?: string): Promise<number> {
  if (userId) {
    try {
      const { data } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
      const cfg = (data as any)?.raw_data?.otcConfig ?? {}
      const n = Number(cfg.manualPct)
      if (Number.isFinite(n) && n >= 0 && n <= MARGEN_MAX) return n
    } catch { /* cae al valor por defecto */ }
  }
  return MARGEN_DEFAULT
}

// La forma exacta del JSON de Finity cambia segun la ruta que responda, asi
// que se prueban las rutas conocidas. Es el MISMO extractor que usa el resto
// de la app (FinitySection.extractRate): tener dos criterios distintos para
// leer la misma respuesta es como esta pantalla se quedo sin tasa.
function extractRate(d: any): number | null {
  if (d == null) return null
  const cand = d.rate ?? d.value ?? d.price ?? d.cop ?? d.exchange_rate ?? d.exchangeRate
    ?? d.data?.rate ?? d.data?.value ?? d.data?.price
    ?? (Array.isArray(d) ? (d[0]?.rate ?? d[0]?.value) : undefined)
    ?? (Array.isArray(d?.data) ? (d.data[0]?.rate ?? d.data[0]?.value) : undefined)
  const n = Number(cand)
  return Number.isFinite(n) && n > 0 ? n : null
}

type Cotizacion = {
  referencia: number | null    // la tasa de referencia que ve el cliente
  rate: number | null          // el que se le aplica al cliente (referencia - margen)
  margenPct: number
  // Pesos que el proveedor ya trae restados para llegar a la referencia. Viaja
  // para que el GRAFICO pueda dibujar la misma serie: los snapshots guardan la
  // tasa bruta, y sin esto el grafico y la referencia mostraban dos numeros
  // distintos para lo mismo en la misma pantalla.
  ajusteCop: number
  fuente: string
  motivo?: string
  crudo?: string               // solo para admin, cuando no hubo tasa
}

// Una tasa ausente NO es una tasa de cero ni una cotizacion en blanco. Si el
// proveedor no responde, el cierre se puede pedir igual (la mesa lo cotiza a
// mano) pero se guarda SIN tasa y se dice por que — no se inventa un numero
// que despues alguien va a leer como un precio acordado.
// Como mucho un punto cada 20 s: con varias pantallas abiertas cotizando cada
// minuto, sin esto la tabla se llena de puntos repetidos. Nunca frena la
// cotización: si no se puede guardar, se cotiza igual.
async function anotarPuntoTasa(bruta: number) {
  if (!(bruta > 0)) return
  try {
    const { data: ult } = await db.from('fx_rate_snapshots').select('captured_at')
      .eq('from_currency', 'USD').eq('to_currency', 'COP').eq('source', 'FINITY')
      .order('captured_at', { ascending: false }).limit(1).maybeSingle()
    const hace = ult?.captured_at ? Date.now() - new Date(String(ult.captured_at)).getTime() : Infinity
    if (hace < 20_000) return
    await db.from('fx_rate_snapshots').insert({ from_currency: 'USD', to_currency: 'COP', rate: bruta, source: 'FINITY' })
  } catch { /* el gráfico no vale una cotización */ }
}

// ── La base del proveedor, con memoria corta (23 nov) ─────────────
// En el celular del dueño salía "No hay cotización automática" mientras en el
// computador sí había tasa. Una sola respuesta fallida del proveedor (un
// tropiezo de red, un límite de llamadas) dejaba al cliente sin tasa hasta la
// siguiente vuelta de un minuto, y cada pantalla abierta le pedía la tasa por
// su lado. Ahora:
//   · Una tasa de hace menos de 15 s se reutiliza sin volver a llamar, y los
//     pedidos simultáneos comparten la misma llamada.
//   · Si el proveedor falla, se usa la última buena de hace menos de 2
//     minutos. Más vieja que eso no: es un precio contra el que se cierra.
// Es memoria de la instancia: alcanza para los tropiezos, no reemplaza al
// proveedor.
type BaseTasa = { referencia: number; bruta: number; ajusteCop: number; at: number }
let ultimaBase: BaseTasa | null = null
let pidiendoBase: Promise<BaseTasa | { motivo: string; crudo?: string }> | null = null
const BASE_FRESCA_MS = 15_000
const BASE_RESPALDO_MS = 120_000

async function pedirBase(): Promise<BaseTasa | { motivo: string; crudo?: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/finity-proxy`, {
      method: 'POST',
      // Las DOS llaves tienen que ser la misma. Mandar la anon en `apikey` y
      // la service-role en `Authorization` hace que el runtime de Supabase
      // rechace la llamada con "Conflicting API keys" — y eso llegaba a la
      // pantalla del cliente como "el proveedor no devolvio tasa".
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'rates', query: { from: 'USD', to: 'COP' } }),
      signal: AbortSignal.timeout(15000),
    })
    const d = await r.json().catch(() => null)

    // Una tasa de SANDBOX es de mentira. Mostrarla como cotizacion seria peor
    // que no mostrar ninguna: el cliente cerraria contra un numero inventado.
    if (d?.sandbox === true) return { motivo: 'el proveedor esta respondiendo en modo de prueba' }

    // La REFERENCIA es la tasa que el panel de admin promete que ve el
    // cliente: la del proveedor menos los puntos configurados ahi. Es la que
    // sale en `data` (el proxy ya se los resto). La bruta solo sirve de
    // respaldo si esa no se puede leer.
    //
    // Son DOS margenes encadenados a proposito: los puntos del riel mas el
    // porcentaje de la mesa manual, que cuesta mas de operar. Quien mueva uno
    // tiene que saber que el otro sigue estando.
    const referencia = extractRate(d?.data) ?? (Number(d?.rateBruta) > 0 ? Number(d.rateBruta) : null)
    if (!(Number(referencia) > 0)) {
      return {
        motivo: d?.data?.message ?? d?.message ?? d?.error ?? `el proveedor no devolvio tasa${r.status !== 200 ? ` (HTTP ${r.status})` : ''}`,
        crudo: JSON.stringify(d ?? null).slice(0, 400),
      }
    }
    const ajusteCop = Number(d?.ajusteCop) > 0 ? Number(d.ajusteCop) : 0
    const bruta = Number(d?.rateBruta) > 0 ? Number(d.rateBruta) : Number(referencia) + ajusteCop
    // Un punto para el gráfico de la mesa (fx_rate_snapshots, FINITY). Los
    // puntos solo se guardaban al abrir el convertidor viejo; la mesa manual
    // cotiza aquí y no dejaba nada, así que 5 min, 1 h y 24 h salían vacíos
    // (19 nov). Se guarda la tasa BRUTA, que es lo que el gráfico espera (le
    // resta el ajuste al leer).
    await anotarPuntoTasa(bruta)
    return { referencia: Number(referencia), bruta, ajusteCop, at: Date.now() }
  } catch (e: any) {
    return { motivo: `no se pudo consultar la tasa: ${e?.message ?? 'error de red'}` }
  }
}

async function baseTasa(): Promise<{ base: BaseTasa | null; motivo?: string; crudo?: string; deRespaldo?: boolean }> {
  if (ultimaBase && Date.now() - ultimaBase.at < BASE_FRESCA_MS) return { base: ultimaBase }
  if (!pidiendoBase) pidiendoBase = pedirBase().finally(() => { pidiendoBase = null })
  const r = await pidiendoBase
  if ('referencia' in r) { ultimaBase = r; return { base: r } }
  if (ultimaBase && Date.now() - ultimaBase.at < BASE_RESPALDO_MS) {
    console.warn('[otc-mesa] el proveedor no dio tasa; se usa la de hace', Math.round((Date.now() - ultimaBase.at) / 1000), 's:', r.motivo)
    return { base: ultimaBase, deRespaldo: true, motivo: r.motivo }
  }
  return { base: null, motivo: r.motivo, crudo: r.crudo }
}

async function tasaUsdCop(userId?: string, side: string = 'vende_usdt'): Promise<Cotizacion> {
  const margenPct = await margenDe(userId)
  const { base, motivo, crudo } = await baseTasa()
  if (!base) return { referencia: null, rate: null, margenPct, ajusteCop: 0, fuente: 'finity', motivo, crudo }
  // El margen va SIEMPRE a favor de Lincoin. Cuando el cliente VENDE USDT
  // recibe COP = monto × tasa: la tasa baja. Cuando COMPRA USDT recibe
  // USDT = COP ÷ tasa: la tasa tiene que SUBIR. Antes se bajaba en los dos
  // casos y en la compra el cliente se llevaba el margen (y los puntos).
  if (side === 'compra_usdt') {
    const ref = base.bruta + base.ajusteCop
    return { referencia: ref, rate: ref * (1 + margenPct / 100), margenPct, ajusteCop: base.ajusteCop, fuente: 'finity' }
  }
  const ref = base.referencia
  return { referencia: ref, rate: ref * (1 - margenPct / 100), margenPct, ajusteCop: base.ajusteCop, fuente: 'finity' }
}

// Como quedo armada la tasa, en una linea legible. Sin columnas nuevas: el
// expediente tiene que poder decir contra que referencia y con que margen se
// cotizo, no solo el numero final.
function trazaTasa(c: Cotizacion, side: string): string {
  return `finity ${c.referencia?.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${side === 'compra_usdt' ? 'más' : 'menos'} ${pct(c.margenPct)}`
}

// El margen en formato colombiano ("0,5 %"), que es como lo lee el cliente.
const pct = (n: number) => `${Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`

// Lo que RECIBE el cliente, redondeado hacia abajo a lo que se puede pagar:
// pesos enteros y USDT con 2 decimales. Antes se guardaba el producto crudo
// (40.123.456,789 COP) y eso es lo que se acreditaba: un saldo con centavos
// que ningún riel puede enviar y que no cuadra con lo que se le dijo.
function redondearRecibe(v: number, moneda: string): number {
  if (!Number.isFinite(v)) return v
  const f = moneda === 'COP' ? 1 : 100
  return Math.floor(v * f + 1e-6) / f
}

// El saludo de la mesa al tomar un cierre. Dice lo pactado con los números
// del cierre (no los de la pantalla) y qué sigue; si todavía no hay tasa, no
// la inventa: dice que se la confirman.
function bienvenidaMesa(c: any, nombre: string): string {
  const n = (v: unknown, dec = 2) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: dec })
  const vende = String(c.side ?? 'vende_usdt') === 'vende_usdt'
  const tasa = Number(c.rate_final ?? c.rate_cotizada)
  const recibe = Number(c.to_amount)
  const decRecibe = c.to_currency === 'COP' ? 0 : 2
  const hola = nombre.trim() ? `¡Hola, ${nombre.trim()}! 👋` : '¡Hola! 👋'
  const pacto = tasa > 0 && recibe > 0
    ? (vende
      ? `vendes ${n(c.from_amount)} ${c.from_currency} a ${n(tasa)} COP por USDT y recibes ${n(recibe, decRecibe)} ${c.to_currency}.`
      : `compras USDT con ${n(c.from_amount, 0)} ${c.from_currency} a ${n(tasa)} COP por USDT y recibes ${n(recibe, decRecibe)} ${c.to_currency}.`)
    : `${vende ? 'vendes' : 'compras USDT con'} ${n(c.from_amount, vende ? 2 : 0)} ${c.from_currency}. En un momento te confirmamos la tasa.`
  const sigue = vende
    ? `Por aquí te compartimos la dirección para enviar los USDT. ${c.payout?.origen ? 'Envíalos desde la wallet que verificaste, ' : 'Cuando los envíes, '}sube el comprobante en este chat y te acreditamos los pesos apenas confirmemos que llegaron.`
    : 'Por aquí te compartimos los datos para el pago. Cuando lo hagas, sube el comprobante en este chat y te entregamos los USDT apenas confirmemos que llegó.'
  return `${hola} Bienvenido a la Mesa OTC de Lincoin. Ya estamos atendiendo tu cierre ${c.ref}: ${pacto}\n\n${sigue}\n\nCualquier duda, escríbenos aquí mismo.`
}

// Lo que ganó Lincoin en un cierre, con la tasa a la que la mesa vendió los
// USDT que entregó el cliente (o compró los que le entrega). La misma cuenta
// que la contabilidad (liquidacion-lincoin.ts): valor de la operación menos
// lo que es del cliente. El % es sobre lo que valen los USDT a la tasa de la
// mesa: así coincide con el margen pactado (vender a la referencia con un
// margen de 0,5 % da 0,5 %).
function ventaDeMesa(c: { side?: string; from_amount: unknown; to_amount: unknown }, tasa: number) {
  const usdt = Number(String(c.side ?? 'vende_usdt') === 'vende_usdt' ? c.from_amount : c.to_amount)
  const r2 = (v: number) => Math.round(v * 100) / 100
  if (String(c.side ?? 'vende_usdt') === 'vende_usdt') {
    const totalCop = r2(usdt * tasa)                 // lo que recibió Lincoin al vender
    const tercerosCop = r2(Number(c.to_amount))      // lo que se le acreditó al cliente
    const utilidadCop = r2(totalCop - tercerosCop)
    return { tasa, usdt, totalCop, tercerosCop, utilidadCop, pct: totalCop > 0 ? Math.round(utilidadCop / totalCop * 1e6) / 1e4 : null }
  }
  const totalCop = r2(Number(c.from_amount))         // lo que pagó el cliente
  const tercerosCop = r2(usdt * tasa)                // lo que le costaron a Lincoin sus USDT
  const utilidadCop = r2(totalCop - tercerosCop)
  return { tasa, usdt, totalCop, tercerosCop, utilidadCop, pct: tercerosCop > 0 ? Math.round(utilidadCop / tercerosCop * 1e6) / 1e4 : null }
}

// ¿La cuenta puede operar? Las mismas banderas que usan los envíos (gasfree
// assertNotBlocked): is_blocked y raw_data.isBlocked / blacklisted. Antes la
// mesa no las miraba: una cuenta bloqueada o en lista negra pedía cierres y
// se le acreditaban.
async function cuentaBloqueada(userId: string): Promise<string | null> {
  const { data, error } = await db.from('users').select('is_blocked, raw_data').eq('id', userId).maybeSingle()
  // Si no se puede leer, no se opera: es plata, y "no sé" no es "sí".
  if (error) return 'No se pudo comprobar el estado de la cuenta. Intenta de nuevo.'
  if (!data) return 'La cuenta no existe.'
  const raw = ((data as any).raw_data ?? {}) as Record<string, any>
  if (raw.blacklisted === true) return 'Esta cuenta está en la lista negra y no puede operar en la mesa.'
  if ((data as any).is_blocked === true || raw.isBlocked === true) return 'Esta cuenta está bloqueada y no puede operar en la mesa.'
  return null
}

// ─── Referencia corta ───────────────────────────────────
function refNueva(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `OTC-${hex}`
}

async function refUnica(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const r = refNueva()
    const { data } = await db.from('otc_closes').select('id').eq('ref', r).maybeSingle()
    if (!data) return r
  }
  // Ocho colisiones seguidas no pasa; si pasara, se alarga en vez de fallar.
  return `OTC-${Date.now().toString(36).toUpperCase()}`
}

// ─── Mensajes ───────────────────────────────────────────
async function escribirMensaje(closeId: string, autor: 'cliente' | 'mesa' | 'sistema', body: string, opts: { autorId?: string; autorNom?: string; adjunto?: string } = {}) {
  const { error } = await db.from('otc_messages').insert({
    close_id: closeId, autor, autor_id: opts.autorId ?? null,
    autor_nom: opts.autorNom ?? null, body, adjunto_url: opts.adjunto ?? null,
  })
  // El hilo no frena la operación, pero un mensaje perdido sin rastro es un
  // "no me avisaron" que nadie puede comprobar después.
  if (error) console.error('[otc-mesa] mensaje sin guardar', closeId, error.message)
  await db.from('otc_closes').update({
    last_msg_at: new Date().toISOString(), last_msg_por: autor, updated_at: new Date().toISOString(),
  }).eq('id', closeId)
}

// ─── Aviso al telefono de la mesa ───────────────────────
// La campana del panel solo suena con el panel abierto. Esto suena igual con
// el telefono guardado, que es cuando el retraso cuesta plata.
//
// NUNCA tumba la operacion: si el push falla, el cierre ya esta creado y lo
// que corresponde es seguir. Un aviso que no llega es molesto; una solicitud
// que se pierde porque el aviso fallo es otra cosa.
//
// Se espera la respuesta en vez de dispararlo y seguir: la funcion puede
// terminar antes de que un fetch suelto salga, y entonces no se manda nada.
async function avisarMesa(titulo: string, cuerpo: string, tag: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/push`, {
      method: 'POST',
      // Las dos cabeceras con la MISMA clave: mandar la anon en apikey y la de
      // servicio en Authorization lo rechaza el runtime con "Conflicting API keys".
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        // Solo a quien opera la mesa OTC (el mismo permiso que abre la pantalla).
        action: 'enviar', rol: 'admin', permiso: ['plata.mover', 'fn.otc'], titulo, cuerpo, tag,
        url: '/admin-empresas', insistir: true,
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el aviso es un extra, no una condicion */ }
}

// El cierre, tal como lo puede ver el CLIENTE: sin notas internas, sin el
// nombre del operador que lo tomo (le corresponde "la mesa", no quien) y sin
// rate_fuente, que nombra al proveedor de la tasa. Que no se pinte en pantalla
// no alcanza: si viaja en la respuesta, esta a un devtools de distancia.
function paraCliente(c: any) {
  if (!c) return c
  const { notas_internas: _n, tomada_por: _t, tomada_por_nom: _tn, rate_fuente: _rf, ...resto } = c
  // payout.canalPor es el nombre del operador que eligió el canal: igual que
  // tomada_por_nom, al cliente le corresponde "la mesa". payout.venta es la
  // tasa a la que la mesa vendió (o compró) los USDT y lo que ganó Lincoin:
  // eso nunca lo ve el cliente. payout.correccionesTasa lleva el nombre y el
  // id del operador que corrigió: el cliente ya ve la corrección en el chat.
  const payout = c.payout && typeof c.payout === 'object'
    ? (({ canalPor: _cp, venta: _v, correccionesTasa: _ct, ...p }) => p)(c.payout) : c.payout
  return { ...resto, payout, atendida: !!c.tomada_at }
}

// ¿Ese cierre es de quien pregunta? Tener sesion no alcanza: sin esto, un
// cliente lee los montos y los datos bancarios de otro cambiando el id.
async function cargarCierre(id: string, caller: Caller): Promise<{ ok: boolean; cierre?: any; motivo?: string }> {
  if (!id) return { ok: false, motivo: 'falta el id del cierre' }
  const { data } = await db.from('otc_closes').select('*').eq('id', id).maybeSingle()
  if (!data) return { ok: false, motivo: 'ese cierre no existe' }
  if (!caller.admin && String(data.user_id) !== String(caller.userId)) {
    return { ok: false, motivo: 'ese cierre no existe' }   // no se confirma que exista
  }
  return { ok: true, cierre: data }
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
const ahora = () => new Date().toISOString()

// La tasa no puede alejarse más de un 15 % de la referencia. Sin tope, quien
// tiene la sección OTC fijaba cualquier número (1e6) y completaba: una
// acreditación por el monto que quisiera. La referencia es la del proveedor
// para este lado de la operación; si no responde, la que vio el cliente al
// pedir (rate_cotizada). Si no hay ninguna de las dos —el proveedor caído y un
// cierre pedido sin tasa—, la mesa cotiza a mano y no hay contra qué comparar:
// no se inventa una referencia. Lo usan fijar_tasa y corregir_tasa: el mismo
// tope para las dos puertas. Devuelve el motivo si está fuera, o null.
async function tasaFueraDeRango(cierre: any, rate: number): Promise<string | null> {
  const c = await tasaUsdCop(cierre.user_id, String(cierre.side ?? 'vende_usdt'))
  const ref = Number(c.referencia) > 0 ? Number(c.referencia)
    : Number(cierre.rate_cotizada) > 0 ? Number(cierre.rate_cotizada) : null
  const TOPE_DESVIO = 0.15
  if (ref && Math.abs(rate - ref) / ref > TOPE_DESVIO) {
    return `La tasa ${rate.toLocaleString('es-CO', { maximumFractionDigits: 2 })} se aleja más de ${TOPE_DESVIO * 100} % de la referencia (${ref.toLocaleString('es-CO', { maximumFractionDigits: 2 })}). Revisa el número.`
  }
  return null
}

// ─── A QUE BILLETERA SE ACREDITA ────────────────────────
// La billetera NO puede salir del cuerpo del pedido sin comprobarse.
//
// `payout` se guardaba tal cual venia del cliente y `completar` usaba
// payout.wallet como CLAVE del saldo, y adjust_balances acepta cualquier clave
// sin lista blanca. Un cierre con side 'vende_usdt' (recibe PESOS) y
// payout {wallet:'USD'} acreditaba el importe en PESOS dentro de la columna de
// dolares: cuatro mil veces su valor, con la mesa viendo una orden normal y el
// mensaje de confirmacion diciendo "Saldo USDT", que es justo lo que se pidio.
//
// El lado de la operacion decide la MONEDA; el cliente solo puede elegir en
// cual de sus rieles de esa moneda la quiere.
const BILLETERAS_COP = ['COP', 'COP_BREB', 'COP_ACH'] as const

// Desde el 19 nov el cliente ya no elige dónde recibe el COP: lo elige la
// MESA al completar, entre los canales por donde Lincoin tiene la plata
// (Mouv = Bre-B, Finity = ACH, Coinsenda Jero = Cuenta 3, Coinsenda
// Kaupaloki = Cuenta 4). Es una lista cerrada por la misma razón de arriba:
// la billetera es la CLAVE del saldo y no puede ser cualquier texto.
const CANALES_MESA = ['COP_BREB', 'COP_ACH', 'COP_C3', 'COP_C4'] as const

function billeteraDestino(side: string, pedida?: unknown): string | null {
  const w = String((pedida as any) ?? '').trim()
  if (side === 'compra_usdt') {
    // Compra USDT: recibe dolares. No hay eleccion de riel.
    return !w || w === 'USD' ? 'USD' : null
  }
  // Vende USDT: recibe pesos, y puede elegir entre sus rieles COP.
  if (!w) return 'COP'
  return (BILLETERAS_COP as readonly string[]).includes(w) ? w : null
}

// Como se llama cada billetera del cliente. Mismos nombres que en su app: el
// mensaje que le queda en el hilo tiene que decir el mismo riel que el que ve
// en su pantalla de saldos.
const NOMBRE_BILLETERA: Record<string, string> = {
  // Las cuentas por número, como las ve el cliente en su app (Cuenta 1 era
  // "Bre-B" y Cuenta 2 "ACH").
  COP: 'Saldo Lincoin', COP_BREB: nombreCuenta(1), COP_ACH: nombreCuenta(2), USD: 'Saldo USDT',
  COP_C3: nombreCuenta(3), COP_C4: nombreCuenta(4),
}

// ─── La wallet desde donde el cliente manda los USDT ────
// Para VENDER USDT, el cliente dice desde qué wallet los manda y esa wallet se
// revisa en la KYT (kyt, acción otc_wallet) ANTES de pedir el cierre. Solo
// pasa una de riesgo BAJO y sin señalamientos, o una de las excepciones que
// decide kyt (wallet nueva; riesgo bajo con vigilancia, 23 nov), que quedan
// anotadas en la ficha del cierre.
//
// La prueba es la fila de auditoría que escribe kyt (audit_log solo lo
// escribe el servidor): de ESTE usuario, de ESTA wallet, de las últimas 2
// horas y con permitido = true. Lo que diga la pantalla no cuenta: el botón
// se puede habilitar a mano en el navegador.
const KYT_CONFIG_KEY = 'kyt_config'
const VIGENCIA_VERIFICACION_MS = 2 * 3600_000
async function kytExigeWallet(): Promise<boolean> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', KYT_CONFIG_KEY).maybeSingle()
    const v = data?.value ? JSON.parse(String(data.value)) : {}
    return v?.otcExigeWallet !== false
  } catch { return true }   // sin poder leerlo, se exige
}
async function walletVerificada(uid: string, coin: string, address: string): Promise<{ ok: true; ficha: Record<string, unknown> } | { ok: false; motivo: string }> {
  const desde = new Date(Date.now() - VIGENCIA_VERIFICACION_MS).toISOString()
  const { data, error } = await db.from('audit_log').select('metadata, created_at')
    .eq('user_id', uid).eq('action', 'kyt.otc_wallet').gte('created_at', desde)
    .filter('metadata->>coin', 'eq', coin).filter('metadata->>addressLower', 'eq', address.toLowerCase())
    .order('created_at', { ascending: false }).limit(1)
  if (error) return { ok: false, motivo: 'No se pudo comprobar la verificación de la wallet. Intenta de nuevo.' }
  const fila = (data ?? [])[0] as any
  if (!fila) return { ok: false, motivo: 'Verifica la wallet desde donde envías antes de pedir el cierre.' }
  const m = fila.metadata ?? {}
  if (m.permitido !== true) return { ok: false, motivo: 'Esa wallet no pasó la revisión de riesgo: no se puede usar para la mesa.' }
  return { ok: true, ficha: {
    coin, address, categoria: m.categoria ?? null, puntaje: m.puntaje ?? null, nivel: m.nivel ?? null,
    excepcion: m.excepcion ?? null, recomendacion: m.recomendacion ?? null,
    saldoUsdt: m.saldoUsdt ?? null, consultadoAt: m.consultadoAt ?? null, verificadaAt: fila.created_at,
  } }
}

// ─── Comprobantes ───────────────────────────────────────
// Bucket PRIVADO. El archivo entra y sale por aca: la app Empresas usa auth
// propia, asi que una politica de storage basada en auth.uid() no protegeria
// nada. El cliente nunca recibe una URL permanente, solo una firmada que vence.
const BUCKET = 'otc-comprobantes'
const MAX_BYTES = 5 * 1024 * 1024
const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']

async function guardarComprobante(closeId: string, archivo: string, nombre: string, tipo: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const t = String(tipo || '').toLowerCase()
  if (!TIPOS_OK.includes(t)) return { ok: false, error: 'El comprobante tiene que ser una imagen (JPG, PNG, WEBP) o un PDF.' }
  let bytes: Uint8Array
  try {
    const b64 = String(archivo).includes(',') ? String(archivo).split(',')[1] : String(archivo)
    const bin = atob(b64)
    bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0))
  } catch { return { ok: false, error: 'No se pudo leer el archivo.' } }
  if (bytes.byteLength === 0) return { ok: false, error: 'El archivo llego vacio.' }
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: 'El comprobante no puede pesar mas de 5 MB.' }

  const limpio = String(nombre || 'comprobante').replace(/[^\w.\-]/g, '_').slice(-60)
  const path = `${closeId}/${Date.now()}-${limpio}`
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: t, upsert: false })
  if (error) return { ok: false, error: `No se pudo guardar el comprobante: ${error.message}` }
  return { ok: true, path }
}

// Los mensajes guardan el PATH dentro del bucket, no una URL. Al leerlos se
// cambia por una URL firmada que vence en una hora: un enlace permanente a un
// documento bancario, una vez que sale, ya no se puede retirar.
async function firmarAdjuntos(msgs: any[]): Promise<any[]> {
  const out: any[] = []
  for (const m of msgs) {
    if (!m.adjunto_url) { out.push(m); continue }
    try {
      const { data } = await db.storage.from(BUCKET).createSignedUrl(m.adjunto_url, 3600)
      out.push({ ...m, adjunto_url: data?.signedUrl ?? null, adjunto_falla: data?.signedUrl ? undefined : true })
    } catch { out.push({ ...m, adjunto_url: null, adjunto_falla: true }) }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const payload = await req.json().catch(() => ({})) as Record<string, any>
    const action = String(payload.action ?? '')
    if (!action) return json(400, { ok: false, error: 'falta action' })

    const caller = await validCaller(req, payload)
    if (!caller.ok) return json(401, { ok: false, error: 'unauthorized' })
    // Con la llave pública + el id de otra persona se podían leer sus
    // órdenes y comprobantes, escribirle mensajes o cancelarle cierres. Fuera
    // de la cotización indicativa, todo exige una sesión real.
    if (action !== 'cotizar' && !caller.viaJwt) {
      return json(401, { ok: false, error: 'sesion_requerida', message: 'Tu sesión venció. Vuelve a iniciar sesión.' })
    }

    // Acciones que solo puede hacer la mesa.
    const SOLO_MESA = new Set(['lista', 'tomar', 'fijar_tasa', 'corregir_tasa', 'completar', 'registrar_venta', 'cancelar_mesa', 'notas', 'resumen', 'config_get', 'config_set'])
    if (SOLO_MESA.has(action) && !caller.admin) {
      return json(403, { ok: false, error: 'solo la mesa' })
    }

    // ── Cotizacion indicativa ───────────────────────────
    if (action === 'cotizar') {
      const side = String(payload.side ?? 'vende_usdt')
      const monto = num(payload.fromAmount)
      // El margen de un cliente es pactado y privado: con la llave pública y
      // el id de otro se veía su comisión. Sin sesión se cotiza con el margen
      // por defecto; con sesión, el propio; la mesa puede pedir el de un cliente.
      const uidCotiza = caller.admin
        ? String(payload.user_id ?? caller.userId ?? '')
        : (caller.viaJwt ? String(caller.userId ?? '') : '')
      const c = await tasaUsdCop(uidCotiza, side)
      // Si la venta exige verificar la wallet de origen (panel → KYT). La
      // pantalla lo usa para pedirla; el que manda es `crear`.
      const exigeWallet = side === 'vende_usdt' && await kytExigeWallet()
      if (c.rate == null) {
        const emSinTasa = await estadoMesa()
        return json(200, {
          ok: true, rate: null, referencia: null, margenPct: c.margenPct,
          toAmount: null, indicativa: true, exigeWallet,
          mesa: { abierta: emSinTasa.abierta, proxima: emSinTasa.proxima, hoy: emSinTasa.hoy, dia: emSinTasa.dia },
          // Al cliente no le corresponde saber QUIEN nos da la tasa ni por que
          // fallo: el motivo del proveedor puede nombrarlo o filtrar detalle de
          // nuestra infraestructura. Ve que no hay cotizacion automatica; el
          // diagnostico va para la mesa.
          ...(caller.admin ? { fuente: c.fuente, motivo: c.motivo } : {}),
          // El crudo del proveedor solo para la mesa: sin esto, "no devolvio
          // tasa" tapa por igual un limite de plan, una ruta caida y una
          // respuesta con otra forma.
          ...(caller.admin && c.crudo ? { crudo: c.crudo } : {}),
        })
      }
      const to = Number.isFinite(monto) && monto > 0
        ? redondearRecibe(side === 'vende_usdt' ? monto * c.rate : monto / c.rate, side === 'vende_usdt' ? 'COP' : 'USDT')
        : null
      const em = await estadoMesa()
      return json(200, {
        ok: true, rate: c.rate, referencia: c.referencia, margenPct: c.margenPct,
        toAmount: to, indicativa: true, ajusteCop: c.ajusteCop, exigeWallet,
        // El plazo que corre desde que pide el cierre: la pantalla lo dice
        // ANTES de que lo pida (la tasa queda fija al crear, ver 'crear').
        ventanaMin: await ventanaPago(),
        mesa: { abierta: em.abierta, proxima: em.proxima, hoy: em.hoy, dia: em.dia },
        ...(caller.admin ? { fuente: c.fuente } : {}),
      })
    }

    // ── Crear un cierre (cliente) ───────────────────────
    if (action === 'crear') {
      const uid = String(payload.user_id ?? caller.userId ?? '')
      if (!uid) return json(400, { ok: false, error: 'falta el usuario' })
      if (!caller.admin && uid !== String(caller.userId)) {
        return json(403, { ok: false, error: 'no puedes crear cierres a nombre de otro' })
      }
      {
        const bloqueo = await cuentaBloqueada(uid)
        if (bloqueo) return json(403, { ok: false, error: 'cuenta_bloqueada', message: bloqueo })
      }

      // LA MESA CERRADA NO TOMA ORDENES, Y SE COMPRUEBA ACA.
      // La pantalla ya esconde el boton, pero una pestana abierta desde el
      // viernes lo sigue teniendo, y una pestana vieja no es permiso para
      // abrir la mesa. Crear igual seria peor que negarse: el plazo de pago
      // arranca al crear, asi que la solicitud se venceria sola contra nadie.
      //
      // La mesa SI puede crear fuera de hora: si esta trabajando, esta abierta
      // para ella.
      if (!caller.admin) {
        const em = await estadoMesa()
        if (!em.abierta) {
          return json(409, {
            ok: false, error: 'mesa_cerrada',
            message: em.proxima
              ? `La mesa está cerrada en este momento. Vuelve a abrir ${em.proxima}.`
              : 'La mesa está cerrada en este momento.',
            proxima: em.proxima,
          })
        }
      }

      const side = String(payload.side ?? 'vende_usdt')
      if (side !== 'vende_usdt' && side !== 'compra_usdt') {
        return json(400, { ok: false, error: 'lado inválido' })
      }
      const monto = num(payload.fromAmount)
      if (!(monto > 0)) return json(400, { ok: false, error: 'el monto tiene que ser mayor a cero' })

      // Vende USDT: el COP lo acredita la mesa en el canal que ELLA elige al
      // completar (ver CANALES_MESA); lo que mande una pantalla vieja se
      // ignora. Compra USDT: siempre a su saldo USDT.
      const destinoValidado = side === 'compra_usdt' ? 'USD' : null

      // La wallet de origen, verificada en la KYT (ver walletVerificada).
      // La mesa puede crear sin ella: es quien opera, no el cliente.
      let origen: Record<string, unknown> | null = null
      if (side === 'vende_usdt' && !caller.admin && await kytExigeWallet()) {
        const w = (payload.walletOrigen ?? {}) as Record<string, unknown>
        const coin = String(w.coin ?? '').trim()
        const address = String(w.address ?? '').trim()
        if (!coin || !address) {
          return json(400, { ok: false, error: 'falta_wallet', message: 'Escribe la wallet desde donde envías los USDT y verifícala.' })
        }
        const v = await walletVerificada(uid, coin, address)
        if (!v.ok) return json(409, { ok: false, error: 'wallet_no_verificada', message: v.motivo })
        origen = v.ficha
      }

      const { count } = await db.from('otc_closes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid).in('status', VIVOS)
      if ((count ?? 0) >= MAX_VIVOS_POR_CLIENTE) {
        return json(409, {
          ok: false, error: 'demasiados_abiertos',
          message: `Ya tienes ${count} cierres en curso. Termina o cancela alguno antes de pedir otro.`,
        })
      }

      // La tasa se resuelve EN EL SERVIDOR. Si viniera del body, el cliente
      // elegiria su propio precio.
      const c = await tasaUsdCop(uid, side)
      const rate = c.rate
      const motivo = c.motivo
      const from_currency = side === 'vende_usdt' ? 'USDT' : 'COP'
      const to_currency   = side === 'vende_usdt' ? 'COP' : 'USDT'
      const to_amount = rate != null
        ? redondearRecibe(side === 'vende_usdt' ? monto * rate : monto / rate, to_currency)
        : null

      // El plazo arranca al CREAR, no cuando la mesa contesta: el cliente ya vio
      // la tasa y ya puede pagar. Hacerlo esperar a una confirmacion para
      // recien entonces darle 5 minutos alarga la operacion sin darle nada.
      //
      // Por eso la tasa cotizada es tambien el precio de ejecucion: es contra
      // ese numero que va a pagar. La mesa puede cambiarlo con fijar_tasa si
      // hay que renegociar, y ahi el plazo vuelve a empezar.
      const mins = await ventanaPago()
      const conTasa = rate != null
      const ref = await refUnica()
      const { data: creada, error } = await db.from('otc_closes').insert({
        ref, user_id: uid, side,
        from_currency, from_amount: monto,
        to_currency, to_amount,
        rate_cotizada: rate, rate_final: rate, rate_fuente: rate != null ? trazaTasa(c, side) : null,
        status: conTasa ? 'esperando_pago' : 'abierta',
        confirmada_at: conTasa ? ahora() : null,
        vence_at: conTasa ? new Date(Date.now() + mins * 60_000).toISOString() : null,
        payout: { tipo: 'saldo', wallet: destinoValidado, ...(origen ? { origen } : {}) },
        last_msg_at: ahora(), last_msg_por: 'sistema',
      }).select('*').maybeSingle()
      if (error) return json(500, { ok: false, error: error.message })

      const montoTxt = `${monto.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${from_currency}`
      await escribirMensaje(creada.id, 'sistema',
        conTasa
          ? `Solicitud de cierre por ${montoTxt} a ${rate!.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP por USDT `
            + `(referencia ${c.referencia?.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${side === 'compra_usdt' ? 'más' : 'menos'} ${pct(c.margenPct)}). `
            + `Recibes ${to_amount!.toLocaleString('es-CO', { maximumFractionDigits: to_currency === 'COP' ? 0 : 2 })} ${to_currency}. `
            + `La tasa quedó fija: tienes ${mins} minutos para enviar y subir el comprobante.`
          : `Solicitud de cierre por ${montoTxt}. No se pudo tomar la cotización automática: la mesa la cotiza a mano y ahí arranca el plazo.`)
      // El motivo del proveedor NO va al hilo (lo lee el cliente y puede
      // nombrar al proveedor o detalles de la infraestructura): queda en las
      // notas internas de la mesa.
      if (!conTasa && motivo) {
        await db.from('otc_closes').update({ notas_internas: `Sin cotización automática: ${String(motivo).slice(0, 500)}` }).eq('id', creada.id)
      }

      const nota = String(payload.nota ?? '').trim()
      if (nota) {
        await escribirMensaje(creada.id, 'cliente', nota.slice(0, 2000), { autorId: uid, autorNom: caller.nombre ?? undefined })
      }

      await avisarMesa(
        'Nuevo cierre OTC',
        `${caller.nombre ?? 'Un cliente'} pide ${side === 'vende_usdt' ? 'vender' : 'comprar'} ${montoTxt}. Ref ${ref}.`,
        // Un tag por cierre: dos solicitudes distintas tienen que verse como
        // dos avisos. Con el tag fijo la segunda tapaba a la primera.
        `otc-${ref}`)

      return json(200, { ok: true, id: creada.id, ref: creada.ref, cierre: paraCliente(creada) })
    }

    // ── Mis cierres (cliente) ───────────────────────────
    if (action === 'mios') {
      await caducarVencidos()
      const uid = String(payload.user_id ?? caller.userId ?? '')
      if (!uid) return json(400, { ok: false, error: 'falta el usuario' })
      if (!caller.admin && uid !== String(caller.userId)) return json(403, { ok: false, error: 'no' })
      const { data } = await db.from('otc_closes').select('*')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(50)
      return json(200, { ok: true, cierres: (data ?? []).map(paraCliente) })
    }

    // ── Bandeja de la mesa ──────────────────────────────
    if (action === 'lista') {
      await caducarVencidos()
      const estado = String(payload.estado ?? '')
      let q = db.from('otc_closes').select('*')
      if (estado === 'vivos') q = q.in('status', VIVOS)
      else if (ESTADOS.includes(estado as Estado)) q = q.eq('status', estado)
      const { data } = await q.order('created_at', { ascending: false }).limit(200)
      const filas = data ?? []

      // El nombre del cliente se resuelve aca y no con un join: users vive con
      // RLS y el join desde PostgREST se cae segun quien pregunte.
      const ids = [...new Set(filas.map((f: any) => f.user_id))]
      const nombres: Record<string, any> = {}
      if (ids.length) {
        const { data: us } = await db.from('users').select('id, full_name, email, company_name').in('id', ids)
        for (const u of us ?? []) nombres[(u as any).id] = u
      }
      return json(200, {
        ok: true,
        cierres: filas.map((f: any) => ({
          ...f,
          cliente: nombres[f.user_id]
            ? {
                nombre: nombres[f.user_id].company_name ?? nombres[f.user_id].full_name ?? null,
                email: nombres[f.user_id].email ?? null,
              }
            : null,
        })),
      })
    }

    // ── Conteo para el badge del sidebar ────────────────
    if (action === 'resumen') {
      await caducarVencidos()
      const { count: abiertas } = await db.from('otc_closes')
        .select('id', { count: 'exact', head: true }).in('status', VIVOS)
      // Sin leer por la mesa: hay mensaje del cliente posterior a la ultima vez
      // que la mesa miro. El filtro va en SQL y no en el cliente para no
      // traerse doscientas filas solo para contar.
      const { data: pend } = await db.from('otc_closes')
        .select('id, last_msg_at, last_msg_por, visto_mesa').in('status', VIVOS).limit(300)
      const sinLeer = (pend ?? []).filter((c: any) =>
        c.last_msg_por === 'cliente' && (!c.visto_mesa || new Date(c.last_msg_at) > new Date(c.visto_mesa))).length
      return json(200, { ok: true, abiertas: abiertas ?? 0, sinLeer })
    }

    // ── Detalle + hilo (los dos lados) ──────────────────
    if (action === 'detalle') {
      await caducarVencidos()
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      const { data: msgsRaw } = await db.from('otc_messages').select('*')
        .eq('close_id', r.cierre.id).order('created_at', { ascending: true }).limit(500)
      const msgs = await firmarAdjuntos(msgsRaw ?? [])

      // Marcar visto del lado que abrio.
      const campo = caller.admin ? 'visto_mesa' : 'visto_cliente'
      await db.from('otc_closes').update({ [campo]: ahora() }).eq('id', r.cierre.id)

      let cliente = null
      if (caller.admin) {
        const { data: u } = await db.from('users')
          .select('id, full_name, email, company_name, phone, kyc_status').eq('id', r.cierre.user_id).maybeSingle()
        cliente = u ?? null
      }
      return json(200, {
        ok: true,
        cierre: caller.admin ? r.cierre : paraCliente(r.cierre),
        mensajes: msgs,
        cliente,
      })
    }

    // ── Escribir en el hilo (los dos lados) ─────────────
    if (action === 'mensaje') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      const body = String(payload.body ?? '').trim()
      const adjunto = String(payload.adjunto ?? '').trim()
      if (!body && !adjunto) return json(400, { ok: false, error: 'mensaje vacío' })
      // Un adjunto solo puede ser un archivo que este servidor guardó para ESTE
      // cierre (acción 'comprobante'). Antes se aceptaba cualquier texto: con
      // eso se cumplía el "comprobante obligatorio" de marcar_pagada sin subir
      // nada, y el servidor firmaba cualquier ruta del bucket privado.
      if (adjunto) {
        const prefijo = `${r.cierre.id}/`
        const nombreArch = adjunto.slice(prefijo.length)
        if (!adjunto.startsWith(prefijo) || !nombreArch || nombreArch.includes('/') || nombreArch.includes('..')) {
          return json(400, { ok: false, error: 'adjunto_invalido', message: 'Sube el archivo con el botón de adjuntar.' })
        }
        const { data: hay, error: eList } = await db.storage.from(BUCKET).list(r.cierre.id, { search: nombreArch, limit: 5 })
        if (eList || !Array.isArray(hay) || !hay.some((o: any) => o?.name === nombreArch)) {
          return json(400, { ok: false, error: 'adjunto_invalido', message: 'Sube el archivo con el botón de adjuntar.' })
        }
      }
      // El hilo NO se cierra con el cierre. Justo cuando una solicitud se
      // cancela por vencimiento es cuando un cliente que alcanzo a pagar
      // necesita avisar; bloquearle el chat ahi lo deja sin a quien escribirle
      // con la plata afuera.
      await escribirMensaje(r.cierre.id, caller.admin ? 'mesa' : 'cliente', body.slice(0, 4000), {
        autorId: caller.userId, autorNom: caller.nombre ?? undefined, adjunto: adjunto || undefined,
      })
      // Solo lo que escribe el cliente: avisarle a la mesa de lo que acaba de
      // escribir la mesa es ruido que termina con las notificaciones apagadas.
      if (!caller.admin) {
        await avisarMesa(`Mensaje en ${r.cierre.ref}`,
          body ? `${caller.nombre ?? 'El cliente'}: ${body.slice(0, 140)}` : `${caller.nombre ?? 'El cliente'} adjunto un archivo.`,
          `otc-${r.cierre.ref}`)
      }
      return json(200, { ok: true })
    }

    // ── La mesa toma el cierre ──────────────────────────
    if (action === 'tomar') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.tomada_por && String(r.cierre.tomada_por) !== String(caller.userId)) {
        return json(409, { ok: false, error: 'ya_tomada', message: `La está atendiendo ${r.cierre.tomada_por_nom ?? 'otro operador'}.` })
      }
      // CAS sobre tomada_por: dos operadores que aprietan a la vez no pueden
      // quedar los dos como responsables.
      const { data: ok } = await db.from('otc_closes').update({
        tomada_por: caller.userId, tomada_por_nom: caller.nombre ?? null, tomada_at: ahora(),
        status: r.cierre.status === 'abierta' ? 'en_proceso' : r.cierre.status,
        updated_at: ahora(),
      }).eq('id', r.cierre.id).is('tomada_por', null).select('id')
      if (!ok?.length) {
        const { data: ahoraEs } = await db.from('otc_closes').select('tomada_por_nom').eq('id', r.cierre.id).maybeSingle()
        return json(409, { ok: false, error: 'ya_tomada', message: `La está atendiendo ${(ahoraEs as any)?.tomada_por_nom ?? 'otro operador'}.` })
      }
      // El hilo lo lee el cliente: le corresponde "la mesa", no el nombre de
      // quien la atiende (ese queda en tomada_por_nom, que paraCliente quita).
      // 23 nov (el dueño): al tomar el cierre, un saludo de la mesa en vez de
      // una línea de sistema; el cliente sabe de una que alguien lo atiende,
      // qué pactó y qué sigue. Va una sola vez: el CAS de arriba deja tomar
      // un cierre una sola vez.
      const { data: u } = await db.from('users').select('company_name, full_name').eq('id', r.cierre.user_id).maybeSingle()
      await escribirMensaje(r.cierre.id, 'mesa', bienvenidaMesa(r.cierre, (u as any)?.company_name || (u as any)?.full_name || ''),
        { autorId: caller.userId, autorNom: caller.nombre ?? undefined })
      return json(200, { ok: true })
    }

    // ── La mesa fija la tasa y da instrucciones ─────────
    if (action === 'fijar_tasa') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      const rate = num(payload.rateFinal)
      if (!(rate > 0)) return json(400, { ok: false, error: 'la tasa tiene que ser mayor a cero' })
      // Solo se fija (o renegocia) la tasa de un cierre que todavía no se
      // pagó. Antes no había control: un cierre COMPLETADO volvía a
      // 'esperando_pago' y se podía completar —acreditar— otra vez. Uno
      // cancelado sí se puede reabrir: es el camino para el cliente que pagó
      // después de que venciera el plazo.
      const FIJABLES = ['abierta', 'en_proceso', 'esperando_pago', 'cancelada']
      if (!FIJABLES.includes(String(r.cierre.status))) {
        return json(409, { ok: false, error: 'estado_invalido', message: r.cierre.status === 'completada' ? 'Este cierre ya se completó: no se puede cambiar la tasa.' : r.cierre.status === 'anulada' ? 'Este cierre fue anulado: se monta uno nuevo.' : 'El cliente ya marcó el pago: para cambiar la tasa usa «Corregir la tasa del cliente» (no reinicia el plazo).' })
      }
      // Un cancelado se reabre solo si NUNCA se acreditó. Antes un cierre que
      // se completaba y se cancelaba a la vez quedaba 'cancelada' con la plata
      // ya acreditada; reabrirlo y completarlo acreditaba por segunda vez.
      // (Cancelar ahora exige un estado vivo, así que eso ya no debería pasar;
      // esto cubre las filas viejas.)
      if (r.cierre.status === 'cancelada' && r.cierre.completada_at) {
        return json(409, { ok: false, error: 'estado_invalido', message: 'Este cierre ya se había acreditado: no se puede reabrir.' })
      }

      {
        const fuera = await tasaFueraDeRango(r.cierre, rate)
        if (fuera) return json(400, { ok: false, error: 'tasa_fuera_de_rango', message: fuera })
      }
      const instrucciones = String(payload.instrucciones ?? '').trim()

      const monto = Number(r.cierre.from_amount)
      const to = redondearRecibe(r.cierre.side === 'vende_usdt' ? monto * rate : monto / rate, String(r.cierre.to_currency))

      // El reloj arranca ACA, no al crear la solicitud: antes de que la mesa
      // diga a que tasa la toma, el cliente no tiene contra que pagar.
      const mins = await ventanaPago()
      const vence = new Date(Date.now() + mins * 60_000).toISOString()

      // CAS sobre el estado: si entre la lectura y esta escritura alguien lo
      // completó, no se reabre.
      const { data: fijado, error } = await db.from('otc_closes').update({
        rate_final: rate, to_amount: to, status: 'esperando_pago',
        confirmada_at: ahora(), vence_at: vence, updated_at: ahora(),
      }).eq('id', r.cierre.id).in('status', FIJABLES).is('completada_at', null).select('id')
      if (error) return json(500, { ok: false, error: error.message })
      if (!fijado?.length) return json(409, { ok: false, error: 'estado_invalido', message: 'El cierre cambió de estado mientras tanto. Recarga.' })

      await escribirMensaje(r.cierre.id, 'sistema',
        `Tasa confirmada: ${rate.toLocaleString('es-CO', { maximumFractionDigits: 2 })}. `
        + `Recibes ${to.toLocaleString('es-CO', { maximumFractionDigits: r.cierre.to_currency === 'COP' ? 0 : 2 })} ${r.cierre.to_currency} `
        + `por ${monto.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${r.cierre.from_currency}. `
        + `Tienes ${mins} minutos para enviar y subir el comprobante.`)
      if (instrucciones) {
        await escribirMensaje(r.cierre.id, 'mesa', instrucciones.slice(0, 4000), { autorId: caller.userId, autorNom: caller.nombre ?? undefined })
      }
      return json(200, { ok: true, toAmount: to, venceAt: vence, ventanaMin: mins })
    }

    // ── Corregir la tasa de un cierre que el cliente ya pagó ──
    // 23 nov: la mesa tenía que corregir la tasa de un cierre "Por verificar"
    // (el cliente ya mandó los USDT) y no había cómo: fijar_tasa lo devuelve a
    // 'esperando_pago' y le abre un plazo nuevo para pagar, que no aplica a
    // quien ya pagó, y por eso no acepta 'pagada'. Esta corrección cambia
    // SOLO la tasa y lo que recibe: el estado y la fecha en que marcó el pago
    // quedan igual. Lleva el mismo tope de ±15 % que fijar_tasa, pide un
    // motivo, se le dice al cliente por el chat (antes y después) y queda en
    // el historial del cierre y en la auditoría. Completar acredita lo que
    // diga la fila en ese momento, así que acredita la tasa corregida.
    if (action === 'corregir_tasa') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status !== 'pagada' || r.cierre.completada_at) {
        return json(409, { ok: false, error: 'estado_invalido', message: r.cierre.status === 'completada' ? 'Este cierre ya se completó: no se puede cambiar la tasa.' : 'Esto es para un cierre que el cliente ya marcó como pagado. Antes de eso, usa «Corregir tasa e instrucciones».' })
      }
      const rate = num(payload.rateFinal)
      if (!(rate > 0)) return json(400, { ok: false, error: 'la tasa tiene que ser mayor a cero' })
      const motivo = String(payload.motivo ?? '').trim()
      if (motivo.length < 5) return json(400, { ok: false, error: 'falta_motivo', message: 'Escribe el motivo de la corrección: el cliente lo ve en el chat.' })
      const antes = Number(r.cierre.rate_final)
      if (antes > 0 && Math.abs(rate - antes) < 1e-9) return json(400, { ok: false, error: 'misma_tasa', message: 'Es la misma tasa que ya tiene el cierre.' })
      {
        const fuera = await tasaFueraDeRango(r.cierre, rate)
        if (fuera) return json(400, { ok: false, error: 'tasa_fuera_de_rango', message: fuera })
      }
      const monto = Number(r.cierre.from_amount)
      const to = redondearRecibe(r.cierre.side === 'vende_usdt' ? monto * rate : monto / rate, String(r.cierre.to_currency))
      const toAntes = Number(r.cierre.to_amount)
      const correccion = {
        de: antes > 0 ? antes : null, a: rate, recibeAntes: Number.isFinite(toAntes) ? toAntes : null, recibe: to,
        motivo: motivo.slice(0, 500), por: caller.nombre ?? null, porId: caller.userId ?? null, at: ahora(),
      }
      const previas = Array.isArray(r.cierre.payout?.correccionesTasa) ? r.cierre.payout.correccionesTasa : []
      // CAS: solo si sigue 'pagada', sin acreditar y con la tasa que se leyó.
      // Si otro operador la corrigió o la completó entre medio, no se pisa.
      let q = db.from('otc_closes').update({
        rate_final: rate, to_amount: to, updated_at: ahora(),
        payout: { ...(r.cierre.payout ?? {}), correccionesTasa: [...previas, correccion].slice(-20) },
      }).eq('id', r.cierre.id).eq('status', 'pagada').is('completada_at', null)
      q = antes > 0 ? q.eq('rate_final', r.cierre.rate_final) : q.is('rate_final', null)
      const { data: corregido, error } = await q.select('id')
      if (error) return json(500, { ok: false, error: error.message })
      if (!corregido?.length) return json(409, { ok: false, error: 'estado_invalido', message: 'El cierre cambió mientras tanto (otra corrección o ya se completó). Recarga.' })

      const fmt = (v: number, d = 2) => v.toLocaleString('es-CO', { maximumFractionDigits: d })
      const dec = r.cierre.to_currency === 'COP' ? 0 : 2
      await escribirMensaje(r.cierre.id, 'sistema',
        `La mesa corrigió la tasa de este cierre: ${antes > 0 ? `antes ${fmt(antes)}, ` : ''}ahora ${fmt(rate)}. `
        + `Recibes ${fmt(to, dec)} ${r.cierre.to_currency} por ${fmt(monto)} ${r.cierre.from_currency}`
        + `${Number.isFinite(toAntes) && toAntes > 0 ? ` (antes ${fmt(toAntes, dec)})` : ''}. Motivo: ${motivo.slice(0, 500)}`)
      try {
        await db.from('audit_log').insert({ user_id: caller.userId ?? null, action: 'otc_manual.corregir_tasa', metadata: { cierre: r.cierre.ref, cliente: r.cierre.user_id, ...correccion } })
      } catch { /* la auditoría no frena */ }
      return json(200, { ok: true, toAmount: to, rateFinal: rate })
    }

    // ── Subir comprobante (paso propio, antes de marcar pagado) ──
    if (action === 'comprobante') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status === 'completada' || r.cierre.status === 'cancelada' || r.cierre.status === 'anulada') {
        return json(409, { ok: false, error: 'ese cierre ya está cerrado' })
      }
      const archivo = String(payload.archivo ?? '')
      if (!archivo) return json(400, { ok: false, error: 'falta el archivo' })
      const sub = await guardarComprobante(r.cierre.id, archivo, String(payload.nombre ?? ''), String(payload.tipo ?? ''))
      if (!sub.ok) return json(400, { ok: false, error: sub.error })
      // Quien adjunta importa: marcar_pagada exige un comprobante DEL CLIENTE.
      // Si un adjunto de la mesa se guardara como suyo, la mesa habilitaria
      // sin querer el "ya pague" de alguien que no pago.
      const quien = caller.admin ? 'mesa' : 'cliente'
      await escribirMensaje(r.cierre.id, quien,
        String(payload.nota ?? (quien === 'mesa' ? 'Adjunto de la mesa.' : 'Comprobante del envío.')).slice(0, 500),
        { autorId: caller.userId, autorNom: caller.nombre ?? undefined, adjunto: sub.path })
      return json(200, { ok: true })
    }

    // ── El cliente avisa que ya pago ────────────────────
    if (action === 'marcar_pagada') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status !== 'esperando_pago') {
        return json(409, { ok: false, error: 'todavía no hay instrucciones de pago para este cierre' })
      }
      // El plazo se comprueba ACA tambien, no solo en el reloj de la pantalla:
      // un contador del navegador se para, se adelanta o se edita.
      if (r.cierre.vence_at && new Date(r.cierre.vence_at).getTime() < Date.now()) {
        await caducarVencidos()
        return json(409, {
          ok: false, error: 'vencido',
          message: 'Se venció el plazo. Si ya enviaste el dinero, escribe por el chat antes de montar otra solicitud.',
        })
      }
      // El comprobante es OBLIGATORIO y tiene que estar YA SUBIDO. "Ya pague"
      // sin respaldo no le sirve a nadie: la mesa tendria que salir a buscar en
      // el banco un pago del que solo sabe que alguien dice que existe.
      //
      // Se comprueba contra el hilo y no contra lo que mande la pantalla: el
      // boton se puede deshabilitar en el navegador, la regla vive aca.
      const { count } = await db.from('otc_messages')
        .select('id', { count: 'exact', head: true })
        .eq('close_id', r.cierre.id).eq('autor', 'cliente').not('adjunto_url', 'is', null)
      if (!(count ?? 0)) {
        return json(400, { ok: false, error: 'falta_comprobante', message: 'Sube el comprobante del envío antes de marcarlo como pagado.' })
      }

      // CAS sobre el estado. Antes el UPDATE no tenía condición: si la mesa
      // completaba entre la lectura de arriba y esta escritura, el cierre
      // volvía de 'completada' a 'pagada' y se podía completar —acreditar—
      // por segunda vez.
      const { data: marcada, error: errMarca } = await db.from('otc_closes')
        .update({ status: 'pagada', pagada_at: ahora(), updated_at: ahora() })
        .eq('id', r.cierre.id).eq('status', 'esperando_pago').is('completada_at', null).select('id')
      if (errMarca) return json(500, { ok: false, error: errMarca.message })
      if (!marcada?.length) {
        return json(409, { ok: false, error: 'estado_invalido', message: 'El cierre cambió de estado mientras tanto. Recarga para verlo.' })
      }
      await escribirMensaje(r.cierre.id, 'sistema', 'El cliente marcó el envío como realizado. La mesa verifica el ingreso antes de liberar.')
      // Este es el aviso que mas urge: hay plata enviada esperando que alguien
      // la verifique y libere.
      await avisarMesa(`Pago declarado en ${r.cierre.ref}`,
        `${caller.nombre ?? 'El cliente'} subio comprobante por ${Number(r.cierre.from_amount).toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${r.cierre.from_currency}. Falta verificar y liberar.`,
        `otc-${r.cierre.ref}`)
      return json(200, { ok: true })
    }

    // ── La mesa libera ──────────────────────────────────
    if (action === 'completar') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status === 'completada') return json(200, { ok: true, yaEstaba: true })
      if (r.cierre.status === 'cancelada') return json(409, { ok: false, error: 'ese cierre esta cancelado', message: 'Este cierre está cancelado. Si el cliente sí pagó, fija la tasa de nuevo para reabrirlo y luego complétalo.' })
      if (r.cierre.status === 'anulada') return json(409, { ok: false, error: 'ese cierre fue anulado', message: 'Este cierre fue anulado. Si el cliente sí pagó, se monta un cierre nuevo.' })
      {
        const bloqueo = await cuentaBloqueada(String(r.cierre.user_id))
        if (bloqueo) {
          return json(409, { ok: false, error: 'cuenta_bloqueada', message: `${bloqueo.replace('Esta cuenta', 'La cuenta del cliente')} No se acreditó nada.` })
        }
      }
      if (!r.cierre.rate_final) {
        return json(409, { ok: false, error: 'falta_tasa', message: 'Fija la tasa final antes de completar: sin eso el cierre queda sin precio de ejecucion.' })
      }
      // Se REVALIDA contra el lado de la operacion. Confiar en lo guardado
      // alcanzaria si nada mas pudiera escribir esa fila, y eso es justo lo que
      // no se puede dar por sentado con plata: una fila vieja, una migracion o
      // un futuro camino de escritura vuelven a abrir el agujero.
      // Vende USDT: el canal lo elige la mesa (payload.wallet), de la lista
      // cerrada. Un cierre viejo que ya traía la billetera elegida por el
      // cliente se puede completar con esa si la mesa no elige otra.
      const lado = String(r.cierre.side ?? '')
      const elegida = String(payload.wallet ?? '').trim()
      let destino: string | null
      if (lado !== 'vende_usdt') destino = billeteraDestino(lado, r.cierre.payout?.wallet)
      else if (elegida) destino = (CANALES_MESA as readonly string[]).includes(elegida) ? elegida : null
      else destino = billeteraDestino(lado, r.cierre.payout?.wallet || 'falta')
      if (!destino) {
        return json(409, {
          ok: false, error: lado === 'vende_usdt' && !elegida ? 'falta_canal' : 'billetera_invalida',
          message: lado === 'vende_usdt' && !elegida
            ? 'Elige en qué canal se le acredita el COP al cliente (Mouv, Finity, Coinsenda Jero o Coinsenda Kaupaloki). No se acreditó nada.'
            : 'La billetera de destino no corresponde a esta operación. No se acreditó nada.',
        })
      }
      const monto = Number(r.cierre.to_amount)
      if (!(monto > 0)) {
        return json(409, { ok: false, error: 'sin_monto', message: 'Este cierre no tiene monto a acreditar. Fija la tasa final primero.' })
      }
      // La tasa a la que la mesa vendió los USDT (o compró los que entrega):
      // con ella queda la utilidad REAL del cierre. Antes la contabilidad la
      // estimaba con la referencia del proveedor y había que confirmarla a
      // mano antes de facturar. La pantalla la pide; aquí es opcional para no
      // frenar un completado desde una pantalla vieja, pero si viene se
      // revisa: un cero de más se volvería una "utilidad" con IVA en la
      // factura. Se valida ANTES de mover nada.
      let tasaVenta: number | null = null
      if (payload.tasaVenta !== undefined && payload.tasaVenta !== null && payload.tasaVenta !== '') {
        const t = num(payload.tasaVenta)
        const base = Number(r.cierre.rate_final)
        if (!(t > 0)) {
          return json(400, { ok: false, error: 'tasa_venta_invalida', message: 'La tasa de venta tiene que ser mayor a cero. No se acreditó nada.' })
        }
        if (base > 0 && Math.abs(t - base) / base > 0.15) {
          return json(400, {
            ok: false, error: 'tasa_venta_fuera_de_rango',
            message: `La tasa de venta ${t.toLocaleString('es-CO', { maximumFractionDigits: 2 })} se aleja más de 15 % de la del cliente (${base.toLocaleString('es-CO', { maximumFractionDigits: 2 })}). Revisa el número: no se acreditó nada.`,
          })
        }
        tasaVenta = t
      }

      // CAS sobre el estado: es el ÚNICO seguro contra completar dos veces —
      // dos clicks, dos pestañas o un reintento de red. Se toma ANTES de mover
      // plata, para que el acreditado corra una sola vez.
      // Solo desde un estado vivo explícito: con un simple "distinto de
      // completada" también pasaba una cancelada que se cancelaba en paralelo.
      const COMPLETABLES = ['abierta', 'en_proceso', 'esperando_pago', 'pagada']
      const payoutAntes = r.cierre.payout ?? null
      const { data: ok, error: errCas } = await db.from('otc_closes').update({
        status: 'completada', completada_at: ahora(), updated_at: ahora(),
        // Dónde quedó acreditado, y quién lo eligió. Es lo que leen el
        // detalle, la anulación y la pantalla del cliente (sin canalPor: ver
        // paraCliente).
        payout: { ...(payoutAntes ?? {}), wallet: destino, canalPor: caller.nombre ?? null },
      }).eq('id', r.cierre.id).in('status', COMPLETABLES)
        // Nunca un cierre que ya se acreditó alguna vez, aunque una escritura
        // vieja lo haya devuelto a un estado vivo.
        .is('completada_at', null)
        .not('rate_final', 'is', null).gt('to_amount', 0)
        // Se acredita lo que dice la fila EN ESTE MOMENTO, no lo leído antes:
        // si otro operador fijó otra tasa entre la lectura y aquí, el monto
        // viejo ya no es el que se le prometió al cliente.
        .select('id, to_amount, rate_final, rate_cotizada')
      if (errCas) return json(500, { ok: false, error: errCas.message, message: 'No se pudo completar. No se acreditó nada.' })
      if (!ok?.length) {
        // Antes esto respondía "ok, ya estaba" pasara lo que pasara: un cierre
        // que se cancelaba en paralelo se mostraba a la mesa como completado.
        const { data: ahoraEs } = await db.from('otc_closes').select('status').eq('id', r.cierre.id).maybeSingle()
        if ((ahoraEs as any)?.status === 'completada') return json(200, { ok: true, yaEstaba: true })
        return json(409, { ok: false, error: 'estado_invalido', message: 'El cierre cambió de estado mientras tanto. Recarga: no se acreditó nada.' })
      }
      const fila = ok[0] as any
      const acreditar = Number(fila.to_amount)
      // La utilidad con lo que quedó EN LA FILA (lo que de verdad se acredita),
      // no con lo leído antes del CAS.
      const venta = tasaVenta
        ? { ...ventaDeMesa({ side: r.cierre.side, from_amount: r.cierre.from_amount, to_amount: fila.to_amount }, tasaVenta), por: caller.nombre ?? null, at: ahora() }
        : null

      // Completar es lo que ACREDITA. Antes solo cambiaba el estado: el cierre
      // quedaba "completado" y el cliente sin su plata ni el movimiento.
      const { data: res, error: errSaldo } = await db.rpc('adjust_balances', {
        p_user_id: r.cierre.user_id, p_fiat: { [destino]: acreditar },
      })
      // ¿La base CONTESTÓ? adjust_balances es una sola transacción: si devolvió
      // {error} o lanzó un error de Postgres (trae código), no movió nada y se
      // puede deshacer el completado para reintentar. Si la respuesta se perdió
      // en la red (sin código), el saldo pudo haber quedado acreditado:
      // devolver el cierre a su estado dejaba completarlo otra vez —un segundo
      // crédito—. Ahí el cierre se queda completado y la mesa lo verifica.
      const fallaSegura = !!(res as any)?.error || (!!errSaldo && !!errSaldo.code)
      if (fallaSegura) {
        // No se acreditó: el cierre NO puede quedar completado. Se devuelve al
        // estado anterior para que se pueda reintentar, en vez de dejar un
        // "completado" que no movió nada.
        await db.from('otc_closes').update({ status: r.cierre.status, completada_at: null, payout: payoutAntes, updated_at: ahora() }).eq('id', r.cierre.id).eq('status', 'completada')
        const detalle = errSaldo?.message ?? (res as any)?.error
        // El detalle técnico va a la mesa (respuesta), no al hilo del cliente.
        await escribirMensaje(r.cierre.id, 'sistema', 'No se pudo acreditar el saldo todavía. El cierre sigue abierto y la mesa lo revisa.')
        return json(500, { ok: false, error: 'no_acreditado', message: `No se pudo acreditar el saldo: ${detalle}. El cierre quedó como estaba.` })
      }
      if (errSaldo) {
        const nota = `Acreditación INCIERTA (${new Date().toISOString()}): se pidió acreditar ${acreditar} ${destino} y la respuesta no llegó (${errSaldo.message}). Verificar el saldo del cliente antes de cargar nada a mano.`
        await db.from('otc_closes').update({
          payout: { ...(payoutAntes ?? {}), wallet: destino, canalPor: caller.nombre ?? null, acreditacion: 'incierta', ...(venta ? { venta } : {}) },
          notas_internas: [r.cierre.notas_internas, nota].filter(Boolean).join('\n'),
          updated_at: ahora(),
        }).eq('id', r.cierre.id)
        console.error('[otc-mesa] acreditación incierta', r.cierre.id, errSaldo.message)
        await avisarMesa(`Revisar acreditación de ${r.cierre.ref}`, 'La respuesta del saldo no llegó. Verifica si el cliente recibió la plata antes de cargar nada a mano.', `otc-${r.cierre.ref}`)
        return json(502, {
          ok: false, error: 'acreditacion_incierta',
          message: 'No llegó la confirmación del saldo. El cierre quedó completado para que NO se acredite dos veces: revisa el saldo del cliente; si no se acreditó, cárgalo a mano.',
        })
      }

      // La utilidad queda en el cierre: la mesa la ve en el detalle, la
      // contabilidad la toma como registrada (liquidacion-lincoin.ts) y el
      // cliente no la ve (paraCliente la quita). La plata ya está acreditada:
      // si esto falla no se deshace nada; se le dice a la mesa para que no
      // crea que quedó guardada.
      let ventaGuardada = true
      if (venta) {
        const { error: eV } = await db.from('otc_closes').update({
          payout: { ...(payoutAntes ?? {}), wallet: destino, canalPor: caller.nombre ?? null, venta },
        }).eq('id', r.cierre.id)
        if (eV) { ventaGuardada = false; console.error('[otc-mesa] utilidad sin guardar en el cierre', r.cierre.id, eV.message) }
      }

      // El movimiento. Si esto fallara, la plata ya esta bien y lo que falta es
      // el registro — se dice en el hilo en vez de callarlo.
      const tasa = Number(fila.rate_final ?? fila.rate_cotizada) || null
      const sinRegistro = async (motivo: string) => {
        await escribirMensaje(r.cierre.id, 'sistema', 'Saldo acreditado. El movimiento todavía no aparece en tu historial: la mesa ya fue avisada.')
        console.error('[otc-mesa] movimiento sin registrar', r.cierre.id, motivo)
        await avisarMesa(`Movimiento sin registrar en ${r.cierre.ref}`, 'El saldo se acreditó pero el movimiento no quedó en el historial del cliente.', `otc-${r.cierre.ref}`)
      }
      try {
        // supabase-js no lanza: el error viene en la respuesta. Con solo el
        // try/catch, un insert rechazado pasaba callado.
        const { error: errMov } = await db.from('transactions').insert({
          user_id: r.cierre.user_id, type: 'convert', amount: acreditar, currency: destino, status: 'Completado',
          raw_data: {
            title: `${r.cierre.from_currency} → ${r.cierre.to_currency} · Mesa OTC ${r.cierre.ref}`,
            initials: 'FX',
            fromCurrency: r.cierre.from_currency, fromAmount: Number(r.cierre.from_amount),
            destAmount: acreditar, mouvRate: tasa,
            source: 'OTC_MANUAL', otcRef: r.cierre.ref, otcCloseId: r.cierre.id,
            // El cliente RECIBE: el movimiento va en positivo. Se dice
            // explicito y no se deja deducir -- un signo al reves en un
            // movimiento de dinero no es un detalle de estilo.
            direccion: 'in',
            completadaPor: caller.nombre ?? null,
            // La utilidad de la mesa NO va aquí: el cliente lee sus propios
            // movimientos con select('*'). Queda en el cierre (payout.venta),
            // que solo lee el servidor, y de ahí la toma la contabilidad.
          },
        })
        if (errMov) await sinRegistro(errMov.message)
      } catch (e: any) {
        await sinRegistro(String(e?.message ?? e))
      }

      await escribirMensaje(r.cierre.id, 'sistema',
        `Cierre completado. Se acreditaron `
        + `${acreditar.toLocaleString('es-CO', { maximumFractionDigits: r.cierre.to_currency === 'COP' ? 0 : 2 })} ${r.cierre.to_currency} en ${NOMBRE_BILLETERA[destino] ?? destino}.`)
      return json(200, { ok: true, acreditado: acreditar, billetera: destino, venta, ventaGuardada })
    }

    // ── La tasa de venta de un cierre YA completado (23 nov) ──
    // Los cierres completados antes de que el modal pidiera la tasa (o uno
    // con un número mal escrito) quedaban sin utilidad: la caja de Lincoin no
    // los sumaba y la contabilidad los estimaba. Esto la registra o la
    // corrige; no toca la plata del cliente (lo acreditado no cambia).
    if (action === 'registrar_venta') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status !== 'completada') {
        return json(409, { ok: false, error: 'estado_invalido', message: 'Solo se registra la tasa de venta de un cierre completado. Uno vivo la pide al completarlo.' })
      }
      const t = num(payload.tasaVenta)
      const base = Number(r.cierre.rate_final)
      if (!(t > 0)) return json(400, { ok: false, error: 'tasa_venta_invalida', message: 'La tasa de venta tiene que ser mayor a cero.' })
      if (base > 0 && Math.abs(t - base) / base > 0.15) {
        return json(400, {
          ok: false, error: 'tasa_venta_fuera_de_rango',
          message: `La tasa de venta ${t.toLocaleString('es-CO', { maximumFractionDigits: 2 })} se aleja más de 15 % de la del cliente (${base.toLocaleString('es-CO', { maximumFractionDigits: 2 })}). Revisa el número.`,
        })
      }
      const anterior = r.cierre.payout?.venta ?? null
      const venta = {
        ...ventaDeMesa({ side: r.cierre.side, from_amount: r.cierre.from_amount, to_amount: r.cierre.to_amount }, t),
        por: caller.nombre ?? null, at: ahora(),
        ...(anterior ? { corregida: true, anterior: { tasa: anterior.tasa ?? null, utilidadCop: anterior.utilidadCop ?? null, por: anterior.por ?? null, at: anterior.at ?? null } } : {}),
      }
      // CAS sobre el estado: si lo anularon mientras tanto, no se escribe.
      const { data: ok, error } = await db.from('otc_closes')
        .update({ payout: { ...(r.cierre.payout ?? {}), venta }, updated_at: ahora() })
        .eq('id', r.cierre.id).eq('status', 'completada').select('id')
      if (error) return json(500, { ok: false, error: error.message })
      if (!ok?.length) return json(409, { ok: false, error: 'estado_invalido', message: 'El cierre cambió de estado mientras tanto. Recarga.' })
      try {
        await db.from('audit_log').insert({ action: 'otc_manual.registrar_venta', metadata: { cierre: r.cierre.ref, de: anterior?.tasa ?? null, a: t, utilidadCop: venta.utilidadCop, por: caller.userId ?? null } })
      } catch { /* la auditoría no frena */ }
      return json(200, { ok: true, venta })
    }

    // ── Cancelar (los dos lados, con reglas distintas) ──
    if (action === 'cancelar' || action === 'cancelar_mesa') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status === 'completada') return json(409, { ok: false, error: 'ese cierre ya se completó' })
      if (r.cierre.status === 'anulada') return json(409, { ok: false, error: 'ese cierre fue anulado' })
      if (r.cierre.status === 'cancelada') return json(200, { ok: true, yaEstaba: true })
      // El cliente solo puede cancelar mientras nadie espera su plata. Una vez
      // que dijo que pago, cancelar es decision de la mesa: puede haber dinero
      // en camino.
      if (!caller.admin && r.cierre.status === 'pagada') {
        return json(409, { ok: false, error: 'ya_pagada', message: 'Ya marcaste el envío. Escríbele a la mesa por el chat para resolverlo.' })
      }
      const motivo = String(payload.motivo ?? '').trim()
      if (caller.admin && !motivo) return json(400, { ok: false, error: 'falta el motivo de la cancelación' })
      // CAS sobre el estado: solo se cancela un cierre VIVO. Antes el UPDATE no
      // tenía condición: si el cliente cancelaba mientras la mesa completaba,
      // `completar` acreditaba y la cancelación dejaba el cierre 'cancelada'
      // con la plata ya entregada — y un cancelado se puede reabrir y volver a
      // completar (segundo crédito). El cliente, además, solo desde los
      // estados en que nadie espera su plata (sin 'pagada', ver arriba).
      const CANCELABLES: Estado[] = caller.admin ? VIVOS : VIVOS.filter(e => e !== 'pagada')
      const { data: cancelado, error: errCancel } = await db.from('otc_closes').update({
        status: 'cancelada', cancelada_at: ahora(), motivo_cierre: motivo || (caller.admin ? null : 'Cancelada por el cliente'), updated_at: ahora(),
      }).eq('id', r.cierre.id).in('status', CANCELABLES).select('id')
      if (errCancel) return json(500, { ok: false, error: errCancel.message })
      if (!cancelado?.length) return json(409, { ok: false, error: 'estado_invalido', message: 'El cierre cambió de estado mientras tanto. Recarga.' })
      await escribirMensaje(r.cierre.id, 'sistema',
        caller.admin ? `Cierre cancelado por la mesa. Motivo: ${motivo}` : 'El cliente canceló la solicitud.')
      return json(200, { ok: true })
    }

    // ── Config de la mesa manual (solo mesa) ────────────
    if (action === 'config_get') {
      const { data } = await db.from('system_config').select('value').eq('key', MARGEN_KEY).maybeSingle()
      let v: any = null
      try { v = data?.value ? JSON.parse(data.value) : null } catch { v = null }
      return json(200, {
        ok: true,
        margenDefecto: MARGEN_DEFAULT,
        ventanaMin: await ventanaPago(),
        horario: await horarioMesa(),
        horarioDefecto: HORARIO_DEFAULT,
        zona: TZ_MESA,
        estado: await estadoMesa(),
        guardado: v ?? null,
        limites: { margenMax: MARGEN_MAX, ventanaMin: VENTANA_MIN, ventanaMax: VENTANA_MAX },
      })
    }

    if (action === 'config_set') {
      // Solo el plazo. El margen NO se configura global: se pacta por cliente.
      const actual = { ventanaMin: await ventanaPago(), horario: await horarioMesa() }
      const nuevo: Record<string, any> = { ...actual }
      if (payload.ventanaMin !== undefined) {
        const n = num(payload.ventanaMin)
        if (!(Number.isFinite(n) && n >= VENTANA_MIN && n <= VENTANA_MAX)) {
          return json(400, { ok: false, error: `El plazo tiene que estar entre ${VENTANA_MIN} y ${VENTANA_MAX} minutos.` })
        }
        nuevo.ventanaMin = n
      }
      if (payload.horario !== undefined) {
        const h = normalizarHorario(payload.horario)
        // Una franja que termina antes de empezar deja el dia cerrado sin
        // decirlo: se rechaza en vez de guardarse y confundir despues.
        for (const d of DIAS) {
          if (h[d].activo && aMin(h[d].hasta) <= aMin(h[d].desde)) {
            return json(400, { ok: false, error: `El ${DIA_NOMBRE[d]} termina antes de empezar (${h[d].desde} a ${h[d].hasta}).` })
          }
        }
        nuevo.horario = h
      }
      const { error } = await db.from('system_config')
        .upsert({ key: MARGEN_KEY, value: JSON.stringify(nuevo) }, { onConflict: 'key' })
      if (error) return json(500, { ok: false, error: error.message })
      try {
        await db.from('audit_log').insert({
          action: 'otc_manual.config', metadata: { de: actual, a: nuevo, por: caller.userId ?? null },
        })
      } catch { /* la auditoria no frena el guardado */ }
      return json(200, { ok: true, ...nuevo })
    }

    // ── Notas internas (solo mesa) ──────────────────────
    if (action === 'notas') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      await db.from('otc_closes').update({
        notas_internas: String(payload.notas ?? '').slice(0, 4000), updated_at: ahora(),
      }).eq('id', r.cierre.id)
      return json(200, { ok: true })
    }

    return json(400, { ok: false, error: `accion desconocida: ${action}` })
  } catch (e: any) {
    console.error('[otc-mesa]', e?.message ?? e)
    return json(500, { ok: false, error: String(e?.message ?? e) })
  }
})
