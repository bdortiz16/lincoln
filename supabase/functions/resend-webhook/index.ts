// ════════════════════════════════════════════════════════
// resend-webhook — se entera cuando un correo nuestro NO llegó.
//
// EL PROBLEMA QUE RESUELVE
//   Cuando una dirección rebota en duro o alguien marca un correo como spam,
//   Resend la pone en su lista de supresión y deja de mandarle. Y cuando
//   mandamos a una dirección suprimida, NOS CONTESTA QUE ACEPTO EL ENVIO.
//
//   O sea: la función de códigos ve un 200, le dice a la persona "revisá tu
//   correo", y ese correo nunca va a salir. La persona reintenta, ve el mismo
//   mensaje, y no entra nunca. Desde nuestro lado no se ve nada.
//
//   Nos pasó con admin@lincoin.me y tardamos horas en darnos cuenta. A un
//   cliente le pasaría igual, salvo que él no puede avisarnos: el correo es
//   justo el canal que se rompió.
//
// CONFIGURACION (Resend → Webhooks → Add Endpoint)
//   URL:      https://lincoin.me/webhooks/resend
//   Eventos:  email.bounced, email.complained, email.delivery_delayed,
//             email.failed
//   Copiar el "Signing Secret" (whsec_...) a Supabase → Edge Functions →
//   Secrets como RESEND_WEBHOOK_SECRET.
//
// LA FIRMA SE EXIGE
//   Resend firma con Svix: cabeceras svix-id, svix-timestamp y svix-signature,
//   HMAC-SHA256 en base64 sobre "id.timestamp.cuerpo". Sin el secreto
//   configurado esto NO acepta nada (401): un endpoint que cualquiera puede
//   llenar de "rebotó" sirve para marcar como rota la cuenta de cualquier
//   cliente, que es justo lo que no queremos.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET       = (Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '').trim()

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, svix-id, svix-timestamp, svix-signature',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Comparación en tiempo constante: con === el tiempo que tarda en fallar
// delata cuántos caracteres iniciales acertó quien prueba.
function igual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

// Svix: el secreto viene como "whsec_<base64>" y lo que se firma es la clave
// DECODIFICADA, no el texto. Firmarlo como texto da una firma que nunca
// coincide — y el error se ve igual que "el secreto está mal".
async function firmaSvix(secreto: string, contenido: string): Promise<string> {
  const crudo = secreto.startsWith('whsec_') ? secreto.slice(6) : secreto
  const clave = Uint8Array.from(atob(crudo), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(contenido))))
}

async function firmaValida(headers: Headers, cuerpo: string): Promise<boolean> {
  const id = headers.get('svix-id') ?? ''
  const ts = headers.get('svix-timestamp') ?? ''
  const firmas = headers.get('svix-signature') ?? ''
  if (!id || !ts || !firmas) return false

  // Ventana de 5 minutos: sin esto, una entrega legítima capturada hoy se
  // puede volver a mandar dentro de un mes y seguiría validando.
  const edad = Math.abs(Date.now() / 1000 - Number(ts))
  if (!Number.isFinite(edad) || edad > 300) return false

  const esperada = await firmaSvix(SECRET, `${id}.${ts}.${cuerpo}`)
  // La cabecera trae una o varias, con prefijo de versión: "v1,xxx v1,yyy".
  for (const parte of firmas.split(' ')) {
    const v = parte.includes(',') ? parte.split(',')[1] : parte
    if (igual(v, esperada)) return true
  }
  return false
}

// Un rebote DURO es definitivo: esa dirección no existe o rechaza para
// siempre. Uno BLANDO es pasajero (buzón lleno, servidor caído) y se
// resuelve solo. Tratarlos igual llena el panel de ruido y termina con nadie
// mirándolo.
function durezaDe(d: Record<string, unknown>): string | null {
  const t = String((d.bounce as any)?.type ?? d.type ?? '').toLowerCase()
  if (t.includes('hard') || t.includes('permanent')) return 'hard'
  if (t.includes('soft') || t.includes('transient')) return 'soft'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const cuerpo = await req.text().catch(() => '')

  if (!SECRET) {
    // Falla CERRADO. Sin secreto, cualquiera puede mandar "rebotó" con el
    // correo de un cliente y dejarlo marcado como roto.
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET sin configurar')
    return json(401, { error: 'no_autorizado' })
  }
  if (!(await firmaValida(req.headers, cuerpo))) {
    console.warn('[resend-webhook] firma inválida')
    return json(401, { error: 'no_autorizado' })
  }

  let evento: Record<string, any>
  try {
    evento = JSON.parse(cuerpo)
  } catch {
    return json(400, { error: 'cuerpo_invalido' })
  }

  const tipo = String(evento.type ?? '').replace(/^email\./, '')
  const d = (evento.data ?? {}) as Record<string, unknown>

  // Solo lo que significa "no llegó". Los 'sent' y 'delivered' son ruido acá:
  // esta tabla existe para lo que falla.
  if (!['bounced', 'complained', 'delivery_delayed', 'failed'].includes(tipo)) {
    return json(200, { ok: true, ignorado: tipo })
  }

  const destinos: string[] = Array.isArray(d.to)
    ? (d.to as unknown[]).map((x) => String(x).toLowerCase().trim()).filter(Boolean)
    : d.to ? [String(d.to).toLowerCase().trim()] : []

  const dureza = durezaDe(d)
  const motivo = String(
    (d.bounce as any)?.message ?? (d.bounce as any)?.subType ?? (d as any).reason ?? '',
  ).slice(0, 500) || null

  for (const email of destinos) {
    const { error } = await db.from('email_incidencias').insert({
      email,
      tipo,
      dureza,
      motivo,
      email_id: String(d.email_id ?? (d as any).id ?? '') || null,
      asunto: String(d.subject ?? '').slice(0, 300) || null,
      crudo: evento,
    })
    // Un error al guardar NO se traga: si no queda registrado, la persona
    // queda a ciegas igual que antes y nadie se entera de que se perdió.
    if (error) {
      console.error(`[resend-webhook] no se pudo guardar ${tipo} de ${email}: ${error.message}`)
      // 500 para que Resend reintente. Perder este aviso es perder la única
      // señal de que alguien no puede entrar a su cuenta.
      return json(500, { error: 'no_guardado' })
    }
    console.log(`[resend-webhook] ${tipo}${dureza ? `/${dureza}` : ''} · ${email}`)
  }

  return json(200, { ok: true })
})
