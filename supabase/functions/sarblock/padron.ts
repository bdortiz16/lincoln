// ════════════════════════════════════════════════════════
// Lincoin Risk — el padrón compartido de consultas (tabla risk_registry).
//
// Una fila por documento, compartida entre cuentas. Antes de pagar una
// consulta a Sarblock se mira acá: si hay un resultado de Sarblock de menos
// de 90 días, se reutiliza sin costo. Después de cada consulta pagada, el
// resultado queda acá para la siguiente cuenta que pregunte.
//
// Solo se reutilizan filas que hizo SARBLOCK (traen la ficha con el
// catálogo completo): las que dejó TusDatos no tienen ese detalle ni se
// juzgaron con la matriz de Lincoin, y no darían el mismo veredicto ni el
// mismo PDF.
//
// Lo que es de la PERSONA (antecedentes, nombre oficial) se reutiliza. Lo que
// es de cada INSCRIPCIÓN (si el nombre que escribió el cliente es el del
// documento) se vuelve a calcular cada vez, contra el nombre oficial.
//
// Solo lo toca el service_role (las edge functions); el cliente nunca ve
// el padrón ni un historial: solo el resultado de lo que consulta.
// ════════════════════════════════════════════════════════

export const VIGENCIA_DIAS = 90;

// La llave. Un NIT se guarda por sus 9 dígitos base: con o sin el dígito de
// verificación es el mismo documento (mismo criterio que tusdatos).
const PESOS_NIT = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
function dvNit(base: string): number | null {
  const d = String(base ?? '').replace(/\D/g, '');
  if (!d.length || d.length > 15) return null;
  let suma = 0;
  for (let i = 0; i < d.length; i++) suma += Number(d[d.length - 1 - i]) * PESOS_NIT[i];
  const r = suma % 11;
  return r > 1 ? 11 - r : r;
}
export const tipoPadron = (t?: string) => String(t ?? 'CC').toUpperCase().trim() || 'CC';
export function docPadron(doc: string, tipo?: string): string {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (tipoPadron(tipo) !== 'NIT' || d.length !== 10) return d;
  return dvNit(d.slice(0, 9)) === Number(d[9]) ? d.slice(0, 9) : d;
}

import { compararNombres } from './nombres.ts';
import { rejuzgar } from './traductor.ts';

// ¿El nombre escrito es el del documento? (igual o el mismo incompleto)
export function nombreCoincide(escrito: string | undefined, oficial: string | undefined): boolean | undefined {
  const c = compararNombres(escrito, oficial);
  return c === undefined ? undefined : c !== 'distinto';
}

// La ficha del padrón, juzgada otra vez para QUIEN pregunta ahora: con su
// nombre escrito contra el oficial y con la matriz vigente. Sale del
// catálogo guardado, sin llamar a Sarblock.
export function fichaParaCuenta(base: any, nombreEscrito?: string, extra: Record<string, unknown> = {}) {
  const documento = String(extra.documento ?? base?.documento ?? '');
  const tipoDocumento = String(extra.tipoDocumento ?? base?.tipoDocumento ?? 'CC');
  const r = rejuzgar(base, { documento, tipoDocumento, nombre: nombreEscrito || undefined }) ?? base;
  return { ...r, ...extra, ...(nombreEscrito ? { nombreInscrito: r.nombreInscrito ?? nombreEscrito } : {}) };
}

// ── Base de datos ───────────────────────────────────────────────────────
// Lo que el padrón tiene de Sarblock sobre un documento, si sigue vigente.
export async function buscar(db: any, tipo: string, doc: string, dias = VIGENCIA_DIAS): Promise<any | null> {
  const d = docPadron(doc, tipo);
  if (!d) return null;
  try {
    const { data } = await db.from('risk_registry').select('*').eq('doc_type', tipoPadron(tipo)).eq('doc_number', d).maybeSingle();
    if (!data?.ficha?.sarblock?.catalog || String(data.estado ?? '') !== 'finalizado') return null;
    const at = Date.parse(String(data.consultado_at ?? ''));
    if (!Number.isFinite(at) || Date.now() - at > dias * 86400_000) return null;
    return data;
  } catch { return null; }   // sin padrón se consulta como siempre
}

// Guarda lo que costó un crédito. `empresas` lleva quién usó la ficha: un
// reporte a la UIAF tiene que poder nombrar al reportante.
export async function guardar(db: any, tipo: string, doc: string, f: any, empresaId: string, fuente: 'sarblock' | 'manual') {
  const d = docPadron(doc, tipo);
  if (!d || f?.estado !== 'finalizado') return;
  try {
    const { data: previo } = await db.from('risk_registry').select('veces_consultado, veces_reutilizado, empresas')
      .eq('doc_type', tipoPadron(tipo)).eq('doc_number', d).maybeSingle();
    const empresas: string[] = Array.isArray(previo?.empresas) ? previo.empresas : [];
    if (empresaId && !empresas.includes(empresaId)) empresas.push(empresaId);
    // La ficha se guarda sin lo que es de la inscripción de una cuenta.
    const { nombreInscrito: _n, decisionManual: _d, historialDecisiones: _h, ...ficha } = f;
    const ahora = new Date().toISOString();
    await db.from('risk_registry').upsert({
      doc_type: tipoPadron(tipo), doc_number: d,
      nombre_real: f.nombreReal ?? null,
      categoria: f.categoria ?? null, operable: f.operable ?? null, estado: f.estado,
      altos: f.altos ?? 0, medios: f.medios ?? 0, bajos: f.bajos ?? 0,
      hallazgos: f.hallazgos ?? [], codigos: f.codigos ?? [], fuentes_con_error: f.fuentesConError ?? [],
      job_id: f.jobid ?? null, consultado_at: ahora, actualizado_at: ahora, fuente,
      veces_consultado: Number(previo?.veces_consultado ?? 0) + 1,
      veces_reutilizado: Number(previo?.veces_reutilizado ?? 0),
      empresas: empresas.slice(0, 200),
      ficha, criterio: f.criterio ?? null,
    }, { onConflict: 'doc_type,doc_number' });
  } catch { /* que el padrón falle no puede tumbar la consulta */ }
}

// Una empresa se ahorró la consulta: se cuenta y se anota quién la usó.
export async function anotarUso(db: any, tipo: string, doc: string, empresaId: string) {
  const d = docPadron(doc, tipo);
  if (!d) return;
  try {
    const { data: previo } = await db.from('risk_registry').select('veces_reutilizado, empresas')
      .eq('doc_type', tipoPadron(tipo)).eq('doc_number', d).maybeSingle();
    if (!previo) return;
    const empresas: string[] = Array.isArray(previo.empresas) ? previo.empresas : [];
    if (empresaId && !empresas.includes(empresaId)) empresas.push(empresaId);
    await db.from('risk_registry').update({ veces_reutilizado: Number(previo.veces_reutilizado ?? 0) + 1, empresas: empresas.slice(0, 200) })
      .eq('doc_type', tipoPadron(tipo)).eq('doc_number', d);
  } catch { /* sin anotar no pasa nada grave */ }
}
