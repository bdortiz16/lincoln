// ════════════════════════════════════════════════════════
// gasfree — Custodia USDT en TRON vía GasFree (SIN GasFree, SIN TRX).
// (redeploy: el intento anterior falló por un 522 transitorio de esm.sh
// al bundlear, no por el código — este comentario solo fuerza un push)
//
// Cada cliente tiene su wallet GasFree (cajita USDT). Los depósitos y
// envíos no requieren TRX: la comisión de red se paga en USDT. Esta
// función habla directo con el proveedor GasFree (open.gasfree.io) y
// firma las autorizaciones TIP-712 con las llaves que Lincoin controla.
//
// Secrets:
//   GASFREE_API_KEY, GASFREE_API_SECRET   credenciales del portal GasFree
//   GASFREE_NET = nile | tron             red (testnet | mainnet)
//   GASFREE_TRON_MNEMONIC  deriva TANTO la
//                                          recaudadora (índice 0, reservado)
//                                          como las wallets de los usuarios
//                                          (índice 1, 2, 3...)
//   LINCOIN_TRON_HOT_KEY                    OPCIONAL — solo si la recaudadora
//                                          ya es una dirección financiada
//                                          antes de este cambio; si no está
//                                          seteada, la recaudadora se genera
//                                          sola del mnemónico (índice 0).
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ethers } from 'https://esm.sh/ethers@6.13.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY)

// 2FA server-side: re-valida el TOTP (SHA1/6/30, ventana ±2) antes de enviar,
// con Web Crypto NATIVO (sin dependencias externas que puedan no cargar).
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
// Exige el código 2FA si el usuario lo tiene activo. Devuelve un mensaje de
// error si falla, o null si pasa (o si no aplica).
const FIELD_ENC_KEY = Deno.env.get('FIELD_ENC_KEY') ?? ''
async function decField(v: string): Promise<string> {
  if (typeof v !== 'string' || !v.startsWith('enc:v1:')) return v
  if (!FIELD_ENC_KEY) throw new Error('FIELD_ENC_KEY missing')
  const rawKey = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(FIELD_ENC_KEY)))
  const ck = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
  const bytes = Uint8Array.from(atob(v.slice(7)), c => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, ck, bytes.slice(12))
  return new TextDecoder().decode(pt)
}
async function require2FA(userId: string, otp: unknown): Promise<string | null> {
  const { data } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
  const raw = ((data as any)?.raw_data ?? {}) as Record<string, any>
  if (raw.mfaEnabled) {
    // FALLA CERRADO: si el 2FA está activo y el secreto no se puede obtener
    // (descifrado falla / falta la llave), se bloquea — no se pasa sin 2FA.
    let secret = ''
    try { secret = raw.totpSecretEnc ? await decField(String(raw.totpSecretEnc)) : String(raw.totpSecret ?? '') } catch { secret = '' }
    if (!secret || !(await verifyTOTPServer(secret, String(otp ?? '')))) {
      return 'No pudimos verificar tu código de dos pasos. Vuelve a intentar el envío.'
    }
  }
  return null
}

const API_KEY    = (Deno.env.get('GASFREE_API_KEY') ?? '').trim()
const API_SECRET = (Deno.env.get('GASFREE_API_SECRET') ?? '').trim()
const NET = (Deno.env.get('GASFREE_NET') ?? 'nile').trim().toLowerCase() === 'tron' ? 'tron' : 'nile'
const HOT_KEY  = (Deno.env.get('LINCOIN_TRON_HOT_KEY') ?? '').trim()

// ── Aviso al admin por correo (cambios sensibles: wallet/recaudadora) ──
// Se manda solo si hay RESEND_API_KEY y un correo destino (ADMIN_ALERT_EMAIL
// o ADMIN_EMAIL). Nunca rompe la operación si el correo falla.
const RESEND_KEY = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
const ALERT_FROM = (Deno.env.get('FROM_EMAIL') ?? Deno.env.get('OTP_FROM_EMAIL') ?? 'no-reply@lincoin.me').trim()
const ALERT_TO   = (Deno.env.get('ADMIN_ALERT_EMAIL') ?? Deno.env.get('ADMIN_EMAIL') ?? '').trim()
async function sendAdminAlert(subject: string, lines: string[]) {
  if (!RESEND_KEY || !ALERT_TO) return
  try {
    const rows = lines.map(l => `<tr><td style="padding:6px 0;font-family:Arial,sans-serif;font-size:13px;color:#15181A">${l}</td></tr>`).join('')
    const html = `<div style="background:#F0EFEB;padding:24px"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid rgba(21,24,26,0.08)"><tr><td style="padding:24px">
      <p style="font-family:Archivo,Arial,sans-serif;font-size:20px;font-weight:800;color:#15181A;margin:0 0 4px">Lincoin<span style="color:#22A35C">.</span> · Seguridad</p>
      <p style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#15181A;margin:12px 0 10px">${subject}</p>
      <table role="presentation" width="100%">${rows}</table>
      <p style="font-family:Arial,sans-serif;font-size:11.5px;color:#9B9F9B;margin-top:18px">Aviso automático. Si NO reconoces este cambio, revísalo en el panel → GasFree → Historial de cambios de wallet.</p>
    </td></tr></table></div>`
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Lincoin <${ALERT_FROM}>`, to: [ALERT_TO], subject: `[Lincoin seguridad] ${subject}`, html }),
    })
  } catch { /* el aviso jamás rompe la operación */ }
}
const MNEMO_GASFREE = (Deno.env.get('GASFREE_TRON_MNEMONIC') || '').trim()
const MNEMONIC = MNEMO_GASFREE.trim()
// Mnemónicas a probar en la RECUPERACIÓN. Deduplicadas, con etiqueta de origen.
const SCAN_MNEMONICS: { source: string; phrase: string }[] = (() => {
  const out: { source: string; phrase: string }[] = []
  const seen = new Set<string>()
  const add = (source: string, phrase: string) => { if (phrase && !seen.has(phrase)) { seen.add(phrase); out.push({ source, phrase }) } }
  add('gasfree', MNEMO_GASFREE)
  return out
})()

const CFG = NET === 'tron'
  ? { host: 'https://open.gasfree.io', prefix: '/tron', chainId: 728126428,  verifying: 'TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U', tronHost: 'https://api.trongrid.io' }
  : { host: 'https://open-test.gasfree.io', prefix: '/nile', chainId: 3448148188, verifying: 'THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc', tronHost: 'https://nile.trongrid.io' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const ok  = (body: object) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } })
const err = (msg: string, status = 500) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ── Autenticación ──────────────────────────────────────────
// Sin esto, cualquiera con la llave anon (pública, va en el bundle JS)
// podía llamar 'send'/'sweep_all' y mover fondos reales de la
// recaudadora. Acciones admin exigen rol admin; las acciones "propias"
// del cliente exigen que su JWT coincida con el userId que pide.
async function callerIsAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') ?? ''
  // Solo JWT real de Supabase con role='admin'. Se eliminó el "AdminBypass
  // <password>" (secreto compartido que se filtraba en el bundle del frontend).
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    if (!user) return false
    const { data: profile } = await db.from('users').select('role').eq('id', user.id).single()
    return profile?.role === 'admin'
  } catch { return false }
}
async function callerUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    return user?.id ?? null
  } catch { return null }
}
// true si el que llama es admin O es el propio userId de la acción
async function verifySelfOrAdmin(req: Request, userId: string): Promise<boolean> {
  if (await callerIsAdmin(req)) return true
  const uid = await callerUserId(req)
  return uid === userId
}

// ── Utilidades de dirección TRON ──────────────────────────
function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '').toLowerCase().padStart(40, '0')
  return new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)))
}
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58Encode(bytes: Uint8Array): string {
  let n = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''))
  let s = ''
  while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n }
  for (const b of bytes) { if (b) break; s = ALPHA[0] + s }
  return s
}
function base58Decode(s: string): Uint8Array {
  let n = 0n
  for (const c of s) { const i = ALPHA.indexOf(c); if (i < 0) throw new Error(`base58 inválido: ${c}`); n = n * 58n + BigInt(i) }
  const out: number[] = []
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n }
  for (const c of s) { if (c === '1') out.unshift(0); else break }
  return new Uint8Array(out)
}
async function ethAddressToTron(ethAddr: string): Promise<string> {
  const payload = new Uint8Array([0x41, ...hexToBytes(ethAddr)])
  const h1 = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', h1))
  return base58Encode(new Uint8Array([...payload, ...h2.slice(0, 4)]))
}
function tronAddrToEvmHex(addr: string): string {
  const raw = base58Decode(addr)
  const payload = raw.slice(0, raw.length - 4)
  return Array.from(payload.slice(1)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Cliente HTTP de GasFree (auth HMAC-SHA256) ────────────
async function gfAuth(method: string, path: string): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000)
  const msg = `${method}${path}${ts}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return { 'Timestamp': String(ts), 'Authorization': `ApiKey ${API_KEY}:${b64}` }
}
async function gfGet(apiPath: string): Promise<any> {
  const path = `${CFG.prefix}${apiPath}`
  const r = await fetch(`${CFG.host}${path}`, { headers: await gfAuth('GET', path) })
  const txt = await r.text()
  try { return JSON.parse(txt) }
  catch {
    // GasFree devuelve texto plano en errores de auth (ej. "Apikey not found.").
    const hint = /apikey/i.test(txt) ? ' — revisa GASFREE_API_KEY/SECRET en Supabase Secrets y que sean del entorno correcto (mainnet/tron vs nile) y estén verificadas.' : ''
    throw new Error(`GasFree respondió (HTTP ${r.status}): ${txt.slice(0, 180)}${hint}`)
  }
}
async function gfPost(apiPath: string, body: any): Promise<any> {
  const path = `${CFG.prefix}${apiPath}`
  const headers = { ...(await gfAuth('POST', path)), 'Content-Type': 'application/json' }
  const r = await fetch(`${CFG.host}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const txt = await r.text()
  try { return JSON.parse(txt) }
  catch {
    const hint = /apikey/i.test(txt) ? ' — revisa GASFREE_API_KEY/SECRET en Supabase Secrets y que sean del entorno correcto (mainnet/tron vs nile) y estén verificadas.' : ''
    throw new Error(`GasFree respondió (HTTP ${r.status}): ${txt.slice(0, 180)}${hint}`)
  }
}

// ── Saldo de un token TRC-20 (balanceOf) en un host TronGrid dado ──
// owner_address: la llamada es de SOLO LECTURA (triggerconstantcontract no
// transmite nada a la red), así que no necesita ser una cuenta real ni
// tener fondos — pero SÍ debe ser una dirección TRON válida en formato.
// Se usa la dirección cero de TRON (hex 41 + 20 ceros), documentada y
// verificable, en vez de una dirección inventada sin confirmar (ese fue
// el bug: una dirección no verificada hacía fallar la consulta en
// silencio y el catch devolvía 0 sin decir por qué).
const CALL_OWNER = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' // dirección cero de TRON
// TronGrid limita (rate-limit) las llamadas SIN API key → las lecturas de saldo
// devolvían 0 aunque el USDT SÍ estuviera on-chain. Si se setea TRONGRID_API_KEY
// en Supabase Secrets, se manda en el header y las lecturas son confiables.
const TRONGRID_KEY = (Deno.env.get('TRONGRID_API_KEY') ?? '').trim()
function tgHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return TRONGRID_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_KEY, ...extra } : extra
}
async function tokenBalanceOnDebug(address: string, contract: string, decimals: number, host: string): Promise<{ balance: number; raw: any; error?: string }> {
  try {
    const param = '0'.repeat(24) + tronAddrToEvmHex(address)
    const r = await fetch(`${host}/wallet/triggerconstantcontract`, {
      method: 'POST', headers: tgHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner_address: CALL_OWNER, contract_address: contract, function_selector: 'balanceOf(address)', parameter: param, visible: true }),
    })
    const d = await r.json()
    const hex = d?.constant_result?.[0]
    if (typeof hex === 'string' && hex.length > 0) {
      const bal = Number(BigInt('0x' + hex)) / Math.pow(10, decimals)
      return { balance: isFinite(bal) ? bal : 0, raw: d }
    }
    return { balance: 0, raw: d, error: 'sin constant_result' }
  } catch (e) {
    return { balance: 0, raw: null, error: (e as Error)?.message }
  }
}
async function tokenBalanceOn(address: string, contract: string, decimals: number, host: string): Promise<number> {
  return (await tokenBalanceOnDebug(address, contract, decimals, host)).balance
}
// Saldo TRC-20 robusto: primero triggerconstantcontract; si da 0 (rate-limit o
// dirección inactiva), cae al endpoint /v1/accounts (el mismo dato que muestra
// Tronscan) buscando el contrato. Así el depósito se detecta aunque una vía falle.
// Saldo neto calculado desde el HISTORIAL de transfers TRC-20 (entrantes −
// salientes). Es el método más robusto: funciona incluso para direcciones
// "inactivas" (0 TRX), donde balanceOf y /v1/accounts a veces no responden.
// Es el mismo dato que usa Tronscan para mostrar los movimientos.
async function tokenBalanceFromTransfers(address: string, contract: string, decimals: number): Promise<number> {
  try {
    const url = `${CFG.tronHost}/v1/accounts/${address}/transactions/trc20?limit=200&contract_address=${contract}`
    const r = await fetch(url, { headers: tgHeaders() })
    const d = await r.json()
    const list: any[] = Array.isArray(d?.data) ? d.data : []
    let net = 0n
    for (const t of list) {
      if ((t?.type ?? 'Transfer') !== 'Transfer') continue
      const v = BigInt(String(t?.value ?? '0'))
      if (t?.to === address) net += v
      else if (t?.from === address) net -= v
    }
    const bal = Number(net) / Math.pow(10, decimals)
    return isFinite(bal) && bal > 0 ? bal : 0
  } catch { return 0 }
}
async function tokenBalance(address: string, contract: string, decimals: number): Promise<number> {
  // 1) balanceOf on-chain (rápido si TronGrid no limita)
  const direct = await tokenBalanceOn(address, contract, decimals, CFG.tronHost)
  if (direct > 0) return direct
  // 2) /v1/accounts (mapa trc20 — no sirve para direcciones inactivas)
  try {
    const list = await scanTrc20On(address, CFG.tronHost)
    const hit = list.find(t => t.contract === contract)
    if (hit) { const b = Number(BigInt(hit.amount)) / Math.pow(10, decimals); if (isFinite(b) && b > 0) return b }
  } catch { /* best-effort */ }
  // 3) historial de transfers (entrantes − salientes) — funciona hasta inactivas
  const fromTx = await tokenBalanceFromTransfers(address, contract, decimals)
  if (fromTx > 0) return fromTx
  return direct
}

// Lista TODOS los TRC-20 que hay en una dirección en un host TronGrid dado.
async function scanTrc20On(address: string, host: string): Promise<{ contract: string; amount: string }[]> {
  try {
    const r = await fetch(`${host}/v1/accounts/${address}`, { headers: tgHeaders() })
    const d = await r.json()
    const list: Record<string, string>[] = d?.data?.[0]?.trc20 ?? []
    return list.map(o => { const [contract, amount] = Object.entries(o)[0]; return { contract, amount: String(amount) } })
  } catch { return [] }
}
async function scanTrc20(address: string) { return scanTrc20On(address, CFG.tronHost) }

// Últimas transferencias TRC-20 ENTRANTES a una dirección (para enriquecer el
// comprobante del depósito con: de dónde vino, el TxID y cuándo). Devuelve
// {from, txId, amount, ts} de la más reciente que iguale (o supere) el monto
// esperado, o la más reciente a secas si no hay match exacto. Best-effort:
// si TronGrid falla, devuelve null y el depósito se registra igual sin estos
// datos (nunca debe bloquear la acreditación).
async function latestIncomingTrc20(address: string, contract: string, decimals: number, wantAmount?: number): Promise<{ from: string; txId: string; amount: number; ts: number } | null> {
  try {
    const url = `${CFG.tronHost}/v1/accounts/${address}/transactions/trc20?only_to=true&limit=20&order_by=block_timestamp,desc&contract_address=${contract}`
    const r = await fetch(url, { headers: tgHeaders() })
    const d = await r.json()
    const list: any[] = Array.isArray(d?.data) ? d.data : []
    const parsed = list
      .filter(t => (t?.type ?? 'Transfer') === 'Transfer' && t?.to === address)
      .map(t => ({
        from: String(t?.from ?? ''),
        txId: String(t?.transaction_id ?? ''),
        amount: Number(t?.value ?? 0) / Math.pow(10, decimals),
        ts: Number(t?.block_timestamp ?? 0),
      }))
      .filter(t => t.from && t.txId)
    if (!parsed.length) return null
    if (wantAmount != null && wantAmount > 0) {
      const tol = Math.max(0.01, wantAmount * 0.001)
      const match = parsed.find(t => Math.abs(t.amount - wantAmount) <= tol)
      if (match) return match
    }
    return parsed[0]
  } catch { return null }
}

// TODAS las transferencias TRC-20 ENTRANTES a una dirección (para acreditar
// cada depósito por su monto EXACTO y una sola vez, por txId).
async function incomingTransfersTrc20(address: string, contract: string, decimals: number, limit = 60): Promise<{ from: string; txId: string; amount: number; ts: number }[]> {
  try {
    const url = `${CFG.tronHost}/v1/accounts/${address}/transactions/trc20?only_to=true&limit=${limit}&order_by=block_timestamp,desc&contract_address=${contract}`
    const r = await fetch(url, { headers: tgHeaders() })
    const d = await r.json()
    const list: any[] = Array.isArray(d?.data) ? d.data : []
    return list
      .filter(t => (t?.type ?? 'Transfer') === 'Transfer' && t?.to === address)
      .map(t => ({ from: String(t?.from ?? ''), txId: String(t?.transaction_id ?? ''), amount: Number(t?.value ?? 0) / Math.pow(10, decimals), ts: Number(t?.block_timestamp ?? 0) }))
      .filter(t => t.txId && t.amount > 0)
  } catch { return [] }
}

// Localizador: busca los TRC-20 de la dirección GasFree y el EOA de un
// usuario en AMBAS redes (mainnet + Nile) — para saber dónde quedó un
// depósito enviado a la red equivocada.
async function locate(userId: string) {
  const index = await userIndex(userId)
  const { eoa } = await userWallet(index)
  const { gasFreeAddress } = await gfAccount(eoa)
  const MAIN = 'https://api.trongrid.io', NILE = 'https://nile.trongrid.io'
  const USDT_MAIN = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'        // USDT real mainnet
  const USDT_NILE = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'        // USDT de GasFree en Nile
  const bal = async (addr: string | null, contract: string, host: string) =>
    addr ? await tokenBalanceOnDebug(addr, contract, 6, host) : { balance: 0, raw: null }
  const [gfMain, gfNile, eoaMain, eoaNile] = await Promise.all([
    bal(gasFreeAddress, USDT_MAIN, MAIN),
    bal(gasFreeAddress, USDT_NILE, NILE),
    bal(eoa, USDT_MAIN, MAIN),
    bal(eoa, USDT_NILE, NILE),
  ])
  return {
    net: NET, eoa, gasFreeAddress,
    gasFreeUsdt: { mainnet: gfMain.balance, nile: gfNile.balance },
    eoaUsdt: { mainnet: eoaMain.balance, nile: eoaNile.balance },
    // Diagnóstico crudo — visible en el panel, sin tener que ir a los Logs
    debugRaw: { gfMain: gfMain.raw ?? gfMain.error, gfNile: gfNile.raw ?? gfNile.error },
  }
}

// ── Config / cuenta GasFree ───────────────────────────────
async function gfConfig() {
  if (!API_KEY || !API_SECRET) throw new Error('Configura GASFREE_API_KEY y GASFREE_API_SECRET en Supabase Secrets')
  const [tokens, providers] = await Promise.all([gfGet('/api/v1/config/token/all'), gfGet('/api/v1/config/provider/all')])
  const token = (tokens?.data?.tokens ?? []).find((t: any) => t.symbol === 'USDT' && t.supported) ?? (tokens?.data?.tokens ?? [])[0]
  const provider = (providers?.data?.providers ?? [])[0]
  if (!token) throw new Error(`GasFree no devolvió el token USDT (respuesta ${tokens?.code}: ${tokens?.message ?? ''})`)
  if (!provider) throw new Error(`GasFree no devolvió un proveedor (respuesta ${providers?.code}: ${providers?.message ?? ''})`)
  return { token, provider }
}
async function gfAccount(eoaB58: string) {
  const a = await gfGet(`/api/v1/address/${eoaB58}`)
  return {
    gasFreeAddress: a?.data?.gasFreeAddress ?? null,
    active: a?.data?.active ?? false,
    nonce: a?.data?.nonce ?? 0,
    allowSubmit: a?.data?.allowSubmit ?? true,
    assets: a?.data?.assets ?? [],
    code: a?.code, message: a?.message,
  }
}

// ── Wallets (recaudadora + usuarios) ──────────────────────
// La recaudadora ya NO exige pegar una llave privada a mano en Secrets
// (LINCOIN_TRON_HOT_KEY sigue soportado, por si ya se financió esa
// dirección) — si no está configurada, se GENERA sola derivándola del
// mismo mnemónico que usan las wallets de los clientes, en el índice 0
// (reservado: los clientes arrancan en el índice 1, así que 0 nunca
// choca con nadie). Así "Generar wallet" en Tesorería funciona igual
// que el botón de cada cliente — sin secrets nuevos que configurar.
// ── Recaudadora ROTATIVA ──────────────────────────────────
// La recaudadora cambia de dirección cada PERÍODO. Un período abre el día 30
// (o el último día del mes si no hay 30) a las 12:00 hora Colombia (UTC-5) y va
// hasta el siguiente corte. Cada período se deriva del MISMO mnemónico pero en
// una RAMA SEPARADA (change = 1) para no chocar jamás con los índices de los
// clientes (que van en change = 0). Así una sola semilla controla la actual y
// todas las archivadas.
function daysInMonth(y: number, m0: number): number { return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate() }
// Índice de período monótono (year*12 + mesDeCorte). El corte del mes M abre el
// período M; antes del corte seguimos en el período M-1.
function recaudadoraPeriod(now: Date = new Date()): number {
  const cot = new Date(now.getTime() - 5 * 3600 * 1000) // Colombia = UTC-5 (sin DST)
  const y = cot.getUTCFullYear(), m = cot.getUTCMonth(), day = cot.getUTCDate(), hour = cot.getUTCHours()
  const cutoverDay = Math.min(30, daysInMonth(y, m))
  const passed = day > cutoverDay || (day === cutoverDay && hour >= 12)
  let py = y, pm = m
  if (!passed) { pm = m - 1; if (pm < 0) { pm = 11; py -= 1 } }
  return py * 12 + pm
}
function periodLabel(period: number): string {
  const y = Math.floor(period / 12), m = period % 12
  return `${y}-${String(m + 1).padStart(2, '0')}`
}
// Fecha (UTC) del corte que ABRE `period`: día 30 (o último) a las 12:00 COT = 17:00 UTC.
function periodCutoverDate(period: number): Date {
  const y = Math.floor(period / 12), m = period % 12
  const day = Math.min(30, daysInMonth(y, m))
  return new Date(Date.UTC(y, m, day, 17, 0, 0))
}
async function recaudadoraWalletFrom(phrase: string, period: number) {
  const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(phrase), "m/44'/195'/0'/1")
  const child = root.deriveChild(period)
  const eoa = await ethAddressToTron(child.address)
  return { pkHex: child.privateKey, eoa }
}
// ── Rotación MANUAL de la recaudadora ─────────────────────────────
// Por defecto la recaudadora rotaba SOLA cada período (día 30). Ahora se
// puede FIJAR un período manualmente (system_config) para que NO rote: se
// queda en esa dirección hasta que el admin decida rotar a mano. Las
// anteriores siguen siendo derivables y aparecen como ARCHIVADAS.
const RECAUDADORA_PIN_KEY = 'gasfree_recaudadora_pinned_period'
async function pinnedRecaudadoraPeriod(): Promise<number | null> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', RECAUDADORA_PIN_KEY).single()
    if (data?.value != null && String(data.value) !== '') { const p = parseInt(String(data.value)); if (Number.isFinite(p)) return p }
  } catch { /* sin pin → rotación por fecha (legacy) */ }
  return null
}
// El período vigente: el FIJADO a mano si existe; si no, el de la fecha.
async function effectiveRecaudadoraPeriod(): Promise<number> {
  const pin = await pinnedRecaudadoraPeriod()
  return pin != null ? pin : recaudadoraPeriod()
}

// Recaudadora ACTUAL (la del período vigente). Si hay LINCOIN_TRON_HOT_KEY
// seteada, se respeta esa dirección fija (no rota) — modo legacy.
async function recaudadora() {
  if (HOT_KEY) {
    const pkHex = HOT_KEY.startsWith('0x') ? HOT_KEY : '0x' + HOT_KEY
    const eoa = await ethAddressToTron(new ethers.Wallet(pkHex).address)
    return { pkHex, eoa, period: null as number | null, pinned: true }
  }
  if (!MNEMONIC) throw new Error('Configura GASFREE_TRON_MNEMONIC en Supabase Secrets para derivar la recaudadora')
  const period = await effectiveRecaudadoraPeriod()
  return { ...(await recaudadoraWalletFrom(MNEMONIC, period)), period, pinned: false }
}
// Info (dirección + saldo + fechas) de la recaudadora de un período dado.
async function recaudadoraInfo(period: number) {
  const { token } = await gfConfig()
  const dec = Number(token.decimal ?? 6)
  const usePinned = !!HOT_KEY
  const eoa = usePinned ? (await recaudadora()).eoa : (await recaudadoraWalletFrom(MNEMONIC, period)).eoa
  const acct = await gfAccount(eoa)
  const gfAddr = acct.gasFreeAddress ?? eoa
  const balance = await tokenBalance(gfAddr, token.tokenAddress, dec)
  return {
    period, label: periodLabel(period), address: eoa,
    gasFreeAddress: acct.gasFreeAddress ?? null, balance,
    opensAt: periodCutoverDate(period).toISOString(),
    closesAt: periodCutoverDate(period + 1).toISOString(),
    pinned: usePinned,
  }
}
async function recaudadoraCurrent() {
  if (HOT_KEY) {
    const { eoa } = await recaudadora()
    const { token } = await gfConfig()
    const acct = await gfAccount(eoa)
    const balance = await tokenBalance(acct.gasFreeAddress ?? eoa, token.tokenAddress, Number(token.decimal ?? 6))
    return { current: true, pinned: true, rotates: false, address: eoa, gasFreeAddress: acct.gasFreeAddress ?? null, balance, note: 'Recaudadora fija (LINCOIN_TRON_HOT_KEY). No rota.' }
  }
  const pin = await pinnedRecaudadoraPeriod()
  const period = pin != null ? pin : recaudadoraPeriod()
  return {
    ...(await recaudadoraInfo(period)), current: true,
    // Con pin manual: NO rota sola. Sin pin: rota por fecha (legacy).
    rotates: pin == null, manual: pin != null,
    nextRotation: pin == null ? periodCutoverDate(period + 1).toISOString() : null,
    note: pin != null ? 'Recaudadora FIJA (manual). No rota sola — la rotas tú.' : 'Rota sola cada período (aún automática).',
  }
}
// Lista la actual + las archivadas (períodos anteriores) con su saldo.
async function recaudadoraList(back = 12) {
  if (HOT_KEY) return { pinned: true, periods: [await recaudadoraCurrent()] }
  const pin = await pinnedRecaudadoraPeriod()
  const cur = pin != null ? pin : recaudadoraPeriod()
  const periods: any[] = []
  for (let p = cur; p > cur - Math.max(1, back); p--) {
    try { periods.push({ ...(await recaudadoraInfo(p)), current: p === cur, archived: p < cur }) }
    catch (e) { periods.push({ period: p, label: periodLabel(p), error: (e as Error)?.message }) }
  }
  return { current: cur, manual: pin != null, nextRotation: pin == null ? periodCutoverDate(cur + 1).toISOString() : null, periods }
}
// Fijar la recaudadora vigente para que NO rote sola (todo manual desde ya).
async function pinRecaudadora() {
  const period = await effectiveRecaudadoraPeriod()
  await saveSystemConfig(RECAUDADORA_PIN_KEY, String(period))
  return { ok: true, pinnedPeriod: period, label: periodLabel(period), manual: true }
}
// Rotar la recaudadora A MANO: avanza al siguiente período. La anterior queda
// ARCHIVADA (derivable y listable). Su saldo NO se mueve — se consolida aparte.
async function rotateRecaudadora() {
  const cur = await effectiveRecaudadoraPeriod()
  const next = cur + 1
  await saveSystemConfig(RECAUDADORA_PIN_KEY, String(next))
  const info = await recaudadoraInfo(next)
  sendAdminAlert('Rotaste la recaudadora (manual)', [
    `Período: <b>${periodLabel(cur)} → ${periodLabel(next)}</b>`,
    `Nueva dirección: <b>${info.gasFreeAddress ?? info.address}</b>`,
    `La anterior queda archivada — su saldo NO se movió.`,
  ]).catch(() => {})
  return { ok: true, oldPeriod: cur, oldLabel: periodLabel(cur), newPeriod: next, newLabel: periodLabel(next), gasFreeAddress: info.gasFreeAddress, address: info.address }
}

// Consolidar: barre el USDT de las recaudadoras ARCHIVADAS (períodos
// anteriores) hacia la recaudadora ACTUAL, para que no quede plata dispersa.
// Mueve dinero on-chain (paga la comisión GasFree por cada barrido). Solo lo
// dispara el admin.
async function consolidateRecaudadoras(back = 12) {
  if (HOT_KEY) return { ok: false, error: 'La recaudadora es fija (LINCOIN_TRON_HOT_KEY) — no hay archivadas que consolidar.' }
  const cur = await effectiveRecaudadoraPeriod()
  const rec = await recaudadora()
  const recAcct = await gfAccount(rec.eoa)
  const dest = recAcct.gasFreeAddress ?? rec.eoa
  const { token } = await gfConfig()
  const dec = Number(token.decimal ?? 6)
  const results: any[] = []
  let totalSwept = 0
  for (let p = cur - 1; p >= cur - Math.max(1, back); p--) {
    try {
      const { pkHex, eoa } = await recaudadoraWalletFrom(MNEMONIC, p)
      const acct = await gfAccount(eoa)
      if (!acct.gasFreeAddress) continue
      const bal = await tokenBalance(acct.gasFreeAddress, token.tokenAddress, dec)
      const fee = (Number(token.transferFee ?? 0) + (acct.active ? 0 : Number(token.activateFee ?? 0))) / Math.pow(10, dec)
      const sendable = parseFloat((bal - fee).toFixed(dec))
      if (sendable <= 0) continue
      const r = await sendCore(pkHex, eoa, dest, sendable)
      totalSwept += sendable
      results.push({ period: p, label: periodLabel(p), swept: sendable, traceId: r.traceId })
      await logTreasuryMovement({ direction: 'in', amount: sendable, fromAddress: acct.gasFreeAddress, context: 'consolidacion_recaudadoras', traceId: r.traceId, state: r.state, feeChargedUsdt: r.feeChargedUsdt })
    } catch (e) { results.push({ period: p, label: periodLabel(p), error: (e as Error)?.message }) }
  }
  if (totalSwept > 0) {
    sendAdminAlert('Consolidaste las recaudadoras archivadas', [
      `Barrido total: <b>${totalSwept.toFixed(2)} USDT</b> → recaudadora actual (${periodLabel(cur)})`,
      `Períodos con saldo: <b>${results.filter(r => r.swept).length}</b>`,
    ]).catch(() => {})
  }
  return { ok: true, dest, totalSwept: parseFloat(totalSwept.toFixed(dec)), results }
}
async function userWallet(index: number) {
  if (!MNEMONIC) throw new Error('Configura GASFREE_TRON_MNEMONIC en Supabase Secrets para derivar las wallets de los usuarios')
  return userWalletFrom(MNEMONIC, index)
}
async function userWalletFrom(phrase: string, index: number) {
  const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(phrase), "m/44'/195'/0'/0")
  const child = root.deriveChild(index)
  const eoa = await ethAddressToTron(child.address)
  return { pkHex: child.privateKey, eoa }
}
// Índice HD estable por usuario (reusa el existente para NO cambiar wallets).
//
// ⚠️ Bug corregido (colisión/cambio de wallet entre usuarios):
//  1) Sesiones "half-auth": el userId (auth.uid) podía NO coincidir con
//     users.id, o haber perfiles duplicados por correo. El `.update(...).eq('id',
//     userId)` entonces afectaba 0 filas → el índice NO se persistía → cada
//     llamada re-asignaba uno nuevo del contador → la dirección del usuario
//     CAMBIABA en cada carga (por eso XATECH pasó de la wallet 9H a otra).
//  2) El contador `gasfree_hd_counter` era read-then-write (no atómico) → dos
//     usuarios podían tomar el MISMO índice → MISMA wallet (colisión).
// Solución: resolver la fila real por id y por CORREO (hermanos), reusar
// cualquier índice ya asignado, persistir en TODAS las filas, y asignar el
// nuevo de forma atómica (RPC next_gasfree_index, con fallback).
// ── Almacén DURABLE del índice HD (a prueba de borrado de raw_data) ──
// El índice vive TAMBIÉN en system_config, bajo una clave por-usuario que el
// cliente NO puede escribir (system_config solo lo toca el service_role/admin).
// Así, aunque un write del cliente BORRE raw_data.gasfreeIndex, el índice —y por
// tanto la WALLET— sobrevive intacto. Es la fuente de verdad #1: por eso la
// billetera deja de "cambiar sola" incluso sin el trigger de base de datos.
function idxKeyForUser(userId: string) { return `gasfree_idx_u:${userId}` }
function idxKeyForEmail(email: string) { return `gasfree_idx_e:${String(email).trim().toLowerCase()}` }
async function readDurableIndex(userId: string, email?: string | null): Promise<number | null> {
  const keys = [idxKeyForUser(userId)]
  if (email) keys.push(idxKeyForEmail(email))
  try {
    const { data } = await db.from('system_config').select('key, value').in('key', keys)
    const num = (v: any) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 1 ? n : null }
    // La CLAVE DE CORREO MANDA. El correo = la persona: si existen filas
    // hermanas (mismo correo, distinto userId), TODAS deben resolver el MISMO
    // índice. Antes se prefería la clave por-usuario y dos perfiles del mismo
    // correo podían quedar en wallets distintas (justo el "cambia sola"). Si la
    // clave por-usuario difiere del correo, se SANA a la del correo.
    const byEmail = email ? num((data as any[])?.find((r) => r.key === idxKeyForEmail(email))?.value) : null
    const byUser = num((data as any[])?.find((r) => r.key === idxKeyForUser(userId))?.value)
    if (byEmail != null) {
      if (byUser !== byEmail) { try { await saveSystemConfig(idxKeyForUser(userId), String(byEmail)) } catch { /* no bloquea */ } }
      return byEmail
    }
    if (byUser != null) {
      // Aún no hay clave de correo → sembrarla desde la del usuario para anclar
      // a los hermanos de aquí en adelante.
      if (email) { try { await saveSystemConfig(idxKeyForEmail(email), String(byUser)) } catch { /* no bloquea */ } }
      return byUser
    }
  } catch { /* si falla la lectura, caemos a la resolución normal */ }
  return null
}
async function writeDurableIndex(userId: string, email: string | null | undefined, idx: number) {
  try { await saveSystemConfig(idxKeyForUser(userId), String(idx)) } catch { /* no bloquea la operación */ }
  if (email) { try { await saveSystemConfig(idxKeyForEmail(email), String(idx)) } catch { /* no bloquea */ } }
}

async function userIndex(userId: string): Promise<number> {
  const { data: primary } = await db.from('users').select('id, email, raw_data').eq('id', userId).maybeSingle()
  const praw = (primary?.raw_data ?? {}) as Record<string, any>
  const email = primary?.email ?? null

  // FUENTE DE VERDAD #1: el almacén durable (system_config, no escribible por el
  // cliente). Si existe, MANDA — sobrevive a cualquier borrado de raw_data, así
  // que la wallet ya no flota. De paso se sana raw_data.gasfreeIndex si se había
  // perdido (para el fast-path y el resto de la app), sin tocar nada más.
  const durable = await readDurableIndex(userId, email)
  if (durable != null) {
    if (praw.gasfreeIndex !== durable) { try { await mergeUserRaw(userId, { gasfreeIndex: durable }) } catch { /* opcional */ } }
    return durable
  }

  // FAST-PATH: si la fila ya tiene índice, úsalo tal cual y SIÉMBRALO en el
  // durable (para que la próxima vez ya esté blindado). No reescribe raw_data.
  //
  // ⚠️ Antes se reconciliaba en CADA llamada (mirando filas hermanas y
  //    reescribiendo raw_data). Eso resultó PELIGROSO: reescribir la columna
  //    raw_data completa en cada my_status/carga corría contra el guardado
  //    del cliente (contactos, 2FA/TOTP, etc.) y una carrera los borraba.
  //    La divergencia admin↔cliente ahora se corrige de forma DELIBERADA con
  //    el botón "Fijar wallet real" (pin_address), no automáticamente.
  if (typeof praw.gasfreeIndex === 'number') {
    await writeDurableIndex(userId, email, praw.gasfreeIndex)
    return praw.gasfreeIndex
  }

  // Resolver hermanos por correo (half-auth / duplicados): el índice puede
  // estar en otra fila del mismo correo.
  let rows: any[] = primary ? [primary] : []
  if (email) {
    const { data: sibs } = await db.from('users').select('id, email, raw_data').eq('email', email)
    if (Array.isArray(sibs) && sibs.length) rows = sibs
  }

  // Reusar un índice YA asignado en cualquier fila hermana (estabilidad).
  for (const r of rows) {
    const raw = (r.raw_data ?? {}) as Record<string, any>
    const existing = typeof raw.gasfreeIndex === 'number' ? raw.gasfreeIndex
      : typeof raw.gasfreeHdIndex === 'number' ? raw.gasfreeHdIndex : null
    if (existing != null) {
      await persistIndexToRows(rows, existing, 'reconcile_email')
      await writeDurableIndex(userId, email, existing)
      return existing
    }
  }

  // Sin fila real donde persistir → índice DETERMINISTA por userId.
  if (!rows.length) return deterministicIndex(userId)
  // Asignar nuevo índice atómico y persistir en todas las filas + durable.
  const next = await allocNextIndex()
  await persistIndexToRows(rows, next, 'first_assign')
  await writeDurableIndex(userId, email, next)
  return next
}

// ── AUDITORÍA de cambios de wallet ────────────────────────────────
// Cada vez que el índice HD de un usuario cambia (primera asignación,
// reconciliación entre filas del mismo correo, pin o reset de admin) se deja
// un registro durable en system_config. Es el "archivo" para saber CUÁNDO y
// POR QUÉ cambió la wallet de alguien — nada cambia sin dejar rastro.
const WALLET_LOG_KEY = 'gasfree_wallet_log'
// Deriva la dirección GasFree (o el EOA de respaldo) de un índice HD, best-
// effort — si la API de GasFree falla, devuelve null y el log igual se escribe.
// Sirve para GUARDAR en el archivo la dirección real de cada wallet anterior,
// no solo el número de índice.
async function addressForIndex(index: number | null): Promise<string | null> {
  if (index == null) return null
  try {
    const { eoa } = await userWallet(index)
    const acct = await gfAccount(eoa)
    return acct.gasFreeAddress ?? eoa ?? null
  } catch { return null }
}
async function logWalletChange(entry: { userId: string; email?: string | null; oldIndex: number | null; newIndex: number; source: string; oldAddress?: string | null; newAddress?: string | null }) {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', WALLET_LOG_KEY).single()
    const list: any[] = data?.value ? JSON.parse(data.value) : []
    list.unshift({ at: new Date().toISOString(), ...entry })
    await saveSystemConfig(WALLET_LOG_KEY, JSON.stringify(list.slice(0, 500)))
  } catch { /* el log jamás bloquea la operación real */ }
  // AVISO: solo cuando una wallet EXISTENTE cambia (oldIndex != null). La
  // primera asignación (oldIndex null) no avisa — no es un "cambio".
  if (entry.oldIndex != null) {
    const label: Record<string, string> = { admin_pin: 'Fijada por admin', admin_reset: 'Reasignada por admin', reconcile_email: 'Reconciliación (mismo correo)', auto: 'Automático' }
    sendAdminAlert('Cambió la wallet de un cliente', [
      `Cliente: <b>${entry.email ?? entry.userId}</b>`,
      `Índice: <b>${entry.oldIndex} → ${entry.newIndex}</b>`,
      `Motivo: <b>${label[entry.source] ?? entry.source}</b>`,
    ]).catch(() => {})
  }
}
async function getWalletLog(email?: string) {
  const { data } = await db.from('system_config').select('value').eq('key', WALLET_LOG_KEY).single()
  const list: any[] = data?.value ? JSON.parse(data.value) : []
  const e = String(email ?? '').trim().toLowerCase()
  return e ? list.filter((x) => String(x.email ?? '').toLowerCase() === e) : list
}

// Fija el índice HD en cada fila SIN pisar el resto de raw_data. Re-lee la
// fila JUSTO antes de escribir y hace merge SOLO del campo del índice — así
// este write nunca borra cambios concurrentes del cliente (contactos, 2FA,
// etc.). Antes escribía un snapshot leído antes y una carrera podía borrarlos.
// Cada cambio real de índice queda registrado en el log de wallets.
async function persistIndexToRows(rows: any[], idx: number, source = 'auto') {
  for (const r of rows) {
    const { data: fresh } = await db.from('users').select('raw_data, email').eq('id', r.id).maybeSingle()
    const raw = (fresh?.raw_data ?? r.raw_data ?? {}) as Record<string, any>
    const prev = typeof raw.gasfreeIndex === 'number' ? raw.gasfreeIndex : null
    const rowEmail = (fresh as any)?.email ?? r.email ?? null
    // El almacén durable manda: se actualiza SIEMPRE (aunque raw_data ya
    // coincida) para que un pin/reset/reconciliación no lo deje desfasado.
    await writeDurableIndex(r.id, rowEmail, idx)
    if (prev === idx) continue
    await db.from('users').update({ raw_data: { ...raw, gasfreeIndex: idx } }).eq('id', r.id)
    // Guarda en el archivo las DIRECCIONES reales (no solo el índice) para que
    // el admin pueda ver la wallet anterior y la nueva.
    const [oldAddress, newAddress] = await Promise.all([addressForIndex(prev), addressForIndex(idx)])
    await logWalletChange({ userId: r.id, email: rowEmail, oldIndex: prev, newIndex: idx, source, oldAddress, newAddress })
  }
}

// ── Merge SEGURO en users.raw_data ────────────────────────────────
// Escribe SOLO las claves de `patch`, re-leyendo raw_data FRESCO justo antes
// del write. Así estos writes de la función de wallet (cachear la dirección,
// gasfreeCredited, sub-wallets…) NUNCA pisan cambios que el cliente guardó en
// paralelo (2FA/TOTP, beneficiarios), que antes se perdían por la carrera
// entre "leer raw al inicio" y "escribir raw completo al final".
async function mergeUserRaw(userId: string, patch: Record<string, any>) {
  const { data: fresh } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
  const raw = (fresh?.raw_data ?? {}) as Record<string, any>
  await db.from('users').update({ raw_data: { ...raw, ...patch } }).eq('id', userId)
}

// AUDITORÍA: detecta wallets colisionadas (un mismo índice HD compartido por
// usuarios de CORREOS distintos) y usuarios sin índice asignado. Filas del
// mismo correo (perfiles duplicados) compartiendo índice NO cuentan como
// colisión — es el mismo usuario.
async function auditIndexes() {
  const { data: users } = await db.from('users').select('id, email, role, raw_data').limit(3000)
  const byIndex: Record<string, Set<string>> = {}
  let noIndex = 0, considered = 0
  for (const u of (users as any[]) ?? []) {
    if (u.role === 'admin') continue
    considered++
    const idx = (u.raw_data ?? {})?.gasfreeIndex
    if (typeof idx !== 'number') { noIndex++; continue }
    ;(byIndex[idx] ??= new Set()).add(String(u.email ?? u.id))
  }
  const collisions = Object.entries(byIndex)
    .map(([idx, emails]) => ({ index: Number(idx), emails: Array.from(emails) }))
    .filter((c) => c.emails.length > 1)
    .sort((a, b) => a.index - b.index)
  return { considered, uniqueIndexes: Object.keys(byIndex).length, noIndex, collisions }
}

// REPARACIÓN de colisión: reasigna a un usuario un índice HD NUEVO y único.
// Necesario cuando el índice guardado ya está corrupto (dos usuarios con la
// misma wallet por el bug previo). NO toca fondos: solo cambia a qué wallet
// apunta el usuario de aquí en adelante (limpia también la dirección cacheada).
async function resetUserIndex(userId: string, source = 'admin_reset') {
  const { data: primary } = await db.from('users').select('id, email, raw_data').eq('id', userId).maybeSingle()
  if (!primary) throw new Error('Usuario no encontrado')
  let rows: any[] = [primary]
  if (primary.email) {
    const { data: sibs } = await db.from('users').select('id, email, raw_data').eq('email', primary.email)
    if (Array.isArray(sibs) && sibs.length) rows = sibs
  }
  const oldIndex = (primary.raw_data ?? {})?.gasfreeIndex ?? null
  const next = await allocNextIndex()
  const [oldAddress, newAddress] = await Promise.all([addressForIndex(oldIndex), addressForIndex(next)])
  // CONTADOR de depósitos: la wallet NUEVA arranca su propio contador
  // (gasfreeCredited) igual a SU saldo on-chain real — normalmente 0. Antes se
  // conservaba el contador de la wallet VIEJA, y como el crédito es por delta
  // (onchain − contador), el siguiente depósito podía acreditar de más o de
  // menos (justo el "me llegó 15 en vez de 10"). Con el reset, cada wallet
  // cuenta SUS propios depósitos desde cero.
  let newWalletBal = 0
  try {
    const { token } = await gfConfig()
    if (newAddress) newWalletBal = await tokenBalance(newAddress, token.tokenAddress, Number(token.decimal ?? 6))
  } catch { /* si no se pudo leer, arranca en 0 */ }
  for (const r of rows) {
    // Re-leer fresco justo antes de escribir para no pisar cambios
    // concurrentes del cliente (contactos, 2FA) al reescribir raw_data.
    const { data: fresh } = await db.from('users').select('raw_data').eq('id', r.id).maybeSingle()
    const raw = { ...((fresh?.raw_data ?? r.raw_data ?? {}) as Record<string, any>) }
    raw.gasfreeIndex = next
    raw.gasfreeCredited = newWalletBal   // el contador de la NUEVA wallet, no el de la vieja
    delete raw.gasfreeHdIndex     // no dejar que el índice viejo lo re-sobrescriba
    delete raw.gasfreeAddress   // limpiar dirección cacheada (se recalcula)
    delete raw.gasfreeEoa
    await db.from('users').update({ raw_data: raw }).eq('id', r.id)
    await writeDurableIndex(r.id, (r as any).email ?? primary.email ?? null, next)
    await logWalletChange({ userId: r.id, email: (r as any).email ?? primary.email ?? null, oldIndex: (r.raw_data ?? {})?.gasfreeIndex ?? null, newIndex: next, source, oldAddress, newAddress })
  }
  return { ok: true, email: primary.email, oldIndex, newIndex: next, eoa: null, gasFreeAddress: newAddress, oldAddress }
}

// ── ARCHIVO de wallets de UN usuario (para el cliente) ───────────────
// Devuelve la wallet ACTUAL (principal) y las ANTERIORES (archivadas),
// reconstruidas del log de cambios. Solo lo del propio usuario.
async function myWalletArchive(userId: string) {
  const { data: primary } = await db.from('users').select('id, email').eq('id', userId).maybeSingle()
  const email = primary?.email ?? null
  const idx = await userIndex(userId)
  const currentAddress = await addressForIndex(idx)
  // Todas las entradas del log de este usuario (por userId o por correo).
  const { data } = await db.from('system_config').select('value').eq('key', WALLET_LOG_KEY).single()
  const list: any[] = data?.value ? JSON.parse(data.value) : []
  const e = String(email ?? '').toLowerCase()
  const mine = list.filter((x) => String(x.userId ?? '') === userId || (e && String(x.email ?? '').toLowerCase() === e))
  // Todas las direcciones por las que pasó esta cuenta = las oldAddress/
  // newAddress del log. Los registros VIEJOS solo tienen índices (oldIndex/
  // newIndex) porque se guardaron antes de anexar la dirección → aquí se
  // DERIVA la dirección desde el índice (best-effort, con caché por índice para
  // no repetir llamadas a la API de GasFree). Así aparecen también las wallets
  // que cambiaron sin autorización, aunque en su momento no se guardó su dir.
  const idxAddrCache = new Map<number, string | null>()
  const resolveAddr = async (storedAddr: string | null | undefined, index: number | null): Promise<string | null> => {
    if (storedAddr) return storedAddr
    if (index == null) return null
    if (idxAddrCache.has(index)) return idxAddrCache.get(index)!
    const a = await addressForIndex(index)
    idxAddrCache.set(index, a)
    return a
  }
  // Candidatos: por cada entrada, la wallet ANTERIOR (oldAddress/oldIndex) y la
  // NUEVA (newAddress/newIndex). Se guarda su índice, fecha y motivo.
  const byAddr = new Map<string, { index: number | null; at: string | null; reason: string }>()
  for (const entry of mine) {
    const cands = [
      { index: typeof entry.oldIndex === 'number' ? entry.oldIndex : null, addr: await resolveAddr(entry.oldAddress, typeof entry.oldIndex === 'number' ? entry.oldIndex : null), reason: entry.source ?? 'cambio' },
      { index: typeof entry.newIndex === 'number' ? entry.newIndex : null, addr: await resolveAddr(entry.newAddress, typeof entry.newIndex === 'number' ? entry.newIndex : null), reason: entry.source ?? 'cambio' },
    ]
    for (const c of cands) {
      if (!c.addr || c.addr === currentAddress) continue
      const prev = byAddr.get(c.addr)
      if (!prev || (entry.at && (!prev.at || entry.at > prev.at))) byAddr.set(c.addr, { index: c.index, at: entry.at ?? null, reason: c.reason })
    }
  }
  // DETECCIÓN extra (sin log): wallets que el usuario pudo tener antes de que
  // existiera el registro. Se prueban sus índices DETERMINISTAS (offset 1M+, los
  // de sesiones half-auth) y los gasfreeIndex/HdIndex guardados en filas
  // hermanas del mismo correo. Así aparecen wallets viejas que el log no tenía.
  try {
    const { data: sibs } = email
      ? await db.from('users').select('id, raw_data').eq('email', email)
      : { data: [{ id: userId, raw_data: (primary as any)?.raw_data }] as any[] }
    const extraIdx = new Set<number>()
    extraIdx.add(deterministicIndex(String(userId)))
    for (const s of ((sibs as any[]) ?? [])) {
      extraIdx.add(deterministicIndex(String(s.id)))
      const raw = (s.raw_data ?? {}) as Record<string, any>
      for (const k of ['gasfreeIndex', 'gasfreeHdIndex']) {
        if (typeof raw[k] === 'number') extraIdx.add(raw[k])
      }
    }
    for (const ix of extraIdx) {
      const a = await resolveAddr(null, ix)
      if (!a || a === currentAddress || byAddr.has(a)) continue
      byAddr.set(a, { index: ix, at: null, reason: 'detectada' })
    }
  } catch { /* la detección extra nunca bloquea el archivo */ }
  // Saldo on-chain de cada wallet (actual + archivadas) para saber cuánto
  // queda por recuperar. Best-effort: si la API falla, el saldo va como null.
  let token: any = null
  try { token = (await gfConfig()).token } catch { /* sin saldo */ }
  const balOf = async (address: string | null): Promise<number | null> => {
    if (!address || !token) return null
    try { return await tokenBalance(address, token.tokenAddress, Number(token.decimal ?? 6)) } catch { return null }
  }
  // SECUENCIAL a propósito: consultar todos los saldos en paralelo hacía que
  // TronGrid limitara y algunas wallets mostraran 0 falso. Uno por uno es más
  // lento pero devuelve el saldo REAL de cada una.
  const currentBalance = await balOf(currentAddress)
  const entries = Array.from(byAddr.entries()).sort((a, b) => String(b[1].at ?? '').localeCompare(String(a[1].at ?? '')))
  const archived: { address: string; index: number | null; at: string | null; reason: string; balance: number | null }[] = []
  for (const [address, v] of entries) {
    archived.push({ address, index: v.index, at: v.at, reason: v.reason, balance: await balOf(address) })
  }
  return { current: { address: currentAddress, index: idx, balance: currentBalance }, archived }
}

// Verifica que un índice HD sea de la propiedad del usuario (aparece en su log
// de wallets, por userId o correo, O es su índice actual). Impide enviar desde
// la wallet de OTRO cliente pasando un índice cualquiera.
async function userOwnsIndex(userId: string, index: number): Promise<boolean> {
  if (!Number.isFinite(index)) return false
  if ((await userIndex(userId)) === index) return true
  const { data: primary } = await db.from('users').select('id, email').eq('id', userId).maybeSingle()
  const email = primary?.email ?? null
  const e = String(email ?? '').toLowerCase()
  // Índices deterministas propios y de filas hermanas + los guardados en ellas
  // (los mismos que myWalletArchive puede DETECTAR sin log).
  if (deterministicIndex(String(userId)) === index) return true
  try {
    const { data: sibs } = email
      ? await db.from('users').select('id, raw_data').eq('email', email)
      : { data: [] as any[] }
    for (const s of ((sibs as any[]) ?? [])) {
      if (deterministicIndex(String(s.id)) === index) return true
      const raw = (s.raw_data ?? {}) as Record<string, any>
      if (raw.gasfreeIndex === index || raw.gasfreeHdIndex === index) return true
    }
  } catch { /* seguimos con el log */ }
  const { data } = await db.from('system_config').select('value').eq('key', WALLET_LOG_KEY).single()
  const list: any[] = data?.value ? JSON.parse(data.value) : []
  return list.some((x) =>
    (String(x.userId ?? '') === userId || (e && String(x.email ?? '').toLowerCase() === e)) &&
    (x.oldIndex === index || x.newIndex === index))
}

// Cotización para enviar desde una wallet (por índice): saldo, comisión GasFree
// y MÁXIMO enviable (saldo − comisión). Así el usuario no adivina cuánto puede
// enviar — el error InsufficientBalance salía por no restar la comisión.
async function myArchivedQuote(userId: string, index: number) {
  if (!(await userOwnsIndex(userId, index))) throw new Error('Esa wallet no es tuya')
  const { eoa } = await userWallet(index)
  const acct = await gfAccount(eoa)
  const { token } = await gfConfig()
  const dec = Number(token.decimal ?? 6)
  const address = acct.gasFreeAddress ?? eoa
  let balance = 0
  try { balance = await tokenBalance(address, token.tokenAddress, dec) } catch { /* 0 */ }
  const transferFeeUsdt = Number(token.transferFee ?? 0) / Math.pow(10, dec)
  const activateFeeUsdt = acct.active ? 0 : Number(token.activateFee ?? 0) / Math.pow(10, dec)
  const totalFeeUsdt = parseFloat((transferFeeUsdt + activateFeeUsdt).toFixed(dec))
  const maxSendable = Math.max(0, parseFloat((balance - totalFeeUsdt).toFixed(dec)))
  return { address, balance, transferFeeUsdt, activateFeeUsdt, totalFeeUsdt, maxSendable, active: !!acct.active }
}

// ── ENVIAR desde una wallet ARCHIVADA (recuperar sus fondos) ─────────
// Solo enviar (una wallet archivada no recibe): mueve el USDT que quedó en una
// wallet anterior a una dirección destino. Verifica que el índice sea del
// propio usuario y firma con GasFree.
async function myArchivedSend(userId: string, index: number, toAddress: string, amount: number) {
  if (!(amount > 0)) throw new Error('Monto inválido')
  if (!(await userOwnsIndex(userId, index))) throw new Error('Esa wallet no es tuya')
  const { pkHex, eoa } = await userWallet(index)
  const fromAddr = (await gfAccount(eoa)).gasFreeAddress ?? eoa
  const r = await sendCore(pkHex, eoa, String(toAddress), amount)
  await db.from('transactions').insert({
    user_id: userId, type: 'send', amount, currency: 'USDT_TRON', status: 'Completado',
    raw_data: {
      title: 'Envío USDT desde wallet archivada', fromWallet: 'Wallet archivada', fromAddress: fromAddr,
      beneficiary: toAddress, account: toAddress, toAddress, traceId: r.traceId, state: r.state, gasfree: true,
      feeChargedUsdt: r.feeChargedUsdt, activateFeeUsdt: r.activateFeeUsdt, transferFeeUsdt: r.transferFeeUsdt,
      sentAt: new Date().toISOString(),
    },
  })
  return r
}

// Movimientos ON-CHAIN de UNA dirección — la verdad COMPLETA (entradas y
// salidas), no solo lo que la app registró. Lee las transferencias TRC-20 de la
// dirección en TronGrid (el mismo dato que muestra Tronscan) y las clasifica en
// entrada (to == addr) / salida (from == addr). Cae a lo registrado en la app
// solo si la cadena no respondiera.
async function myAddressMovements(_userId: string, address: string) {
  const a = String(address || '').trim()
  const explorer = `https://tronscan.org/#/address/${a}`
  if (!a) return { movements: [], explorer }
  let movements: any[] = []
  try {
    const { token } = await gfConfig()
    const contract = token.tokenAddress
    const dec = Number(token.decimal ?? 6)
    const url = `${CFG.tronHost}/v1/accounts/${a}/transactions/trc20?limit=200&contract_address=${contract}`
    const r = await fetch(url, { headers: tgHeaders() })
    const d = await r.json()
    const list: any[] = Array.isArray(d?.data) ? d.data : []
    movements = list
      .filter((t) => (t?.type ?? 'Transfer') === 'Transfer' && (t?.to === a || t?.from === a))
      .map((t) => {
        const inbound = t?.to === a
        return {
          id: t.transaction_id,
          direction: inbound ? 'in' : 'out',
          amount: Number(BigInt(String(t?.value ?? '0'))) / Math.pow(10, dec),
          currency: 'USDT',
          counterparty: inbound ? t?.from : t?.to,
          at: t?.block_timestamp ? new Date(Number(t.block_timestamp)).toISOString() : null,
        }
      })
      .sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')))
  } catch { /* cae al respaldo de la app */ }
  if (movements.length === 0) {
    const { data } = await db.from('transactions')
      .select('id, type, amount, currency, status, raw_data, created_at')
      .eq('user_id', _userId).order('created_at', { ascending: false }).limit(300)
    movements = ((data as any[]) ?? []).filter((t) => {
      const rd = (t.raw_data ?? {}) as Record<string, any>
      return [rd.toAddress, rd.fromAddress, rd.address, rd.beneficiary, rd.account].some((x) => String(x ?? '') === a)
    }).map((t) => {
      const rd = (t.raw_data ?? {}) as Record<string, any>
      const inbound = ['load', 'otc_deposit', 'pay_received', 'referral_payout'].includes(t.type) || /dep[oó]sito|recib/i.test(String(rd.title ?? ''))
      return { id: t.id, direction: inbound ? 'in' : 'out', amount: t.amount, currency: (t.currency === 'USD' || t.currency === 'USDT_TRON') ? 'USDT' : t.currency, at: t.created_at }
    })
  }
  return { movements, explorer }
}

// ── GENERAR nueva wallet MANUALMENTE (acción explícita del usuario) ──
// La actual pasa a archivadas y la nueva queda principal. GUARDA: si la wallet
// actual TIENE saldo on-chain, se REHÚSA (para no dejar fondos varados en la
// wallet vieja) — primero hay que enviar/convertir ese saldo.
async function regenerateWalletSafe(userId: string) {
  const idx = await userIndex(userId)
  const cur = await addressForIndex(idx)
  // Chequear saldo de la wallet actual (GasFree + EOA) antes de rotar.
  try {
    const { token } = await gfConfig()
    let bal = 0
    if (cur) bal = await tokenBalance(cur, token.tokenAddress, Number(token.decimal ?? 6))
    if (bal > 0.01) {
      return { ok: false, error: `Tu wallet actual todavía tiene ${bal.toFixed(2)} USDT. Envía o convierte ese saldo antes de generar una nueva, para no dejar fondos en la wallet anterior.`, balance: bal, address: cur }
    }
  } catch { /* si no se pudo leer el saldo, se permite igual (raro) */ }
  const res = await resetUserIndex(userId, 'manual_regen')
  return { ok: true, previousAddress: res.oldAddress ?? cur, address: res.gasFreeAddress, index: res.newIndex }
}

// FIJAR (pin) la wallet REAL de un usuario a una dirección conocida.
// Caso: la fila del usuario apunta a una wallet (p. ej. …MdW, vacía) distinta
// de la que el CLIENTE ve y usa (p. ej. …1gC, con su USDT). Eso pasa cuando el
// índice de …1gC se perdió/sobrescribió y ya no está guardado en ninguna fila,
// así que la reconciliación por correo no tiene a qué converger. Aquí se
// ESCANEA para hallar el índice HD que deriva a `address` y se escribe como el
// gasfreeIndex canónico en TODAS las filas del correo. NO mueve fondos: solo
// hace que admin y cliente vean la MISMA wallet (la real, con el dinero).
async function pinAddressToUser(userId: string, address: string) {
  const addr = String(address || '').trim()
  if (!addr) throw new Error('Falta la dirección a fijar')

  const { data: primary } = await db.from('users').select('id, email, raw_data').eq('id', userId).maybeSingle()
  if (!primary) throw new Error('Usuario no encontrado')
  let rows: any[] = [primary]
  if (primary.email) {
    const { data: sibs } = await db.from('users').select('id, email, raw_data').eq('email', primary.email)
    if (Array.isArray(sibs) && sibs.length) rows = sibs
  }

  type Match = { index: number; eoa: string; gasFreeAddress: string | null; mnemonic: string; balanceUsdt?: number }
  let match: Match | null = null

  // (1) Probar los índices DETERMINISTAS del usuario (offset 1.000.000+ que el
  //     escaneo secuencial NO cubre). Ahí caen las wallets generadas en
  //     sesiones sin fila real (half-auth) — justo el caso que el escaneo no
  //     encontraba. Se prueban los de cada fila hermana y el del userId.
  const detCandidates = Array.from(new Set(
    rows.map(r => deterministicIndex(String(r.id))).concat([deterministicIndex(String(userId))])
  ))
  for (const i of detCandidates) {
    try {
      const { eoa } = await userWallet(i)
      const acct = await gfAccount(eoa)
      if (eoa === addr || acct.gasFreeAddress === addr) {
        match = { index: i, eoa, gasFreeAddress: acct.gasFreeAddress ?? null, mnemonic: 'determinista' }
        break
      }
    } catch { /* sigue con el siguiente candidato */ }
  }

  // (2) Si no cayó en un determinista, escaneo secuencial AMPLIO.
  let apiErrors = 0
  if (!match) {
    const hit = await findAddress(addr, 120)
    if (hit?.found && typeof hit.index === 'number') {
      match = { index: hit.index, eoa: hit.eoa, gasFreeAddress: hit.gasFreeAddress, mnemonic: hit.mnemonic, balanceUsdt: hit.balanceUsdt }
    } else {
      apiErrors = Number((hit as any)?.apiErrors ?? 0)
    }
  }

  if (!match) {
    // DIAGNÓSTICO: ¿la dirección es de la RAMA de la RECAUDADORA (change=1)?
    // Esas NO son wallets de cliente — no se pueden asignar a un usuario.
    try {
      const cur = recaudadoraPeriod()
      for (let p = cur; p > cur - 18; p--) {
        const { eoa } = await recaudadoraWalletFrom(MNEMONIC, p)
        const acct = await gfAccount(eoa)
        if (eoa === addr || acct.gasFreeAddress === addr) {
          throw new Error(`Esa dirección es la RECAUDADORA (colector de Lincoin) del período ${periodLabel(p)}, NO una wallet de cliente. Su saldo es de tesorería, no de ${primary.email ?? 'este cliente'}. No se puede fijar a un usuario.`)
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('RECAUDADORA')) throw e
      /* si el chequeo de recaudadora falla por red, seguimos al error genérico */
    }
    // Qué deriva el usuario AHORA (para comparar) — sin escribir nada.
    let current = ''
    try {
      const praw = (primary.raw_data ?? {}) as Record<string, any>
      const idx = typeof praw.gasfreeIndex === 'number' ? praw.gasfreeIndex : deterministicIndex(String(primary.id))
      const { eoa } = await userWallet(idx)
      const acct = await gfAccount(eoa)
      current = ` · Hoy este cliente deriva la wallet ${acct.gasFreeAddress ?? eoa} (índice ${idx}).`
    } catch { /* opcional */ }
    if (apiErrors > 0) {
      throw new Error(`No pude confirmar ${addr}: la API de GasFree limitó el escaneo (${apiErrors} consultas fallaron). NO es que no exista — reintenta en 1-2 minutos y debería encontrarla.${current}`)
    }
    throw new Error(`No se encontró ${addr} en la semilla de Lincoin (probé recaudadora, índices deterministas y escaneo amplio, sin errores de API).${current} Verifica que sea la dirección EXACTA que mostró la app (la "TU DIRECCIÓN USDT"), no una copiada de otro lado.`)
  }

  await persistIndexToRows(rows, match.index, 'admin_pin')   // escribe el índice y lo registra en el log
  let bal = match.balanceUsdt
  if (bal == null) {
    try { const { token } = await gfConfig(); bal = match.gasFreeAddress ? await tokenBalance(match.gasFreeAddress, token.tokenAddress, Number(token.decimal ?? 6)) : 0 } catch { /* opcional */ }
  }
  return {
    ok: true, email: primary.email, index: match.index, mnemonic: match.mnemonic,
    eoa: match.eoa, gasFreeAddress: match.gasFreeAddress, balanceUsdt: bal,
  }
}

// ── Resolver / acreditar una CONVERSIÓN TRABADA (acción admin) ──────────
// Cuando el USDT ya llegó al proveedor pero la conversión USDT→COP no cerró
// (p. ej. el monto que llegó fue 4.990,50 y el sistema esperaba 4.992 por una
// comisión extra), el cliente quedó DEBITADO el USDT sin recibir su COP. Como
// el USDT ya está en la tesorería de Lincoin, esta acción acredita el COP
// adeudado al cliente y CIERRA el movimiento. Es idempotente (CAS por estado):
// si ya se acreditó, no vuelve a acreditar.
async function resolveConvertTx(ref: string) {
  const r = String(ref || '').trim()
  if (!r) return null
  // Exacto por id; si no, por sufijo (el admin ve "TX-B385BF").
  let { data: tx } = await db.from('transactions')
    .select('id, user_id, status, amount, currency, raw_data, type').eq('id', r).maybeSingle()
  if (!tx) {
    const { data: rows } = await db.from('transactions')
      .select('id, user_id, status, amount, currency, raw_data, type')
      .ilike('id', `%${r.replace(/^tx[-_]?/i, '')}`).order('created_at', { ascending: false }).limit(3)
    if (rows && rows.length === 1) tx = rows[0]
    else if (rows && rows.length > 1) throw new Error('Varias transacciones coinciden — pega el ID completo.')
  }
  return tx ?? null
}

// Lista las conversiones TRABADAS (no completadas ni rechazadas). Con userId
// filtra por cliente. Sirve para que el admin resuelva sin adivinar el ID.
async function listStuckConverts(userId?: string) {
  let q = db.from('transactions')
    .select('id, user_id, status, amount, currency, raw_data, created_at')
    .eq('type', 'convert')
    .not('status', 'in', '("Completado","Rechazado","Fallido")')
    .order('created_at', { ascending: false }).limit(50)
  if (userId) q = q.eq('user_id', userId)
  const { data } = await q
  const items = ((data as any[]) ?? []).map((tx) => {
    const rd = (tx.raw_data ?? {}) as Record<string, any>
    return {
      txId: tx.id, userId: tx.user_id, status: tx.status, currency: tx.currency,
      owedCop: Math.round(Number(rd.destAmount ?? tx.amount ?? 0)), createdAt: tx.created_at,
    }
  })
  return { ok: true, items }
}

async function adminSettleConvert(ref: string, opts: { rail?: string; amount?: number; preview?: boolean }) {
  const tx = await resolveConvertTx(ref)
  if (!tx) throw new Error('Movimiento no encontrado (revisa el ID).')
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const owedCop = opts.amount != null ? Math.round(Number(opts.amount)) : Math.round(Number(rd.destAmount ?? tx.amount ?? 0))
  const { data: cu } = await db.from('users').select('email, full_name').eq('id', tx.user_id).maybeSingle()
  // Riel destino: por defecto a Saldo Lincoin (COP) — el más seguro cuando el
  // riel ACH es justo el que no cerró. El admin puede pedir COP_ACH/COP_BREB.
  const ALLOWED_RAILS = ['COP', 'COP_ACH', 'COP_BREB']
  const targetRail = opts.rail && ALLOWED_RAILS.includes(opts.rail) ? opts.rail : 'COP'
  const info = {
    txId: tx.id, userId: tx.user_id, email: cu?.email ?? null, name: cu?.full_name ?? null,
    status: tx.status, currency: tx.currency, phase: rd.convertPhase ?? null,
    owedCop, rail: targetRail, fromAmount: rd.fromAmount ?? null, rate: rd.mouvRate ?? null,
  }
  if (opts.preview) return { ok: true, preview: true, ...info }
  if (tx.status === 'Completado') return { ok: true, already: true, message: 'La conversión ya estaba acreditada.', ...info }
  if (!(owedCop > 0)) throw new Error('No hay un monto COP válido para acreditar en este movimiento.')
  // CAS: cerrar el movimiento SOLO si sigue sin completar → evita doble crédito
  // si se hace clic dos veces o el autopiloto la cierra al tiempo.
  const { data: claimed } = await db.from('transactions')
    .update({ status: 'Completado', raw_data: { ...rd, convertPhase: 'done', adminSettled: true, adminSettledAt: new Date().toISOString(), settledRail: targetRail, settledCop: owedCop } })
    .eq('id', tx.id).neq('status', 'Completado').select('id')
  if (!claimed || claimed.length === 0) return { ok: true, already: true, message: 'Otra acción ya la acreditó (evité el doble crédito).', ...info }
  // Acreditar el COP al cliente (atómico; fallback read-write).
  const { data: adj, error: adjErr } = await db.rpc('adjust_balances', { p_user_id: tx.user_id, p_fiat: { [targetRail]: owedCop } })
  let newBal: number | null = null
  if (!adjErr && !(adj as any)?.error) {
    newBal = Number((adj as any)?.balances?.[targetRail] ?? 0)
  } else {
    const { data: u2 } = await db.from('users').select('balances').eq('id', tx.user_id).single()
    const b = (u2?.balances as Record<string, number>) ?? {}
    newBal = parseFloat((Number(b[targetRail] ?? 0) + owedCop).toFixed(2))
    await db.from('users').update({ balances: { ...b, [targetRail]: newBal } }).eq('id', tx.user_id)
  }
  return { ok: true, credited: owedCop, rail: targetRail, newBalance: newBal, ...info }
}

// Índice determinista de respaldo (offset alto: el contador secuencial de
// clientes arranca en 1 y crece de a uno, así que 1_000_000+ nunca choca).
function deterministicIndex(userId: string): number {
  let h = 2166136261
  for (let i = 0; i < userId.length; i++) { h ^= userId.charCodeAt(i); h = Math.imul(h, 16777619) }
  return 1_000_000 + (Math.abs(h | 0) % 1_000_000)
}

// Asignación ATÓMICA del siguiente índice (evita el race read-then-write).
// Usa la función SQL next_gasfree_index; si aún no existe, cae al método
// anterior (no atómico) para no romper.
async function allocNextIndex(): Promise<number> {
  try {
    const { data, error } = await db.rpc('next_gasfree_index')
    if (!error && typeof data === 'number' && data >= 1) return data
  } catch { /* RPC no desplegada aún → fallback */ }
  const { data: cfg } = await db.from('system_config').select('value').eq('key', 'gasfree_hd_counter').single()
  const next = cfg?.value ? (parseInt(cfg.value) + 1) : 1
  await saveSystemConfig('gasfree_hd_counter', String(next))
  return next
}

// ── Envío GasFree (firma TIP-712 + submit) ────────────────
async function sendCore(signerPkHex: string, fromEoaB58: string, toB58: string, amountHuman: number) {
  const { token, provider } = await gfConfig()
  const acct = await gfAccount(fromEoaB58)
  if (!acct.allowSubmit) throw new Error('Hay una transferencia GasFree pendiente en esta wallet — espera a que confirme')
  const dec = Number(token.decimal ?? 6)
  const value = BigInt(Math.round(amountHuman * Math.pow(10, dec)))
  const maxFee = BigInt(token.transferFee ?? 0) + (acct.active ? 0n : BigInt(token.activateFee ?? 0))
  const deadline = Math.floor(Date.now() / 1000) + Number(provider.config?.defaultDeadlineDuration ?? 180)
  const toHex = (b58: string) => '0x' + tronAddrToEvmHex(b58)
  const domain = { name: 'GasFreeController', version: 'V1.0.0', chainId: CFG.chainId, verifyingContract: toHex(CFG.verifying) }
  const types = { PermitTransfer: [
    { name: 'token', type: 'address' }, { name: 'serviceProvider', type: 'address' },
    { name: 'user', type: 'address' }, { name: 'receiver', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'maxFee', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }, { name: 'version', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
  ] }
  const msg = {
    token: toHex(token.tokenAddress), serviceProvider: toHex(provider.address),
    user: toHex(fromEoaB58), receiver: toHex(toB58),
    value: value.toString(), maxFee: maxFee.toString(),
    deadline: deadline.toString(), version: 1, nonce: acct.nonce,
  }
  const wallet = new ethers.Wallet(signerPkHex.startsWith('0x') ? signerPkHex : '0x' + signerPkHex)
  const sig = (await wallet.signTypedData(domain, types, msg)).replace(/^0x/, '')
  const submit = await gfPost('/api/v1/gasfree/submit', {
    requestId: crypto.randomUUID(),
    token: token.tokenAddress, serviceProvider: provider.address,
    user: fromEoaB58, receiver: toB58,
    value: Number(value), maxFee: Number(maxFee),
    deadline, version: 1, nonce: acct.nonce, sig,
  })
  if (submit?.code !== 200) throw new Error(`GasFree rechazó (${submit?.reason ?? submit?.code}): ${submit?.message ?? JSON.stringify(submit).slice(0, 200)}`)
  // La comisión REAL que GasFree va a cobrar (puede ser menor al maxFee
  // límite) viene en la respuesta del submit — es la que hay que mostrarle
  // al cliente, no un valor fijo inventado (la comisión de GasFree varía:
  // $1, $1.2, $1.5... según congestión de red).
  //
  // ⚠️ GasFree devuelve 'estimatedActivateFee' en la respuesta del submit
  // AUNQUE la cuenta ya estaba activa (no la pedimos en maxFee — arriba
  // "maxFee" ya la excluye si acct.active). Si confiamos ciegamente en ese
  // campo, el cliente ve "cobrado $3" (activación + transferencia) en CADA
  // envío, no solo en el primero, aunque en la cadena solo se haya
  // descontado la comisión de transferencia. Forzamos a 0 cuando ya
  // sabemos, por acct.active, que la activación no se pidió ni se pagó.
  const d = submit.data ?? {}
  const activateFeeCharged = acct.active ? 0 : Number(d.estimatedActivateFee ?? 0) / Math.pow(10, dec)
  const transferFeeCharged = Number(d.estimatedTransferFee ?? d.estimateTransferFee ?? 0) / Math.pow(10, dec)
  return {
    ok: true, traceId: d.id, state: d.state, gasFreeAddress: acct.gasFreeAddress,
    maxFeeUsdt: Number(maxFee) / Math.pow(10, dec),
    feeChargedUsdt: parseFloat((activateFeeCharged + transferFeeCharged).toFixed(dec)),
    activateFeeUsdt: activateFeeCharged, transferFeeUsdt: transferFeeCharged,
  }
}

// Estado on-chain de una transferencia GasFree: confirmed | failed | pending.
async function gfTraceStatus(traceId: string): Promise<'confirmed' | 'failed' | 'pending'> {
  if (!traceId) return 'pending'
  try {
    const r = await gfGet(`/api/v1/gasfree/${traceId}`)
    const st = String(r?.data?.state ?? r?.data?.status ?? '').toUpperCase()
    if (/SUCC|CONFIRM|COMPLET|DONE|FINISH/.test(st)) return 'confirmed'
    if (/FAIL|REJECT|ERROR|CANCEL|EXPIRE/.test(st)) return 'failed'
    return 'pending'
  } catch { return 'pending' }
}
// Espera a que una transferencia confirme on-chain (o falle), con tope de
// tiempo. GasFree normalmente confirma en segundos; el tope evita colgar.
async function waitTrace(traceId: string, maxMs = 40000, stepMs = 3000): Promise<'confirmed' | 'failed' | 'pending'> {
  const start = Date.now()
  let s = await gfTraceStatus(traceId)
  while (s === 'pending' && (Date.now() - start) < maxMs) {
    await new Promise((res) => setTimeout(res, stepMs))
    s = await gfTraceStatus(traceId)
  }
  return s
}

// ── Acciones de alto nivel ────────────────────────────────
async function status() {
  const { token, provider } = await gfConfig()
  const { eoa } = await recaudadora()
  const acct = await gfAccount(eoa)
  const balance = acct.gasFreeAddress ? await tokenBalance(acct.gasFreeAddress, token.tokenAddress, Number(token.decimal ?? 6)) : 0
  return { net: NET, eoa, ...acct, balance, token, provider }
}
async function userAddress(userId: string) {
  const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await userIndex(userId)
  const { eoa } = await userWallet(index)
  const { token } = await gfConfig()
  const acct = await gfAccount(eoa)
  const dec = Number(token.decimal ?? 6)
  const balance = acct.gasFreeAddress ? await tokenBalance(acct.gasFreeAddress, token.tokenAddress, dec) : 0
  const eoaBalance = await tokenBalance(eoa, token.tokenAddress, dec)
  const raw = (u.raw_data ?? {}) as Record<string, any>
  if (acct.gasFreeAddress && raw.gasfreeAddress !== acct.gasFreeAddress) {
    await mergeUserRaw(userId, { gasfreeEoa: eoa, gasfreeAddress: acct.gasFreeAddress })
  }
  // Qué tokens llegaron REALMENTE a la cajita (para diagnosticar depósitos
  // que no aparecen: casi siempre es un contrato USDT distinto).
  const tokensAtGasFree = acct.gasFreeAddress ? await scanTrc20(acct.gasFreeAddress) : []
  return {
    userId, email: u.email, index, eoa,
    gasFreeAddress: acct.gasFreeAddress, active: acct.active, nonce: acct.nonce, balance,
    debug: { net: NET, usdtContract: token.tokenAddress, symbol: token.symbol, gasFreeBalance: balance, tokensAtGasFree },
  }
}
async function sweepUser(userId: string) {
  const { data: u } = await db.from('users').select('email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await userIndex(userId)
  const { pkHex, eoa } = await userWallet(index)
  const { token } = await gfConfig()
  const acct = await gfAccount(eoa)
  if (!acct.gasFreeAddress) throw new Error('El usuario aún no tiene dirección GasFree')
  const dec = Number(token.decimal ?? 6)
  const bal = await tokenBalance(acct.gasFreeAddress, token.tokenAddress, dec)
  const fee = (Number(token.transferFee ?? 0) + (acct.active ? 0 : Number(token.activateFee ?? 0))) / Math.pow(10, dec)
  const sendable = parseFloat((bal - fee).toFixed(dec))
  if (sendable <= 0) throw new Error(`Saldo GasFree insuficiente para barrer (${bal} USDT, comisión ${fee})`)
  const rec = await recaudadora()
  const recAcct = await gfAccount(rec.eoa)
  const dest = recAcct.gasFreeAddress ?? rec.eoa
  const r = await sendCore(pkHex, eoa, dest, sendable)
  await db.from('transactions').insert({
    user_id: userId, type: 'admin_hot_withdrawal', amount: sendable, currency: 'USDT_TRON', status: 'Completado',
    raw_data: { fromAddress: acct.gasFreeAddress, toAddress: dest, traceId: r.traceId, sweep: true, gasfree: true, sweptAt: new Date().toISOString() },
  })
  await logTreasuryMovement({
    direction: 'in', amount: sendable, fromAddress: acct.gasFreeAddress, fromUserEmail: u.email,
    traceId: r.traceId, state: r.state, feeChargedUsdt: r.feeChargedUsdt,
    activateFeeUsdt: r.activateFeeUsdt, transferFeeUsdt: r.transferFeeUsdt,
  })
  return { ok: true, email: u.email, swept: sendable, ...r }
}

// ── Auto-servicio del CLIENTE: su propia wallet GasFree ───
// Comisión SIEMPRE en vivo (nunca cacheada) — GasFree la ajusta según
// congestión de red, por eso variaba entre $1, $1.2, $1.5... El cliente
// debe ver el número real de HOY antes de confirmar un envío.
async function myStatus(userId: string) {
  const { data: u } = await db.from('users').select('email, raw_data').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await userIndex(userId)
  const { eoa } = await userWallet(index)
  const { token } = await gfConfig()
  const acct = await gfAccount(eoa)
  const dec = Number(token.decimal ?? 6)
  const balance = acct.gasFreeAddress ? await tokenBalance(acct.gasFreeAddress, token.tokenAddress, dec) : 0
  const activateFeeUsdt = Number(token.activateFee ?? 0) / Math.pow(10, dec)
  const transferFeeUsdt = Number(token.transferFee ?? 0) / Math.pow(10, dec)
  // Guardar la dirección en el perfil — es SIEMPRE la misma (determinista),
  // así el cliente la carga instantáneo la próxima vez sin volver a
  // consultarle a GasFree por red (evita el "Generando…" repetido).
  const raw = (u.raw_data ?? {}) as Record<string, any>
  if (acct.gasFreeAddress && raw.gasfreeAddress !== acct.gasFreeAddress) {
    await mergeUserRaw(userId, { gasfreeEoa: eoa, gasfreeAddress: acct.gasFreeAddress })
  }
  return {
    email: u.email, gasFreeAddress: acct.gasFreeAddress, active: acct.active, balance,
    // Comisión que se cobrará en el PRÓXIMO envío (viva, consultada ahora mismo)
    feeQuote: {
      transferFeeUsdt,
      activateFeeUsdt: acct.active ? 0 : activateFeeUsdt, // solo la 1ª vez
      totalFeeUsdt: transferFeeUsdt + (acct.active ? 0 : activateFeeUsdt),
      note: 'La comisión de GasFree varía según la red — este es el valor vigente ahora mismo.',
    },
  }
}
// Envío del propio cliente (paga con su saldo GasFree). Registra el
// movimiento con el desglose real de comisión para que quede trazable.
async function mySend(userId: string, toAddress: string, amount: number) {
  const { data: u } = await db.from('users').select('email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await userIndex(userId)
  const { pkHex, eoa } = await userWallet(index)
  const r = await sendCore(pkHex, eoa, toAddress, amount)
  await db.from('transactions').insert({
    user_id: userId, type: 'send', amount, currency: 'USDT_TRON', status: 'Completado',
    raw_data: {
      title: 'Envío USDT (GasFree)', beneficiary: toAddress, account: toAddress,
      traceId: r.traceId, state: r.state, gasfree: true,
      feeChargedUsdt: r.feeChargedUsdt, activateFeeUsdt: r.activateFeeUsdt, transferFeeUsdt: r.transferFeeUsdt,
      note: r.activateFeeUsdt ? `Comisión GasFree: ${r.feeChargedUsdt} USDT (incluye ${r.activateFeeUsdt} USDT de activación, solo esta vez)` : `Comisión GasFree: ${r.feeChargedUsdt} USDT`,
      sentAt: new Date().toISOString(),
    },
  })
  return r
}

// ─── Multi-wallet GasFree del cliente (studios, negocios) ───
// El cliente puede tener VARIAS wallets GasFree además de su principal (la del
// OTC). Cada sub-wallet es una wallet GasFree real derivada de un índice HD
// propio. Se guardan en users.raw_data.subWallets. NO se pueden eliminar, solo
// archivar. La principal (índice de userIndex) es única y es la del OTC.
async function myWalletsList(userId: string) {
  const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const raw = (u.raw_data ?? {}) as Record<string, any>
  const { token } = await gfConfig()
  const dec = Number(token.decimal ?? 6)

  // La lista NO debe quedar "Cargando…" para siempre cuando el relay GasFree
  // o TronGrid están lentos. Dos cambios clave frente a la versión anterior:
  //   1. La dirección de cada sub-wallet YA está guardada (al crearse) — no se
  //      vuelve a pedir a gfAccount. Solo el SALDO va a la red.
  //   2. Cada consulta on-chain lleva timeout: si no responde en unos segundos
  //      se devuelve saldo 0 (o el último conocido) y la lista carga igual.
  //      Un refresco posterior trae los saldos reales.
  const withTimeout = <T,>(p: Promise<T>, ms: number, fb: T): Promise<T> =>
    Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fb), ms))])
  const balAt = (address: string | null | undefined): Promise<number> =>
    address ? withTimeout(tokenBalance(address, token.tokenAddress, dec).catch(() => 0), 6000, 0) : Promise.resolve(0)

  // Principal (OTC): índice + derivación HD son locales/rápidos. La dirección
  // GasFree sí requiere el relay → con timeout, cayendo al eoa si no responde.
  const pIndex = await userIndex(userId)
  const { eoa: pEoa } = await userWallet(pIndex)
  const subs: any[] = Array.isArray(raw.subWallets) ? raw.subWallets : []

  // Resolver la dirección del principal y TODOS los saldos de sub-wallets a la
  // vez (los subs usan su dirección ya guardada, así arrancan sin esperar).
  const [pAcct, subBalances] = await Promise.all([
    withTimeout(gfAccount(pEoa).catch(() => ({ gasFreeAddress: null as string | null })), 6000, { gasFreeAddress: null as string | null }),
    Promise.all(subs.map((w) => balAt(w.address ?? w.eoa))),
  ])
  const pBalance = await balAt(pAcct.gasFreeAddress)
  const principal = { id: 'principal', index: pIndex, name: 'Wallet principal (OTC)', address: pAcct.gasFreeAddress ?? pEoa, eoa: pEoa, balance: pBalance, principal: true, archived: false }

  const enriched = subs
    .map((w, i) => ({ ...w, balance: subBalances[i] ?? 0 }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return { principal, wallets: enriched }
}
async function myWalletCreate(userId: string, name: string) {
  const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const raw = (u.raw_data ?? {}) as Record<string, any>
  const subs: any[] = Array.isArray(raw.subWallets) ? raw.subWallets : []
  if (subs.filter((w) => !w.archived).length >= 50) throw new Error('Alcanzaste el máximo de 50 wallets activas — archiva alguna para crear más')
  const index = await allocNextIndex()
  const { eoa } = await userWallet(index)
  const acct = await gfAccount(eoa)
  const w = {
    id: crypto.randomUUID(), index, name: String(name || 'Wallet').trim().slice(0, 40) || 'Wallet',
    address: acct.gasFreeAddress ?? eoa, eoa, archived: false, order: subs.length, createdAt: new Date().toISOString(),
  }
  subs.push(w)
  await mergeUserRaw(userId, { subWallets: subs })
  return { ok: true, wallet: { ...w, balance: 0 } }
}
async function myWalletUpdate(userId: string, id: string, patch: { name?: string; archived?: boolean; order?: number }) {
  const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const raw = (u.raw_data ?? {}) as Record<string, any>
  const subs: any[] = Array.isArray(raw.subWallets) ? raw.subWallets : []
  const w = subs.find((x) => x.id === id)
  if (!w) throw new Error('Wallet no encontrada')
  if (typeof patch.name === 'string' && patch.name.trim()) w.name = patch.name.trim().slice(0, 40)
  if (typeof patch.archived === 'boolean') w.archived = patch.archived
  if (typeof patch.order === 'number') w.order = patch.order
  await mergeUserRaw(userId, { subWallets: subs })
  return { ok: true, wallet: w }
}
// Reordena TODAS las sub-wallets según una lista de ids.
async function myWalletsReorder(userId: string, ids: string[]) {
  const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const raw = (u.raw_data ?? {}) as Record<string, any>
  const subs: any[] = Array.isArray(raw.subWallets) ? raw.subWallets : []
  const pos = new Map(ids.map((id, i) => [id, i]))
  for (const w of subs) if (pos.has(w.id)) w.order = pos.get(w.id)
  await mergeUserRaw(userId, { subWallets: subs })
  return { ok: true }
}
async function myWalletSend(userId: string, id: string, toAddress: string, amount: number) {
  if (!(amount > 0)) throw new Error('Monto inválido')
  const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const raw = (u.raw_data ?? {}) as Record<string, any>
  const subs: any[] = Array.isArray(raw.subWallets) ? raw.subWallets : []
  // 'principal' → índice del OTC; si no, la sub-wallet por id.
  let index: number, walletName: string
  if (id === 'principal') { index = await userIndex(userId); walletName = 'Wallet principal (OTC)' }
  else { const w = subs.find((x) => x.id === id); if (!w) throw new Error('Wallet no encontrada'); index = w.index; walletName = w.name }
  const { pkHex, eoa } = await userWallet(index)
  const r = await sendCore(pkHex, eoa, String(toAddress), amount)
  await db.from('transactions').insert({
    user_id: userId, type: 'send', amount, currency: 'USDT_TRON', status: 'Completado',
    raw_data: {
      title: `Envío USDT desde ${walletName}`, fromWallet: walletName, beneficiary: toAddress, account: toAddress,
      traceId: r.traceId, state: r.state, gasfree: true,
      feeChargedUsdt: r.feeChargedUsdt, activateFeeUsdt: r.activateFeeUsdt, transferFeeUsdt: r.transferFeeUsdt,
      sentAt: new Date().toISOString(),
    },
  })
  return r
}

// Asentamiento COMPLETO de una conversión OTC del propio cliente, TODO
// server-side y autoritativo (service-role) para que no haya carreras con
// los polls del cliente. En UNA sola llamada:
//   1. Barre el USDT real de la wallet GasFree del cliente → recaudadora
//      (GasFree cobra su comisión UNA vez; antes se restaba dos veces: en
//      el convertidor Y en el barrido, dejando la tesorería corta).
//   2. Acredita el COP al saldo interno del cliente leyendo FRESCO de la DB
//      (antes el COP se escribía en el cliente y un poll lo pisaba con el
//      valor viejo → "desaparecía" al recargar).
//   3. Reajusta gasfreeCredited al saldo on-chain real tras el barrido (si
//      no, el contador queda inflado y los depósitos futuros no se detectan).
//   4. Registra UN solo movimiento 'convert' con el USDT que salió, la
//      comisión GasFree y el traceId adentro — no un "barrido" aparte.
async function myConvertSettle(
  userId: string, grossUsd: number, copAmount: number,
  meta: { mouvRate?: number; feePct?: number; utilityCop?: number; creditUsd?: number },
) {
  if (!(grossUsd > 0)) throw new Error('Monto inválido')
  if (!(copAmount > 0)) throw new Error('COP inválido')
  const { data: u } = await db.from('users').select('email, raw_data, balances').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await userIndex(userId)
  const { pkHex, eoa } = await userWallet(index)
  const { token } = await gfConfig()
  const acct = await gfAccount(eoa)
  if (!acct.gasFreeAddress) throw new Error('Aún no tienes wallet GasFree')
  const dec = Number(token.decimal ?? 6)
  const bal = await tokenBalance(acct.gasFreeAddress, token.tokenAddress, dec)

  // Registrar la ENTRADA de USDT si llegó un depósito que aún NO se había
  // contabilizado. Si el cliente convierte sin abrir antes la billetera
  // (que es lo que dispara my_status/myVerifyDeposit), el depósito se
  // consumía en la conversión sin dejar su movimiento de "llegada" — y al
  // resetear gasfreeCredited más abajo, ya nunca se registraba. Aquí se
  // deja el 'load' correspondiente antes de convertir.
  {
    const rawPre = (u.raw_data ?? {}) as Record<string, any>
    const prevCredited: number = typeof rawPre.gasfreeCredited === 'number' ? rawPre.gasfreeCredited : 0
    const incoming = parseFloat((bal - prevCredited).toFixed(dec))
    if (incoming > 0.0001) {
      const inc = await latestIncomingTrc20(acct.gasFreeAddress, token.tokenAddress, dec, incoming)
      await db.from('transactions').insert({
        user_id: userId, type: 'load', amount: incoming, currency: 'USD', status: 'Completado',
        raw_data: {
          initials: '₮', title: 'Depósito USDT (GasFree · TRC-20)', createdAt: new Date().toISOString(),
          userName: u.email, source: 'GASFREE',
          network: 'TRON (TRC-20)',
          toAddress: acct.gasFreeAddress,
          ...(inc ? { fromAddress: inc.from, txId: inc.txId } : {}),
        },
      })
    }
  }

  const fee = (Number(token.transferFee ?? 0) + (acct.active ? 0 : Number(token.activateFee ?? 0))) / Math.pow(10, dec)
  // El receptor (tesorería) recibe `value`; la cuenta del cliente se debita
  // `value + fee`. Se barre el BRUTO que el cliente quiso convertir menos la
  // comisión — así el USDT que llega a tesorería respalda exactamente el COP
  // acreditado (que se calculó sobre ese mismo neto).
  const value = parseFloat((Math.min(grossUsd, bal) - fee).toFixed(dec))
  if (value <= 0) throw new Error(`Saldo GasFree insuficiente (tienes ${bal} USDT, comisión ${fee})`)
  const rec = await recaudadora()
  const recAcct = await gfAccount(rec.eoa)
  const dest = recAcct.gasFreeAddress ?? rec.eoa
  const r = await sendCore(pkHex, eoa, dest, value)  // hop 1: cliente → tesorería

  // El USDT del cliente YA salió de su wallet: se debita su USD y se reajusta
  // gasfreeCredited. El COP NO se acredita todavía — solo cuando Mouv confirme
  // (modelo SIN CAJA: no adelantamos COP hasta que el USDT llegue al proveedor).
  // Re-leer saldo y raw_data frescos. El débito del USD va por adjust_balances
  // (ATÓMICO, solo la columna USD) — antes se sobre-escribía `balances` entero
  // desde una lectura obsoleta y pisaba los rieles COP u otra operación USD
  // concurrente. Se debita lo convertido, acotado al disponible (nunca negativo,
  // preservando el max(0,…) anterior).
  const { data: freshCS } = await db.from('users').select('balances, raw_data').eq('id', userId).maybeSingle()
  const raw = (freshCS?.raw_data ?? u.raw_data ?? {}) as Record<string, any>
  const curUsd = Number(((freshCS?.balances as any)?.USD) ?? (u.balances as any)?.USD ?? 0)
  const debitUsd = Math.min(grossUsd, Math.max(0, curUsd))
  if (debitUsd > 0) {
    const { error: dErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { USD: -debitUsd } })
    if (dErr) {
      // Fallback si la RPC no está desplegada (solo la columna USD, floor en 0).
      const { data: uu } = await db.from('users').select('balances').eq('id', userId).maybeSingle()
      const b = (uu?.balances as Record<string, number>) ?? {}
      await db.from('users').update({ balances: { ...b, USD: Math.max(0, parseFloat((Number(b.USD ?? 0) - debitUsd).toFixed(2))) } }).eq('id', userId)
    }
  }
  const onchainAfter = Math.max(0, parseFloat((bal - value - fee).toFixed(dec)))
  await db.from('users').update({ raw_data: { ...raw, gasfreeCredited: onchainAfter } }).eq('id', userId)

  await logTreasuryMovement({
    direction: 'in', amount: value, fromAddress: acct.gasFreeAddress, fromUserEmail: u.email,
    context: 'conversion_otc', traceId: r.traceId, state: r.state, feeChargedUsdt: r.feeChargedUsdt,
    activateFeeUsdt: r.activateFeeUsdt, transferFeeUsdt: r.transferFeeUsdt,
  })

  // Resolver proveedor (Mouv) destino del hop 2.
  const providers = await getProviders()
  const tcfg = await getTreasuryConfig()
  let prov = providers.find((p: any) => p.id === tcfg.alertProviderId)
  if (!prov) prov = providers.find((p: any) => /mouv/i.test(String(p.name ?? '')))
  if (!prov) prov = providers[0]
  const provAddr = String(prov?.detail ?? '').trim()
  const fee2 = (Number(token.transferFee ?? 0) + (recAcct.active ? 0 : Number(token.activateFee ?? 0))) / Math.pow(10, dec)
  const fwd = parseFloat((value - fee2).toFixed(dec))

  // Campos base del movimiento (se completan según el estado del pipeline).
  const convBase = {
    initials: 'FX', title: `USDT → COP · tasa ${Number(meta.mouvRate ?? 0).toLocaleString('es-CO')}`,
    createdAt: new Date().toISOString(), userName: u.email,
    fromCurrency: 'USD', fromAmount: grossUsd, destAmount: copAmount,
    mouvRate: meta.mouvRate ?? null, feePct: meta.feePct ?? null, utilityCop: meta.utilityCop ?? null,
    creditUsd: meta.creditUsd ?? null,
    source: 'MOUV', gasfree: true,
    usdtOut: value, gasfreeFee: r.feeChargedUsdt, traceId: r.traceId,
    providerName: prov?.name ?? null, providerAddress: provAddr || null, fwd,
  }
  const insertConvert = async (status: string, extra: Record<string, unknown>) => {
    const { data } = await db.from('transactions').insert({
      user_id: userId, type: 'convert', amount: copAmount, currency: 'COP', status,
      raw_data: { ...convBase, ...extra },
    }).select('id').single()
    return data?.id
  }
  const creditCop = async () => {
    await creditBalanceAtomic(userId, 'COP', copAmount)   // atómico (pentest #3)
    const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
    return Number(((uf?.balances as any)?.COP) ?? copAmount)
  }

  // 1) Esperar a que la tesorería reciba el USDT del cliente (hop 1).
  const c1 = await waitTrace(r.traceId)
  if (c1 !== 'confirmed') {
    const txId = await insertConvert('Pendiente', {
      convertPhase: c1 === 'failed' ? 'hop1_failed' : 'hop1_pending',
      usdtToProvider: null, providerTraceId: null, providerPending: true,
      providerError: c1 === 'failed' ? 'El envío a tesorería falló on-chain' : null,
    })
    return { ok: true, status: 'Pendiente', phase: c1 === 'failed' ? 'hop1_failed' : 'hop1_pending',
             copCredited: 0, usdtOut: value, feeChargedUsdt: r.feeChargedUsdt, traceId: r.traceId, txId }
  }

  // 2) Sin proveedor configurado → se acredita el COP (el USDT queda en
  //    tesorería). Mantiene funcionando setups sin proveedor.
  if (!provAddr || fwd <= 0) {
    await assertCopWithinRate(value, copAmount)   // COP acotado al USDT real × tasa del servidor
    const nc = await creditCop()
    const txId = await insertConvert('Completado', { convertPhase: 'no_provider', usdtToProvider: null, providerTraceId: null })
    return { ok: true, status: 'Completado', phase: 'no_provider', copCredited: copAmount, newCop: nc, usdtOut: value, feeChargedUsdt: r.feeChargedUsdt, traceId: r.traceId, txId }
  }

  // 3) Hop 2: tesorería (ya con el USDT del cliente) → Mouv.
  let providerHop: any = null, providerError: string | null = null
  try { providerHop = await payFromTreasury(provAddr, fwd, prov?.name ?? 'Mouv') }
  catch (e) { providerError = String((e as any)?.message ?? e).slice(0, 300) }
  if (!providerHop) {
    const txId = await insertConvert('Pendiente', {
      convertPhase: 'hop2_failed', usdtToProvider: null, providerTraceId: null, providerPending: true, providerError,
    })
    return { ok: true, status: 'Pendiente', phase: 'hop2_failed', copCredited: 0, usdtOut: value, providerError, traceId: r.traceId, txId }
  }

  // 4) Esperar a que Mouv confirme la recepción (hop 2).
  const c2 = await waitTrace(providerHop.traceId)
  if (c2 !== 'confirmed') {
    const txId = await insertConvert('Pendiente', {
      convertPhase: c2 === 'failed' ? 'hop2_failed' : 'hop2_pending',
      usdtToProvider: fwd, providerTraceId: providerHop.traceId, providerPending: true,
      providerError: c2 === 'failed' ? 'El envío al proveedor falló on-chain' : null,
    })
    return { ok: true, status: 'Pendiente', phase: c2 === 'failed' ? 'hop2_failed' : 'hop2_pending',
             copCredited: 0, usdtOut: value, usdtToProvider: fwd, providerTraceId: providerHop.traceId, traceId: r.traceId, txId }
  }

  // 5) Ambos saltos confirmados: el USDT YA ESTÁ EN MOUV (recarga). NO se
  //    acredita COP todavía. El frontend hace ahora la Conversión interna en
  //    Mouv (que así queda DESPUÉS de la recarga en el ledger de Mouv) y
  //    luego llama my_convert_credit para acreditar el COP y completar.
  const txId = await insertConvert('Pendiente', {
    convertPhase: 'recharged', usdtToProvider: fwd, providerTraceId: providerHop.traceId, providerPending: false,
  })
  return {
    ok: true, status: 'Pendiente', phase: 'recharged', recharged: true, copCredited: 0,
    usdtOut: value, usdtToProvider: fwd, feeChargedUsdt: r.feeChargedUsdt, traceId: r.traceId, state: r.state,
    providerForwarded: true, providerName: prov?.name ?? null, providerTraceId: providerHop.traceId, txId,
  }
}

// Acredita el COP al cliente y COMPLETA la conversión, DESPUÉS de que el USDT
// se recargó con el proveedor y se hizo la conversión real (my_convert_settle →
// recharged → convert_confirm del proveedor → este credit). El COP entra al
// SALDO DEL RIEL ACH (COP_ACH): la Mesa OTC hoy liquida por Finity/ACH y el
// cliente dispone de ese saldo desde su billetera ACH. Idempotente.
// Crédito/reintegro ATÓMICO (bloqueo de fila vía adjust_balances) — evita la
// carrera de duplicación en las conversiones (pentest #3). Fallback a read-write.
async function creditBalanceAtomic(userId: string, col: string, delta: number): Promise<void> {
  const { error } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { [col]: delta } })
  if (!error) return
  const { data: u } = await db.from('users').select('balances').eq('id', userId).single()
  const bals: Record<string, number> = (u?.balances as any) ?? {}
  const nb = parseFloat((Number(bals[col] ?? 0) + delta).toFixed(2))
  await db.from('users').update({ balances: { ...bals, [col]: nb } }).eq('id', userId)
}

// Tasa USD→COP de confianza (snapshot admin-only). El OTC de GasFree NO puede
// confiar en el copAmount del cliente — se acota el COP acreditado al USDT
// realmente barrido × tasa del servidor (pentest #2, anti-acuñación).
async function serverUsdCopRate(): Promise<number | null> {
  const { data } = await db.from('fx_rate_snapshots')
    .select('rate, from_currency, to_currency')
    .or('and(from_currency.eq.USD,to_currency.eq.COP),and(from_currency.eq.COP,to_currency.eq.USD)')
    .order('captured_at', { ascending: false }).limit(1)
  const row: any = (data ?? [])[0]
  if (!row || !(Number(row.rate) > 0)) return null
  return row.from_currency === 'USD' ? Number(row.rate) : 1 / Number(row.rate)
}
async function assertCopWithinRate(sweptUsd: number, copAmount: number) {
  if (!(sweptUsd > 0)) throw new Error('Conversión sin USDT verificable')
  const rate = await serverUsdCopRate()
  if (!rate) throw new Error('No hay tasa vigente para la conversión')
  if (copAmount > sweptUsd * rate * 1.02) throw new Error('Monto COP fuera de rango para la conversión')
}

async function myConvertCredit(
  userId: string, txId: string, copAmount: number,
  meta: { mouvRate?: number; feePct?: number; utilityCop?: number },
) {
  if (!(copAmount > 0)) throw new Error('COP inválido')
  const { data: tx } = await db.from('transactions').select('*').eq('id', txId).single()
  if (!tx) throw new Error('Movimiento no encontrado')
  if (tx.user_id !== userId) throw new Error('No autorizado')
  if (tx.status === 'Completado') return { ok: true, status: 'Completado', copCredited: 0 }
  // CRÍTICO: solo se acredita sobre una CONVERSIÓN real que ya pasó el hop al
  // proveedor — sin esto un cliente apuntaba esta acción a su propia
  // dispersión 'Procesando' (o cualquier fila) con un copAmount arbitrario y
  // se auto-acreditaba millones. Se exige type='convert' y una fase donde el
  // USDT ya salió; y el COP se acota al USDT real de la conversión × un tope
  // de tasa razonable, para que un copAmount inflado no pueda pasar.
  if (tx.type !== 'convert') throw new Error('El movimiento no es una conversión')
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const VALID_PHASES = new Set(['recharged', 'converting', 'hop2_pending', 'hop2', 'registered', 'done'])
  if (rd.convertPhase && !VALID_PHASES.has(String(rd.convertPhase))) throw new Error('La conversión aún no llegó al proveedor')
  // ANCLA ANTI-ACUÑACIÓN: el USDT que de verdad se reenvió on-chain al
  // proveedor (usdtToProvider = fwd) o, en su defecto, el barrido real
  // (usdtOut = value). NUNCA rd.creditUsd ni rd.fromAmount: esos vienen del
  // `meta` del cliente (body.creditUsd) y, si se usaran, un cliente podría
  // inflar creditUsd para pasar assertCopWithinRate y acuñar COP.
  const sweptUsd = Number(rd.usdtOut ?? rd.usdtToProvider ?? 0)
  // Acotar el COP al USDT real × la tasa del servidor (no al copAmount del
  // cliente ni a una cota fija holgada). Bloquea acuñar COP inflando el monto.
  await assertCopWithinRate(sweptUsd, copAmount)
  // CANDADO ATÓMICO anti doble-crédito: marca creditClaimed SOLO si no estaba
  // (y el movimiento no está Completado). Si dos llamadas llegan al tiempo
  // (cliente + autopiloto, o dos clics), únicamente UNA gana el claim y
  // acredita; la otra sale sin tocar el saldo. Cierra la carrera de la
  // verificación por estado (leer→comparar→escribir no era atómico).
  const { data: creditClaim } = await db.from('transactions')
    .update({ raw_data: { ...rd, creditClaimed: true } })
    .eq('id', txId).neq('status', 'Completado')
    .filter('raw_data->>creditClaimed', 'is', null)
    .select('id')
  if (!creditClaim || creditClaim.length === 0) {
    return { ok: true, status: 'Completado', copCredited: 0, already: true }
  }
  try {
    await creditBalanceAtomic(userId, 'COP_ACH', copAmount)   // atómico (pentest #3)
  } catch (e) {
    // Si el crédito falla, LIBERAR el claim (rd no trae creditClaimed) para que
    // un reintento legítimo pueda volver a intentarlo — si no, quedaría trabado.
    await db.from('transactions').update({ raw_data: { ...rd } }).eq('id', txId)
    throw e
  }
  const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
  const nc = Number(((uf?.balances as any)?.COP_ACH) ?? copAmount)
  await db.from('transactions').update({
    status: 'Completado', amount: copAmount, currency: 'COP_ACH',
    raw_data: { ...rd, convertPhase: 'done', destAmount: copAmount, creditRail: 'ACH',
      mouvRate: meta.mouvRate ?? rd.mouvRate, feePct: meta.feePct ?? rd.feePct, utilityCop: meta.utilityCop ?? rd.utilityCop,
      title: `USDT → COP (ACH) · tasa ${Number(meta.mouvRate ?? rd.mouvRate ?? 0).toLocaleString('es-CO')}` },
  }).eq('id', txId)
  return { ok: true, status: 'Completado', copCredited: copAmount, newCop: nc, rail: 'ACH' }
}

// Finaliza/reintenta una conversión que quedó 'Pendiente' porque la confirmación
// on-chain tardó más que el tope de espera. Idempotente: reconsulta los traceIds
// y avanza el pipeline; solo acredita el COP cuando Mouv confirma.
async function myConvertFinalize(userId: string, txId: string, settleOnly = false) {
  const { data: tx } = await db.from('transactions').select('*').eq('id', txId).single()
  if (!tx) throw new Error('Movimiento no encontrado')
  if (tx.user_id !== userId) throw new Error('No autorizado')
  if (tx.status === 'Completado') return { ok: true, status: 'Completado', phase: 'done', copCredited: 0 }
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const copAmount = Number(tx.amount ?? 0)
  const provAddr = String(rd.providerAddress ?? '').trim()
  const fwd = Number(rd.fwd ?? 0)

  // settleOnly (lo usa el conversor mientras el cliente ESPERA en pantalla):
  // cuando el hop 2 confirma NO se acredita aquí — se marca 'recharged' y el
  // frontend hace la CONVERSIÓN REAL en el proveedor y acredita al saldo ACH.
  // Sin settleOnly (respaldo/manual), se mantiene el crédito al Saldo Lincoin
  // para que el cliente nunca quede sin su plata mientras el equipo revisa.
  const markRecharged = async (providerTraceId?: string) => {
    await db.from('transactions').update({ raw_data: { ...rd, convertPhase: 'recharged', usdtToProvider: fwd, providerPending: false, providerTraceId: providerTraceId ?? rd.providerTraceId } }).eq('id', txId)
    return { ok: true, status: 'Pendiente', phase: 'recharged', recharged: true, usdtToProvider: fwd, copCredited: 0 }
  }
  const complete = async (providerTraceId?: string) => {
    // Acotar el COP al USDT REAL reenviado (usdtToProvider = fwd, o el barrido
    // usdtOut) × tasa del servidor. NUNCA rd.creditUsd/rd.fromAmount: vienen del
    // `meta` del cliente y un valor inflado dejaría acuñar COP.
    await assertCopWithinRate(Number(rd.usdtOut ?? rd.usdtToProvider ?? rd.fwd ?? 0), copAmount)
    await creditBalanceAtomic(userId, 'COP', copAmount)   // atómico (pentest #3)
    const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
    const nc = Number(((uf?.balances as any)?.COP) ?? copAmount)
    await db.from('transactions').update({ status: 'Completado', raw_data: { ...rd, convertPhase: 'done', providerPending: false, providerTraceId: providerTraceId ?? rd.providerTraceId } }).eq('id', txId)
    return { ok: true, status: 'Completado', phase: 'done', copCredited: copAmount, newCop: nc }
  }

  // Hop 1 pendiente: confirmar → hop 2 → esperar → completar.
  if (rd.convertPhase === 'hop1_pending' || rd.convertPhase === 'hop1_failed') {
    const c1 = await gfTraceStatus(String(rd.traceId ?? ''))
    if (c1 === 'failed') {
      // CAS: reclamar el reembolso UNA sola vez, luego acreditar atómicamente.
      const { data: claimed } = await db.from('transactions')
        .update({ status: 'Rechazado', raw_data: { ...rd, convertPhase: 'hop1_failed', refunded: true } })
        .eq('id', txId).neq('status', 'Rechazado').filter('raw_data->>refunded', 'is', null).select('id')
      if (claimed?.length) await creditBalanceAtomic(userId, 'USD', Number(rd.fromAmount ?? 0))
      return { ok: false, status: 'Rechazado', phase: 'hop1_failed', refunded: true }
    }
    if (c1 !== 'confirmed') return { ok: true, status: 'Pendiente', phase: 'hop1_pending', copCredited: 0 }
    if (!provAddr || fwd <= 0) return settleOnly ? { ok: true, status: 'Pendiente', phase: 'no_provider', copCredited: 0 } : await complete()
    let hop: any = null
    try { hop = await payFromTreasury(provAddr, fwd, String(rd.providerName ?? 'Mouv')) } catch { /* reintentar luego */ }
    if (!hop) return { ok: true, status: 'Pendiente', phase: 'hop2_failed', copCredited: 0 }
    await db.from('transactions').update({ raw_data: { ...rd, convertPhase: 'hop2_pending', providerTraceId: hop.traceId, usdtToProvider: fwd } }).eq('id', txId)
    const c2 = await waitTrace(hop.traceId)
    return c2 === 'confirmed' ? (settleOnly ? await markRecharged(hop.traceId) : await complete(hop.traceId)) : { ok: true, status: 'Pendiente', phase: 'hop2_pending', copCredited: 0 }
  }

  // Hop 2 pendiente: reconsultar el traceId (o reenviar si no se llegó a enviar).
  if (rd.convertPhase === 'hop2_pending' || rd.convertPhase === 'hop2_failed') {
    if (rd.providerTraceId) {
      const c2 = await gfTraceStatus(String(rd.providerTraceId))
      if (c2 === 'confirmed') return settleOnly ? await markRecharged() : await complete()
      if (c2 === 'pending') return { ok: true, status: 'Pendiente', phase: 'hop2_pending', copCredited: 0 }
    }
    if (!provAddr || fwd <= 0) return { ok: true, status: 'Pendiente', phase: 'no_provider', copCredited: 0 }
    let hop: any = null
    try { hop = await payFromTreasury(provAddr, fwd, String(rd.providerName ?? 'Mouv')) } catch { /* luego */ }
    if (!hop) return { ok: true, status: 'Pendiente', phase: 'hop2_failed', copCredited: 0 }
    await db.from('transactions').update({ raw_data: { ...rd, convertPhase: 'hop2_pending', providerTraceId: hop.traceId, usdtToProvider: fwd } }).eq('id', txId)
    const c2 = await waitTrace(hop.traceId)
    return c2 === 'confirmed' ? (settleOnly ? await markRecharged(hop.traceId) : await complete(hop.traceId)) : { ok: true, status: 'Pendiente', phase: 'hop2_pending', copCredited: 0 }
  }

  return { ok: true, status: tx.status, phase: rd.convertPhase ?? 'unknown', copCredited: 0 }
}

// ════════════════════════════════════════════════════════
// AUTOPILOTO de conversión — SEGUNDO PLANO EN EL SERVIDOR.
// La mayoría de clientes convierten desde el celular: si salen de la app
// (WhatsApp, llamada) el navegador mata la página y la orquestación del
// frontend muere con ella. El autopiloto vive en el servidor: avanza los
// saltos pendientes, espera la recarga REGISTRADA en el proveedor,
// RECLAMA la conversión (CAS — jamás doble conversión contra el
// frontend), la ejecuta y acredita el COP en el saldo ACH. Reentrante:
// cualquier "kick" posterior lo retoma donde iba.
// ════════════════════════════════════════════════════════
const sleepMs = (ms: number) => new Promise(res => setTimeout(res, ms))
const FN_BASE = `${SUPABASE_URL}/functions/v1`
async function finityCall(action2: string, uid: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`${FN_BASE}/finity-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action: action2, user_id: uid, ...extra }),
  }).catch(() => null)
  if (!r) return null
  return r.json().catch(() => null)
}
// Lanzar trabajo en segundo plano que SOBREVIVE a la respuesta HTTP.
function bg(p: Promise<unknown>) {
  try {
    const er = (globalThis as any).EdgeRuntime
    if (er?.waitUntil) { er.waitUntil(p.catch(() => {})); return }
  } catch { /* runtime sin waitUntil */ }
  p.catch(() => {})
}

// Reclamo CAS de la conversión: solo UNO (servidor o frontend) convierte.
async function claimConvert(txId: string): Promise<{ claimed: boolean; status?: string; phase?: string }> {
  const { data: tx } = await db.from('transactions').select('status, raw_data').eq('id', txId).single()
  if (!tx) return { claimed: false }
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  if (tx.status === 'Completado' || tx.status === 'Rechazado') return { claimed: false, status: tx.status, phase: String(rd.convertPhase ?? '') }
  if (rd.convertPhase !== 'recharged') return { claimed: false, status: tx.status, phase: String(rd.convertPhase ?? '') }
  const { data: rows, error } = await db.from('transactions')
    .update({ raw_data: { ...rd, convertPhase: 'converting', convertingAt: new Date().toISOString() } })
    .eq('id', txId)
    .filter('raw_data->>convertPhase', 'eq', 'recharged')
    .select('id')
  return { claimed: !error && (rows?.length ?? 0) > 0, status: tx.status, phase: 'converting' }
}
async function releaseConvertClaim(txId: string) {
  const { data: tx } = await db.from('transactions').select('status, raw_data').eq('id', txId).single()
  const rd = (tx?.raw_data ?? {}) as Record<string, any>
  if (tx?.status !== 'Completado' && rd.convertPhase === 'converting') {
    await db.from('transactions').update({ raw_data: { ...rd, convertPhase: 'recharged' } }).eq('id', txId)
  }
}

// ¿El proveedor YA registró la recarga en su plataforma? (movimiento de
// recarga reciente con el monto enviado — no basta la wallet on-chain).
// Saldo USD REAL disponible en Finity (lo que el endpoint de conversión valida:
// su error es literalmente "Insufficient balance"). Lee /v0/account-balance vía
// el proxy y extrae el USD de las formas comunes de respuesta.
async function finityUsdBalance(uid: string): Promise<number | null> {
  try {
    const b = await finityCall('balance', uid)
    const data: any = b?.data ?? null
    if (!data) return null
    const arr: any[] = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data
      : Array.isArray(data.balances) ? data.balances : Array.isArray(data.items) ? data.items : []
    for (const row of arr) {
      const asset = String(row?.asset ?? row?.currency ?? row?.code ?? '').toUpperCase()
      if (asset === 'USD' || asset === 'USDT') {
        const n = Number(String(row?.available ?? row?.available_balance ?? row?.availableBalance ?? row?.balance ?? row?.amount ?? row?.value ?? '').toString().replace(/,/g, ''))
        if (Number.isFinite(n)) return n
      }
    }
    const direct = data.USD ?? data.usd ?? data.usdBalance ?? data.usdAvailable
      ?? data.data?.USD ?? data.data?.usd ?? data.data?.usdBalance
    if (direct != null) { const n = Number(String(direct).replace(/,/g, '')); if (Number.isFinite(n)) return n }
    return null
  } catch { return null }
}

async function rechargeRegisteredAtProvider(uid: string, fwd: number): Promise<boolean> {
  // AUTORITATIVO: el saldo USD real en Finity. Si ya cubre lo que se va a
  // convertir, listo — es EXACTAMENTE lo que valida el endpoint de conversión
  // (400 "Insufficient balance"). Antes solo se cruzaba contra la lista de
  // movimientos (frágil: la API puede nombrar el tipo distinto o tardar en
  // listarlo), y por eso la conversión se demoraba o no arrancaba.
  try {
    const usd = await finityUsdBalance(uid)
    // FAST-PATH: si el saldo ya cubre el monto, listo. Si lee bajo o null NO se
    // bloquea (el pool es compartido y el endpoint puede leer con retraso): se
    // cae al cruce por movimientos, y el propio paso de conversión maneja el
    // 400 insufficient balance sin trabarse.
    if (usd != null && usd + 0.01 >= fwd) return true
  } catch { /* cae al chequeo por movimientos */ }
  try {
    const mv = await finityCall('movements', uid)
    const d: any = mv?.data ?? {}
    const rows: any[] = Array.isArray(d) ? d : Array.isArray(d.data) ? d.data : Array.isArray(d.items) ? d.items
      : Array.isArray(d.movements) ? d.movements : Array.isArray(d.results) ? d.results : []
    const nowMs = Date.now()
    const amountsOf = (r: any): number[] => {
      const nums: number[] = []
      const collect = (o: any, depth = 0) => {
        if (!o || typeof o !== 'object' || depth > 2) return
        for (const v of Object.values(o)) {
          if (typeof v === 'number') nums.push(v)
          else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) nums.push(parseFloat(v))
          else if (v && typeof v === 'object') collect(v, depth + 1)
        }
      }
      collect(r)
      return nums
    }
    const recentOk = (r: any) => {
      const ds = (r.created_at ?? r.createdAt ?? r.date ?? r.creation_date ?? null) as string | null
      if (!ds) return true
      const t = Date.parse(ds)
      return !isFinite(t) || nowMs - t <= 30 * 60 * 1000
    }
    const amountOk = (r: any) => amountsOf(r).some(n => Math.abs(n - fwd) <= Math.max(0.05, fwd * 0.01))
    // 1ª pasada: movimiento que "parece" recarga. 2ª: cualquier movimiento
    // reciente con el monto exacto (la API puede nombrar el tipo distinto).
    for (const r of rows.slice(0, 12)) {
      if (/recarga|recharge|deposit|blockchain|top.?up/i.test(JSON.stringify(r)) && amountOk(r) && recentOk(r)) return true
    }
    for (const r of rows.slice(0, 8)) {
      if (amountOk(r) && recentOk(r)) return true
    }
  } catch { /* próximo intento */ }
  return false
}

async function autoConvert(txId: string, uid: string) {
  try {
    for (let round = 0; round < 10; round++) {
      const { data: tx } = await db.from('transactions').select('*').eq('id', txId).single()
      if (!tx || tx.user_id !== uid || tx.type !== 'convert') return
      if (tx.status === 'Completado' || tx.status === 'Rechazado') return
      const rd = (tx.raw_data ?? {}) as Record<string, any>
      const phase = String(rd.convertPhase ?? '')
      if (phase === 'converting') {
        // Reclamo 'converting': normalmente lo tiene el frontend. Pero si el
        // frontend falló (p. ej. el viejo camino que daba 'forbidden') y NO
        // liberó, quedaba colgado para SIEMPRE (el autopiloto salía aquí). Si
        // el reclamo está VIEJO (> 2 min), se libera y el autopiloto lo retoma.
        const cAt = Date.parse(String(rd.convertingAt ?? '')) || 0
        if (Date.now() - cAt < 120000) return   // reciente → el frontend lo tiene
        await releaseConvertClaim(txId)          // colgado → liberar y retomar
        await sleepMs(500)
        continue
      }
      if (phase !== 'recharged') {
        const fin: any = await myConvertFinalize(uid, txId, true).catch(() => null)
        if (!fin || (!fin.recharged && fin.phase !== 'recharged')) {
          if (fin?.status === 'Rechazado' || fin?.status === 'Completado') return
          await sleepMs(6000); continue
        }
      }
      const fwd = Number(rd.usdtToProvider ?? rd.fwd ?? 0)
      // GATE por SALDO REAL de Finity (autoritativo, no por cruce de montos): NO
      // se convierte "en el aire". Si el saldo USD de Finity aún NO cubre el
      // monto, se ESPERA — la conversión queda en 'recharged' y el webhook
      // FUNDS_DEPOSIT (o el próximo kick) la reanuda apenas el USD entre. Si el
      // endpoint de saldo no responde (null), se deja pasar y Finity valida con
      // su propio 400 "insufficient balance" (abajo).
      if (fwd > 0) {
        const usd = await finityUsdBalance(uid)
        if (usd != null && usd + 0.01 < fwd) {
          await db.from('transactions').update({
            raw_data: { ...rd, convertPhase: 'recharged', convertWaiting: 'finity_usd_balance', lastConvertError: `Finity USD ${usd} < ${fwd} requerido — esperando el depósito`, lastConvertAt: new Date().toISOString() },
          }).eq('id', txId)
          return   // el webhook/kick reanuda apenas el USD esté en Finity
        }
      }
      const claim = await claimConvert(txId)
      if (!claim.claimed) return
      try {
        let done: any = null
        let lastErr = ''
        for (let attempt = 0; attempt < 2 && !done; attempt++) {
          if (attempt > 0) await sleepMs(3000)
          // Cotización FRESCA justo antes de crear — el exchange_rate_id y la
          // confirmación caducan (~30-60 s), así que create→confirm van seguidos.
          const q = await finityCall('rates', uid, { query: { from: 'USD', to: 'COP' } })
          const quote: any = q?.data ?? {}
          const createBody: Record<string, unknown> = { fromAsset: 'USD', toAsset: 'COP', amount: fwd }
          if (quote.id) createBody.exchange_rate_id = quote.id
          if (quote.expires_at) createBody.expires_at = quote.expires_at
          const c = await finityCall('convert', uid, { data: createBody })
          const cd: any = c?.data ?? {}
          const convId = cd?.id
          if (!c?.ok || !convId) {
            lastErr = String(cd?.message ?? cd?.error ?? c?.status ?? 'sin id de conversión')
            // Saldo aún NO reflejado en Finity → no insistir en vano ni gastar la
            // ventana de 60 s: se libera y se retoma cuando el webhook FUNDS_DEPOSIT
            // (o el próximo poll) avise que el USD ya llegó.
            if (/insufficient|balance/i.test(lastErr)) {
              await releaseConvertClaim(txId)
              await db.from('transactions').update({ raw_data: { ...rd, convertWaiting: 'finity_usd_balance', lastConvertError: lastErr, lastConvertAt: new Date().toISOString() } }).eq('id', txId)
              return
            }
            continue
          }
          // Confirmar de inmediato (la doc exige confirmar dentro de 60 s).
          const f = await finityCall('convert_confirm', uid, { id: String(convId) })
          const dd: any = f?.data ?? {}
          if (f?.ok && String(dd.status ?? '') === 'SUCCESS') { done = dd; break }
          lastErr = String(dd?.message ?? dd?.error ?? f?.status ?? 'confirm no SUCCESS')
        }
        if (!done) {
          await releaseConvertClaim(txId)
          await db.from('transactions').update({ raw_data: { ...rd, lastConvertError: lastErr, lastConvertAt: new Date().toISOString() } }).eq('id', txId)
          await sleepMs(15000); continue
        }
        const finityRate = Number(done.exchangeRate ?? rd.mouvRate ?? 0)
        const feePct = Number(rd.feePct ?? 0)
        const creditUsd = Number(rd.creditUsd ?? 0) || Math.max(0, Number(rd.fromAmount ?? 0) - 4)
        const grossCop = finityRate > 0 ? creditUsd * finityRate : Number(done.to_amount ?? 0)
        const clientCop = Math.round(grossCop * (1 - feePct / 100))
        const utilityCop = Math.max(0, Math.round(grossCop - clientCop))
        await myConvertCredit(uid, txId, clientCop, { mouvRate: finityRate, feePct, utilityCop })
        return
      } catch {
        await releaseConvertClaim(txId)
        await sleepMs(15000)
      }
    }
  } catch { /* el próximo kick lo retoma */ }
}

// Destraba TODAS las conversiones pendientes: relanza el autopiloto de cada
// conversión que no esté ni completada ni rechazada. Lo llama finity-webhook
// cuando Finity avisa que el USDT llegó/convirtió — así la conversión que
// esperaba el registro del depósito en el proveedor se destraba al instante,
// sin depender de que el cliente tenga la app abierta. Idempotente (el
// autopiloto usa CAS por fase, no doble-acredita).
async function kickPendingConverts() {
  const { data } = await db.from('transactions')
    .select('id, user_id')
    .eq('type', 'convert')
    .not('status', 'in', '("Completado","Rechazado","Fallido")')
    .order('created_at', { ascending: false }).limit(50)
  const rows = ((data as any[]) ?? [])
  for (const tx of rows) bg(autoConvert(String(tx.id), String(tx.user_id)))
  return { ok: true, kicked: rows.length }
}

// Verifica el saldo GasFree del cliente contra lo YA acreditado (contador
// propio 'gasfreeCredited', separado del viejo 'gasfreeCredited') y acredita
// solo la diferencia nueva a su Dólar digital — mismo patrón anti-doble-
// acreditación que evitó los "dólares fantasma" de GasFree.
async function myVerifyDeposit(userId: string) {
  const { data: u } = await db.from('users').select('raw_data, balances, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await userIndex(userId)
  const { eoa } = await userWallet(index)
  const { token } = await gfConfig()
  const acct = await gfAccount(eoa)
  if (!acct.gasFreeAddress) return { synced: false, reason: 'Aún no tienes dirección GasFree' }
  const dec = Number(token.decimal ?? 6)
  const onchainBal = await tokenBalance(acct.gasFreeAddress, token.tokenAddress, dec)

  const raw = (u.raw_data ?? {}) as Record<string, any>
  // ── Acreditación de depósitos POR TRANSFERENCIA (txId), no por delta ──
  // El esquema viejo (diff = onchain − contador) JUNTABA montos cuando el
  // contador quedaba atrás ("me llegó 15/16,50 en vez de 6,5") y, en el peor
  // caso, acreditaba de más. Ahora cada transferencia ENTRANTE se acredita UNA
  // vez por su monto EXACTO y se registra su propio movimiento.
  const incoming = await incomingTransfersTrc20(acct.gasFreeAddress, token.tokenAddress, dec, 60)

  // MIGRACIÓN (primera vez con el nuevo esquema): si aún no existe la lista de
  // depósitos ya acreditados, se SIEMBRA con las transferencias entrantes
  // actuales (ya reflejadas en el saldo) y se re-basa el contador. NO se
  // acredita nada aquí → jamás se re-acredita lo viejo (ni se mintea).
  if (!Array.isArray(raw.gasfreeCreditedTxs)) {
    const seed = incoming.map(t => t.txId)
    await mergeUserRaw(userId, { gasfreeCreditedTxs: seed, gasfreeCreditedCount: seed.length, gasfreeCredited: onchainBal })
    return { synced: false, migrated: true, onchain: onchainBal, credited: 0, diff: 0, reason: 'Depósitos sincronizados; los próximos se acreditan por su monto exacto.' }
  }

  const creditedSet = new Set((raw.gasfreeCreditedTxs as any[]).map(String))
  const fresh = incoming.filter(t => !creditedSet.has(t.txId))
  if (fresh.length === 0) {
    // Diagnóstico de "sin depósitos": distingue TronGrid limitando de sin nada.
    const viaBalanceOf = await tokenBalanceOn(acct.gasFreeAddress, token.tokenAddress, dec, CFG.tronHost)
    const viaTransfers = await tokenBalanceFromTransfers(acct.gasFreeAddress, token.tokenAddress, dec)
    const reason = (viaBalanceOf === 0 && viaTransfers === 0)
      ? `No se leyó saldo on-chain (balanceOf=0, transfers=0) en ${acct.gasFreeAddress} · contrato ${token.tokenAddress} · red ${NET}. Si Tronscan SÍ muestra saldo, TronGrid está limitando al servidor: agrega TRONGRID_API_KEY.`
      : `Sin depósitos nuevos. On-chain=${onchainBal} USDT.`
    return { synced: false, onchain: onchainBal, credited: 0, diff: 0, reason, debug: { gasFreeAddress: acct.gasFreeAddress, contract: token.tokenAddress, net: NET, viaBalanceOf, viaTransfers } }
  }

  const totalNew = parseFloat(fresh.reduce((s, t) => s + t.amount, 0).toFixed(dec))
  const bals = (u.balances as Record<string, number>) ?? {}
  const newUsd = parseFloat(((Number(bals.USD ?? 0)) + totalNew).toFixed(2))
  const oldCount = typeof raw.gasfreeCreditedCount === 'number' ? raw.gasfreeCreditedCount : creditedSet.size
  const newSet = [...creditedSet, ...fresh.map(t => t.txId)]
  // ── ANTI-DOBLE-ACREDITACIÓN (CAS monótono) ──────────────────────
  // Dos verificaciones simultáneas (poll + botón) no acreditan doble: la
  // escritura solo pasa si gasfreeCreditedCount sigue como lo leímos. El
  // perdedor no escribe ni inserta movimiento. Re-lee raw fresco para no pisar
  // cambios concurrentes del cliente (2FA, beneficiarios).
  const { data: freshCU } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
  const freshRaw = (freshCU?.raw_data ?? raw) as Record<string, any>
  // 1) RECLAMAR el depósito con CAS sobre gasfreeCreditedCount (idempotente:
  //    solo un verify gana). Aquí NO se tocan las columnas de saldo: escribir
  //    `balances` completo desde una lectura obsoleta pisaba una operación
  //    concurrente (retiro/conversión) y podía acuñar/perder USD.
  const upd = await db.from('users').update({
    raw_data: { ...freshRaw, gasfreeCredited: onchainBal, gasfreeCreditedTxs: newSet, gasfreeCreditedCount: oldCount + fresh.length },
  }).eq('id', userId)
    .filter('raw_data->>gasfreeCreditedCount', 'eq', String(oldCount))
    .select('id')
  if (upd.error || !upd.data || upd.data.length === 0) {
    return { synced: false, raced: true, onchain: onchainBal, credited: 0, diff: 0, reason: 'Otra verificación acreditó este depósito hace un instante.' }
  }
  // 2) Ya ganado el claim, acreditar el USD de forma ATÓMICA (bloqueo de fila
  //    vía adjust_balances) — no pisa otras columnas ni se duplica.
  await creditBalanceAtomic(userId, 'USD', totalNew)
  // UN movimiento por cada transferencia nueva, con su MONTO EXACTO y su txId.
  for (const t of fresh) {
    await db.from('transactions').insert({
      user_id: userId, type: 'load', amount: parseFloat(t.amount.toFixed(dec)), currency: 'USD', status: 'Completado',
      raw_data: {
        initials: '₮', title: 'Depósito USDT (GasFree · TRC-20)',
        createdAt: new Date(t.ts || Date.now()).toISOString(),
        userName: u.email, source: 'GASFREE', network: 'TRON (TRC-20)',
        toAddress: acct.gasFreeAddress, fromAddress: t.from, txId: t.txId,
      },
    })
  }
  return { synced: true, credited: totalNew, onchain: onchainBal, newBalance: newUsd, deposits: fresh.length }
}

// ⚠️ YA NO la usa el flujo "Enviar → Wallet" del cliente (ver mySend):
// pagar desde la recaudadora el envío de UN cliente usando el USDT
// agregado de TODOS significaba que un envío podía rechazarse por falta
// de saldo en tesorería aunque el cliente sí tuviera sus USDT reales en
// su propia wallet GasFree (o, peor, pagarse con USDT de otro cliente).
// Se deja para pagos que sí deben salir de tesorería (ej. proveedores).
async function myWalletWithdrawal(userId: string, toAddress: string, amount: number) {
  if (!(amount > 0)) throw new Error('Monto inválido')
  const { data: u } = await db.from('users').select('email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')

  const { token } = await gfConfig()
  const rec = await recaudadora()
  const recAcct = await gfAccount(rec.eoa)
  const dec = Number(token.decimal ?? 6)
  const activateFeeUsdt = recAcct.active ? 0 : Number(token.activateFee ?? 0) / Math.pow(10, dec)
  const transferFeeUsdt = Number(token.transferFee ?? 0) / Math.pow(10, dec)
  const feeQuoted = parseFloat((activateFeeUsdt + transferFeeUsdt).toFixed(dec))
  const total = parseFloat((amount + feeQuoted).toFixed(2))

  // 1) Debitar (monto + comisión) de forma ATÓMICA con bloqueo de fila. Cierra
  //    el DOBLE-GASTO: antes se leía el saldo, se enviaba on-chain y luego se
  //    escribía — dos retiros concurrentes pasaban ambos el chequeo, enviaban
  //    los dos y solo debitaban uno (USDT acuñados). Ahora el segundo débito
  //    falla si el saldo ya no alcanza, ANTES de enviar nada.
  const { data: adj, error: adjErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: { USD: -total } })
  if (!adjErr) {
    if ((adj as any)?.error) throw new Error(`Saldo USD insuficiente (se necesitan ${total.toFixed(2)} = ${amount} + comisión GasFree ${feeQuoted.toFixed(2)}).`)
  } else {
    // Fallback si la RPC no está desplegada (no atómico, preserva la función).
    const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
    const bals = (uf?.balances as Record<string, number>) ?? {}
    const usd = Number(bals.USD ?? 0)
    if (usd < total) throw new Error(`Saldo USD insuficiente (disponible ${usd.toFixed(2)}, se necesitan ${total.toFixed(2)} = ${amount} + comisión GasFree ${feeQuoted.toFixed(2)})`)
    await db.from('users').update({ balances: { ...bals, USD: parseFloat((usd - total).toFixed(2)) } }).eq('id', userId)
  }
  try {
    // 2) Enviar on-chain vía GasFree desde la recaudadora
    const r = await sendCore(rec.pkHex, rec.eoa, toAddress, amount)
    await db.from('transactions').insert({
      user_id: userId, type: 'send', amount, currency: 'USD', status: 'Completado',
      raw_data: {
        title: 'Envío a wallet (GasFree)', beneficiary: toAddress, bank: 'Wallet USDT (GasFree)', account: toAddress,
        traceId: r.traceId, state: r.state, feeChargedUsdt: r.feeChargedUsdt, feeQuotedUsdt: feeQuoted,
        note: `Comisión GasFree: ${r.feeChargedUsdt} USDT (cobrada aparte del monto enviado)`,
        source: 'gasfree', sentAt: new Date().toISOString(),
      },
    })
    return { ok: true, traceId: r.traceId, state: r.state, amountSent: amount, feeChargedUsdt: r.feeChargedUsdt, totalDebitedUsd: total }
  } catch (e) {
    // Devolver el débito completo (ATÓMICO) — el envío on-chain no salió.
    try { await creditBalanceAtomic(userId, 'USD', total) }
    catch { console.error(`[myWalletWithdrawal] ⚠ NO PUDE DEVOLVER el débito de ${total} a ${userId} — revisar manualmente`) }
    throw e
  }
}

// ── Guardado VERIFICADO en system_config ──────────────────
// El upsert de supabase-js NO lanza: devuelve { error } y aquí se estaba
// IGNORANDO — si la tabla no tiene constraint única en `key` (upsert
// necesita ON CONFLICT) el guardado fallaba EN SILENCIO y los proveedores
// "agregados" desaparecían al recargar. Ahora: upsert → si falla,
// update→insert manual → si todo falla, LANZA (el frontend lo muestra).
async function saveSystemConfig(key: string, value: string) {
  const up = await db.from('system_config').upsert({ key, value })
  if (!up.error) return
  const upd = await db.from('system_config').update({ value }).eq('key', key).select('key')
  if (!upd.error && (upd.data?.length ?? 0) > 0) return
  const ins = await db.from('system_config').insert({ key, value })
  if (ins.error) throw new Error(`No se pudo guardar ${key}: ${up.error.message}; insert: ${ins.error.message}`)
}

// ── Tesorería GasFree (recaudadora) — parámetros editables ──
const TREASURY_KEY = 'gasfree_treasury_config'
async function getTreasuryConfig() {
  const { data } = await db.from('system_config').select('value').eq('key', TREASURY_KEY).single()
  const parsed = data?.value ? JSON.parse(data.value) : {}
  return {
    alertThresholdUsdt: Number(parsed.alertThresholdUsdt ?? 10000),
    notes: parsed.notes ?? '',
    // A qué proveedor se le paga cuando el saldo supera el umbral — antes
    // solo había una nota de texto libre, sin ligar al registro real de
    // Proveedores (que puede tener varios inscritos).
    alertProviderId: parsed.alertProviderId ?? null,
  }
}
async function setTreasuryConfig(cfg: { alertThresholdUsdt?: number; notes?: string; alertProviderId?: string | null }) {
  const current = await getTreasuryConfig()
  const next = {
    alertThresholdUsdt: cfg.alertThresholdUsdt ?? current.alertThresholdUsdt,
    notes: cfg.notes ?? current.notes,
    alertProviderId: cfg.alertProviderId !== undefined ? cfg.alertProviderId : current.alertProviderId,
  }
  await saveSystemConfig(TREASURY_KEY, JSON.stringify(next))
  return next
}

// ── Proveedores (registro editable: a quién se le paga con el USDT
// acumulado en Tesorería — ej. un proveedor de liquidez COP) ──
const PROVIDERS_KEY = 'gasfree_providers'
async function getProviders() {
  const { data } = await db.from('system_config').select('value').eq('key', PROVIDERS_KEY).single()
  return data?.value ? JSON.parse(data.value) : []
}
async function setProviders(list: any[]) {
  await saveSystemConfig(PROVIDERS_KEY, JSON.stringify(list))
  // Releer de la base: lo que se devuelve es lo que DE VERDAD quedó guardado.
  return await getProviders()
}

// ── Movimientos de Tesorería (auditoría) ──────────────────
// Registro de TODO lo que entra (barridos de clientes) y sale (pagos a
// proveedores) de la recaudadora, con la comisión real cobrada por
// GasFree en cada uno. No usa la tabla `transactions` (exige un
// user_id NOT NULL y estos movimientos no son de un cliente) — vive en
// system_config, tope de 300 filas más recientes.
const TREASURY_MOVEMENTS_KEY = 'gasfree_treasury_movements'
async function logTreasuryMovement(entry: Record<string, unknown>) {
  const { data } = await db.from('system_config').select('value').eq('key', TREASURY_MOVEMENTS_KEY).single()
  const list: any[] = data?.value ? JSON.parse(data.value) : []
  list.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry })
  await saveSystemConfig(TREASURY_MOVEMENTS_KEY, JSON.stringify(list.slice(0, 300)))
}
async function getTreasuryMovements() {
  const { data } = await db.from('system_config').select('value').eq('key', TREASURY_MOVEMENTS_KEY).single()
  return data?.value ? JSON.parse(data.value) : []
}

// Pago manual a un proveedor (o cualquier dirección) desde la recaudadora —
// no depende de que la Tesorería tenga un monto mínimo acumulado, es
// enteramente a discreción del admin. La comisión GasFree se cotiza en
// vivo y se cobra aparte del monto (igual que cualquier envío GasFree).
async function payFromTreasury(toAddress: string, amount: number, providerName?: string) {
  if (!(amount > 0)) throw new Error('Monto inválido')
  const rec = await recaudadora()
  const r = await sendCore(rec.pkHex, rec.eoa, toAddress, amount)
  await logTreasuryMovement({
    direction: 'out', amount, toAddress, providerName: providerName ?? null,
    traceId: r.traceId, state: r.state, feeChargedUsdt: r.feeChargedUsdt,
    activateFeeUsdt: r.activateFeeUsdt, transferFeeUsdt: r.transferFeeUsdt,
  })
  return r
}

// ── Recuperación: localizar el índice HD de una dirección y barrerlo ──
// Escanea índices 0..top derivando cada wallet y comparando con `target`
// (acepta la dirección GasFree o la EOA). Sirve para recuperar depósitos que
// llegaron a una wallet cuyo índice se "perdió" por el bug de userIndex.
async function findAddress(target: string, extra = 25) {
  const t = String(target || '').trim()
  if (!t) throw new Error('Falta la dirección a localizar')
  const { data: cfg } = await db.from('system_config').select('value').eq('key', 'gasfree_hd_counter').single()
  const top = (cfg?.value ? parseInt(cfg.value) : 0) + Math.max(0, extra)
  const { token } = await gfConfig()
  const dec = Number(token.decimal ?? 6)
  // Se prueban TODAS las mnemónicas conocidas (por si el depósito viejo se
  // generó con la anterior). Escaneo en PARALELO por lotes; cada derivación
  // en try/catch para que un fallo puntual no tumbe el lote.
  const mnemos = SCAN_MNEMONICS.length ? SCAN_MNEMONICS : [{ source: 'primary', phrase: MNEMONIC }]
  // La dirección GasFree se consulta a la API de GasFree (open.gasfree.io). Un
  // escaneo masivo la LIMITA y, si los fallos se ignoran, se pierde la
  // coincidencia y se reporta "no encontrada" en falso. Por eso: lotes chicos,
  // pausa entre lotes, REINTENTOS por candidato, y se CUENTAN los fallos de API
  // para no mentir. Se escanea de arriba hacia abajo (los índices recientes
  // primero — la wallet reasignada suele estar cerca del contador).
  const acctRetry = async (eoa: string): Promise<{ gasFreeAddress: string | null; active: boolean } | null> => {
    for (let a = 0; a < 3; a++) {
      try { const acct = await gfAccount(eoa); return { gasFreeAddress: acct.gasFreeAddress, active: acct.active } }
      catch { await new Promise((r) => setTimeout(r, 300 * (a + 1))) }
    }
    return null
  }
  const CHUNK = 8
  let apiErrors = 0
  for (const m of mnemos) {
    for (let hi = top; hi >= 0; hi -= CHUNK) {
      const idxs: number[] = []
      for (let i = hi; i > Math.max(-1, hi - CHUNK); i--) idxs.push(i)
      const results = await Promise.all(idxs.map(async (i) => {
        try {
          const { eoa } = await userWalletFrom(m.phrase, i)
          if (eoa === t) return { i, eoa, gasFreeAddress: null as string | null, active: false }
          const acct = await acctRetry(eoa)
          if (!acct) { apiErrors++; return { i, eoa, gasFreeAddress: null as string | null, active: false } }
          return { i, eoa, gasFreeAddress: acct.gasFreeAddress, active: acct.active }
        } catch { return { i, eoa: null as string | null, gasFreeAddress: null as string | null, active: false } }
      }))
      const hit = results.find((r) => (r.eoa && r.eoa === t) || (r.gasFreeAddress && r.gasFreeAddress === t))
      if (hit) {
        const bal = hit.gasFreeAddress ? await tokenBalance(hit.gasFreeAddress, token.tokenAddress, dec) : 0
        return { found: true, index: hit.i, mnemonic: m.source, eoa: hit.eoa, gasFreeAddress: hit.gasFreeAddress, active: hit.active, balanceUsdt: bal }
      }
      await new Promise((r) => setTimeout(r, 120))   // respirar entre lotes
    }
  }
  return { found: false, scannedUpTo: top, mnemonicsTried: mnemos.map((m) => m.source), apiErrors }
}

// Barre el USDT de un índice HD específico a la recaudadora (recuperación).
// `mnemonic` indica de cuál mnemónica derivar la llave (por si el depósito
// viejo se generó con la anterior). Por defecto la primaria.
async function sweepIndex(index: number, mnemonic?: string) {
  const chosen = SCAN_MNEMONICS.find((m) => m.source === mnemonic)?.phrase ?? MNEMONIC
  const { pkHex, eoa } = await userWalletFrom(chosen, index)
  const { token } = await gfConfig()
  const acct = await gfAccount(eoa)
  if (!acct.gasFreeAddress) throw new Error('Ese índice no tiene dirección GasFree')
  const dec = Number(token.decimal ?? 6)
  const bal = await tokenBalance(acct.gasFreeAddress, token.tokenAddress, dec)
  const fee = (Number(token.transferFee ?? 0) + (acct.active ? 0 : Number(token.activateFee ?? 0))) / Math.pow(10, dec)
  const sendable = parseFloat((bal - fee).toFixed(dec))
  if (sendable <= 0) throw new Error(`Saldo insuficiente para barrer (bal ${bal} USDT, comisión ${fee})`)
  const rec = await recaudadora()
  const recAcct = await gfAccount(rec.eoa)
  const dest = recAcct.gasFreeAddress ?? rec.eoa
  const r = await sendCore(pkHex, eoa, dest, sendable)
  await logTreasuryMovement({
    direction: 'in', amount: sendable, fromAddress: acct.gasFreeAddress,
    context: 'sweep_index_recovery', traceId: r.traceId, state: r.state, feeChargedUsdt: r.feeChargedUsdt,
    activateFeeUsdt: r.activateFeeUsdt, transferFeeUsdt: r.transferFeeUsdt,
  })
  return { ok: true, index, from: acct.gasFreeAddress, dest, swept: sendable, ...r }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    if (new URL(req.url).searchParams.get('action') === 'ping') {
      return ok({ ok: true, service: 'gasfree', version: 'v2-fixed-owner', net: NET })
    }
    const body = await req.json()
    const { action, userId, toAddress, amount } = body

    if (action === 'ping')   return ok({ ok: true, service: 'gasfree', version: 'v6-cache-user-address', net: NET })

    // ── Acciones del propio CLIENTE (su wallet, su envío) ──
    // Exigen que el JWT del que llama coincida con userId (o sea admin).
    if (action === 'my_status') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myStatus(userId))
    }
    // Lectura ROBUSTA de los movimientos del propio usuario (service role).
    // No depende del caché de PostgREST (RPC) ni de la RLS ni de si la
    // sesión tiene un JWT real — por eso resuelve el "movimientos vacíos"
    // intermitente. Devuelve SOLO las transacciones de ese userId (menos
    // exposición que el RPC público cuypay_get_all_transactions, que ya
    // devuelve TODAS a anon).
    if (action === 'my_transactions') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)   // IDOR (pentest #4)
      // Robusto por CORREO: si existen filas de usuario duplicadas (mismo
      // correo, ids distintos — pasa cuando el login creó un perfil con el
      // id del auth distinto al id real), los movimientos pueden estar bajo
      // cualquiera de esos ids. Se devuelven los de TODOS los ids que
      // comparten el correo, para que nunca queden "vacíos".
      let ids: string[] = [userId]
      const { data: me } = await db.from('users').select('email').eq('id', userId).single()
      if (me?.email) {
        const { data: sib } = await db.from('users').select('id').eq('email', me.email)
        if (Array.isArray(sib) && sib.length) ids = Array.from(new Set(sib.map((x: any) => x.id)))
      }
      // Orden por FECHA: los ids son uuid (orden aleatorio, y el front hacía
      // b.id - a.id = NaN). created_at es el orden real de los movimientos.
      const { data: txs, error: txErr } = await db.from('transactions')
        .select('*').in('user_id', ids)
        .order('created_at', { ascending: false }).limit(500)
      return ok({ transactions: txs ?? [], ids, ...(txErr ? { queryError: txErr.message } : {}) })
    }
    // Guardar SOLO campos cosméticos del perfil (nombre, apodo, foto) del
    // propio usuario vía service role — funciona aunque la sesión no tenga
    // un JWT real (las escrituras directas fallan por RLS). NO toca saldos,
    // rol ni KYC (esos siguen bloqueados), así que el riesgo se limita a lo
    // cosmético.
    if (action === 'my_save_profile') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)   // IDOR (pentest #4)
      const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
      if (!u) return err('Usuario no encontrado', 404)
      const raw = (u.raw_data ?? {}) as Record<string, any>
      const p = (body.profile ?? {}) as Record<string, any>
      const nextRaw = { ...raw }
      if (typeof p.nickname === 'string') nextRaw.nickname = p.nickname
      if (typeof p.avatarUrl === 'string') nextRaw.avatarUrl = p.avatarUrl
      const upd: Record<string, any> = { raw_data: nextRaw }
      if (typeof p.name === 'string' && p.name.trim()) upd.full_name = p.name.trim()
      const { error } = await db.from('users').update(upd).eq('id', userId)
      if (error) return err(error.message, 500)
      return ok({ ok: true })
    }
    if (action === 'my_send') {
      if (!userId || !toAddress || !amount) return err('Faltan userId, toAddress o amount', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      const mfaErr = await require2FA(userId, body.otp)
      if (mfaErr) return err(mfaErr, 403)
      return ok(await mySend(userId, String(toAddress), Number(amount)))
    }
    if (action === 'my_verify_deposit') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myVerifyDeposit(userId))
    }
    if (action === 'my_convert_settle') {
      if (!userId || !amount || !body.copAmount) return err('Faltan userId, amount o copAmount', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      const settled: any = await myConvertSettle(userId, Number(amount), Number(body.copAmount), {
        // El frontend manda la tasa como finityRate — se acepta con ambos nombres.
        mouvRate: body.mouvRate != null ? Number(body.mouvRate) : (body.finityRate != null ? Number(body.finityRate) : undefined),
        feePct: body.feePct != null ? Number(body.feePct) : undefined,
        utilityCop: body.utilityCop != null ? Number(body.utilityCop) : undefined,
        creditUsd: body.creditUsd != null ? Number(body.creditUsd) : undefined,
      })
      // AUTOPILOTO: pase lo que pase con la pestaña del cliente, el servidor
      // sigue empujando la conversión hasta acreditar el COP en ACH.
      if (settled?.txId && settled?.status !== 'Rechazado') bg(autoConvert(String(settled.txId), userId))
      return ok(settled)
    }
    // Reclamo de conversión (CAS) — lo usa el frontend antes de convertir:
    // si el autopiloto del servidor ya la tomó, el frontend solo OBSERVA.
    if (action === 'my_convert_claim') {
      if (!userId || !body.txId) return err('Faltan userId o txId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await claimConvert(String(body.txId)))
    }
    // Estado de una conversión (para observar desde el frontend).
    if (action === 'my_convert_status') {
      if (!userId || !body.txId) return err('Faltan userId o txId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      const { data: tx } = await db.from('transactions').select('id, user_id, status, amount, currency, raw_data').eq('id', String(body.txId)).single()
      if (!tx || tx.user_id !== userId) return err('Movimiento no encontrado', 404)
      const rd = (tx.raw_data ?? {}) as Record<string, any>
      return ok({ ok: true, status: tx.status, phase: rd.convertPhase ?? null, amount: tx.amount, currency: tx.currency, mouvRate: rd.mouvRate ?? null, utilityCop: rd.utilityCop ?? null })
    }
    // Soltar el reclamo (el frontend falló la conversión local) — vuelve a
    // 'recharged' para que el autopiloto o un reintento la retomen.
    if (action === 'my_convert_release') {
      if (!userId || !body.txId) return err('Faltan userId o txId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      await releaseConvertClaim(String(body.txId))
      return ok({ ok: true })
    }
    // Re-lanzar el autopiloto (al volver a la app, o desde el vigilante).
    if (action === 'my_convert_kick') {
      if (!userId || !body.txId) return err('Faltan userId o txId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      bg(autoConvert(String(body.txId), userId))
      return ok({ ok: true, kicked: true })
    }
    // ── Multi-wallet del cliente (studios/negocios) ──
    if (action === 'my_wallets_list') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myWalletsList(userId))
    }
    if (action === 'my_wallet_create') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myWalletCreate(userId, String(body.name ?? 'Wallet')))
    }
    if (action === 'my_wallet_update') {
      if (!userId || !body.id) return err('Faltan userId o id', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myWalletUpdate(userId, String(body.id), body.patch ?? {}))
    }
    // Archivo de wallets del PROPIO usuario (actual + anteriores).
    if (action === 'my_wallet_archive') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myWalletArchive(userId))
    }
    // Generar una NUEVA wallet de depósito manualmente (acción explícita del
    // usuario). La actual pasa a archivadas; rehúsa si tiene saldo.
    if (action === 'my_wallet_regenerate') {
      if (!userId) return err('Falta userId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await regenerateWalletSafe(userId))
    }
    // Cotización de envío de una wallet archivada (saldo, comisión, máximo).
    if (action === 'my_archived_quote') {
      if (!userId || body.index == null) return err('Faltan userId o index', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myArchivedQuote(userId, Number(body.index)))
    }
    // Movimientos de una dirección del usuario (para una wallet archivada).
    if (action === 'my_address_movements') {
      if (!userId || !body.address) return err('Faltan userId o address', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myAddressMovements(userId, String(body.address)))
    }
    // Enviar (recuperar) los fondos de una wallet ARCHIVADA. Exige 2FA como
    // cualquier envío on-chain.
    if (action === 'my_archived_send') {
      if (!userId || body.index == null || !toAddress || !amount) return err('Faltan userId, index, toAddress o amount', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      const mfaErr = await require2FA(userId, body.otp)
      if (mfaErr) return err(mfaErr, 403)
      return ok(await myArchivedSend(userId, Number(body.index), String(toAddress), Number(amount)))
    }
    if (action === 'my_wallets_reorder') {
      if (!userId || !Array.isArray(body.ids)) return err('Faltan userId o ids', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myWalletsReorder(userId, body.ids.map((x: any) => String(x))))
    }
    if (action === 'my_wallet_send') {
      if (!userId || !body.id || !toAddress || !amount) return err('Faltan userId, id, toAddress o amount', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      const mfaErr = await require2FA(userId, body.otp)   // envío on-chain → 2FA server-side
      if (mfaErr) return err(mfaErr, 403)
      return ok(await myWalletSend(userId, String(body.id), String(toAddress), Number(amount)))
    }
    if (action === 'my_convert_finalize') {
      if (!userId || !body.txId) return err('Faltan userId o txId', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myConvertFinalize(userId, String(body.txId), Boolean(body.settleOnly)))
    }
    if (action === 'my_convert_credit') {
      if (!userId || !body.txId || !body.copAmount) return err('Faltan userId, txId o copAmount', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myConvertCredit(userId, String(body.txId), Number(body.copAmount), {
        // El convertidor Finity manda la tasa como finityRate; el nombre
        // histórico interno es mouvRate — se aceptan ambos.
        mouvRate: body.mouvRate != null ? Number(body.mouvRate) : (body.finityRate != null ? Number(body.finityRate) : undefined),
        feePct: body.feePct != null ? Number(body.feePct) : undefined,
        utilityCop: body.utilityCop != null ? Number(body.utilityCop) : undefined,
      }))
    }
    if (action === 'my_wallet_withdrawal') {
      if (!userId || !toAddress || !amount) return err('Faltan userId, toAddress o amount', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      const mfaErr = await require2FA(userId, body.otp)   // retiro on-chain → 2FA server-side
      if (mfaErr) return err(mfaErr, 403)
      return ok(await myWalletWithdrawal(userId, String(toAddress), Number(amount)))
    }

    // Acción INTERNA: la llama finity-webhook (con el service key) cuando Finity
    // avisa que un depósito/conversión se movió, para DESTRABAR las conversiones
    // pendientes al instante. Acepta el service key O un admin.
    if (action === 'kick_pending_converts') {
      const authHeader = req.headers.get('Authorization') ?? ''
      const isService = !!SERVICE_KEY && authHeader === `Bearer ${SERVICE_KEY}`
      if (!isService && !(await callerIsAdmin(req))) return err('No autorizado', 401)
      return ok(await kickPendingConverts())
    }

    // ── Acciones ADMIN (mueven fondos de la recaudadora o de cualquier
    // cliente) — exigen rol admin explícito. ──
    const isAdmin = await callerIsAdmin(req)
    if (!isAdmin) return err('No autorizado — se requiere sesión de administrador', 401)

    if (action === 'status') return ok(await status())
    if (action === 'user_address') {
      if (!userId) return err('Falta userId', 400)
      return ok(await userAddress(userId))
    }
    if (action === 'sweep_user') {
      if (!userId) return err('Falta userId', 400)
      return ok(await sweepUser(userId))
    }
    if (action === 'sweep_all') {
      const { data: users } = await db.from('users').select('id, role').limit(1000)
      const out: any[] = []
      // Se barre a TODOS los clientes (en Lincoin son cuentas personales) —
      // el filtro viejo de "solo empresas" dejaba el barrido sin efecto.
      for (const u of (users as any[]) ?? []) {
        if (u.role === 'admin') continue
        try { out.push(await sweepUser(u.id)) } catch (e) { out.push({ userId: u.id, error: (e as Error)?.message }) }
      }
      return ok({ ok: true, results: out })
    }
    if (action === 'send') {
      if (!toAddress || !amount) return err('Faltan toAddress o amount', 400)
      return ok(await payFromTreasury(String(toAddress), Number(amount), body.providerName ? String(body.providerName) : undefined))
    }
    // Recuperación: localizar el índice HD de una dirección (escaneo).
    if (action === 'find_address') {
      if (!body.address) return err('Falta address', 400)
      return ok(await findAddress(String(body.address), body.extra != null ? Number(body.extra) : 25))
    }
    // Recuperación: barrer el USDT de un índice HD específico a la recaudadora.
    if (action === 'sweep_index') {
      if (body.index == null) return err('Falta index', 400)
      return ok(await sweepIndex(Number(body.index), body.mnemonic ? String(body.mnemonic) : undefined))
    }
    // Recuperación: FIJAR la wallet real de un usuario a una dirección conocida
    // (la que el cliente ve/usa). No mueve fondos; alinea admin ↔ cliente.
    if (action === 'pin_address') {
      let uid = userId as string | undefined
      if (!uid && body.email) {
        const { data } = await db.from('users').select('id').eq('email', String(body.email)).limit(1).maybeSingle()
        uid = data?.id
      }
      if (!uid) return err('Falta userId o email de un usuario existente', 400)
      if (!body.address) return err('Falta address (la wallet real del cliente)', 400)
      return ok(await pinAddressToUser(String(uid), String(body.address)))
    }
    // Acreditar / cerrar una conversión TRABADA (el USDT ya llegó al proveedor
    // pero el COP no se acreditó). preview=true solo consulta; sin preview
    // acredita el COP al cliente y cierra el movimiento (idempotente).
    if (action === 'admin_settle_convert') {
      // Modo LISTA: conversiones trabadas (no completadas) de un cliente.
      if (body.list === true) return ok(await listStuckConverts(body.userId ? String(body.userId) : undefined))
      if (!body.txId && !body.ref) return err('Falta txId (o ref del movimiento)', 400)
      return ok(await adminSettleConvert(String(body.txId ?? body.ref), {
        rail: body.rail ? String(body.rail) : undefined,
        amount: body.amount != null ? Number(body.amount) : undefined,
        preview: body.preview === true,
      }))
    }
    // Historial (log) de cambios de wallet — el "archivo" de auditoría. Con
    // email filtra por cliente; sin él, los últimos cambios de todos.
    if (action === 'wallet_log') {
      return ok({ ok: true, entries: await getWalletLog(body.email ? String(body.email) : undefined) })
    }
    // Auditoría: detectar wallets colisionadas y usuarios sin índice.
    if (action === 'audit_indexes') {
      return ok(await auditIndexes())
    }
    // Reparación: reasignar a un usuario (por userId o email) un índice nuevo.
    if (action === 'reset_user_index') {
      let uid = userId as string | undefined
      if (!uid && body.email) {
        const { data } = await db.from('users').select('id').eq('email', String(body.email)).limit(1).maybeSingle()
        uid = data?.id
      }
      if (!uid) return err('Falta userId o email de un usuario existente', 400)
      return ok(await resetUserIndex(String(uid)))
    }
    if (action === 'get_treasury_movements') return ok({ movements: await getTreasuryMovements() })
    if (action === 'locate') {
      if (!userId) return err('Falta userId', 400)
      return ok(await locate(userId))
    }
    if (action === 'trace') {
      if (!body.traceId) return err('Falta traceId', 400)
      const r = await gfGet(`/api/v1/gasfree/${body.traceId}`)
      return ok({ ok: r?.code === 200, data: r?.data ?? r })
    }
    // Resolver el TxID ON-CHAIN de un movimiento de tesorería (comprobante).
    // 1) Detalle de la traza en GasFree (trae el hash cuando ya está minado).
    // 2) Si no, se busca en las transferencias ENTRANTES de la dirección DESTINO
    //    (la wallet del proveedor, ej. Finity) el TRC-20 que cuadre por monto
    //    cerca de la hora — ese es el hash que Finity debería haber registrado.
    if (action === 'treasury_txid') {
      const traceId = String(body.traceId ?? '')
      const toAddress = String(body.toAddress ?? '')
      const amount = Number(body.amount ?? 0)
      const { token } = await gfConfig()
      const dec = Number(token.decimal ?? 6)
      let txid: string | null = null
      let source: string | null = null
      if (traceId) {
        try {
          const r = await gfGet(`/api/v1/gasfree/${traceId}`)
          const d = (r?.data ?? {}) as any
          txid = d.txnHash ?? d.txHash ?? d.txid ?? d.txId ?? d.transactionHash ?? d.hash ?? d.txnId ?? null
          if (txid) source = 'gasfree'
        } catch { /* sigue al match on-chain */ }
      }
      if (!txid && toAddress && amount > 0) {
        try {
          const incoming = await incomingTransfersTrc20(toAddress, token.tokenAddress, dec, 60)
          const match = incoming.find(t => Math.abs(t.amount - amount) < 0.5)
          if (match?.txId) { txid = match.txId; source = 'onchain_dest' }
        } catch { /* best-effort */ }
      }
      return ok({ ok: true, txid: txid ?? null, source, explorer: txid ? `https://tronscan.org/#/transaction/${String(txid).replace(/^0x/, '')}` : null })
    }
    if (action === 'get_treasury_config') return ok(await getTreasuryConfig())
    if (action === 'set_treasury_config') return ok(await setTreasuryConfig(body.config ?? {}))
    if (action === 'get_providers') return ok({ providers: await getProviders() })
    if (action === 'set_providers') return ok({ providers: await setProviders(body.providers ?? []) })
    // Recaudadora rotativa: la actual (período vigente) y el histórico archivado.
    if (action === 'recaudadora_current') return ok(await recaudadoraCurrent())
    if (action === 'recaudadora_list') return ok(await recaudadoraList(body.back != null ? Number(body.back) : 12))
    // Fijar la recaudadora (dejar de rotar sola) — todo manual desde ya.
    if (action === 'recaudadora_pin') return ok(await pinRecaudadora())
    // Rotar la recaudadora A MANO (avanza al siguiente período; la anterior queda archivada).
    if (action === 'recaudadora_rotate') return ok(await rotateRecaudadora())
    // Consolidar: barrer el saldo de las recaudadoras archivadas → la actual.
    if (action === 'recaudadora_consolidate') return ok(await consolidateRecaudadoras(body.back != null ? Number(body.back) : 12))

    return err(`Acción desconocida: ${action}`, 400)
  } catch (e) {
    return err((e as Error)?.message ?? String(e), 500)
  }
})
