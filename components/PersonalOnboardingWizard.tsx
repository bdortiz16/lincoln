import React, { useState } from 'react';
import { Logo } from './Logo';
import { ShieldCheck, CheckCircle, RefreshCw } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';

interface PersonalOnboardingProps {
  onFinish: () => void;
}

export const PersonalOnboardingWizard: React.FC<PersonalOnboardingProps> = ({ onFinish }) => {
    const [loading, setLoading] = useState(false);
    const [started, setStarted] = useState(false);
    const [error, setError] = useState('');
    const { currentUser } = useDatabase();

    const startDidit = async () => {
        if (!currentUser?.id || loading) return;
        setLoading(true);
        setError('');
        try {
            const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
            const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
            const r = await fetch(`${SURL}/functions/v1/didit-kyc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
                body: JSON.stringify({ action: 'create_session', userId: currentUser.id }),
            });
            const data = await r.json();
            if (data.url) {
                window.location.href = data.url;
                setStarted(true);
            } else {
                setError(data.error || 'Error al iniciar la verificación. Contacta soporte.');
            }
        } catch {
            setError('Error de conexión. Intenta de nuevo.');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="h-16 px-4 md:px-8 flex items-center justify-between bg-white border-b border-slate-200 sticky top-0 z-20">
                <Logo />
            </header>

            <main className="flex-1 flex flex-col items-center justify-center py-8 px-4">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8">

                    {!started ? (
                        <>
                            {/* Intro */}
                            <div className="text-center mb-8">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <ShieldCheck size={32} className="text-[#0F172A]" />
                                </div>
                                <h2 className="text-2xl font-bold text-[#0F172A] mb-2">Verificación de Identidad</h2>
                                <p className="text-slate-500 text-sm">Para activar tu cuenta necesitamos verificar tu identidad. El proceso toma menos de 2 minutos.</p>
                            </div>

                            {/* Steps preview */}
                            <div className="space-y-3 mb-8">
                                {[
                                    { icon: '📄', title: 'Foto de tu documento', desc: 'Pasaporte, cédula o licencia vigente' },
                                    { icon: '🤳', title: 'Selfie en vivo', desc: 'Una foto tuya para confirmar tu identidad' },
                                    { icon: '✅', title: 'Resultado automático', desc: 'Tu cuenta se activa en minutos' },
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

                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-600 text-center">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={startDidit}
                                disabled={loading}
                                className="w-full py-4 bg-[#0F172A] font-bold rounded-xl hover:bg-[#152e52] disabled:opacity-50 transition-colors flex items-center justify-center gap-3 text-base"
                            >
                                {loading
                                    ? <><RefreshCw size={20} className="animate-spin"/> Iniciando verificación...</>
                                    : <><ShieldCheck size={20}/> Comenzar verificación con Lincoin</>
                                }
                            </button>

                            <p className="text-[11px] text-slate-400 text-center mt-4">
                                Verificación Lincoin · Tus datos están protegidos y encriptados
                            </p>
                        </>
                    ) : (
                        <>
                            {/* After clicking — verification in progress */}
                            <div className="text-center mb-8">
                                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CheckCircle size={32} className="text-green-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-[#0F172A] mb-2">¡Verificación iniciada!</h2>
                                <p className="text-slate-500 text-sm">Se abrió Lincoin en una nueva pestaña. Completa el proceso allí — foto de documento y selfie.</p>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 space-y-2">
                                <p className="text-sm font-bold text-[#2DD4BF]">¿Qué pasa después?</p>
                                <p className="text-xs text-[#2DD4BF]">Cuando Lincoin termine de verificarte, tu cuenta se activará automáticamente y recibirás una notificación. No necesitas volver a esta pantalla.</p>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={onFinish}
                                    className="w-full py-3 bg-[#0F172A] font-bold rounded-xl hover:bg-[#152e52] transition-colors"
                                >
                                    Entrar a mi cuenta
                                </button>
                                <button
                                    onClick={startDidit}
                                    disabled={loading}
                                    className="w-full py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors text-sm disabled:opacity-50"
                                >
                                    Volver a abrir verificación
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
};
