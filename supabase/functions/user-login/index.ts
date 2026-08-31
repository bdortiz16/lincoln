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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    // Service role bypasses RLS — can read any user record
    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (error || !user) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    const storedHash: string | undefined = user.raw_data?.passwordHash

    if (storedHash) {
      // Primary: PBKDF2 with the stored email (matches frontend registration)
      const pbkdf2Hash = await hashPasswordPBKDF2(password, user.email)
      // Fallback: legacy SHA-256 scheme
      const sha256Hash = await hashPasswordSHA256(password, email.toLowerCase().trim())

      if (pbkdf2Hash !== storedHash && sha256Hash !== storedHash) {
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
