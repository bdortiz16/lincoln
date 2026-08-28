import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ethers } from 'https://esm.sh/ethers@6.13.5'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TRON_XPUB     = Deno.env.get('TATUM_TRON_XPUB') ?? ''
const ETH_XPUB      = Deno.env.get('TATUM_ETH_XPUB') ?? ''
const TATUM_API_KEY = Deno.env.get('TATUM_API_KEY') ?? ''
const ETH_MNEMONIC    = Deno.env.get('TATUM_ETH_MNEMONIC') ?? ''
const TRON_MNEMONIC   = Deno.env.get('TATUM_TRON_MNEMONIC') ?? ''
// Hot wallet private keys — BSC key also serves BASE (same EVM address)
const BSC_HOT_KEY     = Deno.env.get('LINCOIN_BSC_HOT_KEY') ?? ''
const TRON_HOT_KEY    = Deno.env.get('LINCOIN_TRON_HOT_KEY') ?? ''
const BASE_HOT_KEY    = Deno.env.get('LINCOIN_BASE_HOT_KEY') || Deno.env.get('LINCOIN_BSC_HOT_KEY') || ''

// ── GasFree (envíos USDT sin TRX; la comisión se paga en USDT) ──
const GASFREE_API_KEY    = (Deno.env.get('GASFREE_API_KEY') ?? '').trim()
const GASFREE_API_SECRET = (Deno.env.get('GASFREE_API_SECRET') ?? '').trim()
// 'nile' (testnet) o 'tron' (mainnet). Empezar SIEMPRE en nile.
const GASFREE_NET = (Deno.env.get('GASFREE_NET') ?? 'nile').trim().toLowerCase() === 'tron' ? 'tron' : 'nile'
const GASFREE_CFG = GASFREE_NET === 'tron'
  ? { host: 'https://open.gasfree.io', prefix: '/tron', chainId: 728126428,  verifying: 'TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U', tronHost: 'https://api.trongrid.io' }
  : { host: 'https://open-test.gasfree.io', prefix: '/nile', chainId: 3448148188, verifying: 'THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc', tronHost: 'https://nile.trongrid.io' }

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/tatum-webhook`
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const ok  = (body: object) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } })
const err = (msg: string, status = 500) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '').toLowerCase().padStart(40, '0')
  return new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)))
}
function base58Encode(bytes: Uint8Array): string {
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''))
  let s = ''
  while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n }
  for (const b of bytes) { if (b) break; s = ALPHA[0] + s }
  return s
}
async function ethAddressToTron(ethAddr: string): Promise<string> {
  const payload = new Uint8Array([0x41, ...hexToBytes(ethAddr)])
  const h1 = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', h1))
  return base58Encode(new Uint8Array([...payload, ...h2.slice(0, 4)]))
}
function base58Decode(s: string): Uint8Array {
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = 0n
  for (const c of s) {
    const i = ALPHA.indexOf(c)
    if (i < 0) throw new Error(`base58 inválido: ${c}`)
    n = n * 58n + BigInt(i)
  }
  const out: number[] = []
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n }
  for (const c of s) { if (c === '1') out.unshift(0); else break }
  return new Uint8Array(out)
}
// TAA...base58 → hex EVM de 20 bytes (sin el prefijo 0x41 ni el checksum)
function tronAddrToEvmHex(addr: string): string {
  const raw = base58Decode(addr)
  const payload = raw.slice(0, raw.length - 4)
  return Array.from(payload.slice(1)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function deriveAddressLocal(xpub: string, index: number, network: string): Promise<string> {
  // 1. Try xpub — Tatum xpub is at depth m/44'/60'/0', so derive 0/index
  // fromExtendedKey returns HDNodeVoidWallet for xpub (public key only), so use any
  try {
    const node: any = ethers.HDNodeWallet.fromExtendedKey(xpub)
    let child: any
    try { child = node.derivePath(`0/${index}`) } catch { child = node.deriveChild(index) }
    const addr = network === 'tron' ? await ethAddressToTron(child.address) : child.address
    console.log(`[deriveAddress] xpub OK → ${addr}`)
    return addr
  } catch (xpubErr) {
    console.warn('[deriveAddress] xpub failed:', (xpubErr as Error).message)
  }

  // 2. Try mnemonic
  const mnemonic = network === 'tron' ? TRON_MNEMONIC : ETH_MNEMONIC
  if (mnemonic) {
    try {
      const path = network === 'tron' ? "m/44'/195'/0'/0" : "m/44'/60'/0'/0"
      const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic), path)
      const child = root.deriveChild(index)
      const addr = network === 'tron' ? await ethAddressToTron(child.address) : child.address
      console.log(`[deriveAddress] mnemonic OK → ${addr}`)
      return addr
    } catch (mnErr) {
      console.warn('[deriveAddress] mnemonic failed:', (mnErr as Error).message)
    }
  }

  // 3. Last resort — derive from SERVICE_KEY + index (deterministic, no external secret needed)
  // Uses HMAC-SHA256(SERVICE_KEY, "cuypay:network:index") as a private key seed
  console.warn('[deriveAddress] using SERVICE_KEY fallback for index', index)
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(`cuypay:${network}:${index}`))
  const privKey = '0x' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  const wallet = new ethers.Wallet(privKey)
  return network === 'tron' ? ethAddressToTron(wallet.address) : wallet.address
}

const WALLET_KEY_TO_CHAIN: Record<string, string> = {
  USDT_TRON: 'TRON', USDT_BSC: 'BSC', USDC_BSC: 'BSC', USDC_MATIC: 'MATIC', USDC_BASE: 'BASE',
}
async function subscribeAddress(address: string, walletKey: string): Promise<boolean> {
  if (!TATUM_API_KEY) { console.warn('[tatum] TATUM_API_KEY not set — skipping subscription'); return false }
  const chain = WALLET_KEY_TO_CHAIN[walletKey]
  if (!chain) { console.warn('[tatum] unknown chain for', walletKey); return false }
  const body = JSON.stringify({ type: 'ADDRESS_EVENT', attr: { address, chain, url: WEBHOOK_URL } })
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch('https://api.tatum.io/v4/subscription', {
        method: 'POST',
        headers: { 'x-api-key': TATUM_API_KEY, 'Content-Type': 'application/json' },
        body,
      })
      if (resp.ok) {
        console.log(`[tatum] subscribed ${address} on ${chain} (attempt ${attempt})`)
        return true
      }
      const errText = await resp.text()
      // 409 = already subscribed — treat as success
      if (resp.status === 409) { console.log(`[tatum] already subscribed ${address}`); return true }
      console.warn(`[tatum] subscription attempt ${attempt} failed ${resp.status}:`, errText)
    } catch (e) {
      console.warn(`[tatum] subscription attempt ${attempt} error:`, (e as Error).message)
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000))
  }
  console.error(`[tatum] failed to subscribe ${address} on ${chain} after 3 attempts`)
  return false
}

async function getUserIndex(userId: string): Promise<number> {
  const { data: user } = await db.from('users').select('raw_data').eq('id', userId).single()
  const raw = user?.raw_data ?? {}
  if (typeof raw.tatumHdIndex === 'number') return raw.tatumHdIndex
  const { data: cfg } = await db.from('system_config').select('value').eq('key', 'tatum_hd_counter').single()
  const nextIndex: number = cfg?.value ? (parseInt(cfg.value) + 1) : 1
  await db.from('system_config').upsert({ key: 'tatum_hd_counter', value: String(nextIndex) })
  await db.from('users').update({ raw_data: { ...raw, tatumHdIndex: nextIndex } }).eq('id', userId)
  return nextIndex
}

async function getOrCreate(userId: string, walletKey: string) {
  const { data: user } = await db.from('users').select('raw_data').eq('id', userId).single()
  const raw = user?.raw_data ?? {}
  const addresses: Record<string, string> = raw.tatumAddresses ?? {}
  if (addresses[walletKey]) {
    // Re-subscribe on every load — idempotent, fixes addresses where first subscription failed
    subscribeAddress(addresses[walletKey], walletKey).catch(e =>
      console.warn('[getOrCreate] re-subscribe failed (non-fatal):', e?.message))
    return { address: addresses[walletKey] }
  }
  const index = await getUserIndex(userId)
  let address: string
  if (walletKey === 'USDT_TRON') {
    if (!TRON_XPUB) throw new Error('Falta TATUM_TRON_XPUB')
    address = await deriveAddressLocal(TRON_XPUB, index, 'tron')
  } else if (['USDT_BSC', 'USDC_BSC', 'USDC_MATIC', 'USDC_BASE'].includes(walletKey)) {
    if (!ETH_XPUB) throw new Error('Falta TATUM_ETH_XPUB')
    address = await deriveAddressLocal(ETH_XPUB, index, 'evm')
  } else {
    throw new Error(`Red no soportada: ${walletKey}`)
  }
  addresses[walletKey] = address
  await db.from('users').update({ raw_data: { ...raw, tatumAddresses: addresses } }).eq('id', userId)
  await subscribeAddress(address, walletKey)
  return { address }
}

async function verifyAndCredit(userId: string, walletKey: string) {
  const cfg = TOKEN_CFG[walletKey]
  if (!cfg) throw new Error(`Token no soportado: ${walletKey}`)

  const { data: user } = await db.from('users').select('raw_data, crypto_balances').eq('id', userId).single()
  if (!user) throw new Error('Usuario no encontrado')

  const storedAddresses: Record<string, string> = user.raw_data?.tatumAddresses ?? {}
  const address = storedAddresses[walletKey]
  if (!address) return { synced: false, reason: 'Sin dirección generada aún' }

  // Always re-subscribe to ensure webhook is active
  subscribeAddress(address, walletKey).catch(() => {})

  const bals = (user.crypto_balances as Record<string, number>) ?? {}
  const storedBal = bals[walletKey] ?? bals[WALLET_TO_CURRENCY[walletKey] ?? walletKey] ?? 0

  let onchainBal: number
  if (cfg.tron) {
    onchainBal = await tronTokenBalance(address, cfg.contract, cfg.decimals)
  } else {
    const provider = new ethers.JsonRpcProvider(cfg.rpc!)
    const contract = new ethers.Contract(cfg.contract, ERC20_ABI, provider)
    const rawBal = await contract.balanceOf(address)
    onchainBal = parseFloat(ethers.formatUnits(rawBal, cfg.decimals))
  }

  // ── Anti doble-acreditación ──────────────────────────────
  // NO se compara contra el saldo del libro (ese baja legítimamente con
  // conversiones/consolidación y hacía que cada clic re-acreditara lo
  // mismo). Se compara contra un contador ACUMULADO de lo ya acreditado
  // para esta dirección (raw_data.tatumCredited). Un depósito solo puede
  // acreditarse una vez en la vida.
  const raw = (user.raw_data ?? {}) as Record<string, any>
  const creditedMap: Record<string, number> = raw.tatumCredited ?? {}
  let creditedSoFar = creditedMap[walletKey]
  if (typeof creditedSoFar !== 'number') {
    // Primera vez con el contador: reconstruirlo desde el historial de
    // acreditaciones ya hechas (incluye las fantasma) para no duplicarlas.
    // OJO: acreditaciones viejas quedaron con moneda genérica ('USDT') y
    // otras con la específica ('USDT_TRON') — hay que contar AMBAS o el
    // contador queda corto y re-acredita de más.
    const aliases = [...new Set([walletKey, WALLET_TO_CURRENCY[walletKey] ?? walletKey])]
    const { data: past } = await db.from('transactions').select('amount')
      .eq('user_id', userId).eq('type', 'otc_deposit').in('currency', aliases)
    creditedSoFar = (past ?? []).reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0)
    console.log(`[verifyAndCredit] contador inicializado desde historial (${aliases.join('/')}): ${creditedSoFar}`)
  }

  const diff = parseFloat((onchainBal - creditedSoFar).toFixed(8))
  console.log(`[verifyAndCredit] ${walletKey} address=${address} onchain=${onchainBal} yaAcreditado=${creditedSoFar} libro=${storedBal} diff=${diff}`)

  if (diff <= 0.0001) {
    return { synced: false, onchain: onchainBal, credited: creditedSoFar, stored: storedBal, diff, reason: 'Sin depósitos nuevos por acreditar' }
  }

  const newBal = parseFloat((storedBal + diff).toFixed(8))
  const newCredited = parseFloat((creditedSoFar + diff).toFixed(8))
  await db.from('users').update({
    crypto_balances: { ...bals, [walletKey]: newBal },
    raw_data: { ...raw, tatumCredited: { ...creditedMap, [walletKey]: newCredited } },
  }).eq('id', userId)

  const { data: txRow } = await db.from('transactions').insert({
    user_id: userId, type: 'otc_deposit', amount: diff, currency: walletKey, status: 'Completado',
    raw_data: { address, walletKey, onchainBal, storedBal, syncedAt: new Date().toISOString(), source: 'verify_and_credit' },
  }).select('*').single()

  if (txRow) {
    const NOTIFY_URL = `${SUPABASE_URL}/functions/v1/notify-transaction`
    fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ type: 'INSERT', table: 'transactions', record: txRow }),
    }).catch(e => console.warn('[verifyAndCredit] notify failed:', e?.message))
  }

  return { synced: true, credited: diff, onchain: onchainBal, stored: storedBal, newBalance: newBal }
}

const WALLET_TO_CURRENCY: Record<string, string> = {
  USDT_TRON: 'USDT', USDT_BSC: 'USDT', USDC_BSC: 'USDC', USDC_MATIC: 'USDC',
  USDC_BASE: 'USDC',
}

// Platform withdrawal fee per network (in USD/USDT)
const WITHDRAWAL_FEES: Record<string, number> = {
  USDT_BSC: 1, USDC_BSC: 1, USDT_TRON: 10, USDC_BASE: 1,
}

async function getBalance(userId: string, walletKey: string) {
  const { data: user } = await db.from('users').select('crypto_balances').eq('id', userId).single()
  const bals = (user?.crypto_balances as Record<string, number>) ?? {}
  // Prefer network-specific key (USDT_BSC), fall back to generic (USDT)
  const available = bals[walletKey] ?? bals[WALLET_TO_CURRENCY[walletKey] ?? walletKey] ?? 0
  return { available, blocked: 0 }
}

const TOKEN_CFG: Record<string, { contract: string; decimals: number; rpc?: string; tron?: boolean; base?: boolean }> = {
  USDT_BSC:   { contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, rpc: 'https://bsc-dataseed.binance.org/' },
  USDC_BSC:   { contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, rpc: 'https://bsc-dataseed.binance.org/' },
  USDC_MATIC: { contract: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6,  rpc: 'https://polygon-rpc.com/' },
  USDT_TRON:  { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',        decimals: 6,  tron: true },
  USDC_BASE:  { contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6,  rpc: 'https://mainnet.base.org/', base: true },
}
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]

// ── Lector unificado de saldo TRC-20 ──────────────────────────
// Tatum apagó su API v3 el 30/06/2026 (/v3/tron/account ya no responde),
// así que el orden es: 1) Tronscan (público, sin llave) → 2) TronGrid
// (público) → 3) Tatum v3 (por si lo reviven). Devuelve el saldo en
// unidades humanas (ej. 10.5 USDT).
async function tronTokenBalance(address: string, contract: string, decimals: number): Promise<number> {
  const wanted = contract.toLowerCase()
  // 0) Consulta DIRECTA al contrato (balanceOf) vía TronGrid. Es la fuente
  //    más confiable: funciona aunque la cuenta TRON esté "inactivada"
  //    (sin TRX) — caso en el que los endpoints de cuenta devuelven vacío
  //    AUNQUE la dirección tenga USDT.
  try {
    const param = '0'.repeat(24) + tronAddrToEvmHex(address)
    const r = await fetch('https://api.trongrid.io/wallet/triggerconstantcontract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_address: address,
        contract_address: contract,
        function_selector: 'balanceOf(address)',
        parameter: param,
        visible: true,
      }),
    })
    const d = await r.json()
    const hex = d?.constant_result?.[0]
    if (typeof hex === 'string' && hex.length > 0) {
      const bal = Number(BigInt('0x' + hex)) / Math.pow(10, decimals)
      if (isFinite(bal)) {
        console.log(`[tronTokenBalance] balanceOf directo: ${bal} (${address})`)
        return bal
      }
    }
    console.warn('[tronTokenBalance] balanceOf sin resultado:', JSON.stringify(d).slice(0, 200))
  } catch (e) { console.warn('[tronTokenBalance] balanceOf falló:', (e as Error)?.message) }
  try {
    const r = await fetch(`https://apilist.tronscanapi.com/api/account/tokens?address=${address}&start=0&limit=50`)
    const d = await r.json()
    const tok = (d.data ?? []).find((t: any) =>
      String(t.tokenId ?? t.tokenAddr ?? '').toLowerCase() === wanted)
    if (tok) {
      const dec = Number(tok.tokenDecimal ?? decimals)
      const rawB = Number(tok.balance ?? 0)
      const bal = isFinite(rawB) && rawB > 0 ? rawB / Math.pow(10, dec) : Number(tok.quantity ?? 0)
      if (isFinite(bal) && bal > 0) {
        console.log(`[tronTokenBalance] Tronscan: ${bal} (${address})`)
        return bal
      }
    }
  } catch (e) { console.warn('[tronTokenBalance] Tronscan falló:', (e as Error)?.message) }
  try {
    const r = await fetch(`https://api.trongrid.io/v1/accounts/${address}`)
    const g = await r.json()
    const list: Record<string, string>[] = g?.data?.[0]?.trc20 ?? []
    const entry = list.find(t => Object.keys(t).some(k => k.toLowerCase() === wanted))
    if (entry) {
      const bal = parseFloat(Object.values(entry)[0]) / Math.pow(10, decimals)
      console.log(`[tronTokenBalance] TronGrid: ${bal} (${address})`)
      return bal
    }
  } catch (e) { console.warn('[tronTokenBalance] TronGrid falló:', (e as Error)?.message) }
  try {
    if (TATUM_API_KEY) {
      const resp = await fetch(`https://api.tatum.io/v3/tron/account/${address}`, { headers: { 'x-api-key': TATUM_API_KEY } })
      const d = await resp.json()
      const list: Record<string, string>[] = d.trc20 ?? []
      const entry = list.find(t => Object.keys(t).some(k => k.toLowerCase() === wanted))
      if (entry) return parseFloat(Object.values(entry)[0]) / Math.pow(10, decimals)
    }
  } catch { /* v3 EOL — esperado */ }
  return 0
}

// ═══ ENVÍOS TRON SIN TATUM (v12) ═══════════════════════════
// Tatum apagó /v3/tron/*/transaction el 30/06/2026. Ahora la transacción
// se CONSTRUYE con la API pública de TronGrid, se FIRMA localmente con la
// llave privada (ethers SigningKey — nunca sale del servidor) y se
// TRANSMITE con broadcasttransaction. Mismo esquema que usan las wallets.
const TRONGRID = 'https://api.trongrid.io'
async function tronCall(path: string, body: Record<string, unknown>) {
  const key = (Deno.env.get('TRONGRID_API_KEY') ?? '').trim()
  const r = await fetch(`${TRONGRID}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) },
    body: JSON.stringify(body),
  })
  return await r.json()
}
function tronSign(txID: string, pkHex: string): string {
  const sk = new ethers.SigningKey(pkHex.startsWith('0x') ? pkHex : '0x' + pkHex)
  const sig = sk.sign('0x' + txID)
  return sig.r.slice(2) + sig.s.slice(2) + (sig.v === 27 ? '1b' : '1c')
}
async function tronBroadcast(tx: any, pk: string): Promise<string> {
  const signature = tronSign(tx.txID, pk)
  const res = await tronCall('/wallet/broadcasttransaction', { ...tx, signature: [signature] })
  if (res?.result !== true) {
    let msg = JSON.stringify(res).slice(0, 200)
    if (typeof res?.message === 'string') { try { msg = atob(res.message) } catch { msg = res.message } }
    throw new Error(`TRON rechazó la transacción (${res?.code ?? '¿?'}): ${msg}`)
  }
  return res.txid ?? tx.txID
}
async function tronSendTrc20(pk: string, fromB58: string, toB58: string, contract: string, amountHuman: number, decimals: number): Promise<string> {
  const rawAmount = BigInt(Math.round(amountHuman * Math.pow(10, decimals)))
  const param = '0'.repeat(24) + tronAddrToEvmHex(toB58) + rawAmount.toString(16).padStart(64, '0')
  const built = await tronCall('/wallet/triggersmartcontract', {
    owner_address: fromB58,
    contract_address: contract,
    function_selector: 'transfer(address,uint256)',
    parameter: param,
    fee_limit: 100_000_000, // hasta 100 TRX de energía
    call_value: 0,
    visible: true,
  })
  if (!built?.transaction?.txID) throw new Error(`TRON no pudo construir la transacción: ${JSON.stringify(built?.result ?? built).slice(0, 200)}`)
  const txId = await tronBroadcast(built.transaction, pk)
  console.log(`[tronSendTrc20] ${amountHuman} enviados ${fromB58} → ${toB58} tx=${txId}`)
  return txId
}
async function tronSendTrx(pk: string, fromB58: string, toB58: string, amountSun: number): Promise<string> {
  const built = await tronCall('/wallet/createtransaction', {
    owner_address: fromB58, to_address: toB58, amount: Math.round(amountSun), visible: true,
  })
  if (!built?.txID) throw new Error(`TRON no pudo construir el envío de TRX: ${JSON.stringify(built?.Error ?? built).slice(0, 200)}`)
  return await tronBroadcast(built, pk)
}
async function tronTrxBalanceSun(addrB58: string): Promise<number> {
  try {
    const d = await tronCall('/wallet/getaccount', { address: addrB58, visible: true })
    return Number(d?.balance ?? 0)
  } catch { return 0 }
}
// Las direcciones de depósito de clientes no tienen TRX para la comisión
// de red: la hot wallet les patrocina lo mínimo antes de barrer.
const TRX_GAS_SUN = 30_000_000 // 30 TRX
async function ensureTronGas(userAddrB58: string) {
  const bal = await tronTrxBalanceSun(userAddrB58)
  if (bal >= TRX_GAS_SUN) return
  if (!TRON_HOT_KEY) throw new Error(`La dirección ${userAddrB58} no tiene TRX para la comisión de red y no hay LINCOIN_TRON_HOT_KEY para patrocinarla`)
  const hotEvm = new ethers.Wallet(TRON_HOT_KEY.startsWith('0x') ? TRON_HOT_KEY : '0x' + TRON_HOT_KEY)
  const hotB58 = await ethAddressToTron(hotEvm.address)
  console.log(`[ensureTronGas] patrocinando ${(TRX_GAS_SUN - bal) / 1e6} TRX a ${userAddrB58}`)
  await tronSendTrx(TRON_HOT_KEY.replace(/^0x/, ''), hotB58, userAddrB58, TRX_GAS_SUN - bal)
  await new Promise(r => setTimeout(r, 5000)) // confirmación del bloque
}

async function checkUserOnchainBalance(userId: string, walletKey: string, customRpc?: string, customContract?: string) {
  const cfg = TOKEN_CFG[walletKey] ?? (customRpc && customContract ? { contract: customContract, decimals: 6, rpc: customRpc } : null)
  if (!cfg) throw new Error(`Token no soportado: ${walletKey}. Proporciona customRpc y customContract para redes no listadas.`)
  const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')

  // ⚠️ SIEMPRE consultar la dirección GUARDADA del cliente — la misma que
  // le muestra la app y a la que él deposita (raw_data.tatumAddresses).
  // Antes se re-derivaba desde el mnemonic con otra ruta y salía OTRA
  // dirección (vacía) → "me muestra otra wallet que no es".
  const storedAddr: string | undefined = (u.raw_data?.tatumAddresses ?? {})[walletKey]
  if (!storedAddr) throw new Error('Este usuario aún no tiene dirección generada para esta red (usa "Generar wallet")')

  if ((cfg as any).tron) {
    const balance = await tronTokenBalance(storedAddr, cfg.contract, cfg.decimals)
    return { address: storedAddr, balance, token: walletKey, user_email: u.email }
  } else {
    const rpc = customRpc || cfg.rpc!
    const provider = new ethers.JsonRpcProvider(rpc)
    const contract = new ethers.Contract(customContract || cfg.contract, ERC20_ABI, provider)
    const rawBal = await contract.balanceOf(storedAddr)
    const balance = parseFloat(ethers.formatUnits(rawBal, cfg.decimals))
    return { address: storedAddr, balance, token: walletKey, user_email: u.email, network: customRpc ? 'custom' : walletKey }
  }
}

// Reproduce la dirección TRON guardada del usuario probando las rutas de
// derivación conocidas y devuelve la llave privada que la controla. Si el
// mnemonic no la reproduce, error claro (nunca operar sobre otra wallet).
async function tronKeyForStoredAddress(index: number, storedAddr: string): Promise<{ pk: string; address: string }> {
  if (!TRON_MNEMONIC) throw new Error('Configura TATUM_TRON_MNEMONIC en Supabase Secrets')
  const paths = ["m/44'/195'/0'/0", "m/44'/60'/0'/0", "m/44'/195'/0'", "m/44'/60'/0'"]
  const tried: string[] = []
  for (const p of paths) {
    let root: any
    try { root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(TRON_MNEMONIC), p) } catch { continue }
    const children: any[] = []
    try { children.push(root.derivePath(`0/${index}`)) } catch { /* ruta no aplica */ }
    try { children.push(root.deriveChild(index)) } catch { /* ruta no aplica */ }
    for (const child of children) {
      const addr = await ethAddressToTron(child.address)
      tried.push(`${p} → ${addr}`)
      if (addr === storedAddr) return { pk: child.privateKey.replace(/^0x/, ''), address: addr }
    }
  }
  throw new Error(`El mnemonic configurado NO controla la dirección guardada ${storedAddr}. Derivaciones probadas: ${tried.join(' | ')}`)
}

async function recoverUserFunds(userId: string, walletKey: string, toAddress: string, customRpc?: string, customContract?: string) {
  const cfg = TOKEN_CFG[walletKey] ?? (customRpc && customContract ? { contract: customContract, decimals: 6, rpc: customRpc } : null)
  if (!cfg) throw new Error(`Token no soportado: ${walletKey}. Proporciona customRpc y customContract para redes no listadas.`)
  const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index: number | undefined = u.raw_data?.tatumHdIndex
  if (typeof index !== 'number') throw new Error('Este usuario no tiene billetera HD asignada')

  // Resolve destination — default to hot wallet if not specified
  if (!toAddress) {
    const hw = await getHotWallets()
    toAddress = cfg.tron ? (hw.tron_hot_address ?? '') : (hw.bsc_hot_address ?? '')
    if (!toAddress) throw new Error('Dirección destino no especificada y hot wallet no configurada')
  }

  let txHash: string
  let amount: number
  let fromAddress: string

  if (cfg.tron) {
    // Operar SIEMPRE sobre la dirección guardada del usuario (la que ve en
    // la app) — la llave se busca hasta reproducir esa dirección exacta.
    const storedAddr: string | undefined = (u.raw_data?.tatumAddresses ?? {})[walletKey]
    if (!storedAddr) throw new Error('Este usuario no tiene dirección guardada para esta red')
    const { pk } = await tronKeyForStoredAddress(index, storedAddr)
    fromAddress = storedAddr
    amount = await tronTokenBalance(fromAddress, cfg.contract, cfg.decimals)
    if (amount <= 0) throw new Error(`Sin balance de ${walletKey} en la wallet del usuario (${fromAddress})`)
    await ensureTronGas(fromAddress)
    txHash = await tronSendTrc20(pk, fromAddress, toAddress, cfg.contract, amount, cfg.decimals)
  } else {
    if (!ETH_MNEMONIC) throw new Error('Configura TATUM_ETH_MNEMONIC en Supabase Secrets')
    const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ETH_MNEMONIC), "m/44'/60'/0'/0")
    const userKey = root.deriveChild(index).privateKey
    const rpc = customRpc || cfg.rpc!
    const provider = new ethers.JsonRpcProvider(rpc)
    const userWallet = new ethers.Wallet(userKey, provider)
    fromAddress = userWallet.address
    const contract = new ethers.Contract(customContract || cfg.contract, ERC20_ABI, userWallet)
    const rawBal = await contract.balanceOf(userWallet.address)
    amount = parseFloat(ethers.formatUnits(rawBal, cfg.decimals))
    if (amount <= 0) throw new Error(`Sin balance de ${walletKey} en la wallet del usuario (${fromAddress})`)
    // Sponsor gas if needed
    const nativeBal = await provider.getBalance(userWallet.address)
    const GAS_MIN = ethers.parseEther('0.0005')
    if (nativeBal < GAS_MIN) {
      const hotKey = cfg.base ? (BASE_HOT_KEY || BSC_HOT_KEY) : BSC_HOT_KEY
      if (hotKey) {
        try {
          const hotWallet = new ethers.Wallet(hotKey, provider)
          const feeData = await provider.getFeeData()
          const gasPrice = feeData.gasPrice ?? ethers.parseUnits('5', 'gwei')
          const gasTx = await hotWallet.sendTransaction({ to: userWallet.address, value: gasPrice * 60000n })
          await gasTx.wait()
        } catch (e: any) { console.warn('[recover] gas sponsoring failed:', e?.message) }
      }
    }
    const tx = await contract.transfer(toAddress, rawBal)
    const receipt = await tx.wait()
    txHash = receipt!.hash
  }

  await db.from('transactions').insert({
    user_id: userId, type: 'admin_hot_withdrawal', amount, currency: walletKey, status: 'Completado',
    raw_data: { toAddress, fromAddress, walletKey, txHash, recovery: true, userEmail: u.email, recoveredAt: new Date().toISOString() },
  })
  // El barrido vació (parte de) la dirección: bajar el contador de lo ya
  // acreditado para que futuros depósitos on-chain se detecten como nuevos.
  await decrementCredited(userId, walletKey, amount)
  return { ok: true, txHash, amount, fromAddress, toAddress }
}

// ── Envío a wallet externa (flujo "Enviar → Wallet" de la app) ──
// Pagado DESDE la hot wallet (recaudadora). Orden seguro: debitar el USD
// del cliente → enviar on-chain → si el envío falla, devolver el débito.
async function userWalletWithdrawal(userId: string, toAddress: string, amount: number, network: string, coin: string) {
  if (!(amount > 0)) throw new Error('Monto inválido')
  if ((coin || 'USDT') !== 'USDT') throw new Error('Por ahora solo se envía USDT — para USDC hay que fondear la hot wallet con USDC')
  const net = (network || 'TRC-20').toUpperCase()

  const { data: u } = await db.from('users').select('balances, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const bals: Record<string, number> = (u.balances as Record<string, number>) ?? {}
  const usd = Number(bals.USD ?? 0)
  if (usd < amount) throw new Error(`Saldo USD insuficiente (disponible ${usd.toFixed(2)})`)

  // 1) Debitar primero
  await db.from('users').update({ balances: { ...bals, USD: parseFloat((usd - amount).toFixed(2)) } }).eq('id', userId)

  try {
    // 2) Enviar on-chain desde la recaudadora
    let txHash: string
    if (net.includes('TRC')) {
      if (!TRON_HOT_KEY) throw new Error('Configura LINCOIN_TRON_HOT_KEY (wallet recaudadora TRON) en Supabase Secrets')
      const pk = TRON_HOT_KEY.replace(/^0x/, '')
      const hotB58 = await ethAddressToTron(new ethers.Wallet('0x' + pk).address)
      const cfg = TOKEN_CFG.USDT_TRON
      const hotBal = await tronTokenBalance(hotB58, cfg.contract, cfg.decimals)
      if (hotBal < amount) throw new Error(`La recaudadora ${hotB58} solo tiene ${hotBal.toFixed(2)} USDT — fondéala para procesar este retiro de ${amount}`)
      txHash = await tronSendTrc20(pk, hotB58, toAddress, cfg.contract, amount, cfg.decimals)
    } else {
      if (!BSC_HOT_KEY) throw new Error('Configura LINCOIN_BSC_HOT_KEY (hot wallet BNB Chain) en Supabase Secrets')
      const cfg = TOKEN_CFG.USDT_BSC
      const provider = new ethers.JsonRpcProvider(cfg.rpc!)
      const hot = new ethers.Wallet(BSC_HOT_KEY, provider)
      const contract = new ethers.Contract(cfg.contract, ERC20_ABI, hot)
      const tx = await contract.transfer(toAddress, ethers.parseUnits(amount.toString(), cfg.decimals))
      const receipt = await tx.wait()
      txHash = receipt!.hash
    }

    // 3) Registrar el movimiento
    await db.from('transactions').insert({
      user_id: userId, type: 'send', amount, currency: 'USD', status: 'Completado',
      raw_data: {
        title: `Envío a wallet ${net}`,
        beneficiary: toAddress, bank: `Wallet USDT ${net}`, account: toAddress,
        txHash, source: 'wallet_withdrawal', sentAt: new Date().toISOString(),
      },
    })
    console.log(`[walletWithdrawal] ${amount} USD → ${toAddress} (${net}) tx=${txHash}`)
    return { ok: true, txHash, amount, toAddress, network: net }
  } catch (e) {
    // Devolver el débito — el cliente no pierde saldo si el envío falló
    try {
      const { data: u2 } = await db.from('users').select('balances').eq('id', userId).single()
      const b2: Record<string, number> = (u2?.balances as Record<string, number>) ?? {}
      await db.from('users').update({ balances: { ...b2, USD: parseFloat(((Number(b2.USD ?? 0)) + amount).toFixed(2)) } }).eq('id', userId)
    } catch { console.error(`[walletWithdrawal] ⚠ NO PUDE DEVOLVER el débito de ${amount} a ${userId} — revisar manualmente`) }
    throw e
  }
}

// ═══ GASFREE: envíos USDT sin TRX (comisión en USDT) ══════════
// Firma TIP-712 (=EIP-712) con la llave de la recaudadora y la manda al
// proveedor GasFree, que pone el gas y cobra la comisión en USDT.
async function gasfreeAuth(method: string, path: string): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000)
  const msg = `${method}${path}${ts}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(GASFREE_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return { 'Timestamp': String(ts), 'Authorization': `ApiKey ${GASFREE_API_KEY}:${b64}` }
}
async function gasfreeGet(apiPath: string): Promise<any> {
  const path = `${GASFREE_CFG.prefix}${apiPath}`
  const headers = await gasfreeAuth('GET', path)
  const r = await fetch(`${GASFREE_CFG.host}${path}`, { headers })
  return await r.json()
}
async function gasfreePost(apiPath: string, body: any): Promise<any> {
  const path = `${GASFREE_CFG.prefix}${apiPath}`
  const headers = { ...(await gasfreeAuth('POST', path)), 'Content-Type': 'application/json' }
  const r = await fetch(`${GASFREE_CFG.host}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return await r.json()
}
// Saldo de un token TRC-20 en la RED de GasFree (mainnet o Nile testnet).
// Consulta balanceOf directo al contrato en el TronGrid de esa red — así
// el saldo de testnet no se busca en mainnet (bug: siempre daba 0).
async function gasfreeTokenBalance(address: string, contract: string, decimals: number): Promise<number> {
  try {
    const param = '0'.repeat(24) + tronAddrToEvmHex(address)
    const r = await fetch(`${GASFREE_CFG.tronHost}/wallet/triggerconstantcontract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address, contract_address: contract, function_selector: 'balanceOf(address)', parameter: param, visible: true }),
    })
    const d = await r.json()
    const hex = d?.constant_result?.[0]
    if (typeof hex === 'string' && hex.length > 0) {
      const bal = Number(BigInt('0x' + hex)) / Math.pow(10, decimals)
      return isFinite(bal) ? bal : 0
    }
  } catch (e) { console.warn('[gasfreeTokenBalance] falló:', (e as Error)?.message) }
  return 0
}

// Config global de GasFree (token USDT + primer proveedor). Cacheado por
// invocación.
async function gasfreeConfig() {
  if (!GASFREE_API_KEY || !GASFREE_API_SECRET) throw new Error('Configura GASFREE_API_KEY y GASFREE_API_SECRET en Supabase Secrets')
  const [tokens, providers] = await Promise.all([
    gasfreeGet('/api/v1/config/token/all'),
    gasfreeGet('/api/v1/config/provider/all'),
  ])
  const token = (tokens?.data?.tokens ?? []).find((t: any) => t.symbol === 'USDT' && t.supported) ?? (tokens?.data?.tokens ?? [])[0]
  const provider = (providers?.data?.providers ?? [])[0]
  if (!token) throw new Error('GasFree no devolvió el token USDT')
  if (!provider) throw new Error('GasFree no devolvió un proveedor')
  return { token, provider }
}
// Info de la cuenta GasFree de un EOA: su dirección GasFree, estado, nonce.
async function gasfreeAccount(eoaB58: string) {
  const acct = await gasfreeGet(`/api/v1/address/${eoaB58}`)
  return {
    gasFreeAddress: acct?.data?.gasFreeAddress ?? null,
    active: acct?.data?.active ?? false,
    nonce: acct?.data?.nonce ?? 0,
    allowSubmit: acct?.data?.allowSubmit ?? true,
    assets: acct?.data?.assets ?? [],
    code: acct?.code, message: acct?.message,
  }
}
// EOA (dirección TRON + llave) de la recaudadora, desde LINCOIN_TRON_HOT_KEY.
async function recaudadoraWallet() {
  if (!TRON_HOT_KEY) throw new Error('Configura LINCOIN_TRON_HOT_KEY (recaudadora) en Supabase Secrets')
  const pkHex = TRON_HOT_KEY.startsWith('0x') ? TRON_HOT_KEY : '0x' + TRON_HOT_KEY
  const eoa = await ethAddressToTron(new ethers.Wallet(pkHex).address)
  return { pkHex, eoa }
}
// EOA (dirección + llave) GasFree de un USUARIO, derivada del mnemonic TRON
// en su índice HD. Determinista y reproducible.
async function gasfreeUserWallet(index: number) {
  if (!TRON_MNEMONIC) throw new Error('Configura TATUM_TRON_MNEMONIC en Supabase Secrets (para derivar las wallets de los usuarios)')
  const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(TRON_MNEMONIC), "m/44'/195'/0'/0")
  const child = root.deriveChild(index)
  const eoa = await ethAddressToTron(child.address)
  return { pkHex: child.privateKey, eoa }
}
// Estado GasFree de la recaudadora (config + cuenta + saldo on-chain).
async function gasfreeStatus() {
  const { token, provider } = await gasfreeConfig()
  const { eoa } = await recaudadoraWallet()
  const acct = await gasfreeAccount(eoa)
  const balance = acct.gasFreeAddress ? await gasfreeTokenBalance(acct.gasFreeAddress, token.tokenAddress, Number(token.decimal ?? 6)) : 0
  return { net: GASFREE_NET, eoa, ...acct, balance, token, provider }
}
// ── NÚCLEO de envío GasFree: firma con `signerPkHex` (dueño del EOA
// `fromEoaB58`) y transmite al proveedor. Vale para recaudadora y usuarios.
async function gasfreeSendCore(signerPkHex: string, fromEoaB58: string, toB58: string, amountHuman: number) {
  const { token, provider } = await gasfreeConfig()
  const acct = await gasfreeAccount(fromEoaB58)
  if (!acct.allowSubmit) throw new Error('Hay una transferencia GasFree pendiente en esta wallet — espera a que confirme')
  const dec = Number(token.decimal ?? 6)
  const value = BigInt(Math.round(amountHuman * Math.pow(10, dec)))
  const transferFee = BigInt(token.transferFee ?? 0)
  const activateFee = acct.active ? 0n : BigInt(token.activateFee ?? 0)
  const maxFee = transferFee + activateFee
  const deadline = Math.floor(Date.now() / 1000) + Number(provider.config?.defaultDeadlineDuration ?? 180)

  const toHex = (b58: string) => '0x' + tronAddrToEvmHex(b58)
  const domain = { name: 'GasFreeController', version: 'V1.0.0', chainId: GASFREE_CFG.chainId, verifyingContract: toHex(GASFREE_CFG.verifying) }
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
  const submit = await gasfreePost('/api/v1/gasfree/submit', {
    requestId: crypto.randomUUID(),
    token: token.tokenAddress, serviceProvider: provider.address,
    user: fromEoaB58, receiver: toB58,
    value: Number(value), maxFee: Number(maxFee),
    deadline, version: 1, nonce: acct.nonce, sig,
  })
  if (submit?.code !== 200) {
    throw new Error(`GasFree rechazó (${submit?.reason ?? submit?.code}): ${submit?.message ?? JSON.stringify(submit).slice(0, 200)}`)
  }
  return { ok: true, traceId: submit.data?.id, state: submit.data?.state, gasFreeAddress: acct.gasFreeAddress, maxFee: Number(maxFee) }
}
// Envío desde la recaudadora.
async function gasfreeSend(toB58: string, amountHuman: number) {
  const { pkHex, eoa } = await recaudadoraWallet()
  return await gasfreeSendCore(pkHex, eoa, toB58, amountHuman)
}
// Obtiene/crea la wallet GasFree de un usuario y guarda su dirección.
async function gasfreeUserAddress(userId: string) {
  const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await getUserIndex(userId)
  const { eoa } = await gasfreeUserWallet(index)
  const { token } = await gasfreeConfig()
  const acct = await gasfreeAccount(eoa)
  const balance = acct.gasFreeAddress ? await gasfreeTokenBalance(acct.gasFreeAddress, token.tokenAddress, Number(token.decimal ?? 6)) : 0
  // Guardar la dirección GasFree (la cajita de depósito del usuario)
  const raw = (u.raw_data ?? {}) as Record<string, any>
  if (acct.gasFreeAddress && raw.gasfreeAddress !== acct.gasFreeAddress) {
    await db.from('users').update({ raw_data: { ...raw, gasfreeEoa: eoa, gasfreeAddress: acct.gasFreeAddress } }).eq('id', userId)
  }
  // Diagnóstico: red, host, contrato USDT que rastrea GasFree, y saldo en
  // ambas direcciones. Sirve para ver por qué un depósito no aparece.
  const eoaBalance = await gasfreeTokenBalance(eoa, token.tokenAddress, Number(token.decimal ?? 6))
  return {
    userId, email: u.email, index, eoa,
    gasFreeAddress: acct.gasFreeAddress, active: acct.active, nonce: acct.nonce, balance,
    debug: { net: GASFREE_NET, tronHost: GASFREE_CFG.tronHost, usdtContract: token.tokenAddress, symbol: token.symbol, gasFreeBalance: balance, eoaBalance },
  }
}
// Barre el USDT de la wallet GasFree de un usuario a la recaudadora.
async function gasfreeSweepUser(userId: string) {
  const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
  if (!u) throw new Error('Usuario no encontrado')
  const index = await getUserIndex(userId)
  const { pkHex, eoa } = await gasfreeUserWallet(index)
  const { token } = await gasfreeConfig()
  const acct = await gasfreeAccount(eoa)
  if (!acct.gasFreeAddress) throw new Error('El usuario aún no tiene dirección GasFree')
  const dec = Number(token.decimal ?? 6)
  const bal = await gasfreeTokenBalance(acct.gasFreeAddress, token.tokenAddress, dec)
  const fee = (Number(token.transferFee ?? 0) + (acct.active ? 0 : Number(token.activateFee ?? 0))) / Math.pow(10, dec)
  const sendable = parseFloat((bal - fee).toFixed(dec))
  if (sendable <= 0) throw new Error(`Saldo GasFree insuficiente para barrer (${bal} USDT, comisión ${fee})`)
  const { eoa: recEoa } = await recaudadoraWallet()
  const recAcct = await gasfreeAccount(recEoa)
  const dest = recAcct.gasFreeAddress ?? recEoa
  const r = await gasfreeSendCore(pkHex, eoa, dest, sendable)
  await db.from('transactions').insert({
    user_id: userId, type: 'admin_hot_withdrawal', amount: sendable, currency: 'USDT_TRON', status: 'Completado',
    raw_data: { fromAddress: acct.gasFreeAddress, toAddress: dest, traceId: r.traceId, sweep: true, gasfree: true, sweptAt: new Date().toISOString() },
  })
  return { ok: true, email: u.email, swept: sendable, ...r }
}

// ── BARRIDO MASIVO a la recaudadora ────────────────────────
// Recorre TODAS las direcciones de depósito de clientes con saldo USDT
// TRON y lo mueve a la recaudadora (hot wallet). Se usa manual (botón
// admin) y automático (cron cada N min). Idempotente y con umbral para
// no gastar gas en polvo.
const SWEEP_MIN_USDT = 1 // no barrer saldos menores a 1 USDT (no vale el gas)
async function sweepAllToRecaudadora(): Promise<{ swept: any[]; skipped: number; recaudadora: string }> {
  if (!TRON_HOT_KEY) throw new Error('Configura LINCOIN_TRON_HOT_KEY (recaudadora) en Supabase Secrets')
  const hotEvm = new ethers.Wallet(TRON_HOT_KEY.startsWith('0x') ? TRON_HOT_KEY : '0x' + TRON_HOT_KEY)
  const hotB58 = await ethAddressToTron(hotEvm.address)
  const cfg = TOKEN_CFG.USDT_TRON

  // Solo cuentas de EMPRESA con dirección TRON generada
  const { data: users } = await db.from('users')
    .select('id, email, role, raw_data')
    .not('raw_data->tatumAddresses->>USDT_TRON', 'is', null)
    .limit(1000)

  const swept: any[] = []
  let skipped = 0
  for (const u of (users as any[]) ?? []) {
    if (u.role === 'personal' || u.role === 'admin') { skipped++; continue }
    const addr: string | undefined = u.raw_data?.tatumAddresses?.USDT_TRON
    const index: number | undefined = u.raw_data?.tatumHdIndex
    if (!addr || typeof index !== 'number' || addr === hotB58) { skipped++; continue }
    try {
      const bal = await tronTokenBalance(addr, cfg.contract, cfg.decimals)
      if (bal < SWEEP_MIN_USDT) { skipped++; continue }
      const { pk } = await tronKeyForStoredAddress(index, addr)
      await ensureTronGas(addr)
      const txHash = await tronSendTrc20(pk, addr, hotB58, cfg.contract, bal, cfg.decimals)
      await decrementCredited(u.id, 'USDT_TRON', bal)
      await db.from('transactions').insert({
        user_id: u.id, type: 'admin_hot_withdrawal', amount: bal, currency: 'USDT_TRON', status: 'Completado',
        raw_data: { fromAddress: addr, toAddress: hotB58, txHash, sweep: true, sweptAt: new Date().toISOString(), source: 'sweep_all' },
      })
      swept.push({ email: u.email, amount: bal, txHash })
      console.log(`[sweepAll] ${bal} USDT ${addr} → recaudadora tx=${txHash}`)
    } catch (e) {
      console.warn(`[sweepAll] falló ${u.email}:`, (e as Error)?.message)
      swept.push({ email: u.email, error: (e as Error)?.message })
    }
  }
  return { swept, skipped, recaudadora: hotB58 }
}

// Resta `amount` del contador acumulado de acreditaciones de una wallet
// (se usa tras barrer fondos fuera de la dirección del usuario).
async function decrementCredited(userId: string, walletKey: string, amount: number) {
  try {
    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
    const raw = (u?.raw_data ?? {}) as Record<string, any>
    const map: Record<string, number> = raw.tatumCredited ?? {}
    if (typeof map[walletKey] !== 'number') return
    const next = Math.max(0, parseFloat((map[walletKey] - amount).toFixed(8)))
    await db.from('users').update({ raw_data: { ...raw, tatumCredited: { ...map, [walletKey]: next } } }).eq('id', userId)
  } catch (e) { console.warn('[decrementCredited] falló:', (e as Error)?.message) }
}

async function sendWithdrawal(userId: string, walletKey: string, amount: number, toAddress: string) {
  const cfg = TOKEN_CFG[walletKey]
  if (!cfg) throw new Error(`Red no soportada: ${walletKey}`)

  const fee = WITHDRAWAL_FEES[walletKey] ?? 0
  const netAmount = parseFloat((amount - fee).toFixed(8))
  if (netAmount <= 0) throw new Error(`Monto ${amount} es menor o igual a la comisión (${fee})`)

  // Get user's HD index AND stored deposit address
  const { data: userData } = await db.from('users').select('raw_data').eq('id', userId).single()
  const index: number | undefined = userData?.raw_data?.tatumHdIndex
  if (typeof index !== 'number') throw new Error('Billetera HD no encontrada — el usuario debe generar su dirección primero')
  // The deposit address stored when getOrCreate ran (derived from XPUB)
  const storedDepositAddr: string | undefined = userData?.raw_data?.tatumAddresses?.[walletKey]

  let txHash: string

  if (cfg.tron) {
    // Enviar desde la dirección GUARDADA del usuario (la llave se busca
    // hasta reproducirla — nunca operar sobre otra wallet)
    if (!storedDepositAddr) throw new Error('Usuario sin dirección TRON guardada')
    const { pk } = await tronKeyForStoredAddress(index, storedDepositAddr)
    await ensureTronGas(storedDepositAddr)
    txHash = await tronSendTrc20(pk, storedDepositAddr, toAddress, cfg.contract, netAmount, cfg.decimals)
  } else {
    // Send from user's BSC/MATIC address derived from mnemonic
    if (!ETH_MNEMONIC) throw new Error('Configura TATUM_ETH_MNEMONIC en Supabase Secrets')
    const provider = new ethers.JsonRpcProvider(cfg.rpc!)
    const hotKey   = cfg.base ? (BASE_HOT_KEY || BSC_HOT_KEY) : BSC_HOT_KEY
    const mnemObj  = ethers.Mnemonic.fromPhrase(ETH_MNEMONIC)

    // Try multiple derivation paths to find the one whose address matches the
    // stored deposit address (generated by getOrCreate via xpub).
    // getOrCreate uses xpub.derivePath('0/index') which may be one level deeper
    // than the naive "m/44'/60'/0'/0" + deriveChild(index) used previously.
    const candidatePaths = [
      "m/44'/60'/0'/0",    // standard: root at 0'/0, child = index
      "m/44'/60'/0'",      // Tatum xpub depth: root at 0', child = 0/index via derivePath
      "m/44'/60'/0'/0/0",  // xpub already at 0'/0/0, child = index
    ]
    let signingChild: ethers.HDNodeWallet | null = null
    for (const basePath of candidatePaths) {
      try {
        const baseWallet = ethers.HDNodeWallet.fromMnemonic(mnemObj, basePath)
        // Match what deriveAddressLocal does: try derivePath('0/index') first, then deriveChild(index)
        for (const childMethod of ['path', 'child'] as const) {
          try {
            const child = childMethod === 'path'
              ? baseWallet.derivePath(`0/${index}`)
              : baseWallet.deriveChild(index)
            const addrMatch = storedDepositAddr
              ? child.address.toLowerCase() === storedDepositAddr.toLowerCase()
              : true // no stored addr — just use whatever derives
            console.log(`[sendWithdrawal] try ${basePath}/${childMethod}/${index} → ${child.address} | match: ${addrMatch}`)
            if (addrMatch) { signingChild = child; break }
          } catch {}
        }
        if (signingChild) break
      } catch {}
    }

    // Fall back to first candidate if nothing matched (no stored addr or all paths failed)
    if (!signingChild) {
      signingChild = ethers.HDNodeWallet.fromMnemonic(mnemObj, "m/44'/60'/0'/0").deriveChild(index)
      console.warn(`[sendWithdrawal] no path matched deposit addr ${storedDepositAddr} — using default`)
    }

    const signingAddr   = signingChild.address
    const probeContract = new ethers.Contract(cfg.contract, ERC20_ABI, provider)
    const rawBal        = await probeContract.balanceOf(signingAddr)
    const signingBal    = parseFloat(ethers.formatUnits(rawBal, cfg.decimals))
    console.log(`[sendWithdrawal] signing addr: ${signingAddr} | balance: ${signingBal} ${walletKey} | needed: ${netAmount}`)

    let tx: any
    if (signingBal >= netAmount) {
      // Signing address has funds — sponsor gas if needed, then send
      const nativeBal = await provider.getBalance(signingAddr)
      const GAS_MIN   = ethers.parseEther('0.0005')
      if (nativeBal < GAS_MIN && hotKey) {
        try {
          const hotWallet = new ethers.Wallet(hotKey, provider)
          const feeData   = await provider.getFeeData()
          const gasPrice  = feeData.gasPrice ?? ethers.parseUnits('5', 'gwei')
          const gasTx     = await hotWallet.sendTransaction({ to: signingAddr, value: gasPrice * 65000n })
          await gasTx.wait()
          console.log(`[sendWithdrawal] sponsored gas → ${signingAddr}`)
        } catch (e) {
          console.warn('[sendWithdrawal] gas sponsor failed (continuing):', (e as Error).message)
        }
      }
      const userWallet = new ethers.Wallet(signingChild.privateKey, provider)
      const contract   = new ethers.Contract(cfg.contract, ERC20_ABI, userWallet)
      tx = await contract.transfer(toAddress, ethers.parseUnits(netAmount.toString(), cfg.decimals))
    } else {
      // No mnemonic path has the USDT — fall back to treasury hot wallet
      if (!hotKey) throw new Error('Fondos insuficientes y no hay billetera treasury configurada (LINCOIN_BSC_HOT_KEY)')
      const hotWallet   = new ethers.Wallet(hotKey, provider)
      const hotContract = new ethers.Contract(cfg.contract, ERC20_ABI, hotWallet)
      const rawHotBal   = await hotContract.balanceOf(hotWallet.address)
      const hotBal      = parseFloat(ethers.formatUnits(rawHotBal, cfg.decimals))
      console.log(`[sendWithdrawal] treasury balance: ${hotBal} ${walletKey}`)
      if (hotBal < netAmount) throw new Error(`Fondos insuficientes en treasury (${hotBal.toFixed(2)} USDT). Recarga LINCOIN_BSC_HOT_KEY.`)
      tx = await hotContract.transfer(toAddress, ethers.parseUnits(netAmount.toString(), cfg.decimals))
    }

    const receipt = await tx.wait()
    txHash = receipt?.hash ?? tx.hash
  }

  // Deduct from user's network-specific balance key (USDT_BSC, not generic USDT)
  const { data: user } = await db.from('users').select('crypto_balances').eq('id', userId).single()
  const bals    = (user?.crypto_balances as Record<string, number>) ?? {}
  const prevBal = bals[walletKey] ?? bals[WALLET_TO_CURRENCY[walletKey] ?? walletKey] ?? 0
  await db.from('users').update({
    crypto_balances: { ...bals, [walletKey]: Math.max(0, parseFloat((prevBal - amount).toFixed(8))) },
  }).eq('id', userId)

  const { data: insertedTx } = await db.from('transactions').insert({
    user_id: userId, type: 'otc_withdraw', amount, currency: walletKey, status: 'Completado',
    raw_data: { toAddress, walletKey, txHash, netAmount, fee, sentAt: new Date().toISOString() },
  }).select('*').single()

  // Fire email notification (non-blocking)
  if (insertedTx) {
    const NOTIFY_URL = `${SUPABASE_URL}/functions/v1/notify-transaction`
    fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ type: 'INSERT', table: 'transactions', record: insertedTx }),
    }).catch(e => console.warn('[sendWithdrawal] notify call failed (non-fatal):', e?.message))
  }

  console.log(`[sendWithdrawal] ${netAmount} ${walletKey} → ${toAddress} | fee ${fee} | tx ${txHash}`)
  return { ok: true, txHash, netAmount, fee }
}

async function requestWithdrawal(userId: string, walletKey: string, amount: number, toAddress: string) {
  const { error } = await db.from('transactions').insert({
    user_id: userId, type: 'otc_withdraw_request', amount, currency: walletKey, status: 'pending',
    raw_data: { toAddress, walletKey, requestedAt: new Date().toISOString() },
  })
  if (error) throw new Error(error.message)
  return { ok: true }
}

async function requestConvert(userId: string, walletKey: string, amount: number, targetCurrency: string, rate: number) {
  const currency = WALLET_TO_CURRENCY[walletKey] ?? walletKey
  const { data: user } = await db.from('users').select('crypto_balances, balances').eq('id', userId).single()
  const cryptoBals = (user?.crypto_balances as Record<string, number>) ?? {}
  // Balance may be stored under walletKey ('USDT_BSC') or currency ('USDT') — try both
  const balKey = (cryptoBals[walletKey] != null) ? walletKey : currency
  const available = cryptoBals[balKey] ?? 0
  if (available < amount) throw new Error('Saldo insuficiente')

  const targetAmount = parseFloat((amount * rate).toFixed(2))
  const fiatBals = (user?.balances as Record<string, number>) ?? {}

  await db.from('users').update({
    crypto_balances: { ...cryptoBals, [balKey]: parseFloat(Math.max(0, available - amount).toFixed(8)) },
    balances: { ...fiatBals, [targetCurrency]: parseFloat(((fiatBals[targetCurrency] ?? 0) + targetAmount).toFixed(2)) },
  }).eq('id', userId)

  const { data: txRow } = await db.from('transactions').insert({
    user_id: userId, type: 'otc_convert', amount, currency: walletKey, status: 'Completado',
    raw_data: { targetCurrency, rate, targetAmount, processedAt: new Date().toISOString(), sweepPending: true },
  }).select('id').single()

  const txId: number | undefined = (txRow as any)?.id

  // Sweep USDT/USDC from user HD wallet → admin hot wallet (fire-and-forget, records result in tx)
  sweepConvertToHotWallet(userId, walletKey, amount, txId).catch(async (e) => {
    console.warn('[requestConvert] sweep failed:', e?.message)
    if (txId) {
      const { data: cur } = await db.from('transactions').select('raw_data').eq('id', txId).single()
      await db.from('transactions').update({
        raw_data: { ...(cur?.raw_data ?? {}), sweepPending: true, sweepError: e?.message ?? String(e) },
      }).eq('id', txId)
    }
  })

  return { ok: true, targetAmount }
}

async function sweepConvertToHotWallet(userId: string, walletKey: string, amount: number, txId?: number): Promise<string> {
  const cfg = TOKEN_CFG[walletKey]
  if (!cfg) throw new Error(`Token no soportado: ${walletKey}`)

  const { data: userData } = await db.from('users').select('raw_data').eq('id', userId).single()
  const index: number | undefined = userData?.raw_data?.tatumHdIndex
  if (typeof index !== 'number') throw new Error('Usuario sin tatumHdIndex — wallet HD no generada')

  let txHash: string

  if (cfg.tron) {
    if (!TRON_MNEMONIC) throw new Error('TATUM_TRON_MNEMONIC no configurado en Supabase Secrets')
    if (!TATUM_API_KEY) throw new Error('TATUM_API_KEY no configurado')
    if (!TRON_HOT_KEY) throw new Error('LINCOIN_TRON_HOT_KEY no configurado en Supabase Secrets')
    const hotEvm = new ethers.Wallet(TRON_HOT_KEY.startsWith('0x') ? TRON_HOT_KEY : '0x' + TRON_HOT_KEY)
    const hotAddr = await ethAddressToTron(hotEvm.address)
    const sweepStoredAddr: string | undefined = (userData?.raw_data?.tatumAddresses ?? {})[walletKey]
    if (!sweepStoredAddr) throw new Error('Usuario sin dirección TRON guardada')
    const { pk } = await tronKeyForStoredAddress(index, sweepStoredAddr)
    await ensureTronGas(sweepStoredAddr)
    txHash = await tronSendTrc20(pk, sweepStoredAddr, hotAddr, cfg.contract, amount, cfg.decimals)
    console.log('[sweep] TRON sweep txId:', txHash)
  } else {
    // BSC / BASE
    if (!ETH_MNEMONIC) throw new Error('TATUM_ETH_MNEMONIC no configurado en Supabase Secrets')
    const hotKeyRaw = cfg.base ? (BASE_HOT_KEY || BSC_HOT_KEY) : BSC_HOT_KEY
    if (!hotKeyRaw) throw new Error('LINCOIN_BSC_HOT_KEY no configurado en Supabase Secrets')
    const provider = new ethers.JsonRpcProvider(cfg.rpc!)
    const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ETH_MNEMONIC), "m/44'/60'/0'/0")
    const userWallet = new ethers.Wallet(root.deriveChild(index).privateKey, provider)
    const hotWallet = new ethers.Wallet(hotKeyRaw, provider)

    // Sponsor gas from hot wallet if needed
    const bnbBal = await provider.getBalance(userWallet.address)
    const GAS_MIN = ethers.parseEther('0.0005')
    if (bnbBal < GAS_MIN) {
      const feeData = await provider.getFeeData()
      const gasPrice = feeData.gasPrice ?? ethers.parseUnits('5', 'gwei')
      const gasTx = await hotWallet.sendTransaction({ to: userWallet.address, value: gasPrice * 60000n })
      await gasTx.wait()
    }

    const contract = new ethers.Contract(cfg.contract, ERC20_ABI, userWallet)
    const tx = await contract.transfer(hotWallet.address, ethers.parseUnits(amount.toString(), cfg.decimals))
    const receipt = await tx.wait()
    txHash = receipt.hash
    console.log('[sweep] BSC/BASE sweep txHash:', txHash)
  }

  // Record sweep success in the transaction
  if (txId) {
    const { data: cur } = await db.from('transactions').select('raw_data').eq('id', txId).single()
    await db.from('transactions').update({
      raw_data: { ...(cur?.raw_data ?? {}), sweepPending: false, sweepTxHash: txHash, sweptAt: new Date().toISOString() },
    }).eq('id', txId)
  }

  // La dirección quedó con menos fondos: ajustar el contador de acreditado
  await decrementCredited(userId, walletKey, amount)

  return txHash
}

async function getHotWallets() {
  const result: Record<string, string> = {}
  if (BSC_HOT_KEY) {
    const w = new ethers.Wallet(BSC_HOT_KEY)
    result.bsc_hot_address  = w.address
    result.base_hot_address = w.address  // Base uses the same EVM key
  } else if (ETH_MNEMONIC) {
    const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ETH_MNEMONIC), "m/44'/60'/0'/0")
    result.bsc_hot_address  = root.deriveChild(0).address
    result.base_hot_address = root.deriveChild(0).address
    result.polygon_hot_address = root.deriveChild(0).address
    result.note_bsc = 'Usando índice 0 del mnemonic ETH. Envía USDT/USDC y BNB (gas) a esta dirección.'
  } else {
    result.bsc_error = 'LINCOIN_BSC_HOT_KEY o TATUM_ETH_MNEMONIC no configurados'
  }
  if (TRON_HOT_KEY) {
    const tronWallet = new ethers.Wallet(TRON_HOT_KEY.startsWith('0x') ? TRON_HOT_KEY : '0x' + TRON_HOT_KEY)
    result.tron_hot_address = await ethAddressToTron(tronWallet.address)
  } else if (TRON_MNEMONIC) {
    const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(TRON_MNEMONIC), "m/44'/60'/0'/0")
    const child = root.deriveChild(0)
    result.tron_hot_address = await ethAddressToTron(child.address)
    result.note_tron = 'Usando índice 0 del mnemonic TRON. Envía USDT TRC-20 y TRX (gas) a esta dirección.'
  } else {
    result.tron_error = 'LINCOIN_TRON_HOT_KEY o TATUM_TRON_MNEMONIC no configurados'
  }
  return result
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))])
}

async function getAdminWallets() {
  const addresses = await getHotWallets()
  const TIMEOUT = 8000 // 8s per network

  const bscAddress  = addresses.bsc_hot_address
  const tronAddress = addresses.tron_hot_address
  const baseAddress = addresses.base_hot_address

  const [bscResult, tronResult, baseResult] = await Promise.allSettled([
    // BSC balances
    bscAddress ? withTimeout((async () => {
      const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/')
      const [bnbRaw, usdtRaw, usdcRaw] = await Promise.all([
        provider.getBalance(bscAddress),
        new ethers.Contract(TOKEN_CFG.USDT_BSC.contract, ERC20_ABI, provider).balanceOf(bscAddress),
        new ethers.Contract(TOKEN_CFG.USDC_BSC.contract, ERC20_ABI, provider).balanceOf(bscAddress),
      ])
      return {
        bnb:  parseFloat(ethers.formatEther(bnbRaw)).toFixed(6),
        usdt: parseFloat(ethers.formatUnits(usdtRaw, 18)).toFixed(4),
        usdc: parseFloat(ethers.formatUnits(usdcRaw, 18)).toFixed(4),
      }
    })(), TIMEOUT, { bnb: '—', usdt: '—', usdc: '—' }) : Promise.resolve({ bnb: '—', usdt: '—', usdc: '—' }),

    // TRON balances — TronGrid público para TRX + lector unificado para USDT
    // (Tatum v3 murió el 30/06/2026)
    tronAddress ? withTimeout((async () => {
      let trx = '0.000000'
      try {
        const resp = await fetch(`https://api.trongrid.io/v1/accounts/${tronAddress}`)
        if (resp.ok) {
          const g = await resp.json()
          const acc = g?.data?.[0]
          if (acc) trx = (parseFloat(String(acc.balance ?? '0')) / 1_000_000).toFixed(6)
        }
      } catch { /* TRX queda en 0 */ }
      const usdtNum = await tronTokenBalance(tronAddress, TOKEN_CFG.USDT_TRON.contract, TOKEN_CFG.USDT_TRON.decimals)
      const usdt = usdtNum.toFixed(4)
      return { trx, usdt }
    })(), TIMEOUT, { trx: '—', usdt: '—' }) : Promise.resolve({ trx: '—', usdt: '—' }),

    // Base balances
    baseAddress ? withTimeout((async () => {
      const provider = new ethers.JsonRpcProvider('https://mainnet.base.org/')
      const [ethRaw, usdcRaw] = await Promise.all([
        provider.getBalance(baseAddress),
        new ethers.Contract(TOKEN_CFG.USDC_BASE.contract, ERC20_ABI, provider).balanceOf(baseAddress),
      ])
      return {
        eth:  parseFloat(ethers.formatEther(ethRaw)).toFixed(6),
        usdc: parseFloat(ethers.formatUnits(usdcRaw, TOKEN_CFG.USDC_BASE.decimals)).toFixed(4),
      }
    })(), TIMEOUT, { eth: '—', usdc: '—' }) : Promise.resolve({ eth: '—', usdc: '—' }),
  ])

  const bsc  = bscResult.status  === 'fulfilled' ? bscResult.value  : { bnb: '—', usdt: '—', usdc: '—' }
  const tron = tronResult.status === 'fulfilled' ? tronResult.value : { trx: '—', usdt: '—' }
  const base = baseResult.status === 'fulfilled' ? baseResult.value : { eth: '—', usdc: '—' }

  const [feesBscR, feesTronR, feesBaseR] = await Promise.all([
    db.from('system_config').select('value').eq('key', 'withdrawal_fees_bsc').single(),
    db.from('system_config').select('value').eq('key', 'withdrawal_fees_tron').single(),
    db.from('system_config').select('value').eq('key', 'withdrawal_fees_base').single(),
  ])
  const feesBsc  = feesBscR.data
  const feesTron = feesTronR.data
  const feesBase = feesBaseR.data

  return {
    ...addresses,
    bsc_bnb_balance:         bsc.bnb,
    bsc_usdt_balance:        bsc.usdt,
    bsc_usdc_balance:        bsc.usdc,
    tron_trx_balance:        tron.trx,
    tron_usdt_balance:       tron.usdt,
    base_eth_balance:        base.eth,
    base_usdc_balance:       base.usdc,
    fees_bsc_accumulated:    parseFloat(feesBsc?.value  ?? '0'),
    fees_tron_accumulated:   parseFloat(feesTron?.value ?? '0'),
    fees_base_accumulated:   parseFloat(feesBase?.value ?? '0'),
  }
}

// Admin withdraws from hot wallet directly (no user HD derivation)
async function adminHotWalletWithdrawal(walletKey: string, amount: number, toAddress: string) {
  if (amount <= 0) throw new Error('Monto inválido')
  if (!toAddress) throw new Error('Dirección destino requerida')

  let txHash: string

  if (walletKey === 'USDT_TRON') {
    const cfg = TOKEN_CFG.USDT_TRON
    if (!TRON_HOT_KEY && !TRON_MNEMONIC) throw new Error('Configura LINCOIN_TRON_HOT_KEY o TATUM_TRON_MNEMONIC en Supabase Secrets')
    let pk: string
    if (TRON_HOT_KEY) {
      pk = TRON_HOT_KEY.replace(/^0x/, '')
    } else {
      const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(TRON_MNEMONIC), "m/44'/60'/0'/0")
      pk = root.deriveChild(0).privateKey.replace(/^0x/, '')
    }
    const fromB58 = await ethAddressToTron(new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk).address)
    txHash = await tronSendTrc20(pk, fromB58, toAddress, cfg.contract, amount, cfg.decimals)

  } else if (walletKey === 'TRX') {
    if (!TRON_HOT_KEY && !TRON_MNEMONIC) throw new Error('Configura LINCOIN_TRON_HOT_KEY o TATUM_TRON_MNEMONIC en Supabase Secrets')
    let pk: string
    if (TRON_HOT_KEY) {
      pk = TRON_HOT_KEY.replace(/^0x/, '')
    } else {
      const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(TRON_MNEMONIC), "m/44'/60'/0'/0")
      pk = root.deriveChild(0).privateKey.replace(/^0x/, '')
    }
    const fromB58 = await ethAddressToTron(new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk).address)
    txHash = await tronSendTrx(pk, fromB58, toAddress, Math.round(amount * 1_000_000))

  } else {
    // EVM (BSC, Base, Polygon): native tokens (BNB, ETH_BASE) and ERC-20s
    const hotKey = BASE_HOT_KEY || BSC_HOT_KEY ||
      (ETH_MNEMONIC ? ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ETH_MNEMONIC), "m/44'/60'/0'/0").deriveChild(0).privateKey : null)
    if (!hotKey) throw new Error('Configura LINCOIN_BSC_HOT_KEY o TATUM_ETH_MNEMONIC en Supabase Secrets')
    const cfg = TOKEN_CFG[walletKey]
    const isBase = walletKey === 'ETH_BASE' || (cfg as any)?.base
    const rpc = isBase ? 'https://mainnet.base.org/' : (cfg?.rpc ?? 'https://bsc-dataseed.binance.org/')
    const provider = new ethers.JsonRpcProvider(rpc)
    const hotWallet = new ethers.Wallet(hotKey, provider)

    if (walletKey === 'BNB' || walletKey === 'ETH_BASE') {
      const tx = await hotWallet.sendTransaction({ to: toAddress, value: ethers.parseEther(amount.toString()) })
      const receipt = await tx.wait()
      txHash = receipt!.hash
    } else {
      if (!cfg) throw new Error(`Red no soportada: ${walletKey}`)
      const contract = new ethers.Contract(cfg.contract, ERC20_ABI, hotWallet)
      const tx = await contract.transfer(toAddress, ethers.parseUnits(amount.toString(), cfg.decimals))
      const receipt = await tx.wait()
      txHash = receipt!.hash
    }
  }

  await db.from('transactions').insert({
    user_id: 'admin', type: 'admin_hot_withdrawal', amount, currency: walletKey, status: 'Completado',
    raw_data: { toAddress, walletKey, txHash, sentAt: new Date().toISOString(), source: 'hot_wallet' },
  })

  return { ok: true, txHash, amount, walletKey }
}

async function setupWallets() {
  const ethMnemonic  = ethers.Mnemonic.entropyToPhrase(ethers.randomBytes(16))
  const ethRoot      = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ethMnemonic), "m/44'/60'/0'/0")
  const tronMnemonic = ethers.Mnemonic.entropyToPhrase(ethers.randomBytes(16))
  const tronRoot     = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(tronMnemonic), "m/44'/60'/0'/0")
  const bscHotChild  = ethRoot.deriveChild(0)
  const tronHotChild = tronRoot.deriveChild(0)
  const tronHotTronAddr = await ethAddressToTron(tronHotChild.address)
  return {
    // ── Secrets to add in Supabase → Edge Functions → Secrets ──
    TATUM_ETH_XPUB:      ethRoot.neuter().extendedKey,
    TATUM_ETH_MNEMONIC:  ethMnemonic,
    LINCOIN_BSC_HOT_KEY:  bscHotChild.privateKey,
    bsc_hot_address:     bscHotChild.address,

    // BASE uses the SAME ETH key — same address, different network
    LINCOIN_BASE_HOT_KEY: bscHotChild.privateKey,
    base_hot_address:    bscHotChild.address,

    TATUM_TRON_XPUB:     tronRoot.neuter().extendedKey,
    TATUM_TRON_MNEMONIC: tronMnemonic,
    LINCOIN_TRON_HOT_KEY: tronHotChild.privateKey,
    tron_hot_address:    tronHotTronAddr,
  }
}

// ── Security enforcement ────────────────────────────────────────────────────

async function getSecurityDefaults() {
  const { data } = await db.from('app_config').select('settings').eq('id', 1).single()
  return (data?.settings as any)?.securityDefaults ?? {}
}

async function checkWithdrawalSecurity(userId: string, walletKey: string, amount: number, toAddress: string) {
  const { data: user } = await db.from('users').select('raw_data, role').eq('id', userId).single()
  if (!user) throw new Error('Usuario no encontrado')

  const secCfg   = (user.raw_data as any)?.securityConfig ?? {}
  const defaults = await getSecurityDefaults()

  // 1. Suspension check
  if (secCfg.suspended) {
    throw new Error(`Cuenta suspendida: ${secCfg.suspendReason ?? 'contacte soporte'}`)
  }

  // 2. Per-transaction limit
  const maxPerTx = Number(secCfg.limits?.maxPerTx ?? defaults.defaultMaxPerTx ?? 100000)
  if (amount > maxPerTx) {
    throw new Error(`Monto supera el límite por transacción ($${maxPerTx.toLocaleString()})`)
  }

  // 3. Daily limit (rolling 24h)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentTxs } = await db.from('transactions')
    .select('amount')
    .eq('user_id', userId)
    .in('type', ['otc_withdraw', 'withdraw'])
    .gte('created_at', since)
  const dailyTotal = (recentTxs ?? []).reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0)
  const maxDaily = Number(secCfg.limits?.maxDaily ?? defaults.defaultMaxDaily ?? 500000)
  if (dailyTotal + amount > maxDaily) {
    throw new Error(`Límite diario alcanzado ($${maxDaily.toLocaleString()})`)
  }

  // 4. Large transaction flag (requires manual review)
  const largeThreshold = Number(secCfg.limits?.largeThreshold ?? defaults.largeThreshold ?? 5000)
  if (amount >= largeThreshold) {
    return { requiresApproval: true, reason: `Transacción grande (≥$${largeThreshold.toLocaleString()}) requiere revisión manual` }
  }

  // 5. Whitelist check
  const requireWhitelist = secCfg.requireWhitelist ?? defaults.requireWhitelist ?? false
  if (requireWhitelist) {
    const whitelist: any[] = secCfg.withdrawalWhitelist ?? []
    const approved = whitelist.filter((w: any) => w.status === 'approved')
    const normalizedTo = toAddress.toLowerCase().trim()
    const matched = approved.some((w: any) => {
      const wAddr = (w.address ?? '').toLowerCase().trim()
      return wAddr === normalizedTo
    })
    if (!matched) {
      throw new Error('Dirección de destino no está en la lista blanca aprobada')
    }
    // Cooldown: address must have been approved for ≥ cooldownHours
    const cooldownHours = Number(secCfg.cooldownHours ?? defaults.cooldownHours ?? 24)
    const entry = approved.find((w: any) => (w.address ?? '').toLowerCase().trim() === normalizedTo)
    if (entry?.approvedAt) {
      const approvedMs = new Date(entry.approvedAt).getTime()
      const cooldownMs = cooldownHours * 60 * 60 * 1000
      if (Date.now() - approvedMs < cooldownMs) {
        const remainH = Math.ceil((cooldownMs - (Date.now() - approvedMs)) / 3600000)
        throw new Error(`Dirección en período de enfriamiento. Espere ${remainH}h más`)
      }
    }
  }

  return { requiresApproval: false }
}

async function addWhitelistAddress(userId: string, address: string, label: string, network: string) {
  const { data: user } = await db.from('users').select('raw_data').eq('id', userId).single()
  const raw = (user?.raw_data as any) ?? {}
  const secCfg = raw.securityConfig ?? {}
  const list: any[] = secCfg.withdrawalWhitelist ?? []
  if (list.some((w: any) => w.address?.toLowerCase() === address.toLowerCase())) {
    throw new Error('Dirección ya existe en la lista')
  }
  const entry = { id: crypto.randomUUID(), address, label, network, status: 'pending_approval', addedAt: new Date().toISOString() }
  list.push(entry)
  const newRaw = { ...raw, securityConfig: { ...secCfg, withdrawalWhitelist: list } }
  await db.from('users').update({ raw_data: newRaw }).eq('id', userId)
  return { success: true, entry, list }
}

async function adminApproveWhitelist(userId: string, address: string, approve: boolean) {
  const { data: user } = await db.from('users').select('raw_data').eq('id', userId).single()
  const raw = (user?.raw_data as any) ?? {}
  const secCfg = raw.securityConfig ?? {}
  const list: any[] = secCfg.withdrawalWhitelist ?? []
  // Support lookup by id (admin UI) or address (legacy)
  const idx = list.findIndex((w: any) => w.id === address || w.address?.toLowerCase() === address.toLowerCase())
  if (idx === -1) throw new Error('Dirección no encontrada')
  let entry: any
  if (approve) {
    entry = { ...list[idx], status: 'approved', approvedAt: new Date().toISOString() }
    list[idx] = entry
  } else {
    entry = list[idx]
    list.splice(idx, 1)
  }
  const newRaw = { ...raw, securityConfig: { ...secCfg, withdrawalWhitelist: list } }
  await db.from('users').update({ raw_data: newRaw }).eq('id', userId)
  return { success: true, entry, list }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    // Ping SIN body ni auth: verificar desde el navegador qué versión está
    // desplegada. GET .../tatum-wallet?action=ping
    if (new URL(req.url).searchParams.get('action') === 'ping') {
      return ok({ ok: true, version: 'tatum-wallet v18 (GasFree — diagnostico de saldo)' })
    }
    const body = await req.json()
    const { action, userId, walletKey, amount, toAddress, targetCurrency, rate, address } = body
    if (action === 'setup_wallets')    return ok(await setupWallets())
    if (action === 'get_hot_wallets')  return ok(await getHotWallets())
    if (action === 'get_admin_wallets') return ok(await getAdminWallets())
    if (action === 'admin_hot_wallet_withdrawal') {
      if (!walletKey || !amount || !toAddress) return err('Faltan walletKey, amount o toAddress', 400)
      return ok(await adminHotWalletWithdrawal(walletKey, amount, toAddress))
    }
    // Diagnostic: check if current mnemonic derives a specific address (scan indices 0-30)
    if (action === 'verify_address_control') {
      const target: string = address ?? toAddress ?? ''
      if (!target) return err('Falta address', 400)
      if (!ETH_MNEMONIC) return err('TATUM_ETH_MNEMONIC no configurado', 400)
      const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ETH_MNEMONIC), "m/44'/60'/0'/0")
      for (let i = 0; i <= 30; i++) {
        const child = root.deriveChild(i)
        if (child.address.toLowerCase() === target.toLowerCase()) {
          return ok({ controls: true, index: i, address: child.address, message: `✅ SÍ controlas esta wallet (índice ${i} del mnemonic actual)` })
        }
      }
      return ok({ controls: false, address: target, message: '❌ El mnemonic actual NO controla esta dirección (índices 0-30 verificados)' })
    }
    // Diagnostic: verify whether the current mnemonic controls the stored wallet addresses for a user
    if (action === 'verify_wallet_control') {
      if (!userId) return err('Falta userId', 400)
      const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
      if (!u) return err('Usuario no encontrado', 404)
      const index: number | undefined = u.raw_data?.tatumHdIndex
      const storedAddresses: Record<string, string> = u.raw_data?.tatumAddresses ?? {}
      const result: Record<string, any> = { tatumHdIndex: index, storedAddresses, derived: {}, control: {} }
      if (typeof index === 'number') {
        if (ETH_MNEMONIC) {
          const root  = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ETH_MNEMONIC), "m/44'/60'/0'/0")
          const child = root.deriveChild(index)
          result.derived.BSC = child.address
          result.control.BSC_USDT = storedAddresses.USDT_BSC
            ? { stored: storedAddresses.USDT_BSC, derived: child.address, match: child.address.toLowerCase() === storedAddresses.USDT_BSC.toLowerCase() }
            : { note: 'No hay dirección USDT_BSC guardada' }
        } else {
          result.derived.BSC = 'TATUM_ETH_MNEMONIC no configurado'
        }
        if (TRON_MNEMONIC) {
          const root  = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(TRON_MNEMONIC), "m/44'/60'/0'/0")
          const child = root.deriveChild(index)
          const tronAddr = await ethAddressToTron(child.address)
          result.derived.TRON = tronAddr
          result.control.TRON_USDT = storedAddresses.USDT_TRON
            ? { stored: storedAddresses.USDT_TRON, derived: tronAddr, match: tronAddr === storedAddresses.USDT_TRON }
            : { note: 'No hay dirección USDT_TRON guardada' }
        } else {
          result.derived.TRON = 'TATUM_TRON_MNEMONIC no configurado'
        }
      } else {
        result.note = 'Este usuario no tiene tatumHdIndex — aún no generó su wallet de depósito'
      }
      return ok(result)
    }
    // Admin: clear wallet data for a specific user (or all users) so they get fresh addresses
    // from the current xpub. Use after updating Supabase secrets with new mnemonic.
    if (action === 'reset_wallet_data') {
      const targetId: string | undefined = userId // if provided, reset only this user; else reset all
      const { data: usersToReset } = targetId
        ? await db.from('users').select('id, raw_data').eq('id', targetId)
        : await db.from('users').select('id, raw_data')
      let count = 0
      for (const u of (usersToReset ?? [])) {
        const { tatumHdIndex: _idx, tatumAddresses: _addrs, ...rest } = u.raw_data ?? {}
        await db.from('users').update({ raw_data: rest }).eq('id', u.id)
        count++
      }
      // Reset counter and blacklist in system_config
      if (!targetId) {
        await db.from('system_config').upsert({ key: 'tatum_hd_counter', value: '0' }, { onConflict: 'key' })
        await db.from('system_config').upsert({ key: 'tatum_used_indices', value: '[]' }, { onConflict: 'key' })
      }
      return ok({ ok: true, reset: count, message: `Wallet data cleared for ${count} user(s). They will get fresh addresses on next deposit page load.` })
    }
    if (action === 'check_user_onchain_balance') {
      if (!userId || !walletKey) return err('Faltan userId o walletKey', 400)
      return ok(await checkUserOnchainBalance(userId, walletKey, body.customRpc, body.customContract))
    }
    // Admin: restore a lost tatumHdIndex to a user, given the index and address found via verify_address_control
    if (action === 'restore_wallet_index') {
      if (!userId || typeof body.hdIndex !== 'number' || !body.address) return err('Faltan userId, hdIndex o address', 400)
      const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
      if (!u) return err('Usuario no encontrado', 404)
      const raw = u.raw_data ?? {}
      const newRaw = {
        ...raw,
        tatumHdIndex: body.hdIndex,
        tatumAddresses: { ...(raw.tatumAddresses ?? {}), USDT_BSC: body.address, USDC_BSC: body.address },
      }
      await db.from('users').update({ raw_data: newRaw }).eq('id', userId)
      return ok({ ok: true, message: `Índice HD ${body.hdIndex} restaurado al usuario. Dirección: ${body.address}` })
    }
    if (action === 'recover_user_funds') {
      if (!userId || !walletKey) return err('Faltan userId o walletKey', 400)
      return ok(await recoverUserFunds(userId, walletKey, toAddress ?? '', body.customRpc, body.customContract))
    }
    // Envío REAL a wallet externa (flujo "Enviar → Wallet" de la app):
    // paga desde la hot wallet (recaudadora), debita el USD del cliente
    // server-side y le devuelve el saldo si el envío on-chain falla.
    if (action === 'wallet_withdrawal') {
      if (!userId || !toAddress || !amount) return err('Faltan userId, toAddress o amount', 400)
      return ok(await userWalletWithdrawal(userId, String(toAddress), Number(amount), String(body.network ?? 'TRC-20'), String(body.coin ?? 'USDT')))
    }
    // Guardar contactos con service-role (bypass total de RLS/candado). La
    // app escribía raw_data desde el cliente y a veces se descartaba en
    // silencio → los contactos "desaparecían". key = finityContacts (bancos)
    // o walletContacts (wallets). Devuelve la lista guardada, ya releída.
    // GasFree: estado (dirección GasFree de la recaudadora, saldo, comisión)
    if (action === 'gasfree_status') {
      return ok(await gasfreeStatus())
    }
    // GasFree: enviar USDT desde la recaudadora sin TRX (prueba/producción)
    if (action === 'gasfree_send') {
      if (!toAddress || !amount) return err('Faltan toAddress o amount', 400)
      return ok(await gasfreeSend(String(toAddress), Number(amount)))
    }
    // GasFree: obtener/crear la wallet GasFree de un usuario (su cajita USDT)
    if (action === 'gasfree_user_address') {
      if (!userId) return err('Falta userId', 400)
      return ok(await gasfreeUserAddress(userId))
    }
    // GasFree: barrer el USDT de la wallet de un usuario a la recaudadora
    if (action === 'gasfree_sweep_user') {
      if (!userId) return err('Falta userId', 400)
      return ok(await gasfreeSweepUser(userId))
    }
    // GasFree: barrer TODOS los usuarios de empresa a la recaudadora
    if (action === 'gasfree_sweep_all') {
      const { data: users } = await db.from('users').select('id, role').limit(1000)
      const out: any[] = []
      for (const u of (users as any[]) ?? []) {
        if (u.role === 'personal' || u.role === 'admin') continue
        try { out.push(await gasfreeSweepUser(u.id)) }
        catch (e) { out.push({ userId: u.id, error: (e as Error)?.message }) }
      }
      return ok({ ok: true, results: out })
    }
    // GasFree: estado de una transferencia por traceId
    if (action === 'gasfree_trace') {
      if (!body.traceId) return err('Falta traceId', 400)
      const r = await gasfreeGet(`/api/v1/gasfree/${body.traceId}`)
      return ok({ ok: r?.code === 200, data: r?.data ?? r })
    }
    // Barrer TODOS los buzones de clientes a la recaudadora. Seguro por
    // diseño: el destino SIEMPRE es la recaudadora (derivada del secret
    // LINCOIN_TRON_HOT_KEY), nunca una dirección que el llamante controle —
    // así que ni el botón admin ni el cron pueden desviar fondos. Lo llaman
    // el botón del panel admin y el cron cada N minutos.
    if (action === 'sweep_all') {
      const res = await sweepAllToRecaudadora()
      return ok({ ok: true, ...res })
    }
    if (action === 'save_contacts') {
      if (!userId || !body.key || !Array.isArray(body.list)) return err('Faltan userId, key o list', 400)
      const key = String(body.key)
      if (key !== 'finityContacts' && key !== 'walletContacts') return err('key inválida', 400)
      const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
      if (!u) return err('Usuario no encontrado', 404)
      const raw = (u.raw_data ?? {}) as Record<string, any>
      const nextRaw = { ...raw, [key]: body.list }
      const { error: upErr } = await db.from('users').update({ raw_data: nextRaw }).eq('id', userId)
      if (upErr) return err(`No se pudo guardar: ${upErr.message}`, 500)
      const { data: check } = await db.from('users').select('raw_data').eq('id', userId).single()
      return ok({ ok: true, key, saved: (check?.raw_data ?? {})[key] ?? [] })
    }
    if (action === 'admin_credit_user') {
      if (!userId || !body.currency || !body.creditAmount) return err('Faltan userId, currency o creditAmount', 400)
      const creditAmt = parseFloat(body.creditAmount)
      if (isNaN(creditAmt) || creditAmt <= 0) return err('Monto inválido', 400)
      const { data: u } = await db.from('users').select('crypto_balances').eq('id', userId).single()
      if (!u) return err('Usuario no encontrado', 404)
      const bals = (u.crypto_balances as Record<string, number>) ?? {}
      const newBal = parseFloat(((bals[body.currency] ?? 0) + creditAmt).toFixed(8))
      await db.from('users').update({ crypto_balances: { ...bals, [body.currency]: newBal } }).eq('id', userId)
      await db.from('transactions').insert({
        user_id: userId, type: 'admin_credit', amount: creditAmt, currency: body.currency, status: 'Completado',
        raw_data: { txHash: body.txHash ?? null, network: body.network ?? null, note: body.note ?? null, creditedAt: new Date().toISOString() },
      })
      return ok({ ok: true, credited: creditAmt, currency: body.currency, newBalance: newBal })
    }
    // Admin: derive private key for a user's HD index so admin can recover funds
    // from any EVM or TRON network where user accidentally sent tokens
    if (action === 'derive_user_key') {
      if (!userId) return err('Falta userId', 400)
      const { data: u } = await db.from('users').select('raw_data, email').eq('id', userId).single()
      if (!u) return err('Usuario no encontrado', 404)
      const hdIndex: number | undefined = u.raw_data?.tatumHdIndex
      if (typeof hdIndex !== 'number') return err('Este usuario no tiene tatumHdIndex asignado', 400)
      const result: Record<string, any> = { hd_index: hdIndex, user_email: u.email ?? userId }
      if (ETH_MNEMONIC) {
        const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(ETH_MNEMONIC), "m/44'/60'/0'/0")
        const child = root.deriveChild(hdIndex)
        result.evm_private_key = child.privateKey
        result.evm_address = child.address
      }
      if (TRON_MNEMONIC) {
        const root = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(TRON_MNEMONIC), "m/44'/60'/0'/0")
        const child = root.deriveChild(hdIndex)
        const tronAddr = await ethAddressToTron(child.address)
        result.tron_private_key = child.privateKey.replace('0x', '')
        result.tron_address = tronAddr
      }
      return ok(result)
    }
    if (action === 'get_config') {
      const { data } = await db.from('app_config').select('settings').eq('id', 1).single()
      return ok({ settings: data?.settings ?? null })
    }
    if (action === 'save_config') {
      const { settings } = body
      if (!settings) return err('Missing settings', 400)
      const { error: cfgErr } = await db.from('app_config').upsert({ id: 1, settings })
      if (cfgErr) return err(cfgErr.message)
      return ok({ saved: true })
    }
    if (!userId || !walletKey)         return err('Faltan userId o walletKey', 400)
    if (action === 'get_or_create')    return ok(await getOrCreate(userId, walletKey))
    if (action === 'get_balance')      return ok(await getBalance(userId, walletKey))
    if (action === 'verify_and_credit') return ok(await verifyAndCredit(userId, walletKey))
    if (action === 'send_withdrawal') {
      if (!amount || !toAddress) return err('Faltan amount o toAddress', 400)
      return ok(await sendWithdrawal(userId, walletKey, amount, toAddress))
    }
    if (action === 'request_withdrawal') {
      if (!amount || !toAddress) return err('Faltan amount o toAddress', 400)
      return ok(await requestWithdrawal(userId, walletKey, amount, toAddress))
    }
    if (action === 'add_whitelist_address') {
      const { label = '', network = 'USDT_BSC' } = body
      if (!address) return err('Falta address', 400)
      return ok(await addWhitelistAddress(userId, address, label, network))
    }
    if (action === 'admin_approve_whitelist') {
      const { approve, approved, whitelistId } = body
      const lookupKey = whitelistId ?? address
      if (!lookupKey) return err('Falta address o whitelistId', 400)
      return ok(await adminApproveWhitelist(userId, lookupKey, approved ?? approve ?? true))
    }
    if (action === 'request_convert') {
      if (!amount || !targetCurrency || !rate) return err('Faltan campos', 400)
      return ok(await requestConvert(userId, walletKey, amount, targetCurrency, rate))
    }
    if (action === 'manual_sweep') {
      if (!amount) return err('Falta amount', 400)
      const txHash = await sweepConvertToHotWallet(userId, walletKey, parseFloat(amount), body.txId)
      return ok({ ok: true, txHash })
    }
    return err(`Acción desconocida: ${action}`, 400)
  } catch (e: any) {
    console.error('[tatum-wallet]', e)
    return err(e?.message ?? String(e))
  }
})
