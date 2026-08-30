// ════════════════════════════════════════════════════════
// send-compliance-email — Envía un correo al usuario cuando su
// solicitud de documentación (document_requests) cambia de estado.
//
// Casos que dispara:
//   • APROBADA        → status pasa a 'approved'
//   • RECHAZADA       → status pasa a 'rejected'
//   • REABIERTA       → status pasa a 'pending' desde 'rejected'
//                       (admin le da otra chance al usuario)
//
// Diseñado para ser invocado por Supabase Database Webhook con
// filtro on UPDATE de public.document_requests. El payload es el
// estándar de Supabase Webhook v1:
//   { type:'UPDATE', table, record, old_record }
//
// También sirve invocada manualmente vía POST con { record, old_record }.
//
// Secrets necesarios:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   FROM_EMAIL (opcional, default onboarding@resend.dev)
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
const escNote = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br/>')
const footerNoteHtml = () => FOOTER_NOTE.trim()
  ? `<div style="margin:24px 0 0 0;padding:14px 16px;background-color:#F8FAFC;border:1px solid #e2e8f0;border-radius:10px">
      <p style="margin:0;font-size:11px;color:#64748b;line-height:1.7">${escNote(FOOTER_NOTE.trim())}</p>
    </div>`
  : ''

// ─── Textos por evento editables desde el panel (app_settings 'email_templates') ───
// Keys: doc_approved / doc_rejected / doc_reopened.
// Placeholders: {nombre}, {categoria}, {motivo}
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

// Brand palette Lincoin — misma que usa notify-transaction y el favicon.
const BRAND_NAVY  = '#0C0E0D'
const BRAND_TEAL  = '#4ADE80'
const BRAND_TEAL2 = '#5EEAD4'
const BRAND_LIGHT = '#F8FAFC'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface DocRequestRecord {
  id: string
  user_id: string
  category: string
  title: string | null
  description: string | null
  status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'escalated' | 'canceled'
  review_notes: string | null
  file_url: string | null
  reviewed_at: string | null
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: DocRequestRecord
  old_record: DocRequestRecord | null
}

type EventKind = 'approved' | 'rejected' | 'reopened'

// ─────────────────────────────────────────────
// Detección del evento a partir de la transición de status
// ─────────────────────────────────────────────
function detectEvent(record: DocRequestRecord, old: DocRequestRecord | null): EventKind | null {
  if (!record) return null
  const prev = old?.status ?? null
  const next = record.status

  if (next === 'approved' && prev !== 'approved') return 'approved'
  if (next === 'rejected' && prev !== 'rejected') return 'rejected'
  // Reabierta = pasa a 'pending' viniendo de 'rejected'. Ignoramos el pending
  // inicial (INSERT sin old) para no mandar un email al crear la solicitud.
  if (next === 'pending' && prev === 'rejected') return 'reopened'

  return null
}

// ─────────────────────────────────────────────
// Slugs → labels legibles (mismo mapa que el admin y BlockUserModal)
// ─────────────────────────────────────────────
const DOC_SLUG_LABELS: Record<string, string> = {
  cedula_front:    'Cédula / ID (frente)',
  cedula_back:     'Cédula / ID (dorso)',
  selfie:          'Selfie con documento',
  proof_address:   'Comprobante de dirección',
  proof_income:    'Comprobante de ingresos',
  bank_statement:  'Extracto bancario',
  source_of_funds: 'Declaración de origen de fondos',
  tax_return:      'Declaración de impuestos',
}

const CATEGORY_LABELS: Record<string, string> = {
  source_of_funds:     'Origen de fondos',
  transaction_purpose: 'Propósito de la transacción',
  beneficiary_id:      'ID del beneficiario',
  employment:          'Empleo / ingresos',
  address:             'Comprobante de domicilio',
  limit_increase:      'Ampliación de topes',
  block_unlock:        'Levantamiento de bloqueo',
  other:               'Solicitud de documentación',
  ...DOC_SLUG_LABELS,
}

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? 'Solicitud de documentación'
}

// ─────────────────────────────────────────────
// Templates — subject + hero + message + CTA
// ─────────────────────────────────────────────
function buildSubject(event: EventKind, catLabel: string): string {
  if (event === 'approved') return `Lincoin · ${catLabel} aprobada`
  if (event === 'rejected') return `Lincoin · ${catLabel} rechazada`
  return `Lincoin · Necesitamos que vuelvas a subir tu documentación`
}

function buildHeroLabel(event: EventKind): string {
  if (event === 'approved') return 'Documentación aprobada'
  if (event === 'rejected') return 'Documentación rechazada'
  return 'Solicitud reabierta'
}

function buildAccent(event: EventKind): string {
  if (event === 'approved') return '#10B981' // emerald
  if (event === 'rejected') return '#DC2626' // red
  return '#F59E0B'                            // amber (reopen)
}

function buildMessage(event: EventKind, name: string, record: DocRequestRecord): string {
  const catLabel = categoryLabel(record.category)
  const reason = (record.review_notes ?? '').trim()

  // Override editable desde el panel (Soporte → Formato de correos)
  const ov = (TPL[`doc_${event}`] ?? {}) as any
  if (ov.message) {
    return escapeHtml(applyVars(String(ov.message), { nombre: name, categoria: catLabel, motivo: reason }))
  }

  if (event === 'approved') {
    return `Hola <strong style="color:${BRAND_NAVY}">${name}</strong>, ¡tu documentación (${catLabel}) fue aprobada con éxito! Tu cuenta ya se encuentra completamente activa y podés seguir operando con normalidad.`
  }
  if (event === 'rejected') {
    const motivo = reason
      ? `<br/><br/><strong>Motivo:</strong> ${escapeHtml(reason)}`
      : ''
    return `Hola <strong style="color:${BRAND_NAVY}">${name}</strong>, lamentablemente tu documentación (${catLabel}) fue rechazada.${motivo}<br/><br/>Si tenés dudas o querés apelar, respondé a este correo o contactanos por soporte.`
  }
  // reopened
  const comentario = reason
    ? `<br/><br/><strong>Comentario del administrador:</strong> ${escapeHtml(reason)}`
    : ''
  return `Hola <strong style="color:${BRAND_NAVY}">${name}</strong>, necesitamos que vuelvas a subir tu documentación (${catLabel}) para completar la revisión.${comentario}<br/><br/>Abrí la app Lincoin y andá al <strong>Centro de Cumplimiento</strong> para volver a subir los archivos.`
}

function buildCtaLabel(event: EventKind): string {
  if (event === 'approved') return 'Abrir Lincoin →'
  if (event === 'rejected') return 'Contactar soporte'
  return 'Abrir Centro de Cumplimiento'
}

// Escape básico para no romper el HTML si el admin puso HTML en review_notes.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br/>')
}

// ─────────────────────────────────────────────
// Logo Lincoin inline como SVG (mismo del favicon + notify-transaction)
// ─────────────────────────────────────────────
const LOGO_SVG_DATAURI = `data:image/svg+xml;base64,${btoa(`
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="96" height="96" rx="24" fill="${BRAND_NAVY}"/>
  <path d="M34 30 H47 V58 H58 V71 H34 Z" fill="#F4F4F2"/>
  <circle cx="68" cy="67" r="12" fill="${BRAND_TEAL}"/>
</svg>`.trim())}`

// ─────────────────────────────────────────────
// HTML del correo
// ─────────────────────────────────────────────
function htmlEmail(event: EventKind, name: string, subject: string, record: DocRequestRecord): string {
  const accent   = buildAccent(event)
  const heroLbl  = buildHeroLabel(event)
  const message  = buildMessage(event, name, record)
  const catLabel = categoryLabel(record.category)
  const cta      = buildCtaLabel(event)

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_LIGHT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND_LIGHT}">
<tr><td align="center" style="padding:40px 16px 48px">

  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08)">

    <!-- HEADER navy con logo Lincoin -->
    <tr>
      <td style="background-color:${BRAND_NAVY};padding:28px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:48px;height:48px;vertical-align:middle">
                    <img src="${LOGO_SVG_DATAURI}" width="48" height="48" alt="Lincoin" style="display:block;border-radius:12px"/>
                  </td>
                  <td style="padding-left:14px;vertical-align:middle">
                    <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CUY<span style="color:${BRAND_TEAL}">PAY</span></span>
                    <div style="margin-top:2px;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase">Centro de Cumplimiento</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ACCENT line (color del evento) -->
    <tr>
      <td style="background:linear-gradient(90deg,${accent} 0%,${BRAND_TEAL2} 50%,${accent} 100%);background-color:${accent};height:4px;line-height:4px;font-size:1px">&zwnj;</td>
    </tr>

    <!-- BODY -->
    <tr>
      <td style="background-color:#ffffff;padding:36px 32px 28px">

        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:1.5px">${escapeHtml(heroLbl)}</p>
        <p style="margin:0 0 8px 0;font-size:26px;font-weight:800;color:${BRAND_NAVY};letter-spacing:-0.5px;line-height:1.2">${escapeHtml(catLabel)}</p>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
          <tr><td style="border-top:1px solid #f1f5f9;height:1px;font-size:0">&zwnj;</td></tr>
        </table>

        <p style="margin:0 0 24px 0;font-size:15px;color:#475569;line-height:1.7">${message}</p>

        ${event !== 'approved' && record.file_url ? `
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND_LIGHT};border:1px solid #e2e8f0;border-radius:12px;margin-bottom:20px">
            <tr><td style="padding:14px 18px">
              <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Archivo referido</p>
              <p style="margin:6px 0 0 0;font-size:13px;color:${BRAND_NAVY};word-break:break-all">
                <a href="${escapeHtml(record.file_url)}" target="_blank" style="color:${BRAND_NAVY};text-decoration:underline">${escapeHtml(catLabel)}</a>
              </p>
            </td></tr>
          </table>
        ` : ''}

        <!-- CTA -->
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-radius:10px;background-color:${BRAND_NAVY}">
              <a href="${APP_URL}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px">
                ${escapeHtml(cta)}
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

    <!-- FOOTER -->
    <tr>
      <td style="background-color:${BRAND_NAVY};padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 3px 0;font-size:11px;color:rgba(255,255,255,0.45);line-height:1.5">
                &copy; 2026 Lincoin &middot; Todos los derechos reservados
              </p>
              <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.25)">
                Mensaje automático &mdash; podés responderlo si es una alerta de seguridad.
              </p>
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
      console.error('[compliance-email] RESEND_API_KEY not set — emails disabled')
      return new Response('no_key', { status: 200 })
    }

    const payload = (await req.json()) as WebhookPayload
    console.log('[compliance-email] webhook type:', payload.type, 'table:', payload.table)

    if (payload.type !== 'UPDATE' && payload.type !== 'INSERT') {
      return new Response('ignored_type', { status: 200 })
    }

    const record = payload.record
    const old    = payload.old_record ?? null
    if (!record || !record.user_id) {
      console.warn('[compliance-email] no record.user_id — payload:', JSON.stringify(payload).slice(0, 400))
      return new Response('no_user_id', { status: 200 })
    }

    const event = detectEvent(record, old)
    if (!event) {
      console.log('[compliance-email] no state transition worth notifying — ignoring')
      return new Response('no_event', { status: 200 })
    }

    console.log(`[compliance-email] event=${event} request=${record.id} user=${record.user_id}`)

    // Fetch user email + name
    const { data: user, error: userErr } = await db
      .from('users')
      .select('email, full_name, raw_data')
      .eq('id', record.user_id)
      .single()
    if (userErr) {
      console.error('[compliance-email] user lookup error:', userErr.message)
    }
    if (!user?.email) {
      console.warn('[compliance-email] user has no email — skip')
      return new Response('no_email', { status: 200 })
    }

    // Respetar preferencias del user (mismo esquema que notify-transaction)
    const prefs = (user.raw_data ?? {}) as Record<string, any>
    if (prefs.notifCompliance === false || prefs.notifKyc === false) {
      console.log('[compliance-email] user disabled notifCompliance — skipping')
      return new Response('pref_off', { status: 200 })
    }

    const catLabel = categoryLabel(record.category)
    const name     = user.full_name || 'Usuario'
    await loadFooterNote()
    await loadTemplates()
    let subject = buildSubject(event, catLabel)
    const ovSubject = (TPL[`doc_${event}`] as any)?.subject
    if (ovSubject) subject = applyVars(String(ovSubject), { nombre: name, categoria: catLabel })

    const emailPayload = {
      from:    `Lincoin <${FROM_EMAIL}>`,
      to:      user.email,
      subject,
      html:    htmlEmail(event, name, subject, record),
    }
    console.log('[compliance-email] sending to:', user.email, 'from:', FROM_EMAIL, 'subject:', subject)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    })
    const body = await res.text()
    if (!res.ok) {
      console.error('[compliance-email] Resend error', res.status, body)
      return new Response('email_error', { status: 500 })
    }

    console.log('[compliance-email] email sent OK:', body)
    return new Response('sent', { status: 200 })
  } catch (e) {
    console.error('[compliance-email] exception:', e)
    return new Response('error', { status: 500 })
  }
})
