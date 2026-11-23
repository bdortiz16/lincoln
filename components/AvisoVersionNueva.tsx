import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// "Hay una versión nueva del panel".
//
// 23 nov: el dueño veía la tarjeta de Utilidades de AML y KYT en cero y sin
// el botón del reporte. Era una pestaña abierta desde la medianoche, de
// antes de que ese cambio saliera, que además había dejado de actualizarse.
// Cada despliegue cambia el nombre del archivo principal (/assets/index-….js):
// cada pocos minutos se compara el de esta pestaña con el que sirve hoy el
// sitio y, si cambió, se ofrece recargar. No recarga sola: quien está en la
// mitad de un cargue o de un cierre no puede perder lo que escribió.
// En desarrollo (sin /assets/index-…) no hace nada.
// ─────────────────────────────────────────────────────────────

const PATRON = /\/assets\/index-[\w-]+\.js/;
const CADA_MS = 5 * 60_000;

function archivoActual(): string | null {
  const s = Array.from(document.querySelectorAll('script[src]')).map(x => (x as HTMLScriptElement).src).find(src => PATRON.test(src));
  return s ? (s.match(PATRON)?.[0] ?? null) : null;
}

export const AvisoVersionNueva: React.FC = () => {
  const [nueva, setNueva] = useState(false);

  useEffect(() => {
    const mio = archivoActual();
    if (!mio) return;
    let vivo = true;
    const revisar = async () => {
      if (!vivo || document.hidden) return;
      try {
        const r = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
        const html = await r.text();
        const servido = html.match(PATRON)?.[0] ?? null;
        if (vivo && servido && servido !== mio) setNueva(true);
      } catch { /* sin red: se vuelve a intentar en el siguiente turno */ }
    };
    const t = setInterval(revisar, CADA_MS);
    const alVolver = () => { if (!document.hidden) revisar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, []);

  if (!nueva) return null;
  return (
    <div role="status"
      style={{ position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 9500, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 10px 16px', borderRadius: 12, background: '#121413', border: '1px solid rgba(74,222,128,0.35)', boxShadow: '0 12px 32px rgba(0,0,0,0.45)', color: '#F4F4F2', fontFamily: "'Archivo', system-ui, sans-serif", fontSize: 13, maxWidth: 'calc(100vw - 32px)' }}>
      <span>Hay una versión nueva del panel. Recarga para ver los últimos cambios.</span>
      <button type="button" onClick={() => window.location.reload()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '7px 12px', borderRadius: 9, border: 'none', background: '#4ADE80', color: '#0C0E0D', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
        <RefreshCw size={13} /> Recargar
      </button>
    </div>
  );
};
