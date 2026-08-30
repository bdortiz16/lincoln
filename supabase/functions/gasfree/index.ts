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

const API_KEY    = (Deno.env.get('GASFREE_API_KEY') ?? '').trim()
const API_SECRET = (Deno.env.get('GASFREE_API_SECRET') ?? '').trim()
const NET = (Deno.env.get('GASFREE_NET') ?? 'nile').trim().toLowerCase() === 'tron' ? 'tron' : 'nile'
const HOT_KEY  = (Deno.env.get('LINCOIN_TRON_HOT_KEY') ?? '').trim()
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
const ADMIN_PASS = Deno.env.get('ADMIN_PASS') ?? ''
async function callerIsAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (ADMIN_PASS && authHeader === `AdminBypass ${ADMIN_PASS}`) return true
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
// Recaudadora ACTUAL (la del período vigente). Si hay LINCOIN_TRON_HOT_KEY
// seteada, se respeta esa dirección fija (no rota) — modo legacy.
async function recaudadora() {
  if (HOT_KEY) {
    const pkHex = HOT_KEY.startsWith('0x') ? HOT_KEY : '0x' + HOT_KEY
    const eoa = await ethAddressToTron(new ethers.Wallet(pkHex).address)
    return { pkHex, eoa, period: null as number | null, pinned: true }
  }
  if (!MNEMONIC) throw new Error('Configura GASFREE_TRON_MNEMONIC en Supabase Secrets para derivar la recaudadora')
  const period = recaudadoraPeriod()
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
  const period = recaudadoraPeriod()
  return { ...(await recaudadoraInfo(period)), current: true, rotates: true, nextRotation: periodCutoverDate(period + 1).toISOString() }
}
// Lista la actual + las archivadas (períodos anteriores) con su saldo.
async function recaudadoraList(back = 12) {
  if (HOT_KEY) return { pinned: true, periods: [await recaudadoraCurrent()] }
  const cur = recaudadoraPeriod()
  const periods: any[] = []
  for (let p = cur; p > cur - Math.max(1, back); p--) {
    try { periods.push({ ...(await recaudadoraInfo(p)), current: p === cur, archived: p < cur }) }
    catch (e) { periods.push({ period: p, label: periodLabel(p), error: (e as Error)?.message }) }
  }
  return { current: cur, nextRotation: periodCutoverDate(cur + 1).toISOString(), periods }
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
async function userIndex(userId: string): Promise<number> {
  const { data: primary } = await db.from('users').select('id, email, raw_data').eq('id', userId).maybeSingle()
  const praw = (primary?.raw_data ?? {}) as Record<string, any>
  // Fast-path INTACTO: si la fila primaria ya tiene índice, úsalo tal cual.
  if (typeof praw.gasfreeIndex === 'number') return praw.gasfreeIndex

  // Resolver hermanos por correo (half-auth / duplicados): el índice puede
  // estar en otra fila del mismo correo.
  let rows: any[] = primary ? [primary] : []
  const email = primary?.email
  if (email) {
    const { data: sibs } = await db.from('users').select('id, email, raw_data').eq('email', email)
    if (Array.isArray(sibs) && sibs.length) rows = sibs
  }

  // (1) Reusar un índice YA asignado en cualquier fila hermana (estabilidad).
  for (const r of rows) {
    const raw = (r.raw_data ?? {}) as Record<string, any>
    const existing = typeof raw.gasfreeIndex === 'number' ? raw.gasfreeIndex
      : typeof raw.gasfreeHdIndex === 'number' ? raw.gasfreeHdIndex : null
    if (existing != null) { await persistIndexToRows(rows, existing); return existing }
  }

  // (2) Sin fila real donde persistir → índice DETERMINISTA por userId
  // (estable entre llamadas y con offset alto para no chocar con el contador).
  if (!rows.length) return deterministicIndex(userId)

  // (3) Asignar nuevo índice de forma atómica y persistir en TODAS las filas.
  const next = await allocNextIndex()
  await persistIndexToRows(rows, next)
  return next
}

async function persistIndexToRows(rows: any[], idx: number) {
  for (const r of rows) {
    const raw = (r.raw_data ?? {}) as Record<string, any>
    if (raw.gasfreeIndex === idx) continue
    await db.from('users').update({ raw_data: { ...raw, gasfreeIndex: idx } }).eq('id', r.id)
  }
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
async function resetUserIndex(userId: string) {
  const { data: primary } = await db.from('users').select('id, email, raw_data').eq('id', userId).maybeSingle()
  if (!primary) throw new Error('Usuario no encontrado')
  let rows: any[] = [primary]
  if (primary.email) {
    const { data: sibs } = await db.from('users').select('id, email, raw_data').eq('email', primary.email)
    if (Array.isArray(sibs) && sibs.length) rows = sibs
  }
  const oldIndex = (primary.raw_data ?? {})?.gasfreeIndex ?? null
  const next = await allocNextIndex()
  for (const r of rows) {
    const raw = { ...((r.raw_data ?? {}) as Record<string, any>) }
    raw.gasfreeIndex = next
    delete raw.gasfreeHdIndex     // no dejar que el índice viejo lo re-sobrescriba
    delete raw.gasfreeAddress   // limpiar dirección cacheada (se recalcula)
    delete raw.gasfreeEoa
    await db.from('users').update({ raw_data: raw }).eq('id', r.id)
  }
  const { eoa } = await userWallet(next)
  const acct = await gfAccount(eoa)
  return { ok: true, email: primary.email, oldIndex, newIndex: next, eoa, gasFreeAddress: acct.gasFreeAddress }
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
    await db.from('users').update({ raw_data: { ...raw, gasfreeEoa: eoa, gasfreeAddress: acct.gasFreeAddress } }).eq('id', userId)
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
    await db.from('users').update({ raw_data: { ...raw, gasfreeEoa: eoa, gasfreeAddress: acct.gasFreeAddress } }).eq('id', userId)
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
  await db.from('users').update({ raw_data: { ...raw, subWallets: subs } }).eq('id', userId)
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
  await db.from('users').update({ raw_data: { ...raw, subWallets: subs } }).eq('id', userId)
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
  await db.from('users').update({ raw_data: { ...raw, subWallets: subs } }).eq('id', userId)
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
  const bals = (u.balances as Record<string, number>) ?? {}
  const newUsdLedger = Math.max(0, parseFloat((Number(bals.USD ?? 0) - grossUsd).toFixed(2)))
  const raw = (u.raw_data ?? {}) as Record<string, any>
  const onchainAfter = Math.max(0, parseFloat((bal - value - fee).toFixed(dec)))
  await db.from('users').update({
    balances: { ...bals, USD: newUsdLedger },
    raw_data: { ...raw, gasfreeCredited: onchainAfter },
  }).eq('id', userId)

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
    const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
    const bf = (uf?.balances as Record<string, number>) ?? { ...bals, USD: newUsdLedger }
    const nc = parseFloat((Number(bf.COP ?? 0) + copAmount).toFixed(2))
    await db.from('users').update({ balances: { ...bf, COP: nc } }).eq('id', userId)
    return nc
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
async function myConvertCredit(
  userId: string, txId: string, copAmount: number,
  meta: { mouvRate?: number; feePct?: number; utilityCop?: number },
) {
  if (!(copAmount > 0)) throw new Error('COP inválido')
  const { data: tx } = await db.from('transactions').select('*').eq('id', txId).single()
  if (!tx) throw new Error('Movimiento no encontrado')
  if (tx.user_id !== userId) throw new Error('No autorizado')
  if (tx.status === 'Completado') return { ok: true, status: 'Completado', copCredited: 0 }
  const rd = (tx.raw_data ?? {}) as Record<string, any>
  const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
  const bf = (uf?.balances as Record<string, number>) ?? {}
  const nc = parseFloat((Number(bf.COP_ACH ?? 0) + copAmount).toFixed(2))
  await db.from('users').update({ balances: { ...bf, COP_ACH: nc } }).eq('id', userId)
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
    const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
    const bf = (uf?.balances as Record<string, number>) ?? {}
    const nc = parseFloat((Number(bf.COP ?? 0) + copAmount).toFixed(2))
    await db.from('users').update({ balances: { ...bf, COP: nc } }).eq('id', userId)
    await db.from('transactions').update({ status: 'Completado', raw_data: { ...rd, convertPhase: 'done', providerPending: false, providerTraceId: providerTraceId ?? rd.providerTraceId } }).eq('id', txId)
    return { ok: true, status: 'Completado', phase: 'done', copCredited: copAmount, newCop: nc }
  }

  // Hop 1 pendiente: confirmar → hop 2 → esperar → completar.
  if (rd.convertPhase === 'hop1_pending' || rd.convertPhase === 'hop1_failed') {
    const c1 = await gfTraceStatus(String(rd.traceId ?? ''))
    if (c1 === 'failed') {
      const { data: uf } = await db.from('users').select('balances').eq('id', userId).single()
      const bf = (uf?.balances as Record<string, number>) ?? {}
      const nu = parseFloat((Number(bf.USD ?? 0) + Number(rd.fromAmount ?? 0)).toFixed(2))
      await db.from('users').update({ balances: { ...bf, USD: nu } }).eq('id', userId)
      await db.from('transactions').update({ status: 'Rechazado', raw_data: { ...rd, convertPhase: 'hop1_failed', refunded: true } }).eq('id', txId)
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
async function rechargeRegisteredAtProvider(uid: string, fwd: number): Promise<boolean> {
  try {
    const mv = await finityCall('movements', uid)
    const d: any = mv?.data ?? {}
    const rows: any[] = Array.isArray(d) ? d : Array.isArray(d.data) ? d.data : Array.isArray(d.items) ? d.items
      : Array.isArray(d.movements) ? d.movements : Array.isArray(d.results) ? d.results : []
    const nowMs = Date.now()
    for (const r of rows.slice(0, 12)) {
      if (!/recarga|recharge|deposit|blockchain|top.?up/i.test(JSON.stringify(r))) continue
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
      if (!nums.some(n => Math.abs(n - fwd) <= Math.max(0.05, fwd * 0.01))) continue
      const ds = (r.created_at ?? r.createdAt ?? r.date ?? r.creation_date ?? null) as string | null
      if (ds) { const t = Date.parse(ds); if (isFinite(t) && nowMs - t > 30 * 60 * 1000) continue }
      return true
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
      if (phase === 'converting') return // el frontend (u otro run) la tiene
      if (phase !== 'recharged') {
        const fin: any = await myConvertFinalize(uid, txId, true).catch(() => null)
        if (!fin || (!fin.recharged && fin.phase !== 'recharged')) {
          if (fin?.status === 'Rechazado' || fin?.status === 'Completado') return
          await sleepMs(12000); continue
        }
      }
      const fwd = Number(rd.usdtToProvider ?? rd.fwd ?? 0)
      if (fwd > 0 && !(await rechargeRegisteredAtProvider(uid, fwd))) { await sleepMs(10000); continue }
      const claim = await claimConvert(txId)
      if (!claim.claimed) return
      try {
        let done: any = null
        for (let attempt = 0; attempt < 2 && !done; attempt++) {
          if (attempt > 0) await sleepMs(3000)
          const q = await finityCall('rates', uid, { query: { from: 'USD', to: 'COP' } })
          const quote: any = q?.data ?? {}
          const createBody: Record<string, unknown> = { fromAsset: 'USD', toAsset: 'COP', amount: fwd }
          if (quote.id) createBody.exchange_rate_id = quote.id
          if (quote.expires_at) createBody.expires_at = quote.expires_at
          const c = await finityCall('convert', uid, { data: createBody })
          const convId = (c?.data as any)?.id
          if (!c?.ok || !convId) continue
          const f = await finityCall('convert_confirm', uid, { id: String(convId) })
          const dd: any = f?.data ?? {}
          if (f?.ok && String(dd.status ?? '') === 'SUCCESS') { done = dd; break }
        }
        if (!done) { await releaseConvertClaim(txId); await sleepMs(15000); continue }
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
  // Contador propio (separado de gasfreeCredited): arranca en 0 — GasFree es
  // una fuente nueva, sin acreditaciones previas que reconstruir.
  const credited: number = typeof raw.gasfreeCredited === 'number' ? raw.gasfreeCredited : 0
  const diff = parseFloat((onchainBal - credited).toFixed(dec))
  // AUTOCURACIÓN: si lo acreditado quedó POR ENCIMA del saldo on-chain
  // (p. ej. por una doble acreditación vieja), se re-basa el contador al
  // saldo real — sin tocar balances ni crear movimientos. Si no, el
  // próximo depósito no se acreditaría (diff quedaría en 0 para siempre).
  if (diff < -0.0001) {
    await db.from('users').update({ raw_data: { ...raw, gasfreeCredited: onchainBal } }).eq('id', userId)
    return { synced: false, onchain: onchainBal, credited: 0, diff: 0, rebased: true, reason: `Contador re-basado al saldo real (${onchainBal} USDT).` }
  }
  if (diff <= 0.0001) {
    // Diagnóstico: leer cada vía por separado para saber por qué da 0.
    const viaBalanceOf = await tokenBalanceOn(acct.gasFreeAddress, token.tokenAddress, dec, CFG.tronHost)
    const viaTransfers = await tokenBalanceFromTransfers(acct.gasFreeAddress, token.tokenAddress, dec)
    const allZero = viaBalanceOf === 0 && viaTransfers === 0
    const reason = allZero
      ? `No se leyó saldo on-chain (balanceOf=0, transfers=0) en ${acct.gasFreeAddress} · contrato ${token.tokenAddress} · red ${NET}. Si Tronscan SÍ muestra saldo, TronGrid está limitando al servidor: agrega TRONGRID_API_KEY en Supabase → Edge Functions → Secrets.`
      : `Sin depósitos nuevos. On-chain=${onchainBal} USDT, ya acreditado=${credited}.`
    return { synced: false, onchain: onchainBal, credited, diff: 0, reason, debug: { gasFreeAddress: acct.gasFreeAddress, contract: token.tokenAddress, net: NET, viaBalanceOf, viaTransfers } }
  }

  const bals = (u.balances as Record<string, number>) ?? {}
  const newUsd = parseFloat(((Number(bals.USD ?? 0)) + diff).toFixed(2))
  const newCredited = parseFloat((credited + diff).toFixed(dec))
  // ── ANTI-DOBLE-ACREDITACIÓN (CAS) ──────────────────────────────
  // El poll de 15 s + el botón "Verificar" pueden llegar AL TIEMPO y ambos
  // ver el mismo depósito (lectura → comparación → escritura sin candado):
  // eso acreditaba doble y creaba 2 movimientos + notificaciones falsas.
  // La escritura ahora es CONDICIONAL: solo pasa si gasfreeCredited sigue
  // EXACTAMENTE como lo leímos — el perdedor de la carrera no escribe,
  // no inserta movimiento y responde synced:false (sin toast).
  let upd = db.from('users').update({
    balances: { ...bals, USD: newUsd },
    raw_data: { ...raw, gasfreeCredited: newCredited },
  }).eq('id', userId)
  upd = typeof raw.gasfreeCredited === 'number'
    ? upd.filter('raw_data->>gasfreeCredited', 'eq', String(raw.gasfreeCredited))
    : upd.filter('raw_data->>gasfreeCredited', 'is', null)
  const { data: updRows, error: updErr } = await upd.select('id')
  if (updErr || !updRows || updRows.length === 0) {
    return { synced: false, raced: true, onchain: onchainBal, credited: 0, diff: 0, reason: 'Otra verificación acreditó este depósito hace un instante.' }
  }
  // Enriquecer el comprobante con la transferencia entrante real: de dónde
  // vino, a qué dirección llegó (la GasFree del usuario), la red y el TxID.
  const inc = await latestIncomingTrc20(acct.gasFreeAddress, token.tokenAddress, dec, diff)
  await db.from('transactions').insert({
    user_id: userId, type: 'load', amount: diff, currency: 'USD', status: 'Completado',
    raw_data: {
      initials: '₮', title: 'Depósito USDT (GasFree · TRC-20)', createdAt: new Date().toISOString(),
      userName: u.email, source: 'GASFREE',
      network: 'TRON (TRC-20)',
      toAddress: acct.gasFreeAddress,
      ...(inc ? { fromAddress: inc.from, txId: inc.txId } : {}),
    },
  })
  return { synced: true, credited: diff, onchain: onchainBal, newBalance: newUsd }
}

// ⚠️ YA NO la usa el flujo "Enviar → Wallet" del cliente (ver mySend):
// pagar desde la recaudadora el envío de UN cliente usando el USDT
// agregado de TODOS significaba que un envío podía rechazarse por falta
// de saldo en tesorería aunque el cliente sí tuviera sus USDT reales en
// su propia wallet GasFree (o, peor, pagarse con USDT de otro cliente).
// Se deja para pagos que sí deben salir de tesorería (ej. proveedores).
async function myWalletWithdrawal(userId: string, toAddress: string, amount: number) {
  if (!(amount > 0)) throw new Error('Monto inválido')
  const { data: u } = await db.from('users').select('balances, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const bals = (u.balances as Record<string, number>) ?? {}
  const usd = Number(bals.USD ?? 0)

  const { token } = await gfConfig()
  const rec = await recaudadora()
  const recAcct = await gfAccount(rec.eoa)
  const dec = Number(token.decimal ?? 6)
  const activateFeeUsdt = recAcct.active ? 0 : Number(token.activateFee ?? 0) / Math.pow(10, dec)
  const transferFeeUsdt = Number(token.transferFee ?? 0) / Math.pow(10, dec)
  const feeQuoted = parseFloat((activateFeeUsdt + transferFeeUsdt).toFixed(dec))
  const total = parseFloat((amount + feeQuoted).toFixed(2))
  if (usd < total) throw new Error(`Saldo USD insuficiente (disponible ${usd.toFixed(2)}, se necesitan ${total.toFixed(2)} = ${amount} + comisión GasFree ${feeQuoted.toFixed(2)})`)

  // 1) Debitar primero (monto + comisión cotizada)
  await db.from('users').update({ balances: { ...bals, USD: parseFloat((usd - total).toFixed(2)) } }).eq('id', userId)
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
    // Devolver el débito completo — el envío on-chain no salió
    try {
      const { data: u2 } = await db.from('users').select('balances').eq('id', userId).single()
      const b2 = (u2?.balances as Record<string, number>) ?? {}
      await db.from('users').update({ balances: { ...b2, USD: parseFloat(((Number(b2.USD ?? 0)) + total).toFixed(2)) } }).eq('id', userId)
    } catch { console.error(`[myWalletWithdrawal] ⚠ NO PUDE DEVOLVER el débito de ${total} a ${userId} — revisar manualmente`) }
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
  const CHUNK = 24
  for (const m of mnemos) {
    for (let base = 0; base <= top; base += CHUNK) {
      const idxs: number[] = []
      for (let i = base; i <= Math.min(top, base + CHUNK - 1); i++) idxs.push(i)
      const results = await Promise.all(idxs.map(async (i) => {
        try {
          const { eoa } = await userWalletFrom(m.phrase, i)
          const acct = await gfAccount(eoa)
          return { i, eoa, gasFreeAddress: acct.gasFreeAddress, active: acct.active }
        } catch { return { i, eoa: null, gasFreeAddress: null, active: false } }
      }))
      const hit = results.find((r) => (r.eoa && r.eoa === t) || (r.gasFreeAddress && r.gasFreeAddress === t))
      if (hit) {
        const bal = hit.gasFreeAddress ? await tokenBalance(hit.gasFreeAddress, token.tokenAddress, dec) : 0
        return { found: true, index: hit.i, mnemonic: m.source, eoa: hit.eoa, gasFreeAddress: hit.gasFreeAddress, active: hit.active, balanceUsdt: bal }
      }
    }
  }
  return { found: false, scannedUpTo: top, mnemonicsTried: mnemos.map((m) => m.source) }
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
    if (action === 'my_wallets_reorder') {
      if (!userId || !Array.isArray(body.ids)) return err('Faltan userId o ids', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
      return ok(await myWalletsReorder(userId, body.ids.map((x: any) => String(x))))
    }
    if (action === 'my_wallet_send') {
      if (!userId || !body.id || !toAddress || !amount) return err('Faltan userId, id, toAddress o amount', 400)
      if (!(await verifySelfOrAdmin(req, userId))) return err('No autorizado', 401)
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
      return ok(await myWalletWithdrawal(userId, String(toAddress), Number(amount)))
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
    if (action === 'get_treasury_config') return ok(await getTreasuryConfig())
    if (action === 'set_treasury_config') return ok(await setTreasuryConfig(body.config ?? {}))
    if (action === 'get_providers') return ok({ providers: await getProviders() })
    if (action === 'set_providers') return ok({ providers: await setProviders(body.providers ?? []) })
    // Recaudadora rotativa: la actual (período vigente) y el histórico archivado.
    if (action === 'recaudadora_current') return ok(await recaudadoraCurrent())
    if (action === 'recaudadora_list') return ok(await recaudadoraList(body.back != null ? Number(body.back) : 12))

    return err(`Acción desconocida: ${action}`, 400)
  } catch (e) {
    return err((e as Error)?.message ?? String(e), 500)
  }
})
