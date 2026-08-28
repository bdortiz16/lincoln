#!/usr/bin/env node
// Prueba rápida de la edge function `gasfree`.
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node scripts/test-gasfree.mjs
// o:
//   node scripts/test-gasfree.mjs https://xxxx.supabase.co eyJ...
//
// Hace el `ping` (health check). Debe responder algo como:
//   { ok: true, service: "gasfree", version: "...", net: "nile" }

const URL = process.env.SUPABASE_URL || process.argv[2];
const KEY = process.env.SUPABASE_ANON_KEY || process.argv[3];

if (!URL) {
  console.error('Falta SUPABASE_URL. Uso: node scripts/test-gasfree.mjs <SUPABASE_URL> <ANON_KEY>');
  process.exit(1);
}

const fnUrl = URL.replace(/\/+$/, '') + '/functions/v1/gasfree?action=ping';

const headers = { 'Content-Type': 'application/json' };
if (KEY) { headers['Authorization'] = 'Bearer ' + KEY; headers['apikey'] = KEY; }

console.log('→ POST', fnUrl);
try {
  const res = await fetch(fnUrl, { method: 'POST', headers, body: JSON.stringify({ action: 'ping' }) });
  const text = await res.text();
  console.log('← HTTP', res.status);
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
  catch { console.log(text); }
  if (res.ok) console.log('\n✅ GasFree responde. Revisa que "net" sea "nile" (testnet) para las pruebas.');
  else console.log('\n⚠️  Revisa: función desplegada, secrets (GASFREE_API_KEY/SECRET/MNEMONIC) y anon key.');
} catch (e) {
  console.error('✗ Error de conexión:', e.message);
  process.exit(1);
}
