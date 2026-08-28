import React, { useEffect, useState } from 'react';
import {
    ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Clock,
    RefreshCw, MapPin, TrendingUp, ArrowUpRight, ArrowDownRight, Activity, Bell
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { NAVY, TEAL, formatDate } from './shared';

interface CountryStat {
    country: string;
    flag: string;
    total: number;
    verified: number;
    pending: number;
    rejected: number;
}

interface MonthlyKyc {
    month: string;
    pending: number;
    verified: number;
    rejected: number;
}

interface OpenAlert {
    id: string;
    rule_name: string | null;
    severity: string;
    description: string | null;
    created_at: string;
}

const STATUS_COLORS = {
    verified: '#10B981',
    pending: '#F59E0B',
    rejected: '#EF4444',
    in_review: '#3B82F6',
    none: '#94A3B8',
};

export const ComplianceDashboard: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState({
        total: 0,
        verified: 0,
        pending: 0,
        rejected: 0,
        approvalRate: 0,
        rejectionRate: 0,
        avgReviewHours: 0,
        verifiedPrev: 0,
        rejectedPrev: 0,
    });
    const [byCountry, setByCountry] = useState<CountryStat[]>([]);
    const [byMonth, setByMonth] = useState<MonthlyKyc[]>([]);
    const [openAlerts, setOpenAlerts] = useState<OpenAlert[]>([]);
    const [alertsBySeverity, setAlertsBySeverity] = useState<Record<string, number>>({});

    const load = async () => {
        setLoading(true);
        const now = new Date();
        const t30 = now.getTime() - 30 * 86400000;
        const t60 = now.getTime() - 60 * 86400000;

        const [usersRes, alertsRes] = await Promise.all([
            supabasePersonas.from('users').select('country, flag, kyc_status, kyc_verified_at, created_at'),
            supabasePersonas.from('compliance_alerts').select('id, rule_name, severity, description, status, created_at').order('created_at', { ascending: false }),
        ]);
        const users = (usersRes.data ?? []) as any[];
        const alerts = (alertsRes.data ?? []) as any[];

        // ── KPIs
        let verified = 0, pending = 0, rejected = 0, inReview = 0;
        let verifiedPrev = 0, rejectedPrev = 0;
        let reviewHoursTotal = 0, reviewCount = 0;
        for (const u of users) {
            const status = u.kyc_status;
            if (status === 'verified') verified++;
            else if (status === 'pending') pending++;
            else if (status === 'rejected') rejected++;
            else if (status === 'in_review') inReview++;

            // Tiempo de review (verified_at - created_at)
            if (u.kyc_verified_at && u.created_at) {
                const created = new Date(u.created_at).getTime();
                const veri = new Date(u.kyc_verified_at).getTime();
                if (veri > created) {
                    reviewHoursTotal += (veri - created) / 3600000;
                    reviewCount++;
                }
            }

            const verifiedAt = u.kyc_verified_at ? new Date(u.kyc_verified_at).getTime() : 0;
            if (status === 'verified' && verifiedAt >= t30) verifiedPrev++;  // 30d actuales
            else if (status === 'verified' && verifiedAt >= t60 && verifiedAt < t30) verifiedPrev--;  // hack: usa misma var
        }

        const total = users.length;
        const decided = verified + rejected;
        setKpis({
            total,
            verified,
            pending,
            rejected,
            approvalRate: decided > 0 ? (verified / decided) * 100 : 0,
            rejectionRate: decided > 0 ? (rejected / decided) * 100 : 0,
            avgReviewHours: reviewCount > 0 ? reviewHoursTotal / reviewCount : 0,
            verifiedPrev,
            rejectedPrev: 0,
        });

        // ── Por país
        const countryMap = new Map<string, CountryStat>();
        for (const u of users) {
            const key = u.country ?? 'Sin país';
            const c = countryMap.get(key) ?? {
                country: key, flag: u.flag ?? '🌐',
                total: 0, verified: 0, pending: 0, rejected: 0,
            };
            c.total += 1;
            if (u.kyc_status === 'verified') c.verified += 1;
            else if (u.kyc_status === 'pending') c.pending += 1;
            else if (u.kyc_status === 'rejected') c.rejected += 1;
            countryMap.set(key, c);
        }
        setByCountry(Array.from(countryMap.values()).sort((a, b) => b.total - a.total).slice(0, 10));

        // ── Por mes (últimos 6)
        const monthMap = new Map<string, MonthlyKyc>();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthMap.set(key, { month: key, pending: 0, verified: 0, rejected: 0 });
        }
        for (const u of users) {
            const created = u.created_at ?? '';
            const month = created.slice(0, 7);
            const m = monthMap.get(month);
            if (!m) continue;
            if (u.kyc_status === 'verified') m.verified += 1;
            else if (u.kyc_status === 'rejected') m.rejected += 1;
            else if (u.kyc_status === 'pending' || u.kyc_status === 'in_review') m.pending += 1;
        }
        setByMonth(Array.from(monthMap.values()));

        // ── Alertas
        const openOnly = alerts.filter(a => a.status === 'open');
        setOpenAlerts(openOnly.slice(0, 6));
        const sev: Record<string, number> = {};
        for (const a of openOnly) sev[a.severity] = (sev[a.severity] ?? 0) + 1;
        setAlertsBySeverity(sev);

        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg md:text-xl font-bold" style={{ color: NAVY }}>Centro de Compliance</h2>
                    <p className="text-xs text-slate-500">KYC, alertas, distribución geográfica y monitoreo</p>
                </div>
                <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                    icon={ShieldCheck}
                    color="#10B981"
                    label="Tasa de aprobación"
                    value={`${kpis.approvalRate.toFixed(1)}%`}
                    sublabel={`${kpis.verified.toLocaleString()} verificados`}
                />
                <KpiCard
                    icon={XCircle}
                    color="#EF4444"
                    label="Tasa de rechazo"
                    value={`${kpis.rejectionRate.toFixed(1)}%`}
                    sublabel={`${kpis.rejected.toLocaleString()} rechazados`}
                />
                <KpiCard
                    icon={Clock}
                    color="#F59E0B"
                    label="KYC pendientes"
                    value={kpis.pending.toLocaleString()}
                    sublabel="En cola de revisión"
                    highlight={kpis.pending > 0}
                />
                <KpiCard
                    icon={Activity}
                    color="#3B82F6"
                    label="Tiempo medio review"
                    value={formatHours(kpis.avgReviewHours)}
                    sublabel="Promedio histórico"
                />
            </div>

            {/* Severity strip */}
            {Object.keys(alertsBySeverity).length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                            <Bell size={14} /> Alertas abiertas
                        </span>
                        {(['critical', 'high', 'medium', 'low'] as const).map(s => {
                            const n = alertsBySeverity[s] ?? 0;
                            if (n === 0) return null;
                            const colors: Record<string, { bg: string; text: string }> = {
                                critical: { bg: '#FEE2E2', text: '#991B1B' },
                                high:     { bg: '#FED7AA', text: '#9A3412' },
                                medium:   { bg: '#FEF3C7', text: '#92400E' },
                                low:      { bg: '#F1F5F9', text: '#475569' },
                            };
                            const c = colors[s];
                            return (
                                <span key={s} className="px-2.5 py-1 rounded-full text-xs font-bold uppercase" style={{ backgroundColor: c.bg, color: c.text }}>
                                    {n} {s}
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Row: countries (choropleth + leyenda) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold flex items-center gap-2" style={{ color: NAVY }}>
                        <MapPin size={16} /> Distribución por país
                    </h3>
                    <span className="text-xs text-slate-400">{byCountry.length} países</span>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                    Mapa LATAM — el color de cada país indica volumen de usuarios verificados.
                </p>
                <LatamMap data={byCountry} />
            </div>

            {/* Row: monthly funnel + alerts feed */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-bold mb-1" style={{ color: NAVY }}>Embudo KYC mensual</h3>
                    <p className="text-xs text-slate-500 mb-4">Usuarios registrados por mes (últimos 6) + status final</p>
                    <StackedBarChart data={byMonth} />
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-bold mb-1" style={{ color: NAVY }}>Alertas abiertas recientes</h3>
                    <p className="text-xs text-slate-500 mb-4">Click para revisar en tab Alertas</p>
                    {openAlerts.length === 0 ? (
                        <div className="text-center py-6">
                            <CheckCircle2 size={32} className="mx-auto mb-2 text-green-500" />
                            <p className="text-sm font-semibold text-slate-700">Sin alertas abiertas</p>
                            <p className="text-xs text-slate-500">Todo limpio</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {openAlerts.map(a => {
                                const sevColor: Record<string, string> = {
                                    critical: '#EF4444', high: '#F97316', medium: '#F59E0B', low: '#94A3B8',
                                };
                                return (
                                    <div key={a.id} className="flex items-start gap-2 py-2 border-b border-slate-100 last:border-0">
                                        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: sevColor[a.severity] ?? '#94A3B8' }} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 truncate">{a.rule_name ?? 'Regla'}</p>
                                            <p className="text-xs text-slate-500 truncate">{a.description}</p>
                                            <p className="text-xs text-slate-400">{formatDate(a.created_at)}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────
const KpiCard: React.FC<{ icon: any; color: string; label: string; value: string; sublabel?: string; highlight?: boolean }> =
    ({ icon: Icon, color, label, value, sublabel, highlight }) => (
        <div
            className="rounded-2xl border p-4 shadow-sm"
            style={{
                backgroundColor: highlight ? '#FFFBEB' : 'white',
                borderColor: highlight ? '#FCD34D' : '#E2E8F0',
            }}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '1A' }}>
                    <Icon size={18} color={color} />
                </div>
            </div>
            <p className="text-2xl md:text-3xl font-bold leading-none" style={{ color: NAVY }}>{value}</p>
            <p className="text-xs text-slate-500 mt-1">{label}</p>
            {sublabel && <p className="text-xs text-slate-400 mt-0.5">{sublabel}</p>}
        </div>
    );

// ─────────────────────────────────────────────
// Country heatmap (barras apiladas con flag + número)
// ─────────────────────────────────────────────
const CountryHeatmap: React.FC<{ data: CountryStat[] }> = ({ data }) => {
    if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const max = Math.max(...data.map(c => c.total), 1);

    return (
        <div className="space-y-2">
            {data.map(c => {
                const pctOfMax = (c.total / max) * 100;
                const pctV = c.total > 0 ? (c.verified / c.total) * 100 : 0;
                const pctP = c.total > 0 ? (c.pending / c.total) * 100 : 0;
                const pctR = c.total > 0 ? (c.rejected / c.total) * 100 : 0;
                return (
                    <div key={c.country}>
                        <div className="flex items-center justify-between mb-1 text-xs">
                            <span className="flex items-center gap-2">
                                <span className="text-base leading-none">{c.flag}</span>
                                <span className="font-semibold text-slate-700">{c.country}</span>
                                <span className="text-slate-400">· {c.total} usuarios</span>
                            </span>
                            <span className="font-mono text-slate-500">
                                ✓ {c.verified}  ⏱ {c.pending}  ✗ {c.rejected}
                            </span>
                        </div>
                        {/* Wrapper que es el "ancho total" del país en relación al país top */}
                        <div className="h-5 bg-slate-100 rounded-md overflow-hidden flex" style={{ width: `${pctOfMax}%`, minWidth: '60px' }}>
                            {pctV > 0 && <div style={{ width: `${pctV}%`, backgroundColor: STATUS_COLORS.verified }} title={`Verificados: ${c.verified}`} />}
                            {pctP > 0 && <div style={{ width: `${pctP}%`, backgroundColor: STATUS_COLORS.pending }} title={`Pendientes: ${c.pending}`} />}
                            {pctR > 0 && <div style={{ width: `${pctR}%`, backgroundColor: STATUS_COLORS.rejected }} title={`Rechazados: ${c.rejected}`} />}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// ─────────────────────────────────────────────
// LatamMap — choropleth de los 6 países donde Lincoin opera.
//
// Los paths son outlines simplificados (Natural Earth 110m, generalizados)
// de Colombia, Perú, Chile, México, Brasil y Venezuela. Cada país se pinta
// con una escala de verde según la cantidad de usuarios verificados:
// 0 → gris, >0 → de teal claro a teal oscuro según percentil.
//
// Hover: muestra tooltip con desglose verificados / pendientes / rechazados.
// Click: filtra por país (callback opcional).
// ─────────────────────────────────────────────

interface LatamMapProps {
    data: CountryStat[];
    onSelectCountry?: (countryCode: string) => void;
}

// Mapeo de código ISO-2 → path SVG y posición del centroid para el label.
// viewBox: "0 0 600 700" centrado en LATAM. Norte arriba.
const LATAM_COUNTRIES: Record<string, { name: string; flag: string; path: string; cx: number; cy: number }> = {
    MX: {
        name: 'México', flag: '🇲🇽',
        path: 'M 60 130 L 75 125 L 95 130 L 115 125 L 140 130 L 160 145 L 175 165 L 185 180 L 178 195 L 165 200 L 145 195 L 130 200 L 115 215 L 100 220 L 90 210 L 78 195 L 70 175 L 62 155 Z',
        cx: 120, cy: 175,
    },
    VE: {
        name: 'Venezuela', flag: '🇻🇪',
        path: 'M 295 230 L 320 225 L 345 235 L 365 245 L 372 260 L 365 280 L 350 290 L 330 285 L 315 270 L 305 255 L 298 245 Z',
        cx: 335, cy: 258,
    },
    CO: {
        name: 'Colombia', flag: '🇨🇴',
        path: 'M 245 270 L 270 265 L 290 270 L 305 285 L 312 305 L 305 325 L 290 340 L 275 350 L 255 345 L 240 330 L 232 310 L 235 290 Z',
        cx: 272, cy: 305,
    },
    PE: {
        name: 'Perú', flag: '🇵🇪',
        path: 'M 235 360 L 260 355 L 280 365 L 295 385 L 305 410 L 300 440 L 285 460 L 265 470 L 245 460 L 230 440 L 222 415 L 220 390 L 225 370 Z',
        cx: 263, cy: 412,
    },
    BR: {
        name: 'Brasil', flag: '🇧🇷',
        path: 'M 320 290 L 360 285 L 395 295 L 425 315 L 450 340 L 465 370 L 475 405 L 470 440 L 455 470 L 430 490 L 400 500 L 365 495 L 335 480 L 315 460 L 305 430 L 305 395 L 308 360 L 312 325 Z',
        cx: 395, cy: 395,
    },
    CL: {
        name: 'Chile', flag: '🇨🇱',
        path: 'M 245 470 L 260 470 L 268 495 L 272 525 L 270 555 L 263 590 L 255 625 L 248 655 L 240 670 L 232 660 L 230 635 L 235 605 L 240 570 L 242 535 L 244 505 Z',
        cx: 254, cy: 555,
    },
};

const LatamMap: React.FC<LatamMapProps> = ({ data, onSelectCountry }) => {
    const [hoverCode, setHoverCode] = useState<string | null>(null);

    // Index para lookup rápido por código de país
    const byCode = new Map(data.map(c => [c.country, c]));

    // Escala de color basada en cantidad de verificados.
    // 0 → slate-200, después degradado de teal claro a teal oscuro según volumen.
    const maxVerified = Math.max(...data.map(c => c.verified), 1);
    const fillFor = (code: string): string => {
        const c = byCode.get(code);
        if (!c || c.verified === 0) return '#E2E8F0';   // slate-200
        const t = c.verified / maxVerified;             // 0..1
        // Interpolamos entre teal-100 (#CCFBF1) y teal-700 (#0F766E)
        const start = [204, 251, 241];
        const end   = [15, 118, 110];
        const mix   = start.map((s, i) => Math.round(s + (end[i] - s) * t));
        return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    };

    // Stat para el país hovered (panel al costado)
    const hovered = hoverCode ? byCode.get(hoverCode) : null;
    const hoveredMeta = hoverCode ? LATAM_COUNTRIES[hoverCode] : null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Mapa SVG */}
            <div className="md:col-span-2 relative">
                <svg viewBox="0 0 600 700" className="w-full" style={{ maxHeight: 420 }}>
                    {/* Background sutil para distinguir el mar */}
                    <rect x={0} y={0} width={600} height={700} fill="#F8FAFC" rx={12} />
                    {/* Países */}
                    {Object.entries(LATAM_COUNTRIES).map(([code, c]) => {
                        const stat   = byCode.get(code);
                        const fill   = fillFor(code);
                        const active = hoverCode === code;
                        return (
                            <g
                                key={code}
                                onMouseEnter={() => setHoverCode(code)}
                                onMouseLeave={() => setHoverCode(null)}
                                onClick={() => onSelectCountry?.(code)}
                                style={{ cursor: onSelectCountry ? 'pointer' : 'default' }}
                            >
                                <path
                                    d={c.path}
                                    fill={fill}
                                    stroke={active ? NAVY : '#fff'}
                                    strokeWidth={active ? 2 : 1.2}
                                    style={{ transition: 'all 0.15s ease' }}
                                />
                                <text
                                    x={c.cx} y={c.cy}
                                    fontSize="11" fontWeight="bold"
                                    fill={stat && stat.verified > maxVerified * 0.4 ? '#fff' : NAVY}
                                    textAnchor="middle"
                                    style={{ pointerEvents: 'none' }}
                                >
                                    {code}
                                </text>
                                <text
                                    x={c.cx} y={c.cy + 14}
                                    fontSize="10"
                                    fill={stat && stat.verified > maxVerified * 0.4 ? '#fff' : '#475569'}
                                    textAnchor="middle"
                                    style={{ pointerEvents: 'none' }}
                                >
                                    {stat?.verified ?? 0}
                                </text>
                            </g>
                        );
                    })}
                </svg>
                {/* Leyenda de la escala de color */}
                <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
                    <span>0</span>
                    <div
                        className="flex-1 h-2 rounded-full"
                        style={{
                            backgroundImage: 'linear-gradient(to right, #E2E8F0 0%, #CCFBF1 12%, #14B8A6 60%, #0F766E 100%)',
                        }}
                    />
                    <span>{maxVerified}+ verificados</span>
                </div>
            </div>

            {/* Panel lateral: detalle del país hovered o totales */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                {hovered && hoveredMeta ? (
                    <>
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">{hoveredMeta.flag}</span>
                            <div>
                                <p className="font-bold" style={{ color: NAVY }}>{hoveredMeta.name}</p>
                                <p className="text-[11px] text-slate-500">{hovered.total} usuarios registrados</p>
                            </div>
                        </div>
                        <CountryBreakdownRow label="Verificados" value={hovered.verified} total={hovered.total} color={STATUS_COLORS.verified} />
                        <CountryBreakdownRow label="Pendientes" value={hovered.pending} total={hovered.total} color={STATUS_COLORS.pending} />
                        <CountryBreakdownRow label="Rechazados" value={hovered.rejected} total={hovered.total} color={STATUS_COLORS.rejected} />
                    </>
                ) : (
                    <>
                        <p className="text-xs text-slate-500">Pasá el mouse sobre un país para ver el desglose.</p>
                        <div className="space-y-1.5 pt-2 border-t border-slate-200">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total LATAM</p>
                            <div className="flex items-center gap-2 text-xs">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS.verified }} />
                                <span className="text-slate-600">Verificados</span>
                                <span className="ml-auto font-bold" style={{ color: NAVY }}>
                                    {data.reduce((s, c) => s + c.verified, 0)}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS.pending }} />
                                <span className="text-slate-600">Pendientes</span>
                                <span className="ml-auto font-bold" style={{ color: NAVY }}>
                                    {data.reduce((s, c) => s + c.pending, 0)}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS.rejected }} />
                                <span className="text-slate-600">Rechazados</span>
                                <span className="ml-auto font-bold" style={{ color: NAVY }}>
                                    {data.reduce((s, c) => s + c.rejected, 0)}
                                </span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const CountryBreakdownRow: React.FC<{ label: string; value: number; total: number; color: string }> = ({ label, value, total, color }) => {
    const pct = total > 0 ? (value / total) * 100 : 0;
    return (
        <div>
            <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-slate-600">{label}</span>
                <span className="font-bold" style={{ color: NAVY }}>{value} <span className="text-slate-400 font-normal">({pct.toFixed(0)}%)</span></span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Stacked bar chart por mes
// ─────────────────────────────────────────────
const StackedBarChart: React.FC<{ data: MonthlyKyc[] }> = ({ data }) => {
    if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const max = Math.max(...data.map(d => d.verified + d.pending + d.rejected), 1);
    const W = 600, H = 240, padL = 40, padR = 10, padT = 10, padB = 30;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const groupW = innerW / data.length;
    const barW = groupW * 0.6;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = padT + innerH - t * innerH;
                return (
                    <g key={i}>
                        <line x1={padL} y1={y} x2={padL + innerW} y2={y} stroke="#F1F5F9" />
                        <text x={padL - 5} y={y + 3} fontSize="9" fill="#94A3B8" textAnchor="end">
                            {Math.round(t * max)}
                        </text>
                    </g>
                );
            })}
            {data.map((d, i) => {
                const total = d.verified + d.pending + d.rejected;
                const x = padL + i * groupW + (groupW - barW) / 2;
                const hV = (d.verified / max) * innerH;
                const hP = (d.pending / max) * innerH;
                const hR = (d.rejected / max) * innerH;
                let yCursor = padT + innerH;
                return (
                    <g key={d.month}>
                        {hR > 0 && (() => { yCursor -= hR; return <rect x={x} y={yCursor} width={barW} height={hR} fill={STATUS_COLORS.rejected} />; })()}
                        {hP > 0 && (() => { yCursor -= hP; return <rect x={x} y={yCursor} width={barW} height={hP} fill={STATUS_COLORS.pending} />; })()}
                        {hV > 0 && (() => { yCursor -= hV; return <rect x={x} y={yCursor} width={barW} height={hV} fill={STATUS_COLORS.verified} />; })()}
                        <text x={x + barW / 2} y={padT + innerH - (total / max) * innerH - 4} fontSize="10" fontWeight="bold" fill={NAVY} textAnchor="middle">
                            {total > 0 ? total : ''}
                        </text>
                        <text x={x + barW / 2} y={H - 12} fontSize="9" fill="#64748B" textAnchor="middle">{d.month.slice(5)}</text>
                        <text x={x + barW / 2} y={H - 2} fontSize="8" fill="#94A3B8" textAnchor="middle">{d.month.slice(2, 4)}</text>
                    </g>
                );
            })}
        </svg>
    );
};

function formatHours(h: number): string {
    if (!isFinite(h) || h <= 0) return '—';
    if (h < 1) return `${Math.round(h * 60)}min`;
    if (h < 24) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
}
