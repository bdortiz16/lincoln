import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { equipoPermite, permisosDe, permite } from '../_shared/equipo.ts'
import { requireMfaSession } from '../_shared/admin-auth.ts'

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

// Qué parte de la configuración privada le toca a quien llama. Antes bastaba
// `users.role = 'admin'`: un miembro desactivado, uno de "Solo lectura" o un
// colaborador sin 2FA —con solo la contraseña— recibía el equipo de admin
// (nombres, correos, roles) y la tesorería. Ahora:
//   · miembro ACTIVO del equipo y sesión que pasó el 2FA;
//   · el equipo de admin, solo el dueño (es quien lo administra);
//   · la tesorería, quien la ve en el panel (plata.ver / tesorería / billetera).
// La vista 'completa' —la única sobre la que el panel guarda— es la del dueño:
// guardar la configuración también es solo suyo (save_config).
type Vista = { admin: boolean; dueno: boolean; tesoreria: boolean }
const NINGUNA: Vista = { admin: false, dueno: false, tesoreria: false }
async function vistaDe(req: Request): Promise<Vista> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return NINGUNA
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    if (!user) return NINGUNA
    const { data } = await db.from('users').select('role').eq('id', user.id).maybeSingle()
    if (String((data as any)?.role ?? '') !== 'admin') return NINGUNA
    const eq = await equipoPermite(db, user.id, 'clientes.ver', { email: user.email ?? null })
    if (!eq.ok) return NINGUNA
    if (await requireMfaSession(db, req, user.id)) return NINGUNA
    const permisos = permisosDe(eq.acceso)
    return {
      admin: true,
      dueno: permisos.has('*'),
      tesoreria: permite(permisos, ['plata.ver', 'tesoreria', 'fn.tesoreria', 'fn.billetera']),
    }
  } catch { return NINGUNA }
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
    const v = await vistaDe(req)
    if (settings && !v.admin) {
      for (const k of PRIVADAS) delete settings[k]
      // Los cupones los valida la pantalla del cliente; se dejan solo los
      // activos, sin los que el admin apagó.
      if (Array.isArray(settings.coupons)) settings.coupons = settings.coupons.filter((c: any) => c?.active === true)
    } else if (settings && !v.dueno) {
      delete settings.adminTeam
      if (!v.tesoreria) for (const k of ['treasuryAccounts', 'treasuryBalance', 'treasuryHistory']) delete settings[k]
    }
    return new Response(JSON.stringify({ settings, vista: v.dueno ? 'completa' : v.admin ? 'equipo' : 'publica' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[get-system-config]', e?.message ?? e)
    return new Response(JSON.stringify({ error: 'config_no_disponible' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
