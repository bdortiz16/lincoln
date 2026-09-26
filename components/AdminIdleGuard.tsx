import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminIdleGuard — el panel se cierra solo a la media hora sin uso.
//
// Un computador que quedó abierto en una oficina, un café o una casa ajena es
// una sesión de administrador a disposición de cualquiera que pase. Ni la
// contraseña, ni los dos códigos, ni la llave protegen de eso: todos ya se
// pasaron. Lo único que sirve es que la sesión se cierre sola.
//
// Dos minutos antes avisa, para no perder algo a medio escribir.
//
// El reloj vive en localStorage, no solo en memoria: cerrar la pestaña y
// volver media hora después NO reinicia la cuenta. Y el corte de verdad está
// en el servidor —esto es la parte visible, no la que manda—.
// ─────────────────────────────────────────────────────────────

const LIMITE_MS = 30 * 60_000;
const AVISO_MS = 2 * 60_000;        // avisa cuando faltan 2 minutos
const LATIDO_MS = 5 * 60_000;       // le cuenta al servidor que sigues ahí
const CLAVE = 'lincoin_admin_visto';

const C = {
  card: '#0C0E0D', elev: '#121413',
  border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88',
  green: '#4ADE80', amber: '#FBBF24',
};
const FONT = 'Archivo, system-ui, sans-serif';

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
const tokenOf = () => {
  try {
    const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) return d.access_token as string; }
  } catch { /* */ }
  return null;
};

// El reloj se guarda ATADO a la sesión que lo escribió. Sin eso, salir a las
// 10 y volver a entrar a las 12 encontraba una marca vieja de dos horas y
// cerraba la sesión recién abierta — imposible entrar.
const sesionActual = (): string => {
  try {
    const t = tokenOf();
    const p = t?.split('.')[1];
    if (!p) return '';
    const pad = p.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))?.session_id ?? '';
  } catch { return ''; }
};

const leerVisto = (): number => {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    if (!d?.t) return 0;
    if (String(d.s ?? '') !== sesionActual()) return 0;   // es de otra sesión: no cuenta
    return Number(d.t);
  } catch { return 0; }
};
const guardarVisto = (t: number) => {
  try { localStorage.setItem(CLAVE, JSON.stringify({ s: sesionActual(), t })); } catch { /* */ }
};

export const AdminIdleGuard: React.FC<{ userId: string; onCerrar: () => void }> = ({ userId, onCerrar }) => {
  const [restan, setRestan] = useState<number | null>(null);   // ms, solo durante el aviso
  const ultimoLatido = useRef(0);
  const cerrado = useRef(false);
  // Copia en memoria de la última señal. localStorage puede estar bloqueado
  // (modo privado, ajustes del navegador) y devolver siempre 0: sin esta
  // copia, "nunca hubo señal" se leía como "lleva una eternidad quieto" y
  // cerraba la sesión al instante, que es el error contrario.
  const vistoRef = useRef(0);

  const ultimoVisto = () => Math.max(vistoRef.current, leerVisto());

  const cerrar = () => {
    if (cerrado.current) return;
    cerrado.current = true;
    try { localStorage.removeItem(CLAVE); } catch { /* */ }
    onCerrar();
  };

  // ¿La sesión sigue viva? Si ya venció, la cierra. Se pregunta ANTES de
  // marcar actividad: volver al computador después de una hora tiene que
  // encontrar la sesión cerrada, no reabrirla con el primer movimiento.
  const sigueViva = (): boolean => {
    if (cerrado.current) return false;
    if (Date.now() - ultimoVisto() >= LIMITE_MS) { cerrar(); return false; }
    return true;
  };

  const marcar = () => {
    const ahora = Date.now();
    vistoRef.current = ahora;
    guardarVisto(ahora);
    setRestan(null);
    // Señal al servidor, como mucho una cada 5 minutos.
    if (ahora - ultimoLatido.current > LATIDO_MS) {
      ultimoLatido.current = ahora;
      fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
        body: JSON.stringify({ action: 'touch_session', userId }),
      })
        .then(r => r.json())
        // Si el servidor ya la dio por cerrada, la pantalla no puede seguir
        // abierta: manda el servidor, no el reloj del navegador.
        .then(d => { if (d?.sesionInactiva) cerrar(); })
        .catch(() => { /* la próxima llamada real vuelve a marcar */ });
    }
  };

  useEffect(() => {
    if (!userId) return;

    // Al abrir: si la última señal es de hace más de media hora, la sesión ya
    // venció mientras la pestaña estaba cerrada.
    const previo = leerVisto();
    if (previo && Date.now() - previo >= LIMITE_MS) { cerrar(); return; }
    marcar();

    const eventos = ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    // Primero se comprueba si venció, y SOLO si sigue viva se renueva. Al
    // revés —que era como estaba— cualquier clic al volver resucitaba una
    // sesión que ya debía estar cerrada, y el cierre no ocurría nunca.
    const alHaberActividad = () => { if (sigueViva()) marcar(); };
    eventos.forEach(e => window.addEventListener(e, alHaberActividad, { passive: true }));

    // Volver a la pestaña NO cuenta como actividad: solo dispara la
    // comprobación. Este era el agujero — el navegador congela el reloj de
    // las pestañas de fondo, así que al volver el temporizador todavía no
    // había alcanzado a vencer, y esto lo reiniciaba antes de que pudiera.
    const alVolver = () => { if (document.visibilityState === 'visible') sigueViva(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    window.addEventListener('pageshow', alVolver);

    const reloj = setInterval(() => {
      if (!sigueViva()) { clearInterval(reloj); return; }
      const inactivo = Date.now() - ultimoVisto();
      setRestan(inactivo >= LIMITE_MS - AVISO_MS ? LIMITE_MS - inactivo : null);
    }, 5_000);

    return () => {
      eventos.forEach(e => window.removeEventListener(e, alHaberActividad));
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
      window.removeEventListener('pageshow', alVolver);
      clearInterval(reloj);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [userId]);

  if (restan === null) return null;

  const seg = Math.max(0, Math.ceil(restan / 1000));
  const mm = String(Math.floor(seg / 60)).padStart(1, '0');
  const ss = String(seg % 60).padStart(2, '0');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(7,8,8,0.82)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 24, maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
          <Clock size={17} color={C.amber} /> ¿Sigues ahí?
        </p>
        <p style={{ color: C.sub, fontSize: 12.5, margin: '7px 0 0', lineHeight: 1.55 }}>
          El panel se cierra solo por inactividad. Un computador abierto sin nadie
          delante es una sesión de administrador a disposición de quien pase.
        </p>
        <p style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 30, fontWeight: 800, margin: '16px 0 4px', color: C.amber }}>
          {mm}:{ss}
        </p>
        <button
          onClick={() => { if (sigueViva()) { ultimoLatido.current = 0; marcar(); } }}
          style={{
            width: '100%', marginTop: 12, background: 'rgba(74,222,128,0.12)',
            border: '1px solid rgba(74,222,128,0.32)', color: C.green, borderRadius: 10,
            padding: '11px 0', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
          }}>
          Sigo aquí
        </button>
        <button
          onClick={cerrar}
          style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
          Cerrar sesión ahora
        </button>
      </div>
    </div>
  );
};
