import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// ─────────────────────────────────────────────
// FinityRateChart — gráfico de velas/línea USD→COP con la tasa FINITY
// (no FastForex), leído de fx_rate_snapshots (source='FINITY'). Cada vez
// que un cliente abre el convertidor OTC se registra un punto nuevo
// (ver FinitySection.load), así que el historial crece solo con el uso.
//
// Estilo "trader" (fondo oscuro, velas verde/rojo) — inline, no modal —
// para que viva directo dentro de la tarjeta del convertidor OTC.
// ─────────────────────────────────────────────

const CHART_RANGES: Array<{ key: '5m' | '1h' | '24h' | '7d' | '30d'; label: string; hours: number }> = [
    { key: '5m', label: '5 min', hours: 5 / 60 },
    { key: '1h', label: '1 h', hours: 1 },
    { key: '24h', label: '24 h', hours: 24 },
    { key: '7d', label: '7 días', hours: 24 * 7 },
    { key: '30d', label: '30 días', hours: 24 * 30 },
];

const fmtRate = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

type Row = { rate: number; captured_at: string; source: string };
type Candle = {
    bucketStart: number;
    open: number; high: number; low: number; close: number;
    rate: number; captured_at: string; source: string;
};

export const FinityRateChart: React.FC<{ from?: string; to?: string }> = ({ from = 'USD', to = 'COP' }) => {
    const [range, setRange] = useState<'5m' | '1h' | '24h' | '7d' | '30d'>('24h');
    const [chartType, setChartType] = useState<'candles' | 'line'>('line');
    const [hideOutliers, setHideOutliers] = useState(true);
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [hoverY, setHoverY] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true); setError(null);
            const hours = CHART_RANGES.find(r => r.key === range)?.hours ?? 24;
            const sinceISO = new Date(Date.now() - hours * 3600 * 1000).toISOString();
            try {
                // Con timeout: si la consulta se cuelga (red móvil / sesión sin
                // JWT / tabla sin permiso), el gráfico NO se queda en "Cargando
                // historial…" para siempre — muestra el estado vacío.
                const query = supabase
                    .from('fx_rate_snapshots')
                    .select('rate, captured_at, source')
                    .eq('from_currency', from)
                    .eq('to_currency', to)
                    .eq('source', 'FINITY')
                    .gte('captured_at', sinceISO)
                    .order('captured_at', { ascending: true })
                    .limit(2000);
                const { data, error } = await Promise.race([
                    query as any,
                    new Promise<{ data: null; error: any }>((resolve) =>
                        setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), 8000)),
                ]) as any;
                if (cancelled) return;
                if (error) { setError(error.message === 'timeout' ? null : error.message); setRows([]); }
                else setRows((data ?? []) as any);
            } catch (e: any) {
                if (!cancelled) { setError(null); setRows([]); }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [from, to, range]);

    const bucketMs = range === '5m' ? 15 * 1000
        : range === '1h' ? 60 * 1000
        : range === '24h' ? 5 * 60 * 1000
        : range === '7d' ? 60 * 60 * 1000
        : 6 * 60 * 60 * 1000;
    const bucketedAll: Candle[] = (() => {
        const buckets = new Map<number, { firstT: number; lastT: number; open: number; high: number; low: number; close: number; captured_at: string; source: string }>();
        for (const r of rows) {
            const t = new Date(r.captured_at).getTime();
            if (!isFinite(t)) continue;
            const v = Number(r.rate);
            if (!isFinite(v) || v <= 0) continue;
            const bucketStart = Math.floor(t / bucketMs) * bucketMs;
            const prev = buckets.get(bucketStart);
            if (!prev) {
                buckets.set(bucketStart, { firstT: t, lastT: t, open: v, high: v, low: v, close: v, captured_at: r.captured_at, source: r.source });
            } else {
                if (t < prev.firstT) { prev.firstT = t; prev.open = v; }
                if (t > prev.lastT) { prev.lastT = t; prev.close = v; prev.captured_at = r.captured_at; prev.source = r.source; }
                if (v > prev.high) prev.high = v;
                if (v < prev.low) prev.low = v;
            }
        }
        return Array.from(buckets.entries())
            .map(([bucketStart, b]): Candle => ({ bucketStart, open: b.open, high: b.high, low: b.low, close: b.close, rate: b.close, captured_at: b.captured_at, source: b.source }))
            .sort((a, b) => a.bucketStart - b.bucketStart);
    })();

    const bucketed = (() => {
        if (!hideOutliers || bucketedAll.length < 4) return bucketedAll;
        const sorted = bucketedAll.map(b => b.rate).slice().sort((a, b) => a - b);
        const q = (p: number) => {
            const idx = (sorted.length - 1) * p;
            const lo = Math.floor(idx), hi = Math.ceil(idx);
            return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
        };
        const Q1 = q(0.25), Q3 = q(0.75), IQR = Q3 - Q1;
        const lo = Q1 - 1.5 * IQR, hi = Q3 + 1.5 * IQR;
        return bucketedAll.filter(b => b.rate >= lo && b.rate <= hi);
    })();

    const hasData = bucketed.length >= 2;
    const W = 640, H = 220, PADL = 64, PADR = 60, PADT = 12, PADB = 28;
    const innerW = W - PADL - PADR, innerH = H - PADT - PADB;
    const minV = hasData ? Math.min(...bucketed.map(b => b.low)) : 0;
    const maxV = hasData ? Math.max(...bucketed.map(b => b.high)) : 1;
    const spanV = (maxV - minV) || (maxV * 0.001 || 1);
    const minT = hasData ? bucketed[0].bucketStart : 0;
    const maxT = hasData ? bucketed[bucketed.length - 1].bucketStart : 1;
    const spanT = (maxT - minT) || 1;
    const xOf = (t: number) => PADL + ((t - minT) / spanT) * innerW;
    const yOf = (v: number) => PADT + (1 - (v - minV) / spanV) * innerH;

    const path = hasData
        ? bucketed.reduce((acc, b, i) => `${acc}${i === 0 ? 'M' : 'L'}${xOf(b.bucketStart).toFixed(2)},${yOf(b.rate).toFixed(2)} `, '').trim()
        : '';
    const areaPath = hasData ? `${path} L${xOf(maxT).toFixed(2)},${H - PADB} L${xOf(minT).toFixed(2)},${H - PADB} Z` : '';

    const yTicks = hasData ? Array.from({ length: 4 }, (_, i) => minV + (spanV * (3 - i)) / 3) : [];
    const xTicks = hasData ? Array.from({ length: 5 }, (_, i) => minT + (spanT * i) / 4) : [];
    const formatXLabel = (t: number) => {
        const d = new Date(t);
        if (range === '5m') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (range === '1h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (range === '7d') return d.toLocaleString([], { weekday: 'short', hour: '2-digit' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const last = bucketed[bucketed.length - 1];
    const first = bucketed[0];
    const delta = first && last ? Number(last.rate) - Number(first.rate) : 0;
    const deltaPct = first && Number(first.rate) > 0 ? (delta / Number(first.rate)) * 100 : 0;
    const deltaUp = delta >= 0;
    const upColor = '#2DD4BF', downColor = '#f87171';

    return (
        <div className="rounded-2xl overflow-hidden border border-slate-800" style={{ backgroundColor: '#0B1220' }}>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2">
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{from} → {to} · Lincoin</p>
                    {hasData ? (
                        <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-lg font-bold font-mono text-white">{fmtRate(last.rate)}</span>
                            <span className={`inline-flex items-center gap-1 text-xs font-bold ${deltaUp ? 'text-[#2DD4BF]' : 'text-red-400'}`}>
                                {deltaUp ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(2)}%
                            </span>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 mt-0.5">Sin datos suficientes todavía</p>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {CHART_RANGES.map(r => (
                        <button
                            key={r.key}
                            onClick={() => { setRange(r.key); setHoverIdx(null); }}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors ${range === r.key ? 'bg-[#2DD4BF] text-[#0F172A]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                        >
                            {r.label}
                        </button>
                    ))}
                    <span className="w-px h-4 bg-slate-700 mx-1" />
                    <button
                        onClick={() => setChartType('line')}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors ${chartType === 'line' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        Línea
                    </button>
                    <button
                        onClick={() => setChartType('candles')}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors ${chartType === 'candles' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        Velas
                    </button>
                </div>
            </div>

            <div className="px-2 pb-2">
                {loading && <div className="flex items-center justify-center h-[180px] text-slate-500 text-xs">Cargando historial…</div>}
                {!loading && error && <div className="flex items-center justify-center h-[180px] text-red-400 text-xs px-4 text-center">Error leyendo el historial: {error}</div>}
                {!loading && !error && !hasData && (
                    <div className="flex flex-col items-center justify-center h-[180px] text-slate-500 text-xs text-center px-4 gap-1">
                        <span>Aún no hay suficiente historial de la tasa en este rango.</span>
                        <span className="text-slate-600">Se registra un punto cada vez que se abre el convertidor OTC.</span>
                    </div>
                )}
                {!loading && !error && hasData && (
                    <div className="relative">
                        <svg
                            viewBox={`0 0 ${W} ${H}`}
                            className="w-full h-auto select-none"
                            preserveAspectRatio="xMidYMid meet"
                            onMouseMove={e => {
                                const svg = e.currentTarget;
                                const rect = svg.getBoundingClientRect();
                                const xPct = (e.clientX - rect.left) / rect.width;
                                const yPct = (e.clientY - rect.top) / rect.height;
                                const xInSvg = xPct * W, yInSvg = yPct * H;
                                if (xInSvg < PADL || xInSvg > W - PADR) { setHoverIdx(null); setHoverY(null); return; }
                                const tAtX = minT + ((xInSvg - PADL) / innerW) * spanT;
                                let bestIdx = 0, bestDist = Infinity;
                                for (let i = 0; i < bucketed.length; i++) {
                                    const dist = Math.abs(bucketed[i].bucketStart - tAtX);
                                    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                                }
                                setHoverIdx(bestIdx);
                                setHoverY(Math.max(PADT, Math.min(H - PADB, yInSvg)));
                            }}
                            onMouseLeave={() => { setHoverIdx(null); setHoverY(null); }}
                        >
                            {yTicks.map((v, i) => {
                                const y = PADT + (i * innerH) / 3;
                                return (
                                    <g key={i}>
                                        <line x1={PADL} y1={y} x2={W - PADR} y2={y} stroke="#1e293b" strokeDasharray="2,3" />
                                        <text x={PADL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="monospace">{fmtRate(v)}</text>
                                    </g>
                                );
                            })}
                            {xTicks.map((t, i) => {
                                const x = xOf(t);
                                const anchor = i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
                                return (
                                    <text key={`xt-${i}`} x={x} y={H - PADB + 16} textAnchor={anchor} fontSize="9" fill="#64748b">{formatXLabel(t)}</text>
                                );
                            })}

                            {chartType === 'line' && (
                                <>
                                    <path d={areaPath} fill={upColor} opacity="0.10" />
                                    <path d={path} stroke={upColor} strokeWidth="2" fill="none" />
                                    <circle cx={xOf(last.bucketStart)} cy={yOf(last.rate)} r="3.5" fill={upColor} stroke="#0B1220" strokeWidth="2" />
                                </>
                            )}
                            {chartType === 'candles' && (() => {
                                const slot = innerW / Math.max(1, bucketed.length);
                                const bodyW = Math.max(1.5, Math.min(8, slot * 0.7));
                                return bucketed.map((c, i) => {
                                    const cx = xOf(c.bucketStart);
                                    const up = c.close >= c.open;
                                    const color = up ? upColor : downColor;
                                    const bodyTop = Math.min(yOf(c.open), yOf(c.close));
                                    const bodyH = Math.max(1, Math.abs(yOf(c.close) - yOf(c.open)));
                                    return (
                                        <g key={`c-${i}`}>
                                            <line x1={cx} y1={yOf(c.high)} x2={cx} y2={yOf(c.low)} stroke={color} strokeWidth="1" />
                                            <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} stroke={color} />
                                        </g>
                                    );
                                });
                            })()}

                            {hoverIdx !== null && bucketed[hoverIdx] && (
                                <g pointerEvents="none">
                                    <line x1={xOf(bucketed[hoverIdx].bucketStart)} y1={PADT} x2={xOf(bucketed[hoverIdx].bucketStart)} y2={H - PADB} stroke="#94a3b8" strokeOpacity="0.4" strokeDasharray="3,3" />
                                    {hoverY !== null && <line x1={PADL} x2={W - PADR} y1={hoverY} y2={hoverY} stroke="#94a3b8" strokeOpacity="0.4" strokeDasharray="3,3" />}
                                </g>
                            )}
                        </svg>
                        {hoverIdx !== null && bucketed[hoverIdx] && (() => {
                            const hb = bucketed[hoverIdx];
                            const xPct = (xOf(hb.bucketStart) / W) * 100;
                            const flipLeft = xPct > 65;
                            return (
                                <div
                                    className="absolute top-1 bg-slate-900 border border-slate-700 rounded-lg shadow-lg px-2.5 py-1.5 text-[11px] pointer-events-none"
                                    style={{ left: flipLeft ? 'auto' : `calc(${xPct}% + 10px)`, right: flipLeft ? `calc(${100 - xPct}% + 10px)` : 'auto' }}
                                >
                                    <div className="font-bold text-white font-mono">{fmtRate(hb.rate)}</div>
                                    <div className="text-slate-400">{new Date(hb.captured_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>

            <div className="px-4 py-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500">
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={hideOutliers} onChange={e => setHideOutliers(e.target.checked)} className="rounded" />
                    Quitar atípicos
                </label>
                {hasData && <span>{bucketed.length} puntos · {range === '5m' ? '15 s' : range === '1h' ? '1 min' : range === '24h' ? '5 min' : range === '7d' ? '1 h' : '6 h'} c/u</span>}
            </div>
        </div>
    );
};
