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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
    if (!jwt) return json({ error: 'No authorization token' }, 401)

    const { data: { user }, error: authErr } = await db.auth.getUser(jwt)
    if (authErr || !user) return json({ error: 'Invalid or expired token' }, 401)

    // Only allow deleting own account
    const uid = user.id

    await db.from('transactions').delete().eq('user_id', uid)
    await db.from('users').delete().eq('id', uid)

    const { error: authDelErr } = await db.auth.admin.deleteUser(uid)
    if (authDelErr) {
      console.warn('[delete-self] auth.admin.deleteUser error:', authDelErr.message)
    }

    return json({ success: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
