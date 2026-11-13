// Pruebas de la cartera en Sarblock (cartera.ts) contra el Sarblock simulado.
// Sin red y sin gastar créditos.
//   ~/.deno/bin/deno test supabase/functions/sarblock/cartera.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ClienteSarblock } from './cliente.ts';
import { fetchSimulado, demoraSimulada } from './simulado.ts';
import { traducir } from './traductor.ts';
import * as K from './cartera.ts';

// Base falsa: solo lo que usa setRawPath (raw_data_set_path).
function baseFalsa() {
  const raw: Record<string, any> = {};
  return {
    raw,
    rpc: async (_n: string, a: any) => {
      let o = raw[a.p_user] ??= {};
      for (const k of a.p_path.slice(0, -1)) o = o[k] ??= {};
      o[a.p_path[a.p_path.length - 1]] = a.p_value;
      return { error: null };
    },
  };
}
// Cuenta las llamadas que cobran (crear screening).
function sbContado() {
  const n = { screenings: 0 };
  const sb = new ClienteSarblock('sb_org_prueba', async (url, init) => {
    if (init?.method === 'POST' && new URL(url).pathname.endsWith('/screening/checks')) n.screenings++;
    return fetchSimulado(url, init);
  });
  return { sb, n };
}
const empresa = (nit: string) => ({ id: 'e1', role: 'business', kyc_status: 'verified', company_name: 'ACME SAS', tax_id: nit, email: 'a@acme.co', rep_legal_name: 'Ada Lovelace', rep_doc_number: '123' });

Deno.test('cartera: datos de la cuenta', () => {
  const j = K.datosDeCuenta(empresa('900.123.451-8'));
  assert('datos' in j);
  assertEquals(j.datos.personType, 'juridica');
  assertEquals(j.datos.companyName, 'ACME SAS');
  const n = K.datosDeCuenta({ role: 'personal', doc_type: 'cc', doc_number: '1020', full_name: 'María Fernanda Ospina Ruiz' });
  assert('datos' in n);
  assertEquals([n.datos.tipoDocumento, n.datos.firstName, n.datos.lastName], ['CC', 'María Fernanda', 'Ospina Ruiz']);
  assert('motivo' in K.datosDeCuenta({ role: 'admin' }));
  assert('motivo' in K.datosDeCuenta({ role: 'business', company_name: 'X' }));
});

Deno.test('cartera: partir el nombre', () => {
  assertEquals(K.partirNombre('Ana Ruiz'), { firstName: 'Ana', lastName: 'Ruiz' });
  assertEquals(K.partirNombre('Ana Ruiz Gómez'), { firstName: 'Ana', lastName: 'Ruiz Gómez' });
  assertEquals(K.partirNombre('  '), null);
});

Deno.test('cartera: la empresa queda de cliente con el KYB en borrador, y no se paga dos veces', async () => {
  demoraSimulada(0);
  const db = baseFalsa();
  const { sb, n } = sbContado();
  // Sin proceso y sin permiso de pagar: no hace nada.
  assert('motivo' in await K.altaCliente(sb, db, 'e1', empresa('900123451'), false));
  assertEquals(n.screenings, 0);
  const e: any = await K.altaCliente(sb, db, 'e1', empresa('900123451'), true);
  assertEquals(e.fase, 'expediente');
  assert(e.customerId);
  assert(e.borradorGuardado);
  assertEquals(db.raw.e1.sarblock.kyc.customerId, e.customerId);
  assertEquals(db.raw.e1.sarblock.kyc.plantilla, undefined);
  assertEquals(n.screenings, 1);
  // Otra vuelta con el estado guardado: se retoma, no se cobra otro screening.
  const otra: any = await K.altaCliente(sb, db, 'e1', { ...empresa('900123451'), sb: db.raw.e1.sarblock }, true);
  assertEquals(otra.customerId, e.customerId);
  assertEquals(n.screenings, 1);
  assert(K.clienteListo(otra));
});

Deno.test('cartera: una empresa sancionada nace bloqueada y no recibe beneficiarios', async () => {
  demoraSimulada(0);
  const db = baseFalsa();
  const { sb } = sbContado();
  const e: any = await K.altaCliente(sb, db, 'e2', { ...empresa('900123457'), id: 'e2' }, true);
  assertEquals(e.fase, 'bloqueado');
  assertEquals(K.clienteListo(e), false);
});

async function fichaAml(sb: ClienteSarblock, doc: string, nombre: string) {
  const c = await sb.crearCheck({ purpose: 'beneficiary', subject: { schema: 'Person', idNumber: doc, documentType: 'CO-CC', fullName: nombre }, idempotencia: `t-${doc}` });
  return traducir(await sb.leerCheck(c.id), { documento: doc, tipoDocumento: 'CC', nombre });
}

Deno.test('cartera: el beneficiario queda bajo su empresa con la AML ya pagada', async () => {
  demoraSimulada(0);
  const db = baseFalsa();
  const { sb, n } = sbContado();
  const e: any = await K.altaCliente(sb, db, 'e3', { ...empresa('900123452'), id: 'e3' }, true);
  const ficha = await fichaAml(sb, '1020304050', 'María Fernanda Ospina Ruiz');
  const antes = n.screenings;
  assertEquals(K.beneficiariosPendientes({ '1020304050': ficha }, {}), ['1020304050']);
  const r = await K.registrarBeneficiario(sb, db, 'e3', e.customerId, '1020304050', ficha);
  assert(r?.id);
  assertEquals(n.screenings, antes);   // registrar no lanza otro screening
  assertEquals(db.raw.e3.sarblock.beneficiarios['1020304050'].id, r!.id);
  // Ya registrado: no se vuelve a llamar.
  assertEquals(await K.registrarBeneficiario(sb, db, 'e3', e.customerId, '1020304050', ficha, r!), null);
  assertEquals(K.beneficiariosPendientes({ '1020304050': ficha }, { '1020304050': r! }), []);
});

Deno.test('cartera: un beneficiario que Sarblock no deja registrar queda anotado y no se reintenta', async () => {
  demoraSimulada(0);
  const db = baseFalsa();
  const { sb } = sbContado();
  const e: any = await K.altaCliente(sb, db, 'e4', { ...empresa('900123453'), id: 'e4' }, true);
  const ficha = await fichaAml(sb, '1020304057', 'Juan Pérez');
  const r = await K.registrarBeneficiario(sb, db, 'e4', e.customerId, '1020304057', ficha);
  assertEquals(r?.definitivo, true);
  assert(String(r?.error).startsWith('BENEFICIARY_SCREENING_BLOCKED'));
  assertEquals(K.beneficiariosPendientes({ '1020304057': ficha }, { '1020304057': r! }), []);
});

Deno.test('cartera: fichas de TusDatos o sin terminar no se registran', () => {
  assertEquals(K.cuerpoBeneficiario('1', { proveedor: 'tusdatos', estado: 'finalizado' }), null);
  assertEquals(K.cuerpoBeneficiario('1', { proveedor: 'sarblock', estado: 'procesando', sarblock: { screeningRecordId: 'r' } }), null);
});

Deno.test('cartera: encender el alta automática fija la fecha desde la que aplica', () => {
  const a = K.normalizarConfigCartera(K.POR_DEFECTO_CARTERA, { activo: true, altaAutomatica: true });
  assert(a.altaDesde);
  const b = K.normalizarConfigCartera(a, { beneficiarios: false });
  assertEquals(b.altaDesde, a.altaDesde);   // no se corre al guardar otra cosa
  assertEquals(K.normalizarConfigCartera(b, { altaAutomatica: false }).altaDesde, null);
});

Deno.test('cartera: la persona consultada en Risk queda de cliente, una sola vez por documento', async () => {
  demoraSimulada(0);
  const { sb, n } = sbContado();
  const c = await sb.crearCheck({ purpose: 'customer_onboarding', subject: { schema: 'Person', idNumber: '1030405061', documentType: 'CO-CC', fullName: 'Ana Ruiz Gómez' }, idempotencia: 't-risk' });
  const ficha: any = traducir(await sb.leerCheck(c.id), { documento: '1030405061', tipoDocumento: 'CC', nombre: 'Ana Ruiz Gómez' });
  const actualizadas: any[] = [];
  const db = { from: () => ({ update: (v: any) => ({ eq: async () => { actualizadas.push(v); return { error: null }; } }) }) };
  const fila = { id: 'q1', user_id: 'e1', tipo_persona: 'natural', tipo_documento: 'CC', documento: '1030405061', nombre_escrito: 'Ana Ruiz Gómez' };
  const antes = n.screenings;
  const r = await K.registrarClienteRisk(sb, db, fila, ficha);
  assert(r?.id);
  assertEquals(n.screenings, antes);   // el alta no lanza otro screening
  assertEquals(actualizadas[0].ficha.sarblockCliente.id, r!.id);
  // Otra empresa consulta al mismo documento: se enlaza al cliente que ya existe.
  const otra = await K.registrarClienteRisk(sb, db, { ...fila, id: 'q2' }, ficha);
  assertEquals(otra?.id, r!.id);
  assertEquals(otra?.existia, true);
  // Ya anotado: no se llama otra vez.
  assertEquals(await K.registrarClienteRisk(sb, db, fila, { ...ficha, sarblockCliente: r }), null);
});
