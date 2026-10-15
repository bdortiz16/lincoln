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
const mapear = (t: any) => ({
  id: t.id, userId: t.user_id, type: t.type,
  amount: Number(t.amount), currency: t.currency, status: t.status,
  created_at: t.created_at, createdAt: t.created_at,
  ...(t.raw_data ?? {}),
});

export function useMovimientosCliente(userId: string | null | undefined, globales: any[]) {
  const [extra, setExtra] = useState<{ id: string; filas: any[] } | null>(null);
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
        if (r?.ok && Array.isArray(r.transactions)) setExtra({ id: userId, filas: r.transactions.map(mapear) });
        else setError(r?.error ?? 'No se pudo traer el historial completo.');
      })
      .catch((e: any) => { if (vivo) setError(String(e?.message ?? e)); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [userId, version]);

  const movimientos = useMemo(() => {
    const propios = (globales ?? []).filter((t: any) => t?.userId === userId);
    if (!userId || !extra || extra.id !== userId) return propios;
    const porId = new Map<string, any>(extra.filas.map((t: any) => [String(t.id), t]));
    for (const t of propios) porId.set(String(t.id), { ...(porId.get(String(t.id)) ?? {}), ...t });
    return Array.from(porId.values());
  }, [globales, extra, userId]);

  return {
    movimientos,
    cargando,
    error,
    completo: !!userId && !!extra && extra.id === userId,
    recargar: () => setVersion(v => v + 1),
  };
}
