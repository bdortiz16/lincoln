import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Claves de la configuración que NO son para el público. Este endpoint lo
// llama el landing antes de iniciar sesión: devolvía el equipo de admin
// (nombres, correos, roles) y la tesorería a cualquiera con la URL.
const PRIVADAS = ['adminTeam', 'treasuryAccounts', 'treasuryBalance', 'treasuryHistory']

// Solo un admin (JWT real + users.role = 'admin') recibe la configuración
// completa: el panel la necesita entera, porque al guardar escribe el objeto
// completo y una copia recortada borraría lo que falta.
async function esAdmin(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    if (!user) return false
    const { data } = await db.from('users').select('role').eq('id', user.id).maybeSingle()
    return String((data as any)?.role ?? '') === 'admin'
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const { data } = await db.from('app_config').select('settings').eq('id', 1).single()
    // Defensa en profundidad: nunca devolver claves con pinta de secreto, por
    // si alguna vez se guardó algo sensible en app_config.settings.
    const SENSITIVE = /secret|password|passwd|api[_-]?key|apikey|service[_-]?role|client[_-]?secret|webhook[_-]?secret|access[_-]?token|auth[_-]?token|bearer|private[_-]?key/i
    const strip = (v: any, depth = 0): any => {
      if (!v || typeof v !== 'object' || depth > 6) return v
      if (Array.isArray(v)) return v.map(x => strip(x, depth + 1))
      const out: Record<string, any> = {}
      for (const [k, val] of Object.entries(v)) {
        if (SENSITIVE.test(k)) continue
        out[k] = strip(val, depth + 1)
      }
      return out
    }
    const settings = strip(data?.settings ?? null)
    const admin = await esAdmin(req)
    if (settings && !admin) {
      for (const k of PRIVADAS) delete settings[k]
      // Los cupones los valida la pantalla del cliente; se dejan solo los
      // activos, sin los que el admin apagó.
      if (Array.isArray(settings.coupons)) settings.coupons = settings.coupons.filter((c: any) => c?.active === true)
    }
    return new Response(JSON.stringify({ settings, vista: admin ? 'completa' : 'publica' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[get-system-config]', e?.message ?? e)
    return new Response(JSON.stringify({ error: 'config_no_disponible' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
