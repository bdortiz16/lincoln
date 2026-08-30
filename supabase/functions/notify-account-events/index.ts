// ════════════════════════════════════════════════════════
// notify-account-events — Correos de marca Lincoin para TODOS los
// eventos de cuenta que antes no notificaban nada:
//
//   users (UPDATE):
//     • kyc_status → approved/verified   "Tu cuenta fue aprobada"
//     • kyc_status → rejected            "Verificación rechazada"
//     • bloqueo (is_blocked/is_active)   "Cuenta suspendida" / "Cuenta reactivada"
//     • pin_hash cambia                  "Tu PIN fue actualizado" (alerta seguridad)
//     • pin_hash → null                  "Tu PIN fue reseteado"
//     • is_2fa_enabled on/off            "2FA activado" / "2FA desactivado" (alerta)
//     • email cambia                     "Tu correo de acceso cambió" (alerta)
//
//   beneficiaries (UPDATE) → correo al DUEÑO:
//     • kyc_status → approved            "Tu contacto fue aprobado"
//     • kyc_status → rejected            "Verificación del contacto rechazada"
//     • is_active true→false             "Contacto bloqueado"
//     • is_active false→true             "Contacto reactivado"
//
// Mismo diseño de marca que notify-transaction / send-compliance-email
// (header navy + logo, línea accent, hero, CTA, footer).
//
// Configurar con DOS Database Webhooks apuntando a esta función:
//   1) tabla public.users          · evento UPDATE
//   2) tabla public.beneficiaries  · evento UPDATE
//
// Secrets: RESEND_API_KEY, FROM_EMAIL (opcional), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (inyectados).
//
// Preferencias: los eventos de KYC/bloqueo respetan raw_data.notifKyc /
// notifCompliance = false. Las ALERTAS DE SEGURIDAD (PIN, 2FA, cambio de
// correo) se envían SIEMPRE — silenciarlas sería un riesgo.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const APP_URL = (Deno.env.get('APP_BASE_URL') || 'https://lincoln-psi.vercel.app').replace(/\/+$/, '')
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FROM_EMAIL   = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev'

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
// Shape: { "kyc_approved": { subject, title, message }, ... }
// Placeholders: {nombre}, {correo}, {motivo}, {contacto}
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

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: Record<string, any>
  old_record: Record<string, any> | null
}

interface EventDef {
  key: string
  security: boolean          // alertas de seguridad: se envían siempre
  subject: string
  heroLabel: string
  accent: string
  title: string
  message: (name: string, rec: Record<string, any>, benName?: string) => string
  cta: string
}

const GREEN = '#10B981'
const RED   = '#DC2626'
const AMBER = '#F59E0B'

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br/>')
}

const APPROVED_SET = new Set(['approved', 'verified', 'completed'])
const isApproved = (s: unknown) => APPROVED_SET.has(String(s ?? '').toLowerCase())
const isRejected = (s: unknown) => ['rejected', 'declined'].includes(String(s ?? '').toLowerCase())

// ─────────────────────────────────────────────
// Detección del evento según la transición
// ─────────────────────────────────────────────
function detectUserEvent(rec: Record<string, any>, old: Record<string, any>): EventDef | null {
  // KYC
  if (isApproved(rec.kyc_status) && !isApproved(old.kyc_status)) {
    return {
      key: 'kyc_approved', security: false, accent: GREEN,
      subject: 'Lincoin · ¡Tu cuenta fue aprobada! 🎉',
      heroLabel: 'Cuenta aprobada', title: 'Verificación completada',
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, ¡bienvenido! Tu identidad fue verificada con éxito y tu cuenta Lincoin quedó completamente activa. Ya puedes cargar dinero, enviar a tus contactos y convertir divisas.`,
      cta: 'Abrir Lincoin →',
    }
  }
  if (isRejected(rec.kyc_status) && !isRejected(old.kyc_status)) {
    return {
      key: 'kyc_rejected', security: false, accent: RED,
      subject: 'Lincoin · No pudimos verificar tu identidad',
      heroLabel: 'Verificación rechazada', title: 'Necesitamos revisar tu identidad',
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, no pudimos completar la verificación de tu identidad. Abre la app para ver el motivo y volver a intentarlo — normalmente basta con repetir las fotos con buena luz.`,
      cta: 'Reintentar verificación',
    }
  }
  // Bloqueo / desbloqueo
  const wasBlocked = old.is_blocked === true || old.is_active === false
  const nowBlocked = rec.is_blocked === true || rec.is_active === false
  if (nowBlocked && !wasBlocked) {
    return {
      key: 'account_blocked', security: false, accent: AMBER,
      subject: 'Lincoin · Tu cuenta fue suspendida temporalmente',
      heroLabel: 'Cuenta suspendida', title: 'Necesitamos documentación adicional',
      message: (n, r) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, tu cuenta fue suspendida temporalmente por nuestro equipo de cumplimiento${r.block_reason ? ` (motivo: ${escapeHtml(r.block_reason)})` : ''}. Abre la app y ve al <strong>Centro de Cumplimiento</strong> para subir la documentación requerida y reactivarla.`,
      cta: 'Abrir Centro de Cumplimiento',
    }
  }
  if (!nowBlocked && wasBlocked) {
    return {
      key: 'account_unblocked', security: false, accent: GREEN,
      subject: 'Lincoin · Tu cuenta fue reactivada ✅',
      heroLabel: 'Cuenta reactivada', title: 'Todo en orden',
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, revisamos tu documentación y tu cuenta quedó reactivada. Ya puedes operar con normalidad. Gracias por tu paciencia.`,
      cta: 'Abrir Lincoin →',
    }
  }
  // PIN
  if (old.pin_hash && !rec.pin_hash) {
    return {
      key: 'pin_reset', security: true, accent: AMBER,
      subject: 'Lincoin · Tu PIN fue reseteado',
      heroLabel: 'Alerta de seguridad', title: 'PIN reseteado',
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, tu PIN fue reseteado. La próxima vez que entres a la app te pediremos crear uno nuevo. <strong>Si no lo solicitaste, responde a este correo de inmediato.</strong>`,
      cta: 'Abrir Lincoin →',
    }
  }
  if (rec.pin_hash && rec.pin_hash !== old.pin_hash) {
    return {
      key: 'pin_changed', security: true, accent: BRAND_TEAL,
      subject: 'Lincoin · Tu PIN fue actualizado',
      heroLabel: 'Alerta de seguridad', title: 'PIN actualizado',
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, ${old.pin_hash ? 'tu PIN de seguridad fue cambiado' : 'configuraste tu PIN de seguridad'} correctamente. <strong>Si no fuiste tú, responde a este correo de inmediato.</strong>`,
      cta: 'Abrir Lincoin →',
    }
  }
  // 2FA
  if (rec.is_2fa_enabled === true && old.is_2fa_enabled !== true) {
    return {
      key: '2fa_on', security: true, accent: GREEN,
      subject: 'Lincoin · 2FA activado en tu cuenta',
      heroLabel: 'Alerta de seguridad', title: 'Autenticación en dos pasos activada',
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, activaste la autenticación en dos pasos. Desde ahora pediremos un código de 6 dígitos para tus envíos de dinero. <strong>Si no fuiste tú, responde a este correo de inmediato.</strong>`,
      cta: 'Abrir Lincoin →',
    }
  }
  if (rec.is_2fa_enabled === false && old.is_2fa_enabled === true) {
    return {
      key: '2fa_off', security: true, accent: AMBER,
      subject: 'Lincoin · 2FA desactivado en tu cuenta',
      heroLabel: 'Alerta de seguridad', title: 'Autenticación en dos pasos desactivada',
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, la autenticación en dos pasos de tu cuenta fue <strong>desactivada</strong>. Si no fuiste tú, responde a este correo de inmediato y reactívala desde Ajustes → Seguridad.`,
      cta: 'Revisar seguridad',
    }
  }
  // Cambio de correo de acceso
  if (rec.email && old.email && rec.email !== old.email) {
    return {
      key: 'email_changed', security: true, accent: AMBER,
      subject: 'Lincoin · Tu correo de acceso cambió',
      heroLabel: 'Alerta de seguridad', title: 'Correo de acceso actualizado',
      message: (n, r) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, el correo de acceso de tu cuenta cambió a <strong>${escapeHtml(r.email)}</strong>. Si no solicitaste este cambio, responde a este correo de inmediato.`,
      cta: 'Abrir Lincoin →',
    }
  }
  return null
}

function detectBeneficiaryEvent(rec: Record<string, any>, old: Record<string, any>): EventDef | null {
  const bn = rec.full_name ?? rec.name ?? 'tu contacto'
  if (isApproved(rec.kyc_status) && !isApproved(old.kyc_status)) {
    return {
      key: 'ben_approved', security: false, accent: GREEN,
      subject: `Lincoin · Tu contacto ${bn} fue aprobado ✅`,
      heroLabel: 'Contacto aprobado', title: `${bn} ya puede recibir`,
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, la verificación de tu contacto <strong>${escapeHtml(bn)}</strong> fue aprobada. Ya puedes enviarle dinero sin restricciones.`,
      cta: 'Enviar dinero →',
    }
  }
  if (isRejected(rec.kyc_status) && !isRejected(old.kyc_status)) {
    return {
      key: 'ben_rejected', security: false, accent: RED,
      subject: `Lincoin · La verificación de ${bn} fue rechazada`,
      heroLabel: 'Contacto rechazado', title: `No pudimos verificar a ${bn}`,
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, la verificación de identidad de tu contacto <strong>${escapeHtml(bn)}</strong> fue rechazada. Abre la app para ver el motivo y reintentar la verificación.`,
      cta: 'Ver detalles',
    }
  }
  if (rec.is_active === false && old.is_active !== false) {
    return {
      key: 'ben_blocked', security: false, accent: AMBER,
      subject: `Lincoin · Tu contacto ${bn} fue bloqueado temporalmente`,
      heroLabel: 'Contacto bloqueado', title: `Operaciones hacia ${bn} suspendidas`,
      message: (n, r) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, las operaciones hacia tu contacto <strong>${escapeHtml(bn)}</strong> fueron suspendidas por cumplimiento${r.block_reason ? ` (motivo: ${escapeHtml(r.block_reason)})` : ''}. Revisa el Centro de Cumplimiento para ver la documentación requerida.`,
      cta: 'Abrir Centro de Cumplimiento',
    }
  }
  if (rec.is_active === true && old.is_active === false) {
    return {
      key: 'ben_unblocked', security: false, accent: GREEN,
      subject: `Lincoin · Tu contacto ${bn} fue reactivado ✅`,
      heroLabel: 'Contacto reactivado', title: `${bn} vuelve a estar activo`,
      message: (n) => `Hola <strong style="color:${BRAND_NAVY}">${n}</strong>, tu contacto <strong>${escapeHtml(bn)}</strong> fue reactivado y ya puedes volver a enviarle dinero.`,
      cta: 'Enviar dinero →',
    }
  }
  return null
}

// ─────────────────────────────────────────────
// Template de marca (idéntico a notify-transaction / compliance)
// ─────────────────────────────────────────────
const LOGO_SVG_DATAURI = `data:image/svg+xml;base64,${btoa(`
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="96" height="96" rx="24" fill="${BRAND_NAVY}"/>
  <path d="M34 30 H47 V58 H58 V71 H34 Z" fill="#F4F4F2"/>
  <circle cx="68" cy="67" r="12" fill="${BRAND_TEAL}"/>
</svg>`.trim())}`

function htmlEmail(ev: EventDef, name: string, rec: Record<string, any>): string {
  const message = ev.message(escapeHtml(name), rec)
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(ev.subject)}</title>
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
              <div style="margin-top:2px;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase">${ev.security ? 'Seguridad' : 'Tu cuenta'}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background:linear-gradient(90deg,${ev.accent} 0%,${BRAND_TEAL2} 50%,${ev.accent} 100%);background-color:${ev.accent};height:4px;line-height:4px;font-size:1px">&zwnj;</td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:36px 32px 28px">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:${ev.accent};text-transform:uppercase;letter-spacing:1.5px">${escapeHtml(ev.heroLabel)}</p>
        <p style="margin:0 0 8px 0;font-size:26px;font-weight:800;color:${BRAND_NAVY};letter-spacing:-0.5px;line-height:1.2">${escapeHtml(ev.title)}</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
          <tr><td style="border-top:1px solid #f1f5f9;height:1px;font-size:0">&zwnj;</td></tr>
        </table>
        <p style="margin:0 0 24px 0;font-size:15px;color:#475569;line-height:1.7">${message}</p>
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-radius:10px;background-color:${BRAND_NAVY}">
              <a href="${APP_URL}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px">
                ${escapeHtml(ev.cta)}
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
// Handler
// ─────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    if (!RESEND_KEY) {
      console.error('[account-events] RESEND_API_KEY not set — emails disabled')
      return new Response('no_key', { status: 200 })
    }

    const payload = (await req.json()) as WebhookPayload
    if (payload.type !== 'UPDATE' || !payload.record || !payload.old_record) {
      return new Response('ignored', { status: 200 })
    }

    const rec = payload.record
    const old = payload.old_record
    let ev: EventDef | null = null
    let targetUserId: string | null = null

    if (payload.table === 'users') {
      ev = detectUserEvent(rec, old)
      targetUserId = rec.id
    } else if (payload.table === 'beneficiaries') {
      ev = detectBeneficiaryEvent(rec, old)
      targetUserId = rec.owner_user_id ?? rec.user_id ?? null
    }

    if (!ev || !targetUserId) return new Response('no_event', { status: 200 })
    console.log(`[account-events] event=${ev.key} table=${payload.table} user=${targetUserId}`)

    // Destinatario (para eventos de tercero: el dueño)
    const { data: user } = await db
      .from('users').select('email, full_name, raw_data').eq('id', targetUserId).maybeSingle()
    const email = payload.table === 'users' ? (rec.email ?? user?.email) : user?.email
    if (!email) return new Response('no_email', { status: 200 })

    // Preferencias: solo silencian los eventos NO de seguridad
    const prefs = ((user as any)?.raw_data ?? {}) as Record<string, any>
    if (!ev.security && (prefs.notifKyc === false || prefs.notifCompliance === false)) {
      console.log('[account-events] prefs off — skipping', ev.key)
      return new Response('pref_off', { status: 200 })
    }

    const name = (user as any)?.full_name || 'Usuario'
    await loadFooterNote()
    await loadTemplates()

    // Overrides editables desde el panel
    const ov = (TPL[ev.key] ?? {}) as any
    const vars = {
      nombre: name,
      correo: String(email),
      motivo: String(rec.block_reason ?? ''),
      contacto: payload.table === 'beneficiaries' ? String(rec.full_name ?? rec.name ?? '') : '',
    }
    if (ov.subject) ev = { ...ev, subject: applyVars(String(ov.subject), vars) }
    if (ov.title)   ev = { ...ev, title: applyVars(String(ov.title), vars) }
    if (ov.message) {
      const msg = escapeHtml(applyVars(String(ov.message), vars))
      ev = { ...ev, message: () => msg }
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM_EMAIL}>`,
        to: email,
        subject: ev.subject,
        html: htmlEmail(ev, name, rec),
      }),
    })
    const body = await res.text()
    if (!res.ok) {
      console.error('[account-events] Resend error', res.status, body)
      return new Response('email_error', { status: 500 })
    }

    console.log('[account-events] sent', ev.key, 'to', email)
    return new Response('sent', { status: 200 })
  } catch (e) {
    console.error('[account-events] exception:', e)
    return new Response('error', { status: 500 })
  }
})
