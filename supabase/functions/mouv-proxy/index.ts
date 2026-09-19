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
import { FIELD_ENC_KEY, decField } from '../_shared/field-crypto.ts'
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
async function creditBalanceAtomic(userId: string, col: string, delta: number): Promise<void> {
  const { error } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [col]: delta } })
  if (!error) return
  const { data: u } = await db.from('users').select('balances').eq('id', userId).single()
  const bals: Record<string, number> = (u?.balances as any) ?? {}
  const nb = parseFloat((Number(bals[col] ?? 0) + delta).toFixed(2))
  await db.from('users').update({ balances: { ...bals, [col]: nb } }).eq('id', userId)
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ type: 'UPDATE', table: 'transactions', record: full }),
    })
  } catch { /* correo best-effort — nunca romper el flujo de dinero */ }
}

// Llamada autenticada a Mouv. Timeout duro para no colgar el proxy si Mouv
// no responde. Devuelve { ok, status, data, path } sin lanzar.
async function mouvFetch(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; path: string }> {
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
  found: boolean; matchedKey: string; fullName?: string; idValue?: string; keyType?: string; bank?: string; raw?: any;
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
  for (const kv of variants) {
    try {
      const rk = await mouvFetch('/transfers/resolve-key', { method: 'POST', body: JSON.stringify({ keyValue: kv }) })
      const rd: any = rk.data ?? {}
      lastRaw = rd
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
  return { found: false, matchedKey: key, raw: lastRaw }
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
    if (!targetName || !targetDocument) {
      return { ok: false, status: 0, data: { error: 'missing_sarlaft', message: 'No se pudo obtener el titular de la llave (nombre/documento requeridos por SARLAFT).', resolveDebug: rr.raw ?? null } }
    }

    // Referencia ÚNICA por envío: si Mouv dedupe por referencia (409 Conflict
    // al repetir {monto, destino, referencia}), un reintento tras reembolso o
    // dos envíos iguales chocarían. El sufijo corto evita la colisión.
    const refBase = cleanField(recipient.reference) ?? 'Pago Lincoin'
    const refUniq = `${refBase} ${Date.now().toString(36).slice(-5)}`
    const r = await mouvFetch('/transfers/send', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountCents,
        destination: { brebKey: { type: keyType, value: sendKey } },
        targetName,
        targetDocument,
        reference: refUniq,
      }),
    })
    // Devolver el titular RESUELTO (oficial, de resolve-key) para que el
    // comprobante muestre el nombre/documento reales del beneficiario.
    // La referencia EXACTA que se mando vuelve con el resultado. Sin esto no
    // quedaba guardada en ningun lado -- `reason` tiene la base, no el sufijo
    // unico -- y era otra forma de no poder reencontrar el envio en Mouv.
    return { ok: r.ok, status: r.status, data: r.data, providerRef: r.data?.id, referencia: refUniq, targetName, targetDocument }
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
  return { ok: r.ok, status: r.status, data: r.data, providerRef: r.data?.id, targetName: recipient.holderName, targetDocument: recipient.documentNumber }
}

// ── Estado REAL de una transferencia Mouv ───────────────────────────
// Mouv responde /transfers/send con 201 { id, status:'PENDING', rail }: el
// 200 SÓLO significa "aceptada para procesar", NO "pagada". La transferencia
// puede terminar DEVUELTA (rechazada por el banco destino) minutos después.
// Este normalizador clasifica cualquier estado (español o inglés) de Mouv en
// un veredicto accionable, para no marcar Completado algo que fue devuelto.
type MouvVerdict = 'completed' | 'returned' | 'pending' | 'unknown'
function normalizeMouvState(raw: any): { verdict: MouvVerdict; state: string } {
  const pickState = (o: any): string => {
    if (o == null) return ''
    if (typeof o === 'string') return o
    return String(o.status ?? o.state ?? o.transferStatus ?? o.result ?? o?.data?.status ?? o?.data?.state ?? '')
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

async function mouvTransferStatus(id: string): Promise<EstadoMouv> {
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
  // responde TRANSACTION_NOT_FOUND para lo primero, y eso ES una respuesta: no
  // tiene sentido seguir probando seis rutas adivinadas con un id que el
  // proveedor ya dijo que no reconoce.
  const esIdInexistente = (data: any): boolean => {
    try { return JSON.stringify(data ?? '').includes('TRANSACTION_NOT_FOUND') } catch { return false }
  }
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
async function mouvListarBrebOut(desdeISO: string): Promise<{ ok: boolean; items: any[]; diag?: any }> {
  const desde = String(desdeISO ?? '').slice(0, 10)   // el filtro `from` es una fecha
  const items: any[] = []
  let primera: any = null
  // Tope de 5 paginas (500 movimientos): mas que eso no entra en la ventana de
  // conciliacion, y un bucle sin tope contra un proveedor es una forma de
  // colgar la funcion.
  for (let page = 0; page < 5; page++) {
    const r = await mouvFetch(`/wallets/transactions?type=TRANSFER_OUT&rail=BREB&from=${desde}&limit=100&page=${page}`, { method: 'GET' })
    if (!primera) primera = { ruta: '/wallets/transactions', httpStatus: r.status, cuerpo: (() => { try { return (typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '')).slice(0, 400) } catch { return '(ilegible)' } })() }
    if (!r.ok) {
      const motivo = r.status === 401 || r.status === 403 ? `la llave no tiene permiso de lectura (HTTP ${r.status})`
        : r.status === 429 ? 'limite de consultas (429)'
        : r.status === 404 ? 'la ruta del listado devolvio 404'
        : r.status === 0 ? 'no se pudo conectar con Mouv'
        : `respuesta inesperada (HTTP ${r.status})`
      return { ok: false, items, diag: { motivo, ...primera } }
    }
    const lote = Array.isArray((r.data as any)?.items) ? (r.data as any).items : []
    items.push(...lote)
    if (!(r.data as any)?.hasMore || lote.length === 0) break
  }
  return { ok: true, items }
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
function emparejarConMouv(rd: any, montoCop: number, items: any[], reclamados: Set<string>): any | null {
  // La referencia exacta, si la fila la guardo, es una coincidencia sin
  // ambiguedad: la generamos nosotros con un sufijo unico por envio.
  const refExacta = String(rd?.providerReference ?? '').trim()
  if (refExacta) {
    const porRef = items.filter(it => !reclamados.has(String(it?.id ?? '')) && String(it?.reference ?? '') === refExacta)
    if (porRef.length === 1) return porRef[0]
  }
  const doc = String(rd?.documentNumber ?? rd?.recipient?.documentNumber ?? '').replace(/\D/g, '')
  if (!doc) return null
  const centavos = Math.round(Number(montoCop) * 100)
  if (!(centavos > 0)) return null
  const cand = items.filter(it =>
    !reclamados.has(String(it?.id ?? '')) &&
    Math.round(Number(it?.amount ?? 0)) === centavos &&
    String(it?.targetDocument ?? '').replace(/\D/g, '') === doc)
  return cand.length === 1 ? cand[0] : null
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
async function finityCall(action: string, userId: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/finity-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action, user_id: userId, ...extra }),
  })
  return r.json().catch(() => null)
}
// Precio por transferencia ACH que SE COBRA AL CLIENTE: $2.500 COP por
// envío (override con el secret ACH_FEE_COP). Finity no devuelve costs en
// la orden — doc oficial: { id, status, amount, destination_account }.
const ACH_FEE_COP = Number(Deno.env.get('ACH_FEE_COP') ?? '2500') || 2500
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
    destId = ea?.data?.id ?? ea?.data?.external_account_id ?? ea?.data?.account_id ?? null

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
  // 1.b) La cuenta destino tiene que estar APROBADA por el banco. El estado
  //      que muestra Lincoin no sirve como control: vive en los contactos del
  //      usuario, que el propio cliente puede escribir. El único que manda es
  //      el proveedor, así que se le pregunta a él antes de mover plata.
  //
  //      Se miran TODOS los campos de estado y gana el más restrictivo: una
  //      cuenta puede venir "active" (el registro existe) y a la vez en
  //      revisión (el banco no la aprueba todavía). Son cosas distintas.
  //
  //      FALLA ABIERTO a propósito: si no se puede consultar la lista, o la
  //      cuenta no aparece, el envío sigue. Un control que no logra verificar
  //      no puede frenar una transferencia legítima — y si de verdad no está
  //      aprobada, el proveedor la rechaza y el saldo se devuelve.
  try {
    const lista = await finityCall('external_accounts', userId)
    const filas: any[] = lista?.data?.data ?? lista?.data?.results ?? (Array.isArray(lista?.data) ? lista.data : [])
    const fila = filas.find((r: any) => {
      const rid = String(r?.id ?? r?.external_account_id ?? r?.account_id ?? '')
      if (destId && rid && rid === destId) return true
      const acc = String(r?.account_number ?? r?.account?.account_number ?? '').replace(/\D/g, '')
      return !!acc && acc === accDigits
    })
    if (fila) {
      const textos = [fila.verification_status, fila.estado, fila.state, fila.status]
        .filter((v: unknown) => v !== undefined && v !== null && String(v).trim() !== '')
        .map((v: unknown) => String(v).toLowerCase())
      const rechazada = textos.some(s => /rechaz|reject|denied|declin|fail/.test(s))
      // Aprobada SOLO con una palabra que lo diga. "active" o "enabled"
      // describen el registro, no el veredicto: una cuenta en revisión también
      // es un registro activo.
      const aprobada = textos.some(s => /aprob|approv|verified/.test(s))
      const enRevision = !rechazada && !aprobada && textos.length > 0
      if (rechazada || enRevision) {
        await logAudit(userId, 'finity.payout.destino_no_aprobado', {
          destinationId: destId, cuenta: accDigits, estadoProveedor: textos.join(' · '),
        })
        return {
          ok: false, feeCop: 0,
          error: {
            step: 'destino', httpStatus: null, path: null,
            body: {
              message: rechazada
                ? 'El banco rechazó esta cuenta destino. Revisa los datos del beneficiario e inscríbela de nuevo.'
                : 'El banco todavía está validando esta cuenta destino. Podrás transferirle apenas la apruebe.',
            },
          },
        }
      }
    }
  } catch { /* no se pudo verificar: sigue, el proveedor tiene la última palabra */ }

  // 2) Orden de retiro:
  //    POST /v0/withdrawal-orders { destination_id, amount, currency:'COP' }
  //    ⚠️ amount va en PESOS ENTEROS — NO en centavos. VERIFICADO CONTRA
  //    PRODUCCIÓN: una dispersión de $10.000 enviada como 1.000.000
  //    (pesos × 100, como decía la doc de "unidades menores") creó en
  //    Finity un retiro REAL de COP $1.000.000. NUNCA multiplicar aquí.
  //    → 201 { id, status: PROCESSING|COMPLETED|FAILED, destination_account }
  //    (NO devuelve costs — el precio por transferencia es ACH_FEE_COP.)
  const requestedCop = Math.round(amountCop)
  const w = await finityCall('create_withdrawal', userId, { data: { amount: requestedCop, currency: 'COP', destination_id: destId } })
  const od: any = w?.data ?? {}
  // El error DEBE conservar status/path/cuerpo — con '{}' pelado es
  // imposible saber si fue ruta (404), auth (401) o validación (400).
  if (!w?.ok || !od.id) return {
    ok: false, feeCop: 0, destinationId: destId ?? undefined,
    error: { step: 'retiro', httpStatus: w?.status ?? null, path: w?.path ?? null, body: (od && Object.keys(od).length > 0) ? od : (w?.data ?? w ?? null) },
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

// Registro de auditoría best-effort (no bloquea la operación).
async function logAudit(userId: string | null, action: string, metadata: Record<string, unknown>) {
  try {
    await db.from('audit_log').insert({ user_id: userId, action, metadata })
  } catch { /* la tabla puede no existir en este proyecto — no romper */ }
}

// Valida quién llama: admin-bypass (header compartido) o un usuario real con
// JWT válido. Balance y payouts son sensibles → siempre requieren caller.
async function validCaller(req: Request, payload: any): Promise<{ ok: boolean; userId: string | null; admin: boolean; viaJwt: boolean }> {
  const authHeader = req.headers.get('Authorization') ?? ''
  // (El "AdminBypass <password>" se eliminó: secreto compartido que se filtraba
  //  en el bundle del frontend. El admin real entra por JWT con role='admin'.)
  const jwt = authHeader.replace('Bearer ', '').trim()
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
          const refund = Number(dtx.amount ?? 0) + Number(drd.feeCop ?? 0)
          const railCol = String(dtx.currency ?? 'COP_BREB')
          const { data: claimed } = await db.from('transactions').update({
            status: 'Rechazado',
            raw_data: { ...drd, refunded: true, refundCop: refund, providerState: st.state, returnedAt: new Date().toISOString(), source_event: 'mouv_webhook' },
          }).eq('id', dtx.id).filter('raw_data->>refunded', 'is', null).select('id')
          if (claimed?.length) {
            await creditBalanceAtomic(dtx.user_id, railCol, refund)
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

  const caller = await validCaller(req, payload)
  if (!caller.ok) return json(401, { error: 'unauthorized', message: 'Tu sesión expiró. Vuelve a iniciar sesión.' })

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
    const rr = await mouvResolveBrebKey(rawKey, String((payload as any).keyType ?? ''))
    if (!rr.found) return json(200, { ok: true, found: false, message: 'La llave Bre-B no existe o no está activa.', debug: rr.raw ?? null })
    return json(200, { ok: true, found: true, matchedKey: rr.matchedKey, fullName: rr.fullName ?? null, idValue: rr.idValue ?? null, keyType: rr.keyType ?? null, bank: rr.bank ?? null })
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
    const { data: rows } = await db.from('transactions')
      .select('id, user_id, amount, currency, status, raw_data')
      .eq('type', 'dispersion').eq('user_id', userId).eq('status', 'Procesando')
      .limit(20)
    const out: any[] = []
    for (const tx of (rows ?? []) as any[]) {
      const rd = (tx.raw_data ?? {}) as Record<string, any>
      const ref = String(rd.providerRef ?? '')
      if (!ref) continue
      const st = await finityCall('withdrawal_status', String(userId), { id: ref })
      const d = (st?.data ?? {}) as any
      // Finity devuelve el estado en distintos niveles según el endpoint; se
      // excava en todos (antes sólo leía d.status/d.state y, si venía anidado,
      // quedaba vacío → la dispersión se atascaba en 'Procesando').
      const s = String(
        d?.status ?? d?.state ?? d?.data?.status ?? d?.data?.state ??
        d?.order?.status ?? d?.order?.state ?? d?.attributes?.status ?? d?.attributes?.state ?? ''
      ).toUpperCase()
      // Estados terminales de Finity (incluye variantes en español que antes no
      // se reconocían y dejaban la dispersión atascada en 'Procesando').
      if (/COMPLET|SETTLE|LIQUID|PAGAD|\bPAID\b|SUCCESS|FINALIZ|DISPERSAD|EXITOS|APROBAD|APPROVED/.test(s)) {
        await db.from('transactions').update({
          status: 'Completado',
          raw_data: { ...rd, providerStatus: s, reconciledAt: new Date().toISOString() },
        }).eq('id', tx.id).neq('status', 'Rechazado')
        out.push({ id: tx.id, result: 'completed' })
      } else if (/FAILED|FALLID|REJECT|RECHAZ|CANCEL|ANUL|DECLIN|RETURN|DEVUEL/.test(s)) {
        if (rd.refunded) { out.push({ id: tx.id, result: 'already_refunded' }); continue }
        const refund = Number(tx.amount ?? 0) + Number(rd.feeCop ?? 0)
        const railCol = String(tx.currency ?? 'COP_ACH')
        // CAS: reclamar el reembolso ANTES de tocar el saldo. Si el webhook (o
        // una ejecución paralela de reconcile_ach) ya reclamó, claimed viene
        // vacío y NO se acredita de nuevo — evita el doble reembolso.
        const { data: claimed } = await db.from('transactions').update({
          status: 'Rechazado',
          raw_data: { ...rd, refunded: true, refundCop: refund, providerStatus: s, reconciledAt: new Date().toISOString() },
        }).eq('id', tx.id).neq('status', 'Rechazado').filter('raw_data->>refunded', 'is', null).select('id')
        if (!claimed?.length) { out.push({ id: tx.id, result: 'refund_already_claimed' }); continue }
        await creditBalanceAtomic(userId, railCol, refund)   // atómico (pentest #3)
        out.push({ id: tx.id, result: 'refunded', refund })
      } else {
        out.push({ id: tx.id, result: 'still_processing', providerStatus: s || null })
      }
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
    const userId = requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Vuelve a iniciar sesión.' })
    // Ventana de conciliación para las ya-Completadas: una devolución bancaria
    // llega en horas/pocos días. Se revisan las Completadas de los últimos N
    // días (default 5), más TODAS las que sigan 'Procesando'. Overridable.
    const days = Number(Deno.env.get('BREB_RECONCILE_DAYS') ?? '5') || 5
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    // TODOS LOS CLIENTES (solo admin). La conciliacion por cliente depende de
    // que ESE cliente abra la app, y una devolucion no puede quedar esperando a
    // que a alguien se le ocurra entrar: la plata ya volvio y el saldo sigue
    // debitado. Con esto la mesa cierra el circulo desde el panel.
    const todos = caller.admin && caller.viaJwt && payload?.todos === true
    let q = db.from('transactions')
      .select('id, user_id, amount, currency, status, raw_data, created_at')
      .eq('type', 'dispersion').eq('currency', 'COP_BREB')
      .in('status', ['Procesando', 'Completado'])
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
    const reclamados = new Set<string>()
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
          // El id de Mouv es un UUID. Exigir la FORMA evita agarrar por error
          // un id nuestro (numerico) y preguntarle a Mouv por algo que no es.
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sv)) return { ref: sv, campo }
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
        const m = emparejarConMouv(rd, Number(tx.amount ?? 0), listado.items, reclamados)
        if (m) {
          item = m
          ref = String(m.id ?? '')
          origenRef = 'emparejado por monto + documento'
          reclamados.add(ref)
          // Se GUARDA para que la proxima vez sea exacto y no haya que volver
          // a emparejar. Queda marcado como emparejado y no como dato de
          // primera mano: dentro de seis meses eso tiene que distinguirse.
          await db.from('transactions').update({
            raw_data: { ...rd, providerRef: ref, providerRefOrigen: 'conciliacion_por_listado', providerRefAt: new Date().toISOString() },
          }).eq('id', tx.id)
          rd.providerRef = ref
        }
      }

      const st: EstadoMouv = item
        ? (() => { const n = normalizeMouvState(item); return { found: !!n.state, verdict: n.verdict, state: n.state, raw: item, path: '/wallets/transactions' } })()
        : ref ? await mouvTransferStatus(ref)
        : {
            found: false, verdict: 'unknown', state: '', raw: null,
            diag: {
              motivo: listado.ok
                ? 'sin id guardado y sin un unico movimiento de Mouv que coincida (monto + documento)'
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
        const refund = Number(tx.amount ?? 0) + Number(rd.feeCop ?? 0)
        const railCol = String(tx.currency ?? 'COP_BREB')
        // CAS: reclamar el reembolso ANTES de tocar el saldo. Si una ejecución
        // paralela ya reclamó, `claimed` viene vacío y NO se acredita de nuevo.
        // El motivo que da Mouv (`errorMessage` de /wallets/transactions/:id)
        // se guarda: "fue devuelto" sin decir por que obliga a abrir la consola
        // del proveedor para contestarle al cliente lo mas basico.
        const motivoProveedor = (() => {
          const m = (st.raw as any)?.errorMessage ?? (st.raw as any)?.data?.errorMessage
          return typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : null
        })()
        const { data: claimed } = await db.from('transactions').update({
          status: 'Rechazado',
          raw_data: { ...rd, refunded: true, refundCop: refund, providerState: st.state, providerError: motivoProveedor, returnedAt: new Date().toISOString(), reconciledAt: new Date().toISOString() },
        }).eq('id', tx.id).filter('raw_data->>refunded', 'is', null).select('id')
        if (!claimed?.length) { out.push({ id: tx.id, result: 'refund_already_claimed' }); continue }
        // El reembolso va al DUEÑO DE LA FILA, no a quien llamó. Con el barrido
        // de todos los clientes, `userId` es el admin que apretó el botón —
        // acreditarle a él la devolución de otro sería mover plata a la cuenta
        // equivocada.
        const duenio = String(tx.user_id)
        await creditBalanceAtomic(duenio, railCol, refund)
        await logAudit(duenio, 'mouv.reconcile_breb.refunded', { txId: tx.id, refund, providerState: st.state, providerError: motivoProveedor, providerRef: ref })
        await notifyTx(tx.id) // correo "tu envío fue devuelto · saldo reintegrado"
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
          if (enviado) await db.from('transactions').update({ raw_data: { ...rd, alertaEnviada: true, alertaAt: new Date().toISOString() } }).eq('id', tx.id)
        }
        await db.from('transactions').update({
          raw_data: {
            ...rd,
            providerState: st.state || null,
            sinConfirmarDesde: rd.sinConfirmarDesde ?? new Date().toISOString(),
            ultimaRevision: new Date().toISOString(),
            revisionManual: revisar || undefined,
          },
        }).eq('id', tx.id).eq('status', 'Procesando')
        out.push({
          id: tx.id,
          result: revisar ? 'sin_confirmar_revisar' : 'still_processing',
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
        }).eq('id', tx.id)
        out.push({ id: tx.id, result: 'completado_sin_confirmar', providerState: st.state || null })
      } else {
        out.push({ id: tx.id, result: 'still_completed', ...(caller.admin ? { diag: st.diag ?? null } : {}) })
      }
    }
    return json(200, { ok: true, checked: (rows ?? []).length, results: out })
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

    const refund = Number(tx.amount ?? 0) + Number(rd.feeCop ?? 0)
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

    await creditBalanceAtomic(tx.user_id, railCol, refund)
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
      // Y que la referencia sea SUYA. Tener sesión no da derecho a mirar el
      // cobro de otro con solo cambiar el número.
      if (!caller.admin) {
        const { data: mio } = await db.from('transactions').select('id')
          .eq('user_id', String(userId))
          .or(`raw_data->>reference.eq.${ref},raw_data->>providerRef.eq.${ref}`)
          .limit(1)
        if (!mio?.length) return json(403, { error: 'forbidden', message: 'Operación restringida.' })
      }
      const paths = [`/collections/${ref}`, `/payin/${ref}`, `/pse/${ref}`, `/transfers/collect/${ref}`, `/collections/status/${ref}`]
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
            raw_data: { source: 'mouv_payin_pse', method: 'PSE', reference, providerRef, link, title: 'Recaudo PSE (link)', createdAt: new Date().toISOString() },
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
    if (rail === 'BREB') {
      const fee = brebFeeCop(amount)
      return json(200, { ok: true, rail: 'BREB', provider: 'lincoin', feeCop: fee, fixedCop: fee, variableCop: 0, ivaCop: 0, totalCop: amount + fee })
    }
    // ACH: comisión FIJA única ($2.500) — SIN componente variable.
    return json(200, { ok: true, rail: 'ACH', provider: 'finity', feeCop: ACH_FEE_COP, fixedCop: ACH_FEE_COP, variableCop: 0, ivaCop: 0, totalCop: amount + ACH_FEE_COP })
  }

  // ── dispersión BREB (Mouv) / ACH (Finity) ──
  // El cliente dispersa contra su SALDO INTERNO del riel (COP_BREB / COP_ACH).
  // La COMISIÓN al cliente:
  //   BREB → $1.200 fijos por envío (BREB_FEE_COP); se debita monto + 1.200.
  //   ACH  → precio fijo Finity (ACH_FEE_COP); se debita monto + tarifa.
  // Si el proveedor falla, se REINTEGRA todo lo debitado.
  if (action === 'payout_breb' || action === 'payout_ach') {
    const rail: 'BREB' | 'ACH' = action === 'payout_breb' ? 'BREB' : 'ACH'
    const railCol = action === 'payout_breb' ? 'COP_BREB' : 'COP_ACH'
    // SEGURIDAD: mover dinero exige identidad PROBADA con JWT real (o admin).
    // Un simple user_id en el body ya NO autoriza un payout — así nadie drena
    // la cuenta de otro con solo la llave pública + el id de la víctima.
    const userId = requireOwner(caller, payload)
    if (!userId) return json(403, { error: 'forbidden', message: 'Esta operación requiere una sesión válida. Vuelve a iniciar sesión.' })

    // GUARDIA DE BLOQUEO / LISTA NEGRA — una cuenta bloqueada (p. ej. por
    // hackeo) NO puede dispersar dinero aunque llame la API directo.
    {
      // NO se usa `is_active`: esa columna la maneja el módulo de Personas y en
      // Empresas nadie la pone en true, así que marcaba cuentas legítimas como
      // bloqueadas y les cortaba las dispersiones COP.
      const { data: bU } = await db.from('users').select('is_blocked, raw_data').eq('id', userId).maybeSingle()
      const bRaw = ((bU as any)?.raw_data ?? {}) as Record<string, any>
      if (bU && (bRaw.blacklisted === true || (bU as any).is_blocked === true || bRaw.isBlocked === true)) {
        return json(403, { error: 'blocked', message: bRaw.blacklisted === true ? 'Esta cuenta está en la lista negra y no puede realizar operaciones.' : 'Esta cuenta está bloqueada y no puede realizar operaciones. Contacta a soporte.' })
      }
    }

    // ── 2FA en el SERVIDOR: si el usuario tiene la verificación en dos pasos
    //    activa, el código TOTP se valida AQUÍ antes de mover un peso — no
    //    basta con haber pasado la pantalla del navegador. (Admin/AdminBypass
    //    exceptuado: es una operación de soporte.) ────────────────────────────
    if (!caller.admin) {
      const { data: mfaU } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
      const mraw = ((mfaU as any)?.raw_data ?? {}) as Record<string, any>
      if (mraw.mfaEnabled) {
        // FALLA CERRADO: si el 2FA está activo pero el secreto no se puede
        // obtener (error al descifrar, llave FIELD_ENC_KEY ausente/rotada), se
        // BLOQUEA — nunca se deja pasar el envío sin verificar.
        let mfaSecret = ''
        try { mfaSecret = mraw.totpSecretEnc ? await decField(String(mraw.totpSecretEnc)) : String(mraw.totpSecret ?? '') } catch { mfaSecret = '' }
        const otp = String(payload.otp ?? payload.totp ?? '')
        if (!mfaSecret || !(await verifyTOTPServer(mfaSecret, otp))) {
          return json(403, { error: 'mfa_required', message: 'No pudimos verificar tu código de dos pasos. Vuelve a intentar el envío.' })
        }
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
        const docInscrito = soloDig(hit?.docNumber)
        if (docInscrito) {
          if (docDest && docDest !== docInscrito) {
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
            if (rrPrev?.found && docReal && docReal !== docDest) {
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
      if (docDest) {
        try {
          const { data: tdRow } = await db.from('system_config').select('value').eq('key', 'tusdatos_config').maybeSingle()
          const tdCfg = (tdRow as any)?.value ? JSON.parse((tdRow as any).value) : null
          if (tdCfg?.activo) {
            const f = (rawU?.tusdatos?.beneficiarios ?? {})[docDest]
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
            const bloquea = duro || noOperable || medio
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
        try {
          const { data: cfgRow } = await db.from('system_config').select('value').eq('key', 'kumplo_config').maybeSingle()
          const cfg = (cfgRow as any)?.value ? JSON.parse((cfgRow as any).value) : null
          if (cfg?.activo && cfg?.bloquearEnAlto !== false) {
            const b = (rawU?.kumplo?.beneficiarios ?? {})[docDest]
            // Un veredicto DE VERDAD: o Kumplo dijo operable sí/no, o dio un
            // nivel de riesgo real. 'desconocido' NO es un veredicto — es
            // justamente que no pudieron determinarlo, y antes contaba como
            // uno: bastaba que el campo existiera para que el envío se
            // bloqueara diciendo que la persona estaba restringida por
            // cumplimiento sin que nadie la hubiera juzgado.
            // Y tampoco se confía en un 'operable' guardado junto a un riesgo
            // 'desconocido': esas fichas las escribió la versión que deducía el
            // veredicto, y ese false no lo dijo Kumplo. Se vuelven a consultar.
            const hayVeredicto = !!b && String(b.riesgo ?? '') !== 'desconocido' && (
              typeof b.operable === 'boolean' ||
              ['bajo', 'medio', 'alto'].includes(String(b.riesgo ?? ''))
            )
            if (hayVeredicto && String(b.estado ?? '') !== 'procesando') {
              const puede = cfg.soloBloquearAlto ? b.riesgo !== 'alto' : b.operable !== false
              if (!puede) {
                await logAudit(userId, 'kumplo.envio_bloqueado', { documento: docDest, riesgo: b.riesgo, estado: b.estado })
                return json(403, {
                  error: 'beneficiario_no_operable',
                  message: b.riesgo === 'alto'
                    ? 'No se puede transferir a este beneficiario: la verificación de cumplimiento lo marcó como riesgo alto.'
                    : b.riesgo === 'desconocido'
                      ? 'No pudimos validar el documento de este beneficiario. Revísalo o comunícate con soporte.'
                      : 'Este beneficiario está en revisión de cumplimiento. Todavía no se le puede transferir.',
                })
              }
            }
          }
        } catch { /* la prueba nunca frena un envío legítimo */ }
      }
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
    // ACH permite hasta $50.000.000 por transferencia (Finity). Bre-B sigue en
    // $12.000.000 (tope de Mouv por transferencia). Ambos overridables por secret.
    const ACH_MAX_COP    = Number(Deno.env.get('ACH_MAX_COP')    ?? '50000000') || 50000000
    const perOpMax = rail === 'BREB' ? BREB_MAX_COP : ACH_MAX_COP
    if (amount > perOpMax) {
      return json(400, { error: 'over_limit', message: rail === 'BREB'
        ? `Bre-B permite máximo ${perOpMax.toLocaleString('es-CO')} COP por transferencia. Divide el envío en varias operaciones o usa la Mesa OTC.`
        : `El monto supera el límite por operación (${perOpMax.toLocaleString('es-CO')} COP). Para montos mayores usa la Mesa OTC.` })
    }
    // (2) Idempotencia / anti doble-clic: si YA existe una dispersión idéntica
    //     (mismo usuario, riel y monto) creada hace menos de 2 minutos y que
    //     no fue rechazada, se bloquea el reenvío — dos toques al botón
    //     Confirmar no pueden ejecutar la operación dos veces.
    try {
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString()
      const { data: dup } = await db.from('transactions')
        .select('id, status, created_at')
        .eq('user_id', userId).eq('type', 'dispersion').eq('currency', railCol).eq('amount', amount)
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

    // 1) Comisión que SE COBRA AL CLIENTE
    //    BREB → FIJA Lincoin ($1.200 por envío, BREB_FEE_COP). El costo
    //           real de Mouv lo absorbe Lincoin; el 0,10% ya se cobró al
    //           recibir el cargue Bre-B.
    //    ACH  → precio fijo por transferencia Finity (ACH_FEE_COP).
    let feeCop = 0
    let feeDetail: Record<string, unknown> = {}
    if (rail === 'BREB') {
      feeCop = brebFeeCop(amount)
      feeDetail = { feeCop, feeFixedCop: feeCop, feeVariableCop: 0, feeIvaCop: 0, feeProvider: 'lincoin' }
    } else {
      feeCop = ACH_FEE_COP
      feeDetail = { feeCop, feeProvider: 'finity' }
    }
    const totalDebit = Number((amount + feeCop).toFixed(2))

    // 2-3) Debitar monto + comisión de forma ATÓMICA (bloqueo de fila) — así
    //      una operación concurrente no puede "restaurar" el riel debitado y
    //      duplicar fondos (pentest #4). Fallback a read-check-write si la RPC
    //      adjust_balances aún no está desplegada.
    let afterDebit = 0
    const { data: adjDeb, error: adjDebErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [railCol]: -totalDebit } })
    if (!adjDebErr) {
      const e = (adjDeb as any)?.error
      if (e === 'not_found') return json(404, { error: 'user_not_found', message: 'Usuario no encontrado.' })
      if (e) return json(400, { error: 'insufficient_funds', message: `Saldo ${rail} insuficiente para monto + comisión (${totalDebit.toLocaleString('es-CO')} COP).` })
      afterDebit = Number(((adjDeb as any)?.balances?.[railCol]) ?? 0)
    } else {
      const { data: u } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
      if (!u) return json(404, { error: 'user_not_found', message: 'Usuario no encontrado.' })
      const bals: Record<string, number> = (u.balances as any) ?? {}
      const current = Number(bals[railCol] ?? 0)
      if (current < totalDebit) return json(400, { error: 'insufficient_funds', message: `Saldo ${rail} insuficiente para monto + comisión (${totalDebit.toLocaleString('es-CO')} COP). Disponible: ${current.toLocaleString('es-CO')} COP.` })
      afterDebit = Number((current - totalDebit).toFixed(2))
      const { error: debErr } = await db.from('users').update({ balances: { ...bals, [railCol]: afterDebit } }).eq('id', userId)
      if (debErr) return json(500, { error: 'debit_failed', message: 'No se pudo reservar el saldo. Intenta de nuevo.' })
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
      title: `Dispersión ${railLabel}`,
      beneficiary: recipient.holderName ?? null,
      bank: rail === 'BREB' ? `Bre-B · ${keyTypeLabel}` : (recipient.bankCode ?? 'ACH'),
      account: rail === 'BREB' ? (recipient.key ?? null) : (recipient.accountNumber ?? null),
      ...(recipient.documentNumber ? { documentNumber: recipient.documentNumber } : {}),
      ...(recipient.documentType ? { documentType: recipient.documentType } : {}),
      ...(recipient.reference ? { reason: recipient.reference } : {}),
      recipient,
    }
    // El ERROR de este insert NO se puede descartar. Antes se leía solo `data`
    // y, si el insert fallaba, el código seguía adelante con txId = null: el
    // dinero salía y el movimiento NO EXISTÍA en ninguna parte. Para el cliente
    // eso se ve como "hice la transferencia y no me aparece" — sin rastro,
    // porque nadie se enteró de que la fila nunca se escribió.
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

    // Deja el movimiento en su estado final. Si la fila no llegó a crearse, la
    // CREA ahora — el envío ya ocurrió, así que el registro tiene que existir
    // sí o sí. Antes cada sitio hacía `if (txId) update(...)`: sin fila, el
    // movimiento se perdía para siempre y el cliente no tenía cómo verlo.
    const asentarTx = async (status: string, raw: Record<string, unknown>) => {
      if (txId) { await db.from('transactions').update({ status, raw_data: raw }).eq('id', txId); return }
      const { data: tardio } = await db.from('transactions')
        .insert({ user_id: userId, type: 'dispersion', amount, currency: railCol, status, raw_data: raw })
        .select('id').maybeSingle()
      txId = (tardio as any)?.id ?? null
      if (txId) await logAudit(userId, 'mouv.tx_insert_tardio', { txId, status })
    }

    // 4) Llamar al PROVEEDOR del riel: BREB → Mouv · ACH → Finity
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
        return json(200, { ok: true, status: estado, confirmada, providerRef: pay.providerRef ?? null, providerState: sendState.state || null, feeCop, newBalance: afterDebit })
      }
      // Falló (o el send ya vino DEVUELTO) → REINTEGRAR monto + comisión
      // (atómico; fallback read-write). El estado devuelto se guarda como error.
      let restored = 0
      const { data: adjR, error: adjRErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [railCol]: totalDebit } })
      if (!adjRErr && !(adjR as any)?.error) {
        restored = Number(((adjR as any)?.balances?.[railCol]) ?? 0)
      } else {
        const { data: u2 } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
        const bals2: Record<string, number> = (u2?.balances as any) ?? {}
        restored = Number((Number(bals2[railCol] ?? 0) + totalDebit).toFixed(2))
        await db.from('users').update({ balances: { ...bals2, [railCol]: restored } }).eq('id', userId)
      }
      await asentarTx('Fallido', { ...prettyBase, ...feeDetail, error: pay.data ?? 'payout_failed', httpStatus: pay.status, refunded: true, failedAt: new Date().toISOString() })
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
      const isKeyProblem = /brebkey|destination|no existe|not\s*found|inv[aá]lid|no.{0,3}activ|resolver la llave|llave no|unknown\s*key|key\s*not/.test(errText)
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
        friendly = `El operador del envío rechazó esta transferencia por una restricción de cumplimiento de su lado: «${provMsg}» No es una restricción de Lincoin. Comunícate con soporte para revisarlo. Tu saldo fue devuelto.`
      } else if (provMsg && !/[{}\[\]]|http\s*\d|status\s*code|errors?\b|\bpath\b|brebkey/i.test(provMsg)) {
        // Solo se muestra el mensaje del proveedor si es TEXTO HUMANO (sin JSON,
        // códigos ni jerga). Si trae basura técnica, se usa el genérico limpio.
        friendly = `${provMsg} Tu saldo fue devuelto.`
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
      if (txId) { try { await db.from('transactions').update({ raw_data: { ...prettyBase, ...feeDetail, error: pay.data ?? 'payout_failed', errorMessage: provMsg ?? techHint ?? null, bloqueoDelProveedor: porCumplimientoDelProveedor || undefined, httpStatus: pay.status, refunded: true, failedAt: new Date().toISOString() } }).eq('id', txId) } catch { /* best-effort */ } }
      // NOTA: no se devuelven `data`/`detail` técnicos al cliente. El detalle
      // real vive en la tx (errorMessage/error/httpStatus) y en el audit_log.
      return json(200, { error: 'payout_failed', code: provCode, retryAfterSeconds, refunded: true, newBalance: restored,
        message: friendly })
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
        if (JSON.stringify(next) !== JSON.stringify(list)) await db.from('users').update({ raw_data: { ...raw4, mouvContacts: next } }).eq('id', userId)
      } catch { /* best-effort — nunca bloquea la operación */ }
    }

    if (fin.ok) {
      // El precio por transferencia (ACH_FEE_COP) ya se debitó junto al monto.
      const newBalance = afterDebit
      // Finity CONFIRMED = orden aceptada (aún no pagada) → Procesando.
      await asentarTx('Procesando', {
        ...prettyBase, feeProvider: 'finity', feeCop: fin.feeCop, costs: fin.costs ?? null,
        providerRef: fin.providerRef ?? null, state: fin.state ?? null,
        ...(fin.amountMismatch ? { amountMismatch: fin.amountMismatch, needsReview: true } : {}),
        acceptedAt: new Date().toISOString(),
      })
      await logAudit(userId, `finity.${action}.ok`, { amount, feeCop: fin.feeCop, providerRef: fin.providerRef ?? null })
      await notifyTx(txId) // correo "recibimos tu envío · en proceso"
      return json(200, { ok: true, provider: 'finity', providerRef: fin.providerRef ?? null, feeCop: fin.feeCop, newBalance })
    }
    // Finity falló → REINTEGRAR monto + comisión (atómico; fallback read-write).
    let restored5 = 0
    const { data: adjR5, error: adjR5Err } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [railCol]: totalDebit } })
    if (!adjR5Err && !(adjR5 as any)?.error) {
      restored5 = Number(((adjR5 as any)?.balances?.[railCol]) ?? 0)
    } else {
      const { data: u5 } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
      const bals5: Record<string, number> = (u5?.balances as any) ?? {}
      restored5 = Number((Number(bals5[railCol] ?? 0) + totalDebit).toFixed(2))
      await db.from('users').update({ balances: { ...bals5, [railCol]: restored5 } }).eq('id', userId)
    }
    const finErr: any = fin.error
    const finMsgRaw = (typeof finErr === 'string' ? finErr
      : (finErr?.message ?? finErr?.detail ?? finErr?.error?.message)) as string | undefined
    const detail = (() => { try { return JSON.stringify(fin.error ?? fin).slice(0, 350) } catch { return String(fin.error ?? 'sin detalle') } })()
    // errorMessage = detalle técnico para el Panel de Fallos del admin.
    await asentarTx('Fallido', { ...prettyBase, feeProvider: 'finity', error: fin.error ?? 'finity_failed', errorMessage: (finMsgRaw ?? detail) ?? null, refunded: true, failedAt: new Date().toISOString() })
    await logAudit(userId, `finity.${action}.fail`, { amount, error: JSON.stringify(fin.error ?? {}).slice(0, 200) })
    await notifyTx(txId) // correo "no pudimos completar tu envío · saldo devuelto"
    // AL CLIENTE: mensaje LIMPIO. Solo se usa el texto de Finity si es HUMANO
    // (sin JSON, códigos ni jerga). El detalle técnico NO se devuelve — vive en
    // la tx (errorMessage) y el audit_log para el Panel de Fallos del admin.
    const finMsg = finMsgRaw && !/[{}\[\]]|http\s*\d|status\s*code|errors?\b|\bpath\b/i.test(finMsgRaw) ? finMsgRaw : null
    const friendlyAch = finMsg && finMsg.trim()
      ? `No pudimos completar la transferencia ACH: ${finMsg}. Tu saldo fue devuelto.`
      : `No pudimos completar la transferencia ACH en este momento. Tu saldo fue devuelto — puedes intentarlo de nuevo en unos minutos.`
    return json(200, { error: 'payout_failed', provider: 'finity', refunded: true, newBalance: restored5,
      message: friendlyAch })
  }

  return json(200, { error: 'unknown_action', message: `Acción no soportada: ${action}` })
})
