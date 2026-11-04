// ════════════════════════════════════════════════════════
// Cartera en Sarblock: nuestras empresas como CLIENTES y sus beneficiarios
// como BENEFICIARIOS de cada una.
//
// Por qué: el 4 nov 2026 cumplimiento vio la pantalla Clientes de Sarblock
// en 0. Un screening no abre ninguna ficha (docs.sarblock.com → Screening):
// la ficha se crea aparte con su screeningRecordId. Hasta hoy solo
// mandábamos screenings, así que en Sarblock no había cartera, ni debida
// diligencia, ni re-evaluaciones, ni reporte UIAF de clientes.
//
//   Empresa  → screening customer_onboarding (COBRA 1 crédito) → POST
//              /customers → expediente KYB abierto en DRAFT con lo que ya
//              sabemos (kyc.ts). No se envía solo: cumplimiento lo completa
//              en Sarblock.
//   Beneficiario → con el screening de la AML que YA se pagó (purpose
//              beneficiary) → POST /customers/:id/beneficiaries, bajo la
//              empresa que le paga.
//
// Lincoin Risk NO entra a la cartera (decisión del dueño, 4 nov 2026): son
// terceros que consulta un cliente, no clientes ni beneficiarios de
// Lincoin; en Clientes saldrían en el reporte UIAF como si lo fueran.
//
// Estado: raw_data.sarblock.kyc (el de kyc.ts) y raw_data.sarblock.
// beneficiarios[doc] = { id | error }. Va aparte de la ficha AML
// (tusdatos.beneficiarios) porque esa se reescribe entera en cada consulta
// y se perdería el id: al volver a registrar saldría un duplicado.
// ════════════════════════════════════════════════════════
// deno-lint-ignore-file no-explicit-any

import { ClienteSarblock, ErrorSarblock, sujetoDe } from './cliente.ts';
import { iniciar, avanzar, guardar, type DatosCliente, type EstadoKyc } from './kyc.ts';
import { setRawPath } from '../_shared/raw-data.ts';

export const CONFIG_KEY_CARTERA = 'sarblock_cartera';
export type ConfigCartera = {
  // Apagada no se crea nada en Sarblock (ni clientes ni beneficiarios).
  activo: boolean;
  // Dar de alta sola a cada cuenta verificada creada desde `altaDesde`. Las
  // anteriores van por el botón o por lote: cada una cuesta un crédito.
  altaAutomatica: boolean;
  altaDesde: string | null;
  // Registrar solos los beneficiarios con AML terminada de las empresas que
  // ya son cliente en Sarblock.
  beneficiarios: boolean;
};
export const POR_DEFECTO_CARTERA: ConfigCartera = { activo: false, altaAutomatica: false, altaDesde: null, beneficiarios: true };

export async function leerConfigCartera(db: any): Promise<ConfigCartera> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', CONFIG_KEY_CARTERA).maybeSingle();
    return data?.value ? { ...POR_DEFECTO_CARTERA, ...JSON.parse(data.value) } : POR_DEFECTO_CARTERA;
  } catch { return POR_DEFECTO_CARTERA; }
}
export function normalizarConfigCartera(previa: ConfigCartera, c: any): ConfigCartera {
  const altaAutomatica = c?.altaAutomatica === undefined ? previa.altaAutomatica : !!c.altaAutomatica;
  return {
    activo: c?.activo === undefined ? previa.activo : !!c.activo,
    altaAutomatica,
    // Al encenderla queda la fecha: solo las cuentas nuevas desde ese
    // momento se dan de alta solas (encenderla no gasta en toda la base).
    altaDesde: altaAutomatica ? (previa.altaAutomatica && previa.altaDesde ? previa.altaDesde : new Date().toISOString()) : null,
    beneficiarios: c?.beneficiarios === undefined ? previa.beneficiarios : !!c.beneficiarios,
  };
}

// Las cuentas que son cliente de Lincoin: verificadas y no del equipo.
export const KYC_VERIFICADO = ['verified', 'approved'];
export const ROLES_CLIENTE = ['personal', 'business'];
export const COLS_CUENTA = 'id, role, kyc_status, created_at, email, phone, company_name, tax_id, first_name, last_name, full_name, name, doc_type, doc_number, rep_legal_name, rep_first_name, rep_last_name, rep_doc_number, rdEmpresa:raw_data->>companyName, rdNit:raw_data->>taxId, sb:raw_data->sarblock';

const limpio = (s: unknown) => String(s ?? '').trim();

// Nombre completo → nombre y apellido. Sarblock adopta el nombre oficial de
// la fuente al crear la ficha; esto solo llena los campos obligatorios. En
// Colombia: los dos últimos son los apellidos.
export function partirNombre(completo: unknown): { firstName: string; lastName: string } | null {
  const p = limpio(completo).split(/\s+/).filter(Boolean);
  if (!p.length) return null;
  if (p.length === 1) return { firstName: p[0], lastName: p[0] };
  const corte = p.length <= 3 ? 1 : p.length - 2;
  return { firstName: p.slice(0, corte).join(' '), lastName: p.slice(corte).join(' ') };
}

// De la fila de la cuenta a lo que pide el alta. Empresa → jurídica (NIT y
// razón social); persona → natural (cédula y nombre).
export function datosDeCuenta(u: any): { datos: DatosCliente } | { motivo: string } {
  if (!u || !['personal', 'business'].includes(String(u.role))) return { motivo: 'No es una cuenta de cliente.' };
  const email = limpio(u.email) || undefined, phone = limpio(u.phone) || undefined;
  if (u.role === 'business') {
    const companyName = limpio(u.company_name || u.rdEmpresa);
    const nit = limpio(u.tax_id || u.rdNit);
    if (!nit) return { motivo: 'La empresa no tiene NIT.' };
    if (!companyName) return { motivo: 'La empresa no tiene razón social.' };
    const rep = limpio(u.rep_legal_name) || `${limpio(u.rep_first_name)} ${limpio(u.rep_last_name)}`.trim();
    return { datos: { personType: 'juridica', tipoDocumento: 'NIT', documento: nit, companyName, email, phone,
      legalRepresentativeName: rep || undefined, legalRepresentativeDocument: limpio(u.rep_doc_number) || undefined } };
  }
  const doc = limpio(u.doc_number);
  if (!doc) return { motivo: 'La cuenta no tiene documento.' };
  const n = limpio(u.first_name) && limpio(u.last_name)
    ? { firstName: limpio(u.first_name), lastName: limpio(u.last_name) }
    : partirNombre(u.full_name || u.name);
  if (!n) return { motivo: 'La cuenta no tiene nombre.' };
  return { datos: { personType: 'natural', tipoDocumento: limpio(u.doc_type).toUpperCase() || 'CC', documento: doc, ...n, email, phone } };
}

// ── La empresa como cliente ─────────────────────────────────────────────
// Avanza todo lo que se pueda: screening → ficha → borrador del KYB con lo
// que ya sabemos. `pagar` permite lanzar el screening (1 crédito) si la
// cuenta todavía no tiene proceso; sin él, solo avanza lo que ya existe
// (gratis). Nunca se paga dos veces: un proceso con checkId se retoma.
export async function altaCliente(sb: ClienteSarblock, db: any, uid: string, u: any, pagar: boolean): Promise<EstadoKyc | { motivo: string }> {
  const previo: EstadoKyc | undefined = u?.sb?.kyc;
  let e: EstadoKyc;
  if (previo?.checkId || previo?.customerId) {
    e = await avanzar(sb, previo);
  } else {
    if (!pagar) return { motivo: 'La cuenta todavía no está en Sarblock.' };
    const d = datosDeCuenta(u);
    if ('motivo' in d) return d;
    e = await iniciar(sb, uid, d.datos);
    if (e.fase !== 'error') e = await avanzar(sb, e);
  }
  // El borrador del KYB, una vez, con lo que la plantilla pide y ya
  // sabemos. Si Sarblock lo rechaza no es grave: el expediente sigue
  // abierto y cumplimiento lo llena en Sarblock.
  if (e.fase === 'expediente' && e.prellenado && Object.keys(e.prellenado).length && !(e as any).borradorGuardado) {
    try { e = { ...(await guardar(sb, e, e.prellenado)), borradorGuardado: true } as EstadoKyc; } catch { /* queda para cumplimiento */ }
  }
  // La plantilla pesa y está en Sarblock: no se guarda en la cuenta.
  const { plantilla: _p, solicitud: _s, ...guardable } = e as any;
  await setRawPath(db, uid, ['sarblock', 'kyc'], guardable, false);
  return guardable;
}

// ¿Ya es cliente en Sarblock y puede tener beneficiarios?
export const clienteListo = (k: any) => !!k?.customerId && k?.clienteStatus !== 'BLOCKED' && k?.fase !== 'bloqueado';

// ── El beneficiario bajo su empresa ─────────────────────────────────────
export function cuerpoBeneficiario(doc: string, f: any): Record<string, unknown> | null {
  const rec = f?.sarblock?.screeningRecordId;
  if (!rec || f?.proveedor !== 'sarblock' || f?.estado !== 'finalizado') return null;
  const tipo = String(f.tipoDocumento ?? 'CC').toUpperCase();
  const nombre = limpio(f.nombreReal || f.nombreInscrito);
  const s = sujetoDe(tipo, doc, nombre);
  if (!s) return null;
  if (s.schema === 'Company') return { screeningRecordId: rec, beneficiaryType: 'JURIDICA', companyName: nombre, documentType: s.documentType, documentNumber: s.idNumber, country: 'CO' };
  const n = partirNombre(nombre);
  if (!n) return null;
  return { screeningRecordId: rec, beneficiaryType: 'NATURAL', ...n, documentType: s.documentType, documentNumber: s.idNumber, documentCountry: 'CO', country: 'CO' };
}

// Errores que no se arreglan reintentando: se anotan y no se vuelve a
// intentar (si no, cada vuelta del barrido llamaría otra vez).
const DEFINITIVOS = new Set(['BENEFICIARY_SCREENING_BLOCKED', 'INVALID_INPUT', 'VALIDATION_ERROR', 'CUSTOMER_NOT_ELIGIBLE', 'HTTP_404']);
const MAX_INTENTOS = 3;

export type RegistroBenef = { id?: string; screeningRecordId?: string; status?: string; isActive?: boolean; at: string; error?: string; definitivo?: boolean; intentos?: number };

// Registra UN beneficiario si toca. Devuelve lo anotado, o null si no había
// nada que hacer.
export async function registrarBeneficiario(sb: ClienteSarblock, db: any, uid: string, customerId: string, doc: string, f: any, previo?: RegistroBenef): Promise<RegistroBenef | null> {
  if (previo?.id || previo?.definitivo || Number(previo?.intentos ?? 0) >= MAX_INTENTOS) return null;
  const cuerpo = cuerpoBeneficiario(doc, f);
  if (!cuerpo) return null;
  let reg: RegistroBenef;
  try {
    const b = await sb.crearBeneficiario(customerId, cuerpo);
    reg = { id: String(b?.id ?? ''), screeningRecordId: String(cuerpo.screeningRecordId), status: b?.status, isActive: b?.isActive, at: new Date().toISOString() };
  } catch (e) {
    if (e instanceof ErrorSarblock && e.status === 429) throw e;   // la próxima vuelta
    const tipo = e instanceof ErrorSarblock ? e.tipo : 'ERROR';
    reg = { at: new Date().toISOString(), error: `${tipo}: ${String((e as Error)?.message ?? e).slice(0, 200)}`,
      definitivo: DEFINITIVOS.has(tipo), intentos: Number(previo?.intentos ?? 0) + 1 };
  }
  await setRawPath(db, uid, ['sarblock', 'beneficiarios', doc], reg, false);
  return reg;
}

// Los beneficiarios de una cuenta que faltan por registrar (con AML de
// Sarblock terminada y sin registro, o con error que se puede reintentar).
export function beneficiariosPendientes(fichas: Record<string, any>, registros: Record<string, RegistroBenef>): string[] {
  return Object.entries(fichas ?? {})
    .filter(([doc, f]) => {
      const r = registros?.[doc];
      return !r?.id && !r?.definitivo && Number(r?.intentos ?? 0) < MAX_INTENTOS && !!cuerpoBeneficiario(doc, f);
    })
    .map(([doc]) => doc);
}
