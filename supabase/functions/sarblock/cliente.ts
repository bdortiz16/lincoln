// ════════════════════════════════════════════════════════
// Cliente de la Org API de Sarblock (https://docs.sarblock.com)
//
// Una key (`sb_org_…`) en la cabecera x-api-key, y nada más: sin OAuth ni
// tokens que caduquen. La key vive en el servidor; nunca en el navegador.
//
// Lo que cuesta créditos: crear un check y el rescreen. Leer, el retry de
// fuentes caídas, los catálogos y el consumo son gratis. Por eso las rutas
// que cobran mandan siempre una idempotency-key: un doble clic o un
// reintento tras un timeout devuelve el check que ya existía, no otro.
//
// El fetch se inyecta para poder probar sin red y sin gastar créditos.
// ════════════════════════════════════════════════════════

export const SARBLOCK_URL = 'https://api.sarblock.com/api/org/v1';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// El error de Sarblock tiene la misma forma en todas las rutas. `type` es el
// contrato (para ramificar); `message` es para una persona y puede cambiar.
export class ErrorSarblock extends Error {
  constructor(
    public status: number,
    public tipo: string,
    mensaje: string,
    public retryAfter: number | null = null,
    public detalle: unknown = null,
  ) { super(mensaje); }
}

// ── Tipos de documento ───────────────────────────────────────────────────
// Los nuestros (los del formulario de beneficiarios) contra el catálogo de
// Sarblock, leído de GET /catalogs/identity-document-types el 2026-10-27.
// El tipo decide el `schema` (Person o Company) y qué fuentes aplican: una
// cédula mandada como empresa —o un NIT como persona— es un 400.
const TIPOS: Record<string, { id: string; schema: 'Person' | 'Company' }> = {
  CC: { id: 'CO-CC', schema: 'Person' },
  CE: { id: 'CO-CE', schema: 'Person' },
  PPT: { id: 'CO-PPT', schema: 'Person' },
  PP: { id: 'CO-PAS', schema: 'Person' },
  PAS: { id: 'CO-PAS', schema: 'Person' },
  NIT: { id: 'CO-NIT', schema: 'Company' },
};

export type Sujeto = {
  schema: 'Person' | 'Company';
  idNumber: string;
  documentType: string;
  fullName?: string;
};

// De lo que inscribe el cliente al sujeto que pide Sarblock. Devuelve null
// si el tipo no está en su catálogo: mejor no consultar que cobrar una
// consulta contra el documento equivocado.
export function sujetoDe(tipoDocumento: string, documento: string, nombre?: string): Sujeto | null {
  const t = TIPOS[String(tipoDocumento || 'CC').toUpperCase()];
  if (!t) return null;
  // Solo dígitos en los documentos colombianos numéricos. El NIT va SIN
  // dígito de verificación, como lo pedía TusDatos (por confirmar con una
  // consulta real en el bloque 5).
  let id = String(documento ?? '').trim();
  if (t.id === 'CO-NIT') id = id.replace(/\D/g, '').slice(0, 9);
  else if (t.id === 'CO-CC' || t.id === 'CO-CE') id = id.replace(/\D/g, '');
  if (!id) return null;
  const nombreLimpio = String(nombre ?? '').trim();
  // A una empresa se la busca por la razón social: sin ella se consulta —y
  // se cobra— contra una cadena vacía. De una persona el nombre es opcional
  // (la Registraduría resuelve el oficial), pero si lo tenemos va, porque es
  // contra lo que se mide la suplantación.
  if (t.schema === 'Company' && !nombreLimpio) return null;
  return { schema: t.schema, idNumber: id, documentType: t.id, ...(nombreLimpio ? { fullName: nombreLimpio } : {}) };
}

export class ClienteSarblock {
  constructor(private key: string, private f: Fetch = fetch, private base = SARBLOCK_URL) {
    if (!key?.startsWith('sb_org_')) throw new Error('La key de Sarblock debe empezar por sb_org_.');
  }

  private async llamar<T>(metodo: 'GET' | 'POST' | 'PUT', ruta: string, cuerpo?: unknown, idempotencia?: string): Promise<T> {
    const r = await this.f(`${this.base}${ruta}`, {
      method: metodo,
      headers: {
        'x-api-key': this.key,
        ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencia ? { 'idempotency-key': idempotencia.slice(0, 200) } : {}),
      },
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
    const texto = await r.text();
    let datos: any = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { /* cuerpo no JSON */ }
    if (!r.ok) {
      const ra = Number(r.headers.get('retry-after'));
      throw new ErrorSarblock(
        r.status,
        String(datos?.type ?? `HTTP_${r.status}`),
        String(datos?.message ?? (texto.slice(0, 200) || `Sarblock respondió ${r.status}`)),
        Number.isFinite(ra) && ra > 0 ? ra : null,
        datos?.details ?? datos?.fields ?? null,
      );
    }
    return datos as T;
  }

  // ── Credencial y saldo (gratis) ────────────────────────────────────────
  me() { return this.llamar<any>('GET', '/me'); }
  consumo() { return this.llamar<any>('GET', '/usage'); }
  tiposDocumento() { return this.llamar<any[]>('GET', '/catalogs/identity-document-types'); }

  // ── Screening ─────────────────────────────────────────────────────────
  // Encola y responde 202 { id, status, purpose }. COBRA. El resultado se
  // lee con leerCheck: el contrato es asíncrono siempre.
  crearCheck(d: { purpose: 'beneficiary' | 'customer_onboarding'; subject: Sujeto; callbackUrl?: string; idempotencia: string }) {
    return this.llamar<{ id: string; status: string; purpose: string }>('POST', '/screening/checks', {
      purpose: d.purpose, subject: d.subject, ...(d.callbackUrl ? { callbackUrl: d.callbackUrl } : {}),
    }, d.idempotencia);
  }
  leerCheck(id: string) { return this.llamar<any>('GET', `/screening/checks/${encodeURIComponent(id)}`); }
  // Vuelve a consultar SOLO las fuentes caídas, sobre el mismo id. Gratis,
  // hasta tres lotes por check (el cuarto es 409).
  reintentarFuentes(id: string) { return this.llamar<any>('POST', `/screening/checks/${encodeURIComponent(id)}/retry`, {}); }

  // ── Cliente y KYC ─────────────────────────────────────────────────────
  // La ficha nace de un screening TERMINADO: pide su screeningRecordId (no
  // el id del check; los dos son uuid y confundirlos es un 404).
  crearCliente(cuerpo: Record<string, unknown>, idempotencia: string) { return this.llamar<any>('POST', '/customers', cuerpo, idempotencia); }
  leerCliente(id: string) { return this.llamar<any>('GET', `/customers/${encodeURIComponent(id)}`); }
  plantillasKyc(clienteId: string) { return this.llamar<any>('GET', `/customers/${encodeURIComponent(clienteId)}/kyc/templates`); }
  // El servidor funde lo que mandes con lo que ya había; la primera llamada
  // crea el borrador.
  guardarBorradorKyc(clienteId: string, datos: Record<string, unknown>) { return this.llamar<any>('PUT', `/customers/${encodeURIComponent(clienteId)}/kyc/draft`, datos); }
  enviarKyc(clienteId: string) { return this.llamar<any>('POST', `/customers/${encodeURIComponent(clienteId)}/kyc/submit`, {}); }
  leerKyc(clienteId: string) { return this.llamar<any>('GET', `/customers/${encodeURIComponent(clienteId)}/kyc`); }
}

// Saldo de screening, tolerante a las dos formas que hemos visto: la de la
// documentación (screening.totalRemaining) y la real del 2026-10-27, que
// además trae un bloque credits.
export function saldoScreening(uso: any): number {
  const n = Number(uso?.screening?.totalRemaining ?? uso?.credits?.totalRemaining ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Una consulta por beneficiario y por día: el mismo cliente inscribiendo el
// mismo documento dos veces el mismo día recibe el check que ya existe.
export function claveIdempotencia(userId: string, documento: string, dia = new Date()): string {
  return `benef-${userId}-${documento}-${dia.toISOString().slice(0, 10)}`;
}
