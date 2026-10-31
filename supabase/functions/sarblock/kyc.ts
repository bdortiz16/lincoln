// ════════════════════════════════════════════════════════
// KYC / KYB del cliente con Sarblock.
//
// El orden lo impone Sarblock y no tiene atajos:
//   1. Screening del cliente (purpose customer_onboarding). COBRA.
//   2. Cuando termina, POST /customers con su screeningRecordId. La ficha
//      nace con el expediente KYC ya abierto, en el nivel que sale del
//      riesgo (SIMPLE, STANDARD o ENHANCED) y con su templateKey. Si el
//      screening pide bloquear, la ficha nace BLOCKED y el expediente
//      REJECTED: no hay datos que pedir.
//   3. La plantilla dice qué campos van (solo los rellenables).
//   4. Borrador por partes (PUT, se funde con lo guardado).
//   5. Envío (valida obligatorios) y estado: PENDING → APPROVED, o
//      REQUIRES_INFO con el motivo, o REJECTED.
//
// KYC y KYB son el mismo recurso: lo que cambia es el personType y, con
// él, la plantilla.
//
// El estado de este proceso se guarda en raw_data.sarblock.kyc del usuario,
// para poder retomarlo: el screening tarda y el cliente puede cerrar la
// pestaña en medio.
// ════════════════════════════════════════════════════════

import { ClienteSarblock, ErrorSarblock, sujetoDe } from './cliente.ts';
import { terminado } from './traductor.ts';

export type DatosCliente = {
  personType: 'natural' | 'juridica';
  tipoDocumento: string;          // CC, CE, PPT, PP, NIT
  documento: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  daneCityCode?: string;          // va al reporte UIAF
  legalRepresentativeName?: string;
  legalRepresentativeDocument?: string;
};

export type EstadoKyc = {
  fase: 'screening' | 'expediente' | 'enviado' | 'aprobado' | 'requiere_info' | 'rechazado' | 'bloqueado' | 'error';
  datos: DatosCliente;
  checkId?: string;
  screeningRecordId?: string | null;
  customerId?: string;
  clienteStatus?: string;
  blockSource?: string | null;
  templateKey?: string;
  nivel?: string;
  plantilla?: any;
  // Lo que ya sabemos del cliente, para no pedírselo dos veces.
  prellenado?: Record<string, unknown>;
  // La ficha llegó sin expediente abierto: el primer borrador lo abre.
  expedienteSinAbrir?: boolean;
  solicitud?: any;
  motivo?: string | null;
  error?: string;
  actualizado: string;
};

const ahora = () => new Date().toISOString();
const nombreDe = (d: DatosCliente) => d.personType === 'juridica' ? String(d.companyName ?? '') : `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();

// El cuerpo del alta. El documento y su tipo TIENEN que ser los del screening
// (si no, 400): por eso salen del mismo sujetoDe.
export function cuerpoCliente(d: DatosCliente, screeningRecordId: string) {
  const s = sujetoDe(d.tipoDocumento, d.documento, nombreDe(d));
  if (!s) throw new Error('Tipo de documento no soportado o falta el nombre / razón social.');
  return {
    screeningRecordId,
    personType: d.personType,
    ...(d.personType === 'juridica'
      ? { companyName: d.companyName, legalRepresentativeName: d.legalRepresentativeName || undefined, legalRepresentativeDocument: d.legalRepresentativeDocument || undefined }
      : { firstName: d.firstName, lastName: d.lastName }),
    documentType: s.documentType,
    documentNumber: s.idNumber,
    documentCountry: 'CO',
    country: 'CO',
    email: d.email || undefined,
    phone: d.phone || undefined,
    // Sin municipio el reporte UIAF sale con 01001 (SIN DEFINIR).
    daneCityCode: d.daneCityCode || undefined,
  };
}

// 1. Lanza el screening del cliente.
export async function iniciar(sb: ClienteSarblock, userId: string, d: DatosCliente): Promise<EstadoKyc> {
  const s = sujetoDe(d.tipoDocumento, d.documento, nombreDe(d));
  if (!s) return { fase: 'error', datos: d, error: 'Tipo de documento no soportado, o falta el nombre / la razón social.', actualizado: ahora() };
  const c = await sb.crearCheck({ purpose: 'customer_onboarding', subject: s, idempotencia: `kyc-${userId}-${s.idNumber}-${ahora().slice(0, 10)}` });
  return { fase: 'screening', datos: d, checkId: c.id, actualizado: ahora() };
}

// Avanza lo que se pueda sin intervención: screening → alta → plantilla, y
// relee el estado del expediente enviado. Idempotente: se puede llamar en
// cada vuelta de la pantalla.
export async function avanzar(sb: ClienteSarblock, e: EstadoKyc): Promise<EstadoKyc> {
  try {
    // Una ficha que ya existe se retoma: nunca se vuelve a pagar un
    // screening para un cliente que ya está dado de alta.
    if (e.fase === 'error' && e.customerId && !e.templateKey) {
      return await conFicha(sb, { ...e, error: undefined }, await sb.leerCliente(e.customerId));
    }
    // Screening terminado pero el alta falló: se reintenta el alta (gratis).
    if (e.fase === 'error' && e.checkId && !e.customerId) e = { ...e, fase: 'screening', error: undefined };
    if (e.fase === 'screening' && e.checkId) {
      const check = await sb.leerCheck(e.checkId);
      if (!terminado(check)) return e;
      if (check.status !== 'COMPLETED' || !check.screeningRecordId) return { ...e, fase: 'error', error: 'Sarblock no pudo completar el screening del cliente.', actualizado: ahora() };
      let ficha: any;
      try {
        ficha = await sb.crearCliente(cuerpoCliente(e.datos, check.screeningRecordId), `alta-${check.screeningRecordId}`);
      } catch (err) {
        // Ese documento ya tiene ficha: se retoma la existente.
        if (err instanceof ErrorSarblock && err.tipo === 'CUSTOMER_ALREADY_EXISTS' && (err.detalle as any)?.id) ficha = await sb.leerCliente((err.detalle as any).id);
        else throw err;
      }
      return await conFicha(sb, { ...e, screeningRecordId: check.screeningRecordId }, ficha);
    }
    if ((e.fase === 'enviado' || e.fase === 'requiere_info' || e.fase === 'expediente') && e.customerId) {
      const sol = await sb.leerKyc(e.customerId);
      return { ...e, solicitud: sol, ...faseDeSolicitud(sol), actualizado: ahora() };
    }
    return e;
  } catch (err) {
    if (err instanceof ErrorSarblock && err.status === 429) return e;   // la próxima vuelta
    return { ...e, fase: 'error', error: (err as Error).message, actualizado: ahora() };
  }
}

async function conFicha(sb: ClienteSarblock, e: EstadoKyc, ficha: any): Promise<EstadoKyc> {
  const base = { ...e, customerId: ficha.id, clienteStatus: ficha.status, blockSource: ficha.blockSource ?? null, templateKey: ficha.kyc?.templateKey, nivel: ficha.kyc?.level, motivo: ficha.kyc?.reason ?? null, actualizado: ahora() };
  // La ficha que nace bloqueada no espera datos: su expediente ya viene
  // rechazado, con el motivo.
  if (ficha.status === 'BLOCKED') return { ...base, fase: 'bloqueado' };
  const plantillas: any[] = await sb.plantillasKyc(ficha.id).then(p => Array.isArray(p) ? p : []);
  // Visto en la primera alta real (2026-10-27): la ficha llegó con
  // kyc: null aunque la organización SÍ tiene plantillas publicadas. La
  // documentación dice que el primer borrador abre el expediente, así que se
  // toma la plantilla del nivel que corresponde (o la simplificada) y se
  // sigue. Solo si no hay ninguna plantilla es un error de configuración.
  const tipo = ficha.personType === 'juridica' ? 'JURIDICA' : 'NATURAL';
  const nivel = ficha.kyc?.level ?? ficha.kycLevel ?? 'SIMPLE';
  const plantilla = plantillas.find(p => p.templateKey === ficha.kyc?.templateKey)
    ?? plantillas.find(p => p.level === nivel && String(p.templateKey).endsWith(tipo))
    ?? plantillas.find(p => String(p.templateKey).endsWith(tipo));
  if (!plantilla) return { ...base, fase: 'error', error: 'La organización no tiene plantilla KYC publicada para este tipo de persona.' };
  return {
    ...base, fase: 'expediente', plantilla, templateKey: plantilla.templateKey, nivel: plantilla.level,
    expedienteSinAbrir: !ficha.kyc, prellenado: prellenar(e.datos, plantilla),
  };
}

// Lo que la plantilla pide y ya sabemos por el alta. Solo claves que la
// plantilla trae: lo que no está en ella no se manda.
export function prellenar(d: DatosCliente, plantilla: any): Record<string, unknown> {
  const s = sujetoDe(d.tipoDocumento, d.documento, nombreDe(d));
  const conocido: Record<string, unknown> = {
    firstName: d.firstName?.trim(), lastName: d.lastName?.trim(), companyName: d.companyName?.trim(),
    documentType: s?.documentType, documentNumber: s?.idNumber,
    nationality: 'CO', residenceCountry: 'CO', country: 'CO',
    email: d.email?.trim(), phoneNumber: d.phone?.trim(),
    legalRepresentativeName: d.legalRepresentativeName?.trim(),
  };
  const claves = new Set((plantilla?.fields ?? []).map((f: any) => f.key));
  return Object.fromEntries(Object.entries(conocido).filter(([k, v]) => claves.has(k) && v !== undefined && v !== ''));
}

export function faseDeSolicitud(sol: any): Pick<EstadoKyc, 'fase' | 'motivo'> {
  switch (String(sol?.status ?? '')) {
    case 'APPROVED': return { fase: 'aprobado', motivo: null };
    case 'REJECTED': return { fase: 'rechazado', motivo: null };   // un rechazo no trae motivo por API
    case 'REQUIRES_INFO': return { fase: 'requiere_info', motivo: sol.reason ?? null };
    case 'PENDING': return { fase: 'enviado', motivo: null };
    default: return { fase: 'expediente', motivo: null };
  }
}

// 4. Guarda parte del expediente.
export async function guardar(sb: ClienteSarblock, e: EstadoKyc, valores: Record<string, unknown>): Promise<EstadoKyc> {
  if (!e.customerId || !e.templateKey) return { ...e, error: 'No hay expediente abierto.' };
  const sol = await sb.guardarBorradorKyc(e.customerId, { templateKey: e.templateKey, fieldValues: valores });
  return { ...e, solicitud: sol, expedienteSinAbrir: false, error: undefined, actualizado: ahora() };
}

// 5. Envía. Si faltan obligatorios, Sarblock dice cuáles (400 KYC_INVALID_FIELDS).
export async function enviar(sb: ClienteSarblock, e: EstadoKyc): Promise<EstadoKyc & { faltan?: string[] }> {
  if (!e.customerId) return { ...e, error: 'No hay expediente abierto.' };
  try {
    const sol = await sb.enviarKyc(e.customerId);
    return { ...e, solicitud: sol, ...faseDeSolicitud(sol), error: undefined, actualizado: ahora() };
  } catch (err) {
    if (err instanceof ErrorSarblock && err.tipo === 'KYC_INVALID_FIELDS') {
      const faltan = Array.isArray(err.detalle) ? (err.detalle as any[]).map(f => String(f.path)) : [];
      return { ...e, error: err.message, faltan, actualizado: ahora() };
    }
    throw err;
  }
}
