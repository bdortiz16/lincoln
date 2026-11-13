// Buscar clientes en el servidor desde cualquier buscador del panel.
//
// El panel ya no tiene a todos los clientes en memoria (con decenas de miles
// no puede): trae los que tiene a la vista y el resto se busca. Este hook
// pregunta al servidor lo que se escribe en un buscador (con una pausa, no
// en cada tecla) y devuelve los ids encontrados; los clientes en sí quedan
// en la lista del panel (getAllUsers), así cada pantalla los lee como
// siempre. `conLocales` une lo del servidor con lo que ya estaba cargado y
// coincide, sin repetir.
import { useEffect, useState } from 'react';
import { useDatabase } from '../context/DatabaseContext';

export function useBusquedaClientes(q: string, porPagina = 50): string[] | null {
  const { buscarUsuarios } = useDatabase() as any;
  const [r, setR] = useState<{ q: string; ids: string[] } | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2 || typeof buscarUsuarios !== 'function') { setR(null); return; }
    let vigente = true;
    const t = setTimeout(async () => {
      const res = await buscarUsuarios({ q: s, porPagina });
      if (vigente && res?.ok) setR({ q: s, ids: res.usuarios.map((u: any) => u.id) });
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, porPagina]);
  return r && r.q === q.trim() ? r.ids : null;
}

export function conLocales<T extends { id: string }>(idsServidor: string[] | null, todos: T[], locales: T[]): T[] {
  const porId = new Map(todos.map(u => [u.id, u]));
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const u of [...(idsServidor ?? []).map(id => porId.get(id)).filter(Boolean) as T[], ...locales]) {
    if (vistos.has(u.id)) continue;
    vistos.add(u.id);
    out.push(u);
  }
  return out;
}
