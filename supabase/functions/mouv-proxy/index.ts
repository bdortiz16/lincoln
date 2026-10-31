// ─────────────────────────────────────────────
// mouv-proxy — Proxy server-side para la API de Mouv Platform
// (rails de pago colombianos: BREB, ACH, PSE). Reemplaza a mouv-proxy.
//
// Autenticación: API key de Mouv (mvk_live_...) enviada como
//   Authorization: Bearer <MOUV_API_KEY>
// La key vive SOLO como secret de la edge function (MOUV_API_KEY) — nunca
// llega al cliente. Base URL: https://consola.mouvlatam.com/api
//
// Confirmado de la doc (developer.mouvlatam.com/introduction):
//   GET /api/wallets/balance  → saldo de la wallet
//   Rails: BREB (alias/celular/correo/cédula, tope $12M COP),
//          ACH (Ahorros/Corriente/Depósito, tope $2.000M COP),
//          PSE (recaudo entrante → link).
//   Sin prefijo de versión (/api/...).
//
// Dispersión REAL cableada (quickstart de la doc):
//   POST /api/transfers/resolve-key  → titular oficial de la llave (SARLAFT)
//   POST /api/transfers/send         → retiro BREB (destino inline) / ACH
//   Valores en CENTAVOS. Ver mouvPayout. ACH aún con destino best-guess.
// ─────────────────────────────────────────────
import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mergeRaw } from '../_shared/raw-data.ts'
import { traeSecretoDeLaBase, cabecerasInternas } from '../_shared/webhook-auth.ts'
import { reclamarCandado, soltarCandado } from '../_shared/candado.ts'
import { FIELD_ENC_KEY, decField } from '../_shared/field-crypto.ts'
import { equipoPermite } from '../_shared/equipo.ts'
import { inicioMesBogota, cupoGeneral, cupoAprobado, cupoVigente, solicitudEnProceso, claveBeneficiario, clavesBeneficiario, enviosDelMes, usadoPara, idsMismaPersona as idsDeLaPersona, normDoc, tipoCupo } from '../_shared/cupos.ts'
// Verificación TOTP en el SERVIDOR (2FA), con Web Crypto NATIVO (sin
// dependencias externas que pudieran no cargar y tumbar el proxy). Mismo
// algoritmo que el cliente: SHA1, 6 dígitos, período 30s, ventana ±2. Sin
// esto el 2FA solo vivía en el navegador y se saltaba llamando al proxy.
function base32Decode(s: string): Uint8Array {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(s ?? '').replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0, value = 0; const out: number[] = []
  for (const ch of clean) {
    const idx = alph.indexOf(ch); if (idx < 0) continue
    value = (value << 5) | idx; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return new Uint8Array(out)
}
// Cifrado de campos sensibles: la implementación vive en _shared para que
// NO pueda volver a haber tres copias que se desincronicen (una quedó sin
// entender el formato nuevo y el 2FA de los envíos falló con el código
// correcto, sin que ningún build lo detectara).

async function verifyTOTPServer(secret: string, token: string): Promise<boolean> {
  const code = String(token ?? '').replace(/\D/g, '')
  if (code.length !== 6) return false
  const key = base32Decode(secret)
  if (!key.length) return false
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const step = 30, now = Math.floor(Date.now() / 1000)
  for (let w = -2; w <= 2; w++) {
    const counter = Math.floor(now / step) + w
    const buf = new ArrayBuffer(8); const view = new DataView(buf)
    view.setUint32(0, Math.floor(counter / 0x100000000)); view.setUint32(4, counter >>> 0)
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', ck, buf))
    const offset = hmac[hmac.length - 1] & 0x0f
    const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
    if ((bin % 1000000).toString().padStart(6, '0') === code) return true
  }
  return false
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Comparación de secretos en tiempo constante: con === el tiempo de respuesta
// delataba cuántos caracteres del inicio coincidían.
function igualSeguro(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''))
  let d = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return d === 0
}
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const MOUV_API_KEY = (Deno.env.get('MOUV_API_KEY') ?? '').trim()
// Overridable por si mañana cambia el host o hay sandbox; default = prod.
const MOUV_BASE = (Deno.env.get('MOUV_BASE_URL') ?? 'https://consola.mouvlatam.com/api').replace(/\/+$/, '')

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Crédito/reintegro ATÓMICO de un riel COP (bloqueo de fila vía adjust_balances)
// — evita la carrera de duplicación en reconcile/webhooks (pentest #3). Fallback
// a read-write si la RPC no está desplegada.
// Devuelve SI SE ACREDITO O NO. Antes devolvia void y los llamadores asumian
// que habia funcionado -- marcaban la fila como reembolsada y seguian. Si el
// ajuste fallaba, la fila quedaba marcada, el CAS impedia reintentarla, y el
// cliente perdia el reembolso de forma definitiva y sin rastro.
// ── FIRMA DEL SERVIDOR EN LAS FILAS QUE MUEVEN PLATA ──────────────────
// Un cliente puede insertar filas en `transactions` con su propia sesión
// (RLS lo permite para algunos tipos). Una fila 'dispersion' en Procesando
// inventada, con el providerRef de un envío real rechazado, se reembolsaba
// en la conciliación — con el monto que el atacante quisiera. Las filas que
// crea ESTE servidor llevan una firma (HMAC con la llave de servicio, que el
// navegador no tiene). Sin firma válida no hay reembolso ni crédito
// automático: queda para revisión de un admin.
async function firmaFila(userId: string, type: string, amount: number, currency: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${userId}|${type}|${Number(amount)}|${currency}`)))
  return Array.from(sig.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')
}
async function filaFirmada(tx: any, type: string): Promise<boolean> {
  const f = String(tx?.raw_data?.firmaServidor ?? '')
  if (!f) return false
  return f === await firmaFila(String(tx.user_id), type, Number(tx.amount ?? 0), String(tx.currency ?? ''))
}
async function aRevisionSinFirma(tx: any, origen: string) {
  try {
    await db.from('transactions').update({ raw_data: { ...(tx.raw_data ?? {}), revisionManual: true, sinFirmaServidor: true, sinFirmaVistaAt: new Date().toISOString() } }).eq('id', tx.id)
    await logAudit(String(tx.user_id), 'mouv.fila_sin_firma', { txId: tx.id, origen, amount: tx.amount, currency: tx.currency })
    await avisarAdminSinConfirmar({ id: tx.id, user_id: tx.user_id, amount: tx.amount, currency: tx.currency, raw_data: tx.raw_data })
  } catch { /* la revisión manual es el resguardo; el aviso es un extra */ }
}

// Mensaje al cliente cuando Bre-B · Cuenta 2 no sale. `debitado` = si ya se
// le había descontado (falló al confirmar) o no (falló al preparar).
function mensajeFalloBreb2(fb: ResultadoBreb2, debitado: boolean): string {
  const provMsg = fb.mensaje ? null : digMotivoRechazo(fb.body)
  const errText = `${provMsg ?? ''} ${(() => { try { return JSON.stringify(fb.body ?? '') } catch { return '' } })()}`.toLowerCase()
  const llaveMala = fb.paso === 'crear' && /key|llave|not\s*found|no existe|inv[aá]lid|no.{0,3}activ/.test(errText)
  const motivo = motivoParaCliente(provMsg)
  // Falla DEL PROVEEDOR (error de su servidor, credencial rechazada, tiempo de
  // espera o límite): no es la llave. Antes se le decía al cliente "revisa la
  // llave" (visto el 2026-10-30: cuatro HTTP 500 de Finity seguidos).
  const st = Number(fb.httpStatus ?? 0)
  const fallaProveedor = st >= 500 || st === 401 || st === 403 || st === 408 || st === 429
  const base = fb.mensaje
    ?? (fallaProveedor
      ? 'Bre-B · Cuenta 2 tiene una falla en este momento, así que no salió nada. Envíalo por ACH o inténtalo de nuevo en unos minutos. Tu saldo fue devuelto.'
      : llaveMala
      ? 'La llave Bre-B del beneficiario no es válida o no está activa. Pídele que te confirme su llave exacta y vuelve a intentarlo. Tu saldo fue devuelto.'
      : motivo
        ? `No pudimos completar el envío Bre-B: ${motivo}. Tu saldo fue devuelto.`
        // Rechazado al CREAR sin un motivo mostrable: algo que hacer en vez
        // de "intenta más tarde", que con un rechazo por datos falla igual.
        : fb.paso === 'crear'
          ? 'La red Bre-B no aceptó este envío por la Cuenta 2, así que no salió nada. Revisa que la llave del beneficiario esté bien escrita; si lo está, envíalo por Bre-B · Cuenta 1 o por ACH. Tu saldo fue devuelto.'
          : 'No pudimos completar el envío Bre-B en este momento. Tu saldo fue devuelto — puedes intentarlo de nuevo en unos minutos.')
  if (debitado) return base
  return base.replace(/\s*Tu saldo fue devuelto[^.]*\.?/, '').trim() + ' No se descontó nada de tu saldo.'
}

// ── ¿Se puede reembolsar ESTA fila sola, sin un admin? ───────────────────
// La firma cubre usuario|tipo|monto|moneda, y el cliente lee sus propias
// filas: una fila inventada con el MISMO monto que un envío suyo rechazado
// copia la firma tal cual, con la referencia de ese envío, y se reembolsaba
// otra vez — sumando además la comisión que el cliente quisiera escribir.
// Dos cierres, sin tocar la firma:
//   · un movimiento del proveedor se reembolsa UNA vez: si su referencia está
//     en otra fila de envío, ninguna de las dos se reembolsa sola — va a
//     revisión de un admin;
//   · la comisión que se devuelve no es la que diga la fila sino, como mucho,
//     la que cobra el servidor.
async function reembolsoPermitido(tx: any, ref: string, origen: string): Promise<{ ok: boolean; refund: number }> {
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const amount = Number(tx.amount ?? 0)
  const feeMax = Math.max(ACH_FEE_COP, BREB2_FEE_COP, BREB_FEE_COP, brebFeeCop(amount))
  const fee = Math.min(Math.max(0, Number(rd.feeCop ?? 0) || 0), feeMax)
  const refund = Number((amount + fee).toFixed(2))
  if (!ref) return { ok: true, refund }
  const { data: otras, error } = await db.from('transactions').select('id')
    .eq('type', 'dispersion').filter('raw_data->>providerRef', 'eq', ref).neq('id', tx.id).limit(1)
  // Si no se pudo comprobar, no se reembolsa ahora: la próxima vuelta reintenta.
  if (error) return { ok: false, refund }
  if (otras?.length) {
    if (!rd.refDuplicada) {
      try {
        await db.from('transactions').update({ raw_data: { ...rd, revisionManual: true, refDuplicada: true, refDuplicadaConId: (otras[0] as any).id, refDuplicadaVistaAt: new Date().toISOString() } }).eq('id', tx.id)
        await logAudit(String(tx.user_id), 'reembolso.ref_duplicada', { txId: tx.id, otraFila: (otras[0] as any).id, providerRef: ref, origen, amount, feeFila: rd.feeCop ?? null })
        await avisarAdminSinConfirmar({ id: tx.id, user_id: tx.user_id, amount: tx.amount, currency: tx.currency, raw_data: rd })
      } catch { /* la marca y el aviso son extra: igual no se reembolsa */ }
    }
    return { ok: false, refund }
  }
  return { ok: true, refund }
}

const rpcNoExiste = (e: any): boolean => !!e && /42883|PGRST202|could not find the function|function .* does not exist/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`)

// El mensaje al cliente cuando el reintegro NO se pudo hacer en el momento:
// no se le dice "fue devuelto" si no lo fue.
function conReintegro(msg: string, ok: boolean): string {
  return ok ? msg : msg.replace(/Tu saldo fue devuelto[^.]*\.?/, 'Estamos devolviendo tu saldo: si en unos minutos no lo ves, escríbenos a soporte.')
}
const marcasReintegro = (ok: boolean) => ok ? { refunded: true } : { refunded: false, reembolsoPendiente: true, revisionManual: true }

// Devolver el saldo de un envío que no salió. Si no se pudo devolver, la fila
// NO se marca reembolsada: queda en revisión y se avisa a los admins.
async function reintegrarEnvio(userId: string, railCol: string, total: number): Promise<{ ok: boolean; saldo: number | null }> {
  const { data: adj, error } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [railCol]: total } })
  if (!error && !(adj as any)?.error) return { ok: true, saldo: Number(((adj as any)?.balances?.[railCol]) ?? 0) }
  if (!error || !rpcNoExiste(error)) {
    await logAudit(userId, 'envio.reintegro_no_aplicado', { railCol, total, motivo: (adj as any)?.error ?? error?.message ?? null })
    return { ok: false, saldo: null }
  }
  const ok = await creditBalanceAtomic(userId, railCol, total)
  return { ok, saldo: null }
}

async function creditBalanceAtomic(userId: string, col: string, delta: number): Promise<boolean> {
  // `adjust_balances` devuelve {error:'not_found'} o {error:'insufficient'}
  // como respuesta EXITOSA (200, sin error de transporte). Mirar solo `error`
  // daba el ajuste por bueno cuando el payload decia que no se hizo nada.
  const { data: adj, error } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [col]: delta } })
  if (!error && !(adj as any)?.error) return true
  // Un error DE PAYLOAD es una respuesta del servidor, no un problema de
  // transporte: reintentarlo a mano da el mismo resultado. 'insufficient' sobre
  // un delta negativo es un faltante real y hay que verlo, no taparlo.
  if (!error) {
    await logAudit(userId, 'balance.ajuste_rechazado', { col, delta, motivo: (adj as any)?.error ?? null })
    return false
  }

  // Un error de transporte (la respuesta se perdió) NO se reintenta a mano:
  // el ajuste pudo haberse aplicado y repetirlo acreditaría dos veces. Queda
  // como no hecho, y quien llama lo marca para revisión. El respaldo manual es
  // solo para una base sin adjust_balances.
  if (!rpcNoExiste(error)) {
    await logAudit(userId, 'balance.ajuste_incierto', { col, delta, motivo: error?.message ?? null })
    return false
  }
  const { data: u, error: leerErr } = await db.from('users').select('balances').eq('id', userId).single()
  // SIN ESTA GUARDA se escribia `balances = { [col]: delta }` cuando la lectura
  // fallaba: se perdian COP, COP_ACH, USD y todo lo demas del usuario en una
  // sola escritura. Y este respaldo corre justo cuando la base ya viene
  // inestable, que es cuando esa lectura tiene mas chance de fallar tambien.
  if (leerErr || !u || typeof (u as any).balances !== 'object' || (u as any).balances === null) {
    await logAudit(userId, 'balance.ajuste_fallido', { col, delta, motivo: leerErr?.message ?? 'no se pudo leer el saldo' })
    return false
  }
  const bals: Record<string, number> = ((u as any).balances ?? {}) as any
  const nb = parseFloat((Number(bals[col] ?? 0) + delta).toFixed(2))
  if (nb < 0) {
    await logAudit(userId, 'balance.ajuste_negativo', { col, delta, actual: bals[col] ?? 0 })
    return false
  }
  const { error: escribirErr } = await db.from('users').update({ balances: { ...bals, [col]: nb } }).eq('id', userId)
  if (escribirErr) {
    await logAudit(userId, 'balance.ajuste_fallido', { col, delta, motivo: escribirErr.message })
    return false
  }
  return true
}

// ── AVISO AL TELEFONO DEL CLIENTE ─────────────────────────────────
// Cuando un envio se devuelve, el cliente tiene que enterarse YA: del otro lado
// hay alguien esperando ese pago y, hasta que no lo sepa, no puede rehacerlo ni
// avisarle a su beneficiario. El correo llega, pero se lee cuando se lee.
//
// Nunca frena nada: si el push falla, el reembolso ya ocurrio y lo que
// corresponde es seguir.
async function avisarCliente(userId: string, titulo: string, cuerpo: string, tag: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'enviar', user_ids: [userId], titulo, cuerpo, tag, url: '/movimientos', insistir: true }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el aviso es un extra, no una condicion */ }
}

// ── AVISO AL ADMIN POR DISPERSION SIN CONFIRMAR ───────────────────
// Los botones de Fallos resuelven el caso, pero no evitan que se repita:
// alguien tiene que MIRAR. Dos veces ya quedo plata de un cliente en el aire
// porque nadie se entero a tiempo.
//
// Esto avisa una sola vez por dispersion (flag alertaEnviada) cuando lleva
// demasiado sin confirmarse. No resuelve nada solo -- confirmar o devolver
// sigue siendo una decision humana contra la consola del proveedor -- pero
// hace imposible que pase inadvertido.
async function avisarAdminSinConfirmar(tx: any): Promise<boolean> {
  const KEY = Deno.env.get('RESEND_API_KEY') ?? ''
  const FROM = Deno.env.get('OTP_FROM_EMAIL') ?? Deno.env.get('FROM_EMAIL') ?? 'no-reply@lincoin.me'
  const ADMIN = Deno.env.get('VITE_ADMIN_EMAIL') ?? Deno.env.get('ADMIN_EMAIL') ?? ''
  if (!KEY || !ADMIN) return false
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const horas = Math.floor((Date.now() - new Date(tx.created_at).getTime()) / 3600_000)
  const monto = Number(tx.amount ?? 0).toLocaleString('es-CO')
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM}>`, to: [ADMIN],
        subject: `Dispersion sin confirmar hace ${horas} h - ${monto} COP`,
        html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F0EFEB;font-family:Arial,sans-serif">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFF;border:1px solid rgba(21,24,26,0.08);border-radius:14px"><tr><td style="padding:26px">
<p style="font-family:'Archivo',Arial,sans-serif;font-size:21px;font-weight:800;color:#15181A;margin:0">Lincoin<span style="color:#22A35C">.</span></p>
<p style="font-size:17px;font-weight:800;color:#15181A;margin:20px 0 8px">Una dispersion lleva ${horas} h sin confirmar</p>
<p style="font-size:13px;color:#5C625E;line-height:1.6;margin:0 0 16px">El proveedor acepto el envio pero no confirmo que se pagara, y el saldo del cliente ya esta debitado. Hay que cotejarlo en la consola del proveedor y resolverlo: confirmarlo o devolver el dinero.</p>
<table width="100%" style="font-size:12.5px">
<tr><td style="padding:8px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Monto</td><td align="right" style="padding:8px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${monto} COP</td></tr>
<tr><td style="padding:8px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Beneficiario</td><td align="right" style="padding:8px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700">${String(rd.beneficiary ?? '-')}</td></tr>
<tr><td style="padding:8px 0;border-top:1px solid rgba(21,24,26,0.06);color:#5C625E">Referencia</td><td align="right" style="padding:8px 0;border-top:1px solid rgba(21,24,26,0.06);color:#15181A;font-weight:700;font-family:monospace">${String(rd.providerRef ?? '-')}</td></tr>
</table>
<p style="font-size:12.5px;color:#5C625E;margin:18px 0 0;line-height:1.6">Se resuelve en <b style="color:#15181A">Admin &rarr; Fallos</b>, con los botones Devolver y reembolsar / Confirmar como pagada.</p>
</td></tr></table></body></html>`,
      }),
    })
    if (!r.ok) { console.error(`[mouv] aviso admin rechazado HTTP ${r.status}`); return false }
    return true
  } catch (e) {
    console.error('[mouv] fallo el aviso al admin:', (e as Error)?.message)
    return false
  }
}

// Dispara el correo transaccional del envío directamente contra
// notify-transaction (con service role), sin depender del webhook de la base
// — que NO estaba llegando para las dispersiones. notify-transaction deduplica
// por su propio flag (notified / notified_completed / notified_failed), así
// que llamarlo por cada cambio de estado no manda repetidos.
async function notifyTx(txId: number | string | null): Promise<void> {
  if (txId == null) return
  try {
    const { data: full } = await db.from('transactions').select('*').eq('id', txId).single()
    if (!full) return
    await fetch(`${SUPABASE_URL}/functions/v1/notify-transaction`, {
      method: 'POST',
      headers: await cabecerasInternas(db),
      body: JSON.stringify({ type: 'UPDATE', table: 'transactions', record: full }),
    })
  } catch { /* correo best-effort — nunca romper el flujo de dinero */ }
}

// Llamada autenticada a Mouv. Timeout duro para no colgar el proxy si Mouv
// no responde. Devuelve { ok, status, data, path } sin lanzar.
async function mouvFetch(path: string, init: RequestInit = {}, _reintento = false): Promise<{ ok: boolean; status: number; data: any; path: string }> {
  try {
    const r = await fetch(`${MOUV_BASE}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${MOUV_API_KEY}`,
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(20000),
    })
    // 429: Mouv dice en `Retry-After` los segundos EXACTOS que faltan, y una
    // 429 no consume cuota. Se espera y se reintenta UNA vez.
    //
    // SOLO EN LECTURAS. Reintentar solo un POST que mueve plata seria buscarse
    // un doble pago: aunque una 429 significa que no se proceso, el reintento
    // automatico sobre una operacion financiera es exactamente el tipo de
    // atajo que termina pagando dos veces. Esas vuelven con el 429 y decide
    // quien llamo.
    const metodo = String(init.method ?? 'GET').toUpperCase()
    if (r.status === 429 && !_reintento && metodo === 'GET') {
      const seg = Number(r.headers.get('Retry-After') ?? '1')
      // Tope de 15 s: esperar un minuto adentro de una edge function la deja
      // colgada y el cliente ve un timeout en vez de un error entendible.
      const espera = Math.min(Number.isFinite(seg) && seg > 0 ? seg : 1, 15)
      await new Promise(res => setTimeout(res, espera * 1000))
      return mouvFetch(path, init, true)
    }

    const text = await r.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: r.ok, status: r.status, data, path }
  } catch (e) {
    return { ok: false, status: 0, data: { error: (e as Error)?.message ?? String(e) }, path }
  }
}

// ══════════════════════════════════════════════════════════════════
//  DISPERSIÓN REAL CON MOUV — POST /api/transfers/send (destino inline)
//  ------------------------------------------------------------------
//  Contrato (quickstart de la doc):
//   BREB → { amount, destination:{ brebKey:{ type, value } }, targetName,
//            targetDocument, reference }  → 201 { id, status:'PENDING', rail }
//   `targetName` + `targetDocument` son OBLIGATORIOS SARLAFT: se sacan de
//   POST /api/transfers/resolve-key { keyValue } → recipient.fullName / idValue.
//
//  `recipient` que llega del front:
//    BREB → { keyType:'celular'|'cedula'|'correo'|'alfanumerico', key, holderName?, reference? }
//    ACH  → { bankCode, accountType:'ahorros'|'corriente'|'deposito',
//             accountNumber, documentType, documentNumber, holderName, reference? }
//
//  UNIDAD: Mouv trabaja en CENTAVOS (confirmado contra el saldo real:
//  availableCents 3.173.093.200 = $31.730.932). El `amount` que llega a
//  mouvPayout viene en PESOS y se multiplica ×100 antes de enviarlo.
// ══════════════════════════════════════════════════════════════════

// Mapea el tipo de llave interno → el enum de Mouv (fallback; lo ideal es
// usar el keyType que devuelve resolve-key, que es autoritativo).
// Normaliza CUALQUIER tipo de llave (el interno: celular/correo/cedula/
// alfanumerico; o el que devuelve resolve-key: PHONE/EMAIL/MERCHANT/DOCUMENT/
// NRIC/…) al ENUM que EXIGE /transfers/send: PHONE | EMAIL | ALPHANUM | NRIC.
// Mouv rechaza con 400 cualquier otro valor (p. ej. 'MERCHANT', 'DOCUMENT',
// 'ALPHANUMERIC'). Si el tipo no se reconoce, se infiere por el formato del valor.
function brebTypeToMouv(t: string, keyValue?: string): 'PHONE' | 'EMAIL' | 'ALPHANUM' | 'NRIC' {
  const s = String(t ?? '').trim().toUpperCase()
  if (/PHONE|CELULAR|M[OÓ]VIL|MOBILE|TEL/.test(s)) return 'PHONE'
  if (/EMAIL|CORREO|MAIL/.test(s)) return 'EMAIL'
  if (/NRIC|C[EÉ]DULA|DOCUMENT|DOCUMENTO|\bCC\b|\bNIT\b|\bID\b/.test(s)) return 'NRIC'
  if (/ALPHANUM|ALFANUM|MERCHANT|COMERCIO|C[OÓ]DIGO|CODE|LLAVE|ALIAS/.test(s)) return 'ALPHANUM'
  // Tipo desconocido → inferir por el formato del valor de la llave.
  const v = String(keyValue ?? '').trim()
  if (/@/.test(v)) return 'EMAIL'
  const digits = v.replace(/[^\d]/g, '')
  if (/^\+?\d[\d\s-]{9,14}$/.test(v) && digits.length >= 10) return 'PHONE'
  if (/^\d{6,10}$/.test(digits)) return 'NRIC'
  return 'ALPHANUM'
}

// ── Resolver una llave Bre-B en el directorio de Mouv, con VARIANTES ──
// El directorio guarda los celulares con indicativo +57, así que una llave
// real como "3225407320" no se encuentra tal cual. Se prueban variantes (tal
// cual, +57…, sin +57, 10 dígitos) para celulares. Devuelve el titular
// (nombre/documento), su banco, el keyType autoritativo y la LLAVE que sí
// funcionó (matchedKey) para usarla también en el envío.
async function mouvResolveBrebKey(rawKey: string, keyType?: string): Promise<{
  found: boolean; matchedKey: string; fullName?: string; idValue?: string; keyType?: string; bank?: string; raw?: any; caido?: boolean;
}> {
  const key = String(rawKey ?? '').trim()
  const kt = String(keyType ?? '').trim().toLowerCase()
  const pick = (...xs: any[]) => { for (const x of xs) { const s = x == null ? '' : String(x).trim(); if (s) return s } return undefined }
  const digits = key.replace(/[^\d]/g, '')
  const isPhone = kt === 'celular' || kt === 'phone' || (/^\+?\d{10,13}$/.test(key) && digits.length >= 10)
  const variants: string[] = [key]
  if (isPhone && digits) {
    const d10 = digits.replace(/^57/, '')
    for (const v of [d10, `+57${d10}`, `57${d10}`]) if (!variants.includes(v)) variants.push(v)
  }
  let lastRaw: any = null
  // ¿Mouv contestó de verdad alguna vez? Si todas las variantes fallaron por
  // el proveedor (sin respuesta, 5xx, 401/403, 408, 429), "no encontrada"
  // sería mentira: al cliente le salía "La llave no existe" con el
  // directorio caído (MEXITECH, 30 oct) y terminaba inscribiendo por ACH.
  let respondio = false
  for (const kv of variants) {
    try {
      const rk = await mouvFetch('/transfers/resolve-key', { method: 'POST', body: JSON.stringify({ keyValue: kv }) })
      const rd: any = rk.data ?? {}
      lastRaw = rd
      const fallaProveedor = rk.status === 0 || rk.status >= 500 || [401, 403, 408, 429].includes(rk.status)
      if (!fallaProveedor) respondio = true
      if (!rk.ok) continue
      const rec = rd.recipient ?? rd.holder ?? {}
      const fullName = pick(rec.fullName, rec.name, rec.holderName, rd.fullName, rd.name)
      if (rd.found === true || (rd.found !== false && fullName)) {
        return {
          found: true, matchedKey: kv, fullName,
          idValue: pick(rec.idValue, rec.documentNumber, rec.docNumber, rec.id, rd.idValue),
          keyType: pick(rd.keyType, rec.keyType),
          bank: pick(rec.bank, rec.bankName, rec.entity, rec.financialEntity, rec.institution, rec.bankCode, rd.bank, rd.entity, rd.financialEntity),
          raw: rd,
        }
      }
    } catch { /* siguiente variante */ }
  }
  return { found: false, matchedKey: key, raw: lastRaw, caido: !respondio }
}

// El id que Mouv le pone a la operación, sacado de su respuesta al ENVIAR.
//
// Se leía solo `data.id`. Pero el emparejamiento del listado (idsDe) ya
// tolera cuatro nombres distintos —id, transactionId, reference, externalId—
// porque Mouv no es consistente entre endpoints. Leer un solo nombre al
// enviar era la mitad de esa tolerancia, y si el id venía con otro nombre o
// un nivel más adentro, se perdía: sin él, la conciliación queda sin su mejor
// ancla y tiene que adivinar por monto y nombre.
//
// NO se acepta `reference`: esa suele ser LA NUESTRA, la que mandamos como
// idempotencia. Guardarla como si fuera el id del proveedor haría que la
// consulta de estado pidiera un id que Mouv no conoce.
function refDeMouv(d: any): string | undefined {
  const sacar = (o: any): string | undefined => {
    if (!o || typeof o !== 'object') return undefined
    for (const k of ['id', 'transactionId', 'transaction_id', 'txId', 'externalId']) {
      const v = o[k]
      const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
      if (s) return s
    }
    return undefined
  }
  // Nivel de arriba primero; después los envoltorios que usan algunas APIs.
  return sacar(d) ?? sacar(d?.data) ?? sacar(d?.transaction) ?? sacar(d?.result)
}

async function mouvPayout(
  rail: 'BREB' | 'ACH',
  recipient: Record<string, any>,
  amountCop: number,
): Promise<{ ok: boolean; status: number; data: any; providerRef?: string; referencia?: string; notImplemented?: boolean; targetName?: string; targetDocument?: string }> {
  // Mouv trabaja en CENTAVOS (confirmado contra el saldo real). El monto que
  // llega es en PESOS → se convierte a centavos para /transfers/send.
  const amountCents = Math.round(amountCop * 100)
  // Los contactos pueden traer placeholders ("—", "-") en nombre/documento;
  // NO sirven para SARLAFT ni para Mouv → tratarlos como ausentes.
  const cleanField = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim()
    return s && s !== '—' && s !== '-' && s !== 'N/A' ? s : undefined
  }
  if (rail === 'BREB') {
    // 1) Resolver la llave (con variantes de formato) para el titular SARLAFT.
    let targetName: string | undefined = cleanField(recipient.holderName)
    let targetDocument: string | undefined = cleanField(recipient.documentNumber ?? recipient.docNumber)
    let sendKey = String(recipient.key ?? '').trim()   // la llave a usar en el envío
    let keyType = brebTypeToMouv(recipient.keyType, sendKey)
    const rr = await mouvResolveBrebKey(recipient.key, recipient.keyType)
    if (rr.found) {
      targetName = rr.fullName ?? targetName
      targetDocument = rr.idValue ?? targetDocument
      sendKey = rr.matchedKey || sendKey               // la variante que sí existe (p. ej. +57…)
      // El keyType de resolve-key es autoritativo, PERO se normaliza al enum del
      // send (PHONE/EMAIL/ALPHANUM/NRIC): resolve puede devolver 'MERCHANT',
      // 'DOCUMENT', etc., que el send rechaza con 400.
      if (rr.keyType) keyType = brebTypeToMouv(rr.keyType, sendKey)
    }
    // Si resolve NO la encontró pero el beneficiario YA trae nombre + documento
    // (se inscribió y validó antes), NO se aborta el envío: Mouv hará la
    // validación final en /transfers/send. Solo se aborta si de plano faltan
    // los datos SARLAFT (ni resueltos ni guardados).
    // 422 y no 0: acá no se llamó a Mouv, así que el envío NO salió. Con
    // status 0 el pago se trataba como "no sabemos si salió": el saldo
    // quedaba retenido y al cliente se le decía que no reintentara.
    if (!targetName || !targetDocument) {
      return { ok: false, status: 422, data: { error: 'missing_sarlaft', noSalio: true, message: 'No pudimos confirmar a nombre de quién está esa llave Bre-B. Revisa la llave o completa el documento del beneficiario y vuelve a intentar.', resolveDebug: rr.raw ?? null } }
    }

    // Referencia ÚNICA por envío: si Mouv dedupe por referencia (409 Conflict
    // al repetir {monto, destino, referencia}), un reintento tras reembolso o
    // dos envíos iguales chocarían. El sufijo corto evita la colisión.
    const refBase = cleanField(recipient.reference) ?? 'Pago Lincoin'
    const refUniq = `${refBase} ${Date.now().toString(36).slice(-5)}`
    const cuerpoEnvio = JSON.stringify({
      amount: amountCents,
      destination: { brebKey: { type: keyType, value: sendKey } },
      targetName,
      targetDocument,
      reference: refUniq,
    })
    const t0 = Date.now()
    let r = await mouvFetch('/transfers/send', { method: 'POST', body: cuerpoEnvio })

    // UN 5xx O UN TIMEOUT NO SIGNIFICAN "NO SALIO".
    //
    // Significan que no sabemos: la transferencia pudo haberse despachado y
    // haberse cortado la respuesta. Hasta ahora eso se trataba como fallo y se
    // REEMBOLSABA al cliente en el acto -- si la plata igual habia salido, se
    // pagaba dos veces.
    //
    // Mouv da la salida: `reference` es idempotency key por 60 segundos.
    // Reenviar EXACTAMENTE lo mismo no crea un segundo envio; devuelve el que
    // ya existe. Asi que ante un 5xx se pregunta de nuevo con la misma
    // referencia: si habia salido, vuelve con su id; si no, vuelve el error de
    // verdad.
    //
    // Solo dentro de la ventana de 60 s. Pasada, un reenvio SI crearia una
    // transferencia nueva, que es exactamente lo que se esta evitando.
    const transitorio = r.status === 0 || r.status >= 500
    if (transitorio && Date.now() - t0 < 45_000) {
      const reintento = await mouvFetch('/transfers/send', { method: 'POST', body: cuerpoEnvio })
      // SOLO se acepta el reintento si vuelve OK.
      //
      // Es tentador quedarse tambien con un 4xx "porque es mas informativo", y
      // eso es justo lo que no hay que hacer: si el primer POST SI despacho la
      // transferencia y solo se perdio la respuesta, el reintento con la misma
      // referencia puede volver 409 (referencia duplicada, o ventana
      // antiestructuracion). Tomar ese 409 como respuesta convierte un
      // desenlace DESCONOCIDO en un "rechazo claro", y el rechazo claro
      // reembolsa: el beneficiario cobrado y el cliente reintegrado, hasta 12
      // millones por evento, sin que nadie se entere -- la fila queda 'Fallido'
      // y la conciliacion no mira las Fallido.
      //
      // Un reintento tras un 5xx solo aporta cuando confirma que la
      // transferencia existe. Cualquier otra cosa deja el desenlace como lo que
      // es: desconocido.
      if (reintento.ok) r = reintento
    }
    // Devolver el titular RESUELTO (oficial, de resolve-key) para que el
    // comprobante muestre el nombre/documento reales del beneficiario.
    // La referencia EXACTA que se mando vuelve con el resultado. Sin esto no
    // quedaba guardada en ningun lado -- `reason` tiene la base, no el sufijo
    // unico -- y era otra forma de no poder reencontrar el envio en Mouv.
    return { ok: r.ok, status: r.status, data: r.data, providerRef: refDeMouv(r.data), referencia: refUniq, targetName, targetDocument }
  }

  // ── ACH — mismo endpoint /transfers/send con destino de cuenta bancaria.
  // ⚠️ La forma EXACTA del destino ACH no está en el quickstart (la página
  // "Retiros ACH" → /api-reference/transfers/send la tiene). Este body es la
  // forma más probable; ajústalo aquí cuando veas esa página.
  const r = await mouvFetch('/transfers/send', {
    method: 'POST',
    body: JSON.stringify({
      amount: amountCents,
      destination: {
        bankAccount: {
          bankCode: recipient.bankCode,
          accountType: (recipient.accountType || '').toUpperCase(),  // AHORROS | CORRIENTE | DEPOSITO
          accountNumber: recipient.accountNumber,
        },
      },
      targetName: recipient.holderName,
      targetDocument: recipient.documentNumber,
      reference: recipient.reference ?? 'Pago Lincoin',
    }),
  })
  return { ok: r.ok, status: r.status, data: r.data, providerRef: refDeMouv(r.data), targetName: recipient.holderName, targetDocument: recipient.documentNumber }
}

// ── Estado REAL de una transferencia Mouv ───────────────────────────
// Mouv responde /transfers/send con 201 { id, status:'PENDING', rail }: el
// 200 SÓLO significa "aceptada para procesar", NO "pagada". La transferencia
// puede terminar DEVUELTA (rechazada por el banco destino) minutos después.
// Este normalizador clasifica cualquier estado (español o inglés) de Mouv en
// un veredicto accionable, para no marcar Completado algo que fue devuelto.
type MouvVerdict = 'completed' | 'returned' | 'pending' | 'unknown'

// El MOTIVO humano de un rechazo, tal como lo escribe el operador del riel
// (Finity: "CUENTA Y NIT NO CORRESPONDEN"). Cada endpoint lo pone en una
// clave y un nivel distintos, así que se busca en todo el cuerpo: primero
// las claves que SOLO significan motivo de rechazo; si no hay, las genéricas
// (reason/description/message) que a veces traen el texto. Nunca devuelve
// JSON ni códigos: si lo que hay no parece una frase, no se muestra.
const CLAVES_MOTIVO = ['rejectionreason', 'rejection_reason', 'rejectreason', 'reject_reason', 'rejectedreason', 'rejected_reason', 'failurereason', 'failure_reason', 'failedreason', 'failed_reason', 'statusreason', 'status_reason', 'statusdetail', 'status_detail', 'statusdescription', 'status_description', 'errormessage', 'error_message', 'errordescription', 'error_description', 'declinereason', 'decline_reason', 'motivo', 'motivo_rechazo', 'motivorechazo', 'motivo_de_rechazo', 'observation', 'observations', 'observacion', 'observaciones', 'cause', 'causa', 'detail', 'details']
const CLAVES_MOTIVO_DEBIL = ['reason', 'description', 'message', 'mensaje', 'note', 'notes']
// `excluir`: textos que NO son un motivo de rechazo aunque vengan en un campo
// parecido — sobre todo el MOTIVO DEL PAGO que nosotros mismos mandamos con la
// orden ("Pago a proveedores"), que Finity puede devolver como `reason`.
// Además de los nombres exactos, se aceptan claves que CONTIENEN rechazo,
// devolución o causal (Finity no documenta el nombre del campo).
const CLAVE_MOTIVO_PARECIDA = /reject|rechaz|declin|devoluc|causal|return_?reason|bank_?(message|response|msg)|response_?(message|msg)|status_?(message|msg)|error_?(detail|msg|message)|failure/
const CLAVE_NO_MOTIVO = /(_at|_id|date|time|code|count|amount|fee|cost)$/
function digMotivoRechazo(o: any, excluir?: Set<string>, soloFuertes = false): string | null {
  const limpio = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (s.length < 3 || s.length > 300) return null
    if (/[{}\[\]]|http\s*\d|status\s*code|\bnull\b|undefined/i.test(s)) return null
    // Fechas, números, ids y estados sueltos no son un motivo.
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^[\d\s.,:$-]+$/.test(s) || /^[a-z]{2,5}-[0-9a-f]{4}-/i.test(s)) return null
    if (/^(rejected|failed|rechazad[oa]|declined|returned|cancell?ed|error|fallid[oa])$/i.test(s)) return null
    if (excluir?.has(s.toLowerCase())) return null
    return s
  }
  let debil: string | null = null
  const seen = new Set<any>(); const stack = [o]
  while (stack.length) {
    const c = stack.pop()
    if (!c || typeof c !== 'object' || seen.has(c)) continue
    seen.add(c)
    for (const [k, v] of Object.entries(c)) {
      const key = k.toLowerCase()
      if (CLAVES_MOTIVO.includes(key)) { const s = limpio(v); if (s) return s }
      if (CLAVE_MOTIVO_PARECIDA.test(key) && !CLAVE_NO_MOTIVO.test(key)) { const s = limpio(v); if (s) return s }
      if (!debil && (CLAVES_MOTIVO_DEBIL.includes(key) || key === 'error')) debil = limpio(v)
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return soloFuertes ? null : debil
}

// ¿Se le puede mostrar este texto del proveedor al CLIENTE? Solo si es un
// motivo que el cliente entiende ("NUMERO CUENTA NO EXISTE"). Jerga técnica en
// inglés o el nombre de un aliado no: "Bad request to Kamin API" llegó tal
// cual a la pantalla de un cliente — no le explica nada y le muestra con quién
// operamos. Ese texto es para soporte y queda guardado en la fila.
const JERGA_TECNICA = /[{}\[\]<>]|https?:|http\s*\d|status\s*code|\b(api|request|bad|internal|server|gateway|timeout|timed?\s*out|exception|stack|null|undefined|token|unauthori[sz]ed|forbidden|payload|endpoint|json|errors?|path|brebkey)\b/i
const NOMBRES_ALIADOS = /\b(kamin|finity|mouv|gowd|kumplo|tusdatos|sumsub|fireblocks|circle|tatum|gasfree|resend|crisp)\b/i
const EN_INGLES = /\b(the|to|of|is|was|not|could|cannot|can't|unable|failed|invalid|please|your|with|from)\b/i
function motivoParaCliente(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim().replace(/[.\s]+$/, '')
  if (t.length < 3 || t.length > 240) return null
  if (JERGA_TECNICA.test(t) || NOMBRES_ALIADOS.test(t) || EN_INGLES.test(t)) return null
  // Tiene que ESTAR EN ESPAÑOL. La lista de palabras en inglés nunca alcanza:
  // "Insufficient funds", "Conflict" o "Daily limit exceeded" pasaban.
  if (!/\b(de|del|la|el|los|las|no|en|por|para|con|sin|al|es|se|y|cuenta|banco|titular|documento|llave|existe|corresponde[n]?|v[aá]lid[ao]|inv[aá]lid[ao]|rechazad[ao]|bloquead[ao])\b/i.test(t)) return null
  // "Saldo insuficiente" del proveedor es el de NUESTRA cuenta con él, no el
  // del cliente: mostrarlo así le hace creer que le falta plata a él.
  if (/\b(saldo|fondos)\b/i.test(t)) return null
  return t
}

// El motivo de un rechazo de Finity, buscado a fondo. Primero en la respuesta
// de estado que ya se tiene; si no está, se le pide a finity-proxy todo lo que
// Finity sepa de ese movimiento (otras rutas del detalle, el listado y el
// backend del portal, que es donde el portal lo muestra). Si tampoco aparece,
// queda la respuesta CRUDA en la auditoría para ver en qué campo viene.
// Lo que NOSOTROS mandamos con la orden (el motivo del pago, la referencia) y
// que el proveedor puede devolver en un campo genérico: no es un motivo de
// rechazo. Un solo conjunto para todas las búsquedas.
function textosQueNoSonMotivo(rd: Record<string, any>): Set<string> {
  return new Set(
    [...Object.values(MOTIVOS_ENVIO), rd?.motivoTexto, rd?.reason, rd?.reference, rd?.recipient?.reference, 'Envío de dinero', 'Pago Lincoin']
      .filter(Boolean).map(x => String(x).trim().toLowerCase()),
  )
}

async function motivoFinity(dueno: string, ref: string, st: any, rd: Record<string, any>): Promise<{ motivo: string | null; diag?: string }> {
  const excluir = textosQueNoSonMotivo(rd)
  let motivo = digMotivoRechazo(st, excluir)
  if (motivo) return { motivo }
  const m = await finityCall('motivo_rechazo', dueno, { id: ref })
  const cuerpos: any[] = Array.isArray(m?.cuerpos) ? m.cuerpos : []
  motivo = digMotivoRechazo(cuerpos.map(c => c?.data).filter(Boolean), excluir)
  const rutas = cuerpos.map(c => `${c?.fuente} ${c?.path} ${c?.status}`)
  if (motivo) {
    await logAudit(dueno, 'finity.motivo.encontrado', { ref, motivo, rutas })
    return { motivo }
  }
  const crudo = (() => { try { return JSON.stringify({ estado: st?.data ?? null, extra: st?.extra ?? null, cuerpos: cuerpos.filter(c => c?.data) }).slice(0, 8000) } catch { return null } })()
  await logAudit(dueno, 'finity.motivo.no_encontrado', { ref, rutas, crudo })
  return { motivo: null, diag: (clavesDe(st) + (cuerpos.length ? ` | ${clavesDe(cuerpos.map(c => c?.data).filter(Boolean))}` : '')).slice(0, 600) }
}
// Las rutas de las claves de un cuerpo (sin valores), para diagnosticar en
// qué campo manda el operador el motivo. Los valores NO se copian: traen
// datos del beneficiario.
function clavesDe(o: any, prefijo = '', out: string[] = [], nivel = 0): string {
  if (nivel > 4 || !o || typeof o !== 'object') return out.join(',')
  for (const [k, v] of Object.entries(o)) {
    const p = prefijo ? `${prefijo}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) clavesDe(v, p, out, nivel + 1)
    else if (Array.isArray(v)) { out.push(`${p}[${v.length}]`); if (v[0] && typeof v[0] === 'object') clavesDe(v[0], `${p}[0]`, out, nivel + 1) }
    else out.push(`${p}:${typeof v === 'string' ? `s${v.length}` : typeof v}`)
    if (out.length > 80) break
  }
  return out.join(',')
}

function normalizeMouvState(raw: any): { verdict: MouvVerdict; state: string } {
  const pickState = (o: any): string => {
    if (o == null) return ''
    if (typeof o === 'string') return o
    // `kaminStatus` VA PRIMERO, y es el que importa.
    //
    // GET /wallets/transactions/:id devuelve 200 con el estado en ESE campo,
    // no en `status`. Como no estaba en esta lista, una respuesta perfectamente
    // buena se leia como "sin estado legible": se descartaba, se seguian
    // probando rutas adivinadas, y la consulta terminaba en "respuesta
    // inesperada (HTTP 200)".
    //
    // Eso fue LA causa de que un envio ya COMPLETED en Mouv se quedara en
    // "Procesando" en Lincoin durante dias. El proveedor contestaba bien todo
    // el tiempo; le estabamos preguntando por un campo que no existe.
    return String(
      o.kaminStatus ?? o.status ?? o.state ?? o.transferStatus ?? o.result
      ?? o?.data?.kaminStatus ?? o?.data?.status ?? o?.data?.state ?? '',
    )
  }
  const s = pickState(raw).trim().toUpperCase()
  if (!s) return { verdict: 'unknown', state: '' }

  // ── ESTADOS DOCUMENTADOS DE MOUV ──────────────────────────────────
  // El ciclo de vida real de /transfers/send es: PENDING, AWAITING_APPROVAL,
  // EXECUTING, COMPLETED, FAILED, EXPIRED.
  //
  // Tres de esos seis NO los reconocian las expresiones regulares de abajo, que
  // se escribieron a ciegas cuando la doc estaba bloqueada: AWAITING_APPROVAL,
  // EXECUTING y EXPIRED caian todos en 'unknown'. Un EXPIRED clasificado como
  // "no se" es plata que no salio y que nadie reembolsa.
  //
  // Por eso la tabla EXPLICITA va PRIMERO y las regex quedan solo de red para
  // estados no documentados. Adivinar esta bien cuando no hay otra; con la
  // lista oficial a la vista, adivinar es un error.
  const OFICIALES: Record<string, MouvVerdict> = {
    PENDING: 'pending',
    AWAITING_APPROVAL: 'pending',   // esperando firma, todavia no salio
    EXECUTING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'returned',             // la consola de Mouv lo muestra "Devuelto"
    EXPIRED: 'returned',            // vencio sin ejecutarse: la plata no salio
  }
  if (OFICIALES[s]) return { verdict: OFICIALES[s], state: s }
  // DEVUELTO / RETURNED / RECHAZADO / FALLIDO / CANCELADO → dinero NO salió.
  // Términos EXPLÍCITOS de devolución (se quitó 'ERROR' genérico y 'OK\b'/'DONE'
  // ambiguos): un falso 'returned' dispara un reembolso, así que el veredicto
  // que mueve dinero exige un estado inequívoco.
  if (/DEVUEL|RETURN|RECHAZ|REJECT|FAILED|FALLID|CANCEL|ANUL|DECLIN|REVERS|REEMBOL|REFUND/.test(s)) return { verdict: 'returned', state: s }
  // COMPLETADO / EXITOSO / PAGADO / LIQUIDADO / SETTLED → pago final OK.
  if (/COMPLET|EXITOS|SUCCESS|\bPAID\b|PAGAD|SETTLE|LIQUID|APPROVED|APROBAD|DISPERSAD/.test(s)) return { verdict: 'completed', state: s }
  // PENDING / PROCESSING / EN PROCESO / ENVIADO → aún en curso.
  if (/PEND|PROCES|PROGRESS|SENT|ENVIAD|CREATED|CREAD|ACCEPTED|ACEPTAD|IN_TRANSIT|TRANSIT|QUEUE/.test(s)) return { verdict: 'pending', state: s }
  return { verdict: 'unknown', state: s }
}

// Consulta el estado de una transferencia Mouv por su id.
//
// LA RUTA BUENA ES /wallets/transactions/:id — ESTA DOCUMENTADA.
//   La doc de Mouv dice, textual, "Pollea el estado via GET
//   /wallets/transactions/:id o espera webhooks", y el `id` que devuelve
//   /transfers/send es ese mismo UUID, que es justo lo que guardamos en
//   raw_data.providerRef.
//
//   Hasta ahora se probaban seis rutas ADIVINADAS -- /transfers/:id,
//   /transactions/:id, /payments/:id y variantes -- y NINGUNA era la correcta.
//   Las seis daban 404, el veredicto salia 'unknown' siempre, y por eso ningun
//   envio Bre-B cambiaba de estado NUNCA: ni los exitosos ni, sobre todo, los
//   devueltos. El 19 de septiembre la consola de Mouv mostraba cuatro envios
//   DEVUELTOS que en Lincoin seguian diciendo "en curso", con el saldo del
//   cliente debitado y la plata ya de vuelta en la cuenta.
//
//   El prefijo /wallets es el mismo de /wallets/balance, que si funcionaba: la
//   pista estuvo todo el tiempo dos funciones mas abajo.
//
// Las adivinadas quedan DESPUES, solo por si un dia cambia la ruta oficial.
//
// LIMITE DE LECTURA: 100 req/min. Por eso la ruta oficial responde y se CORTA
// ahi. Antes se probaban las siete siempre que no hubiera respuesta util, y un
// barrido de cien envios gastaba setecientas consultas: se comia el limite,
// empezaba a recibir 429 y las que seguian quedaban sin veredicto.
type EstadoMouv = {
  found: boolean; verdict: MouvVerdict; state: string; raw: any
  path?: string; limitado?: boolean
  // Por que NO hubo veredicto. Sin esto, "sin respuesta del proveedor" tapa por
  // igual una ruta caida, una llave sin permiso, un id que Mouv no reconoce y
  // una fila nuestra sin referencia guardada -- cuatro problemas con cuatro
  // arreglos distintos. Es el mismo remedio que el diagnostico de KYT.
  diag?: { motivo: string; ruta?: string; httpStatus?: number; cuerpo?: string }
}

async function mouvTransferStatus(id: string, creadaAt?: string | null): Promise<EstadoMouv> {
  const tid = String(id ?? '').trim()
  if (!tid) return { found: false, verdict: 'unknown', state: '', raw: null, diag: { motivo: 'la fila no tiene providerRef guardado' } }
  const enc = encodeURIComponent(tid)
  const paths = [
    `/wallets/transactions/${enc}`,   // ← la documentada
    `/transfers/${enc}`, `/transfers/status/${enc}`, `/transfers/${enc}/status`,
    `/transfer/${enc}`, `/transactions/${enc}`, `/payments/${enc}`,
  ]
  // GUARD ANTI-FALSO-POSITIVO: como las rutas se ADIVINAN, una podría resolver
  // a OTRO recurso de Mouv (no esta transferencia) y devolver un estado que se
  // clasificara 'returned' → reembolso indebido de un pago que sí salió. Por
  // eso se EXIGE que el cuerpo de la respuesta referencie el MISMO id antes de
  // confiar en su estado. Si no lo referencia, la ruta apuntó a otra cosa.
  const bodyMentionsId = (data: any): boolean => {
    try { return JSON.stringify(data ?? '').includes(tid) } catch { return false }
  }
  // ¿El 404 es "esa transaccion no existe" o "esa ruta no existe"? Mouv
  // responde TRANSACTION_NOT_FOUND para lo primero.
  const esIdInexistente = (data: any): boolean => {
    try { return JSON.stringify(data ?? '').includes('TRANSACTION_NOT_FOUND') } catch { return false }
  }

  // PERO UN 404 RECIEN ENVIADO NO SIGNIFICA "NO EXISTE".
  // Los movimientos tardan en aparecer del lado de Mouv -- las notificaciones
  // de su consola llegan antes que el listado. Asi que un TRANSACTION_NOT_FOUND
  // sobre un envio de hace dos minutos es "todavia no aparecio", no "ese id no
  // es nuestro", y tratarlo como respuesta definitiva deja la dispersion
  // marcada como desconocida para siempre.
  //
  // Recien pasada esta ventana el 404 empieza a significar algo.
  const MIN_PARA_CREER_404 = 30
  const edadMin = creadaAt ? (Date.now() - new Date(creadaAt).getTime()) / 60000 : Number.POSITIVE_INFINITY
  const confiarEn404 = !Number.isFinite(edadMin) || edadMin >= MIN_PARA_CREER_404
  const recorte = (d: any): string => {
    try { return (typeof d === 'string' ? d : JSON.stringify(d ?? '')).slice(0, 400) } catch { return '(ilegible)' }
  }
  let lastRaw: any = null
  let primera: { ruta: string; httpStatus: number; cuerpo: string } | null = null
  for (const p of paths) {
    const r = await mouvFetch(p, { method: 'GET' })
    // Se guarda SIEMPRE lo que contesto la ruta oficial, responda lo que
    // responda: es lo unico que permite distinguir los cuatro motivos.
    if (!primera) primera = { ruta: p, httpStatus: r.status, cuerpo: recorte(r.data) }
    // 429 = se acabo el cupo de lectura. NO es "no se pudo confirmar": es "no
    // preguntamos". Se corta y se avisa, para que el barrido no siga quemando
    // cupo y para no confundir un limite con un estado desconocido.
    if (r.status === 429) return { found: false, verdict: 'unknown', state: '', raw: r.data, limitado: true, diag: { motivo: 'limite de consultas (429)', ...primera } }
    if (r.status === 404 && esIdInexistente(r.data)) {
      if (!confiarEn404) {
        return {
          found: false, verdict: 'unknown', state: '', raw: r.data, path: p,
          diag: { motivo: `el envio todavia no aparece en Mouv (${Math.round(edadMin)} min; su listado va detras de sus notificaciones)`, ...primera },
        }
      }
      return { found: false, verdict: 'unknown', state: '', raw: r.data, path: p, diag: { motivo: 'Mouv no reconoce ese id (TRANSACTION_NOT_FOUND)', ...primera } }
    }
    if (r.status === 404 || r.status === 0) continue
    lastRaw = r.data
    if (r.ok && bodyMentionsId(r.data)) {
      const n = normalizeMouvState(r.data)
      if (n.state) return { found: true, verdict: n.verdict, state: n.state, raw: r.data, path: p }
      // Ruta válida y del mismo id pero sin estado legible → seguir intentando.
    }
  }
  const motivo = !primera ? 'ninguna ruta respondio'
    : primera.httpStatus === 401 || primera.httpStatus === 403 ? `la llave no tiene permiso para leer (HTTP ${primera.httpStatus})`
    : primera.httpStatus === 404 ? 'la ruta oficial devolvio 404'
    : primera.httpStatus === 0 ? 'no se pudo conectar con Mouv'
    : `respuesta inesperada (HTTP ${primera.httpStatus})`
  return { found: false, verdict: 'unknown', state: '', raw: lastRaw, diag: { motivo, ...(primera ?? {}) } }
}

// ── LISTADO DE MOVIMIENTOS DE MOUV ────────────────────────────────
// GET /wallets/transactions?type=TRANSFER_OUT&rail=BREB&from=...  (scope READ)
//
// Esto resuelve el problema de raiz. La conciliacion por id necesita el UUID
// que Mouv devuelve al enviar, y el 19 de septiembre resulto que NINGUNA de 75
// filas lo tenia guardado: dos fallas encadenadas -- ruta equivocada e id
// ausente -- de las que solo se veia la primera.
//
// El listado no necesita el id: trae `status` ya puesto, asi que UNA consulta
// concilia todos los envios de la ventana en vez de una por envio. De paso
// deja de rozar el limite de 100 lecturas por minuto.
async function mouvListarBrebOut(desdeISO: string): Promise<{ ok: boolean; items: any[]; diag?: any; crudo?: string }> {
  const desdeMs = new Date(desdeISO).getTime()
  const items: any[] = []
  let primera: any = null
  let crudo = ''

  // SIN FILTROS EN LA URL, A PROPOSITO.
  // El primer intento pedia ?type=TRANSFER_OUT&rail=BREB&from=... y Mouv
  // devolvio CERO movimientos con HTTP 200 -- que es lo peor que puede pasar:
  // una respuesta exitosa y vacia se lee como "no hay nada que conciliar" y no
  // como "preguntaste mal". No sabemos si fue el enum, el formato de `from` o
  // la combinacion; lo que si sabemos es que no hace falta arriesgarse. Se pide
  // el listado pelado y se filtra ACA, donde se puede ver lo que llego.
  for (let page = 0; page < 10; page++) {
    const r = await mouvFetch(`/wallets/transactions?limit=100&page=${page}`, { method: 'GET' })
    if (page === 0) {
      try { crudo = (typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '')).slice(0, 500) } catch { crudo = '(ilegible)' }
      primera = { ruta: '/wallets/transactions', httpStatus: r.status, cuerpo: crudo }
    }
    if (!r.ok) {
      const motivo = r.status === 401 || r.status === 403 ? `la llave no tiene permiso de lectura (HTTP ${r.status})`
        : r.status === 429 ? 'limite de consultas (429)'
        : r.status === 404 ? 'la ruta del listado devolvio 404'
        : r.status === 0 ? 'no se pudo conectar con Mouv'
        : `respuesta inesperada (HTTP ${r.status})`
      return { ok: false, items, diag: { motivo, ...primera }, crudo }
    }
    // La forma de la respuesta tampoco se da por sentada: items, data, results,
    // o directamente un array.
    const d: any = r.data
    const lote: any[] = Array.isArray(d) ? d
      : Array.isArray(d?.items) ? d.items
      : Array.isArray(d?.data) ? d.data
      : Array.isArray(d?.results) ? d.results
      : Array.isArray(d?.transactions) ? d.transactions
      : []
    items.push(...lote)
    if (lote.length === 0) break
    // Cortar cuando la pagina ya es mas vieja que la ventana: sin esto se
    // pagina el historico entero para nada.
    const masViejo = lote.reduce((min: number, it: any) => {
      const t = new Date(it?.createdAt ?? it?.created_at ?? 0).getTime()
      return Number.isFinite(t) && t > 0 ? Math.min(min, t) : min
    }, Number.POSITIVE_INFINITY)
    if (Number.isFinite(masViejo) && Number.isFinite(desdeMs) && masViejo < desdeMs) break
    if (d?.hasMore === false) break
  }

  // Filtrado LOCAL. Se queda con lo que es una salida Bre-B, y lo que no trae
  // esos campos NO se descarta: es preferible un candidato de mas -- que el
  // emparejamiento por monto va a descartar igual -- que perder el movimiento
  // que se esta buscando por un nombre de campo distinto al esperado.
  // Lo que NO dice ser una salida se conserva como candidato (puede venir con
  // otro nombre de campo), pero se MARCA. El emparejamiento por monto solo --
  // el ultimo recurso -- exige salida confirmada: un recaudo REVERSADO del
  // mismo importe, que entra sin `type`, podria emparejarse con una dispersion
  // y hacerla ver como devuelta. Seria reembolsar un envio que si salio.
  const esSalidaBreb = (it: any): boolean => {
    const tipo = String(it?.type ?? it?.direction ?? '').toUpperCase()
    const rail = String(it?.rail ?? '').toUpperCase()
    if (tipo && !/OUT|DEBIT|TRANSFER_OUT|SALIDA/.test(tipo)) return false
    if (rail && rail !== 'BREB') return false
    if (tipo) it.__salidaConfirmada = true
    return true
  }
  // FILTRO REAL POR FECHA. `desdeISO` se usaba SOLO para cortar la paginacion,
  // asi que el universo de candidatos eran hasta 1000 movimientos de meses
  // atras. Toda la proteccion del emparejamiento por monto se apoya en "un
  // unico movimiento con ese importe EN LA VENTANA" -- y esa ventana no
  // existia. Un envio de la semana pasada por el mismo monto era candidato.
  const dentroDeVentana = (it: any): boolean => {
    if (!Number.isFinite(desdeMs)) return true
    const t = new Date(it?.createdAt ?? it?.created_at ?? 0).getTime()
    // Sin fecha legible NO se descarta: se deja para que lo filtren las otras
    // condiciones. Descartarlo seria perder el movimiento buscado por un campo
    // con otro nombre.
    if (!Number.isFinite(t) || t <= 0) return true
    return t >= desdeMs
  }
  return { ok: true, items: items.filter(it => esSalidaBreb(it) && dentroDeVentana(it)), crudo }
}

// Emparejar UNA fila nuestra con un movimiento de Mouv cuando no tenemos su id.
//
// ES DELIBERADAMENTE ESTRICTO. Emparejar mal no es un error cosmetico: marca
// como devuelto un envio que si se pago (y le regala la plata al cliente) o da
// por pagado uno que volvio. Por eso exige que coincidan el MONTO EXACTO en
// centavos Y el documento del beneficiario, y que haya UN solo candidato sin
// reclamar. Dos envios identicos a la misma persona no se emparejan: quedan
// para que los mire una persona, que es la respuesta correcta cuando no se
// puede distinguir cual es cual.
function emparejarConMouv(rd: any, montoCop: number, items: any[], reclamados: Set<string>, creadaAt?: string | null): { item: any; via: string } | null {
  const libres = items.filter(it => !reclamados.has(String(it?.id ?? '')))
  const centavos = Math.round(Number(montoCop) * 100)
  if (!(centavos > 0)) return null
  // El monto en centavos es el ancla de TODOS los niveles. Nunca se empareja
  // algo cuyo monto no calce exacto.
  const mismoMonto = libres.filter(it => Math.round(Number(it?.amount ?? 0)) === centavos)
  if (!mismoMonto.length) return null

  const unico = (xs: any[], via: string) => (xs.length === 1 ? { item: xs[0], via } : null)
  // El id del movimiento puede venir en varios campos, y con la forma que la
  // consola muestra (TX-PG-483AC9), no necesariamente como UUID.
  const idsDe = (it: any) => [it?.id, it?.transactionId, it?.reference, it?.externalId]
    .map((v: any) => String(v ?? '').trim()).filter(Boolean)
  const limpiar = (v: any) => String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

  // 1) La referencia EXACTA que mandamos. Sin ambiguedad posible: la generamos
  //    nosotros con un sufijo unico por envio.
  // Se mira el id / la referencia venga como venga: la consola de Mouv los
  // muestra como TX-PG-483AC9, no como el UUID del ejemplo de la doc. Y ACA no
  // se ancla al monto: un id que coincide identifica la operacion por si solo.
  const refExacta = String(rd?.providerReference ?? rd?.providerRef ?? '').trim()
  if (refExacta) {
    const r = unico(libres.filter(it => idsDe(it).includes(refExacta)), 'referencia exacta')
    if (r) return r
  }

  // 2) Documento del beneficiario. Solo esta en las filas que alcanzaron a
  //    guardar el dato del resolve-key.
  const doc = String(rd?.documentNumber ?? rd?.recipient?.documentNumber ?? '').replace(/\D/g, '')
  if (doc) {
    const r = unico(mismoMonto.filter(it => String(it?.targetDocument ?? '').replace(/\D/g, '') === doc), 'monto + documento')
    if (r) return r
  }

  // 3) Nombre del beneficiario, normalizado (sin tildes, sin mayusculas, sin
  //    puntuacion). El nombre que guardamos puede ser el que escribio el
  //    cliente y no el oficial del directorio, asi que se compara flojo.
  const nom = limpiar(rd?.beneficiary ?? rd?.recipient?.holderName)
  if (nom) {
    const r = unico(mismoMonto.filter(it => limpiar(it?.targetName) === nom), 'monto + nombre')
    if (r) return r
  }

  // 4) Solo el monto, y SOLO si en toda la ventana hay UN unico movimiento de
  //    Mouv con ese importe exacto al centavo. Es el ultimo recurso para las
  //    filas viejas que no guardaron ni documento ni id.
  //
  //    El riesgo real de emparejar mal es regalar plata (marcar devuelto algo
  //    que se pago) o darle por pagado al cliente algo que volvio. La unicidad
  //    en la ventana es la proteccion: si hay dos envios por el mismo importe
  //    no se toca ninguno y los resuelve una persona, que es la respuesta
  //    correcta cuando no se puede distinguir cual es cual.
  //    Ademas exige que el movimiento SE DECLARE salida y que este cerca en el
  //    tiempo de nuestra fila. Sin la cercania, el "unico con ese importe"
  //    puede ser un envio de otro dia -- y, cuando concilia un cliente puntual,
  //    de OTRO cliente, porque el listado es de toda la tesoreria.
  const nuestroMs = new Date(creadaAt ?? 0).getTime()
  const cerca = (it: any): boolean => {
    if (!Number.isFinite(nuestroMs) || nuestroMs <= 0) return false
    const t = new Date(it?.createdAt ?? it?.created_at ?? 0).getTime()
    if (!Number.isFinite(t) || t <= 0) return false
    return Math.abs(t - nuestroMs) <= 6 * 60 * 60 * 1000
  }
  return unico(mismoMonto.filter(it => it?.__salidaConfirmada && cerca(it)), 'solo por monto (unico y del mismo momento)')
}

// ── Cotización de comisión Mouv (Bre-B) ────────────────────────────
// POST /api/transfers/quote { amount(cents), keyValue } →
// { feeBreakdown:{ fixedFee, variableFee, subtotalFee, ivaAmount,
//   totalCharged }, totalCost, canAfford }  (valores en CENTAVOS)
// La comisión SE COBRA AL CLIENTE: el débito del riel es monto + comisión.
// OJO: hoy NO se usa — el precio al cliente sale de brebFeeCop(), nuestra
// propia tarifa, y por eso el body incompleto nunca rompio nada. Queda correcta
// para el dia que se quiera cotizar contra el proveedor de verdad.
//
// `keyType` es OBLIGATORIO en /transfers/quote (PHONE | EMAIL | ALPHANUM |
// NRIC). Faltaba. Se deriva igual que en el envio: el que devuelve resolve-key
// si lo hay, y si no se infiere del formato de la llave.
async function mouvQuoteBreb(amountCop: number, keyValue: string, keyType?: string): Promise<{ ok: boolean; feeCop: number; fixedCop: number; variableCop: number; ivaCop: number; raw: any }> {
  const r = await mouvFetch('/transfers/quote', {
    method: 'POST',
    body: JSON.stringify({ amount: Math.round(amountCop * 100), keyValue, keyType: brebTypeToMouv(keyType ?? '', keyValue) }),
  })
  const d: any = r.data ?? {}
  const fb = d.feeBreakdown ?? {}
  const toP = (v: any) => (Number(v) || 0) / 100
  return {
    ok: r.ok,
    feeCop: toP(fb.totalCharged ?? d.totalCharged),
    fixedCop: toP(fb.fixedFee), variableCop: toP(fb.variableFee), ivaCop: toP(fb.ivaAmount),
    raw: d,
  }
}

// ── FINITY (riel ACH) ──────────────────────────────────────────────
// ACH va por Finity (precio fijo por transferencia, más barato que el
// 0,10% de Mouv). Se llama a la edge function finity-proxy (restaurada),
// que maneja OAuth y los paths. El costo REAL viene en la respuesta de la
// orden (costs.{commission,iva,total}) y SE COBRA AL CLIENTE.
const BANK_CODES_CO: Record<string, string> = {
  'Banco de Bogotá': '1001', 'Banco Popular': '1002', 'Itaú': '1006', 'Bancolombia': '1007',
  'Citibank': '1009', 'GNB Sudameris': '1012', 'BBVA Colombia': '1013', 'Scotiabank Colpatria': '1019',
  'Banco de Occidente': '1023', 'Banco Caja Social': '1032', 'Banco Agrario': '1040', 'Davivienda': '1051',
  'Banco AV Villas': '1052', 'Banco Pichincha': '1060', 'Bancoomeva': '1061', 'Banco Falabella': '1062',
  'Coopcentral': '1066', 'Lulo Bank': '1070', 'Nequi': '1507', 'Daviplata': '1551',
  'Movii': '1801', 'Nu Colombia': '1809', 'Nu': '1809',
}
// Sin respuesta legible NO es "falló": es "no sabemos". Quien llama decide
// qué hacer con desenlaceDesconocido (en un retiro: NO reembolsar).
async function finityCall(action: string, userId: string, extra: Record<string, unknown> = {}): Promise<any> {
  let r: Response
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/finity-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action, user_id: userId, ...extra }),
      signal: AbortSignal.timeout(70000),
    })
  } catch (e) {
    return { ok: false, status: 0, desenlaceDesconocido: true, error: String((e as Error)?.name ?? e) }
  }
  const body = await r.json().catch(() => null)
  if (body == null) return { ok: false, status: r.status, desenlaceDesconocido: r.status === 0 || r.status >= 500, error: 'respuesta_ilegible' }
  return body
}
// Precio por transferencia ACH que SE COBRA AL CLIENTE: $2.500 COP por
// envío (override con el secret ACH_FEE_COP). Finity no devuelve costs en
// la orden — doc oficial: { id, status, amount, destination_account }.
const ACH_FEE_COP = Number(Deno.env.get('ACH_FEE_COP') ?? '2500') || 2500

// Los motivos de un envío: los mismos que Finity pregunta en su pantalla
// ("Selecciona la razón del pago"). Copia de lib/motivosEnvio.ts.
const MOTIVOS_ENVIO: Record<string, string> = {
  proveedores: 'Pago a proveedores', servicios: 'Pago de servicios', nomina: 'Pago de nómina',
  gastos: 'Gastos generales', compensacion: 'Transferencia a mi cuenta de compensación', otro: 'Otro',
}
// ── Comisión de envío Bre-B ─────────────────────────────────────────
// Mouv le cobra a Lincoin por CADA transferencia: 0,10% del monto + $800 fijos.
// El 0,10% NO se re-cobra aquí: ya se le cobra al cliente el 0,10% al RECIBIR
// cada cargue Bre-B (admin-data), y ese 0,10% cubre el 0,10% de Mouv en el
// envío. Así que en el ENVÍO solo se cobra el FIJO de Mouv ($800) + la utilidad
// de Lincoin ($400) = $1.200 por defecto. Todo configurable por secrets.
const BREB_MOUV_FIXED = Number(Deno.env.get('BREB_MOUV_FIXED') ?? '800')  || 800      // $800 fijos de Mouv por envío
const BREB_MARGIN_COP = Number(Deno.env.get('BREB_MARGIN_COP') ?? '400')  || 400      // utilidad de Lincoin por envío
// Comisión FIJA Bre-B que paga el cliente por una dispersión (no depende del
// monto: el componente variable 0,10% ya se cobró en el cargue).
function brebFeeCop(_amountCop?: number): number {
  return Math.round(BREB_MOUV_FIXED + BREB_MARGIN_COP)
}
// Legacy (override directo del total si se quiere fijar a mano).
const BREB_FEE_COP = Number(Deno.env.get('BREB_FEE_COP') ?? String(BREB_MOUV_FIXED + BREB_MARGIN_COP)) || 1200
// Bre-B · Cuenta 2 (sale por Finity, del saldo ACH). Por defecto se cobra lo
// mismo que la Cuenta 1; el costo que cobra Finity queda anotado en cada
// envío (costoProveedorCop) para poder ajustar esta tarifa con datos reales.
const BREB2_FEE_COP = Number(Deno.env.get('BREB2_FEE_COP') ?? '') || brebFeeCop()

// ── ¿La cuenta destino está APROBADA en Finity? ─────────────────────────
// El estado que muestra Lincoin no sirve como control: vive en los contactos
// del usuario, que el propio cliente puede escribir — y un revisor de la app
// llegó a marcar "aprobada" una cuenta que Finity tenía en revisión, con el
// botón de enviar habilitado. El único que manda es el proveedor, así que se
// le pregunta a él ANTES de debitar.
//
// Se miran TODOS los campos de estado y gana el más restrictivo: una cuenta
// puede venir "active" (el registro existe) y a la vez en revisión. Y solo se
// aprueba con una palabra que lo diga (aprobada / approved / verified).
//
// FALLA ABIERTO a propósito: si la lista no se puede consultar, o la cuenta no
// aparece, no se bloquea — un control que no logra verificar no puede frenar
// una transferencia legítima, y si de verdad no está aprobada el proveedor la
// rechaza y el saldo se devuelve.
async function revisarDestinoFinity(userId: string, destId: string | null, accDigits: string, docPedido: string): Promise<{
  bloqueo: null | { estado: 'rechazada' | 'en_proceso' | 'otra_cuenta'; message: string }
}> {
  try {
    const lista = await finityCall('external_accounts', userId)
    const filas: any[] = lista?.data?.data ?? lista?.data?.results ?? (Array.isArray(lista?.data) ? lista.data : [])
    const idDe = (r: any) => String(r?.id ?? r?.external_account_id ?? r?.account_id ?? '')
    const accDe = (r: any) => String(r?.account_number ?? r?.account?.account_number ?? '').replace(/\D/g, '')
    // Primero por id; si no, por el número de cuenta COMPLETO. Nunca por los
    // últimos dígitos: dos cuentas pueden terminar igual.
    const fila = (destId ? filas.find(r => idDe(r) === destId) : null)
      ?? (accDigits ? filas.find(r => accDe(r) === accDigits) : null)
    if (!fila) return { bloqueo: null }
    // El id de destino lo puede mandar el navegador: tiene que ser la MISMA
    // cuenta que se verificó (AML, documento). Si en Finity ese id es otra
    // cuenta, el envío no sale — si no, se podía verificar una cuenta limpia
    // y mandar la plata a otra.
    const accFila = accDe(fila)
    const docFila = String(fila?.account_holder_id_number ?? fila?.account?.account_holder_id_number ?? '').replace(/\D/g, '')
    const otraCuenta = (accFila && accDigits && accFila !== accDigits) || (docFila && docPedido && docFila !== docPedido && !docFila.startsWith(docPedido) && !docPedido.startsWith(docFila))
    if (otraCuenta) {
      await logAudit(userId, 'finity.payout.destino_no_coincide', { destId, accPedido: accDigits.slice(-4), accFila: accFila.slice(-4) })
      return { bloqueo: { estado: 'otra_cuenta', message: 'La cuenta destino no coincide con el beneficiario verificado. Vuelve a inscribirlo.' } }
    }
    const textos = [fila.verification_status, fila.estado, fila.state, fila.status]
      .filter((v: unknown) => v !== undefined && v !== null && String(v).trim() !== '')
      .map((v: unknown) => String(v).toLowerCase())
    // "approved"/"verified" como palabra COMPLETA y sin negación: la regex
    // suelta aceptaba "unverified", "not_approved" y "awaiting_approval".
    const rechazada = textos.some(s => /rechaz|reject|denied|declin|fail|inactiv|block|bloque|suspend|cancel/.test(s))
    const negada = textos.some(s => /(un|not|no|dis|awaiting|pending|sin)[\s_-]?(verif|approv|aprob)/.test(s))
    const enRevision = negada || textos.some(s => /proces|pend|review|revis|created|unconfirmed|awaiting/.test(s))
    const aprobada = !negada && textos.some(s => /(^|[\s_-])(approved|verified|aprobad[ao]|verificad[ao])$/.test(s.trim()))
    if (rechazada || enRevision || (!aprobada && textos.length > 0)) {
      await logAudit(userId, 'finity.payout.destino_no_aprobado', {
        destinationId: destId ?? (idDe(fila) || null), cuenta: accDigits, estadoProveedor: textos.join(' · '),
      })
      return {
        bloqueo: rechazada
          ? { estado: 'rechazada', message: 'El banco rechazó esta cuenta destino. Revisa los datos del beneficiario e inscríbela de nuevo.' }
          : { estado: 'en_proceso', message: 'El banco todavía está validando esta cuenta destino. Podrás transferirle apenas la apruebe.' },
      }
    }
    return { bloqueo: null }
  } catch { return { bloqueo: null } }
}

async function finityPayoutAch(userId: string, recipient: Record<string, any>, amountCop: number):
  Promise<{ ok: boolean; providerRef?: string; state?: string; feeCop: number; costs?: any; error?: any; destinationId?: string; amountMismatch?: Record<string, unknown> | null }> {
  // 1) Cuenta destino en Finity (destination_id). Reusar si el contacto ya
  //    la trae; si no, registrarla ahora.
  let destId: string | null = recipient.finityId ?? null
  // Solo dígitos: un número guardado con espacios, puntos o guiones se
  // rechazaba en Finity y el fallo se veía como un error genérico.
  const accDigits = String(recipient.accountNumber ?? '').replace(/\D/g, '')
  if (!destId) {
    // El código de banco puede venir como nombre ('Nequi'), como nombre en
    // otra caja ('NEQUI', 'nequi') o ya como código ('1507'). El mapa era
    // sensible a mayúsculas y exacto: cualquier variante se enviaba tal cual
    // como "código", y Finity la rechazaba.
    const bankRaw = String(recipient.bankCode ?? '').trim()
    const bankKey = Object.keys(BANK_CODES_CO).find(k => k.toLowerCase() === bankRaw.toLowerCase())
    const bankCode = /^\d{3,5}$/.test(bankRaw) ? bankRaw : (bankKey ? BANK_CODES_CO[bankKey] : bankRaw)

    // Tipo de documento en el formato que acepta Finity.
    const docRaw = String(recipient.documentType ?? 'CC').toUpperCase().trim()
    const docType = docRaw === 'PAS' || docRaw === 'PASAPORTE' ? 'CE' : (['CC', 'CE', 'NIT'].includes(docRaw) ? docRaw : 'CC')
    const docNumber = String(recipient.documentNumber ?? '').replace(/\D/g, '')
    const holder = String(recipient.holderName ?? '').trim()

    // Validar ANTES de llamar: si falta un dato, decirlo con nombre propio en
    // vez de mandar el hueco y traducir después un rechazo del proveedor.
    const faltan = [
      !accDigits && 'número de cuenta',
      !bankCode && 'banco',
      !holder && 'nombre del titular',
      !docNumber && 'documento del titular',
    ].filter(Boolean)
    if (faltan.length) {
      return { ok: false, feeCop: 0, error: { step: 'destino', httpStatus: null, path: null, body: { message: `Al contacto le faltan datos: ${faltan.join(', ')}. Edítalo y vuelve a intentar.` } } }
    }

    const body = {
      data: {
        account: {
          geo: 'CO',
          account_type: ['corriente', 'CORRIENTE', 'checking'].includes(String(recipient.accountType)) ? 'checking' : 'savings',
          account_number: accDigits,
          financial_institution_code: bankCode,
          account_holder_fullname: holder,
          account_holder_id_type: docType,
          account_holder_id_number: docNumber,
        },
      },
    }
    const ea = await finityCall('create_external_account', userId, body)
    destId = ea?.id ?? ea?.data?.id ?? ea?.data?.external_account_id ?? ea?.data?.account_id ?? ea?.data?.data?.id ?? null

    // La cuenta YA estaba inscrita en Finity. Pasaba siempre que un intento
    // anterior creó el destino y luego falló el retiro: el id no se guardaba
    // (solo se persistía en el camino de éxito), así que el siguiente envío
    // volvía a crearla y Finity la rechazaba por duplicada. Desde el panel de
    // Finity sí funcionaba, porque allá el destino ya existe y ese paso no se
    // repite. Se busca el existente y se reutiliza.
    if (!ea?.ok || !destId) {
      const list = await finityCall('external_accounts', userId)
      const rows: any[] = list?.data?.data ?? list?.data?.results ?? (Array.isArray(list?.data) ? list.data : [])
      const hit = rows.find((r: any) => {
        const acc = String(r?.account_number ?? r?.account?.account_number ?? '').replace(/\D/g, '')
        return acc && acc === accDigits
      })
      const foundId = hit?.id ?? hit?.external_account_id ?? null
      if (foundId) destId = String(foundId)
      else return { ok: false, feeCop: 0, error: { step: 'destino', httpStatus: ea?.status ?? null, path: ea?.path ?? null, body: ea?.data ?? null } }
    }
  }
  // 1.b) La cuenta destino tiene que estar APROBADA. Ya se revisó antes de
  //      debitar; se repite acá porque la cuenta pudo inscribirse recién, en
  //      el paso 1, y una cuenta nueva casi siempre arranca en revisión.
  {
    const rev = await revisarDestinoFinity(userId, destId, accDigits, String(recipient.documentNumber ?? '').replace(/\D/g, ''))
    if (rev.bloqueo) return { ok: false, feeCop: 0, error: { step: 'destino', httpStatus: null, path: null, body: { message: rev.bloqueo.message } } }
  }

  // 2) Orden de retiro:
  //    POST /v0/withdrawal-orders { destination_id, amount, currency:'COP' }
  //    ⚠️ amount va en PESOS ENTEROS — NO en centavos. VERIFICADO CONTRA
  //    PRODUCCIÓN: una dispersión de $10.000 enviada como 1.000.000
  //    (pesos × 100, como decía la doc de "unidades menores") creó en
  //    Finity un retiro REAL de COP $1.000.000. NUNCA multiplicar aquí.
  //    → 201 { id, status: PROCESSING|COMPLETED|FAILED, destination_account }
  //    (NO devuelve costs — el precio por transferencia es ACH_FEE_COP.)
  const requestedCop = Math.round(amountCop)
  // El motivo del envío va con la orden (es lo que Finity pregunta en su
  // pantalla: "Selecciona la razón del pago"). Si Finity rechaza el campo
  // con un 400 —que no crea nada—, se manda la orden sin él y queda en la
  // auditoría qué contestó, para ajustar el nombre del campo con su doc.
  const cuerpoBase = { amount: requestedCop, currency: 'COP', destination_id: destId }
  const motivoTexto = MOTIVOS_ENVIO[String(recipient.motivo ?? '')] ?? ''
  let w = await finityCall('create_withdrawal', userId, { data: motivoTexto ? { ...cuerpoBase, reason: motivoTexto, description: motivoTexto } : cuerpoBase })
  if (motivoTexto && !w?.ok && Number(w?.status) === 400) {
    await logAudit(userId, 'finity.payout.motivo_rechazado', { motivo: motivoTexto, status: w?.status ?? null, respuesta: w?.data ?? null })
    w = await finityCall('create_withdrawal', userId, { data: cuerpoBase })
  }
  const od: any = w?.data ?? {}
  // El error DEBE conservar status/path/cuerpo — con '{}' pelado es
  // imposible saber si fue ruta (404), auth (401) o validación (400).
  if (!w?.ok || !od.id) {
    // ¿Finity dijo que NO (4xx), o no sabemos? Un timeout, un 5xx o una
    // respuesta ilegible pueden esconder un retiro que SÍ se creó. Un token
    // rechazado (finity_auth_failed) es un no: la orden ni se mandó.
    const hs = Number(w?.status ?? 0)
    const desconocido = w?.error !== 'finity_auth_failed' && w?.error !== 'forbidden'
      && (!!w?.desenlaceDesconocido || !w || hs === 0 || hs >= 500 || (w?.ok && !od.id))
    return {
      ok: false, feeCop: 0, destinationId: destId ?? undefined,
      error: { step: 'retiro', httpStatus: w?.status ?? null, path: w?.path ?? null, desenlaceDesconocido: desconocido, body: (od && Object.keys(od).length > 0) ? od : (w?.data ?? w ?? null) },
    }
  }
  // Una orden CREADA puede venir ya fallida (201 con status FAILED). Antes se
  // tomaba como aceptada: el cliente leía "en proceso" y el reembolso esperaba
  // a la conciliación. Se trata como lo que es: un rechazo claro.
  const estadoOrden = String(od.status ?? od.state ?? '').toUpperCase()
  if (estadoOrden && RE_FINITY_FALLO.test(estadoOrden)) {
    await logAudit(userId, 'finity.withdrawal.creada_fallida', { providerRef: String(od.id), estado: estadoOrden })
    return {
      ok: false, feeCop: 0, destinationId: destId ?? undefined,
      error: { step: 'retiro', httpStatus: w?.status ?? null, path: w?.path ?? null, desenlaceDesconocido: false, body: od },
    }
  }
  // CONTROL DE MONTO (post-orden): si Finity ecoa un amount y NO coincide
  // con lo pedido (±1 peso; también se detecta el patrón ×100 / ÷100), se
  // deja constancia para auditoría y se marca la orden para revisión —
  // exactamente el tipo de discrepancia que produjo el retiro de $1.000.000
  // por una dispersión de $10.000.
  let amountMismatch: Record<string, unknown> | null = null
  const echoed = Number(od.amount ?? od.data?.amount)
  if (Number.isFinite(echoed) && echoed > 0 && Math.abs(echoed - requestedCop) > 1) {
    amountMismatch = {
      requestedCop, providerAmount: echoed,
      pattern: Math.abs(echoed - requestedCop * 100) <= 1 ? 'x100' : Math.abs(echoed - requestedCop / 100) <= 1 ? '/100' : 'otro',
    }
    await logAudit(userId, 'finity.withdrawal.amount_mismatch', { providerRef: String(od.id), ...amountMismatch })
  }
  return { ok: true, providerRef: String(od.id), state: od.status ?? od.state ?? 'PROCESSING', feeCop: ACH_FEE_COP, destinationId: destId ?? undefined, amountMismatch }
}

// ── Bre-B · Cuenta 2: el envío por llave sale por Finity ──────────────
// Finity usa una sola bolsa para ACH y Bre-B, así que esta cuenta se paga
// con el saldo ACH del cliente. El envío tiene dos pasos:
//   1. CREAR  POST /v0/breb-transfers { amount, key_type, key_value }
//      → { id: 'mvm-…', first_name, last_name, bank_name, transfer_amount,
//          withdrawal_cost, total_withdrawal, total_received }
//      No mueve plata. Dice A NOMBRE DE QUIÉN está la llave y cuánto llega.
//   2. CONFIRMAR  POST /v0/breb-transfers/confirm { transaction_id }
//      Este es el que manda la plata.
//
// Entre los dos pasos se revisa lo que Finity contestó: si la llave está a
// nombre de otra persona o el monto no es el pedido, NO se confirma y el
// saldo vuelve. Es la ventaja de este proveedor: se puede mirar antes de
// mandar, en vez de enterarse después.
type BrebTipoFinity = 'PHONE' | 'EMAIL' | 'ALPHANUM' | 'NRIC' | 'MERCHANT'
function brebTypeToFinity(t: string, keyValue?: string): BrebTipoFinity {
  if (/MERCHANT|COMERCIO/.test(String(t ?? '').toUpperCase())) return 'MERCHANT'
  return brebTypeToMouv(t, keyValue)
}
// Las formas en que se prueba la llave. Crear no mueve plata, así que si
// Finity rechaza una forma se puede probar la siguiente sin riesgo.
function llavesParaFinity(tipo: BrebTipoFinity, valor: unknown): string[] {
  const v = String(valor ?? '').trim()
  const out: string[] = []
  const add = (x: string) => { if (x && !out.includes(x)) out.push(x) }
  if (tipo === 'PHONE') {
    const d10 = v.replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '')
    add(d10); add(`+57${d10}`)
  } else if (tipo === 'NRIC') {
    add(v.replace(/\D/g, ''))
  } else if (tipo === 'EMAIL') {
    add(v.toLowerCase())
  } else {
    add(v); add(v.startsWith('@') ? v.slice(1) : `@${v}`)
  }
  return out
}
// ¿El titular que devuelve Finity es claramente OTRA persona? Solo se corta
// cuando no comparte ni una palabra con ninguno de los nombres que tenemos
// del beneficiario (el inscrito, el de la Registraduría, el del directorio
// Bre-B). Si Finity enmascara el nombre o no lo manda, no se juzga.
const RUIDO_NOMBRE = new Set(['SAS', 'LTDA', 'CIA', 'BIC', 'DEL', 'LAS', 'LOS', 'SOCIEDAD', 'COMPANIA', 'EMPRESA', 'GRUPO'])
function palabrasNombre(s: unknown): string[] {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9Ñ ]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !RUIDO_NOMBRE.has(t))
}
function titularEsOtro(titular: string, esperados: string[]): boolean {
  if (!titular || /\*/.test(titular)) return false
  const suyas = palabrasNombre(titular)
  if (!suyas.length) return false
  const listas = esperados.map(palabrasNombre).filter(l => l.length)
  if (!listas.length) return false
  return !listas.some(l => l.some(p => suyas.includes(p)))
}
type ResultadoBreb2 = {
  ok: boolean; providerRef?: string; desenlaceDesconocido?: boolean; paso?: 'crear' | 'titular' | 'monto' | 'confirmar';
  httpStatus?: number | null; body?: any; mensaje?: string; titular?: string; banco?: string;
  costoProveedor?: number | null; totalProveedor?: number | null
}
// PREPARAR = crear + revisar monto y titular. No mueve plata, así que corre
// ANTES de debitar: una llave que Finity no acepta ("Bad request to Kamin
// API"), un titular que no es o un monto distinto ya no cobran y devuelven —
// el envío ni arranca.
// El saldo en pesos de la bolsa de Finity (la misma para ACH y Bre-B · Cuenta
// 2). null = no se pudo leer; nunca se adivina.
async function finityCopDisponible(userId: string): Promise<number | null> {
  try {
    const b = await finityCall('balance', userId)
    const data: any = b?.data ?? null
    if (!b?.ok || !data) return null
    const filas: any[] = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data
      : Array.isArray(data.balances) ? data.balances : Array.isArray(data.items) ? data.items : []
    for (const row of filas) {
      const moneda = String(row?.asset ?? row?.currency ?? row?.code ?? '').toUpperCase()
      if (moneda === 'COP') {
        const n = Number(String(row?.available ?? row?.available_balance ?? row?.availableBalance ?? row?.balance ?? row?.amount ?? '').replace(/,/g, ''))
        if (Number.isFinite(n)) return n
      }
    }
    const directo = data.COP ?? data.cop ?? data.copBalance ?? data.data?.COP ?? data.data?.cop ?? data.data?.copBalance
    if (directo != null) { const n = Number(String(directo).replace(/,/g, '')); if (Number.isFinite(n)) return n }
    return null
  } catch { return null }
}

// Aviso al admin (a lo sumo uno por hora por motivo): la Cuenta 2 rechaza
// envíos por algo que el cliente no puede arreglar.
async function avisarAdminBreb2(motivo: string, asunto: string, texto: string): Promise<void> {
  const KEY = Deno.env.get('RESEND_API_KEY') ?? ''
  const FROM = Deno.env.get('OTP_FROM_EMAIL') ?? Deno.env.get('FROM_EMAIL') ?? 'no-reply@lincoin.me'
  const ADMIN = Deno.env.get('VITE_ADMIN_EMAIL') ?? Deno.env.get('ADMIN_EMAIL') ?? ''
  if (!KEY || !ADMIN) return
  try {
    if (await reclamarCandado(db, `aviso:breb2:${motivo}`, 3600, null, 'aviso_breb2') === 'ocupado') return
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Lincoin <${FROM}>`, to: [ADMIN], subject: asunto,
        html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F0EFEB;font-family:Arial,sans-serif"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFF;border:1px solid rgba(21,24,26,0.08);border-radius:14px"><tr><td style="padding:26px"><p style="font-family:'Archivo',Arial,sans-serif;font-size:21px;font-weight:800;color:#15181A;margin:0">Lincoin<span style="color:#22A35C">.</span></p><p style="font-size:17px;font-weight:800;color:#15181A;margin:20px 0 8px">${asunto}</p><p style="font-size:13px;color:#5C625E;line-height:1.6;margin:0">${texto}</p></td></tr></table></body></html>`,
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* el aviso es un extra */ }
}

const enmascarar = (v: string) => v.length > 4 ? `${'•'.repeat(Math.min(6, v.length - 4))}${v.slice(-4)}` : v
// "Insufficient Kamin wallet balance for withdrawal": la billetera Bre-B del
// proveedor no tiene con qué. No es la llave ni el monto del cliente: es plata
// que hay que poner en esa billetera, y con cualquier llave o monto da igual.
const sinFondosBreb2 = (c: any) => /insufficient|insuficiente|not enough (funds|balance)|sin fondos|fondos insuficientes/i.test(motivoCreacion(c))
const motivoCreacion = (c: any): string => {
  const d = c?.data ?? c ?? {}
  const m = d?.message ?? d?.error?.message ?? d?.error ?? d?.data?.message ?? d?.errors
  try { return (typeof m === 'string' ? m : JSON.stringify(m ?? '')).slice(0, 200) } catch { return '' }
}

async function finityPrepararBreb(userId: string, recipient: Record<string, any>, amountCop: number, nombresEsperados: string[]): Promise<ResultadoBreb2 & { creada?: any }> {
  const monto = Math.round(amountCop)   // pesos enteros, igual que los retiros ACH
  // EL TIPO DE LLAVE LO DICE EL DIRECTORIO BRE-B, no el formulario. La
  // Cuenta 1 ya lo hacía (resolve-key es autoritativo); la Cuenta 2 mandaba el
  // tipo que el cliente eligió al inscribir, y una llave inscrita como
  // "celular" que en Bre-B es otra cosa la rechaza Kamin con un 400 sin
  // explicación ("Bad request to Kamin API").
  const intentos: { tipo: BrebTipoFinity; valor: string }[] = []
  const agregar = (tipo: BrebTipoFinity, valores: string[]) => {
    for (const valor of valores) if (valor && !intentos.some(x => x.tipo === tipo && x.valor === valor)) intentos.push({ tipo, valor })
  }
  let directorio: { tipo?: string; llave?: string } = {}
  try {
    const rr = await mouvResolveBrebKey(String(recipient.key ?? ''), String(recipient.keyType ?? ''))
    if (rr.found && rr.keyType) {
      const tipoR = brebTypeToFinity(rr.keyType, rr.matchedKey)
      directorio = { tipo: tipoR, llave: rr.matchedKey }
      agregar(tipoR, [...llavesParaFinity(tipoR, rr.matchedKey), ...llavesParaFinity(tipoR, recipient.key)])
    }
  } catch { /* sin directorio: se usa lo inscrito */ }
  const tipoInscrito = brebTypeToFinity(String(recipient.keyType ?? ''), recipient.key)
  agregar(tipoInscrito, llavesParaFinity(tipoInscrito, recipient.key))

  let creada: any = null
  let ultimo: any = null
  const rastro: Record<string, unknown>[] = []
  for (const it of intentos) {
    const c = await finityCall('breb_crear', userId, { data: { amount: monto, key_type: it.tipo, key_value: it.valor } })
    ultimo = c
    rastro.push({ tipo: it.tipo, llave: enmascarar(it.valor), status: Number(c?.status ?? 0) || null, motivo: c?.ok ? null : motivoCreacion(c) })
    const d = c?.data?.data ?? c?.data ?? null
    if (c?.ok && d?.id) { creada = { ...d, id: String(d.id) }; break }
    // Sin fondos en la billetera, otra forma de la llave no cambia nada.
    if (sinFondosBreb2(c)) break
    // Solo se prueba otra forma si Finity rechazó la llave por datos.
    if (![400, 404, 422].includes(Number(c?.status ?? 0))) break
  }
  if (!creada) {
    // ¿Es la llave o es el monto? Crear no mueve plata: se prueba la misma
    // llave con el mínimo (5.000). Si así sí la acepta, la llave está bien y lo
    // que no pasa es el monto — o la bolsa de la Cuenta 2 no lo cubre.
    let diagnostico: 'llave' | 'monto' | 'cupo' | 'desconocido' = 'desconocido'
    let mensaje: string | undefined
    const rechazoPorDatos = [400, 404, 422].includes(Number(ultimo?.status ?? 0))
    const avisarSinFondos = (disponible: number | null) => avisarAdminBreb2('sin_fondos', 'Bre-B Cuenta 2 sin fondos: hay que recargar la billetera Bre-B',
      `Un cliente intentó enviar ${monto.toLocaleString('es-CO')} COP por Bre-B Cuenta 2 y Finity respondió "${motivoCreacion(ultimo)}": la billetera Bre-B (Kamin) de la cuenta Finity no tiene saldo para ese envío. ${disponible == null ? '' : `El saldo en pesos de la cuenta Finity (el de ACH) es ${disponible.toLocaleString('es-CO')} COP, pero la billetera Bre-B es aparte. `}Hay que recargar la billetera Bre-B (pedírselo a Finity). Mientras tanto los clientes pueden enviar por Bre-B Cuenta 1 o ACH.`)
    if (sinFondosBreb2(ultimo)) {
      // Lo dice el proveedor: no hace falta adivinar con la prueba de 5.000.
      diagnostico = 'cupo'
      mensaje = 'La Bre-B · Cuenta 2 no tiene fondos disponibles en este momento, así que no salió nada. Envíalo por Bre-B · Cuenta 1 o por ACH, o intenta más tarde.'
      await avisarSinFondos(await finityCopDisponible(userId).catch(() => null))
    } else if (rechazoPorDatos && monto > 5000 && intentos.length) {
      const base = intentos[0]
      const p = await finityCall('breb_crear', userId, { data: { amount: 5000, key_type: base.tipo, key_value: base.valor } })
      const okPrueba = !!(p?.ok && (p?.data?.data?.id ?? p?.data?.id))
      rastro.push({ prueba: 5000, tipo: base.tipo, llave: enmascarar(base.valor), status: Number(p?.status ?? 0) || null, motivo: p?.ok ? null : motivoCreacion(p) })
      if (okPrueba) {
        const disponible = await finityCopDisponible(userId)
        rastro.push({ saldoCuenta2: disponible })
        if (disponible != null && disponible < monto + 5000) {
          diagnostico = 'cupo'
          mensaje = 'La Bre-B · Cuenta 2 no tiene cupo para este monto en este momento, así que no salió nada. Envíalo por Bre-B · Cuenta 1 o por ACH.'
          await avisarAdminBreb2('cupo', 'Bre-B Cuenta 2: la bolsa de Finity no cubre los envíos',
            `Un cliente intentó enviar ${monto.toLocaleString('es-CO')} COP por Bre-B Cuenta 2 y Finity lo rechazó. Con el mínimo (5.000) la misma llave sí pasa, y el saldo en pesos de la cuenta Finity es ${disponible.toLocaleString('es-CO')} COP. Hay que fondear la cuenta Finity: de esa misma bolsa salen también los envíos ACH.`)
        } else {
          diagnostico = 'monto'
          mensaje = 'La Bre-B · Cuenta 2 no aceptó este monto, así que no salió nada. Envíalo por Bre-B · Cuenta 1 o por ACH, o en montos más pequeños.'
          await avisarAdminBreb2('monto', 'Bre-B Cuenta 2: Finity rechaza montos altos',
            `Finity rechazó un envío Bre-B Cuenta 2 de ${monto.toLocaleString('es-CO')} COP ("${motivoCreacion(ultimo)}"), pero aceptó la misma llave con 5.000 COP. ${disponible == null ? 'No se pudo leer el saldo de la cuenta Finity.' : `El saldo en pesos de la cuenta Finity es ${disponible.toLocaleString('es-CO')} COP, que sí alcanza.`} Puede ser un tope por transferencia de Finity o de Kamin: conviene preguntárselo a Finity.`)
        }
      } else if (sinFondosBreb2(p)) {
        // Ni el mínimo pasa porque la billetera está vacía: no es la llave.
        diagnostico = 'cupo'
        mensaje = 'La Bre-B · Cuenta 2 no tiene fondos disponibles en este momento, así que no salió nada. Envíalo por Bre-B · Cuenta 1 o por ACH, o intenta más tarde.'
        await avisarSinFondos(null)
      } else if (rechazoPorDatos) {
        diagnostico = 'llave'
        mensaje = 'La Bre-B · Cuenta 2 no reconoce esa llave, así que no salió nada. Pídele al beneficiario que te confirme su llave exacta, o envíalo por Bre-B · Cuenta 1 o por ACH.'
      }
    }
    await logAudit(userId, 'finity.breb.diagnostico', { monto, diagnostico, directorio: directorio.tipo ? { tipo: directorio.tipo, llave: enmascarar(String(directorio.llave ?? '')) } : null, tipoInscrito, intentos: rastro })
    return { ok: false, paso: 'crear', httpStatus: Number(ultimo?.status ?? 0) || null, body: ultimo?.data ?? ultimo ?? null, ...(mensaje ? { mensaje } : {}) }
  }
  const titular = [creada.first_name, creada.last_name].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
  const extra = {
    providerRef: creada.id, titular: titular || undefined, banco: creada.bank_name ? String(creada.bank_name) : undefined,
    costoProveedor: Number.isFinite(Number(creada.withdrawal_cost)) ? Number(creada.withdrawal_cost) : null,
    totalProveedor: Number.isFinite(Number(creada.total_withdrawal)) ? Number(creada.total_withdrawal) : null,
  }

  // Lo que llega tiene que ser lo pedido. Si Finity cotiza otro monto, no se
  // manda: es justo el tipo de diferencia que en ACH se vio tarde.
  const ecos = [creada.transfer_amount, creada.total_received, creada.cop_amount]
    .map((x: unknown) => Number(x)).filter(n => Number.isFinite(n) && n > 0)
  if (ecos.some(n => Math.abs(n - monto) > 1)) {
    await logAudit(userId, 'finity.breb.monto_no_coincide', { pedido: monto, cotizado: ecos, id: creada.id })
    return { ok: false, ...extra, providerRef: undefined, paso: 'monto', body: creada,
      mensaje: 'El banco cotizó un monto distinto al que pediste, así que no enviamos nada. Tu saldo fue devuelto.' }
  }
  if (titular && titularEsOtro(titular, nombresEsperados)) {
    await logAudit(userId, 'finity.breb.titular_no_coincide', { titular, esperados: nombresEsperados.filter(Boolean).slice(0, 4), id: creada.id })
    return { ok: false, ...extra, providerRef: undefined, paso: 'titular', body: creada,
      mensaje: `Esa llave Bre-B está a nombre de ${titular}, no del beneficiario que tienes inscrito. Corrige el beneficiario antes de enviar. Tu saldo fue devuelto.` }
  }
  return { ok: true, ...extra, creada }
}

// CONFIRMAR = lo que manda la plata. Corre después del débito.
async function finityConfirmarBreb(userId: string, prep: ResultadoBreb2 & { creada?: any }): Promise<ResultadoBreb2> {
  const creada = prep.creada
  const extra = { providerRef: prep.providerRef, titular: prep.titular, banco: prep.banco, costoProveedor: prep.costoProveedor ?? null, totalProveedor: prep.totalProveedor ?? null }
  if (!creada?.id) return { ok: false, ...extra, paso: 'confirmar', httpStatus: null, body: { message: 'sin transferencia creada' } }
  const k = await finityCall('breb_confirmar', userId, { transaction_id: creada.id })
  const hs = Number(k?.status ?? 0)
  if (k?.ok && k?.data?.success !== false) return { ok: true, ...extra }
  // ¿Finity dijo que NO, o no sabemos? Sin respuesta, un 5xx, o un 200 que no
  // dice ni sí ni no pueden esconder una transferencia que SÍ salió. Un
  // rechazo de nuestra propia llamada (forbidden, sesión) es un no: la
  // confirmación ni llegó a Finity.
  const nuestro = ['finity_auth_failed', 'forbidden', 'unauthorized', 'missing_id'].includes(String(k?.error ?? ''))
  const desconocido = !nuestro && (!k || !!k?.desenlaceDesconocido || hs === 0 || hs >= 500 || hs === 408 || (k?.ok && k?.data?.success === false))
  return { ok: false, ...extra, paso: 'confirmar', desenlaceDesconocido: desconocido, httpStatus: hs || null, body: k?.data ?? k ?? null }
}

// Registro de auditoría best-effort (no bloquea la operación).
// Huella de una llave Bre-B para contar llaves distintas sin guardarla en
// claro: HMAC con la llave del servidor (un celular tiene pocas cifras, un
// hash sin secreto se revierte probando todos).
async function huellaLlave(raw: string): Promise<string> {
  const v = String(raw ?? '').trim().toLowerCase()
  const d = v.replace(/\D/g, '')
  const norm = /^\+?\d{10,13}$/.test(v.replace(/[\s-]/g, '')) ? d.replace(/^57(?=\d{10}$)/, '') : v
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(FIELD_ENC_KEY || SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(norm)))
  return Array.from(sig.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Titular de una llave según Finity (respaldo del directorio de Mouv). Crea
// un Bre-B de 5.000 SIN confirmarlo — crear no mueve plata y vence solo — y
// lee el nombre y el banco que devuelve. Prueba las formas de la llave igual
// que el envío por la Cuenta 2.
async function titularPorFinity(userId: string, rawKey: string, keyType: string): Promise<{ nombre: string; banco: string | null; llave: string } | null> {
  const tipo = brebTypeToFinity(keyType, rawKey)
  for (const valor of llavesParaFinity(tipo, rawKey)) {
    const c = await finityCall('breb_crear', userId, { data: { amount: 5000, key_type: tipo, key_value: valor } })
    const d = c?.data?.data ?? c?.data ?? null
    if (c?.ok && d?.id) {
      const nombre = [d.first_name, d.last_name].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
      await logAudit(userId, 'finity.breb.consulta_respaldo', { tipo, llave: enmascarar(valor), encontrada: !!nombre })
      return nombre ? { nombre, banco: d.bank_name ? String(d.bank_name) : null, llave: valor } : null
    }
    if (![400, 404, 422].includes(Number(c?.status ?? 0))) break
  }
  return null
}

async function logAudit(userId: string | null, action: string, metadata: Record<string, unknown>) {
  try {
    await db.from('audit_log').insert({ user_id: userId, action, metadata })
  } catch { /* la tabla puede no existir en este proyecto — no romper */ }
}

// ── Qué configuración de antecedentes gobierna a esta cuenta ─────────────
// Transición de TusDatos a Sarblock: las dos escriben la ficha en el mismo
// lugar (raw_data.tusdatos.beneficiarios), así que el control de abajo es el
// mismo. Lo único que cambia es de dónde salen las perillas (activo, cuentas
// en la prueba, si el riesgo medio bloquea).
//
// Si Sarblock está activo y cubre esta cuenta, manda su configuración. Si
// no —o si sarblock_config no existe—, se lee tusdatos_config como siempre.
// Sin esto, el día que se apagara TusDatos para pasar a Sarblock el control
// leería "apagado" y la plata saldría sin verificación de antecedentes.
async function configAntecedentes(userId: string): Promise<any> {
  const leer = async (key: string) => {
    const { data } = await db.from('system_config').select('value').eq('key', key).maybeSingle()
    return (data as any)?.value ? JSON.parse((data as any).value) : null
  }
  try {
    const sb = await leer('sarblock_config')
    const soloSb: string[] = Array.isArray(sb?.soloEstosUsuarios) ? sb.soloEstosUsuarios : []
    if (sb?.activo && (soloSb.length === 0 || soloSb.includes(userId))) return sb
  } catch { /* sin configuración de Sarblock legible: se usa la de TusDatos */ }
  return await leer('tusdatos_config')
}

// Valida quién llama: admin-bypass (header compartido) o un usuario real con
// JWT válido. Balance y payouts son sensibles → siempre requieren caller.
// ── TOPE POR ENVÍO ACH ────────────────────────────────────────────
// Lo fija el admin (Configuración → Límites de envío) y vive en
// system_config, que solo lee el servidor:
//   'limites_envio'          → { achEmpresa, achPersona, achProveedor }
//   'limite_envio:<userId>'  → { achMax } (excepción para un cliente)
// El del cliente manda sobre el general; el del PROVEEDOR (lo que Finity
// acepta por transferencia) es el techo de todo: ningún tope lo pasa.
const LIMITES_DEF = { achEmpresa: 500_000_000, achPersona: 50_000_000, achProveedor: null as number | null }
async function limitesEnvio(): Promise<typeof LIMITES_DEF> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', 'limites_envio').maybeSingle()
    const v = (data as any)?.value ? JSON.parse((data as any).value) : {}
    const n = (x: any, def: number | null) => { const k = Number(x); return Number.isFinite(k) && k > 0 ? k : def }
    return { achEmpresa: n(v.achEmpresa, LIMITES_DEF.achEmpresa)!, achPersona: n(v.achPersona, LIMITES_DEF.achPersona)!, achProveedor: n(v.achProveedor, null) }
  } catch { return { ...LIMITES_DEF } }
}
// El tope ACH de UN envío. Cuenta quién envía y QUIÉN RECIBE:
//   · una persona (cuenta o beneficiario) tiene el tope de personas (50 M);
//   · una empresa, el de empresas (500 M);
//   · gana el menor: una empresa que le paga a una persona queda en 50 M,
//     empresa a empresa en 500 M.
// La excepción por cliente (Compliance → Límites) manda sobre los generales.
// El tope del proveedor es el techo de todo.
async function topeAchDe(userId: string, beneficiario?: 'empresa' | 'persona' | null): Promise<{ max: number; origen: 'cliente' | 'empresa' | 'persona' | 'beneficiario_persona'; proveedor: number | null }> {
  const g = await limitesEnvio()
  const { data: u } = await db.from('users').select('role').eq('id', userId).maybeSingle()
  const esEmpresa = (u as any)?.role === 'business'
  let propio: number | null = null
  try {
    const { data } = await db.from('system_config').select('value').eq('key', `limite_envio:${userId}`).maybeSingle()
    const k = Number((data as any)?.value ? JSON.parse((data as any).value)?.achMax : NaN)
    if (Number.isFinite(k) && k > 0) propio = k
  } catch { /* sin excepción: aplica el general */ }
  let max: number
  let origen: 'cliente' | 'empresa' | 'persona' | 'beneficiario_persona'
  if (propio != null) { max = propio; origen = 'cliente' }
  else {
    max = esEmpresa ? g.achEmpresa : g.achPersona
    origen = esEmpresa ? 'empresa' : 'persona'
    if (beneficiario === 'persona' && g.achPersona < max) { max = g.achPersona; origen = 'beneficiario_persona' }
  }
  if (g.achProveedor) max = Math.min(max, g.achProveedor)
  return { max, origen, proveedor: g.achProveedor }
}

// Aprobación manual de cumplimiento sobre una ficha de antecedentes
// (Admin → Cumplimiento → Aprobar). Vale solo contra el veredicto que el
// admin tuvo a la vista: si una consulta nueva cambia la categoría o la
// identidad, deja de valer. Misma regla que tusdatos (aprobacionVigente).
function aprobacionAmlVigente(f: any): boolean {
  const d = f?.decisionManual
  if (!d || d.decision !== 'aprobar') return false
  if ((d.categoriaEntonces ?? null) !== (f?.categoria ?? null)) return false
  if ('nombreCoincideEntonces' in d && (d.nombreCoincideEntonces ?? null) !== (f?.nombreCoincide ?? null)) return false
  if ('documentoVigenteEntonces' in d && (d.documentoVigenteEntonces ?? null) !== (f?.documentoVigente ?? null)) return false
  return true
}

// ── Conciliar UNA dispersión que salió por Finity (ACH o Bre-B · Cuenta 2) ──
// Le pregunta a Finity el estado del movimiento y:
//   · rechazado / devuelto / vencido → Rechazado + REEMBOLSO de monto y
//     comisión al riel de donde salió (COP_ACH);
//   · completado → Completado (solo si estaba Procesando).
// La usan la app del cliente (reconcile_ach) y el vigilante del servidor
// (vigilar_finity), así que las dos hacen exactamente lo mismo.
//
// El rechazo se mira PRIMERO: una devolución tardía llega sobre un envío que
// ya figuraba completado, y es justo la que no puede quedar sin reembolsar.
const RE_FINITY_FALLO = /FAILED|FALLID|REJECT|RECHAZ|CANCEL|ANUL|DECLIN|RETURN|DEVUEL|REVERS|EXPIR|VENCID|UNSUCCESS/
// APPROVED / APROBADO no van: es "aprobada para procesar", no "pagada" (así lo
// trata también finity-proxy). Marcarla Completado antes de tiempo la sacaba
// de la vigilancia de Procesando, y una devolución posterior no se veía.
const RE_FINITY_OK = /COMPLET|SETTLE|LIQUID|PAGAD|\bPAID\b|SUCCESS|FINALIZ|DISPERSAD|EXITOS/
async function conciliarFilaFinity(tx: any, origen: string): Promise<Record<string, unknown>> {
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const ref = String(rd.providerRef ?? '')
  const dueno = String(tx.user_id ?? '')
  if (!ref || !dueno) return { id: tx.id, result: 'sin_referencia' }
  if (rd.refunded) return { id: tx.id, result: 'already_refunded' }
  const st = await finityCall('withdrawal_status', dueno, { id: ref })
  // Sin una consulta exitosa no se clasifica nada: con ok:false, `data` es el
  // cuerpo de un ERROR de Finity, y un `status` dentro de ese error se leía
  // como si fuera el estado de la transferencia.
  if (!st || st.ok !== true) return { id: tx.id, result: 'consulta_fallida', httpStatus: st?.status ?? null }
  const d = (st?.data ?? {}) as any
  // Finity devuelve el estado en distintos niveles según el endpoint; se
  // excava en todos (antes sólo leía d.status/d.state y, si venía anidado,
  // quedaba vacío → la dispersión se atascaba en 'Procesando').
  const s = String(
    d?.status ?? d?.state ?? d?.data?.status ?? d?.data?.state ??
    d?.order?.status ?? d?.order?.state ?? d?.attributes?.status ?? d?.attributes?.state ?? ''
  ).toUpperCase()
  if (RE_FINITY_FALLO.test(s)) {
    if (!(await filaFirmada(tx, 'dispersion'))) { if (!rd.sinFirmaServidor) await aRevisionSinFirma(tx, origen); return { id: tx.id, result: 'revision_sin_firma' } }
    const permiso = await reembolsoPermitido(tx, ref, origen)
    if (!permiso.ok) return { id: tx.id, result: 'revision_ref_duplicada' }
    const refund = permiso.refund
    const railCol = String(tx.currency ?? 'COP_ACH')
    // CAS: reclamar el reembolso ANTES de tocar el saldo. Si el webhook (o
    // una ejecución paralela) ya reclamó, claimed viene vacío y NO se
    // acredita de nuevo — evita el doble reembolso.
    // El MOTIVO que da el operador ("CUENTA Y NIT NO CORRESPONDEN") se
    // guarda con el rechazo: el cliente lo ve en el detalle del envío.
    // Solo campos que SIGNIFICAN motivo de rechazo. Un campo genérico
    // (description, message) puede traer "Envío de dinero" —lo que mandamos
    // nosotros—, y guardarlo como motivo saltaba la búsqueda a fondo: el
    // cliente veía eso para siempre en vez de "NUMERO CUENTA NO EXISTE".
    const motivoProveedor = digMotivoRechazo(st, textosQueNoSonMotivo(rd), true)
    const ahora = new Date().toISOString()
    const { data: claimed } = await db.from('transactions').update({
      status: 'Rechazado',
      raw_data: { ...rd, refunded: true, refundCop: refund, providerStatus: s, providerError: motivoProveedor, ...(motivoProveedor ? {} : { motivoDiag: clavesDe(st).slice(0, 600) }), reconciledAt: ahora, ...(tx.status === 'Completado' ? { devolucionTardia: true } : {}) },
    }).eq('id', tx.id).neq('status', 'Rechazado').filter('raw_data->>refunded', 'is', null).select('id')
    if (!claimed?.length) return { id: tx.id, result: 'refund_already_claimed' }
    const acreditado = await creditBalanceAtomic(dueno, railCol, refund)   // atómico (pentest #3)
    if (!acreditado) {
      // El saldo NO volvió. Se deshace el reclamo para que la próxima vuelta
      // lo reintente: un envío rechazado no puede quedar marcado como
      // devuelto sin que la plata haya vuelto.
      await db.from('transactions').update({ status: tx.status, raw_data: { ...rd, reembolsoPendiente: true, reembolsoFallidoAt: ahora } })
        .eq('id', tx.id).eq('status', 'Rechazado').filter('raw_data->>refunded', 'eq', 'true')
      await logAudit(dueno, 'finity.reconcile.reembolso_fallido', { txId: tx.id, refund, railCol, providerRef: ref, origen })
      await avisarAdminSinConfirmar({ id: tx.id, user_id: dueno, amount: tx.amount, currency: railCol, raw_data: rd })
      return { id: tx.id, result: 'reembolso_fallido' }
    }
    await logAudit(dueno, 'finity.reconcile.reembolso', { txId: tx.id, refund, railCol, providerRef: ref, providerStatus: s, origen, tardia: tx.status === 'Completado' })
    // El saldo ya volvió. Si el estado no trajo el motivo, se busca a fondo
    // DESPUÉS del reembolso (son varias consultas; no deben demorarlo).
    let motivoFinal = motivoProveedor
    if (!motivoFinal) {
      try {
        const hallado = await motivoFinity(dueno, ref, st, rd)
        motivoFinal = hallado.motivo
        const { data: fila } = await db.from('transactions').select('raw_data').eq('id', tx.id).maybeSingle()
        const rdAhora = ((fila as any)?.raw_data ?? {}) as Record<string, any>
        await db.from('transactions').update({ raw_data: { ...rdAhora, motivoBuscado: new Date().toISOString(), motivoBuscadoV: '4', ...(motivoFinal ? { providerError: motivoFinal } : { motivoDiag: hallado.diag ?? rdAhora.motivoDiag }) } }).eq('id', tx.id)
      } catch { /* el motivo es informativo: el reembolso ya está hecho */ }
    }
    return { id: tx.id, result: 'refunded', refund, motivo: motivoFinal }
  }
  if (RE_FINITY_OK.test(s)) {
    if (tx.status === 'Completado') return { id: tx.id, result: 'sigue_completado' }
    await db.from('transactions').update({
      status: 'Completado',
      raw_data: { ...rd, providerStatus: s, reconciledAt: new Date().toISOString() },
    }).eq('id', tx.id).eq('status', 'Procesando')
    return { id: tx.id, result: 'completed' }
  }
  return { id: tx.id, result: 'still_processing', providerStatus: s || null }
}

// Qué permiso del equipo pide cada acción de admin. Lo que no figura queda
// para el dueño. Tesorería ve las bolsas (Billeteras) y concilia desde
// Clientes; lo de Fallos (devolver, confirmar, vincular) es de Operaciones.
const PERMISO_MOUV: Record<string, string | string[]> = {
  treasury_balances: ['plata.ver', 'tesoreria'],
  sondear_dispersion: ['plata.ver', 'tesoreria'],
  reconcile_breb: ['plata.mover', 'tesoreria'],
  reconcile_ach: ['plata.mover', 'tesoreria'],
  confirmar_dispersion: 'plata.mover',
  force_return: 'plata.mover',
  marcar_reembolso_externo: 'plata.mover',
  vincular_referencia: 'plata.mover',
  verify_and_credit: 'plata.mover',
}

async function validCaller(req: Request, payload: any): Promise<{ ok: boolean; userId: string | null; admin: boolean; viaJwt: boolean; servicio?: boolean }> {
  const authHeader = req.headers.get('Authorization') ?? ''
  // (El "AdminBypass <password>" se eliminó: secreto compartido que se filtraba
  //  en el bundle del frontend. El admin real entra por JWT con role='admin'.)
  const jwt = authHeader.replace('Bearer ', '').trim()

  // LLAMADA INTERNA (cron / otra edge function). La service_role key no es un
  // JWT de usuario: db.auth.getUser() la rechaza, asi que sin esto un cron no
  // podia correr la conciliacion y todo dependia de que alguien tuviera una
  // pantalla abierta.
  //
  // Solo la sabe el servidor: no viaja al navegador ni esta en el bundle.
  if (jwt && SERVICE_KEY && igualSeguro(jwt, SERVICE_KEY)) {
    return { ok: true, userId: payload?.user_id ?? payload?.userId ?? null, admin: true, viaJwt: true, servicio: true }
  }

  if (jwt) {
    try {
      const { data: { user } } = await Promise.race([
        db.auth.getUser(jwt),
        new Promise<any>((_, rej) => setTimeout(() => rej(new Error('auth_timeout')), 3000)),
      ]) as any
      if (user?.id) {
        const { data: u } = await db.from('users').select('id, role').eq('id', user.id).maybeSingle()
        // viaJwt = identidad PROBADA por un token real (no un uid del body).
        return { ok: true, userId: user.id, admin: (u as any)?.role === 'admin', viaJwt: true }
      }
    } catch { /* jwt inválido/vencido → cae abajo */ }
  }
  // Respaldo "medio-auth": user_id explícito que exista. Sirve para acciones
  // NO sensibles (cotizar, leer estado), pero NUNCA autoriza mover dinero —
  // eso lo exige requireOwner() con viaJwt. NUNCA eleva a admin por un uid.
  const uid = payload?.user_id ?? payload?.userId
  if (uid) {
    const { data } = await db.from('users').select('id').eq('id', uid).maybeSingle()
    if (data) return { ok: true, userId: uid, admin: false, viaJwt: false }
  }
  return { ok: false, userId: null, admin: false, viaJwt: false }
}

// Puerta para acciones que MUEVEN DINERO o leen saldos sensibles: el que
// llama debe haber probado su identidad con un JWT real (o AdminBypass). Un
// simple user_id en el body NO basta — así nadie puede, con solo la llave
// pública y el id de una víctima, disparar un payout en la cuenta ajena.
// Devuelve el userId efectivo (el del JWT para no-admins; el del body si es
// admin) o null si no está autorizado.
function requireOwner(caller: { userId: string | null; admin: boolean; viaJwt: boolean }, payload: any): string | null {
  if (caller.admin) return payload?.user_id ?? payload?.userId ?? caller.userId ?? null
  if (caller.viaJwt && caller.userId) return caller.userId
  return null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!MOUV_API_KEY) {
    return json(200, { error: 'mouv_not_configured', message: 'El servicio de envíos no está disponible en este momento. Intenta más tarde o escríbenos a soporte@lincoin.me.' })
  }

  const payload = await req.json().catch(() => ({}))
  const action = String(payload.action ?? '')

  // ── WEBHOOK de recaudo PSE (Mouv notifica el pago confirmado) ──────
  // Mouv postea aquí (callbackUrl) SIN nuestra auth. Se reconoce porque no
  // trae 'action' pero sí una referencia/estado de recaudo. Se busca la
  // transacción Pendiente por referencia y, si el pago está aprobado, se
  // acredita el Saldo Lincoin (idempotente por status). Tolerante al shape:
  // se excava reference/status en cualquier nivel, como con Finity.
  if (!action) {
    const dig = (o: any, keys: string[]): string => {
      const seen = new Set<any>(); const stack = [o]
      while (stack.length) { const c = stack.pop(); if (!c || typeof c !== 'object' || seen.has(c)) continue; seen.add(c)
        for (const [k, v] of Object.entries(c)) { if (keys.includes(k.toLowerCase()) && (typeof v === 'string' || typeof v === 'number')) return String(v); if (v && typeof v === 'object') stack.push(v) } }
      return ''
    }
    // ── Evento de TRANSFERENCIA (dispersión Bre-B): Mouv puede notificar que
    //    un envío quedó DEVUELTO/RECHAZADO o COMPLETADO. Se busca la dispersión
    //    por su providerRef (el id de Mouv) y se reconcilia. NO se confía en el
    //    cuerpo (no está firmado): se RE-VERIFICA el estado contra Mouv antes de
    //    reembolsar — así un POST forjado no puede forzar un reembolso indebido.
    const transferId = dig(payload, ['id', 'transfer_id', 'transferid', 'transaction_id', 'transactionid'])
    if (transferId) {
      const { data: drows } = await db.from('transactions').select('id, user_id, amount, currency, status, raw_data')
        .eq('type', 'dispersion').filter('raw_data->>providerRef', 'eq', String(transferId)).limit(2)
      const dtx = (drows ?? [])[0] as any
      if (dtx) {
        const drd = (dtx.raw_data ?? {}) as Record<string, any>
        if (dtx.status === 'Rechazado' || drd.refunded) return json(200, { ok: true, already: 'refunded' })
        const st = await mouvTransferStatus(String(transferId))
        if (st.found && st.verdict === 'returned') {
          if (!(await filaFirmada(dtx, 'dispersion'))) { await aRevisionSinFirma(dtx, 'mouv_webhook'); return json(200, { ok: true, revision: 'sin_firma' }) }
          const permiso = await reembolsoPermitido(dtx, String(transferId), 'mouv_webhook')
          if (!permiso.ok) return json(200, { ok: true, revision: 'ref_duplicada' })
          const refund = permiso.refund
          const railCol = String(dtx.currency ?? 'COP_BREB')
          const { data: claimed } = await db.from('transactions').update({
            status: 'Rechazado',
            raw_data: { ...drd, refunded: true, refundCop: refund, providerState: st.state, returnedAt: new Date().toISOString(), source_event: 'mouv_webhook' },
          }).eq('id', dtx.id).neq('status', 'Rechazado').filter('raw_data->>refunded', 'is', null).select('id')
          if (claimed?.length) {
            // Si el saldo NO volvió, se suelta el reclamo para que la próxima
            // conciliación lo reintente. Antes se ignoraba el resultado: la fila
            // quedaba "reembolsada" sin que la plata volviera, y ninguna vuelta
            // posterior la miraba otra vez.
            const acreditado = await creditBalanceAtomic(dtx.user_id, railCol, refund)
            if (!acreditado) {
              await db.from('transactions').update({
                status: dtx.status,
                raw_data: { ...drd, reembolsoFallido: true, reembolsoFallidoAt: new Date().toISOString(), providerState: st.state },
              }).eq('id', dtx.id).eq('status', 'Rechazado')
              await logAudit(dtx.user_id, 'mouv.webhook.reembolso_fallido', { txId: dtx.id, refund, transferId })
              await avisarAdminSinConfirmar({ id: dtx.id, user_id: dtx.user_id, amount: dtx.amount, currency: railCol, raw_data: drd })
              return json(200, { ok: true, refunded: false, retry: true, id: transferId })
            }
            await logAudit(dtx.user_id, 'mouv.webhook.breb_returned', { txId: dtx.id, refund, providerState: st.state, transferId })
            await notifyTx(dtx.id)
          }
          return json(200, { ok: true, refunded: true, id: transferId })
        }
        if (st.found && st.verdict === 'completed' && dtx.status !== 'Completado') {
          await db.from('transactions').update({
            status: 'Completado', raw_data: { ...drd, providerState: st.state, settledAt: new Date().toISOString(), source_event: 'mouv_webhook' },
          }).eq('id', dtx.id).neq('status', 'Rechazado')
          await notifyTx(dtx.id)
          return json(200, { ok: true, completed: true, id: transferId })
        }
        return json(200, { ok: true, pending: true, id: transferId, providerState: st.state || null })
      }
      // No es una dispersión conocida → sigue el flujo de recaudo (payin).
    }

    const ref = dig(payload, ['reference', 'reference_id', 'referenceid', 'external_id', 'externalid'])
    const status = dig(payload, ['status', 'state', 'event', 'transaction_status']).toUpperCase()
    if (!ref) return json(200, { ok: true, ignored: 'no_reference' })
    const { data: rows } = await db.from('transactions').select('id, user_id, amount, currency, status, raw_data')
      .eq('type', 'load').filter('raw_data->>reference', 'eq', ref).limit(2)
    const tx = (rows ?? [])[0] as any
    if (!tx) return json(200, { ok: true, matched: false, ref })
    const paid = /APPROVED|APROBAD|COMPLETED|SUCCESS|PAID|CONFIRM|ACCEPTED|OK/.test(status)
    const failed = /REJECT|DECLIN|FAILED|CANCEL|EXPIRED|ERROR/.test(status)
    if (tx.status === 'Completado' || tx.status === 'Rechazado') return json(200, { ok: true, already: tx.status })
    if (paid) {
      // SEGURIDAD: no se confía en el cuerpo del webhook (no está firmado y
      // podría forjarse). Se VERIFICA contra la API real de Mouv que el
      // recaudo esté aprobado antes de acreditar. Si no se puede verificar
      // (endpoint de estado aún no cableado), NO se acredita — queda para
      // revisión del admin, nunca crédito por un POST no verificado.
      const rd = (tx.raw_data ?? {}) as Record<string, any>
      const pref = String(rd.providerRef ?? ref)
      let verified = false
      for (const p of [`/collections/${pref}`, `/payin/${pref}`, `/pse/${pref}`, `/collections/status/${pref}`]) {
        const chk = await mouvFetch(p, { method: 'GET' })
        if (chk.ok) { const cs = String((chk.data as any)?.status ?? (chk.data as any)?.state ?? '').toUpperCase(); if (/APPROVED|APROBAD|COMPLETED|SUCCESS|PAID|CONFIRM|ACCEPTED|OK/.test(cs)) { verified = true; break } }
      }
      if (!verified) return json(200, { ok: true, unverified: true, ref, note: 'no se pudo verificar con Mouv — sin acreditar' })
      if (!(await filaFirmada(tx, 'load'))) { await aRevisionSinFirma(tx, 'payin_pse'); return json(200, { ok: true, revision: 'sin_firma', ref }) }
      // CAS: reclamar la acreditación antes de tocar el saldo (idempotente).
      const { data: claimed } = await db.from('transactions').update({
        status: 'Completado', raw_data: { ...rd, payinStatus: status, paidAt: new Date().toISOString(), verified: true },
      }).eq('id', tx.id).neq('status', 'Completado').select('id')
      if (claimed?.length) {
        const col = String(tx.currency ?? 'COP')
        await creditBalanceAtomic(tx.user_id, col, Number(tx.amount ?? 0))   // atómico (pentest #3)
        await logAudit(tx.user_id, 'mouv.payin_pse.credited', { ref, amount: tx.amount, status })
      }
      return json(200, { ok: true, credited: true, ref })
    }
    if (failed) {
      await db.from('transactions').update({ status: 'Rechazado', raw_data: { ...(tx.raw_data ?? {}), payinStatus: status, failedAt: new Date().toISOString() } }).eq('id', tx.id).neq('status', 'Completado')
      return json(200, { ok: true, rejected: true, ref })
    }
    return json(200, { ok: true, pending: true, ref, status })
  }

  // ── VIGILANTE FINITY (lo llama la base con pg_cron) ─────────────────
  // Un envío por Finity (ACH o Bre-B · Cuenta 2) puede rechazarse minutos
  // DESPUÉS de confirmado. Hasta ahora eso solo se detectaba cuando alguien
  // tenía la app abierta; si el cliente la cerraba, el saldo quedaba
  // descontado sin envío. Esto lo revisa el servidor solo:
  //   · cada corrida: las dispersiones de Finity que siguen Procesando;
  //   · con barrido: además los Bre-B · Cuenta 2 completados de los últimos
  //     3 días, por si el banco los devuelve tarde.
  // Lo autoriza la clave que la base genera para sí misma (aviso_secret) o la
  // service key. Nadie tiene que copiar llaves.
  if (action === 'vigilar_finity') {
    const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    const autorizado = (!!SERVICE_KEY && igualSeguro(bearer, SERVICE_KEY)) || await traeSecretoDeLaBase(req, db)
    if (!autorizado) return json(403, { error: 'forbidden' })
    const ahora = Date.now()
    // UNA referencia puntual: la usa el aviso (webhook) de Finity. El aviso no
    // decide nada por su cuenta: avisa, y acá se le vuelve a preguntar a
    // Finity el estado, con las mismas protecciones de siempre (firma,
    // referencia única, reversa si el crédito falla).
    const refObjetivo = String(payload?.ref ?? '').trim()
    if (refObjetivo) {
      const { data: filasRef } = await db.from('transactions')
        .select('id, user_id, amount, currency, status, raw_data, created_at')
        .eq('type', 'dispersion').eq('currency', 'COP_ACH').in('status', ['Procesando', 'Completado'])
        .filter('raw_data->>providerRef', 'eq', refObjetivo).limit(3)
      const resultados: Record<string, unknown>[] = []
      for (const tx of (filasRef ?? []) as any[]) {
        try { resultados.push(await conciliarFilaFinity(tx, 'finity_webhook')) }
        catch (e) { resultados.push({ id: tx.id, result: 'error', error: String((e as Error)?.message ?? e).slice(0, 160) }) }
      }
      return json(200, { ok: true, ref: refObjetivo, revisadas: resultados.length, results: resultados })
    }
    // Las más NUEVAS (rechazos que alguien está esperando) y las más VIEJAS
    // (las que llevan días atascadas). Solo las nuevas dejaba que 30 filas
    // trabadas ocuparan todos los cupos y las demás no se miraban nunca.
    const baseVivas = () => db.from('transactions')
      .select('id, user_id, amount, currency, status, raw_data, created_at')
      .eq('type', 'dispersion').eq('status', 'Procesando').eq('currency', 'COP_ACH')
      .not('raw_data->>providerRef', 'is', null)
      .gte('created_at', new Date(ahora - 10 * 86_400_000).toISOString())
      .lte('created_at', new Date(ahora - 30_000).toISOString())
    const [{ data: nuevas }, { data: viejas }] = await Promise.all([
      baseVivas().order('created_at', { ascending: false }).limit(25),
      baseVivas().order('created_at', { ascending: true }).limit(15),
    ])
    const vistas = new Set<string>()
    const vivas = [...((nuevas ?? []) as any[]), ...((viejas ?? []) as any[])].filter(t => !vistas.has(t.id) && !!vistas.add(t.id))
    let tardias: any[] = []
    if (payload?.barrido === true) {
      // Devoluciones TARDÍAS sobre envíos ya Completados: Bre-B · Cuenta 2 y
      // también ACH. Antes solo se miraba Bre-B, y un ACH que el banco devolvía
      // al día siguiente de marcarse Completado no se reembolsaba nunca.
      const { data } = await db.from('transactions')
        .select('id, user_id, amount, currency, status, raw_data, created_at')
        .eq('type', 'dispersion').eq('status', 'Completado').eq('currency', 'COP_ACH')
        .not('raw_data->>providerRef', 'is', null)
        .gte('created_at', new Date(ahora - 5 * 86_400_000).toISOString())
        .order('created_at', { ascending: false }).limit(60)
      // En orden aleatorio: con sesenta filas no alcanza el tiempo para todas,
      // y en el mismo orden siempre quedaban sin mirar las mismas.
      tardias = ((data ?? []) as any[]).sort(() => Math.random() - 0.5)
    }
    // Con tiempo tope: el barrido de 100 filas pasaba de los 2 minutos, la
    // base cortaba la llamada y no se sabía qué había quedado revisado. Lo que
    // no alcanza se mira en la siguiente vuelta.
    const results: Record<string, unknown>[] = []
    let parcial = false
    for (const tx of [...vivas, ...tardias]) {
      if (Date.now() - ahora > 90_000) { parcial = true; break }
      try { results.push(await conciliarFilaFinity(tx, 'vigilar_finity')) }
      catch (e) { results.push({ id: tx.id, result: 'error', error: String((e as Error)?.message ?? e).slice(0, 160) }) }
    }
    const resumen = results.reduce((m: Record<string, number>, r) => { const k = String(r.result); m[k] = (m[k] ?? 0) + 1; return m }, {})
    if (results.some(r => r.result === 'refunded' || r.result === 'completed' || r.result === 'reembolso_fallido')) {
      await logAudit(null, 'finity.vigilante', { revisadas: results.length, resumen })
    }
    return json(200, { ok: true, revisadas: results.length, ...(parcial ? { parcial: true, pendientes: vivas.length + tardias.length - results.length } : {}), resumen, results })
  }

  const caller = await validCaller(req, payload)
  if (!caller.ok) return json(401, { error: 'unauthorized', message: 'Tu sesión expiró. Vuelve a iniciar sesión.' })

  // ── Rol en el equipo ──────────────────────────────────────────────────
  // Ser admin ya no alcanza: un miembro opera acá solo lo que su rol permite
  // (_shared/equipo.ts). Antes cualquier cuenta admin —"Solo lectura"
  // incluida— podía devolver dispersiones o acreditar depósitos llamando acá
  // directo, aunque admin-data le negara lo mismo. Si el rol no alcanza, se
  // le trata como un usuario más: lo de admin le responde 403 y lo propio
  // sigue siendo solo lo propio. Mouv es Colombia: pide tener CO asignado.
  if (caller.admin && !caller.servicio && caller.userId) {
    const g = await equipoPermite(db, caller.userId, PERMISO_MOUV[action], { pais: 'CO' })
    if (!g.ok) caller.admin = false
  }

  // ── Consultar una llave Bre-B (directorio Mouv): devuelve el TITULAR
  //    (nombre, documento) y su BANCO para autollenar la inscripción de
  //    beneficiario. Cualquier usuario autenticado puede consultar (es su
  //    propio beneficiario). Es de solo LECTURA — no mueve dinero.
  if (action === 'resolve_breb_key') {
    // Devuelve NOMBRE COMPLETO, DOCUMENTO y banco del titular de la llave.
    // Exigía solo `caller.ok`, que se concede con un user_id cualquiera que
    // exista en la tabla, sin sesión real: con la llave pública y un uuid se
    // podía enumerar nombre+cédula+banco de cualquier colombiano con llave
    // Bre-B, fuera cliente o no. Ahora exige sesión PROBADA y propia.
    const duenoBreb = requireOwner(caller, payload)
    if (!duenoBreb) return json(403, { error: 'forbidden', message: 'Esta consulta requiere una sesión válida. Vuelve a iniciar sesión.' })
    const rawKey = String((payload as any).keyValue ?? (payload as any).key ?? '').trim()
    if (!rawKey) return json(400, { error: 'missing_key', message: 'Falta la llave.' })
    // Devuelve nombre y documento de un tercero: con la sesión de cualquier
    // cuenta (el registro es abierto) se podía consultar en masa. Tope por
    // cuenta y por día; quien inscribe beneficiarios de verdad no llega.
    if (!caller.admin) {
      // Se cuentan LLAVES DISTINTAS, no consultas: el formulario vuelve a
      // consultar cada vez que el cliente sale del campo, y MEXITECH (que
      // inscribe ~20 Bre-B al día) agotó las 60 el 30 oct a las 18:26 con
      // llaves repetidas; desde ahí "no se llenaba la llave sola". Repetir una
      // llave ya consultada no gasta cupo. Empresas verificadas: 150.
      const huella = await huellaLlave(rawKey)
      try {
        const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
        const { data: previas } = await db.from('audit_log').select('metadata')
          .eq('user_id', duenoBreb).eq('action', 'mouv.breb_consulta').gte('created_at', desde).limit(1000)
        const vistas = new Set<string>()
        let sinHuella = 0   // las anteriores a este cambio no la guardaban: cuenta cada una
        for (const f of (previas ?? []) as any[]) { const h = f?.metadata?.llave; if (h) vistas.add(String(h)); else sinHuella++ }
        if (!vistas.has(huella)) {
          const { data: cu } = await db.from('users').select('role, kyc_status').eq('id', duenoBreb).maybeSingle()
          const empresaVerificada = (cu as any)?.role === 'business' && ['verified', 'approved'].includes(String((cu as any)?.kyc_status ?? ''))
          const tope = empresaVerificada ? 150 : 60
          if (vistas.size + sinHuella >= tope) return json(429, { error: 'demasiadas_consultas', message: 'Llegaste al máximo de consultas de llaves por hoy. Intenta de nuevo mañana o escríbenos a soporte.' })
        }
      } catch { /* sin conteo no se frena la inscripción */ }
      await logAudit(duenoBreb, 'mouv.breb_consulta', { tipo: String((payload as any).keyType ?? ''), llave: huella })
    }
    const rr = await mouvResolveBrebKey(rawKey, String((payload as any).keyType ?? ''))
    // Respaldo: con el directorio de Mouv caído se le pregunta a Finity. Su
    // "crear" de Bre-B (sin confirmar, no mueve plata) devuelve el nombre del
    // titular y el banco, NO la cédula: esa la escribe el cliente. Solo cuando
    // Mouv no responde; el tope de arriba aplica igual.
    if (!rr.found && rr.caido) {
      const fr = await titularPorFinity(duenoBreb, rawKey, String((payload as any).keyType ?? '')).catch(() => null)
      if (fr) return json(200, { ok: true, found: true, fuente: 'finity', matchedKey: fr.llave, fullName: fr.nombre, idValue: null, keyType: null, bank: fr.banco })
    }
    if (!rr.found && rr.caido) return json(200, { ok: false, error: 'directorio_caido', message: 'El directorio Bre-B no responde en este momento. Intenta de nuevo en unos minutos o envía por ACH.' })
    if (!rr.found) return json(200, { ok: true, found: false, message: 'La llave Bre-B no existe o no está activa.' })
    return json(200, { ok: true, found: true, matchedKey: rr.matchedKey, fullName: rr.fullName ?? null, idValue: rr.idValue ?? null, keyType: rr.keyType ?? null, bank: rr.bank ?? null })
  }

  // ── El tope por envío del propio cliente, para mostrarlo en su pantalla.
  //    Solo lectura y solo el suyo (sesión probada).
  if (action === 'limite_envio') {
    const dueno = requireOwner(caller, payload)
    if (!dueno) return json(403, { error: 'forbidden' })
    const t = await topeAchDe(dueno)
    const tPersona = await topeAchDe(dueno, 'persona')
    const BREB_MAX = Number(Deno.env.get('BREB_MAX_COP') ?? '12000000') || 12000000
    const BREB2_MAX = Number(Deno.env.get('BREB2_MAX_COP') ?? '') || BREB_MAX
    return json(200, { ok: true, achMax: t.max, achMaxPersona: tPersona.max, brebMax: BREB_MAX, breb2Max: BREB2_MAX, breb2FeeCop: BREB2_FEE_COP })
  }

  // ── ping / balance: saldo de la wallet COMPARTIDA — SOLO ADMIN ──
  // Los clientes NUNCA pueden ver el saldo total de la wallet Mouv; ellos
  // solo disponen del saldo interno que el admin les cargó (Cargues). Por
  // eso estas dos acciones exigen caller.admin.
  if (action === 'ping') {
    if (!caller.admin) return json(403, { error: 'forbidden', message: 'Solo admin.' })
    const r = await mouvFetch('/wallets/balance')
    return json(200, {
      ok: r.ok,
      status: r.status,
      base: MOUV_BASE,
      message: r.ok ? 'Credenciales Mouv válidas — conectado.' : `Mouv respondió ${r.status}.`,
      data: r.data,
    })
  }

  if (action === 'balance') {
    if (!caller.admin) return json(403, { error: 'forbidden', message: 'Solo admin.' })
    const r = await mouvFetch('/wallets/balance')
    return json(200, { ok: r.ok, status: r.status, path: r.path, data: r.data })
  }

  // ── treasury_balances: saldo de la wallet COMPARTIDA para el panel admin ──
  // Usa el endpoint confirmado GET /api/wallets/balance. Devuelve el crudo +
  // un parseo best-effort (los nombres exactos de los campos se ajustan al
  // ver la respuesta real). SOLO ADMIN.
  if (action === 'treasury_balances') {
    if (!caller.admin) return json(403, { error: 'forbidden', message: 'Solo admin.' })
    const r = await mouvFetch('/wallets/balance')
    if (!r.ok) return json(200, { error: `Mouv respondió ${r.status}.`, status: r.status, raw: r.data })
    const d: any = r.data ?? {}
    // Estructura real (doc): { currency, wallets:[{rail:'BREB'|'ACH',
    //   availableCents, totalCents, maxTransferAmount,...}], consolidated:{availableCents} }
    // El valor va en PESOS (mismo criterio que /transfers: amount en pesos).
    const toNum = (v: any): number | null => {
      if (typeof v === 'number') return v
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
      return null
    }
    // Los *Cents vienen en CENTAVOS (confirmado: 3.173.093.200 = $31.730.932).
    const centsToPesos = (v: any): number | null => { const n = toNum(v); return n === null ? null : n / 100 }
    const wallets: any[] = Array.isArray(d?.wallets) ? d.wallets : []
    const railAmt = (rail: string): number | null => {
      const w = wallets.find(x => String(x?.rail ?? '').toUpperCase() === rail)
      return w ? centsToPesos(w.availableCents) : null
    }
    const breb = railAmt('BREB')
    const ach = railAmt('ACH')
    const total = centsToPesos(d?.consolidated?.availableCents) ?? ((breb ?? 0) + (ach ?? 0) || null)
    return json(200, { ok: true, status: r.status, source: 'mouv', total, breb, ach, cop: total, raw: d })
  }

  // ── Conciliación ACH SIN webhook ──────────────────────────
  // Mientras el webhook del proveedor no esté activo, la app pregunta el
  // estado real de las órdenes de retiro de las dispersiones ACH que
  // siguen 'Procesando' y actualiza: COMPLETED → Completado ·
  // FAILED/CANCELLED → Rechazado + REEMBOLSO (monto + comisión) al riel.
  // Idempotente (flag refunded). La llama el frontend al abrir Movimientos.
  if (action === 'reconcile_ach') {
    // Identidad PROBADA (JWT/admin): sin esto, con la anon key + el UUID de una
    // víctima se podían enumerar sus dispersiones y forzar reembolsos/estados
    // en su cuenta (IDOR). El reembolso siempre va al dueño, pero igual no se
    // deja tocar la cuenta ajena.
    const userId = requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Vuelve a iniciar sesión.' })
    // Solo lo que salió por Finity: ACH y Bre-B · Cuenta 2 (las dos pagan con
    // el saldo ACH). Las de Mouv las concilia reconcile_breb; si entraban acá
    // ocupaban los 20 cupos preguntándole a Finity por ids que no son suyos.
    const { data: rows } = await db.from('transactions')
      .select('id, user_id, amount, currency, status, raw_data')
      .eq('type', 'dispersion').eq('user_id', userId).eq('status', 'Procesando')
      .neq('currency', 'COP_BREB')
      .order('created_at', { ascending: false })
      .limit(20)
    const out: any[] = []
    // Rechazos recientes que quedaron SIN motivo (antes no se guardaba): se
    // les pide el detalle a Finity una vez y se anota. No toca saldos.
    const hace30d = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const VERSION_BUSQUEDA = '4'
    // Con `txId` (el detalle del envío lo manda) se consulta ESE movimiento
    // sí o sí, aunque ya se haya buscado antes. Sin txId, los rechazos
    // recientes que aún no se buscaron con esta versión.
    const txIdPedido = String(payload?.txId ?? '')
    let sinMotivo: any[] = []
    if (txIdPedido) {
      const { data: fila } = await db.from('transactions').select('id, user_id, amount, currency, status, raw_data')
        .eq('id', txIdPedido).eq('user_id', userId).eq('type', 'dispersion').maybeSingle()
      if (fila && String((fila as any).status) === 'Rechazado') sinMotivo = [fila]
    } else {
      const { data: candidatas } = await db.from('transactions')
        .select('id, user_id, amount, currency, status, raw_data')
        .eq('type', 'dispersion').eq('user_id', userId).eq('status', 'Rechazado').gte('created_at', hace30d)
        .order('created_at', { ascending: false }).limit(30)
      sinMotivo = ((candidatas ?? []) as any[])
        .filter(t => !t.raw_data?.providerError && String(t.raw_data?.motivoBuscadoV ?? '') !== VERSION_BUSQUEDA)
        .slice(0, 8)
    }
    for (const tx of sinMotivo) {
      const rd = (tx.raw_data ?? {}) as Record<string, any>
      const ref = String(rd.providerRef ?? '')
      if (!ref) { out.push({ id: tx.id, result: 'sin_referencia' }); continue }
      const st = await finityCall('withdrawal_status', String(userId), { id: ref })
      // Se excava en TODA la respuesta (movimiento + orden de retiro) y, si
      // no está, en todo lo demás que Finity sepa de ese movimiento.
      const hallado = await motivoFinity(String(userId), ref, st, rd)
      const motivo = hallado.motivo
      // Si no hay motivo, quedan anotadas las CLAVES que devolvió Finity (sin
      // valores) y la respuesta cruda en la auditoría (finity.motivo.no_encontrado).
      const diag = motivo ? undefined : hallado.diag || `sin cuerpo (ok=${String(st?.ok)} status=${String(st?.status)})`
      await db.from('transactions').update({ raw_data: { ...rd, motivoBuscado: new Date().toISOString(), motivoBuscadoV: VERSION_BUSQUEDA, ...(motivo ? { providerError: motivo } : {}), ...(diag ? { motivoDiag: diag } : {}) } }).eq('id', tx.id)
      out.push({ id: tx.id, result: motivo ? 'motivo_anotado' : 'sin_motivo', motivo: motivo ?? null, diag: diag ?? null })
    }
    if (txIdPedido) return json(200, { ok: true, checked: sinMotivo.length, results: out })
    for (const tx of (rows ?? []) as any[]) {
      if (!String(tx?.raw_data?.providerRef ?? '')) continue
      out.push(await conciliarFilaFinity(tx, 'reconcile_ach'))
    }
    return json(200, { ok: true, checked: (rows ?? []).length, results: out })
  }

  // ── Conciliación Bre-B (Mouv) SIN webhook ─────────────────────────
  // El 200 de /transfers/send sólo significa "aceptada": Mouv puede DEVOLVER
  // el pago después (rechazo del banco destino). Esta acción consulta el
  // estado REAL en Mouv de las dispersiones Bre-B recientes y actualiza:
  //   completed → Completado
  //   DEVUELTO/RETURNED/RECHAZADO → Rechazado + REEMBOLSO (monto + comisión)
  // Cubre tanto las 'Procesando' como las que quedaron 'Completado' en una
  // ventana reciente (para atrapar una devolución tardía y reembolsar aunque
  // el comprobante ya dijera Completado). Idempotente (flag refunded, CAS).
  if (action === 'reconcile_breb') {
    // Identidad PROBADA (JWT/admin) — mismo motivo que reconcile_ach (IDOR).
    // El cron y el workflow llaman con la llave de servicio y `todos`, sin
    // user_id: requireOwner les daba null y les contestaba 403. Ninguna de las
    // dos vigilancias automáticas de Bre-B había conciliado nada nunca — una
    // devolución quedaba esperando a que el cliente abriera la app.
    const barridoDelServidor = caller.admin && !caller.userId && payload?.todos === true
    const userId = barridoDelServidor ? 'servidor' : requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Vuelve a iniciar sesión.' })
    // Ventana de conciliación para las ya-Completadas: una devolución bancaria
    // llega en horas/pocos días. Se revisan las Completadas de los últimos N
    // días (default 5), más TODAS las que sigan 'Procesando'. Overridable.
    // Dos modos, mismo motor:
    //   · BARRIDO (por defecto): 5 dias hacia atras, para atrapar devoluciones
    //     tardias sobre envios que ya figuraban completados.
    //   · VIGILANCIA (`recientesMin`): solo lo de los ultimos N minutos. Es
    //     barato -- una consulta al listado y unas pocas filas -- asi que puede
    //     correr cada minuto. Es el que hace que un envio fallido se detecte y
    //     se devuelva en minutos y no en horas: justo despues de enviar es
    //     cuando hay alguien esperando del otro lado.
    const recientesMin = Number(payload?.recientesMin ?? 0) || 0
    const days = Number(Deno.env.get('BREB_RECONCILE_DAYS') ?? '5') || 5
    const since = recientesMin > 0
      ? new Date(Date.now() - recientesMin * 60 * 1000).toISOString()
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    // TODOS LOS CLIENTES (solo admin). La conciliacion por cliente depende de
    // que ESE cliente abra la app, y una devolucion no puede quedar esperando a
    // que a alguien se le ocurra entrar: la plata ya volvio y el saldo sigue
    // debitado. Con esto la mesa cierra el circulo desde el panel.
    const todos = caller.admin && caller.viaJwt && payload?.todos === true
    let q = db.from('transactions')
      .select('id, user_id, amount, currency, status, raw_data, created_at')
      .eq('type', 'dispersion').eq('currency', 'COP_BREB')
      .in('status', recientesMin > 0 ? ['Procesando'] : ['Procesando', 'Completado'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(todos ? 80 : 30)   // lectura = 100 req/min; 80 deja aire
    if (!todos) q = q.eq('user_id', userId)
    const { data: rows } = await q

    // UNA sola consulta trae el estado de todos los envios de la ventana. Se
    // usa como fuente principal; la consulta por id queda de respaldo para lo
    // que no aparezca en el listado.
    const listado = await mouvListarBrebOut(since)
    const porId = new Map<string, any>()
    for (const it of listado.items) { const k = String(it?.id ?? ''); if (k) porId.set(k, it) }
    // Un movimiento de Mouv no puede quedar emparejado con dos filas nuestras.
    //
    // SE SIEMBRA DESDE LA BASE, no solo con las filas de este batch. Sembrarlo
    // con `rows` dejaba libre todo movimiento ya pegado a una fila que este
    // lote no trae: las Rechazado (que el filtro de estados excluye), las de
    // otro usuario cuando concilia un cliente puntual, y las que caen fuera del
    // limite. Un movimiento devuelto ya reembolsado quedaba disponible para
    // reembolsar una SEGUNDA fila.
    const reclamados = new Set<string>()
    const { data: yaPegados } = await db.from('transactions')
      .select('raw_data').eq('type', 'dispersion').eq('currency', 'COP_BREB')
      .not('raw_data->>providerRef', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(2000)
    for (const f of (yaPegados ?? []) as any[]) {
      const k = String((f.raw_data ?? {}).providerRef ?? '')
      if (k) reclamados.add(k)
    }
    for (const tx of (rows ?? []) as any[]) {
      const k = String(((tx.raw_data ?? {}) as any).providerRef ?? '')
      if (k) reclamados.add(k)
    }

    const out: any[] = []
    for (const tx of (rows ?? []) as any[]) {
      const rd = (tx.raw_data ?? {}) as Record<string, any>
      if (rd.refunded) { out.push({ id: tx.id, result: 'already_refunded' }); continue }
      // EL ID DE MOUV, BUSCADO EN SERIO.
      // El barrido del 19 de septiembre devolvio "75 x la fila no tiene
      // providerRef guardado": ni una sola de 75 filas traia el id, o no lo
      // traia DONDE se lo buscaba. Antes se leia un unico campo y, si el id
      // vivia en otro lado, la conciliacion se declaraba imposible sin haber
      // preguntado nada.
      //
      // Se prueban los nombres plausibles y se DICE cual sirvio: si el id
      // estaba todo este tiempo bajo otra llave, la conciliacion arranca ya; y
      // si de verdad no esta, el diagnostico lista las llaves que SI tiene la
      // fila, que es lo unico que permite arreglarlo sin adivinar otra vez.
      const buscarRef = (d: any): { ref: string; campo: string } => {
        const cand: Array<[string, any]> = [
          ['providerRef', d?.providerRef], ['provider_ref', d?.provider_ref],
          ['mouvId', d?.mouvId], ['transferId', d?.transferId], ['transfer_id', d?.transfer_id],
          ['id', d?.id], ['raw.id', d?.raw?.id], ['response.id', d?.response?.id],
          ['data.id', d?.data?.id], ['provider.id', d?.provider?.id],
        ]
        for (const [campo, v] of cand) {
          const sv = v == null ? '' : String(v).trim()
          // NO se exige forma de UUID. La doc pone un UUID de ejemplo, pero la
          // consola de Mouv muestra los ids como TX-PG-483AC9, y un filtro que
          // solo acepta UUID tira justo el id que sirve. Lo unico que se
          // descarta es un id puramente numerico, que seria el NUESTRO.
          if (sv.length >= 6 && !/^\d+$/.test(sv)) return { ref: sv, campo }
        }
        return { ref: '', campo: '' }
      }
      const { ref: refGuardado, campo: campoRef } = buscarRef(rd)

      // ORDEN: (1) el id que ya teniamos, buscado en el listado; (2) si no hay
      // id, emparejar por monto + documento; (3) consulta por id, para lo que
      // sea mas viejo que el listado.
      let ref = refGuardado
      let origenRef = campoRef
      let item: any = ref ? porId.get(ref) ?? null : null

      if (!item && !ref && listado.ok) {
        const m = emparejarConMouv(rd, Number(tx.amount ?? 0), listado.items, reclamados, tx.created_at)
        if (m) {
          item = m.item
          ref = String(m.item.id ?? '')
          origenRef = m.via
          reclamados.add(ref)
          // Se GUARDA para que la proxima vez sea exacto y no haya que volver
          // a emparejar. Queda marcado como emparejado y no como dato de
          // primera mano: dentro de seis meses eso tiene que distinguirse.
          // Ultima verificacion contra la base: entre que se leyo `reclamados` y
          // ahora, otra corrida pudo haber pegado este mismo movimiento a otra
          // fila. Dos filas con el mismo providerRef significan "estos dos
          // envios distintos son el mismo", y a partir de ahi toda conciliacion
          // posterior saca la conclusion equivocada.
          const { data: chocaCon } = await db.from('transactions')
            .select('id').eq('type', 'dispersion').filter('raw_data->>providerRef', 'eq', ref).neq('id', tx.id).limit(1)
          if (chocaCon?.length) {
            out.push({ id: tx.id, result: 'emparejamiento_duplicado', providerRef: ref })
            continue
          }
          // Solo si la fila sigue sin ref y sin reembolso. Sin estas guardas, una
          // corrida lenta escribía su copia vieja de raw_data encima de la que
          // otra corrida ya había reembolsado: borraba `refunded` y la fila se
          // reembolsaba DOS veces.
          const { data: pegada } = await db.from('transactions').update({
            raw_data: { ...rd, providerRef: ref, providerRefOrigen: `conciliacion_por_listado: ${m.via}`, providerRefAt: new Date().toISOString() },
          }).eq('id', tx.id).neq('status', 'Rechazado')
            .filter('raw_data->>refunded', 'is', null).filter('raw_data->>providerRef', 'is', null).select('id')
          if (!pegada?.length) { out.push({ id: tx.id, result: 'cambio_en_paralelo' }); continue }
          rd.providerRef = ref
        }
      }

      const st: EstadoMouv = item
        ? (() => { const n = normalizeMouvState(item); return { found: !!n.state, verdict: n.verdict, state: n.state, raw: item, path: '/wallets/transactions' } })()
        : ref ? await mouvTransferStatus(ref, tx.created_at)
        : {
            found: false, verdict: 'unknown', state: '', raw: null,
            diag: {
              // Los datos van DENTRO del motivo a proposito: el panel ya lo
              // imprime, asi que se ven sin esperar a que se redespliegue la
              // web. Un diagnostico que necesita otro despliegue para leerse
              // llega tarde.
              motivo: listado.ok
                ? `sin emparejar · Mouv devolvio ${listado.items.length} salidas Bre-B · la fila tiene monto=${Number(tx.amount ?? 0)} doc=${rd.documentNumber ? 'si' : 'NO'} nombre=${rd.beneficiary ? 'si' : 'NO'} ref=${rd.providerReference ? 'si' : 'NO'}`
                : `no se pudo leer el listado de Mouv: ${listado.diag?.motivo ?? 'sin detalle'}`,
              ...(listado.ok ? {} : { ruta: listado.diag?.ruta, httpStatus: listado.diag?.httpStatus }),
              // Las LLAVES de raw_data, no sus valores: hacen falta para saber
              // donde quedo el id, y los valores traen datos del beneficiario.
              cuerpo: listado.ok
                ? `movimientos Bre-B leidos de Mouv: ${listado.items.length} · source=${String(rd.source ?? '?')} · campos: ${Object.keys(rd).join(', ').slice(0, 220)}`
                : String(listado.diag?.cuerpo ?? ''),
            },
          }
      // Cupo de lectura agotado: se para ACA. Seguir el barrido solo suma 429s,
      // y cada fila que se salte quedaria marcada "sin confirmar" por un limite
      // nuestro, no por algo que dijo el proveedor.
      if ((st as any).limitado) {
        out.push({ id: tx.id, result: 'limite_proveedor' })
        return json(200, { ok: true, checked: (rows ?? []).length, results: out, limiteProveedor: true, message: 'Mouv corto por limite de consultas (100/min). Volve a intentar en un minuto: lo ya conciliado quedo guardado.' })
      }
      // 1) DEVOLUCIÓN confirmada por Mouv → Rechazado + REEMBOLSO (idempotente).
      if (st.found && st.verdict === 'returned') {
        const railCol = String(tx.currency ?? 'COP_BREB')
        // CAS: reclamar el reembolso ANTES de tocar el saldo. Si una ejecución
        // paralela ya reclamó, `claimed` viene vacío y NO se acredita de nuevo.
        // El motivo que da Mouv (`errorMessage` de /wallets/transactions/:id)
        // se guarda: "fue devuelto" sin decir por que obliga a abrir la consola
        // del proveedor para contestarle al cliente lo mas basico.
        if (!(await filaFirmada(tx, 'dispersion'))) { if (!rd.sinFirmaServidor) await aRevisionSinFirma(tx, 'reconcile_breb'); out.push({ id: tx.id, result: 'revision_sin_firma' }); continue }
        const permiso = await reembolsoPermitido(tx, ref, 'reconcile_breb')
        if (!permiso.ok) { out.push({ id: tx.id, result: 'revision_ref_duplicada' }); continue }
        const refund = permiso.refund
        const motivoProveedor = (() => {
          const m = (st.raw as any)?.errorMessage ?? (st.raw as any)?.data?.errorMessage
          return typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : null
        })()
        const { data: claimed } = await db.from('transactions').update({
          status: 'Rechazado',
          raw_data: { ...rd, refunded: true, refundCop: refund, providerState: st.state, providerError: motivoProveedor, returnedAt: new Date().toISOString(), reconciledAt: new Date().toISOString() },
        }).eq('id', tx.id).neq('status', 'Rechazado').filter('raw_data->>refunded', 'is', null).select('id')
        if (!claimed?.length) { out.push({ id: tx.id, result: 'refund_already_claimed' }); continue }
        // El reembolso va al DUEÑO DE LA FILA, no a quien llamó. Con el barrido
        // de todos los clientes, `userId` es el admin que apretó el botón —
        // acreditarle a él la devolución de otro sería mover plata a la cuenta
        // equivocada.
        const duenio = String(tx.user_id)
        const acreditado = await creditBalanceAtomic(duenio, railCol, refund)
        // SI NO SE ACREDITO, SE SUELTA EL CLAIM.
        // El CAS ya marco la fila como reembolsada; dejarla asi con el saldo sin
        // tocar seria perder el reembolso para siempre, porque ninguna corrida
        // posterior vuelve a intentarlo. Se revierte y la proxima lo reintenta.
        if (!acreditado) {
          await db.from('transactions').update({
            status: tx.status,
            raw_data: { ...rd, reembolsoFallido: true, reembolsoFallidoAt: new Date().toISOString(), providerState: st.state },
          }).eq('id', tx.id)
          await logAudit(duenio, 'mouv.reconcile_breb.reembolso_fallido', { txId: tx.id, refund, providerRef: ref })
          out.push({ id: tx.id, result: 'reembolso_fallido', refund })
          continue
        }
        await logAudit(duenio, 'mouv.reconcile_breb.refunded', { txId: tx.id, refund, providerState: st.state, providerError: motivoProveedor, providerRef: ref })
        await notifyTx(tx.id) // correo "tu envío fue devuelto · saldo reintegrado"
        // Y al telefono, que es donde se lee en el momento.
        // El motivo va al teléfono SOLO si es uno que el cliente entiende: el
        // texto crudo de Mouv puede traer jerga en inglés o nombres de aliados.
        const motivoPush = motivoParaCliente(motivoProveedor)
        await avisarCliente(duenio,
          'Tu envío fue devuelto',
          `El envío de ${Number(tx.amount ?? 0).toLocaleString('es-CO')} a ${String((rd as any).beneficiary ?? 'tu beneficiario')} no llegó a destino. `
          + `Ya te reintegramos ${refund.toLocaleString('es-CO')} COP a tu saldo${motivoPush ? `. Motivo: ${motivoPush}` : '.'}`,
          `dev-${tx.id}`)
        out.push({ id: tx.id, result: 'refunded', refund })
        continue
      }
      // 2) ÉXITO confirmado por Mouv → Completado.
      if (st.found && st.verdict === 'completed' && tx.status !== 'Completado') {
        await db.from('transactions').update({
          status: 'Completado',
          raw_data: { ...rd, providerState: st.state, settledAt: new Date().toISOString(), reconciledAt: new Date().toISOString() },
        }).eq('id', tx.id).neq('status', 'Rechazado')
        await notifyTx(tx.id)
        out.push({ id: tx.id, result: 'completed' })
        continue
      }
      // 3) NO se pudo confirmar el estado: Mouv no respondio o devolvio algo
      //    que no se entiende. 'unknown' significa "no se", no "salio bien".
      //
      //    ACA HUBO DOS AUTO-COMPLETADOS, Y LOS DOS MINTIERON.
      //    El primero marcaba Completado a los 2 minutos; el 16 de septiembre
      //    le cobro a un cliente 2.900.000 COP por una dispersion que Mouv
      //    habia RECHAZADO. Se reemplazo por una ventana de 3 horas, con el
      //    argumento de que una devolucion llega antes. El 19 de septiembre la
      //    consola de Mouv mostraba CUATRO envios devueltos del mismo dia que
      //    en Lincoin seguian en "en curso" — y que esa ventana iba a dar por
      //    liquidados esa misma tarde, por 5.609.000 COP que ya estaban de
      //    vuelta en la cuenta y que nadie iba a reembolsar.
      //
      //    La ventana no era una aproximacion razonable: existia unicamente
      //    porque la consulta de estado estaba rota, y tapaba justo el caso que
      //    tenia que detectar. Ahora /wallets/transactions/:id responde de
      //    verdad y cada envio recibe un veredicto real en segundos, asi que se
      //    elimina: no hace falta suponer nada.
      //
      //    Lo que queda sin confirmar se queda en Procesando, que es la verdad,
      //    y se marca para que lo mire una persona. Que algo quede "atascado"
      //    es un problema de operacion; decirle a un cliente que su plata llego
      //    cuando no llego es otra cosa. Si esto se llena de atascadas, el
      //    problema es que Mouv no responde — y eso hay que verlo, no taparlo.
      if (tx.status === 'Procesando') {
        const ageMin = Math.round((Date.now() - new Date(tx.created_at).getTime()) / 60000)

        // Bre-B liquida en segundos. Pasado un rato sin confirmar, deja de ser
        // "en curso" y pasa a ser algo que alguien tiene que mirar contra la
        // consola del proveedor.
        const revisar = ageMin >= 15
        // Aviso al admin UNA sola vez, pasada una hora. Quince minutos es el
        // umbral para marcarla en pantalla; una hora es cuando ya dejo de ser
        // "esta tardando" y hay plata de alguien sin destino conocido.
        // El aviso llega a los 30 minutos: tiene que haber margen para frenar
        // una devolucion antes de que la ventana la de por liquidada.
        if (ageMin >= 30 && !rd.alertaEnviada) {
          const enviado = await avisarAdminSinConfirmar(tx)
          // Misma guarda: este update tambien escribe el snapshot viejo y
          // borraria `refunded` si otra corrida reembolso en el medio.
          if (enviado) await db.from('transactions').update({ raw_data: { ...rd, alertaEnviada: true, alertaAt: new Date().toISOString() } }).eq('id', tx.id).filter('raw_data->>refunded', 'is', null)
        }
        // OJO CON ESTE UPDATE: reescribe raw_data desde el snapshot `rd`, que
        // se leyo al empezar el ciclo. Si mientras tanto OTRA corrida reembolso
        // esta fila, escribir el snapshot viejo BORRA su flag `refunded` -- que
        // es la unica llave de idempotencia del reembolso. La fila quedaria
        // 'Rechazado' pero sin la marca, y el siguiente que apriete Reembolsar
        // acredita por segunda vez.
        //
        // Con `refunded is null` el update simplemente no aplica si ya la
        // reembolsaron. `.eq('status','Procesando')` no alcanzaba: el reembolso
        // deja la fila en 'Rechazado', pero la carrera se resuelve por orden de
        // llegada y el snapshot viejo puede ganar.
        await db.from('transactions').update({
          raw_data: {
            ...rd,
            providerState: st.state || null,
            sinConfirmarDesde: rd.sinConfirmarDesde ?? new Date().toISOString(),
            ultimaRevision: new Date().toISOString(),
            revisionManual: revisar || undefined,
          },
        }).eq('id', tx.id).eq('status', 'Procesando').filter('raw_data->>refunded', 'is', null)
        out.push({
          id: tx.id,
          // "Esperando firma" NO es lo mismo que "procesando": nadie esta
          // moviendo esa plata, esta detenida hasta que una persona firme en
          // el panel del proveedor. A las 24 h expira y se revierte sola.
          result: st.state === 'AWAITING_APPROVAL' ? 'espera_firma'
            : revisar ? 'sin_confirmar_revisar' : 'still_processing',
          minutos: ageMin,
          providerState: st.state || null,
          // El diagnostico solo para la mesa: nombra al proveedor y puede
          // traer detalle de su respuesta.
          ...(caller.admin ? { diag: st.diag ?? null, providerRef: ref || null, campoRef: origenRef || null } : {}),
        })
      } else if (rd.autoCompleted) {
        // Quedó Completado por el auto-completado viejo: NUNCA lo confirmó el
        // proveedor. Se marca para revisión, pero no se revierte sola — puede
        // haber salido de verdad, y un reembolso indebido es igual de malo.
        // Lo resuelve un humano contra la consola, con force_return.
        await db.from('transactions').update({
          raw_data: { ...rd, revisionManual: true, ultimaRevision: new Date().toISOString(), providerState: st.state || null },
        }).eq('id', tx.id).filter('raw_data->>refunded', 'is', null)
        out.push({ id: tx.id, result: 'completado_sin_confirmar', providerState: st.state || null })
      } else {
        out.push({ id: tx.id, result: 'still_completed', ...(caller.admin ? { diag: st.diag ?? null } : {}) })
      }
    }
    return json(200, {
      ok: true, checked: (rows ?? []).length, results: out,
      // El crudo del listado va SOLO a la mesa: si Mouv vuelve a devolver cero
      // movimientos, esto es lo unico que dice por que. Sin el, "0 movimientos"
      // es indistinguible de "no preguntaste bien".
      ...(caller.admin ? { listado: { ok: listado.ok, salidasBreb: listado.items.length, crudo: listado.crudo ?? null, diag: listado.diag ?? null } } : {}),
    })
  }

  // ── SONDEAR UNA DISPERSION CONTRA EL PROVEEDOR ────────────────────
  //
  // Pregunta por UN id y devuelve lo que contesta Mouv, crudo. Nada de
  // listados ni de emparejamiento: la pregunta mas simple que se puede hacer.
  //
  // Existe porque se pasaron horas suponiendo por que un envio seguia "En
  // curso" con Mouv diciendo "Exitoso". Cada hipotesis --la moneda, el id
  // faltante, el filtro-- costo una vuelta entera y ninguna era. Con esto la
  // respuesta esta a un clic, y NO CAMBIA NADA: solo lee y muestra.
  if (action === 'sondear_dispersion') {
    if (!caller.admin || !caller.viaJwt) return json(403, { error: 'forbidden' })
    const txId = payload?.txId ?? payload?.tx_id
    if (txId == null) return json(400, { error: 'missing_tx' })

    const { data: tx } = await db.from('transactions')
      .select('id, user_id, status, type, amount, currency, created_at, raw_data')
      .eq('id', txId).maybeSingle()
    if (!tx) return json(404, { error: 'not_found' })

    const rd = (tx.raw_data ?? {}) as Record<string, any>
    const ref = String(rd.providerRef ?? '').trim()

    // Sin id del proveedor no hay a quien preguntarle, y eso YA es la
    // respuesta: el problema esta en el envio, no en la consulta.
    if (!ref) {
      return json(200, {
        ok: true, txId: tx.id, estadoLincoin: tx.status, providerRef: null,
        conclusion: 'La fila no tiene el id de Mouv guardado. Sin el no se puede consultar por id; la conciliacion depende del listado y del emparejamiento por monto.',
        respuestaEnvio: rd.respuestaEnvio ?? null,
        providerReference: rd.providerReference ?? null,
      })
    }

    const st = await mouvTransferStatus(ref, tx.created_at)
    return json(200, {
      ok: true,
      txId: tx.id,
      estadoLincoin: tx.status,
      providerRef: ref,
      providerReference: rd.providerReference ?? null,
      // Lo que Mouv contesto, tal cual y sin interpretar.
      encontrado: st.found,
      estadoProveedor: st.state || null,
      veredicto: st.verdict,
      rutaQueRespondio: st.path ?? null,
      diag: st.diag ?? null,
      crudo: st.raw ?? null,
      // La diferencia, dicha en una linea.
      conclusion: !st.found
        ? `No se pudo confirmar: ${st.diag?.motivo ?? 'sin motivo'}`
        : st.state && tx.status === 'Procesando' && st.verdict === 'completed'
          ? 'Mouv dice COMPLETED y Lincoin sigue en Procesando: la conciliacion no lo esta aplicando.'
          : `Mouv dice ${st.state}; Lincoin dice ${tx.status}.`,
    })
  }

  // ── CONFIRMAR A MANO UNA DISPERSION ───────────────────────────────
  // La contraparte de force_return. Mientras la consulta de estado no funcione,
  // la unica fuente de verdad es la consola del proveedor, y quien la mira es
  // una persona. Esto le deja cerrar el caso en el sentido bueno.
  //
  // Queda marcado como confirmacion MANUAL y con quien la hizo: un Completado
  // puesto por una persona no es lo mismo que uno confirmado por el proveedor,
  // y dentro de seis meses eso tiene que poder distinguirse.
  if (action === 'confirmar_dispersion') {
    if (!caller.admin || !caller.viaJwt) return json(403, { error: 'forbidden' })
    const txId = payload?.txId ?? payload?.tx_id
    if (txId == null) return json(400, { error: 'missing_tx' })
    const { data: tx } = await db.from('transactions')
      .select('id, user_id, status, type, raw_data').eq('id', txId).maybeSingle()
    if (!tx) return json(404, { error: 'not_found' })
    if (tx.type !== 'dispersion') return json(400, { error: 'not_a_dispersion' })
    const rd = (tx.raw_data ?? {}) as Record<string, any>
    if (rd.refunded) return json(200, { ok: true, already: 'refunded' })
    if (tx.status === 'Completado') return json(200, { ok: true, already: 'Completado' })

    await db.from('transactions').update({
      status: 'Completado',
      raw_data: {
        ...rd,
        settledAt: new Date().toISOString(),
        confirmadaManualmente: true,
        confirmadaPor: caller.userId,
        revisionManual: undefined,
      },
    }).eq('id', tx.id).neq('status', 'Rechazado')
    await logAudit(tx.user_id, 'mouv.confirmar_dispersion', {
      txId: tx.id, admin: caller.userId, providerRef: rd.providerRef ?? null,
    })
    await notifyTx(tx.id)
    return json(200, { ok: true, confirmada: true })
  }

  // ══════════════════════════════════════════════════════════════════
  //  RECAUDO BRE-B POR LLAVE (modo agregador)
  //  ----------------------------------------------------------------
  //  Cada cliente tiene UNA llave Bre-B a su nombre para que le paguen. El
  //  dinero cae en NUESTRO saldo en Mouv, marcado con la llave que lo recibio,
  //  y nosotros se lo acreditamos a su billetera COP_BREB. La misma billetera
  //  donde le acredita la mesa: no hay una segunda cuenta, porque dos saldos
  //  obligarian a mover plata entre ellos a mano y crearian una forma nueva de
  //  tenerla en el lugar equivocado.
  //
  //  LA LLAVE NO SE ELIGE. Mouv la DERIVA del nombre del cliente
  //  ("Panaderia La Espiga" → @PANADERIALAESPIG3456, con los ultimos 4 del
  //  documento como sufijo). No hay picker de @ ni de x.
  //
  //  EL TITULAR REGISTRADO EN LA RED BRE-B ES VECTORA, no el cliente. La llave
  //  lleva su nombre, nada mas. En pantalla se dice "tu llave para recibir
  //  pagos", nunca "tu cuenta bancaria": afirmar lo segundo seria falso.
  //
  //  Requiere modo agregador habilitado (si no, 403 AGGREGATOR_NOT_ENABLED).
  // ══════════════════════════════════════════════════════════════════

  // Los errores de Mouv, dichos en castellano y accionables. "No se pudo" deja
  // al operador sin saber si el problema es el nombre, el permiso o la red.
  const errorLlave = (status: number, d: any): { error: string; message: string; extra?: any } => {
    const cod = String(d?.error ?? '').toUpperCase()
    if (cod === 'AGGREGATOR_NOT_ENABLED' || status === 403 && !cod) {
      return { error: 'agregador_inactivo', message: 'La emisión de llaves de recaudo todavía no está habilitada. Escríbenos a soporte.' }
    }
    if (cod === 'ACCOUNT_NOT_READY') {
      return { error: 'cuenta_no_lista', message: 'La cuenta de recaudo Bre-B todavía no está lista del lado del proveedor.' }
    }
    if (cod === 'NAME_NOT_DERIVABLE') {
      return { error: 'nombre_invalido', message: 'El nombre de la empresa no sirve para derivar una llave: necesita al menos 3 letras o números utilizables.' }
    }
    if (cod === 'KEY_TAKEN') {
      return {
        error: 'nombre_tomado',
        message: 'Ese nombre ya está tomado en la red Bre-B, incluso probando variantes. Hay que cambiarlo un poco y reintentar.',
        extra: { intentadas: d?.attempted ?? null },
      }
    }
    if (cod === 'INSUFFICIENT_SCOPE') return { error: 'sin_permiso', message: 'La llave de API no tiene permiso de escritura.' }
    if (status === 429) return { error: 'limite', message: 'Se alcanzó el límite de creación de llaves. Esperá un minuto y reintentá.' }
    // El texto crudo del proveedor no va al cliente (puede nombrar sistemas
    // internos); queda en el registro de quien llama.
    return { error: 'proveedor', message: 'No se pudo emitir la llave en este momento. Intenta de nuevo en unos minutos.' }
  }

  // ── Emitir (o traer) la llave de recaudo del usuario ──────────────
  if (action === 'breb_llave') {
    const userId = requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Vuelve a iniciar sesión.' })

    // SELECT * a proposito. Pedir `document_number` por nombre reventaba la
    // consulta entera cuando esa columna no existe en esta base: PostgREST
    // devuelve error, `data` viene null, y el codigo lo leia como "el usuario
    // no existe". En pantalla salia un seco "not_found" sobre un usuario que
    // estaba perfectamente ahi.
    const { data: u, error: uErr } = await db.from('users').select('*').eq('id', userId).maybeSingle()
    if (uErr) return json(500, { error: 'no_se_pudo_leer', message: 'No se pudo leer tu cuenta para emitir la llave. Intentá de nuevo.' })
    if (!u) return json(404, { error: 'no_existe', message: 'No encontramos tu cuenta.' })

    const au = u as any
    const rd = (au.raw_data ?? {}) as Record<string, any>
    const guardada = rd.breb ?? null

    // Ya la tiene: NO se vuelve a llamar. Es idempotente del lado de Mouv, pero
    // gastar una llamada por cada vez que alguien abre la pantalla se come el
    // limite de 30/minuto sin necesidad.
    if (!payload?.refrescar && guardada?.valor && guardada?.estado === 'ACTIVE') {
      return json(200, { ok: true, llave: guardada, cuenta: rd.cuentaNo ?? null, deCache: true })
    }

    // `soloLeer` = la pantalla esta preguntando si YA tiene llave. Emitir una
    // por el solo hecho de abrir una pantalla seria crear identidad en la red
    // Bre-B sin que nadie lo haya pedido -- ademas de gastar el cupo de 30 por
    // minuto en usuarios que solo estaban mirando. Emitir es una ACCION.
    if (payload?.soloLeer) {
      return json(200, { ok: false, error: 'sin_llave', cuenta: rd.cuentaNo ?? null })
    }

    // El nombre con el que Mouv DERIVA la llave. Para una cuenta empresa el que
    // corresponde es la razon social, no el nombre de la persona: la llave la
    // va a ver quien le paga.
    const nombre = String(au.company_name ?? au.full_name ?? au.name ?? '').trim()
    if (nombre.replace(/[^A-Za-z0-9]/g, '').length < 3) {
      return json(400, {
        error: 'nombre_invalido',
        message: 'La cuenta necesita un nombre con al menos 3 letras o números para poder emitir la llave.',
      })
    }
    // El NIT vive en distintos lugares segun como se dio de alta la cuenta. Sus
    // ultimos 4 digitos son el sufijo de la llave, asi que vale buscarlo bien:
    // sin el, el sufijo es aleatorio y la llave queda menos reconocible.
    const rdu = (au.raw_data ?? {}) as Record<string, any>
    const doc = String(rdu.nit ?? rdu.documentNumber ?? au.document_number ?? rdu.document ?? '').replace(/\D/g, '')

    const r = await mouvFetch('/breb/collect-keys', {
      method: 'POST',
      body: JSON.stringify({
        // El externalId es NUESTRO id de usuario: es la clave de idempotencia y
        // con el se filtran despues los recaudos de esta persona.
        externalId: String(userId),
        name: nombre.slice(0, 80),
        ...(doc.length >= 4 ? { document: doc.slice(0, 20) } : {}),
      }),
    })
    if (!r.ok) {
      const e = errorLlave(r.status, r.data)
      await logAudit(userId, 'mouv.breb_llave.fallo', { httpStatus: r.status, cod: (r.data as any)?.error ?? null })
      return json(r.status === 403 ? 403 : 502, { ...e, httpStatus: r.status })
    }

    const d: any = r.data ?? {}
    const llave = {
      id: String(d.id ?? ''),
      valor: String(d.key?.value ?? ''),
      tipo: String(d.key?.type ?? ''),
      nombre: String(d.name ?? nombre),
      estado: String(d.state ?? 'ACTIVE'),
      creadaAt: d.createdAt ?? new Date().toISOString(),
    }
    if (!llave.valor) return json(502, { error: 'sin_llave', message: 'El proveedor no devolvió el valor de la llave.' })

    // Numero de cuenta visible, una vez y para siempre. Es una ETIQUETA de la
    // unica cuenta del usuario, no una cuenta aparte: lo que identifica de
    // verdad al cliente para los recaudos es el externalId.
    let cuentaNo = rd.cuentaNo ?? null
    if (!cuentaNo) {
      const { count } = await db.from('users').select('id', { count: 'exact', head: true }).not('raw_data->>cuentaNo', 'is', null)
      cuentaNo = String((Number(count ?? 0) + 1) * 2 + 30).padStart(4, '0')
    }

    await mergeRaw(db, userId, { breb: llave, cuentaNo })
    await logAudit(userId, 'mouv.breb_llave.emitida', { llave: llave.valor, id: llave.id, idempotente: !!d.idempotent })
    return json(200, { ok: true, llave, cuenta: cuentaNo, idempotente: !!d.idempotent })
  }

  // ── QR de cobro de la llave (PNG listo para mostrar o imprimir) ────
  if (action === 'breb_qr') {
    const userId = requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Vuelve a iniciar sesión.' })

    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
    const rd = ((u as any)?.raw_data ?? {}) as Record<string, any>
    const keyId = String(rd.breb?.id ?? '')
    if (!keyId) return json(409, { error: 'sin_llave', message: 'Primero hay que generar la llave de recaudo.' })

    // Un QR vivo por llave: repetir devuelve el mismo (reused: true).
    const q = await mouvFetch(`/breb/collect-keys/${encodeURIComponent(keyId)}/qr`, { method: 'POST' })
    if (!q.ok) {
      const cod = String((q.data as any)?.error ?? '')
      const msg = cod === 'KEY_NOT_ACTIVE' ? 'La llave está suspendida o dada de baja, así que no se le puede emitir un QR.'
        : 'El proveedor no pudo emitir el código QR en este momento.'
      return json(502, { error: 'qr_no_disponible', message: msg })
    }
    const qrId = String((q.data as any)?.qr?.id ?? '')
    if (!qrId) return json(502, { error: 'qr_no_disponible', message: 'El proveedor no devolvió el código QR.' })

    const img = await fetch(`${MOUV_BASE}/breb/collect-keys/qr/${encodeURIComponent(qrId)}.png`, {
      headers: { accept: 'image/png', authorization: `Bearer ${MOUV_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    }).catch(() => null)
    if (!img || !img.ok) return json(502, { error: 'qr_no_disponible', message: 'No se pudo descargar la imagen del QR.' })

    const bytes = new Uint8Array(await img.arrayBuffer())
    return new Response(bytes, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' },
    })
  }

  // ── CONCILIAR LOS RECAUDOS BRE-B ──────────────────────────────────
  // UNA consulta trae los depositos de TODOS los clientes y se reparten por
  // brebKey.externalId. Consultar cliente por cliente serian mil llamadas
  // contra un limite de 100/minuto: imposible con mil clientes, y esta
  // integracion nace pensada para mil.
  //
  // SE ACREDITA EL NETO, NUNCA EL BRUTO.
  //   A nuestro saldo en Mouv entra el neto. Acreditarle el bruto al cliente
  //   nos regalaria la comision en cada recaudo. Y la comision NO se calcula
  //   con un porcentaje escrito aca: viene en cada deposito (feeAmountCents e
  //   ivaAmountCents). Hoy puede ser cero; si manana cobran, los numeros
  //   siguen siendo ciertos sin tocar una linea.
  //
  // SOLO 'ASSIGNED' ES PLATA.
  //   PENDING_CONFIRM no se acredita. Y un deposito puede pasar a REVERSED
  //   DESPUES de acreditado: es el mismo problema de las dispersiones
  //   devueltas, con el signo cambiado, y peor, porque el cliente ya lo pudo
  //   gastar. Por eso se siguen mirando los ya acreditados y, si se reversan,
  //   se debita y se deja constancia.
  if (action === 'breb_conciliar') {
    // Admin con JWT, o llamada interna (cron). Mueve saldo: un uid en el body
    // no alcanza.
    if (!caller.admin || !caller.viaJwt) return json(403, { error: 'forbidden' })

    const paginas = Math.min(Number(payload?.paginas ?? 3) || 3, 10)
    const recaudos: any[] = []
    let diagLista: any = null
    for (let page = 0; page < paginas; page++) {
      const r = await mouvFetch(`/deposits?rail=BREB&limit=100&page=${page}`, { method: 'GET' })
      if (!diagLista) {
        let crudo = ''
        try { crudo = (typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '')).slice(0, 400) } catch { crudo = '(ilegible)' }
        diagLista = { httpStatus: r.status, crudo }
      }
      if (!r.ok) {
        const e = errorLlave(r.status, r.data)
        return json(502, { ...e, diag: diagLista })
      }
      // La forma NO se da por sentada: este endpoint devuelve `deposits`,
      // /wallets/transactions devuelve `items` y collect-keys devuelve `items`
      // con cursor. Tres formas distintas en la misma API.
      const d: any = r.data
      const lote: any[] = Array.isArray(d?.deposits) ? d.deposits
        : Array.isArray(d?.items) ? d.items
        : Array.isArray(d) ? d : []
      recaudos.push(...lote)
      const tp = Number(d?.pagination?.totalPages ?? 0)
      if (lote.length === 0 || (tp && page + 1 >= tp)) break
    }

    const out: any[] = []
    let acreditados = 0, reversados = 0, montoAcreditado = 0
    const cent = (v: any) => Math.round(Number(v ?? 0)) / 100

    for (const dep of recaudos) {
      const depId = String(dep?.id ?? '')
      const ext = String(dep?.brebKey?.externalId ?? '')
      // Sin llave no es un recaudo por llave (puede ser PSE): no es nuestro.
      if (!depId || !ext) continue

      const estado = String(dep?.status ?? '').toUpperCase()
      const bruto = cent(dep?.amountCents)
      const comision = cent(dep?.feeAmountCents) + cent(dep?.ivaAmountCents)
      const neto = dep?.netAmountCents != null ? cent(dep.netAmountCents) : bruto - comision
      if (!(neto > 0)) continue

      const { data: usuario } = await db.from('users').select('id').eq('id', ext).maybeSingle()
      if (!usuario) { out.push({ dep: depId, result: 'usuario_desconocido', externalId: ext }); continue }

      // Idempotencia por el id del deposito: es la unica forma de no acreditar
      // dos veces el mismo pago cuando el polling lo ve otra vez.
      const { data: yaHay } = await db.from('transactions')
        .select('id, status, raw_data').eq('type', 'load')
        .filter('raw_data->>depositId', 'eq', depId).limit(1)
      const fila = yaHay?.[0] ?? null

      if (estado === 'ASSIGNED') {
        if (fila) {
          // Ya estaba: si habia sido reversada y vuelve a ASSIGNED, no se
          // re-acredita sola. Eso lo mira una persona.
          out.push({ dep: depId, result: (fila as any).status === 'Devuelto' ? 'revivio_revisar' : 'ya_acreditado' })
          continue
        }
        const { data: creada, error: insErr } = await db.from('transactions').insert({
          user_id: ext, type: 'load', amount: neto, currency: 'COP_BREB', status: 'Completado',
          raw_data: {
            source: 'mouv_breb_recaudo', title: 'Recaudo Bre-B',
            depositId: depId, brutoCop: bruto, comisionCop: comision, netoCop: neto,
            llave: dep?.brebKey?.value ?? null, llaveId: dep?.brebKey?.id ?? null,
            // Quien pago: es lo que convierte un ingreso en un cobro
            // identificable. Sin esto el cliente ve plata y no sabe de quien.
            pagador: dep?.payerName ?? null,
            pagadorDocumento: dep?.payerDocument ?? null,
            pagadorBanco: dep?.payerBank ?? null,
            providerTransferId: dep?.providerTransferId ?? null,
            confirmadoAt: dep?.providerConfirmedAt ?? null,
            acreditadoAt: new Date().toISOString(),
          },
        }).select('id').maybeSingle()
        // Si la fila no se pudo escribir NO se acredita: sin movimiento, el
        // saldo sube y no hay como explicar de donde salio.
        if (insErr || !creada) { out.push({ dep: depId, result: 'no_se_registro', error: insErr?.message ?? null }); continue }

        // El crédito puede NO entrar (ajuste rechazado o incierto). Antes la
        // fila quedaba Completado igual y el cliente perdía el depósito en
        // silencio: ahora queda marcada para revisión, con el motivo.
        if (!(await creditBalanceAtomic(ext, 'COP_BREB', neto))) {
          await db.from('transactions').update({ status: 'Pendiente', raw_data: { source: 'mouv_breb_recaudo', title: 'Recaudo Bre-B', depositId: depId, brutoCop: bruto, comisionCop: comision, netoCop: neto, revisarCredito: true, acreditadoAt: null } }).eq('id', (creada as any).id)
          await logAudit(ext, 'mouv.breb_recaudo.credito_fallido', { depId, neto })
          out.push({ dep: depId, result: 'credito_fallido_revisar', neto })
          continue
        }
        await logAudit(ext, 'mouv.breb_recaudo.acreditado', { depId, neto, bruto, comision, llave: dep?.brebKey?.value ?? null })
        acreditados++; montoAcreditado += neto
        out.push({ dep: depId, result: 'acreditado', neto })
        continue
      }

      if (estado === 'REVERSED') {
        if (!fila) { out.push({ dep: depId, result: 'reversado_nunca_acreditado' }); continue }
        const frd = ((fila as any).raw_data ?? {}) as Record<string, any>
        if (frd.reversado) { out.push({ dep: depId, result: 'ya_reversado' }); continue }

        // CAS antes de tocar el saldo, igual que en los reembolsos.
        const { data: claimed } = await db.from('transactions').update({
          status: 'Devuelto',
          raw_data: { ...frd, reversado: true, reversadoAt: new Date().toISOString() },
        }).eq('id', (fila as any).id).filter('raw_data->>reversado', 'is', null).select('id')
        if (!claimed?.length) { out.push({ dep: depId, result: 'reverso_ya_reclamado' }); continue }

        const montoFila = Number(frd.netoCop ?? (fila as any).amount ?? 0)
        const { data: saldoU } = await db.from('users').select('balances').eq('id', ext).maybeSingle()
        const disponible = Number(((saldoU as any)?.balances ?? {})['COP_BREB'] ?? 0)

        if (disponible >= montoFila && await creditBalanceAtomic(ext, 'COP_BREB', -montoFila)) {
          out.push({ dep: depId, result: 'reversado', monto: montoFila })
        } else {
          // NO se deja el saldo en negativo ni se ignora el faltante: se debita
          // lo que hay y el resto queda asentado como deuda para que alguien lo
          // cobre. Un reverso que no se puede cubrir es un problema real, y
          // callarlo no lo hace desaparecer.
          // Si el débito no entra, TODO queda como deuda (no se asume cobrado).
          const cobrado = disponible > 0 && disponible < montoFila && await creditBalanceAtomic(ext, 'COP_BREB', -disponible) ? disponible : 0
          const deuda = Number((montoFila - cobrado).toFixed(2))
          await db.from('transactions').update({
            raw_data: { ...frd, reversado: true, reversadoAt: new Date().toISOString(), deudaCop: deuda, debitadoCop: cobrado },
          }).eq('id', (fila as any).id)
          await logAudit(ext, 'mouv.breb_recaudo.reverso_sin_fondos', { depId, montoFila, debitado: cobrado, deuda })
          out.push({ dep: depId, result: 'reversado_con_deuda', debitado: cobrado, deuda })
        }
        await logAudit(ext, 'mouv.breb_recaudo.reversado', { depId, montoFila })
        reversados++
        continue
      }

      // PENDING_CONFIRM / UNASSIGNED / EXPIRED: no son plata todavia (o ya no
      // lo son). Se informan, no se acreditan.
      out.push({ dep: depId, result: 'sin_acreditar', estado })
    }

    return json(200, {
      ok: true, revisados: recaudos.length,
      acreditados, reversados, montoAcreditado,
      resultados: out.slice(0, 200),
      ...(caller.admin ? { diag: diagLista } : {}),
    })
  }

  // ── MARCAR UNA DISPERSION COMO YA REEMBOLSADA POR FUERA ───────────
  // Para cuando el operador ya le devolvio el saldo al cliente A MANO, sin
  // pasar por force_return. La fila queda en Procesando y SIN la marca
  // `refunded`, asi que el dia que la conciliacion lea el estado real y vea que
  // fue devuelta, va a reembolsar OTRA VEZ. El cliente cobraria dos veces por
  // un envio que nunca salio.
  //
  // Esto cierra ese hueco: marca la fila como devuelta y reembolsada, y NO
  // TOCA NINGUN SALDO -- la plata ya la movio una persona. Acreditar aca seria
  // cometer exactamente el error que esto viene a evitar.
  if (action === 'marcar_reembolso_externo') {
    if (!caller.admin || !caller.viaJwt) return json(403, { error: 'forbidden' })
    const txId = payload?.txId ?? payload?.tx_id
    if (txId == null) return json(400, { error: 'missing_tx' })
    const motivo = String(payload?.reason ?? '').trim().slice(0, 300)
    if (!motivo) return json(400, { error: 'missing_reason', message: 'Hay que decir por que se dio por reembolsada.' })

    const { data: tx } = await db.from('transactions')
      .select('id, user_id, amount, currency, status, type, raw_data').eq('id', txId).maybeSingle()
    if (!tx) return json(404, { error: 'not_found' })
    if (tx.type !== 'dispersion') return json(400, { error: 'not_a_dispersion' })
    if (tx.status === 'Completado') {
      return json(409, { error: 'esta_completada', message: 'Esa dispersión figura como pagada. Si se devolvió, usá Reembolsar.' })
    }

    const rd = (tx.raw_data ?? {}) as Record<string, any>
    if (rd.refunded) return json(200, { ok: true, already: 'refunded' })

    // Mismo CAS que force_return: si otra ejecucion ya la reclamo, no se pisa.
    const { data: claimed } = await db.from('transactions').update({
      status: 'Rechazado',
      raw_data: {
        ...rd,
        refunded: true,
        // CERO a proposito: el sistema no acredito nada. Poner el monto aca
        // haria parecer que esta app movio una plata que movio una persona.
        refundCop: 0,
        reembolsoExterno: true,
        returnedAt: new Date().toISOString(),
        returnedBy: caller.userId,
        returnReason: motivo,
      },
    }).eq('id', tx.id).filter('raw_data->>refunded', 'is', null).select('id')
    if (!claimed?.length) return json(200, { ok: true, already: 'refund_already_claimed' })

    await logAudit(tx.user_id, 'mouv.reembolso_externo', {
      txId: tx.id, amount: tx.amount, rail: tx.currency, reason: motivo,
      admin: caller.userId, providerRef: rd.providerRef ?? null,
      nota: 'saldo devuelto por fuera del sistema; no se acredito nada aca',
    })
    return json(200, { ok: true, marcada: true })
  }

  // ── VINCULAR A MANO UNA DISPERSION CON SU ID EN MOUV ──────────────
  // Mientras el listado no se pueda leer, la unica fuente de verdad es la
  // consola del proveedor, y el operador la tiene delante: ahi esta el id
  // (TX-PG-483AC9). Pegarlo cuesta cinco segundos y desbloquea TODO lo demas
  // para esa fila -- consulta de estado, conciliacion y comprobante PDF.
  //
  // NO cambia el estado ni mueve plata: solo guarda el id. Confirmar o devolver
  // sigue siendo una decision aparte, para que pegar un id equivocado no
  // acredite ni reembolse nada por si solo.
  if (action === 'vincular_referencia') {
    if (!caller.admin || !caller.viaJwt) return json(403, { error: 'forbidden' })
    const txId = payload?.txId ?? payload?.tx_id
    const ref = String(payload?.providerRef ?? '').trim()
    if (txId == null) return json(400, { error: 'missing_tx' })
    if (ref.length < 4) return json(400, { error: 'ref_invalida', message: 'Pegá el ID tal como aparece en la consola del proveedor.' })

    const { data: tx } = await db.from('transactions')
      .select('id, user_id, type, raw_data').eq('id', txId).maybeSingle()
    if (!tx) return json(404, { error: 'not_found' })
    if (tx.type !== 'dispersion') return json(400, { error: 'not_a_dispersion' })

    // Un mismo id no puede quedar pegado a dos dispersiones: seria decir que
    // dos envios distintos son el mismo, y a partir de ahi cualquier
    // conciliacion posterior saca la conclusion equivocada.
    const { data: yaUsada } = await db.from('transactions')
      .select('id').eq('type', 'dispersion').filter('raw_data->>providerRef', 'eq', ref).neq('id', tx.id).limit(1)
    if (yaUsada?.length) {
      return json(409, { error: 'ref_duplicada', message: `Ese ID ya está vinculado al movimiento ${yaUsada[0].id}.` })
    }

    const rd = (tx.raw_data ?? {}) as Record<string, any>
    const { error } = await db.from('transactions').update({
      raw_data: { ...rd, providerRef: ref, providerRefOrigen: 'pegado_a_mano', providerRefAt: new Date().toISOString(), providerRefPor: caller.userId ?? null },
    }).eq('id', tx.id)
    if (error) return json(500, { error: 'no_se_pudo_guardar', message: error.message })

    await logAudit(tx.user_id, 'mouv.vincular_referencia', { txId: tx.id, providerRef: ref, admin: caller.userId })

    // Con el id ya guardado se consulta el estado en el acto: es justo lo que
    // faltaba para poder decidir.
    const st = await mouvTransferStatus(ref)
    return json(200, {
      ok: true, providerRef: ref,
      estadoProveedor: st.found ? st.state : null,
      veredicto: st.found ? st.verdict : 'unknown',
      diag: st.diag ?? null,
    })
  }

  // ── COMPROBANTE OFICIAL DEL PROVEEDOR (PDF) ───────────────────────
  // GET /wallets/transactions/:id/receipt.pdf  (scope READ)
  //
  // El comprobante que damos hoy lo dibujamos nosotros. Este lo firma el
  // proveedor: es el que sirve como evidencia fiscal y el que se le manda al
  // beneficiario cuando dice que no le llego.
  //
  // PASA POR ACA Y NO POR EL NAVEGADOR: el PDF se pide con la llave mvk_, que
  // no puede tocar el cliente. Ademas asi se comprueba que la transaccion sea
  // SUYA -- sin eso, cambiando un id cualquiera se bajaria el comprobante de
  // otro, con el nombre y el documento del beneficiario adentro.
  if (action === 'comprobante_proveedor') {
    const userId = requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Vuelve a iniciar sesión.' })

    const txId = payload?.txId ?? payload?.tx_id
    if (txId == null) return json(400, { error: 'missing_tx' })

    const { data: tx } = await db.from('transactions')
      .select('id, user_id, type, raw_data').eq('id', txId).maybeSingle()
    // Un cierre ajeno no se confirma que exista: mismo criterio que el resto.
    if (!tx || (!caller.admin && String(tx.user_id) !== String(userId))) {
      return json(404, { error: 'not_found' })
    }

    const rd = (tx.raw_data ?? {}) as Record<string, any>
    const ref = String(rd.providerRef ?? '').trim()
    if (!ref) {
      return json(409, {
        error: 'sin_referencia',
        message: 'Este envío no tiene guardada la referencia del proveedor, así que no se puede pedir su comprobante.',
      })
    }

    const r = await fetch(`${MOUV_BASE}/wallets/transactions/${encodeURIComponent(ref)}/receipt.pdf`, {
      headers: { accept: 'application/pdf', authorization: `Bearer ${MOUV_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    }).catch((e) => ({ ok: false, status: 0, _err: String((e as Error)?.message ?? e) } as any))

    if (!r.ok) {
      // El motivo se dice en castellano: "no se pudo" manda a buscar a ciegas.
      const motivo = r.status === 404 ? 'El proveedor todavía no tiene el comprobante de este envío.'
        : r.status === 401 || r.status === 403 ? 'No tenemos permiso para descargar este comprobante.'
        : r.status === 429 ? 'Demasiadas descargas seguidas. Probá en un minuto.'
        : 'El proveedor no devolvió el comprobante en este momento.'
      return json(502, { error: 'comprobante_no_disponible', message: motivo, httpStatus: r.status })
    }

    const bytes = new Uint8Array(await (r as Response).arrayBuffer())
    // Se devuelve el PDF tal cual. Va como descarga, con un nombre que se
    // entiende seis meses despues sin abrirlo.
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="comprobante-${ref}.pdf"`,
      },
    })
  }

  // ── SONDEO DE ENDPOINTS DEL PROVEEDOR (admin) ─────────────────────
  // Esto existio porque no sabiamos como se consultaba el estado de una
  // transferencia y mouvTransferStatus adivinaba entre seis rutas que daban
  // 404. YA SE SABE: es GET /wallets/transactions/:id, esta documentada y es
  // la primera que prueba mouvTransferStatus.
  //
  // El sondeo se queda igual, como diagnostico: si algun dia la conciliacion
  // vuelve a dejar todo en 'Procesando', esto dice si la ruta oficial cambio y
  // cual responde ahora, con el cuerpo crudo a la vista.
  //
  // Esto prueba rutas candidatas -- por id y de LISTADO, que es lo que la
  // consola del proveedor usa para mostrar los estados -- y devuelve el cuerpo
  // CRUDO de cada una. Con eso se fija la ruta correcta con el dato a la vista,
  // en vez de seguir adivinando. Es el mismo remedio que el diagnostico de KYT.
  if (action === 'probe_status') {
    if (!caller.admin || !caller.viaJwt) return json(403, { error: 'forbidden' })
    const ref = String(payload?.providerRef ?? payload?.ref ?? '').trim()
    const enc = encodeURIComponent(ref)

    const candidatas: { que: string; ruta: string; metodo: 'GET' }[] = [
      ...(ref ? [
        { que: 'por id (LA OFICIAL)', ruta: `/wallets/transactions/${enc}`, metodo: 'GET' as const },
        { que: 'por id', ruta: `/transfers/${enc}`, metodo: 'GET' as const },
        { que: 'por id', ruta: `/transfers/${enc}/status`, metodo: 'GET' as const },
        { que: 'por id', ruta: `/transfers/status/${enc}`, metodo: 'GET' as const },
        { que: 'por id', ruta: `/transactions/${enc}`, metodo: 'GET' as const },
        { que: 'por id', ruta: `/payments/${enc}`, metodo: 'GET' as const },
        { que: 'por referencia', ruta: `/transfers?reference=${enc}`, metodo: 'GET' as const },
      ] : []),
      // LISTADOS: lo mas probable que exista, porque es lo que alimenta la
      // consola. Si alguna responde, se puede conciliar por lote y dejamos de
      // depender de una consulta por id.
      { que: 'listado (LA OFICIAL)', ruta: '/wallets/transactions?limit=20', metodo: 'GET' },
      { que: 'listado', ruta: '/transfers', metodo: 'GET' },
      { que: 'listado', ruta: '/transfers?limit=20', metodo: 'GET' },
      { que: 'listado', ruta: '/transactions?limit=20', metodo: 'GET' },
      { que: 'listado', ruta: '/payments?limit=20', metodo: 'GET' },
      { que: 'listado', ruta: '/transfers/history?limit=20', metodo: 'GET' },
      { que: 'listado', ruta: '/movements?limit=20', metodo: 'GET' },
    ]

    const out: any[] = []
    for (const cand of candidatas) {
      const r = await mouvFetch(cand.ruta, { method: cand.metodo })
      let crudo = ''
      try { crudo = typeof r.data === 'string' ? r.data : JSON.stringify(r.data) } catch { crudo = '(ilegible)' }
      // Interesa sobre todo si el cuerpo MENCIONA la referencia buscada y si
      // trae algo que se parezca a un estado.
      const mencionaRef = !!ref && crudo.includes(ref)
      const pareceEstado = /"(status|state|estado)"\s*:/i.test(crudo)
      out.push({
        ruta: cand.ruta, tipo: cand.que,
        httpStatus: r.status, ok: r.ok,
        mencionaLaReferencia: mencionaRef,
        traeAlgoParecidoAEstado: pareceEstado,
        crudo: crudo.slice(0, 1200),
      })
    }
    // Primero lo que respondio: es lo unico que sirve mirar.
    out.sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0))
    return json(200, { ok: true, referencia: ref || null, candidatas: out })
  }

  // ── DEVOLUCIÓN MANUAL DE UNA DISPERSIÓN ───────────────────────────
  // Para cuando el proveedor RECHAZÓ un envío y acá quedó Completado. Pasa
  // cuando el estado no se puede consultar (la ruta de Mouv está adivinada) y
  // el rechazo solo se ve en su consola: ahí no hay automatismo posible, lo
  // tiene que decir una persona que miró las dos pantallas.
  //
  // Hace lo mismo que la rama de devolución confirmada: marca Rechazado y
  // reintegra monto + comisión al riel. Idempotente por el mismo flag y el
  // mismo CAS, así que dos clics no reembolsan dos veces.
  //
  // SOLO ADMIN CON JWT. Reintegra saldo: un uid en el body no alcanza.
  if (action === 'force_return') {
    if (!caller.admin || !caller.viaJwt) return json(403, { error: 'forbidden' })
    const txId = payload?.txId ?? payload?.tx_id
    if (txId == null) return json(400, { error: 'missing_tx' })

    const { data: tx } = await db.from('transactions')
      .select('id, user_id, amount, currency, status, type, raw_data')
      .eq('id', txId).maybeSingle()
    if (!tx) return json(404, { error: 'not_found' })
    if (tx.type !== 'dispersion') return json(400, { error: 'not_a_dispersion', type: tx.type })

    const rd = (tx.raw_data ?? {}) as Record<string, any>
    if (rd.refunded) return json(200, { ok: true, already: 'refunded', refundCop: rd.refundCop ?? null })

    // La comisión de la fila con el mismo tope que el resto de reembolsos: una
    // fila con feeCop inflado no devuelve más de lo que se cobró de verdad.
    const feeMaxFR = Math.max(ACH_FEE_COP, BREB2_FEE_COP, BREB_FEE_COP, brebFeeCop(Number(tx.amount ?? 0)))
    const refund = Number(tx.amount ?? 0) + Math.min(Math.max(0, Number(rd.feeCop ?? 0) || 0), feeMaxFR)
    if (!(refund > 0)) return json(400, { error: 'bad_amount', refund })
    const railCol = String(tx.currency ?? 'COP_BREB')
    const motivo = String(payload?.reason ?? '').trim().slice(0, 300)
    if (!motivo) return json(400, { error: 'missing_reason', message: 'Hay que decir por qué se devuelve.' })

    // CAS: se reclama el reembolso ANTES de tocar el saldo. Si otra ejecución
    // ya lo reclamó, `claimed` viene vacío y no se acredita de nuevo.
    const { data: claimed } = await db.from('transactions').update({
      status: 'Rechazado',
      raw_data: {
        ...rd,
        refunded: true,
        refundCop: refund,
        returnedAt: new Date().toISOString(),
        returnedBy: caller.userId,
        returnReason: motivo,
        manualReturn: true,
      },
    }).eq('id', tx.id).filter('raw_data->>refunded', 'is', null).select('id')
    if (!claimed?.length) return json(200, { ok: true, already: 'refund_already_claimed' })

    const acreditadoFR = await creditBalanceAtomic(tx.user_id, railCol, refund)
    if (!acreditadoFR) {
      // Se suelta el claim: si quedara marcada sin acreditar, el boton no se
      // podria volver a usar y el cliente perderia el reembolso.
      await db.from('transactions').update({
        status: tx.status,
        raw_data: { ...rd, reembolsoFallido: true, reembolsoFallidoAt: new Date().toISOString() },
      }).eq('id', tx.id)
      await logAudit(tx.user_id, 'mouv.force_return.reembolso_fallido', { txId: tx.id, refund, admin: caller.userId })
      return json(500, {
        error: 'no_se_acredito',
        message: 'No se pudo acreditar el reembolso, así que la dispersión quedó como estaba. Volvé a intentarlo en un momento.',
      })
    }
    await logAudit(tx.user_id, 'mouv.force_return', {
      txId: tx.id, refund, rail: railCol, reason: motivo,
      admin: caller.userId, providerRef: rd.providerRef ?? null,
      eraAutoCompletada: rd.autoCompleted === true,
    })
    await notifyTx(tx.id)
    return json(200, { ok: true, refunded: true, refundCop: refund, rail: railCol })
  }

  // ── RECAUDO PSE (pay-in por link) ─────────────────────────────────
  // Mouv permite recaudo entrante por PSE devolviendo un LINK que el
  // cliente comparte con quien le paga. Cuando el pago se confirma, Mouv
  // notifica (webhook) o se consulta el estado, y ahí se acredita el COP.
  //
  // ⚠️ La ruta/campos EXACTOS del recaudo PSE están en la doc de Mouv
  // (developer.mouvlatam.com), bloqueada para este backend. Se prueban
  // rutas candidatas y varias formas de body; la respuesta CRUDA vuelve
  // al admin para fijar la ruta correcta (igual que se hizo con Finity).
  if (action === 'payin_pse' || action === 'payin_status') {
    // IDENTIDAD PROBADA. Antes bastaba la llave pública + el id de cualquier
    // usuario: se podían crear recaudos a nombre ajeno y, sobre todo,
    // consultar el estado de CUALQUIER referencia —montos y datos de cobros
    // de otros—. Además 'payin_pse' prueba treinta rutas contra Mouv en cada
    // llamada, así que dejarlo abierto era regalar un amplificador.
    if (!(caller.viaJwt || caller.admin)) {
      return json(403, { error: 'forbidden', message: 'Esta operación requiere una sesión válida.' })
    }
    const userId = caller.userId ?? payload.userId ?? payload.user_id
    if (!userId) return json(400, { error: 'missing_user', message: 'Falta el usuario.' })

    if (action === 'payin_status') {
      const ref = String(payload.reference ?? payload.id ?? '')
      if (!ref) return json(400, { error: 'missing_ref' })
      // Solo letras, números, guion y guion bajo: la referencia va dentro de
      // un filtro .or() y en la ruta del proveedor. Con comas o puntos se
      // podía agregar condiciones al filtro, y con "../" apuntar el GET a
      // otras rutas del proveedor (saldo de tesorería, envíos de otros).
      if (!/^[A-Za-z0-9_-]{4,100}$/.test(ref)) return json(400, { error: 'bad_ref', message: 'Referencia no válida.' })
      // Y que la referencia sea SUYA. Tener sesión no da derecho a mirar el
      // cobro de otro con solo cambiar el número.
      if (!caller.admin) {
        const { data: mio } = await db.from('transactions').select('id')
          .eq('user_id', String(userId))
          .or(`raw_data->>reference.eq.${ref},raw_data->>providerRef.eq.${ref}`)
          .limit(1)
        if (!mio?.length) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      }
      const r0 = encodeURIComponent(ref)
      const paths = [`/collections/${r0}`, `/payin/${r0}`, `/pse/${r0}`, `/transfers/collect/${r0}`, `/collections/status/${r0}`]
      for (const p of paths) {
        const r = await mouvFetch(p, { method: 'GET' })
        if (r.ok) return json(200, { ok: true, path: p, data: r.data })
        if (r.status && r.status !== 404) return json(200, { ok: false, path: p, status: r.status, data: r.data })
      }
      return json(200, { ok: false, error: 'not_found', message: 'No se encontró el recaudo (rutas candidatas 404).' })
    }

    const amount = Number(payload.amount)
    if (!isFinite(amount) || amount < 5000) return json(400, { error: 'bad_amount', message: 'El monto mínimo de recaudo es $5.000 COP.' })
    const railCol = 'COP' // el recaudo entra al Saldo Lincoin
    // Cuerpo tentativo: monto en centavos (como el resto de Mouv), método PSE,
    // referencia única y datos de quien recibe (el usuario Lincoin).
    const reference = `LINCOIN-${String(userId).slice(0, 8)}-${Date.now().toString(36).slice(-5)}`.toUpperCase()
    const bodyBase: Record<string, unknown> = {
      amount: Math.round(amount * 100), amountCop: Math.round(amount),
      currency: 'COP', method: 'PSE', rail: 'PSE', type: 'collection',
      reference, description: String(payload.concept ?? 'Recarga Lincoin'),
      callbackUrl: `${SUPABASE_URL}/functions/v1/mouv-proxy`,
    }
    // Lista AMPLIA de rutas candidatas (Mouv usa /api sin versión, estilo
    // /transfers/send). Se prueba POST en cada una. Un 404 = ruta inexistente;
    // cualquier OTRO código (400/401/405/422…) significa que la RUTA EXISTE
    // pero falta ajustar método/body/auth → se reporta como pista fuerte.
    const paths = [
      '/collections', '/collections/create', '/collection', '/collect',
      '/payin', '/payin/pse', '/payins', '/pay-in', '/pse', '/pse/create', '/pse/collect', '/pse/payment',
      '/recaudo', '/recaudos', '/charges', '/charge',
      '/payment-links', '/payment_links', '/paymentlinks', '/links', '/link', '/checkout',
      '/transfers/collect', '/transfers/receive', '/transfers/payin', '/transfers/pse', '/transfers/collect-pse',
      '/wallets/collect', '/wallets/payin', '/payments/collect', '/payments/pse', '/payments',
    ]
    const tried: { path: string; status: number }[] = []
    const exists: { path: string; status: number; data: any }[] = []
    for (const p of paths) {
      const r = await mouvFetch(p, { method: 'POST', body: JSON.stringify(bodyBase) })
      tried.push({ path: p, status: r.status })
      if (r.ok) {
        const d: any = r.data ?? {}
        const link = d.url ?? d.link ?? d.paymentUrl ?? d.checkoutUrl ?? d.redirectUrl ?? d.data?.url ?? null
        const providerRef = d.id ?? d.reference ?? d.collectionId ?? reference
        try {
          await db.from('transactions').insert({
            user_id: userId, type: 'load', amount: Math.round(amount), currency: railCol, status: 'Pendiente',
            raw_data: { source: 'mouv_payin_pse', method: 'PSE', reference, providerRef, link, title: 'Recaudo PSE (link)', createdAt: new Date().toISOString(), firmaServidor: await firmaFila(userId, 'load', Math.round(amount), railCol) },
          })
        } catch { /* best-effort */ }
        await logAudit(userId, 'mouv.payin_pse.created', { amount, reference, providerRef, path: p })
        return json(200, { ok: true, link, reference, providerRef, path: p, raw: d })
      }
      // 404 = ruta no existe. Cualquier otro código = la ruta EXISTE.
      if (r.status && r.status !== 404 && r.status !== 0) exists.push({ path: p, status: r.status, data: r.data })
    }
    await logAudit(userId, 'mouv.payin_pse.discover', { exists, tried })
    if (exists.length > 0) {
      return json(200, { ok: false, error: 'route_found_needs_fields',
        message: `Encontré la ruta de recaudo (${exists[0].path}) pero falta ajustar el cuerpo. Detalle: ${JSON.stringify(exists[0].data).slice(0, 200)}`,
        candidates: exists })
    }
    return json(200, { ok: false, error: 'payin_not_supported',
      // El detalle técnico queda en `tried`, para el equipo. El mensaje que
      // lee el cliente no nombra al proveedor ni le cuenta cuántas rutas se
      // probaron: eso no le sirve y revela con quién operamos.
      message: 'El recaudo por PSE no está disponible en este momento. Intenta más tarde o comunícate con soporte.',
      tried })
  }

  // ── Cotización de comisión para el paso Confirmar del cliente ──
  // BREB → comisión FIJA Lincoin ($1.200 por envío; el costo Mouv lo
  //        absorbe Lincoin — al cliente ya se le cobró 0,10% al recibir
  //        el cargue). No depende de cotizar a Mouv en vivo.
  // ACH → precio fijo por transferencia (Finity), ACH_FEE_COP.
  if (action === 'payout_quote') {
    const amount = Number(payload.amount)
    if (!isFinite(amount) || amount <= 0) return json(400, { error: 'bad_amount' })
    const rail = String(payload.rail ?? 'BREB').toUpperCase()
    if (rail === 'BREB2') {
      return json(200, { ok: true, rail: 'BREB2', provider: 'lincoin', feeCop: BREB2_FEE_COP, fixedCop: BREB2_FEE_COP, variableCop: 0, ivaCop: 0, totalCop: amount + BREB2_FEE_COP })
    }
    if (rail === 'BREB') {
      const fee = brebFeeCop(amount)
      return json(200, { ok: true, rail: 'BREB', provider: 'lincoin', feeCop: fee, fixedCop: fee, variableCop: 0, ivaCop: 0, totalCop: amount + fee })
    }
    // ACH: comisión FIJA única ($2.500) — SIN componente variable.
    return json(200, { ok: true, rail: 'ACH', feeCop: ACH_FEE_COP, fixedCop: ACH_FEE_COP, variableCop: 0, ivaCop: 0, totalCop: amount + ACH_FEE_COP })
  }

  // ── dispersión BREB (Mouv) / ACH (Finity) ──
  // El cliente dispersa contra su SALDO INTERNO del riel (COP_BREB / COP_ACH).
  // La COMISIÓN al cliente:
  //   BREB → $1.200 fijos por envío (BREB_FEE_COP); se debita monto + 1.200.
  //   ACH  → precio fijo Finity (ACH_FEE_COP); se debita monto + tarifa.
  // Si el proveedor falla, se REINTEGRA todo lo debitado.
  if (action === 'payout_breb' || action === 'payout_breb2' || action === 'payout_ach') {
    const rail: 'BREB' | 'ACH' = action === 'payout_ach' ? 'ACH' : 'BREB'
    // Bre-B tiene DOS cuentas. La 1 sale por Mouv con el saldo Bre-B; la 2 sale
    // por Finity con el saldo ACH, porque Finity usa una sola bolsa para los dos
    // rieles. Todo lo demás —inscripción, AML, titular de la llave, motivo,
    // topes— es el mismo proceso.
    const brebFinity = action === 'payout_breb2'
    const railCol = rail === 'BREB' && !brebFinity ? 'COP_BREB' : 'COP_ACH'
    const saldoLabel = railCol === 'COP_BREB' ? 'Bre-B' : 'ACH'
    // Los nombres que conocemos del beneficiario. Con la Cuenta 2 se comparan
    // con el titular que devuelve Finity antes de confirmar el envío.
    const nombresTitular: string[] = []
    // Persona o empresa QUIEN RECIBE (del beneficiario inscrito; si no se
    // encuentra, del tipo de documento que llega). Define el tope ACH.
    let tipoBeneficiario: 'empresa' | 'persona' | null = null
    // Para el cupo mensual: el documento del beneficiario (el inscrito, o el
    // de la llave), su nombre y TODOS sus destinos inscritos (llave Bre-B y
    // cuentas ACH del mismo documento suman juntos).
    let benefDocCupo = ''
    let benefNombreCupo = ''
    let benefDestinosCupo: string[] = []
    // SEGURIDAD: mover dinero exige identidad PROBADA con JWT real (o admin).
    // Un simple user_id en el body ya NO autoriza un payout — así nadie drena
    // la cuenta de otro con solo la llave pública + el id de la víctima.
    const userId = requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Esta operación requiere una sesión válida. Vuelve a iniciar sesión.' })

    // ── Seguridad de la cuenta: bloqueo y 2FA ────────────────────────────────
    // Se leen SOLO las claves que hacen falta, no el raw_data entero: en una
    // cuenta con cientos de beneficiarios ese blob pesa cientos de KB, y con
    // la base cargada la lectura completa se cortaba por timeout.
    //
    // Y si la lectura falla, NO se sigue: antes, una lectura caída dejaba la
    // cuenta "sin 2FA y sin bloqueo" y el envío pasaba sin verificar el
    // código. Ahora se reintenta una vez y, si sigue sin poder leerse, el
    // envío espera (503) — nunca sale plata sin haber mirado la cuenta.
    const leerSeguridad = async () => {
      for (let intento = 0; intento < 2; intento++) {
        const { data, error } = await db.from('users')
          .select('is_blocked, bl:raw_data->blacklisted, ib:raw_data->isBlocked, mfa:raw_data->mfaEnabled, enc:raw_data->>totpSecretEnc, plano:raw_data->>totpSecret')
          .eq('id', userId).maybeSingle()
        if (!error && data) return data as any
        if (intento === 0) await new Promise(r => setTimeout(r, 400))
      }
      return null
    }
    let seg = await leerSeguridad()
    if (!seg) {
      await logAudit(userId, 'mouv.envio_sin_lectura_seguridad', { action })
      return json(503, { error: 'cuenta_no_legible', message: 'No pudimos verificar tu cuenta en este momento. Intenta de nuevo en unos segundos.' })
    }

    // GUARDIA DE BLOQUEO / LISTA NEGRA — una cuenta bloqueada (p. ej. por
    // hackeo) NO puede dispersar dinero aunque llame la API directo.
    // NO se usa `is_active`: esa columna la maneja el módulo de Personas y en
    // Empresas nadie la pone en true, así que marcaba cuentas legítimas como
    // bloqueadas y les cortaba las dispersiones COP.
    if (seg.bl === true || seg.is_blocked === true || seg.ib === true) {
      return json(403, { error: 'blocked', message: seg.bl === true ? 'Esta cuenta está en la lista negra y no puede realizar operaciones.' : 'Esta cuenta está bloqueada y no puede realizar operaciones. Contacta a soporte.' })
    }

    // ── 2FA en el SERVIDOR: si el usuario tiene la verificación en dos pasos
    //    activa, el código TOTP se valida AQUÍ antes de mover un peso — no
    //    basta con haber pasado la pantalla del navegador. (Admin/AdminBypass
    //    exceptuado: es una operación de soporte.) ────────────────────────────
    if (!caller.admin && seg.mfa === true) {
      // 2FA activo pero el secreto no está: puede ser una escritura de otro
      // proceso a medio camino. Se relee una vez antes de concluir nada.
      if (!seg.enc && !seg.plano) seg = (await leerSeguridad()) ?? seg
      // FALLA CERRADO: si el 2FA está activo pero el secreto no se puede
      // obtener (error al descifrar, llave FIELD_ENC_KEY ausente/rotada), se
      // BLOQUEA — nunca se deja pasar el envío sin verificar.
      let mfaSecret = ''
      try { mfaSecret = seg.enc ? await decField(String(seg.enc)) : String(seg.plano ?? '') } catch { mfaSecret = '' }
      const otp = String(payload.otp ?? payload.totp ?? '')
      if (!mfaSecret) {
        await logAudit(userId, 'mouv.mfa_sin_secreto', { action })
        return json(403, { error: 'mfa_required', message: 'No pudimos verificar tu código de dos pasos. Vuelve a intentar el envío.' })
      }
      if (!(await verifyTOTPServer(mfaSecret, otp))) {
        await logAudit(userId, 'mouv.mfa_codigo_invalido', { action })
        return json(403, { error: 'mfa_required', message: 'El código de dos pasos no es válido o ya venció. Escribe el código nuevo de tu app y vuelve a intentar.' })
      }
    }

    // ── El BENEFICIARIO también tiene que estar en regla ──────────────────
    // No basta con que el titular pueda operar: la plata sale HACIA alguien, y
    // ese alguien es el que hay que mirar para lavado de activos. Kumplo lo
    // verificó al inscribirlo; acá se aplica el veredicto guardado.
    //
    // Falla ABIERTO: sin veredicto —beneficiario viejo, integración apagada,
    // cuenta sin conectar— se deja pasar. Un control a medio conectar no puede
    // frenar un envío legítimo. Solo corta con un "no operable" explícito.
    {
      // El documento del destinatario. En ACH viene siempre en el cuerpo; en
      // Bre-B NO es obligatorio (basta la llave), y sin documento este control
      // entero se saltaba — los envíos Bre-B salían sin mirar antecedentes.
      // Cuando falta, se busca en el beneficiario inscrito que corresponde a
      // esa llave, que es de donde salió el envío.
      let docDest = String((payload.recipient as any)?.documentNumber ?? '').replace(/\D/g, '')
      const { data: uRaw } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
      const rawU = (uRaw as any)?.raw_data ?? {}
      // El documento SALE DEL BENEFICIARIO INSCRITO, no de lo que mande el
      // navegador. Con el documento del cuerpo, una pantalla desincronizada
      // —o alguien llamando la API a mano— podía pagar a la llave de una
      // persona declarando la cédula de otra: el control de antecedentes se
      // hacía sobre el documento equivocado y la plata salía igual.
      //
      // Se busca el contacto por llave (Bre-B) o por número de cuenta (ACH).
      // Si existe, manda su documento. Si además el cuerpo trae uno distinto,
      // se corta: algo no cuadra y no es momento de adivinar.
      {
        const lista: any[] = Array.isArray(rawU?.mouvContacts) ? rawU.mouvContacts : []
        const soloDig = (v: unknown) => String(v ?? '').replace(/\D/g, '')
        // El mismo documento escrito distinto: un NIT puede venir con o sin
        // dígito de verificación (901234567 / 9012345678) y con ceros a la
        // izquierda. El proveedor de Bre-B lo devuelve de una forma y el
        // cliente lo inscribe de otra: comparar el texto bloqueaba pagos a la
        // MISMA empresa ("la llave pertenece a GRUPO LALIBELA" siendo Grupo
        // Lalibela). El dígito extra solo se acepta si es el DV correcto.
        const dvNit = (base: string) => {
          const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
          let suma = 0
          for (let i = 0; i < base.length && i < pesos.length; i++) suma += Number(base[base.length - 1 - i]) * pesos[i]
          const r = suma % 11
          return r > 1 ? 11 - r : r
        }
        const mismoDoc = (x: unknown, y: unknown) => {
          const a = soloDig(x).replace(/^0+/, ''), b = soloDig(y).replace(/^0+/, '')
          if (!a || !b) return false
          if (a === b) return true
          const [largo, corto] = a.length > b.length ? [a, b] : [b, a]
          return largo.length === corto.length + 1 && corto.length >= 8 && largo.startsWith(corto) && Number(largo[largo.length - 1]) === dvNit(corto)
        }
        // Las llaves de celular viajan en varios formatos (3001234567,
        // +573001234567, 57 300 123 4567) y Mouv las empareja todas. Si acá no
        // se emparejan igual, el contacto no se encuentra, no hay corte y el
        // control corre sobre el documento que mandó el navegador.
        const normLlave = (v: unknown) => {
          const t = String(v ?? '').trim().toLowerCase()
          const d = t.replace(/\D/g, '')
          if (d && d.length >= 10 && /^[+\d\s().-]+$/.test(t)) return d.replace(/^57(?=\d{10}$)/, '')
          return t
        }
        const esBreb = (c: any) => (c?.destKind ?? 'ach') === 'breb'
        // Se filtra POR RIEL. Sin esto, la búsqueda ACH recorría también los
        // Bre-B —cuyo accountNumber es la llave— y una llave de celular podía
        // emparejar con el número de cuenta de otra persona: 409 falso sobre un
        // envío legítimo, o el control sobre la cédula equivocada.
        const cands = rail === 'BREB'
          ? lista.filter(c => esBreb(c) && normLlave(c?.brebKey ?? c?.accountNumber) === normLlave((payload.recipient as any)?.key))
          : lista.filter(c => !esBreb(c) && soloDig(c?.accountNumber) === soloDig((payload.recipient as any)?.accountNumber))
        // Dos contactos distintos para el mismo destino: no se adivina cuál.
        if (cands.length > 1 && new Set(cands.map(c => soloDig(c?.docNumber))).size > 1) {
          await logAudit(userId, 'mouv.destino_ambiguo', { rail, cuantos: cands.length })
          return json(409, {
            error: 'destino_ambiguo',
            message: 'Tienes dos beneficiarios distintos con ese mismo destino. Borra el que no uses y vuelve a intentar.',
          })
        }
        const hit = cands[0]
        if (hit?.name) nombresTitular.push(String(hit.name))
        if (hit) tipoBeneficiario = (String(hit.kind ?? '') === 'empresa' || /^NIT$/i.test(String(hit.docType ?? ''))) ? 'empresa' : 'persona'
        const docInscrito = soloDig(hit?.docNumber)
        if (docInscrito) {
          if (docDest && !mismoDoc(docDest, docInscrito)) {
            await logAudit(userId, 'mouv.destinatario_incoherente', {
              rail, docEnviado: docDest, docInscrito, beneficiario: hit?.name ?? null,
            })
            return json(409, {
              error: 'destinatario_incoherente',
              message: 'Los datos del beneficiario no coinciden con los que tienes inscritos. Vuelve a elegirlo en la lista e inténtalo de nuevo.',
            })
          }
          docDest = docInscrito
        }

        // Bre-B SIN documento (ni en el pedido ni en el inscrito): se le
        // pregunta al directorio de quién es la llave. Sin esto, la consulta
        // de antecedentes de abajo —que va por documento— se saltaba entera.
        if (rail === 'BREB' && !docDest) {
          try {
            const rrDoc = await mouvResolveBrebKey(String((payload.recipient as any)?.key ?? ''), String((payload.recipient as any)?.keyType ?? ''))
            const docLlave = soloDig(rrDoc?.idValue)
            if (rrDoc?.found && docLlave) {
              docDest = docLlave
              if (rrDoc.fullName) nombresTitular.push(rrDoc.fullName)
            }
          } catch { /* sin respuesta: decide la compuerta de abajo */ }
        }

        // ── EL TITULAR REAL DE LA LLAVE ──────────────────────────────────
        // Este es el único dato de toda la cadena que no sale del navegador ni
        // del raw_data del propio usuario: se lo pregunta al proveedor. Si el
        // documento del titular de la llave no es el que se verificó, la plata
        // iría a una persona con los antecedentes consultados de otra — que es
        // justo el incidente que hubo. Se comprueba ACÁ, antes de debitar;
        // antes esta resolución ocurría dentro del payout, con el saldo ya
        // descontado y sin comparar nada.
        if (rail === 'BREB' && docDest) {
          try {
            const rrPrev = await mouvResolveBrebKey(String((payload.recipient as any)?.key ?? ''), String((payload.recipient as any)?.keyType ?? ''))
            const docReal = soloDig(rrPrev?.idValue)
            if (rrPrev?.found && rrPrev.fullName && docReal && mismoDoc(docReal, docDest)) nombresTitular.push(rrPrev.fullName)
            if (rrPrev?.found && docReal && !mismoDoc(docReal, docDest)) {
              await logAudit(userId, 'mouv.titular_llave_no_coincide', {
                docVerificado: docDest, docTitular: docReal, titular: rrPrev.fullName ?? null,
              })
              return json(409, {
                error: 'titular_no_coincide',
                message: `Esa llave Bre-B no pertenece al beneficiario que tienes inscrito${rrPrev.fullName ? `, sino a ${rrPrev.fullName}` : ''}. Corrige el beneficiario antes de enviar.`,
              })
            }
          } catch { /* si el proveedor no contesta, decide la compuerta de abajo */ }
        }
      }
      // La consulta de antecedentes la hacemos NOSOTROS (TusDatos). Este es
      // el control que manda; el de Kumplo queda debajo como respaldo para
      // los veredictos que ya estaban guardados de antes.
      let aprobadoAml = false
      // Sin documento NO hay consulta de antecedentes posible. Si el control
      // está activo y cubre esta cuenta, el envío no sale: "sin resultado no
      // sale plata" vale también cuando ni siquiera hay a quién consultar.
      if (!docDest && rail === 'BREB') {
        try {
          const tdCfg0 = await configAntecedentes(userId)
          const soloEstos0: string[] = Array.isArray(tdCfg0?.soloEstosUsuarios) ? tdCfg0.soloEstosUsuarios : []
          if (tdCfg0?.activo && (soloEstos0.length === 0 || soloEstos0.includes(userId))) {
            await logAudit(userId, 'tusdatos.envio_sin_documento', { rail, llave: String((payload.recipient as any)?.key ?? '').slice(-4) })
            return json(409, {
              error: 'sin_documento',
              message: 'Para enviar a esta llave necesitamos el documento del titular. Edita el beneficiario, agrega su documento y vuelve a intentar.',
            })
          }
        } catch { /* sin configuración legible: sigue como antes */ }
      }
      if (docDest) {
        try {
          const tdCfg = await configAntecedentes(userId)
          if (tdCfg?.activo) {
            // La ficha de un NIT está por sus 9 dígitos base (así la guarda
            // Sarblock); el beneficiario puede venir con el DV pegado.
            const fichasAml = (rawU?.tusdatos?.beneficiarios ?? {}) as Record<string, any>
            // De las dos (con DV: la de la época de TusDatos; base: la de
            // Sarblock) manda la vigente y, si las dos lo están, la más
            // reciente — la misma regla que la pantalla. Antes mandaba la del
            // número exacto, y una ficha vieja o archivada tapaba a la nueva.
            const fA = fichasAml[docDest], fB = fichasAml[normDoc(docDest)]
            const vigF = (x: any) => !!x && x.estado !== 'archivado'
            const f = vigF(fA) && vigF(fB)
              ? ((Date.parse(String(fB.at ?? '')) || 0) > (Date.parse(String(fA.at ?? '')) || 0) ? fB : fA)
              : vigF(fA) ? fA : vigF(fB) ? fB : (fA ?? fB)
            if (f?.nombreReal) nombresTitular.push(String(f.nombreReal))
            const cat = String(f?.categoria ?? '')
            const cerrado = f?.estado === 'finalizado'

            // ── SIN RESULTADO NO SALE PLATA ──────────────────────────────
            //
            // Antes, mientras la consulta corría se dejaba pasar: "un control
            // que no pudo concluir no puede acusar a nadie". Para no ACUSAR
            // es cierto, pero no para dejar SALIR el dinero — si el veredicto
            // llega negativo un minuto después, ya se fue. El control existe
            // para decidir antes, no para enterarse después.
            //
            // Solo aplica a las cuentas que el AML realmente cubre: si la
            // cuenta está fuera de la lista de prueba no se le va a consultar
            // nada nunca, y esperar un resultado que no va a llegar dejaría
            // la operación parada sin ganar nada.
            //
            // 'sin_autorizacion' NO espera: el titular está en su derecho de
            // no autorizar la consulta y eso no se resuelve esperando.
            {
              const soloEstos: string[] = Array.isArray(tdCfg?.soloEstosUsuarios) ? tdCfg.soloEstosUsuarios : []
              const cubierta = soloEstos.length === 0 || soloEstos.includes(userId)
              const estadoF = String(f?.estado ?? '')
              const esperando = cubierta && estadoF !== 'finalizado' && estadoF !== 'sin_autorizacion'
              if (esperando) {
                await logAudit(userId, 'tusdatos.envio_en_espera', {
                  documento: docDest, estado: estadoF || 'sin_consulta',
                })
                return json(409, {
                  error: 'aml_pendiente',
                  message: estadoF === 'procesando' || !estadoF
                    ? 'Estamos verificando los antecedentes de este beneficiario. Suele tardar cerca de un minuto; inténtalo de nuevo en un momento.'
                    : 'La verificación de antecedentes de este beneficiario no ha terminado. Se está reintentando; inténtalo de nuevo en unos minutos.',
                })
              }
            }
            // La identidad pesa más que los antecedentes: si el nombre
            // inscrito no es el del documento, o la cédula no está vigente,
            // no se sabe A QUIÉN se le está transfiriendo. Saber que otra
            // persona está limpia no sirve de nada.
            const identidadMal = cerrado && (f?.nombreCoincide === false || f?.documentoVigente === false)
            // Riesgo alto y fallas de identidad cortan SIEMPRE. "Impedir la
            // transferencia" (bloquear) es para el caso ambiguo —el riesgo
            // medio—, no para dejar salir plata hacia un riesgo alto. Antes lo
            // apagaba todo: la insignia decía BLOQUEADO y el envío salía igual.
            const duro = identidadMal || (cerrado && cat === 'alto')
            // Y se respeta el veredicto GUARDADO: si el servidor ya dijo que
            // no es operable, eso manda. Es lo mismo que lee la pantalla para
            // pintar BLOQUEADO, así que insignia y envío no se contradicen.
            const noOperable = cerrado && f?.operable === false
            const medio = cerrado && cat === 'medio' && tdCfg?.soloBloquearAlto !== true && tdCfg?.bloquear !== false
            // Cumplimiento lo revisó y lo APROBÓ contra este mismo veredicto
            // (p. ej. un falso positivo de la fuente): pasa, y queda anotado.
            aprobadoAml = cerrado && aprobacionAmlVigente(f)
            const bloquea = !aprobadoAml && (duro || noOperable || medio)
            if (aprobadoAml && (duro || noOperable || medio)) {
              await logAudit(userId, 'tusdatos.envio_aprobado_manual', {
                documento: docDest, categoria: cat, aprobadoPor: f?.decisionManual?.por ?? null,
                aprobadoEl: f?.decisionManual?.at ?? null, reportId: f?.reportId ?? null,
              })
            }
            if (bloquea) {
              await logAudit(userId, 'tusdatos.envio_bloqueado', {
                documento: docDest, categoria: cat, motivo: f?.bloqueo ?? null,
                nombreCoincide: f?.nombreCoincide ?? null, documentoVigente: f?.documentoVigente ?? null,
                reportId: f?.reportId ?? null,
              })
              return json(403, {
                error: 'beneficiario_no_operable',
                message: f?.nombreCoincide === false
                  ? `El nombre inscrito no corresponde a ese documento. Según la Registraduría la cédula pertenece a ${f?.nombreReal ?? 'otra persona'}. Corrige el beneficiario e inténtalo de nuevo.`
                  : f?.documentoVigente === false
                    ? `El documento de este beneficiario no está vigente${f?.estadoDocumento ? `: ${f.estadoDocumento}` : ''}. No se le puede transferir.`
                    : cat === 'alto'
                      ? 'No se puede transferir a este beneficiario: la verificación de antecedentes lo marcó como riesgo alto.'
                      : 'Este beneficiario está en revisión de cumplimiento. Todavía no se le puede transferir.',
              })
            }
          }
        } catch (e) {
          // Sigue fallando ABIERTO —un tropiezo de la base no puede frenar un
          // envío legítimo— pero ya no en silencio: antes esto equivalía a "sin
          // control AML" y no quedaba rastro de que hubiera pasado.
          await logAudit(userId, 'tusdatos.gate_error', { documento: docDest, error: String((e as any)?.message ?? e) })
        }
        // (Aquí iba el bloqueo de respaldo por el veredicto de Kumplo. Kumplo se
        // retiró de Lincoin el 2026-10-30: el control de beneficiarios es el
        // de Sarblock, arriba.)
      }
      benefDocCupo = docDest
      try {
        const listaC: any[] = Array.isArray(rawU?.mouvContacts) ? rawU.mouvContacts : []
        const mismos = docDest ? listaC.filter(c => normDoc(c?.docNumber) && normDoc(c?.docNumber) === normDoc(docDest)) : []
        benefDestinosCupo = mismos.flatMap(c => [c?.brebKey, c?.accountNumber]).filter(Boolean).map(String)
        benefNombreCupo = String(mismos[0]?.name ?? (payload.recipient as any)?.holderName ?? '').trim()
      } catch { /* sin contactos: cuenta solo el documento y este destino */ }
    }

    const amount = Number(payload.amount)
    if (!isFinite(amount) || amount <= 0) return json(400, { error: 'bad_amount', message: 'Monto inválido.' })
    if (Math.round(amount) !== amount) return json(400, { error: 'bad_amount', message: 'El monto debe ser en pesos enteros.' })

    // ── PROTOCOLOS DE SEGURIDAD (estándar fintech) ──
    // (0) Mínimo por operación: los rieles lo exigen (Finity rechaza retiros
    //     ACH < $5.000 con "amount must be at least 5,000"). Se corta AQUÍ,
    //     antes de debitar, con mensaje claro.
    const PAYOUT_MIN_COP = Number(Deno.env.get('PAYOUT_MIN_COP') ?? '5000') || 5000
    if (amount < PAYOUT_MIN_COP) {
      return json(400, { error: 'under_minimum', message: `El monto mínimo por envío es ${PAYOUT_MIN_COP.toLocaleString('es-CO')} COP.` })
    }
    // (1) Tope por operación. Bre-B tiene un LÍMITE DURO del proveedor (Mouv):
    //     máximo $12.000.000 COP por transferencia — un envío mayor lo rechaza
    //     Mouv, así que se corta AQUÍ con un mensaje claro (antes el tope era
    //     20M y un envío de 12–20M pasaba la app y fallaba en Mouv). ACH usa el
    //     tope general. Ambos overridables por secret.
    const BREB_MAX_COP   = Number(Deno.env.get('BREB_MAX_COP')   ?? '12000000') || 12000000
    // La Cuenta 2 (Finity) arranca con el mismo tope hasta que Finity confirme
    // el suyo; se cambia con el secret BREB2_MAX_COP.
    const BREB2_MAX_COP  = Number(Deno.env.get('BREB2_MAX_COP')  ?? '') || BREB_MAX_COP
    // ACH: el tope lo fija el admin — por defecto 500 M para empresas y 50 M
    // para personas, con excepciones por cliente y siempre por debajo del
    // tope del proveedor (ver topeAchDe). Bre-B sigue en el límite de Mouv.
    if (!tipoBeneficiario) {
      const docT = String((payload.recipient as any)?.documentType ?? (payload.recipient as any)?.docType ?? '').toUpperCase()
      // Si no se sabe quién recibe, se aplica el tope de PERSONAS: con null se
      // usaba el de empresas (500 M) para cualquier destino sin tipo.
      tipoBeneficiario = docT === 'NIT' ? 'empresa' : 'persona'
    }
    // "Empresa" lo dice la ficha del beneficiario (o el pedido), y eso lo
    // escribe el cliente: marcar a una persona como empresa le daba el cupo
    // mensual de 800 M y el tope ACH de empresas. Solo vale si el documento
    // tiene forma de NIT de empresa.
    tipoBeneficiario = tipoCupo(tipoBeneficiario, benefDocCupo)
    const topeAch = rail === 'BREB' ? null : await topeAchDe(userId, tipoBeneficiario)
    const perOpMax = rail === 'BREB' ? (brebFinity ? BREB2_MAX_COP : BREB_MAX_COP) : topeAch!.max
    if (amount > perOpMax) {
      await logAudit(userId, `mouv.${action}.over_limit`, { amount, tope: perOpMax, origen: topeAch?.origen ?? 'breb', beneficiario: tipoBeneficiario })
      return json(400, { error: 'over_limit', message: rail === 'BREB'
        ? `Bre-B permite máximo ${perOpMax.toLocaleString('es-CO')} COP por transferencia. Divide el envío en varias operaciones o usa la Mesa OTC.`
        : topeAch?.origen === 'beneficiario_persona'
          ? `Las transferencias ACH a personas tienen un máximo de ${perOpMax.toLocaleString('es-CO')} COP por envío. Divide el envío o pide un aumento a soporte.`
          : `El monto supera tu límite por envío ACH (${perOpMax.toLocaleString('es-CO')} COP). Divide el envío o pide un aumento a soporte.` })
    }
    // (2) Idempotencia / anti doble-clic: si YA existe una dispersión idéntica
    //     (mismo usuario, riel, monto y DESTINO) creada hace menos de 2 minutos
    //     y que no fue rechazada, se bloquea el reenvío — dos toques al botón
    //     Confirmar no pueden ejecutar la operación dos veces.
    //     El destino entra en la regla: antes bastaba el monto, y una nómina
    //     con dos pagos iguales a personas distintas se frenaba como duplicada.
    const destinoCrudo = String((payload.recipient as any)?.[rail === 'BREB' ? 'key' : 'accountNumber'] ?? '').trim()
    const destinoNorm = rail === 'BREB'
      ? (() => { const t = destinoCrudo.toLowerCase(); const d = t.replace(/\D/g, ''); return d.length >= 10 && /^[+\d\s().-]+$/.test(t) ? d.replace(/^57(?=\d{10}$)/, '') : t.replace(/\s+/g, '') })()
      : destinoCrudo.replace(/\D/g, '')
    try {
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString()
      const { data: dup } = await db.from('transactions')
        .select('id, status, created_at')
        .eq('user_id', userId).eq('type', 'dispersion').eq('currency', railCol).eq('amount', amount)
        // El saldo ACH paga dos rieles (ACH y Bre-B · Cuenta 2): un ACH no
        // cuenta como duplicado de un Bre-B del mismo monto.
        .eq('raw_data->>rail', rail)
        .eq('raw_data->>account', destinoCrudo)
        .gte('created_at', since)
        .in('status', ['Procesando', 'Completado'])
        .limit(1)
      if (dup && dup.length > 0) {
        await logAudit(userId, `mouv.${action}.duplicate_blocked`, { amount, rail, existingTx: dup[0].id })
        return json(200, { error: 'duplicate', message: 'Ya hay una dispersión idéntica en curso (hace menos de 2 minutos). Revisa tus Movimientos antes de volver a enviar.' })
      }
    } catch { /* si la verificación falla no se bloquea el envío legítimo */ }

    const recipient = (payload.recipient ?? {}) as Record<string, any>
    // Validación mínima del destinatario según el riel
    if (rail === 'BREB') {
      if (!recipient.key || !recipient.keyType) return json(400, { error: 'bad_recipient', message: 'Falta la llave Bre-B (tipo y valor).' })
    } else {
      if (!recipient.bankCode || !recipient.accountNumber || !recipient.accountType || !recipient.documentNumber)
        return json(400, { error: 'bad_recipient', message: 'Faltan datos de la cuenta ACH (banco, tipo, número y documento).' })
    }
    // El MOTIVO del envío es obligatorio: va con la orden al banco y decide
    // qué documento sale en Siigo. Sin motivo, nada sale.
    const motivo = String(recipient.motivo ?? '').trim()
    if (!motivo || !(motivo in MOTIVOS_ENVIO)) return json(400, { error: 'falta_motivo', message: 'Elige el motivo del envío (pago a proveedores, servicios, nómina…).' })
    const motivoTexto = MOTIVOS_ENVIO[motivo]

    // ── ACH: la cuenta destino tiene que estar APROBADA en Finity ANTES de
    //    tocar el saldo. Esta revisión vivía solo dentro del pago, con el
    //    saldo ya descontado: un envío de 105 M a una cuenta que Finity tenía
    //    en revisión se debitó, quedó "Fallido" y hubo que devolverlo — y la
    //    pantalla la mostraba como aprobada. Ahora no arranca, y el contacto
    //    vuelve a "en validación" para que la pantalla diga la verdad.
    if (rail === 'ACH') {
      const accD = String(recipient.accountNumber ?? '').replace(/\D/g, '')
      const rev = await revisarDestinoFinity(userId, recipient.finityId ? String(recipient.finityId) : null, accD, String(recipient.documentNumber ?? '').replace(/\D/g, ''))
      if (rev.bloqueo) {
        if (rev.bloqueo.estado !== 'otra_cuenta') {
          try {
            const { data: uC } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
            const lst: any[] = Array.isArray((uC as any)?.raw_data?.mouvContacts) ? (uC as any).raw_data.mouvContacts : []
            const nuevo = lst.map((c: any) => (c?.destKind ?? 'ach') !== 'breb' && String(c?.accountNumber ?? '').replace(/\D/g, '') === accD
              ? { ...c, status: rev.bloqueo!.estado } : c)
            if (JSON.stringify(nuevo) !== JSON.stringify(lst)) await mergeRaw(db, userId, { mouvContacts: nuevo })
          } catch { /* best-effort: el envío igual no sale */ }
        }
        return json(409, { error: 'destino_no_aprobado', estado: rev.bloqueo.estado, message: rev.bloqueo.message })
      }
    }

    // 1) Comisión que SE COBRA AL CLIENTE
    //    BREB → FIJA Lincoin ($1.200 por envío, BREB_FEE_COP). El costo
    //           real de Mouv lo absorbe Lincoin; el 0,10% ya se cobró al
    //           recibir el cargue Bre-B.
    //    ACH  → precio fijo por transferencia Finity (ACH_FEE_COP).
    let feeCop = 0
    let feeDetail: Record<string, unknown> = {}
    if (rail === 'BREB') {
      feeCop = brebFinity ? BREB2_FEE_COP : brebFeeCop(amount)
      feeDetail = { feeCop, feeFixedCop: feeCop, feeVariableCop: 0, feeIvaCop: 0, feeProvider: 'lincoin' }
    } else {
      feeCop = ACH_FEE_COP
      feeDetail = { feeCop, feeProvider: 'finity' }
    }
    const totalDebit = Number((amount + feeCop).toFixed(2))

    // ── Cuentas PERSONA: solo operan si una empresa registrada las autorizó,
    //    y dentro del tope mensual que esa empresa les fijó. La regla vive
    //    aquí, donde sale el dinero: la pantalla solo la cuenta.
    try {
      const { data: pr } = await db.from('users').select('role').eq('id', userId).maybeSingle()
      if ((pr as any)?.role === 'personal') {
        const { data: emps } = await db.from('users').select('id, full_name, company_name, raw_data').eq('role', 'business')
          .contains('raw_data', { personasAutorizadas: [{ id: userId }] }).limit(1)
        const emp = emps?.[0]
        if (!emp) return json(403, { error: 'sin_autorizacion', message: 'Tu cuenta todavía no está autorizada por una empresa. Pide la autorización con el ID de la empresa desde tu portal.' })
        const aut = ((emp as any).raw_data?.personasAutorizadas ?? []).find((x: any) => x?.id === userId)
        const tope = aut?.topeMensual == null ? null : Number(aut.topeMensual)
        if (tope != null && tope > 0) {
          // El mes empieza a medianoche de Bogotá (el servidor corre en UTC:
          // con setHours el mes arrancaba 5 horas tarde).
          const { data: tx } = await db.from('transactions').select('amount, status').eq('user_id', userId).eq('type', 'dispersion').gte('created_at', inicioMesBogota())
          const usado = (tx ?? []).filter((t: any) => ['Completado', 'Procesando', 'Pendiente'].includes(String(t.status))).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)
          if (usado + amount > tope) {
            const resta = Math.max(0, tope - usado)
            return json(403, { error: 'tope_mensual', message: `Este envío supera tu tope mensual de ${tope.toLocaleString('es-CO')} COP fijado por ${String((emp as any).company_name || (emp as any).full_name || 'tu empresa')}. Te quedan ${resta.toLocaleString('es-CO')} COP este mes.` })
          }
        }
      }
    } catch (e) {
      // Si la regla no se pudo evaluar, NO sale el dinero: falla cerrado.
      return json(500, { error: 'autorizacion_no_verificada', message: 'No se pudo verificar tu autorización. Intenta de nuevo.' })
    }

    // ── CANDADO CONTRA EL DOBLE ENVÍO ───────────────────────────────────
    // El control de arriba ("¿hay una dispersión igual en los últimos 2
    // minutos?") lee la tabla: dos toques seguidos llegan juntos, los dos leen
    // antes de que el primero escriba y los dos pasan. El candado se toma en
    // la base (llave primaria), así que de dos pedidos simultáneos solo uno
    // sigue. Dos claves:
    //   · la del intento (idemKey que manda la pantalla): el mismo botón
    //     apretado dos veces, o un reintento del mismo envío;
    //   · la del envío: mismo cliente, saldo, riel y monto por 2 minutos —
    //     la misma regla de arriba, ahora sin ventana.
    // Si el envío no sale (rechazo claro, saldo devuelto) se sueltan.
    const idemKey = String(payload.idemKey ?? '').replace(/[^\w-]/g, '').slice(0, 80)
    const candados: string[] = []
    {
      const claves: [string, number][] = [
        ...(idemKey ? [[`idem:${userId}:${idemKey}`, 86_400] as [string, number]] : []),
        [`payout:${userId}:${railCol}:${rail}:${amount}:${destinoNorm}`, 120],
      ]
      for (const [clave, ttl] of claves) {
        const r = await reclamarCandado(db, clave, ttl, userId, action)
        if (r === 'ocupado') {
          for (const c of candados) await soltarCandado(db, c)
          await logAudit(userId, `mouv.${action}.duplicate_blocked`, { amount, rail, clave: clave.split(':')[0] })
          return json(200, { error: 'duplicate', message: 'Ya hay un envío igual en curso. No lo repitas: revisa tus Movimientos en un momento.' })
        }
        // El candado existe pero la base no respondió: sin él no hay
        // protección contra el doble envío, así que no sale.
        if (r === 'error') {
          for (const c of candados) await soltarCandado(db, c)
          return json(503, { error: 'candado_no_disponible', message: 'No pudimos asegurar tu envío en este momento. No se movió nada; intenta de nuevo en un minuto.' })
        }
        if (r === 'ok') candados.push(clave)
      }
    }
    const soltarCandados = async () => { for (const c of candados) await soltarCandado(db, c) }

    // (1b) CUPO MENSUAL POR BENEFICIARIO (normativa de Cumplimiento): en el
    //      mes, a una persona hasta 80 M y a una empresa hasta 800 M, salvo el
    //      cupo que Cumplimiento haya aprobado para ESE beneficiario. Se corta
    //      antes de debitar, con lo usado y lo que queda.
    //      Va DESPUÉS de los candados y con uno propio por beneficiario: dos
    //      envíos simultáneos al mismo beneficiario con montos distintos no
    //      chocan en el candado del envío, leían el mismo "usado" y pasaban
    //      juntos el cupo. El de cupo se suelta apenas la fila queda escrita.
    {
      const clave = claveBeneficiario(benefDocCupo, destinoNorm)
      const destinosCupo = [...benefDestinosCupo, destinoNorm]
      const clavesCupo = clavesBeneficiario(benefDocCupo, destinosCupo)
      // Las cuentas de la misma persona suman juntas: el candado también es
      // por persona (la primera de sus cuentas), no por cuenta.
      let idsPersona: string[] = [userId]
      try { idsPersona = await idsDeLaPersona(db, userId) } catch { /* sigue con la propia */ }
      const duenoCupo = [...idsPersona].sort()[0] ?? userId
      if (clave) {
        const cc = `cupo:${duenoCupo}:${clave}`
        const r = await reclamarCandado(db, cc, 90, userId, action)
        if (r === 'ocupado') {
          await soltarCandados()
          return json(409, { error: 'cupo_ocupado', message: 'Hay otro envío a este beneficiario terminando de procesarse. Espera unos segundos y vuelve a intentar.' })
        }
        if (r === 'error') {
          await soltarCandados()
          return json(503, { error: 'cupo_no_verificado', message: 'No pudimos verificar el cupo mensual de este beneficiario. Intenta de nuevo en un momento.' })
        }
        if (r === 'ok') candados.push(cc)
      }
      try {
        const general = await cupoGeneral(db)
        const aprobado = await cupoAprobado(db, idsPersona, clavesCupo)
        const cupo = cupoVigente(aprobado, tipoBeneficiario === 'empresa' ? general.empresa : general.persona)
        const envios = await enviosDelMes(db, idsPersona)
        const usado = usadoPara(envios, benefDocCupo, destinosCupo)
        if (usado + amount > cupo) {
          const enProceso = await solicitudEnProceso(db, idsPersona, clavesCupo)
          const quedan = Math.max(0, cupo - usado)
          const quien = benefNombreCupo || String((payload.recipient as any)?.holderName ?? '').trim() || 'este beneficiario'
          await logAudit(userId, `mouv.${action}.cupo_mensual`, { amount, usado, cupo, aprobado: aprobado != null, clave, enProceso })
          await soltarCandados()
          return json(403, {
            error: 'cupo_mensual', cupo, usado, disponible: quedan, enProceso,
            message: `Este envío supera el cupo mensual de ${quien}: este mes llevas ${usado.toLocaleString('es-CO')} COP de ${cupo.toLocaleString('es-CO')} COP y te quedan ${quedan.toLocaleString('es-CO')} COP. `
              + (enProceso
                ? 'Tu solicitud de aumento de cupo para este beneficiario está en revisión de cumplimiento.'
                : 'Para enviar más, solicita un aumento de cupo en Beneficiarios adjuntando el RUT.'),
          })
        }
      } catch (e) {
        // Sin poder calcular el cupo, el envío NO sale: es un control de
        // cumplimiento y falla cerrado.
        await logAudit(userId, `mouv.${action}.cupo_error`, { error: String((e as Error)?.message ?? e).slice(0, 200) })
        await soltarCandados()
        return json(503, { error: 'cupo_no_verificado', message: 'No pudimos verificar el cupo mensual de este beneficiario. Intenta de nuevo en un momento.' })
      }
    }

    // ── Bre-B · Cuenta 2: PREPARAR antes de tocar el saldo ───────────────
    // Crear la transferencia en Finity no mueve plata: si la llave no sirve,
    // el titular no es o el monto no cuadra, el envío no arranca — sin
    // débito, sin fila Fallido y sin devolución.
    let prepBreb2: (ResultadoBreb2 & { creada?: any }) | null = null
    if (brebFinity) {
      // Solo nombres que NO salen del pedido: el inscrito y el del directorio.
      // El holderName lo escribe el navegador y con él la comparación siempre
      // pasaba.
      prepBreb2 = await finityPrepararBreb(userId, recipient, amount, [...nombresTitular])
      if (!prepBreb2.ok) {
        await logAudit(userId, `finity.${action}.no_creada`, {
          amount, paso: prepBreb2.paso ?? null, httpStatus: prepBreb2.httpStatus ?? null,
          error: (() => { try { return JSON.stringify(prepBreb2!.body ?? {}).slice(0, 300) } catch { return null } })(),
        })
        await soltarCandados()
        return json(200, { error: 'payout_failed', refunded: false, sinDebito: true, message: mensajeFalloBreb2(prepBreb2, false) })
      }
    }

    // ── Cuentas PERSONA: su COP llega al Saldo Lincoin ('COP'), no a un
    //    riel. Antes de debitar el riel del envío se cubre lo que falte desde
    //    'COP' y, si aún falta, desde el otro riel. Es un movimiento interno
    //    atómico (adjust_balances rechaza dejar cualquier saldo en negativo);
    //    si el envío después falla, el reintegro cae en el riel y sigue
    //    contando en su total en pesos. Las empresas mueven rieles a mano
    //    desde su panel, así que para ellas no cambia nada.
    try {
      const { data: pu } = await db.from('users').select('role, balances').eq('id', userId).maybeSingle()
      if ((pu as any)?.role === 'personal') {
        const bals = (((pu as any)?.balances ?? {}) as Record<string, unknown>)
        const en = (k: string) => Number(bals[k] ?? 0) || 0
        let falta = Number((totalDebit - en(railCol)).toFixed(2))
        if (falta > 0) {
          const mov: Record<string, number> = {}
          for (const f of ['COP', railCol === 'COP_BREB' ? 'COP_ACH' : 'COP_BREB']) {
            if (falta <= 0) break
            const disp = en(f)
            if (disp <= 0) continue
            const toma = Number(Math.min(disp, falta).toFixed(2))
            mov[f] = -toma
            falta = Number((falta - toma).toFixed(2))
          }
          if (Object.keys(mov).length) {
            const total = Number((-Object.values(mov).reduce((s, v) => s + v, 0)).toFixed(2))
            const { data: adj, error: adjErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { ...mov, [railCol]: total } })
            if (adjErr || (adj as any)?.error) { await soltarCandados(); return json(400, { error: 'fondeo_riel', message: 'No se pudo preparar tu saldo en pesos para este envío. Intenta de nuevo.' }) }
          }
        }
      }
    } catch { /* si la lectura falla, el chequeo de saldo de abajo decide */ }

    // 2-3) Debitar monto + comisión de forma ATÓMICA (bloqueo de fila) — así
    //      una operación concurrente no puede "restaurar" el riel debitado y
    //      duplicar fondos (pentest #4). Fallback a read-check-write si la RPC
    //      adjust_balances aún no está desplegada.
    let afterDebit = 0
    const { data: adjDeb, error: adjDebErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [railCol]: -totalDebit } })
    if (!adjDebErr) {
      const e = (adjDeb as any)?.error
      if (e === 'not_found') { await soltarCandados(); return json(404, { error: 'user_not_found', message: 'Usuario no encontrado.' }) }
      if (e) { await soltarCandados(); return json(400, { error: 'insufficient_funds', message: `Saldo ${saldoLabel} insuficiente para monto + comisión (${totalDebit.toLocaleString('es-CO')} COP).` }) }
      afterDebit = Number(((adjDeb as any)?.balances?.[railCol]) ?? 0)
    } else if (!rpcNoExiste(adjDebErr)) {
      // La base no contestó con claridad: el débito pudo haberse aplicado.
      // NO se reintenta a mano (cobraría dos veces) y NO se llama al
      // proveedor. Se avisa para revisar el saldo.
      await logAudit(userId, `mouv.${action}.debito_incierto`, { amount, totalDebit, railCol, motivo: adjDebErr?.message ?? null })
      await avisarAdminSinConfirmar({ id: null, user_id: userId, amount, currency: railCol, created_at: new Date().toISOString(), raw_data: { motivo: 'debito_incierto', totalDebit } })
      await soltarCandados()
      return json(500, { error: 'debit_uncertain', message: 'No pudimos confirmar el descuento de tu saldo, así que no enviamos nada. Revisa tu saldo en un minuto; si se descontó, te lo devolvemos.' })
    } else {
      const { data: u } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
      if (!u) { await soltarCandados(); return json(404, { error: 'user_not_found', message: 'Usuario no encontrado.' }) }
      const bals: Record<string, number> = (u.balances as any) ?? {}
      const current = Number(bals[railCol] ?? 0)
      if (current < totalDebit) { await soltarCandados(); return json(400, { error: 'insufficient_funds', message: `Saldo ${saldoLabel} insuficiente para monto + comisión (${totalDebit.toLocaleString('es-CO')} COP). Disponible: ${current.toLocaleString('es-CO')} COP.` }) }
      afterDebit = Number((current - totalDebit).toFixed(2))
      const { error: debErr } = await db.from('users').update({ balances: { ...bals, [railCol]: afterDebit } }).eq('id', userId)
      if (debErr) { await soltarCandados(); return json(500, { error: 'debit_failed', message: 'No se pudo reservar el saldo. Intenta de nuevo.' }) }
    }

    // 3) Registrar la transacción (type 'dispersion' — NO colisiona con la
    //    cola de retiros del admin, que es type 'send' + 'Pendiente').
    //    Los campos amigables (title/beneficiary/bank/account) son los que
    //    lee el comprobante del cliente — sin ellos salía "dispersion" crudo
    //    y sin beneficiario.
    const railLabel = rail === 'BREB' ? 'Bre-B' : 'ACH'
    const keyTypeLabel = ({ celular: 'Celular', cedula: 'Cédula', correo: 'Correo', alfanumerico: 'Llave' } as Record<string, string>)[String(recipient.keyType ?? '')] ?? 'Llave'
    const prettyBase = {
      source: 'mouv_payout', rail,
      ...(rail === 'BREB' ? { cuentaBreb: brebFinity ? 2 : 1, proveedor: brebFinity ? 'finity' : 'mouv' } : {}),
      title: brebFinity ? 'Dispersión Bre-B · Cuenta 2' : `Dispersión ${railLabel}`,
      beneficiary: recipient.holderName ?? null,
      bank: rail === 'BREB' ? `Bre-B · ${keyTypeLabel}` : (recipient.bankCode ?? 'ACH'),
      account: rail === 'BREB' ? (recipient.key ?? null) : (recipient.accountNumber ?? null),
      ...(recipient.documentNumber ? { documentNumber: recipient.documentNumber } : {}),
      // El documento del beneficiario con que se controla el cupo mensual (el
      // inscrito o el de la llave), aunque el envío no lo traiga.
      ...(benefDocCupo ? { benefDoc: benefDocCupo } : {}),
      ...(recipient.documentType ? { documentType: recipient.documentType } : {}),
      ...(recipient.reference ? { reason: recipient.reference } : {}),
      motivo, motivoTexto,
      recipient,
    }
    // El ERROR de este insert NO se puede descartar. Antes se leía solo `data`
    // y, si el insert fallaba, el código seguía adelante con txId = null: el
    // dinero salía y el movimiento NO EXISTÍA en ninguna parte. Para el cliente
    // eso se ve como "hice la transferencia y no me aparece" — sin rastro,
    // porque nadie se enteró de que la fila nunca se escribió.
    // La firma va DENTRO de prettyBase: todas las escrituras posteriores de
    // la fila (asentarTx) parten de prettyBase y así no se pierde.
    ;(prettyBase as any).firmaServidor = await firmaFila(userId, 'dispersion', amount, railCol)
    const filaTx = {
      user_id: userId, type: 'dispersion', amount, currency: railCol, status: 'Procesando',
      raw_data: { ...prettyBase, ...feeDetail, requestedAt: new Date().toISOString() },
    }
    const { data: txIns, error: txInsErr } = await db.from('transactions').insert(filaTx).select('id').maybeSingle()
    let txId = (txIns as any)?.id ?? null
    if (txInsErr || !txId) {
      // Un reintento inmediato: la causa más común es un tropiezo puntual.
      const reintento = await db.from('transactions').insert(filaTx).select('id').maybeSingle()
      txId = (reintento.data as any)?.id ?? null
      if (!txId) {
        // Queda constancia con TODO lo necesario para reconstruir la fila a
        // mano. Es lo mínimo: el dinero va a salir igual, así que el registro
        // no puede desaparecer en silencio.
        await logAudit(userId, 'mouv.tx_insert_failed', {
          motivo: txInsErr?.message ?? reintento.error?.message ?? 'insert sin id',
          amount, railCol, recipient,
        })
      }
    }
    // La fila ya existe y cuenta para el cupo: el siguiente envío a este
    // beneficiario puede leerla, así que su candado se suelta ya. (Si la fila
    // no se escribió, se deja vencer: así no entra otro sin verla.)
    if (txId) {
      for (const c of candados.filter(x => x.startsWith('cupo:'))) {
        await soltarCandado(db, c)
        candados.splice(candados.indexOf(c), 1)
      }
    }

    // Deja el movimiento en su estado final. Si la fila no llegó a crearse, la
    // CREA ahora — el envío ya ocurrió, así que el registro tiene que existir
    // sí o sí. Antes cada sitio hacía `if (txId) update(...)`: sin fila, el
    // movimiento se perdía para siempre y el cliente no tenía cómo verlo.
    const asentarTx = async (status: string, raw: Record<string, unknown>) => {
      if (txId) {
        // EL ERROR DE ESTE UPDATE NO SE PUEDE DESCARTAR.
        // Se descartaba, y esa es la causa de fondo del 19 de septiembre: 75
        // dispersiones quedaron con el raw_data del insert inicial, sin
        // providerRef y sin documentNumber -- los dos se escriben ACA -- asi
        // que no habia ni id para consultar el estado ni documento para
        // emparejar. La fila decia "Procesando" y parecia normal.
        const { error: upErr } = await db.from('transactions').update({ status, raw_data: raw }).eq('id', txId)
        if (upErr) {
          await logAudit(userId, 'mouv.asentar_tx_failed', {
            txId, status, motivo: upErr.message,
            // Con esto se puede reconstruir la fila a mano: el envio ya ocurrio.
            providerRef: (raw as any)?.providerRef ?? null,
            providerReference: (raw as any)?.providerReference ?? null,
            amount, railCol,
          })
        }
        return
      }
      const { data: tardio } = await db.from('transactions')
        .insert({ user_id: userId, type: 'dispersion', amount, currency: railCol, status, raw_data: raw })
        .select('id').maybeSingle()
      txId = (tardio as any)?.id ?? null
      if (txId) await logAudit(userId, 'mouv.tx_insert_tardio', { txId, status })
    }

    // 4) Llamar al PROVEEDOR del riel: BREB → Mouv (Cuenta 1) o Finity
    //    (Cuenta 2) · ACH → Finity
    if (brebFinity) {
      const fb = await finityConfirmarBreb(userId, prepBreb2!)
      const ahora = new Date().toISOString()
      const delProveedor = {
        ...(fb.titular ? { titularProveedor: fb.titular } : {}),
        ...(fb.banco ? { bancoDestino: fb.banco } : {}),
        ...(fb.costoProveedor != null ? { costoProveedorCop: fb.costoProveedor } : {}),
        ...(fb.totalProveedor != null ? { totalProveedorCop: fb.totalProveedor } : {}),
      }
      if (fb.ok) {
        // Confirmada no es pagada: queda Procesando hasta que la conciliación
        // (o el aviso de Finity) diga que llegó. Igual que la Cuenta 1.
        await asentarTx('Procesando', {
          ...prettyBase, ...feeDetail, ...delProveedor,
          providerRef: fb.providerRef ?? null, aceptadaAt: ahora,
        })
        await logAudit(userId, `finity.${action}.ok`, { amount, feeCop, rail, providerRef: fb.providerRef ?? null, costoProveedorCop: fb.costoProveedor ?? null })
        await notifyTx(txId)
        return json(200, { ok: true, status: 'Procesando', confirmada: false, providerRef: fb.providerRef ?? null, feeCop, newBalance: afterDebit })
      }
      // Sin respuesta clara AL CONFIRMAR: no se reembolsa. Puede haber salido.
      if (fb.desenlaceDesconocido) {
        await asentarTx('Procesando', {
          ...prettyBase, ...feeDetail, ...delProveedor,
          providerRef: fb.providerRef ?? null,
          desenlaceDesconocido: true, revisionManual: true,
          httpStatus: fb.httpStatus ?? null, error: fb.body ?? 'sin_respuesta',
          sinConfirmarDesde: ahora,
        })
        await logAudit(userId, `finity.${action}.desenlace_desconocido`, { txId, amount, providerRef: fb.providerRef ?? null, httpStatus: fb.httpStatus ?? null })
        await avisarAdminSinConfirmar({ id: txId, user_id: userId, amount, currency: railCol, raw_data: prettyBase })
        await notifyTx(txId)
        return json(200, {
          ok: true, status: 'Procesando', confirmada: false, desenlaceDesconocido: true,
          message: 'No pudimos confirmar el envío con el banco. NO lo reintentes: lo estamos verificando y te avisamos en minutos.',
          feeCop, newBalance: afterDebit,
        })
      }
      // Finity dijo que no, o lo frenamos antes de confirmar (titular o monto
      // que no cuadran): no salió nada → REINTEGRAR monto + comisión.
      const reintF = await reintegrarEnvio(userId, railCol, totalDebit)
      const restoredF = reintF.saldo ?? 0
      const provMsgF = fb.mensaje ? null : digMotivoRechazo(fb.body)
      const friendlyF = mensajeFalloBreb2(fb, true)
      await asentarTx('Fallido', {
        ...prettyBase, ...feeDetail, ...delProveedor,
        ...(fb.providerRef ? { providerRef: fb.providerRef } : {}),
        error: fb.body ?? 'finity_breb_failed', errorMessage: fb.mensaje ?? provMsgF ?? `paso ${fb.paso ?? '?'} · HTTP ${fb.httpStatus ?? 0}`,
        pasoFallido: fb.paso ?? null, httpStatus: fb.httpStatus ?? null,
        ...marcasReintegro(reintF.ok), failedAt: ahora,
      })
      if (!reintF.ok) await avisarAdminSinConfirmar({ id: txId, user_id: userId, amount, currency: railCol, created_at: ahora, raw_data: { ...prettyBase, reembolsoPendiente: true } })
      await logAudit(userId, `finity.${action}.fail`, { amount, paso: fb.paso ?? null, httpStatus: fb.httpStatus ?? null, error: (() => { try { return JSON.stringify(fb.body ?? {}).slice(0, 300) } catch { return null } })() })
      await notifyTx(txId)
      await soltarCandados()
      return json(200, { error: 'payout_failed', refunded: reintF.ok, newBalance: restoredF, message: conReintegro(friendlyF, reintF.ok) })
    }

    if (rail === 'BREB') {
      const pay = await mouvPayout(rail, recipient, amount)
      // ACEPTADA NO ES PAGADA.
      //
      // Mouv responde /transfers/send con 201 { status: 'PENDING' }: eso
      // significa "la recibí para procesar", no "la pagué". El banco destino
      // puede rechazarla minutos después.
      //
      // Acá se marcaba Completado en el acto salvo que la respuesta del envío
      // YA viniera devuelta, y se justificaba apoyándose en dos redes de
      // seguridad: reconcile_breb y el webhook de Mouv. Ninguna de las dos
      // existe en la práctica — mouvTransferStatus adivina la ruta entre seis
      // candidatas y todas dan 404, y el webhook no está registrado. Así que
      // no era una apuesta cubierta: era una afirmación sin respaldo.
      //
      // El 16 de septiembre eso le cobró 2.900.000 COP a un cliente por una
      // dispersión que Mouv rechazó. El comprobante decía Completado, el saldo
      // estaba debitado, y la plata nunca salió.
      //
      // Ahora Completado exige que el proveedor lo diga. Si solo la aceptó,
      // queda Procesando —que es lo que realmente pasó— hasta que se confirme
      // por conciliación, por webhook, o a mano. Un cliente esperando es un
      // problema; un cliente al que se le cobró por algo que no ocurrió y se
      // le dijo que sí, es otra cosa.
      const sendState = pay.ok ? normalizeMouvState(pay.data) : { verdict: 'unknown' as MouvVerdict, state: '' }
      if (pay.ok && sendState.verdict !== 'returned') {
        // LA RESPUESTA DEL ENVIO NO PUEDE PROBAR LA LIQUIDACION FINAL.
        //
        // El arreglo anterior exigia veredicto 'completed' para marcar
        // Completado, y no alcanzo: Mouv responde con su propio vocabulario y
        // "Exitoso" normaliza a completed. El 17 de septiembre una dispersion
        // salio "Exitoso" en el envio, quedo Completado, y Mouv la marco
        // DEVUELTA minutos despues. El cliente pago por algo que no ocurrio.
        //
        // En un riel que se puede revertir, lo unico que prueba el pago es una
        // consulta POSTERIOR. Asi que el envio ya no marca Completado nunca:
        // deja Procesando, que es lo que realmente se sabe en ese instante, y
        // la confirmacion la da la conciliacion o el webhook.
        //
        // El costo es real: si la conciliacion no puede confirmar -- hoy no
        // puede, porque la ruta de consulta de estado esta adivinada y da 404
        // -- la dispersion se queda en Procesando y alguien tiene que
        // resolverla a mano contra la consola del proveedor. Sale en
        // Admin -> Fallos, marcada como sin confirmar. Es incomodo; decirle a
        // un cliente que su plata llego cuando no llego es otra cosa.
        const estado = 'Procesando'
        const confirmada = false
        await asentarTx(estado, {
            ...prettyBase, ...feeDetail,
            ...(pay.targetName ? { beneficiary: pay.targetName } : {}),
            ...(pay.targetDocument ? { documentNumber: pay.targetDocument } : {}),
            providerRef: pay.providerRef ?? null,
            providerReference: pay.referencia ?? null,
            providerState: sendState.state || null,
            // LA RESPUESTA CRUDA DEL ENVIO, GUARDADA.
            //
            // Cuando providerRef sale null no hay forma de saber POR QUE sin
            // esto: si Mouv no devolvio id, si lo devolvio con otro nombre, o
            // si vino un nivel mas adentro. Se paso horas preguntandole a una
            // persona que corriera consultas para averiguarlo. Con el crudo
            // guardado, el proximo caso se diagnostica solo.
            //
            // Se recorta: no hace falta un blob enorme por fila, y lo que
            // importa (ids, estado, mensaje) siempre viene arriba.
            respuestaEnvio: JSON.stringify(pay.data ?? null).slice(0, 4000),
            // MULTI-FIRMA: si la empresa tiene multiSigThreshold >= 2, el envio
            // NO se despacha hasta que una persona firme en el panel del
            // proveedor, y a las 24 h expira y se revierte. Visto desde aca se
            // parece a "procesando" y no lo es: nadie esta moviendo esa plata,
            // esta esperando una firma que quiza nadie sabe que debe dar.
            ...(sendState.state === 'AWAITING_APPROVAL'
              ? { esperaFirma: true, esperaFirmaDesde: new Date().toISOString() }
              : {}),
            aceptadaAt: new Date().toISOString(),
            ...(confirmada
              ? { settledAt: new Date().toISOString() }
              : { sinConfirmarDesde: new Date().toISOString() }),
        })
        await logAudit(userId, `mouv.${action}.aceptada`, {
          amount, feeCop, rail, providerRef: pay.providerRef ?? null,
          providerState: sendState.state || null, estado,
        })
        // UN ENVIO ACEPTADO SIN ID ES UN ENVIO QUE NO SE VA A PODER CONCILIAR.
        // Es la falla que dejo 75 dispersiones sin forma de consultar su
        // estado, y no dejaba rastro: se veia como "aceptada" igual que las
        // buenas. Ahora queda asentada aparte, con el cuerpo que contesto
        // Mouv, para que se note el mismo dia y no tres semanas despues.
        if (!pay.providerRef) {
          await logAudit(userId, `mouv.${action}.sin_provider_ref`, {
            txId, amount, rail, referencia: pay.referencia ?? null,
            respuesta: (() => { try { return JSON.stringify(pay.data ?? '').slice(0, 500) } catch { return '(ilegible)' } })(),
          })
        }
        await notifyTx(txId)
        return json(200, {
          ok: true, status: estado, confirmada,
          providerRef: pay.providerRef ?? null, providerState: sendState.state || null,
          ...(sendState.state === 'AWAITING_APPROVAL' ? { esperaFirma: true } : {}),
          feeCop, newBalance: afterDebit,
        })
      }
      // ── FALLO TRANSITORIO: NO SE REEMBOLSA ──────────────────────────
      // Un 5xx o un timeout NO significan "no salio": significan que no
      // sabemos. Ya se reintento una vez con la MISMA referencia (idempotente
      // 60 s) y siguio sin respuesta util, asi que el desenlace es
      // desconocido.
      //
      // Reembolsar acá seria afirmar que no salio. Si habia salido, el cliente
      // cobra dos veces y esa plata no vuelve. Dejarla debitada es el error
      // barato: si efectivamente no salio, lo resuelve una persona en Fallos en
      // minutos, con un boton que ya existe.
      //
      // Entre pagar dos veces y hacer esperar a alguien, se hace esperar.
      const rechazoClaro = pay.status > 0 && pay.status < 500
      if (!rechazoClaro) {
        await asentarTx('Procesando', {
          ...prettyBase, ...feeDetail,
          providerReference: pay.referencia ?? null,
          desenlaceDesconocido: true,
          httpStatus: pay.status,
          error: pay.data ?? 'sin_respuesta',
          sinConfirmarDesde: new Date().toISOString(),
          revisionManual: true,
        })
        await logAudit(userId, `mouv.${action}.desenlace_desconocido`, {
          txId, amount, rail, httpStatus: pay.status, referencia: pay.referencia ?? null,
        })
        await avisarAdminSinConfirmar({ id: txId, user_id: userId, amount, currency: railCol, raw_data: prettyBase })
        await notifyTx(txId)
        return json(200, {
          ok: true, status: 'Procesando', confirmada: false, desenlaceDesconocido: true,
          message: 'No pudimos confirmar el envío con el proveedor. NO lo reintentes: lo estamos verificando y te avisamos en minutos.',
          feeCop, newBalance: afterDebit,
        })
      }

      // Rechazo EXPLICITO del proveedor (4xx) o envio ya devuelto → REINTEGRAR
      // monto + comisión (atómico; fallback read-write).
      const reintM = await reintegrarEnvio(userId, railCol, totalDebit)
      const restored = reintM.saldo ?? 0
      await asentarTx('Fallido', { ...prettyBase, ...feeDetail, error: pay.data ?? 'payout_failed', httpStatus: pay.status, ...marcasReintegro(reintM.ok), failedAt: new Date().toISOString() })
      if (!reintM.ok) await avisarAdminSinConfirmar({ id: txId, user_id: userId, amount, currency: railCol, created_at: new Date().toISOString(), raw_data: { ...prettyBase, reembolsoPendiente: true } })
      await logAudit(userId, `mouv.${action}.fail`, { amount, rail, status: pay.status, data: pay.data ?? null })
      await notifyTx(txId) // correo "no pudimos completar tu envío · saldo devuelto"
      // Mensaje LIMPIO para el cliente: si el proveedor manda un error
      // estructurado (código + mensaje), se muestra ese texto humano — NUNCA
      // el JSON crudo. El detalle técnico va aparte en `data` para soporte.
      let provObj: any = null
      try { provObj = typeof pay.data === 'string' ? JSON.parse(pay.data) : pay.data } catch { provObj = pay.data }
      const provCode = provObj?.error ?? provObj?.code ?? null
      // Excavar un mensaje HUMANO en las formas típicas de error de Mouv.
      const digMsg = (o: any): string | null => {
        if (o == null) return null
        if (typeof o === 'string') return o.trim() || null
        return (
          (typeof o.message === 'string' && o.message) ||
          (typeof o.detail === 'string' && o.detail) ||
          (typeof o.error?.message === 'string' && o.error.message) ||
          (Array.isArray(o.errors) && typeof o.errors[0]?.message === 'string' && o.errors[0].message) ||
          (typeof o.reason === 'string' && o.reason) ||
          (typeof o.error === 'string' && o.error) ||
          null
        )
      }
      const provMsg = digMsg(provObj)
      const retryAfterSeconds = Number(provObj?.retryAfterSeconds ?? 0) || null
      // Pista técnica compacta (para diagnóstico) cuando Mouv no da un mensaje
      // humano: casi siempre es saldo insuficiente en la wallet Mouv, timeout, o
      // Mouv respondió sin cuerpo legible. Se guarda en la tx y se muestra al
      // final del mensaje para poder identificar la causa real.
      const techHint = (() => {
        const parts: string[] = []
        if (pay.status) parts.push(`HTTP ${pay.status}`); else parts.push('sin respuesta de Mouv')
        if (provCode && typeof provCode === 'string') parts.push(provCode)
        if (!provMsg) { try { const s = typeof pay.data === 'string' ? pay.data : JSON.stringify(pay.data ?? ''); if (s && s !== '{}' && s !== 'null' && s !== '""') parts.push(s.slice(0, 140)) } catch { /* */ } }
        return parts.filter(Boolean).join(' · ')
      })()
      // Texto completo del error (para clasificar la causa).
      const errText = (() => {
        let s = String(provMsg ?? '')
        try { s += ' ' + (typeof pay.data === 'string' ? pay.data : JSON.stringify(pay.data ?? '')) } catch { /* */ }
        return s.toLowerCase()
      })()
      // ¿Es un problema de la LLAVE del beneficiario (no un fallo de Mouv)?
      // Un 401/403 es NUESTRA credencial con Mouv ("Invalid API key"), no la
      // llave del beneficiario: decirle al cliente que su llave está mal lo
      // mandaba a corregir algo que estaba bien.
      const isKeyProblem = ![0, 401, 403].includes(Number(pay.status)) && /brebkey|destination|no existe|not\s*found|inv[aá]lid|no.{0,3}activ|resolver la llave|llave no|unknown\s*key|key\s*not/.test(errText)
      let friendly: string
      if (provCode === 'STRUCTURING_WINDOW_BLOCKED' || (pay.status === 409 && !provMsg)) {
        const secs = retryAfterSeconds ?? 0
        const mins = secs > 0 ? Math.max(1, Math.ceil(secs / 60)) : (Number(provObj?.windowMinutes) || 5)
        friendly = `Ya hiciste un envío a este mismo beneficiario hace poco. Por seguridad, espera ${mins} minuto${mins === 1 ? '' : 's'} antes de repetir un pago al mismo destino. Tu saldo fue devuelto.`
      } else if (isKeyProblem) {
        friendly = `La llave Bre-B del beneficiario no es válida o no está activa. Pídele que te confirme su llave Bre-B exacta (celular, correo, cédula o alias) y vuelve a intentarlo. Tu saldo fue devuelto.`
      } else if (provMsg && /cumplimiento|compliance|restringid|sarlaft|listas?\s+restrictiv|lavado/i.test(provMsg)) {
        // Cuando el rechazo es por CUMPLIMIENTO, decir de quién viene. Este
        // mensaje llega tal cual del operador del riel y se mostraba sin
        // firma, así que se leía como si lo hubiera decidido Lincoin —
        // exactamente el mismo texto que usaría nuestra propia verificación.
        // Costó horas de buscar el bloqueo en el lado equivocado.
        // El texto del operador solo si es uno que el cliente entiende.
        const motivoCump = motivoParaCliente(provMsg)
        friendly = `El operador del envío rechazó esta transferencia por una restricción de cumplimiento de su lado${motivoCump ? `: «${motivoCump}».` : '.'} No es una restricción de Lincoin. Comunícate con soporte para revisarlo. Tu saldo fue devuelto.`
      } else if (motivoParaCliente(provMsg)) {
        // Solo se muestra el mensaje del proveedor si es TEXTO HUMANO (sin JSON,
        // códigos, jerga en inglés ni nombres de aliados). Si no, el genérico.
        friendly = `${motivoParaCliente(provMsg)}. Tu saldo fue devuelto.`
      } else {
        // AL CLIENTE: mensaje limpio, SIN detalles técnicos. El detalle real
        // (techHint) NO se muestra aquí — queda guardado en la tx (errorMessage)
        // y en el audit_log para el Panel de Fallos del admin.
        friendly = `No pudimos completar el envío en este momento. Tu saldo fue devuelto — puedes intentarlo de nuevo en unos minutos.`
      }
      // Queda anotado QUIÉN rechazó. Un fallo por cumplimiento del proveedor y
      // uno de nuestra propia verificación se investigan en sitios distintos;
      // sin esta marca los dos se ven igual en el Panel de Fallos.
      const porCumplimientoDelProveedor = !!provMsg && /cumplimiento|compliance|restringid|sarlaft|listas?\s+restrictiv|lavado/i.test(provMsg)
      if (porCumplimientoDelProveedor) {
        await logAudit(userId, 'mouv.rechazo_cumplimiento_proveedor', {
          rail, documento: String((payload.recipient as any)?.documentNumber ?? '').replace(/\D/g, ''),
          httpStatus: pay.status, mensaje: String(provMsg).slice(0, 300),
        })
      }
      // Guardar el motivo legible en la tx para que el comprobante del fallo lo muestre.
      if (txId) { try { await db.from('transactions').update({ raw_data: { ...prettyBase, ...feeDetail, error: pay.data ?? 'payout_failed', errorMessage: provMsg ?? techHint ?? null, bloqueoDelProveedor: porCumplimientoDelProveedor || undefined, httpStatus: pay.status, ...marcasReintegro(reintM.ok), failedAt: new Date().toISOString() } }).eq('id', txId) } catch { /* best-effort */ } }
      // NOTA: no se devuelven `data`/`detail` técnicos al cliente. El detalle
      // real vive en la tx (errorMessage/error/httpStatus) y en el audit_log.
      await soltarCandados()
      return json(200, { error: 'payout_failed', code: provCode, retryAfterSeconds, refunded: reintM.ok, newBalance: restored,
        message: conReintegro(friendly, reintM.ok) })
    }

    // ── ACH vía FINITY ──
    const fin = await finityPayoutAch(userId, recipient, amount)

    // ⚠️ EL id del destino se guarda PASE LO QUE PASE, no solo si el envío
    // salió bien. Antes solo se persistía en el camino de éxito: si el destino
    // se creaba y luego fallaba el retiro, ese id se perdía, el siguiente
    // intento volvía a crear la MISMA cuenta y Finity la rechazaba por
    // duplicada — el envío quedaba roto para siempre desde Lincoin, mientras
    // que desde el panel de Finity funcionaba porque allá el destino ya existe.
    if (fin.destinationId) {
      try {
        const accKey = String(recipient.accountNumber ?? '').replace(/\D/g, '')
        const { data: u4 } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
        const raw4 = (u4?.raw_data ?? {}) as Record<string, any>
        const list = Array.isArray(raw4.mouvContacts) ? raw4.mouvContacts : []
        const next = list.map((c: any) => String(c?.accountNumber ?? '').replace(/\D/g, '') === accKey ? { ...c, finityId: fin.destinationId } : c)
        if (JSON.stringify(next) !== JSON.stringify(list)) await mergeRaw(db, userId, { mouvContacts: next })
      } catch { /* best-effort — nunca bloquea la operación */ }
    }

    if (fin.ok) {
      // El precio por transferencia (ACH_FEE_COP) ya se debitó junto al monto.
      const newBalance = afterDebit
      // Finity CONFIRMED = orden aceptada (aún no pagada) → Procesando.
      await asentarTx('Procesando', {
        // La comisión que SE DEBITÓ (no la que reporta el proveedor): es la que
        // se devuelve si el envío termina rechazado.
        ...prettyBase, feeProvider: 'finity', feeCop, costs: fin.costs ?? null,
        providerRef: fin.providerRef ?? null, state: fin.state ?? null,
        ...(fin.amountMismatch ? { amountMismatch: fin.amountMismatch, needsReview: true } : {}),
        acceptedAt: new Date().toISOString(),
      })
      await logAudit(userId, `finity.${action}.ok`, { amount, feeCop: fin.feeCop, providerRef: fin.providerRef ?? null })
      await notifyTx(txId) // correo "recibimos tu envío · en proceso"
      return json(200, { ok: true, providerRef: fin.providerRef ?? null, feeCop: fin.feeCop, newBalance })
    }
    // ── SIN RESPUESTA CLARA DE FINITY: NO SE REEMBOLSA ──────────────
    // Igual que en Bre-B: un timeout o un 5xx no significan "no salió". Si
    // se devolviera el saldo y el retiro sí se creó, el cliente cobra dos
    // veces. Queda en Procesando para revisión y se avisa a los admins.
    if ((fin.error as any)?.desenlaceDesconocido) {
      await asentarTx('Procesando', {
        // feeCop debitado: con fin.feeCop (0 en este camino) una devolución
        // posterior reintegraba el monto sin la comisión.
        ...prettyBase, feeProvider: 'finity', feeCop,
        desenlaceDesconocido: true, revisionManual: true,
        httpStatus: (fin.error as any)?.httpStatus ?? null,
        error: (fin.error as any)?.body ?? 'sin_respuesta',
        sinConfirmarDesde: new Date().toISOString(),
      })
      await logAudit(userId, `finity.${action}.desenlace_desconocido`, { txId, amount, httpStatus: (fin.error as any)?.httpStatus ?? null })
      await avisarAdminSinConfirmar({ id: txId, user_id: userId, amount, currency: railCol, raw_data: prettyBase })
      await notifyTx(txId)
      return json(200, {
        ok: true, status: 'Procesando', confirmada: false, desenlaceDesconocido: true,
        message: 'No pudimos confirmar el envío con el banco. NO lo reintentes: lo estamos verificando y te avisamos en minutos.',
        feeCop, newBalance: afterDebit,
      })
    }

    // Finity dijo que NO (rechazo claro) → REINTEGRAR monto + comisión.
    const reintA = await reintegrarEnvio(userId, railCol, totalDebit)
    const restored5 = reintA.saldo ?? 0
    const finErr: any = fin.error
    // El motivo vive en error.BODY ({ step, httpStatus, path, body }). Se leía
    // error.message, que nunca existe: los motivos propios ("el banco todavía
    // está validando esta cuenta destino", "al contacto le faltan datos") se
    // perdían y el comprobante decía "el operador no entregó el motivo" de un
    // envío que ni siquiera había llegado al operador.
    const finMsgRaw = (typeof finErr === 'string' ? finErr
      : (finErr?.body?.message ?? finErr?.body?.error?.message ?? digMotivoRechazo(finErr?.body) ?? finErr?.message ?? finErr?.detail ?? finErr?.error?.message)) as string | undefined
    const finPaso = String(finErr?.step ?? '')
    const detail = (() => { try { return JSON.stringify(fin.error ?? fin).slice(0, 350) } catch { return String(fin.error ?? 'sin detalle') } })()
    // AL CLIENTE: mensaje LIMPIO. Solo se usa el texto si es un motivo que el
    // cliente entiende (sin JSON, jerga en inglés ni nombres de aliados).
    const finMsg = motivoParaCliente(finMsgRaw)
    // errorMessage: el motivo legible si lo hay (lo ven el comprobante y el
    // Panel de Fallos); si no, el detalle técnico. El cuerpo entero queda en `error`.
    await asentarTx('Fallido', { ...prettyBase, feeProvider: 'finity', error: fin.error ?? 'finity_failed', errorMessage: finMsg ?? finMsgRaw ?? detail ?? null, pasoFallido: finPaso || null, noSalio: true, ...marcasReintegro(reintA.ok), failedAt: new Date().toISOString() })
    if (!reintA.ok) await avisarAdminSinConfirmar({ id: txId, user_id: userId, amount, currency: railCol, created_at: new Date().toISOString(), raw_data: { ...prettyBase, reembolsoPendiente: true } })
    await logAudit(userId, `finity.${action}.fail`, { amount, paso: finPaso || null, error: JSON.stringify(fin.error ?? {}).slice(0, 400) })
    await notifyTx(txId) // correo "no pudimos completar tu envío · saldo devuelto"
    const friendlyAch = finMsg
      ? `No pudimos completar la transferencia ACH: ${finMsg}. Tu saldo fue devuelto.`
      // Falló al inscribir o validar la cuenta destino: el envío ni salió.
      : finPaso === 'destino'
        ? 'No pudimos inscribir la cuenta destino con el banco, así que el envío no salió. Revisa los datos del beneficiario (banco, número y tipo de cuenta, tipo y número de documento). Tu saldo fue devuelto.'
        : `No pudimos completar la transferencia ACH en este momento. Tu saldo fue devuelto — puedes intentarlo de nuevo en unos minutos.`
    await soltarCandados()
    return json(200, { error: 'payout_failed', refunded: reintA.ok, newBalance: restored5,
      message: conReintegro(friendlyAch, reintA.ok) })
  }

  return json(200, { error: 'unknown_action', message: `Acción no soportada: ${action}` })
})
