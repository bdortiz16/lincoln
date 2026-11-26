// Lincoin Risk tiene dos consultas: AML (personas y empresas, por cédula o
// NIT) y KYT (wallets de criptoactivos). Antes, entrar a Lincoin Risk abría
// directo la de personas y el KYT solo se encontraba por Servicios. El dueño
// pidió (23 nov) que al entrar se pregunte primero, en una ventana, cuál de
// las dos, y que se abra la elegida.
//
// La elección no se recuerda a propósito: cada entrada pregunta. Desde
// cualquiera de las dos se vuelve a la ventana con la flecha de arriba.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Users, Wallet, X } from 'lucide-react';
import { RiskCliente, C, Panel, Recarga, ESTILOS, llamar } from './RiskCliente';
import { Wordmark } from './Carnet';
import { KytSection } from '../KytSection';

type Modo = 'aml' | 'kyt';

const OPCIONES: { modo: Modo; sigla: string; titulo: string; texto: string; Icono: typeof Users }[] = [
  {
    modo: 'aml', sigla: 'AML', titulo: 'Personas y empresas', Icono: Users,
    texto: 'Listas restrictivas, procesos judiciales, antecedentes y PEP de una persona o empresa, con su cédula o NIT.',
  },
  {
    modo: 'kyt', sigla: 'KYT', titulo: 'Wallets', Icono: Wallet,
    texto: 'El riesgo de una dirección de criptoactivos: si está señalada, con qué puntaje y por qué.',
  },
];

const Ventana: React.FC<{ onElegir: (m: Modo) => void; onCerrar: () => void }> = ({ onElegir, onCerrar }) => {
  // El foco entra a la ventana, no a una opción: con el foco en AML se veía
  // como si ya estuviera elegida.
  const ventana = useRef<HTMLDivElement>(null);
  // onCerrar llega nuevo en cada render del tablero: con él en las
  // dependencias, el foco saltaba a la primera opción cada vez que el tablero
  // se refrescaba. El efecto corre una vez y lee la última versión.
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  useEffect(() => {
    ventana.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar.current(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(4,5,5,0.72)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto' }}>
      <style>{`
        .lr-op { transition: border-color .15s, background .15s, transform .15s; }
        .lr-op:hover { border-color: rgba(74,222,128,0.45) !important; background: #141715 !important; }
        .lr-op:focus-visible { outline: 2px solid #4ADE80; outline-offset: 2px; }
        .lr-op:hover .lr-flecha { color: #4ADE80 !important; transform: translateX(2px); }
        .lr-x:hover { color: #F4F4F2 !important; background: rgba(255,255,255,0.06) !important; }
        @media (max-width: 560px) { .lr-ops { grid-template-columns: minmax(0, 1fr) !important; } }
      `}</style>
      <div ref={ventana} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="lr-entrada-titulo" onClick={e => e.stopPropagation()}
        style={{ outline: 'none',
          width: 'min(580px, 100%)', boxSizing: 'border-box', borderRadius: 20, padding: '20px 22px 22px', color: C.texto,
          border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          background: 'radial-gradient(circle at 88% 0%, rgba(74,222,128,0.14), transparent 42%), linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Wordmark tam={17} />
          <button onClick={onCerrar} aria-label="Cerrar" className="lr-x"
            style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <X size={17} strokeWidth={1.8} />
          </button>
        </div>
        <h2 id="lr-entrada-titulo" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', margin: '16px 0 0' }}>¿Qué quieres revisar?</h2>
        <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.55 }}>
          Elige la consulta antes de operar.
        </p>

        <div className="lr-ops" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 18 }}>
          {OPCIONES.map(o => (
            <button key={o.modo} onClick={() => onElegir(o.modo)} className="lr-op"
              style={{ textAlign: 'left', fontFamily: 'inherit', color: C.texto, cursor: 'pointer', background: C.elevado, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: '16px 16px 15px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 170 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(74,222,128,0.12)', color: C.verde, display: 'grid', placeItems: 'center' }}>
                  <o.Icono size={19} strokeWidth={1.8} />
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.4px', color: C.sub, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '3px 9px' }}>{o.sigla}</span>
              </span>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.2px' }}>{o.titulo}</span>
              <span style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5, flex: 1 }}>{o.texto}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
                Consultar {o.sigla} <ArrowRight className="lr-flecha" size={15} strokeWidth={2} style={{ color: C.sub, transition: 'color .15s, transform .15s' }} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export const RiskEntrada: React.FC<{ onSalir: () => void }> = ({ onSalir }) => {
  const [modo, setModo] = useState<Modo | null>(null);
  // El KYT gasta las mismas consultas que AML (23 nov): su pantalla muestra
  // ese saldo y abre la misma recarga, sin pasar por la de personas.
  const [cuenta, setCuenta] = useState<any>(null);
  const [recarga, setRecarga] = useState(false);
  const refrescar = useCallback(async () => {
    const r = await llamar('risk_cuenta').catch(() => null);
    if (r?.ok) setCuenta(r);
  }, []);
  useEffect(() => { if (modo === 'kyt') refrescar(); }, [modo, refrescar]);

  if (modo === 'kyt') {
    return (
      <>
        <style>{ESTILOS}</style>
        <KytSection onBack={() => setModo(null)} volverA="Lincoin Risk"
          consultas={cuenta ? Number(cuenta.saldo ?? 0) : null}
          onSaldo={n => setCuenta((c: any) => (c ? { ...c, saldo: n } : c))}
          onRecargar={cuenta?.tienda ? () => setRecarga(true) : undefined} />
        <Panel titulo="Recargar consultas" abierto={recarga && !!cuenta?.tienda} cerrar={() => { setRecarga(false); refrescar(); }}>
          {cuenta?.tienda ? <Recarga cuenta={cuenta} listo={() => { setRecarga(false); refrescar(); }} /> : null}
        </Panel>
      </>
    );
  }
  if (modo === 'aml') {
    return (
      <>
        <div style={{ maxWidth: 860, margin: '18px auto -6px', padding: '0 4px' }}>
          <button onClick={() => setModo(null)}
            style={{ fontSize: 13, fontWeight: 600, color: C.sub, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
            <ArrowLeft size={15} strokeWidth={1.8} /> AML o KYT
          </button>
        </div>
        <RiskCliente />
      </>
    );
  }
  // Mientras no se elija, no se muestra ninguna de las dos debajo: la
  // ventana es lo primero que se ve.
  return <Ventana onElegir={setModo} onCerrar={onSalir} />;
};
