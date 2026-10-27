// ════════════════════════════════════════════════════════
// Sarblock SIMULADO — para probar la pantalla sin gastar créditos.
//
// Imita las rutas que usamos (crear check, leerlo, retry, /me, /usage) con
// las respuestas de ejemplo de la documentación. El escenario sale del
// ÚLTIMO dígito del documento, para poder provocar cada caso a propósito:
//
//   0–5  limpio            → SIN HALLAZGOS
//   6    PEP               → RIESGO MEDIO (en revisión)
//   7    OFAC              → BLOQUEADO
//   8    fuente caída      → limpio pero con la Policía sin responder;
//                            el retry (gratis) la recupera
//   9    suplantación      → nombre incorrecto, BLOQUEADO
//
// Un check tarda ~6 s en terminar, como un screening real que tarda.
// ════════════════════════════════════════════════════════

let DEMORA_MS = 6000;
// Las pruebas automáticas la ponen en 0 para no esperar.
export const demoraSimulada = (ms: number) => { DEMORA_MS = ms; };
type Sim = { id: string; doc: string; nombre: string; schema: string; creado: number; reintentado: boolean; proposito?: string; tipoDoc?: string };
const checks = new Map<string, Sim>();
const porIdempotencia = new Map<string, string>();

const fuente = (code: string, label: string, category: string, categoryLabel: string, restrictiva: boolean, over: Record<string, unknown> = {}) => ({
  code, label, category, categoryLabel, status: 'CLEAR', statusReason: null, isRestrictive: restrictiva,
  consulted: true, retryable: false, matched: false, matchCount: 0, hits: [], coverage: null, ...over,
});

function catalogoBase(nombre: string) {
  return [
    fuente('us_ofac_sdn', 'OFAC SDN', 'SANCTIONS', 'Listas vinculantes internacionales', true),
    fuente('un_sc_sanctions', 'Consejo de Seguridad ONU', 'SANCTIONS', 'Listas vinculantes internacionales', true),
    fuente('eu_fsf', 'Sanciones financieras UE', 'SANCTIONS', 'Listas vinculantes internacionales', true),
    fuente('worldbank_debarred', 'Inhabilitados del Banco Mundial', 'DEBARMENT', 'Inhabilitaciones y exclusión de contratación', true),
    fuente('interpol_red_notices', 'Notificaciones rojas INTERPOL', 'SANCTIONS', 'Listas vinculantes internacionales', true),
    fuente('co_funcion_publica', 'PEP Colombia — Función Pública', 'PEP', 'Exposición política (PEP)', false),
    fuente('co_registraduria', 'Estado vital Registraduría', 'IDENTITY', 'Identidad Colombia', false, { status: 'VERIFIED' }),
    fuente('co_sisben', 'SISBEN', 'COLOMBIA', 'Antecedentes Colombia', false, { statusReason: 'D21' }),
    fuente('co_policia', 'Antecedentes Policía', 'COLOMBIA', 'Antecedentes Colombia', false),
    fuente('co_procuraduria', 'Antecedentes Procuraduría', 'COLOMBIA', 'Antecedentes Colombia', false),
    fuente('co_contraloria', 'Antecedentes Contraloría', 'COLOMBIA', 'Antecedentes Colombia', false),
    fuente('co_rama_judicial', 'Procesos Judiciales — Rama Judicial', 'COLOMBIA', 'Antecedentes Colombia', false, {
      statusReason: '2 procesos, ninguno con el cliente como parte pasiva · conteo mínimo', matchCount: 2,
      hits: [{ id: 'sim-j1', matchedName: nombre.toUpperCase(), score: 1, matchType: 'PROVIDER_CHECK', matchedField: 'Partes del proceso',
        judicial: { processKey: '11001310300320240012300', branch: 'civil', court: 'JUZGADO 003 CIVIL DEL CIRCUITO DE BOGOTÁ', partySide: 'activa', startDate: '2024-03-11', lastActionDate: '2025-01-20' } }],
      coverage: { uniqueProcesses: 2, countIsMinimum: true },
    }),
    fuente('adverse_media_serper', 'Noticias adversas (fuentes públicas)', 'ADVERSE_MEDIA', 'Noticias adversas', false),
  ];
}

function resultado(s: Sim) {
  const nombreOficial = s.nombre.toUpperCase() || 'TITULAR DE PRUEBA';
  const esc = Number(s.doc.slice(-1));
  const cat = catalogoBase(s.nombre);
  const set = (code: string, over: Record<string, unknown>) => { const e = cat.find(x => x.code === code); if (e) Object.assign(e, over); };
  let summary: any = { action: 'CLEAR', riskLevel: 'NONE', shouldBlock: false, blockReason: null, hasPepResult: false };
  let identity: any = { validated: true, verifiedName: nombreOficial, declaredName: s.nombre, spoofSuspected: false, nameSimilarity: 0.98 };
  let aggregate = 'COMPLETED';

  if (esc === 6) {
    set('co_funcion_publica', { status: 'MATCH', matched: true, matchCount: 1, hits: [{ id: 'sim-p1', matchedName: nombreOficial, score: 1, matchType: 'EXACT', matchedField: 'name_match' }] });
    summary = { action: 'HOLD_FOR_REVIEW', riskLevel: 'MEDIUM', shouldBlock: false, blockReason: null, hasPepResult: true };
  } else if (esc === 7) {
    set('us_ofac_sdn', { status: 'MATCH', matched: true, matchCount: 1, hits: [{ id: 'sim-o1', matchedName: nombreOficial, score: 1, matchType: 'EXACT', matchedField: 'name_match' }] });
    summary = { action: 'BLOCK', riskLevel: 'CRITICAL', shouldBlock: true, blockReason: 'Coincidencia en lista OFAC', hasPepResult: false };
  } else if (esc === 8 && !s.reintentado) {
    set('co_policia', { status: 'UNAVAILABLE', statusReason: 'El proveedor no respondió', retryable: true });
    aggregate = 'PARTIAL';
  } else if (esc === 9) {
    identity = { validated: true, verifiedName: 'MARÍA FERNANDA OSPINA RUIZ', declaredName: s.nombre, spoofSuspected: true, nameSimilarity: 0.18 };
    summary = { action: 'BLOCK', riskLevel: 'HIGH', shouldBlock: true, blockReason: 'Posible suplantación: el nombre declarado no corresponde al documento', hasPepResult: false };
  }
  const matched = cat.filter(e => e.matched).length;
  const unavailable = cat.filter(e => e.status === 'UNAVAILABLE').length;
  summary = { ...summary, totalHits: cat.reduce((n, e) => n + Number(e.matchCount || 0), 0), matchedLists: matched,
    clearLists: cat.filter(e => e.status === 'CLEAR').length, unavailableLists: unavailable, skippedLists: 0 };
  const fin = new Date(s.creado + DEMORA_MS).toISOString();
  return {
    id: s.id, status: 'COMPLETED', purpose: s.proposito === 'customer_onboarding' ? 'CUSTOMER_ONBOARDING' : 'BENEFICIARY', aggregateOutcome: aggregate, customerId: null,
    screeningRecordId: `rec-${s.id}`, catalogVersion: '2026-09-21', summary, identity, catalog: cat,
    createdAt: new Date(s.creado).toISOString(), updatedAt: fin, completedAt: fin,
  };
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

// Un fetch con la misma firma que el real: se le pasa a ClienteSarblock.
export const fetchSimulado = async (url: string, init?: RequestInit): Promise<Response> => {
  const ruta = new URL(url).pathname.replace(/^\/api\/org\/v1/, '');
  const metodo = init?.method ?? 'GET';
  const h = (init?.headers ?? {}) as Record<string, string>;
  if (ruta === '/me') return json({ organization: { id: 'org_sim', name: 'SIMULADO', slug: 'simulado' }, apiKey: { prefix: 'sb_org_', start: 'sb_org_sim', scopes: {} } });
  if (ruta === '/usage') return json({ period: null, screening: { totalRemaining: 999 }, operations: { totalRemaining: 0 } });
  if (ruta === '/screening/checks' && metodo === 'POST') {
    const clave = h['idempotency-key'];
    if (clave && porIdempotencia.has(clave)) return json({ id: porIdempotencia.get(clave), status: 'QUEUED', purpose: 'BENEFICIARY' }, 202);
    const b = JSON.parse(String(init?.body ?? '{}'));
    const id = `sim-${crypto.randomUUID()}`;
    checks.set(id, { id, doc: String(b?.subject?.idNumber ?? '0'), nombre: String(b?.subject?.fullName ?? ''), schema: String(b?.subject?.schema ?? 'Person'), creado: Date.now(), reintentado: false, proposito: String(b?.purpose ?? 'beneficiary'), tipoDoc: String(b?.subject?.documentType ?? 'CO-CC') });
    if (clave) porIdempotencia.set(clave, id);
    return json({ id, status: 'QUEUED', purpose: 'BENEFICIARY' }, 202);
  }
  const m = /^\/screening\/checks\/([^/]+)(\/retry)?$/.exec(ruta);
  if (m) {
    const s = checks.get(decodeURIComponent(m[1]));
    if (!s) return json({ statusCode: 404, type: 'RESOURCE_NOT_FOUND', message: `Check ${m[1]} no encontrado` }, 404);
    if (m[2]) {
      s.reintentado = true; s.creado = Date.now() - DEMORA_MS + 3000;
      return json({ id: s.id, status: 'RUNNING', retrying: true, retriedSteps: ['list-check.co-policia'] }, 202);
    }
    if (Date.now() - s.creado < DEMORA_MS) return json({ id: s.id, status: 'RUNNING', purpose: 'BENEFICIARY', aggregateOutcome: null, screeningRecordId: null, summary: null, identity: null, catalog: [] });
    return json(resultado(s));
  }
  const k = await kycSimulado(ruta, metodo, init);
  if (k) return k;
  return json({ statusCode: 404, type: 'RESOURCE_NOT_FOUND', message: `Ruta simulada no implementada: ${metodo} ${ruta}` }, 404);
};

// ════════════════════════════════════════════════════════
// Clientes y KYC simulados (docs.sarblock.com → Clientes, KYC y KYB)
//
// La ficha nace de un screening TERMINADO (su screeningRecordId) y trae el
// expediente KYC ya abierto, en el nivel que sale del riesgo. El último
// dígito del documento elige el caso:
//   7 → la ficha nace BLOCKED (OFAC) y el expediente llega REJECTED
//   6 → PEP: nivel STANDARD (debida diligencia estándar)
//   5 → al enviar, cumplimiento pide más datos (REQUIRES_INFO)
//   resto → SIMPLE; al enviar pasa a PENDING y a los ~8 s queda APPROVED
// ════════════════════════════════════════════════════════

type ClienteSim = {
  id: string; personType: 'natural' | 'juridica'; datos: Record<string, any>; status: string; blockSource: string | null;
  screeningRecordId: string; kyc: { requestId: string; templateKey: string; level: string; status: string; reason: string | null;
    fieldValues: Record<string, unknown>; submittedAt: string | null; approvedAt: string | null; rejectedAt: string | null; createdAt: string; updatedAt: string };
};
const clientes = new Map<string, ClienteSim>();

// Campos rellenables de cada plantilla. Las reales las publica cada
// organización en su panel; éstas siguen la forma de la documentación.
const CAMPOS: Record<string, any[]> = {
  NATURAL: [
    { key: 'fullName', label: 'Nombre completo', type: 'TEXT', required: true, options: null },
    { key: 'dateOfBirth', label: 'Fecha de nacimiento', type: 'DATE', required: true, options: null },
    { key: 'occupation', label: 'Ocupación', type: 'SELECT', required: true, options: ['EMPLEADO', 'INDEPENDIENTE', 'PENSIONADO', 'ESTUDIANTE'] },
    { key: 'monthlyIncome', label: 'Ingresos mensuales (COP)', type: 'NUMBER', required: true, options: null },
    { key: 'fundsOrigin', label: 'Origen de los fondos', type: 'TEXT', required: true, options: null },
    { key: 'isPep', label: '¿Es persona expuesta políticamente?', type: 'BOOLEAN', required: true, options: null },
    { key: 'acceptedTerms', label: 'Acepta los términos', type: 'BOOLEAN', required: true, options: null },
    { key: 'authorizedVerification', label: 'Autoriza la verificación de sus datos', type: 'BOOLEAN', required: true, options: null },
  ],
  JURIDICA: [
    { key: 'companyName', label: 'Razón social', type: 'TEXT', required: true, options: null },
    { key: 'legalRepresentative', label: 'Representante legal', type: 'TEXT', required: true, options: null },
    { key: 'economicActivity', label: 'Actividad económica (CIIU)', type: 'TEXT', required: true, options: null },
    { key: 'monthlyIncome', label: 'Ingresos mensuales (COP)', type: 'NUMBER', required: true, options: null },
    { key: 'fundsOrigin', label: 'Origen de los fondos', type: 'TEXT', required: true, options: null },
    { key: 'acceptedTerms', label: 'Acepta los términos', type: 'BOOLEAN', required: true, options: null },
  ],
};
// En debida diligencia estándar se pide más.
const EXTRA_ESTANDAR = [
  { key: 'pepPosition', label: 'Cargo público que ocupa u ocupó', type: 'TEXT', required: true, options: null },
  { key: 'expectedMonthlyVolume', label: 'Volumen mensual esperado (COP)', type: 'NUMBER', required: true, options: null },
];
const plantillaDe = (c: ClienteSim) => {
  const tipo = c.personType === 'juridica' ? 'JURIDICA' : 'NATURAL';
  const fields = c.kyc.level === 'STANDARD' ? [...CAMPOS[tipo], ...EXTRA_ESTANDAR] : CAMPOS[tipo];
  return { templateKey: c.kyc.templateKey, level: c.kyc.level, versionId: 'ktv_sim', version: 1, fields };
};
const solicitud = (c: ClienteSim) => {
  // La revisión simulada: lo enviado se aprueba solo a los ~8 s.
  if (c.kyc.status === 'PENDING' && c.kyc.submittedAt && Date.now() - Date.parse(c.kyc.submittedAt) >= DEMORA_MS + 2000 * Math.sign(DEMORA_MS)) {
    c.kyc.status = 'APPROVED'; c.kyc.approvedAt = new Date().toISOString(); c.kyc.updatedAt = c.kyc.approvedAt; c.status = 'ACTIVE';
  }
  const { fieldValues: _f, level: _l, requestId, ...resto } = c.kyc;
  return { id: requestId, customerId: c.id, ...resto };
};
const fichaCliente = (c: ClienteSim) => ({
  id: c.id, status: c.status, personType: c.personType,
  firstName: c.datos.firstName ?? null, lastName: c.datos.lastName ?? null, companyName: c.datos.companyName ?? null,
  documentType: c.datos.documentType, documentNumber: c.datos.documentNumber, country: c.datos.country ?? 'CO',
  kycLevel: c.kyc.status === 'APPROVED' ? c.kyc.level : null, email: c.datos.email ?? null, daneCityCode: c.datos.daneCityCode ?? null,
  isPep: c.kyc.level === 'STANDARD', hasPepRelation: false, identityVerified: true, evaluationIncomplete: false,
  blockSource: c.blockSource, screeningRecordId: c.screeningRecordId,
  kyc: { requestId: c.kyc.requestId, templateKey: c.kyc.templateKey, level: c.kyc.level, status: c.kyc.status === 'IN_PROGRESS' ? 'DRAFT' : c.kyc.status, reason: c.kyc.reason },
});

async function kycSimulado(ruta: string, metodo: string, init?: RequestInit): Promise<Response | null> {
  const cuerpo = () => JSON.parse(String(init?.body ?? '{}'));
  if (ruta === '/customers' && metodo === 'POST') {
    const b = cuerpo();
    const check = [...checks.values()].find(s => `rec-${s.id}` === b.screeningRecordId);
    if (!check || Date.now() - check.creado < DEMORA_MS) return json({ statusCode: 400, type: 'INVALID_INPUT', message: 'El screening no existe o no ha terminado.', fields: [{ path: 'screeningRecordId', message: 'No es un screening terminado' }] }, 400);
    if (String(b.documentNumber) !== check.doc) return json({ statusCode: 400, type: 'INVALID_INPUT', message: 'El documento no coincide con el del screening. Comprueba los datos o haz un screening de esta persona.', fields: [{ path: 'documentNumber', message: 'No es el del screening' }] }, 400);
    const ya = [...clientes.values()].find(c => c.datos.documentNumber === b.documentNumber && c.datos.documentType === b.documentType);
    if (ya) return json({ statusCode: 409, type: 'CUSTOMER_ALREADY_EXISTS', message: 'Ya existe un cliente con este tipo y número de documento en la organización', details: { id: ya.id, status: ya.status } }, 409);
    const esc = Number(String(b.documentNumber).slice(-1));
    const tipo = b.personType === 'juridica' ? 'juridica' : 'natural';
    const bloqueado = esc === 7;
    const nivel = esc === 6 ? 'STANDARD' : 'SIMPLE';
    const ahora = new Date().toISOString();
    const c: ClienteSim = {
      id: `cus-sim-${crypto.randomUUID().slice(0, 8)}`, personType: tipo, datos: b, status: bloqueado ? 'BLOCKED' : 'ACTIVE',
      blockSource: bloqueado ? 'SCREENING_SANCTIONS' : null, screeningRecordId: b.screeningRecordId,
      kyc: { requestId: crypto.randomUUID(), templateKey: `CUSTOMER_${nivel}_KYC_${tipo.toUpperCase()}`, level: nivel,
        status: bloqueado ? 'REJECTED' : 'IN_PROGRESS', reason: bloqueado ? 'Coincidencia en lista OFAC' : (nivel === 'STANDARD' ? 'Persona expuesta políticamente' : null),
        fieldValues: {}, submittedAt: null, approvedAt: null, rejectedAt: bloqueado ? ahora : null, createdAt: ahora, updatedAt: ahora },
    };
    clientes.set(c.id, c);
    return json(fichaCliente(c), 201);
  }
  const m = /^\/customers\/([^/]+)(\/kyc(\/templates|\/draft|\/submit)?)?$/.exec(ruta);
  if (!m) return null;
  const c = clientes.get(decodeURIComponent(m[1]));
  if (!c) return json({ statusCode: 404, type: 'CUSTOMER_NOT_FOUND', message: 'Cliente no encontrado' }, 404);
  const sub = m[3] ?? (m[2] ? '/kyc' : '');
  if (sub === '' && metodo === 'GET') return json(fichaCliente(c));
  if (sub === '/templates' && metodo === 'GET') return json([plantillaDe(c)]);
  if (sub === '/kyc' && metodo === 'GET') return json(solicitud(c));
  if (sub === '/draft' && metodo === 'PUT') {
    if (c.kyc.status === 'REJECTED' || c.kyc.status === 'APPROVED') return json({ statusCode: 409, type: 'CONFLICT', message: 'El expediente no admite cambios en este estado.' }, 409);
    const b = cuerpo();
    if (b.templateKey !== c.kyc.templateKey) return json({ statusCode: 400, type: 'INVALID_INPUT', message: 'templateKey no corresponde a la solicitud abierta.' }, 400);
    Object.assign(c.kyc.fieldValues, b.fieldValues ?? {});
    if (c.kyc.status !== 'REQUIRES_INFO') c.kyc.status = 'IN_PROGRESS';
    c.kyc.updatedAt = new Date().toISOString();
    return json(solicitud(c));
  }
  if (sub === '/submit' && metodo === 'POST') {
    if (c.kyc.status === 'APPROVED') return json({ statusCode: 409, type: 'CONFLICT', message: 'El expediente KYC de este cliente ya está aprobado y no puede reenviarse.' }, 409);
    if (c.kyc.status === 'REJECTED') return json({ statusCode: 409, type: 'CONFLICT', message: 'El expediente fue rechazado.' }, 409);
    const faltan = plantillaDe(c).fields.filter((f: any) => f.required && (c.kyc.fieldValues[f.key] === undefined || c.kyc.fieldValues[f.key] === '' || (f.type === 'BOOLEAN' && f.key !== 'isPep' && c.kyc.fieldValues[f.key] !== true)));
    if (faltan.length) return json({ statusCode: 400, type: 'KYC_INVALID_FIELDS', message: 'Faltan campos obligatorios', fields: faltan.map((f: any) => ({ path: f.key, message: `Falta: ${f.label}` })) }, 400);
    const ahora = new Date().toISOString();
    const pideMas = Number(String(c.datos.documentNumber).slice(-1)) === 5 && c.kyc.status !== 'REQUIRES_INFO';
    c.kyc.status = pideMas ? 'REQUIRES_INFO' : 'PENDING';
    c.kyc.reason = pideMas ? 'Adjunta un soporte del origen de los fondos (extracto o certificación laboral).' : null;
    c.kyc.submittedAt = ahora; c.kyc.updatedAt = ahora;
    return json(solicitud(c), 201);
  }
  return null;
}
