// ══════════════════════════════════════════════════════════════════
//  email-otp — verificación en dos pasos por CORREO al iniciar sesión.
//  Genera un código de 6 dígitos, lo guarda hasheado con expiración en
//  users.raw_data.otp y lo envía por Resend desde el dominio lincoin.me.
//  Acciones: 'send' (emite y manda el código) · 'verify' (valida).
//  Nada de secretos en el front: RESEND_API_KEY y FROM_EMAIL son secrets.
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
// Remitente: idealmente no-reply@lincoin.me (dominio verificado en Resend).
const FROM_EMAIL   = Deno.env.get('OTP_FROM_EMAIL') ?? Deno.env.get('FROM_EMAIL') ?? 'no-reply@lincoin.me'
const APP_URL      = (Deno.env.get('APP_BASE_URL') || 'https://lincoln-psi.vercel.app').replace(/\/+$/, '')
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Hash SHA-256 del código (no se guarda el código en claro).
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function findUser(email?: string, userId?: string) {
  if (userId) return db.from('users').select('id, email, full_name, raw_data').eq('id', userId).maybeSingle()
  return db.from('users').select('id, email, full_name, raw_data').ilike('email', String(email ?? '')).maybeSingle()
}

// Espacio fino cada 3 dígitos para leer mejor el código (482 916).
const spacedCode = (c: string) => c.replace(/(\d{3})(\d{3})/, '$1 $2')
const otpEmailHtml = (code: string, name: string, meta: { device?: string; loc?: string; time?: string; userId?: string }) => `
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F0EFEB">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0EFEB"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid rgba(21,24,26,0.08);border-radius:14px">
<tr><td style="padding:28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-family:'Archivo',Arial,sans-serif;font-size:22px;font-weight:800;color:#15181A">Lincoin<span style="color:#22A35C">.</span></td>
    <td align="right" style="font-family:Arial,sans-serif;font-size:11px;color:#9B9F9B">Correo de seguridad</td>
  </tr></table>
  <p style="font-family:'Archivo',Arial,sans-serif;font-size:19px;font-weight:800;color:#15181A;margin:26px 0 10px">Tu código de acceso</p>
  <p style="font-family:Arial,sans-serif;font-size:13.5px;color:#5C625E;line-height:1.6;margin:0 0 20px">Hola${name ? `, ${name}` : ''}. Alguien está intentando iniciar sesión en tu cuenta Lincoin. Usa este código para continuar:</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#F4F4F1;border-radius:10px;padding:22px">
    <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:800;letter-spacing:10px;color:#15181A">${spacedCode(code)}</span>
  </td></tr></table>
  <p style="font-family:Arial,sans-serif;font-size:12.5px;color:#5C625E;text-align:center;margin:12px 0 22px">Vence en <b style="color:#15181A">10 minutos</b> · Un solo uso</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:12.5px">
    ${meta.device ? `<tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Dispositivo</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${meta.device}</td></tr>` : ''}
    ${meta.loc ? `<tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Ubicación aproximada</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${meta.loc}</td></tr>` : ''}
    <tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Hora</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${meta.time ?? new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) + ' (GMT-5)'}</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr><td style="background:#F4F4F1;border-radius:10px;padding:16px">
    <p style="font-family:Arial,sans-serif;font-size:12.5px;color:#15181A;font-weight:700;margin:0 0 6px">¿No fuiste tú?</p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#5C625E;line-height:1.6;margin:0">Ignora este correo y <a href="${APP_URL}" style="color:#22A35C;text-decoration:none;font-weight:600">cambia tu contraseña ahora</a>. Nadie puede entrar sin este código. Recuerda: <b>nunca</b> te pediremos el código por teléfono, WhatsApp ni correo.</p>
  </td></tr></table>
  ${footerHtml(`Recibiste este correo porque hay una cuenta en Lincoin${meta.userId ? ` (ID ${meta.userId})` : ''} asociada a esta dirección.`)}
</td></tr></table>
</td></tr></table>
</body></html>`

const footerHtml = (why: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid rgba(21,24,26,0.06)"><tr><td style="padding-top:18px">
    <p style="font-family:Arial,sans-serif;font-size:11.5px;color:#5C625E;font-weight:600;margin:0 0 10px">
      <a href="${APP_URL}" style="color:#5C625E;text-decoration:none">Centro de ayuda</a> · <a href="${APP_URL}" style="color:#5C625E;text-decoration:none">Seguridad</a> · <a href="${APP_URL}" style="color:#5C625E;text-decoration:none">Preferencias de correo</a>
    </p>
    <p style="font-family:Arial,sans-serif;font-size:10.5px;color:#9B9F9B;line-height:1.6;margin:0">${why} Lincoin no es un banco. Los criptoactivos no están cubiertos por fondos de garantía de depósitos. El dólar digital (USDT) se mantiene 1:1 con dólares y la custodia opera sobre infraestructura GasFree/Fireblocks. © 2026 Lincoin.</p>
  </td></tr></table>`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const email = body.email ? String(body.email).trim() : undefined
    const userId = body.userId ? String(body.userId) : undefined
    if (!email && !userId) return json(400, { error: 'missing_identity' })

    const { data: user } = await findUser(email, userId)
    if (!user) return json(404, { error: 'user_not_found' })
    const raw = (user.raw_data ?? {}) as Record<string, any>

    if (action === 'send') {
      if (!RESEND_KEY) return json(200, { ok: false, error: 'email_not_configured', message: 'Falta RESEND_API_KEY.' })
      // Rate-limit suave: no reenviar si se emitió hace < 30 s.
      const prev = raw.otp
      if (prev?.sentAt && Date.now() - Number(prev.sentAt) < 30000) {
        return json(200, { ok: true, throttled: true, message: 'Ya te enviamos un código. Revisa tu correo.' })
      }
      const code = String(Math.floor(100000 + Math.random() * 900000)) // 6 dígitos
      const codeHash = await sha256(code)
      const otp = { codeHash, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0, sentAt: Date.now() }
      await db.from('users').update({ raw_data: { ...raw, otp } }).eq('id', user.id)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Lincoin <${FROM_EMAIL}>`, to: [user.email],
          subject: `${spacedCode(code)} es tu código de Lincoin`,
          html: otpEmailHtml(code, String(user.full_name ?? '').split(' ')[0] ?? '', {
            device: deviceFromUA(req.headers.get('user-agent') ?? ''),
            loc: undefined,
            time: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }) + ' (GMT-5)',
            userId: String(user.id ?? '').slice(0, 8).toUpperCase(),
          }),
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        return json(200, { ok: false, error: 'send_failed', status: res.status, detail: t.slice(0, 200) })
      }
      return json(200, { ok: true, sent: true, to: maskEmail(String(user.email ?? '')) })
    }

    if (action === 'verify') {
      const code = String(body.code ?? '').trim()
      if (!/^\d{6}$/.test(code)) return json(200, { ok: false, error: 'bad_code' })
      const otp = raw.otp
      if (!otp?.codeHash) return json(200, { ok: false, error: 'no_code', message: 'Solicita un código nuevo.' })
      if (Date.now() > Number(otp.expiresAt)) return json(200, { ok: false, error: 'expired', message: 'El código venció. Pide uno nuevo.' })
      if (Number(otp.attempts ?? 0) >= 5) return json(200, { ok: false, error: 'too_many', message: 'Demasiados intentos. Pide un código nuevo.' })
      const ok = (await sha256(code)) === otp.codeHash
      if (!ok) {
        await db.from('users').update({ raw_data: { ...raw, otp: { ...otp, attempts: Number(otp.attempts ?? 0) + 1 } } }).eq('id', user.id)
        return json(200, { ok: false, error: 'invalid', message: 'Código incorrecto.' })
      }
      // Éxito: se limpia el OTP.
      const { otp: _drop, ...rest } = raw
      await db.from('users').update({ raw_data: rest }).eq('id', user.id)
      return json(200, { ok: true, verified: true, userId: user.id })
    }

    return json(400, { error: 'bad_action' })
  } catch (e) {
    return json(500, { error: 'internal', message: (e as Error)?.message ?? String(e) })
  }
})

// Dispositivo legible desde el user-agent ("Chrome · macOS").
function deviceFromUA(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Navegador'
  const os = /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'dispositivo'
  return `${browser} · ${os}`
}

function maskEmail(e: string): string {
  const [u, d] = e.split('@')
  if (!d) return e
  const head = u.length <= 2 ? u[0] : u.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`
}
