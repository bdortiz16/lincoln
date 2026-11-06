import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Colores y fuente de Lincoin (los mismos de Contabilidad).
const FONT = 'Archivo, system-ui, sans-serif';
const C = { text: '#F4F4F2', sub: '#878E88', borde: 'rgba(255,255,255,0.08)', entra: '#4ADE80' };
const ROJO = '#F87171';

// ── Volver a emitir una factura rechazada por la DIAN ─────────────
// Ventana de Lincoin (antes era el confirm() del navegador, «lincoin.me
// dice»). Pregunta, envía y muestra la respuesta en la misma ventana.
// Es la MISMA factura de Siigo, corregida (fecha de hoy) y reenviada: no se
// crea otra.
export const ReenvioDianModal: React.FC<{
  numero: string | null;
  /** Hace el reenvío; devuelve la respuesta del servidor. */
  enviar: () => Promise<any>;
  onCerrar: (enviada: boolean) => void;
}> = ({ numero, enviar, onCerrar }) => {
  const [fase, setFase] = useState<'pregunta' | 'enviando' | 'hecho'>('pregunta');
  const [res, setRes] = useState<{ ok: boolean; texto: string } | null>(null);
  const hoy = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
  const nombre = numero ?? 'la factura';
  const cerrar = () => { if (fase !== 'enviando') onCerrar(!!res?.ok); };
  const confirmar = async () => {
    setFase('enviando');
    const r = await enviar().catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setRes(r?.ok ? { ok: true, texto: String(r.aviso ?? 'Enviada otra vez a la DIAN.') } : { ok: false, texto: String(r?.error ?? 'No se pudo reenviar la factura.') });
    setFase('hecho');
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  // En document.body: se abre desde dentro de otras ventanas (el detalle del
  // movimiento), y ahí un `transform` del contenedor la dejaría mal ubicada.
  return createPortal(
    <div className="fixed inset-0 z-[120] p-4" style={{ background: 'rgba(4,5,4,0.85)', display: 'grid', placeItems: 'center' }} onClick={cerrar}>
      <div role="dialog" aria-modal="true" aria-labelledby="reenvio-dian-titulo" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, fontFamily: FONT, padding: '20px 22px' }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <p id="reenvio-dian-titulo" style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Volver a emitir {nombre}</p>
            <p style={{ fontSize: 12, color: ROJO, margin: '3px 0 0', fontWeight: 700 }}>Rechazada por la DIAN</p>
          </div>
          <button onClick={cerrar} disabled={fase === 'enviando'} aria-label="Cerrar" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.borde}`, background: 'transparent', color: C.sub, fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>
        {fase !== 'hecho' ? (
          <>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.55, margin: '14px 0 0' }}>
              Se corrige la fecha a la de hoy ({hoy}) y {numero ? `la ${numero}` : 'la factura'} se vuelve a enviar a la DIAN.
            </p>
            <p style={{ fontSize: 12, color: C.sub, lineHeight: 1.55, margin: '8px 0 0' }}>
              Es la misma factura de Siigo, con el mismo número: no se crea una factura nueva ni se cobra dos veces. La DIAN la valida en unos minutos.
            </p>
            <div className="flex" style={{ gap: 8, marginTop: 18 }}>
              <button onClick={cerrar} disabled={fase === 'enviando'} className="flex-1"
                style={{ fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, cursor: 'pointer', opacity: fase === 'enviando' ? 0.5 : 1 }}>Cancelar</button>
              <button onClick={confirmar} disabled={fase === 'enviando'} className="flex-1"
                style={{ fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, color: '#0A0A0A', background: '#F4F4F2', border: 'none', cursor: 'pointer', opacity: fase === 'enviando' ? 0.6 : 1 }}>
                {fase === 'enviando' ? 'Enviando a la DIAN…' : 'Corregir y enviar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, border: `1px solid ${res?.ok ? 'rgba(74,222,128,0.30)' : 'rgba(248,113,113,0.35)'}`, background: res?.ok ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)' }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: res?.ok ? C.entra : ROJO, margin: 0 }}>{res?.ok ? 'Enviada a la DIAN' : 'No se pudo reenviar'}</p>
              <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55, margin: '4px 0 0', wordBreak: 'break-word' }}>{res?.texto}</p>
            </div>
            <button onClick={cerrar} className="w-full"
              style={{ fontFamily: FONT, marginTop: 16, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, color: '#0A0A0A', background: '#F4F4F2', border: 'none', cursor: 'pointer' }}>Cerrar</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
