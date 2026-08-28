import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { Menu, ChevronDown, Check, Globe, BookOpen, Briefcase, Cpu, Megaphone, Monitor, Ticket, MessageCircle, Send, CreditCard, RefreshCw, Smartphone, ShieldCheck, Play, Clock, Minus, Equal, X as XIcon, User, Building2, Skull, Coffee, Mountain, Sun, Palmtree, Landmark, Zap, TrendingDown, TrendingUp, Headphones, Code, Users, FileText, Gift, Share2, DollarSign, Handshake, BarChart3, Home, Bell, Plus, Euro, Tag, Facebook, Linkedin, Instagram, ArrowRight, Globe2, ArrowRightLeft } from 'lucide-react';
import { useExchangeRates } from '../context/ExchangeRateContext';
import { useSystemConfig } from '../context/SystemConfigContext';
import { useTheme } from '../context/ThemeContext';
import { supabasePersonas } from '../lib/supabaseClient';

// Keys de app_settings que la landing lee para links dinámicos —
// editables desde el admin en Soporte → Enlaces del sitio.
const SITE_LINK_KEYS = [
    'calendly_url', 'support_email',
    'link_blog', 'link_support', 'link_about',
    'link_facebook', 'link_linkedin', 'link_instagram',
] as const;

interface LandingPageProps {
  onLoginClick: () => void;
  onRegisterClick: (role?: 'business' | 'personal') => void;
  onNavigateTo: (pageKey: string) => void;
}

// --- LOCALIZATION & CONFIGURATION ---

type CountryCode = 'CO' | 'PE' | 'CL' | 'MX' | 'BR' | 'US';

interface CountryConfig {
  code: CountryCode;
  name: string;
  currency: string;
  lang: 'es' | 'pt' | 'en';
  sticker: React.ReactNode; 
  stickerColor: string;
  texts: {
    heroTitle: React.ReactNode;
    heroSubtitle: string;
    ctaMain: string;
    ctaSecondary: string;
    featuresTitle: React.ReactNode;
    featuresSubtitle: string;
    login: string;
    createAccount: string;
    personal: string;
    business: string;
  }
}

const LOCALIZATION: Record<CountryCode, CountryConfig> = {
  CO: {
    code: 'CO', name: 'Colombia', currency: 'COP', lang: 'es',
    sticker: <Coffee strokeWidth={1} />, stickerColor: 'text-red-700',
    texts: {
      heroTitle: <>OPERA SIN <br/> FRONTERAS</>,
      heroSubtitle: 'Envía, recibe, compra y vende divisas sin costo Swift y con la mejor tasa del mercado colombiano.',
      ctaMain: 'Crea Tu Cuenta LINCOIN', ctaSecondary: 'Agenda una reunión',
      featuresTitle: <>Todo lo que necesitas <br/> <span className="text-[#0F172A]">en una sola app</span></>,
      featuresSubtitle: 'Únete a las empresas líderes en Colombia que ya operan con nosotros.',
      login: 'Iniciar sesión', createAccount: 'Crear cuenta', personal: 'PERSONAS', business: 'EMPRESAS'
    }
  },
  MX: {
    code: 'MX', name: 'México', currency: 'MXN', lang: 'es',
    sticker: <Skull strokeWidth={1} />, stickerColor: 'text-orange-600', 
    texts: {
      heroTitle: <>SIN FRONTERAS <br/> NI LÍMITES</>,
      heroSubtitle: 'La solución financiera internacional para empresas mexicanas que piensan en grande.',
      ctaMain: 'Abre tu Cuenta', ctaSecondary: 'Contactar Ventas',
      featuresTitle: <>Tu llave al <br/> <span className="text-[#0F172A]">mercado internacional</span></>,
      featuresSubtitle: 'Maneja tus pesos y dólares como un experto local.',
      login: 'Iniciar sesión', createAccount: 'Crear cuenta', personal: 'PERSONAS', business: 'EMPRESAS'
    }
  },
  PE: {
    code: 'PE', name: 'Perú', currency: 'PEN', lang: 'es',
    sticker: <Sun strokeWidth={1} />, stickerColor: 'text-yellow-600',
    texts: {
      heroTitle: <>TU NEGOCIO <br/> EN EL MUNDO</>,
      heroSubtitle: 'Tipo de cambio preferencial para empresas peruanas. Olvídate de las comisiones ocultas.',
      ctaMain: 'Empieza Ahora', ctaSecondary: 'Saber más',
      featuresTitle: <>Potencia tu <br/> <span className="text-[#0F172A]">crecimiento</span></>,
      featuresSubtitle: 'La herramienta favorita de los exportadores peruanos.',
      login: 'Iniciar sesión', createAccount: 'Crear cuenta', personal: 'PERSONAS', business: 'EMPRESAS'
    }
  },
  CL: {
    code: 'CL', name: 'Chile', currency: 'CLP', lang: 'es',
    sticker: <Mountain strokeWidth={1} />, stickerColor: 'text-slate-600',
    texts: {
      heroTitle: <>FINANZAS <br/> INTERNACIONALES</>,
      heroSubtitle: 'La cuenta digital para chilenos sin fronteras. Transfiere al extranjero fácil y rápido.',
      ctaMain: 'Regístrate Gratis', ctaSecondary: 'Ver Demo',
      featuresTitle: <>Libertad <br/> <span className="text-[#0F172A]">financiera</span></>,
      featuresSubtitle: 'Desde Santiago para el mundo, sin barreras.',
      login: 'Iniciar sesión', createAccount: 'Crear cuenta', personal: 'PERSONAS', business: 'EMPRESAS'
    }
  },
  BR: {
    code: 'BR', name: 'Brasil', currency: 'BRL', lang: 'pt',
    sticker: <Palmtree strokeWidth={1} />, stickerColor: 'text-green-600',
    texts: {
      heroTitle: <>OPERAÇÃO SEM <br/> FRONTEIRAS</>,
      heroSubtitle: 'Envie, receba, compre e venda moedas em mais de 90 países, sem custo Swift.',
      ctaMain: 'Crie Sua Conta', ctaSecondary: 'Agendar reunião',
      featuresTitle: <>Tudo o que você precisa <br/> <span className="text-[#0F172A]">em um único app</span></>,
      featuresSubtitle: 'Junte-se a mais de 5000 empresas que já operam conosco na América Latina.',
      login: 'Entrar', createAccount: 'Criar conta', personal: 'PESSOAS', business: 'EMPRESAS'
    }
  },
  US: {
    code: 'US', name: 'USA', currency: 'USD', lang: 'en',
    sticker: <Landmark strokeWidth={1} />, stickerColor: 'text-[#4ADE80]',
    texts: {
      heroTitle: <>BORDERLESS <br/> OPERATIONS</>,
      heroSubtitle: 'Send, receive, and exchange currencies in over 90 countries with transparent rates.',
      ctaMain: 'Get Started', ctaSecondary: 'Contact Sales',
      featuresTitle: <>Everything you need <br/> <span className="text-[#0F172A]">in one app</span></>,
      featuresSubtitle: 'Manage your money locally anywhere in the world.',
      login: 'Log In', createAccount: 'Sign Up', personal: 'PERSONAL', business: 'BUSINESS'
    }
  }
};

const CURRENCIES_LIST = [
  { code: 'BRL', name: 'Real', countryCode: 'BR' },
  { code: 'COP', name: 'Peso', countryCode: 'CO' },
  { code: 'MXN', name: 'Peso', countryCode: 'MX' },
  { code: 'PEN', name: 'Sol', countryCode: 'PE' },
  { code: 'CLP', name: 'Peso', countryCode: 'CL' },
  { code: 'USD', name: 'Dólar', countryCode: 'US' },
  { code: 'VES', name: 'Bolívar', countryCode: 'VE' },
];

// --- HELPER COMPONENTS ---

const FlagImg: React.FC<{ code: string; className?: string }> = ({ code, className }) => (
  <img
    src={`https://flagcdn.com/w40/${code.toLowerCase()}.png`}
    alt={code}
    className={className ?? 'w-5 h-3.5 object-cover rounded-sm'}
  />
);

const CurrencySelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = CURRENCIES_LIST.find(c => c.code === value) ?? CURRENCIES_LIST[0];
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg py-1.5 pl-2 pr-3 font-bold text-slate-800 cursor-pointer"
      >
        <FlagImg code={selected.countryCode} className="w-5 h-3.5 object-cover rounded-sm" />
        <span className="text-sm">{selected.code}</span>
        <ChevronDown size={12} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden py-1 z-50">
          {CURRENCIES_LIST.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onChange(c.code); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left ${value === c.code ? 'bg-slate-50 text-[#0F172A] font-bold' : 'text-slate-800'}`}
            >
              <FlagImg code={c.countryCode} className="w-5 h-3.5 object-cover rounded-sm" />
              <span className="text-sm font-bold">{c.code}</span>
              <span className="text-xs text-slate-400">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const FlagBubble: React.FC<{ children: React.ReactNode; highlight?: boolean }> = ({ children, highlight }) => (
  <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl transform transition-all duration-300 hover:scale-110 cursor-default ${highlight ? 'bg-white border-4 border-[#4ADE80] -translate-y-4 z-10' : 'bg-white border-2 border-slate-50 text-slate-600'}`}>
    {children}
  </div>
);

const IndustryItem: React.FC<{ icon: any; label: string; color: string; logo: string }> = ({ icon: Icon, label, color, logo }) => (
    <div className="flex flex-col items-center group cursor-pointer">
        {/* La animación vive solo en la caja redondeada del icono: se eleva,
            crece un poco y proyecta un glow suave con la forma del rounded
            (spread negativo) — así el hover ya no se ve cuadrado. */}
        <div className={`w-16 h-16 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center mb-4 transition-all duration-300 group-hover:-translate-y-1.5 group-hover:scale-105 group-hover:bg-[#4ADE80]/10 group-hover:border-[#4ADE80]/60 group-hover:shadow-[0_16px_32px_-10px_rgba(45,212,191,0.5)] ${color}`}>
            <Icon size={32} />
        </div>
        <h3 className="font-bold text-white mb-1 transition-colors group-hover:text-[#4ADE80]">{label}</h3>
        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">{logo}</span>
    </div>
);

// FeatureCard premium con icono más grande, gradient sutil y glow
// behind the icon. La paleta unificada se basa en el cyan oficial
// Lincoin (#4ADE80) — los `color` legacy del callsite siguen
// aceptados pero el container del icono ahora siempre arma su
// estilo desde el tono del icono que recibe (iconTint).
const FeatureCard: React.FC<{
    icon: any;
    title: string;
    desc: string;
    color?: string;          // legacy, ignorado para el container nuevo
    iconTint?: 'cyan' | 'emerald' | 'violet';
}> = ({ icon: Icon, title, desc, iconTint = 'cyan' }) => {
    // Paleta consistente con la marca: 3 tonos derivados del cyan #4ADE80
    // que mantienen la armonía sin desentonar.
    const tones: Record<string, { from: string; to: string; ring: string; icon: string; glow: string }> = {
        cyan: {
            from: '#4ADE80',
            to:   '#06B6D4',
            ring: 'rgba(45, 212, 191, 0.35)',
            icon: '#0F172A',
            glow: 'rgba(45, 212, 191, 0.45)',
        },
        emerald: {
            from: '#34D399',
            to:   '#10B981',
            ring: 'rgba(52, 211, 153, 0.35)',
            icon: '#0F172A',
            glow: 'rgba(52, 211, 153, 0.45)',
        },
        violet: {
            from: '#A78BFA',
            to:   '#7C3AED',
            ring: 'rgba(167, 139, 250, 0.35)',
            icon: '#ffffff',
            glow: 'rgba(167, 139, 250, 0.45)',
        },
    };
    const t = tones[iconTint];
    return (
        <div className="relative bg-white/5 p-8 rounded-3xl border border-white/10 hover:border-[#4ADE80]/60 transition-all duration-300 group flex flex-col items-center text-center hover-lift overflow-hidden">
            {/* Glow detrás del icono en hover */}
            <div
                className="absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-40 rounded-full blur-3xl opacity-0 group-hover:opacity-60 transition-opacity duration-500 pointer-events-none"
                style={{ backgroundColor: t.glow }}
            />
            {/* Container del icono — pill con gradient + doble ring */}
            <div
                className="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300"
                style={{
                    backgroundImage: `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)`,
                    boxShadow: `0 0 0 1px ${t.ring}, 0 12px 30px -8px ${t.glow}`,
                }}
            >
                <Icon size={30} strokeWidth={2} color={t.icon} />
            </div>
            <h3 className="text-xl font-bold text-white mb-3 transition-colors">{title}</h3>
            <p className="text-white/60 leading-relaxed text-sm">{desc}</p>
        </div>
    );
};

const BenefitItem: React.FC<{ icon: any; title: string; desc: string }> = ({ icon: Icon, title, desc }) => (
    // Sección oscura: NO se voltea a fondo blanco en hover (eso dejaba el
    // icono blanco-sobre-blanco y el texto gris claro ilegibles). Todo se
    // mantiene claro-sobre-oscuro; el hover es solo un tinte sutil + lift.
    <div className="flex flex-col items-center text-center p-6 rounded-2xl hover:bg-white/5 transition-all duration-300 group cursor-pointer border border-transparent hover:border-[#4ADE80]/30 hover-lift">
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-6 text-[#0F172A] shadow-sm group-hover:scale-110 transition-transform duration-300 border border-slate-100">
            <Icon size={28} strokeWidth={1.5} />
        </div>
        <h3 className="text-lg font-bold text-white mb-3 group-hover:text-[#4ADE80] transition-colors">{title}</h3>
        <p className="text-slate-300 text-sm leading-relaxed">
            {desc}
        </p>
    </div>
);

export const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick, onRegisterClick, onNavigateTo }) => {
  const [landingView, setLandingView] = useState<'home' | 'referrals' | 'affiliates'>('home');
  const [segment, setSegment] = useState<'personal' | 'business'>('personal');
  
  // Country State
  const [currentCountry, setCurrentCountry] = useState<CountryCode>('CO');
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  
  // Menus
  const [registerMenuOpen, setRegisterMenuOpen] = useState(false);
  const [benefitsMenuOpen, setBenefitsMenuOpen] = useState(false);
  
  const registerMenuRef = useRef<HTMLDivElement>(null);
  const countryMenuRef = useRef<HTMLDivElement>(null);
  const benefitsMenuRef = useRef<HTMLDivElement>(null);

  // CONTEXT CONNECTION
  const { getRate, getFee, getFeeForAmount, getProvider } = useExchangeRates();
  const { config } = useSystemConfig();
  const { isDarkMode } = useTheme();
  const pageBg = isDarkMode ? config.themeColor : '#FFFFFF';

  const seasonEmoji = config.seasonEmojis && config.seasonEmojis.length > 0 ? config.seasonEmojis[0] : null;
  const secondaryEmoji = config.seasonEmojis && config.seasonEmojis.length > 1 ? config.seasonEmojis[1] : null;

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (registerMenuRef.current && !registerMenuRef.current.contains(event.target as Node)) {
        setRegisterMenuOpen(false);
      }
      if (countryMenuRef.current && !countryMenuRef.current.contains(event.target as Node)) {
        setCountryMenuOpen(false);
      }
      if (benefitsMenuRef.current && !benefitsMenuRef.current.contains(event.target as Node)) {
        setBenefitsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- CONVERTER STATE ---
  const [amount, setAmount] = useState<number>(1000); 
  const [sourceCurr, setSourceCurr] = useState('USD'); 
  const [targetCurr, setTargetCurr] = useState(LOCALIZATION[currentCountry].currency);
  
  // Update target currency when country changes
  useEffect(() => {
      setTargetCurr(LOCALIZATION[currentCountry].currency);
  }, [currentCountry]);

  // Scroll reveal — observe all .reveal* elements after render.
  // Deps incluyen segment + landingView porque cuando el user cambia entre
  // personal/empresas o entre home/referrals/affiliates, React monta NUEVOS
  // nodos .reveal que el observer viejo nunca observó — y quedan con
  // opacity:0 permanente. Re-creamos el observer en cada cambio.
  //
  // También promovemos a 'visible' inmediatamente cualquier .reveal que ya
  // esté arriba del fold al montar: el IntersectionObserver a veces no
  // dispara para elementos que ya son visibles antes de que se suscriba,
  // lo cual deja el hero/sección activa en blanco hasta que el user scrollea.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } }),
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    // Pequeño delay para que React termine de pintar los nodos del nuevo
    // segment/landingView antes de suscribirnos.
    const t = window.setTimeout(() => {
      document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale')
        .forEach(el => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          // Si ya está visible en viewport, marcarlo directo (evita el
          // edge case del observer que no dispara para elementos visibles
          // antes del subscribe).
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            el.classList.add('visible');
          } else {
            observer.observe(el);
          }
        });
    }, 30);
    return () => { window.clearTimeout(t); observer.disconnect(); };
  }, [currentCountry, segment, landingView]);

  // UI State
  const [showDetails, setShowDetails] = useState(false);

  // Fee Calculation: usamos los tiers configurados en el admin si los hay,
  // si no cae al flat fee legacy. El monto se evalúa en la moneda source y
  // el helper lo convierte a USD internamente para buscar el tier.
  const feePercentage = getFeeForAmount(sourceCurr, targetCurr, amount);
  const fee = amount * (feePercentage / 100);
  const amountToConvert = amount - fee;
  
  const rate = getRate(sourceCurr, targetCurr);
  const result = amountToConvert * rate;

  // Etiqueta de fuente para mostrar debajo del converter público.
  // Solo FastForex (API) y Manual son fuentes activas; las legacy (CurrencyFreaks,
  // Fawaz, XE) no muestran badge — caen a string vacío que oculta el bloque.
  const rateProvider = (getProvider(sourceCurr, targetCurr) ?? '').toUpperCase();
  const rateProviderLabel: string =
    rateProvider === 'FASTFOREX' ? (currentCountry === 'US' ? 'Live rate · FastForex' : 'Tasa en vivo · FastForex') :
    rateProvider === 'MANUAL'    ? (currentCountry === 'US' ? 'Manual rate'           : 'Tasa manual') :
    '';
  const rateRefreshHint: string =
    currentCountry === 'BR' ? 'Atualizada a cada 5 min' :
    currentCountry === 'US' ? 'Updated every 5 min'      :
                              'Actualizada cada 5 min';

  const handleRegisterAttempt = (role?: 'business' | 'personal') => {
      if (!config.allowNewRegistrations) {
          alert(currentCountry === 'BR' ? "O registro está temporariamente desativado." : currentCountry === 'US' ? "Registration temporarily disabled." : "El registro de nuevos usuarios está temporalmente deshabilitado.");
          return;
      }
      onRegisterClick(role);
  };

  // Links dinámicos del sitio (Calendly, redes, correo de contacto…)
  // cargados desde app_settings. Fallbacks razonables si falla la carga.
  const [siteLinks, setSiteLinks] = useState<Record<string, string>>({});
  const [contactOpen, setContactOpen] = useState(false);

  useEffect(() => {
      let cancelled = false;
      (async () => {
          try {
              const { data } = await supabasePersonas
                  .from('app_settings')
                  .select('key, value')
                  .in('key', SITE_LINK_KEYS as unknown as string[]);
              if (cancelled || !data) return;
              const map: Record<string, string> = {};
              for (const row of data as any[]) {
                  const v = row.value;
                  const s = typeof v === 'string' ? v : (v?.url ?? v?.email ?? '');
                  if (s) map[row.key] = s;
              }
              setSiteLinks(map);
          } catch { /* la landing funciona igual con los fallbacks */ }
      })();
      return () => { cancelled = true; };
  }, []);

  // Tracking de visita a la home (vistas + tiempo). Best-effort.
  useEffect(() => {
      let eventId: string | null = null;
      const start = Date.now();
      (async () => {
          try {
              const { data } = await supabasePersonas
                  .from('site_events')
                  .insert({ page: 'home', referrer: document.referrer || null })
                  .select('id')
                  .single();
              eventId = (data as any)?.id ?? null;
          } catch { /* sin tracking */ }
      })();
      const flush = () => {
          if (!eventId) return;
          const secs = Math.round((Date.now() - start) / 1000);
          void supabasePersonas.from('site_events')
              .update({ duration_seconds: secs })
              .eq('id', eventId);
      };
      const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
      document.addEventListener('visibilitychange', onVis);
      return () => { document.removeEventListener('visibilitychange', onVis); flush(); };
  }, []);

  const openCalendly = () => {
      window.open(siteLinks.calendly_url || 'https://calendly.com/bryandavidortiz51/masaje', '_blank');
  };

  // Enlaces rápidos: si el admin configuró una URL externa, la abrimos;
  // si no, cae a la navegación interna de siempre.
  const openQuickLink = (key: string, fallbackPage: string) => {
      const url = siteLinks[key];
      if (url) window.open(url, '_blank');
      else onNavigateTo(fallbackPage);
  };

  const supportEmail = siteLinks.support_email || 'soporte@cuypay.com';

  const formatCurrency = (val: number, curr: string) => {
    return new Intl.NumberFormat(currentCountry === 'US' ? 'en-US' : 'es-CL', { 
        style: 'decimal', 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    }).format(val);
  };
  
  const getDeliveryDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    if (currentCountry === 'US') return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
    if (currentCountry === 'BR') return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  };

  const content = LOCALIZATION[currentCountry];

  const getCurrencySymbol = (code: string) => {
      if (code === 'EUR') return '€';
      if (code === 'PEN') return 'S/';
      if (code === 'BRL') return 'R$';
      if (code === 'GBP') return '£';
      if (code === 'CNY') return '¥';
      return '$';
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-500 ${isDarkMode ? 'text-white' : 'text-slate-950'}`}
      style={{ background: pageBg }}>

      {/* Navbar - Dynamic Background */}
      <nav className={`sticky top-0 z-50 backdrop-blur-sm ${isDarkMode ? 'border-b border-white/10' : 'border-b border-slate-300'}`} style={{ backgroundColor: `${pageBg}F0` }}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-20 flex items-center justify-between">
           {/* Logo & Role Switcher */}
           <div className="flex items-center gap-4 lg:gap-8">
              <div 
                className="scale-90 cursor-pointer hover:opacity-80 transition-opacity" 
                onClick={() => { setLandingView('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              >
                <Logo variant="white" business={segment === 'business'} />
              </div>
              
              {landingView === 'home' && (
                  <div className="hidden md:flex items-center text-[10px] lg:text-xs font-bold h-20 tracking-wide">
                     <button
                        onClick={() => setSegment('personal')}
                        className={`px-3 lg:px-4 h-full flex items-center transition-all duration-300 border-b-[3px] ${segment === 'personal' ? 'text-[#4ADE80] border-[#4ADE80]' : 'text-slate-400 border-transparent hover:text-white'}`}
                     >
                        {content.texts.personal} {seasonEmoji}
                     </button>
                     <button
                        onClick={() => setSegment('business')}
                        className={`px-3 lg:px-4 h-full flex items-center transition-all duration-300 border-b-[3px] ${segment === 'business' ? 'text-[#4ADE80] border-[#4ADE80]' : 'text-slate-400 border-transparent hover:text-white'}`}
                     >
                        {content.texts.business}
                     </button>
                     {/* SMART CARD — externa: redirige a lincoin.me en la misma pestaña.
                         Versión premium con icono AL LADO del texto, ping/glow alrededor,
                         gradient cyan→violet en el texto y shimmer al hover. */}
                     <a
                        href="https://lincoin.me"
                        className="smartcard-pill relative px-3 lg:px-4 h-full flex items-center gap-2 transition-all duration-300 border-b-[3px] border-transparent group overflow-visible"
                     >
                        {/* Icono CreditCard al lado con pulse infinito */}
                        <span className="relative inline-flex items-center justify-center pointer-events-none">
                           <span className="absolute inline-flex h-6 w-6 rounded-full opacity-60 animate-ping" style={{ backgroundColor: '#4ADE80' }} />
                           <CreditCard size={14} className="relative text-[#4ADE80] drop-shadow-[0_0_6px_rgba(45,212,191,0.7)]" />
                        </span>
                        {/* Texto con gradient animado (smartcard-text en index.html) */}
                        <span
                           className="smartcard-text font-extrabold tracking-wide bg-clip-text text-transparent transition-all duration-300 group-hover:scale-105"
                           style={{
                              backgroundImage: 'linear-gradient(90deg, #4ADE80 0%, #06B6D4 50%, #A78BFA 100%, #06B6D4 150%, #4ADE80 200%)',
                           }}
                        >
                           SMART CARD
                        </span>
                        {/* Shimmer pasando en hover */}
                        <span
                           aria-hidden
                           className="pointer-events-none absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 group-hover:animate-[shimmer_1.2s_ease-in-out_infinite] rounded"
                           style={{ backgroundSize: '200% 100%' }}
                        />
                     </a>
                  </div>
              )}
           </div>

           {/* Right Links */}
           <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-white/90">
              <button 
                onClick={() => { setLandingView('home'); }}
                className={`flex items-center gap-1 cursor-pointer transition-colors ${landingView === 'home' ? 'text-white font-bold' : 'hover:text-[#4ADE80]'}`}
              >
                  {currentCountry === 'BR' ? 'Produtos' : currentCountry === 'US' ? 'Products' : 'Productos'}
              </button>

              {/* BENEFITS DROPDOWN */}
              <div className="relative" ref={benefitsMenuRef}>
                  <button 
                    onClick={() => setBenefitsMenuOpen(!benefitsMenuOpen)}
                    className={`flex items-center gap-1 cursor-pointer transition-colors ${landingView !== 'home' ? 'text-[#4ADE80] font-bold' : 'hover:text-[#4ADE80]'}`}
                  >
                      {currentCountry === 'BR' ? 'Benefícios' : currentCountry === 'US' ? 'Benefits' : 'Beneficios'} <ChevronDown size={14}/>
                  </button>
                  {benefitsMenuOpen && (
                      <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden py-2 animate-in fade-in zoom-in-95 text-slate-800 z-50">
                          <button 
                            onClick={() => { setLandingView('referrals'); setBenefitsMenuOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                          >
                              <div className="bg-green-100 p-1.5 rounded-lg text-green-600"><Gift size={16}/></div>
                              <span className="text-sm font-bold">Invita y Gana</span>
                          </button>
                          <button 
                            onClick={() => { setLandingView('affiliates'); setBenefitsMenuOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                          >
                              <div className="bg-[#F0FFFE] p-1.5 rounded-lg text-[#4ADE80]"><Megaphone size={16}/></div>
                              <span className="text-sm font-bold">Aliados LINCOIN</span>
                          </button>
                      </div>
                  )}
              </div>
              
              {/* Country Selector */}
              <div className="relative" ref={countryMenuRef}>
                  <button 
                    onClick={() => setCountryMenuOpen(!countryMenuOpen)}
                    className="flex items-center gap-2 cursor-pointer pl-2 hover:bg-white/10 px-3 py-1.5 rounded-full transition-colors"
                  >
                     <FlagImg code={content.code} className="w-6 h-4 object-cover rounded-sm shadow-sm" />
                     <span className="font-bold text-xs">{content.code}</span>
                     <ChevronDown size={14} className="text-slate-400"/>
                  </button>
                  
                  {countryMenuOpen && (
                      <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden py-1 animate-in fade-in zoom-in-95 text-slate-800">
                          {Object.values(LOCALIZATION).map((c) => (
                              <button 
                                key={c.code}
                                onClick={() => { setCurrentCountry(c.code); setCountryMenuOpen(false); }}
                                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors ${currentCountry === c.code ? 'bg-slate-50 text-[#0F172A] font-bold' : ''}`}
                              >
                                  <FlagImg code={c.code} className="w-6 h-4 object-cover rounded-sm shadow-sm" />
                                  <span className="text-sm">{c.name}</span>
                                  {currentCountry === c.code && <Check size={14} className="ml-auto"/>}
                              </button>
                          ))}
                      </div>
                  )}
              </div>
              
              <button onClick={onLoginClick} className="font-bold hover:text-[#4ADE80] transition-colors">
                  {content.texts.login}
              </button>
              
              {/* Dropdown for Create Account */}
              <div className="relative" ref={registerMenuRef}>
                  <button 
                    onClick={() => setRegisterMenuOpen(!registerMenuOpen)}
                    disabled={!config.allowNewRegistrations}
                    className={`
                        bg-white text-[#0F172A] px-5 py-2.5 rounded-full font-bold transition-all flex items-center gap-2
                        ${!config.allowNewRegistrations ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#4ADE80] hover:text-white'}
                    `}
                  >
                    {content.texts.createAccount}
                  </button>

                  {registerMenuOpen && config.allowNewRegistrations && (
                    <div className="absolute top-full right-0 mt-3 w-64 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden py-2 animate-in fade-in zoom-in-95 duration-200 text-slate-900">
                        <button 
                            onClick={() => {
                                setSegment('personal');
                                handleRegisterAttempt('personal');
                                setRegisterMenuOpen(false);
                            }}
                            className="w-full text-left px-6 py-4 hover:bg-slate-50 flex items-center gap-4 group transition-colors border-b border-slate-50"
                        >
                            <User size={20} className="text-[#0F172A] group-hover:scale-110 transition-transform" />
                            <span className="font-bold text-[#0F172A] text-sm">{content.texts.personal}</span>
                        </button>
                        <button 
                            onClick={() => {
                                setSegment('business');
                                handleRegisterAttempt('business');
                                setRegisterMenuOpen(false);
                            }}
                            className="w-full text-left px-6 py-4 hover:bg-slate-50 flex items-center gap-4 group transition-colors"
                        >
                            <Building2 size={20} className="text-[#0F172A] group-hover:scale-110 transition-transform" />
                            <span className="font-bold text-[#0F172A] text-sm">{content.texts.business}</span>
                        </button>
                    </div>
                  )}
              </div>

              <ThemeToggle />
           </div>

           {/* Mobile Menu Toggle */}
           <div className="lg:hidden flex items-center gap-3">
                <ThemeToggle />
                <button onClick={() => {
                    const codes: CountryCode[] = ['CO', 'MX', 'PE', 'CL', 'BR', 'US'];
                    const idx = codes.indexOf(currentCountry);
                    setCurrentCountry(codes[(idx + 1) % codes.length]);
                }} className="text-xl">
                    {content.flag}
                </button>
               <button className="text-white" onClick={onLoginClick}>
                  <Menu size={24} />
               </button>
           </div>
        </div>
      </nav>

      {/* --- CONTENT AREA BASED ON VIEW --- */}

      {landingView === 'home' && (
        <>
          {/* Hero Section */}
          <section className="relative pt-10 pb-20 md:pt-16 md:pb-32 overflow-hidden min-h-[600px] md:min-h-[650px] flex items-center">
             <div className="max-w-7xl mx-auto px-4 md:px-8 flex flex-col lg:flex-row items-center gap-10 lg:gap-16 w-full">

                {/* Left Content */}
                <div className="lg:w-5/12 z-10 space-y-6 md:space-y-8 text-center lg:text-left anim-slide-l" style={{animationDelay:'0.1s'}}>
                   {segment === 'business' ? (
                       <>
                           <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight uppercase">
                             <span className="text-[#4ADE80] text-xs md:text-base font-bold tracking-widest uppercase block mb-2 md:mb-4">
                                 {currentCountry === 'BR' ? 'Para empresas que pensam grande' : currentCountry === 'US' ? 'For ambitious companies' : 'Si tu empresa piensa en grande'} {secondaryEmoji}
                             </span>
                             {content.texts.heroTitle} {seasonEmoji}
                           </h1>
                           <p className="text-green-100/80 text-base md:text-lg leading-relaxed max-w-xl mx-auto lg:mx-0">
                             {content.texts.heroSubtitle}
                           </p>
                           <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                              <button onClick={openCalendly} className="bg-white text-[#0F172A] px-8 py-4 rounded-full font-bold hover:bg-slate-200 transition-colors w-full sm:w-auto">
                                {content.texts.ctaSecondary}
                              </button>
                              <button onClick={() => handleRegisterAttempt('business')} disabled={!config.allowNewRegistrations} className="border border-white text-white px-8 py-4 rounded-full font-bold hover:bg-white/10 transition-colors disabled:opacity-50 w-full sm:w-auto">
                                {content.texts.ctaMain}
                              </button>
                           </div>
                       </>
                   ) : (
                       /* PERSONAL HERO TEXT */
                       <>
                           <h1 className="text-3xl md:text-5xl lg:text-[3.5rem] font-bold leading-tight tracking-tight">
                             {currentCountry === 'BR' ? <>Transferências <br/> internacionais ao <br/></> : currentCountry === 'US' ? <>International <br/> transfers at the <br/></> : <>Transferencias <br/> internacionales al <br/></>}
                             <span className="text-green-200">
                                 {currentCountry === 'BR' ? 'melhor preço' : currentCountry === 'US' ? 'best price' : 'mejor precio'}
                             </span> {seasonEmoji}
                           </h1>
                           <div className="space-y-4">
                               <p className="text-white text-base md:text-lg leading-relaxed max-w-xl mx-auto lg:mx-0">
                                 {content.texts.heroSubtitle}
                               </p>
                           </div>
                           <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start pt-4">
                              <button onClick={() => { setSegment('personal'); handleRegisterAttempt('personal'); }} disabled={!config.allowNewRegistrations} className="bg-white text-[#0F172A] px-8 py-3.5 rounded-full font-bold hover:bg-slate-100 transition-colors shadow-lg disabled:opacity-50 w-full sm:w-auto btn-shine">
                                {content.texts.ctaMain}
                              </button>
                              <button onClick={() => window.open('https://www.youtube.com/@CuypayLatam', '_blank')} className="flex items-center justify-center gap-3 text-white px-6 py-3.5 font-bold hover:bg-white/10 rounded-full transition-colors border border-white/20 hover:border-white w-full sm:w-auto">
                                <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-[#0F172A]">
                                    <Play size={10} fill="#0F172A" />
                                </div>
                                {currentCountry === 'BR' ? 'Veja como funciona' : currentCountry === 'US' ? 'See how it works' : 'Mira cómo funciona'}
                              </button>
                           </div>
                       </>
                   )}
                </div>

                {/* Right Content - Mockups / Widgets */}
                <div className="lg:w-7/12 relative z-10 flex justify-center perspective-1000 w-full px-2 md:px-0 anim-slide-r" style={{animationDelay:'0.25s'}}>
                    

                    {/* Cultural Sticker Decoration */}
                    <div className={`absolute -top-16 -right-4 md:-right-10 z-0 opacity-10 md:opacity-20 pointer-events-none transform rotate-12 scale-150 md:scale-[2.5] ${content.stickerColor}`}>
                        {React.cloneElement(content.sticker as React.ReactElement<any>, { size: 140 })}
                    </div>

                    {segment === 'business' ? (
                        /* LAPTOP MOCKUP FOR BUSINESS */
                        <div className="relative w-full max-w-2xl transform rotate-y-[-5deg] rotate-x-[5deg] transition-all duration-700 anim-float-slow">
                            <div className="bg-[#1a1a1a] rounded-t-3xl p-1 pb-0 shadow-2xl border-4 border-[#2a2a2a] relative">
                                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#333] rounded-full z-20"></div>
                                <div className="bg-[#F4F6F9] rounded-t-2xl overflow-hidden aspect-[16/10] relative text-slate-900 flex text-[10px] md:text-xs leading-none select-none cursor-default">
                                    {/* Sidebar */}
                                    <div className="w-16 md:w-20 bg-[#0F172A] flex flex-col items-center py-6 gap-6 shrink-0" style={{ backgroundColor: config.themeColor }}>
                                        <div className="w-8 h-8 rounded-lg bg-[#4ADE80] flex items-center justify-center text-[#0F172A] font-bold">C</div>
                                        <div className="space-y-4 w-full flex flex-col items-center">
                                            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white"><Home size={14} /></div>
                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400"><Send size={14} /></div>
                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400"><RefreshCw size={14} /></div>
                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400"><Users size={14} /></div>
                                        </div>
                                    </div>

                                    {/* Main Content */}
                                    <div className="flex-1 p-6 md:p-8 flex flex-col">
                                        {/* Header */}
                                        <div className="flex justify-between items-center mb-8">
                                            <div>
                                                <div className="font-bold text-slate-800 text-sm md:text-base mb-1">Resumen Global {seasonEmoji}</div>
                                                <div className="text-[10px] text-slate-400">Actualizado hace 1 min</div>
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center"><Bell size={14} className="text-slate-400"/></div>
                                                <div className="w-8 h-8 rounded-full bg-[#4ADE80] flex items-center justify-center text-[#0F172A] font-bold">E</div>
                                            </div>
                                        </div>

                                        {/* Cards Row */}
                                        <div className="flex gap-4 mb-8 overflow-hidden">
                                            {/* Card 1: CLP */}
                                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 w-40 shrink-0 flex flex-col justify-between h-28 relative overflow-hidden group">
                                                <div className="flex justify-between items-start">
                                                    <FlagImg code="CL" className="w-7 h-5 object-cover rounded shadow-sm" />
                                                    <span className="text-[10px] font-bold text-slate-400">CLP</span>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-800 text-sm">$ 2.500.000</div>
                                                    <div className="text-[8px] text-slate-400 mt-1">Peso Chileno</div>
                                                </div>
                                                <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-100"></div>
                                            </div>

                                            {/* Card 2: USD */}
                                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 w-40 shrink-0 flex flex-col justify-between h-28 relative overflow-hidden group">
                                                <div className="flex justify-between items-start">
                                                    <FlagImg code="US" className="w-7 h-5 object-cover rounded shadow-sm" />
                                                    <span className="text-[10px] font-bold text-slate-400">USD</span>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-800 text-sm">$ 12,450.00</div>
                                                    <div className="text-[8px] text-slate-400 mt-1">Dólar USA</div>
                                                </div>
                                                <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-100"></div>
                                            </div>

                                            {/* Card 3: EUR (Active) */}
                                            <div className="bg-[#0F172A] p-4 rounded-2xl shadow-lg border border-[#0F172A] w-40 shrink-0 flex flex-col justify-between h-28 relative overflow-hidden text-white" style={{ backgroundColor: config.themeColor, borderColor: config.themeColor }}>
                                                <div className="flex justify-between items-start">
                                                    <span className="text-2xl">🇪🇺</span>
                                                    <span className="text-[10px] font-bold text-slate-400">EUR</span>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-white text-sm">€ 4.200,50</div>
                                                    <div className="text-[8px] text-slate-400 mt-1">Euro</div>
                                                </div>
                                                {/* Decorative accent */}
                                                {/* Action buttons inside card */}
                                                <div className="flex gap-2 mt-2">
                                                     <div className="h-6 bg-white/10 rounded flex items-center px-2 gap-1 w-full justify-center">
                                                        <Plus size={10} /> <span className="text-[8px]">Cargar</span>
                                                     </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Transactions List */}
                                        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-4 overflow-hidden">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Movimientos Recientes</div>
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-100"><FlagImg code="US" className="w-full h-full object-cover" /></div>
                                                        <div>
                                                            <div className="font-bold text-slate-700">Pago Proveedor AWS</div>
                                                            <div className="text-[8px] text-slate-400">Hace 2 horas</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-bold text-slate-800">- $450.00</div>
                                                        <div className="text-[8px] text-slate-400">USD</div>
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-100"><FlagImg code="CL" className="w-full h-full object-cover" /></div>
                                                        <div>
                                                            <div className="font-bold text-slate-700">Cobro Factura #1023</div>
                                                            <div className="text-[8px] text-slate-400">Ayer</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-bold text-green-600">+ $1.200.000</div>
                                                        <div className="text-[8px] text-slate-400">CLP</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-[#2a2a2a] h-4 rounded-b-3xl transform scale-x-[1.02] shadow-xl relative z-0"></div>
                            
                            {/* Floating Bubbles */}
                            <div className="absolute -bottom-8 right-10 flex items-center gap-4">
                                {/* USD Bubble */}
                                <FlagBubble>
                                    <div className="flex flex-col items-center justify-center h-full">
                                        <span className="text-lg font-bold text-slate-700 leading-none">$</span>
                                        <span className="text-[8px] font-bold text-slate-400 mt-0.5">USD</span>
                                    </div>
                                </FlagBubble>
                                
                                {/* EUR Bubble */}
                                <FlagBubble>
                                    <div className="flex flex-col items-center justify-center h-full">
                                        <span className="text-lg font-bold text-slate-700 leading-none">€</span>
                                        <span className="text-[8px] font-bold text-slate-400 mt-0.5">EUR</span>
                                    </div>
                                </FlagBubble>

                                {/* Local Currency Bubble (Highlighted) */}
                                <FlagBubble highlight>
                                    <div className="flex flex-col items-center justify-center h-full">
                                        <span className="text-lg font-bold text-slate-700 leading-none">
                                            {getCurrencySymbol(content.currency)}
                                        </span>
                                        <span className="text-[8px] font-bold text-slate-400 mt-0.5">
                                            {content.currency}
                                        </span>
                                    </div>
                                </FlagBubble>
                            </div>
                        </div>
                    ) : (
                        /* LIVE CONVERTER WIDGET FOR PERSONAL */
                        <div className="bg-white rounded-3xl p-6 md:p-8 shadow-2xl w-full max-w-md text-slate-900 animate-in fade-in slide-in-from-right-8 duration-700 relative overflow-hidden min-h-[520px] flex flex-col justify-center mx-auto">
                            
                            {/* Cultural Icon Inside Widget (Small) */}
                            <div className={`absolute top-4 left-4 opacity-10 transform -rotate-12 ${content.stickerColor}`}>
                                 {React.cloneElement(content.sticker as React.ReactElement<any>, { size: 48 })}
                            </div>

                            {/* OVERLAY: DETAIL VIEW */}
                            <div className={`
                                absolute inset-0 bg-white z-20 p-8 transition-all duration-300 flex flex-col
                                ${showDetails ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'}
                            `}>
                                <div className="flex justify-between items-center mb-8">
                                    <h3 className="text-[#0F172A] font-bold text-xl">{currentCountry === 'US' ? 'Full Details' : 'Detalle completo'}</h3>
                                    <button 
                                        onClick={() => setShowDetails(false)}
                                        className="flex items-center gap-1 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-full px-3 py-1.5 hover:bg-slate-50 transition-colors uppercase tracking-wider"
                                    >
                                        <XIcon size={12} strokeWidth={3} />
                                    </button>
                                </div>

                                <div className="space-y-4 flex-1">
                                    {/* Row 1 */}
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-bold text-slate-700 text-sm">Tu envias:</span>
                                        <span className="font-bold text-[#0F172A] text-lg">{formatCurrency(amount, sourceCurr)} {sourceCurr}</span>
                                    </div>
                                    <div className="border-t border-dashed border-slate-200"></div>

                                    {/* Row 2: Fee */}
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-bold text-slate-700 text-sm">Costo de envío:</span>
                                        <span className="font-bold text-[#0F172A] text-lg">{formatCurrency(fee, sourceCurr)} {sourceCurr}</span>
                                    </div>
                                    {/* Los costos operacionales son información INTERNA de Lincoin
                                        (Contabilidad → costos por par) — el cliente solo ve el costo
                                        de envío total. */}
                                    <div className="border-t border-dashed border-slate-200"></div>

                                    {/* Row 3: Amount to Convert */}
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-bold text-slate-700 text-sm">Monto a convertir:</span>
                                        <span className="font-bold text-[#0F172A] text-lg">{formatCurrency(amountToConvert, sourceCurr)} {sourceCurr}</span>
                                    </div>
                                    <div className="border-t border-dashed border-slate-200"></div>

                                    {/* Row 4: Rate */}
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-bold text-slate-700 text-sm">Tipo de cambio:</span>
                                        <span className="font-bold text-[#0F172A] text-sm">1 {sourceCurr} = {rate > 0 ? formatCurrency(rate, targetCurr) : '---'} {targetCurr}</span>
                                    </div>
                                    <div className="border-t border-dashed border-slate-200"></div>

                                    {/* Row 5: Total */}
                                    <div className="flex justify-between items-baseline mt-4">
                                        <span className="font-bold text-slate-700 text-sm">Tu contacto recibe:</span>
                                        <span className="font-bold text-[#0F172A] text-xl">{rate > 0 ? formatCurrency(result, targetCurr) : '---'} {targetCurr}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Input: You Send */}
                            <div className="border border-slate-200 rounded-2xl p-4 mb-3 relative bg-white hover:border-[#4ADE80] transition-colors group focus-within:border-[#4ADE80]">
                               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                   {currentCountry === 'BR' ? 'Você envia' : currentCountry === 'US' ? 'You send' : 'Tu envías'}
                               </label>
                               <div className="flex justify-between items-center gap-2">
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    value={amount === 0 ? '' : amount}
                                    onChange={(e) => {
                                        const raw = e.target.value;
                                        if (raw === '') { setAmount(0); return; }
                                        // Si el valor empieza con '0' seguido de otro dígito
                                        // (caso "05090"), saco el cero líder antes de parsear.
                                        const cleaned = raw.replace(/^0+(?=\d)/, '');
                                        const n = Number(cleaned);
                                        setAmount(isFinite(n) && n >= 0 ? n : 0);
                                    }}
                                    placeholder="0"
                                    className="text-3xl font-bold text-slate-900 w-full outline-none bg-transparent"
                                  />
                                  <CurrencySelect value={sourceCurr} onChange={setSourceCurr} />
                               </div>
                            </div>

                            {/* Input: They Receive (Read Only) */}
                            <div className="border border-slate-200 rounded-2xl p-4 mb-3 relative bg-white hover:border-[#4ADE80] transition-colors group">
                               {/* Connector Icon */}
                               <div className="absolute left-1/2 -top-5 -translate-x-1/2 bg-white border border-slate-200 rounded-full p-1.5 text-slate-400 shadow-sm z-10">
                                  <span className="font-serif font-bold text-sm text-slate-400">$</span>
                               </div>

                               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                   {currentCountry === 'BR' ? 'Seu contato recebe' : currentCountry === 'US' ? 'They receive' : 'Tu contacto recibe'}
                               </label>
                               <div className="flex justify-between items-center gap-2">
                                  <span className="text-3xl font-bold text-slate-900 break-all">
                                    {formatCurrency(result, targetCurr)}
                                  </span>
                                  <CurrencySelect value={targetCurr} onChange={setTargetCurr} />
                               </div>
                            </div>

                            {/* Breakdown - MAIN VIEW */}
                            <div className="space-y-4 mb-6 px-2 animate-in fade-in">
                                
                                {/* Row 1: Costo de envío */}
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-3">
                                         <div className="w-5 h-5 rounded-full bg-[#4ADE80] text-white flex items-center justify-center shadow-sm">
                                            <Minus size={12} strokeWidth={3} />
                                         </div>
                                         <span className="text-[#4ADE80] font-medium">
                                             {currentCountry === 'BR' ? 'Custo de envio' : currentCountry === 'US' ? 'Fee' : 'Costo de envío'}:
                                         </span>
                                    </div>
                                    <span className="font-bold text-slate-800">
                                        {formatCurrency(fee, sourceCurr)} {sourceCurr}
                                    </span>
                                </div>

                                {/* Row 2: Monto a convertir */}
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-3">
                                         <div className="w-5 h-5 rounded-full bg-[#4ADE80] text-white flex items-center justify-center shadow-sm">
                                            <Equal size={12} strokeWidth={3} />
                                         </div>
                                         <span className="text-slate-500 font-medium">
                                             {currentCountry === 'BR' ? 'Valor a converter' : currentCountry === 'US' ? 'Amount to convert' : 'Monto a convertir'}:
                                         </span>
                                    </div>
                                    <span className="font-bold text-slate-800">
                                        {formatCurrency(amountToConvert, sourceCurr)} {sourceCurr}
                                    </span>
                                </div>

                                {/* Row 3: Tipo de cambio */}
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-3">
                                         <div className="w-5 h-5 rounded-full bg-[#4ADE80] text-white flex items-center justify-center shadow-sm">
                                            <div className="font-serif font-bold text-xs">÷</div>
                                         </div>
                                         <span className="text-slate-500 font-medium">
                                             {currentCountry === 'BR' ? 'Câmbio comercial' : currentCountry === 'US' ? 'Exchange rate' : 'Tipo de cambio'}:
                                         </span>
                                    </div>
                                    <span className="font-bold text-slate-800">
                                        1 {sourceCurr} = {rate > 0 ? formatCurrency(rate, targetCurr) : '---'} {targetCurr}
                                    </span>
                                </div>

                                {/* Etiqueta de fuente: 'Tasa en vivo · FastForex' / 'Tasa manual' + refresh hint */}
                                {rateProviderLabel && (
                                    <div className="flex items-center justify-between text-[10px] text-slate-500 pl-8 -mt-2">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className={`w-1.5 h-1.5 rounded-full ${rateProvider === 'MANUAL' ? 'bg-slate-400' : 'bg-[#4ADE80] animate-pulse'}`} />
                                            {rateProviderLabel}
                                        </span>
                                        <span className="opacity-70">{rateRefreshHint}</span>
                                    </div>
                                )}

                                <div className="flex justify-center pt-2">
                                  <button 
                                    onClick={() => setShowDetails(true)}
                                    className="text-[#4ADE80] text-sm font-medium hover:underline flex items-center gap-1"
                                  >
                                    {currentCountry === 'BR' ? 'Ver detalhes' : currentCountry === 'US' ? 'View details' : 'Ver detalle completo'} <ChevronDown size={16} />
                                  </button>
                                </div>
                            </div>

                            {/* Info Box */}
                            <div className="bg-[#F0FFFE] rounded-xl p-3 flex items-start gap-3 mb-6">
                                <div className="bg-white p-1 rounded-full text-slate-700 shrink-0">
                                    <Clock size={14} />
                                </div>
                                <span className="text-xs text-slate-700">
                                    {currentCountry === 'BR' 
                                        ? <>Seu dinheiro deve chegar em <span className="font-bold">{getDeliveryDate()}</span></>
                                        : currentCountry === 'US' 
                                        ? <>Money should arrive by <span className="font-bold">{getDeliveryDate()}</span></>
                                        : <>Tu dinero debería llegar el <span className="font-bold">{getDeliveryDate()}</span></>
                                    }
                                </span>
                            </div>

                            {/* Main CTA */}
                            <button onClick={onLoginClick} className="w-full bg-[#4ADE80] text-white font-bold py-4 rounded-xl hover:bg-[#22C55E] transition-colors shadow-lg shadow-green-500/30 text-lg btn-shine">
                                {currentCountry === 'BR' ? 'Enviar dinheiro agora' : currentCountry === 'US' ? 'Send money now' : 'Enviar dinero ahora'}
                            </button>
                            
                            {/* Security Footer */}
                            <div className="text-center mt-5 flex items-center justify-center gap-2 text-[10px] text-slate-400 font-medium">
                                <div className="w-1.5 h-1.5 bg-slate-300 rounded-full"></div>
                                {currentCountry === 'BR' ? 'Sistema de envios seguros' : currentCountry === 'US' ? 'Secure transfer system' : 'Sistema de envíos seguros'}
                            </div>
                        </div>
                    )}
                </div>
             </div>
          </section>

          {/* NEW BENEFITS SECTION */}
          {segment === 'business' && (
          <section className="py-16 bg-[#0F172A] border-b border-white/5">
             <div className="max-w-7xl mx-auto px-4">
                 <div className="text-center mb-12 reveal">
                     <h2 className="text-3xl font-bold text-white mb-4">
                         {currentCountry === 'BR' ? 'Potencialize sua empresa com benefícios exclusivos' : currentCountry === 'US' ? 'Empower your business with unique benefits' : 'Potencia tu empresa con beneficios únicos'}
                     </h2>
                     <p className="text-white/50 max-w-2xl mx-auto">
                         {currentCountry === 'BR' ? 'Ferramentas financeiras de classe mundial para escalar seu negócio sem fronteiras.' : currentCountry === 'US' ? 'World-class financial tools to scale your business without borders.' : 'Herramientas financieras de clase mundial para escalar tu negocio sin fronteras.'}
                     </p>
                 </div>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                     <div className="reveal delay-100"><BenefitItem icon={Users} title={currentCountry === 'US' ? "Multi-user Management" : "Gestión Multi-usuario"} desc={currentCountry === 'US' ? "Assign roles and permissions to your finance team." : "Asigna roles y permisos a tu equipo de finanzas."} /></div>
                     <div className="reveal delay-200"><BenefitItem icon={Zap} title={currentCountry === 'US' ? "Bulk Payments" : "Pagos Masivos"} desc={currentCountry === 'US' ? "Disperse payroll and suppliers in a single click." : "Dispersa nóminas y proveedores en un solo clic."} /></div>
                     <div className="reveal delay-300"><BenefitItem icon={Code} title={currentCountry === 'US' ? "Integrated API" : "API Integrada"} desc={currentCountry === 'US' ? "Connect your ERP or accounting software easily." : "Conecta tu ERP o software contable fácilmente."} /></div>
                     <div className="reveal delay-400"><BenefitItem icon={FileText} title={currentCountry === 'US' ? "Local Invoicing" : "Facturación Local"} desc={currentCountry === 'US' ? "Get deductible invoices in your country." : "Obtén facturas deducibles en tu país."} /></div>
                 </div>
             </div>
          </section>
          )}

          {/* Industries / Features Section - Context Aware */}
          <section className="bg-[#0F172A] py-16 md:py-24 text-white relative">
              <div className="max-w-7xl mx-auto px-4 text-center">
                  {segment === 'business' ? (
                      <>
                        <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white reveal">
                            {currentCountry === 'BR' ? 'Pertence a alguma' : currentCountry === 'US' ? 'Do you belong to' : '¿Perteneces a alguna de'} <br/>
                            <span className="text-[#4ADE80]">{currentCountry === 'BR' ? 'dessas indústrias?' : currentCountry === 'US' ? 'these industries?' : 'estas industrias?'}</span>
                        </h2>
                        <p className="text-white/50 max-w-2xl mx-auto mb-16 text-lg">
                            {content.texts.featuresSubtitle}
                        </p>
                        {/* Industries Slider/Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 mb-20 relative animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <IndustryItem icon={BookOpen} label={currentCountry === 'US' ? 'Education' : "Educación"} color="text-red-500" logo="exxema" />
                            <IndustryItem icon={Cpu} label={currentCountry === 'US' ? 'Tech' : "Tecnología"} color="text-red-400" logo="ROCKETBOT" />
                            <IndustryItem icon={Briefcase} label={currentCountry === 'US' ? 'Consulting' : "Consultoría"} color="text-[#4ADE80]" logo="Phylolegal" />
                            <IndustryItem icon={Megaphone} label="Marketing" color="text-green-500" logo="greenti" />
                            <IndustryItem icon={Monitor} label="Fintech" color="text-purple-500" logo="latamfintech" />
                            <IndustryItem icon={Ticket} label={currentCountry === 'US' ? 'Entertainment' : "Entretenimiento"} color="text-orange-500" logo="ticketplus" />
                        </div>
                      </>
                  ) : (
                      <>
                        <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
                            {content.texts.featuresTitle} {seasonEmoji}
                        </h2>
                        <p className="text-white/50 max-w-2xl mx-auto mb-16 text-lg">
                            {currentCountry === 'BR' 
                                ? 'Esqueça as fronteiras. Gerencie seu dinheiro como um local em qualquer lugar do mundo.'
                                : currentCountry === 'US'
                                ? 'Forget borders. Manage your money like a local anywhere in the world.'
                                : 'Olvídate de las fronteras. Maneja tu dinero como un local en cualquier parte del mundo.'
                            }
                        </p>
                        {/* Personal Features Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <FeatureCard
                                icon={Globe2}
                                iconTint="cyan"
                                title={currentCountry === 'BR' ? 'Envios Globais' : currentCountry === 'US' ? 'Global Transfers' : 'Envíos Globales'}
                                desc={currentCountry === 'BR' ? 'Envie dinheiro para mais de 65 países.' : currentCountry === 'US' ? 'Send money to over 65 countries.' : 'Envía dinero a más de 65 países con la mejor tasa del mercado.'}
                            />
                            <FeatureCard
                                icon={CreditCard}
                                iconTint="emerald"
                                title={currentCountry === 'BR' ? 'Cartão Global' : currentCountry === 'US' ? 'Global Card' : 'Tarjeta Global'}
                                desc={currentCountry === 'BR' ? 'Pague em qualquer lugar com seu cartão.' : currentCountry === 'US' ? 'Pay anywhere with your card.' : 'Paga en cualquier lugar con tu tarjeta física o virtual.'}
                            />
                            <FeatureCard
                                icon={ArrowRightLeft}
                                iconTint="violet"
                                title={currentCountry === 'BR' ? 'Câmbio Real' : currentCountry === 'US' ? 'Real Exchange' : 'Cambio Real'}
                                desc={currentCountry === 'BR' ? 'Converta moedas instantaneamente.' : currentCountry === 'US' ? 'Convert currencies instantly.' : 'Convierte divisas al instante y sin comisiones ocultas.'}
                            />
                        </div>
                      </>
                  )}
              </div>
          </section>

          {/* Footer */}
          <footer className="bg-[#0F172A] text-white pt-20 pb-10 border-t border-white/5" style={{ backgroundColor: config.themeColor }}>
              <div className="max-w-7xl mx-auto px-4 md:px-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
                      {/* Column 1: Brand */}
                      <div className="space-y-6">
                          <div className="scale-90 origin-left">
                              <Logo variant="white" />
                          </div>
                          <p className="text-slate-300 text-sm leading-relaxed">
                              Envía y recibe pagos de manera rápida, segura y confiable entre países como Colombia, Chile, Perú, México y Brasil.
                          </p>
                          <div className="flex gap-4">
                              <a href={siteLinks.link_facebook || '#'} target={siteLinks.link_facebook ? '_blank' : undefined} rel="noreferrer" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#4ADE80] hover:text-[#0F172A] transition-colors"><Facebook size={16} /></a>
                              <a href={siteLinks.link_linkedin || '#'} target={siteLinks.link_linkedin ? '_blank' : undefined} rel="noreferrer" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#4ADE80] hover:text-[#0F172A] transition-colors"><Linkedin size={16} /></a>
                              <a href={siteLinks.link_instagram || '#'} target={siteLinks.link_instagram ? '_blank' : undefined} rel="noreferrer" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#4ADE80] hover:text-[#0F172A] transition-colors"><Instagram size={16} /></a>
                          </div>
                      </div>

                      {/* Column 2: Enlaces rápidos */}
                      <div>
                          <h4 className="font-bold text-lg mb-6">Enlaces rápidos:</h4>
                          <ul className="space-y-3 text-sm text-slate-300">
                              <li><button onClick={() => openQuickLink('link_blog', 'blog')} className="hover:text-[#4ADE80] transition-colors text-left">Blog</button></li>
                              <li><button onClick={() => openQuickLink('link_support', 'support')} className="hover:text-[#4ADE80] transition-colors text-left">Soporte</button></li>
                              <li><button onClick={() => openQuickLink('link_about', 'about')} className="hover:text-[#4ADE80] transition-colors text-left">Acerca de Nosotros</button></li>
                          </ul>
                      </div>

                      {/* Column 3: Disclaimer legal */}
                      <div>
                          <h4 className="font-bold text-lg mb-6">Disclaimer legal:</h4>
                          <p className="text-xs text-slate-400 italic mb-6">
                              “LINCOIN opera bajo estrictos estándares regulatorios.”
                          </p>
                          <ul className="space-y-3 text-sm text-slate-300">
                              <li><button onClick={() => onNavigateTo('privacy')} className="hover:text-[#4ADE80] transition-colors text-left">Tratamiento de datos</button></li>
                              <li><button onClick={() => onNavigateTo('terms')} className="hover:text-[#4ADE80] transition-colors text-left">Términos y Condiciones</button></li>
                              <li><button onClick={() => onNavigateTo('contact')} className="hover:text-[#4ADE80] transition-colors text-left">Contacta con Nosotros</button></li>
                              <li><button onClick={() => onNavigateTo('shipping')} className="hover:text-[#4ADE80] transition-colors text-left">Solicitud de Envíos</button></li>
                              <li><button onClick={() => onNavigateTo('collection')} className="hover:text-[#4ADE80] transition-colors text-left">Solicitud de Cobro</button></li>
                              <li><button onClick={() => onNavigateTo('sagrilaft')} className="hover:text-[#4ADE80] transition-colors text-left">Política Sagrilaft</button></li>
                          </ul>
                      </div>

                      {/* Column 4: ¿Necesitas ayuda? */}
                      <div>
                          <h4 className="font-bold text-lg mb-6">¿Necesitas ayuda?</h4>
                          <p className="text-xs text-slate-400 italic mb-6">
                              “Tu Socio Financiero en América Latina y el Mundo”
                          </p>
                          <ul className="space-y-3 text-sm text-slate-300">
                              <li><button onClick={openCalendly} className="hover:text-[#4ADE80] transition-colors text-left">Habla con un Especialista</button></li>
                              <li><button onClick={openCalendly} className="hover:text-[#4ADE80] transition-colors text-left">Solicita una Demo</button></li>
                          </ul>
                      </div>
                  </div>

                  {/* Separator */}
                  <div className="h-px bg-white/10 w-full mb-10"></div>

                  {/* Bottom CTA — abre el modal de contacto (correo + reunión) */}
                  <div className="text-center mb-16">
                      <p className="text-white mb-4">¿Te gustaría aliarse con nosotros, invitarnos a ferias o eventos, o incluso colaborar en la creación de un artículo?</p>
                      <button onClick={() => setContactOpen(true)} className="inline-flex items-center gap-2 font-bold hover:text-[#4ADE80] transition-colors">
                          Contáctanos aquí <ArrowRight size={16} />
                      </button>
                  </div>

                  {/* Modal de contacto */}
                  {contactOpen && (
                      <div
                          className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4"
                          onClick={() => setContactOpen(false)}
                      >
                          <div
                              className="bg-[#0F172A] border border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-8 text-center relative"
                              onClick={e => e.stopPropagation()}
                          >
                              <button
                                  onClick={() => setContactOpen(false)}
                                  className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 text-slate-400"
                              >
                                  <XIcon size={18} />
                              </button>
                              <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: 'rgba(45,212,191,0.15)' }}>
                                  <Handshake size={26} className="text-[#4ADE80]" />
                              </div>
                              <h3 className="text-white text-xl font-bold mb-2">Hablemos</h3>
                              <p className="text-slate-400 text-sm mb-6">
                                  Escribinos o agendá una reunión con el equipo de Lincoin.
                              </p>
                              <div className="space-y-3">
                                  <a
                                      href={`mailto:${supportEmail}`}
                                      className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-semibold hover:border-[#4ADE80] transition-colors"
                                  >
                                      <Send size={15} className="text-[#4ADE80]" /> {supportEmail}
                                  </a>
                                  <button
                                      onClick={() => { setContactOpen(false); openCalendly(); }}
                                      className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold transition-colors"
                                      style={{ backgroundColor: '#4ADE80', color: '#0F172A' }}
                                  >
                                      <Clock size={15} /> Agendar una reunión
                                  </button>
                              </div>
                          </div>
                      </div>
                  )}

                  {/* Copyright */}
                  <div className="text-center text-xs text-slate-500">
                      © Copyright LINCOIN, All right reserved.
                  </div>
              </div>
          </footer>
        </>
      )}

      {landingView === 'referrals' && (
          <div className="pt-20 min-h-screen bg-slate-50 text-slate-900">
              <div className="max-w-4xl mx-auto px-4 py-16 text-center">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600">
                      <Gift size={40} />
                  </div>
                  <h1 className="text-4xl font-bold text-[#0F172A] mb-4">Invita y Gana</h1>
                  <p className="text-lg text-slate-500 mb-8">Gana $20 USD por cada amigo que invites y opere $1,000 USD.</p>
                  <button onClick={() => setLandingView('home')} className="text-[#0F172A] font-bold hover:underline">Volver al inicio</button>
              </div>
          </div>
      )}

      {landingView === 'affiliates' && (
          <div className="pt-20 min-h-screen bg-slate-50 text-slate-900">
              <div className="max-w-4xl mx-auto px-4 py-16 text-center">
                  <div className="w-20 h-20 bg-[#F0FFFE] rounded-full flex items-center justify-center mx-auto mb-6 text-[#4ADE80]">
                      <Megaphone size={40} />
                  </div>
                  <h1 className="text-4xl font-bold text-[#0F172A] mb-4">Programa de Aliados</h1>
                  <p className="text-lg text-slate-500 mb-8">Únete a nuestra red de partners y obtén beneficios exclusivos.</p>
                  <button onClick={() => setLandingView('home')} className="text-[#0F172A] font-bold hover:underline">Volver al inicio</button>
              </div>
          </div>
      )}

    </div>
  );
};