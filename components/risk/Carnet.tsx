// ── Lincoin Risk · la consulta como carnet ──────────────────────────────
// Pedido del dueño (2026-11): cada persona o empresa consultada se ve como un
// carnet, con su silueta, sus datos, el nivel de riesgo a la vista y las
// fuentes revisadas.
//
// Nada se inventa:
//   · el riesgo es el NIVEL (bajo, medio, alto) que dio la matriz, no un
//     puntaje: Sarblock no entrega un número y uno puesto acá parecería una
//     medida que nadie hizo;
//   · la silueta de una persona es neutra: el resultado no trae el sexo y
//     adivinarlo por el nombre sería suponer;
//   · el QR lleva la referencia real de la consulta (número, documento,
//     fecha y nivel), para cotejarla con el reporte PDF; no hay código de
//     barras porque no codificaría nada.
//
// Marca: el encabezado es negro Lincoin con el wordmark (el verde nunca es
// fondo grande); el color del riesgo va en la franja y en el sello.
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { digitoVerificacionNit } from '../../lib/nit';

export type Nivel = { k: string; t: string; sub: string; c: string };
// Colores sobre fondo claro (el cuerpo del carnet es claro).
const NIVELES: Record<string, Nivel> = {
  bajo: { k: 'bajo', t: 'Bajo', sub: 'Se puede operar', c: '#22A35C' },
  medio: { k: 'medio', t: 'Medio', sub: 'Revisar antes', c: '#C27803' },
  alto: { k: 'alto', t: 'Alto', sub: 'No operar', c: '#D93636' },
  revisar: { k: 'revisar', t: 'Revisar', sub: 'Nombre no corresponde', c: '#D93636' },
  sin_validar: { k: 'sin_validar', t: 'Revisar', sub: 'Identidad sin validar', c: '#C27803' },
  sin_verificar: { k: 'sin_verificar', t: '—', sub: 'Sin verificar', c: '#6B726C' },
};
// Mismo criterio que el veredicto de la pantalla (RiskCliente).
export function nivelDe(c: any): Nivel {
  const f = c?.ficha;
  if (c?.estado === 'no_verificado' || (f?.documentoNoEncontrado && !f?.hallazgo)) return NIVELES.sin_verificar;
  if (f?.nombreCoincide === false) return NIVELES.revisar;
  if (c?.operable === false || f?.operable === false || c?.categoria === 'alto' || f?.categoria === 'alto' || c?.grupo === 'alto') return NIVELES.alto;
  if (c?.categoria === 'medio' || f?.categoria === 'medio' || c?.grupo === 'medio') return NIVELES.medio;
  if (f?.categoria === 'sin_validar') return NIVELES.sin_validar;
  return NIVELES.bajo;
}

export const fechaCorta = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
};
// "CC 1.053.792.313" · "NIT 901.745.301-1" (el DV se calcula, no se supone).
export function documentoLegible(tipo: string, doc: string): string {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (!d) return `${tipo} ${doc ?? ''}`.trim();
  const miles = (x: string) => x.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (String(tipo).toUpperCase() === 'NIT') {
    const base = d.length === 10 ? d.slice(0, 9) : d;
    const dv = digitoVerificacionNit(base);
    return `NIT ${miles(base)}${dv != null ? `-${dv}` : ''}`;
  }
  return `${tipo} ${miles(d)}`;
}

// Las fuentes revisadas, para las fichas: primero las que dieron algo.
type Ficha = { texto: string; alerta: boolean; aviso?: boolean };
export function fichasDe(c: any): Ficha[] {
  const f = c?.ficha;
  const catalogo: any[] = f?.sarblock?.catalog ?? [];
  if (catalogo.length) {
    const conHallazgo = new Map<string, number>();
    for (const h of (f?.hallazgos ?? []) as any[]) if (h?.fuente) conHallazgo.set(String(h.fuente), (conHallazgo.get(String(h.fuente)) ?? 0) + 1);
    const out: Ficha[] = [];
    for (const [fuente, n] of conHallazgo) out.push({ texto: n > 1 ? `${fuente} (${n})` : fuente, alerta: true });
    for (const e of catalogo) {
      const label = String(e?.label ?? e?.code ?? '').trim();
      if (!label || conHallazgo.has(label)) continue;
      if (e.status === 'CLEAR' || e.status === 'VERIFIED') out.push({ texto: label, alerta: false });
      else if (e.status === 'UNAVAILABLE' || e.status === 'ERROR') out.push({ texto: `${label}: sin respuesta`, alerta: false, aviso: true });
    }
    return out;
  }
  // Sin la ficha (lista): los tipos de riesgo que quedaron guardados.
  const TIPOS: Record<string, string> = { sanciones: 'Listas restrictivas', judicial: 'Procesos judiciales', antecedentes: 'Antecedentes', pep: 'PEP', prensa: 'Prensa adversa', identidad: 'Identidad' };
  const riesgos = ((c?.riesgos ?? []) as string[]).filter(r => r !== 'ninguno');
  return riesgos.length ? riesgos.map(r => ({ texto: TIPOS[r] ?? r, alerta: true })) : [{ texto: 'Sin hallazgos', alerta: false }];
}

export const Silueta: React.FC<{ empresa: boolean; tam: number }> = ({ empresa, tam }) => empresa ? (
  <svg viewBox="0 0 80 96" width={tam} height={tam * 1.2} aria-hidden="true">
    <rect x="14" y="30" width="34" height="62" rx="2" fill="#7D8A99" />
    <rect x="50" y="50" width="18" height="42" rx="2" fill="#5D6B7B" />
    {[0, 1, 2, 3, 4].map(f => [0, 1, 2].map(k => <rect key={`${f}-${k}`} x={19 + k * 10} y={36 + f * 10} width="6" height="6" rx="1" fill="#E6EAEE" />))}
    {[0, 1, 2].map(f => <rect key={`b${f}`} x="55" y={56 + f * 10} width="8" height="5" rx="1" fill="#E6EAEE" />)}
  </svg>
) : (
  <svg viewBox="0 0 80 96" width={tam} height={tam * 1.2} aria-hidden="true">
    <circle cx="40" cy="34" r="17" fill="#8794A3" />
    <path d="M8 96c0-20 14.3-34 32-34s32 14 32 34z" fill="#8794A3" />
  </svg>
);

export const Wordmark: React.FC<{ tam: number }> = ({ tam }) => (
  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: tam * 0.35, whiteSpace: 'nowrap' }}>
    <span style={{ fontFamily: "Archivo, system-ui, sans-serif", fontWeight: 800, letterSpacing: '-0.6px', color: '#F4F4F2', fontSize: tam }}>Lincoin<span style={{ color: '#4ADE80' }}>.</span></span>
    <span style={{ fontFamily: "Archivo, system-ui, sans-serif", fontWeight: 600, color: 'rgba(244,244,242,0.75)', fontSize: tam * 0.85 }}>Risk</span>
  </span>
);

export const ESTILOS_CARNET = `
.lc-carnet { font-family: Archivo, system-ui, sans-serif; background: #121413; color: #15181A; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
.lc-cab { position: relative; background: #121413; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lc-cab::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 38%; background: repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0 9px, transparent 9px 18px); pointer-events: none; }
.lc-claro { background: #F4F5F3; }
.lc-cuerpo { display: grid; align-items: start; }
.lc-campo + .lc-campo { border-top: 1px solid rgba(21,24,26,0.08); }
.lc-lbl { display: block; font-size: 10px; font-weight: 600; color: #6B726C; }
.lc-val { display: block; font-weight: 700; color: #15181A; overflow-wrap: anywhere; }
.lc-ficha { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 3px 8px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 520px) {
  .lc-carnet-full .lc-cuerpo { grid-template-columns: 64px minmax(0, 1fr) !important; gap: 12px !important; padding: 14px 14px 10px !important; }
  .lc-carnet-full .lc-foto { height: 80px !important; }
  .lc-carnet-full .lc-foto svg { width: 56px; height: 67px; }
  .lc-carnet-full .lc-sello { grid-column: 1 / -1; flex-direction: row !important; justify-content: space-between; }
  .lc-carnet-full .lc-dd { display: none; }
}
`;

// ── Carnet completo (resultado de una consulta y detalle) ────────────────
export const CarnetRisk: React.FC<{ consulta: any }> = ({ consulta: c }) => {
  const nivel = nivelDe(c);
  const empresa = c?.tipoPersona === 'juridica' || String(c?.tipoDocumento).toUpperCase() === 'NIT';
  const nombre = c?.nombreOficial || c?.nombreEscrito || (nivel === NIVELES.sin_verificar ? 'Documento no encontrado' : 'Sin nombre');
  const vencida = c?.vence?.estado === 'vencida';
  const ref = String(c?.id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
  const fichas = fichasDe(c);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const texto = `Lincoin Risk · Ref ${ref} · ${documentoLegible(c?.tipoDocumento, c?.documento)} · consultado ${fechaCorta(c?.at)} · riesgo ${nivel.t.toLowerCase()}`;
    if (ref) QRCode.toDataURL(texto, { width: 160, margin: 1, errorCorrectionLevel: 'M' }).then(u => { if (vivo) setQr(u); }).catch(() => {});
    return () => { vivo = false; };
  }, [ref, c?.tipoDocumento, c?.documento, c?.at, nivel.t]);
  return (
    <div className="lc-carnet lc-carnet-full">
      <style>{ESTILOS_CARNET}</style>
      <div className="lc-cab" style={{ padding: '13px 18px' }}>
        <Wordmark tam={17} />
        <span style={{ position: 'relative', zIndex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', color: 'rgba(244,244,242,0.7)', textAlign: 'right', whiteSpace: 'nowrap' }}>{empresa ? 'EMPRESA' : 'PERSONA'}<span className="lc-dd"> · DEBIDA DILIGENCIA</span></span>
      </div>
      <div style={{ height: 4, background: nivel.c }} />
      <div className="lc-claro">
      <div className="lc-cuerpo" style={{ gridTemplateColumns: '112px minmax(0, 1fr) 118px', gap: 16, padding: '16px 18px 12px' }}>
        <div className="lc-foto" style={{ height: 136, borderRadius: 12, background: 'linear-gradient(180deg, #E3E7EB, #CDD3DA)', border: '1px solid rgba(21,24,26,0.08)', display: 'grid', placeItems: 'end center', overflow: 'hidden' }}>
          <Silueta empresa={empresa} tam={empresa ? 78 : 92} />
        </div>
        <div style={{ minWidth: 0 }}>
          {[
            [empresa ? 'Razón social' : 'Nombre y apellidos', nombre, false],
            ['Documento', documentoLegible(c?.tipoDocumento, c?.documento), false],
            ['Consultado', `${fechaCorta(c?.at)}${c?.por ? ` · ${c.por}` : ''}`, false],
            ['Vence', vencida ? `Vencida · ${fechaCorta(c?.vence?.venceAt)}` : fechaCorta(c?.vence?.venceAt), vencida],
          ].map(([l, v, rojo]) => (
            <div key={String(l)} className="lc-campo" style={{ padding: '6px 0' }}>
              <span className="lc-lbl">{l as string}</span>
              <span className="lc-val" style={{ fontSize: l === 'Nombre y apellidos' || l === 'Razón social' ? 15 : 13.5, color: rojo ? '#D93636' : undefined }}>{v as string}</span>
            </div>
          ))}
        </div>
        <div className="lc-sello" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ width: '100%', borderRadius: 12, background: nivel.c, color: '#FFFFFF', textAlign: 'center', padding: '9px 6px 10px' }}>
            <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', opacity: 0.9 }}>RIESGO</span>
            <span style={{ display: 'block', fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1.15 }}>{nivel.t}</span>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, opacity: 0.92 }}>{nivel.sub}</span>
          </div>
          {qr && (
            <div style={{ textAlign: 'center' }}>
              <img src={qr} alt={`Referencia de la consulta ${ref}`} width={84} height={84} style={{ display: 'block', borderRadius: 8, border: '1px solid rgba(21,24,26,0.1)', background: '#FFF', padding: 3 }} />
              <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.8px', color: '#6B726C', marginTop: 4 }}>REF. {ref}</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '0 18px 15px' }}>
        {fichas.slice(0, 8).map((x, i) => (
          <span key={i} className="lc-ficha" title={x.texto}
            style={x.alerta ? { background: 'rgba(217,54,54,0.1)', color: '#B42318' } : x.aviso ? { background: 'rgba(194,120,3,0.1)', color: '#8A5502' } : { background: 'rgba(21,24,26,0.06)', color: '#3B423D' }}>
            {x.alerta ? '⚠' : x.aviso ? '·' : '✓'} {x.texto}
          </span>
        ))}
        {fichas.length > 8 && <span className="lc-ficha" style={{ background: 'rgba(21,24,26,0.06)', color: '#3B423D' }}>+{fichas.length - 8} fuentes</span>}
        {c?.deCache && <span className="lc-ficha" style={{ background: 'rgba(21,24,26,0.06)', color: '#6B726C' }}>Del padrón Lincoin Risk</span>}
      </div>
      </div>
    </div>
  );
};
