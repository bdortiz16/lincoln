// ════════════════════════════════════════════════════════
// SelectorPais — la pantalla que aparece entre las verificaciones y el panel.
//
// QUE HACE
//   Pregunta sobre qué país se va a operar y guarda la elección para la
//   sesión. A partir de ahí el panel muestra solo lo de ese país: clientes,
//   movimientos, cargues, OTC.
//
// LO QUE ESTA PANTALLA *NO* ES
//   No es el control de acceso. Los países que aparecen acá los decide el
//   servidor (acción `mi_acceso`) según el rol y los países del miembro, y el
//   filtro de datos también vive allá. Si alguien forzara esta pantalla para
//   mostrar un país que no le toca, no vería nada de ese país igual: el
//   servidor no se lo manda.
//
//   Se aclara porque es fácil confundir "la pantalla que elige" con "lo que
//   permite", y construir sobre esa confusión termina en un panel que parece
//   separado por país y no lo está.
// ════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import { Logo } from './Logo';

export const CLAVE_PAIS = 'lincoin_admin_pais';

export interface PaisDisponible {
  code: string;
  nombre: string;
  estado: string;      // 'on' | 'soon'
}

// Se guarda por SESIÓN, no para siempre: "sobre qué país estoy operando" es
// una decisión del momento, y arrastrarla de un día para otro hace que alguien
// mire números de un país creyendo que son de otro.
export function paisElegido(): string | null {
  try { return sessionStorage.getItem(CLAVE_PAIS); } catch { return null; }
}
export function guardarPais(code: string) {
  try { sessionStorage.setItem(CLAVE_PAIS, code); } catch { /* modo privado */ }
}
export function olvidarPais() {
  try { sessionStorage.removeItem(CLAVE_PAIS); } catch { /* modo privado */ }
}

const BANDERA: Record<string, string> = { CO: '🇨🇴', BR: '🇧🇷', MX: '🇲🇽', US: '🇺🇸' };

const DETALLE: Record<string, string> = {
  CO: 'COP · Bre-B · ACH · Mesa OTC',
  BR: 'BRL · PIX',
  MX: 'MXN · SPEI',
  US: 'USD · USDT',
};

const FONDO = 'linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)';
const TXT = '#F4F4F2', TXT2 = '#878E88', TXT3 = 'rgba(244,244,242,0.45)';
const VERDE = '#4ADE80';

interface Props {
  paises: PaisDisponible[];
  rol: string;
  cargando: boolean;
  onElegir: (code: string) => void;
  onSalir: () => void;
}

export const SelectorPais: React.FC<Props> = ({ paises, rol, cargando, onElegir, onSalir }) => {
  const [marcado, setMarcado] = useState<string | null>(null);

  // Si solo hay un país habilitado, queda preseleccionado — sigue haciendo
  // falta confirmar, para que nadie entre sin registrar sobre qué opera.
  useEffect(() => {
    const activos = paises.filter((p) => p.estado === 'on');
    if (activos.length === 1) setMarcado(activos[0].code);
  }, [paises]);

  const elegir = (p: PaisDisponible) => {
    if (p.estado !== 'on') return;
    setMarcado(p.code);
  };

  const confirmar = () => {
    if (!marcado) return;
    guardarPais(marcado);
    onElegir(marcado);
  };

  return (
    <div style={{ minHeight: '100vh', background: FONDO, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* Glow verde en la esquina, como el resto de la marca */}
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(circle at 85% 10%, rgba(74,222,128,0.10), transparent 45%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 460, position: 'relative' }}>
        <div style={{ marginBottom: 32 }}><Logo variant="white" /></div>

        <h1 style={{ fontFamily: 'Archivo, system-ui, sans-serif', fontWeight: 800, fontSize: 26, letterSpacing: '-0.6px', color: TXT, margin: '0 0 8px' }}>
          ¿Sobre qué país vas a operar?
        </h1>
        <p style={{ fontSize: 13.5, color: TXT2, lineHeight: 1.55, margin: '0 0 28px' }}>
          El panel va a mostrarte solo lo de ese país — clientes, movimientos, cargues y mesa.
          Podés cambiarlo cuando quieras desde arriba.
        </p>

        {cargando ? (
          <p style={{ fontSize: 13, color: TXT3 }}>Cargando tus permisos…</p>
        ) : paises.length === 0 ? (
          // No se dice "no tenés permisos" a secas: alguien tiene que poder
          // resolverlo, y para eso hay que saber a quién pedírselo.
          <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: 18 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: TXT, margin: '0 0 6px' }}>
              Tu cuenta todavía no tiene países asignados
            </p>
            <p style={{ fontSize: 13, color: TXT2, lineHeight: 1.55, margin: 0 }}>
              Entraste bien, pero no vas a ver datos hasta que alguien con rol de dueño
              te asigne al menos un país en <b style={{ color: TXT }}>Equipo</b>.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {paises.map((p) => {
              const activo = p.estado === 'on';
              const sel = marcado === p.code;
              return (
                <button
                  key={p.code}
                  onClick={() => elegir(p)}
                  disabled={!activo}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
                    padding: '14px 16px', borderRadius: 12,
                    border: `1px solid ${sel ? VERDE : 'rgba(255,255,255,0.10)'}`,
                    background: sel ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.02)',
                    cursor: activo ? 'pointer' : 'not-allowed',
                    opacity: activo ? 1 : 0.4,
                    transition: 'border-color .15s, background .15s',
                  }}
                >
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{BANDERA[p.code] ?? '🌐'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: TXT }}>{p.nombre}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: TXT3, marginTop: 2 }}>
                      {activo ? (DETALLE[p.code] ?? '') : 'Próximamente'}
                    </span>
                  </span>
                  {sel && <span style={{ color: VERDE, fontSize: 18, fontWeight: 800 }}>✓</span>}
                </button>
              );
            })}
          </div>
        )}

        {paises.length > 0 && (
          <button
            onClick={confirmar}
            disabled={!marcado}
            style={{
              width: '100%', marginTop: 20, padding: '13px 16px', borderRadius: 12, border: 'none',
              background: marcado ? VERDE : 'rgba(255,255,255,0.06)',
              color: marcado ? '#0A0B0A' : TXT3,
              fontFamily: 'Archivo, system-ui, sans-serif', fontWeight: 800, fontSize: 14.5,
              letterSpacing: '-0.2px', cursor: marcado ? 'pointer' : 'not-allowed',
            }}
          >
            Entrar
          </button>
        )}

        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 11, color: TXT3 }}>
            Rol: <b style={{ color: TXT2 }}>{({ dueno: 'Dueño', operaciones: 'Operaciones', cumplimiento: 'Cumplimiento', lectura: 'Solo lectura' } as Record<string, string>)[rol] ?? rol}</b>
          </span>
          <button onClick={onSalir} style={{ background: 'none', border: 'none', color: TXT3, fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline' }}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};
