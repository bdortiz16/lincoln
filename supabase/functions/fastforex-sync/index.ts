// ════════════════════════════════════════════════════════
// fastforex-sync — Alimenta fx_rate_snapshots con tasas REALES de
// FastForex para todos los pares LATAM de Lincoin.
//
// Pensada para el proyecto Supabase que NO tiene el cron de Antigravity
// (el feed original vive en LincoinANDROID). Desplegar esta función y
// programarla cada 5 minutos deja al proyecto con su propio feed.
//
// Secrets:
//   FASTFOREX_API_KEY   la API key de fastforex.io (la misma del otro
//                       proyecto sirve — o crea una en fastforex.io)
//   CRON_SECRET         opcional: si está seteado, la función exige
//                       ?key=<CRON_SECRET> (evita que cualquiera la dispare)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (inyectados)
//
// Programación (elige UNA):
//   a) Dashboard → Edge Functions → fastforex-sync → Schedules →
//      cron: */5 * * * *
//   b) pg_cron + pg_net (SQL en 2026_fx_snapshots_empresas.sql)
//
// Invocación manual (para probar):
//   POST https://<proj>.supabase.co/functions/v1/fastforex-sync?key=<CRON_SECRET>
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FF_KEY       = Deno.env.get('FASTFOREX_API_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

// Monedas del ecosistema Lincoin. Cada base consulta las demás en UNA
// llamada (fetch-multi) → 7 requests por corrida, 42 pares.
const CURRENCIES = ['USD', 'COP', 'CLP', 'PEN', 'MXN', 'BRL', 'VES']

Deno.serve(async (req) => {
  try {
    if (CRON_SECRET) {
      const url = new URL(req.url)
      if (url.searchParams.get('key') !== CRON_SECRET) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      }
    }
    if (!FF_KEY) {
      return new Response(JSON.stringify({ error: 'missing_FASTFOREX_API_KEY' }), { status: 200 })
    }

    const capturedAt = new Date().toISOString()
    const rows: Array<{ from_currency: string; to_currency: string; rate: number; source: string; captured_at: string }> = []
    const errors: string[] = []

    for (const from of CURRENCIES) {
      const to = CURRENCIES.filter(c => c !== from).join(',')
      try {
        const r = await fetch(
          `https://api.fastforex.io/fetch-multi?from=${from}&to=${to}&api_key=${FF_KEY}`,
          { headers: { accept: 'application/json' } },
        )
        const body = await r.json().catch(() => ({}))
        if (!r.ok || !body?.results) {
          errors.push(`${from}: ${r.status} ${JSON.stringify(body).slice(0, 120)}`)
          continue
        }
        for (const [toCur, rate] of Object.entries(body.results as Record<string, number>)) {
          const n = Number(rate)
          if (Number.isFinite(n) && n > 0) {
            rows.push({ from_currency: from, to_currency: toCur, rate: n, source: 'FASTFOREX', captured_at: capturedAt })
          }
        }
      } catch (e) {
        errors.push(`${from}: ${String((e as Error)?.message ?? e)}`)
      }
    }

    if (rows.length === 0) {
      console.error('[fastforex-sync] sin filas — errores:', errors)
      return new Response(JSON.stringify({ ok: false, inserted: 0, errors }), { status: 200 })
    }

    const { error } = await db.from('fx_rate_snapshots').insert(rows)
    if (error) {
      console.error('[fastforex-sync] insert error:', error.message)
      try {
        await db.from('xe_config').update({
          last_error: error.message, last_error_at: new Date().toISOString(),
        }).eq('id', 1)
      } catch { /* tabla opcional */ }
      return new Response(JSON.stringify({ ok: false, error: error.message, errors }), { status: 200 })
    }

    // Salud del sistema (la lee fx_health_dashboard en el panel)
    try {
      await db.from('xe_config').update({
        last_sync_at: capturedAt,
        consecutive_failures: 0,
        last_error: errors.length ? errors.join(' | ').slice(0, 500) : null,
        last_error_at: errors.length ? capturedAt : null,
      }).eq('id', 1)
    } catch { /* tabla opcional */ }

    console.log(`[fastforex-sync] ${rows.length} tasas insertadas · errores: ${errors.length}`)
    return new Response(JSON.stringify({ ok: true, inserted: rows.length, pairs: rows.length, errors }), { status: 200 })
  } catch (e) {
    console.error('[fastforex-sync] exception:', e)
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), { status: 500 })
  }
})
