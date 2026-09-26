// ══════════════════════════════════════════════════════════════════
//  Contabilidad · Dashboard — Lincoin Empresas
//
//  El libro de la cuenta: cuánto entró, cuánto salió, cuánto quedó, y cada
//  movimiento con su comprobante. Lo que se le mandó a CADA beneficiario ya
//  no vive acá —eso es una pregunta de cumplimiento y está en Compliance—.
//  Acá la pregunta es la de un contador: qué pasó con la plata este mes.
//
//  POR MONEDA, SIEMPRE. La cuenta tiene pesos y dólares, y no se suman: un
//  neto que mezcle COP con USD es un número inventado. Arriba hay un selector
//  de moneda y todo lo demás obedece.
//
//  UNA CONVERSIÓN ES DOS ASIENTOS. Cambiar COP a USD es una salida en pesos y
//  una entrada en dólares. Se registra así, en cada moneda lo suyo, porque
//  es lo que pasó.
//
//  CUENTA LO COMPLETADO Y LO PROCESANDO: la plata ya salió (o ya entró). Lo
//  rechazado se lista tachado y no suma. Un comprobante solo existe para lo
//  Completado: lo emite el servidor apenas la operación se completa.
//
//  LOS COLORES: entrada verde, salida blanca, y gris para lo que no cuenta.
//  Validados contra la tarjeta oscura (ΔE 16 en daltonismo, 24 en visión
//  normal entre las dos series). Todo valor está además en texto, en la
//  tabla o en el tooltip: el color acompaña, no carga el dato solo.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { llamarFuncion } from '../lib/edge';
import { FacturacionConfig } from './FacturacionConfig';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', medio: '#b9beba',
  entra: '#4ADE80', sale: '#F4F4F2', neutro: 'rgba(255,255,255,0.15)',
  guia: 'rgba(255,255,255,0.05)', hover: 'rgba(255,255,255,0.02)',
  tooltipFondo: '#161A17', tooltipBorde: 'rgba(255,255,255,0.14)',
};

export type Periodo = 'mes' | 'anio' | 'historico';
type Moneda = 'COP' | 'USD';
type Dir = 'in' | 'out';

const TIPO_ES: Record<string, string> = {
  load: 'Depósito', send: 'Retiro', dispersion: 'Envío', convert: 'Conversión', tx_created: 'Conversión',
  pay_received: 'Pago recibido', pay_sent: 'Pago enviado', otc_deposit: 'Depósito OTC', otc_withdraw: 'Retiro OTC',
};
const ENTRA = new Set(['load', 'pay_received', 'otc_deposit']);
const SALE = new Set(['send', 'dispersion', 'pay_sent', 'otc_withdraw']);
const familia = (cur: any): Moneda => (String(cur ?? '').toUpperCase().startsWith('COP') ? 'COP' : 'USD');
const cuando = (t: any) => new Date(t?.createdAt ?? t?.created_at ?? t?.date ?? 0).getTime() || 0;
const cuenta = (t: any) => t?.status === 'Completado' || t?.status === 'Procesando';

// Un asiento: una entrada o una salida, en una moneda. Una operación normal
// es un asiento; una conversión son dos.
type Asiento = { tx: any; dir: Dir; monto: number; moneda: Moneda; ts: number; tipo: string; contraparte: string; estado: string };
const asientosDe = (t: any): Asiento[] => {
  const ts = cuando(t);
  const estado = String(t.status ?? '');
  const base = { tx: t, ts, estado };
  const contra = (() => {
    if (t.type === 'dispersion' || t.type === 'send') return String(t.beneficiary ?? t.bank ?? '—');
    if (t.type === 'pay_received') return String(t.senderName ?? 'Usuario Lincoin');
    if (t.type === 'pay_sent') return String(t.recipientName ?? 'Usuario Lincoin');
    if (t.type === 'load') return String(t.method ?? t.bank ?? '—');
    if (t.type === 'otc_deposit' || t.type === 'otc_withdraw') return String(t.chain ?? t.walletKey ?? t.currency ?? '—');
    return '—';
  })();
  if (t.type === 'convert' || t.type === 'tx_created') {
    const de = String(t.currency ?? ''), a = String(t.targetCurrency ?? '');
    const out: Asiento[] = [{ ...base, dir: 'out', monto: Number(t.amount) || 0, moneda: familia(de), tipo: 'Conversión', contraparte: `${de.split('_')[0]} → ${a.split('_')[0] || '?'}` }];
    const tA = Number(t.targetAmount);
    if (a && Number.isFinite(tA) && tA > 0) out.push({ ...base, dir: 'in', monto: tA, moneda: familia(a), tipo: 'Conversión', contraparte: `${de.split('_')[0]} → ${a.split('_')[0]}` });
    return out;
  }
  if (ENTRA.has(t.type)) return [{ ...base, dir: 'in', monto: Number(t.amount) || 0, moneda: familia(t.currency), tipo: TIPO_ES[t.type] ?? t.type, contraparte: contra }];
  if (SALE.has(t.type)) return [{ ...base, dir: 'out', monto: Number(t.amount) || 0, moneda: familia(t.currency), tipo: TIPO_ES[t.type] ?? t.type, contraparte: contra }];
  return [];
};

const fmtMon = (v: number, m: Moneda) => `${v.toLocaleString('es-CO', { maximumFractionDigits: m === 'COP' ? 0 : 2 })} ${m}`;
const fmtCorto = (v: number, m: Moneda) => {
  if (m === 'COP' && Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: Math.abs(v) >= 100e6 ? 0 : 1 })} M`;
  return v.toLocaleString('es-CO', { maximumFractionDigits: m === 'COP' ? 0 : 2 });
};
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

type Props = {
  transactions: any[];
  userId?: string | null;
  onVerMovimiento?: (tx: any) => void;
};

const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({ children, style, className }) => (
  <div className={className} style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '18px 20px', minWidth: 0, ...style }}>{children}</div>
);
const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', color: C.sub, margin: 0 }}>{children}</p>
);
const Swatch: React.FC<{ color: string }> = ({ color }) => (
  <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block', flexShrink: 0 }} />
);

function useAncho<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const medir = () => setW(Math.max(240, el.clientWidth));
    medir();
    const ro = new ResizeObserver(medir); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ── Barras: entradas vs salidas, lado a lado ────────────────────────
type Cubo = { rot: string; rotLargo: string; entra: number; sale: number };
const Barras: React.FC<{ cubos: Cubo[]; titulo: string; moneda: Moneda }> = ({ cubos, titulo, moneda }) => {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sobre, setSobre] = useState<number | null>(null);
  const alto = 230, padL = 50, padR = 12, padT = 14, padB = 26;
  const areaW = ancho - padL - padR, areaH = alto - padT - padB;
  const max = Math.max(1, ...cubos.map(c => Math.max(c.entra, c.sale)));
  const paso = (() => {
    const bruto = max / 4, mag = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
    const cand = [1, 2, 2.5, 5, 10].map(k => k * mag);
    return cand.find(k => k >= bruto) ?? cand[cand.length - 1];
  })();
  const techo = paso * 4 >= max ? paso * 4 : paso * 5;
  const n = cubos.length, slot = n > 0 ? areaW / n : areaW;
  const grupoW = Math.max(4, Math.min(26, slot * 0.62)), barW = grupoW / 2;
  const y = (v: number) => padT + areaH - (v / techo) * areaH;
  const hayAlgo = cubos.some(c => c.entra + c.sale > 0);
  const cadaN = Math.max(1, Math.ceil(n / 10));
  const tip = sobre != null ? cubos[sobre] : null;
  const barra = (x: number, v: number, fill: string) => v <= 0 ? null : (
    <path d={`M${x},${y(0)} V${y(v) + 3} q0,-3 3,-3 h${Math.max(0, barW - 6)} q3,0 3,3 V${y(0)} Z`} fill={fill} />
  );
  return (
    <Tarjeta style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column' }} className="lincoin-graf-barras">
      <div className="flex items-start justify-between flex-wrap" style={{ gap: 10 }}>
        <Rotulo>{titulo}</Rotulo>
        <div className="flex items-center" style={{ gap: 14, fontSize: 11.5, color: C.medio }}>
          <span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.entra} />Recibido</span>
          <span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.sale} />Enviado</span>
        </div>
      </div>
      <div ref={ref} style={{ position: 'relative', marginTop: 10, flex: 1 }}>
        {!hayAlgo && <p style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12.5, color: C.tenue, margin: 0 }}>Sin movimientos en el periodo.</p>}
        <svg width={ancho} height={alto} style={{ display: 'block', fontFamily: FONT }} onMouseLeave={() => setSobre(null)}>
          {[0, 1, 2, 3, 4].map(i => { const g = (techo / 4) * i; return (
            <g key={i}>
              <line x1={padL} x2={ancho - padR} y1={y(g)} y2={y(g)} stroke={C.guia} />
              <text x={padL - 8} y={y(g) + 3.5} textAnchor="end" fontSize={10} fill={C.tenue} style={{ fontVariantNumeric: 'tabular-nums' }}>{g === 0 ? '0' : fmtCorto(g, moneda)}</text>
            </g>
          ); })}
          <text x={padL - 8} y={padT - 4} textAnchor="end" fontSize={9} fill={C.tenue}>{moneda === 'COP' ? 'M COP' : 'USD'}</text>
          {cubos.map((c, i) => {
            const x0 = padL + slot * i + (slot - grupoW) / 2;
            const apag = sobre != null && sobre !== i;
            return (
              <g key={i} opacity={apag ? 0.45 : 1} style={{ transition: 'opacity 120ms' }} onMouseEnter={() => setSobre(i)}>
                <rect x={padL + slot * i} y={padT} width={slot} height={areaH} fill="transparent" />
                {barra(x0, c.entra, C.entra)}
                {barra(x0 + barW + 1, c.sale, C.sale)}
                {(i % cadaN === 0 || n <= 12) && <text x={padL + slot * i + slot / 2} y={alto - 8} textAnchor="middle" fontSize={10} fill={C.tenue}>{c.rot}</text>}
              </g>
            );
          })}
        </svg>
        {tip && tip.entra + tip.sale > 0 && (() => {
          const cx = padL + slot * (sobre as number) + slot / 2, izq = cx > ancho / 2;
          return (
            <div style={{ position: 'absolute', top: 6, left: izq ? undefined : Math.min(cx + 10, ancho - 200), right: izq ? Math.max(ancho - cx + 10, 0) : undefined, background: C.tooltipFondo, border: `1px solid ${C.tooltipBorde}`, borderRadius: 10, padding: '9px 12px', pointerEvents: 'none', minWidth: 180 }}>
              <p style={{ fontSize: 11, color: C.sub, margin: 0 }}>{tip.rotLargo}</p>
              <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}><span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.entra} />Recibido</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMon(tip.entra, moneda)}</b></p>
              <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}><span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.sale} />Enviado</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMon(tip.sale, moneda)}</b></p>
              <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '6px 0 0', paddingTop: 6, borderTop: `1px solid ${C.borde}`, gap: 12 }}><span style={{ color: C.sub }}>Neto</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{(tip.entra - tip.sale >= 0 ? '+' : '−') + fmtMon(Math.abs(tip.entra - tip.sale), moneda)}</b></p>
            </div>
          );
        })()}
      </div>
    </Tarjeta>
  );
};

export const ContabilidadDashboard: React.FC<Props> = ({ transactions, userId, onVerMovimiento }) => {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [monedaSel, setMonedaSel] = useState<Moneda | null>(null);
  const [filtroDir, setFiltroDir] = useState<'todos' | 'in' | 'out' | 'conv'>('todos');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(25);
  const [folios, setFolios] = useState<Record<string, { folio: number; numero: string; enviado: boolean; factura?: { estado: string | null; numero: string | null; url: string | null; error: string | null; tipo: string | null } }>>({});
  const [foliosEstado, setFoliosEstado] = useState<'cargando' | 'ok' | 'sin_tabla' | 'error'>('cargando');
  const [configAbierta, setConfigAbierta] = useState(false);
  const [facturacionActiva, setFacturacionActiva] = useState<boolean | null>(null);
  const [reintentando, setReintentando] = useState<number | null>(null);
  const [foliosVersion, setFoliosVersion] = useState(0);

  const ahora = useMemo(() => new Date(), []);
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
  const inicioAnio = new Date(ahora.getFullYear(), 0, 1).getTime();
  const inicioMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).getTime();
  const inicioAnioAnt = new Date(ahora.getFullYear() - 1, 0, 1).getTime();
  const rango = (p: Periodo): [number, number] => p === 'mes' ? [inicioMes, Infinity] : p === 'anio' ? [inicioAnio, Infinity] : [0, Infinity];
  const rangoAnt = (p: Periodo): [number, number] | null => p === 'mes' ? [inicioMesAnt, inicioMes] : p === 'anio' ? [inicioAnioAnt, inicioAnio] : null;
  const en = (a: Asiento, [d, h]: [number, number]) => a.ts >= d && a.ts < h;

  // Los comprobantes emitidos por el servidor, para ponerle número a cada
  // movimiento. Si la tabla no existe todavía, la columna dice por qué.
  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    (async () => {
      // `*` a propósito: si una columna nueva (factura_tipo) todavía no
      // existe porque falta correr su migración, nombrarla rompería toda la
      // consulta y la columna COMPROBANTE quedaría vacía.
      const { data, error } = await supabase.from('comprobantes')
        .select('*')
        .eq('user_id', userId).limit(2000);
      if (!vivo) return;
      if (error) { setFoliosEstado(/does not exist|42P01|schema cache/i.test(error.message) ? 'sin_tabla' : 'error'); return; }
      const m: typeof folios = {};
      for (const r of (data ?? []) as any[]) m[String(r.transaction_id)] = {
        folio: Number(r.folio), numero: String(r.numero), enviado: !!r.enviado_at,
        factura: { estado: r.factura_estado ?? null, numero: r.factura_numero ?? null, url: r.factura_url ?? null, error: r.factura_error ?? null, tipo: r.factura_tipo ?? null },
      };
      setFolios(m); setFoliosEstado('ok');
    })();
    return () => { vivo = false; };
  }, [userId, foliosVersion]);
  // ¿Tiene la facturación automática activa? Solo para decidir qué dice la
  // columna FACTURA y el botón de configuración.
  useEffect(() => {
    if (!userId) return;
    llamarFuncion('facturacion', { action: 'config_get' }, 20000)
      .then((r: any) => setFacturacionActiva(!!r?.config?.activo))
      .catch(() => setFacturacionActiva(null));
  }, [userId, configAbierta]);
  const reintentarFactura = async (folio: number) => {
    setReintentando(folio);
    const r = await llamarFuncion('facturacion', { action: 'reintentar', folio }, 60000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setReintentando(null);
    setFoliosVersion(v => v + 1);
    if (!r?.ok) alert(r?.error ?? 'No se pudo emitir la factura.');
  };

  // Todos los asientos de la cuenta.
  const asientos = useMemo(() => (transactions ?? []).filter(t => t.userId === userId).flatMap(asientosDe), [transactions, userId]);
  const R = rango(periodo), RA = rangoAnt(periodo);
  const enP = asientos.filter(a => en(a, R));
  // Moneda: la que tenga más movimientos en el periodo, salvo que se elija.
  const hayCop = asientos.some(a => a.moneda === 'COP'), hayUsd = asientos.some(a => a.moneda === 'USD');
  const moneda: Moneda = monedaSel ?? (enP.filter(a => a.moneda === 'USD').length > enP.filter(a => a.moneda === 'COP').length ? 'USD' : 'COP');
  const del = enP.filter(a => a.moneda === moneda);
  const suma = (as: Asiento[], dir: Dir) => as.filter(a => a.dir === dir && cuenta(a.tx)).reduce((s, a) => s + a.monto, 0);
  const recibido = suma(del, 'in'), enviado = suma(del, 'out'), neto = recibido - enviado;
  const nIn = del.filter(a => a.dir === 'in' && cuenta(a.tx)).length, nOut = del.filter(a => a.dir === 'out' && cuenta(a.tx)).length;
  const ant = RA ? asientos.filter(a => en(a, RA) && a.moneda === moneda) : null;
  const delta = (v: number, vAnt: number | null) => vAnt != null && vAnt > 0 ? ((v - vAnt) / vAnt) * 100 : null;
  const dRec = ant ? delta(recibido, suma(ant, 'in')) : null, dEnv = ant ? delta(enviado, suma(ant, 'out')) : null;

  // Cubos del gráfico.
  const cubos: Cubo[] = useMemo(() => {
    const vacio = (rot: string, rotLargo: string): Cubo => ({ rot, rotLargo, entra: 0, sale: 0 });
    let lista: Cubo[] = []; let clave: (ts: number) => number;
    if (periodo === 'mes') {
      const dias = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
      lista = Array.from({ length: dias }, (_, i) => vacio(String(i + 1), `${i + 1} de ${MESES_L[ahora.getMonth()]}`));
      clave = ts => new Date(ts).getDate() - 1;
    } else if (periodo === 'anio') {
      lista = MESES.map((m, i) => vacio(m, `${MESES_L[i]} ${ahora.getFullYear()}`));
      clave = ts => new Date(ts).getMonth();
    } else {
      const tss = del.map(a => a.ts).filter(Boolean);
      const primero = tss.length ? new Date(Math.min(...tss)) : ahora;
      const desde = new Date(primero.getFullYear(), primero.getMonth(), 1);
      const n = Math.max(1, (ahora.getFullYear() - desde.getFullYear()) * 12 + (ahora.getMonth() - desde.getMonth()) + 1);
      const rec = Math.max(0, n - 24);
      lista = Array.from({ length: n - rec }, (_, i) => { const d = new Date(desde.getFullYear(), desde.getMonth() + rec + i, 1); return vacio(`${MESES[d.getMonth()]}${d.getMonth() === 0 || i === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ''}`, `${MESES_L[d.getMonth()]} ${d.getFullYear()}`); });
      clave = ts => { const d = new Date(ts); return (d.getFullYear() - desde.getFullYear()) * 12 + (d.getMonth() - desde.getMonth()) - rec; };
    }
    for (const a of del) { if (!cuenta(a.tx)) continue; const i = clave(a.ts); if (i < 0 || i >= lista.length) continue; if (a.dir === 'in') lista[i].entra += a.monto; else lista[i].sale += a.monto; }
    return lista;
  }, [periodo, moneda, del.length, recibido, enviado]); // eslint-disable-line react-hooks/exhaustive-deps

  // Por tipo, en el periodo.
  const porTipo = useMemo(() => {
    const m: Record<string, { n: number; monto: number; dir: Dir }> = {};
    for (const a of del) { if (!cuenta(a.tx)) continue; const k = a.tipo; const acc = m[k] ?? (m[k] = { n: 0, monto: 0, dir: a.dir }); acc.n += 1; acc.monto += a.monto; }
    return Object.entries(m).sort((x, y) => y[1].monto - x[1].monto);
  }, [del]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxTipo = Math.max(1, ...porTipo.map(([, v]) => v.monto));

  // Últimos 12 meses, siempre.
  const meses12 = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - (11 - i), 1);
    const desde = d.getTime(), hasta = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const as = asientos.filter(a => a.moneda === moneda && a.ts >= desde && a.ts < hasta && cuenta(a.tx));
    const r = as.filter(a => a.dir === 'in').reduce((s, a) => s + a.monto, 0), e = as.filter(a => a.dir === 'out').reduce((s, a) => s + a.monto, 0);
    return { rot: `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, recibido: r, enviado: e, movs: as.length };
  }), [asientos, moneda, ahora]);

  // Lista de movimientos: filtro y búsqueda juntos.
  const q = busca.trim().toLowerCase();
  const lista = del
    .filter(a => filtroDir === 'todos' || (filtroDir === 'conv' ? a.tipo === 'Conversión' : (a.dir === filtroDir && a.tipo !== 'Conversión')))
    .filter(a => !q || a.contraparte.toLowerCase().includes(q) || a.tipo.toLowerCase().includes(q) || String(folios[String(a.tx.id)]?.numero ?? '').toLowerCase().includes(q) || String(a.tx.providerRef ?? a.tx.reference ?? '').toLowerCase().includes(q))
    .sort((x, y) => y.ts - x.ts);
  const mostrados = lista.slice(0, limite);

  const csv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lineas = [['Fecha', 'Tipo', 'Dirección', 'Contraparte', 'Monto', 'Moneda', 'Estado', 'Comprobante', 'Referencia', 'Id'].map(esc).join(',')];
    for (const a of lista) lineas.push([new Date(a.ts).toISOString(), a.tipo, a.dir === 'in' ? 'entrada' : 'salida', a.contraparte, a.dir === 'in' ? a.monto : -a.monto, a.moneda, a.estado, folios[String(a.tx.id)]?.numero ?? '', a.tx.providerRef ?? a.tx.reference ?? a.tx.txHash ?? '', a.tx.id].map(esc).join(','));
    const url = URL.createObjectURL(new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const el = document.createElement('a'); el.href = url; el.download = `lincoin-contabilidad-${moneda}-${periodo}-${new Date().toISOString().slice(0, 10)}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const rotPeriodo = periodo === 'mes' ? 'este mes' : periodo === 'anio' ? 'este año' : 'histórico';
  const rotAnt = periodo === 'mes' ? 'el mes anterior' : 'el año anterior';
  const deltaTxt = (d: number | null) => d == null ? (periodo === 'historico' ? 'Todo el historial' : `Sin ${rotAnt} para comparar`) : `${d > 0 ? '+' : ''}${d.toLocaleString('es-CO', { maximumFractionDigits: 1 })} % vs. ${rotAnt}`;
  const fecha = (ts: number) => new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const estadoColor = (s: string) => s === 'Completado' ? C.entra : s === 'Rechazado' || s === 'Fallido' ? C.tenue : C.medio;
  const seg = (act: boolean): React.CSSProperties => ({ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', color: act ? C.text : C.sub, background: act ? 'rgba(255,255,255,0.09)' : 'transparent', transition: 'background 120ms, color 120ms' });
  const kpi = (rot: string, valor: string, nota: string, notaColor = C.sub) => (
    <Tarjeta>
      <Rotulo>{rot}</Rotulo>
      <p style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 0', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valor}</p>
      <p style={{ fontSize: 12, margin: '4px 0 0', color: notaColor }}>{nota}</p>
    </Tarjeta>
  );

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. Periodo · moneda · CSV */}
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 12 }}>
        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
          <div className="flex" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: 3 }}>
            {([['mes', 'Este mes'], ['anio', 'Este año'], ['historico', 'Histórico']] as [Periodo, string][]).map(([k, rot]) => (
              <button key={k} onClick={() => { setPeriodo(k); setLimite(25); }} style={seg(periodo === k)}>{rot}</button>
            ))}
          </div>
          {hayCop && hayUsd && (
            <div className="flex" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: 3 }}>
              {(['COP', 'USD'] as Moneda[]).map(m => <button key={m} onClick={() => setMonedaSel(m)} style={seg(moneda === m)}>{m}</button>)}
            </div>
          )}
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <button onClick={() => setConfigAbierta(true)}
            style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 16px', borderRadius: 9, cursor: 'pointer', color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            className="hover:border-[rgba(255,255,255,0.22)] transition-colors">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: facturacionActiva ? C.entra : 'rgba(255,255,255,0.18)', flexShrink: 0 }} />
            Configuración
          </button>
          <button onClick={csv} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 18px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>Descargar CSV</button>
        </div>
      </div>
      {configAbierta && <FacturacionConfig onCerrar={() => setConfigAbierta(false)} />}

      {/* 2. KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {kpi('RECIBIDO', fmtMon(recibido, moneda), deltaTxt(dRec), dRec != null && dRec > 0 ? C.entra : C.sub)}
        {kpi('ENVIADO', fmtMon(enviado, moneda), deltaTxt(dEnv))}
        {kpi('NETO', `${neto >= 0 ? '+' : '−'}${fmtMon(Math.abs(neto), moneda)}`, neto >= 0 ? 'Entró más de lo que salió' : 'Salió más de lo que entró')}
        {kpi('MOVIMIENTOS', String(nIn + nOut), `${nIn} ${nIn === 1 ? 'recibido' : 'recibidos'} · ${nOut} ${nOut === 1 ? 'enviado' : 'enviados'}`)}
      </div>

      {/* 3. Gráfico + por tipo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <Barras cubos={cubos} moneda={moneda} titulo={periodo === 'mes' ? `MOVIMIENTOS POR DÍA · ${MESES_L[ahora.getMonth()].toUpperCase()}` : 'MOVIMIENTOS POR MES'} />
        <Tarjeta>
          <Rotulo>POR TIPO · {rotPeriodo.toUpperCase()}</Rotulo>
          {porTipo.length === 0 ? <p style={{ fontSize: 12.5, color: C.tenue, margin: '14px 0 0' }}>Sin movimientos en el periodo.</p>
            : porTipo.map(([tipo, v], i) => (
              <div key={tipo} style={{ marginTop: i === 0 ? 12 : 10 }}>
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <span className="flex items-center" style={{ gap: 7, fontSize: 12.5, color: C.text }}><Swatch color={v.dir === 'in' ? C.entra : C.sale} />{tipo} <span style={{ color: C.tenue }}>· {v.n}</span></span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtMon(v.monto, moneda)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', marginTop: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, (v.monto / maxTipo) * 100)}%`, height: '100%', background: v.dir === 'in' ? C.entra : C.sale, opacity: v.dir === 'in' ? 1 : 0.85, borderRadius: 999 }} />
                </div>
              </div>
            ))}
        </Tarjeta>
      </div>

      {/* 4. Resumen por mes */}
      <Tarjeta style={{ padding: '18px 0 6px' }}>
        <div style={{ padding: '0 20px' }}><Rotulo>ÚLTIMOS 12 MESES · {moneda}</Rotulo></div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead><tr>{['MES', 'RECIBIDO', 'ENVIADO', 'NETO', 'MOVIMIENTOS'].map((h, i) => <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i === 0 ? 'left' : 'right', padding: '8px 20px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {meses12.map(m => { const vacio = m.movs === 0, col = vacio ? C.tenue : C.text, n = m.recibido - m.enviado; return (
                <tr key={m.rot}>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, borderBottom: `1px solid ${C.borde}`, textTransform: 'capitalize' }}>{m.rot}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{m.recibido > 0 ? fmtMon(m.recibido, moneda) : '—'}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{m.enviado > 0 ? fmtMon(m.enviado, moneda) : '—'}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', fontWeight: 700 }}>{vacio ? '—' : `${n >= 0 ? '+' : '−'}${fmtMon(Math.abs(n), moneda)}`}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}` }}>{m.movs}</td>
                </tr>
              ); })}
              <tr>
                <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text }}>Total</td>
                {[meses12.reduce((s, m) => s + m.recibido, 0), meses12.reduce((s, m) => s + m.enviado, 0)].map((v, i) => <td key={i} style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtMon(v, moneda)}</td>)}
                {(() => { const n = meses12.reduce((s, m) => s + m.recibido - m.enviado, 0); return <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{`${n >= 0 ? '+' : '−'}${fmtMon(Math.abs(n), moneda)}`}</td>; })()}
                <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{meses12.reduce((s, m) => s + m.movs, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {/* 5. Movimientos */}
      <Tarjeta style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '14px 20px', borderBottom: `1px solid ${C.borde}` }}>
          <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
            <p style={{ fontSize: 14.5, fontWeight: 700, color: C.text, margin: '0 8px 0 0' }}>Movimientos</p>
            {([['todos', 'Todos'], ['in', 'Recibidos'], ['out', 'Enviados'], ['conv', 'Conversiones']] as const).map(([k, rot]) => { const act = filtroDir === k; return (
              <button key={k} onClick={() => { setFiltroDir(k); setLimite(25); }} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', color: act ? C.text : C.sub, background: act ? 'rgba(255,255,255,0.08)' : 'transparent', border: `1px solid ${act ? 'rgba(255,255,255,0.22)' : C.borde}` }}>{rot}</button>
            ); })}
          </div>
          <input value={busca} onChange={e => { setBusca(e.target.value); setLimite(25); }} placeholder="Buscar por contraparte, comprobante o referencia" style={{ fontFamily: FONT, fontSize: 13, color: C.text, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', outline: 'none', width: 300, maxWidth: '100%' }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead><tr>{['FECHA', 'MOVIMIENTO', 'MONTO', 'ESTADO', 'COMPROBANTE', 'FACTURA', ''].map((h, i) => <th key={h || 'acc'} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i === 2 ? 'right' : 'left', padding: '9px 20px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {mostrados.length === 0 && <tr><td colSpan={7} style={{ padding: '18px 20px', fontSize: 12.5, color: C.tenue }}>Sin movimientos que coincidan.</td></tr>}
              {mostrados.map((a, i) => {
                const rech = a.estado === 'Rechazado' || a.estado === 'Fallido';
                const f = folios[String(a.tx.id)];
                return (
                  <tr key={`${a.tx.id}-${a.dir}-${i}`} className="lincoin-fila-mov" style={{ cursor: onVerMovimiento ? 'pointer' : 'default' }} onClick={() => onVerMovimiento?.(a.tx)}>
                    <td style={{ padding: '11px 20px', fontSize: 12.5, color: C.medio, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fecha(a.ts)}</td>
                    <td style={{ padding: '11px 20px', borderBottom: `1px solid ${C.borde}`, minWidth: 220 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0 }}>{a.tipo}</p>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>{a.contraparte}</p>
                    </td>
                    <td style={{ padding: '11px 20px', fontSize: 13.5, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', color: rech ? C.tenue : a.dir === 'in' ? C.entra : C.text, textDecoration: rech ? 'line-through' : 'none' }}>{a.dir === 'in' ? '+' : '−'}{fmtMon(a.monto, a.moneda)}</td>
                    <td style={{ padding: '11px 20px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', borderBottom: `1px solid ${C.borde}`, color: estadoColor(a.estado), whiteSpace: 'nowrap' }}>{a.estado.toUpperCase()}</td>
                    <td style={{ padding: '11px 20px', fontSize: 12.5, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace', color: f ? C.text : C.tenue }} title={f ? (f.enviado ? 'Enviado por correo' : 'Emitido; el correo no salió') : undefined}>
                      {f ? f.numero : (a.estado === 'Completado' ? '—' : '')}
                    </td>
                    {/* FACTURA: lo que Siigo contestó, o por qué no se emitió.
                        El error va textual en el title y con "Reintentar". */}
                    <td style={{ padding: '11px 20px', fontSize: 12, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const fa = f?.factura;
                        if (!f || !fa?.estado) return <span style={{ color: C.tenue }}>{f && facturacionActiva ? 'pendiente' : '—'}</span>;
                        // "DS" delante cuando lo que salió fue un documento
                        // soporte, no una factura: son dos cosas distintas.
                        const rotulo = fa.tipo === 'DS' ? 'DS · ' : '';
                        if (fa.estado === 'emitida') return fa.url
                          ? <a href={fa.url} target="_blank" rel="noopener noreferrer" title={fa.tipo === 'DS' ? 'Documento soporte' : 'Factura de venta'} style={{ color: C.text, fontFamily: 'ui-monospace, monospace', textDecoration: 'underline', textUnderlineOffset: 3 }}>{rotulo}{fa.numero ?? 'ver'}</a>
                          : <span title={fa.tipo === 'DS' ? 'Documento soporte' : 'Factura de venta'} style={{ color: C.text, fontFamily: 'ui-monospace, monospace' }}>{rotulo}{fa.numero ?? 'emitida'}</span>;
                        if (fa.estado === 'error') return (
                          <span className="flex items-center" style={{ gap: 6 }} title={fa.error ?? ''}>
                            <span style={{ color: '#F87171', fontWeight: 700 }}>error</span>
                            <button onClick={() => reintentarFactura(f.folio)} disabled={reintentando === f.folio}
                              style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', opacity: reintentando === f.folio ? 0.5 : 1 }}>
                              {reintentando === f.folio ? '…' : 'Reintentar'}
                            </button>
                          </span>
                        );
                        return <span style={{ color: C.tenue }} title={fa.error ?? ''}>{fa.estado === 'omitida' ? 'no aplica' : fa.estado}</span>;
                      })()}
                    </td>
                    <td style={{ padding: '11px 20px', borderBottom: `1px solid ${C.borde}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {onVerMovimiento && <button onClick={e => { e.stopPropagation(); onVerMovimiento(a.tx); }} style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }} className="hover:text-[#F4F4F2] hover:border-[rgba(255,255,255,0.22)] transition-colors">Ver</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 20px', borderTop: `1px solid ${C.borde}` }}>
          <span style={{ fontSize: 12, color: C.sub }}>Mostrando {mostrados.length} de {lista.length}</span>
          {lista.length > mostrados.length && <button onClick={() => setLimite(l => l + 50)} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Cargar más →</button>}
        </div>
      </Tarjeta>

      {/* 6. Notas */}
      <p style={{ fontSize: 12, color: C.tenue, margin: 0, lineHeight: 1.55 }}>
        Cuenta lo Completado y lo Procesando: la plata ya se movió. Lo rechazado se lista tachado y no suma. Una conversión es una salida en una moneda y una entrada en la otra.
        {foliosEstado === 'sin_tabla' && ' Los comprobantes automáticos todavía no están activos en esta cuenta (falta la migración 2026_comprobantes.sql).'}
        {foliosEstado === 'ok' && ' El comprobante de cada operación se emite solo, con número consecutivo, apenas la operación se completa, y llega por correo.'}
      </p>

      <style>{`
        .lincoin-fila-mov:hover td { background: ${C.hover}; }
        @media (max-width: 720px) { .lincoin-graf-barras { grid-column: span 1 !important; } }
      `}</style>
    </div>
  );
};
