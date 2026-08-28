import React, { useState } from 'react';
import { Search, ChevronRight, Check } from 'lucide-react';

const stepsData = [
  { id: 1, label: "Datos del representante legal" },
  { id: 2, label: "Datos generales de la empresa" },
  { id: 3, label: "Declaración jurada de beneficiarios finales" },
  { id: 4, label: "Adjuntar documentación" },
  { id: 5, label: "Resumen" },
  { id: 6, label: "Términos y Condiciones" },
];

export const OnboardingStepper: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);

  const handleContinue = () => {
    if (currentStep < stepsData.length) {
      setCurrentStep(prev => prev + 1);
    } else {
      // Finished flow
      alert("¡Registro completado!");
    }
  };

  const getStepStatus = (stepId: number) => {
    if (stepId < currentStep) return 'completed';
    if (stepId === currentStep) return 'current';
    return 'pending';
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col md:flex-row min-h-[400px]">
      
      {/* Left Side - Stepper Navigation (Navy Gradient) */}
      <div className="md:w-5/12 lg:w-4/12 bg-gradient-to-b from-[#0F172A] to-[#0F172A] p-8 text-white relative overflow-hidden transition-all duration-500">
        {/* Decorative circle overlay */}
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-cuypay-accent/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="relative z-10 space-y-0">
          {stepsData.map((step, index) => {
            const status = getStepStatus(step.id);
            return (
              <div key={step.id} className="flex gap-4 group">
                <div className="flex flex-col items-center">
                  {/* Dot */}
                  <div className={`
                    w-4 h-4 rounded-full border-2 z-10 transition-all duration-300 flex items-center justify-center
                    ${status === 'completed' ? 'bg-cuypay-accent border-cuypay-accent' : 
                      status === 'current' ? 'bg-cuypay-accent border-cuypay-accent shadow-[0_0_10px_rgba(212,240,53,0.5)] scale-110' : 
                      'bg-transparent border-white/30'}
                  `}>
                    {status === 'completed' && <Check size={10} className="text-cuypay-dark" strokeWidth={4} />}
                  </div>
                  
                  {/* Connector Line */}
                  {index !== stepsData.length - 1 && (
                    <div className={`w-0.5 flex-1 min-h-[32px] transition-colors duration-500 ${status === 'completed' ? 'bg-cuypay-accent' : 'bg-white/10'}`}></div>
                  )}
                </div>
                
                {/* Text */}
                <div className={`pb-6 text-sm font-medium transition-colors duration-300 ${status === 'current' ? 'text-white' : status === 'completed' ? 'text-cuypay-accent/80' : 'text-teal-200/40'}`}>
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Side - Action Area (White) */}
      <div className="md:w-7/12 lg:w-8/12 p-8 md:p-12 flex flex-col justify-center items-start bg-white animate-in fade-in slide-in-from-right-4 duration-500" key={currentStep}>
        <div className="mb-6">
          <div className="w-14 h-14 bg-slate-50/50 rounded-xl flex items-center justify-center text-[#0F172A] mb-6 border border-slate-200">
            <Search size={28} strokeWidth={1.5} />
          </div>
          
          <h2 className="text-2xl font-bold text-slate-900 mb-3">
            {stepsData.find(s => s.id === currentStep)?.label}
          </h2>
          
          <p className="text-slate-500 max-w-md leading-relaxed">
            Completa la información requerida para el paso {currentStep} de {stepsData.length}.
            Asegúrate de tener a mano la documentación necesaria para agilizar el proceso de verificación de tu empresa.
          </p>
        </div>

        <button 
          onClick={handleContinue}
          className="bg-[#0F172A] hover:bg-[#152e52] px-8 py-3 rounded-lg font-bold shadow-lg shadow-teal-900/10 transition-all transform active:scale-95 flex items-center gap-2 border-b-2 border-cuypay-accent"
        >
          {currentStep === stepsData.length ? 'Finalizar' : 'Continuar registro'}
          {currentStep !== stepsData.length && <ChevronRight size={18} />}
        </button>
      </div>

    </div>
  );
};