import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TATUM_API_KEY = Deno.env.get('TATUM_API_KEY') ?? ''
const NOTIFY_URL    = `${SUPABASE_URL}/functions/v1/notify-transaction`

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const WALLET_TO_CURRENCY: Record<string, string> = {
  USDT_TRON: 'USDT', USDT_BSC: 'USDT', USDC_BSC: 'USDC', USDC_MATIC: 'USDC',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

// Tatum sends the API key in x-api-key header — verify it matches ours
function isValidRequest(req: Request): boolean {
  if (!TATUM_API_KEY) return true // skip check if not configured
  const incoming = req.headers.get('x-api-key') ?? ''
  return incoming === TATUM_API_KEY
}

// Normalize currency from Tatum event to our internal keys
// e.g. "USDT" on TRON → "USDT_TRON", on BSC → "USDT_BSC"
function normalizeCurrency(symbol: string, chain: string): string {
  const s = (symbol ?? '').toUpperCase()
  const c = (chain  ?? '').toUpperCase()
  if (s === 'USDT' && c === 'TRON')  return 'USDT_TRON'
  if (s === 'USDT' && c === 'BSC')   return 'USDT_BSC'
  if (s === 'USDC' && c === 'BSC')   return 'USDC_BSC'
  if (s === 'USDC' && (c === 'MATIC' || c === 'POLYGON')) return 'USDC_MATIC'
  return `${s}_${c}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    // Verify the request comes from Tatum
    if (!isValidRequest(req)) {
      console.warn('[tatum-webhook] Unauthorized request')
      return new Response('Unauthorized', { status: 401 })
    }

    const payload = await req.json()
    console.log('[tatum-webhook] received:', JSON.stringify(payload))

    // Tatum ADDRESS_EVENT payload shape:
    // { address, asset, amount, chain, txId, type, blockNumber, ... }
    const {
      address,
      asset,       // e.g. "USDT"
      amount,      // string or number
      chain,       // e.g. "TRON", "BSC"
      txId,
      type,        // "incoming" | "outgoing"
    } = payload

    // We only care about incoming transactions
    if (type !== 'incoming') {
      return new Response(JSON.stringify({ ok: true, skipped: 'outgoing' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const parsedAmount = parseFloat(String(amount))
    if (!address || !asset || isNaN(parsedAmount) || parsedAmount <= 0) {
      console.warn('[tatum-webhook] invalid payload', payload)
      return new Response(JSON.stringify({ ok: false, reason: 'invalid payload' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const walletKey = normalizeCurrency(asset, chain)

    // Find which user owns this address using a targeted JSON query (avoids full table scan)
    const addrLower = address.toLowerCase()
    const { data: users } = await db
      .from('users')
      .select('id, raw_data')
      .or(
        ['USDT_TRON','USDT_BSC','USDC_BSC','USDC_MATIC','USDC_BASE']
          .map(k => `raw_data->tatumAddresses->>${k}.ilike.${addrLower}`)
          .join(',')
      )
      .limit(5)

    const user = (users ?? []).find((u: any) => {
      const addrs: Record<string, string> = u.raw_data?.tatumAddresses ?? {}
      return Object.values(addrs).some(a => a.toLowerCase() === addrLower)
    })

    if (!user) {
      console.warn(`[tatum-webhook] No user found for address ${address}`)
      return new Response(JSON.stringify({ ok: false, reason: 'address not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Avoid duplicate transactions for the same txId
    if (txId) {
      const { data: existing } = await db
        .from('transactions')
        .select('id')
        .eq('user_id', user.id)
        .eq('type', 'otc_deposit')
        .contains('raw_data', { txId })
        .maybeSingle()
      if (existing) {
        console.log(`[tatum-webhook] duplicate txId ${txId}, skipping`)
        return new Response(JSON.stringify({ ok: true, skipped: 'duplicate' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Auto-credit: update user crypto balance immediately and record as completed
    // Use walletKey (e.g. USDT_BSC, USDT_TRON) as balance key — independent per network
    const { data: userData } = await db.from('users').select('crypto_balances, raw_data').eq('id', user.id).single()
    const cryptoBals = (userData?.crypto_balances as Record<string, number>) ?? {}
    const newBalance = parseFloat(((cryptoBals[walletKey] ?? 0) + parsedAmount).toFixed(8))

    // Alimentar también el contador acumulado anti doble-acreditación que
    // usa "Verificar depósito" (raw_data.tatumCredited) — así el botón
    // nunca re-acredita lo que ya entró por webhook.
    const rawData = (userData?.raw_data ?? {}) as Record<string, any>
    const creditedMap: Record<string, number> = rawData.tatumCredited ?? {}
    const updatePayload: Record<string, any> = { crypto_balances: { ...cryptoBals, [walletKey]: newBalance } }
    if (typeof creditedMap[walletKey] === 'number') {
      updatePayload.raw_data = {
        ...rawData,
        tatumCredited: { ...creditedMap, [walletKey]: parseFloat((creditedMap[walletKey] + parsedAmount).toFixed(8)) },
      }
    }

    const { error: balErr } = await db.from('users')
      .update(updatePayload)
      .eq('id', user.id)

    if (balErr) {
      console.error('[tatum-webhook] balance update error:', balErr)
      return new Response(JSON.stringify({ ok: false, error: balErr.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { error: txErr } = await db.from('transactions').insert({
      user_id:  user.id,
      type:     'otc_deposit',
      amount:   parsedAmount,
      currency: walletKey,
      status:   'Completado',
      raw_data: { txId, address, chain, asset, walletKey, detectedAt: new Date().toISOString(), source: 'tatum_webhook' },
    })

    if (txErr) {
      console.error('[tatum-webhook] tx insert error:', txErr)
    } else {
      // Re-fetch the inserted tx record so notify-transaction has its DB id
      const { data: insertedTx } = await db.from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .eq('type', 'otc_deposit')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (insertedTx) {
        // Call notify-transaction directly (don't wait — fire and forget)
        fetch(NOTIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ type: 'INSERT', table: 'transactions', record: insertedTx }),
        }).catch(e => console.warn('[tatum-webhook] notify call failed (non-fatal):', e?.message))
      }
    }

    console.log(`[tatum-webhook] auto-credited ${parsedAmount} ${walletKey} to user ${user.id} (new balance: ${newBalance})`)
    return new Response(JSON.stringify({ ok: true, credited: parsedAmount, currency: walletKey }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (e: any) {
    console.error('[tatum-webhook] error:', e)
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
