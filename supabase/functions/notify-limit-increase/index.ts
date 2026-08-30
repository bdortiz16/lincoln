// ════════════════════════════════════════════════════════
// notify-limit-increase — Correo (Resend) + Push (FCM/APNs) cuando una
// solicitud de ampliación de topes (limit_increase_requests) pasa a
// 'approved' o 'rejected'.
//
// Invocada por Supabase Database Webhook:
//   Tabla: public.limit_increase_requests · Evento: UPDATE
//   Payload estándar v1: { type:'UPDATE', table, record, old_record }
//
// Si la solicitud trae beneficiary_id, el mensaje aclara que el aumento
// es para ese CONTACTO (los topes se aplicaron en beneficiaries, no en
// users — ver trigger apply_limit_increase).
//
// Secrets necesarios:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (inyectados por Supabase)
//   RESEND_API_KEY                             correo
//   FROM_EMAIL                                 opcional, default onboarding@resend.dev
//   FCM_SERVICE_ACCOUNT                        JSON completo del service account de
//                                              Firebase (Project settings → Service
//                                              accounts → Generate new private key).
//                                              Si falta, el push se salta y solo va correo.
//
// Tokens push: se buscan en las tablas device_tokens / push_tokens /
// user_devices (columnas token|fcm_token|push_token|device_token) y en
// columnas de public.users (fcm_token, push_token, device_token) o en
// raw_data (fcmToken / fcm_token / pushToken). FCM entrega a Android y
// también a iOS vía APNs cuando la app está registrada en Firebase.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const APP_URL = (Deno.env.get('APP_BASE_URL') || 'https://lincoln-psi.vercel.app').replace(/\/+$/, '')
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FROM_EMAIL   = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev'
const FCM_SA_RAW   = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

// ─── Bloque editable de términos/información (Soporte → Formato de correos) ───
let FOOTER_NOTE = ''
async function loadFooterNote(): Promise<void> {
  try {
    const { data } = await db.from('app_settings').select('value').eq('key', 'email_footer_note').maybeSingle()
    const v = (data as any)?.value
    FOOTER_NOTE = (typeof v === 'string' ? v : (v?.content ?? '')) || ''
  } catch { FOOTER_NOTE = '' }
}
const footerNoteHtml = () => FOOTER_NOTE.trim()
  ? `<div style="margin:24px 0 0 0;padding:14px 16px;background-color:#F8FAFC;border:1px solid #e2e8f0;border-radius:10px">
      <p style="margin:0;font-size:11px;color:#64748b;line-height:1.7">${escapeHtml(FOOTER_NOTE.trim())}</p>
    </div>`
  : ''

// ─── Textos por evento editables desde el panel (app_settings 'email_templates') ───
// Keys: limit_approved / limit_rejected.
// Placeholders: {nombre}, {monto}, {contacto}, {motivo}
let TPL: Record<string, any> = {}
async function loadTemplates(): Promise<void> {
  try {
    const { data } = await db.from('app_settings').select('value').eq('key', 'email_templates').maybeSingle()
    const v = (data as any)?.value
    TPL = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
  } catch { TPL = {} }
}
const applyVars = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')

const BRAND_NAVY  = '#0C0E0D'
const BRAND_TEAL  = '#4ADE80'
const BRAND_TEAL2 = '#5EEAD4'
const BRAND_LIGHT = '#F8FAFC'

interface LirRecord {
  id: string
  user_id: string
  beneficiary_id?: string | null
  status: string
  requested_amount: string | number | null
  admin_notes: string | null
  reviewed_at: string | null
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: LirRecord
  old_record: LirRecord | null
}

type EventKind = 'approved' | 'rejected'

function detectEvent(record: LirRecord, old: LirRecord | null): EventKind | null {
  const prev = old?.status ?? null
  const next = record?.status
  if (next === 'approved' && prev !== 'approved') return 'approved'
  if (next === 'rejected' && prev !== 'rejected') return 'rejected'
  return null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br/>')
}

function fmtAmount(raw: string | number | null): string | null {
  const n = Number(String(raw ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return `${n.toLocaleString('es-CO')} USD`
}

const LOGO_SVG_DATAURI = `data:image/svg+xml;base64,${btoa(`
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="96" height="96" rx="24" fill="${BRAND_NAVY}"/>
  <path d="M34 30 H47 V58 H58 V71 H34 Z" fill="#F4F4F2"/>
  <circle cx="68" cy="67" r="12" fill="${BRAND_TEAL}"/>
</svg>`.trim())}`

// ─────────────────────────────────────────────
// Email HTML (misma plantilla brand que send-compliance-email)
// ─────────────────────────────────────────────
function htmlEmail(event: EventKind, name: string, benName: string | null, amount: string | null, notes: string | null): string {
  const accent  = event === 'approved' ? '#10B981' : '#DC2626'
  const heroLbl = event === 'approved' ? 'Solicitud aprobada' : 'Solicitud rechazada'
  const titleTx = benName ? `Ampliación de topes · Contacto ${escapeHtml(benName)}` : 'Ampliación de topes'

  const target = benName
    ? `los topes de tu contacto <strong style="color:${BRAND_NAVY}">${escapeHtml(benName)}</strong>`
    : 'tus topes de operación'

  // Override editable desde el panel (Soporte → Formato de correos)
  const ov = (TPL[`limit_${event}`] ?? {}) as any

  let message: string
  if (ov.message) {
    message = escapeHtml(applyVars(String(ov.message), {
      nombre: name, monto: amount ?? '', contacto: benName ?? '', motivo: (notes ?? '').trim(),
    }))
  } else if (event === 'approved') {
    message = `Hola <strong style="color:${BRAND_NAVY}">${escapeHtml(name)}</strong>, ¡buenas noticias! Aprobamos tu solicitud de ampliación${amount ? ` por <strong>${escapeHtml(amount)}</strong>` : ''} y ya aumentamos ${target}. Los nuevos topes están activos desde ahora.`
  } else {
    const motivo = (notes ?? '').trim()
      ? `<br/><br/><strong>Motivo:</strong> ${escapeHtml((notes ?? '').trim())}`
      : ''
    message = `Hola <strong style="color:${BRAND_NAVY}">${escapeHtml(name)}</strong>, lamentablemente no pudimos aprobar tu solicitud de ampliación${amount ? ` por ${escapeHtml(amount)}` : ''} para ${target}.${motivo}<br/><br/>Podés volver a intentarlo con documentación adicional o escribirnos por soporte.`
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(titleTx)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_LIGHT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND_LIGHT}">
<tr><td align="center" style="padding:40px 16px 48px">
  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08)">
    <tr>
      <td style="background-color:${BRAND_NAVY};padding:28px 32px">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width:48px;height:48px;vertical-align:middle">
              <img src="${LOGO_SVG_DATAURI}" width="48" height="48" alt="Lincoin" style="display:block;border-radius:12px"/>
            </td>
            <td style="padding-left:14px;vertical-align:middle">
              <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CUY<span style="color:${BRAND_TEAL}">PAY</span></span>
              <div style="margin-top:2px;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase">Topes y Límites</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background:linear-gradient(90deg,${accent} 0%,${BRAND_TEAL2} 50%,${accent} 100%);background-color:${accent};height:4px;line-height:4px;font-size:1px">&zwnj;</td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:36px 32px 28px">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:1.5px">${escapeHtml(heroLbl)}</p>
        <p style="margin:0 0 8px 0;font-size:26px;font-weight:800;color:${BRAND_NAVY};letter-spacing:-0.5px;line-height:1.2">${titleTx}</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
          <tr><td style="border-top:1px solid #f1f5f9;height:1px;font-size:0">&zwnj;</td></tr>
        </table>
        <p style="margin:0 0 24px 0;font-size:15px;color:#475569;line-height:1.7">${message}</p>
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-radius:10px;background-color:${BRAND_NAVY}">
              <a href="${APP_URL}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px">
                Abrir Lincoin →
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:28px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.6">
          Si no reconocés esta actividad, contactanos respondiendo a este correo o desde el chat de soporte.
        </p>
        ${footerNoteHtml()}
      </td>
    </tr>
    <tr>
      <td style="background-color:${BRAND_NAVY};padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 3px 0;font-size:11px;color:rgba(255,255,255,0.45);line-height:1.5">&copy; 2026 Lincoin &middot; Todos los derechos reservados</p>
              <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.25)">Mensaje automático &mdash; podés responderlo si es una alerta de seguridad.</p>
            </td>
            <td align="right" style="vertical-align:middle">
              <a href="${APP_URL}" style="font-size:11px;color:${BRAND_TEAL};text-decoration:none;font-weight:600">lincoin.me</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

// ─────────────────────────────────────────────
// Push — FCM HTTP v1 con service account (cubre Android y iOS/APNs)
// ─────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)))
}

async function getFcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`
    const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    const keyData = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.importKey(
      'pkcs8', keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign'],
    )
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)))
    const jwt = `${unsigned}.${b64url(sig)}`
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
    })
    const j = await res.json()
    if (!res.ok || !j.access_token) {
      console.error('[limit-notify] FCM oauth error:', res.status, JSON.stringify(j).slice(0, 300))
      return null
    }
    return j.access_token as string
  } catch (e) {
    console.error('[limit-notify] FCM oauth exception:', e)
    return null
  }
}

// Buscar tokens push del usuario en los lugares habituales sin asumir schema.
async function collectPushTokens(userId: string, userRow: Record<string, any> | null): Promise<string[]> {
  const tokens = new Set<string>()
  const pick = (row: Record<string, any>) => {
    for (const k of ['token', 'fcm_token', 'push_token', 'device_token', 'apns_token']) {
      const v = row?.[k]
      if (typeof v === 'string' && v.length > 20) tokens.add(v)
    }
  }
  for (const table of ['device_tokens', 'push_tokens', 'user_devices']) {
    try {
      const { data, error } = await db.from(table).select('*').eq('user_id', userId).limit(20)
      if (!error) for (const row of (data ?? []) as any[]) pick(row)
    } catch { /* tabla inexistente */ }
  }
  if (userRow) {
    pick(userRow)
    const rd = (userRow.raw_data ?? {}) as Record<string, any>
    for (const k of ['fcmToken', 'fcm_token', 'pushToken', 'push_token', 'deviceToken']) {
      const v = rd?.[k]
      if (typeof v === 'string' && v.length > 20) tokens.add(v)
    }
  }
  return Array.from(tokens)
}

async function sendPush(userId: string, userRow: Record<string, any> | null, title: string, body: string, data: Record<string, string>) {
  if (!FCM_SA_RAW) {
    console.log('[limit-notify] FCM_SERVICE_ACCOUNT not set — push skipped')
    return
  }
  let sa: any
  try { sa = JSON.parse(FCM_SA_RAW) } catch {
    console.error('[limit-notify] FCM_SERVICE_ACCOUNT is not valid JSON — push skipped')
    return
  }
  const tokens = await collectPushTokens(userId, userRow)
  if (tokens.length === 0) {
    console.log('[limit-notify] no push tokens found for user', userId)
    return
  }
  const access = await getFcmAccessToken(sa)
  if (!access) return

  for (const token of tokens) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data,
            android: { priority: 'HIGH', notification: { sound: 'default' } },
            apns: { payload: { aps: { sound: 'default', badge: 1 } } },
          },
        }),
      })
      const txt = await res.text()
      if (!res.ok) {
        // UNREGISTERED = token viejo; lo logueamos y seguimos con el resto
        console.warn('[limit-notify] FCM send failed', res.status, txt.slice(0, 200))
      } else {
        console.log('[limit-notify] push sent OK to token …' + token.slice(-8))
      }
    } catch (e) {
      console.error('[limit-notify] FCM send exception:', e)
    }
  }
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload
    if (payload.type !== 'UPDATE') return new Response('ignored_type', { status: 200 })

    const record = payload.record
    const old    = payload.old_record ?? null
    if (!record?.user_id) return new Response('no_user_id', { status: 200 })

    const event = detectEvent(record, old)
    if (!event) return new Response('no_event', { status: 200 })

    console.log(`[limit-notify] event=${event} request=${record.id} user=${record.user_id} beneficiary=${record.beneficiary_id ?? '—'}`)

    // Usuario (select * para poder rescatar tokens push de cualquier columna)
    const { data: user, error: uerr } = await db
      .from('users').select('*').eq('id', record.user_id).maybeSingle()
    if (uerr) console.error('[limit-notify] user lookup error:', uerr.message)

    // Nombre del contacto si el aumento es por beneficiario
    let benName: string | null = null
    if (record.beneficiary_id) {
      try {
        const { data: ben } = await db.from('beneficiaries').select('*').eq('id', record.beneficiary_id).maybeSingle()
        benName = (ben as any)?.full_name ?? (ben as any)?.name ?? (ben as any)?.alias ?? (ben as any)?.nickname ?? null
      } catch { /* no bloquea la notificación */ }
    }

    const prefs = ((user as any)?.raw_data ?? {}) as Record<string, any>
    const name   = (user as any)?.full_name || 'Usuario'
    const amount = fmtAmount(record.requested_amount)

    const pushTitle = event === 'approved'
      ? 'Ampliación de topes aprobada 🎉'
      : 'Ampliación de topes rechazada'
    const pushBody = event === 'approved'
      ? (benName
          ? `Aumentamos los topes de tu contacto ${benName}${amount ? ` a ${amount}` : ''}. Ya están activos.`
          : `Tus nuevos topes${amount ? ` de ${amount}` : ''} ya están activos.`)
      : (benName
          ? `No pudimos aprobar el aumento para tu contacto ${benName}. Revisá los detalles en la app.`
          : 'No pudimos aprobar tu solicitud. Revisá los detalles en la app.')

    // Push (no depende de las prefs de email; es la notificación in-app que pidió iOS)
    await sendPush(record.user_id, user as any, pushTitle, pushBody, {
      type: 'limit_increase',
      status: event,
      request_id: record.id,
      beneficiary_id: record.beneficiary_id ?? '',
    })

    // Email
    if (!RESEND_KEY) {
      console.log('[limit-notify] RESEND_API_KEY not set — email skipped')
      return new Response('push_only', { status: 200 })
    }
    if (prefs.notifCompliance === false) {
      console.log('[limit-notify] user disabled notifCompliance — email skipped')
      return new Response('pref_off', { status: 200 })
    }
    const email = (user as any)?.email
    if (!email) return new Response('no_email', { status: 200 })

    await loadFooterNote()
    await loadTemplates()
    let subject = event === 'approved'
      ? `Lincoin · Ampliación de topes aprobada${benName ? ` — Contacto ${benName}` : ''}`
      : `Lincoin · Ampliación de topes rechazada${benName ? ` — Contacto ${benName}` : ''}`
    const ovSubject = (TPL[`limit_${event}`] as any)?.subject
    if (ovSubject) subject = applyVars(String(ovSubject), { nombre: name, monto: amount ?? '', contacto: benName ?? '' })

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM_EMAIL}>`,
        to: email,
        subject,
        html: htmlEmail(event, name, benName, amount, record.admin_notes),
      }),
    })
    const body = await res.text()
    if (!res.ok) {
      console.error('[limit-notify] Resend error', res.status, body)
      return new Response('email_error', { status: 500 })
    }

    console.log('[limit-notify] email sent OK:', body.slice(0, 200))
    return new Response('sent', { status: 200 })
  } catch (e) {
    console.error('[limit-notify] exception:', e)
    return new Response('error', { status: 500 })
  }
})
