// ══════════════════════════════════════════════════════════════════
//  Reporte de riesgo AML de un análisis de SARBLOCK — marca Lincoin.
//
//  El dueño compartió el informe que Sarblock genera en su plataforma
//  (SARBLOCK-WAL-2026-000001, 23 nov) y pidió que el de Lincoin fuera igual:
//  portada con el puntaje y la conclusión, la ficha, por qué el puntaje,
//  hallazgos, de dónde viene el dinero, actividad, qué se revisó,
//  trazabilidad, notas y autenticidad. Esta es esa estructura con la marca de
//  Lincoin (wordmark, negro y verde Lincoin, Archivo).
//
//  LO QUE NO TRAE LA API NO SE DIBUJA. El PDF de Sarblock se arma dentro de su
//  plataforma y muestra cosas que la API de wallets no devuelve: los
//  hallazgos informativos ("no suma"), los puntos de cada hallazgo (+20), las
//  rutas con montos, la gráfica mensual, la fecha de cada lista y su código de
//  verificación. Inventarlas para que "se vea igual" sería poner en un
//  documento que se presenta ante bancos datos que nadie dio. Donde falta, se
//  dice por qué.
//
//  Se imprime con el diálogo del navegador (texto seleccionable, vectorial),
//  como el reporte de MistTrack (KytReporte.tsx). El encabezado y el número de
//  página de cada hoja van en los márgenes de la página (@page); un navegador
//  que no los soporta imprime igual, sin ellos.
// ══════════════════════════════════════════════════════════════════
import React from 'react';
import { createPortal } from 'react-dom';
import {
  recomendacionSb, nivelSarblockEs, severidadEs, confianzaEs, senalEs, categoriaSbEs,
  descripcionSenalSb, conclusionSb, ESCALA_SB, chequeosSb, caminoDe,
} from '../lib/kytTextos';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const T = {
  tinta: '#15181A',
  suave: '#5C625E',
  tenue: '#9B9F9B',
  linea: 'rgba(21,24,26,0.12)',
  fondo: '#F5F6F5',
  verde: '#22A35C',
  verdeVivo: '#4ADE80',
};

// Color de cada nivel: el vivo va sobre la portada oscura, el otro sobre papel.
const COLOR_NIVEL: Record<string, { vivo: string; papel: string; suave: string }> = {
  NONE: { vivo: '#4ADE80', papel: '#22A35C', suave: 'rgba(34,163,92,0.12)' },
  LOW: { vivo: '#4ADE80', papel: '#22A35C', suave: 'rgba(34,163,92,0.12)' },
  MEDIUM: { vivo: '#F2B84B', papel: '#B7791F', suave: 'rgba(183,121,31,0.13)' },
  HIGH: { vivo: '#FB923C', papel: '#C2410C', suave: 'rgba(194,65,12,0.12)' },
  EXTREME: { vivo: '#F87171', papel: '#C0392B', suave: 'rgba(192,57,43,0.12)' },
  CRITICAL: { vivo: '#F87171', papel: '#C0392B', suave: 'rgba(192,57,43,0.12)' },
};
const colorNivel = (l: any) => COLOR_NIVEL[String(l ?? '').toUpperCase()] ?? { vivo: '#9BA19C', papel: T.suave, suave: T.fondo };
const ORDEN_SEV: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
// La severidad de una señal usa la misma paleta que el nivel del puntaje.
const colorSev = (s: any) => {
  const l = String(s ?? '').toUpperCase();
  return colorNivel(l === 'CRITICAL' ? 'EXTREME' : l);
};

const usd = (v: any) => v == null || !Number.isFinite(Number(v)) ? null
  : `USD ${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
const entero = (v: any) => v == null || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString('es-CO');
const corta = (a?: string | null) => {
  const s = String(a ?? '');
  return s.length > 16 ? `${s.slice(0, 6)}…${s.slice(-6)}` : (s || '—');
};
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
// Las fechas, en hora de Colombia y con el mes en palabras (como el informe
// de Sarblock): "22 nov 2026" y "11:04 p. m.".
const enBogota = (t?: string | null) => {
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 5 * 3600_000); // Colombia: UTC−5, sin horario de verano
};
const dia = (t?: string | null) => {
  const d = enBogota(t);
  return d ? `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';
};
const hora = (t?: string | null) => {
  const d = enBogota(t);
  if (!d) return '';
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const diaHora = (t?: string | null) => (t ? `${dia(t)}, ${hora(t)}` : '—');
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Lo que va dentro del CSS de @page (encabezado y pie de cada hoja): solo
// caracteres que no puedan cerrar la cadena ni la regla.
const paraCss = (s: any) => String(s ?? '').replace(/[^\p{L}\p{N} .,·:()\-–@/]/gu, '').slice(0, 90);

// ── Piezas ──────────────────────────────────────────────────────────

// El puntaje como el anillo de segmentos del informe: los llenos son el
// puntaje sobre 100, con el color de su nivel.
const Anillo: React.FC<{ valor: number | null; level: string }> = ({ valor, level }) => {
  const N = 26, R1 = 50, R2 = 62, cx = 70, cy = 70;
  const llenos = valor == null ? 0 : Math.max(valor > 0 ? 1 : 0, Math.round((Math.min(100, Math.max(0, valor)) / 100) * N));
  const c = colorNivel(level).vivo;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true" style={{ display: 'block' }}>
      {Array.from({ length: N }, (_, i) => {
        // Empieza abajo a la izquierda y gira como las agujas del reloj.
        const a = ((i / N) * 360 + 200) * (Math.PI / 180);
        return (
          <line key={i}
            x1={cx + R1 * Math.cos(a)} y1={cy + R1 * Math.sin(a)}
            x2={cx + R2 * Math.cos(a)} y2={cy + R2 * Math.sin(a)}
            stroke={i < llenos ? c : 'rgba(255,255,255,0.10)'} strokeWidth={7} strokeLinecap="round" />
        );
      })}
    </svg>
  );
};

const Seccion: React.FC<{ n: string; titulo: string; meta?: React.ReactNode; children: React.ReactNode; salto?: boolean }> = ({ n, titulo, meta, children, salto }) => (
  <section style={{ marginTop: 26, ...(salto ? { breakBefore: 'page' as const } : {}) }}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${T.linea}`, paddingBottom: 8, marginBottom: 12, breakAfter: 'avoid' }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.tinta, letterSpacing: '-0.2px' }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: T.verde, marginRight: 10 }}>{n}</span>{titulo}
      </h2>
      {meta ? <span style={{ fontSize: 10, color: T.tenue, textAlign: 'right' }}>{meta}</span> : null}
    </div>
    {children}
  </section>
);

const Dato: React.FC<{ rot: string; valor: React.ReactNode; sub?: React.ReactNode; punto?: string }> = ({ rot, valor, sub, punto }) => (
  <div style={{ padding: '10px 12px 10px 0' }}>
    <p style={{ fontSize: 9, color: T.tenue, margin: 0 }}>{rot}</p>
    <p style={{ fontSize: 11.5, fontWeight: 700, color: T.tinta, margin: '3px 0 0', lineHeight: 1.3, display: 'flex', alignItems: 'baseline', gap: 6 }}>
      {punto ? <span style={{ width: 7, height: 7, borderRadius: 7, background: punto, flexShrink: 0, transform: 'translateY(-1px)' }} /> : null}
      <span>{valor}</span>
    </p>
    {sub ? <p style={{ fontSize: 9.5, color: T.suave, margin: '3px 0 0', lineHeight: 1.45 }}>{sub}</p> : null}
  </div>
);

const Grilla: React.FC<{ children: React.ReactNode; borde?: boolean }> = ({ children, borde = true }) => (
  <div className="sb-grilla" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', borderBottom: borde ? `1px solid ${T.linea}` : 'none', breakInside: 'avoid' }}>
    {children}
  </div>
);

// El cuadrito de color de cada hallazgo, con un símbolo que no depende del color.
const Icono: React.FC<{ sev: any; simbolo: string }> = ({ sev, simbolo }) => {
  const c = colorSev(sev);
  return (
    <div style={{ width: 26, height: 26, borderRadius: 7, background: c.papel, color: '#FFFFFF', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
      {simbolo}
    </div>
  );
};

const Chip: React.FC<{ sev: any; children: React.ReactNode }> = ({ sev, children }) => {
  const c = colorSev(sev);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 700, color: c.papel, background: c.suave, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: 5, background: c.papel }} />{children}
    </span>
  );
};

const Nota: React.FC<{ t: string; children: React.ReactNode }> = ({ t, children }) => (
  <div style={{ breakInside: 'avoid', marginBottom: 10 }}>
    <p style={{ fontSize: 10, fontWeight: 800, color: T.tinta, margin: 0 }}>{t}</p>
    <p style={{ fontSize: 9.5, color: T.suave, margin: '2px 0 0', lineHeight: 1.55 }}>{children}</p>
  </div>
);

// ── El reporte ──────────────────────────────────────────────────────

export const KytReporteSarblock: React.FC<{ d: any; onClose: () => void }> = ({ d, onClose }) => {
  const sb = d.sarblock ?? {};
  // La constancia es la del último archivo de la dirección: solo respalda
  // este reporte si es de SARBLOCK y del mismo análisis. La de un MistTrack
  // anterior o la de otro análisis tiene otra huella.
  const k = d.constancia?.proveedor === 'sarblock'
    && (!d.constancia.analisisId || !sb.analisisId || d.constancia.analisisId === sb.analisisId)
    ? d.constancia : null;
  const cad = d.cadena;
  const empresa: string = d.empresa || 'la empresa';
  const rec = recomendacionSb(sb.recomendacion);
  const score = sb.score ?? {};
  const valor: number | null = Number.isFinite(Number(score.value)) ? Number(score.value) : null;
  const level = String(score.level ?? '').toUpperCase();
  const cNivel = colorNivel(level);
  const nivelPuntaje = nivelSarblockEs(level);
  const red = sb.network || sb.family || d.coin;

  const senales: any[] = [...(sb.senales ?? [])].sort((a, b) =>
    (ORDEN_SEV[String(b.severity).toUpperCase()] ?? 0) - (ORDEN_SEV[String(a.severity).toUpperCase()] ?? 0)
    || Number(b.exposureUsd ?? 0) - Number(a.exposureUsd ?? 0));
  const masPesa = senales[0] ?? null;

  // Por categoría, como "Por qué 32 de 100" del informe: sin los puntos de
  // cada una, que la API no devuelve.
  const grupos = Object.values(senales.reduce((acc: Record<string, any>, s) => {
    const key = categoriaSbEs(s.category);
    const g = acc[key] ?? (acc[key] = { nombre: key, n: 0, sev: s.severity, expo: 0 });
    g.n += 1;
    if ((ORDEN_SEV[String(s.severity).toUpperCase()] ?? 0) > (ORDEN_SEV[String(g.sev).toUpperCase()] ?? 0)) g.sev = s.severity;
    g.expo += Number(s.exposureUsd ?? 0);
    return acc;
  }, {})) as any[];

  // Exposición a contrapartes de riesgo: solo las señales de ese tipo. El
  // monto de un patrón de comportamiento ("lo que recibe sale casi de
  // inmediato") es lo que se movió, no plata expuesta a una wallet de riesgo.
  const deContraparte = senales.filter(s => /MIXER|SANCTION|SCAM|HACK|DARKNET|RANSOM|PHISH|FROZEN|FREEZE|TERROR|GAMBLING|STOLEN|FRAUD/i.test(`${s.code} ${s.category ?? ''}`));
  const expoRiesgo = deContraparte.reduce((t, s) => t + Number(s.exposureUsd ?? 0), 0);
  const enListas = senales.filter(s => /SANCTION|FROZEN|FREEZE|BLACKLIST/i.test(`${s.code} ${s.category ?? ''}`));
  const sinListas = enListas.length === 0;
  const pctEx: number | null = Number.isFinite(Number(sb.exposicion?.exchangeSharePct)) ? Number(sb.exposicion.exchangeSharePct) : null;
  const ch = chequeosSb(sb.chequeos);
  const total = Number(sb.chequeos?.total);
  const limpios = Number(sb.chequeos?.clean);
  const duro = sb.requestedAt && sb.completedAt
    ? Math.max(0, Math.round((new Date(sb.completedAt).getTime() - new Date(sb.requestedAt).getTime()) / 1000)) : null;

  const antig = cad?.creada ? Math.floor((Date.now() - new Date(cad.creada).getTime()) / 86_400_000) : null;
  const rutas: any[] = (d.rutas?.rutas ?? []).slice(0, 8);

  // Trazabilidad: solo fechas que existen, en orden.
  const pasos = [
    sb.requestedAt && { at: sb.requestedAt, que: 'Se pidió el análisis a SARBLOCK', det: d.delPadron ? 'Análisis guardado en el padrón de Lincoin' : null, quien: empresa },
    sb.completedAt && { at: sb.completedAt, que: 'SARBLOCK terminó el análisis', det: `${nivelPuntaje} · ${valor ?? '—'} de 100 · ${rec?.codigo ?? sb.recomendacion ?? '—'}`, quien: 'SARBLOCK · automático' },
    k?.archivadoAt && { at: k.archivadoAt, que: 'Lincoin archivó la respuesta original', det: k.sha256 ? `Huella SHA-256 ${String(k.sha256).slice(0, 8)}…${String(k.sha256).slice(-4)}` : null, quien: 'Lincoin · automático' },
    d.generadoAt && { at: d.generadoAt, que: 'Se generó este reporte', det: `Solicitado por ${empresa}`, quien: empresa },
  ].filter(Boolean).sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime()) as any[];

  // Encabezado y pie de cada hoja impresa. El primero lleva la portada, así
  // que el de margen solo dice qué documento es y de qué dirección.
  const cssPagina = `
    @media print {
      @page kytsb {
        size: letter; margin: 16mm 13mm 16mm;
        @top-left { content: "Lincoin · Reporte de riesgo AML"; font: 700 8pt Archivo, sans-serif; color: #15181A; }
        @top-right { content: "${paraCss(red)} · ${paraCss(corta(d.address))} · ${paraCss(dia(d.generadoAt))}"; font: 400 8pt Archivo, sans-serif; color: #5C625E; }
        @bottom-left { content: "Análisis on-chain provisto por SARBLOCK · ${paraCss(sb.analisisId)}"; font: 400 7.5pt Archivo, sans-serif; color: #9B9F9B; }
        @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 400 7.5pt Archivo, sans-serif; color: #5C625E; }
      }
      /* La primera hoja ya trae la cabecera completa: sin repetirla arriba. */
      @page kytsb:first { @top-left { content: none; } @top-right { content: none; } }
      #lincoin-reporte.reporte-sb { page: kytsb; }
    }
    @media screen and (max-width: 720px) {
      #lincoin-reporte.reporte-sb .sb-grilla { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
      #lincoin-reporte.reporte-sb .sb-dos { grid-template-columns: minmax(0, 1fr) !important; }
    }`;

  return createPortal(
    <div className="fixed inset-0 lincoin-print-root" style={{ zIndex: 90, background: 'rgba(4,5,5,0.8)', overflow: 'auto' }}>
      <style>{cssPagina}</style>
      <div className="no-imprimir flex items-center justify-between flex-wrap"
        style={{ gap: 12, position: 'sticky', top: 0, padding: '12px 18px', background: '#0C0E0D', borderBottom: '1px solid rgba(255,255,255,0.12)', fontFamily: FONT, zIndex: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>Reporte de riesgo AML</span>
        <div className="flex items-center" style={{ gap: 10 }}>
          <button onClick={() => window.print()}
            style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, background: '#F4F4F2', color: '#0A0A0A', border: 'none', borderRadius: 9, padding: '10px 18px', cursor: 'pointer' }}>
            Guardar como PDF
          </button>
          <button onClick={onClose}
            style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, background: 'none', color: '#878E88', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '10px 16px', cursor: 'pointer' }}>
            Cerrar
          </button>
        </div>
      </div>

      <div id="lincoin-reporte" className="reporte-sb" style={{ fontFamily: FONT, color: T.tinta, background: '#FFFFFF', maxWidth: 860, margin: '20px auto', padding: '30px 34px 36px' }}>

        {/* ── Cabecera: Lincoin a la izquierda, quién hizo el análisis a la
            derecha (con su logo, sobre su recuadro oscuro: sus letras son
            blancas y no se alteran; ver CLAUDE.md). ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${T.linea}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.6px', color: T.tinta }}>
              Lincoin<span style={{ color: T.verde }}>.</span>
            </span>
            <span style={{ width: 1, height: 18, background: T.linea }} />
            <span style={{ fontSize: 11, color: T.suave }}>Reporte de riesgo AML</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 7.5, fontWeight: 700, color: T.tenue, margin: 0, letterSpacing: '0.6px' }}>ANÁLISIS ON-CHAIN PROVISTO POR</p>
              <p style={{ fontSize: 9, color: T.suave, margin: '2px 0 0' }}>Emitido para {empresa} · {diaHora(d.generadoAt)}, hora de Colombia</p>
            </div>
            <div style={{ background: '#141615', color: '#F4F4F2', padding: '7px 10px', borderRadius: 6, lineHeight: 0 }}>
              <img src="/aliados/sarblock.png" alt="SARBLOCK" width={124} height={16}
                style={{ width: 124, height: 'auto', display: 'block', fontSize: 11, fontWeight: 800, lineHeight: 1.2 }} />
            </div>
          </div>
        </div>

        {/* ── Portada: negro Lincoin con el glow verde de la marca. ── */}
        <div style={{
          marginTop: 18, borderRadius: 16, padding: '22px 24px 20px', color: '#F4F4F2', breakInside: 'avoid',
          background: 'radial-gradient(circle at 88% 8%, rgba(74,222,128,0.20), transparent 46%), linear-gradient(135deg, #161A17 0%, #0C0E0D 60%, #0A0B0A 100%)',
        }}>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'rgba(244,244,242,0.55)', margin: 0, textTransform: 'uppercase' }}>
            <span style={{ color: T.verdeVivo }}>◆</span> Análisis de wallet · {empresa}
          </p>
          <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.5px', margin: '6px 0 0' }}>Reporte de riesgo AML</h1>

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 11, padding: '10px 14px' }}>
            <span style={{ width: 30, height: 30, borderRadius: 30, border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, fontWeight: 800, color: '#F4F4F2', flexShrink: 0, fontFamily: MONO }}>
              {String(d.coin ?? '').slice(0, 4)}
            </span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 700, margin: 0, wordBreak: 'break-all' }}>{d.address}</p>
              <p style={{ fontSize: 9.5, color: 'rgba(244,244,242,0.55)', margin: '2px 0 0' }}>
                {red} · analizada el {diaHora(sb.completedAt ?? d.consultadoAt)}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
              <Anillo valor={valor} level={level} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1 }}>{valor ?? '—'}</span>
                <span style={{ fontSize: 9.5, marginTop: 4, color: 'rgba(244,244,242,0.6)' }}>
                  <b style={{ color: cNivel.vivo }}>Riesgo {nivelPuntaje.toLowerCase()}</b> · de 100
                </span>
              </div>
            </div>
            <div style={{ flex: '1 1 300px', minWidth: 0 }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: T.verdeVivo, margin: 0 }}>● CONCLUSIÓN</p>
              <p style={{ fontSize: 21, fontWeight: 800, margin: '5px 0 0', letterSpacing: '-0.3px' }}>{conclusionSb(sb.recomendacion)}</p>
              <p style={{ fontSize: 10.5, color: 'rgba(244,244,242,0.65)', margin: '4px 0 0', lineHeight: 1.5 }}>
                {masPesa
                  ? <>Lo que más pesa: {senalEs(masPesa.code, masPesa.category)}.</>
                  : (rec?.detalle ?? 'SARBLOCK no devolvió una recomendación.')}
                {' '}Recomendación de SARBLOCK: <span style={{ fontFamily: MONO, color: '#F4F4F2' }}>{rec?.codigo ?? sb.recomendacion ?? '—'}</span>.
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                {ESCALA_SB.map(e => {
                  const activa = e.level === level;
                  const c = colorNivel(e.level);
                  return (
                    <span key={e.level} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, borderRadius: 20, padding: '4px 10px',
                      background: activa ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${activa ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'}`,
                      color: activa ? '#F4F4F2' : 'rgba(244,244,242,0.5)', fontWeight: activa ? 700 : 500,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: 2, background: c.vivo, opacity: activa ? 1 : 0.6 }} />
                      {e.nombre} {e.rango}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Ficha ── */}
        <div style={{ marginTop: 6 }}>
          <Grilla>
            <Dato rot="Nivel de riesgo" valor={nivelSarblockEs(sb.riskLevel ?? d.nivel)} sub={rec ? rec.titulo : null} />
            <Dato rot="Solicitado por" valor={empresa} sub="Cliente de Lincoin" />
            <Dato rot="Confianza del análisis" valor={cap(confianzaEs(score.confidence))}
              sub={sb.degraded ? 'Parte de la evidencia no se pudo consultar' : 'Sin fuentes caídas'} />
            <Dato rot="Análisis" valor={sb.analisisId ? 'Completo' : '—'}
              sub={duro != null ? `Tardó ${duro} ${duro === 1 ? 'segundo' : 'segundos'}` : null} />
          </Grilla>
          <Grilla>
            <Dato rot="Listas" punto={sinListas ? T.verde : COLOR_NIVEL.EXTREME.papel}
              valor={sinListas ? 'Sin sanciones ni congelamientos' : `${enListas.length} ${enListas.length === 1 ? 'hallazgo' : 'hallazgos'} en listas`} />
            <Dato rot="Exposición a exchanges" punto={T.tenue}
              valor={pctEx != null ? `${entero(pctEx)} % de lo recibido` : 'Sin dato'} sub={pctEx != null ? 'Últimos 12 meses' : null} />
            <Dato rot="Hallazgos" punto={senales.length ? colorSev(masPesa?.severity).papel : T.verde}
              valor={senales.length ? `${senales.length} ${senales.length === 1 ? 'suma' : 'suman'} riesgo` : 'Ninguno suma riesgo'} />
            <Dato rot="Chequeos" punto={sb.chequeos?.flagged?.length ? COLOR_NIVEL.MEDIUM.papel : T.verde}
              valor={Number.isFinite(total) ? `${Number.isFinite(limpios) ? limpios : '—'} de ${total} sin hallazgos` : 'Sin dato'} />
          </Grilla>
        </div>

        {/* ── 01 Por qué ── */}
        <Seccion n="01" titulo={`Por qué ${valor ?? '—'} de 100`} meta="Metodología de SARBLOCK">
          <p style={{ fontSize: 10.5, color: T.suave, margin: 0, lineHeight: 1.6 }}>
            El puntaje va de 0 a 100 y sube con el riesgo. Cada hallazgo suma según qué tan grave es, qué tan
            cerca está de la wallet, cuánto de su dinero toca y qué tan reciente es. Una sanción o un
            congelamiento vigente deja el puntaje en 90 o más, y un hackeo documentado en 70 o más.
            {score.floor != null ? <> <b style={{ color: T.tinta }}>En este análisis se aplicó el piso de {score.floor}.</b></> : null}
          </p>
          <p style={{ fontSize: 10.5, color: T.tinta, margin: '8px 0 10px', lineHeight: 1.6 }}>
            {senales.length
              ? <>{senales.length} {senales.length === 1 ? 'hallazgo suma' : 'hallazgos suman'} riesgo. El que más pesa es <b>«{senalEs(masPesa.code, masPesa.category)}»</b>.</>
              : <>Ningún hallazgo suma riesgo.</>}
          </p>
          {grupos.map(g => (
            <div key={g.nombre} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: `1px solid ${T.linea}`, breakInside: 'avoid' }}>
              <Icono sev={g.sev} simbolo="≡" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11, fontWeight: 700, margin: 0 }}>{g.nombre}</p>
                <p style={{ fontSize: 9.5, color: T.tenue, margin: '1px 0 0' }}>
                  {g.n} {g.n === 1 ? 'señal' : 'señales'}{g.expo > 0 ? ` · ${usd(g.expo)}` : ''}
                </p>
              </div>
              <Chip sev={g.sev}>{cap(severidadEs(g.sev))}</Chip>
            </div>
          ))}
          {sb.degraded ? (
            <p style={{ fontSize: 9.5, color: COLOR_NIVEL.MEDIUM.papel, margin: '8px 0 0', lineHeight: 1.5 }}>
              Parte de la evidencia no se pudo consultar: el resultado es válido, pero menos completo.
            </p>
          ) : null}
        </Seccion>

        {/* ── 02 Hallazgos ── */}
        <Seccion n="02" titulo="Hallazgos" meta={senales.length ? `${senales.length} ${senales.length === 1 ? 'suma' : 'suman'} riesgo` : 'Ninguno suma riesgo'}>
          {senales.length === 0 ? (
            <p style={{ fontSize: 10.5, color: T.suave, margin: 0, lineHeight: 1.6 }}>
              SARBLOCK no reportó hallazgos que sumen riesgo para esta dirección.
            </p>
          ) : senales.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 0', borderTop: i ? `1px solid ${T.linea}` : 'none', breakInside: 'avoid' }}>
              <Icono sev={s.severity} simbolo={/SANCTION|FROZEN|FREEZE/i.test(`${s.code} ${s.category ?? ''}`) ? '!' : '→'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11.5, fontWeight: 800, margin: 0 }}>{senalEs(s.code, s.category)}</p>
                <p style={{ fontSize: 10, color: T.suave, margin: '2px 0 0', lineHeight: 1.55 }}>{descripcionSenalSb(s.code, s.category)}</p>
                <p style={{ fontSize: 9, color: T.tenue, margin: '4px 0 0' }}>
                  {[s.network, usd(s.exposureUsd), s.entity, categoriaSbEs(s.category)].filter(Boolean).join(' · ')}
                  {' · '}<span style={{ fontFamily: MONO }}>{s.code}</span>
                </p>
              </div>
              <div style={{ flexShrink: 0 }}><Chip sev={s.severity}>{cap(severidadEs(s.severity))}</Chip></div>
            </div>
          ))}
          <p style={{ fontSize: 9, color: T.tenue, margin: '10px 0 0', lineHeight: 1.5 }}>
            La API de SARBLOCK entrega los hallazgos que suman riesgo, sin los informativos de contexto.
          </p>
        </Seccion>

        {/* ── 03 De dónde viene el dinero ── */}
        <Seccion n="03" titulo="De dónde viene el dinero" meta="Últimos 12 meses">
          {pctEx != null ? (
            <div className="sb-dos" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 24, alignItems: 'start', breakInside: 'avoid' }}>
              <div>
                {[
                  { t: 'Exchanges', p: pctEx, c: T.verde },
                  { t: 'Otras fuentes', p: Math.max(0, 100 - pctEx), c: '#A3A8A4' },
                ].map(f => (
                  <div key={f.t} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
                    <span style={{ fontSize: 10.5, width: 92, flexShrink: 0 }}>{f.t}</span>
                    <span style={{ flex: 1, height: 6, borderRadius: 6, background: '#ECEDEC', overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${f.p}%`, height: '100%', background: f.c, borderRadius: 6 }} />
                    </span>
                    <b style={{ fontSize: 10.5, width: 40, textAlign: 'right' }}>{entero(f.p)} %</b>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10.5, color: T.suave, margin: 0, lineHeight: 1.6 }}>
                {sb.exposicion?.attributedEntity ? <>SARBLOCK atribuye la dirección a <b style={{ color: T.tinta }}>{sb.exposicion.attributedEntity}</b>. </> : null}
                {deContraparte.length
                  ? <>SARBLOCK reportó {deContraparte.length} {deContraparte.length === 1 ? 'hallazgo' : 'hallazgos'} de contacto con wallets de riesgo
                      {expoRiesgo > 0 ? <>, con <b style={{ color: T.tinta }}>{usd(expoRiesgo)}</b> de exposición</> : null} (ver Hallazgos).</>
                  : <>SARBLOCK no reportó contacto con wallets de riesgo.</>}
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 10.5, color: T.suave, margin: 0 }}>SARBLOCK no informó la parte recibida de exchanges para esta dirección.</p>
          )}
          <p style={{ fontSize: 9.5, color: T.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>
            «Otras fuentes» es lo que no viene de exchanges identificados. El rastreo se detiene en los exchanges: lo que pasa dentro de ellos no se ve en la red.
          </p>

          {rutas.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 10.5, fontWeight: 800, margin: '0 0 6px' }}>Rutas hacia direcciones señaladas</p>
              {rutas.map((r, i) => {
                const { nodos } = caminoDe(r, d.address);
                return (
                  <div key={i} style={{ breakInside: 'avoid', marginBottom: 8 }}>
                    <div style={{ background: T.fondo, borderRadius: 8, padding: '8px 10px', fontSize: 9.5, lineHeight: 1.7 }}>
                      {nodos.map((x: string, j: number) => (
                        <React.Fragment key={j}>
                          {j ? <span style={{ color: T.tenue, margin: '0 5px' }}>→</span> : null}
                          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{corta(x)}</span>
                          {j === 0 ? <span style={{ color: T.suave }}> (esta wallet)</span>
                            : j === nodos.length - 1 && r.etiqueta ? <span style={{ color: T.suave }}> ({r.etiqueta})</span> : null}
                        </React.Fragment>
                      ))}
                    </div>
                    <p style={{ fontSize: 9, color: T.tenue, margin: '3px 0 0' }}>
                      {[d.coin, r.saltos === 1 ? 'Contacto directo' : `A ${r.saltos} saltos`, usd(r.monto)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                );
              })}
              <p style={{ fontSize: 9, color: T.tenue, margin: '2px 0 0' }}>Rastreo de intermediarios hecho con MistTrack (análisis profundo).</p>
            </div>
          ) : null}
        </Seccion>

        {/* ── 04 Actividad ── */}
        <Seccion n="04" titulo="Actividad" meta="Explorador público de la red">
          {cad ? (
            <Grilla borde={false}>
              <Dato rot="Movimientos" valor={entero(cad.transacciones) ?? 'Sin dato'}
                sub={cad.entradas != null || cad.salidas != null ? `${entero(cad.entradas) ?? '—'} entradas · ${entero(cad.salidas) ?? '—'} salidas` : null} />
              <Dato rot="Saldo" valor={cad.saldoUsdt != null ? `${Number(cad.saldoUsdt).toLocaleString('es-CO', { maximumFractionDigits: 2 })} USDT` : (usd(cad.valorUsd) ?? 'Sin dato')}
                sub={cad.saldoNativo != null ? `${Number(cad.saldoNativo).toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${d.coin}` : null} />
              <Dato rot="Primer movimiento" valor={cad.creada ? dia(cad.creada) : 'Sin dato'}
                sub={cad.ultimaActividad ? `Último: ${dia(cad.ultimaActividad)}` : null} />
              <Dato rot="Antigüedad" valor={antig != null ? `${entero(antig)} ${antig === 1 ? 'día' : 'días'}` : 'Sin dato'}
                sub={sb.redesActivas?.length ? `Redes con actividad: ${sb.redesActivas.join(', ')}` : null} />
            </Grilla>
          ) : (
            <p style={{ fontSize: 10.5, color: T.suave, margin: 0, lineHeight: 1.6 }}>
              El explorador público de la red no devolvió datos de esta dirección.
              {sb.redesActivas?.length ? <> Según SARBLOCK, tiene actividad en {sb.redesActivas.join(', ')}.</> : null}
            </p>
          )}
        </Seccion>

        {/* ── 05 Qué revisó SARBLOCK ── */}
        <Seccion n="05" titulo="Qué revisó SARBLOCK"
          meta={Number.isFinite(total) ? `${Number.isFinite(limpios) ? limpios : '—'} de ${total} sin hallazgos` : undefined}>
          <div className="sb-dos" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 22 }}>
            {ch.filas.map(f => (
              <div key={f.nombre} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.linea}`, breakInside: 'avoid' }}>
                <span style={{ width: 16, height: 16, borderRadius: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#FFFFFF', background: f.conHallazgo ? COLOR_NIVEL.EXTREME.papel : T.verde }}>
                  {f.conHallazgo ? '!' : '✓'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 10.5, fontWeight: 700, margin: 0 }}>{f.nombre}</p>
                  {f.fuente ? <p style={{ fontSize: 9, color: T.tenue, margin: '1px 0 0' }}>{f.fuente}</p> : null}
                </div>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: f.conHallazgo ? COLOR_NIVEL.EXTREME.papel : T.verde, whiteSpace: 'nowrap' }}>
                  {f.conHallazgo ? 'Con hallazgos' : 'Sin hallazgos'}
                </span>
              </div>
            ))}
            {ch.completa ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.linea}`, breakInside: 'avoid' }}>
                <span style={{ width: 16, height: 16, borderRadius: 16, flexShrink: 0, background: '#E3E5E3', color: T.suave, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>–</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 10.5, fontWeight: 700, margin: 0 }}>Darknet y ransomware</p>
                  <p style={{ fontSize: 9, color: T.tenue, margin: '1px 0 0' }}>SARBLOCK todavía no lo cubre</p>
                </div>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: T.tenue }}>No incluido</span>
              </div>
            ) : null}
          </div>
          {!ch.completa ? (
            <p style={{ fontSize: 10, color: T.suave, margin: '8px 0 0', lineHeight: 1.55 }}>
              {Number.isFinite(limpios) && limpios > 0
                ? <>Los otros {limpios} {limpios === 1 ? 'chequeo salió' : 'chequeos salieron'} sin hallazgos. </>
                : null}
              SARBLOCK solo nombra los chequeos con hallazgos.
            </p>
          ) : null}
        </Seccion>

        {/* ── 06 Trazabilidad ── */}
        <Seccion n="06" titulo="Trazabilidad" meta="Cada paso con su fecha, en hora de Colombia">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Fecha', 'Qué pasó', 'Quién'].map(h => (
                  <th key={h} style={{ fontSize: 9, fontWeight: 600, color: T.tenue, textAlign: 'left', padding: '0 0 6px', borderBottom: `1px solid ${T.linea}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pasos.map((p, i) => (
                <tr key={i} style={{ breakInside: 'avoid' }}>
                  <td style={{ fontSize: 10, padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.linea}`, verticalAlign: 'top', width: 110 }}>
                    {dia(p.at)}<br /><span style={{ color: T.tenue }}>{hora(p.at)}</span>
                  </td>
                  <td style={{ fontSize: 10.5, padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.linea}`, verticalAlign: 'top' }}>
                    <b>{p.que}</b>{p.det ? <><br /><span style={{ fontSize: 9.5, color: T.suave }}>{p.det}</span></> : null}
                  </td>
                  <td style={{ fontSize: 10, padding: '8px 0', borderBottom: `1px solid ${T.linea}`, verticalAlign: 'top', width: 150, color: T.suave }}>{p.quien}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Seccion>

        {/* ── 07 Notas ── */}
        <Seccion n="07" titulo="Notas sobre este reporte" salto>
          <div className="sb-dos" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 26 }}>
            <div>
              <Nota t="Qué es">
                Un resumen del análisis de riesgo de una dirección de activos virtuales, hecho con la plataforma
                SARBLOCK a pedido de {empresa} por medio de Lincoin, con la información disponible en la fecha y hora
                del análisis.
              </Nota>
              <Nota t="Para qué sirve">
                Es soporte de la debida diligencia sobre la contraparte y los activos virtuales dentro del sistema de
                gestión del riesgo de LA/FT/FPADM de {empresa}. Se puede entregar a autoridades competentes y a
                entidades financieras que lo pidan para gestionar ese mismo riesgo. No debe publicarse ni usarse con
                otra finalidad.
              </Nota>
              <Nota t="Lo que no es">
                No certifica que los fondos tengan un origen lícito ni identifica a la persona que controla la wallet.
                Un puntaje bajo no garantiza que los fondos estén limpios, y uno alto no prueba que no lo estén. Las
                decisiones sobre la operación son de {empresa}.
              </Nota>
              <Nota t="Sanciones y congelamientos">
                La lista de OFAC es de los Estados Unidos: en Colombia se consulta como referencia de riesgo, junto
                con las listas que la ley o el supervisor hagan obligatorias. El congelamiento de Tether o Circle es
                una decisión del emisor del token y no una orden de autoridad.
              </Nota>
              <Nota t="Metodología">
                Es la de SARBLOCK, la misma para todas las wallets. Lincoin no ajusta el puntaje, el nivel, la
                recomendación ni las señales: los presenta tal como SARBLOCK los devolvió.
              </Nota>
              <Nota t="Reserva">
                El reporte no indica si se ha reportado alguna operación a la UIAF. Esa información es reservada y
                nunca hace parte de él.
              </Nota>
            </div>
            <div>
              <Nota t="Hallazgos y presunción de inocencia">
                Un hallazgo es una señal de riesgo sobre la dirección, no una prueba de que su titular haya cometido
                un delito: toda persona se presume inocente mientras no se la declare judicialmente culpable
                (Constitución Política, art. 29). La exposición indirecta solo indica que los fondos pasaron cerca de
                una wallet de riesgo; en el camino puede haber terceros sin relación.
              </Nota>
              <Nota t="De dónde viene la información">
                El análisis de riesgo es de SARBLOCK, con datos públicos de cada red, listas de sanciones, listas de
                bloqueo de emisores y listas de terceros. Los saldos y movimientos de la sección Actividad salen del
                explorador público de la red. La atribución de una dirección a una entidad puede tener errores.
              </Nota>
              <Nota t="Vigencia">
                Las listas y fuentes cambian a diario. El reporte refleja su estado en la fecha del análisis y no se
                actualiza solo. Para una decisión nueva conviene pedir uno nuevo.
              </Nota>
              <Nota t="Datos personales">
                Una dirección asociada a una persona es un dato personal. Se trata para prevenir y controlar el
                LA/FT, finalidad prevista en la Ley 1581 de 2012 (art. 2, lit. b), y el reporte trae solo lo
                necesario.
              </Nota>
              <Nota t="Autenticidad">
                Lincoin archiva la respuesta original de SARBLOCK con su huella SHA-256 y la entrega a la autoridad
                que la requiera. El análisis se puede verificar en la plataforma de SARBLOCK con su identificador.
                Este documento no lleva firma manuscrita ni firma digital certificada.
              </Nota>
              <Nota t="Responsabilidad">
                Lincoin aporta la herramienta y conserva el original; no es un banco. Ni Lincoin ni SARBLOCK
                responden por la exactitud de las fuentes de terceros ni por las decisiones de {empresa} o de
                quienes reciban el reporte.
              </Nota>
            </div>
          </div>
        </Seccion>

        {/* ── 08 Autenticidad ── */}
        <Seccion n="08" titulo="Constancia del análisis">
          <div style={{ background: T.fondo, borderRadius: 14, padding: '16px 18px', breakInside: 'avoid' }}>
            <p style={{ fontSize: 12, fontWeight: 800, margin: 0 }}>Este análisis se puede comprobar</p>
            <p style={{ fontSize: 10, color: T.suave, margin: '4px 0 0', lineHeight: 1.6 }}>
              En la plataforma de SARBLOCK, con el identificador del análisis. Para confirmar que la respuesta
              archivada por Lincoin no cambió, se compara su huella SHA-256.
            </p>
            <p style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, margin: '12px 0 0', display: 'inline-block', background: '#FFFFFF', border: `1px solid ${T.linea}`, borderRadius: 8, padding: '7px 12px', wordBreak: 'break-all' }}>
              {sb.analisisId ?? '—'}
            </p>
            <p style={{ fontFamily: MONO, fontSize: 9, color: T.tenue, margin: '10px 0 0', lineHeight: 1.6, wordBreak: 'break-all' }}>
              Wallet en SARBLOCK · {sb.walletId ?? '—'}<br />
              {k?.sha256
                ? <>Huella SHA-256 de la respuesta archivada · {k.sha256} · archivada el {diaHora(k.archivadoAt)}</>
                : <>La respuesta original no quedó archivada para esta consulta{d.constanciaMotivo ? `: ${d.constanciaMotivo}` : ''}.</>}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.linea}` }}>
            <span style={{ fontSize: 9.5, color: T.suave }}>
              <b style={{ color: T.tinta, fontWeight: 800, letterSpacing: '-0.3px' }}>Lincoin<span style={{ color: T.verde }}>.</span></b>
              {' '}· lincoin.me · Reporte generado el {diaHora(d.generadoAt)}, hora de Colombia
            </span>
            <span style={{ fontSize: 9.5, color: T.tenue }}>Análisis on-chain: SARBLOCK · sarblock.com</span>
          </div>
        </Seccion>
      </div>
    </div>,
    document.body,
  );
};
