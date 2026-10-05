// ══════════════════════════════════════════════════════════════════
//  gowd — cuentas en Brasil (PIX · BRL) para los clientes de Lincoin
//
//  La cuenta la abre nuestro aliado en Brasil y la asignamos a un cliente.
//  Todo queda en public.cuentas_brasil y solo esta función la escribe.
//
//  DOS CAMINOS PARA QUE UN CLIENTE TENGA CUENTA
//    · Manual: el aliado entrega los datos de una cuenta ya abierta y un
//      admin la asigna desde la ficha del cliente (admin_asignar).
//    · Sección Gowd del admin (admin_gowd_*): se abre la cuenta en Gowd por
//      su API Banking (solicitud, documentos, aprobación, llaves PIX) y ya
//      abierta se asigna a un cliente. Desde ahí mismo: cobros con QR, envíos
//      PIX/TED, reembolsos, extracto, reclamos de llave, cierre, MED y la
//      configuración del webhook. Todo queda en gowd_cuentas y
//      gowd_operaciones.
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

// Igual que llamarProxy, pero con el cuerpo en bytes y su content-type
// (multipart para subir documentos). El proxy lo reenvía sin tocarlo.
async function llamarProxyCrudo(metodo: string, ruta: string, cuerpo: Uint8Array, contentType: string, idempotencia?: string) {
  if (!PROXY_URL || !PROXY_SECRET) return { status: 0, data: { error: 'proxy_no_configurado' } as any }
  try {
    const r = await fetch(PROXY_URL, {
      method: metodo,
      headers: { 'content-type': contentType, 'x-proxy-secret': PROXY_SECRET, 'x-gowd-path': ruta, ...(idempotencia ? { 'idempotency-key': idempotencia } : {}) },
      body: cuerpo,
      signal: AbortSignal.timeout(60000),
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

// ── Cuentas Banking de Gowd (documentación "Gowd Platform API") ───────
//   POST /order/v1/banking/accounts                 crear la solicitud
//   POST /order/v1/banking/accounts/documents       subir un documento (multipart)
//   GET  /order/v1/banking/accounts/requests/{id}   estado de la solicitud
//   GET  /order/v1/banking/accounts/{id}            datos de la cuenta abierta
//   GET  /order/v1/banking/accounts                 listar (para importar)
//   GET/POST /order/v1/banking/accounts/{id}/keys   llaves PIX
//   GET  /order/v1/banking/accounts/terms           contrato vigente
// Las cuentas se crean en Gowd y quedan en public.gowd_cuentas; asignar una
// a un cliente la copia a cuentas_brasil, que es lo que ve el cliente.
const DOCS_POR_TIPO: Record<string, string[]> = {
  // Persona: exactamente estos tres (su documentación: cualquier otro tipo se rechaza).
  INDIVIDUAL: ['documentHolder', 'selfieHolder', 'pepDeclaration'],
  ORGANIZATION: ['socialContract', 'cnpjCard', 'balanceSheet', 'partnerProofAddress', 'documentRepresentative', 'selfieRepresentative', 'accountTerms', 'proofAddress', 'proofBankAddress', 'ir', 'kyc', 'pepDeclaration', 'incomeStatement'],
}
const errorGowd = (r: { status: number; data: any }) => {
  const d = r.data ?? {}
  if (d.error === 'proxy_no_configurado') return 'Falta conectar Gowd: GOWD_PROXY_URL y GOWD_PROXY_SECRET en los secretos de Supabase.'
  const det = Array.isArray(d.details) && d.details.length ? ` · ${d.details.map((x: any) => `${x.field ?? '?'}: ${x.description ?? x.issue ?? ''}`).join(' · ')}` : ''
  const msg = d.message ?? (Array.isArray(d) ? d.join(' · ') : null) ?? d.error ?? d.texto ?? ''
  return `Gowd respondió ${r.status || 'sin conexión'}${msg ? `: ${msg}` : ''}${det}${d.desenlaceDesconocido ? ' (no se sabe si se procesó: consulta antes de reintentar)' : ''}`.slice(0, 900)
}
const okGowd = (r: { status: number }) => r.status >= 200 && r.status < 300
const tipoLlave: Record<string, string> = { CPF: 'cpf', CNPJ: 'cnpj', EMAIL: 'email', PHONE: 'telefone', RANDOM: 'aleatoria', EVP: 'aleatoria' }

const URL_WEBHOOK = 'https://lincoin.me/webhooks/gowd'

async function cuentaGowd(id: unknown): Promise<any> {
  const n = Number(id ?? 0)
  if (!n) return null
  const { data } = await db.from('gowd_cuentas').select('*').eq('id', n).maybeSingle()
  return data ?? null
}

// Montos como texto con dos decimales, sin pasar por float: "50" → "50.00".
function montoBRL(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(',', '.')
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null
  const [ent, dec = ''] = s.split('.')
  const r = `${String(Number(ent))}.${(dec + '00').slice(0, 2)}`
  return r === '0.00' ? null : r
}

// La llave de idempotencia la genera el panel al abrir el formulario: un
// doble clic o un reintento manda la misma y Gowd no repite la operación.
const idemDe = (v: unknown) => /^[A-Za-z0-9-]{8,64}$/.test(String(v ?? '')) ? String(v) : crypto.randomUUID()

// Anota la operación ANTES de mandarla: si la misma llave ya está, no se
// vuelve a mandar y se devuelve lo que hay.
async function anotarOperacion(fila: Record<string, unknown>): Promise<{ nueva: boolean; op: any; error?: string }> {
  const { data, error } = await db.from('gowd_operaciones').insert(fila).select('*').single()
  if (!error) return { nueva: true, op: data }
  if (String((error as any).code) === '23505') {
    const { data: ya } = await db.from('gowd_operaciones').select('*').eq('idempotencia', String(fila.idempotencia)).maybeSingle()
    return { nueva: false, op: ya }
  }
  return { nueva: false, op: null, error: /does not exist|schema cache/i.test(error.message) ? 'Falta correr la migración 2026_gowd_cuentas.sql en Supabase.' : error.message }
}
async function cerrarOperacion(op: any, r: { status: number; data: any }) {
  const ok = okGowd(r)
  const d = r.data ?? {}
  await db.from('gowd_operaciones').update({
    gowd_id: ok ? (d.id ?? d.referenceId ?? d.closeAccountRequestId ?? null) : null,
    estado: ok ? (d.status ?? 'CREADA') : (d.desenlaceDesconocido ? 'DESCONOCIDO' : 'RECHAZADA'),
    end_to_end: d.endToEndId ?? null,
    respuesta: ok ? d : { error: errorGowd(r), http: r.status },
    actualizado_at: new Date().toISOString(),
  }).eq('id', op.id)
}

// Quien recibe (envíos): {name, document {type, number}}, como sus ejemplos.
function receptorDe(x: any): { ok: true; v: any } | { ok: false; error: string } | null {
  if (!x || !String(x.nombre ?? '').trim()) return null
  const tipo = String(x.docTipo ?? '').toUpperCase()
  const num = digitos(x.docNumero)
  if (!documentoValido(tipo, num)) return { ok: false, error: `El ${tipo || 'documento'} de quien recibe no es válido.` }
  return { ok: true, v: { name: String(x.nombre).trim().slice(0, 140), document: { type: tipo, number: num } } }
}

// Trae de Gowd el estado de la solicitud y, si ya hay cuenta, sus datos
// bancarios y llaves PIX. Guarda todo en gowd_cuentas.
async function refrescarGowd(fila: any): Promise<{ ok: boolean; fila?: any; error?: string }> {
  const cambios: Record<string, unknown> = { actualizado_at: new Date().toISOString() }
  let accountId: string | null = fila.account_id ?? null
  if (fila.solicitud_id) {
    const r = await llamarProxy('GET', `/order/v1/banking/accounts/requests/${encodeURIComponent(fila.solicitud_id)}`)
    if (!okGowd(r)) return { ok: false, error: errorGowd(r) }
    const d = r.data ?? {}
    Object.assign(cambios, {
      estado_solicitud: d.status ?? null, paso: d.step ?? null,
      faltan: Array.isArray(d.missingRequiredDocuments) ? d.missingRequiredDocuments : null,
      motivo: d.reprovedReason ? `${d.reprovedReason}${d.reprovedDescription ? `: ${d.reprovedDescription}` : ''}${Array.isArray(d.reprovedFields) && d.reprovedFields.length ? ` (reenviar: ${d.reprovedFields.join(', ')})` : ''}` : null,
      ultima_respuesta: d,
    })
    if (d.accountId) accountId = String(d.accountId)
  }
  if (accountId) {
    cambios.account_id = accountId
    const r = await llamarProxy('GET', `/order/v1/banking/accounts/${encodeURIComponent(accountId)}`)
    if (okGowd(r)) {
      const a = r.data ?? {}
      const b = a.bankAccountData ?? {}
      Object.assign(cambios, {
        estado_cuenta: a.status ?? null,
        ispb: b.ispb ?? null, banco: b.bankNumber ?? null, agencia: b.branchNumber ?? null,
        conta: b.accountNumber ?? null, conta_tipo: b.accountType ?? null,
      })
      if (!fila.titular && a.fullName) cambios.titular = a.fullName
    }
    const k = await llamarProxy('GET', `/order/v1/banking/accounts/${encodeURIComponent(accountId)}/keys`)
    if (okGowd(k)) cambios.llaves = Array.isArray(k.data?.data) ? k.data.data.map((x: any) => ({ id: x.id, type: x.type, key: x.key })) : null
  }
  const { data, error } = await db.from('gowd_cuentas').update(cambios).eq('id', fila.id).select('*').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, fila: data }
}

// La ficha del cliente ya no crea por API: las cuentas se abren en la
// sección Gowd (admin_gowd_crear), que pide los datos del titular, los
// documentos y la aceptación del contrato que la solicitud exige.
async function crearEnGowd(_cuenta: any): Promise<{ ok: false; error: string; message: string }> {
  return {
    ok: false,
    error: 'usar_seccion_gowd',
    message: 'Las cuentas se abren desde Admin → Gowd → Nueva cuenta (piden datos del titular y documentos). Ya abierta, asígnala a este cliente desde ahí.',
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

    // ── Sección Gowd: lectura ──
    if (accion === 'admin_gowd_resumen') {
      const { data, error } = await db.from('gowd_cuentas').select('*').order('creada_at', { ascending: false }).limit(500)
      if (error) {
        const falta = /does not exist|schema cache/i.test(error.message)
        return json({ ok: false, error: falta ? 'Falta correr la migración 2026_gowd_cuentas.sql en Supabase.' : error.message }, falta ? 424 : 500)
      }
      const ids = [...new Set((data ?? []).map((c: any) => c.user_id).filter(Boolean).map(String))]
      const { data: us } = ids.length ? await db.from('users').select('id, email, full_name, company_name').in('id', ids) : { data: [] as any[] }
      const porId: Record<string, any> = {}
      for (const u of (us ?? []) as any[]) porId[String(u.id)] = { email: u.email, nombre: u.company_name || u.full_name }
      let saldo: any = null
      if (PROXY_URL && PROXY_SECRET && body.conSaldo) {
        const r = await llamarProxy('GET', '/order/v2/account/balance')
        saldo = okGowd(r) ? r.data : { error: errorGowd(r) }
      }
      return json({
        ok: true, puedeEscribir: acceso.rol === 'dueno' || acceso.rol === 'operaciones',
        proxyConfigurado: !!(PROXY_URL && PROXY_SECRET), saldo,
        cuentas: (data ?? []).map((c: any) => ({ ...c, cliente: c.user_id ? porId[String(c.user_id)] ?? null : null })),
      })
    }

    if (accion === 'admin_gowd_terminos') {
      const ht = String(body.holderType ?? '').toUpperCase()
      if (!['INDIVIDUAL', 'ORGANIZATION'].includes(ht)) return json({ ok: false, error: 'Tipo de titular inválido.' }, 400)
      const r = await llamarProxy('GET', `/order/v1/banking/accounts/terms?holderType=${ht}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, terminos: { fileName: r.data?.fileName, url: r.data?.url, expiresAt: r.data?.expiresAt, publishedAt: r.data?.publishedAt } })
    }

    // Lecturas que no tocan dinero ni datos: cualquier admin con Brasil.
    if (accion === 'admin_gowd_clientes') {
      const q = String(body.q ?? '').trim().replace(/[%,()]/g, ' ').slice(0, 60)
      let consulta = db.from('users').select('id, email, full_name, company_name, tax_id, kyc_status').eq('role', 'business').limit(20)
      if (q) consulta = consulta.or(`company_name.ilike.%${q}%,full_name.ilike.%${q}%,email.ilike.%${q}%,tax_id.ilike.%${q}%`)
      const { data, error } = await consulta
      if (error) return json({ ok: false, error: error.message }, 500)
      const ids = (data ?? []).map((u: any) => String(u.id))
      const { data: vivas } = ids.length ? await db.from('cuentas_brasil').select('user_id').in('user_id', ids).eq('estado', 'activa') : { data: [] as any[] }
      const conCuenta = new Set((vivas ?? []).map((v: any) => String(v.user_id)))
      return json({ ok: true, clientes: (data ?? []).map((u: any) => ({ id: u.id, email: u.email, nombre: u.company_name || u.full_name, nit: u.tax_id, kyc: u.kyc_status, tieneCuentaBrasil: conCuenta.has(String(u.id)) })) })
    }

    if (accion === 'admin_gowd_operaciones') {
      let q = db.from('gowd_operaciones').select('*').order('creada_at', { ascending: false }).limit(200)
      if (body.gowdId) q = q.eq('gowd_cuenta_id', Number(body.gowdId))
      if (body.tipo) q = q.eq('tipo', String(body.tipo))
      const { data, error } = await q
      if (error) return json({ ok: false, error: /does not exist|schema cache/i.test(error.message) ? 'Falta correr la migración 2026_gowd_cuentas.sql en Supabase.' : error.message }, 500)
      return json({ ok: true, operaciones: data ?? [] })
    }

    if (accion === 'admin_gowd_saldo') {
      const r = await llamarProxy('GET', '/order/v2/account/balance')
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, saldo: r.data })
    }

    if (accion === 'admin_gowd_saldo_titulares') {
      const tipo = String(body.accountType ?? 'PAYMENT').toUpperCase()
      if (!['ADMINISTRATIVE', 'RESERVE', 'ADMINISTRATIVE_OUT', 'PAYMENT', 'GUARANTEED_LIMIT'].includes(tipo)) return json({ ok: false, error: 'Tipo de cuenta inválido.' }, 400)
      const r = await llamarProxy('GET', `/account/v1/holder/company/balance?accountType=${tipo}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, datos: r.data })
    }

    if (accion === 'admin_gowd_extracto') {
      const g = await cuentaGowd(body.gowdId)
      if (!g?.account_id) return json({ ok: false, error: 'La cuenta todavía no está abierta en Gowd.' }, 400)
      const p = new URLSearchParams({ currency: 'BRL', limit: String(Math.min(Math.max(Number(body.limite) || 100, 1), 500)), sort: body.orden === 'asc' ? 'asc' : 'desc' })
      const fechaIso = (v: unknown) => /^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v) : null
      const desde = fechaIso(body.desde), hasta = fechaIso(body.hasta)
      if (desde) p.set('startDate', desde.length === 10 ? `${desde}T00:00:00Z` : desde)
      if (hasta) p.set('endDate', hasta.length === 10 ? `${hasta}T23:59:59Z` : hasta)
      if (body.operacion === 'in' || body.operacion === 'out') p.set('operation', body.operacion)
      if (body.endToEndId) p.set('endToEndId', String(body.endToEndId).trim())
      if (body.cursor) p.set('cursor', String(body.cursor))
      if (body.agruparLotes) p.set('mergeBatch', 'true')
      const r = await llamarProxy('GET', `/order/v1/banking/accounts/${encodeURIComponent(g.account_id)}/statements?${p}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, movimientos: r.data?.data ?? [], hasNext: !!r.data?.hasNext, nextCursor: r.data?.nextCursor ?? null })
    }

    if (accion === 'admin_gowd_reclamos') {
      const g = await cuentaGowd(body.gowdId)
      if (!g?.account_id) return json({ ok: false, error: 'La cuenta todavía no está abierta en Gowd.' }, 400)
      const r = await llamarProxy('GET', `/order/v1/banking/accounts/${encodeURIComponent(g.account_id)}/keys/claims`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, reclamos: r.data?.data ?? [] })
    }

    if (accion === 'admin_gowd_consultar') {
      // Estado de un cobro, envío o reembolso preguntándole a Gowd (la API
      // confirma). Si está en nuestro registro, se actualiza.
      let tipo = String(body.tipo ?? '')
      let gid = String(body.ordenId ?? '').trim()
      let ext = String(body.externalId ?? '').trim()
      let op: any = null
      if (body.opId) {
        op = (await db.from('gowd_operaciones').select('*').eq('id', Number(body.opId)).maybeSingle()).data
        if (!op) return json({ ok: false, error: 'Operación no encontrada.' }, 404)
        tipo = op.tipo; gid = op.gowd_id ?? ''; ext = op.external_id ?? ''
      }
      const ruta = tipo === 'cobro' ? 'order-payins' : tipo === 'envio' ? 'order-payouts' : tipo === 'reembolso' ? 'order-refunds' : ''
      if (!ruta) return json({ ok: false, error: 'Se consultan cobros, envíos o reembolsos.' }, 400)
      if (!gid && !(tipo === 'cobro' && ext)) return json({ ok: false, error: 'Falta el id de Gowd.' }, 400)
      const r = await llamarProxy('GET', `/order/v1/banking/${ruta}/${encodeURIComponent(gid || ext)}${tipo === 'cobro' && ext ? `?externalId=${encodeURIComponent(ext)}` : ''}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      if (op) {
        await db.from('gowd_operaciones').update({ estado: r.data?.status ?? op.estado, end_to_end: r.data?.endToEndId ?? op.end_to_end, respuesta: r.data, actualizado_at: new Date().toISOString() }).eq('id', op.id)
      }
      return json({ ok: true, orden: r.data })
    }

    if (accion === 'admin_gowd_cierres') {
      const r = await llamarProxy('POST', '/order/v1/banking/accounts/close-requests/paged/list', { skip: Math.max(Number(body.skip) || 0, 0), take: Math.min(Math.max(Number(body.take) || 50, 1), 100), requireTotalCount: true })
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, cierres: r.data?.data ?? [], total: r.data?.totalCount ?? null })
    }

    if (accion === 'admin_gowd_cierre_ver') {
      const id = String(body.cierreId ?? '').trim()
      if (!id) return json({ ok: false, error: 'Falta el id de la solicitud de cierre.' }, 400)
      const r = await llamarProxy('GET', `/order/v1/banking/accounts/close-requests/${encodeURIComponent(id)}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, cierre: r.data })
    }

    if (accion === 'admin_gowd_med_listar') {
      const p = new URLSearchParams({ page: String(Math.max(Number(body.pagina) || 1, 1)), limit: '50' })
      if (body.gowdId) {
        const g = await cuentaGowd(body.gowdId)
        if (g?.account_id) p.set('accountId', g.account_id)
      }
      if (body.soloPendientes) p.set('onlyPending', 'true')
      if (body.rol === 'PAYER' || body.rol === 'RECEIVER') p.set('role', body.rol)
      const r = await llamarProxy('GET', `/order/v1/banking/med?${p}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, casos: r.data?.data ?? [], total: r.data?.total ?? null, hasNext: !!r.data?.hasNext })
    }

    if (accion === 'admin_gowd_med_ver') {
      const id = String(body.referenceId ?? '').trim()
      if (!id) return json({ ok: false, error: 'Falta el id del caso.' }, 400)
      const r = await llamarProxy('GET', `/order/v1/banking/med/${encodeURIComponent(id)}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, caso: r.data })
    }

    if (accion === 'admin_gowd_webhook_ver') {
      const r = await llamarProxy('GET', '/order/v1/webhook')
      const { data: sec } = await db.from('gowd_config').select('actualizado_at').eq('clave', 'webhook_secret').maybeSingle()
      return json({
        ok: true, urlNuestra: URL_WEBHOOK,
        config: okGowd(r) ? r.data : null, errorConfig: okGowd(r) ? null : (r.status === 404 ? 'Todavía no hay webhook configurado en Gowd.' : errorGowd(r)),
        secretoGuardadoAt: sec?.actualizado_at ?? null, secretoEnSupabase: !!(Deno.env.get('GOWD_WEBHOOK_SECRET') ?? '').trim(),
      })
    }

    if (accion === 'admin_gowd_webhook_eventos') {
      const p = new URLSearchParams({ limit: '50', sort: 'desc' })
      if (body.cursor) p.set('cursor', String(body.cursor))
      const r = await llamarProxy('GET', `/order/v1/webhook/events?${p}`)
      if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
      return json({ ok: true, eventos: r.data?.data ?? [], hasNext: !!r.data?.hasNext, nextCursor: r.data?.nextCursor ?? null })
    }

    if (accion === 'admin_gowd_recibidos') {
      // Lo que llegó a nuestro webhook (tabla gowd_eventos), sin cabeceras.
      const { data, error } = await db.from('gowd_eventos').select('id, recibido_at, verificado, metodo_auth, evento, estado, tipo, orden_id, orden_code, monto_valor, monto_moneda, end_to_end').order('id', { ascending: false }).limit(100)
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true, recibidos: data ?? [] })
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

    // ── Sección Gowd: escritura ──
    if (accion === 'admin_gowd_crear') {
      if (!PROXY_URL || !PROXY_SECRET) return json({ ok: false, error: errorGowd({ status: 0, data: { error: 'proxy_no_configurado' } }) })
      const ht = String(body.holderType ?? '').toUpperCase()
      const doc = digitos(body.documento)
      const t = {
        fullName: String(body.fullName ?? '').trim().slice(0, 140),
        email: String(body.email ?? '').trim().slice(0, 140),
        phone: String(body.phone ?? '').replace(/[^\d+]/g, ''),
        birthdate: String(body.birthdate ?? '').trim(),
        alias: String(body.alias ?? '').trim().slice(0, 60),
      }
      const dir = body.direccion ?? {}
      const reps: any[] = Array.isArray(body.representantes) ? body.representantes : []
      const errores: string[] = []
      if (!['INDIVIDUAL', 'ORGANIZATION'].includes(ht)) errores.push('tipo de titular')
      if (ht === 'INDIVIDUAL' && !(t.fullName.split(/\s+/).length >= 2)) errores.push('nombre completo (nombre y apellido)')
      if (ht === 'ORGANIZATION' && t.fullName.length < 3) errores.push('razón social')
      if (!(ht === 'ORGANIZATION' ? cnpjValido(doc) : cpfValido(doc))) errores.push(ht === 'ORGANIZATION' ? 'CNPJ válido' : 'CPF válido')
      if (!/^\S+@\S+\.\S+$/.test(t.email)) errores.push('correo')
      if (!/^\+\d{10,15}$/.test(t.phone)) errores.push('teléfono con indicativo (+55…)')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.birthdate)) errores.push(ht === 'ORGANIZATION' ? 'fecha de constitución' : 'fecha de nacimiento')
      for (const k of ['zipCode', 'street', 'number', 'neighborhood', 'city', 'state']) if (!String(dir[k] ?? '').trim()) errores.push(`dirección: ${k}`)
      if (ht === 'ORGANIZATION' && !reps.length) errores.push('al menos un representante legal')
      if (!body.terminosAceptados) errores.push('aceptación de los términos por el titular')
      if (errores.length) return json({ ok: false, error: `Revisa: ${errores.join(', ')}.` }, 400)

      // El contrato vigente: su fileName va en la solicitud y el mismo
      // archivo se sube como documento accountTerms.
      const rt = await llamarProxy('GET', `/order/v1/banking/accounts/terms?holderType=${ht}`)
      if (!okGowd(rt)) return json({ ok: false, error: `No se pudo traer el contrato vigente — ${errorGowd(rt)}` })
      const terminos = { fileName: String(rt.data?.fileName ?? ''), url: String(rt.data?.url ?? '') }

      // ESTRUCTURA DE document / address / representatives / acceptance:
      // la documentación impresa no expande esos objetos. Se arma con los
      // nombres que usan sus propios ejemplos (document {type, number};
      // representantes {country, fullName, email, phone, birthdate,
      // documentNumber}). Si Gowd espera otros nombres, responde 400 con el
      // campo exacto (details[].field) y no se crea nada.
      const cuerpo: Record<string, unknown> = {
        country: 'BRA', holderType: ht, fullName: t.fullName, email: t.email, phone: t.phone, birthdate: t.birthdate,
        document: { type: ht === 'ORGANIZATION' ? 'CNPJ' : 'CPF', number: doc },
        address: {
          zipCode: digitos(dir.zipCode), street: String(dir.street).trim(), number: String(dir.number).trim(),
          ...(String(dir.complement ?? '').trim() ? { complement: String(dir.complement).trim() } : {}),
          neighborhood: String(dir.neighborhood).trim(), city: String(dir.city).trim(), state: String(dir.state).trim().toUpperCase().slice(0, 2), country: 'BRA',
        },
        ...(ht === 'ORGANIZATION' ? { representatives: reps.map((r: any) => ({
          country: 'BRA', fullName: String(r.fullName ?? '').trim(), email: String(r.email ?? '').trim(),
          phone: String(r.phone ?? '').replace(/[^\d+]/g, ''), birthdate: String(r.birthdate ?? '').trim(), documentNumber: digitos(r.documentNumber),
        })) } : {}),
        ...(t.alias ? { alias: t.alias } : {}),
        acceptance: { fileName: terminos.fileName },
      }
      const idem = crypto.randomUUID()
      const { data: fila, error: e1 } = await db.from('gowd_cuentas').insert({
        idempotencia: idem, holder_type: ht, titular: t.fullName, documento: doc, alias: t.alias || null,
        email: t.email, telefono: t.phone, datos_enviados: cuerpo, creada_por: yo.id, estado_solicitud: 'ENVIANDO',
      }).select('*').single()
      if (e1) return json({ ok: false, error: /does not exist|schema cache/i.test(e1.message) ? 'Falta correr la migración 2026_gowd_cuentas.sql en Supabase.' : e1.message }, 500)

      const r = await llamarProxy('POST', '/order/v1/banking/accounts', cuerpo, idem)
      if (!okGowd(r) || !r.data?.accountRequestId) {
        const err = errorGowd(r)
        await db.from('gowd_cuentas').update({ estado_solicitud: r.data?.desenlaceDesconocido ? 'DESCONOCIDO' : 'ERROR', motivo: err, ultima_respuesta: r.data, actualizado_at: new Date().toISOString() }).eq('id', fila.id)
        await auditar(yo.id, 'gowd.solicitud_fallida', { gowdId: fila.id, status: r.status })
        return json({ ok: false, error: err })
      }
      await db.from('gowd_cuentas').update({ solicitud_id: String(r.data.accountRequestId), estado_solicitud: r.data.status ?? 'PENDING', ultima_respuesta: r.data, motivo: null, actualizado_at: new Date().toISOString() }).eq('id', fila.id)
      await auditar(yo.id, 'gowd.solicitud_creada', { gowdId: fila.id, solicitudId: r.data.accountRequestId, holderType: ht, alias: t.alias || null })

      // El contrato, tal cual lo entregó Gowd, como documento accountTerms.
      // Solo empresa: a una solicitud de persona Gowd no le acepta ese tipo.
      let avisoTerminos = ''
      if (ht === 'ORGANIZATION') try {
        const f = await fetch(terminos.url, { signal: AbortSignal.timeout(20000) })
        if (!f.ok) throw new Error(`HTTP ${f.status}`)
        const bytes = new Uint8Array(await f.arrayBuffer())
        const fd = new FormData()
        fd.append('file', new Blob([bytes], { type: f.headers.get('content-type') ?? 'application/pdf' }), terminos.fileName || 'account-terms.pdf')
        fd.append('documentType', 'accountTerms')
        fd.append('accountRequestId', String(r.data.accountRequestId))
        const req = new Request('http://x', { method: 'POST', body: fd })
        const up = await llamarProxyCrudo('POST', '/order/v1/banking/accounts/documents', new Uint8Array(await req.arrayBuffer()), req.headers.get('content-type') ?? 'multipart/form-data')
        if (!okGowd(up)) avisoTerminos = `No se pudo adjuntar el contrato: ${errorGowd(up)}. Súbelo como "accountTerms".`
      } catch (e) { avisoTerminos = `No se pudo adjuntar el contrato (${(e as Error).message}). Súbelo como "accountTerms".` }

      const fr = await db.from('gowd_cuentas').select('*').eq('id', fila.id).single()
      const ref = fr.data ? await refrescarGowd(fr.data) : { ok: false }
      return json({ ok: true, cuenta: (ref as any).fila ?? fr.data, aviso: avisoTerminos || null })
    }

    if (accion.startsWith('admin_gowd_')) {
      const g: any = await cuentaGowd(body.gowdId)
      const SIN_CUENTA = ['admin_gowd_importar', 'admin_gowd_reembolso', 'admin_gowd_med_cancelar', 'admin_gowd_webhook_rotar', 'admin_gowd_webhook_guardar', 'admin_gowd_webhook_apuntar', 'admin_gowd_webhook_reenviar', 'admin_gowd_sandbox_estado']
      if (!g && !SIN_CUENTA.includes(accion)) return json({ ok: false, error: 'Cuenta de Gowd no encontrada.' }, 404)

      if (accion === 'admin_gowd_refrescar') {
        const r = await refrescarGowd(g)
        return json(r.ok ? { ok: true, cuenta: r.fila } : { ok: false, error: r.error })
      }

      if (accion === 'admin_gowd_documento') {
        if (!g.solicitud_id) return json({ ok: false, error: 'Esta cuenta no tiene solicitud en Gowd.' }, 400)
        const tipo = String(body.documentType ?? '')
        if (!(DOCS_POR_TIPO[g.holder_type] ?? []).includes(tipo)) return json({ ok: false, error: `Ese documento no aplica a ${g.holder_type === 'ORGANIZATION' ? 'empresa' : 'persona'}.` }, 400)
        const b64 = String(body.archivoBase64 ?? '')
        const mime = String(body.mime ?? '')
        if (!['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(mime)) return json({ ok: false, error: 'Formato no admitido: PDF, PNG o JPG.' }, 400)
        if (/^selfie/.test(tipo) && mime === 'application/pdf') return json({ ok: false, error: 'La selfie tiene que ser una foto (PNG o JPG).' }, 400)
        let bytes: Uint8Array
        try { bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)) } catch { return json({ ok: false, error: 'Archivo ilegible.' }, 400) }
        if (!bytes.length || bytes.length > 10 * 1024 * 1024) return json({ ok: false, error: 'El archivo debe pesar hasta 10 MB.' }, 400)
        const fd = new FormData()
        fd.append('file', new Blob([bytes], { type: mime }), String(body.nombre ?? 'documento').slice(0, 120))
        fd.append('documentType', tipo)
        fd.append('accountRequestId', String(g.solicitud_id))
        if (body.append === false) fd.append('append', 'false')
        const req = new Request('http://x', { method: 'POST', body: fd })
        const up = await llamarProxyCrudo('POST', '/order/v1/banking/accounts/documents', new Uint8Array(await req.arrayBuffer()), req.headers.get('content-type') ?? 'multipart/form-data')
        if (!okGowd(up)) return json({ ok: false, error: errorGowd(up) })
        await auditar(yo.id, 'gowd.documento_subido', { gowdId: g.id, documentType: tipo })
        const { data } = await db.from('gowd_cuentas').update({ faltan: Array.isArray(up.data?.missingRequiredDocuments) ? up.data.missingRequiredDocuments : g.faltan, actualizado_at: new Date().toISOString() }).eq('id', g.id).select('*').single()
        return json({ ok: true, cuenta: data })
      }

      if (accion === 'admin_gowd_importar') {
        let cursor: string | null = null
        let n = 0
        for (let vuelta = 0; vuelta < 10; vuelta++) {
          const r = await llamarProxy('GET', `/order/v1/banking/accounts?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
          if (!okGowd(r)) return json({ ok: false, error: errorGowd(r), importadas: n })
          const lista: any[] = Array.isArray(r.data?.data) ? r.data.data : []
          for (const a of lista) {
            if (!a?.id) continue
            const b = a.bankAccountData ?? {}
            const datos = {
              account_id: String(a.id), holder_type: ['INDIVIDUAL', 'ORGANIZATION'].includes(a.holderType) ? a.holderType : 'ORGANIZATION',
              titular: String(a.fullName ?? '—'), documento: digitos(a.document?.number ?? a.document?.documentNumber ?? ''),
              email: a.email ?? null, telefono: a.phone ?? null, estado_cuenta: a.status ?? null,
              ispb: b.ispb ?? null, banco: b.bankNumber ?? null, agencia: b.branchNumber ?? null, conta: b.accountNumber ?? null, conta_tipo: b.accountType ?? null,
              actualizado_at: new Date().toISOString(),
            }
            const { data: ya } = await db.from('gowd_cuentas').select('id').eq('account_id', datos.account_id).maybeSingle()
            if (ya) await db.from('gowd_cuentas').update(datos).eq('id', ya.id)
            else await db.from('gowd_cuentas').insert({ ...datos, idempotencia: `import-${datos.account_id}`, creada_por: yo.id })
            n++
          }
          if (!r.data?.hasNext || !r.data?.nextCursor) break
          cursor = String(r.data.nextCursor)
        }
        await auditar(yo.id, 'gowd.cuentas_importadas', { cantidad: n })
        return json({ ok: true, importadas: n })
      }

      if (accion === 'admin_gowd_asignar') {
        if (g.user_id) return json({ ok: false, error: 'Esta cuenta ya está asignada. Quítala primero.' }, 409)
        if (!g.account_id || !g.conta || !g.agencia) return json({ ok: false, error: 'Actualízala primero: todavía no tiene los datos bancarios de Gowd.' }, 400)
        if (g.estado_cuenta && g.estado_cuenta !== 'ACTIVE') return json({ ok: false, error: `La cuenta está ${g.estado_cuenta} en Gowd.` }, 400)
        const userId = String(body.userId ?? '')
        const { data: cli } = await db.from('users').select('id, role, company_name, full_name').eq('id', userId).maybeSingle()
        if (!cli) return json({ ok: false, error: 'Cliente no encontrado.' }, 404)
        if (cli.role !== 'business') return json({ ok: false, error: 'La cuenta en Brasil se asigna a cuentas Empresa.' }, 400)
        const llaves: any[] = Array.isArray(g.llaves) ? g.llaves : []
        const llave = llaves.find(x => x?.key) ?? null
        const ahora = new Date().toISOString()
        // Lo que ve el cliente. El nombre del aliado no se muestra: el banco
        // va por su código (677), que es lo que el pagador necesita.
        const datos = {
          titular: g.titular, documento_tipo: g.holder_type === 'ORGANIZATION' ? 'CNPJ' : 'CPF', documento: g.documento,
          banco_nombre: `Banco ${g.banco ?? '677'}`, banco_codigo: String(g.banco ?? '677').padStart(3, '0').slice(-3), ispb: g.ispb,
          agencia: g.agencia, conta: g.conta, conta_tipo: 'pagamento',
          chave_pix: llave?.key ?? null, chave_pix_tipo: llave ? (tipoLlave[String(llave.type)] ?? 'aleatoria') : null,
          gowd_account_id: g.account_id, estado: 'activa', origen: 'api', activada_at: ahora, asignada_por: yo.id,
          actualizado_at: ahora, nota_cliente: null,
        }
        const { data: viva } = await db.from('cuentas_brasil').select('id, estado').eq('user_id', userId).in('estado', ['solicitada', 'en_creacion', 'activa']).limit(1).maybeSingle()
        if (viva?.estado === 'activa') return json({ ok: false, error: 'Ese cliente ya tiene una cuenta en Brasil activa. Suspéndela primero desde su ficha.' }, 409)
        const res = viva
          ? await db.from('cuentas_brasil').update(datos).eq('id', viva.id).select('*').single()
          : await db.from('cuentas_brasil').insert({ user_id: userId, ...datos }).select('*').single()
        if (res.error) {
          const dup = String((res.error as any).code) === '23505'
          return json({ ok: false, error: dup ? 'Esa cuenta bancaria ya está asignada a otro cliente.' : res.error.message }, dup ? 409 : 500)
        }
        await db.from('gowd_cuentas').update({ user_id: userId, asignada_at: ahora, asignada_por: yo.id, actualizado_at: ahora }).eq('id', g.id)
        await auditar(yo.id, 'gowd.cuenta_asignada', { gowdId: g.id, clienteId: userId, cuentaBrasilId: res.data.id })
        await notificarCliente(userId, 'Tu cuenta en Brasil está lista', 'Ya puedes recibir PIX en tu cuenta en Brasil. Mira los datos en tu panel.', 'success')
        return json({ ok: true })
      }

      if (accion === 'admin_gowd_desasignar') {
        if (!g.user_id) return json({ ok: false, error: 'Esta cuenta no está asignada.' }, 400)
        const ahora = new Date().toISOString()
        await db.from('cuentas_brasil').update({ estado: 'suspendida', actualizado_at: ahora, nota_interna: 'Cuenta de Gowd desasignada desde la sección Gowd.' }).eq('user_id', g.user_id).eq('gowd_account_id', g.account_id).eq('estado', 'activa')
        await db.from('gowd_cuentas').update({ user_id: null, asignada_at: null, actualizado_at: ahora }).eq('id', g.id)
        await auditar(yo.id, 'gowd.cuenta_desasignada', { gowdId: g.id, clienteId: g.user_id })
        await notificarCliente(String(g.user_id), 'Tu cuenta en Brasil está en pausa', 'No envíes PIX a esa cuenta hasta nuevo aviso. Escríbenos a soporte si tienes dudas.')
        return json({ ok: true })
      }

      // ── Llaves PIX ──
      const rutaCuenta = g?.account_id ? `/order/v1/banking/accounts/${encodeURIComponent(g.account_id)}` : ''
      const exigeCuenta = () => !g?.account_id ? json({ ok: false, error: 'La cuenta todavía no está abierta en Gowd.' }, 400) : null

      if (accion === 'admin_gowd_llave') {
        const sin = exigeCuenta(); if (sin) return sin
        const tipo = String(body.tipo ?? 'RANDOM').toUpperCase()
        if (!['RANDOM', 'CPF', 'CNPJ', 'EMAIL', 'PHONE'].includes(tipo)) return json({ ok: false, error: 'Tipo de llave inválido.' }, 400)
        let key: string | undefined
        if (tipo === 'CPF' || tipo === 'CNPJ') {
          key = digitos(body.key) || g.documento
          if (!documentoValido(tipo, String(key))) return json({ ok: false, error: `El ${tipo} de la llave no es válido.` }, 400)
        } else if (tipo === 'EMAIL') {
          key = String(body.key ?? '').trim().toLowerCase()
          if (!/^\S+@\S+\.\S+$/.test(key)) return json({ ok: false, error: 'Correo inválido.' }, 400)
        } else if (tipo === 'PHONE') {
          key = String(body.key ?? '').replace(/[^\d+]/g, '')
          if (!/^\+55\d{10,11}$/.test(key)) return json({ ok: false, error: 'Teléfono de Brasil con +55 y DDD.' }, 400)
        }
        const cuerpoK: Record<string, unknown> = { type: tipo, ...(key ? { key } : {}), ...(tipo === 'PHONE' && body.canal === 'whatsapp' ? { channel: 'whatsapp' } : {}) }
        const r = await llamarProxy('POST', `${rutaCuenta}/keys`, cuerpoK, crypto.randomUUID())
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await auditar(yo.id, 'gowd.llave_creada', { gowdId: g.id, tipo, pendiente: !!r.data?.validationId })
        // Correo y teléfono: Gowd manda un código al titular y la llave queda
        // pendiente hasta confirmarlo.
        if (r.data?.validationId) return json({ ok: true, pendiente: true, validationId: r.data.validationId, expiresAt: r.data.expiresAt ?? null })
        const ref = await refrescarGowd(g)
        return json(ref.ok ? { ok: true, cuenta: ref.fila } : { ok: false, error: ref.error })
      }

      if (accion === 'admin_gowd_llave_confirmar' || accion === 'admin_gowd_llave_reenviar') {
        const sin = exigeCuenta(); if (sin) return sin
        const validationId = String(body.validationId ?? '').trim()
        if (!validationId) return json({ ok: false, error: 'Falta la validación.' }, 400)
        const confirmar = accion === 'admin_gowd_llave_confirmar'
        const token = String(body.token ?? '').trim()
        if (confirmar && !/^\w{4,10}$/.test(token)) return json({ ok: false, error: 'Escribe el código que recibió el titular.' }, 400)
        const r = await llamarProxy('POST', `${rutaCuenta}/keys/${confirmar ? 'confirm' : 'resend'}`, confirmar ? { validationId, token } : { validationId }, crypto.randomUUID())
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        if (!confirmar) return json({ ok: true, expiresAt: r.data?.expiresAt ?? null })
        await auditar(yo.id, 'gowd.llave_confirmada', { gowdId: g.id })
        const ref = await refrescarGowd(g)
        return json(ref.ok ? { ok: true, cuenta: ref.fila } : { ok: false, error: ref.error })
      }

      if (accion === 'admin_gowd_llave_borrar') {
        const sin = exigeCuenta(); if (sin) return sin
        const keyId = String(body.keyId ?? '').trim()
        if (!keyId) return json({ ok: false, error: 'Falta la llave.' }, 400)
        const r = await llamarProxy('DELETE', `${rutaCuenta}/keys/${encodeURIComponent(keyId)}`, undefined, crypto.randomUUID())
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await auditar(yo.id, 'gowd.llave_borrada', { gowdId: g.id, keyId })
        const ref = await refrescarGowd(g)
        // Si era la llave que ve el cliente, se le quita de su cuenta.
        if (g.user_id && ref.ok) {
          const quedan: any[] = Array.isArray(ref.fila?.llaves) ? ref.fila.llaves : []
          const otra = quedan.find(x => x?.key) ?? null
          await db.from('cuentas_brasil').update({ chave_pix: otra?.key ?? null, chave_pix_tipo: otra ? (tipoLlave[String(otra.type)] ?? 'aleatoria') : null, actualizado_at: new Date().toISOString() })
            .eq('user_id', g.user_id).eq('gowd_account_id', g.account_id).eq('estado', 'activa')
        }
        return json(ref.ok ? { ok: true, cuenta: ref.fila } : { ok: false, error: ref.error })
      }

      // ── Reclamos y portabilidad de llaves ──
      if (accion === 'admin_gowd_reclamo_crear') {
        const sin = exigeCuenta(); if (sin) return sin
        const claimType = String(body.claimType ?? '').toUpperCase()
        const tipo = String(body.tipo ?? '').toUpperCase()
        const key = String(body.key ?? '').trim()
        if (!['PORTABILITY', 'CLAIM_OWNERSHIP'].includes(claimType)) return json({ ok: false, error: 'Tipo de reclamo inválido.' }, 400)
        if (!['CPF', 'CNPJ', 'EMAIL', 'PHONE'].includes(tipo)) return json({ ok: false, error: 'Las llaves aleatorias no se reclaman.' }, 400)
        if (!key) return json({ ok: false, error: 'Escribe la llave.' }, 400)
        const r = await llamarProxy('POST', `${rutaCuenta}/keys/claims`, { claimType, type: tipo, key: tipo === 'CPF' || tipo === 'CNPJ' ? digitos(key) : key }, crypto.randomUUID())
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await auditar(yo.id, 'gowd.reclamo_creado', { gowdId: g.id, claimType, tipo })
        return json({ ok: true, ...(r.data ?? {}), pendiente: !!r.data?.validationId })
      }

      if (['admin_gowd_reclamo_confirmar', 'admin_gowd_reclamo_reenviar'].includes(accion)) {
        const sin = exigeCuenta(); if (sin) return sin
        const validationId = String(body.validationId ?? '').trim()
        if (!validationId) return json({ ok: false, error: 'Falta la validación.' }, 400)
        const confirmar = accion === 'admin_gowd_reclamo_confirmar'
        const token = String(body.token ?? '').trim()
        if (confirmar && !token) return json({ ok: false, error: 'Escribe el código.' }, 400)
        const r = await llamarProxy('POST', `${rutaCuenta}/keys/claims/${confirmar ? 'confirm' : 'resend'}`, confirmar ? { validationId, token } : { validationId }, crypto.randomUUID())
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await auditar(yo.id, confirmar ? 'gowd.reclamo_confirmado' : 'gowd.reclamo_codigo_reenviado', { gowdId: g.id })
        return json({ ok: true, ...(r.data ?? {}) })
      }

      if (['admin_gowd_reclamo_cancelar', 'admin_gowd_reclamo_donante_pedir', 'admin_gowd_reclamo_donante_confirmar', 'admin_gowd_reclamo_donante_reenviar'].includes(accion)) {
        const sin = exigeCuenta(); if (sin) return sin
        const claimId = String(body.claimId ?? '').trim()
        if (!claimId) return json({ ok: false, error: 'Falta el reclamo.' }, 400)
        const base = `${rutaCuenta}/keys/claims/${encodeURIComponent(claimId)}`
        let ruta = '', cuerpo: Record<string, unknown> = {}
        if (accion === 'admin_gowd_reclamo_cancelar') ruta = `${base}/cancel`
        else if (accion === 'admin_gowd_reclamo_donante_pedir') ruta = `${base}/confirm-request`
        else if (accion === 'admin_gowd_reclamo_donante_reenviar') { ruta = `${base}/confirm-resend`; cuerpo = { validationId: String(body.validationId ?? '') } }
        else {
          const decision = String(body.decision ?? '').toUpperCase()
          if (!['CONFIRM', 'CANCEL'].includes(decision)) return json({ ok: false, error: 'Decide: liberar la llave o quedártela.' }, 400)
          if (!body.validationId || !body.token) return json({ ok: false, error: 'Falta el código que recibió el titular.' }, 400)
          ruta = `${base}/confirm`; cuerpo = { validationId: String(body.validationId), token: String(body.token).trim(), decision }
        }
        const r = await llamarProxy('POST', ruta, cuerpo, crypto.randomUUID())
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await auditar(yo.id, `gowd.${accion.replace('admin_gowd_', '')}`, { gowdId: g.id, claimId, decision: body.decision ?? null })
        if (accion === 'admin_gowd_reclamo_donante_confirmar') await refrescarGowd(g)
        return json({ ok: true, ...(r.data ?? {}) })
      }

      // ── Cobros (QR dinámico) y QR estático ──
      if (accion === 'admin_gowd_cobro' || accion === 'admin_gowd_qr_estatico') {
        const sin = exigeCuenta(); if (sin) return sin
        const monto = montoBRL(body.monto)
        if (!monto) return json({ ok: false, error: 'Monto inválido (BRL, hasta 2 decimales).' }, 400)
        const descripcion = String(body.descripcion ?? '').trim().slice(0, 140)
        const llaves: any[] = Array.isArray(g.llaves) ? g.llaves : []
        const pixKey = String(body.pixKey ?? '').trim() || (llaves.find(x => x?.key)?.key ?? '')
        const estatico = accion === 'admin_gowd_qr_estatico'
        if (estatico && !pixKey) return json({ ok: false, error: 'La cuenta no tiene llave PIX. Crea una primero.' }, 400)
        const idem = idemDe(body.idempotencia)
        const externalId = `lc-${estatico ? 'qr' : 'cob'}-${idem.slice(0, 18)}`
        let cuerpo: Record<string, unknown>
        if (estatico) {
          cuerpo = { accountId: g.account_id, pixKey, amount: { currency: 'BRL', value: monto }, ...(descripcion ? { description: descripcion } : {}) }
        } else {
          const exp = Math.min(Math.max(Number(body.expiracionSeg) || 86400, 300), 30 * 86400)
          const pagador = receptorDe(body.pagador)
          if (pagador && !pagador.ok) return json({ ok: false, error: pagador.error }, 400)
          cuerpo = {
            externalId, accountId: g.account_id, paymentMethod: 'PIX', ...(pixKey ? { pixKey } : {}),
            ...(pagador?.ok ? { payer: pagador.v } : {}), amount: { currency: 'BRL', value: monto },
            ...(descripcion ? { description: descripcion } : {}), expiration: exp,
          }
        }
        const an = await anotarOperacion({ tipo: estatico ? 'qr_estatico' : 'cobro', idempotencia: idem, external_id: estatico ? null : externalId, gowd_cuenta_id: g.id, account_id: g.account_id, monto, moneda: 'BRL', descripcion: descripcion || null, datos_enviados: cuerpo, creada_por: yo.id, estado: 'ENVIANDO' })
        if (an.error) return json({ ok: false, error: an.error }, 500)
        if (!an.nueva) return json({ ok: true, repetida: true, operacion: an.op })
        const r = await llamarProxy('POST', `/order/v1/banking/${estatico ? 'pix-static-qrcodes' : 'order-payins'}`, cuerpo, idem)
        await cerrarOperacion(an.op, r)
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await auditar(yo.id, estatico ? 'gowd.qr_estatico' : 'gowd.cobro_creado', { gowdId: g.id, opId: an.op.id, monto })
        return json({ ok: true, qr: { id: r.data?.id, status: r.data?.status ?? null, qrcodeData: r.data?.qrcodeData, qrcodeImageBase64: r.data?.qrcodeImageBase64 ?? r.data?.qrcodeBase64, expireDateTime: r.data?.expireDateTime ?? null, conciliationId: r.data?.conciliationId ?? null } })
      }

      // ── De acá en adelante sale plata o se cierra algo: solo el dueño ──
      const soloDueno = () => acceso.rol !== 'dueno' ? json({ ok: false, error: 'Esta operación la hace solo el dueño.' }, 403) : null

      if (accion === 'admin_gowd_envio') {
        const nd = soloDueno(); if (nd) return nd
        const sin = exigeCuenta(); if (sin) return sin
        if (g.estado_cuenta && g.estado_cuenta !== 'ACTIVE') return json({ ok: false, error: `La cuenta está ${g.estado_cuenta} en Gowd.` }, 400)
        const metodo = String(body.metodo ?? 'PIX').toUpperCase()
        const modo = String(body.modo ?? 'pixKey')
        if (!['PIX', 'TED'].includes(metodo)) return json({ ok: false, error: 'Método: PIX o TED.' }, 400)
        if (metodo === 'TED' && modo !== 'bankAccount') return json({ ok: false, error: 'Por TED solo se envía a una cuenta bancaria (ISPB, agencia, conta).' }, 400)
        const monto = montoBRL(body.monto)
        if (!monto) return json({ ok: false, error: 'Monto inválido (BRL, hasta 2 decimales).' }, 400)
        const descripcion = String(body.descripcion ?? '').trim().slice(0, 140)
        if (descripcion.length < 3) return json({ ok: false, error: 'Escribe una descripción.' }, 400)
        if (!body.confirmado) return json({ ok: false, error: 'Confirma el envío.' }, 400)
        let paymentData: Record<string, unknown>
        if (modo === 'pixKey') {
          const k = String(body.pixKey ?? '').trim()
          if (!k) return json({ ok: false, error: 'Escribe la llave PIX de destino.' }, 400)
          paymentData = { pixKey: k }
        } else if (modo === 'qrcodeData') {
          const q = String(body.qrcodeData ?? '').trim()
          if (!/^000201/.test(q)) return json({ ok: false, error: 'Pega el código PIX copia-e-cola completo.' }, 400)
          paymentData = { qrcodeData: q }
        } else if (modo === 'bankAccount') {
          const b = body.cuenta ?? {}
          const ba = { ispb: digitos(b.ispb), branchNumber: digitos(b.agencia), accountNumber: String(b.conta ?? '').replace(/[^\dXx]/g, ''), accountType: String(b.tipo ?? 'CHECKING_ACCOUNT') }
          if (ba.ispb.length !== 8) return json({ ok: false, error: 'ISPB de 8 dígitos.' }, 400)
          if (!ba.branchNumber || ba.branchNumber.length > 5) return json({ ok: false, error: 'Agência inválida.' }, 400)
          if (ba.accountNumber.length < 2) return json({ ok: false, error: 'Conta inválida.' }, 400)
          if (!['CHECKING_ACCOUNT', 'PAYMENT_ACCOUNT'].includes(ba.accountType)) return json({ ok: false, error: 'Tipo de conta inválido.' }, 400)
          paymentData = { bankAccount: ba }
        } else return json({ ok: false, error: 'Modo de envío inválido.' }, 400)
        const rec = receptorDe(body.receptor)
        if (rec && !rec.ok) return json({ ok: false, error: rec.error }, 400)
        if (modo === 'bankAccount' && !rec?.ok) return json({ ok: false, error: 'Para envíos a cuenta bancaria escribe el nombre y documento de quien recibe.' }, 400)
        const idem = idemDe(body.idempotencia)
        const externalId = `lc-env-${idem.slice(0, 18)}`
        const cuerpo = { externalId, accountId: g.account_id, paymentMethod: metodo, ...(rec?.ok ? { receiver: rec.v } : {}), paymentData, amount: { currency: 'BRL', value: monto }, description: descripcion }
        const an = await anotarOperacion({ tipo: 'envio', idempotencia: idem, external_id: externalId, gowd_cuenta_id: g.id, account_id: g.account_id, monto, moneda: 'BRL', descripcion, datos_enviados: cuerpo, creada_por: yo.id, estado: 'ENVIANDO' })
        if (an.error) return json({ ok: false, error: an.error }, 500)
        if (!an.nueva) return json({ ok: true, repetida: true, operacion: an.op })
        const r = await llamarProxy('POST', '/order/v1/banking/order-payouts', cuerpo, idem)
        await cerrarOperacion(an.op, r)
        await auditar(yo.id, 'gowd.envio', { gowdId: g.id, opId: an.op.id, metodo, modo, monto, status: r.status })
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        return json({ ok: true, envio: r.data })
      }

      if (accion === 'admin_gowd_reembolso') {
        const nd = soloDueno(); if (nd) return nd
        const orderId = String(body.orderId ?? '').trim()
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ ok: false, error: 'Id de la orden (cobro) inválido.' }, 400)
        const monto = montoBRL(body.monto)
        if (!monto) return json({ ok: false, error: 'Monto inválido.' }, 400)
        const refundCode = String(body.refundCode ?? 'RECEIVER_REQUEST').trim().toUpperCase()
        if (!/^[A-Z_]{3,40}$/.test(refundCode)) return json({ ok: false, error: 'Código de reembolso inválido.' }, 400)
        if (!body.confirmado) return json({ ok: false, error: 'Confirma el reembolso.' }, 400)
        const idem = idemDe(body.idempotencia)
        const externalId = `lc-ree-${idem.slice(0, 18)}`
        const motivo = String(body.motivo ?? '').trim().slice(0, 140)
        const descripcion = String(body.descripcion ?? '').trim().slice(0, 140)
        const cuerpo = { orderId, externalId, amount: { currency: 'BRL', value: monto }, refundCode, ...(motivo ? { refundReason: motivo } : {}), ...(descripcion ? { description: descripcion } : {}) }
        const an = await anotarOperacion({ tipo: 'reembolso', idempotencia: idem, external_id: externalId, gowd_cuenta_id: g?.id ?? null, account_id: g?.account_id ?? null, monto, moneda: 'BRL', descripcion: descripcion || motivo || null, datos_enviados: cuerpo, creada_por: yo.id, estado: 'ENVIANDO' })
        if (an.error) return json({ ok: false, error: an.error }, 500)
        if (!an.nueva) return json({ ok: true, repetida: true, operacion: an.op })
        const r = await llamarProxy('POST', '/order/v1/banking/order-refunds', cuerpo, idem)
        await cerrarOperacion(an.op, r)
        await auditar(yo.id, 'gowd.reembolso', { opId: an.op.id, orderId, monto, status: r.status })
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        return json({ ok: true, reembolso: r.data })
      }

      if (accion === 'admin_gowd_cierre_pedir') {
        const nd = soloDueno(); if (nd) return nd
        const sin = exigeCuenta(); if (sin) return sin
        if (g.user_id) return json({ ok: false, error: 'La cuenta está asignada a un cliente. Quítasela primero.' }, 409)
        const motivo = String(body.motivo ?? '').trim().slice(0, 300)
        if (motivo.length < 5) return json({ ok: false, error: 'Escribe el motivo del cierre.' }, 400)
        const idem = crypto.randomUUID()
        const an = await anotarOperacion({ tipo: 'cierre', idempotencia: idem, gowd_cuenta_id: g.id, account_id: g.account_id, descripcion: motivo, datos_enviados: { closeRequestReason: motivo }, creada_por: yo.id, estado: 'ENVIANDO' })
        if (an.error) return json({ ok: false, error: an.error }, 500)
        const r = await llamarProxy('POST', `${rutaCuenta}/close-request`, { closeRequestReason: motivo }, idem)
        await cerrarOperacion(an.op, r)
        await auditar(yo.id, 'gowd.cierre_pedido', { gowdId: g.id, status: r.status })
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        return json({ ok: true, cierre: r.data })
      }

      // ── MED (devolución especial del PIX) ──
      if (accion === 'admin_gowd_med_abrir') {
        const nd = soloDueno(); if (nd) return nd
        const sin = exigeCuenta(); if (sin) return sin
        const e2e = String(body.endToEndId ?? '').trim()
        const situacion = String(body.situationType ?? '').toUpperCase()
        const detalle = String(body.details ?? '').trim().slice(0, 2000)
        if (!/^[A-Za-z0-9]{20,40}$/.test(e2e)) return json({ ok: false, error: 'EndToEndId inválido.' }, 400)
        if (!['SCAM', 'UNAUTHORIZED_TRANSACTION', 'CRIME_OF_COERCION', 'FRAUDULENT_ACCESS_AND_AUTHORIZATION', 'OTHERS', 'UNKNOWN'].includes(situacion)) return json({ ok: false, error: 'Situación inválida.' }, 400)
        if (situacion === 'OTHERS' && !detalle) return json({ ok: false, error: 'Con "Otros" el detalle es obligatorio.' }, 400)
        const idem = crypto.randomUUID()
        const cuerpo = { endToEndId: e2e, situationType: situacion, ...(detalle ? { details: detalle } : {}) }
        const an = await anotarOperacion({ tipo: 'med', idempotencia: idem, gowd_cuenta_id: g.id, account_id: g.account_id, end_to_end: e2e, descripcion: situacion, datos_enviados: cuerpo, creada_por: yo.id, estado: 'ENVIANDO' })
        if (an.error) return json({ ok: false, error: an.error }, 500)
        const r = await llamarProxy('POST', `/order/v1/banking/med/accounts/${encodeURIComponent(g.account_id)}`, cuerpo, idem)
        await cerrarOperacion(an.op, r)
        await auditar(yo.id, 'gowd.med_abierto', { gowdId: g.id, situacion, status: r.status })
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        return json({ ok: true, caso: r.data })
      }

      if (accion === 'admin_gowd_med_cancelar') {
        const nd = soloDueno(); if (nd) return nd
        const ref = String(body.referenceId ?? '').trim()
        if (!ref) return json({ ok: false, error: 'Falta el id del caso.' }, 400)
        const r = await llamarProxy('POST', `/order/v1/banking/med/${encodeURIComponent(ref)}/cancel`, {}, crypto.randomUUID())
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await db.from('gowd_operaciones').update({ estado: r.data?.status ?? 'CANCELED', actualizado_at: new Date().toISOString() }).eq('tipo', 'med').eq('gowd_id', ref)
        await auditar(yo.id, 'gowd.med_cancelado', { referenceId: ref })
        return json({ ok: true, caso: r.data })
      }

      // ── Webhook de Gowd hacia nosotros ──
      if (accion === 'admin_gowd_webhook_rotar') {
        const nd = soloDueno(); if (nd) return nd
        // El secreto nuevo se guarda directo en gowd_config, donde lo lee
        // gowd-webhook. No vuelve al navegador: nadie tiene que copiarlo.
        const r = await llamarProxy('POST', '/order/v1/webhook/rotate-secret', {})
        if (!okGowd(r) || !r.data?.secret) return json({ ok: false, error: okGowd(r) ? 'Gowd no devolvió el secreto.' : errorGowd(r) })
        const { error } = await db.from('gowd_config').upsert({ clave: 'webhook_secret', valor: String(r.data.secret), actualizado_at: new Date().toISOString(), actualizado_por: yo.id })
        await auditar(yo.id, 'gowd.webhook_secreto_rotado', { guardado: !error })
        if (error) return json({ ok: false, error: `Gowd ya cambió el secreto pero no se pudo guardar (${error.message}). Corre la migración y vuelve a rotar.` }, 500)
        return json({ ok: true, guardado: true })
      }

      if (accion === 'admin_gowd_webhook_guardar' || accion === 'admin_gowd_webhook_apuntar') {
        const nd = soloDueno(); if (nd) return nd
        let events: any[]
        if (accion === 'admin_gowd_webhook_guardar') {
          if (!Array.isArray(body.events)) return json({ ok: false, error: 'events debe ser una lista.' }, 400)
          events = body.events
        } else {
          // Toma la configuración actual y cambia cada URL por la nuestra,
          // sin tocar los demás campos (cuyos nombres pone Gowd).
          const cur = await llamarProxy('GET', '/order/v1/webhook')
          if (!okGowd(cur)) return json({ ok: false, error: errorGowd(cur) })
          const lista: any[] = Array.isArray(cur.data?.events) ? cur.data.events : []
          if (!lista.length) return json({ ok: false, error: 'Gowd no tiene eventos configurados para apuntar. Pega la lista en el editor (formato de su colección Postman) o pídele a Gowd que los cree.' }, 400)
          const apuntar = (o: any): any => {
            if (typeof o === 'string') return /^https?:\/\//i.test(o) ? URL_WEBHOOK : o
            if (Array.isArray(o)) return o.map(apuntar)
            if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([k]) => !['createdAt', 'updatedAt'].includes(k)).map(([k, v]) => [k, apuntar(v)]))
            return o
          }
          events = lista.map(apuntar)
        }
        const r = await llamarProxy('PUT', '/order/v1/webhook', { events })
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        await auditar(yo.id, 'gowd.webhook_actualizado', { eventos: events.length })
        return json({ ok: true, config: r.data })
      }

      if (accion === 'admin_gowd_webhook_reenviar') {
        const id = String(body.eventoId ?? '').trim()
        if (!id) return json({ ok: false, error: 'Falta el evento.' }, 400)
        const r = await llamarProxy('POST', `/order/v1/webhook/events/${encodeURIComponent(id)}/resend`, {})
        if (!okGowd(r)) return json({ ok: false, error: errorGowd(r) })
        return json({ ok: true })
      }

      // ── Herramientas del sandbox ──
      if (accion === 'admin_gowd_sandbox_estado') {
        const id = String(body.ordenId ?? '').trim()
        const status = String(body.status ?? '').toUpperCase()
        if (!id) return json({ ok: false, error: 'Falta el id de la orden.' }, 400)
        if (!['PAID', 'REFUNDED', 'EXPIRED', 'CANCELED', 'REJECTED', 'ERROR'].includes(status)) return json({ ok: false, error: 'Estado inválido.' }, 400)
        const r = await llamarProxy('PUT', '/order-tools/v1/order/status', { id, status })
        if (!okGowd(r)) return json({ ok: false, error: r.status === 404 ? 'Solo existe en el sandbox de Gowd.' : errorGowd(r) })
        return json({ ok: true, resultado: r.data })
      }

      return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
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
