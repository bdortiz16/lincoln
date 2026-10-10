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
//   El secreto lo guarda solo Admin → Gowd → Webhooks → "Rotar secreto" (tabla
//   gowd_config); GOWD_WEBHOOK_SECRET en Supabase queda como respaldo.
//   Con secreto puesto, la firma se EXIGE: un aviso que no valida
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
// El secreto vigente: el que guardó Admin → Gowd al rotarlo (gowd_config),
// o el de los secretos de Supabase si nunca se rotó desde el panel. El de la
// tabla manda porque es el último que Gowd entregó: al rotar, el anterior
// deja de valer en ese mismo instante.
let secretoCache: { valor: string; at: number } | null = null
async function secretoVigente(): Promise<string> {
  if (secretoCache && Date.now() - secretoCache.at < 60_000) return secretoCache.valor
  let valor = SECRET
  try {
    const { data } = await db.from('gowd_config').select('valor').eq('clave', 'webhook_secret').maybeSingle()
    if (data?.valor) valor = String(data.valor).trim()
  } catch { /* sin la tabla, queda el de los secretos */ }
  secretoCache = { valor, at: Date.now() }
  return valor
}

async function verificar(headers: Record<string, string>, crudo: Uint8Array): Promise<Verdicto> {
  // Sin secreto configurado no se puede verificar nada. Se guarda y se marca
  // como no verificado — que es exactamente lo que es — y no acredita nada.
  const secreto = await secretoVigente()
  if (!secreto) return { ok: false, metodo: 'sin_secreto' }
  const recibida = (headers['x-signature-sha256'] ?? '').trim().replace(/^sha256=/i, '').toLowerCase()
  if (!recibida) return { ok: false, metodo: 'rechazado' }
  const esperada = await hmacHex(crudo, secreto)
  return igual(recibida, esperada) ? { ok: true, metodo: 'hmac_sha256' } : { ok: false, metodo: 'rechazado' }
}

const textoMotivo = (r: unknown): string | null => {
  if (r == null || r === '') return null
  return (typeof r === 'string' ? r : JSON.stringify(r)).slice(0, 900)
}

async function avisarAdmins(titulo: string, cuerpo: string, tag: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'enviar', rol: 'admin', titulo, cuerpo, tag, url: '/admin' }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el aviso es un extra */ }
}

// ACCOUNT.CREATED {accountId, requestId, status, bankData?}
// ACCOUNT.REJECTED {requestId, status: REJECTED, reason}
// ACCOUNT.PENDING_DOCUMENTS {requestId, status: PENDING_DOCUMENTS, reason}
// ACCOUNT.STATUS_CHANGED {accountId, status, previousStatus, reason}
async function aplicarEventoCuenta(j: Record<string, any>) {
  const ev = String(j.event)
  const reqId = j.requestId ? String(j.requestId) : null
  const accId = j.accountId ? String(j.accountId) : null
  let fila: any = null
  if (reqId) fila = (await db.from('gowd_cuentas').select('*').eq('solicitud_id', reqId).maybeSingle()).data
  if (!fila && accId) fila = (await db.from('gowd_cuentas').select('*').eq('account_id', accId).maybeSingle()).data
  if (!fila) return
  const ahora = new Date().toISOString()
  const cambios: Record<string, unknown> = { actualizado_at: ahora }

  if (ev === 'ACCOUNT.CREATED') {
    Object.assign(cambios, { account_id: accId ?? fila.account_id, estado_solicitud: 'APPROVED', estado_cuenta: j.status ?? 'ACTIVE', motivo: null })
    const b = j.bankData ?? {}
    if (b.accountNumber) Object.assign(cambios, { ispb: b.ispb ?? null, banco: b.bankNumber ?? null, agencia: b.branchNumber ?? null, conta: b.accountNumber, conta_tipo: b.accountType ?? null })
    await avisarAdmins('Cuenta de Brasil aprobada', `${fila.titular}: la cuenta quedó abierta. Asígnala desde Admin → Gowd.`, `gowd-cuenta-${fila.id}`)
  } else if (ev === 'ACCOUNT.REJECTED') {
    Object.assign(cambios, { estado_solicitud: 'REPROVED', motivo: textoMotivo(j.reason) })
    await avisarAdmins('Cuenta de Brasil rechazada', `${fila.titular}: ${textoMotivo(j.reason) ?? 'sin motivo'}`.slice(0, 300), `gowd-cuenta-${fila.id}`)
  } else if (ev === 'ACCOUNT.PENDING_DOCUMENTS') {
    Object.assign(cambios, { estado_solicitud: 'PENDING_DOCUMENTS', motivo: textoMotivo(j.reason) })
    await avisarAdmins('Gowd pide documentos', `${fila.titular}: ${textoMotivo(j.reason) ?? 'revisa la solicitud'}`.slice(0, 300), `gowd-cuenta-${fila.id}`)
  } else if (ev === 'ACCOUNT.STATUS_CHANGED') {
    Object.assign(cambios, { estado_cuenta: j.status ?? null, motivo: textoMotivo(j.reason) })
    // Una cuenta que dejó de estar activa no se le sigue mostrando al
    // cliente: un PIX a una cuenta inactiva o cerrada no llega.
    if (j.status && j.status !== 'ACTIVE' && fila.user_id && fila.account_id) {
      await db.from('cuentas_brasil').update({ estado: 'suspendida', actualizado_at: ahora, nota_interna: `Gowd: la cuenta pasó a ${j.status}.` })
        .eq('user_id', fila.user_id).eq('gowd_account_id', fila.account_id).eq('estado', 'activa')
    }
    await avisarAdmins('Cambio de estado en cuenta de Brasil', `${fila.titular}: ${j.previousStatus ?? '?'} → ${j.status ?? '?'}`, `gowd-cuenta-${fila.id}`)
  } else return

  await db.from('gowd_cuentas').update(cambios).eq('id', fila.id)
}

async function aplicarEventoOrden(j: Record<string, any>) {
  const id = j.id ? String(j.id) : null
  const code = j.code ? String(j.code) : null
  let fila: any = null
  if (id) fila = (await db.from('gowd_operaciones').select('id, tipo').eq('gowd_id', id).limit(1).maybeSingle()).data
  if (!fila && code) fila = (await db.from('gowd_operaciones').select('id, tipo').eq('external_id', code).limit(1).maybeSingle()).data
  if (!fila) return
  // Un reembolso llega como evento del cobro con type REFUND: si el registro
  // es del cobro, no se le pisa el estado con el del reembolso.
  if (j.type === 'REFUND' && fila.tipo !== 'reembolso') return
  await db.from('gowd_operaciones').update({
    estado: j.status ?? null, end_to_end: j.endToEndId ?? null, actualizado_at: new Date().toISOString(),
  }).eq('id', fila.id)
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
      ? 'Sin verificar: falta el secreto del webhook (Admin → Gowd → Webhooks → Rotar secreto). Este aviso NO confirma nada — hay que preguntarle a la API de Gowd por este id antes de mover un saldo.'
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

  // Avisos de cuentas Banking: solo si la firma validó. Se actualiza el
  // estado en gowd_cuentas; los datos bancarios los trae el admin con
  // "Actualizar" (la API confirma). Idempotente: el mismo aviso 5 veces deja
  // la fila igual.
  if (verdicto.ok && typeof j.event === 'string' && j.event.startsWith('ACCOUNT.')) {
    try { await aplicarEventoCuenta(j) } catch (e) { console.error('[gowd-webhook] evento de cuenta:', (e as Error).message) }
  }
  // Cobros, envíos y reembolsos creados desde Admin → Gowd: se actualiza el
  // estado que muestra el registro. No mueve saldos de nadie.
  if (verdicto.ok && typeof j.event === 'string' && /^ORDER-(PAYIN|PAYOUT)\./.test(j.event)) {
    try { await aplicarEventoOrden(j) } catch (e) { console.error('[gowd-webhook] evento de orden:', (e as Error).message) }
  }

  // Exactamente lo que su documentación dice que esperan. Si no ven esto,
  // reintentan 4 veces más.
  return json(200, { returnCode: 'SUCCESS' })
})
