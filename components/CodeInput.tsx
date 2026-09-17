// ══════════════════════════════════════════════════════════════════
//  CodeInput — las casillas del código de verificación.
//
//  Reemplaza al input de un solo campo con `tracking-[0.5em]`, que se veía
//  como seis dígitos pero no lo era: el cursor quedaba descolocado, en móvil
//  aparecía el teclado de texto, y no había forma de saber en qué dígito ibas.
//
//  CÓMO ESTÁ HECHO: UN solo input real, transparente, encima de las casillas
//  dibujadas. Es a propósito y no es un truco: seis inputs separados rompen el
//  pegado del código, pelean por el foco, y el autorrelleno del código que
//  ofrece iOS no funciona. Con uno solo, `autoComplete="one-time-code"` hace
//  que el teléfono ofrezca el código del correo con un toque.
//
//  Las animaciones son CORTAS a propósito. Esto se usa entrando a una cuenta o
//  autorizando un pago: una animación lenta ahí no se lee como cuidado, se lee
//  como que el sistema va lento. Y quien pidió menos movimiento en su sistema
//  operativo no ve ninguna (el CSS lo respeta).
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useRef, useState } from 'react';

const FONT = 'Archivo, system-ui, sans-serif';

export type CodeStatus = 'idle' | 'verifying' | 'error' | 'ok';

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Se dispara al completar los dígitos. Útil para verificar sin que haya que tocar un botón. */
  onComplete?: (v: string) => void;
  length?: number;
  status?: CodeStatus;
  /** 'dark' = app del cliente · 'light' = pantallas claras (ingreso, panel). */
  tone?: 'dark' | 'light';
  autoFocus?: boolean;
  disabled?: boolean;
  /** Texto accesible del campo (no se dibuja). */
  aria?: string;
};

export const CodeInput: React.FC<Props> = ({
  value, onChange, onComplete, length = 6,
  status = 'idle', tone = 'dark', autoFocus, disabled, aria = 'Código de verificación',
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const [foco, setFoco] = useState(false);
  // Se recuerda el largo anterior para animar SOLO el dígito que acaba de
  // entrar. Animar todos en cada tecla es lo que hace que estas casillas se
  // sientan nerviosas.
  const previo = useRef(0);
  const [ultimo, setUltimo] = useState(-1);

  const limpio = String(value ?? '').replace(/\D/g, '').slice(0, length);

  useEffect(() => {
    if (limpio.length > previo.current) setUltimo(limpio.length - 1);
    else setUltimo(-1);
    previo.current = limpio.length;
  }, [limpio]);

  // El onComplete se dispara UNA vez por código completo. Sin esta guarda, un
  // re-render con el código ya lleno lo volvía a disparar y se verificaba dos
  // veces el mismo código — que del lado del servidor cuenta como un intento
  // gastado.
  const disparado = useRef('');
  useEffect(() => {
    if (limpio.length === length && disparado.current !== limpio) {
      disparado.current = limpio;
      onComplete?.(limpio);
    }
    if (limpio.length < length) disparado.current = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limpio, length]);

  useEffect(() => {
    if (autoFocus) {
      // Un tick de espera: dentro de un modal que acaba de abrir, el foco
      // inmediato lo pierde el contenedor.
      const t = setTimeout(() => ref.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  const oscuro = tone === 'dark';
  const P = oscuro
    ? { txt: '#F4F4F2', dim: 'rgba(244,244,242,0.28)', bg: '#121413', bd: 'rgba(255,255,255,0.11)' }
    : { txt: '#0C0E0D', dim: 'rgba(12,14,13,0.22)',   bg: '#F7F8F7', bd: 'rgba(12,14,13,0.13)' };

  const VERDE = '#4ADE80';
  const ROJO = '#F87171';

  const activo = Math.min(limpio.length, length - 1);
  const borde = (i: number) => {
    if (status === 'error') return ROJO;
    if (status === 'ok') return VERDE;
    if (foco && i === activo && limpio.length < length) return VERDE;
    if (limpio[i]) return oscuro ? 'rgba(255,255,255,0.22)' : 'rgba(12,14,13,0.28)';
    return P.bd;
  };

  const claseFila = status === 'error' ? 'lincoin-code-shake' : status === 'ok' ? 'lincoin-code-ok' : '';

  return (
    <div style={{ position: 'relative', fontFamily: FONT }}>
      <div
        className={claseFila}
        style={{ display: 'flex', gap: 8, justifyContent: 'center' }}
        onClick={() => ref.current?.focus()}
      >
        {Array.from({ length }).map((_, i) => {
          const d = limpio[i];
          const esActivo = foco && i === activo && limpio.length < length && status !== 'ok';
          return (
            <div
              key={i}
              className={status === 'verifying' ? 'lincoin-code-wait' : ''}
              style={{
                flex: '1 1 0', minWidth: 0, maxWidth: 58, height: 58,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: P.bg,
                border: `1.5px solid ${borde(i)}`,
                borderRadius: 13,
                // El resalte del dígito activo va con box-shadow y no con un
                // borde más gordo: cambiar el grosor mueve las casillas de a
                // un pixel y la fila entera parece temblar al escribir.
                boxShadow: esActivo
                  ? `0 0 0 3px rgba(74,222,128,0.14)`
                  : status === 'error'
                    ? '0 0 0 3px rgba(248,113,113,0.12)'
                    : 'none',
                transition: 'border-color 140ms ease, box-shadow 140ms ease, background 140ms ease',
                position: 'relative', overflow: 'hidden',
              }}
            >
              {d ? (
                <span
                  key={`${i}-${d}`}
                  className={i === ultimo ? 'lincoin-code-digit' : undefined}
                  style={{
                    fontSize: 25, fontWeight: 800, letterSpacing: '-0.5px',
                    color: status === 'error' ? ROJO : status === 'ok' ? VERDE : P.txt,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {d}
                </span>
              ) : esActivo ? (
                <span className="lincoin-code-caret" style={{ width: 2, height: 25, background: VERDE, borderRadius: 2 }} />
              ) : (
                <span style={{ fontSize: 22, fontWeight: 700, color: P.dim }}>·</span>
              )}
            </div>
          );
        })}
      </div>

      {/* El input real. Cubre toda la fila, es transparente y no muestra su
          propio cursor: el cursor que se ve es el de la casilla activa. */}
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        name="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        value={limpio}
        disabled={disabled}
        aria-label={aria}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFoco(true)}
        onBlur={() => setFoco(false)}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: 0, background: 'transparent', border: 'none', outline: 'none',
          color: 'transparent', caretColor: 'transparent',
          fontSize: 16, // menos de 16px hace que iOS haga zoom al enfocar
          cursor: disabled ? 'default' : 'text',
          textAlign: 'center', letterSpacing: '1em',
        }}
      />
    </div>
  );
};

export default CodeInput;
