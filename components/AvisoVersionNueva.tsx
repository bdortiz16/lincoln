import React, { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// Aviso de versión nueva.
//
// La app y los paneles quedan abiertos horas o días en la misma pestaña, y
// sin recargar siguen corriendo el código con que se abrieron. El 22 nov el
// dueño bajó el Excel de movimientos de un cliente después del despliegue
// que lo cambiaba y le salió igual: la pestaña tenía el código viejo.
//
// Cada compilación deja /version.json con su id (vite.config.ts) y se sirve
// sin caché (public/_headers). Acá se compara cada pocos minutos, y al volver
// a la pestaña, con el id con que se compiló ESTE código. Si cambió, se
// avisa con un botón para recargar. No se recarga solo: se perdería lo que
// la persona está escribiendo, o un envío a mitad de confirmar.
// ─────────────────────────────────────────────────────────────

declare const __BUILD_ID__: string;

const CADA_MS = 3 * 60_000;

export const AvisoVersionNueva: React.FC = () => {
  const [hayNueva, setHayNueva] = useState(false);
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    const propia = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
    if (!propia || propia === 'dev') return;
    let vivo = true;
    const revisar = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        // Donde no hay version.json (desarrollo) responde la página: no es JSON y se ignora.
        const d = await r.json().catch(() => null);
        const id = d && typeof d.id === 'string' ? d.id : '';
        if (vivo && id && id !== propia) setHayNueva(true);
      } catch { /* sin red: se vuelve a intentar en la próxima vuelta */ }
    };
    const t = setInterval(revisar, CADA_MS);
    const alVolver = () => { void revisar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    void revisar();
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('focus', alVolver); };
  }, []);

  if (!hayNueva || oculto) return null;
  return (
    <div role="status" style={{
      position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 2147483000, margin: '0 auto', maxWidth: 560,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: '#121413', color: '#F4F4F2', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 14,
      padding: '12px 14px', boxShadow: '0 10px 30px rgba(0,0,0,0.45)', fontFamily: 'Archivo, system-ui, sans-serif',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ADE80', flexShrink: 0 }} />
      <span style={{ flex: '1 1 220px', fontSize: 13, lineHeight: 1.45 }}>
        <strong>Hay una versión nueva de Lincoin.</strong> Recargá para usarla (lo que hagas antes sigue con la versión anterior).
      </span>
      <button onClick={() => window.location.reload()}
        style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#0A0B0A', background: '#F4F4F2', border: 'none', borderRadius: 9, padding: '8px 14px', cursor: 'pointer' }}>
        Recargar
      </button>
      <button onClick={() => setOculto(true)} aria-label="Ahora no"
        style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#878E88', background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 4px' }}>
        Ahora no
      </button>
    </div>
  );
};
