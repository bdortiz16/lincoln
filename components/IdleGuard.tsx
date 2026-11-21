import React, { useEffect, useRef, useState } from 'react';
import { leerVisto, guardarVisto, olvidarVisto } from '../lib/idle';

// ─────────────────────────────────────────────────────────────
// IdleGuard — la sesión se cierra sola cuando nadie la usa.
//
// Antes esto eran dos setTimeout en memoria, y por eso no cerraba nunca:
//   · El navegador congela los temporizadores de las pestañas de fondo. En el
//     móvil basta bloquear la pantalla. El que iba a cerrar a los cinco
//     minutos no llegaba a disparar.
//   · Si se cerraba la pestaña, el temporizador desaparecía. Al volver,
//     Supabase restauraba la sesión y se entraba como si nada.
//   · Y volver a la pestaña contaba como actividad, así que el primer
//     movimiento al regresar reiniciaba la cuenta antes de que venciera.
//
// Acá el reloj vive en localStorage y se compara contra la hora real: al
// abrir, al volver a la pestaña, y cada quince segundos. Volver NO cuenta
// como actividad — solo dispara la comprobación.
// ─────────────────────────────────────────────────────────────

const CLAVE = 'lincoin_visto';
const REVISAR_MS = 15_000;

export const IdleGuard: React.FC<{
  limiteMs: number;
  avisoMs: number;
  onCerrar: () => void;
}> = ({ limiteMs, avisoMs, onCerrar }) => {
  const [restan, setRestan] = useState<number | null>(null);   // ms, solo durante el aviso
  const cerrado = useRef(false);
  // Copia en memoria de la última señal. localStorage puede estar bloqueado
  // (modo privado, ajustes del navegador) y devolver siempre 0: sin esta
  // copia, "nunca hubo señal" se leería como "lleva una eternidad quieto" y
  // cerraría la sesión al instante, que es el error contrario.
  const vistoRef = useRef(0);
  const ultimoVisto = () => Math.max(vistoRef.current, leerVisto(CLAVE));

  const cerrar = () => {
    if (cerrado.current) return;
    cerrado.current = true;
    olvidarVisto(CLAVE);
    onCerrar();
  };

  // Se pregunta ANTES de marcar actividad: volver al teléfono después de una
  // hora tiene que encontrar la sesión cerrada, no reabrirla con el primer
  // toque.
  const sigueViva = (): boolean => {
    if (cerrado.current) return false;
    if (Date.now() - ultimoVisto() >= limiteMs) { cerrar(); return false; }
    return true;
  };

  const marcar = () => {
    const ahora = Date.now();
    vistoRef.current = ahora;
    guardarVisto(CLAVE, ahora);
    setRestan(null);
  };

  useEffect(() => {
    // Al abrir: si la última señal es de hace más del límite, la sesión ya
    // venció mientras la pestaña estaba cerrada o el teléfono bloqueado.
    const previo = leerVisto(CLAVE);
    if (previo && Date.now() - previo >= limiteMs) { cerrar(); return; }
    marcar();

    const alHaberActividad = () => { if (sigueViva()) marcar(); };
    const eventos = ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    eventos.forEach(e => window.addEventListener(e, alHaberActividad, { passive: true }));

    // Volver a la pestaña solo COMPRUEBA. Este era el agujero: el reloj de
    // las pestañas de fondo va congelado, así que al volver el temporizador
    // todavía no había vencido, y cualquier evento lo reiniciaba antes.
    const alVolver = () => { if (document.visibilityState === 'visible') sigueViva(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);

    // Y un latido propio, para que el cierre ocurra con la pestaña quieta y a
    // la vista, sin esperar a que alguien toque algo.
    const reloj = setInterval(() => {
      if (!sigueViva()) return;
      const inactivo = Date.now() - ultimoVisto();
      setRestan(inactivo >= limiteMs - avisoMs ? limiteMs - inactivo : null);
    }, REVISAR_MS);

    return () => {
      eventos.forEach(e => window.removeEventListener(e, alHaberActividad));
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
      clearInterval(reloj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limiteMs, avisoMs]);

  if (restan === null) return null;
  const min = Math.max(0, Math.ceil(restan / 60_000));

  return (
    <div role="status" style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
      gap: 12, padding: '12px 16px',
      background: '#121413', borderTop: '1px solid rgba(255,255,255,0.12)',
      fontFamily: "'Archivo', system-ui, sans-serif",
    }}>
      <span style={{ fontSize: 13, color: '#F4F4F2' }}>
        Tu sesión se cierra {min <= 1 ? 'en menos de un minuto' : `en ${min} minutos`} por inactividad.
      </span>
      <button onClick={marcar} className="hover:bg-white/[0.09] transition-colors"
        style={{ fontSize: 12.5, fontWeight: 700, color: '#F4F4F2', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.14)', padding: '7px 14px', borderRadius: 9 }}>
        Sigo aquí
      </button>
    </div>
  );
};
