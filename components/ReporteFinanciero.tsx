import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Info, Search, X, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { celdaCsv } from '../lib/csv';

// ─────────────────────────────────────────────────────────────
// Reportes → Resumen financiero.
//
// Antes esta pestaña sumaba en el navegador la lista de clientes del panel
// (que ya no trae la base entera), tenía un "+12.5% vs mes anterior" escrito
// a mano y una gráfica vacía. Ahora todo sale del servidor
// (admin-data reporte_financiero), de la base entera, con las mismas reglas
// que Contabilidad y Lincoin:
//   ingresos = margen de los cargues + comisiones de envíos + ingresos de caja
//   gastos   = cargues en pérdida + costo Mouv (0,10 %) + costo de proveedores
//              en envíos + egresos registrados en la caja
// Por día (horas), mes (días) o año (meses), de todos o de un cliente, y
// comparado con el mismo tramo del periodo anterior.
// ─────────────────────────────────────────────────────────────

type Periodo = 'dia' | 'mes' | 'anio';
type Partidas = {
  margenCargues: number; comisionesEnvios: number; otrosIngresos: number;
  perdidaCargues: number; costoMouv: number; costoEnvios: number; egresos: number;
  entradas: number; salidas: number; nEntradas: number; nSalidas: number; nCargues: number; nEnvios: number;
  ingresos: number; gastos: number; utilidad: number;
};
type Reporte = {
  ok: true; hoy: string; periodo: Periodo; desde: string; hasta: string; corte: string; enCurso: boolean;
  anterior: (Partidas & { desde: string; hasta: string; completo: boolean }) | null;
  cliente: { id: string; nombre: string; email: string | null; empresa: boolean } | null;
  totales: Partidas;
  tramos: (Partidas & { i: number })[];
  fuentes: (Partidas & { fuente: string })[];
  clientes: (Partidas & { id: string; nombre: string; email: string | null; empresa: boolean })[];
  nClientes: number;
  caja: { retiros: number; aportes: number; gastos: { id: string; fecha: string; proveedor: string; monto: number; descripcion: string }[] };
  avisos: { carguesSinContabilidad: number; enviosSinCosto: number; carguesEnPerdida: number; parcial: boolean };
};

// Colores. Superficie de las tarjetas #0C0E0D. Entradas/salidas: los dos
// primeros tonos de la paleta categórica validada para fondo oscuro (azul y
// naranja, ΔE 26,8 con daltonismo). La utilidad usa el verde de Lincoin
// arriba de la línea y rojo abajo: el signo lo dice también la dirección.
const C = {
  card: '#0C0E0D', elev: '#121413', base: '#070808',
  b1: 'rgba(255,255,255,0.08)', b2: 'rgba(255,255,255,0.14)', grid: 'rgba(255,255,255,0.06)', eje: 'rgba(255,255,255,0.16)',
  text: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)',
  verde: '#4ADE80', rojo: '#E66767', rojoTexto: '#F87171', ambar: '#FBBF24',
  entradas: '#3987e5', salidas: '#d95926',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const plata = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CO')}`;
const compacto = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil M`
    : a >= 1e6 ? `${(a / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`
    : a >= 1e3 ? `${(a / 1e3).toLocaleString('es-CO', { maximumFractionDigits: 0 })} mil`
    : String(Math.round(a));
  return `${n < 0 ? '−' : ''}${s}`;
};
const ymdDe = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const fechaUtc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const hoyBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const diaLargo = (ymd: string) => fechaUtc(ymd).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const diaCorto = (ymd: string) => { const d = fechaUtc(ymd); return `${d.getUTCDate()} ${MES_CORTO[d.getUTCMonth()]}`; };

function moverFecha(p: Periodo, f: string, paso: -1 | 1): string {
  const d = fechaUtc(f);
  if (p === 'dia') return ymdDe(new Date(d.getTime() + paso * 86_400_000));
  if (p === 'mes') return ymdDe(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + paso, 1)));
  return `${d.getUTCFullYear() + paso}-01-01`;
}
function tituloPeriodo(p: Periodo, f: string): string {
  const d = fechaUtc(f);
  if (p === 'dia') { const s = diaLargo(f); return s.charAt(0).toUpperCase() + s.slice(1); }
  if (p === 'mes') return `${MESES[d.getUTCMonth()].charAt(0).toUpperCase()}${MESES[d.getUTCMonth()].slice(1)} ${d.getUTCFullYear()}`;
  return String(d.getUTCFullYear());
}
function etiquetaTramo(r: Reporte, i: number, larga = false): string {
  if (r.periodo === 'dia') return larga ? `${i}:00 – ${i}:59` : `${i}h`;
  if (r.periodo === 'mes') { const d = fechaUtc(r.desde); return larga ? diaLargo(ymdDe(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), i + 1)))) : String(i + 1); }
  return larga ? `${MESES[i]} ${r.desde.slice(0, 4)}` : MES_CORTO[i];
}
// Contra qué se compara, dicho en palabras.
function textoAnterior(r: Reporte): string {
  const a = r.anterior; if (!a) return '';
  if (r.periodo === 'dia') return r.enCurso ? 'vs ayer a esta hora' : `vs ${diaCorto(a.desde)}`;
  if (r.periodo === 'mes') { const m = MESES[fechaUtc(a.desde).getUTCMonth()]; return a.completo ? `vs ${m}` : `vs ${fechaUtc(a.desde).getUTCDate()}–${fechaUtc(a.hasta).getUTCDate()} de ${m}`; }
  return a.completo ? `vs ${a.desde.slice(0, 4)}` : `vs ${a.desde.slice(0, 4)} a la misma fecha`;
}

// Ancho real del contenedor, para dibujar el SVG en píxeles (sin estirarlo:
// estirado se deforman las esquinas y el texto).
function useAncho<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const medir = () => setW(Math.floor(el.getBoundingClientRect().width));
    medir();
    const ro = new ResizeObserver(medir); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Escala "limpia" para el eje: 0 y 3-4 marcas redondas.
function marcas(min: number, max: number): number[] {
  const rango = Math.max(max - Math.min(0, min), 1);
  const paso0 = rango / 4;
  const pot = Math.pow(10, Math.floor(Math.log10(paso0)));
  const paso = [1, 2, 2.5, 5, 10].map(x => x * pot).find(x => x >= paso0) ?? 10 * pot;
  const out: number[] = [];
  for (let v = Math.floor(Math.min(0, min) / paso) * paso; v <= max + paso * 0.001; v += paso) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + paso);
  return out;
}

// Columna con el extremo de datos redondeado (4 px) y la base recta.
function columna(x: number, y0: number, y1: number, w: number): string {
  const h = Math.abs(y1 - y0); if (h < 0.5) return '';
  const r = Math.min(4, h, w / 2);
  if (y1 < y0) return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

type Serie = { clave: string; nombre: string; color: (v: number) => string; valor: (t: Partidas) => number };

// Gráfica de columnas (una o dos series). Pasar el puntero (o tocar) sobre un
// tramo muestra todos sus valores; debajo, "Ver en tabla" da lo mismo sin
// pasar el puntero.
const Columnas: React.FC<{
  r: Reporte; series: Serie[]; detalle: (t: Partidas) => { nombre: string; valor: number; color?: string; fuerte?: boolean }[]; alto?: number; titulo: string;
}> = ({ r, series, detalle, alto = 220, titulo }) => {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sobre, setSobre] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);
  const n = r.tramos.length;
  const valores = r.tramos.flatMap(t => series.map(s => s.valor(t)));
  const max = Math.max(0, ...valores), min = Math.min(0, ...valores);
  const ticks = marcas(min, max === 0 && min === 0 ? 1 : max);
  const tMin = Math.min(0, ticks[0]), tMax = ticks[ticks.length - 1];
  const IZQ = 52, DER = 8, ARR = 10, ABA = 26;
  const altoPlot = alto - ARR - ABA;
  const y = (v: number) => ARR + (tMax - v) / (tMax - tMin || 1) * altoPlot;
  const anchoPlot = Math.max(0, ancho - IZQ - DER);
  const banda = n ? anchoPlot / n : 0;
  const gap = 2;
  const wBarra = Math.max(2, Math.min(24, (banda * 0.72 - gap * (series.length - 1)) / series.length));
  const grupo = wBarra * series.length + gap * (series.length - 1);
  const cada = n > 24 ? (ancho < 520 ? 7 : 5) : n > 12 ? (ancho < 520 ? 4 : 2) : 1;
  const vacio = valores.every(v => v === 0);
  const tip = sobre != null ? r.tramos[sobre] : null;
  const xTip = sobre != null ? IZQ + banda * sobre + banda / 2 : 0;

  return (
    <div>
      <div ref={ref} style={{ position: 'relative', height: alto }} onPointerLeave={() => setSobre(null)}>
        {ancho > 0 && (
          <svg width={ancho} height={alto} role="img" aria-label={`${titulo}. Usa "Ver en tabla" para leer cada valor.`} style={{ display: 'block', fontFamily: FONT }}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={IZQ} x2={ancho - DER} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.eje : C.grid} strokeWidth={1} />
                <text x={IZQ - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill={C.sub} style={{ fontVariantNumeric: 'tabular-nums' }}>{compacto(t)}</text>
              </g>
            ))}
            {r.tramos.map((t, i) => {
              const x0 = IZQ + banda * i + (banda - grupo) / 2;
              return (
                <g key={i} opacity={sobre == null || sobre === i ? 1 : 0.55}>
                  {series.map((s, k) => {
                    const v = s.valor(t);
                    const d = columna(x0 + k * (wBarra + gap), y(0), y(v), wBarra);
                    return d ? <path key={s.clave} d={d} fill={s.color(v)} /> : null;
                  })}
                  {((i % cada === 0 && n - 1 - i >= Math.ceil(cada / 2)) || i === n - 1) && (
                    <text x={IZQ + banda * i + banda / 2} y={alto - 8} textAnchor="middle" fontSize={10.5} fill={C.sub}>{etiquetaTramo(r, i)}</text>
                  )}
                  {/* El área de toque es toda la banda, no solo la barra. */}
                  <rect x={IZQ + banda * i} y={ARR} width={banda} height={altoPlot} fill="transparent"
                    onPointerEnter={() => setSobre(i)} onPointerDown={() => setSobre(i)} />
                </g>
              );
            })}
            {vacio && <text x={IZQ + anchoPlot / 2} y={ARR + altoPlot / 2} textAnchor="middle" fontSize={12.5} fill={C.sub}>Sin movimientos en este periodo</text>}
          </svg>
        )}
        {tip && (
          <div role="status" style={{
            position: 'absolute', top: 4, pointerEvents: 'none', zIndex: 5, minWidth: 170,
            left: Math.max(4, Math.min(ancho - 184, xTip + 12 > ancho - 190 ? xTip - 184 : xTip + 12)),
            background: '#161A17', border: `1px solid ${C.b2}`, borderRadius: 10, padding: '8px 10px', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}>
            <p style={{ margin: '0 0 5px', fontSize: 11, color: C.sub }}>{etiquetaTramo(r, sobre!, true)}</p>
            {detalle(tip).map(f => (
              <div key={f.nombre} className="flex items-center justify-between" style={{ gap: 12, padding: '1px 0' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.sub }}>
                  {f.color && <span style={{ width: 10, height: 2, borderRadius: 1, background: f.color }} />}{f.nombre}
                </span>
                <span style={{ fontSize: f.fuerte ? 13 : 12, fontWeight: f.fuerte ? 800 : 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{plata(f.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={() => setTabla(v => !v)}
        style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, color: C.sub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline' }}>
        {tabla ? 'Ocultar tabla' : 'Ver en tabla'}
      </button>
      {tabla && (
        <div style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.b1}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <th style={{ textAlign: 'left', padding: '7px 10px', color: C.sub, fontWeight: 700, position: 'sticky', top: 0, background: C.elev }}>{r.periodo === 'dia' ? 'Hora' : r.periodo === 'mes' ? 'Día' : 'Mes'}</th>
              {detalle(r.tramos[0] ?? r.totales).map(f => <th key={f.nombre} style={{ textAlign: 'right', padding: '7px 10px', color: C.sub, fontWeight: 700, position: 'sticky', top: 0, background: C.elev }}>{f.nombre}</th>)}
            </tr></thead>
            <tbody>
              {r.tramos.map((t, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.b1}` }}>
                  <td style={{ padding: '6px 10px', color: C.text }}>{etiquetaTramo(r, i, true)}</td>
                  {detalle(t).map(f => <td key={f.nombre} style={{ padding: '6px 10px', textAlign: 'right', color: C.text, fontVariantNumeric: 'tabular-nums', fontWeight: f.fuerte ? 700 : 500 }}>{plata(f.valor)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Cambio contra el periodo anterior: flecha + porcentaje (o el monto si el
// anterior era cero o negativo, donde un porcentaje no dice nada).
const Cambio: React.FC<{ ahora: number; antes: number | null | undefined; subirEsBueno?: boolean; texto: string }> = ({ ahora, antes, subirEsBueno = true, texto }) => {
  if (antes == null) return null;
  const dif = ahora - antes;
  if (Math.round(dif) === 0) return <span style={{ fontSize: 11.5, color: C.sub }}>Igual {texto}</span>;
  const sube = dif > 0;
  const bueno = sube === subirEsBueno;
  const pct = antes > 0 ? `${sube ? '+' : '−'}${Math.abs(Math.round(dif / antes * 100)).toLocaleString('es-CO')} %` : `${sube ? '+' : '−'}${plata(Math.abs(dif))}`;
  const Icono = sube ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 700, color: bueno ? C.verde : C.rojoTexto }}>
      <Icono size={13} /> {pct} <span style={{ color: C.sub, fontWeight: 500 }}>{texto}</span>
    </span>
  );
};

const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 16, padding: 18, minWidth: 0, ...style }}>{children}</div>
);
const Titulo: React.FC<{ children: React.ReactNode; sub?: React.ReactNode }> = ({ children, sub }) => (
  <div style={{ marginBottom: 12 }}>
    <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: C.text, letterSpacing: '-0.2px' }}>{children}</p>
    {sub && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.sub }}>{sub}</p>}
  </div>
);

export const ReporteFinanciero: React.FC = () => {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [fecha, setFecha] = useState<string>(hoyBogota());
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [r, setR] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [verTodos, setVerTodos] = useState(false);
  const [verEgresos, setVerEgresos] = useState(false);
  const pedido = useRef(0);

  useEffect(() => {
    const n = ++pedido.current;
    setCargando(true); setError(null);
    pedirAdmin({ action: 'reporte_financiero', periodo, fecha, ...(clienteId ? { userId: clienteId } : {}) })
      .then(d => { if (n !== pedido.current) return; if (d?.ok) setR(d as Reporte); else setError(String(d?.error ?? 'No se pudo cargar el reporte.')); })
      .catch(() => { if (n === pedido.current) setError('No se pudo cargar el reporte.'); })
      .finally(() => { if (n === pedido.current) setCargando(false); });
  }, [periodo, fecha, clienteId]);

  const hoy = hoyBogota();
  const siguiente = moverFecha(periodo, fecha, 1);
  const haySiguiente = periodo === 'dia' ? siguiente <= hoy : periodo === 'mes' ? siguiente.slice(0, 7) <= hoy.slice(0, 7) : siguiente.slice(0, 4) <= hoy.slice(0, 4);
  const esActual = periodo === 'dia' ? fecha === hoy : periodo === 'mes' ? fecha.slice(0, 7) === hoy.slice(0, 7) : fecha.slice(0, 4) === hoy.slice(0, 4);
  const unidad = periodo === 'dia' ? 'hora' : periodo === 'mes' ? 'día' : 'mes';

  const clientesFiltrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (r?.clientes ?? []).filter(c => !q || c.nombre.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q));
  }, [r, buscar]);
  const maxUtilCli = Math.max(1, ...clientesFiltrados.map(c => Math.abs(c.utilidad)));
  const maxUtilFuente = Math.max(1, ...(r?.fuentes ?? []).map(f => Math.abs(f.utilidad)));

  const exportar = () => {
    if (!r) return;
    const filas: unknown[][] = [];
    filas.push(['Reporte financiero Lincoin', tituloPeriodo(r.periodo, r.desde), r.cliente ? r.cliente.nombre : 'Todos los clientes']);
    filas.push(['Desde', r.desde, 'Hasta', r.enCurso ? r.corte.slice(0, 10) : r.hasta]);
    filas.push([]);
    filas.push(['Concepto', 'COP']);
    const t = r.totales;
    ([['Margen en cargues', t.margenCargues], ['Comisiones de envíos', t.comisionesEnvios], ['Otros ingresos (caja)', t.otrosIngresos], ['Total ingresos', t.ingresos],
      ['Cargues en pérdida', -t.perdidaCargues], ['Costo Mouv 0,10% Bre-B', -t.costoMouv], ['Costo de proveedores en envíos', -t.costoEnvios], ['Egresos registrados (caja)', -t.egresos], ['Total gastos', -t.gastos],
      ['Utilidad neta', t.utilidad], ['Entradas (cargues y recaudos)', t.entradas], ['Salidas (envíos)', t.salidas]] as [string, number][]).forEach(([a, b]) => filas.push([a, b]));
    filas.push([]);
    filas.push([r.periodo === 'dia' ? 'Hora' : r.periodo === 'mes' ? 'Día' : 'Mes', 'Ingresos', 'Gastos', 'Utilidad', 'Entradas', 'Salidas']);
    r.tramos.forEach((x, i) => filas.push([etiquetaTramo(r, i, true), x.ingresos, x.gastos, x.utilidad, x.entradas, x.salidas]));
    if (!r.cliente) {
      filas.push([]);
      filas.push(['Cliente', 'Correo', 'Entradas', 'Salidas', 'Cargues', 'Envíos', 'Ingresos', 'Gastos', 'Utilidad']);
      r.clientes.forEach(c => filas.push([c.nombre, c.email ?? '', c.entradas, c.salidas, c.nCargues, c.nEnvios, c.ingresos, c.gastos, c.utilidad]));
      if (r.caja.gastos.length) {
        filas.push([]);
        filas.push(['Egreso', 'Fecha', 'Bolsa', 'Monto']);
        r.caja.gastos.forEach(g => filas.push([g.descripcion, g.fecha, g.proveedor, g.monto]));
      }
    }
    const csv = '﻿' + filas.map(f => f.map(celdaCsv).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `reporte_${r.periodo}_${r.desde}${r.cliente ? '_cliente' : ''}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const t = r?.totales;
  const ant = r?.anterior ?? null;
  const vsTexto = r ? textoAnterior(r) : '';

  const boton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, minWidth: 34, padding: '0 10px', borderRadius: 10, background: 'transparent', border: `1px solid ${C.b2}`, color: C.text, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };

  return (
    <div style={{ fontFamily: FONT, color: C.text, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Filtros: una fila arriba de todo lo que filtran ── */}
      <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
        <div style={{ display: 'flex', background: C.base, border: `1px solid ${C.b2}`, borderRadius: 999, padding: 3 }}>
          {([['dia', 'Día'], ['mes', 'Mes'], ['anio', 'Año']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriodo(k)}
              style={{ border: 'none', borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, background: periodo === k ? C.text : 'transparent', color: periodo === k ? C.card : C.sub }}>{l}</button>
          ))}
        </div>
        <div className="flex items-center" style={{ gap: 6 }}>
          <button type="button" aria-label="Periodo anterior" onClick={() => setFecha(moverFecha(periodo, fecha, -1))} style={boton}><ChevronLeft size={16} /></button>
          <span style={{ minWidth: periodo === 'dia' ? 0 : 150, textAlign: 'center', fontSize: 14, fontWeight: 800, padding: '0 4px' }}>{tituloPeriodo(periodo, fecha)}</span>
          <button type="button" aria-label="Periodo siguiente" disabled={!haySiguiente} onClick={() => haySiguiente && setFecha(siguiente)} style={{ ...boton, opacity: haySiguiente ? 1 : 0.35, cursor: haySiguiente ? 'pointer' : 'default' }}><ChevronRight size={16} /></button>
          {!esActual && <button type="button" onClick={() => setFecha(hoy)} style={boton}>{periodo === 'dia' ? 'Hoy' : periodo === 'mes' ? 'Este mes' : 'Este año'}</button>}
        </div>
        {r?.cliente && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 6px 0 12px', borderRadius: 999, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', fontSize: 12.5, fontWeight: 700 }}>
            Cliente: {r.cliente.nombre}
            <button type="button" aria-label="Ver todos los clientes" onClick={() => setClienteId(null)} style={{ display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 999, background: 'transparent', border: 'none', color: C.text, cursor: 'pointer' }}><X size={14} /></button>
          </span>
        )}
        <div className="flex items-center" style={{ gap: 8, marginLeft: 'auto' }}>
          {cargando && <RefreshCw size={14} className="animate-spin" style={{ color: C.sub }} />}
          <button type="button" onClick={exportar} disabled={!r} style={{ ...boton, opacity: r ? 1 : 0.4 }}><Download size={14} /> Exportar CSV</button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ background: C.elev, border: '1px solid rgba(248,113,113,0.3)', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{error}</div>
      )}

      {!r && !error && <Tarjeta><p style={{ margin: 0, fontSize: 13, color: C.sub }}>Calculando el reporte…</p></Tarjeta>}

      {r && t && (
        // Al cambiar de periodo se deja el reporte anterior atenuado mientras
        // llega el nuevo: sin saltos ni pantallas en blanco.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: cargando ? 0.55 : 1, transition: 'opacity .15s' }}>
          {r.enCurso && (
            <p style={{ margin: 0, fontSize: 12, color: C.sub }}>
              Periodo en curso: cifras hasta el {new Date(r.corte).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </p>
          )}

          {/* ── La cifra principal y los indicadores ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]" style={{ gap: 16 }}>
            <Tarjeta style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: C.sub }}>Utilidad neta{r.cliente ? ' con este cliente' : ''}</p>
              <p style={{ margin: '4px 0 6px', fontSize: 48, lineHeight: 1.05, fontWeight: 800, letterSpacing: '-1.4px', color: t.utilidad < 0 ? C.rojoTexto : C.text }}>{plata(t.utilidad)}</p>
              <Cambio ahora={t.utilidad} antes={ant?.utilidad} texto={vsTexto} />
              <p style={{ margin: '10px 0 0', fontSize: 12, color: C.sub }}>
                Ingresos {plata(t.ingresos)} − gastos {plata(t.gastos)}
              </p>
            </Tarjeta>
            <div className="grid grid-cols-2" style={{ gap: 12 }}>
              {[
                { l: 'Ingresos', v: t.ingresos, a: ant?.ingresos, bueno: true, sub: `${t.nCargues.toLocaleString('es-CO')} cargues · ${t.nEnvios.toLocaleString('es-CO')} envíos` },
                { l: 'Gastos', v: t.gastos, a: ant?.gastos, bueno: false, sub: t.egresos ? `Incluye ${plata(t.egresos)} de egresos` : 'Costos de proveedores y pérdidas' },
                { l: 'Entró (cargues y recaudos)', v: t.entradas, a: ant?.entradas, bueno: true, sub: `${t.nEntradas.toLocaleString('es-CO')} operaciones` },
                { l: 'Salió (envíos)', v: t.salidas, a: ant?.salidas, bueno: true, sub: `${t.nSalidas.toLocaleString('es-CO')} envíos` },
              ].map(k => (
                <Tarjeta key={k.l} style={{ padding: 14 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.sub }}>{k.l}</p>
                  <p style={{ margin: '4px 0 2px', fontSize: 'clamp(16px, 4.4vw, 22px)', fontWeight: 800, letterSpacing: '-0.5px', overflowWrap: 'anywhere' }}>{plata(k.v)}</p>
                  <Cambio ahora={k.v} antes={k.a} subirEsBueno={k.bueno} texto="" />
                  <p style={{ margin: '4px 0 0', fontSize: 11.5, color: C.tenue }}>{k.sub}</p>
                </Tarjeta>
              ))}
            </div>
          </div>

          {/* ── Las dos gráficas ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2" style={{ gap: 16 }}>
            <Tarjeta>
              <Titulo sub={`Ingresos menos gastos, por ${unidad}. Abajo de la línea: ${unidad === 'mes' ? 'meses' : unidad === 'día' ? 'días' : 'horas'} en pérdida.`}>Utilidad neta por {unidad}</Titulo>
              <Columnas r={r} titulo={`Utilidad neta por ${unidad}`}
                series={[{ clave: 'u', nombre: 'Utilidad', color: v => v < 0 ? C.rojo : C.verde, valor: x => x.utilidad }]}
                detalle={x => [{ nombre: 'Utilidad', valor: x.utilidad, fuerte: true }, { nombre: 'Ingresos', valor: x.ingresos }, { nombre: 'Gastos', valor: x.gastos }]} />
            </Tarjeta>
            <Tarjeta>
              <Titulo sub="La plata de los clientes que pasó por Lincoin.">Entradas y salidas por {unidad}</Titulo>
              <div className="flex items-center" style={{ gap: 14, margin: '-4px 0 8px' }}>
                {[['Entró', C.entradas], ['Salió', C.salidas]].map(([n, c]) => (
                  <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.sub }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{n}
                  </span>
                ))}
              </div>
              <Columnas r={r} titulo={`Entradas y salidas por ${unidad}`} alto={202}
                series={[{ clave: 'e', nombre: 'Entró', color: () => C.entradas, valor: x => x.entradas }, { clave: 's', nombre: 'Salió', color: () => C.salidas, valor: x => x.salidas }]}
                detalle={x => [{ nombre: 'Entró', valor: x.entradas, color: C.entradas }, { nombre: 'Salió', valor: x.salidas, color: C.salidas }]} />
            </Tarjeta>
          </div>

          {/* ── Estado de resultados y utilidad por proveedor ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2" style={{ gap: 16 }}>
            <Tarjeta>
              <Titulo sub="De dónde salió la utilidad y en qué se fue.">Estado de resultados</Titulo>
              {(() => {
                const fila = (l: string, v: number, nota?: string, tipo: 'normal' | 'total' | 'final' = 'normal') => (
                  <div key={l} className="flex items-start justify-between" style={{ gap: 12, padding: tipo === 'normal' ? '6px 0' : '9px 0', borderTop: tipo !== 'normal' ? `1px solid ${tipo === 'final' ? C.b2 : C.b1}` : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: tipo === 'final' ? 14 : 13, fontWeight: tipo === 'normal' ? 500 : 800, color: C.text }}>{l}</p>
                      {nota && <p style={{ margin: '1px 0 0', fontSize: 11, color: C.tenue }}>{nota}</p>}
                    </div>
                    <span style={{ fontSize: tipo === 'final' ? 16 : 13, fontWeight: tipo === 'normal' ? 600 : 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: tipo === 'final' ? (v < 0 ? C.rojoTexto : C.verde) : C.text }}>{plata(v)}</span>
                  </div>
                );
                const rotulo = (s: string) => <p key={s} style={{ margin: '10px 0 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.sub }}>{s}</p>;
                return (
                  <div>
                    {rotulo('Ingresos')}
                    {fila('Margen en cargues', t.margenCargues, `Diferencia entre la tasa de venta del USDT y la que se le paga al cliente · ${t.nCargues.toLocaleString('es-CO')} cargues`)}
                    {fila('Comisiones de envíos', t.comisionesEnvios, `Lo cobrado a los clientes por ${t.nEnvios.toLocaleString('es-CO')} envíos`)}
                    {!r.cliente && fila('Otros ingresos', t.otrosIngresos, 'Ingresos externos registrados en la caja de Lincoin')}
                    {fila('Total ingresos', t.ingresos, undefined, 'total')}
                    {rotulo('Gastos')}
                    {fila('Cargues en pérdida', -t.perdidaCargues, r.avisos.carguesEnPerdida ? `${r.avisos.carguesEnPerdida} cargues pagaron más de lo que se vendió` : 'Ninguno en este periodo')}
                    {fila('Costo Mouv (0,10 % Bre-B)', -t.costoMouv, 'Se descuenta de cada cargue a Mouv')}
                    {fila('Costo de proveedores en envíos', -t.costoEnvios, r.avisos.enviosSinCosto ? `${r.avisos.enviosSinCosto} envíos no tienen el costo registrado y no restan aquí` : 'Lo que cobró cada proveedor por enviar')}
                    {!r.cliente && fila('Egresos registrados', -t.egresos, 'Gastos anotados en la caja de Lincoin (detalle abajo)')}
                    {fila('Total gastos', -t.gastos, undefined, 'total')}
                    {fila('Utilidad neta', t.utilidad, undefined, 'final')}
                    {!r.cliente && (r.caja.retiros > 0 || r.caja.aportes > 0) && (
                      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: C.sub, lineHeight: 1.5 }}>
                        No son gasto ni ingreso: {r.caja.retiros > 0 && <>se enviaron <b style={{ color: C.text }}>{plata(r.caja.retiros)}</b> de utilidad a la empresa</>}
                        {r.caja.retiros > 0 && r.caja.aportes > 0 && ' y '}
                        {r.caja.aportes > 0 && <>entraron <b style={{ color: C.text }}>{plata(r.caja.aportes)}</b> de aportes</>}.
                      </p>
                    )}
                  </div>
                );
              })()}
            </Tarjeta>

            <Tarjeta>
              <Titulo sub="La utilidad neta que dejó cada bolsa.">Utilidad por proveedor</Titulo>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[...r.fuentes].sort((a, b) => b.utilidad - a.utilidad).map(f => {
                  const vacia = !f.ingresos && !f.gastos && !f.entradas && !f.salidas;
                  return (
                    <div key={f.fuente} style={{ opacity: vacia ? 0.45 : 1 }}>
                      <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{f.fuente}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: f.utilidad < 0 ? C.rojoTexto : C.text }}>{plata(f.utilidad)}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.05)', marginTop: 5, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(0, Math.abs(f.utilidad) / maxUtilFuente * 100)}%`, height: '100%', borderRadius: 999, background: f.utilidad < 0 ? C.rojo : C.verde }} />
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: C.tenue }}>
                        {vacia ? 'Sin movimientos' : `Ingresos ${plata(f.ingresos)} · gastos ${plata(f.gastos)} · entró ${compacto(f.entradas)} · salió ${compacto(f.salidas)}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Tarjeta>
          </div>

          {/* ── Egresos de la caja ── */}
          {!r.cliente && r.caja.gastos.length > 0 && (
            <Tarjeta>
              <Titulo sub="Lo que se anotó como egreso en la caja de Lincoin (Tesorería → Lincoin).">Egresos del periodo</Titulo>
              <div>
                {(verEgresos ? r.caja.gastos : r.caja.gastos.slice(0, 6)).map((g, i) => (
                  <div key={g.id} className="flex items-center justify-between" style={{ gap: 12, padding: '9px 0', borderTop: i ? `1px solid ${C.b1}` : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{g.descripcion || 'Sin descripción'}</p>
                      <p style={{ margin: '1px 0 0', fontSize: 11.5, color: C.sub }}>{diaCorto(g.fecha)} · bolsa {g.proveedor}</p>
                    </div>
                    <span style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{plata(-g.monto)}</span>
                  </div>
                ))}
              </div>
              {r.caja.gastos.length > 6 && (
                <button type="button" onClick={() => setVerEgresos(v => !v)} style={{ ...boton, marginTop: 8 }}>
                  {verEgresos ? 'Ver menos' : `Ver los ${r.caja.gastos.length} egresos`}
                </button>
              )}
            </Tarjeta>
          )}

          {/* ── Por cliente ── */}
          {!r.cliente && (
            <Tarjeta>
              <div className="flex items-start justify-between flex-wrap" style={{ gap: 10, marginBottom: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800 }}>Por cliente</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: C.sub }}>{r.nClientes.toLocaleString('es-CO')} clientes con movimiento. Toca uno para ver su reporte.</p>
                </div>
                <div style={{ position: 'relative', width: 240, maxWidth: '100%' }}>
                  <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: C.sub }} />
                  <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar cliente…"
                    style={{ width: '100%', height: 34, boxSizing: 'border-box', background: C.base, border: `1px solid ${C.b2}`, borderRadius: 10, padding: '0 10px 0 31px', color: C.text, fontSize: 12.5, outline: 'none', fontFamily: FONT }} />
                </div>
              </div>
              {clientesFiltrados.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>{buscar ? 'Ningún cliente coincide.' : 'Ningún cliente tuvo movimientos en este periodo.'}</p>
              ) : (
                <div>
                  {/* En el celular, una lista: la tabla de seis columnas obligaba a
                      deslizar de lado para ver la utilidad. */}
                  <div className="sm:hidden">
                    {(verTodos ? clientesFiltrados : clientesFiltrados.slice(0, 15)).map((c, i) => (
                      <button key={c.id} type="button" onClick={() => setClienteId(c.id)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: i ? `1px solid ${C.b1}` : 'none', padding: '10px 0', color: C.text, cursor: 'pointer', fontFamily: FONT }}>
                        <span className="flex items-baseline justify-between" style={{ gap: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{c.nombre}</span>
                          <span style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: 'nowrap', color: c.utilidad < 0 ? C.rojoTexto : C.text }}>{plata(c.utilidad)}</span>
                        </span>
                        <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: C.tenue, lineHeight: 1.5 }}>
                          Entró {compacto(c.entradas)} · salió {compacto(c.salidas)} · ingresos {plata(c.ingresos)} · gastos {plata(c.gastos)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        {['Cliente', 'Entró', 'Salió', 'Ingresos', 'Gastos', 'Utilidad'].map((h, i) => (
                          <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '0 10px 8px', fontSize: 11, fontWeight: 700, color: C.sub, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(verTodos ? clientesFiltrados : clientesFiltrados.slice(0, 15)).map(c => (
                        <tr key={c.id} onClick={() => setClienteId(c.id)} className="hover:bg-white/5" style={{ borderTop: `1px solid ${C.b1}`, cursor: 'pointer' }}>
                          <td style={{ padding: '9px 10px', minWidth: 180 }}>
                            <button type="button" onClick={e => { e.stopPropagation(); setClienteId(c.id); }}
                              style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', color: C.text, cursor: 'pointer', fontFamily: FONT }}>
                              <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{c.nombre}</span>
                              <span style={{ display: 'block', fontSize: 11, color: C.tenue }}>{c.empresa ? 'Empresa' : 'Operador'} · {c.nCargues} cargues · {c.nEnvios} envíos</span>
                            </button>
                          </td>
                          {[c.entradas, c.salidas, c.ingresos, -c.gastos].map((v, i) => (
                            <td key={i} style={{ padding: '9px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: C.text }}>{plata(v)}</td>
                          ))}
                          <td style={{ padding: '9px 10px', textAlign: 'right', whiteSpace: 'nowrap', minWidth: 140 }}>
                            <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: c.utilidad < 0 ? C.rojoTexto : C.text }}>{plata(c.utilidad)}</span>
                            <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.05)', marginTop: 4, marginLeft: 'auto', width: 110 }}>
                              <div style={{ width: `${Math.abs(c.utilidad) / maxUtilCli * 100}%`, height: '100%', borderRadius: 999, background: c.utilidad < 0 ? C.rojo : C.verde, marginLeft: 'auto' }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  {clientesFiltrados.length > 15 && (
                    <button type="button" onClick={() => setVerTodos(v => !v)} style={{ ...boton, marginTop: 10 }}>
                      {verTodos ? 'Ver menos' : `Ver los ${clientesFiltrados.length.toLocaleString('es-CO')}`}
                    </button>
                  )}
                  {r.nClientes > r.clientes.length && (
                    <p style={{ margin: '8px 0 0', fontSize: 11.5, color: C.tenue }}>Se muestran los {r.clientes.length} con más utilidad; el CSV trae los mismos.</p>
                  )}
                </div>
              )}
            </Tarjeta>
          )}

          {/* ── Cómo leer las cifras ── */}
          {(r.avisos.enviosSinCosto > 0 || r.avisos.carguesSinContabilidad > 0 || r.avisos.parcial) && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', borderRadius: 12, border: `1px solid ${C.b1}`, background: C.card }}>
              <Info size={15} style={{ color: C.sub, flexShrink: 0, marginTop: 1 }} />
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12, color: C.sub, lineHeight: 1.6 }}>
                {r.avisos.carguesSinContabilidad > 0 && <li>{r.avisos.carguesSinContabilidad} cargues no tienen la operación (USDT y tasas) registrada: no suman margen.</li>}
                {r.avisos.enviosSinCosto > 0 && <li>{r.avisos.enviosSinCosto} envíos no tienen registrado el costo del proveedor: su comisión cuenta completa como ingreso.</li>}
                {r.avisos.parcial && <li style={{ color: C.ambar }}>El periodo tiene demasiados movimientos y el cálculo quedó incompleto. Mira un periodo más corto.</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
