// Pruebas del núcleo Sarblock. Sin red y sin gastar créditos: las respuestas
// son las de ejemplo de docs.sarblock.com (screening y "Las fuentes").
//   ~/.deno/bin/deno test pruebas/sarblock/
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { ClienteSarblock, ErrorSarblock, sujetoDe, saldoScreening, claveIdempotencia } from './cliente.ts';
import { traducir, fichaLanzada, hayQueReintentar } from './traductor.ts';
import { firmar, verificarCallback } from './firma.ts';

// ── Fuentes de ejemplo (tal cual la documentación) ──────────────────────
const limpia = (code: string, label: string, category = 'SANCTIONS', restrictiva = true) => ({
  code, label, category, categoryLabel: 'Listas vinculantes internacionales', status: 'CLEAR', statusReason: null,
  isRestrictive: restrictiva, consulted: true, retryable: false, matched: false, matchCount: 0, hits: [], coverage: null,
});
const ofacMatch = {
  code: 'us_ofac_sdn', label: 'OFAC SDN', category: 'SANCTIONS', categoryLabel: 'Listas vinculantes internacionales',
  status: 'MATCH', statusReason: null, isRestrictive: true, consulted: true, retryable: false, matched: true, matchCount: 1,
  hits: [{ id: 'h1', matchedName: 'Ada Lovelace', score: 1, matchType: 'EXACT', matchedField: 'name_match' }], coverage: null,
};
const pepMatch = {
  code: 'co_funcion_publica', label: 'PEP Colombia — Función Pública', category: 'PEP', categoryLabel: 'Exposición política (PEP)',
  status: 'MATCH', statusReason: null, isRestrictive: false, consulted: true, retryable: false, matched: true, matchCount: 1, hits: [], coverage: null,
};
const ramaDemandante = {
  code: 'co_rama_judicial', label: 'Procesos Judiciales — Rama Judicial', category: 'COLOMBIA', categoryLabel: 'Antecedentes Colombia',
  status: 'CLEAR', statusReason: '3 procesos, ninguno con el cliente como parte pasiva · conteo mínimo',
  isRestrictive: false, consulted: true, retryable: false, matched: false, matchCount: 3, hits: [], coverage: { uniqueProcesses: 3, countIsMinimum: true },
};
const policiaCaida = {
  code: 'co_policia', label: 'Antecedentes Policía', category: 'COLOMBIA', categoryLabel: 'Antecedentes Colombia',
  status: 'UNAVAILABLE', statusReason: 'El proveedor no respondió', isRestrictive: false, consulted: true, retryable: true,
  matched: false, matchCount: 0, hits: [], coverage: null,
};

const check = (over: Record<string, unknown>) => ({
  id: '7c3f1a82-4be0-4a1d-9c55-2f6d0e91b7a3', status: 'COMPLETED', purpose: 'BENEFICIARY', aggregateOutcome: 'COMPLETED',
  customerId: null, screeningRecordId: '5e2d9f14-30c6-4a77-8f1b-9c0a2d4e6b58', catalogVersion: '2026-09-21',
  summary: { action: 'CLEAR', riskLevel: 'NONE', shouldBlock: false, blockReason: null, hasPepResult: false, totalHits: 0, matchedLists: 0, clearLists: 2, unavailableLists: 0, skippedLists: 0 },
  identity: { validated: true, verifiedName: 'ADA LOVELACE', declaredName: 'Ada Lovelace', spoofSuspected: false, nameSimilarity: 0.97 },
  catalog: [limpia('us_ofac_sdn', 'OFAC SDN'), limpia('un_sc_sanctions', 'Consejo de Seguridad ONU')],
  completedAt: '2026-09-18T04:12:55.310Z',
  ...over,
});
const benef = { documento: '10033310', tipoDocumento: 'CC', nombre: 'Ada Lovelace' };

// ── Traductor ────────────────────────────────────────────────────────────
Deno.test('limpio: se puede operar, sin hallazgos', () => {
  const f = traducir(check({}), benef);
  assertEquals(f.estado, 'finalizado');
  assertEquals(f.categoria, 'ninguno');
  assertEquals(f.operable, true);
  assertEquals(f.nombreReal, 'ADA LOVELACE');
  assertEquals(f.nombreCoincide, true);
  assertEquals(f.hallazgos, []);
  assertEquals(f.sarblock?.catalogVersion, '2026-09-21');
  assertEquals(f.bloqueo, undefined);
});

Deno.test('OFAC: alto, no operable, con el motivo', () => {
  const f = traducir(check({
    summary: { action: 'BLOCK', riskLevel: 'CRITICAL', shouldBlock: true, blockReason: 'Coincidencia en lista OFAC', matchedLists: 1, unavailableLists: 0 },
    catalog: [ofacMatch, limpia('un_sc_sanctions', 'Consejo de Seguridad ONU')],
  }), benef);
  assertEquals(f.categoria, 'alto');
  assertEquals(f.operable, false);
  assert(f.bloqueo?.startsWith('Riesgo alto: Coincidencia en lista restrictiva: OFAC SDN'));
  assertEquals(f.altos, 1);
  assertEquals(f.hallazgos?.[0], { nivel: 'alto', codigo: 'lista_restrictiva', texto: 'Coincidencia en lista restrictiva: OFAC SDN (Ada Lovelace)', fuente: 'OFAC SDN' });
  assertEquals(f.criterio, 'lincoin-v3-2026-10-30');
});

Deno.test('revisión solo por una fuente caída, sin coincidencias: NO es riesgo medio', () => {
  // Caso real del 2026-10-30: 0 coincidencias, 1 fuente caída, Sarblock pide
  // revisión (provider_error). Antes salía "riesgo medio".
  const f = traducir(check({
    identity: { validated: true, declaredName: 'ADA LOVELACE', verifiedName: 'ADA LOVELACE', spoofSuspected: false },
    summary: { action: 'HOLD_FOR_REVIEW', riskLevel: 'NONE', shouldBlock: false, blockReason: 'provider_error', matchedLists: 0, totalHits: 0, unavailableLists: 1 },
    aggregateOutcome: 'PARTIAL',
  }), benef);
  assert(f.categoria !== 'medio');
  assertEquals(f.operable, true);
  assertEquals(f.incompleta, true);
  assertEquals(f.bloqueo, undefined);
});

Deno.test('documento no encontrado en la Registraduría: se marca y no es riesgo medio', () => {
  const f = traducir(check({
    identity: { validated: false, vitalStatus: 'NOT_FOUND', declaredName: null, verifiedName: null, spoofSuspected: false },
    summary: { action: 'HOLD_FOR_REVIEW', riskLevel: 'NONE', shouldBlock: false, blockReason: 'provider_error', matchedLists: 0, totalHits: 0, unavailableLists: 1 },
    aggregateOutcome: 'PARTIAL',
  }), { documento: '9003978390', tipoDocumento: 'CC' });
  assertEquals(f.documentoNoEncontrado, true);
  assertEquals(f.categoria, 'sin_validar');
});

Deno.test('PEP: medio, sigue operable (la revisión la decide la config)', () => {
  const f = traducir(check({
    summary: { action: 'HOLD_FOR_REVIEW', riskLevel: 'MEDIUM', shouldBlock: false, hasPepResult: true, matchedLists: 1, unavailableLists: 0 },
    catalog: [pepMatch],
  }), benef);
  assertEquals(f.categoria, 'medio');
  assertEquals(f.operable, true);
  assertEquals(f.medios, 1);
  assertEquals(f.hallazgos?.[0].nivel, 'medio');
});

Deno.test('HOLD_FOR_REVIEW con nivel bajo sube a medio', () => {
  const f = traducir(check({ summary: { action: 'HOLD_FOR_REVIEW', riskLevel: 'LOW', shouldBlock: false, matchedLists: 0 } }), benef);
  assertEquals(f.categoria, 'medio');
});

Deno.test('Rama Judicial como demandante: no es coincidencia, cuenta como bajo', () => {
  const f = traducir(check({ catalog: [ramaDemandante] }), benef);
  assertEquals(f.hallazgos, []);
  assertEquals(f.bajos, 1);
  assertEquals(f.categoria, 'ninguno');
});

Deno.test('fuente caída: queda a la vista y se puede reintentar gratis', () => {
  const c = check({ aggregateOutcome: 'PARTIAL', summary: { action: 'CLEAR', riskLevel: 'NONE', shouldBlock: false, matchedLists: 0, unavailableLists: 1 }, catalog: [policiaCaida] });
  const f = traducir(c, benef);
  assertEquals(f.estado, 'finalizado');
  assertEquals(f.fuentesConError, ['Antecedentes Policía']);
  assert(f.detalle?.includes('no respondieron'));
  assert(hayQueReintentar(c));
});

Deno.test('suplantación: el nombre no corresponde y bloquea', () => {
  const f = traducir(check({ identity: { validated: true, verifiedName: 'OTRA PERSONA', declaredName: 'Ada Lovelace', spoofSuspected: true, nameSimilarity: 0.21 } }), benef);
  assertEquals(f.nombreCoincide, false);
  assertEquals(f.operable, false);
  assert(f.bloqueo?.includes('OTRA PERSONA'));
});

Deno.test('identidad sin validar y sin hallazgos: sin_validar, no bloquea', () => {
  const f = traducir(check({ identity: { validated: false, verifiedName: null, declaredName: 'Ada Lovelace', spoofSuspected: false, nameSimilarity: null } }), benef);
  assertEquals(f.categoria, 'sin_validar');
  assertEquals(f.operable, true);
});

Deno.test('en curso: sigue procesando (el envío espera)', () => {
  const f = traducir({ id: 'x', status: 'RUNNING' }, benef);
  assertEquals(f.estado, 'procesando');
  assertEquals(f.operable, undefined);
});

Deno.test('fallido: estado error, sin veredicto en contra', () => {
  const f = traducir({ id: 'x', status: 'FAILED' }, benef);
  assertEquals(f.estado, 'error');
  assertEquals(f.operable, undefined);
  assertEquals(f.categoria, undefined);
});

Deno.test('ficha lanzada nace procesando con el id del check', () => {
  const f = fichaLanzada({ ...benef, checkId: 'abc' });
  assertEquals(f.estado, 'procesando');
  assertEquals(f.jobid, 'abc');
});

// ── Sujeto y utilidades ──────────────────────────────────────────────────
Deno.test('sujeto: cédula es Person CO-CC, NIT es Company sin DV', () => {
  assertEquals(sujetoDe('CC', '1.020.304.050', 'Juan'), { schema: 'Person', idNumber: '1020304050', documentType: 'CO-CC', fullName: 'Juan' });
  assertEquals(sujetoDe('NIT', '901.799.579-5', 'XATECH SERVICES SAS'), { schema: 'Company', idNumber: '901799579', documentType: 'CO-NIT', fullName: 'XATECH SERVICES SAS' });
  assertEquals(sujetoDe('NIT', '901799579', ''), null); // empresa sin razón social: no se cobra
  assertEquals(sujetoDe('XX', '123'), null);
});

Deno.test('saldo y clave de idempotencia', () => {
  assertEquals(saldoScreening({ screening: { totalRemaining: 12 } }), 12);
  assertEquals(saldoScreening({ credits: { totalRemaining: 3 }, screening: {} }), 3);
  assertEquals(claveIdempotencia('u1', '123', new Date('2026-10-27T10:00:00Z')), 'benef-u1-123-2026-10-27');
});

// ── Cliente HTTP con fetch simulado ──────────────────────────────────────
Deno.test('cliente: manda x-api-key e idempotency-key al crear', async () => {
  let visto: { url: string; init?: RequestInit } | null = null;
  const c = new ClienteSarblock('sb_org_prueba', async (url, init) => {
    visto = { url, init };
    return new Response(JSON.stringify({ id: 'c1', status: 'QUEUED', purpose: 'BENEFICIARY' }), { status: 202 });
  });
  const r = await c.crearCheck({ purpose: 'beneficiary', subject: sujetoDe('CC', '123', 'A')!, idempotencia: 'k1' });
  assertEquals(r.id, 'c1');
  const h = visto!.init!.headers as Record<string, string>;
  assertEquals(visto!.url, 'https://api.sarblock.com/api/org/v1/screening/checks');
  assertEquals(h['x-api-key'], 'sb_org_prueba');
  assertEquals(h['idempotency-key'], 'k1');
});

Deno.test('cliente: sin saldo es un ErrorSarblock 403 con su tipo', async () => {
  const c = new ClienteSarblock('sb_org_prueba', async () =>
    new Response(JSON.stringify({ statusCode: 403, type: 'INSUFFICIENT_SCREENING_BALANCE', message: 'Insufficient screening balance' }), { status: 403 }));
  const e = await assertRejects(() => c.crearCheck({ purpose: 'beneficiary', subject: sujetoDe('CC', '1')!, idempotencia: 'k' }), ErrorSarblock);
  assertEquals(e.status, 403);
  assertEquals(e.tipo, 'INSUFFICIENT_SCREENING_BALANCE');
});

Deno.test('cliente: el 429 trae el retry-after', async () => {
  const c = new ClienteSarblock('sb_org_prueba', async () =>
    new Response(JSON.stringify({ statusCode: 429, type: 'TOO_MANY_REQUESTS', message: 'despacio' }), { status: 429, headers: { 'retry-after': '17' } }));
  const e = await assertRejects(() => c.leerCheck('x'), ErrorSarblock);
  assertEquals(e.retryAfter, 17);
});

Deno.test('cliente: rechaza una key que no es de organización', () => {
  let fallo = false;
  try { new ClienteSarblock('sk_otra'); } catch { fallo = true; }
  assert(fallo);
});

// ── Firma de callbacks ───────────────────────────────────────────────────
const SECRETO = 'sbcb_' + 'a'.repeat(64);
const CUERPO = '{"checkId":"7c3f1a82-4be0-4a1d-9c55-2f6d0e91b7a3","status":"COMPLETED","completedAt":null}';

Deno.test('firma válida', async () => {
  const ts = '1789718400';
  assert(await verificarCallback(CUERPO, await firmar(SECRETO, ts, CUERPO), ts, [SECRETO], 1789718400 + 10));
});

Deno.test('firma vencida (más de 5 minutos)', async () => {
  const ts = '1789718400';
  assertEquals(await verificarCallback(CUERPO, await firmar(SECRETO, ts, CUERPO), ts, [SECRETO], 1789718400 + 301), false);
});

Deno.test('cuerpo alterado', async () => {
  const ts = '1789718400';
  const firma = await firmar(SECRETO, ts, CUERPO);
  assertEquals(await verificarCallback(CUERPO.replace('COMPLETED', 'FAILED'), firma, ts, [SECRETO], 1789718400), false);
});

Deno.test('rotación: acepta el secreto anterior', async () => {
  const ts = '1789718400';
  const viejo = 'sbcb_' + 'b'.repeat(64);
  assert(await verificarCallback(CUERPO, await firmar(viejo, ts, CUERPO), ts, [SECRETO, viejo], 1789718400));
});

Deno.test('sin cabeceras: rechaza', async () => {
  assertEquals(await verificarCallback(CUERPO, null, null, [SECRETO]), false);
});

// ── KYC del cliente contra el Sarblock simulado ─────────────────────────
import { fetchSimulado, demoraSimulada } from './simulado.ts';
import { iniciar, avanzar, guardar, enviar, cuerpoCliente } from './kyc.ts';

const persona = (doc: string) => ({ personType: 'natural' as const, tipoDocumento: 'CC', documento: doc, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', daneCityCode: '05001' });
const completo = { fullName: 'Ada Lovelace', dateOfBirth: '1990-12-10', occupation: 'INDEPENDIENTE', monthlyIncome: 5000000, fundsOrigin: 'Honorarios', isPep: false, acceptedTerms: true, authorizedVerification: true };

Deno.test('KYC: alta con el documento del screening', () => {
  const c = cuerpoCliente({ ...persona('1.002.003.001') }, 'rec-1');
  assertEquals(c.documentType, 'CO-CC');
  assertEquals(c.documentNumber, '1002003001');
  assertEquals(c.personType, 'natural');
  assertEquals((c as any).firstName, 'Ada');
});

Deno.test('KYC: screening → ficha → plantilla → borrador → envío → aprobado', async () => {
  demoraSimulada(0);
  const sb = new ClienteSarblock('sb_org_prueba', fetchSimulado);
  let e = await iniciar(sb, 'u1', persona('20000001'));
  assertEquals(e.fase, 'screening');
  e = await avanzar(sb, e);
  assertEquals(e.fase, 'expediente');
  assertEquals(e.nivel, 'SIMPLE');
  assert(e.plantilla.fields.some((f: any) => f.key === 'occupation'));
  // Envío incompleto: Sarblock dice qué falta.
  e = await guardar(sb, e, { fullName: 'Ada Lovelace' });
  const incompleto = await enviar(sb, e);
  assert(incompleto.faltan?.includes('occupation'));
  e = await guardar(sb, incompleto, completo);
  e = await enviar(sb, e);
  // Con demora 0 el simulado revisa al instante: puede llegar ya aprobado.
  assert(e.fase === 'enviado' || e.fase === 'aprobado');
  e = await avanzar(sb, e);
  assertEquals(e.fase, 'aprobado');
});

Deno.test('KYC: sancionado nace bloqueado y sin expediente que llenar', async () => {
  demoraSimulada(0);
  const sb = new ClienteSarblock('sb_org_prueba', fetchSimulado);
  const e = await avanzar(sb, await iniciar(sb, 'u2', persona('30000007')));
  assertEquals(e.fase, 'bloqueado');
  assertEquals(e.blockSource, 'SCREENING_SANCTIONS');
});

Deno.test('KYC: PEP abre debida diligencia estándar con campos extra', async () => {
  demoraSimulada(0);
  const sb = new ClienteSarblock('sb_org_prueba', fetchSimulado);
  const e = await avanzar(sb, await iniciar(sb, 'u3', persona('40000006')));
  assertEquals(e.nivel, 'STANDARD');
  assert(e.plantilla.fields.some((f: any) => f.key === 'pepPosition'));
});

Deno.test('KYC: cumplimiento pide más datos (REQUIRES_INFO con motivo)', async () => {
  demoraSimulada(0);
  const sb = new ClienteSarblock('sb_org_prueba', fetchSimulado);
  let e = await avanzar(sb, await iniciar(sb, 'u4', persona('50000005')));
  e = await guardar(sb, e, completo);
  e = await enviar(sb, e);
  assertEquals(e.fase, 'requiere_info');
  assert(String(e.motivo).includes('origen de los fondos'));
});

// ── Fuentes "en curso" (visto en la primera consulta real) ──────────────
import { enCurso, releerFicha } from './traductor.ts';
const policiaEnCurso = { ...policiaCaida, retryable: false, statusReason: 'Consulta en curso en la fuente oficial: el resultado se añadirá al llegar' };

Deno.test('fuente en curso: no se reintenta, la ficha queda para releer', () => {
  const c = check({ aggregateOutcome: 'PARTIAL', summary: { action: 'MONITOR', riskLevel: 'LOW', shouldBlock: false, blockReason: 'provider_error', matchedLists: 0, unavailableLists: 1 }, catalog: [policiaEnCurso] });
  assertEquals(enCurso(c), 1);
  assertEquals(hayQueReintentar(c), false);
  const f = traducir(c, benef);
  assertEquals(f.fuentesEnCurso, 1);
  assertEquals(f.categoria, 'bajo');
  assertEquals(f.operable, true);       // blockReason sin shouldBlock no bloquea
  assertEquals(f.bloqueo, undefined);
  assert(releerFicha({ ...f, lanzadoAt: new Date().toISOString() }));
  // Pasadas 24 h se da por perdida y no se relee más.
  assertEquals(releerFicha({ ...f, lanzadoAt: new Date(Date.now() - 25 * 3600e3).toISOString() }), false);
});

Deno.test('ficha vieja sin fuentesEnCurso: se deduce del catálogo guardado', () => {
  const f = traducir(check({ aggregateOutcome: 'PARTIAL', catalog: [policiaEnCurso] }), benef);
  const { fuentesEnCurso: _x, ...vieja } = f;
  assert(releerFicha({ ...vieja, at: new Date().toISOString() }));
});

Deno.test('al completarse, la ficha queda sin fuentes en curso', () => {
  const f = traducir(check({ catalog: [{ ...policiaEnCurso, status: 'CLEAR', statusReason: null }] }), benef);
  assertEquals(f.fuentesEnCurso, undefined);
  assertEquals(f.fuentesConError, []);
  assertEquals(releerFicha({ ...f, lanzadoAt: new Date().toISOString() }), false);
});

// ── Matriz de riesgo de Lincoin (aprobada 2026-10-27) ───────────────────
import { reglasLincoin } from './traductor.ts';
const proceso = (branch: string, partySide: string, court = 'JUZGADO 003 PENAL MUNICIPAL DE MEDELLÍN') =>
  ({ id: 'j', matchedName: 'SERGIO ANDRES GARCIA\r\n\t\tALZATE', score: 1, matchType: 'PROVIDER_CHECK', matchedField: 'Partes del proceso',
     judicial: { processKey: '052126000201200904949', branch, court, partySide, startDate: '2009-11-15', lastActionDate: null } });
const rama = (hits: any[], matched = true) => ({
  code: 'co_rama_judicial', label: 'Procesos Judiciales — Rama Judicial', category: 'COLOMBIA', categoryLabel: 'Antecedentes Colombia',
  status: matched ? 'MATCH' : 'CLEAR', statusReason: `${hits.filter(h => h.judicial.partySide === 'pasiva').length} de ${hits.length} procesos con el cliente como parte pasiva`,
  isRestrictive: false, consulted: true, retryable: false, matched, matchCount: hits.length, hits, coverage: null,
});
const bajoSarblock = { action: 'MONITOR', riskLevel: 'LOW', shouldBlock: false, blockReason: 'provider_error', matchedLists: 1, unavailableLists: 0 };

Deno.test('caso real CC 75104651: penal como parte pasiva → alto y bloqueado, aunque Sarblock diga LOW', () => {
  const f = traducir(check({ summary: bajoSarblock, catalog: [rama([proceso('civil', 'pasiva', 'JUZGADO 001 CIVIL DE MANIZALES'), proceso('penal', 'pasiva'), proceso('familia', 'pasiva', 'JUZGADO 003 DE FAMILIA DE MANIZALES')])] }), benef);
  assertEquals(f.categoria, 'alto');
  assertEquals(f.operable, false);
  assertEquals(f.altos, 1);
  assertEquals(f.medios, 2);
  assertEquals(f.hallazgos?.[0].nivel, 'alto');                       // lo alto primero
  assert(f.hallazgos?.[0].texto.includes('proceso penal'));
  assert(f.hallazgos?.[0].texto.includes('radicado 052126000201200904949'));
  assert(f.bloqueo?.startsWith('Riesgo alto: Parte pasiva en proceso penal'));
});

Deno.test('extinción de dominio como parte pasiva → alto', () => {
  const m = reglasLincoin([rama([proceso('extincion_de_dominio', 'pasiva')])]);
  assertEquals(m[0].nivel, 'alto');
  assert(m[0].texto.includes('extincion de dominio'));
});

Deno.test('civil o familia como parte pasiva → medio, en revisión', () => {
  const f = traducir(check({ summary: bajoSarblock, catalog: [rama([proceso('civil', 'pasiva', 'JUZGADO 001 CIVIL')])] }), benef);
  assertEquals(f.categoria, 'medio');
  assertEquals(f.operable, true);                                     // el medio lo frena la configuración actual
  assert(f.bloqueo?.startsWith('En revisión de cumplimiento: Parte pasiva en proceso civil'));
});

Deno.test('penal como DEMANDANTE no cuenta (solo pesa la parte pasiva)', () => {
  const f = traducir(check({ catalog: [rama([proceso('penal', 'activa')], false)] }), benef);
  assertEquals(f.altos, 0);
  assertEquals(f.categoria, 'ninguno');
});

Deno.test('antecedentes de Policía con coincidencia → alto', () => {
  const pol = { ...policiaCaida, status: 'MATCH', matched: true, retryable: false, statusReason: 'Registra antecedentes', matchCount: 1 };
  const f = traducir(check({ summary: bajoSarblock, catalog: [pol] }), benef);
  assertEquals(f.categoria, 'alto');
  assertEquals(f.operable, false);
  assert(f.hallazgos?.[0].texto.startsWith('Antecedentes Policía: registra antecedentes'));
});

Deno.test('prensa: EXTREMO + CONFIRMADA → alto; EXTREMO + POSIBLE o MEDIO → medio; DESCARTADO no cuenta', () => {
  const prensa = (hits: any[]) => ({ code: 'adverse_media_serper', label: 'Noticias adversas (fuentes públicas)', category: 'ADVERSE_MEDIA', categoryLabel: 'Noticias adversas', status: 'MATCH', statusReason: null, isRestrictive: false, consulted: true, retryable: false, matched: true, matchCount: hits.length, hits, coverage: null });
  const n = (severity: string, identityConfidence: string) => ({ id: 'n', matchedName: 'X', score: 0.9, matchType: 'PROVIDER_CHECK', matchedField: 'Noticia adversa', severity, identityConfidence, sourceUrl: 'https://example.com/n', categories: ['judicial'] });
  assertEquals(reglasLincoin([prensa([n('EXTREMO', 'CONFIRMADA')])])[0].nivel, 'alto');
  assertEquals(reglasLincoin([prensa([n('ALTO', 'PROBABLE')])])[0].nivel, 'alto');
  assertEquals(reglasLincoin([prensa([n('EXTREMO', 'POSIBLE')])])[0].nivel, 'medio');
  assertEquals(reglasLincoin([prensa([n('MEDIO', 'CONFIRMADA')])])[0].nivel, 'medio');
  assertEquals(reglasLincoin([prensa([n('DESCARTADO', 'CONFIRMADA')])]).length, 0);
});

Deno.test('PEP → medio con el motivo escrito', () => {
  const m = reglasLincoin([pepMatch]);
  assertEquals(m, [{ nivel: 'medio', regla: 'pep', fuente: 'PEP Colombia — Función Pública', texto: 'Persona expuesta políticamente: PEP Colombia — Función Pública' }]);
});

// ── Lincoin Risk (padrón) ───────────────────────────────────────────────
import { docPadron, tipoPadron, nombreCoincide, fichaParaCuenta } from './padron.ts';

Deno.test('padrón: un NIT con o sin DV es el mismo documento', () => {
  assertEquals(docPadron('901799579-1', 'NIT'), '901799579');
  assertEquals(docPadron('901799579-5', 'NIT'), '9017995795');   // DV que no cuadra: se deja tal cual
  assertEquals(docPadron('901799579', 'nit'), '901799579');
  assertEquals(docPadron('1.020.304.050', 'CC'), '1020304050');
  assertEquals(tipoPadron('cc'), 'CC');
});

Deno.test('padrón: el nombre escrito se compara contra el oficial', () => {
  assertEquals(nombreCoincide('Juan Perez', 'JUAN PÉREZ GÓMEZ'), true);
  assertEquals(nombreCoincide('Kevin Fernando Echeverri R', 'KEVIN FERNANDO ECHEVERRI RODRIGUEZ'), true);
  assertEquals(nombreCoincide('María Ospina', 'JUAN PÉREZ GÓMEZ'), false);
  assertEquals(nombreCoincide('Xatech Services SAS', 'XATECH SERVICES S.A.S'), true);
  assertEquals(nombreCoincide('', 'JUAN'), undefined);
});

Deno.test('padrón: reutilizar con otro nombre que no corresponde bloquea', () => {
  const base = traducir(check({}), benef);   // ADA LOVELACE, limpio
  const ok = fichaParaCuenta(base, 'Ada Lovelace');
  assertEquals(ok.operable, true);
  assertEquals(ok.nombreCoincide, true);
  const malo = fichaParaCuenta(base, 'Pedro Pérez');
  assertEquals(malo.operable, false);
  assertEquals(malo.nombreCoincide, false);
  assert(String(malo.bloqueo).includes('ADA LOVELACE'));
  assertEquals(fichaParaCuenta(base, undefined).operable, true);   // sin nombre no se juzga
});

// ── Nombre incompleto: el documento manda ──────────────────────────────
import { compararNombres } from './nombres.ts';

Deno.test('nombres: igual, incompleto o distinto', () => {
  assertEquals(compararNombres('Ada Lovelace', 'ADA LOVELACE'), 'igual');
  assertEquals(compararNombres('JEISY URREA', 'JEISSY TATIANA URREA RAMIREZ'), 'incompleto');     // caso real
  assertEquals(compararNombres('Kevin Fernando Echeverri R', 'KEVIN FERNANDO ECHEVERRI RODRIGUEZ'), 'incompleto');
  assertEquals(compararNombres('Juan Perez', 'JUAN PÉREZ GÓMEZ'), 'incompleto');
  assertEquals(compararNombres('María Ospina', 'JUAN PÉREZ GÓMEZ'), 'distinto');
  assertEquals(compararNombres('Juan Perez Lopez', 'JUAN PÉREZ GÓMEZ'), 'distinto');             // una palabra ajena
  assertEquals(compararNombres('Juan', 'JUAN PÉREZ GÓMEZ'), 'distinto');                         // una sola palabra no alcanza
  assertEquals(compararNombres('', 'JUAN'), undefined);
});

Deno.test('caso real CC 43689692: Sarblock dice suplantación, es el mismo nombre incompleto → no bloquea', () => {
  const f = traducir(check({
    summary: { action: 'HOLD_FOR_REVIEW', riskLevel: 'MEDIUM', shouldBlock: false, blockReason: 'identity_spoof_suspected', hasPepResult: false, matchedLists: 0, unavailableLists: 0 },
    identity: { validated: true, declaredName: 'JEISY URREA', verifiedName: 'JEISSY TATIANA URREA RAMIREZ', spoofSuspected: true, nameSimilarity: 0.39 },
  }), { documento: '43689692', tipoDocumento: 'CC', nombre: 'JEISY URREA' });
  assertEquals(f.nombreCoincide, true);
  assertEquals(f.nombreIncompleto, true);
  assertEquals(f.nombreReal, 'JEISSY TATIANA URREA RAMIREZ');
  assertEquals(f.operable, true);
  assertEquals(f.categoria, 'ninguno');
  assertEquals(f.bloqueo, undefined);
});

Deno.test('otra persona: bloquea y el motivo queda escrito como hallazgo', () => {
  const f = traducir(check({
    summary: { action: 'HOLD_FOR_REVIEW', riskLevel: 'MEDIUM', shouldBlock: false, blockReason: 'identity_spoof_suspected', matchedLists: 0, unavailableLists: 0 },
    identity: { validated: true, declaredName: 'MARIA OSPINA', verifiedName: 'JEISSY TATIANA URREA RAMIREZ', spoofSuspected: true, nameSimilarity: 0.1 },
  }), { documento: '43689692', tipoDocumento: 'CC', nombre: 'MARIA OSPINA' });
  assertEquals(f.nombreCoincide, false);
  assertEquals(f.operable, false);
  assertEquals(f.hallazgos?.[0].codigo, 'identidad');
  assert(f.hallazgos?.[0].texto.includes('JEISSY TATIANA URREA RAMIREZ'));
});

Deno.test('rejuzgar: una ficha de la matriz anterior se recalcula sin llamar a Sarblock', async () => {
  const { rejuzgar } = await import('./traductor.ts');
  const vieja = { ...traducir(check({ identity: { validated: true, declaredName: 'JEISY URREA', verifiedName: 'JEISSY TATIANA URREA RAMIREZ', spoofSuspected: true, nameSimilarity: 0.39 },
    summary: { action: 'HOLD_FOR_REVIEW', riskLevel: 'MEDIUM', shouldBlock: false, blockReason: 'identity_spoof_suspected', matchedLists: 0, unavailableLists: 0 } }), { documento: '43689692', tipoDocumento: 'CC', nombre: 'JEISY URREA' }),
    criterio: 'lincoin-v1-2026-10-27', operable: false, nombreCoincide: false };
  const nueva = rejuzgar(vieja, { documento: '43689692', tipoDocumento: 'CC', nombre: 'JEISY URREA' });
  assertEquals(nueva?.operable, true);
  assertEquals(nueva?.criterio, 'lincoin-v3-2026-10-30');
});

// ── Lincoin Risk prepago ────────────────────────────────────────────────
import * as Risk from './risk.ts';

Deno.test('risk: precio con IVA y compra mínima desde la configuración', () => {
  const cfg = Risk.normalizarConfig(Risk.CONFIG_INICIAL, { precioPorConsulta: 3500, ivaPct: 19, minimoCompra: 300 });
  assertEquals(Risk.cotizar(cfg, 300), { cantidad: 300, precioUnit: 3500, subtotal: 1_050_000, iva: 199_500, total: 1_249_500 });
  assertEquals(Risk.validarCompra(cfg, 299, 'COP_ACH', 9e9), 'La compra mínima es de 300 consultas.');
  assertEquals(Risk.validarCompra(cfg, 300, 'COP_ACH', 1_249_499), 'No tienes saldo suficiente en ese bolsillo.');
  assertEquals(Risk.validarCompra(cfg, 300, 'COP_ACH', 1_249_500), null);
  // Coincenda queda listo pero apagado.
  assertEquals(Risk.validarCompra(cfg, 300, 'COP_COINCENDA', 9e9), 'Ese medio de pago no está disponible.');
  // Sin precio definido no se vende.
  assertEquals(Risk.validarCompra(Risk.CONFIG_INICIAL, 300, 'COP_ACH', 9e9), 'El precio de las consultas todavía no está definido.');
});

Deno.test('risk: la configuración ignora valores inválidos', () => {
  const c = Risk.normalizarConfig(Risk.CONFIG_INICIAL, { precioPorConsulta: -5, minimoCompra: 0, vigenciaDias: '', ivaPct: 'x', bolsillos: { COP_BREB: { activo: false }, OTRO: { activo: true } } });
  assertEquals(c.precioPorConsulta, 0);
  assertEquals(c.minimoCompra, 1);
  assertEquals(c.vigenciaDias, 90);
  assertEquals(c.ivaPct, 0);
  assertEquals(c.bolsillos.COP_BREB.activo, false);
  assertEquals('OTRO' in c.bolsillos, false);
});

Deno.test('risk: vencimiento a color', () => {
  const cfg = Risk.CONFIG_INICIAL;
  const hace = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
  assertEquals(Risk.vencimiento(cfg, hace(0)).estado, 'vigente');
  assertEquals(Risk.vencimiento(cfg, hace(65)).estado, 'pronto');
  assertEquals(Risk.vencimiento(cfg, hace(85)).estado, 'critico');
  assertEquals(Risk.vencimiento(cfg, hace(91)).estado, 'vencida');
});

Deno.test('risk: tipos de riesgo y despachos solo de parte pasiva', () => {
  const ficha = {
    hallazgos: [{ regla: 'rama_penal_pasiva' }, { regla: 'pep' }],
    sarblock: { catalog: [{ code: 'co_rama_judicial', hits: [
      { judicial: { partySide: 'PASIVA', court: 'JUZGADO 003 DE FAMILIA DE MANIZALES' } },
      { judicial: { partySide: 'ACTIVA', court: 'JUZGADO 001 PROMISCUO MUNICIPAL DE FILADELFIA' } },
    ] }] },
  };
  assertEquals(Risk.tiposDeRiesgo(ficha).sort(), ['judicial', 'pep']);
  assertEquals(Risk.tiposDeRiesgo({ hallazgos: [] }), ['ninguno']);
  assertEquals(Risk.tiposDeRiesgo({ hallazgos: [], nombreCoincide: false }), ['identidad']);
  assertEquals(Risk.despachos(ficha), ['JUZGADO 003 DE FAMILIA DE MANIZALES']);
});
