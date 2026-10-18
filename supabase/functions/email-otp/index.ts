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

// Hash SHA-256 (solo para leer códigos emitidos antes del cambio a HMAC).
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
// El código se guarda como HMAC con una llave que solo tiene el servidor. Con
// un SHA-256 simple, quien leyera raw_data.otp (el propio titular puede leer
// su fila) sacaba el código probando el millón de combinaciones en segundos.
async function hmacCodigo(userId: string, code: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(`email-otp|${SERVICE_KEY}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${userId}:${code}`)))
  return Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')
}
function igualesHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
// Código de 6 dígitos con el generador criptográfico (Math.random no lo es).
function codigoNuevo(): string {
  const n = new Uint32Array(1)
  crypto.getRandomValues(n)
  return String(100000 + (n[0] % 900000))
}

function findUser(email?: string, userId?: string) {
  if (userId) return db.from('users').select('id, email, full_name, raw_data').eq('id', userId).maybeSingle()
  // Comparación sin mayúsculas pero SIN comodines: con '%' o '_' en el correo,
  // ilike encontraba cuentas ajenas por patrón (enumeración de correos).
  const e = String(email ?? '').trim().toLowerCase()
  if (!e || /[%*\\,()]/.test(e)) return Promise.resolve({ data: null, error: null } as any)
  return db.from('users').select('id, email, full_name, raw_data').ilike('email', e.replace(/_/g, '\\_')).maybeSingle()
}

// La IP la pone el proxy de la plataforma: el primer valor de X-Forwarded-For
// lo escribe el cliente.
function ipDe(req: Request): string {
  const directa = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim()
  if (directa) return directa
  const saltos = (req.headers.get('x-forwarded-for') ?? '').split(',').map(x => x.trim()).filter(Boolean)
  return saltos.length ? saltos[saltos.length - 1] : ''
}
const escHtml = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Freno de envíos por IP y por correo, para TODOS los correos (existan o no).
// Sin él, cualquiera podía inundar buzones ajenos y gastar la cuota de envío;
// y como el freno de 30 s solo existía para cuentas reales, repetir la
// petición decía si el correo tenía cuenta. Se lleva en audit_log.
const MAX_ENVIOS_IP_10M = 15
async function frenoEnvio(ip: string, claveCorreo: string): Promise<'ip' | 'correo' | null> {
  try {
    const hace10 = new Date(Date.now() - 10 * 60_000).toISOString()
    const hace30s = new Date(Date.now() - 30_000).toISOString()
    if (ip) {
      const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true })
        .eq('action', 'otp.send').gte('created_at', hace10).eq('metadata->>ip', ip)
      if ((count ?? 0) >= MAX_ENVIOS_IP_10M) return 'ip'
    }
    const { count: c2 } = await db.from('audit_log').select('id', { count: 'exact', head: true })
      .eq('action', 'otp.send').gte('created_at', hace30s).eq('metadata->>correo', claveCorreo)
    if ((c2 ?? 0) >= 1) return 'correo'
  } catch { /* sin registro no se frena a nadie por error */ }
  return null
}
async function anotarEnvio(ip: string, claveCorreo: string) {
  try { await db.from('audit_log').insert({ user_id: null, action: 'otp.send', metadata: { ip: ip || null, correo: claveCorreo, at: new Date().toISOString() } }) } catch { /* */ }
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
  <p style="font-family:Arial,sans-serif;font-size:13.5px;color:#5C625E;line-height:1.6;margin:0 0 20px">Hola${name ? `, ${escHtml(name)}` : ''}. Alguien está intentando iniciar sesión en tu cuenta Lincoin. Usa este código para continuar:</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#F4F4F1;border-radius:10px;padding:22px">
    <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:800;letter-spacing:10px;color:#15181A">${spacedCode(code)}</span>
  </td></tr></table>
  <p style="font-family:Arial,sans-serif;font-size:12.5px;color:#5C625E;text-align:center;margin:12px 0 22px">Vence en <b style="color:#15181A">10 minutos</b> · Un solo uso</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:12.5px">
    ${meta.device ? `<tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Dispositivo</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${escHtml(meta.device)}</td></tr>` : ''}
    ${meta.loc ? `<tr><td style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Ubicación aproximada</td><td align="right" style="padding:9px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${escHtml(meta.loc)}</td></tr>` : ''}
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
    <p style="font-family:Arial,sans-serif;font-size:10.5px;color:#9B9F9B;line-height:1.6;margin:0">${why} Lincoin no es un banco. Los dólares y euros digitales no están cubiertos por fondos de garantía de depósitos. USDC y EURC los emite Circle con respaldo 1:1, y la custodia opera sobre infraestructura de Fireblocks. © 2026 Lincoin.</p>
  </td></tr></table>`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const email = body.email ? String(body.email).trim() : undefined
    const userId = body.userId ? String(body.userId) : undefined
    if (!email && !userId) return json(400, { error: 'missing_identity' })
    if (!['send', 'verify', 'is_trusted'].includes(action)) return json(400, { error: 'bad_action' })

    // IP del cliente, la que pone el proxy de la plataforma.
    const clientIp = ipDe(req)

    // Freno de envíos ANTES de mirar si la cuenta existe: así responde igual
    // para un correo con cuenta que para uno sin cuenta.
    if (action === 'send') {
      const claveCorreo = await sha256(`otp|${String(userId ?? email ?? '').trim().toLowerCase()}`)
      const freno = await frenoEnvio(clientIp, claveCorreo)
      if (freno) return json(200, { ok: true, throttled: true, esperaSegundos: 30, message: 'Ya te enviamos un código. Revisa tu correo.' })
      await anotarEnvio(clientIp, claveCorreo)
    }

    const { data: user } = await findUser(email, userId)
    // SEGURIDAD (pentest H3): NO revelar si el correo tiene cuenta o no.
    // Antes esta función devolvía 404 user_not_found para correos que no
    // existen y 200 para los que sí — eso permite enumerar direcciones con
    // cuenta. Respuesta UNIFORME: si no hay usuario, respondemos igual que
    // el camino de éxito (sin enviar nada) y salimos.
    if (!user) {
      if (action === 'verify') return json(200, { ok: false, error: 'invalid', message: 'Código incorrecto.' })
      if (action === 'is_trusted') return json(200, { ok: true, trusted: false, hasta: null })
      // Mismo shape que el camino de éxito (incluye `to` enmascarado del
      // correo que ENVIÓ el cliente) para no dar pistas de existencia.
      return json(200, { ok: true, sent: true, to: maskEmail(String(email ?? '')) })
    }
    const raw = (user.raw_data ?? {}) as Record<string, any>

    if (action === 'send') {
      // Todo lo que impide que salga un correo se REGISTRA. Hoy no se
      // registraba nada: cuando no llegaba el código no había forma de saber
      // si era la llave, el proveedor o una condición de acá adentro, y se
      // terminaba adivinando. Los registros van con el correo enmascarado.
      const quien = maskEmail(String(user.email ?? ''))
      if (!RESEND_KEY) {
        console.error(`[otp] ${quien}: falta RESEND_API_KEY en el entorno`)
        return json(200, { ok: false, error: 'email_not_configured', message: 'Falta RESEND_API_KEY.' })
      }
      // Rate-limit suave: no reenviar si se emitió hace < 30 s.
      const prev = raw.otp
      if (prev?.sentAt && Date.now() - Number(prev.sentAt) < 30000) {
        const hace = Math.round((Date.now() - Number(prev.sentAt)) / 1000)
        console.log(`[otp] ${quien}: frenado, el anterior salio hace ${hace}s`)
        return json(200, { ok: true, throttled: true, esperaSegundos: 30 - hace, message: 'Ya te enviamos un código. Revisa tu correo.' })
      }
      const code = codigoNuevo() // 6 dígitos
      const codeHash = await hmacCodigo(String(user.id), code)
      const otp = { codeHash, v: 2, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0, sentAt: Date.now() }

      // ── UN SOLO CÓDIGO POR VEZ, AUNQUE LLEGUEN DOS PETICIONES JUNTAS ────
      // El freno de 30 s de arriba mira `prev`, que se leyó al empezar. Dos
      // peticiones simultáneas leían las dos el MISMO estado anterior, las dos
      // pasaban el freno, las dos escribían y las dos mandaban correo. Llegaban
      // dos códigos con un segundo de diferencia y solo servía el segundo —el
      // que sobreescribió—, así que el titular probaba el primero y le decía
      // "código incorrecto".
      //
      // La escritura ahora exige que el estado anterior SIGA siendo el que se
      // leyó. Solo una puede cumplirlo: la otra no encuentra fila, no manda
      // correo y responde como si estuviera frenada.
      //
      // Los TRES estados posibles, cada uno con su condición. Antes eran dos,
      // y el tercero —un otp guardado SIN sentAt— no encajaba en ninguna: la
      // condición exigía que raw_data->otp fuera null, y no lo era, así que
      // no coincidía ninguna fila y la cuenta se quedaba SIN PODER RECIBIR
      // CÓDIGOS PARA SIEMPRE, respondiendo "ya te enviamos uno" sin enviar
      // nada. La rama de abajo es además lo que DESTRABA a las cuentas que ya
      // quedaron así: en el próximo intento coinciden y vuelven a funcionar
      // solas, sin tocar la base a mano.
      let claim = db.from('users').update({ raw_data: { ...raw, otp } }).eq('id', user.id)
      if (prev?.sentAt) {
        claim = claim.filter('raw_data->otp->>sentAt', 'eq', String(prev.sentAt))
      } else if (prev) {
        claim = claim.is('raw_data->otp->>sentAt', null)
      } else {
        claim = claim.is('raw_data->otp', null)
      }
      const { data: gane, error: errClaim } = await claim.select('id')
      // Este NO es el freno de 30 s, aunque antes respondía lo mismo. Que los
      // dos casos dijeran "ya te enviamos un código" fue justo lo que escondió
      // durante horas una cuenta que no podía emitir ninguno. Se distinguen.
      if (!gane?.length) {
        console.error(`[otp] ${quien}: no se pudo reclamar el turno` +
          ` · otp guardado=${JSON.stringify(prev ?? null).slice(0, 120)}` +
          (errClaim ? ` · error=${errClaim.message}` : ''))
        return json(200, { ok: false, error: 'claim_failed', message: 'No pudimos emitir el código. Probá de nuevo en un momento.' })
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Lincoin <${FROM_EMAIL}>`, to: [user.email],
          subject: `${spacedCode(code)} es tu código de Lincoin`,
          html: otpEmailHtml(code, String(user.full_name ?? '').split(' ')[0] ?? '', {
            device: deviceFromUA(req.headers.get('user-agent') ?? ''),
            loc: await approxLocation(clientIp),
            time: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }) + ' (GMT-5)',
            userId: String(user.id ?? '').slice(0, 8).toUpperCase(),
          }),
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        console.error(`[otp] ${quien}: Resend rechazo el envio · HTTP ${res.status} · ${t.slice(0, 300)}`)
        // El turno ya se reclamó arriba, así que quedó guardado un código que
        // el titular NUNCA recibió: el próximo intento caería en el freno de
        // 30 s y le diría "revisa tu correo" — un correo que no existe. Se
        // deshace la marca de envío. Queda `failedAt` en vez de borrar el
        // objeto: sin `sentAt`, el próximo intento vuelve a reclamar turno de
        // inmediato, y además queda el rastro de que hubo un fallo.
        await db.from('users')
          .update({ raw_data: { ...raw, otp: { failedAt: Date.now() } } })
          .eq('id', user.id)
          .filter('raw_data->otp->>sentAt', 'eq', String(otp.sentAt))
        return json(200, { ok: false, error: 'send_failed', status: res.status, message: 'No se pudo enviar el código. Intenta de nuevo en un momento.' })
      }
      console.log(`[otp] ${quien}: enviado`)
      return json(200, { ok: true, sent: true, to: quien })
    }

    if (action === 'verify') {
      const code = String(body.code ?? '').trim()
      if (!/^\d{6}$/.test(code)) return json(200, { ok: false, error: 'bad_code' })
      const otp = raw.otp
      // Sin hash guardado hay dos casos distintos, y conviene distinguirlos:
      // nunca se pidió un código, o este YA SE USÓ. Decir "solicita uno nuevo"
      // cuando el código acaba de funcionar en otra pestaña confunde al dueño
      // de la cuenta y no le aclara nada a nadie más.
      if (!otp?.codeHash) {
        return otp?.usedAt
          ? json(200, { ok: false, error: 'used', message: 'Ese código ya se usó. Pide uno nuevo.' })
          : json(200, { ok: false, error: 'no_code', message: 'Solicita un código nuevo.' })
      }
      if (Date.now() > Number(otp.expiresAt)) return json(200, { ok: false, error: 'expired', message: 'El código venció. Pide uno nuevo.' })
      if (Number(otp.attempts ?? 0) >= 5) return json(200, { ok: false, error: 'too_many', message: 'Demasiados intentos. Pide un código nuevo.' })
      // EL INTENTO SE COBRA ANTES DE MIRAR EL CÓDIGO. Antes se comparaba
      // primero y se sumaba después, condicionado al valor leído: con diez
      // peticiones en paralelo las diez se evaluaban y solo UNA lograba subir
      // el contador — diez códigos probados por el precio de un intento. Ahora
      // cada petición tiene que ganar su turno (subir attempts de N a N+1)
      // para que su código se evalúe; la que no lo gana no prueba nada.
      const previo = Number(otp.attempts ?? 0)
      const otpConIntento = { ...otp, attempts: previo + 1 }
      const { data: turno } = await db.from('users')
        .update({ raw_data: { ...raw, otp: otpConIntento } })
        .eq('id', user.id)
        .eq('raw_data->otp->>attempts', String(previo))
        .filter('raw_data->otp->>codeHash', 'eq', String(otp.codeHash))
        .select('id')
      if (!turno?.length) return json(200, { ok: false, error: 'invalid', message: 'Código incorrecto.' })
      const esperado = Number(otp.v) === 2 ? await hmacCodigo(String(user.id), code) : await sha256(code)
      const ok = igualesHex(esperado, String(otp.codeHash))
      if (!ok) return json(200, { ok: false, error: 'invalid', message: 'Código incorrecto.' })

      // ── CONSUMO DE UN SOLO USO, ATÓMICO ─────────────────────────────────
      // El borrado por sí solo NO alcanzaba: entre leer el código y borrarlo
      // hay una ventana, y dos peticiones con el MISMO código que llegan a la
      // vez —un doble toque en "Continuar", o alguien reenviando la petición—
      // leían las dos el código todavía puesto, las dos daban por buena la
      // verificación, y las dos borraban. Un código, dos usos.
      //
      // Ahora el borrado lleva la condición de que el hash SIGA siendo el
      // mismo. La base solo puede cumplirla una vez: la primera petición lo
      // quita, y la segunda no encuentra fila que actualizar. Gana una sola,
      // sin importar cuántas lleguen juntas.
      //
      // Se deja la marca 'usedAt' en vez de borrar el objeto entero, para
      // poder responder "ese código ya se usó" en lugar de un genérico.
      //
      // ── DISPOSITIVO DE CONFIANZA, EN LA MISMA ESCRITURA ─────────────────
      // "Confiar en este dispositivo 30 días" vivía SOLO en el navegador: una
      // fecha en localStorage. Cualquier cosa que limpie el almacenamiento la
      // borraba y el código volvía a pedirse en cada ingreso; y al revés,
      // escribiendo esa fecha a mano se saltaba el paso. Ahora la confianza la
      // guarda el SERVIDOR: el navegador solo conserva un identificador sin
      // valor por sí mismo, que si no está en la lista de acá no abre nada.
      //
      // VA EN ESTA MISMA ESCRITURA, no en una segunda. Cuando era una segunda
      // pasaban dos cosas, las dos malas: partía de `raw`, que se leyó al
      // ENTRAR a la petición, así que pisaba lo que acababa de dejar el
      // reclamo de acá arriba; y al reconstruir el objeto otp se le quedaba
      // fuera `sentAt`. Sin `sentAt`, el envío del código no encontraba fila
      // que reclamar y la cuenta quedaba SIN PODER RECIBIR CÓDIGOS, mientras
      // respondía "ya te enviamos uno". Marcar "confiar en este dispositivo"
      // era lo que dejaba la cuenta inservible. Una sola escritura no puede
      // pisarse a sí misma.
      const dev = String(body.deviceId ?? '').trim().slice(0, 64)
      const confiar = body.trust === true && /^[A-Za-z0-9_-]{16,64}$/.test(dev)

      // Se parte de la fila con el intento ya cobrado (lo que quedó escrito).
      const rawNuevo: Record<string, any> = {
        ...raw,
        otp: { usedAt: Date.now(), sentAt: otp.sentAt ?? null },
      }
      if (confiar) {
        const previos: any[] = Array.isArray(raw.trustedDevices) ? raw.trustedDevices : []
        const vivos = previos.filter(d => d && d.id !== dev && Number(d.exp ?? 0) > Date.now())
        const nuevo = {
          id: dev,
          exp: Date.now() + 30 * 86400_000,
          desde: new Date().toISOString(),
          agente: deviceFromUA(req.headers.get('user-agent') ?? ''),
        }
        // Tope de 10: una cuenta con veinte dispositivos "de confianza" no
        // tiene ninguno. Se quedan los más recientes.
        rawNuevo.trustedDevices = [nuevo, ...vivos].slice(0, 10)
      }

      const { data: reclamado } = await db.from('users')
        .update({ raw_data: rawNuevo })
        .eq('id', user.id)
        .filter('raw_data->otp->>codeHash', 'eq', String(otp.codeHash))
        .select('id')
      if (!reclamado?.length) {
        return json(200, { ok: false, error: 'used', message: 'Ese código ya se usó. Pide uno nuevo.' })
      }
      return json(200, { ok: true, verified: true, userId: user.id })
    }

    // ¿Este dispositivo ya pasó el código? Lo decide el servidor, no el
    // navegador. Se responde solo sí o no: nada que un cliente pueda fingir.
    if (action === 'is_trusted') {
      const dev = String(body.deviceId ?? '').trim().slice(0, 64)
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(dev)) return json(200, { ok: true, trusted: false })
      const lista: any[] = Array.isArray(raw.trustedDevices) ? raw.trustedDevices : []
      const hit = lista.find(d => d && d.id === dev && Number(d.exp ?? 0) > Date.now())
      return json(200, { ok: true, trusted: !!hit, hasta: hit?.exp ?? null })
    }

    return json(400, { error: 'bad_action' })
  } catch (e) {
    console.error('[otp] error interno:', (e as Error)?.message ?? e)
    return json(500, { error: 'internal', message: 'No se pudo completar la verificación. Intenta de nuevo.' })
  }
})

// Dispositivo legible desde el user-agent ("Chrome · iPhone").
function deviceFromUA(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'dispositivo'
  return `${browser} · ${os}`
}

// Ubicación aproximada por IP (ciudad, país). Servicio gratuito sin llave,
// con timeout corto: si falla, el correo simplemente omite la fila.
async function approxLocation(ip: string): Promise<string | undefined> {
  if (!ip || ip === '127.0.0.1' || ip.startsWith('::1') || ip.startsWith('10.') || ip.startsWith('192.168.')) return undefined
  try {
    const res = await Promise.race([
      fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,country`),
      new Promise<Response>((_, rej) => setTimeout(() => rej(new Error('geo_timeout')), 2500)),
    ]) as Response
    const j = await res.json().catch(() => null) as any
    if (!j || j.success === false) return undefined
    const parts = [j.city, j.country].filter((s: unknown) => typeof s === 'string' && s)
    return parts.length ? parts.join(', ') : undefined
  } catch { return undefined }
}

function maskEmail(e: string): string {
  const [u, d] = e.split('@')
  if (!d) return e
  const head = u.length <= 2 ? u[0] : u.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`
}
