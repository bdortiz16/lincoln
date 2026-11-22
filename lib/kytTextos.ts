// ══════════════════════════════════════════════════════════════════
//  Los hallazgos de MistTrack, en español.
//
//  El proveedor los manda en inglés: "Involved Illicit Activity",
//  "Interact With High-risk Tag Address". Eso salía tal cual en la pantalla y
//  en el reporte que se le entrega a un banco.
//
//  LO QUE NO SE RECONOCE SE DEJA EN INGLÉS. A propósito. Un hallazgo de
//  cumplimiento traducido a ojo es peor que uno sin traducir: el que lo lee
//  toma una decisión con una palabra que nadie escribió. Si aparece una
//  etiqueta nueva, sale como vino — y eso además es la señal de que hay que
//  agregarla acá.
//
//  Los nombres propios NO se traducen: htx, nobitex.ir, Tornado Cash y demás
//  son entidades, no descripciones.
// ══════════════════════════════════════════════════════════════════

// Los sustantivos que MistTrack combina con sus verbos.
const COSAS: [RegExp, string][] = [
  [/^illicit activit(y|ies)$/i,            'actividad ilícita'],
  [/^high[- ]risk tag address$/i,          'una dirección etiquetada de alto riesgo'],
  [/^high[- ]risk address$/i,              'una dirección de alto riesgo'],
  [/^malicious address$/i,                 'una dirección maliciosa'],
  [/^sanctioned entit(y|ies)$/i,           'una entidad sancionada'],
  [/^sanction(s|ed)?$/i,                   'sanciones'],
  [/^theft activit(y|ies)$/i,              'robo de fondos'],
  [/^stealing$/i,                          'robo de fondos'],
  [/^ransom(ware)?( activity)?$/i,         'ransomware'],
  [/^phishing( activity)?$/i,              'phishing'],
  [/^scam( activity)?$/i,                  'estafa'],
  [/^fraud$/i,                             'fraude'],
  [/^money laundering$/i,                  'lavado de dinero'],
  [/^launder(ing)?$/i,                     'lavado de dinero'],
  [/^mixer( service)?$/i,                  'un mixer'],
  [/^tumbler$/i,                           'un mixer'],
  [/^gambling$/i,                          'apuestas'],
  [/^darkweb|^dark web$/i,                 'la dark web'],
  [/^blackmail$/i,                         'extorsión'],
  [/^dusting attack$/i,                    'un ataque de polvo (dusting)'],
  [/^honeypot$/i,                          'un honeypot'],
  [/^risk(y)? exchange$/i,                 'un exchange de riesgo'],
  [/^bridge$/i,                            'un puente entre cadenas'],
  [/^mev bot$/i,                           'un bot de MEV'],
  [/^coin ?join$/i,                        'CoinJoin'],
  [/^terrorist financing$/i,               'financiación del terrorismo'],
  [/^cyber ?crime$/i,                      'cibercrimen'],
  [/^malware$/i,                           'malware'],
];

// Frases completas, cuando no siguen el patrón verbo + cosa.
const FRASES: [RegExp, string][] = [
  [/^suspected malicious address$/i,       'Sospecha de dirección maliciosa'],
  [/^malicious address$/i,                 'Dirección maliciosa'],
  [/^high[- ]risk address$/i,              'Dirección de alto riesgo'],
  [/^sanctioned (entity|address)$/i,       'Entidad sancionada'],
  [/^no risk( detected)?$/i,               'Sin riesgo detectado'],
  [/^low risk$/i,                          'Riesgo bajo'],
  [/^moderate risk$/i,                     'Riesgo moderado'],
  [/^high risk$/i,                         'Riesgo alto'],
  [/^severe risk$/i,                       'Riesgo severo'],
  [/^unknown$/i,                           'Sin clasificar'],
];

// Los verbos con que MistTrack arma sus etiquetas.
const VERBOS: [RegExp, string][] = [
  [/^involved (in )?(.+)$/i,               'Participó en $2'],
  [/^interact(ed|s)? with (.+)$/i,         'Interactuó con $2'],
  [/^suspected (.+)$/i,                    'Sospecha de $1'],
  [/^related to (.+)$/i,                   'Relacionada con $1'],
  [/^associated with (.+)$/i,              'Asociada a $1'],
  [/^received from (.+)$/i,                'Recibió de $1'],
  [/^sent to (.+)$/i,                      'Envió a $1'],
  [/^direct(ly)? exposure to (.+)$/i,      'Exposición directa a $2'],
  [/^indirect(ly)? exposure to (.+)$/i,    'Exposición indirecta a $2'],
];

function cosaEnEspanol(s: string): string | null {
  const t = s.trim();
  for (const [re, es] of COSAS) if (re.test(t)) return es;
  return null;
}

/**
 * Traduce un hallazgo de MistTrack. Si no lo reconoce lo devuelve TAL CUAL —
 * nunca aproximado.
 */
export function hallazgoEnEspanol(raw: any): string {
  const s = String(typeof raw === 'string' ? raw : (raw?.label ?? raw?.name ?? raw?.type ?? '')).trim();
  if (!s) return '';

  for (const [re, es] of FRASES) if (re.test(s)) return es;

  for (const [re, plantilla] of VERBOS) {
    const m = s.match(re);
    if (!m) continue;
    // El grupo del sustantivo es el último que capturó algo.
    const idx = plantilla.includes('$2') ? 2 : 1;
    const cosa = cosaEnEspanol(m[idx] ?? '');
    const texto = cosa ?? (m[idx] ?? '').trim();
    // "Involved" no se traduce igual ante una COSA que ante una ACTIVIDAD.
    // "Participó en una entidad sancionada" no es castellano; los sustantivos
    // de la tabla que son entidades llevan artículo, y eso los distingue.
    let out = plantilla;
    if (/^Participó en /.test(plantilla) && /^un[a]? /.test(texto)) out = 'Vinculada a $IDX';
    return out.replace('$IDX', texto).replace(`$${idx}`, texto);
  }

  // Un sustantivo suelto, sin verbo.
  const sola = cosaEnEspanol(s);
  if (sola) return sola.charAt(0).toUpperCase() + sola.slice(1);

  return s;
}

export const hallazgosEnEspanol = (arr: any, max = 40): string[] =>
  (Array.isArray(arr) ? arr : []).map(hallazgoEnEspanol).map(s => s.trim()).filter(Boolean).slice(0, max);

// ── El nivel de riesgo es EL DEL PROVEEDOR ────────────────────────
//
// Hasta el 22 nov aquí había una "banda propia" que SUBÍA el nivel cuando el
// detail_list traía cualquier cosa: una dirección de Binance con puntaje 3 y
// "Interact With High-risk Tag Address" salía como "Riesgo medio" y "señalada
// directamente", mientras el reporte del proveedor decía Bajo (3). Ante un
// banco, un ente de control o una investigación, dos documentos que dicen
// cosas distintas sobre la misma dirección no respaldan: se contradicen. El
// dueño pidió que el nuestro diga lo mismo que el del proveedor.
//
// Y la elevación además leía mal el dato: según la documentación del
// proveedor, "Interact With …" es una INTERACCIÓN con una dirección
// etiquetada, no una etiqueta sobre la dirección consultada. Las etiquetas
// propias son las otras (Malicious Address, Sanctioned Entity, Mixer,
// Involved … Activity, etc.).
//
// Ahora: el nivel y el puntaje salen tal cual del proveedor, y los
// indicadores se muestran separados en "etiquetas de la dirección" e
// "interacciones", con sus palabras.
export function bandaDeRiesgo(
  categoriaProveedor: string | undefined,
  _hallazgos?: string[],
): { categoria: 'alto' | 'medio' | 'bajo' | 'sin_dato'; elevada: boolean; motivo: string | null } {
  return { categoria: ((categoriaProveedor as any) ?? 'sin_dato'), elevada: false, motivo: null };
}

// "Interact With …" describe con quién operó la dirección; lo demás del
// detail_list describe a la dirección misma.
const ES_INTERACCION = /^\s*interact(ed|s)?\s+with\b/i;

/** Separa el detail_list CRUDO del proveedor en etiquetas propias e
 *  interacciones, ya en español. */
export function indicadoresDe(detalle: any): { propios: string[]; interacciones: string[] } {
  const crudos = (Array.isArray(detalle) ? detalle : [])
    .map((x: any) => String(typeof x === 'string' ? x : (x?.label ?? x?.name ?? x?.type ?? '')).trim())
    .filter(Boolean);
  const propios = Array.from(new Set(crudos.filter(s => !ES_INTERACCION.test(s)).map(hallazgoEnEspanol)));
  const interacciones = Array.from(new Set(crudos.filter(s => ES_INTERACCION.test(s)).map(hallazgoEnEspanol)));
  return { propios, interacciones };
}

/** El nivel tal como lo nombra el proveedor (Low / Moderate / High / Severe),
 *  en español. Si no vino el texto, el de la categoría. */
export function nivelProveedorEs(nivel: any, categoria?: string): string {
  const l = String(nivel ?? '').trim().toLowerCase();
  if (l.startsWith('sev')) return 'Severo';
  if (l.startsWith('high') || l === 'alto') return 'Alto';
  if (l.startsWith('mod') || l.startsWith('med')) return 'Moderado';
  if (l.startsWith('low') || l === 'bajo') return 'Bajo';
  return categoria === 'alto' ? 'Alto' : categoria === 'medio' ? 'Moderado' : categoria === 'bajo' ? 'Bajo' : 'Sin clasificar';
}

/** La escala del proveedor (su documentación y su reporte). */
export const ESCALA_RIESGO: { nivel: string; rango: string; operacion: string }[] = [
  { nivel: 'Bajo', rango: '0 – 30', operacion: 'Supervisión mínima.' },
  { nivel: 'Moderado', rango: '31 – 70', operacion: 'Supervisión moderada.' },
  { nivel: 'Alto', rango: '71 – 90', operacion: 'Vigilancia estrecha y análisis de las transacciones.' },
  { nivel: 'Severo', rango: '91 – 100', operacion: 'No operar (retiros ni negociación) y reportar la dirección de inmediato.' },
];

/** ¿La dirección MISMA figura como sancionada? Lo que el reporte del
 *  proveedor llama "Sanctions": una exposición indirecta a una entidad
 *  sancionada (htx a 3 saltos) no la hace sancionada. */
export function sancionadaPorProveedor(detalle: any, riskDetail?: any): boolean {
  const crudos = (Array.isArray(detalle) ? detalle : []).map((x: any) => String(typeof x === 'string' ? x : (x?.label ?? '')).trim());
  if (crudos.some(s => /^sanctioned (entity|address)$/i.test(s))) return true;
  // Una entrada de risk_detail sancionada a la que la dirección pertenece
  // (exposición directa a 0 saltos) también: no se infiere nada más.
  return (Array.isArray(riskDetail) ? riskDetail : []).some((x: any) =>
    String(x?.risk_type ?? x?.tipo ?? '') === 'sanctioned_entity' && Number(x?.hop_num ?? x?.saltos) === 0);
}

/** Fecha del proveedor: sus marcas de tiempo vienen en SEGUNDOS Unix (las
 *  leíamos como milisegundos y la pantalla decía "Activa desde 1970"). Acepta
 *  segundos, milisegundos o texto ISO; devuelve ISO o null. */
export function fechaProveedor(v: any): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : NaN);
  if (Number.isFinite(n)) {
    if (n <= 0) return null;
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) && d.getFullYear() >= 2008 ? d.toISOString() : null;
  }
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) && d.getFullYear() >= 2008 ? d.toISOString() : null;
}

// Las 14 fuentes de riesgo de lavado que identifica el proveedor, por nivel
// (de su reporte). Van en el anexo del nuestro para que el lector sepa qué
// mira cada categoría sin tener que ir al documento del proveedor.
export const FUENTES_RIESGO: { nivel: string; items: [string, string][] }[] = [
  { nivel: 'Severo', items: [
    ['Sanciones', 'Entidades sancionadas legalmente, por lo general por organismos internacionales o gobiernos, por infracciones que incluyen lavado de activos u otros delitos financieros.'],
    ['Monedas ilícitas', 'Fondos obtenidos por medios ilícitos: robo, estafa, secuestro de datos (ransomware) o software malicioso.'],
    ['Financiación del terrorismo', 'Entidades vinculadas a la financiación del terrorismo, a menudo mediante redes financieras complejas y ocultas.'],
  ] },
  { nivel: 'Alto', items: [
    ['Mezcladores (mixers)', 'Servicios que mezclan fondos de varios usuarios y hacen casi imposible rastrear su origen.'],
    ['Exchanges de riesgo', 'Sin verificación de clientes (KYC), con cargos por incumplimientos ALA/CFT, sin licencia o que no responden a requerimientos de las autoridades.'],
    ['Mercados de la darknet', 'Mercados en la parte oculta de internet donde se pagan bienes y servicios ilícitos.'],
    ['Servicios o plataformas ilegales', 'Esquemas Ponzi o estafas de inversión, entre otros.'],
    ['Congelamientos públicos', 'Fondos congelados por entidades reconocidas; los emisores de stablecoins como Tether o Circle pueden congelar fondos para impedir actividades ilegales.'],
  ] },
  { nivel: 'Medio', items: [
    ['Apuestas', 'Fondos asociados a juegos o apuestas en línea sin licencia.'],
    ['Puentes centralizados', 'Entidades que trasladan fondos entre cadenas sin pasar por un exchange.'],
    ['Protocolos de privacidad', 'Protocolos que ocultan la transparencia de las transacciones y a las contrapartes (por ejemplo, con pruebas de conocimiento cero).'],
  ] },
  { nivel: 'Bajo', items: [
    ['DEX', 'Plataformas de intercambio descentralizadas, entre pares, sin intermediario central.'],
    ['Protocolos DeFi', 'Préstamos y operaciones entre pares sin intermediario ni autoridad central.'],
    ['Mercados de NFT', 'Plataformas dedicadas a emitir, negociar y vender NFT.'],
  ] },
];

export const ABREVIATURAS: [string, string][] = [
  ['ALA / AML', 'Antilavado de activos'], ['CDD', 'Debida diligencia del cliente'],
  ['CFT', 'Contra la financiación del terrorismo'], ['FATF / GAFI', 'Grupo de Acción Financiera Internacional'],
  ['UIF / FIU', 'Unidad de inteligencia financiera'], ['KYC', 'Conocimiento del cliente'],
  ['KYT', 'Conocimiento de la transacción'], ['LA', 'Lavado de activos'],
  ['PEP', 'Persona expuesta políticamente'], ['PSP', 'Proveedor de servicios de pago'],
  ['ROS / STR', 'Reporte de operación sospechosa'], ['FT', 'Financiación del terrorismo'],
];
