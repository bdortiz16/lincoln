// ============================================================================
// CuyPay · didit-kyc v5.1 — con caché de imágenes en Supabase Storage
// Primera vez: descarga de Didit + guarda en Storage + cachea en kyc_cache
// Siguientes veces: lee del caché local (sin llamar a Didit)
// ?force=true → fuerza recarga desde Didit
//
// v5.1 (fixes sobre la v5 de Antigravity — solo tocan el pipeline de media):
//   1. storeMedia reintenta la descarga con x-api-key si el fetch sin auth
//      falla (URLs de Didit no pre-firmadas devolvían 401/403 → sin imagen).
//   2. buildTabsFromDecision acepta las variantes de keys que Didit v3
//      devuelve según cuenta/versión: front_image / full_front_image /
//      portrait_image / video_url / selfie_image / singular vs plural.
//   3. Self-heal del cache: si una sesión quedó cacheada SIN imágenes
//      archivadas (stored_images vacío), se re-fetchea de Didit para
//      archivarlas en vez de servir el cache con URLs vencidas.
//   4. Retrato del documento (portrait) también se archiva y se sirve.
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const DIDIT_BASE = 'https://verification.didit.me'
const DIDIT_AUTH_URL = 'https://apx.didit.me/auth/v2/token/'
// Workflows configurables: personas (KYC) y empresas (KYB). Si el de KYB no
// está configurado, las empresas usan el mismo workflow que personas.
const DIDIT_WORKFLOW_ID     = (Deno.env.get('DIDIT_WORKFLOW_ID') ?? '').trim()
const DIDIT_WORKFLOW_ID_KYB = (Deno.env.get('DIDIT_WORKFLOW_ID_KYB') ?? '').trim()
const DIDIT_CLIENT_ID       = (Deno.env.get('DIDIT_CLIENT_ID') ?? '').trim()
const DIDIT_CLIENT_SECRET   = (Deno.env.get('DIDIT_CLIENT_SECRET') ?? '').trim()
const APP_RETURN_URL        = (Deno.env.get('KYC_RETURN_URL') ?? 'https://cuypay.com').trim()
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

async function fetchDidit(url: string, apiKey: string) {
  console.log(`[didit-kyc] Fetching: ${url}`)
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
  })
  console.log(`[didit-kyc] Response: ${res.status} ${res.statusText}`)
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const data = await res.json()
    return { ok: res.ok, status: res.status, data }
  }
  return { ok: false, status: res.status, data: { error: `non-JSON` } }
}

// ── Download media and store in Supabase Storage ──
// v5.1: recibe apiKey y reintenta con x-api-key si la descarga sin auth
// falla — las URLs de Didit no siempre son pre-firmadas.
async function storeMedia(
  supabase: any, mediaUrl: string, sessionId: string, label: string, apiKey: string,
): Promise<string | null> {
  try {
    console.log(`[didit-kyc] 📥 Downloading ${label}...`)
    let res = await fetch(mediaUrl)
    if (!res.ok && apiKey) {
      console.log(`[didit-kyc] ${label} sin auth → ${res.status}; retry con x-api-key`)
      res = await fetch(mediaUrl, { headers: { 'x-api-key': apiKey } })
    }
    if (!res.ok && apiKey) {
      console.log(`[didit-kyc] ${label} x-api-key → ${res.status}; retry con Authorization Bearer`)
      res = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${apiKey}` } })
    }
    if (!res.ok) {
      console.warn(`[didit-kyc] ❌ Download ${label}: HTTP ${res.status}`)
      return null
    }

    const blob = await res.blob()
    if (blob.size === 0) { console.warn(`[didit-kyc] ❌ ${label}: 0 bytes`); return null }
    const ct = blob.type || 'image/jpeg'
    const ext = ct.includes('webm') ? 'webm' : ct.includes('mp4') ? 'mp4'
      : ct.includes('png') ? 'png' : ct.includes('pdf') ? 'pdf' : 'jpg'
    const path = `${sessionId}/${label}.${ext}`

    const { error } = await supabase.storage
      .from('kyc-documents')
      .upload(path, blob, { contentType: ct, upsert: true })

    if (error) {
      console.warn(`[didit-kyc] ❌ Upload ${label}:`, error.message)
      return null
    }
    console.log(`[didit-kyc] ✅ Stored ${label} → ${path}`)
    return path
  } catch (e) {
    console.warn(`[didit-kyc] ❌ ${label}:`, e.message)
    return null
  }
}

// ── Get signed URL for stored media ──
async function getSignedUrl(supabase: any, path: string): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from('kyc-documents')
    .createSignedUrl(path, 3600) // 1 hour
  return error ? null : data?.signedUrl || null
}

// ── Build tabs from V3 decision ──
// v5.1: fallbacks para las variantes de nombres de keys y para secciones
// singular vs plural — según la cuenta/versión de Didit cambian.
function buildTabsFromDecision(decision: Record<string, any> | null | undefined) {
  if (!decision) return {
    id_verification: null, liveness: null, face_match: null,
    email_verification: null, phone_verification: null, validations: null,
  }

  const idv = decision.id_verifications?.[0] || decision.id_verification || decision.kyc || null
  const liv = decision.liveness_checks?.[0] || decision.liveness || null
  const fm  = decision.face_matches?.[0] || decision.face_match || null
  const aml = decision.aml_screenings?.[0] || decision.aml || null
  const email = decision.email_verifications?.[0] || decision.email_verification || null
  const phone = decision.phone_verifications?.[0] || decision.phone_verification || null
  const poa = decision.poa_verifications?.[0] || decision.poa || null
  const ip  = decision.ip_analyses?.[0] || decision.ip_analysis || null

  return {
    id_verification: idv ? {
      first_name: idv.first_name || null,
      last_name: idv.last_name || null,
      full_name: idv.full_name || [idv.first_name, idv.last_name].filter(Boolean).join(' ') || null,
      document_type: idv.document_type || null,
      document_subtype: idv.document_subtype || null,
      document_number: idv.document_number || null,
      date_of_birth: idv.date_of_birth || null,
      date_of_expiry: idv.date_of_expiry || null,
      issuing_state: idv.issuing_state || null,
      issuing_state_name: idv.issuing_state_name || null,
      nationality: idv.nationality || null,
      gender: idv.gender || null,
      age: idv.age || null,
      mrz_valid: idv.mrz_valid || null,
      front_image_url: idv.front_image_url || idv.front_image || idv.full_front_image || null,
      back_image_url: idv.back_image_url || idv.back_image || idv.full_back_image || null,
      portrait_image_url: idv.portrait_image_url || idv.portrait_image || null,
    } : null,
    liveness: liv ? {
      liveness_score: liv.liveness_score || liv.score || null,
      passed: liv.passed || null,
      selfie_image_url: liv.reference_image || liv.selfie_image || liv.reference_image_url || liv.selfie_url || null,
      video_url: liv.video || liv.video_url || null,
    } : null,
    face_match: fm ? {
      passed: fm.passed || null,
      score: fm.score || null,
      source_image: fm.source_image || fm.source_image_url || null,
      target_image: fm.target_image || fm.target_image_url || null,
    } : null,
    email_verification: email ? {
      email: email.email || null,
      passed: email.passed || null,
    } : null,
    phone_verification: phone ? {
      phone_number: phone.phone_number || null,
      passed: phone.passed || null,
    } : null,
    validations: {
      aml: aml ? {
        hits: aml.hits || [],
        total_hits: aml.total_hits || 0,
        has_hits: aml.has_hits || false,
      } : null,
      poa: poa ? {
        document_type: poa.document_type || null,
        full_name: poa.full_name || null,
        address: poa.address || null,
        issue_date: poa.issue_date || null,
        extracted_fields: poa.extracted_fields || {},
      } : null,
      ip: ip ? {
        ip: ip.ip || null,
        country: ip.country || null,
        proxy: ip.proxy || false,
        vpn: ip.vpn || false,
        tor: ip.tor || false,
      } : null,
    },
  }
}

// ── Archive images ──
async function archiveImages(
  supabase: any, sessionId: string, tabs: any, apiKey: string,
): Promise<Record<string, string>> {
  const stored: Record<string, string> = {}

  if (tabs.id_verification?.front_image_url) {
    const p = await storeMedia(supabase, tabs.id_verification.front_image_url, sessionId, 'id_front', apiKey)
    if (p) stored.id_front = p
  }
  if (tabs.id_verification?.back_image_url) {
    const p = await storeMedia(supabase, tabs.id_verification.back_image_url, sessionId, 'id_back', apiKey)
    if (p) stored.id_back = p
  }
  if (tabs.id_verification?.portrait_image_url) {
    const p = await storeMedia(supabase, tabs.id_verification.portrait_image_url, sessionId, 'id_portrait', apiKey)
    if (p) stored.id_portrait = p
  }
  if (tabs.liveness?.selfie_image_url) {
    const p = await storeMedia(supabase, tabs.liveness.selfie_image_url, sessionId, 'selfie', apiKey)
    if (p) stored.selfie = p
  }
  if (tabs.liveness?.video_url) {
    const p = await storeMedia(supabase, tabs.liveness.video_url, sessionId, 'liveness_video', apiKey)
    if (p) stored.liveness_video = p
  }
  if (tabs.face_match?.source_image) {
    const p = await storeMedia(supabase, tabs.face_match.source_image, sessionId, 'face_source', apiKey)
    if (p) stored.face_source = p
  }
  if (tabs.face_match?.target_image) {
    const p = await storeMedia(supabase, tabs.face_match.target_image, sessionId, 'face_target', apiKey)
    if (p) stored.face_target = p
  }

  return stored
}

// ── Replace URLs ──
async function replaceWithLocalUrls(supabase: any, response: any, stored: Record<string, string>) {
  if (stored.id_front && response.id_verification) {
    const url = await getSignedUrl(supabase, stored.id_front)
    if (url) response.id_verification.front_image_url = url
  }
  if (stored.id_back && response.id_verification) {
    const url = await getSignedUrl(supabase, stored.id_back)
    if (url) response.id_verification.back_image_url = url
  }
  if (stored.id_portrait && response.id_verification) {
    const url = await getSignedUrl(supabase, stored.id_portrait)
    if (url) response.id_verification.portrait_image_url = url
  }
  if (stored.selfie && response.liveness) {
    const url = await getSignedUrl(supabase, stored.selfie)
    if (url) response.liveness.selfie_image_url = url
  }
  if (stored.liveness_video && response.liveness) {
    const url = await getSignedUrl(supabase, stored.liveness_video)
    if (url) response.liveness.video_url = url
  }
  if (stored.face_source && response.face_match) {
    const url = await getSignedUrl(supabase, stored.face_source)
    if (url) response.face_match.source_image = url
  }
  if (stored.face_target && response.face_match) {
    const url = await getSignedUrl(supabase, stored.face_target)
    if (url) response.face_match.target_image = url
  }
}

// ============================================================================
// ── Flujo del USUARIO: crear sesión de verificación (KYC/KYB) ──
// Restaurado en v5.3 — se perdió en la reescritura del panel admin y el
// botón "Verificar ahora" quedaba en error para todos los clientes.

async function diditOAuthToken(): Promise<string> {
  const credentials = btoa(`${DIDIT_CLIENT_ID}:${DIDIT_CLIENT_SECRET}`)
  const resp = await fetch(DIDIT_AUTH_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!resp.ok) {
    const t = await resp.text()
    throw new Error(`Didit rechazó las credenciales client_id/secret (${t.slice(0, 120)}). Solución recomendada: crea el secret DIDIT_API_KEY en Supabase → Edge Functions → Secrets con la API key de tu consola de Didit (Application → API Key) — es el método actual y tiene prioridad.`)
  }
  return (await resp.json()).access_token
}

async function createDiditSession(db: any, apiKey: string, userId: string) {
  const { data: u } = await db.from('users').select('raw_data, role, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')

  const isBusiness = u.role === 'business'
  const workflowId = (isBusiness && DIDIT_WORKFLOW_ID_KYB) ? DIDIT_WORKFLOW_ID_KYB : DIDIT_WORKFLOW_ID
  if (!workflowId) throw new Error('Configura DIDIT_WORKFLOW_ID en Supabase Secrets')

  const body = JSON.stringify({
    workflow_id: workflowId,
    vendor_data: userId,
    callback: APP_RETURN_URL, // adonde vuelve el usuario al terminar
  })

  // Didit v2 con x-api-key; si no hay API key, OAuth v1 (integraciones viejas)
  let resp: Response
  if (apiKey) {
    resp = await fetch(`${DIDIT_BASE}/v2/session/`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body,
    })
  } else if (DIDIT_CLIENT_ID && DIDIT_CLIENT_SECRET) {
    const token = await diditOAuthToken()
    resp = await fetch(`${DIDIT_BASE}/v1/session/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    })
  } else {
    throw new Error('Configura DIDIT_API_KEY (o DIDIT_CLIENT_ID/SECRET) en Supabase Secrets')
  }

  if (!resp.ok) throw new Error(`Didit session error (${resp.status}): ${await resp.text()}`)
  const data = await resp.json()
  const sessionId: string = data.session_id ?? data.id

  await db.from('users').update({
    didit_session_id: sessionId,
    kyc_status: 'in_progress',
    raw_data: { ...(u.raw_data ?? {}), diditSessionId: sessionId },
  }).eq('id', userId)

  return { url: data.url ?? data.session_url ?? data.verification_url, session_id: sessionId, kind: isBusiness ? 'KYB' : 'KYC' }
}

// Webhook de Didit (vendor_data = userId): actualiza el estado del cliente.
const mapDiditStatus = (s: string): string => {
  const v = (s ?? '').toLowerCase()
  if (v === 'approved') return 'verified'
  if (v === 'declined' || v === 'abandoned') return 'rejected'
  if (v === 'in review') return 'in_review'
  if (v === 'in progress') return 'in_progress'
  return 'pending'
}

async function handleDiditWebhook(db: any, req: Request) {
  const payload = await req.json()
  console.log('[didit-kyc] webhook:', JSON.stringify(payload).slice(0, 400))
  const { session_id, status, vendor_data } = payload
  const userId: string = vendor_data
  if (!userId || !session_id) return new Response('ok', { status: 200 })

  const kycStatus = mapDiditStatus(status)
  const { data: u } = await db.from('users').select('raw_data, notifications').eq('id', userId).single()
  if (!u) return new Response('ok', { status: 200 })
  const notifications = [...(u.notifications ?? [])]
  if (kycStatus === 'verified') {
    notifications.push({ id: Date.now(), type: 'kyc', read: false, title: 'Verificación aprobada',
      message: 'Tu verificación fue aprobada. Ya puedes operar con todos los servicios.', date: new Date().toLocaleDateString('es-CO') })
  } else if (kycStatus === 'rejected') {
    notifications.push({ id: Date.now(), type: 'kyc', read: false, title: 'Verificación rechazada',
      message: 'Tu verificación fue rechazada. Intenta de nuevo o contacta soporte.', date: new Date().toLocaleDateString('es-CO') })
  }
  await db.from('users').update({
    kyc_status: kycStatus,
    didit_session_id: session_id,
    notifications,
    raw_data: { ...(u.raw_data ?? {}), diditSessionId: session_id, diditStatus: status },
  }).eq('id', userId)
  console.log(`[didit-kyc] webhook: user ${userId} → ${kycStatus}`)
  return new Response('ok', { status: 200 })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const apiKey = (Deno.env.get('DIDIT_API_KEY') || '').trim()

    const url = new URL(req.url)
    let action = url.searchParams.get('action')

    if (action === 'ping') {
      return json({
        ok: true, version: 'v5.4-create-session',
        api_key: apiKey ? apiKey.slice(0, 8) + '...' : 'NO CONFIGURADA',
        workflow_kyc: DIDIT_WORKFLOW_ID || 'NO CONFIGURADO',
        workflow_kyb: DIDIT_WORKFLOW_ID_KYB || '(usa el de KYC)',
        client_id_legacy: DIDIT_CLIENT_ID ? DIDIT_CLIENT_ID.slice(0, 6) + '...' : 'no',
      })
    }

    // ── Webhook de Didit: POST /didit-kyc/webhook (sin JWT) ──
    if (url.pathname.endsWith('/webhook') && req.method === 'POST') {
      const sb = createClient(supabaseUrl, serviceRoleKey)
      try { return await handleDiditWebhook(sb, req) }
      catch (e) { console.error('[didit-kyc] webhook error:', (e as Error)?.message); return new Response('error', { status: 500 }) }
    }

    // ── Acciones del USUARIO (la app manda el action en el body JSON) ──
    // create_session/get_status NO exigen rol admin: las llama el propio
    // cliente al pulsar "Verificar ahora".
    let bodyJson: any = null
    if (!action && req.method === 'POST') {
      try { bodyJson = await req.json() } catch { /* sin body JSON */ }
      if (bodyJson?.action) action = bodyJson.action
    }
    if (action === 'create_session' || action === 'get_status') {
      const userId = bodyJson?.userId ?? url.searchParams.get('userId')
      if (!userId) return json({ error: 'Falta userId' }, 400)
      const sb = createClient(supabaseUrl, serviceRoleKey)
      try {
        if (action === 'create_session') return json(await createDiditSession(sb, apiKey, userId))
        const { data: u } = await sb.from('users').select('kyc_status, didit_session_id').eq('id', userId).single()
        return json({ status: u?.kyc_status ?? 'not_started', session_id: u?.didit_session_id ?? null })
      } catch (e) {
        console.error('[didit-kyc] user action error:', (e as Error)?.message)
        return json({ error: (e as Error)?.message ?? 'Error' }, 500)
      }
    }

    // ── get-image: proxy autenticado para media privada de Didit ──
    // Los <img src> del browser NO pueden mandar headers Authorization,
    // así que las URLs privadas de Didit daban 401/403 al renderizar.
    // Este action recibe la URL por query param, la fetchea server-side
    // inyectando el API key, y devuelve los bytes con su Content-Type.
    // Auth: JWT del admin como query param (?jwt=) porque el <img> no
    // puede mandar headers. Solo se permiten hosts de Didit/S3 para no
    // ser un open proxy.
    if (action === 'get-image') {
      const jwt    = url.searchParams.get('jwt') || ''
      const target = url.searchParams.get('url') || ''
      if (!jwt)    return json({ error: 'jwt required' }, 401)
      if (!target) return json({ error: 'url required' }, 400)

      let host = ''
      try { host = new URL(target).hostname } catch { return json({ error: 'bad url' }, 400) }
      const allowedHost =
        host === 'didit.me' || host.endsWith('.didit.me') ||
        host.endsWith('.amazonaws.com') || host.endsWith('.cloudfront.net')
      if (!allowedHost) return json({ error: 'host not allowed' }, 403)

      const sb = createClient(supabaseUrl, serviceRoleKey)
      const { data: { user: imgUser }, error: imgAuthErr } = await sb.auth.getUser(jwt)
      if (imgAuthErr || !imgUser) return json({ error: 'Unauthorized' }, 401)
      const { data: imgCaller } = await sb.from('users').select('role').eq('id', imgUser.id).single()
      if (!imgCaller || !['admin', 'super_admin'].includes(imgCaller.role))
        return json({ error: 'Forbidden' }, 403)

      // Fetch con escalada de auth: sin auth (S3 pre-firmada) → x-api-key → Bearer
      let r = await fetch(target)
      if (!r.ok && apiKey) r = await fetch(target, { headers: { 'x-api-key': apiKey } })
      if (!r.ok && apiKey) r = await fetch(target, { headers: { Authorization: `Bearer ${apiKey}` } })
      if (!r.ok) return json({ error: `upstream ${r.status}` }, 502)

      const ct = r.headers.get('content-type') || 'image/jpeg'
      return new Response(r.body, {
        headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=3600', ...CORS },
      })
    }

    const authHeader = req.headers.get('authorization')
    if (!authHeader) return json({ error: 'No auth' }, 401)

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: callerRow } = await supabase
      .from('users').select('role').eq('id', user.id).single()
    if (!callerRow || !['admin', 'super_admin'].includes(callerRow.role))
      return json({ error: 'Forbidden' }, 403)

    if (action === 'full') {
      let sessionId = url.searchParams.get('session_id')
      const userId = url.searchParams.get('user_id')
      const beneficiaryId = url.searchParams.get('beneficiary_id')
      const forceRefresh = url.searchParams.get('force') === 'true'

      if (!sessionId && userId) {
        const { data: u } = await supabase
          .from('users').select('didit_session_id').eq('id', userId).single()
        sessionId = u?.didit_session_id
      }
      if (!sessionId && beneficiaryId) {
        const { data: b } = await supabase
          .from('beneficiaries').select('didit_session_id').eq('id', beneficiaryId).single()
        sessionId = b?.didit_session_id
      }
      if (!sessionId) return json({ error: 'no_session' }, 404)

      // ────── CHECK CACHE FIRST ──────
      // v5.1: solo servimos cache si TIENE imágenes archivadas. Un cache sin
      // stored_images viene de antes del fix de media — sus URLs de Didit ya
      // vencieron, así que re-fetcheamos para archivar (self-heal).
      if (!forceRefresh) {
        const { data: cached } = await supabase
          .from('kyc_cache')
          .select('cached_response, stored_images, cached_at')
          .eq('session_id', sessionId)
          .single()

        const hasStoredMedia = cached?.stored_images && Object.keys(cached.stored_images).length > 0
        if (cached?.cached_response && hasStoredMedia) {
          console.log(`[didit-kyc] 📦 Serving from cache (${cached.cached_at})`)
          const response = cached.cached_response
          // Regenerate signed URLs for stored images
          await replaceWithLocalUrls(supabase, response, cached.stored_images)
          return json({ ...response, _source: 'cache', _cached_at: cached.cached_at })
        }
        if (cached?.cached_response && !hasStoredMedia) {
          console.log(`[didit-kyc] ♻️ Cache sin imágenes archivadas → re-fetch para archivar media`)
        }
      }

      // ────── FETCH FROM DIDIT ──────
      console.log(`[didit-kyc] 🌐 Fetching from Didit (force=${forceRefresh})`)
      let decisionData: any = null
      let decisionError: any = null

      if (apiKey) {
        try {
          const result = await fetchDidit(
            `${DIDIT_BASE}/v3/session/${sessionId}/decision/`, apiKey)
          if (result.ok) {
            decisionData = result.data
            console.log(`[didit-kyc] ✅ Status: ${decisionData?.status}`)
          } else {
            decisionError = result.data
          }
        } catch (e) {
          decisionError = { error: e.message }
        }
      }

      const effectiveData = decisionData || null
      const effectiveDecision = effectiveData?.decision || effectiveData || null
      const tabs = buildTabsFromDecision(effectiveDecision)
      const status = decisionData?.status || 'unknown'

      // ────── ARCHIVE IMAGES TO SUPABASE STORAGE ──────
      let storedImages: Record<string, string> = {}
      if (decisionData) {
        storedImages = await archiveImages(supabase, sessionId, tabs, apiKey)
      }

      // Build response
      const response = {
        session_id: sessionId,
        status,
        summary: {
          status,
          created_at: decisionData?.created_at,
          vendor_data: decisionData?.vendor_data,
        },
        ...tabs,
        _raw: {
          didit_decision: decisionData,
          didit_error: decisionError,
        },
      }

      // ────── SAVE TO CACHE ──────
      if (decisionData) {
        const { error: upsertErr } = await supabase
          .from('kyc_cache')
          .upsert({
            session_id: sessionId,
            user_id: userId || null,
            beneficiary_id: beneficiaryId || null,
            status,
            cached_response: response,
            stored_images: storedImages,
            cached_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'session_id' })

        if (upsertErr) console.warn(`[didit-kyc] Cache save error:`, upsertErr.message)
        else console.log(`[didit-kyc] 💾 Cached response + ${Object.keys(storedImages).length} images`)
      }

      // Replace Didit URLs with local signed URLs
      if (Object.keys(storedImages).length > 0) {
        await replaceWithLocalUrls(supabase, response, storedImages)
      }

      // Update user kyc_status
      if (userId && status) {
        const statusMap: Record<string, string> = {
          'Approved': 'approved', 'Declined': 'rejected',
          'In Review': 'in_progress', 'Expired': 'expired',
        }
        const newStatus = statusMap[status]
        if (newStatus) {
          await supabase.from('users')
            .update({ kyc_status: newStatus })
            .eq('id', userId)
        }
      }

      // Also update beneficiaries with this session
      if (sessionId && status) {
        const statusMap: Record<string, string> = {
          'Approved': 'approved', 'Declined': 'rejected',
          'In Review': 'in_progress', 'Expired': 'expired',
        }
        const newStatus = statusMap[status]
        if (newStatus) {
          await supabase.from('beneficiaries')
            .update({
              kyc_status: newStatus,
              ...(newStatus === 'approved' ? { kyc_verified_at: new Date().toISOString() } : {}),
            })
            .eq('didit_session_id', sessionId)
        }
      }

      return json({ ...response, _source: 'didit_live' })
    }

    // ── update_status: Sync CuyPay ↔ Didit status ──
    if (action === 'update_status') {
      const body = await req.json()
      const { session_id: sid, user_id: uid, new_status, comment } = body

      if (!sid) return json({ error: 'session_id required' }, 400)
      if (!new_status) return json({ error: 'new_status required' }, 400)

      // Map CuyPay status names to Didit API values
      const diditStatusMap: Record<string, string> = {
        'approved': 'Approved',
        'Approved': 'Approved',
        'rejected': 'Declined',
        'Rejected': 'Declined',
        'Declined': 'Declined',
        'declined': 'Declined',
        'resubmit': 'Resubmission Required',
        'Resubmission Required': 'Resubmission Required',
        'resubmission_required': 'Resubmission Required',
      }

      const diditStatus = diditStatusMap[new_status]
      if (!diditStatus) {
        return json({
          error: `Invalid status: ${new_status}. Valid: approved, rejected, resubmit`,
        }, 400)
      }

      // Map to CuyPay kyc_status
      const cuyStatusMap: Record<string, string> = {
        'Approved': 'approved',
        'Declined': 'rejected',
        'Resubmission Required': 'pending',
      }
      const cuyStatus = cuyStatusMap[diditStatus]

      // 1) Call Didit API to update status
      let diditResult: any = null
      if (apiKey) {
        try {
          console.log(`[didit-kyc] 🔄 Updating Didit session ${sid} → ${diditStatus}`)
          const patchRes = await fetch(
            `${DIDIT_BASE}/v3/session/${sid}/update-status/`,
            {
              method: 'PATCH',
              headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                new_status: diditStatus,
                comment: comment || `Status changed from CuyPay admin by ${user.email}`,
              }),
            },
          )
          const ct = patchRes.headers.get('content-type') || ''
          if (ct.includes('application/json')) {
            diditResult = await patchRes.json()
          } else {
            diditResult = { raw: await patchRes.text() }
          }
          console.log(`[didit-kyc] Didit PATCH response: ${patchRes.status}`, JSON.stringify(diditResult).slice(0, 500))

          if (!patchRes.ok) {
            return json({
              error: 'Didit API rejected the status update',
              didit_status: patchRes.status,
              didit_response: diditResult,
            }, 502)
          }
        } catch (e) {
          console.error(`[didit-kyc] Didit PATCH error:`, e.message)
          return json({ error: `Didit API error: ${e.message}` }, 502)
        }
      }

      // 2) Update CuyPay user kyc_status
      if (uid && cuyStatus) {
        const { error: updateErr } = await supabase
          .from('users')
          .update({
            kyc_status: cuyStatus,
            kyc_updated_at: new Date().toISOString(),
          })
          .eq('id', uid)

        if (updateErr) {
          console.warn(`[didit-kyc] User update error:`, updateErr.message)
        } else {
          console.log(`[didit-kyc] ✅ User ${uid} kyc_status → ${cuyStatus}`)
        }
      }

      // 2b) Update beneficiaries with this session_id
      if (sid && cuyStatus) {
        const kycVerifiedAt = cuyStatus === 'approved' ? new Date().toISOString() : null
        const { error: benErr, count } = await supabase
          .from('beneficiaries')
          .update({
            kyc_status: cuyStatus,
            ...(kycVerifiedAt ? { kyc_verified_at: kycVerifiedAt } : {}),
          })
          .eq('didit_session_id', sid)

        if (benErr) {
          console.warn(`[didit-kyc] Beneficiary update error:`, benErr.message)
        } else {
          console.log(`[didit-kyc] ✅ Beneficiaries with session ${sid} → ${cuyStatus} (${count} rows)`)
        }
      }

      // 3) Update cache if exists
      await supabase
        .from('kyc_cache')
        .update({
          status: diditStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('session_id', sid)

      // 4) Log the action in audit
      await supabase.from('kyc_events').insert({
        didit_session_id: sid,
        raw_payload: {
          action: 'status_update',
          old_status: null,
          new_status: diditStatus,
          cuypay_status: cuyStatus,
          changed_by: user.id,
          changed_by_email: user.email,
          comment: comment || null,
          didit_response: diditResult,
          timestamp: new Date().toISOString(),
        },
      })

      return json({
        ok: true,
        session_id: sid,
        didit_status: diditStatus,
        cuypay_status: cuyStatus,
        didit_response: diditResult,
        message: `Estado actualizado: ${diditStatus}`,
      })
    }

    return json({ error: 'Unknown action. Use: ping, full, update_status, get-image' }, 400)
  } catch (err) {
    console.error('[didit-kyc] Fatal:', err)
    return json({ error: err.message }, 500)
  }
})
