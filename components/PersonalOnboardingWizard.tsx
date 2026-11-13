import React from 'react';
import { Logo } from './Logo';
import { ShieldCheck, Mail } from 'lucide-react';

interface PersonalOnboardingProps {
  onFinish: () => void;
}

// Paso de verificación del alta de cuenta.
//
// Antes esta pantalla abría una sesión con un proveedor externo de KYC: el
// titular sacaba foto del documento, se hacía una selfie y el veredicto volvía
// solo. Ese proveedor ya no está conectado, y la verificación la hace el
// equipo de Lincoin a mano.
//
// Por eso la pantalla dejó de prometer un proceso automático de dos minutos:
// no se puede pedir documento y selfie por un canal que no existe, ni decir
// que la cuenta "se activa en minutos" cuando depende de que una persona la
// revise. Lo que sí es cierto —la cuenta ya existe, se puede cargar dinero, y
// para enviar hace falta la verificación— es lo que dice ahora.
export const PersonalOnboardingWizard: React.FC<PersonalOnboardingProps> = ({ onFinish }) => (
    <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="h-16 px-4 md:px-8 flex items-center justify-between bg-white border-b border-slate-200 sticky top-0 z-20">
            <Logo />
        </header>

        <main className="flex-1 flex flex-col items-center justify-center py-8 px-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <ShieldCheck size={32} className="text-[#0C0E0D]" />
                    </div>
                    <h2 className="text-2xl font-bold text-[#0C0E0D] mb-2">Tu cuenta está creada</h2>
                    <p className="text-slate-500 text-sm">
                        Para poder <b>enviar y convertir</b> falta verificar tu identidad. La revisa nuestro
                        equipo: te vamos a pedir la documentación por correo.
                    </p>
                </div>

                <div className="space-y-3 mb-8">
                    {[
                        { icon: '💸', title: 'Ya podés cargar dinero', desc: 'Recibir y guardar no requiere verificación' },
                        { icon: '📄', title: 'Te pedimos la documentación', desc: 'Por correo, desde soporte@lincoin.me' },
                        { icon: '✅', title: 'Activamos los envíos', desc: 'Cuando el equipo apruebe la verificación' },
                    ].map(({ icon, title, desc }) => (
                        <div key={title} className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl">
                            <span className="text-2xl">{icon}</span>
                            <div>
                                <p className="font-bold text-slate-800 text-sm">{title}</p>
                                <p className="text-xs text-slate-500">{desc}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="space-y-3">
                    <button
                        onClick={onFinish}
                        className="w-full py-4 bg-[#0C0E0D] text-white font-bold rounded-xl hover:bg-[#161A17] transition-colors text-base"
                    >
                        Entrar a mi cuenta
                    </button>
                    <a
                        href="mailto:soporte@lincoin.me?subject=Verificaci%C3%B3n%20de%20identidad"
                        className="w-full py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors text-sm flex items-center justify-center gap-2"
                    >
                        <Mail size={15} /> Adelantar mi verificación
                    </a>
                </div>

                <p className="text-[11px] text-slate-400 text-center mt-4">
                    Tus datos están protegidos y encriptados
                </p>
            </div>
        </main>
    </div>
);
