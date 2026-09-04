import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ADMIN_EMAIL  = Deno.env.get('ADMIN_EMAIL') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function hashPassword(password: string, email: string): Promise<string> {
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

    // If ADMIN_EMAIL is configured, restrict to that email only.
    // Respuesta UNIFORME (401 invalid_credentials): NO devolver un código
    // distinto (403/not_admin) para correos que no son el admin — eso
    // permitiría enumerar / adivinar cuál es el correo admin probando emails.
    if (ADMIN_EMAIL && email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('email', email)
      .single()

    // Respuesta UNIFORME: no revelar si el correo existe ni si es admin
    // (evita enumeración de cuentas / del correo admin).
    if (error || !user || user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    const storedHash: string | undefined = user.raw_data?.passwordHash
    const inputHash = await hashPassword(password, email)

    if (storedHash) {
      if (inputHash !== storedHash) {
        return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
        })
      }
    } else {
      // SEGURIDAD (pentest H2): NO adoptar cualquier contraseña que llegue
      // cuando la cuenta admin no tiene hash propio — eso permitiría tomarse
      // la cuenta admin con solo su correo. El admin entra por su sesión real
      // de Supabase (Authentication → Users). Se rechaza este respaldo.
      return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    // Return safe profile (no password hash)
    const { raw_data, ...safeUser } = user
    const { passwordHash: _ph, ...safeRawData } = raw_data || {}

    return new Response(JSON.stringify({ user: { ...safeUser, raw_data: safeRawData } }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    })

  } catch (e: any) {
    console.error('[admin-login] error:', e)
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
