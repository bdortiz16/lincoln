// ════════════════════════════════════════════════════════
// gowd-webhook — receptor de los avisos del banco de Brasil (Gowd).
//
// A GOWD SE LE DA ESTA URL, NO LA DE SUPABASE:
//   https://lincoin.me/webhooks/gowd
// (vercel.json —o el worker de Cloudflare, cloudflare/worker.js— la reenvía
// acá con el cuerpo intacto. Cambiar la URL de un webhook con un banco es un
// trámite, no un deploy.)
//
// LO QUE GOWD ESPERA DE NOSOTROS (de su documentación)
//   HTTP 200 con { "returnCode": "SUCCESS" }. Si no lo recibe, REINTENTA 4
//   VECES MAS. O sea que el mismo evento puede llegar hasta 5 veces: lo que
//   procese esto tiene que ser idempotente, sí o sí.
//
// LA FIRMA (de su documentación, "Webhook signature")
//   Cada aviso trae  X-Signature-SHA256: sha256=<hex>  = HMAC-SHA256 del
//   cuerpo CRUDO (tal cual llega, antes de parsear) con el secreto del
//   webhook. El secreto es por ambiente y se obtiene con
//   POST /order/v1/webhook/rotate-secret (solo se muestra esa vez). Va en
//   Supabase → Edge Functions → Secrets como GOWD_WEBHOOK_SECRET.
//   Firma que no valida → 401 (ellos reintentan; un 2xx es "recibido").
//
//   Aun firmado, la regla se mantiene:  EL POSTBACK AVISA. LA API CONFIRMA.
//   Antes de mover un peso se consulta el id a Gowd (por el proxy mTLS) y se
//   cree a esa respuesta. Esa confirmación es la columna confirmado_api.
//
// ESTADO HOY: RECIBE, GUARDA Y CONTESTA. NO ACREDITA NADA.
//   No hay lógica de negocio de Gowd todavía — no hay cuentas en BRL ni
//   órdenes que conciliar. Cuando la haya, entra por confirmado_api.
//
//   Con GOWD_WEBHOOK_SECRET puesto, la firma se EXIGE: un aviso que no valida
//   se guarda como 'rechazado' y se contesta 401. Sin el secreto, se guarda
//   como no verificado y se contesta 200 (sirve para probar en sandbox).
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
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-api-key, x-signature-sha256',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Cabeceras que pueden traer una credencial: de estas se guarda huella, no valor.
const SENSIBLES = [
  'authorization', 'x-api-key', 'apikey', 'x-webhook-secret', 'x-secret',
  'x-signature', 'x-signature-sha256', 'x-gowd-signature', 'x-hub-signature', 'x-hub-signature-256',
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

async function hmacHex(crudo: Uint8Array, secreto: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, crudo)))
}

type Verdicto = { ok: boolean; metodo: string }

// Exactamente como lo documenta Gowd: X-Signature-SHA256 = "sha256=" + hex
// del HMAC-SHA256 del cuerpo crudo. Nada de adivinar cabeceras ni formatos:
// si la firma no es esa, no es de ellos.
async function verificar(headers: Record<string, string>, crudo: Uint8Array): Promise<Verdicto> {
  // Sin secreto configurado no se puede verificar nada. Se guarda y se marca
  // como no verificado — que es exactamente lo que es — y no acredita nada.
  if (!SECRET) return { ok: false, metodo: 'sin_secreto' }
  const recibida = (headers['x-signature-sha256'] ?? '').trim().replace(/^sha256=/i, '').toLowerCase()
  if (!recibida) return { ok: false, metodo: 'rechazado' }
  const esperada = await hmacHex(crudo, SECRET)
  return igual(recibida, esperada) ? { ok: true, metodo: 'hmac_sha256' } : { ok: false, metodo: 'rechazado' }
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

  // La firma va sobre los bytes tal cual llegaron: decodificar y volver a
  // codificar podría cambiarlos y hacer fallar un aviso legítimo.
  let crudo = new Uint8Array()
  try {
    crudo = new Uint8Array(await req.arrayBuffer())
  } catch {
    crudo = new Uint8Array()
  }
  const cuerpo = new TextDecoder().decode(crudo)

  const verdicto = await verificar(headers, crudo)

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
      ? 'Sin verificar: falta GOWD_WEBHOOK_SECRET (se obtiene con POST /order/v1/webhook/rotate-secret). Este aviso NO confirma nada — hay que preguntarle a la API de Gowd por este id antes de mover un saldo.'
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
