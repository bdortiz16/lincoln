// Todos los movimientos de UN cliente, para el panel admin.
//
// La carga general del panel trae solo los 200 movimientos más recientes de
// toda la plataforma (más los pendientes). Al abrir un cliente eso dejaba ver
// únicamente lo que cayera en esa ventana: sus cargues y movimientos más
// viejos no aparecían. Este hook le pide al servidor el historial completo de
// esa cuenta y lo une con lo que ya hay en memoria (lo de memoria manda en lo
// repetido: es lo más fresco).
import { useEffect, useMemo, useState } from 'react';
import { pedirAdmin } from './adminApi';

// Mismo formato que arma DatabaseContext para el admin, con la fecha real de
// la fila por si el raw_data no la trae.
// El servidor trae también los movimientos guardados bajo otro id de la misma
// persona (mismo correo); se les pone el id del cliente abierto para que todas
// las vistas que filtran por él los cuenten. El id original queda aparte.
const mapear = (t: any, userId: string) => ({
  id: t.id, userId, userIdOriginal: t.user_id, type: t.type,
  amount: Number(t.amount), currency: t.currency, status: t.status,
  created_at: t.created_at, createdAt: t.created_at,
  ...(t.raw_data ?? {}),
});

export function useMovimientosCliente(userId: string | null | undefined, globales: any[]) {
  const [extra, setExtra] = useState<{ id: string; filas: any[]; ids: string[]; truncado?: boolean } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!userId) { setExtra(null); setError(null); return; }
    let vivo = true;
    setCargando(true); setError(null);
    pedirAdmin({ action: 'movimientos_cliente', userId })
      .then((r: any) => {
        if (!vivo) return;
        if (r?.ok && Array.isArray(r.transactions)) setExtra({ id: userId, filas: r.transactions.map((t: any) => mapear(t, userId)), ids: Array.isArray(r.ids) ? r.ids.map(String) : [userId], truncado: r.truncado === true });
        else setError(r?.error ?? 'No se pudo traer el historial completo.');
      })
      .catch((e: any) => { if (vivo) setError(String(e?.message ?? e)); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [userId, version]);

  const movimientos = useMemo(() => {
    const misIds = new Set<string>(extra && extra.id === userId ? extra.ids : (userId ? [userId] : []));
    const propios = (globales ?? []).filter((t: any) => misIds.has(String(t?.userId)));
    if (!userId || !extra || extra.id !== userId) return propios;
    const porId = new Map<string, any>(extra.filas.map((t: any) => [String(t.id), t]));
    for (const t of propios) porId.set(String(t.id), { ...(porId.get(String(t.id)) ?? {}), ...t, userId, userIdOriginal: t.userId });
    return Array.from(porId.values());
  }, [globales, extra, userId]);

  return {
    movimientos,
    total: extra && extra.id === userId ? extra.filas.length : null,
    ids: extra && extra.id === userId ? extra.ids : [],
    cargando,
    error,
    // "Completo" solo si el servidor no cortó el historial por el tope.
    completo: !!userId && !!extra && extra.id === userId && !extra.truncado,
    truncado: !!userId && !!extra && extra.id === userId && !!extra.truncado,
    recargar: () => setVersion(v => v + 1),
  };
}
