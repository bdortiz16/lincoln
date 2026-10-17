// ══════════════════════════════════════════════════════════════════
//  Servicios · Lincoin Empresas
//
//  Reemplaza la versión anterior, que traía iconos con fondos de color (verde,
//  morado, rosa), pills amarillas de "Próximamente" y un panel de ayuda
//  gigante centrado. Nada de eso cumplía la paleta: el verde de Lincoin es
//  puntual —el punto del logo, un dato positivo, un CTA— y nunca un fondo
//  grande, mucho menos cinco fondos distintos en fila.
//
//  Los iconos son de trazo monocromo en un cuadro neutro. Así la fila se lee
//  como un sistema y no como cinco marcas peleando entre sí; y cuando uno está
//  desactivado, basta bajarle la opacidad para que se entienda.
// ══════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Layers, ScanSearch, ShoppingBag, TrendingUp, GraduationCap, Bell, Check } from 'lucide-react';

const FONT = 'Archivo, system-ui, sans-serif';

const C = {
  card: '#0C0E0D',
  text: '#F4F4F2',
  sub: '#878E88',
  bd: 'rgba(255,255,255,0.09)',
  bdHover: 'rgba(255,255,255,0.2)',
  green: '#4ADE80',
};

// Un solo cuadro para todos los iconos. Trazo 1.4 y remates redondos: los
// iconos de lucide son SVG de trazo, así que basta pasarles el grosor.
const Cuadro: React.FC<{ Icon: any; apagado?: boolean }> = ({ Icon, apagado }) => (
  <div
    style={{
      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
      background: 'rgba(255,255,255,0.045)',
      border: '1px solid rgba(255,255,255,0.08)',
      display: 'grid', placeItems: 'center',
      opacity: apagado ? 0.75 : 1,
    }}
  >
    <Icon size={19} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" color={C.text} />
  </div>
);

const ANILLO = '0 0 0 2px rgba(74,222,128,0.5)';

type Activo = { Icon: any; titulo: string; desc: string; cta: string; go: () => void };
type Proximo = { id: string; Icon: any; titulo: string; desc: string };

export const ServiciosSection: React.FC<{
  onBack: () => void;
  onOtc: () => void;
  onMultiwallet: () => void;
  onKyt: () => void;
  /** Avisos ya suscritos, para que el estado sobreviva a recargar la página. */
  avisos?: string[];
  onAvisar?: (id: string) => void;
}> = ({ onBack, onOtc, onMultiwallet, onKyt, avisos = [], onAvisar }) => {
  const [locales, setLocales] = useState<string[]>([]);
  const suscrito = (id: string) => avisos.includes(id) || locales.includes(id);

  const activos: Activo[] = [
    {
      Icon: ArrowLeftRight, titulo: 'Mesa OTC',
      desc: 'Operaciones de alto volumen con tasa negociada y ejecución acompañada por nuestro equipo.',
      cta: 'Solicitar cotización', go: onOtc,
    },
    {
      Icon: Layers, titulo: 'Multiwallet',
      desc: 'Varias billeteras USDC con nombre — ideal para separar proyectos, estudios y negocios.',
      cta: 'Crear billetera', go: onMultiwallet,
    },
    // KYT no estaba en el diseño porque todavía no existía cuando se escribió.
    // Va acá y no en próximamente: está funcionando.
    {
      Icon: ScanSearch, titulo: 'KYT',
      desc: 'Consulta si una dirección cripto está señalada por actividad ilícita antes de operar con ella.',
      cta: 'Consultar dirección', go: onKyt,
    },
  ];

  const proximos: Proximo[] = [
    { id: 'comercio', Icon: ShoppingBag, titulo: 'Comercio', desc: 'Cobra a tus clientes con links y botones de pago en USDC y EURC.' },
    // "Rendimientos", no "Staking": el nombre tiene que decir qué hace sin
    // pedirle al cliente que sepa jerga cripto.
    { id: 'rendimientos', Icon: TrendingUp, titulo: 'Rendimientos', desc: 'Genera rendimientos con tu saldo digital, sin bloquear tu dinero.' },
    { id: 'educacion', Icon: GraduationCap, titulo: 'Educación', desc: 'Paga matrículas y cursos en el exterior directo desde tu cuenta.' },
  ];

  const avisar = (id: string) => {
    if (suscrito(id)) return;
    setLocales(l => [...l, id]);
    onAvisar?.(id);
  };

  const label = (t: string) => (
    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: C.sub, margin: '0 0 12px' }}>{t}</p>
  );

  const grid: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12,
  };

  return (
    <div style={{ fontFamily: FONT, padding: '34px 44px 60px', maxWidth: 1060 }} className="animate-in fade-in duration-300">
      {/* ── Encabezado ── */}
      <div className="flex items-center" style={{ gap: 14, marginBottom: 8 }}>
        <button
          onClick={onBack}
          className="transition-colors hover:text-[#F4F4F2]"
          style={{ fontSize: 13.5, fontWeight: 600, color: C.sub, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; e.currentTarget.style.borderRadius = '6px'; }}
          onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
        >
          <ArrowLeft size={16} strokeWidth={1.6} /> Volver
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', color: C.text, margin: 0 }}>Servicios</h1>
      </div>
      <p style={{ fontSize: 13.5, color: C.sub, margin: '0 0 30px', maxWidth: 620, lineHeight: 1.6 }}>
        Herramientas adicionales de tu cuenta empresa. Los marcados como próximamente se activarán
        solos — te avisamos por correo.
      </p>

      {/* ── Disponibles ── */}
      <div style={{ marginBottom: 30 }}>
        {label('DISPONIBLES AHORA')}
        <div style={grid}>
          {activos.map(({ Icon, titulo, desc, cta, go }) => (
            <button
              key={titulo}
              onClick={go}
              className="text-left transition-colors"
              style={{
                background: C.card, border: `1px solid ${C.bd}`, borderRadius: 14,
                padding: 20, display: 'flex', gap: 14, alignItems: 'flex-start',
                cursor: 'pointer', fontFamily: FONT, width: '100%',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.bdHover; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.bd; }}
              onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }}
              onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
            >
              <Cuadro Icon={Icon} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 14.5, fontWeight: 700, color: C.text, margin: 0 }}>{titulo}</p>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.6 }}>{desc}</p>
                <span style={{ display: 'inline-block', fontSize: 12.5, fontWeight: 700, color: C.green, marginTop: 11 }}>
                  {cta} →
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Próximamente ── */}
      <div style={{ marginBottom: 30 }}>
        {label('PRÓXIMAMENTE')}
        <div style={grid}>
          {proximos.map(({ id, Icon, titulo, desc }) => {
            const ya = suscrito(id);
            return (
              // El borde punteado hace el trabajo que antes hacía la pill
              // amarilla: se ve desde lejos que la tarjeta no es tocable, sin
              // meter un color de alarma donde no hay ninguna alarma.
              <div
                key={id}
                style={{
                  background: 'transparent', border: '1px dashed rgba(255,255,255,0.13)',
                  borderRadius: 14, padding: 20, display: 'flex', gap: 14, alignItems: 'flex-start',
                }}
              >
                <Cuadro Icon={Icon} apagado />
                <div style={{ minWidth: 0 }}>
                  <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                    <p style={{ fontSize: 14.5, fontWeight: 700, color: 'rgba(244,244,242,0.85)', margin: 0 }}>{titulo}</p>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.sub,
                      border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '3px 9px',
                      whiteSpace: 'nowrap',
                    }}>PRÓXIMAMENTE</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.6 }}>{desc}</p>
                  <button
                    onClick={() => avisar(id)}
                    disabled={ya}
                    className={ya ? '' : 'transition-colors hover:text-[#F4F4F2]'}
                    style={{
                      marginTop: 11, background: 'none', border: 'none', padding: 0,
                      fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
                      color: ya ? C.green : C.sub,
                      cursor: ya ? 'default' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                    onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; e.currentTarget.style.borderRadius = '6px'; }}
                    onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
                  >
                    {ya
                      ? <><Check size={14} strokeWidth={1.8} /> Te avisaremos</>
                      : <><Bell size={14} strokeWidth={1.4} /> Avisarme cuando esté</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Ayuda ── */}
      <div
        className="flex items-center justify-between flex-wrap"
        style={{ background: C.card, border: `1px solid ${C.bd}`, borderRadius: 14, padding: '20px 24px', gap: 16 }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>¿Necesitas ayuda con un servicio?</p>
          <p style={{ fontSize: 13, color: C.sub, margin: '4px 0 0', lineHeight: 1.55 }}>
            Nuestro equipo responde en menos de 10 minutos, de lunes a sábado.
          </p>
        </div>
        <a
          href="mailto:soporte@lincoin.me"
          style={{
            background: C.text, color: '#0A0A0A', fontFamily: FONT,
            fontSize: 13.5, fontWeight: 700, borderRadius: 10,
            padding: '11px 20px', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
          }}
          onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }}
          onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
        >
          Contactar soporte
        </a>
      </div>
    </div>
  );
};

export default ServiciosSection;
