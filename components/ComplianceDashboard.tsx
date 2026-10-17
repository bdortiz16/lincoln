// ══════════════════════════════════════════════════════════════════
//  Compliance · Dashboard — Lincoin Empresas
//
//  Quién puede recibir plata y quién no, y por qué. Mismo sistema visual que
//  Contabilidad: cuatro cifras, una barra de distribución, dos gráficos y la
//  lista con filtros.
//
//  EL ESTADO LLEVA COLOR: bloqueado rojo, en revisión ámbar, sin hallazgos
//  verde, esperando gris. Son los mismos tres colores de la insignia AML en la
//  lista de Beneficiarios, para que un bloqueado se vea igual acá y allá. La
//  misma codificación en cifras, barra, gráfico, chips y pastillas: un color
//  significa una sola cosa en toda la página.
//
//  LA SITUACIÓN DE CADA UNO NO SE CALCULA ACÁ. Llega por `situacionAml`, la
//  misma función que frena el botón Enviar. Esta pantalla no puede decir "se
//  puede operar" y el envío rechazarse: sería el mismo tipo de mentira que ya
//  se corrigió en otras partes.
//
//  LO QUE NO SABEMOS, SE DICE. No hay un reloj de "listas actualizadas a las
//  06:00" porque no tenemos ese dato: lo que sí tenemos es cuándo fue la
//  última consulta, y eso es lo que se muestra. Los motivos de los hallazgos
//  salen de lo que TusDatos devolvió (nivel, código, texto, fuente) más las
//  dos banderas de identidad; lo que no encaja en un motivo conocido no se
//  fuerza en uno: se agrupa por su nivel.
// ══════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import type { MouvContact, ContactStatus } from './ContactsSection';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)', bordeFuerte: 'rgba(255,255,255,0.22)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', medio: '#b9beba',
  verde: '#4ADE80', guia: 'rgba(255,255,255,0.05)', hover: 'rgba(255,255,255,0.02)',
  tooltipFondo: '#161A17', tooltipBorde: 'rgba(255,255,255,0.14)',
};

export type Situacion = 'bloqueado' | 'esperando' | 'revision' | 'limpio' | 'sin_consulta';
type Filtro = 'todos' | 'bloqueados' | 'revision' | 'esperando' | 'limpios' | 'sin_consulta';

// La codificación de estado, UNA sola vez.
// Bloqueado en rojo, en revisión en ámbar, sin hallazgos en verde: los mismos
// tres colores que usa la insignia AML en la lista de Beneficiarios, para que
// un bloqueado se vea igual acá y allá. Bloqueado va RELLENO —es el único
// estado que impide recibir, y tiene que ser el más fuerte de la página.
const ESTADO: Record<Situacion, { rot: string; color: string; pill: React.CSSProperties; nota: string }> = {
  bloqueado:    { rot: 'Bloqueado',           color: '#F87171',                 pill: { background: '#F87171', color: '#0A0A0A', border: '1px solid #F87171' }, nota: 'no pueden recibir' },
  revision:     { rot: 'En revisión',         color: '#FBBF24',                 pill: { background: 'transparent', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.4)' }, nota: 'envíos retenidos' },
  limpio:       { rot: 'Sin hallazgos',       color: '#4ADE80',                 pill: { background: 'transparent', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.35)' }, nota: 'pueden recibir' },
  esperando:    { rot: 'Esperando resultado', color: 'rgba(255,255,255,0.18)',  pill: { background: 'transparent', color: '#878E88', border: '1px solid rgba(255,255,255,0.14)' }, nota: 'consulta en curso' },
  sin_consulta: { rot: 'Sin consulta',        color: 'rgba(255,255,255,0.10)',  pill: { background: 'transparent', color: '#878E88', border: '1px solid rgba(255,255,255,0.14)' }, nota: 'sin documento que consultar' },
};
const ORDEN: Situacion[] = ['bloqueado', 'revision', 'esperando', 'sin_consulta', 'limpio'];

type Props = {
  contacts: MouvContact[];
  amlDe: (c: MouvContact) => any | null;
  situacionAml: (c: MouvContact) => Situacion;
  contactStatus: (c: MouvContact) => ContactStatus;
  rowMeta: (c: MouvContact) => { bankName: string; maskLine: string; railLine: string; isWallet: boolean };
  initialsOf: (n: string) => string;
  prettyName: (n: string) => string;
  amlActivo: boolean;
  amlMotivo: string | null;
  esAdmin: boolean;
  onDetalle: (c: MouvContact) => void;
  // Los movimientos hacia cada beneficiario: la MISMA función que usan las
  // barras de la lista y el extracto. Cumplimiento necesita saber cuánto se
  // le movió a cada persona; por eso la tabla vive acá y no en Contabilidad.
  movimientosDe?: (c: MouvContact) => any[];
  onExtracto?: (c: MouvContact) => void;
};

const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '18px 20px', minWidth: 0, ...style }}>{children}</div>
);
const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', color: C.sub, margin: 0 }}>{children}</p>
);
const Swatch: React.FC<{ color: string; size?: number }> = ({ color, size = 8 }) => (
  <span style={{ width: size, height: size, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0, border: color.includes('0.1') || color.includes('0.18') ? '1px solid rgba(255,255,255,0.2)' : 'none' }} />
);
const Pill: React.FC<{ s: Situacion }> = ({ s }) => (
  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap', display: 'inline-block', ...ESTADO[s].pill }}>
    {ESTADO[s].rot.toUpperCase()}
  </span>
);

// ── Semana ISO, para agrupar consultas ──────────────────────────────
const semanaIso = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - y0.getTime()) / 86400000) + 1) / 7);
};
const inicioSemana = (d: Date) => {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dia = t.getDay() || 7;
  t.setDate(t.getDate() - dia + 1);
  return t;
};

// ── El motivo de un hallazgo, por lo que TusDatos devolvió ──────────
const motivoDe = (h: { nivel?: string; codigo?: string; texto?: string; fuente?: string }): string => {
  const s = `${h.codigo ?? ''} ${h.texto ?? ''} ${h.fuente ?? ''}`.toLowerCase();
  if (/ofac|onu|un\b|sancion|restrictiv|sdn|interpol|europol|clinton/.test(s)) return 'Lista restrictiva (OFAC/ONU)';
  if (/\bpep\b|expuesta|políticamente|politicamente/.test(s)) return 'PEP o familiar de PEP';
  if (String(h.nivel ?? '').toLowerCase() === 'alto') return 'AML riesgo alto';
  return 'AML riesgo medio';
};

export const ComplianceDashboard: React.FC<Props> = ({
  contacts, amlDe, situacionAml, contactStatus, rowMeta, initialsOf, prettyName, amlActivo, amlMotivo, esAdmin, onDetalle,
  movimientosDe, onExtracto,
}) => {
  // ── Cuánto se le movió a cada beneficiario ──
  // Mes y año calendario en curso, contando Completado y Procesando. Se suma
  // por moneda y se muestra la dominante: COP con USDT en una cifra sería
  // inventar un número.
  const movido = useMemo(() => {
    if (!movimientosDe) return null;
    const ahora = new Date();
    const iniMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
    const iniAnio = new Date(ahora.getFullYear(), 0, 1).getTime();
    const cuando = (t: any) => new Date(t.createdAt ?? t.created_at ?? t.date ?? 0).getTime() || 0;
    const out = contacts.map(c => {
      const por: Record<string, { mes: number; anio: number; envios: number }> = {};
      for (const t of movimientosDe(c)) {
        if (!(t.status === 'Completado' || t.status === 'Procesando')) continue;
        const ts = cuando(t); if (ts < iniAnio) continue;
        const m = String(t.currency ?? 'COP').split('_')[0];
        const acc = por[m] ?? (por[m] = { mes: 0, anio: 0, envios: 0 });
        const v = Number(t.amount) || 0;
        acc.anio += v; acc.envios += 1; if (ts >= iniMes) acc.mes += v;
      }
      const dom = Object.entries(por).sort((a, b) => b[1].anio - a[1].anio)[0];
      return { c, mes: dom?.[1].mes ?? 0, anio: dom?.[1].anio ?? 0, envios: dom?.[1].envios ?? 0, moneda: dom?.[0] ?? 'COP' };
    }).sort((a, b) => b.anio - a.anio || b.mes - a.mes);
    const totalMes = out.reduce((s, f) => s + (f.moneda === 'COP' ? f.mes : 0), 0);
    return { filas: out, totalMes, conEnvios: out.filter(f => f.anio > 0).length };
  }, [contacts, movimientosDe]);
  const [verTodosMov, setVerTodosMov] = useState(false);
  const fmtM = (v: number, m: string) => `${v.toLocaleString('es-CO', { maximumFractionDigits: m === 'COP' ? 0 : 2 })} ${m}`;
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(20);
  const [sobre, setSobre] = useState<number | null>(null);

  const filas = useMemo(() => contacts.map(c => {
    const k = amlDe(c);
    const sit = situacionAml(c);
    const st = contactStatus(c);
    // Motivos de ESTA persona, sin repetir.
    const motivos = new Set<string>();
    if (k) {
      if (k.nombreCoincide === false) motivos.add('Documento no coincide');
      if (k.documentoVigente === false) motivos.add('Documento no vigente');
      for (const h of (Array.isArray(k.hallazgos) ? k.hallazgos : [])) motivos.add(motivoDe(h));
      if (!motivos.size && String(k.categoria ?? '') === 'medio') motivos.add('AML riesgo medio');
      if (!motivos.size && String(k.categoria ?? '') === 'alto') motivos.add('AML riesgo alto');
    }
    const conHallazgos = sit === 'bloqueado' || sit === 'revision' || motivos.size > 0;
    const at = k?.at ? new Date(k.at).getTime() : 0;
    const nota = sit === 'bloqueado'
      ? (motivos.size ? `No puede recibir: ${Array.from(motivos).join(' · ').toLowerCase()}.` : 'No puede recibir. El envío se rechaza en el servidor.')
      : sit === 'revision' ? `Envío retenido hasta que cumplimiento lo resuelva${motivos.size ? `: ${Array.from(motivos).join(' · ').toLowerCase()}` : ''}.`
      : sit === 'esperando' ? 'La consulta de antecedentes no ha vuelto. Suele tardar cerca de un minuto.'
      : sit === 'sin_consulta' ? (amlActivo ? 'Sin documento para consultar antecedentes.' : 'Sin verificación de antecedentes en esta cuenta.')
      : st !== 'aprobada' ? (st === 'rechazada' ? 'Antecedentes limpios, pero el banco rechazó la cuenta destino.' : 'Antecedentes limpios; la cuenta destino sigue en validación del banco.')
      : 'Puede recibir sin restricciones.';
    return { c, k, sit, st, motivos: Array.from(motivos), conHallazgos, at, nota };
  }), [contacts, amlDe, situacionAml, contactStatus, amlActivo]);

  const n = (s: Situacion) => filas.filter(f => f.sit === s).length;
  const total = filas.length;
  const limpios = n('limpio');
  const enValidacion = filas.filter(f => f.st === 'en_proceso').length;
  const ultimaAt = filas.reduce((m, f) => Math.max(m, f.at), 0);

  // Consultas por semana: última consulta de cada beneficiario, 8 semanas.
  const semanas = useMemo(() => {
    const hoy = inicioSemana(new Date());
    const cubos = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(hoy); d.setDate(hoy.getDate() - 7 * (7 - i));
      return { desde: d.getTime(), hasta: d.getTime() + 7 * 86400000, rot: `S${semanaIso(d)}`, largo: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }), limpias: 0, conHallazgos: 0 };
    });
    for (const f of filas) {
      if (!f.at) continue;
      const cubo = cubos.find(cb => f.at >= cb.desde && f.at < cb.hasta);
      if (!cubo) continue;
      if (f.conHallazgos) cubo.conHallazgos += 1; else cubo.limpias += 1;
    }
    return cubos;
  }, [filas]);
  const hayConsultas = semanas.some(s => s.limpias + s.conHallazgos > 0);

  // Motivos, contando una vez por beneficiario.
  const motivos = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of filas) for (const mo of f.motivos) m[mo] = (m[mo] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [filas]);
  const maxMotivo = Math.max(1, ...motivos.map(([, v]) => v));

  // Filtro + búsqueda, juntos.
  const mapa: Record<Filtro, Situacion | null> = { todos: null, bloqueados: 'bloqueado', revision: 'revision', esperando: 'esperando', limpios: 'limpio', sin_consulta: 'sin_consulta' };
  const q = busca.trim().toLowerCase();
  const visibles = filas
    .filter(f => !mapa[filtro] || f.sit === mapa[filtro])
    .filter(f => !q || String(f.c.name).toLowerCase().includes(q) || String(f.c.docNumber ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'))
    .sort((a, b) => ORDEN.indexOf(a.sit) - ORDEN.indexOf(b.sit) || String(a.c.name).localeCompare(String(b.c.name)));
  const mostradas = visibles.slice(0, limite);

  const exportar = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lineas = [['Beneficiario', 'Tipo doc', 'Documento', 'Banco o riel', 'Cuenta o llave', 'Situación', 'Categoría', 'Operable', 'Motivos', 'Cuenta destino', 'Última consulta'].map(esc).join(',')];
    for (const f of visibles) {
      const m = rowMeta(f.c);
      lineas.push([
        f.c.name, String(f.c.docType ?? '').toUpperCase(), f.c.docNumber ?? '',
        m.bankName === '—' ? m.railLine : m.bankName,
        f.c.accountKind === 'wallet' ? f.c.accountNumber : (f.c.brebKey ?? f.c.accountNumber),
        ESTADO[f.sit].rot, f.k?.categoria ?? '', f.k?.operable == null ? '' : (f.k.operable ? 'sí' : 'no'),
        f.motivos.join(' | '), f.st === 'aprobada' ? 'verificada' : f.st === 'rechazada' ? 'rechazada' : 'en validación',
        f.at ? new Date(f.at).toISOString() : '',
      ].map(esc).join(','));
    }
    const url = URL.createObjectURL(new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `lincoin-compliance-${filtro}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const fechaCorta = (ts: number) => {
    const d = new Date(ts); const hoy = new Date();
    const esHoy = d.toDateString() === hoy.toDateString();
    const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return esHoy ? `hoy, ${hora}` : `${d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}, ${hora}`;
  };

  const chips: { k: Filtro; rot: string; cnt: number }[] = [
    { k: 'todos', rot: 'Todos', cnt: total },
    { k: 'bloqueados', rot: 'Bloqueados', cnt: n('bloqueado') },
    { k: 'revision', rot: 'En revisión', cnt: n('revision') },
    { k: 'esperando', rot: 'Esperando resultado', cnt: n('esperando') },
    { k: 'limpios', rot: 'Sin hallazgos', cnt: limpios },
    { k: 'sin_consulta', rot: 'Sin consulta', cnt: n('sin_consulta') },
  ];

  // Gráfico de barras: 8 semanas.
  const G = { w: 560, h: 210, padL: 30, padR: 10, padT: 22, padB: 26 };
  const maxSem = Math.max(1, ...semanas.map(s => s.limpias + s.conHallazgos));
  const areaH = G.h - G.padT - G.padB, slot = (G.w - G.padL - G.padR) / 8, barW = Math.min(34, slot * 0.6);
  const yDe = (v: number) => G.padT + areaH - (v / maxSem) * areaH;

  const kpi = (s: Situacion, valor: number, nota: string, fuerte = false) => (
    <Tarjeta style={{ border: `1px solid ${fuerte ? C.bordeFuerte : C.borde}` }}>
      <p className="flex items-center" style={{ gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', color: C.sub, margin: 0 }}>
        <Swatch color={ESTADO[s].color} />{ESTADO[s].rot.toUpperCase()}
      </p>
      <p style={{ fontSize: 30, fontWeight: 800, color: C.text, margin: '8px 0 0', letterSpacing: '-0.8px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{valor}</p>
      <p style={{ fontSize: 12, color: C.sub, margin: '6px 0 0' }}>{nota}</p>
    </Tarjeta>
  );

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. Encabezado derecho: última consulta + exportar */}
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 12 }}>
        <span className="flex items-center" style={{ gap: 8, fontSize: 12.5, color: C.sub }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: ultimaAt ? C.verde : 'rgba(255,255,255,0.18)', flexShrink: 0 }} />
          {ultimaAt ? `Última consulta ${fechaCorta(ultimaAt)}` : 'Sin consultas todavía'}
        </span>
        <button onClick={exportar} className="lincoin-btn-white"
          style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 18px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
          Exportar reporte
        </button>
      </div>

      {!amlActivo && (
        <Tarjeta>
          <p style={{ fontSize: 13, color: C.text, fontWeight: 600, margin: 0 }}>La verificación de antecedentes no está activa para esta cuenta.</p>
          <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
            Lo que se ve abajo es el estado de las cuentas destino según el banco.{esAdmin && amlMotivo ? ` ${amlMotivo}` : ''}
          </p>
        </Tarjeta>
      )}

      {/* 2. KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {kpi('bloqueado', n('bloqueado'), 'no pueden recibir', true)}
        {kpi('revision', n('revision'), 'envíos retenidos')}
        {kpi('limpio', limpios, 'pueden recibir')}
        {kpi('esperando', n('esperando'), `${enValidacion} ${enValidacion === 1 ? 'cuenta' : 'cuentas'} en validación`)}
      </div>

      {/* 3. Barra de distribución */}
      <Tarjeta>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
          <Rotulo>ESTADO DE TUS {total} BENEFICIARIOS</Rotulo>
          <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>
            <b style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>{total ? Math.round((limpios / total) * 100) : 0} %</b> pueden recibir sin restricciones
          </p>
        </div>
        <div className="flex" style={{ gap: 3, height: 14, marginTop: 12, borderRadius: 7, overflow: 'hidden' }}>
          {total === 0 ? <div style={{ flex: 1, background: C.guia }} /> : ORDEN.map(s => {
            const v = n(s);
            return v > 0 ? <div key={s} title={`${ESTADO[s].rot}: ${v}`} style={{ flex: v, background: ESTADO[s].color, borderRadius: 7, minWidth: 3 }} /> : null;
          })}
        </div>
        <div className="flex flex-wrap" style={{ gap: 16, marginTop: 10 }}>
          {ORDEN.map(s => (
            <span key={s} className="flex items-center" style={{ gap: 7, fontSize: 12, color: n(s) > 0 ? C.medio : C.tenue }}>
              <Swatch color={ESTADO[s].color} />{ESTADO[s].rot} <b style={{ color: n(s) > 0 ? C.text : C.tenue, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n(s)}</b>
            </span>
          ))}
        </div>
      </Tarjeta>

      {/* 4. Dos gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Tarjeta>
          <div className="flex items-start justify-between flex-wrap" style={{ gap: 10 }}>
            <div>
              <Rotulo>CONSULTAS POR SEMANA</Rotulo>
              <p style={{ fontSize: 11.5, color: C.tenue, margin: '3px 0 0' }}>Última consulta de cada beneficiario, ocho semanas</p>
            </div>
            <div className="flex items-center" style={{ gap: 12, fontSize: 11.5, color: C.medio }}>
              <span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.verde} />Sin hallazgos</span>
              <span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.text} />Con hallazgos</span>
            </div>
          </div>
          <div style={{ position: 'relative', marginTop: 8 }}>
            {!hayConsultas && <p style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12.5, color: C.tenue, margin: 0 }}>Sin consultas en las últimas ocho semanas.</p>}
            <svg viewBox={`0 0 ${G.w} ${G.h}`} width="100%" height={G.h} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', fontFamily: FONT }} onMouseLeave={() => setSobre(null)}>
              {[0, 0.25, 0.5, 0.75, 1].map(f => (
                <line key={f} x1={G.padL} x2={G.w - G.padR} y1={yDe(maxSem * f)} y2={yDe(maxSem * f)} stroke={C.guia} />
              ))}
              {semanas.map((s, i) => {
                const tot = s.limpias + s.conHallazgos;
                const x = G.padL + slot * i + (slot - barW) / 2;
                const yL = yDe(s.limpias), yT = yDe(tot), base = yDe(0);
                const apag = sobre != null && sobre !== i;
                return (
                  <g key={i} opacity={apag ? 0.45 : 1} onMouseEnter={() => setSobre(i)}>
                    <rect x={G.padL + slot * i} y={G.padT - 14} width={slot} height={areaH + 14} fill="transparent" />
                    {s.limpias > 0 && <path d={s.conHallazgos > 0 ? `M${x},${base} V${yL} h${barW} V${base} Z` : `M${x},${base} V${yL + 3} q0,-3 3,-3 h${barW - 6} q3,0 3,3 V${base} Z`} fill={C.verde} />}
                    {s.conHallazgos > 0 && s.limpias > 0 && <rect x={x} y={yL - 1} width={barW} height={2} fill={C.tarjeta} />}
                    {s.conHallazgos > 0 && <path d={`M${x},${yL} V${yT + 3} q0,-3 3,-3 h${barW - 6} q3,0 3,3 V${yL} Z`} fill={C.text} />}
                    {tot > 0 && <text x={x + barW / 2} y={yT - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.text} style={{ fontVariantNumeric: 'tabular-nums' }}>{tot}</text>}
                    <text x={G.padL + slot * i + slot / 2} y={G.h - 8} textAnchor="middle" fontSize={10.5} fill={C.tenue}>{s.rot}</text>
                  </g>
                );
              })}
            </svg>
            {sobre != null && (semanas[sobre].limpias + semanas[sobre].conHallazgos) > 0 && (
              <div style={{ position: 'absolute', top: 0, left: sobre < 4 ? '55%' : 8, background: C.tooltipFondo, border: `1px solid ${C.tooltipBorde}`, borderRadius: 10, padding: '9px 12px', pointerEvents: 'none', minWidth: 160 }}>
                <p style={{ fontSize: 11, color: C.sub, margin: 0 }}>Semana del {semanas[sobre].largo}</p>
                <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}><span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.verde} />Sin hallazgos</span><b>{semanas[sobre].limpias}</b></p>
                <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}><span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.text} />Con hallazgos</span><b>{semanas[sobre].conHallazgos}</b></p>
              </div>
            )}
          </div>
        </Tarjeta>

        <Tarjeta>
          <Rotulo>MOTIVOS DE LOS HALLAZGOS</Rotulo>
          <p style={{ fontSize: 11.5, color: C.tenue, margin: '3px 0 0' }}>Beneficiarios con cada motivo; uno puede tener varios</p>
          {motivos.length === 0 ? (
            <p style={{ fontSize: 12.5, color: C.tenue, margin: '18px 0 0' }}>Sin hallazgos registrados.</p>
          ) : motivos.map(([mo, v], i) => (
            <div key={mo} style={{ marginTop: i === 0 ? 14 : 11 }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <span style={{ fontSize: 12.5, color: C.text }}>{mo}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', marginTop: 5, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(2, (v / maxMotivo) * 100)}%`, height: '100%', background: C.text, opacity: 0.85, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </Tarjeta>
      </div>

      {/* 5. Lista */}
      <Tarjeta style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '14px 20px', borderBottom: `1px solid ${C.borde}` }}>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            {chips.map(ch => {
              const act = filtro === ch.k;
              return (
                <button key={ch.k} onClick={() => { setFiltro(ch.k); setLimite(20); }}
                  style={{
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
                    color: act ? C.text : C.sub, background: act ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: `1px solid ${act ? C.bordeFuerte : C.borde}`, transition: 'background 120ms, color 120ms',
                  }}>
                  {ch.rot} <span style={{ color: C.tenue, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{ch.cnt}</span>
                </button>
              );
            })}
          </div>
          <input value={busca} onChange={e => { setBusca(e.target.value); setLimite(20); }} placeholder="Buscar por nombre o documento"
            style={{ fontFamily: FONT, fontSize: 13, color: C.text, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', outline: 'none', width: 260, maxWidth: '100%' }} />
        </div>

        {mostradas.length === 0 && <p style={{ fontSize: 12.5, color: C.tenue, padding: '18px 20px', margin: 0 }}>Nadie en esta categoría.</p>}
        {mostradas.map(f => {
          const m = rowMeta(f.c);
          return (
            <div key={f.c.id} className="lincoin-fila-cumpl" onClick={() => onDetalle(f.c)}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(260px, 1.6fr) auto', gap: 16, alignItems: 'center', padding: '13px 20px', borderTop: `1px solid ${C.borde}`, cursor: 'pointer' }}>
              <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <span style={{ color: C.sub, fontWeight: 800, fontSize: 12 }}>{initialsOf(f.c.name)}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prettyName(f.c.name)}</p>
                  <p style={{ fontSize: 11.5, color: C.sub, margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.c.docNumber && f.c.docNumber !== '—' ? `${String(f.c.docType ?? 'CC').toUpperCase()} ${f.c.docNumber} · ` : ''}{m.bankName} · {m.maskLine}
                  </p>
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                  <Pill s={f.sit} />
                  {f.st === 'aprobada' && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 999, border: '1px solid rgba(74,222,128,0.35)', color: C.verde, whiteSpace: 'nowrap' }}>CUENTA VERIFICADA</span>
                  )}
                  {f.st !== 'aprobada' && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 999, border: `1px solid ${C.borde}`, color: C.sub, whiteSpace: 'nowrap' }}>{f.st === 'rechazada' ? 'CUENTA RECHAZADA' : 'CUENTA EN VALIDACIÓN'}</span>
                  )}
                </div>
                <p style={{ fontSize: 12.5, color: C.medio, margin: '6px 0 0', lineHeight: 1.45 }}>{f.nota}</p>
              </div>
              <button onClick={e => { e.stopPropagation(); onDetalle(f.c); }}
                style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                className="hover:border-[rgba(255,255,255,0.22)] transition-colors">
                Ver detalle
              </button>
            </div>
          );
        })}
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 20px', borderTop: `1px solid ${C.borde}` }}>
          <span style={{ fontSize: 12, color: C.sub }}>Mostrando {mostradas.length} de {visibles.length}</span>
          {visibles.length > mostradas.length && (
            <button onClick={() => setLimite(l => l + 20)} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Cargar más →
            </button>
          )}
        </div>
      </Tarjeta>

      {/* 6. Por beneficiario: cuánto se le movió a cada uno ──
          Es una pregunta de cumplimiento —a quién le está saliendo la plata y
          en qué proporción— por eso está acá y no en Contabilidad. */}
      {movido && (
        <Tarjeta style={{ padding: 0, overflow: 'hidden' }}>
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '16px 20px', borderBottom: `1px solid ${C.borde}` }}>
            <div>
              <p style={{ fontSize: 14.5, fontWeight: 700, color: C.text, margin: 0 }}>Cuánto se le movió a cada beneficiario</p>
              <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>{movido.conEnvios} con envíos este año · {contacts.length - movido.conEnvios} sin envíos</p>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>{['BENEFICIARIO', 'SITUACIÓN', 'MES', 'AÑO', '% DEL MES', 'ENVÍOS', ''].map((h, i) => <th key={h || 'acc'} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i >= 2 && i <= 5 ? 'right' : 'left', padding: '9px 20px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>
                {(verTodosMov ? movido.filas : movido.filas.slice(0, 15)).map(f => {
                  const sit = situacionAml(f.c); const m = rowMeta(f.c); const gris = f.anio <= 0;
                  const p = movido.totalMes > 0 && f.moneda === 'COP' ? Math.round((f.mes / movido.totalMes) * 1000) / 10 : 0;
                  return (
                    <tr key={f.c.id} className="lincoin-fila-cumpl" style={{ cursor: 'pointer' }} onClick={() => (onExtracto ?? onDetalle)(f.c)}>
                      <td style={{ padding: '10px 20px', borderBottom: `1px solid ${C.borde}` }}>
                        <p style={{ fontSize: 13.5, fontWeight: 700, color: gris ? C.medio : C.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{prettyName(f.c.name)}</p>
                        <p style={{ fontSize: 11.5, color: C.sub, margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{m.bankName} · {m.maskLine}</p>
                      </td>
                      <td style={{ padding: '10px 20px', borderBottom: `1px solid ${C.borde}` }}><Pill s={sit} /></td>
                      <td style={{ padding: '10px 20px', fontSize: 12.5, color: f.mes > 0 ? C.text : C.tenue, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{f.mes > 0 ? fmtM(f.mes, f.moneda) : '—'}</td>
                      <td style={{ padding: '10px 20px', fontSize: 12.5, color: f.anio > 0 ? C.text : C.tenue, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{f.anio > 0 ? fmtM(f.anio, f.moneda) : '—'}</td>
                      <td style={{ padding: '10px 20px', borderBottom: `1px solid ${C.borde}`, minWidth: 140 }}>
                        <div className="flex items-center justify-end" style={{ gap: 10 }}>
                          <div style={{ width: 80, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, p)}%`, height: '100%', background: C.verde, borderRadius: 999 }} /></div>
                          <span style={{ fontSize: 12, color: p > 0 ? C.text : C.tenue, fontVariantNumeric: 'tabular-nums', width: 44, textAlign: 'right' }}>{p > 0 ? `${p} %` : '—'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 20px', fontSize: 12.5, color: gris ? C.tenue : C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}` }}>{f.envios}</td>
                      <td style={{ padding: '10px 20px', borderBottom: `1px solid ${C.borde}`, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => onDetalle(f.c)} style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }} className="hover:text-[#F4F4F2] hover:border-[rgba(255,255,255,0.22)] transition-colors">Expediente</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 20px', borderTop: `1px solid ${C.borde}` }}>
            <span style={{ fontSize: 12, color: C.sub }}>Mostrando {Math.min(verTodosMov ? movido.filas.length : 15, movido.filas.length)} de {movido.filas.length}</span>
            {!verTodosMov && movido.filas.length > 15 && <button onClick={() => setVerTodosMov(true)} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Ver todos los beneficiarios →</button>}
          </div>
        </Tarjeta>
      )}

      {/* 7. Nota */}
      <p style={{ fontSize: 12, color: C.tenue, margin: 0, lineHeight: 1.55 }}>
        Un beneficiario bloqueado no puede recibir envíos. En revisión, el envío queda retenido hasta que cumplimiento lo resuelva.
      </p>

      <style>{`
        .lincoin-fila-cumpl:hover { background: ${C.hover}; }
        @media (max-width: 760px) { .lincoin-fila-cumpl { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
};
