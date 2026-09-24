// ══════════════════════════════════════════════════════════════════
//  Contabilidad · Dashboard — Lincoin Empresas
//
//  Cuánto le enviaste a cada beneficiario, por riel y por periodo. Antes eran
//  doce tarjetas (mes / año / histórico / envíos × tres rieles) y una lista:
//  doce números sueltos sin una forma que los relacione. Acá los mismos datos
//  se leen en una pasada: cuatro cifras, un gráfico de barras apiladas por
//  riel, una dona, los cinco que más reciben, el resumen por riel y la tabla.
//
//  UNA SOLA FUENTE DE VERDAD. Los movimientos de cada beneficiario llegan por
//  `movimientosDe`, la misma función que alimenta las barras de la lista de
//  Beneficiarios y el extracto. Si este dashboard calculara lo suyo, tarde o
//  temprano diría un número distinto del extracto de la misma persona.
//
//  CUENTA LO COMPLETADO Y LO PROCESANDO: la plata ya salió. Que el riel tarde
//  en confirmar no la devuelve a la cuenta.
//
//  LOS COLORES SON DE MARCA, NO DE GRÁFICO. ACH verde, Bre-B blanco, COP gris.
//  Pasaron por el validador de paletas: los dos rieles activos se distinguen
//  con holgura (ΔE 16 en daltonismo, 24 en visión normal). El gris de COP
//  tiene poco contraste contra la tarjeta (1,8:1) y por eso NUNCA es el único
//  portador de un dato: cada valor está también en la tabla "Resumen por riel",
//  en el tooltip y en la leyenda. Y nada de rojos ni amarillos: acá no hay
//  errores que señalar, hay plata que contar.
//
//  SOLO SE GRAFICA LO QUE ESTÁ EN PESOS. Un envío en USDT a una wallet no se
//  puede apilar sobre uno en COP sin inventar una tasa. Esos van en el resumen
//  por riel con su moneda, fuera del gráfico, y se dice.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MouvContact } from './ContactsSection';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  pagina: '#070808', tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', medio: '#b9beba',
  ach: '#4ADE80', breb: '#F4F4F2', cop: 'rgba(255,255,255,0.15)',
  guia: 'rgba(255,255,255,0.05)', hover: 'rgba(255,255,255,0.02)',
  tooltipFondo: '#161A17', tooltipBorde: 'rgba(255,255,255,0.14)',
};

export type Periodo = 'mes' | 'anio' | 'historico';
type Riel = 'ACH' | 'Bre-B' | 'COP';
const RIELES: Riel[] = ['ACH', 'Bre-B', 'COP'];
const COLOR_RIEL: Record<Riel, string> = { ACH: C.ach, 'Bre-B': C.breb, COP: C.cop };

// El riel se lee de la moneda del movimiento: COP_ACH, COP_BREB, COP. En
// pantalla se llaman ACH, Bre-B y COP. Cualquier otra moneda (USDT a una
// wallet) no es un riel en pesos y no entra al gráfico.
const rielDe = (t: any): Riel | null => {
  const m = String(t?.currency ?? '');
  if (m === 'COP_ACH') return 'ACH';
  if (m === 'COP_BREB') return 'Bre-B';
  if (m === 'COP') return 'COP';
  return null;
};
const cuando = (t: any) => new Date(t?.createdAt ?? t?.created_at ?? t?.date ?? 0).getTime() || 0;
const cuenta = (t: any) => t?.status === 'Completado' || t?.status === 'Procesando';

// Millones de pesos, formato es-CO. Con un decimal hasta 100 M; enteros después.
const M = (v: number, dec?: number) =>
  `${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: dec ?? (Math.abs(v) >= 100e6 ? 0 : 1), minimumFractionDigits: 0 })} M`;
const COP = (v: number) => `${Math.round(v).toLocaleString('es-CO')} COP`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

type Props = {
  contacts: MouvContact[];
  transactions: any[];
  userId?: string | null;
  movimientosDe: (c: MouvContact) => any[];
  rowMeta: (c: MouvContact) => { bankName: string; maskLine: string; railLine: string; isWallet: boolean };
  initialsOf: (n: string) => string;
  prettyName: (n: string) => string;
  onExtracto: (c: MouvContact) => void;
  onCompliance: (c: MouvContact) => void;
};

// ── Tarjeta base ────────────────────────────────────────────────────
const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({ children, style, className }) => (
  <div className={className} style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '18px 20px', minWidth: 0, ...style }}>
    {children}
  </div>
);
const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', color: C.sub, margin: 0 }}>{children}</p>
);
const Swatch: React.FC<{ riel: Riel }> = ({ riel }) => (
  <span style={{ width: 10, height: 10, borderRadius: 3, background: COLOR_RIEL[riel], border: riel === 'COP' ? `1px solid rgba(255,255,255,0.25)` : 'none', flexShrink: 0, display: 'inline-block' }} />
);

// ── Ancho del contenedor, para que el SVG no estire el texto ────────
function useAncho<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setW(Math.max(240, el.clientWidth));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ── Barras apiladas ─────────────────────────────────────────────────
type Cubo = { rot: string; rotLargo: string; ACH: number; 'Bre-B': number; COP: number };
const BarrasApiladas: React.FC<{ cubos: Cubo[]; titulo: string }> = ({ cubos, titulo }) => {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sobre, setSobre] = useState<number | null>(null);
  const alto = 230, padL = 46, padR = 12, padT = 14, padB = 26;
  const areaW = ancho - padL - padR, areaH = alto - padT - padB;
  const max = Math.max(1, ...cubos.map(c => c.ACH + c['Bre-B'] + c.COP));
  // 5 guías a valores "redondos" en millones.
  const paso = (() => {
    const bruto = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
    const cand = [1, 2, 2.5, 5, 10].map(k => k * mag);
    return cand.find(k => k >= bruto) ?? cand[cand.length - 1];
  })();
  const techo = paso * 4 >= max ? paso * 4 : paso * 5;
  const guias = [0, 1, 2, 3, 4].map(i => (techo / 4) * i);
  const n = cubos.length;
  const slot = n > 0 ? areaW / n : areaW;
  const barW = Math.max(3, Math.min(28, slot * 0.62));
  const y = (v: number) => padT + areaH - (v / techo) * areaH;
  const hayAlgo = cubos.some(c => c.ACH + c['Bre-B'] + c.COP > 0);
  // Etiquetas del eje X: no más de ~10 para que no se pisen.
  const cadaN = Math.max(1, Math.ceil(n / 10));
  const tip = sobre != null ? cubos[sobre] : null;

  return (
    <Tarjeta style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column' }} className="lincoin-graf-barras">
      <div className="flex items-start justify-between flex-wrap" style={{ gap: 10 }}>
        <Rotulo>{titulo}</Rotulo>
        <div className="flex items-center" style={{ gap: 14 }}>
          {(['ACH', 'Bre-B'] as Riel[]).map(r => (
            <span key={r} className="flex items-center" style={{ gap: 6, fontSize: 11.5, color: C.medio }}><Swatch riel={r} />{r}</span>
          ))}
        </div>
      </div>
      <div ref={ref} style={{ position: 'relative', marginTop: 10, flex: 1 }}>
        {!hayAlgo && (
          <p style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12.5, color: C.tenue, margin: 0 }}>Sin envíos en el periodo.</p>
        )}
        <svg width={ancho} height={alto} style={{ display: 'block', fontFamily: FONT }} onMouseLeave={() => setSobre(null)}>
          {guias.map((g, i) => (
            <g key={i}>
              <line x1={padL} x2={ancho - padR} y1={y(g)} y2={y(g)} stroke={C.guia} strokeWidth={1} />
              <text x={padL - 8} y={y(g) + 3.5} textAnchor="end" fontSize={10} fill={C.tenue} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {g === 0 ? '0' : M(g, g >= 100e6 ? 0 : 1).replace(' M', '')}
              </text>
            </g>
          ))}
          <text x={padL - 8} y={padT - 4} textAnchor="end" fontSize={9} fill={C.tenue}>M COP</text>
          {cubos.map((c, i) => {
            const x = padL + slot * i + (slot - barW) / 2;
            const apagado = sobre != null && sobre !== i;
            const yAch = y(c.ACH), yBreb = y(c.ACH + c['Bre-B']), yCop = y(c.ACH + c['Bre-B'] + c.COP);
            const base = y(0);
            const hAch = base - yAch, hBreb = yAch - yBreb, hCop = yBreb - yCop;
            // Separador de 2px del color de la tarjeta entre segmentos, y
            // esquina superior redondeada solo en el segmento de arriba.
            const seg = (yy: number, h: number, fill: string, arriba: boolean) => h <= 0 ? null : (
              <path key={fill + yy} d={arriba
                ? `M${x},${yy + h} V${yy + 3} q0,-3 3,-3 h${barW - 6} q3,0 3,3 V${yy + h} Z`
                : `M${x},${yy} h${barW} v${h} h${-barW} Z`}
                fill={fill} />
            );
            const topAch = hBreb <= 0 && hCop <= 0, topBreb = hCop <= 0 && hBreb > 0;
            return (
              <g key={i} opacity={apagado ? 0.45 : 1} style={{ transition: 'opacity 120ms' }}
                onMouseEnter={() => setSobre(i)}>
                {/* Área de impacto más grande que la barra. */}
                <rect x={padL + slot * i} y={padT} width={slot} height={areaH} fill="transparent" />
                {seg(yAch, hAch, C.ach, topAch)}
                {hBreb > 0 && hAch > 0 && <rect x={x} y={yAch - 1} width={barW} height={2} fill={C.tarjeta} />}
                {seg(yBreb, hBreb, C.breb, topBreb)}
                {hCop > 0 && (hBreb > 0 || hAch > 0) && <rect x={x} y={yBreb - 1} width={barW} height={2} fill={C.tarjeta} />}
                {seg(yCop, hCop, C.cop, true)}
                {(i % cadaN === 0 || n <= 12) && (
                  <text x={padL + slot * i + slot / 2} y={alto - 8} textAnchor="middle" fontSize={10} fill={C.tenue}>{c.rot}</text>
                )}
              </g>
            );
          })}
        </svg>
        {tip && (tip.ACH + tip['Bre-B'] + tip.COP > 0) && (() => {
          const i = sobre as number;
          const cx = padL + slot * i + slot / 2;
          const izq = cx > ancho / 2;
          return (
            <div style={{
              position: 'absolute', top: 6, left: izq ? undefined : Math.min(cx + 10, ancho - 190), right: izq ? Math.max(ancho - cx + 10, 0) : undefined,
              background: C.tooltipFondo, border: `1px solid ${C.tooltipBorde}`, borderRadius: 10, padding: '9px 12px', pointerEvents: 'none', minWidth: 170,
            }}>
              <p style={{ fontSize: 11, color: C.sub, margin: 0 }}>{tip.rotLargo}</p>
              {(['ACH', 'Bre-B', 'COP'] as Riel[]).filter(r => tip[r] > 0).map(r => (
                <p key={r} className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}>
                  <span className="flex items-center" style={{ gap: 6 }}><Swatch riel={r} />{r}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{COP(tip[r])}</span>
                </p>
              ))}
              <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '6px 0 0', paddingTop: 6, borderTop: `1px solid ${C.borde}`, gap: 12 }}>
                <span style={{ color: C.sub }}>Total</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>{COP(tip.ACH + tip['Bre-B'] + tip.COP)}</span>
              </p>
            </div>
          );
        })()}
      </div>
    </Tarjeta>
  );
};

// ── Dona por riel ───────────────────────────────────────────────────
const Dona: React.FC<{ porRiel: Record<Riel, { monto: number; envios: number }>; total: number }> = ({ porRiel, total }) => {
  const size = 164, trazo = 14, r = (size - trazo) / 2, cx = size / 2, cy = size / 2;
  const per = 2 * Math.PI * r;
  const partes = RIELES.map(k => ({ riel: k, ...porRiel[k] })).filter(p => p.monto > 0);
  // Cada arco con un hueco de 2px del color de la tarjeta.
  let acum = 0;
  const arcos = partes.map(p => {
    const frac = total > 0 ? p.monto / total : 0;
    const largo = Math.max(0, frac * per - (partes.length > 1 ? 2 : 0));
    const el = { ...p, frac, dash: `${largo} ${per - largo}`, offset: -acum * per };
    acum += frac;
    return el;
  });
  return (
    <Tarjeta style={{ display: 'flex', flexDirection: 'column' }}>
      <Rotulo>POR RIEL</Rotulo>
      <div className="flex items-center justify-center" style={{ marginTop: 10 }}>
        <div style={{ position: 'relative', width: size, height: size }}>
          <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.guia} strokeWidth={trazo} />
            {arcos.map(a => (
              <circle key={a.riel} cx={cx} cy={cy} r={r} fill="none" stroke={COLOR_RIEL[a.riel]} strokeWidth={trazo}
                strokeDasharray={a.dash} strokeDashoffset={a.offset} />
            ))}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <p style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? M(total) : '—'}</p>
              <p style={{ fontSize: 10, color: C.tenue, margin: '2px 0 0' }}>COP</p>
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        {RIELES.map(k => {
          const p = porRiel[k];
          const vacio = p.monto <= 0;
          return (
            <div key={k} className="flex items-center justify-between" style={{ gap: 10, padding: '7px 0', borderTop: `1px solid ${C.borde}`, color: vacio ? C.tenue : C.text }}>
              <span className="flex items-center" style={{ gap: 8, fontSize: 12.5 }}><Swatch riel={k} />{k}</span>
              <span style={{ fontSize: 12, color: vacio ? C.tenue : C.sub, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {p.envios} {p.envios === 1 ? 'envío' : 'envíos'} · <b style={{ color: vacio ? C.tenue : C.text, fontWeight: 700 }}>{pct(p.monto, total)} %</b>
              </span>
            </div>
          );
        })}
      </div>
    </Tarjeta>
  );
};

// ── El dashboard ────────────────────────────────────────────────────
export const ContabilidadDashboard: React.FC<Props> = ({
  contacts, transactions, userId, movimientosDe, rowMeta, initialsOf, prettyName, onExtracto, onCompliance,
}) => {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [busca, setBusca] = useState('');
  const [verTodos, setVerTodos] = useState(false);

  const ahora = useMemo(() => new Date(), []);
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
  const inicioAnio = new Date(ahora.getFullYear(), 0, 1).getTime();
  const inicioMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).getTime();
  const inicioAnioAnt = new Date(ahora.getFullYear() - 1, 0, 1).getTime();

  // Rango del periodo elegido y del anterior (para el delta).
  const rango = (p: Periodo): [number, number] =>
    p === 'mes' ? [inicioMes, Infinity] : p === 'anio' ? [inicioAnio, Infinity] : [0, Infinity];
  const rangoAnterior = (p: Periodo): [number, number] | null =>
    p === 'mes' ? [inicioMesAnt, inicioMes] : p === 'anio' ? [inicioAnioAnt, inicioAnio] : null;
  const enRango = (t: any, [a, b]: [number, number]) => { const ts = cuando(t); return ts >= a && ts < b; };

  // ── Los datos, una sola vez por cambio de insumos ──
  const datos = useMemo(() => {
    // Todos los envíos de la cuenta que cuentan (salieron). Incluye los que no
    // casan con ningún beneficiario inscrito: son plata que salió igual.
    const todos = (transactions ?? []).filter(t =>
      t.userId === userId && (t.type === 'dispersion' || t.type === 'send') && cuenta(t));
    // Por beneficiario, con la MISMA función que usan la lista y el extracto.
    const porBenef = contacts.map(c => ({ c, movs: movimientosDe(c).filter(cuenta) }));
    const idsCasados = new Set<any>();
    for (const b of porBenef) for (const t of b.movs) idsCasados.add(t.id ?? t);
    const sinBenef = todos.filter(t => !idsCasados.has(t.id ?? t));
    // Moneda que no es COP: se cuenta aparte, no se grafica.
    const otrasMonedas: Record<string, { monto: number; envios: number }> = {};
    for (const t of todos) {
      if (rielDe(t)) continue;
      const m = String(t.currency ?? '?');
      const acc = otrasMonedas[m] ?? (otrasMonedas[m] = { monto: 0, envios: 0 });
      acc.monto += Number(t.amount) || 0; acc.envios += 1;
    }
    return { todos, porBenef, sinBenef, otrasMonedas };
  }, [contacts, transactions, userId, movimientosDe]);

  const R = rango(periodo), RA = rangoAnterior(periodo);
  const enP = (t: any) => enRango(t, R);
  const suma = (ts: any[]) => ts.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const enPesos = (ts: any[]) => ts.filter(t => rielDe(t));

  // KPIs — solo pesos.
  const delP = enPesos(datos.todos.filter(enP));
  const total = suma(delP);
  const envios = delP.length;
  const totalAnt = RA ? suma(enPesos(datos.todos.filter(t => enRango(t, RA)))) : null;
  const delta = totalAnt != null && totalAnt > 0 ? ((total - totalAnt) / totalAnt) * 100 : null;
  const ticket = envios > 0 ? total / envios : 0;
  const porRiel: Record<Riel, { monto: number; envios: number }> = { ACH: { monto: 0, envios: 0 }, 'Bre-B': { monto: 0, envios: 0 }, COP: { monto: 0, envios: 0 } };
  for (const t of delP) { const r = rielDe(t)!; porRiel[r].monto += Number(t.amount) || 0; porRiel[r].envios += 1; }
  const activos = datos.porBenef.filter(b => enPesos(b.movs.filter(enP)).length > 0).length;

  // Cubos del gráfico: por día del mes, o por mes.
  const cubos: Cubo[] = useMemo(() => {
    const vacio = (rot: string, rotLargo: string): Cubo => ({ rot, rotLargo, ACH: 0, 'Bre-B': 0, COP: 0 });
    let lista: Cubo[] = [];
    let clave: (t: any) => number;
    if (periodo === 'mes') {
      const dias = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
      lista = Array.from({ length: dias }, (_, i) => vacio(String(i + 1), `${i + 1} de ${MESES_L[ahora.getMonth()]}`));
      clave = t => new Date(cuando(t)).getDate() - 1;
    } else if (periodo === 'anio') {
      lista = MESES.map((m, i) => vacio(m, `${MESES_L[i]} ${ahora.getFullYear()}`));
      clave = t => new Date(cuando(t)).getMonth();
    } else {
      const ts = delP.map(cuando).filter(Boolean);
      const primero = ts.length ? new Date(Math.min(...ts)) : ahora;
      const desde = new Date(primero.getFullYear(), primero.getMonth(), 1);
      const n = Math.max(1, (ahora.getFullYear() - desde.getFullYear()) * 12 + (ahora.getMonth() - desde.getMonth()) + 1);
      const recorte = Math.max(0, n - 24);
      lista = Array.from({ length: n - recorte }, (_, i) => {
        const d = new Date(desde.getFullYear(), desde.getMonth() + recorte + i, 1);
        return vacio(`${MESES[d.getMonth()]}${d.getMonth() === 0 || i === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ''}`, `${MESES_L[d.getMonth()]} ${d.getFullYear()}`);
      });
      clave = t => { const d = new Date(cuando(t)); return (d.getFullYear() - desde.getFullYear()) * 12 + (d.getMonth() - desde.getMonth()) - recorte; };
    }
    for (const t of delP) {
      const i = clave(t);
      if (i < 0 || i >= lista.length) continue;
      lista[i][rielDe(t)!] += Number(t.amount) || 0;
    }
    return lista;
  }, [periodo, delP.length, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Por beneficiario, para top 5 y tabla.
  const filas = useMemo(() => datos.porBenef.map(({ c, movs }) => {
    const pesos = enPesos(movs);
    const mes = suma(pesos.filter(t => enRango(t, [inicioMes, Infinity])));
    const anio = suma(pesos.filter(t => enRango(t, [inicioAnio, Infinity])));
    const hist = suma(pesos);
    const enPeriodo = pesos.filter(enP);
    return { c, mes, anio, hist, periodo: suma(enPeriodo), envios: enPeriodo.length };
  }).sort((a, b) => b.periodo - a.periodo || b.hist - a.hist), [datos, periodo]); // eslint-disable-line react-hooks/exhaustive-deps
  const top5 = filas.filter(f => f.periodo > 0).slice(0, 5);
  const q = busca.trim().toLowerCase();
  const visibles = filas.filter(f => !q || String(f.c.name).toLowerCase().includes(q));
  const sinEnvios = filas.filter(f => f.periodo <= 0).length;
  const PAG = 15;
  const mostradas = verTodos || q ? visibles : visibles.slice(0, PAG);

  // Resumen por riel: mes / año / histórico / envíos del periodo.
  const resumen = RIELES.map(k => {
    const de = (r: [number, number]) => suma(datos.todos.filter(t => rielDe(t) === k && enRango(t, r)));
    return { riel: k, mes: de([inicioMes, Infinity]), anio: de([inicioAnio, Infinity]), hist: de([0, Infinity]), envios: porRiel[k].envios };
  });

  // ── CSV, respetando el periodo ──
  const csv = (movs: { c: MouvContact | null; t: any }[], nombre: string) => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lineas = [['Fecha', 'Beneficiario', 'Banco o riel', 'Cuenta o llave', 'Riel', 'Tipo', 'Monto', 'Moneda', 'Estado', 'Referencia'].map(esc).join(',')];
    for (const { c, t } of movs) {
      const m = c ? rowMeta(c) : null;
      lineas.push([
        new Date(cuando(t)).toISOString(),
        c?.name ?? '(sin beneficiario inscrito)',
        m ? (m.bankName === '—' ? m.railLine : m.bankName) : '',
        c ? (c.accountKind === 'wallet' ? c.accountNumber : (c.brebKey ?? c.accountNumber)) : (t.account ?? ''),
        rielDe(t) ?? String(t.currency ?? ''),
        t.type === 'dispersion' ? 'Dispersión' : 'Envío',
        Number(t.amount) || 0, t.currency ?? 'COP', t.status ?? '',
        t.providerRef ?? t.reference ?? t.txHash ?? t.id ?? '',
      ].map(esc).join(','));
    }
    const url = URL.createObjectURL(new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `lincoin-contabilidad-${nombre}-${periodo}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const csvGeneral = () => {
    const filasCsv: { c: MouvContact | null; t: any }[] = [];
    for (const { c, movs } of datos.porBenef) for (const t of movs.filter(enP)) filasCsv.push({ c, t });
    for (const t of datos.sinBenef.filter(enP)) filasCsv.push({ c: null, t });
    filasCsv.sort((a, b) => cuando(b.t) - cuando(a.t));
    csv(filasCsv, 'beneficiarios');
  };
  const csvDe = (c: MouvContact) =>
    csv(movimientosDe(c).filter(cuenta).filter(enP).map(t => ({ c, t })), String(c.name).replace(/[^\w]+/g, '-').toLowerCase());

  const rotPeriodo = periodo === 'mes' ? 'este mes' : periodo === 'anio' ? 'este año' : 'histórico';
  const tituloBarras = periodo === 'mes' ? `ENVÍOS POR DÍA · ${MESES_L[ahora.getMonth()].toUpperCase()}` : 'ENVÍOS POR MES';
  const otras = Object.entries(datos.otrasMonedas) as [string, { monto: number; envios: number }][];
  const btnFantasma: React.CSSProperties = {
    fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent',
    border: `1px solid ${C.borde}`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. Encabezado: periodo + CSV */}
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 12 }}>
        <div className="flex" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: 3 }}>
          {([['mes', 'Este mes'], ['anio', 'Este año'], ['historico', 'Histórico']] as [Periodo, string][]).map(([k, rot]) => (
            <button key={k} onClick={() => { setPeriodo(k); setVerTodos(false); }}
              style={{
                fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer',
                color: periodo === k ? C.text : C.sub, background: periodo === k ? 'rgba(255,255,255,0.09)' : 'transparent', transition: 'background 120ms, color 120ms',
              }}>{rot}</button>
          ))}
        </div>
        <button onClick={csvGeneral} className="lincoin-btn-white"
          style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 18px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
          Descargar CSV
        </button>
      </div>

      {/* 2. KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        <Tarjeta>
          <Rotulo>TOTAL ENVIADO</Rotulo>
          <p style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 0', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>
            {M(total)} <span style={{ fontSize: 13, fontWeight: 600, color: C.sub }}>COP</span>
          </p>
          <p style={{ fontSize: 12, margin: '4px 0 0', color: delta != null && delta > 0 ? C.ach : C.sub }}>
            {delta == null
              ? (periodo === 'historico' ? 'Todo lo enviado en pesos' : 'Sin periodo anterior para comparar')
              : `${delta > 0 ? '+' : ''}${delta.toLocaleString('es-CO', { maximumFractionDigits: 1 })} % vs. ${periodo === 'mes' ? 'el mes anterior' : 'el año anterior'}`}
          </p>
        </Tarjeta>
        <Tarjeta>
          <Rotulo>ENVÍOS</Rotulo>
          <p style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 0', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>{envios}</p>
          <p style={{ fontSize: 12, margin: '4px 0 0', color: C.sub, fontVariantNumeric: 'tabular-nums' }}>
            {porRiel.ACH.envios} ACH · {porRiel['Bre-B'].envios} Bre-B{porRiel.COP.envios > 0 ? ` · ${porRiel.COP.envios} COP` : ''}
          </p>
        </Tarjeta>
        <Tarjeta>
          <Rotulo>TICKET PROMEDIO</Rotulo>
          <p style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 0', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>
            {envios > 0 ? M(ticket, ticket >= 100e6 ? 0 : 2) : '—'} <span style={{ fontSize: 13, fontWeight: 600, color: C.sub }}>COP</span>
          </p>
          <p style={{ fontSize: 12, margin: '4px 0 0', color: C.sub }}>Total dividido por envíos</p>
        </Tarjeta>
        <Tarjeta>
          <Rotulo>BENEFICIARIOS ACTIVOS</Rotulo>
          <p style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 0', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>
            {activos} <span style={{ fontSize: 13, fontWeight: 600, color: C.sub }}>de {contacts.length}</span>
          </p>
          <p style={{ fontSize: 12, margin: '4px 0 0', color: C.sub }}>
            {contacts.length - activos} sin envíos {rotPeriodo}
            {datos.sinBenef.filter(enP).length > 0 ? ` · ${datos.sinBenef.filter(enP).length} envíos sin beneficiario inscrito` : ''}
          </p>
        </Tarjeta>
      </div>

      {/* 3. Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }} className="lincoin-graf-fila">
        <BarrasApiladas cubos={cubos} titulo={tituloBarras} />
        <Dona porRiel={porRiel} total={total} />
      </div>

      {/* 4. Top 5 + Resumen por riel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Tarjeta>
          <Rotulo>TOP BENEFICIARIOS · {rotPeriodo.toUpperCase()}</Rotulo>
          {top5.length === 0 ? (
            <p style={{ fontSize: 12.5, color: C.tenue, margin: '14px 0 0' }}>Sin envíos en el periodo.</p>
          ) : top5.map((f, i) => (
            <div key={f.c.id} style={{ marginTop: i === 0 ? 12 : 10 }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <button onClick={() => onExtracto(f.c)} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: C.text, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {prettyName(f.c.name)}
                </button>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{M(f.periodo)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', marginTop: 5, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(2, (f.periodo / top5[0].periodo) * 100)}%`, height: '100%', background: C.ach, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </Tarjeta>
        <Tarjeta style={{ padding: '18px 0 6px' }}>
          <div style={{ padding: '0 20px' }}><Rotulo>RESUMEN POR RIEL</Rotulo></div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead>
                <tr>
                  {['RIEL', 'MES', 'AÑO', 'HISTÓRICO', 'ENVÍOS'].map((h, i) => (
                    <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i === 0 ? 'left' : 'right', padding: '8px 20px 8px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resumen.map(r => {
                  const vacio = r.hist <= 0;
                  const col = vacio ? C.tenue : C.text;
                  return (
                    <tr key={r.riel}>
                      <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, borderBottom: `1px solid ${C.borde}` }}>
                        <span className="flex items-center" style={{ gap: 8 }}><Swatch riel={r.riel} />{r.riel}</span>
                      </td>
                      {[r.mes, r.anio, r.hist].map((v, i) => (
                        <td key={i} style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{v > 0 ? M(v) : '—'}</td>
                      ))}
                      <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}` }}>{r.envios}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text }}>Total</td>
                  {[resumen.reduce((s, r) => s + r.mes, 0), resumen.reduce((s, r) => s + r.anio, 0), resumen.reduce((s, r) => s + r.hist, 0)].map((v, i) => (
                    <td key={i} style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v > 0 ? M(v) : '—'}</td>
                  ))}
                  <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{envios}</td>
                </tr>
                {/* Lo que no está en pesos no se grafica ni se suma arriba: se
                    dice acá, con su moneda. */}
                {otras.map(([mon, v]) => (
                  <tr key={mon}>
                    <td colSpan={5} style={{ padding: '8px 20px 10px', fontSize: 11.5, color: C.tenue, borderTop: `1px solid ${C.borde}` }}>
                      Además, {v.envios} {v.envios === 1 ? 'envío' : 'envíos'} en {mon} por {v.monto.toLocaleString('es-CO', { maximumFractionDigits: 2 })} {mon} (histórico). No se suma con los pesos ni entra al gráfico.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      </div>

      {/* 5. Tabla por beneficiario */}
      <Tarjeta style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '16px 20px', borderBottom: `1px solid ${C.borde}` }}>
          <div>
            <p style={{ fontSize: 14.5, fontWeight: 700, color: C.text, margin: 0 }}>Por beneficiario</p>
            <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>{contacts.length} beneficiarios · {sinEnvios} sin envíos {rotPeriodo}</p>
          </div>
          <input value={busca} onChange={e => { setBusca(e.target.value); }} placeholder="Buscar por nombre"
            style={{ fontFamily: FONT, fontSize: 13, color: C.text, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', outline: 'none', width: 240, maxWidth: '100%' }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                {['BENEFICIARIO', 'MES', 'AÑO', `% DEL ${periodo === 'mes' ? 'MES' : periodo === 'anio' ? 'AÑO' : 'TOTAL'}`, 'ENVÍOS', ''].map((h, i) => (
                  <th key={h || 'acc'} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i === 0 ? 'left' : i === 5 ? 'right' : 'right', padding: '9px 20px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mostradas.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '18px 20px', fontSize: 12.5, color: C.tenue }}>Nadie coincide con la búsqueda.</td></tr>
              )}
              {mostradas.map(f => {
                const m = rowMeta(f.c);
                const p = pct(f.periodo, total);
                const gris = f.periodo <= 0;
                return (
                  <tr key={f.c.id} className="lincoin-fila-benef" style={{ cursor: 'pointer' }} onClick={() => onExtracto(f.c)}>
                    <td style={{ padding: '11px 20px', borderBottom: `1px solid ${C.borde}` }}>
                      <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          <span style={{ color: C.sub, fontWeight: 800, fontSize: 12 }}>{initialsOf(f.c.name)}</span>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 13.5, fontWeight: 700, color: gris ? C.medio : C.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prettyName(f.c.name)}</p>
                          <p style={{ fontSize: 11.5, color: C.sub, margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.bankName} · {m.maskLine}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px 20px', fontSize: 12.5, color: f.mes > 0 ? C.text : C.tenue, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{f.mes > 0 ? COP(f.mes) : '—'}</td>
                    <td style={{ padding: '11px 20px', fontSize: 12.5, color: f.anio > 0 ? C.text : C.tenue, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{f.anio > 0 ? COP(f.anio) : '—'}</td>
                    <td style={{ padding: '11px 20px', borderBottom: `1px solid ${C.borde}`, minWidth: 150 }}>
                      <div className="flex items-center justify-end" style={{ gap: 10 }}>
                        <div style={{ width: 90, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, p)}%`, height: '100%', background: C.ach, borderRadius: 999 }} />
                        </div>
                        <span style={{ fontSize: 12, color: gris ? C.tenue : C.text, fontVariantNumeric: 'tabular-nums', width: 44, textAlign: 'right' }}>{gris ? '—' : `${p} %`}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 20px', fontSize: 12.5, color: gris ? C.tenue : C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}` }}>{f.envios}</td>
                    <td style={{ padding: '11px 20px', borderBottom: `1px solid ${C.borde}`, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => csvDe(f.c)} style={btnFantasma} className="hover:text-[#F4F4F2] hover:border-[rgba(255,255,255,0.22)] transition-colors" disabled={gris} title={gris ? 'Sin envíos en el periodo' : undefined}>CSV</button>
                      <button onClick={() => onCompliance(f.c)} style={{ ...btnFantasma, marginLeft: 6 }} className="hover:text-[#F4F4F2] hover:border-[rgba(255,255,255,0.22)] transition-colors">Compliance</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 20px' }}>
          <span style={{ fontSize: 12, color: C.sub }}>Mostrando {mostradas.length} de {visibles.length}</span>
          {!verTodos && !q && visibles.length > PAG && (
            <button onClick={() => setVerTodos(true)} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Ver todos los beneficiarios →
            </button>
          )}
        </div>
      </Tarjeta>

      {/* 6. Nota */}
      <p style={{ fontSize: 12, color: C.tenue, margin: 0, lineHeight: 1.55 }}>
        Cuenta lo Completado y lo Procesando: la plata ya salió. Depósitos, conversiones y demás movimientos están en Movimientos, con su propia exportación.
      </p>

      <style>{`
        .lincoin-fila-benef:hover td { background: ${C.hover}; }
        @media (max-width: 720px) { .lincoin-graf-barras { grid-column: span 1 !important; } }
      `}</style>
    </div>
  );
};
