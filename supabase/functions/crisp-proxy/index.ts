// ════════════════════════════════════════════════════════
// crisp-proxy — proxy autenticado a la API REST de Crisp para la
// bandeja embebida del admin (sección Soporte).
//
// La API de Crisp no permite CORS desde browsers y el token de
// plugin es secreto — por eso todas las llamadas pasan por acá.
//
// Actions (query param ?action=):
//   • ping                      → healthcheck + qué secrets faltan
//   • conversations&page=1      → lista de conversaciones
//   • messages&session_id=...   → mensajes de una conversación
//   • send   (POST body {session_id, content}) → responder como operador
//   • resolve(POST body {session_id})          → marcar resuelta
//
// Secrets requeridos (Edge Functions → Secrets):
//   CRISP_IDENTIFIER  → identifier del plugin token
//   CRISP_KEY         → key del plugin token
//   CRISP_WEBSITE_ID  → opcional (default: el website de Lincoin)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → automáticos
//
// El token se crea en https://marketplace.crisp.chat → New Plugin
// (privado) → API tokens, con scopes:
//   website:conversation:sessions (read)
//   website:conversation:messages (read + write)
//   website:conversation:states   (write)
// y activando el plugin en el website de Lincoin.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRISP_IDENTIFIER = Deno.env.get('CRISP_IDENTIFIER') ?? ''
const CRISP_KEY        = Deno.env.get('CRISP_KEY') ?? ''
const CRISP_WEBSITE_ID = Deno.env.get('CRISP_WEBSITE_ID') ?? '972ae8c4-146c-475c-82dd-2d54a766dfbe'

const CRISP_BASE = `https://api.crisp.chat/v1/website/${CRISP_WEBSITE_ID}`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

function crispHeaders(): HeadersInit {
  return {
    'Authorization': `Basic ${btoa(`${CRISP_IDENTIFIER}:${CRISP_KEY}`)}`,
    'X-Crisp-Tier': 'plugin',
    'Content-Type': 'application/json',
  }
}

async function crispFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${CRISP_BASE}${path}`, { ...init, headers: { ...crispHeaders(), ...(init?.headers ?? {}) } })
  let body: any = null
  try { body = await res.json() } catch { /* vacío */ }
  if (!res.ok) console.warn(`[crisp-proxy] ${init?.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
  return { ok: res.ok, status: res.status, body }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') ?? ''

    if (action === 'ping') {
      return json({
        ok: true,
        secrets: {
          CRISP_IDENTIFIER: !!CRISP_IDENTIFIER,
          CRISP_KEY:        !!CRISP_KEY,
          CRISP_WEBSITE_ID: CRISP_WEBSITE_ID,
        },
      })
    }

    // ── Auth: JWT del admin ──
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return json({ error: 'No auth' }, 401)
    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await sb.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)
    const { data: caller } = await sb.from('users').select('role, admin_role').eq('id', user.id).single()
    const roles = [caller?.role, (caller as any)?.admin_role].filter(Boolean)
    const allowed = roles.some(r => ['admin', 'super_admin', 'compliance', 'support'].includes(String(r)))
    if (!allowed) return json({ error: 'Forbidden' }, 403)

    if (!CRISP_IDENTIFIER || !CRISP_KEY) {
      return json({
        error: 'crisp_not_configured',
        hint: 'Faltan secrets CRISP_IDENTIFIER / CRISP_KEY. Creá un plugin token en marketplace.crisp.chat y cargalos en Edge Functions → Secrets.',
      }, 200)
    }

    // ── Listar conversaciones ──
    if (action === 'conversations') {
      const page = url.searchParams.get('page') ?? '1'
      const r = await crispFetch(`/conversations/${page}`)
      if (!r.ok) return json({ error: `Crisp ${r.status}`, detail: r.body?.reason ?? r.body }, 502)
      // Normalizamos lo mínimo que el front necesita
      const items = (r.body?.data ?? []).map((c: any) => ({
        session_id:  c.session_id,
        nickname:    c.meta?.nickname ?? c.meta?.email ?? 'Visitante',
        email:       c.meta?.email ?? null,
        avatar:      c.meta?.avatar ?? null,
        state:       c.state,                       // pending | unresolved | resolved
        unread:      c.unread?.operator ?? 0,
        updated_at:  c.updated_at,
        last_message: c.last_message ?? '',
      }))
      return json({ ok: true, conversations: items })
    }

    // ── Mensajes de una conversación ──
    if (action === 'messages') {
      const sid = url.searchParams.get('session_id') ?? ''
      if (!sid) return json({ error: 'session_id required' }, 400)
      const r = await crispFetch(`/conversation/${sid}/messages`)
      if (!r.ok) return json({ error: `Crisp ${r.status}`, detail: r.body?.reason ?? r.body }, 502)
      const items = (r.body?.data ?? []).map((m: any) => ({
        fingerprint: m.fingerprint,
        from:        m.from,          // user | operator
        type:        m.type,          // text | file | picker | ...
        content:     typeof m.content === 'string' ? m.content
                     : m.type === 'file' ? (m.content?.name ?? '[archivo]')
                     : JSON.stringify(m.content).slice(0, 200),
        timestamp:   m.timestamp,
        nickname:    m.user?.nickname ?? null,
      }))
      return json({ ok: true, messages: items })
    }

    // ── Enviar mensaje como operador ──
    if (action === 'send' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const sid = body?.session_id ?? ''
      const content = String(body?.content ?? '').trim()
      if (!sid)     return json({ error: 'session_id required' }, 400)
      if (!content) return json({ error: 'content required' }, 400)
      const r = await crispFetch(`/conversation/${sid}/message`, {
        method: 'POST',
        body: JSON.stringify({
          type:    'text',
          from:    'operator',
          origin:  'chat',
          content,
          user:    { nickname: body?.nickname ?? 'Lincoin Soporte' },
        }),
      })
      if (!r.ok) return json({ error: `Crisp ${r.status}`, detail: r.body?.reason ?? r.body }, 502)
      return json({ ok: true })
    }

    // ── Marcar conversación resuelta ──
    if (action === 'resolve' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const sid = body?.session_id ?? ''
      if (!sid) return json({ error: 'session_id required' }, 400)
      const r = await crispFetch(`/conversation/${sid}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'resolved' }),
      })
      if (!r.ok) return json({ error: `Crisp ${r.status}`, detail: r.body?.reason ?? r.body }, 502)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action. Use: ping, conversations, messages, send, resolve' }, 400)
  } catch (e: any) {
    console.error('[crisp-proxy] fatal:', e)
    return json({ error: e?.message ?? 'internal' }, 500)
  }
})
