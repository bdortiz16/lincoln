import React, { useEffect, useRef } from 'react';
import { LANDING_HTML } from './landingHtml';

interface LandingPageProps {
  onLoginClick: () => void;
  onRegisterClick: (role?: 'business' | 'personal') => void;
  onNavigateTo: (pageKey: string) => void;
}

// La fuente ya la carga index.html (sin bloquear). El @import de la landing
// la volvía a pedir cada vez que se pintaba la página.
const LANDING_HTML_SIN_IMPORT = LANDING_HTML.replace(/@import url\([^)]*\);?/g, '');
// El OBJETO va fijo, fuera del componente. React 19 vuelve a escribir el
// innerHTML entero cada vez que recibe un objeto nuevo (no compara el texto):
// en cada render del padre la página se reescribía — se borraba el conversor
// mientras la persona tecleaba y parpadeaba al iniciar.
const LANDING_INNER = { __html: LANDING_HTML_SIN_IMPORT };

// ── Arreglos de ancho en celular + animaciones ──
// Ancho: el panel del hero y la franja de confianza (dos columnas de 212 px)
// eran más anchos que la pantalla de un celular: el texto quedaba cortado a
// la derecha y la página se corría de lado.
// Animaciones: solo opacidad y transform (las baratas para el teléfono), y
// nada si la persona pidió reducir el movimiento.
const LANDING_EXTRA_CSS = `
.lincoin-landing-root { overflow-x: clip; }
.lincoin-landing-root .hero-grid > *, .lincoin-landing-root .trust-grid > *, .lincoin-landing-root .sec-grid > *,
.lincoin-landing-root .faq-grid > *, .lincoin-landing-root .foot-grid > *, .lincoin-landing-root .testi-grid > * { min-width: 0; }
.lincoin-landing-root .hero-art { max-width: 100%; }
@media (max-width: 520px) {
  .lincoin-landing-root .trust-grid { grid-template-columns: 1fr !important; }
  .lincoin-landing-root .trust-grid > div { border-right: none !important; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .lincoin-landing-root nav { display: none !important; }
  .lincoin-landing-root header button { white-space: nowrap; padding: 10px 14px !important; }
}

@keyframes lcUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes lcPulse { 0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.55); } 70% { box-shadow: 0 0 0 7px rgba(74,222,128,0); } 100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); } }
@keyframes lcFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes lcGlow { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }

.lincoin-landing-root.lc-js .lc-up { opacity: 0; animation: lcUp 0.7s cubic-bezier(.2,.7,.2,1) forwards; animation-delay: var(--d, 0ms); }
.lincoin-landing-root.lc-js .lc-reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s cubic-bezier(.2,.7,.2,1); transition-delay: var(--d, 0ms); }
.lincoin-landing-root.lc-js .lc-reveal.lc-in { opacity: 1; transform: none; }
.lincoin-landing-root .lc-pulse { animation: lcPulse 2.2s ease-out infinite; }
.lincoin-landing-root .lc-float { animation: lcFloat 6s ease-in-out infinite; }
.lincoin-landing-root .lc-glow { animation: lcGlow 5s ease-in-out infinite; }
.lincoin-landing-root button, .lincoin-landing-root .store { transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease; }
.lincoin-landing-root button:hover, .lincoin-landing-root .store:hover { transform: translateY(-2px); }
.lincoin-landing-root button:active { transform: translateY(0) scale(0.98); }
.lincoin-landing-root .feature-row { transition: background 0.2s ease, transform 0.2s ease; }
.lincoin-landing-root .feature-row:hover { transform: translateX(4px); }

@media (prefers-reduced-motion: reduce) {
  .lincoin-landing-root *, .lincoin-landing-root *::before, .lincoin-landing-root *::after { animation: none !important; transition: none !important; }
  .lincoin-landing-root.lc-js .lc-up, .lincoin-landing-root.lc-js .lc-reveal { opacity: 1 !important; transform: none !important; }
}
`;

// Landing oficial de Lincoin: pasarela de pagos para empresas en Colombia
// (1 nov: reemplaza a "Dinero fuerte, fronteras cero", la de USDT/EURT, junto
// con su conversor USDT → BRL y la sección de la tarjeta).
export const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick, onNavigateTo }) => {
  const ref = useRef<HTMLDivElement>(null);
  // Los callbacks van por ref: cada render del padre trae funciones nuevas y,
  // como dependencias del efecto, lo volvían a correr y se repetían las
  // animaciones. Ahora el efecto corre UNA vez.
  const loginRef = useRef(onLoginClick);
  const navRef = useRef(onNavigateTo);
  loginRef.current = onLoginClick;
  navRef.current = onNavigateTo;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const heroArt = el.querySelector<HTMLElement>('.hero-art');

    // 2b) Animaciones. Se marcan los elementos y el CSS hace el resto; la
    //     clase lc-js va al final, así sin JS nada queda invisible.
    let observer: IntersectionObserver | null = null;
    try {
      const heroGrid = el.querySelector<HTMLElement>('.hero-grid');
      const heroTexto = heroGrid?.firstElementChild as HTMLElement | null;
      if (heroTexto) {
        (Array.from(heroTexto.children) as HTMLElement[]).forEach((c, i) => {
          (c as HTMLElement).classList.add('lc-up');
          (c as HTMLElement).style.setProperty('--d', `${80 + i * 90}ms`);
        });
      }
      if (heroArt) {
        heroArt.classList.add('lc-up');
        heroArt.style.setProperty('--d', '380ms');
        const brillo = heroArt.querySelector<HTMLElement>('div[style*="radial-gradient"]');
        brillo?.classList.add('lc-glow');
      }
      // Los puntos verdes de "en vivo" / "operativos" laten.
      el.querySelectorAll<HTMLElement>('span[style*="border-radius:50%"], span[style*="border-radius: 50%"]').forEach(dot => {
        const st = dot.getAttribute('style') || '';
        if (/#4ade80/i.test(st) && /width:\s*[56]px/.test(st)) dot.classList.add('lc-pulse');
      });
      // El panel de la cuenta flota suave.
      const panel = heroArt?.firstElementChild as HTMLElement | null;
      panel?.classList.add('lc-float');

      // Cada sección aparece al entrar en pantalla; sus filas, en cascada.
      const secciones = (Array.from(el.querySelectorAll<HTMLElement>('section')) as HTMLElement[]).filter(sec => sec.id !== 'top');
      const items: HTMLElement[] = [];
      secciones.forEach(sec => {
        const filas = sec.querySelectorAll<HTMLElement>('.feature-row, .faq, .trust-grid > *, .testi-grid > *, .foot-grid > *');
        if (filas.length) {
          (Array.from(filas) as HTMLElement[]).forEach((f, i) => { f.classList.add('lc-reveal'); f.style.setProperty('--d', `${Math.min(i, 6) * 70}ms`); items.push(f); });
          const cabeza = (Array.from(sec.querySelectorAll<HTMLElement>('h2, h3')) as HTMLElement[]).slice(0, 1);
          cabeza.forEach(h => { h.classList.add('lc-reveal'); items.push(h); });
        } else {
          sec.classList.add('lc-reveal'); items.push(sec);
        }
      });
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver((entries) => {
          entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('lc-in'); observer?.unobserve(en.target); } });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        items.forEach(it => observer!.observe(it));
      } else {
        items.forEach(it => it.classList.add('lc-in'));
      }
      el.classList.add('lc-js');
    } catch { /* sin animaciones, la página igual funciona */ }

    // 4) Botones que llevan al onboarding (data-open) y páginas legales (data-page).
    const goToAuth = (e: Event) => { e.preventDefault(); loginRef.current(); };
    const goToPage = (e: Event) => { e.preventDefault(); const k = (e.currentTarget as HTMLElement).getAttribute('data-page'); if (k) navRef.current(k); };
    const openNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-open]'));
    const pageNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-page]'));
    openNodes.forEach((n) => n.addEventListener('click', goToAuth));
    pageNodes.forEach((n) => n.addEventListener('click', goToPage));

    return () => {
      openNodes.forEach((n) => n.removeEventListener('click', goToAuth));
      pageNodes.forEach((n) => n.removeEventListener('click', goToPage));
      if (observer) observer.disconnect();
    };
  }, []);

  return (
    <>
      <style>{LANDING_EXTRA_CSS}</style>
      <div
        ref={ref}
        className="lincoin-landing-root"
        dangerouslySetInnerHTML={LANDING_INNER}
      />
    </>
  );
};
