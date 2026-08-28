import React, { useEffect, useState } from 'react';
import { MailOpen, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';

interface EmailConfirmationProps {
  onValidated: () => void;
  onBack: () => void;
  email: string;
}

export const EmailConfirmation: React.FC<EmailConfirmationProps> = ({ onValidated, onBack, email }) => {
  const { currentUser } = useDatabase();
  const [checking, setChecking] = useState(false);

  // When Supabase fires SIGNED_IN after the user clicks the confirmation link,
  // currentUser becomes non-null — proceed automatically.
  useEffect(() => {
    if (currentUser) {
      onValidated();
    }
  }, [currentUser]);

  const handleManualCheck = () => {
    setChecking(true);
    // If currentUser is already set (session confirmed), onValidated fires via useEffect.
    // If not, just show feedback and let the user try again.
    setTimeout(() => setChecking(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F6F9] px-4 py-12">

      <div className="mb-8">
        <div className="relative">
          <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center text-[#0F172A] relative z-10">
            <MailOpen size={48} strokeWidth={1.5} />
          </div>
          <div className="absolute top-0 left-0 w-full h-full bg-slate-50 rounded-full scale-125 opacity-50"></div>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-[#0F172A] text-center mb-4">
        Confirma tu email
      </h1>

      <div className="text-center max-w-md space-y-4 mb-8">
        <p className="text-slate-500">
          Te enviamos un correo para confirmar tu email y completar el registro de cuenta LINCOIN
        </p>
        <p className="font-bold text-[#0F172A] text-lg">{email}</p>
        <p className="text-slate-400 text-sm">
          Haz clic en el enlace del correo — esta página avanzará automáticamente.
        </p>
      </div>

      <div className="text-sm text-slate-500 mb-8">
        ¿No has recibido el correo?{' '}
        <button className="text-[#0F172A] font-bold hover:underline">Reenviar correo</button>
      </div>

      <button
        onClick={handleManualCheck}
        disabled={checking}
        className="w-full max-w-xs h-12 bg-[#0F172A] hover:bg-[#152e52] disabled:opacity-60 font-bold rounded-lg transition-colors shadow-lg shadow-green-900/20 mb-6 flex items-center justify-center gap-2"
      >
        {checking ? (
          <><Loader2 size={18} className="animate-spin" /> Verificando...</>
        ) : (
          <><CheckCircle size={18} /> Ya confirmé mi correo</>
        )}
      </button>

      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[#0F172A] font-bold hover:underline"
      >
        <ArrowLeft size={18} />
        Volver
      </button>

      <div className="mt-12 w-full max-w-xl bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 flex gap-4 items-start">
        <div className="w-6 h-6 bg-slate-200 rounded-full flex items-center justify-center text-slate-500 font-bold text-xs shrink-0 mt-0.5">i</div>
        <p className="text-slate-400 text-sm leading-relaxed text-left">
          Si no te ha llegado el email, revisa tu carpeta de spam. Una vez que confirmes el enlace, esta pantalla avanzará sola y tu sesión quedará guardada.
        </p>
      </div>
    </div>
  );
};
