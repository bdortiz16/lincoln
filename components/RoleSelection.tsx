import React from 'react';
import { X, User, Building2, ChevronRight, Download } from 'lucide-react';
import { Logo } from './Logo';

interface RoleSelectionProps {
  onSelectPersonal: () => void;
  onSelectBusiness: () => void;
  onClose: () => void;
}

const ARCHIVO = "'Archivo', system-ui, sans-serif";

export const RoleSelection: React.FC<RoleSelectionProps> = ({ onSelectPersonal, onSelectBusiness, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-300"
      style={{ fontFamily: ARCHIVO }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }} onClick={onClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300"
        style={{
          background: '#0D0E0D',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 24,
          boxShadow: '0 40px 120px rgba(0,0,0,0.7)',
        }}
      >
        {/* Glow verde puntual arriba */}
        <div style={{ position: 'absolute', top: -80, right: -40, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(74,222,128,0.14), transparent 65%)', pointerEvents: 'none' }} />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Logo variant="white" />
          <button
            onClick={onClose}
            className="p-1.5 rounded-full transition-colors"
            style={{ color: '#8F8F8A' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#F4F4F2'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#8F8F8A'; e.currentTarget.style.background = 'transparent'; }}
            aria-label="Cerrar"
          >
            <X size={22} />
          </button>
        </div>

        {/* Contenido */}
        <div className="rs-content px-6 py-10 md:px-14 md:py-14 flex flex-col items-center overflow-y-auto relative z-10">
          <h2 className="text-center" style={{ fontFamily: ARCHIVO, fontWeight: 800, letterSpacing: '-1px', color: '#F4F4F2', fontSize: 'clamp(24px, 4vw, 40px)', marginBottom: 12 }}>
            ¡Hola! ¿A dónde quieres ingresar?
          </h2>
          <p className="text-center" style={{ color: '#8F8F8A', fontSize: 15, maxWidth: 520, marginBottom: 40 }}>
            Selecciona el perfil correspondiente para acceder a tu Banca por Internet Lincoin.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
            {/* PERSONAS */}
            <button onClick={onSelectPersonal} className="role-card group relative flex flex-col items-center text-center transition-all duration-300" style={cardStyle}>
              <span className="absolute top-4 right-4" style={badgeStyle}>📱 APP MÓVIL</span>
              <div className="rc-circle flex items-center justify-center rounded-full transition-all duration-300 group-hover:scale-105" style={circleStyle}>
                <User className="transition-colors duration-300" style={{ width: 34, height: 34, color: '#F4F4F2' }} strokeWidth={1.8} />
              </div>
              <h3 style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 22, color: '#F4F4F2', marginBottom: 8 }}>Personas</h3>
              <p style={{ color: '#8F8F8A', fontSize: 13.5, lineHeight: 1.5, marginBottom: 20 }}>
                Realiza transferencias, cambios de divisa y pagos personales desde tu celular.
              </p>
              <span className="mt-auto flex items-center gap-2" style={{ color: '#4ADE80', fontWeight: 700, fontSize: 14 }}>
                <Download size={15} /> Descargar app
              </span>
            </button>

            {/* EMPRESAS */}
            <button onClick={onSelectBusiness} className="role-card group relative flex flex-col items-center text-center transition-all duration-300" style={cardStyle}>
              <div className="rc-circle flex items-center justify-center rounded-full transition-all duration-300 group-hover:scale-105" style={circleStyle}>
                <Building2 className="transition-colors duration-300" style={{ width: 34, height: 34, color: '#F4F4F2' }} strokeWidth={1.8} />
              </div>
              <h3 style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 22, color: '#F4F4F2', marginBottom: 8 }}>Empresas</h3>
              <p style={{ color: '#8F8F8A', fontSize: 13.5, lineHeight: 1.5, marginBottom: 20 }}>
                Gestiona pagos a proveedores, planilla y cobranzas masivas.
              </p>
              <span className="mt-auto flex items-center gap-2" style={{ color: '#4ADE80', fontWeight: 700, fontSize: 14 }}>
                Ingresar <ChevronRight size={15} />
              </span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="py-4 px-6 text-center shrink-0 relative z-10" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(244,244,242,0.45)', fontSize: 12.5 }}>
          ¿No eres cliente?{' '}
          <button onClick={onSelectPersonal} style={{ color: '#4ADE80', fontWeight: 700 }} className="hover:underline">Abre tu cuenta aquí</button>
        </div>
      </div>

      {/* Hover de las tarjetas (borde verde + glow) */}
      <style>{`
        .role-card:hover { border-color: rgba(74,222,128,0.55) !important; box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(74,222,128,0.25) inset; }
        .role-card:hover .rc-circle { background: #4ADE80 !important; }
        .role-card:hover .rc-circle svg { color: #0A0A0A !important; }
        @media (max-width: 640px) {
          .rs-content { padding-top: 24px !important; padding-bottom: 24px !important; }
          .rs-content h2 { font-size: 22px !important; margin-bottom: 8px !important; }
          .rs-content > p { font-size: 13.5px !important; margin-bottom: 24px !important; }
          .role-card { padding: 18px 16px !important; }
          .rc-circle { width: 56px !important; height: 56px !important; margin-bottom: 12px !important; }
          .rc-circle svg { width: 26px !important; height: 26px !important; }
          .role-card h3 { font-size: 18px !important; margin-bottom: 4px !important; }
          .role-card p { font-size: 12.5px !important; line-height: 1.45 !important; margin-bottom: 14px !important; }
        }
      `}</style>
    </div>
  );
};

const cardStyle: React.CSSProperties = {
  background: '#121413',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 20,
  padding: '32px 24px',
};

const circleStyle: React.CSSProperties = {
  width: 88,
  height: 88,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  marginBottom: 20,
};

const badgeStyle: React.CSSProperties = {
  background: 'rgba(74,222,128,0.12)',
  color: '#4ADE80',
  border: '1px solid rgba(74,222,128,0.30)',
  fontSize: 10,
  fontWeight: 700,
  padding: '4px 10px',
  borderRadius: 999,
};
