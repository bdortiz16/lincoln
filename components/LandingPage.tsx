import React, { useEffect, useRef } from 'react';
import { LANDING_HTML } from './landingHtml';

interface LandingPageProps {
  onLoginClick: () => void;
  onRegisterClick: (role?: 'business' | 'personal') => void;
  onNavigateTo: (pageKey: string) => void;
}

// ── Conversor USDT → BRL del hero (demostrativo; dirige al onboarding) ──
const CONVERTER_HTML = `
<div style="position: relative; width: 100%; max-width: 420px; margin: 0 auto;">
  <div style="position:absolute; inset:-20px; background: radial-gradient(circle, rgba(74,222,128,0.09), transparent 62%); filter: blur(24px); z-index:0;"></div>
  <div style="position: relative; z-index:1; background:#0C0E0D; border:1px solid rgba(255,255,255,0.12); border-radius:20px; padding:26px;">
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
      <span style="font-size:16px; font-weight:700; color:#F4F4F2;">Conversor</span>
      <span style="display:inline-flex; align-items:center; gap:6px; border:1px solid rgba(74,222,128,0.3); border-radius:999px; padding:4px 10px;">
        <span style="width:5px; height:5px; border-radius:50%; background:#4ADE80;"></span>
        <span style="font-size:11px; font-weight:700; color:#4ADE80; letter-spacing:0.4px;">TASA EN VIVO</span>
      </span>
    </div>

    <div style="background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.09); border-radius:13px; padding:15px 17px;">
      <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#878E88; margin-bottom:8px;">
        <span>Envías</span><span>Dólar digital</span>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <input id="cv-in" inputmode="decimal" value="1 000"
          style="flex:1; min-width:0; background:transparent; border:none; outline:none; color:#F4F4F2; font-family:'Archivo',system-ui,sans-serif; font-size:27px; font-weight:800; letter-spacing:-0.8px;" />
        <span style="display:inline-flex; align-items:center; gap:7px; background:rgba(255,255,255,0.055); border:1px solid rgba(255,255,255,0.11); border-radius:999px; padding:5px 11px 5px 6px; flex-shrink:0;">
          <span style="width:22px; height:22px; border-radius:50%; background:#26A17B; display:grid; place-items:center; color:#fff; font-weight:800; font-size:11px;">T</span>
          <span style="font-size:13.5px; font-weight:700; color:#F4F4F2;">USDT</span>
        </span>
      </div>
    </div>

    <div style="display:flex; justify-content:center; margin:-7px 0; position:relative; z-index:2;">
      <div style="width:34px; height:34px; border-radius:50%; background:#0C0E0D; border:1px solid rgba(255,255,255,0.14); display:grid; place-items:center;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M7 4v13m0 0l-3-3m3 3l3-3" stroke="#F4F4F2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 20V7m0 0l3 3m-3-3l-3 3" stroke="#878E88" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>

    <div style="background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.09); border-radius:13px; padding:15px 17px;">
      <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#878E88; margin-bottom:8px;">
        <span>Reciben en Brasil</span><span>Vía Pix · en segundos</span>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <span id="cv-out" style="flex:1; min-width:0; color:#F4F4F2; font-size:27px; font-weight:800; letter-spacing:-0.8px;">0,00</span>
        <span style="display:inline-flex; align-items:center; gap:7px; background:rgba(255,255,255,0.055); border:1px solid rgba(255,255,255,0.11); border-radius:999px; padding:5px 11px 5px 6px; flex-shrink:0;">
          <span style="width:22px; height:22px; border-radius:50%; background:#009C3B; display:grid; place-items:center; position:relative; overflow:hidden;">
            <span style="width:13px; height:13px; background:#FFDF00; transform:rotate(45deg); display:block;"></span>
            <span style="position:absolute; width:6px; height:6px; border-radius:50%; background:#002776;"></span>
          </span>
          <span style="font-size:13.5px; font-weight:700; color:#F4F4F2;">BRL</span>
        </span>
      </div>
    </div>

    <div style="margin-top:16px; font-size:12.5px;">
      <div style="display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#878E88;">Tasa de cambio</span><span id="cv-rateline" style="color:#F4F4F2; font-weight:700;">1 USDT = 5,4120 BRL</span></div>
      <div style="display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#878E88;">Comisión Lincoin</span><span style="color:#4ADE80; font-weight:700;">Gratis</span></div>
      <div style="display:flex; justify-content:space-between; padding:7px 0;"><span style="color:#878E88;">Llega</span><span style="color:#F4F4F2; font-weight:700;">Hoy, en segundos</span></div>
    </div>

    <button data-open style="width:100%; margin-top:18px; background:#F4F4F2; color:#0A0A0A; border:none; border-radius:11px; padding:14px 0; font-family:'Archivo',system-ui,sans-serif; font-size:15px; font-weight:700; cursor:pointer;">Convertir ahora</button>
    <p style="text-align:center; font-size:11px; color:rgba(244,244,242,0.45); margin:12px 0 0;">Tasa referencial. Se fija al confirmar la operación.</p>
  </div>
</div>`;

// ── Sección de la tarjeta Mastercard (deposita USDT, paga en el mundo) ──
const CARD_SECTION_HTML = `
<section id="tarjeta" style="border-top:1px solid rgba(255,255,255,0.12); background:#0a0a0a;">
  <div style="max-width:1180px; margin:0 auto; padding:88px 48px; display:grid; grid-template-columns:1fr 1fr; gap:56px; align-items:center;" class="sec-grid">
    <div>
      <span style="display:inline-flex; align-items:center; gap:7px; border:1px solid rgba(74,222,128,0.3); border-radius:999px; padding:5px 12px; font-size:11px; font-weight:700; letter-spacing:1px; color:#4ADE80;">
        <span style="width:5px; height:5px; border-radius:50%; background:#4ADE80;"></span>TARJETA LINCOIN · MASTERCARD
      </span>
      <h2 style="font-size:38px; font-weight:800; letter-spacing:-1px; color:#F4F4F2; margin:20px 0 14px; line-height:1.08;">Deposita USDT, paga en <span style="color:#4ADE80;">cualquier parte del mundo</span>.</h2>
      <p style="font-size:16px; color:#878E88; line-height:1.6; margin:0 0 24px; max-width:460px;">Tu dólar digital, listo para gastar. Carga USDT en tu cuenta y paga con tu tarjeta Mastercard en millones de comercios y en línea — la conversión ocurre al instante, sin cambiar de app.</p>
      <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:28px;">
        <div style="display:flex; gap:10px; align-items:flex-start;"><span style="color:#4ADE80; font-weight:800;">✓</span><span style="font-size:14.5px; color:#F4F4F2;">Aceptada donde recibas Mastercard, físico y en línea.</span></div>
        <div style="display:flex; gap:10px; align-items:flex-start;"><span style="color:#4ADE80; font-weight:800;">✓</span><span style="font-size:14.5px; color:#F4F4F2;">Se descuenta de tu saldo en dólar digital al pagar.</span></div>
        <div style="display:flex; gap:10px; align-items:flex-start;"><span style="color:#4ADE80; font-weight:800;">✓</span><span style="font-size:14.5px; color:#F4F4F2;">Controla y congela la tarjeta desde la app.</span></div>
      </div>
      <button data-open style="background:#F4F4F2; color:#0A0A0A; border:none; border-radius:11px; padding:14px 28px; font-family:'Archivo',system-ui,sans-serif; font-size:15px; font-weight:700; cursor:pointer;">Quiero mi tarjeta</button>
    </div>
    <div style="display:flex; justify-content:center;">
      <div style="width:340px; height:214px; border-radius:18px; padding:24px; position:relative; overflow:hidden; background:linear-gradient(135deg, #161A17 0%, #0C0E0D 60%, #0A0B0A 100%); border:1px solid rgba(255,255,255,0.12); box-shadow:0 30px 60px rgba(0,0,0,0.55);">
        <div style="position:absolute; top:-40px; right:-30px; width:200px; height:200px; background:radial-gradient(circle, rgba(74,222,128,0.18), transparent 60%);"></div>
        <div style="position:relative; z-index:1; height:100%; display:flex; flex-direction:column; justify-content:space-between;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <span style="font-family:'Archivo',system-ui,sans-serif; font-weight:800; font-size:20px; letter-spacing:-0.6px; color:#F4F4F2;">Lincoin<span style="color:#4ADE80;">.</span></span>
            <span style="font-size:11px; color:#878E88; letter-spacing:1px;">DÓLAR DIGITAL</span>
          </div>
          <div style="width:40px; height:30px; border-radius:6px; background:linear-gradient(135deg,#d4b872,#a8863f);"></div>
          <div>
            <div style="font-family:ui-monospace,Menlo,monospace; font-size:16px; letter-spacing:2px; color:#F4F4F2; margin-bottom:12px;">5241 ····&nbsp;····&nbsp;0062</div>
            <div style="display:flex; justify-content:space-between; align-items:flex-end;">
              <span style="font-size:12px; color:#878E88; letter-spacing:0.5px;">TITULAR LINCOIN</span>
              <span style="display:flex; align-items:center;"><span style="width:26px; height:26px; border-radius:50%; background:#EB001B; display:inline-block;"></span><span style="width:26px; height:26px; border-radius:50%; background:#F79E1B; display:inline-block; margin-left:-11px; mix-blend-mode:screen;"></span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>`;

// La fuente ya la carga index.html (sin bloquear). El @import de la landing
// la volvía a pedir cada vez que se pintaba la página.
const LANDING_HTML_SIN_IMPORT = LANDING_HTML.replace(/@import url\([^)]*\);?/g, '');
// El OBJETO va fijo, fuera del componente. React 19 vuelve a escribir el
// innerHTML entero cada vez que recibe un objeto nuevo (no compara el texto):
// en cada render del padre la página se reescribía — se borraba el conversor
// mientras la persona tecleaba y parpadeaba al iniciar.
const LANDING_INNER = { __html: LANDING_HTML_SIN_IMPORT };

// ── Arreglos de ancho en celular + animaciones ──
// Ancho: el conversor (420 px) y la franja de confianza (dos columnas de
// 212 px) eran más anchos que la pantalla de un celular: el texto quedaba
// cortado a la derecha y la página se corría de lado.
// Animaciones: solo opacidad y transform (las baratas para el teléfono), y
// nada si la persona pidió reducir el movimiento.
const LANDING_EXTRA_CSS = `
.lincoin-landing-root { overflow-x: clip; }
.lincoin-landing-root .hero-grid > *, .lincoin-landing-root .trust-grid > *, .lincoin-landing-root .sec-grid > *,
.lincoin-landing-root .faq-grid > *, .lincoin-landing-root .foot-grid > *, .lincoin-landing-root .testi-grid > * { min-width: 0; }
.lincoin-landing-root .hero-art { max-width: 100%; }
@media (max-width: 520px) {
  .lincoin-landing-root .trust-grid { grid-template-columns: 1fr !important; }
  .lincoin-landing-root nav { display: none !important; }
}

@keyframes lcUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes lcPulse { 0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.55); } 70% { box-shadow: 0 0 0 7px rgba(74,222,128,0); } 100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); } }
@keyframes lcFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes lcGlow { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
@keyframes lcFlash { from { color: #4ADE80; } to { color: #F4F4F2; } }

.lincoin-landing-root.lc-js .lc-up { opacity: 0; animation: lcUp 0.7s cubic-bezier(.2,.7,.2,1) forwards; animation-delay: var(--d, 0ms); }
.lincoin-landing-root.lc-js .lc-reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s cubic-bezier(.2,.7,.2,1); transition-delay: var(--d, 0ms); }
.lincoin-landing-root.lc-js .lc-reveal.lc-in { opacity: 1; transform: none; }
.lincoin-landing-root .lc-pulse { animation: lcPulse 2.2s ease-out infinite; }
.lincoin-landing-root .lc-float { animation: lcFloat 6s ease-in-out infinite; }
.lincoin-landing-root .lc-glow { animation: lcGlow 5s ease-in-out infinite; }
.lincoin-landing-root .lc-flash { animation: lcFlash 0.9s ease-out; }
.lincoin-landing-root button, .lincoin-landing-root .store { transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease; }
.lincoin-landing-root button:hover, .lincoin-landing-root .store:hover { transform: translateY(-2px); }
.lincoin-landing-root button:active { transform: translateY(0) scale(0.98); }
.lincoin-landing-root .feature-row { transition: background 0.2s ease, transform 0.2s ease; }
.lincoin-landing-root .feature-row:hover { transform: translateX(4px); }
.lincoin-landing-root #tarjeta .lc-card { transition: transform 0.4s cubic-bezier(.2,.7,.2,1); }
.lincoin-landing-root #tarjeta .lc-card:hover { transform: perspective(900px) rotateX(4deg) rotateY(-7deg) translateY(-6px); }

@media (prefers-reduced-motion: reduce) {
  .lincoin-landing-root *, .lincoin-landing-root *::before, .lincoin-landing-root *::after { animation: none !important; transition: none !important; }
  .lincoin-landing-root.lc-js .lc-up, .lincoin-landing-root.lc-js .lc-reveal { opacity: 1 !important; transform: none !important; }
}
`;

// Landing oficial de Lincoin (Lincoin Landing v2 — "Dinero fuerte, fronteras cero").
export const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick, onNavigateTo }) => {
  const ref = useRef<HTMLDivElement>(null);
  // Los callbacks van por ref: cada render del padre trae funciones nuevas y,
  // como dependencias del efecto, lo volvían a correr — se reinsertaba el
  // conversor (borrando lo que la persona estaba escribiendo) y se volvía a
  // pedir la tasa. Ahora el efecto corre UNA vez.
  const loginRef = useRef(onLoginClick);
  const navRef = useRef(onNavigateTo);
  loginRef.current = onLoginClick;
  navRef.current = onNavigateTo;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 1) Reemplazar el mockup del hero por el conversor.
    const heroArt = el.querySelector<HTMLElement>('.hero-art');
    if (heroArt) {
      heroArt.style.display = 'flex';
      heroArt.style.alignItems = 'center';
      heroArt.style.justifyContent = 'center';
      heroArt.innerHTML = CONVERTER_HTML;
    }

    // 2) Insertar la sección de la tarjeta JUSTO ENCIMA de la franja de
    //    confianza (la barra "Cifrado AES-256 · USDT y EURT · …"). Si por
    //    algún motivo no está, se cae al antiguo punto (antes del footer).
    if (!el.querySelector('#tarjeta')) {
      const trustSection =
        el.querySelector('.trust-grid')?.closest('section') || el.querySelector('footer');
      if (trustSection) {
        const wrap = document.createElement('div');
        wrap.innerHTML = CARD_SECTION_HTML;
        const node = wrap.firstElementChild;
        if (node) trustSection.parentElement?.insertBefore(node, trustSection);
      }
    }

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
      // La tarjeta flota y se inclina al pasar el cursor.
      const tarjeta = el.querySelector<HTMLElement>('#tarjeta div[style*="width:340px"]');
      if (tarjeta) { tarjeta.classList.add('lc-card'); tarjeta.parentElement?.classList.add('lc-float'); }

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

    // 3) Comportamiento del conversor (tasa en vivo + formato es).
    let rate = 5.4120; // referencia; se refresca desde la API si hay dato
    // Formato es del spec: miles con ESPACIO, coma decimal (ej. "5 412,00").
    const spaceThousands = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const fmt = (n: number) => { const [i, d = '00'] = (n || 0).toFixed(2).split('.'); return `${spaceThousands(i)},${d}`; };
    const fmtInt = (n: number) => spaceThousands(String(Math.round(n || 0)));
    const fmtRate = (n: number) => n.toFixed(4).replace('.', ',');
    const input = el.querySelector<HTMLInputElement>('#cv-in');
    const out = el.querySelector<HTMLElement>('#cv-out');
    const rateLine = el.querySelector<HTMLElement>('#cv-rateline');
    const parseAmt = (s: string) => {
      const clean = String(s).replace(/[^\d,]/g, '').replace(',', '.');
      const n = parseFloat(clean);
      return isFinite(n) ? n : 0;
    };
    const recompute = () => {
      if (!input || !out) return;
      const amt = parseAmt(input.value);
      out.textContent = fmt(amt * rate);
      if (rateLine) rateLine.textContent = `1 USDT = ${fmtRate(rate)} BRL`;
    };
    const onInput = () => {
      if (!input) return;
      const amt = parseAmt(input.value);
      const caretEnd = input.selectionStart === input.value.length;
      // Reformatea solo la parte entera con separador de miles (permite coma decimal al teclear).
      if (!/[,][0-9]*$/.test(input.value)) input.value = amt ? fmtInt(amt) : '';
      if (caretEnd) { try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* noop */ } }
      recompute();
    };
    if (input) {
      input.addEventListener('input', onInput);
      input.addEventListener('focus', () => { input.style.outline = 'none'; });
    }
    recompute();

    // Tasa en vivo desde fx_rate_snapshots (lectura pública anon). USDT ≈ USD.
    let timer: ReturnType<typeof setInterval> | null = null;
    const fetchRate = async () => {
      try {
        const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
        const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
        if (!SURL) return;
        const r = await fetch(`${SURL}/rest/v1/fx_rate_snapshots?select=rate,from_currency,to_currency&or=(and(from_currency.eq.USD,to_currency.eq.BRL),and(from_currency.eq.BRL,to_currency.eq.USD))&order=captured_at.desc&limit=1`, {
          headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` },
        }).then(x => x.json()).catch(() => null);
        const row = Array.isArray(r) ? r[0] : null;
        if (row && Number(row.rate) > 0) {
          const nueva = row.from_currency === 'USD' ? Number(row.rate) : 1 / Number(row.rate);
          const cambio = Math.abs(nueva - rate) > 1e-6;
          rate = nueva;
          recompute();
          // Un destello verde cuando la tasa en vivo se mueve.
          if (cambio && out) { out.classList.remove('lc-flash'); void out.offsetWidth; out.classList.add('lc-flash'); }
        }
      } catch { /* mantiene la tasa de referencia */ }
    };
    fetchRate();
    timer = setInterval(fetchRate, 30000);

    // 4) Botones que llevan al onboarding (data-open) y páginas legales (data-page).
    const goToAuth = (e: Event) => { e.preventDefault(); loginRef.current(); };
    const goToPage = (e: Event) => { e.preventDefault(); const k = (e.currentTarget as HTMLElement).getAttribute('data-page'); if (k) navRef.current(k); };
    const openNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-open]'));
    const pageNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-page]'));
    openNodes.forEach((n) => n.addEventListener('click', goToAuth));
    pageNodes.forEach((n) => n.addEventListener('click', goToPage));

    return () => {
      if (timer) clearInterval(timer);
      if (input) input.removeEventListener('input', onInput);
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
