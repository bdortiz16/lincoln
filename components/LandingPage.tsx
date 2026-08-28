import React, { useEffect, useRef } from 'react';
import { LANDING_HTML } from './landingHtml';

interface LandingPageProps {
  onLoginClick: () => void;
  onRegisterClick: (role?: 'business' | 'personal') => void;
  onNavigateTo: (pageKey: string) => void;
}

// Landing oficial de Lincoin (Lincoin Landing v2 — "Dinero fuerte, fronteras cero").
// El HTML del diseño se inyecta tal cual y los botones "Ingresar" / "Crear cuenta"
// (data-open) se conectan al flujo del app: selección Personas / Empresas → login.
export const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const goToAuth = (e: Event) => {
      e.preventDefault();
      onLoginClick(); // abre la selección Personas / Empresas (role-selection)
    };
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-open]'));
    nodes.forEach((n) => n.addEventListener('click', goToAuth));
    return () => nodes.forEach((n) => n.removeEventListener('click', goToAuth));
  }, [onLoginClick]);

  return (
    <div
      ref={ref}
      className="lincoin-landing-root"
      dangerouslySetInnerHTML={{ __html: LANDING_HTML }}
    />
  );
};
