import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev'

const db = createClient(SUPABASE_URL, SERVICE_KEY)

// ─── Bloque editable de términos/información (Soporte → Formato de correos) ───
// Se lee de app_settings key 'email_footer_note' y se muestra al pie de
// todos los correos, antes del footer. Vacío = no se muestra nada.
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
// Shape: { "tx_load": { subject, message }, ... }. Placeholders: {nombre},
// {monto}, {de}, {para}. Si no hay override, se usa el texto por defecto.
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
// tx_created es un alias visual de convert — comparten textos
const tplKeyOf = (type: string) => type === 'tx_created' ? 'tx_convert' : `tx_${type}`

// Brand colors — palette Lincoin (matches landing + favicon + admin web).
const BRAND_NAVY  = '#0C0E0D'
const BRAND_TEAL  = '#4ADE80'
const BRAND_TEAL2 = '#5EEAD4'
const BRAND_LIGHT = '#F8FAFC'

interface TxRecord {
  id: number
  user_id: string
  type: string
  amount: number
  currency: string
  status: string
  raw_data: Record<string, any>
}

// Tipos soportados. Cualquier otro se ignora silenciosamente.
const NOTIFY_TYPES = new Set([
  'pay_received', 'pay_sent', 'load', 'send',
  'otc_deposit', 'otc_withdraw',
  'convert', 'tx_created',
])

function fmt(amount: number, currency: string) {
  const displayCurrency = currency.includes('_') ? currency.split('_')[0] : currency
  return `${Number(amount).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${displayCurrency}`
}

function networkLabel(currency: string, rawData?: Record<string, any>): string {
  const chain = rawData?.chain ?? rawData?.walletKey ?? currency
  if (chain === 'USDT_TRON' || chain === 'TRON')  return 'TRC-20 (Tron)'
  if (chain === 'USDT_BSC'  || chain === 'BSC')    return 'BEP-20 (BSC)'
  if (chain === 'USDC_BSC')                         return 'BEP-20 (BSC)'
  if (chain === 'USDC_BASE' || chain === 'BASE')    return 'Base'
  return chain
}

// Subject limpio — NUNCA mete el nombre del event type (load/send/tx_created/…).
// Solo lenguaje natural para el usuario.
function buildSubject(tx: TxRecord): string {
  const a = fmt(tx.amount, tx.currency)
  if (tx.type === 'pay_received')                  return `Lincoin · Recibiste ${a}`
  if (tx.type === 'pay_sent')                      return `Lincoin · Enviaste ${a}`
  if (tx.type === 'load')                          return `Lincoin · Recibimos tu depósito de ${a}`
  if (tx.type === 'send')                          return `Lincoin · Recibimos tu retiro de ${a}`
  if (tx.type === 'otc_deposit')                   return `Lincoin · Depósito de ${a} acreditado`
  if (tx.type === 'otc_withdraw')                  return `Lincoin · Retiro de ${a} procesado`
  if (tx.type === 'convert' || tx.type === 'tx_created') {
    const dest = tx.raw_data?.destCurrency ?? tx.raw_data?.to_currency
    if (dest) return `Lincoin · Conversión ${a} → ${dest}`
    return `Lincoin · Recibimos tu operación de ${a}`
  }
  return `Lincoin · Movimiento de ${a}`
}

// Subject/mensaje para el correo de COMPLETADO (cuando el estado pasa a
// Completado en una UPDATE — ej. un retiro que Mouv ya pagó, un depósito
// aprobado). Distinto del correo de "creado/montado" que va en el INSERT.
function buildSubjectCompleted(tx: TxRecord): string {
  const a = fmt(tx.amount, tx.currency)
  if (tx.type === 'send' || tx.type === 'otc_withdraw') return `Lincoin · Tu retiro de ${a} se completó`
  if (tx.type === 'load' || tx.type === 'otc_deposit')  return `Lincoin · Tu depósito de ${a} se acreditó`
  if (tx.type === 'convert' || tx.type === 'tx_created') return `Lincoin · Tu conversión de ${a} se completó`
  return `Lincoin · Tu operación de ${a} se completó`
}

function buildMessageCompleted(tx: TxRecord, name: string): string {
  const greet = `Hola <strong style="color:${BRAND_NAVY}">${name}</strong>,`
  const ov = (TPL[`${tplKeyOf(tx.type)}_done`] ?? {}) as any
  if (ov.message) return escNote(applyVars(String(ov.message), { nombre: name, monto: fmt(tx.amount, tx.currency) }))
  if (tx.type === 'send' || tx.type === 'otc_withdraw')
    return `${greet} tu retiro se <strong>completó</strong> y el dinero ya fue enviado al destino.`
  if (tx.type === 'load' || tx.type === 'otc_deposit')
    return `${greet} tu depósito fue <strong>acreditado</strong> a tu saldo.`
  if (tx.type === 'convert' || tx.type === 'tx_created')
    return `${greet} tu conversión se <strong>completó</strong> y ya está reflejada en tu saldo.`
  return `${greet} tu operación se <strong>completó</strong>.`
}

// Solo TEAL como accent. Variamos por tipo solo de etiqueta, no de color
// — la marca pide consistencia visual.
const ACCENT = BRAND_TEAL

function txTypeLabel(type: string): string {
  if (type === 'pay_received')                       return 'Dinero recibido'
  if (type === 'pay_sent')                           return 'Transferencia enviada'
  if (type === 'load')                               return 'Solicitud de depósito'
  if (type === 'send')                               return 'Solicitud de retiro'
  if (type === 'otc_deposit')                        return 'Depósito OTC acreditado'
  if (type === 'otc_withdraw')                       return 'Retiro OTC procesado'
  if (type === 'convert' || type === 'tx_created')   return 'Conversión'
  return 'Movimiento'
}

function txStatusText(type: string): string {
  if (type === 'pay_received')                       return 'Acreditado'
  if (type === 'pay_sent')                           return 'Enviado'
  if (type === 'load')                               return 'En revisión'
  if (type === 'send')                               return 'En proceso'
  if (type === 'otc_deposit')                        return 'Acreditado en tu wallet'
  if (type === 'otc_withdraw')                       return 'Enviado a blockchain'
  if (type === 'convert' || type === 'tx_created')   return 'Completada'
  return 'Procesado'
}

function buildMessage(tx: TxRecord, name: string): string {
  const from = tx.raw_data?.senderName || 'un usuario Lincoin'
  const to   = tx.raw_data?.recipientName || 'un usuario Lincoin'
  const greet = `Hola <strong style="color:${BRAND_NAVY}">${name}</strong>,`

  // Override editable desde el panel (Soporte → Formato de correos)
  const ov = (TPL[tplKeyOf(tx.type)] ?? {}) as any
  if (ov.message) {
    return escNote(applyVars(String(ov.message), {
      nombre: name, monto: fmt(tx.amount, tx.currency), de: from, para: to,
    }))
  }

  if (tx.type === 'pay_received')
    return `${greet} <strong>${from}</strong> te envió dinero. El monto ya está disponible en tu saldo.`
  if (tx.type === 'pay_sent')
    return `${greet} tu transferencia a <strong>${to}</strong> fue procesada exitosamente.`
  if (tx.type === 'load')
    return `${greet} recibimos tu solicitud de depósito y la estamos <strong>revisando</strong>. Te avisamos cuando se acredite.`
  if (tx.type === 'send')
    return `${greet} estamos <strong>procesando</strong> tu solicitud de retiro. Te avisamos cuando se complete.`
  if (tx.type === 'otc_deposit') {
    const net = networkLabel(tx.currency, tx.raw_data)
    return `${greet} detectamos tu depósito en la red <strong>${net}</strong> y se acreditó automáticamente en tu wallet OTC.`
  }
  if (tx.type === 'otc_withdraw') {
    const net = networkLabel(tx.currency, tx.raw_data)
    const addr = tx.raw_data?.toAddress ?? tx.raw_data?.address ?? ''
    return `${greet} tu retiro en la red <strong>${net}</strong> fue enviado a la blockchain.${addr ? ` Dirección: <code style="font-size:11px">${addr.slice(0,12)}…${addr.slice(-8)}</code>` : ''}`
  }
  if (tx.type === 'convert' || tx.type === 'tx_created') {
    const dest = tx.raw_data?.destCurrency ?? tx.raw_data?.to_currency
    if (dest) return `${greet} tu conversión a <strong>${dest}</strong> se completó. Ya está reflejada en tu saldo.`
    return `${greet} recibimos tu operación y ya está confirmada.`
  }
  return `${greet} registramos un movimiento en tu cuenta.`
}

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;padding:10px 0 0 0;vertical-align:top;width:40%">${label}</td>
    <td style="font-size:14px;font-weight:600;color:${BRAND_NAVY};padding:10px 0 0 0;vertical-align:top">${value}</td>
  </tr>`
}

function buildDetailRows(tx: TxRecord, completed = false): string {
  const rows: string[] = []
  const now = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })

  if (tx.type === 'pay_received') rows.push(detailRow('De', tx.raw_data?.senderName || 'Usuario Lincoin'))
  if (tx.type === 'pay_sent')     rows.push(detailRow('Para', tx.raw_data?.recipientName || 'Usuario Lincoin'))

  if (tx.type === 'otc_deposit' || tx.type === 'otc_withdraw') {
    rows.push(detailRow('Red', networkLabel(tx.currency, tx.raw_data)))
    const txId = tx.raw_data?.txId
    if (txId) rows.push(detailRow('TxID', `${txId.slice(0, 14)}…${txId.slice(-8)}`))
  }

  if (tx.type === 'convert' || tx.type === 'tx_created') {
    const rd = tx.raw_data ?? {}
    const fromAmount = rd.fromAmount ?? rd.fromAmt
    const rate = rd.mouvRate
    const feePct = rd.feePct
    const gfFee = rd.gasfreeFee
    const dest = rd.destCurrency ?? rd.to_currency
    rows.push(detailRow('Detalle', `Conversión ${rd.fromCurrency ?? 'USD'} → ${dest ?? tx.currency}`))
    if (fromAmount != null) rows.push(detailRow('Convertiste', `${Number(fromAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`))
    if (rate != null) rows.push(detailRow('Tasa aplicada', `1 USD = ${Number(rate).toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP`))
    if (feePct != null) rows.push(detailRow('Comisión Lincoin', `${feePct}%`))
    if (gfFee != null) rows.push(detailRow('Comisión de red', `${Number(gfFee).toFixed(2)} USDT`))
    rows.push(detailRow('Recibiste', fmt(tx.amount, tx.currency)))
    rows.push(detailRow('Fecha', now))
    rows.push(detailRow('Referencia', `#${tx.id}`))
    rows.push(detailRow('Estado', completed ? 'Completado' : txStatusText(tx.type)))
    return rows.join('')
  }

  rows.push(detailRow('Monto', fmt(tx.amount, tx.currency)))
  rows.push(detailRow('Fecha', now))
  rows.push(detailRow('Referencia', `#${tx.id}`))
  rows.push(detailRow('Estado', completed ? 'Completado' : txStatusText(tx.type)))

  return rows.join('')
}

// Logo Lincoin como PNG HOSTEADO (Gmail bloquea imágenes SVG y muchos data
// URIs → el logo salía roto). Se sirve desde el sitio en https, que sí carga.
const LOGO_SVG_DATAURI = 'https://lincoln-psi.vercel.app/cuypay-email-logo.png'

function htmlEmail(tx: TxRecord, name: string, subject: string, completed = false): string {
  const label   = completed ? 'Operación completada' : txTypeLabel(tx.type)
  const message = completed ? buildMessageCompleted(tx, name) : buildMessage(tx, name)
  const details = buildDetailRows(tx, completed)
  const amount  = fmt(tx.amount, tx.currency)

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_LIGHT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND_LIGHT}">
<tr><td align="center" style="padding:40px 16px 48px">

  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08)">

    <!-- HEADER navy con logo Lincoin (SVG inline) -->
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
                    <div style="margin-top:2px;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase">Tu dinero sin fronteras</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ACCENT LINE TEAL -->
    <tr>
      <td style="background:linear-gradient(90deg,${BRAND_TEAL} 0%,${BRAND_TEAL2} 50%,${BRAND_TEAL} 100%);background-color:${BRAND_TEAL};height:4px;line-height:4px;font-size:1px">&zwnj;</td>
    </tr>

    <!-- BODY -->
    <tr>
      <td style="background-color:#ffffff;padding:36px 32px 28px">

        <!-- Tipo + monto hero -->
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:${ACCENT};text-transform:uppercase;letter-spacing:1.5px">${label}</p>
        <p style="margin:0 0 8px 0;font-size:42px;font-weight:800;color:${BRAND_NAVY};letter-spacing:-1.8px;line-height:1">${amount}</p>

        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
          <tr><td style="border-top:1px solid #f1f5f9;height:1px;font-size:0">&zwnj;</td></tr>
        </table>

        <!-- Mensaje -->
        <p style="margin:0 0 24px 0;font-size:15px;color:#475569;line-height:1.7">${message}</p>

        <!-- Detail card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
          style="background-color:${BRAND_LIGHT};border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px">
          <tr>
            <td style="padding:14px 22px 22px 22px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${details}
              </table>
            </td>
          </tr>
        </table>

        <!-- CTA -->
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-radius:10px;background-color:${BRAND_NAVY}">
              <a href="https://lincoln-psi.vercel.app" target="_blank"
                style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px">
                Abrir Lincoin &rarr;
              </a>
            </td>
          </tr>
        </table>

        <!-- Aviso de seguridad -->
        <p style="margin:28px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.6">
          Si no reconocés esta operación, contactanos respondiendo a este correo y revisamos tu cuenta.
        </p>
        ${footerNoteHtml()}

      </td>
    </tr>

    <!-- FOOTER navy -->
    <tr>
      <td style="background-color:${BRAND_NAVY};padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 3px 0;font-size:11px;color:rgba(255,255,255,0.45);line-height:1.5">
                &copy; 2026 Lincoin &middot; Todos los derechos reservados
              </p>
              <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.25)">
                Mensaje automático &mdash; por favor no respondas a este correo a menos que sea una alerta de seguridad.
              </p>
            </td>
            <td align="right" style="vertical-align:middle">
              <a href="https://lincoln-psi.vercel.app" style="font-size:11px;color:${BRAND_TEAL};text-decoration:none;font-weight:600">lincoin.me</a>
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

// Correo genérico de marca para eventos que NO son transacciones (ej.
// "Contacto aprobado"). Mismo look que los comprobantes.
function customHtmlEmail(title: string, message: string, subject: string): string {
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light only"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:${BRAND_LIGHT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND_LIGHT}"><tr><td align="center" style="padding:40px 16px 48px">
  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08)">
    <tr><td style="background-color:${BRAND_NAVY};padding:28px 32px">
      <img src="${LOGO_SVG_DATAURI}" width="44" height="44" alt="Lincoin" style="display:inline-block;border-radius:11px;vertical-align:middle"/>
      <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;vertical-align:middle;margin-left:12px">CUY<span style="color:${BRAND_TEAL}">PAY</span></span>
    </td></tr>
    <tr><td style="background-color:${BRAND_TEAL};height:4px;line-height:4px;font-size:1px">&zwnj;</td></tr>
    <tr><td style="background-color:#ffffff;padding:36px 32px 28px">
      <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;color:${BRAND_TEAL};text-transform:uppercase;letter-spacing:1.5px">Notificación</p>
      <p style="margin:0 0 16px 0;font-size:24px;font-weight:800;color:${BRAND_NAVY};letter-spacing:-0.5px;line-height:1.2">${title}</p>
      <p style="margin:0 0 24px 0;font-size:15px;color:#475569;line-height:1.7">${message}</p>
      <table cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background-color:${BRAND_NAVY}">
        <a href="https://lincoln-psi.vercel.app" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">Abrir Lincoin &rarr;</a>
      </td></tr></table>
      ${footerNoteHtml()}
    </td></tr>
    <tr><td style="background-color:${BRAND_NAVY};padding:20px 32px">
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.45)">&copy; 2026 Lincoin &middot; <a href="https://lincoln-psi.vercel.app" style="color:${BRAND_TEAL};text-decoration:none">lincoin.me</a></p>
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

Deno.serve(async (req) => {
  try {
    if (!RESEND_KEY) {
      console.error('[notify] RESEND_API_KEY secret not set — emails disabled')
      return new Response('no_key', { status: 200 })
    }

    const payload = await req.json()
    console.log('[notify] webhook type:', payload.type, 'table:', payload.table)

    // ── Correo genérico (eventos que no son transacciones, ej. contacto
    //    aprobado). Solo llamadas INTERNAS con el service role — así el
    //    cliente no puede mandar correos a direcciones arbitrarias. El
    //    remitente decide el destinatario leyéndolo de la base, no del body
    //    del cliente. ────────────────────────────────────────────────────
    if (payload.type === 'CUSTOM_EMAIL') {
      const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      if (!SERVICE_KEY || auth !== SERVICE_KEY) return new Response('forbidden', { status: 403 })
      const to = String(payload.to ?? '')
      if (!to) return new Response('no_to', { status: 200 })
      await loadFooterNote()
      const subject = String(payload.subject ?? 'Lincoin')
      const html = customHtmlEmail(String(payload.title ?? 'Notificación'), String(payload.message ?? ''), subject)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `Lincoin <${FROM_EMAIL}>`, to, subject, html }),
      })
      const body = await res.text()
      if (!res.ok) { console.error('[notify] custom email error', res.status, body); return new Response('email_error', { status: 500 }) }
      return new Response('sent', { status: 200 })
    }

    const op = payload.type as string
    if (op !== 'INSERT' && op !== 'UPDATE') return new Response('ok', { status: 200 })

    const tx: TxRecord = payload.record
    console.log('[notify] op:', op, 'tx.type:', tx.type, 'tx.status:', tx.status, 'tx.user_id:', tx.user_id, 'tx.amount:', tx.amount)

    if (!NOTIFY_TYPES.has(tx.type)) {
      console.log('[notify] skipping type:', tx.type)
      return new Response('skipped', { status: 200 })
    }

    // ── ¿Correo de CREADO o de COMPLETADO? ──
    // Se decide por el ESTADO, no por INSERT/UPDATE:
    //  - status 'Completado' → correo "se completó/acreditó" (flag notified_completed)
    //  - cualquier otro (Pendiente…) → correo "en proceso/en revisión" (flag notified)
    // Así llegan los DOS correos en el flujo con espera (envío bancario:
    // creado Pendiente + luego Completado), UNO solo en los instantáneos
    // (conversión / envío a wallet que ya nacen Completado), y nunca
    // repetidos porque cada etapa usa su propio flag de dedup.
    const completed = String(tx.status) === 'Completado'
    const dedupFlag = completed ? 'notified_completed' : 'notified'

    // Atomic deduplication (por flag).
    const { data: claimed } = await db
      .from('transactions')
      .update({ raw_data: { ...(tx.raw_data ?? {}), [dedupFlag]: true } })
      .eq('id', tx.id)
      .filter(`raw_data->>${dedupFlag}`, 'is', null)
      .select('id')

    if (!claimed || claimed.length === 0) {
      console.log('[notify] duplicate — tx', tx.id, `already ${dedupFlag}, skipping`)
      return new Response('duplicate', { status: 200 })
    }

    const { data: user, error: userErr } = await db
      .from('users')
      .select('email, full_name, raw_data')
      .eq('id', tx.user_id)
      .single()

    if (userErr) console.error('[notify] user lookup error:', userErr.message)
    console.log('[notify] user found:', user?.email ?? 'none')

    if (!user?.email) return new Response('no_email', { status: 200 })

    const prefs = user.raw_data ?? {}
    const prefMap: Record<string, string> = {
      pay_sent:     'notifTransfers',
      pay_received: 'notifTransfers',
      load:         'notifDeposits',
      send:         'notifDeposits',
      otc_deposit:  'notifDeposits',
      otc_withdraw: 'notifDeposits',
      convert:      'notifTransfers',
      tx_created:   'notifTransfers',
    }
    const prefKey = prefMap[tx.type]
    if (prefKey && prefs[prefKey] === false) {
      console.log('[notify] user disabled', prefKey, '— skipping')
      return new Response('pref_off', { status: 200 })
    }

    const name = user.full_name || 'Usuario'
    await loadFooterNote()
    await loadTemplates()
    let subject = completed ? buildSubjectCompleted(tx) : buildSubject(tx)
    const tplLookupKey = completed ? `${tplKeyOf(tx.type)}_done` : tplKeyOf(tx.type)
    const ovSubject = (TPL[tplLookupKey] as any)?.subject
    if (ovSubject) subject = applyVars(String(ovSubject), { nombre: name, monto: fmt(tx.amount, tx.currency) })

    const emailPayload = {
      from: `Lincoin <${FROM_EMAIL}>`,
      to: user.email,
      subject,
      html: htmlEmail(tx, name, subject, completed),
    }
    console.log('[notify] sending to:', user.email, 'from:', FROM_EMAIL, 'subject:', subject)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    })

    const resBody = await res.text()
    if (!res.ok) {
      console.error('[notify] Resend error', res.status, resBody)
      return new Response('email_error', { status: 500 })
    }

    console.log('[notify] email sent OK:', resBody)
    return new Response('sent', { status: 200 })
  } catch (e) {
    console.error('[notify] exception:', e)
    return new Response('error', { status: 500 })
  }
})
