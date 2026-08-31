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

// Landing oficial de Lincoin (Lincoin Landing v2 — "Dinero fuerte, fronteras cero").
export const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick, onNavigateTo }) => {
  const ref = useRef<HTMLDivElement>(null);

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

    // 2) Insertar la sección de la tarjeta antes del footer.
    const footer = el.querySelector('footer');
    if (footer && !el.querySelector('#tarjeta')) {
      const wrap = document.createElement('div');
      wrap.innerHTML = CARD_SECTION_HTML;
      const node = wrap.firstElementChild;
      if (node) footer.parentElement?.insertBefore(node, footer);
    }

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
          rate = row.from_currency === 'USD' ? Number(row.rate) : 1 / Number(row.rate);
          recompute();
        }
      } catch { /* mantiene la tasa de referencia */ }
    };
    fetchRate();
    timer = setInterval(fetchRate, 30000);

    // 4) Botones que llevan al onboarding (data-open) y páginas legales (data-page).
    const goToAuth = (e: Event) => { e.preventDefault(); onLoginClick(); };
    const goToPage = (e: Event) => { e.preventDefault(); const k = (e.currentTarget as HTMLElement).getAttribute('data-page'); if (k) onNavigateTo(k); };
    const openNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-open]'));
    const pageNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-page]'));
    openNodes.forEach((n) => n.addEventListener('click', goToAuth));
    pageNodes.forEach((n) => n.addEventListener('click', goToPage));

    return () => {
      if (timer) clearInterval(timer);
      if (input) input.removeEventListener('input', onInput);
      openNodes.forEach((n) => n.removeEventListener('click', goToAuth));
      pageNodes.forEach((n) => n.removeEventListener('click', goToPage));
    };
  }, [onLoginClick, onNavigateTo]);

  return (
    <div
      ref={ref}
      className="lincoin-landing-root"
      dangerouslySetInnerHTML={{ __html: LANDING_HTML }}
    />
  );
};
