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

const otpEmailHtml = (code: string, name: string) => `
<!doctype html><html><body style="margin:0;background:#070808;font-family:Archivo,Arial,sans-serif">
  <div style="max-width:440px;margin:0 auto;padding:40px 24px;color:#F4F4F2">
    <p style="font-size:22px;font-weight:800;letter-spacing:-0.5px;margin:0 0 24px">Lincoin<span style="color:#4ADE80">.</span></p>
    <p style="font-size:15px;color:#F4F4F2;margin:0 0 6px">Hola${name ? ` ${name}` : ''},</p>
    <p style="font-size:13.5px;color:#878E88;line-height:1.5;margin:0 0 22px">Usa este código para confirmar tu ingreso a Lincoin. Vence en 10 minutos.</p>
    <div style="background:#0C0E0D;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:22px;text-align:center">
      <span style="font-size:34px;font-weight:800;letter-spacing:10px;color:#4ADE80;font-family:ui-monospace,Menlo,monospace">${code}</span>
    </div>
    <p style="font-size:12px;color:#878E88;line-height:1.5;margin:22px 0 0">Si no intentaste iniciar sesión, ignora este correo y cambia tu contraseña.</p>
    <p style="font-size:11px;color:rgba(244,244,242,0.45);margin:26px 0 0"><a href="${APP_URL}" style="color:#4ADE80;text-decoration:none">lincoin.me</a> · Este código es personal, nunca lo compartas.</p>
  </div>
</body></html>`

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
          subject: `Tu código de ingreso: ${code}`,
          html: otpEmailHtml(code, String(user.full_name ?? '').split(' ')[0] ?? ''),
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

function maskEmail(e: string): string {
  const [u, d] = e.split('@')
  if (!d) return e
  const head = u.length <= 2 ? u[0] : u.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`
}
