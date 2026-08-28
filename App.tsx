import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { EmailConfirmation } from './components/EmailConfirmation';
import { OnboardingIntro } from './components/OnboardingIntro';
import { OnboardingWizard } from './components/OnboardingWizard';
import { PersonalOnboardingWizard } from './components/PersonalOnboardingWizard';
import { LandingPage } from './components/LandingPage';
import { RoleSelection } from './components/RoleSelection';
import { DownloadAppModal } from './components/DownloadAppModal';
import { PersonalDashboard } from './components/PersonalDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { ToastProvider } from './components/AdminPersonas/lib/toast';
import { StaticPage } from './components/StaticPage'; // New Import
import { LogoConcepts } from './components/LogoConcepts';
import { useDatabase } from './context/DatabaseContext';
import { useSystemConfig } from './context/SystemConfigContext';
import { useTheme } from './context/ThemeContext';
import { isSupabaseConfigured } from './lib/supabaseClient';
import { X, WifiOff } from 'lucide-react';

// Added 'static-page' to ViewState
type ViewState = 'landing' | 'role-selection' | 'login' | 'register' | 'confirmation' | 'onboarding-intro' | 'onboarding-wizard' | 'personal-onboarding-wizard' | 'dashboard' | 'personal-dashboard' | 'admin-dashboard' | 'static-page';
type UserRole = 'business' | 'personal' | 'admin';

const LEGACY_BLUES = ['#2563eb', '#1d4ed8', '#3b82f6', '#60a5fa', '#0ea5e9', '#06b6d4', '#7dd3fc', '#4f46e5', '#4b9fe1', '#1e40af'];

const ThemeInjector: React.FC = () => {
    const { config } = useSystemConfig();
    const { isDarkMode } = useTheme();

    const rawAccent = (config.accentColor || '').toLowerCase();
    const accentColor = LEGACY_BLUES.includes(rawAccent) ? '#4ADE80' : (config.accentColor || '#4ADE80');
    const bgColor = isDarkMode ? config.themeColor : '#FFFFFF';

    return (
        <style>{`
            :root {
                --primary-color: ${config.themeColor};
                --accent-color: ${accentColor};
            }

            /* Only change page background based on light/dark mode */
            body {
                background-color: ${bgColor} !important;
            }

            /* Smooth transition so Supabase color updates don't flash (but not for animated elements) */
            *:not([class*="anim-"]):not([class*="reveal"]):not(.hover-lift) { transition: background-color 0.4s ease, color 0.4s ease, border-color 0.4s ease; }
            input:not([class*="anim-"]):not([class*="reveal"]), button:not([class*="anim-"]):not([class*="reveal"]), a:not([class*="anim-"]):not([class*="reveal"]) { transition: background-color 0.2s ease, color 0.2s ease, opacity 0.2s ease; }

            /* In dark mode: only text directly on dark backgrounds → white.
               Text inside white/light cards (bg-white, rounded cards) stays dark automatically. */
            ${isDarkMode ? `
                .text-slate-400, .text-slate-500, .text-slate-600 { color: #E2E8F0 !important; }
                .text-gray-400, .text-gray-500, .text-gray-600 { color: #E2E8F0 !important; }

                /* BUT inside white cards, restore dark text */
                .bg-white .text-slate-400, .bg-white .text-slate-500, .bg-white .text-slate-600,
                .bg-white .text-gray-400, .bg-white .text-gray-500, .bg-white .text-gray-600 { color: #475569 !important; }
                .bg-white .text-slate-700, .bg-white .text-slate-800, .bg-white .text-slate-900 { color: #0F172A !important; }
                .bg-white .text-white { color: #0F172A !important; }

                [class*="bg-white"] p, [class*="bg-white"] span, [class*="bg-white"] div { color: inherit; }
            ` : ''}

            /* Override hardcoded Tailwind classes for dynamic theming */
            .bg-\\[\\#0F172A\\] { background-color: var(--primary-color) !important; }
            .text-\\[\\#0F172A\\] { color: var(--primary-color) !important; }
            .border-\\[\\#0F172A\\] { border-color: var(--primary-color) !important; }

            /* Mapping Accent Color - replace all blues with teal */
            .bg-\\[\\#2563EB\\],
            .bg-blue-400, .bg-blue-500, .bg-blue-600,
            .bg-sky-400, .bg-sky-500,
            .bg-green-400, .bg-green-500 { background-color: var(--accent-color) !important; }

            .text-\\[\\#2563EB\\],
            .text-blue-400, .text-blue-500, .text-blue-600,
            .text-sky-400, .text-sky-500,
            .text-green-400, .text-green-500 { color: var(--accent-color) !important; }

            .border-\\[\\#2563EB\\],
            .border-blue-400, .border-blue-500,
            .border-sky-400, .border-sky-500 { border-color: var(--accent-color) !important; }

            .bg-\\[\\#4ADE80\\] { background-color: var(--accent-color) !important; }
            .text-\\[\\#4ADE80\\] { color: var(--accent-color) !important; }
            .border-\\[\\#4ADE80\\] { border-color: var(--accent-color) !important; }

            /* Fill and stroke for SVG icons */
            [fill="#2563EB"], [fill="#60a5fa"], [fill="#3b82f6"], [fill="#0ea5e9"] { fill: var(--accent-color) !important; }
            [stroke="#2563EB"], [stroke="#60a5fa"], [stroke="#3b82f6"], [stroke="#0ea5e9"] { stroke: var(--accent-color) !important; }

            /* SVG elements inside elements with text-sky/blue classes */
            .text-sky-500 svg, .text-blue-500 svg { color: var(--accent-color) !important; }
            .text-sky-500, .text-blue-500 { color: var(--accent-color) !important; }

            /* Replace light blue backgrounds with green-tinted light background */
            .bg-\\[\\#EBF2FA\\],
            [style*="background:#EBF2FA"],
            [style*="backgroundColor:#EBF2FA"],
            [style*="background: #EBF2FA"],
            [style*="backgroundColor: #EBF2FA"] {
                background-color: ${isDarkMode ? '#EBF2FA' : '#E0F2FE'} !important;
            }

            /* Light mode: elements that were white-on-dark need to flip */
            ${!isDarkMode ? `
                .text-white { color: #0F172A !important; }
                .text-white\\/50 { color: #64748B !important; }
                .text-white\\/70, .text-white\\/90 { color: #334155 !important; }
                .border-white\\/10, .border-white\\/20 { border-color: #E2E8F0 !important; }
                .bg-white\\/10, .bg-white\\/20 { background-color: #F1F5F9 !important; }
            ` : ''}
        `}</style>
    );
};

const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const isSafeImageSrc = (url: string): boolean => {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  return isSafeUrl(url);
};

// Splash con el logo de MARCA actual (mismo del favicon y los correos:
// cuadro navy + marco teal + punto). Animación: el marco teal se dibuja
// solo (stroke-dash), el punto hace "pop" al completarse y el logo entero
// respira suavemente. Sin rotaciones — el logo nunca se deforma.
const SPLASH_CSS = `
  @keyframes splashDraw { 0%{stroke-dashoffset:100} 55%{stroke-dashoffset:0} 100%{stroke-dashoffset:0} }
  @keyframes splashDot { 0%,55%{opacity:0;transform:scale(0.3)} 68%{opacity:1;transform:scale(1.25)} 78%,100%{opacity:1;transform:scale(1)} }
  @keyframes splashBreath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
  .splash-logo { animation:splashBreath 2.6s ease-in-out infinite; }
  .splash-frame { stroke-dasharray:100; animation:splashDraw 2.6s ease-in-out infinite; }
  .splash-dot { animation:splashDot 2.6s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  @keyframes splashFade { 0%,100%{opacity:0.35} 50%{opacity:1} }
  .splash-dots span { animation:splashFade 1.4s ease-in-out infinite; }
  .splash-dots span:nth-child(2) { animation-delay:0.2s; }
  .splash-dots span:nth-child(3) { animation-delay:0.4s; }
`;

const SplashScreen: React.FC = () => (
  <div style={{ background: '#0F172A' }} className="fixed inset-0 flex flex-col items-center justify-center gap-7">
    <style>{SPLASH_CSS}</style>
    <svg className="splash-logo" width="96" height="96" viewBox="0 0 100 100" fill="none" style={{ filter: 'drop-shadow(0 8px 32px rgba(74,222,128,0.25))' }}>
      <rect x="2" y="2" width="96" height="96" rx="24" fill="#0a0a0a"/>
      <path d="M34 30 H47 V58 H58 V71 H34 Z" fill="#F4F4F2"/>
      <circle className="splash-dot" cx="68" cy="67" r="10" fill="#4ADE80"/>
    </svg>
    <div className="text-center">
      <p className="text-white font-black text-3xl tracking-tight" style={{ letterSpacing: '-0.5px' }}>
        Lincoin<span style={{ color: '#4ADE80' }}>.</span>
      </p>
      <p className="text-white/30 text-xs font-medium mt-1 tracking-widest uppercase">Verificando sesión</p>
    </div>
    <div className="splash-dots flex gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] inline-block"/>
      <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] inline-block"/>
      <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] inline-block"/>
    </div>
  </div>
);

const App: React.FC = () => {
  // Nota: el routing de /admin-personas Y /admin-empresas se maneja en
  // index.tsx (apps aisladas con su propio login) — acá solo llega el
  // flujo de clientes.
  const [currentView, setCurrentView] = useState<ViewState>('landing');
  const [staticPageKey, setStaticPageKey] = useState<string>('privacy'); // State for static page content
  const [email, setEmail] = useState('');
  const [showDashboardBanner, setShowDashboardBanner] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('business');
  
  // Marketing Modal State
  const [showMarketingModal, setShowMarketingModal] = useState(false);
  const [showPersonalDownloadModal, setShowPersonalDownloadModal] = useState(false);

  const { currentUser, isAuthLoading, logoutUser } = useDatabase();
  const { config } = useSystemConfig();
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const INACTIVE_LOGOUT_MS = 5 * 60 * 1000;   // 5 minutes
  const INACTIVE_WARNING_MS = 4 * 60 * 1000;   // warn at 4 minutes

  const resetInactivityTimer = useCallback(() => {
    if (!currentUser) return;
    setInactivityWarning(false);
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    warningTimer.current = setTimeout(() => setInactivityWarning(true), INACTIVE_WARNING_MS);
    inactivityTimer.current = setTimeout(() => {
      logoutUser();
      setCurrentView('landing');
      setInactivityWarning(false);
    }, INACTIVE_LOGOUT_MS);
  }, [currentUser, logoutUser]);

  useEffect(() => {
    if (!currentUser) {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      if (warningTimer.current) clearTimeout(warningTimer.current);
      setInactivityWarning(false);
      return;
    }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetInactivityTimer, { passive: true }));
    resetInactivityTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetInactivityTimer));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      if (warningTimer.current) clearTimeout(warningTimer.current);
    };
  }, [currentUser, resetInactivityTimer]);

  // Restore Session Logic with Enhanced KYC Routing
  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === 'admin') {
        // Los admins NO usan la app de clientes: su portal es /admin-empresas
        // (con login propio). Cualquier sesión admin acá se redirige allá.
        window.location.replace('/admin-empresas');
        return;
      }

      // Check if we are currently in a registration flow to prevent premature redirection.
      const isInAuthFlow = ['register', 'confirmation', 'role-selection'].includes(currentView);
      
      if (currentUser.kycStatus === 'pending' || currentUser.kycStatus === 'in_progress' || currentUser.kycStatus === 'in_review' || currentUser.kycStatus === 'rejected') {
          // Both personal and business users go straight to their dashboard.
          // The KYC/KYB banner inside the dashboard handles verification.
          // Dashboard UNIFICADO: empresas y personas usan la misma vista
          // (personal-dashboard) — el badge BUSINESS distingue a las empresas.
          const safeViews = ['dashboard', 'personal-dashboard'];
          if (!safeViews.includes(currentView)) {
              setCurrentView('personal-dashboard');
          }
          return;
      }

      // Allow staying on static pages even if logged in, otherwise redirect to dashboard
      if ((currentView === 'landing' || currentView === 'login' || !isInAuthFlow) && currentView !== 'static-page') {
          // Dashboard unificado para personas y empresas
          setCurrentView('personal-dashboard');
      }
    } else if (!isAuthLoading) {
        // Only redirect if auth has fully settled (not in the middle of session restore)
        const protectedViews = ['dashboard', 'personal-dashboard', 'admin-dashboard', 'onboarding-wizard', 'onboarding-intro', 'personal-onboarding-wizard'];
        if (protectedViews.includes(currentView)) {
            const t = setTimeout(() => setCurrentView('landing'), 1500);
            return () => clearTimeout(t);
        }
    }
  }, [currentUser, isAuthLoading]);

  // Marketing Modal Logic
  useEffect(() => {
      if (config.marketingModal?.isActive && currentView === 'landing') {
          const timer = setTimeout(() => setShowMarketingModal(true), 1500);
          return () => clearTimeout(timer);
      } else {
          setShowMarketingModal(false);
      }
  }, [config.marketingModal?.isActive, currentView]);

  // Navigation handlers
  const navigateToRegister = (role?: UserRole) => {
    // Personal accounts only via mobile app — show download modal instead
    if (role === 'personal') {
        setShowPersonalDownloadModal(true);
        return;
    }
    if (role && role !== 'admin') setUserRole(role);

    if (currentUser) {
        logoutUser();
        setTimeout(() => setCurrentView('register'), 50);
    } else {
        setCurrentView('register');
    }
  };
  
  const navigateToLogin = () => setCurrentView('role-selection');
  
  const navigateToLanding = () => setCurrentView('landing');

  // Handler to navigate to static pages
  const navigateToStaticPage = (pageKey: string) => {
      setStaticPageKey(pageKey);
      setCurrentView('static-page');
      window.scrollTo(0, 0);
  };
  
  const handleBusinessSelected = () => {
    setUserRole('business');
    setCurrentView('login');
  };
  
  const handlePersonalSelected = () => {
    // Personal accounts only via mobile app — show download modal instead
    setShowPersonalDownloadModal(true);
  };

  const handleRegisterSuccess = (registeredEmail: string) => {
    setEmail(registeredEmail);
    setCurrentView('confirmation');
  };

  // Dashboard UNIFICADO: personas y empresas comparten personal-dashboard
  // (el badge BUSINESS distingue a las empresas). Solo admin va aparte.
  const handleLoginSuccess = (role?: UserRole) => {
    setShowDashboardBanner(false);
    if (role === 'admin') {
      // El login de clientes no abre el panel admin: portal dedicado.
      window.location.replace('/admin-empresas');
      return;
    }
    setCurrentView('personal-dashboard');
  };

  const handleEmailValidated = () => {
    setCurrentView('personal-dashboard');
  };

  const handleIntroContinue = () => {
    setCurrentView('onboarding-wizard');
  };

  const handleOnboardingComplete = () => {
    setShowDashboardBanner(true);
    // Dashboard unificado para todos los roles no-admin
    setCurrentView('personal-dashboard');
  };

  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logoutUser();
    setLoggingOut(false);
    setCurrentView('landing');
  };

  // View Routing
  const renderView = () => {
      switch (currentView) {
        case 'landing':
          return (
            <LandingPage 
              onLoginClick={navigateToLogin}
              onRegisterClick={(role) => navigateToRegister(role || 'personal')}
              onNavigateTo={navigateToStaticPage} // Pass navigation handler
            />
          );
        case 'static-page':
          return (
            <StaticPage 
              pageKey={staticPageKey}
              onBack={navigateToLanding}
            />
          );
        case 'role-selection':
          return (
            <>
              <LandingPage 
                 onLoginClick={() => {}} 
                 onRegisterClick={() => {}} 
                 onNavigateTo={() => {}} // Dummy prop for overlay background
              />
              <RoleSelection 
                 onSelectBusiness={handleBusinessSelected}
                 onSelectPersonal={handlePersonalSelected}
                 onClose={navigateToLanding}
              />
            </>
          );
        case 'login':
          return (
            <Login 
              userRole={userRole !== 'admin' ? userRole : 'business'}
              onRegisterClick={() => navigateToRegister(userRole !== 'admin' ? userRole : 'business')} 
              onLoginSuccess={handleLoginSuccess}
              onBack={navigateToLanding}
            />
          );
        case 'register':
          return (
            <Register 
              userRole={userRole !== 'admin' ? userRole : 'business'}
              onSuccess={handleRegisterSuccess} 
              onLoginClick={navigateToLogin}
              onBack={navigateToLanding}
            />
          );
        case 'confirmation':
          return (
            <EmailConfirmation 
              email={email}
              onValidated={handleEmailValidated}
              onBack={() => navigateToRegister(userRole !== 'admin' ? userRole : 'business')}
            />
          );
        case 'onboarding-intro':
          return (
            <OnboardingIntro 
              onContinue={handleIntroContinue} 
            />
          );
        case 'onboarding-wizard':
            return (
                <OnboardingWizard onFinish={handleOnboardingComplete} />
            );
        case 'personal-onboarding-wizard':
            return (
                <PersonalOnboardingWizard onFinish={handleOnboardingComplete} />
            );
        case 'dashboard':
            return (
                <Dashboard onLogout={handleLogout} showSuccessBanner={showDashboardBanner} />
            );
        case 'personal-dashboard':
            return (
                <PersonalDashboard onLogout={handleLogout} />
            );
        case 'admin-dashboard':
            return (
                <ToastProvider>
                    <AdminDashboard onLogout={handleLogout} />
                </ToastProvider>
            );
        default:
            return <div>View not found</div>;
      }
  };

  if (window.location.pathname === '/logos') return <LogoConcepts />;

  // Show branded splash while auth loads OR while transitioning from landing → dashboard
  if (isAuthLoading || (currentUser && currentView === 'landing')) {
    return <SplashScreen />;
  }

  return (
      <>
        <ThemeInjector />
        {renderView()}

        {/* LOGOUT OVERLAY */}
        {loggingOut && (
          <div className="fixed inset-0 z-[9999] bg-[#0F172A]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin"/>
            <p className="text-white font-semibold text-lg tracking-tight">Cerrando sesión...</p>
          </div>
        )}

        {/* INACTIVITY WARNING BANNER */}
        {inactivityWarning && currentUser && (
          <div className="fixed bottom-0 left-0 right-0 z-[200] bg-amber-500 text-white text-sm text-center py-3 px-4 flex items-center justify-center gap-3 shadow-lg">
            <span>⚠️ Tu sesión se cerrará en 1 minuto por inactividad.</span>
            <button onClick={resetInactivityTimer} className="bg-white text-amber-600 font-bold px-3 py-1 rounded-lg text-xs hover:bg-amber-50 transition-colors">
              Continuar sesión
            </button>
          </div>
        )}

        {/* OFFLINE MODE BANNER — shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set */}
        {!isSupabaseConfigured && (
          <div className="fixed bottom-0 left-0 right-0 z-[200] bg-amber-500 text-white text-xs text-center py-2 px-4 flex items-center justify-center gap-2">
            <WifiOff size={14} />
            <span>Modo offline — las variables de entorno de Supabase no están configuradas. Las transacciones solo se guardan localmente.</span>
          </div>
        )}

        {/* DOWNLOAD APP MODAL — when user tries to access Personas via web */}
        {showPersonalDownloadModal && (
            <DownloadAppModal onClose={() => setShowPersonalDownloadModal(false)} />
        )}

        {/* GLOBAL MARKETING MODAL */}
        {showMarketingModal && config.marketingModal?.isActive && (
            <div
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
                onClick={() => setShowMarketingModal(false)}
            >
                <div
                    className="relative rounded-2xl overflow-hidden shadow-2xl max-w-lg w-full animate-in zoom-in-95 duration-300"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Close button — always on top with dark background so it's always visible */}
                    <button
                        onClick={() => setShowMarketingModal(false)}
                        className="absolute top-3 right-3 bg-black/60 hover:bg-black text-white rounded-full p-1.5 z-20 transition-colors shadow-lg"
                        aria-label="Cerrar"
                    >
                        <X size={18}/>
                    </button>
                    <a
                        href={isSafeUrl(config.marketingModal.linkUrl) ? config.marketingModal.linkUrl : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block cursor-pointer"
                    >
                        <img
                            src={isSafeImageSrc(config.marketingModal.imageUrl) ? config.marketingModal.imageUrl : ''}
                            alt="Promo"
                            className="w-full h-auto object-cover max-h-[80vh] block"
                        />
                    </a>
                </div>
            </div>
        )}
      </>
  );
};

export default App;