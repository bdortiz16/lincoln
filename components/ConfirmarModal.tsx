// ══════════════════════════════════════════════════════════════════
//  ConfirmarModal — el "¿Seguro?" de Lincoin.
//
//  Reemplaza window.confirm(), que muestra el cuadro gris del navegador con
//  "www.lincoin.me dice". Misma pregunta, con la cara del producto: fondo
//  oscuro, Archivo, y el botón de confirmar a la derecha. Enter confirma,
//  Escape cancela, y el foco arranca en Cancelar para que un Enter por
//  costumbre no cierre nada por accidente.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useRef } from 'react';

const FONT = 'Archivo, system-ui, sans-serif';
const C = { tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.10)', text: '#F4F4F2', sub: '#878E88', verde: '#4ADE80', rojo: '#F87171' };

type Props = {
  titulo: string;
  texto?: string;
  /** Texto del botón que confirma. */
  confirmar?: string;
  cancelar?: string;
  /** Acción destructiva: el botón de confirmar va en rojo tenue. */
  peligro?: boolean;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
};

export const ConfirmarModal: React.FC<Props> = ({ titulo, texto, confirmar = 'Aceptar', cancelar = 'Cancelar', peligro = false, ocupado = false, onConfirmar, onCancelar }) => {
  const cancelarRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelarRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancelar(); }
      if (e.key === 'Enter' && document.activeElement !== cancelarRef.current) { e.preventDefault(); if (!ocupado) onConfirmar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirmar, onCancelar, ocupado]);

  return (
    <div onClick={onCancelar} role="dialog" aria-modal="true" aria-labelledby="confirmar-titulo"
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.66)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: FONT }}>
      <div onClick={e => e.stopPropagation()} className="animate-in zoom-in-95 fade-in duration-200"
        style={{ width: '100%', maxWidth: 400, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 18, padding: '24px 24px 20px', boxShadow: '0 30px 90px rgba(0,0,0,0.6)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -70, right: -50, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${peligro ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.14)'}, transparent 65%)`, pointerEvents: 'none' }} />
        <p style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.5px', color: C.text, margin: 0, lineHeight: 1 }}>Lincoin<span style={{ color: C.verde }}>.</span></p>
        <h2 id="confirmar-titulo" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px', color: C.text, margin: '16px 0 0', lineHeight: 1.25 }}>{titulo}</h2>
        {texto && <p style={{ fontSize: 13.5, color: C.sub, margin: '8px 0 0', lineHeight: 1.55 }}>{texto}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>
          <button ref={cancelarRef} onClick={onCancelar} disabled={ocupado}
            style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13.5, color: C.text, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.borde}`, borderRadius: 10, padding: '11px 18px', cursor: 'pointer' }}>
            {cancelar}
          </button>
          <button onClick={onConfirmar} disabled={ocupado} className={peligro ? '' : 'lincoin-btn-white'}
            style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13.5, borderRadius: 10, padding: '11px 18px', cursor: 'pointer', border: 'none', opacity: ocupado ? 0.6 : 1,
              ...(peligro ? { color: C.rojo, background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)' } : {}) }}>
            {ocupado ? '…' : confirmar}
          </button>
        </div>
      </div>
    </div>
  );
};
