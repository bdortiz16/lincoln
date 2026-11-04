// Carnet de la consulta: la persona o empresa consultada como una tarjeta de
// identificación, con el riesgo a la vista. Debajo va el resto del resultado.
//
// Sarblock no entrega foto, así que va una silueta. Tampoco entrega el sexo de
// la persona: en vez de adivinarlo por el nombre (se equivoca y ofende), la
// silueta arranca neutra y quien consulta la puede cambiar; queda guardada en
// este navegador para ese documento.
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type Silueta = 'neutra' | 'hombre' | 'mujer';

const CLARO = { fondo: '#F4F4F2', tinta: '#15181A', sub: '#5F6661', linea: 'rgba(21,24,26,0.10)', foto: '#E4E6E2', figura: '#8A928C', figura2: '#646C66' };

const Figura: React.FC<{ s: Silueta | 'empresa' }> = ({ s }) => {
  if (s === 'empresa') return (
    <svg viewBox="0 0 120 140" width="100%" height="100%" aria-hidden>
      <rect x="22" y="38" width="50" height="102" rx="3" fill={CLARO.figura} />
      <rect x="72" y="68" width="30" height="72" rx="3" fill={CLARO.figura2} />
      {[0, 1, 2, 3, 4].map(r => [0, 1, 2].map(c => <rect key={`${r}${c}`} x={30 + c * 14} y={48 + r * 16} width="8" height="9" fill={CLARO.foto} />))}
      {[0, 1, 2].map(r => <rect key={r} x="80" y={78 + r * 16} width="14" height="8" fill={CLARO.foto} />)}
    </svg>
  );
  return (
    <svg viewBox="0 0 120 140" width="100%" height="100%" aria-hidden>
      {s === 'mujer' && <path d="M30 80c-5-36 6-64 30-64s35 28 30 64c-9 5-51 5-60 0z" fill={CLARO.figura2} />}
      <circle cx="60" cy="48" r="25" fill={CLARO.figura} />
      {s === 'hombre' && <path d="M35 42c0-17 11-27 25-27s25 10 25 25c-6-5-15-9-25-9s-19 4-25 11z" fill={CLARO.figura2} />}
      <path d="M14 140c2-33 22-49 46-49s44 16 46 49z" fill={CLARO.figura} />
    </svg>
  );
};

const clave = (doc: string) => `lr-silueta:${doc}`;
const leer = (doc: string): Silueta => {
  try { const v = localStorage.getItem(clave(doc)); return v === 'hombre' || v === 'mujer' ? v : 'neutra'; } catch { return 'neutra'; }
};

const fecha = (d?: string) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const Campo: React.FC<{ k: string; v: React.ReactNode; c?: string }> = ({ k, v, c }) => (
  <div style={{ padding: '6px 0', borderBottom: `1px solid ${CLARO.linea}` }}>
    <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: CLARO.sub, letterSpacing: '0.3px' }}>{k}</span>
    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: c ?? CLARO.tinta, lineHeight: 1.25, wordBreak: 'break-word' }}>{v}</span>
  </div>
);

export const Carnet: React.FC<{ consulta: any; nombre: string; tono: { t: string; c: string; corto: string } }> = ({ consulta, nombre, tono }) => {
  const empresa = consulta.tipoPersona === 'juridica' || consulta.tipoDocumento === 'NIT';
  const [silueta, setSilueta] = useState<Silueta>(() => leer(consulta.documento));
  const [qr, setQr] = useState<string | null>(null);
  const v = consulta.vence;
  const vencida = v?.estado === 'vencida';
  const fuentes: any[] = consulta.ficha?.sarblock?.catalog ?? [];
  const revisadas = fuentes.filter(x => x.status === 'CLEAR' || x.status === 'VERIFIED' || x.status === 'MATCH').length;

  useEffect(() => { setSilueta(leer(consulta.documento)); }, [consulta.documento]);
  // El QR lleva el resumen de la consulta (sin enlaces ni datos de más): sirve
  // para identificar el carnet impreso o en una captura.
  useEffect(() => {
    const texto = `Lincoin Risk · ${consulta.tipoDocumento} ${consulta.documento} · ${nombre} · Riesgo ${tono.corto} · ${fecha(consulta.at)} · ${consulta.id}`;
    QRCode.toDataURL(texto, { width: 160, margin: 1, errorCorrectionLevel: 'M', color: { dark: CLARO.tinta, light: '#FFFFFF' } }).then(setQr).catch(() => setQr(null));
  }, [consulta.id, consulta.documento, consulta.tipoDocumento, consulta.at, nombre, tono.corto]);

  const elegir = (s: Silueta) => {
    setSilueta(s);
    try { s === 'neutra' ? localStorage.removeItem(clave(consulta.documento)) : localStorage.setItem(clave(consulta.documento), s); } catch { /* sin almacenamiento: solo en esta vista */ }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ background: CLARO.fondo, color: CLARO.tinta, borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Banda: el wordmark sobre fondo oscuro y una franja del color del riesgo. */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 18px', background: 'linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)' }}>
          <span style={{ fontFamily: 'Archivo, system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.6px', color: '#F4F4F2', fontSize: 17 }}>Lincoin<span style={{ color: '#4ADE80' }}>.</span> <span style={{ fontWeight: 600, letterSpacing: 0, color: '#878E88', fontSize: 13 }}>Risk</span></span>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '1.6px', color: '#878E88' }}>{empresa ? 'EMPRESA' : 'PERSONA'} · DEBIDA DILIGENCIA</span>
          <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: tono.c }} />
        </div>

        <style>{`
          .lr-carnet { display: grid; grid-template-columns: 112px 1fr 92px; gap: 14px; padding: 14px 18px 10px }
          .lr-carnet-foto { height: 132px }
          .lr-carnet-lado { display: flex; flex-direction: column; align-items: center; gap: 8px }
          @media (max-width: 520px) {
            .lr-carnet { grid-template-columns: 84px 1fr; gap: 12px; padding: 12px 14px 8px }
            .lr-carnet-foto { height: 100px }
            .lr-carnet-lado { grid-column: 1 / -1; flex-direction: row; justify-content: space-between }
          }
        `}</style>
        <div className="lr-carnet">
          <div>
            <div className="lr-carnet-foto" style={{ borderRadius: 10, background: CLARO.foto, border: `1px solid ${CLARO.linea}`, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
              <Figura s={empresa ? 'empresa' : silueta} />
            </div>
            {!empresa && (
              <div style={{ display: 'flex', gap: 3, marginTop: 6, justifyContent: 'center' }} title="Silueta del carnet">
                {(['hombre', 'mujer'] as const).map(s => (
                  <button key={s} onClick={() => elegir(silueta === s ? 'neutra' : s)}
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${silueta === s ? CLARO.tinta : CLARO.linea}`, background: silueta === s ? CLARO.tinta : 'transparent', color: silueta === s ? '#F4F4F2' : CLARO.sub }}>
                    {s === 'hombre' ? 'Hombre' : 'Mujer'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <Campo k={empresa ? 'Razón social' : 'Nombre y apellidos'} v={nombre} />
            <Campo k="Documento" v={`${consulta.tipoDocumento} ${consulta.documento}`} />
            <Campo k="Consultado" v={`${fecha(consulta.at)}${consulta.por ? ` · ${consulta.por}` : ''}`} />
            <div style={{ padding: '6px 0' }}>
              <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: CLARO.sub, letterSpacing: '0.3px' }}>Vigencia</span>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: vencida ? '#B42318' : v?.estado === 'critico' || v?.estado === 'pronto' ? '#A15C07' : CLARO.tinta }}>
                {v ? (vencida ? `Vencida · ${fecha(v.venceAt)}` : `Hasta ${fecha(v.venceAt)} (${v.dias} días)`) : '—'}
              </span>
            </div>
          </div>
          <div className="lr-carnet-lado">
            <div style={{ width: 92, borderRadius: 10, background: tono.c, color: '#0A0B0A', textAlign: 'center', padding: '8px 4px' }}>
              <span style={{ display: 'block', fontSize: 9.5, fontWeight: 800, letterSpacing: '1.2px', opacity: 0.75 }}>RIESGO</span>
              <span style={{ display: 'block', fontSize: tono.corto.length > 7 ? 13 : 19, fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2, marginTop: 2 }}>{tono.corto}</span>
            </div>
            {qr && <img src={qr} alt="Código QR de la consulta" width={80} height={80} style={{ borderRadius: 6, border: `1px solid ${CLARO.linea}` }} />}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '4px 18px 12px', fontSize: 10.5, color: CLARO.sub }}>
          <span>{fuentes.length ? `${revisadas} de ${fuentes.length} fuentes revisadas` : 'Fuentes oficiales y listas restrictivas'}</span>
          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.5px' }}>N.º {String(consulta.id ?? '').slice(0, 8).toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
};
