import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const { data } = await db.from('app_config').select('settings').eq('id', 1).single()
    // Este endpoint es PÚBLICO (el landing/login lo necesita antes de
    // autenticar). Defensa en profundidad: nunca devolver claves con pinta de
    // secreto, por si alguna vez se guardó algo sensible en app_config.settings.
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
    return new Response(JSON.stringify({ settings: strip(data?.settings ?? null) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
