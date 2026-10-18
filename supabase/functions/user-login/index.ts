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
// La IP la pone el proxy de la plataforma, no el cliente: el PRIMER valor de
// X-Forwarded-For lo escribe quien hace la petición (cambiándolo en cada
// intento se saltaba el freno). Se usa la cabecera del proxy o el ÚLTIMO
// salto de X-Forwarded-For, que agrega la propia plataforma.
function ipOf(req: Request): string | null {
  const directa = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim()
  if (directa) return directa
  const saltos = (req.headers.get('x-forwarded-for') ?? '').split(',').map(x => x.trim()).filter(Boolean)
  return saltos.length ? saltos[saltos.length - 1] : null
}
const MAX_FAILS_15M = 10
const MAX_FAILS_CUENTA_15M = 8
async function contarFallos(campo: 'ip' | 'email', valor: string, since: string): Promise<number> {
  // El filtro va EN la consulta: antes se traían 300 filas sin orden y se
  // filtraba en memoria, y con tráfico los fallos de esta IP quedaban fuera.
  const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true })
    .eq('action', 'auth.failed_login').gte('created_at', since).eq(`metadata->>${campo}`, valor)
  return count ?? 0
}
async function loginThrottle(req: Request, email: string): Promise<string | null> {
  const ip = ipOf(req)
  if (ip) {
    try {
      const { data } = await db.from('system_config').select('value').eq('key', 'blocked_ips').single()
      const list: any[] = data?.value ? JSON.parse(data.value) : []
      if (list.some((b: any) => b?.ip === ip)) return 'ip_blocked'
    } catch { /* si no se puede leer, no se bloquea a nadie por error */ }
  }
  try {
    const since = new Date(Date.now() - 15 * 60_000).toISOString()
    if (ip && (await contarFallos('ip', ip, since)) >= MAX_FAILS_15M) return 'too_many_attempts'
    // También por cuenta: cambiando de IP se podía seguir probando contra el
    // mismo correo.
    if (email && (await contarFallos('email', email, since)) >= MAX_FAILS_CUENTA_15M) return 'too_many_attempts'
  } catch { /* idem */ }
  return null
}

// Comparación en tiempo constante de dos hashes hex.
function igualesHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// Claves de raw_data que NUNCA salen de este servidor: credenciales y
// material del segundo factor. El navegador solo necesita saber si el 2FA
// está activo (mfaEnabled), no sus secretos.
const CLAVES_PRIVADAS = ['passwordHash', 'otp', 'totpSecret', 'totpSecretEnc', 'mfaBackupHashes', 'mfaSessions', 'mfaLastCounter', 'mfaFactorId', 'trustedDevices', 'passkeys']
async function noteFail(req: Request, email: string, reason: string) {
  try {
    await db.from('audit_log').insert({
      user_id: null, action: 'auth.failed_login',
      metadata: { email: String(email ?? '').trim().toLowerCase().slice(0, 120), reason, ip: ipOf(req), userAgent: req.headers.get('user-agent') ?? null, at: new Date().toISOString() },
    })
  } catch { /* el registro nunca rompe el login */ }
}
const noAutorizado = () => new Response(JSON.stringify({ error: 'invalid_credentials' }), {
  status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
})

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
    const throttled = await loginThrottle(req, String(email).trim().toLowerCase())
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

    if (!storedHash) {
      // SEGURIDAD (pentest H2): si la cuenta NO tiene contraseña propia
      // guardada (p. ej. entró con Google, fue sembrada por el admin, o
      // importada), este respaldo NO puede "adoptar" cualquier contraseña que
      // llegue — eso permitía tomarse la cuenta de otro con solo su correo.
      await noteFail(req, email, 'cuenta sin contraseña propia (user-login)')
      return noAutorizado()
    }
    // Primary: PBKDF2 with the stored email (matches frontend registration)
    const pbkdf2Hash = await hashPasswordPBKDF2(password, user.email)
    // Fallback: legacy SHA-256 scheme
    const sha256Hash = await hashPasswordSHA256(password, email.toLowerCase().trim())
    if (!igualesHex(pbkdf2Hash, storedHash) && !igualesHex(sha256Hash, storedHash)) {
      await noteFail(req, email, 'contraseña incorrecta (user-login)')
      return noAutorizado()
    }

    // ── Solo para cuentas que NUNCA tuvieron usuario de Auth ─────────────
    // Antes, con la contraseña guardada en raw_data.passwordHash (la del
    // REGISTRO, que no cambia cuando la persona recupera su contraseña), este
    // respaldo le ponía esa contraseña al usuario de Auth. Resultado: tras un
    // robo de contraseña y su cambio, la contraseña VIEJA seguía entrando por
    // aquí y además pisaba la nueva — toma de cuenta y dueño afuera.
    //
    // Ahora, si el usuario de Auth EXISTE, manda Auth: este camino no entra
    // ni cambia nada (la persona usa su contraseña actual o "Olvidé mi
    // contraseña"). Solo se CREA el usuario de Auth, con el mismo id, cuando
    // no existe ninguno: ahí passwordHash es la única credencial de la cuenta.
    try {
      const { data: existente } = await db.auth.admin.getUserById(user.id)
      if (existente?.user) {
        await noteFail(req, email, 'respaldo con usuario de Auth existente (user-login)')
        return noAutorizado()
      }
    } catch { /* si no se pudo consultar, el createUser de abajo decide */ }
    let authSynced = false
    try {
      const { error: createErr } = await db.auth.admin.createUser({
        id: user.id, email: user.email, password, email_confirm: true,
      })
      authSynced = !createErr
      if (createErr) console.warn('[user-login] no se pudo crear el auth user:', createErr.message)
    } catch (e) {
      console.warn('[user-login] auth sync threw:', (e as Error)?.message)
    }
    if (!authSynced) {
      await noteFail(req, email, 'no se pudo crear el usuario de Auth (user-login)')
      return noAutorizado()
    }
    // La contraseña ya vive en Auth: la copia de raw_data sobra y es la que
    // permitía el ataque de arriba. Se borra.
    try {
      const { data: fresca } = await db.from('users').select('raw_data').eq('id', user.id).maybeSingle()
      const rd = { ...(((fresca as any)?.raw_data ?? {}) as Record<string, any>) }
      delete rd.passwordHash
      await db.from('users').update({ raw_data: rd }).eq('id', user.id)
    } catch { /* no bloquea el ingreso */ }

    // Return profile without secrets
    const { raw_data, ...safeUser } = user
    const safeRawData: Record<string, any> = { ...(raw_data || {}) }
    for (const k of CLAVES_PRIVADAS) delete safeRawData[k]

    return new Response(JSON.stringify({ user: { ...safeUser, raw_data: safeRawData }, authSynced }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    })

  } catch (e: any) {
    console.error('[user-login] error:', e)
    return new Response(JSON.stringify({ error: 'login_failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
