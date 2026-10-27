// ════════════════════════════════════════════════════════
// De la respuesta de Sarblock a la FICHA que ya lee todo Lincoin.
//
// La ficha vive en raw_data.tusdatos.beneficiarios[documento] y de ella
// dependen el bloqueo del envío (mouv-proxy), la insignia y el detalle del
// beneficiario, el modal KYC y la ciudad del tercero en Siigo. Si Sarblock
// escribe la MISMA forma, nada de eso cambia durante la transición. Lo que
// Sarblock trae de más (el catálogo entero) va en `sarblock`, para el modal
// y el PDF con marca Lincoin.
//
// Criterio: Sarblock ya entrega la decisión derivada (summary.action,
// shouldBlock). Se usa esa, no se recalcula: dos criterios terminan
// separándose. Y como con TusDatos, un veredicto AUSENTE no es un veredicto
// en contra: solo corta una decisión explícita.
// ════════════════════════════════════════════════════════

export type Hallazgo = { nivel: 'alto' | 'medio'; codigo: string; texto: string; fuente: string };

// Qué versión de la matriz decidió esta ficha. Si la matriz cambia, se sabe
// con qué regla se juzgó cada caso.
export const CRITERIO = 'lincoin-v1-2026-10-27';

export type Motivo = { nivel: 'alto' | 'medio'; regla: string; texto: string; fuente: string };

const PASIVA = (h: any) => String(h?.judicial?.partySide ?? '').toLowerCase() === 'pasiva';
const RAMA_GRAVE = (rama: string) => /penal|extinci/.test(rama);
const ANTECEDENTES = new Set(['co_policia', 'co_procuraduria', 'co_contraloria']);
const GRAVEDAD_ALTA = new Set(['EXTREMO', 'ALTO']);
const CERTEZA_ALTA = new Set(['CONFIRMADA', 'PROBABLE']);
const limpio = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();

// La matriz, fila por fila:
//   Lista restrictiva (OFAC, ONU…)                                → alto
//   Rama Judicial: parte pasiva en proceso penal / extinción      → alto
//   Antecedentes Policía / Procuraduría / Contraloría con coinc.  → alto
//   Prensa adversa EXTREMO/ALTO con certeza CONFIRMADA/PROBABLE    → alto
//   Rama Judicial: parte pasiva en civil, familia, laboral…       → medio
//   PEP · fuente que pide revisión · prensa de menor gravedad     → medio
export function reglasLincoin(catalogo: any[]): Motivo[] {
  const out: Motivo[] = [];
  for (const e of catalogo) {
    const label = limpio(e?.label ?? e?.code);
    const hits: any[] = Array.isArray(e?.hits) ? e.hits : [];
    const code = String(e?.code ?? '');
    if (e?.matched === true && e?.isRestrictive) {
      out.push({ nivel: 'alto', regla: 'lista_restrictiva', fuente: label, texto: `Coincidencia en lista restrictiva: ${label}${hits[0]?.matchedName ? ` (${limpio(hits[0].matchedName)})` : ''}` });
      continue;
    }
    if (code === 'co_rama_judicial') {
      // Se miran los procesos uno por uno: lo que pesa es la rama y el lado.
      for (const h of hits.filter(PASIVA)) {
        const rama = String(h.judicial?.branch ?? '').toLowerCase();
        const donde = `${limpio(h.judicial?.court)}, radicado ${h.judicial?.processKey ?? '—'}${h.judicial?.startDate ? `, desde ${h.judicial.startDate}` : ''}`;
        out.push(RAMA_GRAVE(rama)
          ? { nivel: 'alto', regla: 'rama_penal_pasiva', fuente: label, texto: `Parte pasiva en proceso ${rama.replace(/_/g, ' ')}: ${donde}` }
          : { nivel: 'medio', regla: 'rama_pasiva', fuente: label, texto: `Parte pasiva en proceso ${rama.replace(/_/g, ' ') || 'judicial'}: ${donde}` });
      }
      continue;
    }
    if (ANTECEDENTES.has(code) && e?.matched === true) {
      out.push({ nivel: 'alto', regla: 'antecedentes', fuente: label, texto: `${label}: registra antecedentes${e.statusReason ? ` (${limpio(e.statusReason)})` : ''}` });
      continue;
    }
    if (String(e?.category) === 'ADVERSE_MEDIA') {
      for (const h of hits) {
        const sev = String(h?.severity ?? '').toUpperCase();
        const cer = String(h?.identityConfidence ?? '').toUpperCase();
        if (sev === 'DESCARTADO' || (!sev && e?.matched !== true)) continue;
        const nota = `Noticia adversa (gravedad ${sev || '—'}, certeza ${cer || '—'})${h?.sourceUrl ? `: ${h.sourceUrl}` : ''}`;
        out.push(GRAVEDAD_ALTA.has(sev) && CERTEZA_ALTA.has(cer)
          ? { nivel: 'alto', regla: 'prensa_grave', fuente: label, texto: nota }
          : { nivel: 'medio', regla: 'prensa', fuente: label, texto: nota });
      }
      continue;
    }
    if (e?.matched === true && String(e?.category) === 'PEP') {
      out.push({ nivel: 'medio', regla: 'pep', fuente: label, texto: `Persona expuesta políticamente: ${label}` });
      continue;
    }
    if (e?.matched === true) {
      out.push({ nivel: 'medio', regla: 'revision', fuente: label, texto: `${label}${e.statusReason ? `: ${limpio(e.statusReason)}` : ''}` });
    }
  }
  // Lo alto primero: es el porqué del bloqueo.
  return out.sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === 'alto' ? -1 : 1));
}

export type Ficha = {
  proveedor: 'sarblock';
  documento: string;
  tipoDocumento: string;
  estado: 'procesando' | 'finalizado' | 'error';
  detalle?: string;
  jobid?: string;
  nombre?: string;
  nombreInscrito?: string;
  nombreReal?: string;
  nombreCoincide?: boolean;
  validado?: boolean;
  hallazgo?: boolean;
  categoria?: 'alto' | 'medio' | 'bajo' | 'ninguno' | 'sin_validar';
  operable?: boolean;
  bloqueo?: string;
  criterio?: string;
  altos?: number;
  medios?: number;
  bajos?: number;
  codigos?: string[];
  hallazgos?: Hallazgo[];
  fuentesConError?: string[];
  // Fuentes que Sarblock sigue consultando por su cuenta ("consulta en curso
  // en la fuente oficial: el resultado se añadirá al llegar"). No se
  // reintentan: el MISMO check se completa solo y hay que volver a leerlo.
  fuentesEnCurso?: number;
  lanzadoAt?: string;
  at?: string;
  sarblock?: {
    checkId: string;
    screeningRecordId: string | null;
    catalogVersion: string | null;
    aggregateOutcome: string | null;
    summary: any;
    identity: any;
    catalog: any[];
  };
};

const TERMINALES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
export const terminado = (check: any) => TERMINALES.has(String(check?.status ?? ''));

// La ficha recién lanzada: "procesando" hasta que vuelva el resultado. Es lo
// que hace que el envío espere en vez de salir antes del veredicto.
export function fichaLanzada(d: { documento: string; tipoDocumento: string; nombre?: string; checkId: string }): Ficha {
  const ahora = new Date().toISOString();
  return {
    proveedor: 'sarblock', documento: d.documento, tipoDocumento: d.tipoDocumento,
    estado: 'procesando', jobid: d.checkId, nombreInscrito: d.nombre || undefined,
    lanzadoAt: ahora, at: ahora,
  };
}

// riskLevel es un nivel, no un número. CRITICAL y HIGH son nuestro "alto".
const CATEGORIA: Record<string, Ficha['categoria']> = {
  CRITICAL: 'alto', HIGH: 'alto', MEDIUM: 'medio', LOW: 'bajo', NONE: 'ninguno',
};

export function traducir(check: any, d: { documento: string; tipoDocumento: string; nombre?: string }): Ficha {
  const base: Ficha = {
    proveedor: 'sarblock', documento: d.documento, tipoDocumento: d.tipoDocumento,
    estado: 'procesando', jobid: String(check?.id ?? ''), nombreInscrito: d.nombre || undefined,
    at: new Date().toISOString(),
  };
  const st = String(check?.status ?? '');
  if (!terminado(check)) return base;
  if (st !== 'COMPLETED') {
    return { ...base, estado: 'error', detalle: st === 'CANCELLED' ? 'Sarblock canceló la consulta.' : 'Sarblock no pudo completar la consulta.' };
  }

  const s = check.summary ?? {};
  const id = check.identity ?? null;
  const catalogo: any[] = Array.isArray(check.catalog) ? check.catalog : [];

  // ── Matriz de riesgo de Lincoin (aprobada el 2026-10-27) ──────────────
  // Sarblock solo bloquea por listas restrictivas: para él la Rama Judicial,
  // la Policía o los PEP nunca bloquean. Con eso, alguien con un proceso
  // penal como parte pasiva salía "riesgo bajo" (caso real CC 75104651, que
  // TusDatos había marcado alto por delito fuente de LAFT). Estas reglas se
  // aplican encima del catálogo y el veredicto es el MÁS estricto entre el
  // de Sarblock y el de la matriz. Cada motivo queda escrito con la regla,
  // la fuente y el dato, para que quien revisa sepa por qué.
  const motivos = reglasLincoin(catalogo);
  const coinciden = catalogo.filter(e => e?.matched === true);
  const hallazgos: Hallazgo[] = motivos.map(m => ({ nivel: m.nivel, codigo: m.regla, texto: m.texto, fuente: m.fuente }));
  const altos = motivos.filter(m => m.nivel === 'alto').length;
  const medios = motivos.length - altos;
  // Menciones que NO son coincidencia (p. ej. procesos como demandante): se
  // cuentan como bajos, igual que TusDatos contaba sus bajos sin listarlos.
  const bajos = catalogo.filter(e => e?.matched !== true && Number(e?.matchCount ?? 0) > 0).length;

  // Una fuente sin respuesta no es una fuente limpia.
  const fuentesConError = catalogo.filter(e => e?.status === 'UNAVAILABLE').map(e => String(e.label ?? e.code));
  const fuentesEnCurso = enCurso(check);

  // Identidad: si el nombre declarado y el oficial se parecen poco, Sarblock
  // marca posible suplantación. Para nosotros es "el nombre no corresponde",
  // que pesa más que cualquier antecedente: no se sabe a quién se le paga.
  const spoof = id?.spoofSuspected === true;
  const nombreCoincide = id ? !spoof : undefined;

  const accion = String(s.action ?? '');
  let categoria = CATEGORIA[String(s.riskLevel ?? '')] ?? undefined;
  // La decisión explícita de Sarblock manda sobre su nivel: BLOCK es alto y
  // HOLD_FOR_REVIEW es al menos medio.
  if (s.shouldBlock === true || accion === 'BLOCK') categoria = 'alto';
  else if (accion === 'HOLD_FOR_REVIEW' && (categoria === 'bajo' || categoria === 'ninguno' || !categoria)) categoria = 'medio';
  // Y la matriz de Lincoin sube el nivel si encontró algo más grave.
  if (altos > 0) categoria = 'alto';
  else if (medios > 0 && categoria !== 'alto') categoria = 'medio';
  // Sin identidad contrastada y sin nada encontrado no se sabe de quién son
  // los antecedentes: igual que el 'sin_validar' de TusDatos, no bloquea.
  if (id && id.validated === false && (categoria === 'ninguno' || categoria === 'bajo')) categoria = 'sin_validar';

  const bloqueaSarblock = s.shouldBlock === true || accion === 'BLOCK';
  const operable = !(bloqueaSarblock || spoof || altos > 0);
  const motivosTexto = (nivel: 'alto' | 'medio') => motivos.filter(m => m.nivel === nivel).map(m => m.texto);
  const bloqueo = spoof
    ? `El nombre inscrito no corresponde al documento.${id?.verifiedName ? ` Según la fuente oficial es ${id.verifiedName}.` : ''}`
    : altos > 0
      ? `Riesgo alto: ${motivosTexto('alto').join(' · ')}`
      : bloqueaSarblock
        ? String(s.blockReason || 'Coincidencia en una lista restrictiva.')
        : medios > 0
          ? `En revisión de cumplimiento: ${motivosTexto('medio').join(' · ')}`
          : accion === 'HOLD_FOR_REVIEW' ? 'Sarblock pidió revisión de cumplimiento.' : undefined;

  return {
    ...base,
    estado: 'finalizado',
    nombre: id?.verifiedName || undefined,
    nombreReal: id?.verifiedName || undefined,
    nombreCoincide,
    validado: id ? id.validated === true : undefined,
    hallazgo: Number(s.matchedLists ?? coinciden.length) > 0,
    categoria,
    operable,
    bloqueo,
    altos, medios, bajos,
    criterio: CRITERIO,
    codigos: coinciden.map(e => String(e.code ?? '')).slice(0, 60),
    hallazgos: hallazgos.slice(0, 60),
    fuentesConError,
    ...(fuentesEnCurso > 0 ? { fuentesEnCurso } : {}),
    // El resultado de una PARTIAL se guarda —es lo que hay—, pero con las
    // fuentes caídas a la vista; el servidor intenta el retry gratis.
    ...(check.aggregateOutcome === 'PARTIAL' ? { detalle: `${fuentesConError.length} fuente(s) no respondieron.` } : {}),
    at: String(check.completedAt ?? new Date().toISOString()),
    sarblock: {
      checkId: String(check.id ?? ''),
      screeningRecordId: check.screeningRecordId ?? null,
      catalogVersion: check.catalogVersion ?? null,
      aggregateOutcome: check.aggregateOutcome ?? null,
      summary: s, identity: id, catalog: catalogo,
    },
  };
}

// Fuentes caídas que NO se reintentan porque Sarblock las sigue esperando.
// Visto en la primera consulta real (2026-10-27): la Policía quedó
// UNAVAILABLE con «Consulta en curso…», retryable false, y minutos después
// el mismo check pasó a COMPLETED con la Policía en CLEAR.
export const enCurso = (check: any) =>
  (Array.isArray(check?.catalog) ? check.catalog : []).filter((e: any) => e?.status === 'UNAVAILABLE' && e?.retryable !== true).length;

// Una ficha cerrada que hay que volver a leer: quedó con fuentes en curso y
// no ha pasado tanto tiempo como para darlas por perdidas.
export const VENTANA_EN_CURSO_MS = 24 * 3600 * 1000;
export const releerFicha = (f: any, ahora = Date.now()) =>
  f?.proveedor === 'sarblock' && f.estado === 'finalizado' && !!f.jobid
  && Number(f.fuentesEnCurso ?? enCurso({ catalog: f.sarblock?.catalog })) > 0
  && ahora - Date.parse(String(f.lanzadoAt ?? f.at ?? 0)) < VENTANA_EN_CURSO_MS;

// ¿Vale la pena un retry? Solo si quedaron fuentes caídas recuperables. Es
// gratis y sobre el mismo check, hasta tres lotes.
export const hayQueReintentar = (check: any) =>
  terminado(check) && Number(check?.summary?.unavailableLists ?? 0) > 0
  && (Array.isArray(check?.catalog) ? check.catalog : []).some((e: any) => e?.status === 'UNAVAILABLE' && e?.retryable === true);
