import React, { useEffect, useState } from 'react';
import {
    DollarSign, TrendingUp, TrendingDown, Percent, RefreshCw,
    ArrowUpRight, ArrowDownRight, Activity, Wallet
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { NAVY, TEAL, formatDate } from './shared';

interface MonthBucket {
    month: string;     // YYYY-MM
    volume: number;
    fees: number;
    count: number;
}

interface ByType {
    type: string;
    volume: number;
    count: number;
}

interface ByCurrency {
    currency: string;
    volume: number;
    count: number;
}

const TYPE_COLORS: Record<string, string> = {
    load:    '#10B981',
    send:    '#3B82F6',
    convert: '#A78BFA',
    receive: '#FBBF24',
};
const TYPE_LABELS: Record<string, string> = {
    load: 'Cargas',
    send: 'Envíos',
    convert: 'Conversiones',
    receive: 'Recepciones',
};

export const TreasuryDashboard: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [monthly, setMonthly] = useState<MonthBucket[]>([]);
    const [byType, setByType] = useState<ByType[]>([]);
    const [byCurrency, setByCurrency] = useState<ByCurrency[]>([]);
    const [kpis, setKpis] = useState({
        volume30: 0,
        fees30: 0,
        count30: 0,
        avgTicket: 0,
        volPrev30: 0,
        feesPrev30: 0,
    });

    const load = async () => {
        setLoading(true);
        const now = new Date();
        const since12m = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
        const { data } = await supabasePersonas
            .from('transactions')
            .select('type, status, from_amount, from_currency, fee, created_at')
            .gte('created_at', since12m)
            .in('status', ['approved', 'completed']);
        const all = (data ?? []) as any[];

        // ── Buckets mensuales (12 meses)
        const buckets = new Map<string, MonthBucket>();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            buckets.set(key, { month: key, volume: 0, fees: 0, count: 0 });
        }
        for (const t of all) {
            const month = (t.created_at as string).slice(0, 7);
            const b = buckets.get(month);
            if (!b) continue;
            b.volume += Number(t.from_amount) || 0;
            b.fees += Number(t.fee) || 0;
            b.count += 1;
        }
        setMonthly(Array.from(buckets.values()));

        // ── Últimos 30 / 30-60 días
        const t30 = now.getTime() - 30 * 86400000;
        const t60 = now.getTime() - 60 * 86400000;
        let v30 = 0, f30 = 0, c30 = 0, v60_30 = 0, f60_30 = 0;
        for (const t of all) {
            const ts = new Date(t.created_at).getTime();
            const amt = Number(t.from_amount) || 0;
            const fee = Number(t.fee) || 0;
            if (ts >= t30) {
                v30 += amt; f30 += fee; c30 += 1;
            } else if (ts >= t60) {
                v60_30 += amt; f60_30 += fee;
            }
        }
        setKpis({
            volume30: v30,
            fees30: f30,
            count30: c30,
            avgTicket: c30 > 0 ? v30 / c30 : 0,
            volPrev30: v60_30,
            feesPrev30: f60_30,
        });

        // ── Por tipo (últimos 30 días)
        const typeMap = new Map<string, ByType>();
        for (const t of all) {
            if (new Date(t.created_at).getTime() < t30) continue;
            const key = t.type ?? 'unknown';
            const cur = typeMap.get(key) ?? { type: key, volume: 0, count: 0 };
            cur.volume += Number(t.from_amount) || 0;
            cur.count += 1;
            typeMap.set(key, cur);
        }
        setByType(Array.from(typeMap.values()).sort((a, b) => b.volume - a.volume));

        // ── Por moneda (últimos 30 días)
        const curMap = new Map<string, ByCurrency>();
        for (const t of all) {
            if (new Date(t.created_at).getTime() < t30) continue;
            const key = t.from_currency ?? 'UNK';
            const cur = curMap.get(key) ?? { currency: key, volume: 0, count: 0 };
            cur.volume += Number(t.from_amount) || 0;
            cur.count += 1;
            curMap.set(key, cur);
        }
        setByCurrency(Array.from(curMap.values()).sort((a, b) => b.volume - a.volume).slice(0, 6));

        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const volChg = kpis.volPrev30 > 0 ? ((kpis.volume30 - kpis.volPrev30) / kpis.volPrev30) * 100 : 0;
    const feeChg = kpis.feesPrev30 > 0 ? ((kpis.fees30 - kpis.feesPrev30) / kpis.feesPrev30) * 100 : 0;
    // Utilidad estimada = comisiones cobradas (es la "ganancia bruta" de la fintech)
    const utility = kpis.fees30;
    const margin = kpis.volume30 > 0 ? (utility / kpis.volume30) * 100 : 0;

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg md:text-xl font-bold" style={{ color: NAVY }}>Flujo de caja · Tesorería</h2>
                    <p className="text-xs text-slate-500">Métricas operativas y de utilidad</p>
                </div>
                <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiBig
                    icon={DollarSign}
                    color={TEAL}
                    label="Volumen 30d"
                    value={formatShort(kpis.volume30)}
                    change={volChg}
                />
                <KpiBig
                    icon={Percent}
                    color="#10B981"
                    label="Comisiones 30d"
                    value={formatShort(kpis.fees30)}
                    change={feeChg}
                />
                <KpiBig
                    icon={TrendingUp}
                    color="#A78BFA"
                    label="Utilidad estimada"
                    value={formatShort(utility)}
                    sublabel={`margen ${margin.toFixed(2)}%`}
                />
                <KpiBig
                    icon={Activity}
                    color="#3B82F6"
                    label="Operaciones 30d"
                    value={kpis.count30.toLocaleString()}
                    sublabel={`ticket prom. ${formatShort(kpis.avgTicket)}`}
                />
            </div>

            {/* Monthly volume + commissions */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold" style={{ color: NAVY }}>Volumen y comisiones · últimos 12 meses</h3>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1" style={{ backgroundColor: TEAL }} /> Volumen
                    <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle ml-3 mr-1" style={{ backgroundColor: '#10B981' }} /> Comisiones
                </p>
                <DualBarChart data={monthly} />
            </div>

            {/* Row: by type donut + by currency bars */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-bold mb-1" style={{ color: NAVY }}>Volumen por tipo de operación · 30d</h3>
                    <p className="text-xs text-slate-500 mb-4">Distribución de movimientos</p>
                    <TypeDonut data={byType} />
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-bold mb-1" style={{ color: NAVY }}>Volumen por moneda · 30d</h3>
                    <p className="text-xs text-slate-500 mb-4">Top monedas movidas</p>
                    <CurrencyBars data={byCurrency} />
                </div>
            </div>

            {/* Profitability table */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <h3 className="font-bold mb-3" style={{ color: NAVY }}>Resumen mensual de utilidad</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-3 py-2">Mes</th>
                                <th className="text-right px-3 py-2">Operaciones</th>
                                <th className="text-right px-3 py-2">Volumen</th>
                                <th className="text-right px-3 py-2">Comisiones</th>
                                <th className="text-right px-3 py-2">Margen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthly.slice(-6).reverse().map(b => {
                                const m = b.volume > 0 ? (b.fees / b.volume) * 100 : 0;
                                return (
                                    <tr key={b.month} className="border-t border-slate-100">
                                        <td className="px-3 py-2 font-semibold" style={{ color: NAVY }}>{b.month}</td>
                                        <td className="px-3 py-2 text-right text-slate-700">{b.count.toLocaleString()}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-700">{formatShort(b.volume)}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: '#10B981' }}>{formatShort(b.fees)}</td>
                                        <td className="px-3 py-2 text-right text-slate-500">{m.toFixed(2)}%</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// KPI grande
// ─────────────────────────────────────────────
const KpiBig: React.FC<{ icon: any; color: string; label: string; value: string; change?: number; sublabel?: string }> =
    ({ icon: Icon, color, label, value, change, sublabel }) => (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '1A' }}>
                    <Icon size={18} color={color} />
                </div>
                {change !== undefined && Math.abs(change) > 0.01 && (
                    <span
                        className="text-xs font-bold flex items-center gap-0.5 px-2 py-0.5 rounded-full"
                        style={{
                            backgroundColor: change >= 0 ? '#D1FAE5' : '#FEE2E2',
                            color: change >= 0 ? '#065F46' : '#991B1B',
                        }}
                    >
                        {change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                        {Math.abs(change).toFixed(1)}%
                    </span>
                )}
            </div>
            <p className="text-2xl md:text-3xl font-bold leading-none" style={{ color: NAVY }}>{value}</p>
            <p className="text-xs text-slate-500 mt-1">{label}</p>
            {sublabel && <p className="text-xs text-slate-400 mt-0.5">{sublabel}</p>}
        </div>
    );

// ─────────────────────────────────────────────
// Bar chart con doble serie (volumen + comisiones)
// ─────────────────────────────────────────────
const DualBarChart: React.FC<{ data: MonthBucket[] }> = ({ data }) => {
    if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const W = 900, H = 280, padL = 60, padR = 50, padT = 10, padB = 40;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxVol = Math.max(...data.map(d => d.volume), 1);
    const maxFee = Math.max(...data.map(d => d.fees), 1);
    const groupW = innerW / data.length;
    const barW = (groupW - 6) / 2;

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
        y: padT + innerH - t * innerH,
        labelVol: formatShort(t * maxVol),
        labelFee: formatShort(t * maxFee),
    }));

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 320 }}>
            {yTicks.map((t, i) => (
                <g key={i}>
                    <line x1={padL} y1={t.y} x2={padL + innerW} y2={t.y} stroke="#F1F5F9" />
                    <text x={padL - 6} y={t.y + 3} fontSize="9" fill="#94A3B8" textAnchor="end">{t.labelVol}</text>
                    <text x={padL + innerW + 6} y={t.y + 3} fontSize="9" fill="#10B981" textAnchor="start">{t.labelFee}</text>
                </g>
            ))}
            {data.map((d, i) => {
                const x = padL + i * groupW + 3;
                const hV = (d.volume / maxVol) * innerH;
                const hF = (d.fees / maxFee) * innerH;
                return (
                    <g key={d.month}>
                        <rect x={x} y={padT + innerH - hV} width={barW} height={hV} fill={TEAL} rx={2} />
                        <rect x={x + barW + 2} y={padT + innerH - hF} width={barW} height={hF} fill="#10B981" rx={2} />
                        <text x={x + barW} y={H - 22} fontSize="9" fill="#64748B" textAnchor="middle">{d.month.slice(5)}</text>
                        <text x={x + barW} y={H - 10} fontSize="8" fill="#94A3B8" textAnchor="middle">{d.month.slice(2, 4)}</text>
                    </g>
                );
            })}
        </svg>
    );
};

// ─────────────────────────────────────────────
// Donut por tipo de TX
// ─────────────────────────────────────────────
const TypeDonut: React.FC<{ data: ByType[] }> = ({ data }) => {
    const total = data.reduce((s, d) => s + d.volume, 0);
    if (total === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const R = 70, STROKE = 22, CX = 90, CY = 90, C = 2 * Math.PI * R;
    let offset = 0;
    const segs = data.map(d => {
        const pct = d.volume / total;
        const len = pct * C;
        const s = { ...d, pct, len, offset, color: TYPE_COLORS[d.type] ?? '#94A3B8' };
        offset += len;
        return s;
    });
    return (
        <div className="flex flex-col md:flex-row items-center gap-4">
            <svg viewBox="0 0 180 180" className="w-44 h-44 shrink-0">
                <circle cx={CX} cy={CY} r={R} fill="none" stroke="#F1F5F9" strokeWidth={STROKE} />
                {segs.map(s => (
                    <circle
                        key={s.type}
                        cx={CX} cy={CY} r={R}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={STROKE}
                        strokeDasharray={`${s.len} ${C}`}
                        strokeDashoffset={-s.offset}
                        transform={`rotate(-90 ${CX} ${CY})`}
                    />
                ))}
                <text x={CX} y={CY - 2} textAnchor="middle" fontSize="14" fontWeight="bold" fill={NAVY}>{formatShort(total)}</text>
                <text x={CX} y={CY + 12} textAnchor="middle" fontSize="8" fill="#94A3B8">VOLUMEN</text>
            </svg>
            <div className="flex-1 w-full space-y-2">
                {segs.map(s => (
                    <div key={s.type}>
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                                <span className="text-slate-700 capitalize">{TYPE_LABELS[s.type] ?? s.type}</span>
                            </span>
                            <span className="font-mono font-semibold text-slate-900">{formatShort(s.volume)}</span>
                        </div>
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full" style={{ width: `${s.pct * 100}%`, backgroundColor: s.color }} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Bars por moneda
// ─────────────────────────────────────────────
const CurrencyBars: React.FC<{ data: ByCurrency[] }> = ({ data }) => {
    if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const max = Math.max(...data.map(d => d.volume), 1);
    const COLORS = ['#3B82F6', '#10B981', '#A78BFA', '#F59E0B', '#EF4444', '#06B6D4'];
    return (
        <div className="space-y-3">
            {data.map((c, i) => (
                <div key={c.currency}>
                    <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold text-slate-700">{c.currency}</span>
                        <span className="font-mono text-slate-900">{formatShort(c.volume)} <span className="text-slate-400">· {c.count} tx</span></span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(c.volume / max) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                </div>
            ))}
        </div>
    );
};

// Util
function formatShort(n: number): string {
    if (!isFinite(n)) return '0';
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}
