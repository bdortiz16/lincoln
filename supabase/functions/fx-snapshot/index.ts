// ════════════════════════════════════════════════════════
// fx-snapshot — Llama a un proveedor de tasas y persiste
// los pares en fx_rate_snapshots.
//
// Diseñado para ser invocado por:
//   • cron (Supabase scheduled function cada N minutos)
//   • el botón "Actualizar API" del panel Rates
//
// Proveedores soportados (FX_PROVIDER):
//   • 'fawaz'        → @fawazahmed0/currency-api (default, GRATIS, sin key)
//                      Hosteado en jsDelivr CDN, refresca cada hora.
//                      Soporta USD/COP/CLP/PEN/MXN/BRL/VES sin problema.
//   • 'openexchange' → open.er-api.com (gratis, fallback secundario)
//   • 'xe'           → xe.com (requiere FX_API_KEY="account:secret")
//   • 'exchangerate' → exchangerate.host (requiere FX_API_KEY)
//
// Secrets necesarios siempre:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Secrets opcionales (solo para xe/exchangerate):
//   FX_PROVIDER          → default 'fawaz'
//   FX_API_KEY
// ════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FX_PROVIDER  = (Deno.env.get('FX_PROVIDER') ?? 'fawaz').toLowerCase()
const FX_API_KEY   = Deno.env.get('FX_API_KEY') ?? ''

const CURRENCIES = ['USD', 'COP', 'CLP', 'PEN', 'MXN', 'BRL', 'VES']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const db = createClient(SUPABASE_URL, SERVICE_KEY)

// ─────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────

// Fawaz Ahmed Currency API — GRATIS, sin key, CDN jsDelivr, refresca cada hora.
// Devuelve { date, [base_lc]: { ccy_lc: rate, ... } }  (todo lowercase)
async function fetchFawaz(base: string): Promise<Record<string, number>> {
  const baseLc = base.toLowerCase()
  // El proyecto cambió de @fawazahmed0/exchange-api a @fawazahmed0/currency-api
  // y la URL nueva tiene fallback automático. Probamos la primaria y si falla
  // caemos al mirror de Cloudflare.
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseLc}.json`,
    `https://${'latest'}.currency-api.pages.dev/v1/currencies/${baseLc}.json`,
  ]
  let lastErr = ''
  for (const url of urls) {
    try {
      const r = await fetch(url)
      if (!r.ok) { lastErr = `fawaz ${r.status} en ${url}`; continue }
      const j = await r.json() as Record<string, any>
      const rates = j[baseLc] as Record<string, number> | undefined
      if (!rates) { lastErr = `fawaz: respuesta sin base ${baseLc}`; continue }
      // Convertir las keys a UPPERCASE para que matcheen con CURRENCIES
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(rates)) {
        if (typeof v === 'number' && v > 0) out[k.toUpperCase()] = v
      }
      return out
    } catch (e) {
      lastErr = `fawaz: ${(e as Error).message}`
    }
  }
  throw new Error(lastErr || 'fawaz: ambos endpoints fallaron')
}

// open.er-api.com — gratis, sin key. Devuelve { base, rates: { CCY: rate, ... } }
async function fetchOpenER(base: string): Promise<Record<string, number>> {
  const r = await fetch(`https://open.er-api.com/v6/latest/${base}`)
  if (!r.ok) throw new Error(`open.er-api ${r.status}`)
  const j = await r.json()
  return j.rates ?? {}
}

// exchangerate.host  (alias compatible)
async function fetchExchangerate(base: string): Promise<Record<string, number>> {
  const url = FX_API_KEY
    ? `https://api.exchangerate.host/latest?base=${base}&access_key=${FX_API_KEY}`
    : `https://api.exchangerate.host/latest?base=${base}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`exchangerate ${r.status}`)
  const j = await r.json()
  return j.rates ?? {}
}

// xe.com — requiere account+secret en formato Basic auth
async function fetchXe(base: string): Promise<Record<string, number>> {
  if (!FX_API_KEY) throw new Error('FX_API_KEY required for xe')
  // FX_API_KEY esperado en formato "account:secret"
  if (!FX_API_KEY.includes(':')) {
    throw new Error('FX_API_KEY debe estar en formato "account_id:api_secret" para xe.com')
  }
  const auth = btoa(FX_API_KEY)
  const to = CURRENCIES.filter(c => c !== base).join(',')
  const r = await fetch(`https://xecdapi.xe.com/v1/convert_from.json/?from=${base}&to=${to}&amount=1`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`xe ${r.status}: ${body.slice(0, 200)}`)
  }
  const j = await r.json()
  const out: Record<string, number> = {}
  for (const t of j.to ?? []) {
    if (typeof t.quotecurrency === 'string' && typeof t.mid === 'number') {
      out[t.quotecurrency] = t.mid
    }
  }
  return out
}

async function ratesForBase(base: string): Promise<Record<string, number>> {
  switch (FX_PROVIDER) {
    case 'xe':            return fetchXe(base)
    case 'exchangerate':  return fetchExchangerate(base)
    case 'openexchange':
    case 'open':          return fetchOpenER(base)
    case 'fawaz':
    default:              return fetchFawaz(base)
  }
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    // mode=ping → solo verifica conectividad y credenciales sin insertar
    const url = new URL(req.url)
    const mode = url.searchParams.get('mode')
    if (mode === 'ping') {
      try {
        const sample = await ratesForBase('USD')
        return new Response(JSON.stringify({
          ok: true,
          provider: FX_PROVIDER,
          has_api_key: Boolean(FX_API_KEY),
          sample_pair: { from: 'USD', count: Object.keys(sample).length, first: Object.entries(sample)[0] ?? null },
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } })
      } catch (e) {
        return new Response(JSON.stringify({
          ok: false,
          provider: FX_PROVIDER,
          has_api_key: Boolean(FX_API_KEY),
          error: (e as Error).message,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } })
      }
    }

    const inserted: Array<{ from: string; to: string; rate: number }> = []
    const errors: string[] = []

    for (const base of CURRENCIES) {
      try {
        const rates = await ratesForBase(base)
        const rows = CURRENCIES
          .filter(c => c !== base && typeof rates[c] === 'number' && rates[c] > 0)
          .map(c => ({
            from_currency: base,
            to_currency: c,
            rate: rates[c],
            source: FX_PROVIDER,
          }))
        if (rows.length > 0) {
          const { error } = await db.from('fx_rate_snapshots').insert(rows)
          if (error) errors.push(`insert ${base}: ${error.message}`)
          else rows.forEach(r => inserted.push({ from: r.from_currency, to: r.to_currency, rate: r.rate }))
        }
      } catch (e) {
        errors.push(`${base}: ${(e as Error).message}`)
      }
    }

    return new Response(JSON.stringify({
      ok: errors.length === 0,
      provider: FX_PROVIDER,
      inserted: inserted.length,
      errors,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
