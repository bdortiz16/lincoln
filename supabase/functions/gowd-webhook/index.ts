// ════════════════════════════════════════════════════════
// gowd-webhook — receptor de los avisos del banco de Brasil (Gowd).
//
// A GOWD SE LE DA ESTA URL, NO LA DE SUPABASE:
//   https://lincoin.me/webhooks/gowd
// (vercel.json la reenvía acá. Ver el comentario de ese archivo: cambiar la
// URL de un webhook con un banco es un trámite de semanas, no un deploy.)
//
// LO QUE GOWD ESPERA DE NOSOTROS (de su documentación)
//   HTTP 200 con { "returnCode": "SUCCESS" }. Si no lo recibe, REINTENTA 4
//   VECES MAS. O sea que el mismo evento puede llegar hasta 5 veces: lo que
//   procese esto tiene que ser idempotente, sí o sí.
//
// UN POSTBACK NO ES UNA PRUEBA — ESTO ES LO IMPORTANTE
//   Su documentación describe el cuerpo del postback con todo detalle, y NO
//   DESCRIBE NINGUNA FIRMA NI SECRETO. Por lo que está escrito, cualquiera que
//   descubra esta URL puede mandarnos "ORDER-PAYIN.PAID" por el monto que se
//   le ocurra, y si acreditáramos sobre eso, acabamos de regalar la plata.
//
//   Por eso la regla, que no se negocia:
//
//     EL POSTBACK AVISA. LA API CONFIRMA.
//
//   Al recibir un aviso se guarda y se despierta a quien corresponda, pero
//   antes de mover un peso hay que preguntarle a Gowd por ese id (a través del
//   proxy mTLS, que es el único que puede hablarles) y creerle a la respuesta.
//   Esa confirmación es la columna confirmado_api.
//
// ESTADO HOY: RECIBE, GUARDA Y CONTESTA. NO ACREDITA NADA.
//   No hay lógica de negocio de Gowd todavía — no hay cuentas en BRL ni
//   órdenes que conciliar. Cuando la haya, entra por confirmado_api.
//
//   Tenerla arriba desde hoy sirve igual: CAPTURA SUS CABECERAS. Si mandan
//   alguna firma que no está documentada, la primera llamada de prueba nos la
//   muestra sin esperar a que alguien la escriba en un correo.
//
// SI APARECE UNA FIRMA
//   Se setea GOWD_WEBHOOK_SECRET en Supabase → Edge Functions → Secrets.
//   Desde ese momento se EXIGE: un evento que no valide se guarda como
//   'rechazado' y se contesta 401.
//
// LO QUE NO SE GUARDA
//   El valor de las cabeceras que son credenciales. Se guarda su NOMBRE y una
//   huella (largo + sha256 recortado) — alcanza para reconocer el esquema y
//   para ver si cambió, sin tener el secreto de un banco en nuestra base.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET       = (Deno.env.get('GOWD_WEBHOOK_SECRET') ?? '').trim()

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-api-key, x-signature, x-hub-signature-256, x-gowd-signature, x-webhook-secret',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Cabeceras que pueden traer una credencial: de estas se guarda huella, no valor.
const SENSIBLES = [
  'authorization', 'x-api-key', 'apikey', 'x-webhook-secret', 'x-secret',
  'x-signature', 'x-gowd-signature', 'x-hub-signature', 'x-hub-signature-256',
  'signature', 'cookie',
]

const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')

async function huella(valor: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor)))
  return `len=${valor.length} sha256=${hex(d).slice(0, 12)}`
}

// Comparación en tiempo constante: con === el tiempo que tarda en fallar
// delata cuántos caracteres iniciales acertó quien prueba.
function igual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

async function hmacDe(cuerpo: string, secreto: string): Promise<{ hex: string; b64: string }> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(cuerpo)))
  return { hex: hex(sig), b64: btoa(String.fromCharCode(...sig)) }
}

// Algunos proveedores mandan "sha256=abc..." en vez de "abc...".
const limpiar = (v: string) => v.trim().replace(/^(sha256|hmac-sha256|sha-256)[=\s]/i, '').trim()

type Verdicto = { ok: boolean; metodo: string }

async function verificar(headers: Record<string, string>, cuerpo: string): Promise<Verdicto> {
  // Sin secreto configurado no se puede verificar nada. Se acepta y se marca
  // como no verificado — que es exactamente lo que es.
  if (!SECRET) return { ok: false, metodo: 'sin_secreto' }

  // (a) El secreto viajando tal cual en alguna cabecera.
  for (const h of ['x-webhook-secret', 'x-api-key', 'x-secret', 'apikey', 'x-gowd-secret']) {
    if (headers[h] && igual(limpiar(headers[h]), SECRET)) return { ok: true, metodo: 'header' }
  }
  if (headers['authorization']) {
    const v = headers['authorization'].replace(/^Bearer\s+/i, '').trim()
    if (igual(v, SECRET)) return { ok: true, metodo: 'header' }
  }

  // (b) HMAC-SHA256 del cuerpo, en hex o base64. No se asume cuál de las dos
  // formas usan: se prueban las dos contra todas las cabeceras de firma.
  if (cuerpo) {
    const firma = await hmacDe(cuerpo, SECRET)
    for (const h of ['x-signature', 'x-gowd-signature', 'x-hub-signature-256', 'signature', 'x-webhook-signature']) {
      const v = headers[h] ? limpiar(headers[h]) : ''
      if (!v) continue
      if (igual(v.toLowerCase(), firma.hex)) return { ok: true, metodo: 'hmac_hex' }
      if (igual(v, firma.b64)) return { ok: true, metodo: 'hmac_b64' }
    }
  }

  return { ok: false, metodo: 'rechazado' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Muchos bancos "pingean" la URL con un GET antes de darla por registrada.
  // Contestar 200 acá no acepta nada: no hay cuerpo que guardar ni que creer.
  if (req.method === 'GET' || req.method === 'HEAD') {
    return json(200, { ok: true, servicio: 'gowd-webhook' })
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const headers: Record<string, string> = {}
  for (const [k, v] of req.headers.entries()) headers[k.toLowerCase()] = v

  let cuerpo = ''
  try {
    cuerpo = await req.text()
  } catch {
    cuerpo = ''
  }

  const verdicto = await verificar(headers, cuerpo)

  // Lo que se guarda de las cabeceras: valor si es inocuo, huella si no.
  const headersGuardables: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    headersGuardables[k] = SENSIBLES.includes(k) ? await huella(v) : v.slice(0, 500)
  }

  let cuerpoJson: Record<string, unknown> | null = null
  try {
    const p = cuerpo ? JSON.parse(cuerpo) : null
    cuerpoJson = p && typeof p === 'object' ? p as Record<string, unknown> : null
  } catch {
    cuerpoJson = null // no era JSON; queda el texto crudo, que es la prueba
  }

  // Los campos que su documentación marca como required en todos los
  // postbacks. Se extraen para poder buscar sin abrir el JSON — el JSON
  // completo se guarda igual.
  const j = cuerpoJson ?? {}
  const txt = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
    return s ? s.slice(0, 300) : null
  }
  const monto = (j.amount ?? {}) as Record<string, unknown>

  // El monto NO se convierte a número. Su ejemplo es "50.00": pasarlo por un
  // float lo deja de ser, y con plata eso no se perdona. Se guarda tal cual
  // llegó y se convierte a centavos enteros recién cuando haga falta.
  const { error } = await db.from('gowd_eventos').insert({
    verificado: verdicto.ok,
    metodo_auth: verdicto.metodo,
    headers: headersGuardables,
    ip: headers['x-forwarded-for']?.split(',')[0]?.trim() ?? null,
    cuerpo_texto: cuerpo.slice(0, 100_000),
    cuerpo: cuerpoJson,
    orden_id: txt(j.id),
    orden_code: txt(j.code),
    // 'event' es de los postbacks nuevos (banking); los viejos solo traen
    // status. Si no viene, se arma uno para que la columna sirva igual.
    evento: txt(j.event) ?? (txt(j.type) && txt(j.status) ? `${txt(j.type)}.${txt(j.status)}` : null),
    estado: txt(j.status),
    tipo: txt(j.type),
    end_to_end: txt(j.endToEndId),
    monto_valor: txt(monto.value),
    monto_moneda: txt(monto.currency),
    actualizado_at: txt(j.updatedAt),
    nota: verdicto.metodo === 'sin_secreto'
      ? 'Sin firma: su documentación no define ninguna. Este aviso NO confirma nada — hay que preguntarle a la API de Gowd por este id antes de mover un saldo.'
      : null,
  })

  if (error) {
    // Si no se pudo guardar, NO se contesta 200. Un 200 le dice al banco
    // "recibido, no lo mandes más" — y no lo tenemos. Que lo reintenten.
    console.error('[gowd-webhook] no se pudo guardar el evento:', error.message)
    return json(500, { error: 'no_guardado' })
  }

  if (!verdicto.ok && verdicto.metodo === 'rechazado') {
    // Con secreto configurado, una firma que no valida es un rechazo. No se
    // dice qué falló.
    console.warn('[gowd-webhook] firma inválida')
    return json(401, { error: 'no_autorizado' })
  }

  // Exactamente lo que su documentación dice que esperan. Si no ven esto,
  // reintentan 4 veces más.
  return json(200, { returnCode: 'SUCCESS' })
})
