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
//    POST /v2/risk_score_create_task  → asíncrono (sin límite de tasa)
//    GET  /v2/risk_score_query_task
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

// Un veredicto SOLO si hay un puntaje o un nivel legible. Si el proveedor
// respondió 200 con un cuerpo que no trae ninguno de los dos, no hay veredicto
// — y eso se dice, no se inventa.
function leerVeredicto(bruto: any): {
  hay: boolean
  score: number | null
  level: string | null
  riskDetail: any[]
  detailList: any[]
  reportUrl: string | null
} {
  const d = desenvolver(bruto)
  const scoreRaw = d?.score ?? d?.risk_score ?? d?.riskScore
  const levelRaw = d?.risk_level ?? d?.riskLevel ?? d?.level
  const score = Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null
  const level = typeof levelRaw === 'string' && levelRaw.trim() ? levelRaw.trim() : null
  const arr = (v: any): any[] => (Array.isArray(v) ? v : [])
  return {
    hay: score !== null || level !== null,
    score,
    level,
    riskDetail: arr(d?.risk_detail ?? d?.riskDetail),
    detailList: arr(d?.detail_list ?? d?.detailList),
    reportUrl: typeof d?.risk_report_url === 'string' ? d.risk_report_url : (typeof d?.report_url === 'string' ? d.report_url : null),
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
      await guardarConfig(nueva)
      return json({ ok: true, config: nueva })
    }

    // ── Cadenas soportadas, según el proveedor ────────────────────
    // No se hardcodean: se le preguntan a MistTrack. Una lista de cadenas
    // escrita a mano se desactualiza en silencio y el cliente recibe un error
    // sin explicación al elegir una que el proveedor ya no acepta.
    if (accion === 'cadenas') {
      const r = await llamarMT(c, c.rutaEstado, {})
      if (!r.ok) return json({ ok: false, error: 'proveedor', status: r.status, detalle: r.error ?? null })
      const d = desenvolver(r.data) ?? {}
      const lista = (d.coin_list ?? d.coins ?? d.supported_coins ?? d.list ?? []) as any[]
      return json({ ok: true, cadenas: Array.isArray(lista) ? lista : [], crudo: yo.esAdmin ? r.data : undefined })
    }

    // ── CONSULTA ──────────────────────────────────────────────────
    if (accion === 'consultar') {
      if (!c.activo) return json({ ok: false, error: 'inactivo', mensaje: 'El servicio no está habilitado.' })

      const coin = String(body.coin ?? '').trim().toUpperCase()
      const dir = normDir(body.address)
      if (!coin) return json({ ok: false, error: 'falta_cadena', mensaje: 'Elegí la red de la dirección.' })
      if (dir.length < 20 || dir.length > 120) {
        return json({ ok: false, error: 'direccion_invalida', mensaje: 'Esa no parece una dirección válida.' })
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
      const sirve = !!ficha && ficha.estado === 'finalizado' && Date.now() < vigenteHasta

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

      // 3) Se paga la consulta.
      const r = await llamarMT(c, c.rutaRiesgo, { coin, address: dir })
      const v = leerVeredicto(r.data)

      if (!r.ok || !v.hay) {
        // NO HAY VEREDICTO. Se guarda que no lo hubo —para no repetir el gasto
        // a ciegas y para que el admin vea qué respondió el proveedor— pero no
        // se devuelve nada que se pueda leer como "está limpia".
        await db.from('kyt_registry').upsert({
          coin, address_lower: dir.toLowerCase(), address: dir,
          estado: 'sin_resultado',
          respuesta_cruda: { status: r.status, error: r.error ?? null, data: r.data ?? null },
          actualizado_at: new Date().toISOString(),
          empresas: anotarEmpresa(ficha?.empresas, quien),
        }, { onConflict: 'coin,address_lower' })

        return json({
          ok: false,
          error: r.error === 'sin_credencial' ? 'sin_credencial' : 'sin_resultado',
          estado: 'sin_resultado',
          mensaje: r.error === 'sin_credencial'
            ? 'El servicio no está configurado todavía.'
            : 'No pudimos obtener un resultado para esa dirección. No significa que esté limpia: significa que no sabemos.',
          status: yo.esAdmin ? r.status : undefined,
          detalle: yo.esAdmin ? (r.data ?? r.error ?? null) : undefined,
        })
      }

      // Etiquetas: es una segunda llamada y NO es indispensable. Si falla, el
      // veredicto igual vale — se muestra sin etiquetas, no se pierde todo.
      let etiquetas: any[] = []
      try {
        const e = await llamarMT(c, c.rutaEtiquetas, { coin, address: dir })
        if (e.ok) {
          const d = desenvolver(e.data)
          const l = d?.label_list ?? d?.labels ?? d?.label ?? []
          etiquetas = Array.isArray(l) ? l : (l ? [l] : [])
        }
      } catch { /* el veredicto no depende de esto */ }

      const ahora = new Date().toISOString()
      await db.from('kyt_registry').upsert({
        coin, address_lower: dir.toLowerCase(), address: dir,
        risk_score: v.score, risk_level: v.level,
        risk_detail: v.riskDetail, detail_list: v.detailList,
        labels: etiquetas, report_url: v.reportUrl,
        estado: 'finalizado',
        respuesta_cruda: r.data ?? null,
        consultado_at: ahora, actualizado_at: ahora,
        veces_consultado: Number(ficha?.veces_consultado ?? 0) + 1,
        veces_reutilizado: Number(ficha?.veces_reutilizado ?? 0),
        empresas: anotarEmpresa(ficha?.empresas, quien),
      }, { onConflict: 'coin,address_lower' })

      // Se audita la consulta PAGADA: es lo que cuenta para el tope diario y
      // para saber en qué se gastó el plan.
      try {
        await db.from('audit_log').insert({
          user_id: yo.userId, action: 'kyt.consulta_pagada',
          metadata: { coin, address: dir, score: v.score, level: v.level, empresa: quien.empresa },
        })
      } catch { /* que no se pierda la consulta por no poder auditar */ }

      return json({
        ok: true,
        address: dir, coin,
        categoria: clasificar(c, v.score, v.level),
        puntaje: v.score, nivel: v.level,
        hallazgos: v.riskDetail, etiquetas, detalle: v.detailList,
        reporte: v.reportUrl,
        estado: 'finalizado',
        delPadron: false,
        consultadoAt: ahora,
      })
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
