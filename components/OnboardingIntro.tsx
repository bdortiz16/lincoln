import React from 'react';
import { FileText, CreditCard, UserCheck, Info } from 'lucide-react';
import { Logo } from './Logo';

interface OnboardingIntroProps {
  onContinue: () => void;
}

export const OnboardingIntro: React.FC<OnboardingIntroProps> = ({ onContinue }) => {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="h-20 px-8 flex items-center border-b border-slate-100">
        <Logo />
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-12 flex flex-col items-center">
        
        <h1 className="text-2xl md:text-3xl font-bold text-[#0F172A] text-center mb-4">
          Estás a punto de crear tu cuenta empresa
        </h1>
        
        <p className="text-slate-500 text-center mb-10 text-lg">
          Para completar el registro, considera las siguientes recomendaciones:
        </p>

        <div className="space-y-4 w-full max-w-3xl">
          
          {/* Card 1 */}
          <div className="bg-[#F8FAFC] p-6 rounded-xl flex gap-5 items-start">
            <div className="bg-[#0F172A] w-12 h-12 rounded-lg flex items-center justify-center shrink-0">
               <FileText className="text-white" size={24} />
            </div>
            <div>
               <p className="text-slate-800 font-medium leading-relaxed">
                 Debes tener el Certificado de Existencia y Representación Legal de la empresa ( <span className="font-bold">con vigencia NO mayor a 30 días</span> ).
               </p>
               <p className="text-slate-500 text-sm mt-1 italic">
                 Recuerda que debe ser el que tiene <span className="font-semibold">información sobre la junta directiva.</span>
               </p>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-[#F8FAFC] p-6 rounded-xl flex gap-5 items-center">
            <div className="bg-[#0F172A] w-12 h-12 rounded-lg flex items-center justify-center shrink-0">
               <FileText className="text-white" size={24} />
            </div>
            <p className="text-slate-800 font-medium">
               Tener el Registro Único Tributario (RUT)
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-[#F8FAFC] p-6 rounded-xl flex gap-5 items-start">
            <div className="bg-[#EBF2FA] w-12 h-12 rounded-lg flex items-center justify-center shrink-0">
               <CreditCard className="text-[#0F172A]" size={24} />
            </div>
            <p className="text-slate-800 font-medium leading-relaxed">
               Si eres el representante legal, asegúrate de tener a mano tu documento, y completa el proceso de validación de identidad.
            </p>
          </div>

          {/* Info Box */}
          <div className="border border-slate-200 bg-slate-50/50 p-6 rounded-xl flex gap-4 items-start">
            <Info className="text-[#0F172A] shrink-0 mt-1" size={20} />
            <p className="text-slate-600 text-sm leading-relaxed">
               Si NO eres el representante legal, por favor completa el proceso y te contactaremos para validar la identidad del representante legal.
            </p>
          </div>

        </div>

        <div className="mt-12 flex flex-col items-center gap-4 w-full">
            <button 
                onClick={onContinue}
                className="w-full max-w-md h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg transition-colors shadow-lg shadow-teal-900/20"
            >
                Siguiente
            </button>
            
            <div className="flex items-center gap-2 text-xs text-slate-400">
                <div className="w-3 h-3 bg-slate-200 rounded-sm"></div>
                Sistema seguro
            </div>
        </div>

      </main>
    </div>
  );
};