// ══════════════════════════════════════════════════════════════════
//  Contador — lo administra la empresa desde Contabilidad.
//
//  El contador tiene su propia cuenta, entra por Empresas → Contabilidad y
//  escribe el ID Lincoin de la empresa. Acá la empresa ve esa solicitud y
//  la aprueba o la rechaza; aprobado, el contador ve solo la contabilidad
//  (movimientos, comprobantes, facturas). Se le quita cuando se quiera.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { X, Trash2, Check, Copy, ShieldCheck, Clock } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';
import { ConfirmarModal } from './ConfirmarModal';

const FONT = 'Archivo, system-ui, sans-serif';
const C = { tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.10)', text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171' };

type Vinculo = { id: string; email: string; nombre: string; at?: string };
const fecha = (ts?: string) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) || !ts ? '' : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); };

export const AccesoContadorModal: React.FC<{ onCerrar: () => void }> = ({ onCerrar }) => {
  const [miId, setMiId] = useState('');
  const [contadores, setContadores] = useState<Vinculo[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<Vinculo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [quitarA, setQuitarA] = useState<Vinculo | null>(null);

  const aplicar = (r: any) => { setContadores(r.contadores ?? []); setSolicitudes(r.solicitudes ?? []); if (r.miId) setMiId(String(r.miId)); };
  const cargar = async () => {
    const r = await llamarFuncion('contador', { action: 'listar_accesos' }, 30000);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo consultar.'); setContadores([]); return; }
    aplicar(r);
  };
  useEffect(() => { cargar(); }, []);

  const accion = async (action: 'aprobar' | 'rechazar' | 'revocar_acceso', c: Vinculo) => {
    setOcupado(c.id); setError(null); setQuitarA(null);
    const r = await llamarFuncion('contador', { action, contadorId: c.id }, 30000);
    setOcupado(null);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo.'); return; }
    aplicar(r);
  };

  const copiar = async () => { try { await navigator.clipboard.writeText(miId); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* */ } };

  const botonSec: React.CSSProperties = { fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 };
  const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: '22px 0 8px' }}>{children}</p>;

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ fontFamily: FONT, width: '100%', maxWidth: 540, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: 22, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.3px' }}>Tu contador</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.5 }}>
              Tu contador entra por <b style={{ color: C.text }}>Empresas → Contabilidad</b> con su propia cuenta, escribe tu ID, y tú lo apruebas aquí. Ve solo esta pantalla: movimientos, comprobantes y facturas. Nada de saldos operables ni envíos.
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>

        {/* El ID que la empresa le da al contador. */}
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, marginTop: 16, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 12, padding: '12px 14px' }}>
          <div>
            <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>TU ID LINCOIN · DÁSELO A TU CONTADOR</p>
            <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '4px', margin: '4px 0 0', color: C.text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{miId || '······'}</p>
          </div>
          <button onClick={copiar} disabled={!miId} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>

        {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: '12px 0 0', lineHeight: 1.45 }}>{error}</p>}

        <Rotulo>SOLICITUDES PENDIENTES</Rotulo>
        {contadores == null ? (
          <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Consultando…</p>
        ) : solicitudes.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, margin: 0, lineHeight: 1.5 }}>Ninguna. Cuando tu contador escriba tu ID, aparece aquí para que lo apruebes.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {solicitudes.map(c => (
              <div key={c.id} className="flex items-center justify-between" style={{ gap: 10, background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.borde}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ minWidth: 0 }}>
                  <p className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, gap: 6 }}><Clock size={13} color={C.sub} /> {c.nombre}</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}{c.at ? ` · pidió acceso el ${fecha(c.at)}` : ''}</p>
                </div>
                <div className="flex items-center" style={{ gap: 6 }}>
                  <button onClick={() => accion('rechazar', c)} disabled={ocupado === c.id} style={botonSec}>Rechazar</button>
                  <button onClick={() => accion('aprobar', c)} disabled={ocupado === c.id} className="lincoin-btn-white" style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: '7px 12px', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: ocupado === c.id ? 0.6 : 1 }}>
                    <Check size={13} /> {ocupado === c.id ? '…' : 'Aprobar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Rotulo>CON ACCESO</Rotulo>
        {contadores == null ? null : contadores.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Nadie todavía.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contadores.map(c => (
              <div key={c.id} className="flex items-center justify-between" style={{ gap: 10, background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.borde}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ minWidth: 0 }}>
                  <p className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, gap: 6 }}><ShieldCheck size={13} color={C.verde} /> {c.nombre}</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}{c.at ? ` · desde ${fecha(c.at)}` : ''}</p>
                </div>
                <button onClick={() => setQuitarA(c)} disabled={ocupado === c.id} title="Quitar acceso" style={botonSec}>
                  <Trash2 size={13} /> {ocupado === c.id ? '…' : 'Quitar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {quitarA && (
        <ConfirmarModal titulo={`¿Quitar el acceso de ${quitarA.nombre}?`} texto="Dejará de ver tu contabilidad de inmediato. Puede volver a pedir acceso con tu ID." confirmar="Quitar acceso" peligro
          onConfirmar={() => accion('revocar_acceso', quitarA)} onCancelar={() => setQuitarA(null)} />
      )}
    </div>
  );
};
