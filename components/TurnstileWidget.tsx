import React, { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────
// TurnstileWidget — CAPTCHA de Cloudflare Turnstile para proteger
// los endpoints de autenticación (login, registro, reset) contra bots.
//
// SEGURO POR DEFECTO: si NO hay VITE_TURNSTILE_SITE_KEY configurado, el
// widget NO se renderiza y no exige token — así el código se puede
// desplegar sin romper nada. Solo cuando pongas el Site Key (y actives
// el CAPTCHA en Supabase) empieza a pedir el token.
//
// El token es de UN SOLO USO y expira (~300s). Para reintentar tras un
// fallo, el padre cambia `resetKey` para volver a montar el widget.
// ─────────────────────────────────────────────────────────────

export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string) || '';
export const captchaEnabled = !!TURNSTILE_SITE_KEY;

declare global {
  interface Window { turnstile?: any; __turnstileLoading?: boolean }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    if (window.turnstile) return resolve();
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) { existing.addEventListener('load', () => resolve()); if (window.turnstile) resolve(); return; }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

export const TurnstileWidget: React.FC<{
  onToken: (token: string) => void;
  resetKey?: number | string;
  className?: string;
}> = ({ onToken, resetKey, className }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<any>(null);

  useEffect(() => {
    if (!captchaEnabled) return;
    let cancelled = false;
    (async () => {
      await loadScript();
      if (cancelled || !ref.current || !window.turnstile) return;
      // Limpia un render previo (por cambio de resetKey).
      try { if (widgetIdRef.current != null) window.turnstile.remove(widgetIdRef.current); } catch { /* */ }
      ref.current.innerHTML = '';
      try {
        widgetIdRef.current = window.turnstile.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
          'timeout-callback': () => onToken(''),
        });
      } catch { /* si falla el render, no bloquea la UI */ }
    })();
    return () => { cancelled = true; try { if (widgetIdRef.current != null) window.turnstile?.remove(widgetIdRef.current); } catch { /* */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!captchaEnabled) return null;
  return <div ref={ref} className={className} />;
};
