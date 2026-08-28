import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, HelpCircle, ChevronDown, ArrowLeft, Users } from 'lucide-react';
import { Logo } from './Logo';
import { useDatabase } from '../context/DatabaseContext';
import { FlagImg } from './FlagImg';

const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

interface RegisterProps {
  onSuccess: (email: string) => void;
  onLoginClick: () => void;
  onBack: () => void;
  userRole?: 'business' | 'personal';
}

const countries = [
  { name: 'Perú', code: '+51', countryCode: 'PE' },
  { name: 'Chile', code: '+56', countryCode: 'CL' },
  { name: 'Colombia', code: '+57', countryCode: 'CO' },
  { name: 'México', code: '+52', countryCode: 'MX' },
  { name: 'Brasil', code: '+55', countryCode: 'BR' },
];

// Data for the rotating widget simulation
const simulationData = [
  {
    id: 1,
    available: '$ 200.000 CLP',
    send: { amount: '50.000', currency: 'CLP' },
    receive: { amount: '205.507', currency: 'COP' }
  },
  {
    id: 2,
    available: 'S/ 3.500 PEN',
    send: { amount: '1.000', currency: 'PEN' },
    receive: { amount: '1.540', currency: 'BRL' }
  },
  {
    id: 3,
    available: '$ 15.000 MXN',
    send: { amount: '2.500', currency: 'MXN' },
    receive: { amount: '135.200', currency: 'CLP' }
  },
];

export const Register: React.FC<RegisterProps> = ({ onSuccess, onLoginClick, onBack, userRole = 'business' }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [companyCountry, setCompanyCountry] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);

  const { registerUser, loginWithGoogle } = useDatabase();

  // Countdown when Supabase rate-limits the registration
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Simulation State
  const [currentSimIndex, setCurrentSimIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Rotation Effect
  useEffect(() => {
    const interval = setInterval(() => {
      setIsAnimating(true); 
      setTimeout(() => {
        setCurrentSimIndex((prev) => (prev + 1) % simulationData.length);
        setIsAnimating(false); 
      }, 300); 
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const currentSim = simulationData[currentSimIndex];

  const getPasswordStrength = (pass: string) => {
    let score = 0;
    if (!pass) return 0;
    if (pass.length > 5) score += 1;
    if (pass.length > 8) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return score; 
  };

  const strength = getPasswordStrength(password);

  const getStrengthColor = (score: number) => {
    switch (score) {
      case 0: return 'bg-slate-100';
      case 1: return 'bg-red-500';
      case 2: return 'bg-orange-400';
      case 3: return 'bg-yellow-400';
      case 4: return 'bg-cuypay-accent'; 
      default: return 'bg-slate-100';
    }
  };

  const getStrengthText = (score: number) => {
    switch (score) {
      case 0: return '';
      case 1: return 'Débil';
      case 2: return 'Regular';
      case 3: return 'Buena';
      case 4: return 'CONTRASEÑA SEGURA';
      default: return '';
    }
  };

  const validateEmail = (email: string) => {
    return String(email)
      .toLowerCase()
      .match(
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
      );
  };

  const handleSubmit = async () => {
      if (cooldown > 0 || loading) return;
      setErrorMsg(null);
      setLoading(true);
      if (!email || !password) {
          setErrorMsg("Por favor completa todos los campos requeridos.");
          setLoading(false); return;
      }
      if (!validateEmail(email)) {
          setErrorMsg("El formato del correo electrónico no es válido.");
          setLoading(false); return;
      }
      if (userRole === 'personal' && email !== confirmEmail) {
          setErrorMsg("Los correos electrónicos no coinciden.");
          setLoading(false); return;
      }
      if (!privacyAccepted) {
          setErrorMsg("Debes aceptar las políticas de privacidad y términos para continuar.");
          setLoading(false); return;
      }
      if (password.length < 6) {
          setErrorMsg("La contraseña debe tener al menos 6 caracteres.");
          setLoading(false); return;
      }

      try {
        const timeout = new Promise<{ error: string }>(resolve =>
          setTimeout(() => resolve({ error: 'El registro tardó demasiado. Intenta de nuevo.' }), 20000)
        );
        const result = await Promise.race([
          registerUser({
            email,
            password,
            role: userRole || 'personal',
            name: userRole === 'business' ? (companyName || 'Empresa Nueva') : 'Usuario Nuevo',
            companyName: userRole === 'business' ? companyName : undefined,
            country: userRole === 'business' ? companyCountry : undefined,
            referralCode,
          }),
          timeout,
        ]);

        if (result?.error) {
            setErrorMsg(result.error);
            const secs = result.error.match(/espera (\d+) segundos/i)?.[1];
            if (secs) setCooldown(parseInt(secs, 10));
            setLoading(false);
            return;
        }
        setLoading(false);
        onSuccess(email);
      } catch (e: any) {
        setErrorMsg(e?.message || 'Error inesperado. Intenta de nuevo.');
        setLoading(false);
      }
  };

  return (
    <div className="min-h-screen flex bg-white">
      
      {/* LEFT SIDE: Form */}
      <div className="w-full lg:w-1/2 p-8 md:p-12 lg:p-16 flex flex-col overflow-y-auto relative">
        
        <button 
            onClick={onBack}
            className="absolute top-6 left-6 md:top-8 md:left-8 flex items-center gap-2 text-slate-800 hover:text-[#0F172A] transition-colors font-medium text-sm z-10"
        >
            <ArrowLeft size={18} />
            Volver al inicio
        </button>

        <div className="mb-8 flex justify-center lg:justify-start mt-8">
            <div className="scale-110">
                <Logo collapsed />
            </div>
        </div>

        {errorMsg && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-4 w-full max-w-lg mx-auto lg:mx-0 font-medium text-center">
                {errorMsg}
            </div>
        )}

        {userRole === 'personal' ? (
            /* PERSONAL FORM */
            <div className="space-y-6 max-w-lg mx-auto lg:mx-0 w-full animate-in fade-in duration-500">
                <h1 className="text-2xl font-bold text-[#0F172A] text-center lg:text-left mb-4">
                  Regístrate a LINCOIN Personas
                </h1>

                {/* Google OAuth */}
                <button
                    onClick={() => loginWithGoogle('personal')}
                    type="button"
                    className="w-full h-12 flex items-center justify-center gap-3 border border-slate-500 rounded-lg bg-white hover:bg-slate-50 transition-colors text-slate-900 font-semibold text-sm shadow-sm"
                >
                    <GoogleIcon />
                    Registrarse con Google
                </button>

                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-xs text-slate-800 font-medium">o con email</span>
                    <div className="flex-1 h-px bg-slate-200" />
                </div>

                <div className="relative">
                    <input 
                        type="email" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#5d87ff] focus:ring-1 focus:ring-[#5d87ff] bg-white pt-3"
                        placeholder=" "
                    />
                    <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#5d87ff]">
                        Correo electrónico
                    </label>
                </div>

                <div className="relative">
                    <input 
                        type="email" 
                        value={confirmEmail}
                        onChange={(e) => setConfirmEmail(e.target.value)}
                        className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#5d87ff] focus:ring-1 focus:ring-[#5d87ff] bg-white pt-3"
                        placeholder=" "
                    />
                    <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#5d87ff]">
                        Confirmar correo electrónico
                    </label>
                </div>

                <div>
                    <div className="relative">
                        <input 
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#5d87ff] focus:ring-1 focus:ring-[#5d87ff] bg-white pt-3 pr-10"
                            placeholder=" "
                        />
                        <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#5d87ff]">
                            Contraseña
                        </label>
                        <button 
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-3.5 text-slate-800 hover:text-slate-800 focus:outline-none"
                        >
                            {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                        </button>
                    </div>
                    <p className="text-xs text-slate-900 mt-2 leading-relaxed">
                        Tu contraseña debe tener 8 caracteres que contengan números, letras y una letra mayúscula.
                    </p>
                </div>

                {/* Referral Code Field */}
                <div className="relative">
                    <input 
                        type="text" 
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value)}
                        className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#5d87ff] focus:ring-1 focus:ring-[#5d87ff] bg-white pt-3 pl-10"
                        placeholder=" "
                    />
                    <Users className="absolute left-3 top-3.5 text-slate-800" size={18} />
                    <label className="absolute left-10 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#5d87ff]">
                        Código de referido (Opcional)
                    </label>
                </div>

                <div className="flex items-start gap-3 mt-4">
                    <input 
                        type="checkbox" 
                        id="privacy"
                        checked={privacyAccepted}
                        onChange={(e) => setPrivacyAccepted(e.target.checked)}
                        className="mt-1 w-4 h-4 rounded border-slate-500 text-[#5d87ff] focus:ring-[#5d87ff] cursor-pointer" 
                    />
                    <label htmlFor="privacy" className="text-sm text-slate-900 cursor-pointer">
                        Al registrarme acepto las <a href="#" className="text-[#5d87ff] underline hover:text-[#0F172A]">políticas de privacidad</a>.
                    </label>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={cooldown > 0 || loading}
                    className="w-full h-12 bg-[#2DD4BF] hover:bg-[#2DD4BF] text-white font-bold rounded-lg transition-colors shadow-lg shadow-slate-200 mt-6 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {loading ? 'Registrando...' : cooldown > 0 ? `Espera ${cooldown}s...` : 'Registrarme'}
                </button>

                <div className="text-center text-sm text-slate-900 mt-8">
                    ¿Ya tienes una cuenta persona? <button onClick={onLoginClick} className="text-[#5d87ff] font-bold underline hover:text-[#0F172A]">Iniciar sesión</button>
                </div>
            </div>
        ) : (
            /* BUSINESS FORM */
            <div className="space-y-5 max-w-lg mx-auto lg:mx-0 w-full animate-in fade-in duration-500">
                <h1 className="text-2xl font-bold text-[#0F172A] text-center lg:text-left mb-4">
                  Registra tu cuenta LINCOIN Empresas
                </h1>

                {/* Google OAuth */}
                <button
                    onClick={() => loginWithGoogle('business')}
                    type="button"
                    className="w-full h-12 flex items-center justify-center gap-3 border border-slate-500 rounded-lg bg-white hover:bg-slate-50 transition-colors text-slate-900 font-semibold text-sm shadow-sm"
                >
                    <GoogleIcon />
                    Registrarse con Google
                </button>

                <div className="text-xs font-bold text-[#0F172A] uppercase tracking-wide flex items-center gap-2">
                   O CON TU EMAIL EMPRESA
                   <div className="h-px bg-slate-200 flex-1 ml-2"></div>
                </div>

                <div className="relative">
                    <input 
                        type="email" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] bg-[#F8FAFC] pt-3"
                        placeholder=" "
                    />
                    <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#0F172A]">
                        Correo de la empresa
                    </label>
                    <HelpCircle className="absolute right-3 top-3.5 text-slate-800" size={18} />
                </div>

                <div>
                    <div className="relative">
                        <input 
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] bg-[#F8FAFC] pt-3 pr-10"
                            placeholder=" "
                        />
                        <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#0F172A]">
                            Contraseña
                        </label>
                        <button 
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-3.5 text-slate-800 hover:text-slate-800 focus:outline-none"
                        >
                            {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                        </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2 h-4">
                        <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                            <div 
                                className={`h-full rounded-full transition-all duration-300 ${getStrengthColor(strength)}`} 
                                style={{ width: `${(strength / 4) * 100}%` }}
                            ></div>
                        </div>
                        {strength > 0 && (
                            <span className={`text-[10px] font-bold uppercase ${strength === 4 ? 'text-cuypay-accent' : 'text-slate-800'}`}>
                                {getStrengthText(strength)}
                            </span>
                        )}
                    </div>
                </div>

                 <div className="relative">
                    <input
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="peer w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] bg-white pt-3"
                        placeholder=" "
                    />
                    <label className="absolute left-4 top-0.5 text-[10px] text-slate-900 font-semibold transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-800 peer-focus:top-0.5 peer-focus:text-[10px] peer-focus:text-[#0F172A]">
                        Nombre legal de la empresa
                    </label>
                </div>

                <div className="relative">
                    <select
                        value={companyCountry}
                        onChange={(e) => setCompanyCountry(e.target.value)}
                        className="w-full h-12 px-4 border border-slate-500 rounded-lg text-slate-900 focus:outline-none focus:border-[#0F172A] bg-white appearance-none cursor-pointer"
                    >
                        <option value="" disabled>País de constitución de la empresa</option>
                        {countries.map(country => (
                            <option key={country.name} value={country.name}>
                                {country.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-4 text-slate-800 pointer-events-none" size={16} />
                </div>

                <div className="flex items-start gap-3 mt-2">
                    <input 
                        type="checkbox" 
                        id="businessPrivacy"
                        checked={privacyAccepted}
                        onChange={(e) => setPrivacyAccepted(e.target.checked)}
                        className="mt-1 w-4 h-4 rounded border-slate-500 text-[#0F172A] focus:ring-[#0F172A] cursor-pointer" 
                    />
                    <label htmlFor="businessPrivacy" className="text-xs text-slate-900 cursor-pointer leading-relaxed">
                        Acepto las <a href="#" className="text-[#0F172A] font-semibold">políticas de privacidad</a> y los <a href="#" className="text-[#0F172A] font-semibold">términos y condiciones</a> de uso del servicio.
                    </label>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={cooldown > 0 || loading}
                    className="w-full h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg transition-colors shadow-lg shadow-teal-900/20 mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {loading ? 'Registrando...' : cooldown > 0 ? `Espera ${cooldown}s...` : 'Registrarse'}
                </button>

                <div className="text-center text-sm text-slate-900 mt-6">
                    ¿Ya tienes una cuenta? <button onClick={onLoginClick} className="text-[#0F172A] font-bold">Inicia sesión</button>
                </div>
            </div>
        )}
      </div>

      {/* RIGHT SIDE: Graphics (Hidden on mobile) */}
      <div className="hidden lg:flex w-1/2 bg-[#0F172A] relative overflow-hidden items-center justify-center p-12">
        {/* Same graphics as before, omitted for brevity but preserved in existing file */}
        <div className="absolute top-0 right-0 w-full h-full opacity-10">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                <path d="M0 0 L100 0 L100 100 L0 100 Z" fill="url(#grad1)" />
            </svg>
        </div>
        <div className="relative z-10 max-w-lg w-full">
            <div className="relative mb-12 min-h-[220px]">
                <div className="absolute -right-10 -top-20 w-64 h-64 bg-slate-300 rounded-full opacity-20 blur-3xl transition-colors duration-1000"></div>
                <div className={`bg-[#2d4a9e] rounded-2xl p-6 border border-teal-400/30 shadow-2xl backdrop-blur-sm relative transition-opacity duration-300 ease-in-out transform ${isAnimating ? 'opacity-50 scale-[0.98]' : 'opacity-100 scale-100'}`}>
                    <div className="flex justify-between items-center text-teal-100 text-xs font-semibold mb-4">
                        <span>Tienes disponible {currentSim.available}</span>
                    </div>
                    <div className="bg-[#1a337a] rounded-xl p-4 mb-2 flex justify-between items-center">
                        <div>
                            <p className="text-xs text-teal-300 mb-1">Tu envías</p>
                            <p className="text-2xl font-bold text-white transition-all duration-300">$ {currentSim.send.amount}</p>
                        </div>
                        <div className="flex items-center gap-2 bg-[#2d4a9e] px-3 py-1.5 rounded-lg border border-teal-400/30 transition-all duration-300">
                            <FlagImg code={currentSim.send.currency} className="w-5 h-3.5 object-cover rounded-sm" />
                            <span className="text-white font-bold">{currentSim.send.currency}</span>
                        </div>
                    </div>
                    <div className="bg-[#4d66b0] rounded-xl p-4 flex justify-between items-center border border-teal-300/30">
                         <div>
                            <p className="text-xs text-teal-100 mb-1">Recibes</p>
                            <p className="text-2xl font-bold text-white transition-all duration-300">$ {currentSim.receive.amount}</p>
                        </div>
                        <div className="flex items-center gap-2 transition-all duration-300">
                            <FlagImg code={currentSim.receive.currency} className="w-5 h-3.5 object-cover rounded-sm" />
                            <span className="text-white font-bold">{currentSim.receive.currency}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="text-center text-white">
                <h2 className="text-3xl font-bold mb-4">Transferencias nacionales e internacionales</h2>
                <p className="text-teal-100 leading-relaxed text-sm max-w-md mx-auto">
                    Paga en moneda local a proveedores, servicios freelance y plataformas digitales a más de 70 destinos sin comisiones de envío.
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};