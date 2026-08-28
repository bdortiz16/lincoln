import React from 'react';
import { X, User, Building2, ChevronRight, Download } from 'lucide-react';
import { Logo } from './Logo';

interface RoleSelectionProps {
  onSelectPersonal: () => void;
  onSelectBusiness: () => void;
  onClose: () => void;
}

export const RoleSelection: React.FC<RoleSelectionProps> = ({ onSelectPersonal, onSelectBusiness, onClose }) => {

  return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-300">

        {/* Backdrop Blur Overlay */}
        <div
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={onClose}
        ></div>

        {/* Main Modal Card */}
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

          {/* Header Bar - Fixed at top */}
          <div className="flex items-center justify-between px-5 py-4 md:px-8 md:py-6 border-b border-slate-100 shrink-0">
              <div className="scale-75 origin-left">
                  <Logo />
              </div>
              <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-slate-800 transition-colors p-1 hover:bg-slate-50 rounded-full"
              >
                  <X size={24} />
              </button>
          </div>

          {/* Scrollable Content */}
          <div className="p-5 md:p-16 flex flex-col items-center overflow-y-auto">

              <h2 className="text-xl md:text-4xl font-bold text-[#0F172A] text-center mb-2 md:mb-4">
                  ¡Hola! ¿A dónde quieres ingresar?
              </h2>
              <p className="text-slate-500 text-center text-xs md:text-lg mb-6 md:mb-12 max-w-2xl">
                  Selecciona el perfil correspondiente para acceder a tu Banca por Internet CUYPAY.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-8 w-full max-w-3xl">

                  {/* PERSONAS OPTION - Calls handler that opens download modal in App.tsx */}
                  <button
                      onClick={onSelectPersonal}
                      className="role-card group relative bg-white border-2 border-slate-100 rounded-2xl md:rounded-3xl p-4 md:p-8 hover:border-[#2DD4BF] hover:shadow-2xl transition-all duration-300 flex flex-col items-center text-center text-left"
                  >
                      {/* "App móvil" badge */}
                      <div className="absolute top-3 right-3 md:top-4 md:right-4 bg-[#2DD4BF]/10 text-[#0F172A] text-[9px] md:text-[10px] font-bold px-2 py-1 rounded-full border border-[#2DD4BF]/30">
                          📱 APP MÓVIL
                      </div>

                      <div className="role-circle-teal w-12 h-12 md:w-24 md:h-24 rounded-full bg-slate-50 flex items-center justify-center mb-3 md:mb-6 group-hover:bg-[#2DD4BF] transition-all duration-300 shadow-sm group-hover:scale-110 shrink-0">
                          <User className="w-6 h-6 md:w-10 md:h-10 text-slate-900 group-hover:text-[#0F172A] transition-colors duration-300" strokeWidth={2} />
                      </div>

                      <h3 className="text-lg md:text-2xl font-bold text-slate-800 mb-1 md:mb-2 group-hover:text-[#0F172A]">Personas</h3>
                      <p className="text-slate-500 text-[10px] md:text-sm leading-relaxed mb-3 md:mb-6">
                          Realiza transferencias, cambios de divisa y pagos personales desde tu celular.
                      </p>

                      <div className="mt-auto flex items-center gap-2 text-[#0F172A] font-bold text-xs md:text-sm">
                          <Download size={14} className="md:w-4 md:h-4" />
                          Descargar app
                      </div>
                  </button>

                  {/* EMPRESAS OPTION */}
                  <button
                      onClick={onSelectBusiness}
                      className="role-card group relative bg-white border-2 border-slate-100 rounded-2xl md:rounded-3xl p-4 md:p-8 hover:border-[#0F172A] hover:shadow-2xl transition-all duration-300 flex flex-col items-center text-center text-left"
                  >
                      <div className="role-circle-dark w-12 h-12 md:w-24 md:h-24 rounded-full bg-slate-50 flex items-center justify-center mb-3 md:mb-6 group-hover:bg-[#0F172A] transition-all duration-300 shadow-sm group-hover:scale-110 shrink-0">
                          <Building2 className="w-6 h-6 md:w-10 md:h-10 text-slate-900 group-hover:text-white transition-colors duration-300" strokeWidth={2} />
                      </div>

                      <h3 className="text-lg md:text-2xl font-bold text-slate-800 mb-1 md:mb-2 group-hover:text-[#0F172A]">Empresas</h3>
                      <p className="text-slate-500 text-[10px] md:text-sm leading-relaxed mb-3 md:mb-6">
                          Gestiona pagos a proveedores, planilla y cobranzas masivas.
                      </p>

                      <div className="mt-auto flex items-center gap-2 text-[#0F172A] font-bold text-xs md:text-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity transform md:translate-y-2 md:group-hover:translate-y-0">
                          Ingresar <ChevronRight size={14} className="md:w-4 md:h-4" />
                      </div>

                      {/* Checkmark badge on hover (Desktop only) */}
                      <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-[#0F172A] items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex">
                          <ChevronRight size={14} className="text-white" strokeWidth={2.5} />
                      </div>
                  </button>

              </div>

          </div>

          {/* Footer info inside modal - Fixed at bottom */}
          <div className="bg-slate-50 py-3 md:py-4 px-4 md:px-8 text-center text-[10px] md:text-xs text-slate-400 border-t border-slate-100 shrink-0">
              ¿No eres cliente? <button onClick={onSelectPersonal} className="text-[#0F172A] font-bold hover:underline">Abre tu cuenta aquí</button>
          </div>
        </div>
      </div>
  );
};
