// ══════════════════════════════════════════════════════════════════
//  gowd — cuentas en Brasil (PIX · BRL) para los clientes de Lincoin
//
//  La cuenta la abre nuestro aliado en Brasil y la asignamos a un cliente.
//  Todo queda en public.cuentas_brasil y solo esta función la escribe.
//
//  DOS CAMINOS PARA QUE UN CLIENTE TENGA CUENTA
//    · Manual: el aliado entrega los datos de una cuenta ya abierta y un
//      admin la asigna (admin_asignar). Funciona desde hoy.
//    · Por API: admin_crear_api se la pide al aliado a través del proxy mTLS.
//      Queda cableado pero DETENIDO: la ruta y el cuerpo de su endpoint de
//      cuentas no están en la documentación que tenemos, y una llamada
//      inventada a un banco no se manda. Ver crearEnGowd() más abajo.
//
//  EL CLIENTE NO VE EL NOMBRE DEL ALIADO
//    Ve "tu cuenta en Brasil" y sus datos para recibir PIX. Con quién
//    operamos es información nuestra.
//
//  QUIÉN PUEDE QUÉ
//    Cliente (Empresa, KYC aprobado): mi_cuenta · solicitar
//    Admin con Brasil (dueño u operaciones): asignar, rechazar, suspender,
//      reactivar, crear por API. Cumplimiento y lectura solo listan.
//    Las acciones de admin que escriben exigen la sesión verificada con 2FA,
//    igual que en admin-data: asignar una cuenta bancaria al cliente
//    equivocado es plata que le llega a quien no es.
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mergeRaw } from '../_shared/raw-data.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ADMIN_EMAIL  = Deno.env.get('ADMIN_EMAIL') ?? ''
const PROXY_URL    = (Deno.env.get('GOWD_PROXY_URL') ?? '').trim()
const PROXY_SECRET = (Deno.env.get('GOWD_PROXY_SECRET') ?? '').trim()
const MFA_TTL_MS   = 24 * 3600 * 1000
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ── Quién llama ─────────────────────────────────────────────────────────
type Quien = { id: string; email: string; role: string; nombre: string; empresa: string; taxId: string; kyc: string; bloqueado: boolean; raw: Record<string, any> }

function sessionIdOf(req: Request): string | null {
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    const part = jwt.split('.')[1]
    if (!part) return null
    const pad = part.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))?.session_id ?? null
  } catch { return null }
}

async function quienLlama(req: Request): Promise<Quien | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  const { data: { user }, error } = await db.auth.getUser(jwt)
  if (error || !user) return null
  const { data: f } = await db.from('users').select('*').eq('id', user.id).maybeSingle()
  if (!f) return null
  const raw = (f.raw_data ?? {}) as Record<string, any>
  return {
    id: String(f.id), email: String(f.email ?? user.email ?? ''), role: String(f.role ?? ''),
    nombre: String(f.full_name ?? ''), empresa: String(f.company_name ?? raw.companyName ?? ''),
    taxId: String(f.tax_id ?? raw.taxId ?? ''), kyc: String(f.kyc_status ?? ''),
    bloqueado: !!(f.is_blocked ?? raw.isBlocked), raw,
  }
}

// Mismo modelo de permisos que admin-data (tabla admin_miembros). Si la tabla
// no existe o está vacía, todo admin es dueño: una migración sin correr no le
// quita el acceso a nadie.
type Acceso = { rol: 'dueno' | 'operaciones' | 'cumplimiento' | 'lectura'; brasil: boolean }
async function accesoDe(userId: string, email: string): Promise<Acceso> {
  const TODO: Acceso = { rol: 'dueno', brasil: true }
  const { data: m, error } = await db.from('admin_miembros').select('rol, paises, activo').eq('id', userId).maybeSingle()
  if (error) return TODO
  if (m && (m as any).activo) {
    const rol = String((m as any).rol) as Acceso['rol']
    const paises: string[] = Array.isArray((m as any).paises) ? (m as any).paises.map(String) : []
    return { rol, brasil: rol === 'dueno' || paises.includes('BR') }
  }
  if (m && !(m as any).activo) return { rol: 'lectura', brasil: false }
  const { count, error: e2 } = await db.from('admin_miembros').select('id', { count: 'exact', head: true })
  if (e2 || !count) return TODO
  if (ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return TODO
  return { rol: 'lectura', brasil: false }
}

// La sesión pasó el 2FA completo (mismo registro que escribe admin-data).
function sesionVerificada(req: Request, raw: Record<string, any>): boolean {
  if (!raw.mfaEnabled) return true
  const sid = sessionIdOf(req)
  if (!sid) return true
  const lista: any[] = Array.isArray(raw.mfaSessions) ? raw.mfaSessions : []
  const hit = lista.find(x => x?.sid === sid && (x?.stage ?? 'full') === 'full')
  return !!hit && Date.now() - new Date(hit.at).getTime() < MFA_TTL_MS
}

// ── Validaciones de Brasil ──────────────────────────────────────────────
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

function cnpjValido(v: string): boolean {
  const d = digitos(v)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (base: string, pesos: number[]) => {
    const s = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(d[12]) && d2 === Number(d[13])
}
function cpfValido(v: string): boolean {
  const d = digitos(v)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const calc = (n: number) => {
    const s = d.slice(0, n).split('').reduce((acc, x, i) => acc + Number(x) * (n + 1 - i), 0)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}
const documentoValido = (tipo: string, doc: string) => tipo === 'CNPJ' ? cnpjValido(doc) : tipo === 'CPF' ? cpfValido(doc) : false

// Lo que ve el cliente. Los datos bancarios solo si la cuenta está activa:
// una cuenta en creación todavía puede cambiar, y un PIX a datos que después
// cambian es plata perdida.
function vistaCliente(c: any) {
  if (!c) return null
  const activa = c.estado === 'activa'
  return {
    id: c.id, estado: c.estado, solicitadaAt: c.solicitada_at, activadaAt: c.activada_at,
    titular: c.titular, documentoTipo: c.documento_tipo, documento: c.documento,
    notaCliente: c.nota_cliente ?? null,
    ...(activa ? {
      bancoNombre: c.banco_nombre, bancoCodigo: c.banco_codigo, ispb: c.ispb, agencia: c.agencia,
      conta: c.conta, contaTipo: c.conta_tipo, chavePix: c.chave_pix, chavePixTipo: c.chave_pix_tipo,
    } : {}),
  }
}

// ── Avisos ──────────────────────────────────────────────────────────────
async function push(cuerpo: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'enviar', insistir: true, ...cuerpo }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el aviso es un extra */ }
}
async function notificarCliente(userId: string, titulo: string, mensaje: string, tipo: 'info' | 'success' = 'info') {
  try {
    const { data: cur } = await db.from('users').select('raw_data').eq('id', userId).single()
    const raw = { ...((cur?.raw_data as any) ?? {}) }
    const lista: any[] = Array.isArray(raw.notifications) ? raw.notifications : []
    raw.notifications = [...lista, { id: Date.now(), type: tipo, title: titulo, message: mensaje, read: false, date: new Date().toLocaleDateString('es-CO') }].slice(-60)
    await mergeRaw(db, userId, { notifications: raw.notifications })
  } catch { /* la campana es un extra */ }
  await push({ user_ids: [userId], titulo, cuerpo: mensaje, tag: `brasil-${userId}`, url: '/portal_empresas' })
}
async function auditar(userId: string, action: string, metadata: Record<string, unknown>) {
  try { await db.from('audit_log').insert({ user_id: userId, action, metadata: { ...metadata, at: new Date().toISOString() } }) } catch { /* */ }
}

// ── Proxy mTLS hacia el aliado ──────────────────────────────────────────
// La única puerta hacia su API (ver infra/gowd-proxy). La ruta viaja en una
// cabecera; el token lo pone el proxy.
async function llamarProxy(metodo: string, ruta: string, cuerpo?: unknown, idempotencia?: string) {
  if (!PROXY_URL || !PROXY_SECRET) return { status: 0, data: { error: 'proxy_no_configurado' } as any }
  try {
    const r = await fetch(PROXY_URL, {
      method: metodo,
      headers: {
        'content-type': 'application/json', 'x-proxy-secret': PROXY_SECRET, 'x-gowd-path': ruta,
        ...(idempotencia ? { 'idempotency-key': idempotencia } : {}),
      },
      body: cuerpo != null && !['GET', 'DELETE'].includes(metodo) ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(30000),
    })
    const t = await r.text()
    let data: any = null
    try { data = t ? JSON.parse(t) : null } catch { data = { texto: t.slice(0, 500) } }
    return { status: r.status, data }
  } catch (e) {
    const timeout = (e as Error)?.name === 'TimeoutError'
    return { status: timeout ? 504 : 502, data: { error: timeout ? 'sin_respuesta' : 'no_se_pudo_conectar', desenlaceDesconocido: timeout } }
  }
}

// CREAR LA CUENTA EN EL ALIADO — DETENIDO A PROPÓSITO.
// La documentación que tenemos de su API cubre el token y los postbacks de
// órdenes (PAY-IN, PAY-OUT, REFUND, LOAD, TRANSFER). No trae el endpoint ni
// el cuerpo para abrir una cuenta. Mandarle a un banco una llamada con una
// ruta y campos supuestos no es una prueba inofensiva: puede crear algo a
// medias del otro lado. Cuando llegue esa parte de su documentación, esto se
// completa con la ruta exacta, el cuerpo y la lectura de la respuesta
// (id de cuenta, agencia, conta, chave PIX).
async function crearEnGowd(_cuenta: any): Promise<{ ok: false; error: string; message: string }> {
  return {
    ok: false,
    error: 'falta_documentacion',
    message: 'La creación por API todavía no está conectada: falta la documentación del aliado para abrir cuentas (ruta y campos). Mientras tanto, asigna la cuenta con los datos que te entregue el aliado.',
  }
}

// ── Servidor ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)
  let body: Record<string, any> = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'Cuerpo inválido' }, 400) }
  const accion = String(body.action ?? '')
  const yo = await quienLlama(req)
  if (!yo) return json({ ok: false, error: 'Sesión inválida' }, 401)

  try {
    // ── EL CLIENTE ─────────────────────────────────────────────────────
    if (accion === 'mi_cuenta') {
      const { data } = await db.from('cuentas_brasil').select('*').eq('user_id', yo.id)
        .order('solicitada_at', { ascending: false }).limit(1).maybeSingle()
      // Una suspendida no se muestra: sus datos ya no sirven para recibir.
      const c = data && data.estado !== 'suspendida' ? data : null
      return json({ ok: true, cuenta: vistaCliente(c) })
    }

    if (accion === 'solicitar') {
      if (yo.role !== 'business') return json({ ok: false, error: 'La cuenta en Brasil es para cuentas Empresa.' }, 403)
      if (yo.bloqueado) return json({ ok: false, error: 'Tu cuenta está restringida. Escríbenos a soporte.' }, 403)
      if (!['approved', 'verified'].includes(yo.kyc)) return json({ ok: false, error: 'Primero termina la verificación de tu empresa.' }, 403)
      const tipo = String(body.documentoTipo ?? 'CNPJ').toUpperCase()
      const doc = digitos(body.documento)
      const titular = String(body.titular ?? yo.empresa ?? yo.nombre).trim().slice(0, 140)
      if (!['CNPJ', 'CPF'].includes(tipo)) return json({ ok: false, error: 'Tipo de documento inválido.' }, 400)
      if (!documentoValido(tipo, doc)) return json({ ok: false, error: `El ${tipo} no es válido. Revisa los dígitos.` }, 400)
      if (titular.length < 3) return json({ ok: false, error: 'Escribe la razón social del titular.' }, 400)

      const { data: viva } = await db.from('cuentas_brasil').select('*').eq('user_id', yo.id)
        .in('estado', ['solicitada', 'en_creacion', 'activa']).limit(1).maybeSingle()
      if (viva) return json({ ok: true, cuenta: vistaCliente(viva), yaExistia: true })

      const { data: nueva, error } = await db.from('cuentas_brasil').insert({
        user_id: yo.id, estado: 'solicitada', origen: 'manual', titular, documento_tipo: tipo, documento: doc,
      }).select('*').single()
      if (error) {
        // Dos clics a la vez: el índice de "una viva por cliente" frena el segundo.
        if (String((error as any).code) === '23505') {
          const { data: v } = await db.from('cuentas_brasil').select('*').eq('user_id', yo.id).in('estado', ['solicitada', 'en_creacion', 'activa']).limit(1).maybeSingle()
          return json({ ok: true, cuenta: vistaCliente(v), yaExistia: true })
        }
        return json({ ok: false, error: `No se pudo guardar la solicitud: ${error.message}` }, 500)
      }
      await auditar(yo.id, 'brasil.cuenta_solicitada', { cuentaId: nueva.id, documentoTipo: tipo })
      await push({ rol: 'admin', titulo: 'Solicitud de cuenta en Brasil', cuerpo: `${titular} (${tipo} ${doc}) pidió su cuenta en Brasil.`, tag: `brasil-sol-${nueva.id}`, url: '/admin-empresas' })
      return json({ ok: true, cuenta: vistaCliente(nueva) })
    }

    // ── ADMIN ──────────────────────────────────────────────────────────
    if (!accion.startsWith('admin_')) return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
    if (yo.role !== 'admin') return json({ ok: false, error: 'Solo administración' }, 403)
    const acceso = await accesoDe(yo.id, yo.email)
    if (!acceso.brasil) return json({ ok: false, error: 'No tienes acceso a Brasil.' }, 403)

    if (accion === 'admin_listar') {
      let q = db.from('cuentas_brasil').select('*').order('solicitada_at', { ascending: false }).limit(300)
      if (body.userId) q = q.eq('user_id', String(body.userId))
      if (body.estado) q = q.eq('estado', String(body.estado))
      const { data, error } = await q
      if (error) {
        const falta = /does not exist|schema cache/i.test(error.message)
        return json({ ok: false, error: falta ? 'Falta correr la migración 2026_cuentas_brasil.sql en Supabase.' : error.message }, falta ? 424 : 500)
      }
      const ids = [...new Set((data ?? []).map((c: any) => String(c.user_id)))]
      const { data: us } = ids.length ? await db.from('users').select('id, email, full_name, company_name').in('id', ids) : { data: [] as any[] }
      const porId: Record<string, any> = {}
      for (const u of (us ?? []) as any[]) porId[String(u.id)] = u
      return json({
        ok: true,
        puedeEscribir: acceso.rol === 'dueno' || acceso.rol === 'operaciones',
        proxyConfigurado: !!(PROXY_URL && PROXY_SECRET),
        cuentas: (data ?? []).map((c: any) => ({ ...c, cliente: porId[String(c.user_id)] ? { email: porId[String(c.user_id)].email, nombre: porId[String(c.user_id)].company_name || porId[String(c.user_id)].full_name } : null })),
      })
    }

    if (accion === 'admin_ping') {
      // Diagnóstico de la puerta hacia el aliado, sin mover nada: un GET a la
      // raíz. Cualquier respuesta del banco (aunque sea 404) prueba que el
      // proxy tiene certificado, token e IP registrada.
      if (!PROXY_URL || !PROXY_SECRET) return json({ ok: true, estado: 'sin_configurar', detalle: 'Faltan GOWD_PROXY_URL y GOWD_PROXY_SECRET en los secretos de Supabase.' })
      const r = await llamarProxy('GET', '/')
      const e = String(r.data?.error ?? '')
      const estado = r.status === 401 && e === 'no_autorizado' ? 'secreto_invalido'
        : r.status === 503 && e === 'proxy_sin_configurar' ? 'proxy_sin_base'
        : r.status === 503 && e === 'certificado_no_disponible' ? 'sin_certificado'
        : r.status === 502 || r.status === 504 || r.status === 0 ? 'sin_conexion'
        : r.status >= 500 && e ? 'error_proxy'
        : 'conectado'
      const detalle: Record<string, string> = {
        secreto_invalido: 'El proxy rechazó el secreto: GOWD_PROXY_SECRET no coincide con el del proxy.',
        proxy_sin_base: 'El proxy está arriba pero sin la URL del banco (gowd_base en Terraform).',
        sin_certificado: 'El proxy no pudo cargar el certificado .pfx o las credenciales de Secrets Manager.',
        sin_conexion: 'El proxy no llegó al banco (IP no registrada, red o banco caído).',
        error_proxy: `El proxy respondió con error: ${e}.`,
        conectado: `El banco respondió (HTTP ${r.status}): certificado, token e IP funcionan.`,
      }
      return json({ ok: true, estado, http: r.status, detalle: detalle[estado] })
    }

    // De acá en adelante se escribe: dueño u operaciones, con 2FA de sesión.
    if (!(acceso.rol === 'dueno' || acceso.rol === 'operaciones')) return json({ ok: false, error: 'Tu rol solo puede ver las cuentas de Brasil.' }, 403)
    if (!sesionVerificada(req, yo.raw)) return json({ ok: false, error: 'Esta sesión no verificó el segundo factor. Vuelve a iniciar sesión.', needs2fa: true }, 403)

    if (accion === 'admin_asignar') {
      const userId = String(body.userId ?? '')
      const { data: cli } = await db.from('users').select('id, role, company_name, full_name, email').eq('id', userId).maybeSingle()
      if (!cli) return json({ ok: false, error: 'Cliente no encontrado.' }, 404)
      if (cli.role !== 'business') return json({ ok: false, error: 'La cuenta en Brasil se asigna a cuentas Empresa.' }, 400)

      const tipo = String(body.documentoTipo ?? 'CNPJ').toUpperCase()
      const doc = digitos(body.documento)
      const f = {
        titular: String(body.titular ?? '').trim().slice(0, 140),
        banco_nombre: String(body.bancoNombre ?? '').trim().slice(0, 80),
        banco_codigo: digitos(body.bancoCodigo),
        ispb: digitos(body.ispb) || null,
        agencia: String(body.agencia ?? '').replace(/[^\dXx-]/g, '').slice(0, 8),
        conta: String(body.conta ?? '').replace(/[^\dXx-]/g, '').slice(0, 20),
        conta_tipo: String(body.contaTipo ?? 'pagamento'),
        chave_pix: String(body.chavePix ?? '').trim().slice(0, 77) || null,
        chave_pix_tipo: body.chavePix ? String(body.chavePixTipo ?? '') : null,
        gowd_account_id: String(body.gowdAccountId ?? '').trim().slice(0, 120) || null,
      }
      const errores: string[] = []
      if (f.titular.length < 3) errores.push('titular')
      if (!documentoValido(tipo, doc)) errores.push(`${tipo} inválido`)
      if (!f.banco_nombre) errores.push('nombre del banco')
      if (f.banco_codigo.length !== 3) errores.push('código del banco (3 dígitos)')
      if (f.ispb && f.ispb.length !== 8) errores.push('ISPB (8 dígitos)')
      if (!/^\d{1,5}(-[\dXx])?$/.test(f.agencia)) errores.push('agencia')
      if (!/^\d{1,18}-?[\dXx]$/.test(f.conta)) errores.push('conta con dígito')
      if (!['corrente', 'pagamento', 'poupanca'].includes(f.conta_tipo)) errores.push('tipo de conta')
      if (f.chave_pix && !['cnpj', 'cpf', 'email', 'telefone', 'aleatoria'].includes(String(f.chave_pix_tipo))) errores.push('tipo de chave PIX')
      if (errores.length) return json({ ok: false, error: `Revisa: ${errores.join(', ')}.` }, 400)

      const ahora = new Date().toISOString()
      const datos = { ...f, documento_tipo: tipo, documento: doc, estado: 'activa', activada_at: ahora, asignada_por: yo.id, actualizado_at: ahora, nota_cliente: null, nota_interna: String(body.notaInterna ?? '').slice(0, 500) || null }
      const { data: viva } = await db.from('cuentas_brasil').select('id, estado').eq('user_id', userId).in('estado', ['solicitada', 'en_creacion', 'activa']).limit(1).maybeSingle()
      const res = viva
        ? await db.from('cuentas_brasil').update(datos).eq('id', viva.id).select('*').single()
        : await db.from('cuentas_brasil').insert({ user_id: userId, origen: 'manual', ...datos }).select('*').single()
      if (res.error) {
        const dup = String((res.error as any).code) === '23505'
        return json({ ok: false, error: dup ? 'Esa cuenta bancaria ya está asignada a otro cliente.' : res.error.message }, dup ? 409 : 500)
      }
      await auditar(yo.id, 'brasil.cuenta_asignada', { cuentaId: res.data.id, clienteId: userId, banco: f.banco_codigo, agencia: f.agencia, conta: f.conta, reemplazo: viva?.estado === 'activa' })
      await notificarCliente(userId, 'Tu cuenta en Brasil está lista', `Ya puedes recibir PIX en tu cuenta de ${f.banco_nombre}. Mira los datos en tu panel.`, 'success')
      return json({ ok: true, cuenta: res.data })
    }

    const cuentaId = Number(body.cuentaId ?? 0)
    const { data: c } = cuentaId ? await db.from('cuentas_brasil').select('*').eq('id', cuentaId).maybeSingle() : { data: null as any }
    if (!c) return json({ ok: false, error: 'Cuenta no encontrada.' }, 404)
    const ahora = new Date().toISOString()

    if (accion === 'admin_rechazar') {
      if (!['solicitada', 'en_creacion'].includes(c.estado)) return json({ ok: false, error: 'Solo se rechaza una solicitud.' }, 400)
      const nota = String(body.notaCliente ?? '').trim().slice(0, 300)
      if (nota.length < 5) return json({ ok: false, error: 'Escribe el motivo que va a ver el cliente.' }, 400)
      const { data, error } = await db.from('cuentas_brasil').update({ estado: 'rechazada', nota_cliente: nota, actualizado_at: ahora, asignada_por: yo.id }).eq('id', c.id).select('*').single()
      if (error) return json({ ok: false, error: error.message }, 500)
      await auditar(yo.id, 'brasil.cuenta_rechazada', { cuentaId: c.id, clienteId: c.user_id })
      await notificarCliente(String(c.user_id), 'Solicitud de cuenta en Brasil', `No pudimos abrir tu cuenta en Brasil: ${nota}`)
      return json({ ok: true, cuenta: data })
    }

    if (accion === 'admin_suspender') {
      if (c.estado !== 'activa') return json({ ok: false, error: 'Solo se suspende una cuenta activa.' }, 400)
      const { data, error } = await db.from('cuentas_brasil').update({ estado: 'suspendida', actualizado_at: ahora, nota_interna: String(body.notaInterna ?? c.nota_interna ?? '').slice(0, 500) || null }).eq('id', c.id).select('*').single()
      if (error) return json({ ok: false, error: error.message }, 500)
      await auditar(yo.id, 'brasil.cuenta_suspendida', { cuentaId: c.id, clienteId: c.user_id })
      await notificarCliente(String(c.user_id), 'Tu cuenta en Brasil está en pausa', 'No envíes PIX a esa cuenta hasta nuevo aviso. Escríbenos a soporte si tienes dudas.')
      return json({ ok: true, cuenta: data })
    }

    if (accion === 'admin_reactivar') {
      if (c.estado !== 'suspendida') return json({ ok: false, error: 'Solo se reactiva una cuenta suspendida.' }, 400)
      const { data, error } = await db.from('cuentas_brasil').update({ estado: 'activa', actualizado_at: ahora }).eq('id', c.id).select('*').single()
      if (error) {
        const dup = String((error as any).code) === '23505'
        return json({ ok: false, error: dup ? 'El cliente ya tiene otra cuenta viva, o esos datos bancarios ya están asignados a otro.' : error.message }, dup ? 409 : 500)
      }
      await auditar(yo.id, 'brasil.cuenta_reactivada', { cuentaId: c.id, clienteId: c.user_id })
      await notificarCliente(String(c.user_id), 'Tu cuenta en Brasil está activa de nuevo', 'Ya puedes volver a recibir PIX en tu cuenta.', 'success')
      return json({ ok: true, cuenta: data })
    }

    if (accion === 'admin_crear_api') {
      if (c.estado !== 'solicitada') return json({ ok: false, error: 'Solo se crea por API una cuenta solicitada.' }, 400)
      if (!PROXY_URL || !PROXY_SECRET) return json({ ok: false, error: 'proxy_no_configurado', message: 'Falta conectar el proxy: GOWD_PROXY_URL y GOWD_PROXY_SECRET en los secretos de Supabase.' }, 503)
      const r = await crearEnGowd(c)
      return json(r, 501)
    }

    return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500)
  }
})
