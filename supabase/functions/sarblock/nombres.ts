// ════════════════════════════════════════════════════════
// El nombre inscrito contra el nombre del documento.
//
// El documento (Registraduría) manda: el nombre oficial es la verdad, y el
// que escribió el cliente solo sirve para comprobar que el documento es de
// esa persona. Tres resultados:
//
//   'igual'      → las mismas palabras.
//   'incompleto' → el MISMO nombre escrito corto o con una letra distinta:
//                  "JEISY URREA" para "JEISSY TATIANA URREA RAMIREZ". No es
//                  otra persona y NO bloquea (TusDatos lo trataba igual).
//   'distinto'   → no corresponde: otra persona. Bloquea.
//
// Sarblock marca "posible suplantación" por similitud de texto, y un nombre
// abreviado le da una similitud baja (0,39 en el caso real de arriba). Por
// eso la decisión es nuestra, palabra por palabra.
// ════════════════════════════════════════════════════════

const RELLENO = new Set(['SAS', 'SA', 'SAC', 'LTDA', 'LTD', 'EU', 'BIC', 'CIA', 'INC', 'CORP', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'EN']);

export const palabras = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !RELLENO.has(t));

// Distancia de edición, cortada en 2 (solo interesa si es 0 o 1).
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Una palabra escrita "es" una del documento si es igual, si le sobra o le
// falta una letra (JEISY ~ JEISSY), o si es su abreviatura (FDO ~ FERNANDO no,
// pero "ALEJ" ~ "ALEJANDRO" sí: prefijo de 4 letras o más).
function mismaPalabra(escrita: string, oficial: string): boolean {
  if (escrita === oficial) return true;
  if (escrita.length >= 4 && oficial.length >= 4 && distancia(escrita, oficial) <= 1) return true;
  return escrita.length >= 4 && oficial.startsWith(escrita);
}

export type Comparacion = 'igual' | 'incompleto' | 'distinto';

export function compararNombres(escrito: unknown, oficial: unknown): Comparacion | undefined {
  const a = palabras(escrito), b = palabras(oficial);
  if (!a.length || !b.length) return undefined;
  const libres = [...b];
  let exactas = 0, parecidas = 0;
  for (const p of a) {
    const i = libres.findIndex(o => o === p);
    if (i >= 0) { exactas++; libres.splice(i, 1); continue; }
    const j = libres.findIndex(o => mismaPalabra(p, o));
    if (j >= 0) { parecidas++; libres.splice(j, 1); continue; }
    return 'distinto';   // una palabra que no está en el documento: otra persona
  }
  if (!parecidas && a.length === b.length) return 'igual';
  // Con una sola palabra no alcanza para decir que es la misma persona
  // ("JUAN" calza con miles de documentos).
  return exactas + parecidas >= 2 || a.length === b.length ? 'incompleto' : 'distinto';
}
