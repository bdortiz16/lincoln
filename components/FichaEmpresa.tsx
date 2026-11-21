// ══════════════════════════════════════════════════════════════════
//  Ficha de la empresa — la bolita con su nombre y lo que hay adentro
//
//  La misma ficha la abren los dos lados:
//  · El contador, desde su portal (junto a "Actualizar"): los datos de la
//    empresa y sus documentos contables, que él anexa o retira.
//  · La empresa, desde su Contabilidad: autoriza o quita a su contador
//    (solicitudes en espera arriba, para que no se pierdan), descarga los
//    documentos que le anexaron y ve sus datos.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DocumentosContables } from './DocumentosContables';
import { AccesoContadorPanel, ExplicacionContador, type Vinculo } from './AccesoContadorModal';
import type { FichaEmpresa } from './libroContable';

const FONT = 'Archivo, system-ui, sans-serif';
const C = { tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)', text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80' };

// La bolita de la empresa: sus iniciales (MEXITECH → ME, J&J EYEWEAR → JE).
export const inicialesDe = (nombre: string) => {
  const p = String(nombre ?? '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9 ]+/g, ' ').trim().split(/\s+/).filter(w => !/^(S|SAS|SA|LTDA|EU)$/i.test(w));
  return ((p.length > 1 ? p[0][0] + p[1][0] : (p[0] ?? '?').slice(0, 2)) || '?').toUpperCase();
};
export const Bolita: React.FC<{ nombre: string; activo?: boolean; tam?: number }> = ({ nombre, activo, tam = 26 }) => (
  <span aria-hidden="true" style={{ width: tam, height: tam, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: Math.round(tam * 0.4), fontWeight: 800, letterSpacing: '-0.3px',
    color: activo ? '#0A0A0A' : C.text, background: activo ? C.verde : 'rgba(255,255,255,0.08)', border: `1px solid ${activo ? C.verde : 'rgba(255,255,255,0.12)'}` }}>
    {inicialesDe(nombre)}
  </span>
);

const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: '0 0 8px' }}>{children}</p>
);

const DatosEmpresa: React.FC<{ empresa: FichaEmpresa }> = ({ empresa }) => {
  const desde = empresa.clienteDesde ? new Date(empresa.clienteDesde).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }) : '';
  const filas = ([
    ['Identificación', [empresa.tipoDocumento, empresa.nit].filter(Boolean).join(' ')],
    ['Representante legal', [empresa.representante, empresa.representanteDoc].filter(Boolean).join(' · ')],
    ['Dirección', empresa.direccion],
    ['Ciudad', [empresa.ciudad, empresa.pais].filter(Boolean).join(', ')],
    ['Teléfono', empresa.telefono],
    ['Correo', empresa.email],
    ['Cliente Lincoin desde', desde],
  ] as [string, string | undefined][]).filter(([, v]) => String(v ?? '').trim());
  return (
    <>
      <Rotulo>DATOS DE LA EMPRESA</Rotulo>
      {filas.length === 0
        ? <p style={{ fontSize: 13, color: C.tenue, margin: 0 }}>La empresa no ha completado sus datos en Lincoin.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px 18px' }}>
            {filas.map(([k, v]) => (
              <div key={k} style={{ minWidth: 0 }}>
                <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>{k}</p>
                <p style={{ fontSize: 13.5, fontWeight: 600, margin: '2px 0 0', overflowWrap: 'anywhere' }}>{v}</p>
              </div>
            ))}
          </div>
        )}
    </>
  );
};

type Props = {
  empresa: FichaEmpresa & { id: string };
  /** 'contador': anexa y retira documentos. 'empresa': autoriza a su contador y descarga. */
  modo: 'contador' | 'empresa';
  onCerrar: () => void;
  /** Solo empresa: las solicitudes de contador que quedan en espera. */
  onCambioContador?: (solicitudes: Vinculo[]) => void;
};

export const FichaEmpresaModal: React.FC<Props> = ({ empresa, modo, onCerrar, onCambioContador }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con una confirmación abierta (retirar, quitar acceso), Escape es de ella.
      if (e.key === 'Escape' && !document.getElementById('confirmar-titulo')) onCerrar();
    };
    window.addEventListener('keydown', onKey);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = antes; };
  }, [onCerrar]);

  const seccion: React.CSSProperties = { padding: '18px 22px', borderTop: `1px solid ${C.borde}`, position: 'relative' };
  return createPortal(
    <div onClick={onCerrar} role="dialog" aria-modal="true" aria-labelledby="ficha-empresa-titulo"
      style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.66)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto', fontFamily: FONT, color: C.text }}>
      <div onClick={e => e.stopPropagation()} className="animate-in zoom-in-95 fade-in duration-200"
        style={{ width: '100%', maxWidth: 640, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 18, boxShadow: '0 30px 90px rgba(0,0,0,0.6)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -80, right: -60, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(74,222,128,0.14), transparent 65%)', pointerEvents: 'none' }} />
        <div className="flex items-center" style={{ gap: 14, padding: '22px 22px 18px', position: 'relative' }}>
          <Bolita nombre={empresa.nombre} activo tam={46} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="ficha-empresa-titulo" style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{empresa.nombre}</h2>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{[empresa.nit ? `${empresa.tipoDocumento || 'NIT'} ${empresa.nit}` : '', empresa.idLincoin ? `ID Lincoin ${empresa.idLincoin}` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.sub, borderRadius: 9, padding: 7, cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}><X size={16} /></button>
        </div>

        {modo === 'empresa' ? (
          <>
            <div style={seccion}>
              <p style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', margin: 0 }}>Tu contador</p>
              <ExplicacionContador />
              <AccesoContadorPanel onCambio={onCambioContador} />
            </div>
            <div style={seccion}><DocumentosContables modo="empresa" /></div>
            <div style={{ ...seccion, paddingBottom: 22 }}><DatosEmpresa empresa={empresa} /></div>
          </>
        ) : (
          <>
            <div style={seccion}><DatosEmpresa empresa={empresa} /></div>
            <div style={{ ...seccion, paddingBottom: 22 }}><DocumentosContables modo="contador" empresaId={empresa.id} /></div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
