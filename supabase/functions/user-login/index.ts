import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Must match DatabaseContext.tsx hashPassword — PBKDF2, 100k iterations, email as salt
async function hashPasswordPBKDF2(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Legacy SHA-256 scheme (some accounts may have been hashed with this)
async function hashPasswordSHA256(password: string, email: string): Promise<string> {
  const data = new TextEncoder().encode(`${email}:${password}:cuypay-salt`)
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}


// ── Freno de fuerza bruta ─────────────────────────────────────────────────
// Este endpoint verifica contraseñas SIN pasar por Supabase Auth, así que no
// heredaba ni su límite de intentos ni el CAPTCHA de la pantalla: era un
// oráculo al que se le podían probar contraseñas a toda velocidad. Ahora
// comparte la lista de IPs bloqueadas y el registro de intentos fallidos del
// panel de seguridad.
function ipOf(req: Request): string | null {
  const fwd = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return fwd || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || null
}
const MAX_FAILS_15M = 10
async function loginThrottle(req: Request): Promise<string | null> {
  const ip = ipOf(req)
  if (!ip) return null
  try {
    const { data } = await db.from('system_config').select('value').eq('key', 'blocked_ips').single()
    const list: any[] = data?.value ? JSON.parse(data.value) : []
    if (list.some((b: any) => b?.ip === ip)) return 'ip_blocked'
  } catch { /* si no se puede leer, no se bloquea a nadie por error */ }
  try {
    const since = new Date(Date.now() - 15 * 60_000).toISOString()
    const { data: recent } = await db.from('audit_log').select('metadata')
      .eq('action', 'auth.failed_login').gte('created_at', since).limit(300)
    const fails = (recent ?? []).filter((r: any) => r?.metadata?.ip === ip).length
    if (fails >= MAX_FAILS_15M) return 'too_many_attempts'
  } catch { /* idem */ }
  return null
}
async function noteFail(req: Request, email: string, reason: string) {
  try {
    await db.from('audit_log').insert({
      user_id: null, action: 'auth.failed_login',
      metadata: { email: String(email ?? '').slice(0, 120), reason, ip: ipOf(req), userAgent: req.headers.get('user-agent') ?? null, at: new Date().toISOString() },
    })
  } catch { /* el registro nunca rompe el login */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    // Freno ANTES de comparar nada: si la IP está bloqueada o ya acumuló
    // demasiados fallos, ni siquiera se toca la contraseña.
    const throttled = await loginThrottle(req)
    if (throttled) {
      return new Response(JSON.stringify({ error: throttled === 'ip_blocked' ? 'ip_blocked' : 'too_many_attempts' }), {
        status: 429, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    // Service role bypasses RLS — can read any user record
    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (error || !user) {
      // Respuesta UNIFORME con credenciales inválidas: no revelar si el correo
      // existe (evita enumeración de cuentas).
      await noteFail(req, email, 'correo inexistente (user-login)')
      return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    const storedHash: string | undefined = user.raw_data?.passwordHash

    if (storedHash) {
      // Primary: PBKDF2 with the stored email (matches frontend registration)
      const pbkdf2Hash = await hashPasswordPBKDF2(password, user.email)
      // Fallback: legacy SHA-256 scheme
      const sha256Hash = await hashPasswordSHA256(password, email.toLowerCase().trim())

      if (pbkdf2Hash !== storedHash && sha256Hash !== storedHash) {
        await noteFail(req, email, 'contraseña incorrecta (user-login)')
        return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
        })
      }

      // Migrate legacy SHA-256 hash to PBKDF2 on successful login
      if (sha256Hash === storedHash && pbkdf2Hash !== storedHash) {
        await db.from('users').update({
          raw_data: { ...(user.raw_data || {}), passwordHash: pbkdf2Hash },
        }).eq('id', user.id)
      }
    } else {
      // SEGURIDAD (pentest H2): si la cuenta NO tiene contraseña propia
      // guardada (p. ej. entró con Google, fue sembrada por el admin, o
      // importada), este respaldo NO puede "adoptar" cualquier contraseña que
      // llegue — eso permitía tomarse la cuenta de otro con solo su correo.
      // Se rechaza; esas cuentas entran por su método real (Google) o por
      // recuperación de contraseña, no por este camino.
      await noteFail(req, email, 'cuenta sin contraseña propia (user-login)')
      return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    // ── Sincronizar la sesión REAL de Supabase Auth ──────────────────
    // Este login de respaldo (usado cuando supabase.auth.signInWithPassword
    // falla) hasta ahora solo devolvía el PERFIL — el cliente quedaba
    // "medio autenticado": veía sus datos, pero sin un JWT real. Como la
    // tabla public.users solo deja escribir a sesiones 'authenticated' con
    // auth.uid()=id, CUALQUIER guardado de ese cliente (saldos, envíos,
    // conversiones) fallaba en silencio para siempre — el saldo nunca
    // bajaba, aunque en pantalla pareciera que sí.
    //
    // Con el service-role: 1) intenta poner la contraseña que acaba de
    // validar en el usuario de Auth con el MISMO id que public.users.id
    // (cubre el caso típico: existe pero quedó desincronizada); 2) si ese
    // usuario de Auth no existe, lo crea con ese mismo id explícito (para
    // que auth.uid() siga calzando con public.users.id de ahí en más). El
    // cliente, al recibir authSynced:true, reintenta signInWithPassword y
    // de ahí en adelante ya tiene un JWT real como cualquier login normal.
    let authSynced = false
    try {
      const { error: updErr } = await db.auth.admin.updateUserById(user.id, { password })
      if (!updErr) {
        authSynced = true
      } else {
        const { error: createErr } = await db.auth.admin.createUser({
          id: user.id, email: user.email, password, email_confirm: true,
        })
        authSynced = !createErr
        if (createErr) console.warn('[user-login] no se pudo crear el auth user:', createErr.message)
      }
    } catch (e) {
      console.warn('[user-login] auth sync threw:', (e as Error)?.message)
    }

    // Return profile without password hash
    const { raw_data, ...safeUser } = user
    const { passwordHash: _ph, ...safeRawData } = raw_data || {}

    return new Response(JSON.stringify({ user: { ...safeUser, raw_data: safeRawData }, authSynced }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    })

  } catch (e: any) {
    console.error('[user-login] error:', e)
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
