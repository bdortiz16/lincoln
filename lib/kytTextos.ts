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

// ── La banda de riesgo, que es NUESTRA lectura ────────────────────
//
// EL PROBLEMA QUE ESTO ARREGLA
//   MistTrack le puso 3/100 a una dirección cuyo propio detail_list dice
//   "Involved Illicit Activity". Nosotros pintábamos el 3 de verde y arriba
//   escribíamos "está señalada directamente". Dos cosas ciertas que, juntas y
//   en la misma tarjeta, se leen como tranquilizadoras.
//
//   Su puntaje pesa volumen y cercanía. Sus etiquetas reportan un hecho. Un
//   hecho no se promedia hasta desaparecer.
//
// LA REGLA
//   Una dirección señalada NUNCA sale en verde. El puntaje del proveedor se
//   sigue mostrando tal cual —no se falsea su número— pero la banda de color es
//   nuestra y se dice que es nuestra.
const GRAVES = /ilícit|illicit|sancion|sanction|malicious|malicios|lavado|launder|ransom|robo|theft|steal|terroris|mixer|darkweb|dark web/i;

export function bandaDeRiesgo(
  categoriaProveedor: string | undefined,
  hallazgos: string[],
): { categoria: 'alto' | 'medio' | 'bajo' | 'sin_dato'; elevada: boolean; motivo: string | null } {
  const base = (categoriaProveedor as any) ?? 'sin_dato';
  if (!hallazgos.length) return { categoria: base, elevada: false, motivo: null };

  const grave = hallazgos.some(h => GRAVES.test(h));
  const ORDEN: Record<string, number> = { sin_dato: 0, bajo: 1, medio: 2, alto: 3 };
  const propuesta = grave ? 'alto' : 'medio';
  // Solo se SUBE. Si el proveedor ya dice alto, se queda en alto.
  const final = (ORDEN[propuesta] > (ORDEN[base] ?? 0) ? propuesta : base) as any;

  return {
    categoria: final,
    elevada: final !== base,
    motivo: final !== base
      ? (grave
          ? 'El proveedor le puso un puntaje bajo, pero sus propias etiquetas señalan a esta dirección por hechos graves. El puntaje pesa volumen y cercanía; una etiqueta reporta un hecho.'
          : 'El proveedor le puso un puntaje bajo, pero reportó señalamientos sobre esta misma dirección.')
      : null,
  };
}
