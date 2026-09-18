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
const ESTADOS = ['abierta', 'en_proceso', 'esperando_pago', 'pagada', 'completada', 'cancelada'] as const
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

  if (SERVICE_KEY && jwt === SERVICE_KEY) {
    return { ok: true, userId: String(payload.user_id ?? '') || undefined, admin: true, viaJwt: true, nombre: 'Sistema' }
  }

  const { data } = await db.auth.getUser(jwt)
  if (data?.user) {
    const { data: prof } = await db.from('users').select('role, full_name, email').eq('id', data.user.id).maybeSingle()
    const admin = String((prof as any)?.role ?? '') === 'admin'
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
        motivo_cierre: 'Vencio el plazo para subir el comprobante',
      })
      .eq('status', 'esperando_pago')
      .lt('vence_at', ahora())
      .select('id')
    for (const c of data ?? []) {
      await escribirMensaje((c as any).id, 'sistema',
        'Se vencio el plazo para subir el comprobante y la solicitud quedo cancelada. '
        + 'Si YA enviaste el dinero, escribi por aca antes de montar otra: la mesa lo verifica y lo resuelve sobre esta misma solicitud.')
    }
  } catch { /* nunca frena la lectura */ }
}

// El margen que le toca a ESTE cliente.
//
// CERO ES UN VALOR, NO UN VACIO. Un cliente con 0% de comision tiene que pagar
// 0%: si se resolviera con `??` sobre un numero que puede ser 0, o con un `||`,
// el cero caeria al valor por defecto y se le cobraria un margen que nadie le
// nego.
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
  referencia: number | null    // precio Finity, sin margen — lo que se muestra como referencia
  rate: number | null          // el que se le aplica al cliente (referencia - margen)
  margenPct: number
  fuente: string
  motivo?: string
  crudo?: string               // solo para admin, cuando no hubo tasa
}

// Una tasa ausente NO es una tasa de cero ni una cotizacion en blanco. Si el
// proveedor no responde, el cierre se puede pedir igual (la mesa lo cotiza a
// mano) pero se guarda SIN tasa y se dice por que — no se inventa un numero
// que despues alguien va a leer como un precio acordado.
async function tasaUsdCop(userId?: string): Promise<Cotizacion> {
  const margenPct = await margenDe(userId)
  const vacia = (motivo: string, crudo?: string): Cotizacion =>
    ({ referencia: null, rate: null, margenPct, fuente: 'finity', motivo, crudo })
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
    if (d?.sandbox === true) {
      return vacia('el proveedor esta respondiendo en modo de prueba')
    }

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
      return vacia(
        d?.data?.message ?? d?.message ?? d?.error ?? 'el proveedor no devolvio tasa',
        JSON.stringify(d ?? null).slice(0, 400),
      )
    }
    const ref = Number(referencia)
    const rate = ref * (1 - margenPct / 100)
    return { referencia: ref, rate, margenPct, fuente: 'finity' }
  } catch (e: any) {
    return vacia(`no se pudo consultar la tasa: ${e?.message ?? 'error de red'}`)
  }
}

// Como quedo armada la tasa, en una linea legible. Sin columnas nuevas: el
// expediente tiene que poder decir contra que referencia y con que margen se
// cotizo, no solo el numero final.
function trazaTasa(c: Cotizacion): string {
  return `finity ${c.referencia?.toLocaleString('es-CO', { maximumFractionDigits: 2 })} menos ${c.margenPct}%`
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
  await db.from('otc_messages').insert({
    close_id: closeId, autor, autor_id: opts.autorId ?? null,
    autor_nom: opts.autorNom ?? null, body, adjunto_url: opts.adjunto ?? null,
  })
  await db.from('otc_closes').update({
    last_msg_at: new Date().toISOString(), last_msg_por: autor, updated_at: new Date().toISOString(),
  }).eq('id', closeId)
}

// El cierre, tal como lo puede ver el CLIENTE: sin notas internas, sin el
// nombre del operador que lo tomo (le corresponde "la mesa", no quien) y sin
// rate_fuente, que nombra al proveedor de la tasa. Que no se pinte en pantalla
// no alcanza: si viaja en la respuesta, esta a un devtools de distancia.
function paraCliente(c: any) {
  if (!c) return c
  const { notas_internas: _n, tomada_por: _t, tomada_por_nom: _tn, rate_fuente: _rf, ...resto } = c
  return { ...resto, atendida: !!c.tomada_at }
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

// Como se llama cada billetera del cliente. Mismos nombres que en su app: el
// mensaje que le queda en el hilo tiene que decir el mismo riel que el que ve
// en su pantalla de saldos.
const NOMBRE_BILLETERA: Record<string, string> = {
  COP: 'Saldo Lincoin', COP_BREB: 'Bre-B', COP_ACH: 'ACH', USD: 'Saldo USDT',
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

    // Acciones que solo puede hacer la mesa.
    const SOLO_MESA = new Set(['lista', 'tomar', 'fijar_tasa', 'completar', 'cancelar_mesa', 'notas', 'resumen', 'config_get', 'config_set'])
    if (SOLO_MESA.has(action) && !caller.admin) {
      return json(403, { ok: false, error: 'solo la mesa' })
    }

    // ── Cotizacion indicativa ───────────────────────────
    if (action === 'cotizar') {
      const side = String(payload.side ?? 'vende_usdt')
      const monto = num(payload.fromAmount)
      const c = await tasaUsdCop(String(payload.user_id ?? caller.userId ?? ''))
      if (c.rate == null) {
        return json(200, {
          ok: true, rate: null, referencia: null, margenPct: c.margenPct,
          toAmount: null, indicativa: true,
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
        ? (side === 'vende_usdt' ? monto * c.rate : monto / c.rate)
        : null
      return json(200, {
        ok: true, rate: c.rate, referencia: c.referencia, margenPct: c.margenPct,
        toAmount: to, indicativa: true,
        ...(caller.admin ? { fuente: c.fuente } : {}),
      })
    }

    // ── Crear un cierre (cliente) ───────────────────────
    if (action === 'crear') {
      const uid = String(payload.user_id ?? caller.userId ?? '')
      if (!uid) return json(400, { ok: false, error: 'falta el usuario' })
      if (!caller.admin && uid !== String(caller.userId)) {
        return json(403, { ok: false, error: 'no podes crear cierres a nombre de otro' })
      }

      const side = String(payload.side ?? 'vende_usdt')
      if (side !== 'vende_usdt' && side !== 'compra_usdt') {
        return json(400, { ok: false, error: 'lado invalido' })
      }
      const monto = num(payload.fromAmount)
      if (!(monto > 0)) return json(400, { ok: false, error: 'el monto tiene que ser mayor a cero' })

      const { count } = await db.from('otc_closes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid).in('status', VIVOS)
      if ((count ?? 0) >= MAX_VIVOS_POR_CLIENTE) {
        return json(409, {
          ok: false, error: 'demasiados_abiertos',
          message: `Ya tenes ${count} cierres en curso. Cerra o cancela alguno antes de pedir otro.`,
        })
      }

      // La tasa se resuelve EN EL SERVIDOR. Si viniera del body, el cliente
      // elegiria su propio precio.
      const c = await tasaUsdCop(uid)
      const rate = c.rate
      const motivo = c.motivo
      const from_currency = side === 'vende_usdt' ? 'USDT' : 'COP'
      const to_currency   = side === 'vende_usdt' ? 'COP' : 'USDT'
      const to_amount = rate != null
        ? (side === 'vende_usdt' ? monto * rate : monto / rate)
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
        rate_cotizada: rate, rate_final: rate, rate_fuente: rate != null ? trazaTasa(c) : null,
        status: conTasa ? 'esperando_pago' : 'abierta',
        confirmada_at: conTasa ? ahora() : null,
        vence_at: conTasa ? new Date(Date.now() + mins * 60_000).toISOString() : null,
        payout: payload.payout && typeof payload.payout === 'object' ? payload.payout : {},
        last_msg_at: ahora(), last_msg_por: 'sistema',
      }).select('*').maybeSingle()
      if (error) return json(500, { ok: false, error: error.message })

      const montoTxt = `${monto.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${from_currency}`
      await escribirMensaje(creada.id, 'sistema',
        conTasa
          ? `Solicitud de cierre por ${montoTxt} a ${rate!.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP por USD `
            + `(referencia ${c.referencia?.toLocaleString('es-CO', { maximumFractionDigits: 2 })} menos ${c.margenPct}%). `
            + `Tenes ${mins} minutos para enviar y subir el comprobante.`
          : `Solicitud de cierre por ${montoTxt}. No se pudo tomar cotizacion automatica (${motivo ?? 'sin detalle'}): la mesa la cotiza a mano y ahi arranca el plazo.`)

      const nota = String(payload.nota ?? '').trim()
      if (nota) {
        await escribirMensaje(creada.id, 'cliente', nota.slice(0, 2000), { autorId: uid, autorNom: caller.nombre ?? undefined })
      }

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
      if (!body && !adjunto) return json(400, { ok: false, error: 'mensaje vacio' })
      // El hilo NO se cierra con el cierre. Justo cuando una solicitud se
      // cancela por vencimiento es cuando un cliente que alcanzo a pagar
      // necesita avisar; bloquearle el chat ahi lo deja sin a quien escribirle
      // con la plata afuera.
      await escribirMensaje(r.cierre.id, caller.admin ? 'mesa' : 'cliente', body.slice(0, 4000), {
        autorId: caller.userId, autorNom: caller.nombre ?? undefined, adjunto: adjunto || undefined,
      })
      return json(200, { ok: true })
    }

    // ── La mesa toma el cierre ──────────────────────────
    if (action === 'tomar') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.tomada_por && String(r.cierre.tomada_por) !== String(caller.userId)) {
        return json(409, { ok: false, error: 'ya_tomada', message: `La esta atendiendo ${r.cierre.tomada_por_nom ?? 'otro operador'}.` })
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
        return json(409, { ok: false, error: 'ya_tomada', message: `La esta atendiendo ${(ahoraEs as any)?.tomada_por_nom ?? 'otro operador'}.` })
      }
      await escribirMensaje(r.cierre.id, 'sistema', `${caller.nombre ?? 'La mesa'} esta atendiendo este cierre.`)
      return json(200, { ok: true })
    }

    // ── La mesa fija la tasa y da instrucciones ─────────
    if (action === 'fijar_tasa') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      const rate = num(payload.rateFinal)
      if (!(rate > 0)) return json(400, { ok: false, error: 'la tasa tiene que ser mayor a cero' })
      const instrucciones = String(payload.instrucciones ?? '').trim()

      const monto = Number(r.cierre.from_amount)
      const to = r.cierre.side === 'vende_usdt' ? monto * rate : monto / rate

      // El reloj arranca ACA, no al crear la solicitud: antes de que la mesa
      // diga a que tasa la toma, el cliente no tiene contra que pagar.
      const mins = await ventanaPago()
      const vence = new Date(Date.now() + mins * 60_000).toISOString()

      const { error } = await db.from('otc_closes').update({
        rate_final: rate, to_amount: to, status: 'esperando_pago',
        confirmada_at: ahora(), vence_at: vence, updated_at: ahora(),
      }).eq('id', r.cierre.id)
      if (error) return json(500, { ok: false, error: error.message })

      await escribirMensaje(r.cierre.id, 'sistema',
        `Tasa confirmada: ${rate.toLocaleString('es-CO', { maximumFractionDigits: 2 })}. `
        + `Recibis ${to.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${r.cierre.to_currency} `
        + `por ${monto.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${r.cierre.from_currency}. `
        + `Tenes ${mins} minutos para enviar y subir el comprobante.`)
      if (instrucciones) {
        await escribirMensaje(r.cierre.id, 'mesa', instrucciones.slice(0, 4000), { autorId: caller.userId, autorNom: caller.nombre ?? undefined })
      }
      return json(200, { ok: true, toAmount: to, venceAt: vence, ventanaMin: mins })
    }

    // ── Subir comprobante (paso propio, antes de marcar pagado) ──
    if (action === 'comprobante') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status === 'completada' || r.cierre.status === 'cancelada') {
        return json(409, { ok: false, error: 'ese cierre ya esta cerrado' })
      }
      const archivo = String(payload.archivo ?? '')
      if (!archivo) return json(400, { ok: false, error: 'falta el archivo' })
      const sub = await guardarComprobante(r.cierre.id, archivo, String(payload.nombre ?? ''), String(payload.tipo ?? ''))
      if (!sub.ok) return json(400, { ok: false, error: sub.error })
      await escribirMensaje(r.cierre.id, 'cliente', String(payload.nota ?? 'Comprobante del envio.').slice(0, 500),
        { autorId: caller.userId, autorNom: caller.nombre ?? undefined, adjunto: sub.path })
      return json(200, { ok: true })
    }

    // ── El cliente avisa que ya pago ────────────────────
    if (action === 'marcar_pagada') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status !== 'esperando_pago') {
        return json(409, { ok: false, error: 'todavia no hay instrucciones de pago para este cierre' })
      }
      // El plazo se comprueba ACA tambien, no solo en el reloj de la pantalla:
      // un contador del navegador se para, se adelanta o se edita.
      if (r.cierre.vence_at && new Date(r.cierre.vence_at).getTime() < Date.now()) {
        await caducarVencidos()
        return json(409, {
          ok: false, error: 'vencido',
          message: 'Se vencio el plazo. Si ya enviaste el dinero, escribi por el chat antes de montar otra solicitud.',
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
        return json(400, { ok: false, error: 'falta_comprobante', message: 'Subi el comprobante del envio antes de marcarlo como pagado.' })
      }

      await db.from('otc_closes').update({ status: 'pagada', pagada_at: ahora(), updated_at: ahora() }).eq('id', r.cierre.id)
      await escribirMensaje(r.cierre.id, 'sistema', 'El cliente marco el envio como realizado. La mesa verifica el ingreso antes de liberar.')
      return json(200, { ok: true })
    }

    // ── La mesa libera ──────────────────────────────────
    if (action === 'completar') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status === 'completada') return json(200, { ok: true, yaEstaba: true })
      if (r.cierre.status === 'cancelada') return json(409, { ok: false, error: 'ese cierre esta cancelado' })
      if (!r.cierre.rate_final) {
        return json(409, { ok: false, error: 'falta_tasa', message: 'Fija la tasa final antes de completar: sin eso el cierre queda sin precio de ejecucion.' })
      }
      const destino = String(r.cierre.payout?.wallet ?? (r.cierre.side === 'vende_usdt' ? 'COP' : 'USD'))
      const monto = Number(r.cierre.to_amount)
      if (!(monto > 0)) {
        return json(409, { ok: false, error: 'sin_monto', message: 'Este cierre no tiene monto a acreditar. Fija la tasa final primero.' })
      }

      // CAS sobre el estado: es el ÚNICO seguro contra completar dos veces —
      // dos clicks, dos pestañas o un reintento de red. Se toma ANTES de mover
      // plata, para que el acreditado corra una sola vez.
      const { data: ok } = await db.from('otc_closes').update({
        status: 'completada', completada_at: ahora(), updated_at: ahora(),
      }).eq('id', r.cierre.id).neq('status', 'completada').select('id')
      if (!ok?.length) return json(200, { ok: true, yaEstaba: true })

      // Completar es lo que ACREDITA. Antes solo cambiaba el estado: el cierre
      // quedaba "completado" y el cliente sin su plata ni el movimiento.
      const { data: res, error: errSaldo } = await db.rpc('adjust_balances', {
        p_user_id: r.cierre.user_id, p_fiat: { [destino]: monto },
      })
      if (errSaldo || (res as any)?.error) {
        // No se acredito: el cierre NO puede quedar completado. Se devuelve al
        // estado anterior para que se pueda reintentar, en vez de dejar un
        // "completado" que no movio nada.
        await db.from('otc_closes').update({ status: r.cierre.status, completada_at: null, updated_at: ahora() }).eq('id', r.cierre.id)
        const detalle = errSaldo?.message ?? (res as any)?.error
        await escribirMensaje(r.cierre.id, 'sistema', `No se pudo acreditar el saldo (${detalle}). El cierre sigue abierto.`)
        return json(500, { ok: false, error: 'no_acreditado', message: `No se pudo acreditar el saldo: ${detalle}. El cierre quedo como estaba.` })
      }

      // El movimiento. Si esto fallara, la plata ya esta bien y lo que falta es
      // el registro — se dice en el hilo en vez de callarlo.
      const tasa = Number(r.cierre.rate_final ?? r.cierre.rate_cotizada) || null
      try {
        await db.from('transactions').insert({
          user_id: r.cierre.user_id, type: 'convert', amount: monto, currency: destino, status: 'Completado',
          raw_data: {
            title: `${r.cierre.from_currency} → ${r.cierre.to_currency} · Mesa OTC ${r.cierre.ref}`,
            initials: 'FX',
            fromCurrency: r.cierre.from_currency, fromAmount: Number(r.cierre.from_amount),
            destAmount: monto, mouvRate: tasa,
            source: 'OTC_MANUAL', otcRef: r.cierre.ref, otcCloseId: r.cierre.id,
            // El cliente RECIBE: el movimiento va en positivo. Se dice
            // explicito y no se deja deducir -- un signo al reves en un
            // movimiento de dinero no es un detalle de estilo.
            direccion: 'in',
            completadaPor: caller.nombre ?? null,
          },
        })
      } catch (e: any) {
        await escribirMensaje(r.cierre.id, 'sistema', `Saldo acreditado, pero el movimiento no quedo registrado (${e?.message ?? 'error'}). Avisar a soporte.`)
      }

      await escribirMensaje(r.cierre.id, 'sistema',
        `Cierre completado por ${caller.nombre ?? 'la mesa'}. Se acreditaron `
        + `${monto.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${r.cierre.to_currency} en ${NOMBRE_BILLETERA[destino] ?? destino}.`)
      return json(200, { ok: true, acreditado: monto, billetera: destino })
    }

    // ── Cancelar (los dos lados, con reglas distintas) ──
    if (action === 'cancelar' || action === 'cancelar_mesa') {
      const r = await cargarCierre(String(payload.id ?? ''), caller)
      if (!r.ok) return json(404, { ok: false, error: r.motivo })
      if (r.cierre.status === 'completada') return json(409, { ok: false, error: 'ese cierre ya se completo' })
      if (r.cierre.status === 'cancelada') return json(200, { ok: true, yaEstaba: true })
      // El cliente solo puede cancelar mientras nadie espera su plata. Una vez
      // que dijo que pago, cancelar es decision de la mesa: puede haber dinero
      // en camino.
      if (!caller.admin && r.cierre.status === 'pagada') {
        return json(409, { ok: false, error: 'ya_pagada', message: 'Ya marcaste el envio. Escribile a la mesa por el chat para resolverlo.' })
      }
      const motivo = String(payload.motivo ?? '').trim()
      if (caller.admin && !motivo) return json(400, { ok: false, error: 'falta el motivo de la cancelacion' })
      await db.from('otc_closes').update({
        status: 'cancelada', cancelada_at: ahora(), motivo_cierre: motivo || (caller.admin ? null : 'Cancelada por el cliente'), updated_at: ahora(),
      }).eq('id', r.cierre.id)
      await escribirMensaje(r.cierre.id, 'sistema',
        caller.admin ? `Cierre cancelado por la mesa. Motivo: ${motivo}` : 'El cliente cancelo la solicitud.')
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
        guardado: v ?? null,
        limites: { margenMax: MARGEN_MAX, ventanaMin: VENTANA_MIN, ventanaMax: VENTANA_MAX },
      })
    }

    if (action === 'config_set') {
      // Solo el plazo. El margen NO se configura global: se pacta por cliente.
      const actual = { ventanaMin: await ventanaPago() }
      const nuevo: Record<string, number> = { ...actual }
      if (payload.ventanaMin !== undefined) {
        const n = num(payload.ventanaMin)
        if (!(Number.isFinite(n) && n >= VENTANA_MIN && n <= VENTANA_MAX)) {
          return json(400, { ok: false, error: `El plazo tiene que estar entre ${VENTANA_MIN} y ${VENTANA_MAX} minutos.` })
        }
        nuevo.ventanaMin = n
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
