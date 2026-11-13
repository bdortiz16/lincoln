import { createContext, useContext, useEffect, useState } from 'react';
import { llamarFuncion } from './edge';

// El contador opera la facturación de una empresa desde su propio portal:
// cada llamada a `facturacion` lleva el id de la empresa, y el servidor
// revisa que la empresa tenga aprobado a ese contador. La empresa, en su
// propia cuenta, no pone nada (el contexto queda en null).
export const EmpresaFacturacion = createContext<string | null>(null);

export function useFacturacion() {
  const empresaId = useContext(EmpresaFacturacion);
  return (cuerpo: Record<string, unknown>, ms?: number) =>
    llamarFuncion('facturacion', empresaId ? { ...cuerpo, empresaId } : cuerpo, ms);
}

export const useEmpresaFacturacion = () => useContext(EmpresaFacturacion);

// Los ordenantes (modelo Comisión) viven en la ficha de la empresa. Ella los
// lee de su sesión; el contador, del servidor (su sesión es la suya, no la
// de la empresa). `version` vuelve a pedirlos tras un cambio.
export function useOrdenantesEmpresa(deLaSesion: any[], version = 0): any[] {
  const empresaId = useContext(EmpresaFacturacion);
  const [lista, setLista] = useState<any[] | null>(null);
  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    llamarFuncion('facturacion', { action: 'ordenantes_get', empresaId }, 20000)
      .then((r: any) => { if (vivo) setLista(r?.ok && Array.isArray(r.ordenantes) ? r.ordenantes : []); })
      .catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [empresaId, version]);
  return empresaId ? (lista ?? []) : deLaSesion;
}
