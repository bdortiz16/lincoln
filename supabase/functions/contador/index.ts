// ══════════════════════════════════════════════════════════════════
//  contador — acceso de solo lectura a la contabilidad de una empresa
//
//  La empresa, desde Contabilidad, le da acceso a su contador con un correo.
//  Se le crea una cuenta aparte (role = 'contador') atada a la empresa por
//  raw_data.contadorDe. El contador entra por "Empresas → Contabilidad" con
//  su propio correo y contraseña y ve SOLO la contabilidad de esa empresa:
//  movimientos, comprobantes, facturas. Nada de saldos operables, nada de
//  enviar, nada de configurar.
//
//  Por qué pasa por acá y no por RLS: las políticas de transactions y
//  comprobantes son "lo mío". El contador no es el dueño de nada; lo que ve
//  se lo entrega este servidor después de verificar el vínculo, y es solo
//  lectura por construcción: no hay acción de escritura sobre la empresa.
//
//  Acciones (todas con JWT):
//    crear_acceso   {email, nombre, origen}   — la empresa crea al contador
//    listar_accesos {}                        — la empresa ve sus contadores
//    revocar_acceso {contadorId}              — la empresa lo elimina
//    datos          {}                        — el contador pide la contabilidad
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL      = (Deno.env.get('APP_BASE_URL') || 'https://www.lincoin.me').replace(/\/+$/, '')
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Quien = { id: string; email: string; role: string; nombre: string; raw: Record<string, unknown> }

async function quienLlama(req: Request): Promise<Quien | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  const { data: { user }, error } = await db.auth.getUser(jwt)
  if (error || !user) return null
  const { data: fila } = await db.from('users').select('id, email, role, full_name, raw_data').eq('id', user.id).maybeSingle()
  if (!fila) return null
  return { id: String(fila.id), email: String(fila.email ?? user.email ?? ''), role: String(fila.role ?? ''), nombre: String(fila.full_name ?? ''), raw: (fila.raw_data ?? {}) as Record<string, unknown> }
}

// A dónde vuelve el contador desde el correo para ponerse contraseña. Solo
// se acepta el propio dominio: un redirectTo arbitrario sería una puerta
// para mandar el enlace de recuperación a un sitio ajeno.
function origenSeguro(o: unknown): string {
  const s = String(o ?? '').replace(/\/+$/, '')
  try {
    const u = new URL(s)
    const host = u.hostname.toLowerCase()
    if (u.protocol === 'https:' && (host === 'lincoin.me' || host.endsWith('.lincoin.me') || host.endsWith('.vercel.app'))) return `${u.protocol}//${u.host}`
    if (host === 'localhost' || host === '127.0.0.1') return `${u.protocol}//${u.host}`
  } catch { /* sin origen válido */ }
  return APP_URL
}

const correoValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)

async function contadoresDe(empresaId: string) {
  const { data } = await db.from('users').select('id, email, full_name, created_at, raw_data')
    .eq('role', 'contador').filter('raw_data->>contadorDe', 'eq', empresaId)
  return (data ?? []).map((r: any) => ({ id: String(r.id), email: String(r.email ?? ''), nombre: String(r.full_name ?? ''), creadoEn: r.created_at ?? r.raw_data?.createdAt ?? null }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'Cuerpo inválido' }, 400) }
  const accion = String(body.action ?? '')

  const yo = await quienLlama(req)
  if (!yo) return json({ ok: false, error: 'Sesión inválida' }, 401)

  try {
    // ── La EMPRESA administra sus contadores ─────────────────────────────
    if (accion === 'listar_accesos') {
      if (yo.role !== 'business') return json({ ok: false, error: 'Solo una cuenta Empresa' }, 403)
      return json({ ok: true, contadores: await contadoresDe(yo.id) })
    }

    if (accion === 'crear_acceso') {
      if (yo.role !== 'business') return json({ ok: false, error: 'Solo una cuenta Empresa puede dar acceso a un contador' }, 403)
      const email = String(body.email ?? '').trim().toLowerCase()
      const nombre = String(body.nombre ?? '').trim().slice(0, 80)
      if (!correoValido(email)) return json({ ok: false, error: 'Correo inválido' }, 400)
      if (!nombre) return json({ ok: false, error: 'Falta el nombre del contador' }, 400)
      if (email === yo.email.toLowerCase()) return json({ ok: false, error: 'Ese es tu propio correo. El contador necesita uno distinto.' }, 400)

      const existentes = await contadoresDe(yo.id)
      if (existentes.length >= 5) return json({ ok: false, error: 'Ya tienes 5 accesos de contador. Elimina uno para crear otro.' }, 400)
      if (existentes.some(c => c.email === email)) return json({ ok: false, error: 'Ese correo ya tiene acceso a tu contabilidad' }, 400)

      // Correo ya registrado en Lincoin (como empresa, persona u otro
      // contador): no se toca. Un acceso de contador es una cuenta propia.
      const { data: yaExiste } = await db.from('users').select('id').ilike('email', email).maybeSingle()
      if (yaExiste) return json({ ok: false, error: 'Ese correo ya tiene una cuenta en Lincoin. El contador necesita un correo que no esté registrado.' }, 400)

      // Contraseña temporal que nadie conoce: el contador la fija desde el
      // enlace del correo. Si el correo no llega, "¿Olvidaste tu contraseña?"
      // en el login hace lo mismo.
      const temporal = crypto.randomUUID() + crypto.randomUUID()
      const { data: creado, error: eAuth } = await db.auth.admin.createUser({
        email, password: temporal, email_confirm: true,
        user_metadata: { full_name: nombre, role: 'contador', contadorDe: yo.id },
      })
      if (eAuth || !creado?.user) return json({ ok: false, error: `No se pudo crear la cuenta: ${eAuth?.message ?? 'sin detalle'}` }, 500)
      const uid = creado.user.id

      const fila = {
        id: uid, email, full_name: nombre, role: 'contador', kyc_status: 'approved',
        balances: {}, raw_data: {
          contadorDe: yo.id, empresaNombre: yo.nombre, empresaEmail: yo.email,
          ownReferralCode: uid.slice(-6).toUpperCase(), createdAt: new Date().toISOString(),
          creadoPor: yo.id,
        },
      }
      const { error: ePerfil } = await db.from('users').insert(fila)
      if (ePerfil) {
        // Sin perfil no hay vínculo con la empresa: se deshace la cuenta.
        await db.auth.admin.deleteUser(uid).catch(() => {})
        return json({ ok: false, error: `No se pudo guardar el perfil: ${ePerfil.message}` }, 500)
      }

      let correoEnviado = true
      let motivoCorreo = ''
      const { error: eReset } = await db.auth.resetPasswordForEmail(email, { redirectTo: origenSeguro(body.origen) })
      if (eReset) { correoEnviado = false; motivoCorreo = eReset.message }

      await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.contador_creado', metadata: { contadorId: uid, email, nombre, at: new Date().toISOString() } })
      return json({ ok: true, contador: { id: uid, email, nombre, creadoEn: fila.raw_data.createdAt }, correoEnviado, motivoCorreo })
    }

    if (accion === 'revocar_acceso') {
      if (yo.role !== 'business') return json({ ok: false, error: 'Solo una cuenta Empresa' }, 403)
      const contadorId = String(body.contadorId ?? '')
      const { data: c } = await db.from('users').select('id, email, role, raw_data').eq('id', contadorId).maybeSingle()
      if (!c || c.role !== 'contador' || String((c.raw_data as any)?.contadorDe ?? '') !== yo.id) {
        return json({ ok: false, error: 'Ese acceso no es tuyo o ya no existe' }, 404)
      }
      // Fuera del todo: sin sesión, sin cuenta, sin perfil. Es una cuenta que
      // solo existía para leer tu contabilidad.
      await db.from('users').delete().eq('id', contadorId)
      const { error: eDel } = await db.auth.admin.deleteUser(contadorId)
      if (eDel) return json({ ok: false, error: `Se quitó el vínculo pero no se pudo borrar la cuenta: ${eDel.message}` }, 500)
      await db.from('audit_log').insert({ user_id: yo.id, action: 'empresa.contador_revocado', metadata: { contadorId, email: c.email, at: new Date().toISOString() } })
      return json({ ok: true })
    }

    // ── El CONTADOR lee la contabilidad de su empresa ────────────────────
    if (accion === 'datos') {
      if (yo.role !== 'contador') return json({ ok: false, error: 'Esta entrada es solo para contadores' }, 403)
      const empresaId = String(yo.raw.contadorDe ?? '')
      if (!empresaId) return json({ ok: false, error: 'Tu acceso no está vinculado a ninguna empresa. Pídele a la empresa que lo cree de nuevo.' }, 403)

      const { data: emp } = await db.from('users').select('*').eq('id', empresaId).maybeSingle()
      if (!emp || emp.role !== 'business') return json({ ok: false, error: 'La empresa de este acceso ya no existe' }, 404)

      const [tx, comps] = await Promise.all([
        db.from('transactions').select('*').eq('user_id', empresaId).order('created_at', { ascending: false }).limit(5000),
        db.from('comprobantes').select('*').eq('user_id', empresaId).limit(5000),
      ])
      if (tx.error) return json({ ok: false, error: `Movimientos: ${tx.error.message}` }, 500)

      return json({
        ok: true,
        empresa: { id: String(emp.id), nombre: String((emp as any).company_name || emp.full_name || ''), email: String(emp.email ?? ''), nit: String((emp as any).tax_id ?? (emp as any).nit ?? (emp as any).raw_data?.nit ?? '') },
        transactions: tx.data ?? [],
        comprobantes: comps.error ? [] : (comps.data ?? []),
        comprobantesError: comps.error ? comps.error.message : null,
      })
    }

    return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400)
  } catch (e) {
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500)
  }
})
