import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ¿Hace cuánto se autenticó DE VERDAD esta sesión? El `iat` del token se
// renueva cada hora sin pedir nada; `amr` guarda cuándo se ingresó la
// contraseña (o el método que fuera). Borrar la cuenta exige un ingreso
// reciente: una sesión robada o un equipo prestado no alcanzan.
function segundosDesdeIngreso(jwt: string): number | null {
  try {
    const p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const marcas = Array.isArray(p.amr) ? p.amr.map((m: any) => Number(m?.timestamp) || 0).filter((n: number) => n > 0) : []
    const t = marcas.length ? Math.max(...marcas) : Number(p.iat) || 0
    return t > 0 ? Math.floor(Date.now() / 1000) - t : null
  } catch { return null }
}
const MAX_SEG_DESDE_INGRESO = 10 * 60

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ error: 'No authorization token' }, 401)

    const { data: { user }, error: authErr } = await db.auth.getUser(jwt)
    if (authErr || !user) return json({ error: 'Invalid or expired token' }, 401)

    // Only allow deleting own account
    const uid = user.id

    const edad = segundosDesdeIngreso(jwt)
    if (edad == null || edad > MAX_SEG_DESDE_INGRESO) {
      return json({ error: 'reauth_required', message: 'Por seguridad, vuelve a iniciar sesión y repite el borrado de la cuenta.' }, 403)
    }

    // Con saldo o con operaciones en curso NO se borra: la plata del cliente
    // quedaría sin dueño y un envío en vuelo sin a quién devolverle.
    const { data: prof } = await db.from('users').select('email, role, balances, crypto_balances').eq('id', uid).maybeSingle()
    if ((prof as any)?.role === 'admin') return json({ error: 'admin_account', message: 'Una cuenta de administración no se borra desde aquí.' }, 403)
    const saldos = [
      ...Object.values(((prof as any)?.balances ?? {}) as Record<string, unknown>),
      ...Object.values(((prof as any)?.crypto_balances ?? {}) as Record<string, unknown>),
    ].map(v => Number(v) || 0)
    if (saldos.some(v => Math.abs(v) > 0.000001)) {
      return json({ error: 'saldo_pendiente', message: 'Tu cuenta todavía tiene saldo. Retíralo o escríbenos antes de borrarla.' }, 409)
    }
    const { count: enCurso } = await db.from('transactions').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).in('status', ['Pendiente', 'Procesando'])
    if ((enCurso ?? 0) > 0) {
      return json({ error: 'operaciones_en_curso', message: 'Tienes operaciones en curso. Espera a que terminen antes de borrar la cuenta.' }, 409)
    }

    // Registro DURABLE del borrado (quién, cuándo, IP) — antes no quedaba rastro
    // en la app, solo en los logs de Supabase que caducan.
    try {
      const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') ?? '').split(',').map(x => x.trim()).filter(Boolean).pop() || null
      await db.from('audit_log').insert({ user_id: uid, action: 'user.delete_self', metadata: { deletedEmail: (prof as any)?.email ?? user.email ?? null, deletedRole: (prof as any)?.role ?? null, ip, userAgent: req.headers.get('user-agent') ?? null, at: new Date().toISOString() } })
    } catch { /* best-effort */ }

    // El historial de movimientos NO se borra: es el registro contable y de
    // cumplimiento (comprobantes, facturas, reportes). Se borra el perfil y
    // el acceso; las operaciones quedan con su user_id.
    const { error: delErr } = await db.from('users').delete().eq('id', uid)
    if (delErr) {
      console.error('[delete-self] no se pudo borrar el perfil:', delErr.message)
      return json({ error: 'delete_failed', message: 'No se pudo borrar la cuenta. Intenta de nuevo o escríbenos.' }, 500)
    }

    const { error: authDelErr } = await db.auth.admin.deleteUser(uid)
    if (authDelErr) {
      console.warn('[delete-self] auth.admin.deleteUser error:', authDelErr.message)
    }

    return json({ success: true })
  } catch (e) {
    console.error('[delete-self]', e)
    return json({ error: 'delete_failed', message: 'No se pudo borrar la cuenta.' }, 500)
  }
})
