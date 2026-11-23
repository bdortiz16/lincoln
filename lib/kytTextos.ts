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

const CODIGO_SENAL_ES: Record<string, string> = {
  NEW_WALLET: 'Wallet nueva: todavía tiene poco o ningún historial en la red',
  RAPID_PASS_THROUGH: 'Paso rápido de fondos: el dinero entra y sale enseguida',
};

/**
 * Traduce un hallazgo de MistTrack. Si no lo reconoce lo devuelve TAL CUAL —
 * nunca aproximado.
 */
export function hallazgoEnEspanol(raw: any): string {
  const s = String(typeof raw === 'string' ? raw : (raw?.label ?? raw?.name ?? raw?.type ?? '')).trim();
  if (!s) return '';
  // Códigos de señal de SARBLOCK que ya llegaron a la pantalla en crudo
  // ("NEW_WALLET"). Solo los que conocemos; uno nuevo sigue saliendo tal cual.
  if (CODIGO_SENAL_ES[s.toUpperCase()]) return CODIGO_SENAL_ES[s.toUpperCase()];

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

// ── Rutas: camino y sentido de cada tramo ──
// `nodos` va de la dirección analizada hacia la señalada y `tramos[i]` es el
// sentido de la plata entre nodos[i] y nodos[i+1], visto desde la analizada:
// 'entrante' (fue hacia ella), 'saliente' (salió de ella), 'ambos', o null
// (no se sabe). Los manda la función kyt desde el 23 nov. Una ruta vieja, sin
// ellos, se arma igual pero sin sentido por tramo: mejor "sin dato" que una
// flecha supuesta. El rastreo guardado antes decía 'entrada'/'salida'; se
// normaliza para que nadie tenga que acordarse de las dos formas.
export const sentidoNorm = (f: any): string | null =>
  f === 'entrada' ? 'entrante' : f === 'salida' ? 'saliente' : (f ?? null);

export function caminoDe(r: any, address: string): { nodos: string[]; tramos: (string | null)[] } {
  if (Array.isArray(r?.nodos) && r.nodos.length >= 2) {
    const tramos = Array.isArray(r.tramos) && r.tramos.length === r.nodos.length - 1
      ? r.tramos.map(sentidoNorm) : r.nodos.slice(1).map(() => null);
    return { nodos: r.nodos, tramos };
  }
  // El proveedor manda los intermediarios desde la señalada hacia acá.
  const medios: string[] = r?.intermediarios?.length ? [...r.intermediarios].reverse()
    : (r?.intermediario ? [r.intermediario] : []);
  const nodos = [address, ...medios, r?.contaminante];
  // Una directa vieja sí trae su sentido: es el único tramo.
  const tramos = nodos.length === 2 ? [sentidoNorm(r?.flujo)] : nodos.slice(1).map(() => null);
  return { nodos, tramos };
}

// El sentido de la ruta ENTERA. Una ruta vieja con intermediario solo traía
// el del primer tramo (el error del 23 nov): ese no se usa como de la ruta.
export const flujoRuta = (r: any): string | null =>
  Array.isArray(r?.nodos) ? sentidoNorm(r.flujo)
    : (r?.intermediarios?.length || r?.intermediario) ? null
    : sentidoNorm(r?.flujo);

// ── Sarblock (desde el 23 nov, la consulta normal de EVM y TRON) ──
// Las palabras salen de su documentación (docs.sarblock.com/reference/
// wallets): la recomendación es "el campo para decidir", y el puntaje y las
// señales sirven para mostrar y priorizar. No se traducen a la escala de
// MistTrack: son dos proveedores con dos escalas, y mezclarlas sería decir
// de uno lo que dijo el otro.

/** Qué hacer, según la recomendación de Sarblock (su tabla, en orden). */
export const RECOMENDACIONES_SB: { codigo: string; titulo: string; detalle: string }[] = [
  { codigo: 'CLEAR', titulo: 'Sin hallazgos que lo impidan', detalle: 'Se puede operar con esta dirección.' },
  { codigo: 'MONITOR', titulo: 'Operar con vigilancia', detalle: 'Sigue, pero con seguimiento de sus movimientos.' },
  { codigo: 'REVIEW', titulo: 'Revisión de cumplimiento', detalle: 'Que una persona de cumplimiento la revise antes de operar con esa dirección.' },
  { codigo: 'BLOCK', titulo: 'No operar', detalle: 'Hay una sanción o un hallazgo crítico.' },
];
export const recomendacionSb = (codigo: any) =>
  RECOMENDACIONES_SB.find(r => r.codigo === String(codigo ?? '').toUpperCase()) ?? null;

/** Nivel de riesgo de Sarblock (riskLevel), en palabras. */
export function nivelSarblockEs(nivel: any): string {
  const l = String(nivel ?? '').toUpperCase();
  return l === 'NONE' ? 'Sin riesgo' : l === 'LOW' ? 'Bajo' : l === 'MEDIUM' ? 'Medio'
    : l === 'HIGH' ? 'Alto' : l === 'CRITICAL' ? 'Crítico' : l === 'EXTREME' ? 'Extremo' : 'Sin clasificar';
}
export const severidadEs = (s: any): string => {
  const l = String(s ?? '').toUpperCase();
  return l === 'LOW' ? 'baja' : l === 'MEDIUM' ? 'media' : l === 'HIGH' ? 'alta' : l === 'CRITICAL' ? 'crítica' : (l ? l.toLowerCase() : '—');
};
export const confianzaEs = (s: any): string => {
  const l = String(s ?? '').toUpperCase();
  return l === 'HIGH' ? 'alta' : l === 'MEDIUM' ? 'media' : l === 'LOW' ? 'baja' : '—';
};

// Las señales: el conjunto de códigos de Sarblock es ABIERTO (pueden
// aparecer nuevos). Se traducen los que conocemos por su forma, y uno nuevo
// se muestra con su código tal cual, legible, en vez de esconderlo.
const CATEGORIA_SB: Record<string, string> = {
  MIXER: 'un mezclador', SANCTIONS: 'una entidad sancionada', SANCTIONED: 'una entidad sancionada',
  GAMBLING: 'apuestas', DARKNET: 'un mercado de la darknet', SCAM: 'una estafa', HACK: 'un hackeo',
  RANSOMWARE: 'ransomware', BRIDGE: 'un puente entre redes', EXCHANGE: 'un exchange',
  TERRORISM: 'financiación del terrorismo', FROZEN: 'fondos congelados', PHISHING: 'phishing',
};
export function senalEs(code: any, category?: any): string {
  const c = String(code ?? '').toUpperCase().trim();
  if (!c) return 'Señal sin código';
  const san = c.match(/^SANCTION(?:ED)?_?(.*)$/);
  if (san) return `Dirección sancionada${san[1] ? ` (${san[1].replace(/_/g, ' ')})` : ''}`;
  const inter = c.match(/^(.+?)_INTERACTION$/);
  if (inter) {
    const q = CATEGORIA_SB[inter[1]] ?? CATEGORIA_SB[String(category ?? '').toUpperCase()] ?? inter[1].replace(/_/g, ' ').toLowerCase();
    return `Interacción con ${q}`;
  }
  const t = c.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Reporte AML con el diseño del informe de Sarblock (23 nov) ──
// El dueño pidió que el reporte de Lincoin se viera como el PDF que Sarblock
// genera en su plataforma. Ese PDF trae más de lo que la API nos entrega (los
// hallazgos informativos, los puntos de cada hallazgo, las rutas, la fecha de
// cada lista): acá solo se dice lo que la API devolvió. Las palabras de la
// escala, la metodología y los chequeos son las del propio informe de
// Sarblock (metodología v1), no nuestras.

/** La categoría de una señal, como sustantivo para agrupar ("Comportamiento"). */
const CATEGORIA_SB_NOMBRE: Record<string, string> = {
  MIXER: 'Mezcladores', BRIDGE: 'Puentes entre redes', SANCTIONS: 'Sanciones', SANCTIONED: 'Sanciones',
  FROZEN: 'Congelamientos', FREEZE: 'Congelamientos', SCAM: 'Estafas', HACK: 'Hackeos', PHISHING: 'Phishing',
  RANSOMWARE: 'Ransomware', DARKNET: 'Darknet', GAMBLING: 'Apuestas', EXCHANGE: 'Exchanges',
  TERRORISM: 'Financiación del terrorismo', BEHAVIOR: 'Comportamiento', BEHAVIOUR: 'Comportamiento',
  PROFILE: 'Perfil de la wallet',
};
export function categoriaSbEs(cat: any): string {
  const c = String(cat ?? '').toUpperCase().trim();
  if (!c) return 'Sin categoría';
  if (CATEGORIA_SB_NOMBRE[c]) return CATEGORIA_SB_NOMBRE[c];
  const t = c.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Qué quiere decir una señal. Solo para los códigos que conocemos de la
 *  documentación; uno nuevo se explica por su categoría, sin inventarle un
 *  significado. */
export function descripcionSenalSb(code: any, category?: any): string {
  const c = String(code ?? '').toUpperCase();
  const cat = String(category ?? '').toUpperCase();
  if (c === 'SANCTIONED_OFAC') return 'La dirección figura en la lista de sanciones de OFAC (Departamento del Tesoro de EE. UU.).';
  if (/^SANCTION/.test(c)) return 'La dirección figura en una lista oficial de sanciones.';
  if (c === 'NEW_WALLET') return 'La wallet es nueva: todavía tiene poco o ningún historial en la red. No dice nada malo de ella; solo que no hay de dónde juzgarla.';
  if (c === 'RAPID_PASS_THROUGH') return 'Los fondos entran y salen de la wallet en poco tiempo, un patrón que se revisa porque puede servir para mover dinero de paso.';
  if (c === 'MIXER_INTERACTION') return 'La wallet movió fondos con un mezclador, un servicio que junta fondos de muchas personas para ocultar su origen.';
  if (/_INTERACTION$/.test(c)) return `La wallet movió fondos con ${CATEGORIA_SB[c.replace(/_INTERACTION$/, '')] ?? CATEGORIA_SB[cat] ?? 'una contraparte de riesgo'}.`;
  if (cat && CATEGORIA_SB_NOMBRE[cat]) return `Hallazgo de la categoría «${CATEGORIA_SB_NOMBRE[cat]}».`;
  return 'Hallazgo reportado por SARBLOCK con este código.';
}

/** La conclusión de la portada, según la recomendación (el campo para decidir). */
export function conclusionSb(codigo: any): string {
  const c = String(codigo ?? '').toUpperCase();
  return c === 'CLEAR' ? 'Se puede operar' : c === 'MONITOR' ? 'Operar con vigilancia'
    : c === 'REVIEW' ? 'Revisar antes de operar' : c === 'BLOCK' ? 'No operar' : 'Sin recomendación';
}

/** La escala del puntaje, como la publica el informe de Sarblock (metodología v1). */
export const ESCALA_SB: { level: string; nombre: string; rango: string }[] = [
  { level: 'LOW', nombre: 'Bajo', rango: '1–49' },
  { level: 'MEDIUM', nombre: 'Medio', rango: '50–69' },
  { level: 'HIGH', nombre: 'Alto', rango: '70–84' },
  { level: 'EXTREME', nombre: 'Extremo', rango: '85–100' },
];

/** Los chequeos que corre el análisis, con los nombres y fuentes del informe
 *  de Sarblock. La API solo nombra los que tuvieron hallazgos (`flagged`) y
 *  cuenta el resto: la lista completa se arma SOLO si son 7 y cada nombre
 *  marcado coincide sin duda con uno de estos; si no, se muestra lo que vino. */
export const CHEQUEOS_SB: { nombre: string; fuente: string; alias: string[] }[] = [
  { nombre: 'Sanciones de OFAC', fuente: 'OFAC · Departamento del Tesoro de EE. UU.', alias: ['sanciones de ofac', 'ofac'] },
  { nombre: 'Otras listas de sanciones', fuente: 'Listas oficiales de sanciones', alias: ['otras listas de sanciones'] },
  { nombre: 'Mezcladores y puentes', fuente: 'Contratos de servicios identificados', alias: ['mezcladores y puentes', 'mixers y puentes'] },
  { nombre: 'Perfil de la wallet', fuente: 'Análisis del historial de la wallet', alias: ['perfil de la wallet'] },
  { nombre: 'Congelamientos del emisor', fuente: 'Tether y Circle', alias: ['congelamientos del emisor'] },
  { nombre: 'Estafas, hackeos y listas de terceros', fuente: 'ScamSniffer, MyEtherWallet, FBI IC3, NBCTF de Israel y hackeos documentados', alias: ['estafas, hackeos y listas de terceros', 'estafas hackeos y listas de terceros'] },
  { nombre: 'Patrones de comportamiento', fuente: 'Análisis del historial de la wallet', alias: ['patrones de comportamiento'] },
];
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function chequeosSb(ch: any): { completa: boolean; filas: { nombre: string; fuente: string | null; conHallazgo: boolean }[] } {
  const marcados: string[] = Array.isArray(ch?.flagged) ? ch.flagged.map((x: any) => String(x)) : [];
  const idx = marcados.map(m => CHEQUEOS_SB.findIndex(c => c.alias.some(a => sinTildes(a) === sinTildes(m))));
  if (Number(ch?.total) === CHEQUEOS_SB.length && idx.every(i => i >= 0) && new Set(idx).size === idx.length) {
    return { completa: true, filas: CHEQUEOS_SB.map((c, i) => ({ nombre: c.nombre, fuente: c.fuente, conHallazgo: idx.includes(i) })) };
  }
  return {
    completa: false,
    filas: marcados.map(m => ({ nombre: m.charAt(0).toUpperCase() + m.slice(1), fuente: null, conHallazgo: true })),
  };
}
