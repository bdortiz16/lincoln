import React from 'react';

// ─────────────────────────────────────────────────────────────
// SidebarEmpresas — la barra lateral de la app de empresas.
//
// La anterior venía del tema claro: cada ítem era una caja con borde y
// sombra, el activo un botón negro con relieve. Pesaba más que el contenido
// que acompaña, y una barra de navegación no es el protagonista de la
// pantalla — es de donde uno sale hacia otra parte.
//
// Acá los ítems son planos y el activo se marca solo con un fondo apenas
// perceptible. Lo único con color es el punto del logo, el de identidad
// verificada y el de novedad.
//
// El punto de novedad es VERDE. Antes era rojo, y el rojo en esta interfaz
// significa que algo salió mal: un referido pendiente no es un error.
// ─────────────────────────────────────────────────────────────

const C = {
  fondo: '#0A0C0B',
  borde: 'rgba(255,255,255,0.07)',
  activo: 'rgba(255,255,255,0.055)',
  hover: 'rgba(255,255,255,0.03)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  verde: '#4ADE80',
};
const FONT = "Archivo, system-ui, sans-serif";

// Iconos de trazo, monocromos, 20×20. Heredan el color del texto, así el
// mismo icono sirve activo e inactivo sin dos versiones.
const Ico: React.FC<{ d: string }> = ({ d }) => (
  <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d={d} />
  </svg>
);

const I = {
  casa: 'M3 8.5L10 3l7 5.5V16a1 1 0 01-1 1h-3.5v-5h-5v5H4a1 1 0 01-1-1z',
  avion: 'M17.5 2.5L2.5 8.7l5.6 2.2 2.2 5.6zM17.5 2.5L8.1 10.9',
  cambio: 'M3.5 7h13l-3-3M16.5 13h-13l3 3',
  reloj: 'M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10 6v4.2l2.8 1.6',
  personas: 'M7.5 9.5a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2zM2.5 16.5c0-2.2 2.2-3.6 5-3.6s5 1.4 5 3.6M13.5 4.6a2.6 2.6 0 010 5M14.8 13.2c1.7.4 2.7 1.5 2.7 3.3',
  tarjeta: 'M2.5 6a1.5 1.5 0 011.5-1.5h12A1.5 1.5 0 0117.5 6v8a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 14zM2.5 8.5h15M5 12.5h3',
  regalo: 'M3 9.5h14v7a1 1 0 01-1 1H4a1 1 0 01-1-1zM2.5 6.5h15v3h-15zM10 6.5v11M10 6.5S8.8 3 7 3a1.8 1.8 0 000 3.5zM10 6.5S11.2 3 13 3a1.8 1.8 0 010 3.5z',
  eslabon: 'M8.5 11.5a3 3 0 004.2 0l2.3-2.3a3 3 0 00-4.2-4.2l-.6.6M11.5 8.5a3 3 0 00-4.2 0L5 10.8a3 3 0 004.2 4.2l.6-.6',
  puerta: 'M12.5 6V4.5a1 1 0 00-1-1h-6a1 1 0 00-1 1v11a1 1 0 001 1h6a1 1 0 001-1V14M8.5 10h9m0 0l-2.5-2.5M17.5 10L15 12.5',
};

type Item = {
  clave: string;
  etiqueta: string;
  icono: string;
  activo?: boolean;
  onClick?: () => void;
  punto?: boolean;      // novedad
  pronto?: boolean;     // existe en el producto, todavía no en la app
};

const Fila: React.FC<{ it: Item }> = ({ it }) => {
  const [sobre, setSobre] = React.useState(false);
  const encendido = !!it.activo;
  const apagado = !!it.pronto;
  return (
    <button
      onClick={apagado ? undefined : it.onClick}
      disabled={apagado}
      aria-current={encendido ? 'page' : undefined}
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      className="lincoin-nav-item"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '10px 12px', borderRadius: 9, border: 'none', textAlign: 'left',
        background: encendido ? C.activo : (sobre && !apagado ? C.hover : 'transparent'),
        color: encendido ? C.text : (sobre && !apagado ? C.text : C.sub),
        fontFamily: FONT, fontSize: 14, fontWeight: encendido ? 600 : 500,
        cursor: apagado ? 'default' : 'pointer',
        opacity: apagado ? 0.55 : 1,
        transition: 'background 150ms, color 150ms',
      }}>
      <Ico d={it.icono} />
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.etiqueta}</span>
      {/* Punto de novedad. Verde: un referido pendiente es una buena noticia,
          no una alerta. */}
      {it.punto && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.verde, flexShrink: 0 }} />}
      {it.pronto && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', color: C.dim, flexShrink: 0 }}>PRONTO</span>}
    </button>
  );
};

type Props = {
  activeView: string;
  nombre: string;
  esEmpresa: boolean;
  kycVerificado: boolean;
  novedadReferidos?: boolean;
  irA: (v: string) => void;
  onEnviar: () => void;
  onConvertir: () => void;
  onPerfil: () => void;
  onLogout: () => void;
  abiertaMovil: boolean;
  cerrarMovil: () => void;
};

export const SidebarEmpresas: React.FC<Props> = ({
  activeView, nombre, esEmpresa, kycVerificado, novedadReferidos,
  irA, onEnviar, onConvertir, onPerfil, onLogout, abiertaMovil, cerrarMovil,
}) => {
  const ir = (v: string) => () => { irA(v); cerrarMovil(); };
  const inicial = String(nombre || 'L').trim().charAt(0).toUpperCase();

  const principales: Item[] = [
    { clave: 'dashboard', etiqueta: 'Inicio', icono: I.casa, activo: activeView === 'dashboard', onClick: ir('dashboard') },
    { clave: 'enviar', etiqueta: 'Enviar dinero', icono: I.avion, onClick: () => { onEnviar(); cerrarMovil(); } },
    { clave: 'convertir', etiqueta: 'Convertir', icono: I.cambio, onClick: () => { onConvertir(); cerrarMovil(); } },
    { clave: 'movements', etiqueta: 'Movimientos', icono: I.reloj, activo: activeView === 'movements', onClick: ir('movements') },
    { clave: 'contactos', etiqueta: 'Beneficiarios', icono: I.personas, activo: activeView === 'contactos', onClick: ir('contactos') },
    // Las tarjetas son parte del producto pero todavía no tienen pantalla.
    // Se muestra marcada como PRONTO en vez de llevar a ningún lado: un
    // enlace que no abre nada es peor que decir que aún no está.
    { clave: 'tarjetas', etiqueta: 'Tarjetas', icono: I.tarjeta, pronto: true },
  ];

  return (
    <>
      {/* Capa para cerrar en móvil. Solo aparece con la barra abierta. */}
      {abiertaMovil && (
        <div onClick={cerrarMovil} aria-hidden="true"
          className="lg:hidden"
          style={{ position: 'fixed', inset: 0, zIndex: 25, background: 'rgba(0,0,0,0.55)' }} />
      )}

      <aside
        className={`lincoin-sidebar ${abiertaMovil ? 'abierta' : ''}`}
        style={{
          width: 244, flexShrink: 0, background: C.fondo,
          borderRight: `1px solid ${C.borde}`,
          padding: '24px 14px 18px', display: 'flex', flexDirection: 'column',
          fontFamily: FONT,
        }}>
        {/* Logo — no se rediseña: wordmark Archivo 800 y el punto verde. */}
        <div style={{ padding: '0 10px 22px' }}>
          <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.6px', color: C.text, margin: 0, lineHeight: 1 }}>
            Lincoin<span style={{ color: C.verde }}>.</span>
          </p>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2.2px', color: C.sub, margin: '6px 0 0' }}>EMPRESAS</p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {principales.map(it => <Fila key={it.clave} it={it} />)}

          <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '2px', color: C.sub, margin: 0, padding: '22px 12px 7px' }}>DESCUBRE</p>
          <Fila it={{
            clave: 'referrals', etiqueta: 'Invita y gana', icono: I.regalo,
            activo: activeView === 'referrals', onClick: ir('referrals'), punto: !!novedadReferidos,
          }} />
          {/* "Aliados Lincoin", no "Aliados LINCOIN": la marca no va en
              mayúsculas dentro de la interfaz. */}
          <Fila it={{
            clave: 'affiliates', etiqueta: 'Aliados Lincoin', icono: I.eslabon,
            activo: activeView === 'affiliates', onClick: ir('affiliates'),
          }} />
        </nav>

        {/* Estado de la identidad, pegado abajo. Es lo que decide qué puede
            hacer la cuenta, así que vive a la vista y no dentro de Ajustes. */}
        <div style={{
          marginTop: 'auto', background: 'rgba(255,255,255,0.035)',
          border: `1px solid ${C.borde}`, borderRadius: 11, padding: '13px 14px',
        }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: C.text, margin: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: kycVerificado ? C.verde : C.sub, flexShrink: 0 }} />
            {kycVerificado ? 'Identidad verificada' : 'Verificación en curso'}
          </p>
          {kycVerificado ? (
            <p style={{ fontSize: 11, color: C.sub, margin: '4px 0 0', lineHeight: 1.45 }}>Nivel 2 · Límites completos activos</p>
          ) : (
            <p style={{ fontSize: 11, color: C.sub, margin: '4px 0 0', lineHeight: 1.45 }}>
              Mientras tanto, los límites están reducidos.{' '}
              <button onClick={() => { irA('profile'); cerrarMovil(); }}
                style={{ background: 'transparent', border: 'none', padding: 0, color: C.text, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline' }}>
                Completar
              </button>
            </p>
          )}
        </div>

        {/* Pie: quién está dentro, y la salida. */}
        <div style={{ borderTop: `1px solid ${C.borde}`, paddingTop: 12, marginTop: 14 }}>
          <button onClick={() => { onPerfil(); cerrarMovil(); }}
            className="lincoin-nav-item"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none', padding: '6px 6px', borderRadius: 9,
              cursor: 'pointer', fontFamily: FONT, marginBottom: 4,
            }}>
            <span style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(140deg, #2E3330, #1A1D1B)',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'grid', placeItems: 'center', color: C.sub, fontWeight: 800, fontSize: 12,
            }}>{inicial}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre || 'Mi cuenta'}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: C.sub }}>{esEmpresa ? 'Cuenta empresa' : 'Cuenta personal'}</span>
            </span>
          </button>

          <Fila it={{
            clave: 'logout', etiqueta: 'Cerrar sesión', icono: I.puerta,
            onClick: () => { if (window.confirm('¿Cerrar sesión?')) onLogout(); },
          }} />
        </div>
      </aside>

      <style>{`
        .lincoin-sidebar { height: 100vh; position: sticky; top: 0; }
        .lincoin-nav-item:focus-visible {
          outline: 2px solid rgba(74,222,128,0.5);
          outline-offset: 2px;
        }
        @media (max-width: 1023px) {
          .lincoin-sidebar {
            position: fixed; inset: 0 auto 0 0; z-index: 30;
            transform: translateX(-100%); transition: transform 260ms ease;
          }
          .lincoin-sidebar.abierta { transform: translateX(0); }
        }
      `}</style>
    </>
  );
};
