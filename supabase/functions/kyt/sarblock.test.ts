// Pruebas del cliente de wallets de Sarblock (sarblock.ts) contra respuestas
// simuladas con los casos de prueba de su documentación. Sin red y sin
// gastar créditos.
//   ~/.deno/bin/deno test supabase/functions/kyt/sarblock.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { analizarYEsperar, leerResultado, motivoSarblock, claveAnalisis, redSarblock, probarLlave } from './sarblock.ts';

// Los casos fijos de docs.sarblock.com/reference/wallets (modo de pruebas).
const CASOS: Record<string, any> = {
  '0x7e57000000000000000000000000000000000001': { riskLevel: 'LOW', recommendation: 'CLEAR', score: { value: 8, level: 'LOW', floor: null, confidence: 'HIGH' }, degraded: false, signals: [], checks: { total: 7, clean: 7, flagged: [] }, exposure: { exchangeSharePct: 62, attributedEntity: null }, activeNetworks: ['ETH'] },
  '0x7e57000000000000000000000000000000000002': { riskLevel: 'MEDIUM', recommendation: 'REVIEW', score: { value: 55, level: 'MEDIUM', floor: null, confidence: 'MEDIUM' }, degraded: false, signals: [{ code: 'MIXER_INTERACTION', severity: 'MEDIUM', network: 'ETH', category: 'MIXER', entity: null, exposureUsd: '1250.00' }], checks: { total: 7, clean: 6, flagged: ['mixers y puentes'] }, exposure: { exchangeSharePct: 62, attributedEntity: null }, activeNetworks: ['ETH'] },
  '0x7e57000000000000000000000000000000000003': { riskLevel: 'HIGH', recommendation: 'BLOCK', score: { value: 90, level: 'HIGH', floor: 90, confidence: 'HIGH' }, degraded: false, signals: [{ code: 'SANCTIONED_OFAC', severity: 'CRITICAL', network: 'ETH', category: 'SANCTIONS', entity: null, exposureUsd: null }], checks: { total: 7, clean: 6, flagged: ['sanciones'] }, exposure: { exchangeSharePct: null, attributedEntity: null }, activeNetworks: ['ETH'] },
};

// Sarblock simulado: el POST encola; las primeras lecturas siguen en curso.
function simulado(lecturasHastaListo = 3) {
  const vistos: any[] = [];
  let lecturas = 0;
  const f = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (init?.method === 'POST') {
      const b = JSON.parse(String(init.body));
      vistos.push({ cuerpo: b, cabeceras: init.headers });
      if (b.address.endsWith('4')) return new Response(JSON.stringify({ statusCode: 402, type: 'INSUFFICIENT_CREDITS', message: 'Sin saldo' }), { status: 402 });
      return new Response(JSON.stringify({ id: 'an-' + b.address.slice(-1), walletId: 'w-' + b.address.slice(-1), status: 'QUEUED', reused: false }), { status: 202 });
    }
    lecturas++;
    const id = u.pathname.split('/').pop()!;
    const dir = '0x7e5700000000000000000000000000000000000' + id.slice(-1);
    const listo = lecturas >= lecturasHastaListo;
    return new Response(JSON.stringify({
      id, walletId: 'w-' + id.slice(-1), address: dir, family: 'EVM', network: 'ETH',
      status: listo ? 'COMPLETE' : 'RUNNING', failureReason: null,
      requestedAt: '2026-11-23T03:00:00Z', completedAt: listo ? '2026-11-23T03:00:05Z' : null,
      result: listo ? CASOS[dir] : null,
    }), { status: 200 });
  };
  return { f, vistos, lecturas: () => lecturas };
}
const sinEspera = async () => {};
const dir = (n: number) => '0x7e5700000000000000000000000000000000000' + n;

Deno.test('limpia: CLEAR, bajo, sin señales; espera hasta COMPLETE', async () => {
  const s = simulado();
  const r = await analizarYEsperar(s.f, 'sb_test_x', { address: dir(1), network: 'ETH', idempotencia: claveAnalisis('ETH', dir(1)) }, 25000, sinEspera);
  assert(!r.enCurso);
  assertEquals(s.lecturas(), 3);
  const v = leerResultado(r.analisis)!;
  assertEquals([v.recomendacion, v.riskLevel, v.score.value, v.sancionada, v.senales.length], ['CLEAR', 'LOW', 8, false, 0]);
  assertEquals((s.vistos[0].cabeceras as any)['x-api-key'], 'sb_test_x');
  assertEquals((s.vistos[0].cabeceras as any)['idempotency-key'], claveAnalisis('ETH', dir(1)));
});

Deno.test('mezclador: REVIEW con la señal y su exposición en número', async () => {
  const s = simulado();
  const v = leerResultado((await analizarYEsperar(s.f, 'k', { address: dir(2), network: 'ETH', idempotencia: 'x' }, 25000, sinEspera)).analisis)!;
  assertEquals(v.recomendacion, 'REVIEW');
  assertEquals(v.senales[0].code, 'MIXER_INTERACTION');
  assertEquals(v.senales[0].exposureUsd, 1250);
  assertEquals(v.chequeos.flagged, ['mixers y puentes']);
  assertEquals(v.sancionada, false);
});

Deno.test('sancionada: BLOCK y sancionada por la señal, no por el piso', async () => {
  const s = simulado();
  const v = leerResultado((await analizarYEsperar(s.f, 'k', { address: dir(3), network: 'ETH', idempotencia: 'x' }, 25000, sinEspera)).analisis)!;
  assertEquals([v.recomendacion, v.score.floor, v.sancionada], ['BLOCK', 90, true]);
});

Deno.test('sin saldo: 402 se lee como sin créditos', async () => {
  const s = simulado();
  let codigo = '';
  try { await analizarYEsperar(s.f, 'k', { address: dir(4), network: 'ETH', idempotencia: 'x' }, 25000, sinEspera); }
  catch (e) { codigo = motivoSarblock(e).codigo; }
  assertEquals(codigo, 'sin_creditos');
});

Deno.test('si no termina a tiempo vuelve en curso, sin resultado', async () => {
  const s = simulado(99);
  const r = await analizarYEsperar(s.f, 'k', { address: dir(1), network: 'ETH', idempotencia: 'x' }, 1000, sinEspera);
  assert(r.enCurso);
  assertEquals(leerResultado(r.analisis), null);
});

Deno.test('redes y clave de idempotencia', () => {
  assertEquals([redSarblock('trx'), redSarblock('BNB'), redSarblock('MATIC'), redSarblock('BTC')], ['TRON', 'BSC', 'POLYGON', null]);
  const d = new Date('2026-11-23T10:00:00Z');
  assertEquals(claveAnalisis('TRX', 'TAbc', false, d), 'kyt-TRX-tabc-2026-11-23');
  assert(claveAnalisis('TRX', 'TAbc', true, d).startsWith('kyt-TRX-tabc-2026-11-23-f'));
});

// La llave del 22 nov: válida para screening, sin permiso de wallets. Formas
// de la especificación de la Org API (ErrorResponse.details.requiredPermissions
// en un 403; MeResponse.apiKey.scopes como objeto por familia).
function llaveSinWallets() {
  return async (url: string, _init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/me')) return new Response(JSON.stringify({
      mode: 'live', organization: { id: 'o1', name: 'Lincoin', slug: 'lincoin' },
      apiKey: { id: 'k1', prefix: 'sb_org_', start: 'sb_org_ab12', scopes: { screening: ['create', 'read'], customers: ['read', 'write'] } },
    }), { status: 200 });
    if (u.pathname.endsWith('/usage')) return new Response(JSON.stringify({ credits: { totalRemaining: 180 }, screening: { totalRemaining: 999 } }), { status: 200 });
    return new Response(JSON.stringify({ statusCode: 403, type: 'ORG_API_FORBIDDEN', message: 'Missing permission', details: { requiredPermissions: ['wallets:analyze'] } }), { status: 403 });
  };
}

Deno.test('403 sin permiso de wallets: la referencia dice qué permiso falta', async () => {
  let ref = '', cod = '';
  try { await analizarYEsperar(llaveSinWallets(), 'k', { address: dir(1), network: 'ETH', idempotencia: 'x' }, 25000, sinEspera); }
  catch (e) { const m = motivoSarblock(e); ref = m.referencia ?? ''; cod = m.codigo; }
  assertEquals(cod, 'llave');
  assertEquals(ref, '403 · ORG_API_FORBIDDEN · falta wallets:analyze');
});

Deno.test('probar llave: lee scopes como objeto, créditos de credits, sin wallets', async () => {
  const p = await probarLlave(llaveSinWallets(), 'k');
  assertEquals(p.lectura.ok, false);
  assertEquals(p.analizar, false);
  assertEquals(p.permisos, ['screening:create', 'screening:read', 'customers:read', 'customers:write']);
  assertEquals(p.creditos, 180);
  assertEquals([p.modo, p.organizacion], ['live', 'Lincoin']);
});

Deno.test('probar llave: con wallets analyze y read', async () => {
  const f = async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/me')) return new Response(JSON.stringify({ mode: 'live', organization: { name: 'Lincoin' }, apiKey: { prefix: 'sb_org_', start: 'sb_org_ab12', scopes: { wallets: ['analyze', 'read', 'link'] } } }), { status: 200 });
    if (u.pathname.endsWith('/usage')) return new Response(JSON.stringify({ credits: { totalRemaining: 50 } }), { status: 200 });
    return new Response(JSON.stringify({ data: [], meta: { total: 0, page: 1, limit: 1, totalPages: 0 } }), { status: 200 });
  };
  const p = await probarLlave(f, 'k');
  assertEquals([p.lectura.ok, p.analizar, p.creditos], [true, true, 50]);
});
