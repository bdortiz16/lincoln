// ══════════════════════════════════════════════════════════════════
//  kyt — consulta de riesgo de una dirección cripto contra MistTrack.
//
//  El cliente pega una dirección, elige la cadena, y ve si está señalada:
//  puntaje, nivel de riesgo, hallazgos y etiquetas de la dirección.
//
//  SOLO INFORMA. No bloquea ninguna operación ni toca los caminos por donde
//  se mueve la plata. Eso fue decisión explícita: es una herramienta de
//  consulta, y meterla en el flujo de retiros es un cambio aparte que hay que
//  decidir aparte.
//
//  SIN RESULTADO NO ES "LIMPIA". Si el proveedor no responde, o responde algo
//  que no se puede interpretar, se dice que no hubo resultado. Nunca se
//  convierte la ausencia de información en un veredicto favorable — es el
//  mismo principio del AML de esta app, y el error que en este proyecto ya
//  costó plata cuando se aplicó al revés en las dispersiones.
//
//  Contrato de MistTrack (repo oficial slowmist/misttrack-skills):
//    GET  /v1/status                  → estado + monedas soportadas
//    GET  /v3/risk_score              → coin + address|txid (síncrono)
//    POST /v3/risk_score_create_task  → asíncrono (sin límite de tasa)
//    GET  /v3/risk_score_query_task   → por task_id, NO por coin+address
//    GET  /v1/address_labels          → etiquetas de la dirección
//    GET  /v1/address_overview        → saldo y estadísticas
//  La llave va por query (`api_key`). La ruta base y las rutas se pueden
//  cambiar desde el panel SIN desplegar: si MistTrack mueve un endpoint, esto
//  no se queda adivinando en silencio como nos pasó con el proveedor de rieles.
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MT_KEY       = Deno.env.get('MISTTRACK_API_KEY') ?? ''
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL   = Deno.env.get('OTP_FROM_EMAIL') ?? Deno.env.get('FROM_EMAIL') ?? 'no-reply@lincoin.me'

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CONFIG_KEY = 'kyt_config'

type Config = {
  activo: boolean
  baseUrl: string
  rutaEstado: string
  rutaRiesgo: string
  rutaEtiquetas: string
  rutaResumen: string
  rutaPerfil: string
  rutaContrapartes: string
  rutaInvestigacion: string
  rutaComportamiento: string
  topeMonitoreadas: number
  presupuestoRutas: number
  // Cada cuantas horas se vuelve a consultar una direccion monitoreada.
  horasMonitoreo: number
  // Cuántos días vale un resultado del padrón antes de volver a pagar.
  diasVigencia: number
  // Tope de consultas por cuenta por día. 0 = sin tope. Existe porque cada
  // consulta se paga y una sola cuenta puede gastarse el plan en una tarde.
  topeDiarioPorCliente: number
  // Nivel desde el cual se considera "señalada" para el resumen que ve el
  // cliente. Configurable porque MistTrack puede afinar su escala.
  puntajeAlto: number
  puntajeMedio: number
}

const CONFIG_POR_DEFECTO: Config = {
  activo: true,
  baseUrl: 'https://openapi.misttrack.io',
  rutaEstado: '/v1/status',
  rutaRiesgo: '/v3/risk_score',
  rutaEtiquetas: '/v1/address_labels',
  rutaResumen: '/v1/address_overview',
  rutaPerfil: '/v1/address_trace',
  rutaContrapartes: '/v1/address_counterparty',
  rutaInvestigacion: '/v1/transactions_investigation',
  rutaComportamiento: '/v1/address_action',
  topeMonitoreadas: 50,
  presupuestoRutas: 10,
  horasMonitoreo: 24,
  diasVigencia: 7,
  topeDiarioPorCliente: 25,
  puntajeAlto: 70,
  puntajeMedio: 40,
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

// ── Llamada al proveedor ──────────────────────────────────────────
// Devuelve SIEMPRE qué pasó, incluso cuando falla: el estado HTTP y el cuerpo
// crudo. No se traga los errores — un error tragado acá se convierte en
// "dirección limpia", que es lo peor que puede decir esta pantalla.
async function llamarMT(c: Config, ruta: string, params: Record<string, string>):
  Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  if (!MT_KEY) return { ok: false, status: 0, data: null, error: 'sin_credencial' }
  const qs = new URLSearchParams({ ...params, api_key: MT_KEY }).toString()
  const url = `${c.baseUrl.replace(/\/+$/, '')}${ruta.startsWith('/') ? '' : '/'}${ruta}?${qs}`
  try {
    const ctrl = new AbortController()
    const reloj = setTimeout(() => ctrl.abort(), 20000)
    const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctrl.signal })
    clearTimeout(reloj)
    let data: any = null
    const txt = await r.text().catch(() => '')
    try { data = txt ? JSON.parse(txt) : null } catch { data = txt }
    return { ok: r.ok, status: r.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error)?.message ?? 'red' }
  }
}

// MistTrack envuelve la respuesta como { success: bool, data: {...} } en las
// rutas v1/v2 y devuelve el objeto plano en otras. Se acepta cualquiera de las
// dos formas en vez de asumir una: asumir mal acá significa leer un veredicto
// de un objeto vacío.
function desenvolver(d: any): any {
  if (d && typeof d === 'object') {
    if (d.success === false) return null
    if (d.data && typeof d.data === 'object') return d.data
  }
  return d
}

// El MOTIVO que manda el proveedor cuando dice que no. Se perdia: desenvolver()
// devuelve null con success:false y el `msg` se tiraba, asi que un "tu plan no
// incluye esta consulta" y un "no hay datos" llegaban a la pantalla como la
// misma frase -- "el proveedor no devolvio X" -- y no habia forma de saber cual
// de las dos era. Es el mismo agujero que tenian los correos del OTP.
function motivoProveedor(d: any): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 200) || null
  if (typeof d === 'object') {
    const m = d.msg ?? d.message ?? d.error ?? d.detail ?? null
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 200)
    if (d.success === false) return 'el proveedor respondió sin datos'
  }
  return null
}

// Resultado de UNA fuente del expediente: que paso, con el motivo del
// proveedor y si nuestro parser saco algo. Va al reporte para que cada seccion
// vacia pueda decir POR QUE esta vacia.
type Fuente = { ok: boolean; status: number; motivo: string | null; conDatos: boolean }
function fuenteDe(r: { ok: boolean; status: number; data: any; error?: string } | null, parsed: any): Fuente {
  if (!r) return { ok: false, status: 0, motivo: 'no se pudo llamar al proveedor', conDatos: false }
  return {
    ok: r.ok,
    status: r.status,
    motivo: r.error ?? motivoProveedor(r.data),
    conDatos: parsed != null,
  }
}

// Un veredicto SOLO si hay un puntaje o un nivel legible. Si el proveedor
// respondió 200 con un cuerpo que no trae ninguno de los dos, no hay veredicto
// — y eso se dice, no se inventa.
function leerVeredicto(bruto: any): {
  hay: boolean
  score: number | null
  level: string | null
  riskDetail: any[]
  detailList: any[]
  hackingEvent: string | null
  hopDic: any
  addressLabel: string | null
  reportUrl: string | null
} {
  const d = desenvolver(bruto)
  const scoreRaw = d?.score ?? d?.risk_score ?? d?.riskScore
  const levelRaw = d?.risk_level ?? d?.riskLevel ?? d?.level
  const score = Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null
  const level = typeof levelRaw === 'string' && levelRaw.trim() ? levelRaw.trim() : null
  const arr = (v: any): any[] => (Array.isArray(v) ? v : [])
  const hack = typeof d?.hacking_event === 'string' ? d.hacking_event.trim() : ''
  return {
    hay: score !== null || level !== null,
    score,
    level,
    // risk_detail son OBJETOS con forma propia: { entity, risk_type,
    // exposure_type, hop_num, volume }. Se guardan tal cual y se interpretan
    // donde toca -- antes se los leia buscando label/name/type, claves que esa
    // lista no tiene, asi que con un 85/100 en pantalla la tarjeta de hallazgos
    // salia vacia.
    riskDetail: arr(d?.risk_detail ?? d?.riskDetail),
    // detail_list ES la descripcion del riesgo en texto. Es el "por que".
    detailList: arr(d?.detail_list ?? d?.detailList),
    hackingEvent: hack || null,
    // V3 agrega estos dos. hop_dic es el CAMINO: por donde se pasa para llegar
    // a la entidad senalada. Venia en la respuesta y lo estabamos tirando.
    hopDic: (d && typeof d === 'object' && !Array.isArray(d)) ? (d.hop_dic ?? d.hopDic ?? null) : null,
    addressLabel: typeof d?.address_label === 'string' ? d.address_label.trim() || null : null,
    reportUrl: typeof d?.risk_report_url === 'string' ? d.risk_report_url : (typeof d?.report_url === 'string' ? d.report_url : null),
  }
}

// ── Exposicion, calculada de risk_detail ──────────────────────────
// Sale del MISMO endpoint de riesgo, no de address_action: risk_detail ya trae
// exposure_type (direct | indirect), volume, hop_num y la entidad. Pedirselo a
// address_action era gastar una llamada que nunca iba a devolver esto.
const TIPO_ES: Record<string, string> = {
  sanctioned_entity: 'entidad sancionada',
  illicit_activity: 'actividad ilicita',
  mixer: 'mixer',
  gambling: 'apuestas',
  risk_exchange: 'exchange de riesgo',
  bridge: 'puente entre cadenas',
}

// ── hop_dic: el camino, direccion por direccion ───────────────────
// Lo agrega la V3 del risk_score. Es un diccionario { "1": [dir...], "2": [...] }
// donde el salto 1 es la ENTIDAD SENALADA y el ultimo salto es la direccion que
// preguntamos. O sea: el camino completo, con los intermediarios NOMBRADOS.
//
// Esto llega GRATIS con el veredicto que ya se paga. Recorrer ese mismo camino a
// mano cuesta una consulta por contraparte y llega solo hasta donde alcance el
// presupuesto -- por eso, cuando hay hop_dic, manda hop_dic.
//
// No se asume donde viene: se lee arriba y dentro de cada risk_detail. Si su
// forma cambia, el crudo queda igual y la seccion dice que no hubo camino, en
// lugar de inventarse uno.
function leerHopDic(v: any): { nivel: number; direcciones: string[] }[] | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const niveles = Object.keys(v)
    .map(k => ({
      nivel: Number(k),
      direcciones: (Array.isArray(v[k]) ? v[k] : [v[k]])
        .map((a: any) => (typeof a === 'string' ? a : String(a?.address ?? '')).trim())
        .filter(Boolean)
        .slice(0, 12),
    }))
    .filter(n => Number.isFinite(n.nivel) && n.direcciones.length)
    .sort((a, b) => a.nivel - b.nivel)
  return niveles.length ? niveles : null
}

// Convierte los niveles en algo que se pueda leer de un vistazo: quien
// contamina, por donde pasa, y si el camino de verdad termina en la direccion
// que preguntamos. Esto ultimo se COMPRUEBA y se informa: si el ultimo salto no
// es nuestra direccion, el camino no es de esta direccion y decirlo igual seria
// atribuirle una ruta ajena.
function caminoDeHop(dir: string, niveles: { nivel: number; direcciones: string[] }[]) {
  const bajo = niveles[0]
  const alto = niveles[niveles.length - 1]
  const medio = niveles.slice(1, -1)
  const d = dir.toLowerCase()
  const igual = (a: string) => a.toLowerCase() === d
  return {
    contaminante: bajo.direcciones[0] ?? null,
    contaminantes: bajo.direcciones,
    intermediarios: medio.flatMap(n => n.direcciones),
    // La UI vieja muestra UN intermediario; se le da el primero y la lista
    // completa aparte, para no romperla ni recortar el dato.
    intermediario: medio.length ? (medio[0].direcciones[0] ?? null) : null,
    // Saltos = tramos del camino, no niveles. Un camino de dos niveles
    // (contaminante → nosotros) es UN salto.
    saltos: Math.max(1, niveles.length - 1),
    niveles: niveles.length,
    camino: niveles,
    terminaEnLaDireccion: alto.direcciones.some(igual),
    // Si nuestra direccion aparece en el nivel mas bajo, el "contaminante" del
    // camino somos nosotros: el camino esta al reves o es de otra direccion.
    empiezaEnLaDireccion: bajo.direcciones.some(igual),
  }
}

function exposicionDe(riskDetail: any[], hopTop?: any): Record<string, any> | null {
  const items = (Array.isArray(riskDetail) ? riskDetail : [])
    .filter(x => x && typeof x === 'object')
    .map(x => ({
      entidad: String(x.entity ?? '').trim() || null,
      tipo: String(x.risk_type ?? '').trim() || null,
      tipoEs: TIPO_ES[String(x.risk_type ?? '')] ?? (String(x.risk_type ?? '').replace(/_/g, ' ') || null),
      exposicion: String(x.exposure_type ?? '').trim().toLowerCase() || null,
      saltos: Number.isFinite(Number(x.hop_num)) ? Number(x.hop_num) : null,
      volumen: Number.isFinite(Number(x.volume)) ? Number(x.volume) : null,
      // percent viene en la documentacion y no se leia: es la parte del volumen
      // de la direccion que pasa por esta ruta, que es lo que dice si el vinculo
      // es marginal o es casi toda su actividad.
      pct: Number.isFinite(Number(x.percent)) ? Number(x.percent) : null,
      // El camino de ESTE hallazgo, si el proveedor lo manda por hallazgo.
      camino: leerHopDic(x.hop_dic ?? x.hopDic),
    }))
  if (!items.length) return null
  const directas = items.filter(i => i.exposicion === 'direct')
  const indirectas = items.filter(i => i.exposicion === 'indirect')
  const suma = (a: any[]) => a.reduce((t, i) => t + (i.volumen ?? 0), 0)
  const total = suma(items)
  const volIndirecto = suma(indirectas)
  return {
    items: items.slice(0, 20),
    directas: directas.length,
    indirectas: indirectas.length,
    volumenTotal: total || null,
    volumenIndirecto: volIndirecto || null,
    // El porcentaje SOLO si hay volumenes: sin ellos no se puede calcular y
    // poner 0 seria afirmar que no hay exposicion.
    pctIndirecto: total > 0 ? Math.round((volIndirecto / total) * 1000) / 10 : null,
    saltoMinimo: indirectas.length ? Math.min(...indirectas.map(i => i.saltos ?? 99)) : null,
    // El hop_dic de la respuesta entera, cuando no viene por hallazgo. Se deja
    // aparte a proposito: pegarselo a cada hallazgo seria afirmar que todos
    // pasan por el mismo camino, y eso no lo dice el proveedor.
    caminoGeneral: leerHopDic(hopTop) ?? null,
    conCamino: items.some(i => i.camino) || !!leerHopDic(hopTop),
  }
}

// Clasificación propia, en español, para lo que ve el cliente. Se calcula del
// nivel que manda MistTrack y, si no viene, del puntaje.
function clasificar(c: Config, score: number | null, level: string | null): 'alto' | 'medio' | 'bajo' | 'sin_dato' {
  const l = String(level ?? '').toUpperCase()
  if (/SEVERE|CRITICAL|HIGH|ALTO/.test(l)) return 'alto'
  if (/MODERATE|MEDIUM|MEDIO/.test(l)) return 'medio'
  if (/LOW|BAJO|NONE|CLEAN/.test(l)) return 'bajo'
  if (score === null) return 'sin_dato'
  if (score >= c.puntajeAlto) return 'alto'
  if (score >= c.puntajeMedio) return 'medio'
  return 'bajo'
}

const normDir = (s: string) => String(s ?? '').trim()

// ── Codigos de red de MistTrack ───────────────────────────────────
// De su documentacion oficial. Son mas de 200 tokens; estas son las cadenas.
// OJO CON zkSync: va en mayuscula y minuscula MEZCLADAS. El codigo hacia
// toUpperCase() a lo que llegaba del cliente, asi que esa red habria fallado
// siempre -- y el fallo se habria visto como "sin resultado", que en esta
// pantalla se lee como un problema nuestro y no como una red mal escrita.
const REDES_MT = [
  'BTC', 'ETH', 'TRX', 'BNB', 'SOL', 'MATIC', 'ARB', 'BASE', 'AVAX',
  'OP', 'zkSync', 'TON', 'SUI', 'LTC', 'DOGE', 'BCH', 'IOTX', 'HSK',
] as const

// Devuelve el codigo con la GRAFIA que espera el proveedor. Hace falta para
// dos cosas: que la llamada salga bien, y que el padron no guarde la misma red
// con dos grafias distintas y pague dos veces por el mismo dato.
function canonCoin(v: string): string {
  const x = String(v ?? '').trim()
  if (!x) return ''
  const hit = REDES_MT.find(r => r.toLowerCase() === x.toLowerCase())
  // Una red que no conocemos se manda TAL CUAL: la lista real la tiene
  // /v1/status, y preferimos que el proveedor la rechace antes que rechazarla
  // nosotros por no tenerla anotada.
  return hit ?? x
}

// ── Padrón ────────────────────────────────────────────────────────
async function padronBuscar(coin: string, dir: string) {
  const { data } = await db.from('kyt_registry')
    .select('*').eq('coin', coin).eq('address_lower', dir.toLowerCase()).maybeSingle()
  return (data as any) ?? null
}

// Anota que una cuenta usó esta ficha. Hace falta para poder nombrar al
// reportante aunque la consulta se haya reutilizado y no se haya pagado.
function anotarEmpresa(previas: any, quien: { userId: string | null; email?: string | null; empresa?: string | null }) {
  const lista = Array.isArray(previas) ? previas : []
  const ya = lista.find((e: any) => e && e.userId === quien.userId)
  if (ya) {
    ya.veces = Number(ya.veces ?? 1) + 1
    ya.ultimaAt = new Date().toISOString()
    return lista.slice(0, 200)
  }
  return [...lista, { ...quien, veces: 1, primeraAt: new Date().toISOString(), ultimaAt: new Date().toISOString() }].slice(0, 200)
}

// ── Validación del formato según la red ───────────────────────────
// Se comprueba ANTES de llamar al proveedor. Una dirección de Ethereum
// consultada como TRON es una consulta pagada que no sirve para nada, y el
// cliente recibe un "sin resultado" que parece un problema nuestro.
const FORMATOS: Record<string, RegExp> = {
  TRX:  /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  BTC:  /^(bc1[0-9a-z]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  BCH:  /^((bitcoincash:)?[qp][0-9a-z]{41}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  LTC:  /^(ltc1[0-9a-z]{11,71}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,33})$/,
  DOGE: /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/,
  SOL:  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  SUI:  /^0x[0-9a-fA-F]{64}$/,
  TON:  /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/,
}
// Las cadenas EVM comparten formato. Se listan por nombre para poder decirle
// al cliente cuál eligió, no para distinguir el formato.
// Las cadenas EVM comparten formato de direccion. Se compara en minusculas
// para que zkSync entre igual sin romper su grafia.
const EVM = new Set(['eth', 'bnb', 'bsc', 'matic', 'polygon', 'arb', 'op', 'base', 'avax', 'zksync', 'merlin', 'hsk', 'iotx'])
function formatoValido(coin: string, dir: string): boolean {
  const c = coin.toLowerCase()
  if (EVM.has(c)) return /^0x[0-9a-fA-F]{40}$/.test(dir)
  const re = FORMATOS[coin.toUpperCase()]
  // Red que no conocemos: NO se rechaza. Preferimos gastar una consulta antes
  // que bloquear una red que el proveedor sí soporta y nosotros no listamos.
  return re ? re.test(dir) : dir.length >= 20 && dir.length <= 120
}

// ── Actividad de la dirección (address_overview) ──────────────────
//
// UN CERO NO ES UN SALDO SI NO HUBO NINGUNA TRANSACCION.
//   El reporte mostraba "0,00 TRX · 0 transacciones · sin dato de antigüedad"
//   para una dirección con 4.954 USD de exposición indirecta. Las dos cosas no
//   pueden ser ciertas a la vez: si nunca se movió nada, no hay por dónde
//   haberse expuesto. Ese cero no era un saldo, era un overview vacío pintado
//   como si fuera un dato — justo lo que la cabecera de este archivo promete no
//   hacer.
//
//   Ahora, si TODO viene en cero y ademas no hay ni primera ni ultima
//   transaccion, se devuelve null: la tarjeta dice "sin dato", que es la
//   verdad.
function leerActividad(bruto: any): Record<string, any> | null {
  const d = desenvolver(bruto)
  if (!d || typeof d !== 'object') return null
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : null)
  const out = {
    txs: n(d.txs_count ?? d.txCount ?? d.transactions_count ?? d.tx_count),
    primera: d.first_seen ?? d.firstSeen ?? d.first_tx_time ?? null,
    ultima: d.last_seen ?? d.lastSeen ?? d.last_tx_time ?? null,
    recibido: n(d.total_received ?? d.totalReceived),
    enviado: n(d.total_spent ?? d.totalSpent ?? d.total_sent),
    saldo: n(d.balance),
  }
  const sinFechas = !out.primera && !out.ultima
  const todoCero = [out.txs, out.recibido, out.enviado, out.saldo]
    .every(v => v === null || v === 0)
  if (sinFechas && todoCero) return null
  // Si no trajo NADA utilizable, es null y la tarjeta dirá que no hay dato.
  // Devolver un objeto de nulos haría que la pantalla muestre guiones como si
  // fueran datos.
  return Object.values(out).some(v => v !== null) ? out : null
}

// ── El saldo que de verdad importa: el del token ──────────────────
// address_overview devuelve la moneda NATIVA de la cadena. Una wallet de TRON
// que movió cien mil dólares en USDT puede tener 0 TRX, y el reporte mostraba
// ese 0 como si fuera todo el saldo.
//
// MistTrack trata cada token como una "coin" propia, con su propio código. Se
// consulta el estable de la red ademas del nativo.
//
// CUESTA PLATA: cada address_overview son USD 0,50 segun su tarifario. Por eso
// es UNA consulta extra, la del estable principal de esa red, y no un barrido
// de todos los tokens.
const TOKEN_DE_RED: Record<string, string> = {
  TRX: 'USDT-TRC20',
  ETH: 'USDT-ERC20',
  BNB: 'USDT-BEP20',
  MATIC: 'USDT-Polygon',
  ARB: 'USDT-Arbitrum',
  OP: 'USDT-Optimism',
  AVAX: 'USDT-Avalanche',
}
const tokenDe = (coin: string): string | null => TOKEN_DE_RED[String(coin ?? '').toUpperCase()] ?? null

// ── Perfil de la direccion (address_trace) ────────────────────────
// Campos REALES de la documentacion: use_platform, malicious_event,
// relation_info y first_address. Antes se leian platform_list y
// malicious_event_list -- nombres que invente -- asi que el perfil venia
// siempre vacio, y no se notaba porque la tarjeta simplemente no aparecia.
function leerPerfil(bruto: any): Record<string, any> | null {
  const d = desenvolver(bruto)
  if (!d || typeof d !== 'object') return null
  const nombres = (v: any): string[] => {
    if (!v) return []
    const arr = Array.isArray(v) ? v : (Array.isArray(v.list) ? v.list : [])
    return arr
      .map((x: any) => typeof x === 'string' ? x : String(x?.name ?? x?.platform ?? x?.label ?? ''))
      .map((t: string) => t.trim()).filter(Boolean).slice(0, 20)
  }
  const up = d.use_platform ?? {}
  const plataformas = {
    exchange: nombres(up.exchange), dex: nombres(up.dex),
    mixer: nombres(up.mixer), nft: nombres(up.nft),
  }
  const me = d.malicious_event ?? {}
  const eventos = {
    phishing: nombres(me.phishing), ransom: nombres(me.ransom),
    stealing: nombres(me.stealing), laundering: nombres(me.laundering),
  }
  const ri = d.relation_info ?? {}
  const relaciones = { wallet: nombres(ri.wallet), ens: nombres(ri.ens), twitter: nombres(ri.twitter) }
  const primera = typeof d.first_address === 'string' ? d.first_address
    : (d.first_address?.label ?? d.first_address?.address ?? null)
  const algo = Object.values(plataformas).some(a => a.length)
    || Object.values(eventos).some(a => a.length)
    || Object.values(relaciones).some(a => a.length) || !!primera
  return algo ? { plataformas, eventos, relaciones, primeraFuente: primera } : null
}

// ── Contrapartes (address_counterparty) ───────────────────────────
// No soporta hot wallets: devuelve UnsupportedAddressType. Eso NO es un error
// nuestro y se informa como tal, no como "sin datos".
function leerContrapartes(bruto: any): Record<string, any> | null {
  const d = desenvolver(bruto)
  let crudo = ''
  try { crudo = JSON.stringify(bruto ?? '') } catch { crudo = '' }
  if (/UnsupportedAddressType/i.test(crudo)) return { noSoportada: true, items: [] }
  const lista = d?.address_counterparty_list
  if (!Array.isArray(lista) || !lista.length) return null
  return {
    noSoportada: false,
    items: lista.slice(0, 25).map((x: any) => ({
      nombre: String(x?.name ?? '').trim() || null,
      montoUsd: Number.isFinite(Number(x?.amount)) ? Number(x.amount) : null,
      pct: Number.isFinite(Number(x?.percent)) ? Number(x.percent) : null,
    })),
  }
}

// ── Investigacion de transacciones (transactions_investigation) ───
// Cada contraparte trae `type`: 1 normal, 2 MALICIOSA, 3 entidad, 4 contrato.
// El tipo 2 es lo que importa: contrapartes senaladas, con monto y hashes. Es
// el "ranking de posibles contaminadores".
const TIPO_CONTRAPARTE: Record<string, string> = { '1': 'normal', '2': 'maliciosa', '3': 'entidad', '4': 'contrato' }
function leerInvestigacion(bruto: any): Record<string, any> | null {
  const d = desenvolver(bruto)
  if (!d || typeof d !== 'object') return null
  const mapa = (arr: any, flujo: 'entrada' | 'salida') => (Array.isArray(arr) ? arr : []).map((x: any) => ({
    direccion: String(x?.address ?? '').trim() || null,
    tipo: TIPO_CONTRAPARTE[String(x?.type ?? '')] ?? null,
    tipoNum: Number(x?.type) || null,
    etiqueta: String(x?.label ?? '').trim() || null,
    monto: Number.isFinite(Number(x?.amount)) ? Number(x.amount) : null,
    hashes: Array.isArray(x?.tx_hash_list) ? x.tx_hash_list.slice(0, 5) : [],
    flujo,
  }))
  const entradas = mapa(d.in, 'entrada')
  const salidas = mapa(d.out, 'salida')
  if (!entradas.length && !salidas.length) return null
  const maliciosas = [...entradas, ...salidas].filter(x => x.tipoNum === 2)
    .sort((a, b) => (b.monto ?? 0) - (a.monto ?? 0))
  return { entradas: entradas.slice(0, 40), salidas: salidas.slice(0, 40), maliciosas: maliciosas.slice(0, 25), paginas: Number(d.total_pages) || 1 }
}

// ── Comportamiento (address_action) ───────────────────────────────
// received_txs / spent_txs con action, count y proportion. NO es exposicion a
// riesgo -- eso sale de risk_detail -- es en que usa la direccion su volumen.
function leerComportamiento(bruto: any): Record<string, any> | null {
  const d = desenvolver(bruto)
  if (!d || typeof d !== 'object') return null
  const mapa = (arr: any) => (Array.isArray(arr) ? arr : []).map((x: any) => ({
    accion: String(x?.action ?? '').trim() || null,
    veces: Number(x?.count) || null,
    pct: Number.isFinite(Number(x?.proportion))
      ? (Number(x.proportion) <= 1 ? Number(x.proportion) * 100 : Number(x.proportion)) : null,
  })).filter((x: any) => x.accion).slice(0, 12)
  const recibido = mapa(d.received_txs)
  const enviado = mapa(d.spent_txs)
  if (!recibido.length && !enviado.length) return null
  return { recibido, enviado }
}

// Guarda la ficha con las columnas nuevas y, si la base todavia no las tiene,
// la vuelve a guardar sin ellas. Devuelve si el camino entro.
//
// No es paranoia: `2026_kyt_hop_dic.sql` lo corre una persona a mano y el
// codigo se despliega solo. Entre una cosa y la otra, nombrar una columna
// inexistente tira la fila COMPLETA, no la columna.
let faltanColumnasHop = false
async function guardarFicha(base: Record<string, unknown>, extra: Record<string, unknown>): Promise<boolean> {
  if (!faltanColumnasHop) {
    const { error } = await db.from('kyt_registry').upsert({ ...base, ...extra }, { onConflict: 'coin,address_lower' })
    if (!error) return true
    // 42703 = undefined_column. Cualquier otro error se reintenta igual sin las
    // columnas nuevas: perder el veredicto por no poder guardar el camino seria
    // el peor de los dos resultados.
    if (/hop_dic|address_label|hop_at|token_actividad|42703|does not exist/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
      faltanColumnasHop = true
      console.warn('[kyt] falta correr 2026_kyt_hop_dic.sql: se guarda la ficha sin el camino (hop_dic).')
    } else {
      console.error('[kyt] no se pudo guardar la ficha:', error.message)
    }
  }
  const { error: e2 } = await db.from('kyt_registry').upsert(base, { onConflict: 'coin,address_lower' })
  if (e2) console.error('[kyt] no se pudo guardar la ficha ni sin el camino:', e2.message)
  return false
}

// Auditar no puede hacer fallar la operacion que audita.
async function logAuditKyt(userId: string | null, action: string, metadata: Record<string, unknown>) {
  try { await db.from('audit_log').insert({ user_id: userId, action, metadata }) } catch { /* no bloquea */ }
}

// ── Consulta PAGADA + guardado en el padrón ───────────────────────
// La usan la consulta del cliente y la ronda de monitoreo. Una sola
// implementación a propósito: dos copias de esto se habrían separado, y una de
// las dos habría acabado interpretando el veredicto distinto que la otra.
async function evaluarYGuardar(
  c: Config, coin: string, dir: string,
  quien: { userId: string | null; email?: string | null; empresa?: string | null },
  ficha: any,
): Promise<{ hay: boolean; score: number | null; level: string | null; hallazgos: any[]; detalle: any[]; etiquetas: any[]; reporte: string | null; actividad: any; exposicion: any; status: number; crudo: any; error?: string }> {
  const r = await llamarMT(c, c.rutaRiesgo, { coin, address: dir })
  const v = leerVeredicto(r.data)

  if (!r.ok || !v.hay) {
    await db.from('kyt_registry').upsert({
      coin, address_lower: dir.toLowerCase(), address: dir,
      estado: 'sin_resultado',
      respuesta_cruda: { status: r.status, error: r.error ?? null, data: r.data ?? null },
      actualizado_at: new Date().toISOString(),
      empresas: anotarEmpresa(ficha?.empresas, quien),
    }, { onConflict: 'coin,address_lower' })
    return { hay: false, score: null, level: null, hallazgos: [], detalle: [], etiquetas: [], reporte: null, actividad: null, exposicion: null, status: r.status, crudo: r.data ?? r.error ?? null, error: r.error }
  }

  // Los enriquecimientos son OPCIONALES: si fallan, el veredicto vale igual.
  // Se piden en paralelo para no encadenar esperas.
  const token = tokenDe(coin)
  const [eEtq, eRes, ePerfil, eTok] = await Promise.all([
    llamarMT(c, c.rutaEtiquetas, { coin, address: dir }).catch(() => null),
    llamarMT(c, c.rutaResumen, { coin, address: dir }).catch(() => null),
    llamarMT(c, c.rutaPerfil, { coin, address: dir }).catch(() => null),
    token ? llamarMT(c, c.rutaResumen, { coin: token, address: dir }).catch(() => null) : Promise.resolve(null),
  ])
  let etiquetas: any[] = []
  if (eEtq?.ok) {
    const d = desenvolver(eEtq.data)
    const l = d?.label_list ?? d?.labels ?? d?.label ?? []
    etiquetas = Array.isArray(l) ? l : (l ? [l] : [])
  }
  // address_label de la V3 va con las etiquetas: es una mas, y de la fuente
  // mas confiable que tenemos. Se agrega sin duplicar.
  if (v.addressLabel && !etiquetas.some(e => String(typeof e === 'string' ? e : e?.label ?? e?.name ?? '').toLowerCase() === v.addressLabel!.toLowerCase())) {
    etiquetas = [v.addressLabel, ...etiquetas]
  }
  const actividad = eRes?.ok ? leerActividad(eRes.data) : null
  // El saldo y los movimientos del estable de la red. Va aparte del nativo a
  // propósito: son dos activos distintos y sumarlos o pisarlos sería mentir.
  const actToken = eTok?.ok ? leerActividad(eTok.data) : null
  const tokenActividad = actToken ? { ...actToken, simbolo: 'USDT', coin: token } : null
  // De risk_detail y hop_dic, que ya vinieron con el veredicto.
  const exposicion = exposicionDe(v.riskDetail, v.hopDic)
  // Perfil: plataformas con las que interactuo y eventos maliciosos asociados.
  const perfil = ePerfil?.ok ? leerPerfil(ePerfil.data) : null

  const ahora = new Date().toISOString()
  const base = {
    coin, address_lower: dir.toLowerCase(), address: dir,
    risk_score: v.score, risk_level: v.level,
    risk_detail: v.riskDetail, detail_list: v.detailList,
    labels: etiquetas, report_url: v.reportUrl,
    actividad, exposicion, perfil, hacking_event: v.hackingEvent,
    estado: 'finalizado',
    respuesta_cruda: r.data ?? null,
    consultado_at: ahora, actualizado_at: ahora,
    veces_consultado: Number(ficha?.veces_consultado ?? 0) + 1,
    veces_reutilizado: Number(ficha?.veces_reutilizado ?? 0),
    empresas: anotarEmpresa(ficha?.empresas, quien),
  }
  // Las columnas del camino van aparte y con reintento SIN ellas.
  //
  // Las edge functions se despliegan solas al hacer push; el SQL lo corre una
  // persona. En la ventana entre las dos cosas, un insert que nombra una
  // columna que todavia no existe NO guarda nada: PostgREST rechaza la fila
  // entera. O sea que agregar el camino habria dejado de guardar el veredicto
  // — la parte que si funcionaba — hasta que alguien se acordara de la
  // migracion. Con este reintento, mientras falte el SQL se guarda todo menos
  // el camino, y en el log queda dicho por que.
  await guardarFicha(base, {
    hop_dic: v.hopDic ?? null, address_label: v.addressLabel, hop_at: ahora,
    token_actividad: tokenActividad,
  })

  return {
    hay: true, score: v.score, level: v.level,
    hallazgos: v.riskDetail, detalle: v.detailList, etiquetas,
    hackingEvent: v.hackingEvent, perfil,
    hopDic: v.hopDic ?? null, addressLabel: v.addressLabel,
    tokenActividad,
    reporte: v.reportUrl, actividad, exposicion,
    status: r.status, crudo: r.data ?? null,
  }
}

// ── Correo de alerta de cambio de riesgo ──────────────────────────
// La pantalla le promete al cliente que le avisamos por correo. Si esto no
// existiera, esa frase seria falsa -- y una promesa de aviso que no se cumple
// es peor que no prometer nada: el cliente deja de revisar porque cree que le
// van a avisar.
//
// Devuelve si se envio, para no marcar aviso_enviado cuando no salio.
async function avisarPorCorreo(userId: string, datos: {
  alias: string | null; address: string; coin: string;
  antes: number | null; despues: number | null; motivo: string | null;
}): Promise<boolean> {
  if (!RESEND_KEY) return false
  const { data: u } = await db.from('users').select('email, full_name, company_name').eq('id', userId).maybeSingle()
  const to = (u as any)?.email
  if (!to) return false
  const nombre = String((u as any)?.company_name ?? (u as any)?.full_name ?? '').split(' ')[0] ?? ''
  const corta = datos.address.length > 14 ? `${datos.address.slice(0, 6)}…${datos.address.slice(-4)}` : datos.address
  const etiqueta = datos.alias || corta

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F0EFEB">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0EFEB"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid rgba(21,24,26,0.08);border-radius:14px">
<tr><td style="padding:28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-family:'Archivo',Arial,sans-serif;font-size:22px;font-weight:800;color:#15181A">Lincoin<span style="color:#22A35C">.</span></td>
    <td align="right" style="font-family:Arial,sans-serif;font-size:11px;color:#9B9F9B">Verificacion de direcciones</td>
  </tr></table>
  <p style="font-family:'Archivo',Arial,sans-serif;font-size:19px;font-weight:800;color:#15181A;margin:26px 0 10px">Cambio de riesgo en una direccion que monitoreas</p>
  <p style="font-family:Arial,sans-serif;font-size:13.5px;color:#5C625E;line-height:1.6;margin:0 0 18px">Hola${nombre ? `, ${nombre}` : ''}. La direccion <b style="color:#15181A">${etiqueta}</b> que tenes guardada en KYT cambio de clasificacion de riesgo.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:12.5px">
    <tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Direccion</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700;font-family:monospace">${corta}</td></tr>
    <tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Red</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${datos.coin}</td></tr>
    <tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Puntaje</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${datos.antes ?? '-'} a ${datos.despues ?? '-'} / 100</td></tr>
    ${datos.motivo ? `<tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Motivo</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${datos.motivo}</td></tr>` : ''}
  </table>
  <p style="font-family:Arial,sans-serif;font-size:12.5px;color:#5C625E;line-height:1.6;margin:20px 0 0">Esto no bloquea ninguna operacion: es informacion para que decidas. Podes ver el detalle en Servicios, KYT.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid rgba(21,24,26,0.06)"><tr><td style="padding-top:18px">
    <p style="font-family:Arial,sans-serif;font-size:10.5px;color:#9B9F9B;line-height:1.6;margin:0">Recibiste este correo porque guardaste esta direccion para monitoreo en tu cuenta Lincoin. Lincoin no es un banco. El resultado refleja la informacion disponible hoy y puede cambiar.</p>
  </td></tr></table>
</td></tr></table>
</td></tr></table>
</body></html>`

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM_EMAIL}>`, to: [to],
        subject: `Cambio de riesgo en ${etiqueta}`,
        html,
      }),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      console.error(`[kyt] Resend rechazo el aviso - HTTP ${r.status} - ${t.slice(0, 200)}`)
      return false
    }
    return true
  } catch (e) {
    console.error('[kyt] fallo el aviso por correo:', (e as Error)?.message)
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const accion = String(body.action ?? '')
    const yo = await quienLlama(req)
    if (!yo.userId && !yo.esAdmin) return json({ error: 'no_autorizado' }, 401)

    const c = await leerConfig()

    // ── Configuración (admin) ─────────────────────────────────────
    if (accion === 'config_get') {
      if (!yo.esAdmin) return json({ error: 'no_autorizado' }, 401)
      // Se dice SI hay credencial, nunca cuál ni dónde vive. La llave está en
      // la Bóveda y de ahí no sale ni en forma de pista.
      return json({ ok: true, config: c, credencial: !!MT_KEY })
    }
    if (accion === 'config_set') {
      if (!yo.esAdmin) return json({ error: 'no_autorizado' }, 401)
      const nueva: Config = { ...c, ...(body.config ?? {}) }
      nueva.diasVigencia = Math.max(0, Math.min(365, Number(nueva.diasVigencia) || 0))
      nueva.topeDiarioPorCliente = Math.max(0, Math.min(10000, Number(nueva.topeDiarioPorCliente) || 0))
      nueva.puntajeAlto = Math.max(1, Math.min(100, Number(nueva.puntajeAlto) || 70))
      nueva.puntajeMedio = Math.max(1, Math.min(nueva.puntajeAlto, Number(nueva.puntajeMedio) || 40))
      nueva.topeMonitoreadas = Math.max(1, Math.min(2000, Number(nueva.topeMonitoreadas) || 50))
      nueva.horasMonitoreo = Math.max(1, Math.min(720, Number(nueva.horasMonitoreo) || 24))
      await guardarConfig(nueva)
      return json({ ok: true, config: nueva })
    }

    // ── Cadenas soportadas, según el proveedor ────────────────────
    // No se hardcodean: se le preguntan a MistTrack. Una lista de cadenas
    // escrita a mano se desactualiza en silencio y el cliente recibe un error
    // sin explicación al elegir una que el proveedor ya no acepta.
    if (accion === 'cadenas') {
      const r = await llamarMT(c, c.rutaEstado, {})
      const d = r.ok ? (desenvolver(r.data) ?? {}) : {}
      const lista = (d.coin_list ?? d.coins ?? d.supported_coins ?? d.list ?? []) as any[]
      // Si el proveedor no contesta, se devuelve la lista conocida en vez de un
      // error: un selector de redes vacio deja la pantalla inservible, y estos
      // codigos salen de su propia documentacion.
      return json({
        ok: true,
        cadenas: Array.isArray(lista) && lista.length ? lista : REDES_MT.map(v => ({ coin: v })),
        delProveedor: Array.isArray(lista) && lista.length > 0,
        crudo: yo.esAdmin ? r.data : undefined,
      })
    }

    // ── CONSULTA ──────────────────────────────────────────────────
    if (accion === 'consultar') {
      if (!c.activo) return json({ ok: false, error: 'inactivo', mensaje: 'El servicio no está habilitado.' })

      const coin = canonCoin(body.coin)
      const dir = normDir(body.address)
      if (!coin) return json({ ok: false, error: 'falta_cadena', mensaje: 'Elegí la red de la dirección.' })
      if (dir.length < 20 || dir.length > 120) {
        return json({ ok: false, error: 'direccion_invalida', mensaje: 'Esa no parece una dirección válida.' })
      }
      // Se valida el formato ANTES de gastar una consulta: una dirección de
      // Ethereum preguntada como TRON es un crédito perdido y un "sin
      // resultado" que parece un problema nuestro.
      if (!formatoValido(coin, dir)) {
        return json({ ok: false, error: 'formato_red', mensaje: `Esa dirección no tiene el formato de ${coin}. Revisá la red que elegiste.` })
      }

      const quien = {
        userId: yo.userId,
        email: null as string | null,
        empresa: null as string | null,
      }
      if (yo.userId) {
        const { data: u } = await db.from('users').select('email, company_name').eq('id', yo.userId).maybeSingle()
        quien.email = (u as any)?.email ?? null
        quien.empresa = (u as any)?.company_name ?? null
      }

      // 1) El padrón primero. Solo se reutiliza una ficha FINALIZADA y
      //    vigente: una consulta sin resultado no ahorra nada, porque no
      //    sabemos nada de esa dirección.
      const ficha = await padronBuscar(coin, dir)
      const vigenteHasta = ficha?.consultado_at
        ? new Date(ficha.consultado_at).getTime() + c.diasVigencia * 86400_000
        : 0
      // `force` saltea el padron y paga una consulta nueva. Hace falta porque
      // una ficha vieja puede no tener los datos que hoy mostramos (actividad,
      // exposicion) y reutilizarla deja la pantalla a medias sin explicacion.
      const force = body.force === true
      const sirve = !force && !!ficha && ficha.estado === 'finalizado' && Date.now() < vigenteHasta

      if (sirve) {
        await db.from('kyt_registry').update({
          veces_reutilizado: Number(ficha.veces_reutilizado ?? 0) + 1,
          actualizado_at: new Date().toISOString(),
          empresas: anotarEmpresa(ficha.empresas, quien),
        }).eq('coin', coin).eq('address_lower', dir.toLowerCase())

        return json({
          ok: true,
          address: ficha.address,
          coin,
          categoria: clasificar(c, ficha.risk_score, ficha.risk_level),
          puntaje: ficha.risk_score,
          nivel: ficha.risk_level,
          hallazgos: ficha.risk_detail ?? [],
          etiquetas: ficha.labels ?? [],
          detalle: ficha.detail_list ?? [],
          actividad: ficha.actividad ?? null,
          tokenActividad: ficha.token_actividad ?? null,
          exposicion: ficha.exposicion ?? null,
          hopDic: ficha.hop_dic ?? null,
          perfil: ficha.perfil ?? null,
          hackingEvent: ficha.hacking_event ?? null,
          reporte: ficha.report_url,
          estado: 'finalizado',
          delPadron: true,
          consultadoAt: ficha.consultado_at,
        })
      }

      // 2) Tope diario por cuenta. Cada consulta se paga; una sola cuenta no
      //    puede gastarse el plan en una tarde.
      if (!yo.esAdmin && c.topeDiarioPorCliente > 0 && yo.userId) {
        const desde = new Date(Date.now() - 86400_000).toISOString()
        const { count } = await db.from('audit_log')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', yo.userId).eq('action', 'kyt.consulta_pagada')
          .gte('created_at', desde)
        if ((count ?? 0) >= c.topeDiarioPorCliente) {
          return json({ ok: false, error: 'tope_diario', mensaje: `Llegaste al tope de ${c.topeDiarioPorCliente} consultas por día.` })
        }
      }

      // 3) Se paga la consulta. La misma función que usa la ronda de
      //    monitoreo, para que las dos interpreten el veredicto igual.
      const ev = await evaluarYGuardar(c, coin, dir, quien, ficha)

      if (!ev.hay) {
        // NO HAY VEREDICTO. Se devolvió ya guardado como 'sin_resultado' para
        // no repetir el gasto a ciegas, pero no se devuelve nada que se pueda
        // leer como "está limpia".
        return json({
          ok: false,
          error: ev.error === 'sin_credencial' ? 'sin_credencial' : 'sin_resultado',
          estado: 'sin_resultado',
          mensaje: ev.error === 'sin_credencial'
            ? 'El servicio no está configurado todavía.'
            : 'No pudimos obtener un resultado para esa dirección. No significa que esté limpia: significa que no sabemos.',
          status: yo.esAdmin ? ev.status : undefined,
          detalle: yo.esAdmin ? ev.crudo : undefined,
        })
      }

      try {
        await db.from('audit_log').insert({
          user_id: yo.userId, action: 'kyt.consulta_pagada',
          metadata: { coin, address: dir, score: ev.score, level: ev.level, empresa: quien.empresa },
        })
      } catch { /* que no se pierda la consulta por no poder auditar */ }

      return json({
        ok: true,
        address: dir, coin,
        categoria: clasificar(c, ev.score, ev.level),
        puntaje: ev.score, nivel: ev.level,
        hallazgos: ev.hallazgos, etiquetas: ev.etiquetas, detalle: ev.detalle,
        actividad: ev.actividad, tokenActividad: ev.tokenActividad ?? null,
        exposicion: ev.exposicion,
        hopDic: ev.hopDic ?? null,
        hackingEvent: ev.hackingEvent ?? null, perfil: ev.perfil ?? null,
        reporte: ev.reporte,
        estado: 'finalizado',
        delPadron: false,
        consultadoAt: new Date().toISOString(),
      })
    }

    // ── GUARDAR Y MONITOREAR ──────────────────────────────────────
    if (accion === 'guardar') {
      if (!yo.userId) return json({ error: 'no_autorizado' }, 401)
      const coin = canonCoin(body.coin)
      const dir = normDir(body.address)
      const alias = String(body.alias ?? '').trim().slice(0, 80)
      if (!coin || !dir) return json({ ok: false, error: 'faltan_datos' })

      // El tope cuenta solo las ACTIVAS: si dejaste de monitorear una, ese
      // lugar se libera.
      const { count } = await db.from('kyt_watchlist')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', yo.userId).eq('activo', true)
      const yaEsta = await db.from('kyt_watchlist')
        .select('id').eq('user_id', yo.userId).eq('coin', coin)
        .eq('address_lower', dir.toLowerCase()).maybeSingle()
      if (!yaEsta.data && (count ?? 0) >= c.topeMonitoreadas) {
        return json({ ok: false, error: 'tope', mensaje: `Llegaste al tope de ${c.topeMonitoreadas} direcciones monitoreadas. Dejá de monitorear alguna para agregar otra.` })
      }

      // El punto de partida sale del padrón, que es donde vive el veredicto.
      const ficha2 = await padronBuscar(coin, dir)
      const banda = clasificar(c, ficha2?.risk_score ?? null, ficha2?.risk_level ?? null)
      const ahora = new Date().toISOString()

      // Se reactiva si estaba dada de baja, y se reinicia la referencia: al
      // volver a guardarla, el "subió desde que la guardaste" se cuenta desde
      // AHORA, no desde la primera vez.
      const { error: errUp } = await db.from('kyt_watchlist').upsert({
        user_id: yo.userId, coin,
        address_lower: dir.toLowerCase(), address: dir,
        alias: alias || null,
        score_inicial: ficha2?.risk_score ?? null,
        nivel_inicial: ficha2?.risk_level ?? null,
        banda_inicial: banda,
        score_actual: ficha2?.risk_score ?? null,
        nivel_actual: ficha2?.risk_level ?? null,
        banda_actual: banda,
        revisado_at: ficha2?.consultado_at ?? ahora,
        subio: false, subio_at: null, motivo_cambio: null, aviso_enviado: false,
        activo: true,
      }, { onConflict: 'user_id,coin,address_lower' })
      if (errUp) return json({ ok: false, error: 'no_guardado', mensaje: errUp.message }, 500)
      return json({ ok: true, guardada: true })
    }

    if (accion === 'quitar') {
      if (!yo.userId) return json({ error: 'no_autorizado' }, 401)
      const id = String(body.id ?? '')
      if (!id) return json({ ok: false, error: 'falta_id' })
      // Se da de baja, NO se borra: el historial de alertas apunta a esta fila
      // y borrarla dejaría alertas sin contexto. Un registro de cumplimiento
      // que se puede borrar no es un registro.
      await db.from('kyt_watchlist').update({ activo: false })
        .eq('id', id).eq('user_id', yo.userId)
      return json({ ok: true })
    }

    if (accion === 'lista') {
      if (!yo.userId) return json({ error: 'no_autorizado' }, 401)
      const { data, error } = await db.from('kyt_watchlist')
        .select('*').eq('user_id', yo.userId).eq('activo', true)
        .order('created_at', { ascending: false }).limit(500)
      if (error) {
        const base = (SUPABASE_URL.match(/^https:\/\/([^.]+)\./)?.[1] ?? '').slice(0, 4)
        return json({ ok: false, error: error.message, base }, 500)
      }
      const filas = (data ?? []) as any[]
      // Hora de la última ronda: la revisión más reciente de esta cuenta.
      const ultima = filas.reduce<string | null>((a, r) => {
        const t = r.revisado_at
        return t && (!a || new Date(t) > new Date(a)) ? t : a
      }, null)
      return json({
        ok: true,
        tope: c.topeMonitoreadas,
        horas: c.horasMonitoreo,
        ultimaRonda: ultima,
        direcciones: filas.map(r => ({
          id: r.id, coin: r.coin, address: r.address, alias: r.alias,
          puntaje: r.score_actual, nivel: r.nivel_actual,
          categoria: r.banda_actual ?? 'sin_dato',
          puntajeInicial: r.score_inicial, bandaInicial: r.banda_inicial,
          subio: r.subio === true, subioAt: r.subio_at, motivo: r.motivo_cambio,
          avisoEnviado: r.aviso_enviado === true,
          revisadoAt: r.revisado_at, guardadaAt: r.created_at,
        })),
      })
    }

    if (accion === 'alertas') {
      if (!yo.userId) return json({ error: 'no_autorizado' }, 401)
      const { data } = await db.from('kyt_alerts')
        .select('*').eq('user_id', yo.userId)
        .order('created_at', { ascending: false }).limit(200)
      return json({ ok: true, alertas: (data ?? []) as any[] })
    }

    // ── RONDA DE MONITOREO ────────────────────────────────────────
    // La dispara el cron (con CRON_SECRET) o un admin. NO la puede disparar un
    // cliente: gasta consultas pagadas de toda la cuenta.
    if (accion === 'monitorear') {
      const secreto = Deno.env.get('CRON_SECRET') ?? ''
      const traido = String(body.secret ?? req.headers.get('x-cron-secret') ?? '')
      const autorizado = yo.esAdmin || (!!secreto && traido === secreto)
      if (!autorizado) return json({ error: 'no_autorizado' }, 401)
      if (!secreto && !yo.esAdmin) return json({ error: 'sin_cron_secret' }, 503)

      const limite = Math.max(1, Math.min(200, Number(body.limite) || 40))
      const corte = new Date(Date.now() - c.horasMonitoreo * 3600_000).toISOString()

      // Las que llevan más tiempo sin revisar primero. Nunca revisadas van
      // antes que todas (NULLS FIRST en el índice).
      const { data: pend } = await db.from('kyt_watchlist')
        .select('*').eq('activo', true)
        .or(`revisado_at.is.null,revisado_at.lt.${corte}`)
        .order('revisado_at', { ascending: true, nullsFirst: true })
        .limit(limite)

      const out: any[] = []
      for (const w of ((pend ?? []) as any[])) {
        const ficha3 = await padronBuscar(w.coin, w.address)
        const ev = await evaluarYGuardar(c, w.coin, w.address, { userId: w.user_id }, ficha3)
        const ahora2 = new Date().toISOString()

        if (!ev.hay) {
          // No se pudo confirmar: se anota la revisión pero NO se toca la
          // banda. Bajar el riesgo porque el proveedor no contestó sería
          // exactamente el error de las dispersiones, al revés.
          await db.from('kyt_watchlist').update({ revisado_at: ahora2 }).eq('id', w.id)
          out.push({ id: w.id, r: 'sin_resultado' })
          continue
        }

        const antes = String(w.banda_actual ?? 'sin_dato')
        const ahoraBanda = clasificar(c, ev.score, ev.level)
        const ORDEN: Record<string, number> = { bajo: 1, sin_dato: 1, medio: 2, alto: 3 }
        const empeoro = (ORDEN[ahoraBanda] ?? 1) > (ORDEN[antes] ?? 1)

        const motivo = empeoro
          ? (Array.isArray(ev.hallazgos) && ev.hallazgos.length
              ? String(typeof ev.hallazgos[0] === 'string' ? ev.hallazgos[0] : (ev.hallazgos[0]?.label ?? ev.hallazgos[0]?.type ?? 'nuevo hallazgo')).slice(0, 180)
              : 'cambió la clasificación del proveedor')
          : null

        await db.from('kyt_watchlist').update({
          score_actual: ev.score, nivel_actual: ev.level, banda_actual: ahoraBanda,
          revisado_at: ahora2,
          ...(empeoro ? { subio: true, subio_at: ahora2, motivo_cambio: motivo, aviso_enviado: false } : {}),
        }).eq('id', w.id)

        if (empeoro) {
          // El correo se manda ANTES de anotar aviso_enviado, y solo se anota
          // si de verdad salio. Marcar el aviso como enviado cuando no salio
          // le diria al cliente en pantalla que ya le avisamos -- y dejaria de
          // revisar.
          const enviado = await avisarPorCorreo(w.user_id, {
            alias: w.alias, address: w.address, coin: w.coin,
            antes: w.score_actual, despues: ev.score, motivo,
          })
          await db.from('kyt_alerts').insert({
            user_id: w.user_id, watchlist_id: w.id,
            coin: w.coin, address: w.address, alias: w.alias,
            score_antes: w.score_actual, score_despues: ev.score,
            banda_antes: antes, banda_despues: ahoraBanda,
            motivo, empeoro: true, aviso_enviado: enviado,
          })
          if (enviado) await db.from('kyt_watchlist').update({ aviso_enviado: true }).eq('id', w.id)
          out.push({ id: w.id, r: 'subio', de: w.score_actual, a: ev.score, aviso: enviado })
        } else {
          out.push({ id: w.id, r: 'sin_cambio' })
        }
      }
      return json({ ok: true, revisadas: out.length, resultados: out })
    }

    // ── EXPEDIENTE COMPLETO PARA EL REPORTE ───────────────────────
    // Junta TODO lo que el proveedor sabe de una direccion: veredicto,
    // vinculos, contrapartes, flujos entrantes y salientes con las senaladas,
    // comportamiento, perfil y actividad. Es lo que se imprime.
    //
    // Se guarda en el padron. Un expediente son varias llamadas pagadas: sin
    // cachearlo, cada vez que alguien reimprime el mismo reporte se vuelve a
    // pagar por un dato que no cambio.
    if (accion === 'reporte') {
      if (!yo.userId && !yo.esAdmin) return json({ error: 'no_autorizado' }, 401)
      if (!c.activo) return json({ ok: false, error: 'inactivo' })
      const coin = canonCoin(body.coin)
      const dir = normDir(body.address)
      if (!coin || !dir) return json({ ok: false, error: 'faltan_datos' })
      if (!formatoValido(coin, dir)) {
        return json({ ok: false, error: 'formato_red', mensaje: `Esa dirección no tiene el formato de ${coin}.` })
      }

      const quien = { userId: yo.userId, email: null as string | null, empresa: null as string | null }
      if (yo.userId) {
        const { data: u } = await db.from('users').select('email, company_name').eq('id', yo.userId).maybeSingle()
        quien.email = (u as any)?.email ?? null
        quien.empresa = (u as any)?.company_name ?? null
      }

      const ficha = await padronBuscar(coin, dir)
      const vigenteHasta = ficha?.consultado_at
        ? new Date(ficha.consultado_at).getTime() + c.diasVigencia * 86400_000 : 0
      const completo = !!ficha && ficha.estado === 'finalizado'
        && ficha.contrapartes !== null && ficha.investigacion !== null
      const reusar = body.force !== true && completo && Date.now() < vigenteHasta

      if (!reusar) {
        // El veredicto y sus enriquecimientos base.
        const ev = await evaluarYGuardar(c, coin, dir, quien, ficha)
        if (!ev.hay) {
          return json({
            ok: false, error: ev.error === 'sin_credencial' ? 'sin_credencial' : 'sin_resultado',
            mensaje: ev.error === 'sin_credencial'
              ? 'El servicio no está configurado todavía.'
              : 'No pudimos obtener un resultado para esa dirección. No significa que esté limpia: significa que no sabemos.',
          })
        }
        // Las tres piezas extra del expediente, en paralelo. Ninguna es
        // indispensable: si una falla, el reporte sale sin esa seccion y lo
        // dice, en vez de no salir.
        const [eCp, eInv, eAct] = await Promise.all([
          llamarMT(c, c.rutaContrapartes, { coin, address: dir }).catch(() => null),
          llamarMT(c, c.rutaInvestigacion, { coin, address: dir, type: 'all', page: '1' }).catch(() => null),
          llamarMT(c, c.rutaComportamiento, { coin, address: dir }).catch(() => null),
        ])
        const contrapartes = eCp ? leerContrapartes(eCp.data) : null
        const investigacion = eInv?.ok ? leerInvestigacion(eInv.data) : null
        const comportamiento = eAct?.ok ? leerComportamiento(eAct.data) : null
        // Se guarda POR QUE quedo vacia cada fuente. Sin esto, "el proveedor no
        // devolvio X" tapaba por igual un 403 de plan, un 404 de ruta y una
        // respuesta con forma distinta a la que espera el parser.
        const fuentes = {
          contrapartes: fuenteDe(eCp, contrapartes),
          investigacion: fuenteDe(eInv, investigacion),
          comportamiento: fuenteDe(eAct, comportamiento),
        }
        await db.from('kyt_registry').update({
          contrapartes, investigacion, comportamiento, fuentes,
          actualizado_at: new Date().toISOString(),
        }).eq('coin', coin).eq('address_lower', dir.toLowerCase())
      }

      const f = await padronBuscar(coin, dir)
      if (!f) return json({ ok: false, error: 'sin_resultado' })

      // Las rutas con intermediario van en el reporte, asi que se rastrean acá
      // mismo. Es caro -- cada contraparte expandida es una consulta pagada --
      // pero un reporte sin la seccion de rutas indirectas no sirve para lo que
      // se usa. Presupuesto acotado y reutilizando lo ya cacheado.
      let trazado: any = f.rutas ?? null
      const rutasVigentes = trazado && f.rutas_at
        && Date.now() - new Date(f.rutas_at).getTime() < c.diasVigencia * 86400_000
      if (!rutasVigentes && body.sinRutas !== true) {
        const rInv2 = await llamarMT(c, c.rutaInvestigacion, { coin, address: dir, type: 'all', page: '1' })
        const inv2 = rInv2.ok ? leerInvestigacion(rInv2.data) : null
        if (inv2) {
          const vecinos = [...(inv2.entradas ?? []), ...(inv2.salidas ?? [])].filter((x: any) => x.direccion)
          const directas = vecinos.filter((x: any) => x.tipoNum === 2).map((x: any) => ({
            contaminante: x.direccion, etiquetaContaminante: x.etiqueta, intermediario: null,
            saltos: 1, flujo: x.flujo, monto: x.monto, txs: x.hashes?.length ?? 1, hashes: x.hashes ?? [],
          }))
          const cand = vecinos.filter((x: any) => x.tipoNum !== 2)
            .sort((a2: any, b2: any) => (b2.monto ?? 0) - (a2.monto ?? 0))
            .slice(0, Math.max(1, Math.min(25, Number(c.presupuestoRutas) || 10)))
          const indirectas: any[] = []
          let expandidos = 0
          for (const v of cand) {
            const r2 = await llamarMT(c, c.rutaInvestigacion, { coin, address: v.direccion, type: 'all', page: '1' })
            if (!r2.ok) continue
            expandidos++
            for (const m of (leerInvestigacion(r2.data)?.maliciosas ?? [])) {
              indirectas.push({
                contaminante: m.direccion, etiquetaContaminante: m.etiqueta,
                intermediario: v.direccion, etiquetaIntermediario: v.etiqueta,
                saltos: 2, flujo: v.flujo, monto: v.monto, montoTramoFinal: m.monto,
                txs: v.hashes?.length ?? 1, hashes: v.hashes ?? [],
              })
            }
          }
          const todas = [...directas, ...indirectas]
          // Ranking por contaminante: cuantos caminos llevan a la misma entidad
          // y por cuanto monto. Es lo que se mira para priorizar.
          const porC: Record<string, any> = {}
          for (const r of todas) {
            const k = String(r.contaminante ?? '?')
            porC[k] = porC[k] ?? { contaminante: r.contaminante, etiqueta: r.etiquetaContaminante, evidencias: 0, monto: 0, saltoMinimo: 99, flujos: new Set<string>() }
            porC[k].evidencias += 1
            porC[k].monto += Number(r.monto ?? 0)
            porC[k].saltoMinimo = Math.min(porC[k].saltoMinimo, r.saltos)
            if (r.flujo) porC[k].flujos.add(r.flujo)
          }
          const ranking = Object.values(porC).map((g: any) => ({
            contaminante: g.contaminante, etiqueta: g.etiqueta,
            evidencias: g.evidencias, monto: g.monto || null,
            saltoMinimo: g.saltoMinimo === 99 ? null : g.saltoMinimo,
            flujoDominante: g.flujos.has('salida') ? 'salida' : (g.flujos.has('entrada') ? 'entrada' : null),
          })).sort((x: any, y: any) => (y.monto ?? 0) - (x.monto ?? 0))

          trazado = {
            rutas: todas, ranking,
            contrapartesRevisadas: vecinos.length, expandidos,
            completo: cand.length >= vecinos.filter((x: any) => x.tipoNum !== 2).length,
            entrantesSenaladas: directas.filter((x: any) => x.flujo === 'entrada').length,
            salientesSenaladas: directas.filter((x: any) => x.flujo === 'salida').length,
          }
          await db.from('kyt_registry').update({ rutas: trazado, rutas_at: new Date().toISOString() })
            .eq('coin', coin).eq('address_lower', dir.toLowerCase())
        }
      }
      return json({
        ok: true,
        generadoAt: new Date().toISOString(),
        empresa: quien.empresa, correo: quien.email,
        coin, address: f.address,
        categoria: clasificar(c, f.risk_score, f.risk_level),
        puntaje: f.risk_score, nivel: f.risk_level,
        hackingEvent: f.hacking_event ?? null,
        detalle: f.detail_list ?? [],
        etiquetas: f.labels ?? [],
        exposicion: f.exposicion ?? null,
        // El camino del proveedor va al reporte: es la parte que se imprime y
        // se le muestra a un banco. Cada hallazgo de `exposicion` ya trae el
        // suyo; este es el de la respuesta entera, cuando viene arriba.
        hopDic: f.hop_dic ?? null,
        etiquetaProveedor: f.address_label ?? null,
        actividad: f.actividad ?? null,
        tokenActividad: f.token_actividad ?? null,
        perfil: f.perfil ?? null,
        contrapartes: f.contrapartes ?? null,
        investigacion: f.investigacion ?? null,
        comportamiento: f.comportamiento ?? null,
        fuentes: f.fuentes ?? null,
        rutas: trazado,
        reporte: f.report_url ?? null,
        consultadoAt: f.consultado_at,
        delPadron: reusar,
      })
    }

    // ── RASTREO DE RUTAS ──────────────────────────────────────────
    // LO MAS IMPORTANTE DE ESTA HERRAMIENTA. Saber que una direccion tiene una
    // ruta hacia una entidad senalada -- aunque sea a dos saltos -- es lo que
    // permite anticipar que un exchange le va a congelar los fondos. Llega
    // antes que el bloqueo, que es cuando todavia se puede hacer algo.
    //
    // DOS NIVELES, y la diferencia importa:
    //
    //   · EL CAMINO DEL PROVEEDOR (hop_dic, V3 del risk_score). Trae las
    //     direcciones de CADA salto: contaminante, intermediarios y la nuestra
    //     al final. Es el dato bueno y llega GRATIS con el puntaje. Lo que no
    //     dice es si la plata entro o salio.
    //
    //   · EL RECORRIDO A MANO (transactions_investigation). Se piden las
    //     contrapartes de la direccion y, por cada una, las suyas, buscando las
    //     marcadas como maliciosas (type 2). Cada paso es una consulta PAGADA,
    //     asi que tiene presupuesto y llega hasta donde alcanza. Lo que si dice
    //     es la DIRECCION del flujo: a quien le mandamos y de quien recibimos.
    //
    // Se usan los DOS y se cruzan: el camino lo pone hop_dic, el sentido lo pone
    // la investigacion. Ninguno de los dos solo contesta la pregunta completa.
    if (accion === 'rutas') {
      if (!yo.userId && !yo.esAdmin) return json({ error: 'no_autorizado' }, 401)
      const coin = canonCoin(body.coin)
      const dir = normDir(body.address)
      if (!coin || !dir) return json({ ok: false, error: 'faltan_datos' })
      if (!formatoValido(coin, dir)) return json({ ok: false, error: 'formato_red' })

      // Presupuesto: cuantas contrapartes se expanden. Cada una es una consulta
      // pagada. 10 por defecto; el tope evita que una direccion con cientos de
      // contrapartes se coma el plan en un clic.
      const presupuesto = Math.max(1, Math.min(25, Number(body.presupuesto) || 10))

      // ── 1) El camino que ya tenemos guardado ──
      // hop_dic viene con el veredicto, y el veredicto ya se pago al consultar.
      // Se lee del padron; solo si no hay ficha se gasta una consulta de riesgo
      // -- una, no una por contraparte.
      const fichaR = await padronBuscar(coin, dir)
      let hopDic: any = fichaR?.hop_dic ?? null
      let expo: any = fichaR?.exposicion ?? null
      let riesgoRecien = false
      // hop_at marca que YA le preguntamos al proveedor por el camino. Sin esa
      // marca no se puede distinguir "no tiene camino" de "esta ficha es
      // anterior a que empezaramos a leerlo", y sin distinguirlas o se paga una
      // consulta de mas en cada clic, o las fichas viejas nunca muestran el
      // camino que el proveedor si manda.
      if (!fichaR?.hop_at) {
        const rr = await llamarMT(c, c.rutaRiesgo, { coin, address: dir })
        if (rr.ok) {
          const vv = leerVeredicto(rr.data)
          hopDic = vv.hopDic ?? null
          expo = exposicionDe(vv.riskDetail, vv.hopDic) ?? expo
          riesgoRecien = true
          // La exposicion (con el camino adentro) se guarda igual aunque falten
          // las columnas nuevas: esa columna ya existia. El camino suelto solo
          // si la migracion ya corrio — si no, el update entero se cae y se
          // pierde tambien lo que si se podia guardar.
          const { error: eUp } = await db.from('kyt_registry').update({
            ...(expo ? { exposicion: expo } : {}),
            ...(faltanColumnasHop ? {} : {
              hop_dic: hopDic, address_label: vv.addressLabel, hop_at: new Date().toISOString(),
            }),
          }).eq('coin', coin).eq('address_lower', dir.toLowerCase())
          if (eUp && /hop_dic|address_label|hop_at|42703|does not exist/i.test(`${eUp.code ?? ''} ${eUp.message ?? ''}`)) {
            faltanColumnasHop = true
            console.warn('[kyt] falta correr 2026_kyt_hop_dic.sql: el camino no se guarda, se recalcula en cada consulta.')
            if (expo) await db.from('kyt_registry').update({ exposicion: expo }).eq('coin', coin).eq('address_lower', dir.toLowerCase())
          }
        }
      }

      // Cada hallazgo con camino propio es una ruta del proveedor. El camino
      // general (cuando el hop_dic viene arriba y no por hallazgo) va una sola
      // vez, sin atribuirselo a ningun hallazgo en particular.
      const rutasProveedor: any[] = []
      for (const it of (Array.isArray(expo?.items) ? expo.items : [])) {
        // `camino` ya viene normalizado por exposicionDe (y asi quedo guardado
        // en el padron): niveles ordenados, direcciones limpias.
        const niveles = Array.isArray(it?.camino) ? it.camino : null
        if (!niveles || !niveles.length) continue
        const cm = caminoDeHop(dir, niveles)
        rutasProveedor.push({
          fuente: 'proveedor',
          contaminante: cm.contaminante, etiquetaContaminante: it?.entidad ?? null,
          contaminantes: cm.contaminantes,
          intermediario: cm.intermediario, intermediarios: cm.intermediarios,
          // hop_num del hallazgo manda sobre el largo del camino: es el numero
          // que el proveedor afirma, y el camino puede venir recortado.
          saltos: Number.isFinite(Number(it?.saltos)) ? Number(it.saltos) : cm.saltos,
          camino: cm.camino,
          terminaEnLaDireccion: cm.terminaEnLaDireccion,
          tipo: it?.tipo ?? null, tipoEs: it?.tipoEs ?? null,
          exposicion: it?.exposicion ?? null,
          monto: it?.volumen ?? null, pct: it?.pct ?? null,
          flujo: null, hashes: [],
        })
      }
      const general = leerHopDic(hopDic)
      if (general && !rutasProveedor.length) {
        const cm = caminoDeHop(dir, general)
        rutasProveedor.push({
          fuente: 'proveedor',
          contaminante: cm.contaminante, etiquetaContaminante: null,
          contaminantes: cm.contaminantes,
          intermediario: cm.intermediario, intermediarios: cm.intermediarios,
          saltos: cm.saltos, camino: cm.camino,
          terminaEnLaDireccion: cm.terminaEnLaDireccion,
          tipo: null, tipoEs: null, exposicion: null,
          monto: null, pct: null, flujo: null, hashes: [],
          // Este camino es de la respuesta, no de un hallazgo concreto. Se dice,
          // para que la pantalla no lo presente como si fuera de uno.
          sinHallazgo: true,
        })
      }

      const rInv = await llamarMT(c, c.rutaInvestigacion, { coin, address: dir, type: 'all', page: '1' })
      const inv = rInv.ok ? leerInvestigacion(rInv.data) : null
      if (!inv) {
        // Antes esto cortaba la accion. Ahora ya no puede: si el proveedor
        // mando el camino, tenemos rutas reales aunque no podamos decir el
        // sentido del flujo -- y tirarlas para devolver un error seria esconder
        // lo unico que el cliente vino a ver.
        if (!rutasProveedor.length) {
          return json({
            ok: false, error: 'sin_investigacion',
            fuente: fuenteDe(rInv, inv),
            mensaje: 'No pudimos obtener las contrapartes de esta dirección, así que no se pueden rastrear rutas.',
          })
        }
        await logAuditKyt(yo.userId, 'kyt.rutas', { coin, address: dir, soloProveedor: true, rutas: rutasProveedor.length })
        return json({
          ok: true, coin, address: dir,
          rutas: rutasProveedor,
          resumen: [],
          delProveedor: rutasProveedor.length, riesgoRecien,
          contrapartesRevisadas: 0, expandidos: 0, fallos: 0, presupuesto,
          completo: false,
          fuenteContrapartes: fuenteDe(rInv, inv),
          // Se dice que falta, porque es justo la mitad de la pregunta del
          // cliente: sabe que hay un camino, no si mando o recibio por el.
          sinSentidoDeFlujo: true,
        })
      }

      const vecinos = [...(inv.entradas ?? []), ...(inv.salidas ?? [])]
        .filter((x: any) => x.direccion)
      // Las que YA son maliciosas son rutas DIRECTAS: un salto, sin intermediario.
      const directas = vecinos.filter((x: any) => x.tipoNum === 2).map((x: any) => ({
        contaminante: x.direccion, etiquetaContaminante: x.etiqueta,
        intermediario: null, saltos: 1,
        flujo: x.flujo === 'entrada' ? 'entrante' : 'saliente',
        monto: x.monto, txs: x.hashes?.length ?? null, hashes: x.hashes ?? [],
      }))

      // Se expanden las que NO son maliciosas, de mayor monto a menor: si hay
      // presupuesto para diez, conviene gastarlo donde hay mas plata en juego.
      const candidatos = vecinos
        .filter((x: any) => x.tipoNum !== 2)
        .sort((a: any, b: any) => (b.monto ?? 0) - (a.monto ?? 0))
        .slice(0, presupuesto)

      const indirectas: any[] = []
      let expandidos = 0
      let fallos = 0
      for (const v of candidatos) {
        const r2 = await llamarMT(c, c.rutaInvestigacion, { coin, address: v.direccion, type: 'all', page: '1' })
        if (!r2.ok) { fallos++; continue }
        expandidos++
        const inv2 = leerInvestigacion(r2.data)
        for (const m of (inv2?.maliciosas ?? [])) {
          indirectas.push({
            contaminante: m.direccion, etiquetaContaminante: m.etiqueta,
            intermediario: v.direccion, etiquetaIntermediario: v.etiqueta,
            saltos: 2,
            flujo: v.flujo === 'entrada' ? 'entrante' : 'saliente',
            // El monto que se muestra es el del tramo que TOCA a la direccion
            // analizada, no el del tramo entre el intermediario y la lista: lo
            // segundo no es plata de este titular y ponerlo exagera su
            // exposicion.
            monto: v.monto, montoTramoFinal: m.monto,
            txs: v.hashes?.length ?? null, hashes: v.hashes ?? [],
          })
        }
      }

      // ── El cruce ──
      // hop_dic dice POR DONDE pasa. La investigacion dice PARA QUE LADO. Se
      // cruzan por direccion: si el primer tramo del camino del proveedor es
      // una contraparte que conocemos, sabemos si le mandamos o nos mando.
      const sentido = new Map<string, string>()
      for (const v of vecinos) {
        const k = String(v.direccion ?? '').toLowerCase()
        if (!k) continue
        const nuevo = v.flujo === 'entrada' ? 'entrante' : 'saliente'
        sentido.set(k, sentido.has(k) && sentido.get(k) !== nuevo ? 'ambos' : nuevo)
      }
      for (const r of rutasProveedor) {
        // El tramo que nos toca es el que sale de NUESTRA direccion: el
        // intermediario mas cercano, o el contaminante si el camino es directo.
        const primerTramo = String(
          (r.intermediarios?.length ? r.intermediarios[r.intermediarios.length - 1] : null) ?? r.contaminante ?? '',
        ).toLowerCase()
        r.flujo = sentido.get(primerTramo) ?? null
        // Se distingue a proposito de "no hay flujo": null significa que esa
        // contraparte no aparecio entre las que revisamos, no que no exista.
        r.flujoDesconocido = r.flujo === null
        const vc = vecinos.find((x: any) => String(x.direccion ?? '').toLowerCase() === primerTramo)
        if (vc) {
          r.etiquetaIntermediario = r.etiquetaIntermediario ?? vc.etiqueta ?? null
          r.hashes = vc.hashes ?? []
          r.txs = vc.hashes?.length ?? null
        }
      }

      // Las rutas del proveedor pisan a las rastreadas a mano cuando llevan al
      // MISMO contaminante: el proveedor nombra el camino entero y nosotros
      // solo llegamos a dos saltos. Quedarse con las dos seria contar la misma
      // exposicion dos veces y abultar el "caminos" del resumen.
      const delProveedor = new Set(
        rutasProveedor.map(r => String(r.contaminante ?? '').toLowerCase()).filter(Boolean),
      )
      const aMano = [...directas, ...indirectas]
        .map(r => ({ ...r, fuente: 'rastreo' }))
        .filter(r => !delProveedor.has(String(r.contaminante ?? '').toLowerCase()))

      // Agrupado por contaminante, como en un reporte de exposicion: lo que se
      // mira primero es CUANTOS caminos llevan a la misma entidad senalada.
      const porContaminante: Record<string, any> = {}
      for (const r of [...rutasProveedor, ...aMano]) {
        const k = String(r.contaminante ?? 'desconocido')
        if (!porContaminante[k]) {
          porContaminante[k] = {
            contaminante: r.contaminante, etiqueta: r.etiquetaContaminante,
            caminos: 0, montoTotal: 0, saltoMinimo: 99,
            intermediarios: new Set<string>(), flujos: new Set<string>(),
            delProveedor: false,
          }
        }
        const g = porContaminante[k]
        g.etiqueta = g.etiqueta ?? r.etiquetaContaminante ?? null
        g.caminos += 1
        g.montoTotal += Number(r.monto ?? 0)
        g.saltoMinimo = Math.min(g.saltoMinimo, r.saltos)
        for (const m of (r.intermediarios?.length ? r.intermediarios : (r.intermediario ? [r.intermediario] : []))) {
          g.intermediarios.add(m)
        }
        if (r.flujo && r.flujo !== 'ambos') g.flujos.add(r.flujo)
        if (r.flujo === 'ambos') { g.flujos.add('entrante'); g.flujos.add('saliente') }
        if (r.fuente === 'proveedor') g.delProveedor = true
      }
      const resumen = Object.values(porContaminante).map((g: any) => ({
        contaminante: g.contaminante, etiqueta: g.etiqueta,
        caminos: g.caminos, montoTotal: g.montoTotal || null,
        saltoMinimo: g.saltoMinimo === 99 ? null : g.saltoMinimo,
        intermediarios: Array.from(g.intermediarios),
        // Lo que el cliente pregunto con todas las letras: si le mando o
        // recibio de una direccion contaminada. Vacio = no lo sabemos.
        flujos: Array.from(g.flujos),
        delProveedor: !!g.delProveedor,
      })).sort((a: any, b: any) => (b.montoTotal ?? 0) - (a.montoTotal ?? 0))

      const todasLasRutas = [...rutasProveedor, ...aMano]
        .sort((a, b) => (a.saltos ?? 99) - (b.saltos ?? 99) || (b.monto ?? 0) - (a.monto ?? 0))

      await logAuditKyt(yo.userId, 'kyt.rutas', {
        coin, address: dir, expandidos,
        proveedor: rutasProveedor.length, directas: directas.length, indirectas: indirectas.length,
      })

      return json({
        ok: true, coin, address: dir,
        rutas: todasLasRutas,
        resumen,
        // Cuantas salieron del camino del proveedor y cuantas de nuestro
        // rastreo. Importa: las primeras son el camino completo y las segundas
        // llegan hasta donde alcanzo el presupuesto.
        delProveedor: rutasProveedor.length,
        rastreadas: aMano.length,
        riesgoRecien,
        contrapartesRevisadas: vecinos.length,
        expandidos, fallos, presupuesto,
        // Se dice explicitamente hasta donde se miro. Una lista vacia despues
        // de expandir diez de doscientas contrapartes NO significa "no hay
        // rutas": significa "no hay en lo que miramos". El camino del proveedor
        // no tiene ese limite, asi que si hubo rutas suyas el aviso sobra.
        completo: rutasProveedor.length > 0
          || candidatos.length >= vecinos.filter((x: any) => x.tipoNum !== 2).length,
      })
    }

    // ── DIAGNOSTICO (admin) ───────────────────────────────────────
    // Llama TODOS los endpoints para una direccion y devuelve el cuerpo crudo
    // de cada uno, el estado HTTP y si nuestro parser saco algo.
    //
    // Existe porque hoy no se podia distinguir entre tres cosas que se veian
    // iguales: que el plan no incluya el endpoint, que la ruta no exista, y que
    // la respuesta tenga una forma distinta de la que el parser espera. Las
    // tres llegaban a la pantalla como "el proveedor no devolvio X", y me
    // llevaron a inventar nombres de campo dos veces.
    if (accion === 'diagnostico') {
      if (!yo.esAdmin) return json({ error: 'no_autorizado' }, 401)
      const coin = canonCoin(body.coin)
      const dir = normDir(body.address)
      if (!coin || !dir) return json({ ok: false, error: 'faltan_datos' })

      const rutas: [string, string, (d: any) => any][] = [
        ['riesgo', c.rutaRiesgo, (d) => leerVeredicto(d)],
        ['actividad', c.rutaResumen, leerActividad],
        ['etiquetas', c.rutaEtiquetas, (d) => desenvolver(d)],
        ['perfil', c.rutaPerfil, leerPerfil],
        ['contrapartes', c.rutaContrapartes, leerContrapartes],
        ['investigacion', c.rutaInvestigacion, leerInvestigacion],
        ['comportamiento', c.rutaComportamiento, leerComportamiento],
      ]
      const out: Record<string, any> = {}
      for (const [nombre, ruta, parser] of rutas) {
        const extra = nombre === 'investigacion' ? { type: 'all', page: '1' } : {}
        const r = await llamarMT(c, ruta, { coin, address: dir, ...extra })
        let parsed: any = null
        let errParser: string | null = null
        try { parsed = parser(r.data) } catch (e) { errParser = (e as Error)?.message ?? 'parser' }
        let crudo = ''
        try { crudo = typeof r.data === 'string' ? r.data : JSON.stringify(r.data) } catch { crudo = '(ilegible)' }
        out[nombre] = {
          ruta,
          httpStatus: r.status,
          ok: r.ok,
          errorRed: r.error ?? null,
          motivoProveedor: motivoProveedor(r.data),
          parserSacoDatos: parsed != null,
          errorParser: errParser,
          // El cuerpo crudo, recortado. Es lo unico que permite corregir un
          // nombre de campo sin volver a adivinar.
          crudo: crudo.slice(0, 1800),
        }
      }
      return json({ ok: true, coin, address: dir, credencial: !!MT_KEY, fuentes: out })
    }

    // ── Padrón completo (admin) ───────────────────────────────────
    if (accion === 'padron') {
      if (!yo.esAdmin) return json({ error: 'no_autorizado' }, 401)
      const q = String(body.q ?? '').trim()
      let sel = db.from('kyt_registry').select('*').order('actualizado_at', { ascending: false }).limit(300)
      if (q) sel = sel.ilike('address_lower', `%${q.toLowerCase()}%`)
      const { data, error } = await sel
      if (error) {
        // Igual que en Lincoin Risk: si el padrón no responde, se dice a qué
        // base se le preguntó. "No existe la tabla" y "existe en otra base" se
        // leen igual, y distinguirlas a mano nos costó medio día.
        const base = (SUPABASE_URL.match(/^https:\/\/([^.]+)\./)?.[1] ?? '').slice(0, 4)
        return json({ error: error.message, base }, 500)
      }
      const filas = (data ?? []) as any[]
      const pagadas = filas.reduce((a, r) => a + Number(r.veces_consultado ?? 0), 0)
      const ahorradas = filas.reduce((a, r) => a + Number(r.veces_reutilizado ?? 0), 0)
      return json({
        ok: true,
        config: c,
        credencial: !!MT_KEY,
        resumen: {
          direcciones: filas.length,
          consultasPagadas: pagadas,
          consultasAhorradas: ahorradas,
          alto: filas.filter(r => clasificar(c, r.risk_score, r.risk_level) === 'alto').length,
          medio: filas.filter(r => clasificar(c, r.risk_score, r.risk_level) === 'medio').length,
          sinResultado: filas.filter(r => r.estado !== 'finalizado').length,
        },
        direcciones: filas.map(r => ({
          coin: r.coin, address: r.address,
          categoria: clasificar(c, r.risk_score, r.risk_level),
          puntaje: r.risk_score, nivel: r.risk_level,
          estado: r.estado,
          hallazgos: Array.isArray(r.risk_detail) ? r.risk_detail : [],
          etiquetas: Array.isArray(r.labels) ? r.labels : [],
          reporte: r.report_url,
          consultadoAt: r.consultado_at, actualizadoAt: r.actualizado_at,
          vecesConsultado: r.veces_consultado, vecesReutilizado: r.veces_reutilizado,
          empresas: Array.isArray(r.empresas) ? r.empresas : [],
        })),
      })
    }

    return json({ error: 'accion_desconocida' }, 400)
  } catch (e) {
    return json({ error: 'interno', mensaje: (e as Error)?.message ?? String(e) }, 500)
  }
})
