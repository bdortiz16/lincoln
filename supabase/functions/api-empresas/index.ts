// ══════════════════════════════════════════════════════════════════
//  api-empresas — API de lectura de saldos de los clientes de cada empresa
//
//  Para un sistema externo. Cada consulta va FIRMADA (HMAC-SHA256) con un
//  secreto que el sistema rota cada hora; si un secreto viejo se sigue
//  usando después de rotar, hay dos usuarios del mismo secreto (robo) y la
//  credencial entera se revoca. Todo intento, bueno o malo, queda en
//  api_consultas con IP, país, User-Agent y dispositivo.
//
//    GET  /functions/v1/api-empresas            → todas las empresas
//    GET  /functions/v1/api-empresas?id=XXXX    → detalle de una empresa
//    POST /functions/v1/api-empresas/rotar      → nueva generación del secreto
//
//  El panel (admin + 2FA + dueño) usa POST {action} sin X-Llave-Id:
//    crear | listar | revocar | registro
//
//  Diseño: docs/superpowers/specs/2026-11-12-api-empresas-design.md
//  Guía para el sistema externo: docs/api-empresas.md
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verificarAdminConMfa, igualSeguro } from '../_shared/admin-auth.ts'
import { accesoDe } from '../_shared/equipo.ts'
import {
  textoAFirmar, firmar, horaValida, generarSecreto, generarLlaveId, cifrar, descifrar,
  evaluarGeneracion, VIDA_MS, NONCE_MS, type Gen,
} from './firma.ts'
import { armarDetalle, armarResumen, idsAutorizados, leerEmpresas, leerOperadores, usadoMes } from './datos.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CLAVE = Deno.env.get('API_SECRETOS_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const TOPE_POR_MINUTO = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const NO_AUTORIZADO = () => json(401, { error: 'no_autorizado' })

// Mismo criterio que admin-data: primero la de Cloudflare (no se puede falsear).
function ipOf(req: Request): string | null {
  const cf = (req.headers.get('cf-connecting-ip') ?? '').trim()
  if (cf) return cf
  const fwd = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return fwd || req.headers.get('x-real-ip') || null
}

async function auditar(action: string, metadata: Record<string, unknown>, userId: string | null = null) {
  try { await db.from('audit_log').insert({ user_id: userId, action, metadata }) } catch { /* la auditoría no frena */ }
}

async function avisarAdmin(asunto: string, lineas: string[]) {
  const KEY = Deno.env.get('RESEND_API_KEY') ?? ''
  const FROM = Deno.env.get('OTP_FROM_EMAIL') ?? Deno.env.get('FROM_EMAIL') ?? 'no-reply@lincoin.me'
  const ADMIN = Deno.env.get('VITE_ADMIN_EMAIL') ?? Deno.env.get('ADMIN_EMAIL') ?? ''
  if (!KEY || !ADMIN) return
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM}>`, to: [ADMIN], subject: asunto,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px">${lineas.map(l => `<p>${esc(l)}</p>`).join('')}</body></html>`,
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el correo es un extra */ }
}

// ── API firmada ──────────────────────────────────────────────────────────
type Registro = {
  credencial_id: string | null; generacion: number | null; accion: string | null; id_consultado: string | null
  ip: string | null; pais: string | null; user_agent: string | null; dispositivo: string | null
}

async function apiFirmada(req: Request, url: URL): Promise<Response> {
  const inicio = Date.now()
  const reg: Registro = {
    credencial_id: null, generacion: null, accion: null, id_consultado: url.searchParams.get('id'),
    ip: ipOf(req), pais: req.headers.get('cf-ipcountry'), user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
    dispositivo: (req.headers.get('x-dispositivo') ?? '').slice(0, 120) || null,
  }
  const rotar = req.method === 'POST' && url.pathname.replace(/\/+$/, '').endsWith('/rotar')
  reg.accion = rotar ? 'rotar' : reg.id_consultado ? 'detalle' : 'listar'
  const salir = async (resultado: string, res: Response, clientes: number | null = null) => {
    try { await db.from('api_consultas').insert({ ...reg, resultado, clientes, duracion_ms: Date.now() - inicio }) } catch { /* el registro no tumba la respuesta */ }
    return res
  }

  if (!CLAVE) return salir('error', json(500, { error: 'no_configurado' }))
  const llaveId = (req.headers.get('x-llave-id') ?? '').trim()
  const g = Number(req.headers.get('x-generacion'))
  const hora = (req.headers.get('x-hora') ?? '').trim()
  const nonce = (req.headers.get('x-nonce') ?? '').trim()
  const firma = (req.headers.get('x-firma') ?? '').trim().toLowerCase()
  if (!llaveId || !Number.isInteger(g) || !hora || nonce.length < 16 || nonce.length > 128 || !firma) return salir('firma_invalida', NO_AUTORIZADO())

  const { data: cred } = await db.from('api_credenciales').select('*').eq('llave_id', llaveId).maybeSingle()
  if (!cred) return salir('firma_invalida', NO_AUTORIZADO())
  reg.credencial_id = cred.id
  reg.generacion = g
  if (cred.estado !== 'activa') return salir('credencial_revocada', NO_AUTORIZADO())

  const { data: gens } = await db.from('api_secretos').select('generacion, expira_at, reemplazado_at, secreto_cifrado').eq('credencial_id', cred.id)
  const lista = (gens ?? []) as (Gen & { secreto_cifrado: string })[]
  const estadoGen = evaluarGeneracion(lista, g)
  if (estadoGen === 'desconocida') return salir('firma_invalida', NO_AUTORIZADO())
  if (!horaValida(hora)) return salir('hora_fuera_de_rango', NO_AUTORIZADO())

  // La firma se verifica ANTES de decidir reuso o vencimiento: así nadie
  // puede revocar una credencial ajena con solo conocer su llave_id.
  const cuerpo = req.method === 'POST' ? await req.text() : ''
  const ruta = url.pathname.startsWith('/functions/v1') ? url.pathname : `/functions/v1${url.pathname}`
  const gen = lista.find(x => Number(x.generacion) === g)!
  let secreto: string
  try { secreto = await descifrar(CLAVE, gen.secreto_cifrado) } catch { return salir('error', json(500, { error: 'error' })) }
  const esperada = await firmar(secreto, await textoAFirmar(req.method, ruta, url.searchParams, hora, nonce, cuerpo))
  if (!igualSeguro(esperada, firma)) return salir('firma_invalida', NO_AUTORIZADO())

  if (estadoGen === 'reuso') return salir('reuso_detectado', await revocarPorReuso(cred, g, reg))
  if (estadoGen === 'vencida') return salir('generacion_vencida', NO_AUTORIZADO())

  // Nonce de un solo uso (la PK lo garantiza) y limpieza de los viejos.
  await db.from('api_nonces').delete().lt('at', new Date(Date.now() - NONCE_MS).toISOString())
  const { error: errNonce } = await db.from('api_nonces').insert({ credencial_id: cred.id, nonce })
  if (errNonce) return salir('nonce_repetido', NO_AUTORIZADO())

  const ips: string[] = Array.isArray(cred.ips_permitidas) ? cred.ips_permitidas.filter(Boolean) : []
  if (ips.length && !ips.includes(String(reg.ip ?? ''))) return salir('ip_no_permitida', json(403, { error: 'no_autorizado' }))

  const { count } = await db.from('api_consultas').select('id', { count: 'exact', head: true })
    .eq('credencial_id', cred.id).gte('at', new Date(Date.now() - 60_000).toISOString())
  if ((count ?? 0) >= TOPE_POR_MINUTO) return salir('demasiadas_consultas', json(429, { error: 'demasiadas_consultas' }))

  // IP nunca vista con éxito para esta credencial → aviso.
  if (reg.ip) {
    const { count: vista } = await db.from('api_consultas').select('id', { count: 'exact', head: true })
      .eq('credencial_id', cred.id).eq('ip', reg.ip).eq('resultado', 'ok')
    if (!vista) {
      await auditar('api.ip_nueva', { credencial: cred.llave_id, ip: reg.ip, pais: reg.pais, user_agent: reg.user_agent, dispositivo: reg.dispositivo })
      await avisarAdmin(`API externa: IP nueva para "${cred.etiqueta}"`, [
        `La credencial ${cred.llave_id} (${cred.etiqueta}) se usó desde una IP que no se había visto.`,
        `IP: ${reg.ip} · País: ${reg.pais ?? '—'}`,
        `Programa: ${reg.user_agent ?? '—'} · Dispositivo: ${reg.dispositivo ?? '—'}`,
        'Si no fue el sistema autorizado, revoca la credencial en Admin → Seguridad → API externa.',
      ])
    }
  }

  try {
    if (rotar) {
      // Solo la generación vigente puede rotar, y una sola vez: si otro ya
      // rotó desde ella (no actualiza ninguna fila), son dos usuarios.
      const { data: marcada } = await db.from('api_secretos').update({ reemplazado_at: new Date().toISOString() })
        .eq('credencial_id', cred.id).eq('generacion', g).is('reemplazado_at', null).select('generacion')
      if (!marcada?.length) {
        // Respuesta perdida: el sistema reintenta rotar desde la misma
        // generación. Si la siguiente todavía no se ha usado nunca, se le
        // devuelve esa misma (no hay dos usuarios: nadie la conoce aún).
        const ultima = lista.reduce((m, x) => Number(x.generacion) > Number(m.generacion) ? x : m, lista[0])
        if (Number(ultima.generacion) === g + 1) {
          const { count: usada } = await db.from('api_consultas').select('id', { count: 'exact', head: true })
            .eq('credencial_id', cred.id).eq('generacion', g + 1).eq('resultado', 'ok')
          if (!usada) return salir('ok', json(200, { generacion: g + 1, secreto: await descifrar(CLAVE, ultima.secreto_cifrado), expira_at: ultima.expira_at }))
        }
        return salir('reuso_detectado', await revocarPorReuso(cred, g, reg))
      }
      const nueva = Math.max(...lista.map(x => Number(x.generacion))) + 1
      const s = generarSecreto()
      const expira = new Date(Date.now() + VIDA_MS).toISOString()
      const { error } = await db.from('api_secretos').insert({ credencial_id: cred.id, generacion: nueva, secreto_cifrado: await cifrar(CLAVE, s), expira_at: expira })
      if (error) return salir('error', json(500, { error: 'error' }))
      return salir('ok', json(200, { generacion: nueva, secreto: s, expira_at: expira }))
    }
    if (req.method !== 'GET') return salir('error', json(405, { error: 'metodo_no_permitido' }))

    const empresas = (await leerEmpresas(db)).filter(e => !cred.empresa_id || String(e.id) === String(cred.empresa_id))
    if (reg.id_consultado) {
      const id = reg.id_consultado.toUpperCase()
      const emp = empresas.find(e => String(e.raw_data?.ownReferralCode ?? '').toUpperCase() === id)
      if (!emp) return salir('id_no_existe', json(404, { error: 'no_encontrado' }))
      const ids = idsAutorizados(emp)
      const [ops, usado] = await Promise.all([leerOperadores(db, ids), usadoMes(db, ids)])
      const d = armarDetalle(emp, ops, usado, new Date())
      return salir('ok', json(200, d), d.clientes.length)
    }
    const todos = [...new Set(empresas.flatMap(idsAutorizados))]
    const ops = await leerOperadores(db, todos)
    const lista2 = empresas.filter(e => e.raw_data?.ownReferralCode).map(e => armarResumen(e, ops))
    return salir('ok', json(200, { generado_at: new Date().toISOString(), empresas: lista2 }), lista2.reduce((s, e) => s + e.clientes, 0))
  } catch (e) {
    console.error('[api-empresas]', String((e as Error)?.message ?? e))
    return salir('error', json(500, { error: 'error' }))
  }
}

async function revocarPorReuso(cred: any, g: number, reg: Registro): Promise<Response> {
  await db.from('api_credenciales').update({ estado: 'revocada', motivo_revocacion: 'reuso', revocada_at: new Date().toISOString() }).eq('id', cred.id).eq('estado', 'activa')
  await auditar('api.credencial_revocada_por_reuso', { credencial: cred.llave_id, generacion: g, ip: reg.ip, pais: reg.pais, user_agent: reg.user_agent, dispositivo: reg.dispositivo })
  await avisarAdmin(`API externa: credencial "${cred.etiqueta}" REVOCADA por posible robo`, [
    `Se usó un secreto ya reemplazado de la credencial ${cred.llave_id} (${cred.etiqueta}), generación ${g}.`,
    'Eso significa que dos sistemas tienen el mismo secreto. La credencial quedó revocada.',
    `IP: ${reg.ip ?? '—'} · País: ${reg.pais ?? '—'} · Programa: ${reg.user_agent ?? '—'}`,
    'Para reconectar al sistema legítimo, emite una credencial nueva en Admin → Seguridad → API externa.',
  ])
  return NO_AUTORIZADO()
}

// ── Panel de administración ──────────────────────────────────────────────
async function panel(req: Request): Promise<Response> {
  const v = await verificarAdminConMfa(db, req)
  if (!v.ok) return json(v.status, { ok: false, error: v.error })
  const acceso = await accesoDe(db, v.userId, v.email, Deno.env.get('VITE_ADMIN_EMAIL') ?? Deno.env.get('ADMIN_EMAIL') ?? null)
  if (acceso.desactivado || acceso.rol !== 'dueno') return json(403, { ok: false, error: 'Solo el dueño puede administrar la API externa.' })
  const body = await req.json().catch(() => ({})) as Record<string, any>
  const accion = String(body.action ?? '')

  if (accion === 'crear') {
    if (!CLAVE) return json(500, { ok: false, error: 'Falta configurar API_SECRETOS_KEY en Supabase.' })
    const etiqueta = String(body.etiqueta ?? '').trim().slice(0, 80)
    if (etiqueta.length < 3) return json(400, { ok: false, error: 'Escribe el nombre del sistema que se va a conectar.' })
    const ips = String(body.ips ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean).slice(0, 20)
    const llaveId = generarLlaveId()
    const { data: cred, error } = await db.from('api_credenciales').insert({ llave_id: llaveId, etiqueta, ips_permitidas: ips.length ? ips : null, creada_por: v.userId }).select('id').single()
    if (error || !cred) return json(500, { ok: false, error: 'No se pudo crear la credencial.' })
    const s = generarSecreto()
    const expira = new Date(Date.now() + VIDA_MS).toISOString()
    const { error: e2 } = await db.from('api_secretos').insert({ credencial_id: cred.id, generacion: 1, secreto_cifrado: await cifrar(CLAVE, s), expira_at: expira })
    if (e2) { await db.from('api_credenciales').delete().eq('id', cred.id); return json(500, { ok: false, error: 'No se pudo crear la credencial.' }) }
    await auditar('api.credencial_creada', { credencial: llaveId, etiqueta, ips }, v.userId)
    return json(200, { ok: true, llave_id: llaveId, secreto: s, generacion: 1, expira_at: expira })
  }

  if (accion === 'listar') {
    const { data: creds } = await db.from('api_credenciales').select('*').order('creada_at', { ascending: false }).limit(100)
    const out = []
    for (const c of (creds ?? []) as any[]) {
      const { data: g } = await db.from('api_secretos').select('generacion, creado_at, expira_at').eq('credencial_id', c.id).order('generacion', { ascending: false }).limit(1)
      const { data: u } = await db.from('api_consultas').select('at, ip, pais, resultado').eq('credencial_id', c.id).eq('resultado', 'ok').order('at', { ascending: false }).limit(1)
      out.push({ ...c, generacion: g?.[0]?.generacion ?? null, ultima_rotacion: g?.[0]?.creado_at ?? null, expira_at: g?.[0]?.expira_at ?? null, ultimo_uso: u?.[0] ?? null })
    }
    return json(200, { ok: true, credenciales: out })
  }

  if (accion === 'revocar') {
    const id = String(body.id ?? '')
    const { data: c } = await db.from('api_credenciales').update({ estado: 'revocada', motivo_revocacion: 'manual', revocada_at: new Date().toISOString() }).eq('id', id).eq('estado', 'activa').select('llave_id').maybeSingle()
    if (!c) return json(404, { ok: false, error: 'No está activa o no existe.' })
    await auditar('api.credencial_revocada', { credencial: c.llave_id }, v.userId)
    return json(200, { ok: true })
  }

  if (accion === 'registro') {
    let q = db.from('api_consultas').select('*').order('at', { ascending: false }).limit(200)
    if (body.credencial_id) q = q.eq('credencial_id', String(body.credencial_id))
    if (body.resultado) q = q.eq('resultado', String(body.resultado))
    const { data } = await q
    return json(200, { ok: true, consultas: data ?? [] })
  }

  return json(400, { ok: false, error: 'Acción desconocida' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  try {
    if (req.headers.get('x-llave-id')) return await apiFirmada(req, url)
    if (req.method === 'POST') return await panel(req)
    return NO_AUTORIZADO()
  } catch (e) {
    console.error('[api-empresas]', String((e as Error)?.message ?? e))
    return json(500, { error: 'error' })
  }
})
