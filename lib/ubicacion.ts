// ════════════════════════════════════════════════════════
// Dónde aparece una persona, según sus procesos judiciales (Lincoin Risk).
//
// Sarblock no entrega la dirección ni el lugar de expedición. Lo que sí trae
// es el despacho de cada proceso en la Rama Judicial ("JUZGADO 003 DE FAMILIA
// DE MANIZALES"). De ahí se saca la ciudad y su departamento con la lista
// oficial de municipios (DANE). Se muestra con su fuente: no es la dirección
// de la persona, es dónde tiene procesos.
// ════════════════════════════════════════════════════════
import { MUNICIPIOS } from './municipios';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

// Nombre de municipio → candidatos. Con nombres repetidos ("LA UNIÓN") gana
// la capital del departamento (código terminado en 001): los juzgados están
// casi siempre en capitales o cabeceras.
const POR_NOMBRE = new Map<string, typeof MUNICIPIOS>();
for (const m of MUNICIPIOS) {
  const k = norm(m.nombre);
  if (!POR_NOMBRE.has(k)) POR_NOMBRE.set(k, []);
  POR_NOMBRE.get(k)!.push(m);
}
// Bogotá aparece en los despachos de muchas formas.
const ALIAS: Record<string, string> = { 'BOGOTA': 'BOGOTA D C', 'BOGOTA D C': 'BOGOTA D C', 'SANTAFE DE BOGOTA': 'BOGOTA D C', 'CARTAGENA': 'CARTAGENA DE INDIAS', 'CUCUTA': 'SAN JOSE DE CUCUTA' };
const nombres = [...POR_NOMBRE.keys()].sort((a, b) => b.length - a.length);

export type Lugar = { municipio: string; codigo: string; depto: string; deptoNombre: string };

export function lugarDeDespacho(despacho: unknown): Lugar | null {
  const t = ` ${norm(String(despacho ?? ''))} `;
  if (t.trim().length < 4) return null;
  // Se prefiere lo que va después del último " DE ": ahí suele ir la ciudad.
  const cola = t.slice(t.lastIndexOf(' DE ') + 1);
  for (const zona of [cola, t]) {
    for (const [alias, real] of Object.entries(ALIAS)) {
      if (zona.includes(` ${alias} `) && POR_NOMBRE.has(real)) return elegir(POR_NOMBRE.get(real)!);
    }
    const n = nombres.find(k => k.length >= 4 && zona.includes(` ${k} `));
    if (n) return elegir(POR_NOMBRE.get(n)!);
  }
  return null;
}
function elegir(c: typeof MUNICIPIOS): Lugar {
  const m = c.find(x => x.codigo.endsWith('001')) ?? c[0];
  return { municipio: m.nombre, codigo: m.codigo, depto: m.depto, deptoNombre: m.deptoNombre };
}

// Los lugares de una lista de despachos (los de los procesos donde la persona
// es parte pasiva: la función sarblock los manda ya filtrados), sin repetir.
export function lugaresDeDespachos(despachos: string[] | null | undefined): Array<Lugar & { procesos: number }> {
  const out = new Map<string, Lugar & { procesos: number }>();
  for (const d of despachos ?? []) {
    const l = lugarDeDespacho(d);
    if (l) out.set(l.codigo, { ...l, procesos: (out.get(l.codigo)?.procesos ?? 0) + 1 });
  }
  return [...out.values()].sort((a, b) => b.procesos - a.procesos);
}

// El mapa agregado: por departamento, cuántas personas y cuántos procesos.
export function mapaDePersonas(personas: string[][]) {
  const porDepto: Record<string, { depto: string; nombre: string; personas: number; procesos: number }> = {};
  let sinUbicacion = 0;
  for (const p of personas) {
    const lugares = lugaresDeDespachos(p);
    if (!lugares.length) { sinUbicacion++; continue; }
    const vistos = new Set<string>();
    for (const l of lugares) {
      const d = (porDepto[l.depto] ??= { depto: l.depto, nombre: l.deptoNombre, personas: 0, procesos: 0 });
      d.procesos += l.procesos;
      if (!vistos.has(l.depto)) { d.personas++; vistos.add(l.depto); }
    }
  }
  return { departamentos: Object.values(porDepto), sinUbicacion };
}
