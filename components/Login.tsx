import React, { useState, useEffect, useRef } from 'react';

declare global { interface Window { grecaptcha: any } }
import { Eye, EyeOff, ArrowLeft, AlertTriangle, X, CheckCircle, ShieldCheck } from 'lucide-react';
import { Logo } from './Logo';
import { useSystemConfig } from '../context/SystemConfigContext';
import { useDatabase } from '../context/DatabaseContext';

interface LoginProps {
  onRegisterClick: () => void;
  onLoginSuccess: (role?: 'business' | 'personal' | 'admin') => void;
  onBack: () => void;
  userRole?: 'business' | 'personal';
}

export const Login: React.FC<LoginProps> = ({ onRegisterClick, onLoginSuccess, onBack, userRole = 'business' }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Forgot Password State
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const { config } = useSystemConfig();
  const { loginUser, loginWithGoogle, logoutUser, mfaPending, completeMFALogin, cancelMFALogin, sendPasswordReset } = useDatabase();

  // Sin llave por defecto: reCAPTCHA queda opcional (el flujo resuelve token ''
  // y continúa). Se activa cargando una site key válida vía admin → recaptchaSiteKey.
  const RECAPTCHA_SITE_KEY: string = config.recaptchaSiteKey || '';
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const recaptchaWidgetId = useRef<number | null>(null);

  // 2FA State
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);

  // reCAPTCHA v3: get a token invisibly — always resolves within 3 s
  const getRecaptchaToken = (): Promise<string> =>
    Promise.race([
      new Promise<string>((resolve) => {
        if (!RECAPTCHA_SITE_KEY || !window.grecaptcha?.ready) { resolve(''); return; }
        window.grecaptcha.ready(() => {
          window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'login' })
            .then(resolve)
            .catch(() => resolve(''));
        });
      }),
      new Promise<string>(resolve => setTimeout(() => resolve(''), 3000)),
    ]);

  const handleLogin = async () => {
    setErrorMsg(null);
    setIsLoading(true);
    // Absolute safety net — button always unsticks after 20 s even if something hangs
    const safetyTimer = setTimeout(() => setIsLoading(false), 20000);
    try {
      await getRecaptchaToken();
      const result = await loginUser(email, password);

      // 2FA pendiente: la contraseña FUE correcta; se muestra la pantalla del
      // código (vía el estado mfaPending). No mostrar "credenciales inválidas".
      if (result === 'MFA_REQUIRED') return;

      const user = result;
      if (!user) {
        setErrorMsg("Credenciales inválidas. Por favor intenta nuevamente.");
        return;
      }

      if (user && userRole !== 'admin' && user.role !== 'admin' && user.role !== userRole) {
        logoutUser();
        setErrorMsg(
          user.role === 'personal'
            ? 'Tu cuenta es de tipo Personal. Por favor inicia sesión en la sección de Personas.'
            : 'Tu cuenta es de tipo Empresas. Por favor inicia sesión en la sección de Empresas.'
        );
        return;
      }

      if (config.maintenanceMode && user!.role !== 'admin') {
        logoutUser();
        setErrorMsg("El sistema se encuentra en mantenimiento. Solo administradores pueden ingresar.");
        return;
      }

      onLoginSuccess(user!.role as 'business' | 'personal' | 'admin');
    } catch {
      setErrorMsg("Error de conexión. Por favor intenta de nuevo.");
    } finally {
      clearTimeout(safetyTimer);
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async () => {
    if (mfaCode.length !== 6) return;
    setMfaLoading(true);
    setMfaError('');
    const user = await completeMFALogin(mfaCode);
    setMfaLoading(false);
    if (!user) {
      setMfaError('Código incorrecto o expirado. Intenta nuevamente.');
      setMfaCode('');
      return;
    }
    onLoginSuccess(user.role as 'business' | 'personal' | 'admin');
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) return;
    await sendPasswordReset(forgotEmail.trim());
    setForgotSent(true);
  };

  const closeForgotModal = () => {
    setIsForgotModalOpen(false);
    setForgotSent(false);
    setForgotEmail('');
  };

  // --- 2FA VERIFICATION SCREEN ---
  if (mfaPending) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F6F9] px-4">
        <div className="mb-8 scale-125">
          <Logo collapsed />
        </div>
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-200">
              <ShieldCheck className="text-[#0C0E0D]" size={28} />
            </div>
            <h2 className="text-2xl font-bold text-[#0C0E0D]">Verificación en 2 pasos</h2>
            <p className="text-slate-900 text-sm mt-2 leading-relaxed">
              Abre tu app autenticadora (Google Authenticator, Authy, etc.) e ingresa el código de 6 dígitos.
            </p>
          </div>

          {mfaError && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-4 text-center font-medium">
              {mfaError}
            </div>
          )}

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
            className="w-full h-16 text-center text-3xl font-bold tracking-[0.5em] border-2 border-slate-200 rounded-xl focus:border-[#0C0E0D] outline-none mb-6 bg-slate-50"
            placeholder="000000"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleVerify2FA()}
          />

          <button
            onClick={handleVerify2FA}
            disabled={mfaCode.length !== 6 || mfaLoading}
            className="w-full h-12 bg-[#0C0E0D] hover:bg-[#152e52] font-bold rounded-lg disabled:opacity-50 transition-colors mb-4 shadow-lg shadow-green-900/20"
          >
            {mfaLoading ? 'Verificando...' : 'Verificar'}
          </button>

          <button
            onClick={() => { cancelMFALogin(); setMfaCode(''); setMfaError(''); }}
            className="w-full text-center text-slate-800 text-sm hover:text-slate-800 transition-colors"
          >
            Cancelar e iniciar sesión nuevamente
          </button>
        </div>
      </div>
    );
  }

  // --- NORMAL LOGIN SCREEN ---
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F6F9] px-4 relative">

      <button
        onClick={onBack}
        className="absolute top-6 left-6 flex items-center gap-2 text-slate-800 hover:text-[#0C0E0D] transition-colors font-medium text-sm"
      >
        <ArrowLeft size={18} />
        Volver al inicio
      </button>

      <div className="mb-8 scale-125 cursor-pointer hover:scale-[1.4] transition-transform duration-300 anim-fade-in" onClick={onBack} title="Volver a la página principal">
        <Logo collapsed />
      </div>

      <h1 className="text-2xl font-bold text-[#0C0E0D] text-center mb-10 anim-fade-up">
        ¡Te damos la bienvenida a LINCOIN{userRole === 'business' ? <><br />empresas!</> : '!'}
      </h1>

      {config.maintenanceMode && (
        <div className="bg-yellow-50 border border-yellow-100 text-yellow-700 p-4 rounded-xl flex items-center gap-3 max-w-md w-full mb-6">
          <AlertTriangle className="shrink-0" />
          <div className="text-sm">
            <p className="font-bold">Sistema en Mantenimiento</p>
            <p>El acceso está restringido temporalmente.</p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-6 w-full max-w-md font-medium text-center">
          {errorMsg}
        </div>
      )}

      <div className="w-full max-w-md space-y-6">
        <div className="relative group">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#0C0E0D] focus:ring-1 focus:ring-[#0C0E0D] bg-[#EBF2FA]/50 pt-3"
            placeholder=" "
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#0C0E0D]">
            E-mail
          </label>
        </div>

        <div className="relative group">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#0C0E0D] focus:ring-1 focus:ring-[#0C0E0D] bg-[#EBF2FA]/50 pt-3 pr-10"
            placeholder=" "
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#0C0E0D]">
            Contraseña
          </label>
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-3 text-slate-800 hover:text-slate-800 focus:outline-none"
          >
            {showPassword ? <Eye size={20} /> : <EyeOff size={20} />}
          </button>
        </div>

        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="btn-shine w-full h-12 bg-[#0C0E0D] hover:bg-[#152e52] font-bold rounded-lg transition-all duration-200 shadow-lg shadow-green-900/20 disabled:opacity-70 hover:shadow-xl hover:shadow-green-500/30 hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0"
        >
          {isLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-800 font-medium">o continúa con</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <button
          onClick={() => loginWithGoogle(userRole !== 'admin' ? userRole : 'business')}
          type="button"
          className="w-full h-12 flex items-center justify-center gap-3 border border-slate-500 rounded-lg bg-white hover:bg-slate-50 transition-all duration-200 text-slate-900 font-semibold text-sm shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continuar con Google
        </button>

        <div className="flex justify-between items-center text-sm pt-2">
          <div className="text-slate-900">
            ¿Eres nuevo? <button onClick={onRegisterClick} className="text-[#0C0E0D] font-bold hover:underline">Regístrate</button>
          </div>
          <button onClick={() => setIsForgotModalOpen(true)} className="text-slate-800 hover:text-[#0C0E0D] transition-colors">
            Recuperar contraseña
          </button>
        </div>
      </div>

      {RECAPTCHA_SITE_KEY && (
        <div className="fixed bottom-6 text-[10px] text-slate-800 text-center max-w-lg">
          This site is protected by reCAPTCHA and the Google <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#0C0E0D]">Privacy Policy</a> and <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-[#0C0E0D]">Terms of Service</a> apply.
        </div>
      )}

      {/* FORGOT PASSWORD MODAL */}
      {isForgotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 p-8 relative">
            <button onClick={closeForgotModal} className="absolute top-4 right-4 text-slate-800 hover:text-slate-800">
              <X size={20} />
            </button>
            {!forgotSent ? (
              <>
                <h3 className="text-xl font-bold text-[#0C0E0D] mb-2 text-center">Recuperar Contraseña</h3>
                <p className="text-slate-900 text-sm text-center mb-6">Ingresa tu correo electrónico y te enviaremos las instrucciones.</p>
                <div className="relative mb-6">
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:border-[#0C0E0D] outline-none"
                    placeholder="tu@email.com"
                  />
                </div>
                <button onClick={handleForgotPassword} className="w-full h-12 bg-[#0C0E0D] font-bold rounded-lg hover:bg-[#152e52] transition-colors">
                  Enviar Instrucciones
                </button>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">¡Correo Enviado!</h3>
                <p className="text-slate-900 text-sm mb-6">Revisa tu bandeja de entrada. Hemos enviado un enlace para restablecer tu contraseña.</p>
                <button onClick={closeForgotModal} className="w-full h-12 border border-slate-500 text-slate-800 font-bold rounded-lg hover:bg-slate-50 transition-colors">
                  Volver al Login
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
