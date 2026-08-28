import React, { useEffect, useState } from 'react';
import {
    TrendingUp, TrendingDown, Users, DollarSign, AlertTriangle, ShieldCheck,
    ArrowUpRight, ArrowDownRight, Clock, Activity, RefreshCw, ChevronRight
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { type AdminProfile, ROLE_LABELS, ROLE_COLORS } from '../lib/adminAuth';
import { formatDate, NAVY, TEAL } from './shared';

interface Props {
    profile: AdminProfile;
}

interface Kpi {
    label: string;
    value: string;
    change: number; // % change vs previous period
    trend: number[]; // sparkline data
    color: string;
    icon: any;
}

interface DailyVolume {
    day: string;
    total: number;
}

interface CountryStat {
    country: string;
    flag: string;
    count: number;
}

interface RecentAction {
    id: string;
    admin_email: string;
    admin_role: string;
    action: string;
    created_at: string;
}

export const OverviewSection: React.FC<Props> = ({ profile }) => {
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState<Kpi[]>([]);
    const [volumeSeries, setVolumeSeries] = useState<DailyVolume[]>([]);
    const [kycDist, setKycDist] = useState<Record<string, number>>({});
    const [countries, setCountries] = useState<CountryStat[]>([]);
    const [recentActions, setRecentActions] = useState<RecentAction[]>([]);
    const [pendingTxList, setPendingTxList] = useState<any[]>([]);

    const load = async () => {
        setLoading(true);
        const now = new Date();
        const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
        const since60 = new Date(now.getTime() - 60 * 86400000).toISOString();

        const [
            usersRes, allTxRes, kycRes, recentActionsRes, pendingTxRes
        ] = await Promise.all([
            supabasePersonas.from('users').select('country, flag, kyc_status, created_at'),
            supabasePersonas.from('transactions').select('from_amount, from_currency, status, type, created_at').gte('created_at', since60.toString()),
            supabasePersonas.from('users').select('kyc_status'),
            supabasePersonas.from('admin_actions').select('id, admin_email, admin_role, action, created_at').order('created_at', { ascending: false }).limit(8),
            supabasePersonas.from('transactions').select('id, type, from_amount, from_currency, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
        ]);

        const users = (usersRes.data ?? []) as any[];
        const allTx = (allTxRes.data ?? []) as any[];
        const kyc = (kycRes.data ?? []) as any[];

        // ── KPIs con comparativa periodo previo
        const tx30 = allTx.filter(t => new Date(t.created_at).getTime() >= now.getTime() - 30 * 86400000);
        const tx60_30 = allTx.filter(t => {
            const d = new Date(t.created_at).getTime();
            return d >= now.getTime() - 60 * 86400000 && d < now.getTime() - 30 * 86400000;
        });
        const vol30 = tx30.filter(t => ['approved','completed'].includes(t.status)).reduce((s, t) => s + (Number(t.from_amount) || 0), 0);
        const vol60_30 = tx60_30.filter(t => ['approved','completed'].includes(t.status)).reduce((s, t) => s + (Number(t.from_amount) || 0), 0);
        const volChange = vol60_30 > 0 ? ((vol30 - vol60_30) / vol60_30) * 100 : 0;

        const newUsers30 = users.filter(u => new Date(u.created_at).getTime() >= now.getTime() - 30 * 86400000).length;
        const newUsers60_30 = users.filter(u => {
            const d = new Date(u.created_at).getTime();
            return d >= now.getTime() - 60 * 86400000 && d < now.getTime() - 30 * 86400000;
        }).length;
        const userChange = newUsers60_30 > 0 ? ((newUsers30 - newUsers60_30) / newUsers60_30) * 100 : (newUsers30 > 0 ? 100 : 0);

        const tx30Count = tx30.length;
        const tx60_30Count = tx60_30.length;
        const txChange = tx60_30Count > 0 ? ((tx30Count - tx60_30Count) / tx60_30Count) * 100 : 0;

        const pendingKyc = kyc.filter(u => u.kyc_status === 'pending').length;

        // Sparklines (últimos 7 dias)
        const sparkVol: number[] = [];
        const sparkUsers: number[] = [];
        const sparkTx: number[] = [];
        for (let i = 6; i >= 0; i--) {
            const dayStart = new Date(now.getTime() - i * 86400000); dayStart.setHours(0,0,0,0);
            const dayEnd = new Date(dayStart.getTime() + 86400000);
            sparkVol.push(allTx.filter(t => {
                const d = new Date(t.created_at);
                return d >= dayStart && d < dayEnd && ['approved','completed'].includes(t.status);
            }).reduce((s, t) => s + (Number(t.from_amount) || 0), 0));
            sparkUsers.push(users.filter(u => {
                const d = new Date(u.created_at);
                return d >= dayStart && d < dayEnd;
            }).length);
            sparkTx.push(allTx.filter(t => {
                const d = new Date(t.created_at);
                return d >= dayStart && d < dayEnd;
            }).length);
        }

        setKpis([
            { label: 'Volumen 30d', value: formatShort(vol30), change: volChange, trend: sparkVol, color: TEAL, icon: DollarSign },
            { label: 'Usuarios totales', value: users.length.toLocaleString(), change: userChange, trend: sparkUsers, color: '#3B82F6', icon: Users },
            { label: 'TX 30d', value: tx30Count.toLocaleString(), change: txChange, trend: sparkTx, color: '#A78BFA', icon: Activity },
            { label: 'KYC pendientes', value: pendingKyc.toLocaleString(), change: 0, trend: [0,0,0,0,0,0,pendingKyc], color: '#FBBF24', icon: AlertTriangle },
        ]);

        // ── Serie volumen 30 días
        const volByDay = new Map<string, number>();
        for (let i = 29; i >= 0; i--) {
            const day = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
            volByDay.set(day, 0);
        }
        for (const t of allTx) {
            if (!['approved','completed'].includes(t.status)) continue;
            const day = (t.created_at as string).slice(0, 10);
            if (volByDay.has(day)) volByDay.set(day, (volByDay.get(day) ?? 0) + (Number(t.from_amount) || 0));
        }
        setVolumeSeries(Array.from(volByDay.entries()).map(([day, total]) => ({ day, total })));

        // ── KYC distribution
        const kycMap: Record<string, number> = {};
        for (const u of kyc) {
            const k = u.kyc_status ?? 'none';
            kycMap[k] = (kycMap[k] ?? 0) + 1;
        }
        setKycDist(kycMap);

        // ── Top países
        const countryMap = new Map<string, { country: string; flag: string; count: number }>();
        for (const u of users) {
            const key = u.country ?? 'Sin país';
            const c = countryMap.get(key) ?? { country: key, flag: u.flag ?? '', count: 0 };
            c.count += 1;
            countryMap.set(key, c);
        }
        setCountries(Array.from(countryMap.values()).sort((a, b) => b.count - a.count).slice(0, 5));

        setRecentActions((recentActionsRes.data ?? []) as RecentAction[]);
        setPendingTxList((pendingTxRes.data ?? []) as any[]);
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="p-4 md:p-8 space-y-6">
            {/* Header bienvenida */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Panel Ejecutivo</p>
                    <h1 className="text-2xl md:text-3xl font-bold mt-1" style={{ color: NAVY }}>
                        Buenas tardes, {profile.fullName.split(' ')[0]}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {ROLE_LABELS[profile.role]} · {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                </div>
                <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg self-start md:self-end">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {kpis.map(k => <KpiCard key={k.label} k={k} />)}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h3 className="font-bold" style={{ color: NAVY }}>Volumen transado · últimos 30 días</h3>
                            <p className="text-xs text-slate-500">Solo TX aprobadas o completadas</p>
                        </div>
                    </div>
                    <VolumeChart data={volumeSeries} />
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-bold mb-1" style={{ color: NAVY }}>Estado KYC</h3>
                    <p className="text-xs text-slate-500 mb-4">Distribución de usuarios</p>
                    <KycDonut data={kycDist} />
                </div>
            </div>

            {/* Row 3: countries + recent activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-bold mb-1" style={{ color: NAVY }}>Top países</h3>
                    <p className="text-xs text-slate-500 mb-4">Usuarios registrados</p>
                    <CountryBars data={countries} />
                </div>

                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h3 className="font-bold" style={{ color: NAVY }}>Actividad reciente del equipo</h3>
                            <p className="text-xs text-slate-500">Últimas acciones administrativas</p>
                        </div>
                        <span className="text-xs text-slate-400">{recentActions.length} eventos</span>
                    </div>
                    <ActivityFeed actions={recentActions} />
                </div>
            </div>

            {/* Pending TX preview */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="font-bold flex items-center gap-2" style={{ color: NAVY }}>
                            <Clock size={16} className="text-amber-500" />
                            Transacciones pendientes de aprobación
                        </h3>
                        <p className="text-xs text-slate-500">Las 5 más recientes</p>
                    </div>
                </div>
                {pendingTxList.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-sm">
                        <ShieldCheck size={28} className="mx-auto mb-2 text-green-500" />
                        Sin pendientes — todo al día
                    </div>
                ) : (
                    <div className="space-y-2">
                        {pendingTxList.map(t => (
                            <div key={t.id} className="bg-slate-50 rounded-lg p-3 flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                    <Clock size={16} className="text-amber-700" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-slate-900 capitalize text-sm">{t.type}</p>
                                    <p className="text-xs text-slate-500">{formatDate(t.created_at)}</p>
                                </div>
                                <p className="font-mono font-bold text-slate-900 text-sm">
                                    {Number(t.from_amount).toLocaleString('es-CO', { minimumFractionDigits: 2 })} {t.from_currency}
                                </p>
                                <ChevronRight size={16} className="text-slate-400 shrink-0" />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────
const KpiCard: React.FC<{ k: Kpi }> = ({ k }) => {
    const Icon = k.icon;
    const isPositive = k.change >= 0;
    return (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: k.color + '1A' }}>
                    <Icon size={18} color={k.color} />
                </div>
                {k.change !== 0 && (
                    <span
                        className="text-xs font-bold flex items-center gap-0.5 px-2 py-0.5 rounded-full"
                        style={{
                            backgroundColor: isPositive ? '#D1FAE5' : '#FEE2E2',
                            color: isPositive ? '#065F46' : '#991B1B',
                        }}
                    >
                        {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                        {Math.abs(k.change).toFixed(1)}%
                    </span>
                )}
            </div>
            <p className="text-2xl md:text-3xl font-bold leading-none" style={{ color: NAVY }}>{k.value}</p>
            <p className="text-xs text-slate-500 mt-1">{k.label}</p>
            <div className="mt-3">
                <Sparkline data={k.trend} color={k.color} />
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Sparkline (SVG mini)
// ─────────────────────────────────────────────
const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
    if (data.length === 0) return null;
    const W = 100, H = 24;
    const max = Math.max(...data, 1);
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * W;
        const y = H - (v / max) * H;
        return `${x},${y}`;
    }).join(' ');
    const areaPoints = `0,${H} ${points} ${W},${H}`;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-6">
            <polygon points={areaPoints} fill={color} opacity="0.15" />
            <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
};

// ─────────────────────────────────────────────
// Volume Chart (line)
// ─────────────────────────────────────────────
const VolumeChart: React.FC<{ data: DailyVolume[] }> = ({ data }) => {
    if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const W = 800, H = 240, padL = 50, padR = 10, padT = 10, padB = 30;
    const max = Math.max(...data.map(d => d.total), 1);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const points = data.map((d, i) => {
        const x = padL + (i / (data.length - 1)) * innerW;
        const y = padT + innerH - (d.total / max) * innerH;
        return `${x},${y}`;
    });
    const linePoints = points.join(' ');
    const areaPoints = `${padL},${padT + innerH} ${linePoints} ${padL + innerW},${padT + innerH}`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
        y: padT + innerH - t * innerH,
        label: formatShort(t * max),
    }));

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
            {/* Y grid */}
            {ticks.map((t, i) => (
                <g key={i}>
                    <line x1={padL} y1={t.y} x2={padL + innerW} y2={t.y} stroke="#F1F5F9" strokeWidth="1" />
                    <text x={padL - 5} y={t.y + 3} fontSize="9" fill="#94A3B8" textAnchor="end">{t.label}</text>
                </g>
            ))}
            {/* Area */}
            <defs>
                <linearGradient id="grad-vol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TEAL} stopOpacity="0.4" />
                    <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
                </linearGradient>
            </defs>
            <polygon points={areaPoints} fill="url(#grad-vol)" />
            {/* Line */}
            <polyline points={linePoints} fill="none" stroke={TEAL} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* X labels (every 5 days) */}
            {data.map((d, i) => i % 5 === 0 && (
                <text key={i} x={padL + (i / (data.length - 1)) * innerW} y={H - 8} fontSize="9" fill="#94A3B8" textAnchor="middle">
                    {d.day.slice(5)}
                </text>
            ))}
        </svg>
    );
};

// ─────────────────────────────────────────────
// KYC Donut
// ─────────────────────────────────────────────
const KycDonut: React.FC<{ data: Record<string, number> }> = ({ data }) => {
    const entries = Object.entries(data);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const COLORS: Record<string, string> = {
        verified: '#10B981',
        pending: '#F59E0B',
        in_review: '#3B82F6',
        rejected: '#EF4444',
        none: '#94A3B8',
    };
    const LABELS: Record<string, string> = {
        verified: 'Verificado',
        pending: 'Pendiente',
        in_review: 'En revisión',
        rejected: 'Rechazado',
        none: 'Sin estado',
    };
    const R = 70, STROKE = 22, CX = 90, CY = 90, C = 2 * Math.PI * R;
    let offset = 0;
    const segments = entries.map(([k, v]) => {
        const pct = v / total;
        const len = pct * C;
        const seg = { k, v, pct, len, offset, color: COLORS[k] ?? '#94A3B8' };
        offset += len;
        return seg;
    });
    return (
        <div>
            <svg viewBox="0 0 180 180" className="w-full max-w-[200px] mx-auto">
                <circle cx={CX} cy={CY} r={R} fill="none" stroke="#F1F5F9" strokeWidth={STROKE} />
                {segments.map(s => (
                    <circle
                        key={s.k}
                        cx={CX} cy={CY} r={R}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={STROKE}
                        strokeDasharray={`${s.len} ${C}`}
                        strokeDashoffset={-s.offset}
                        transform={`rotate(-90 ${CX} ${CY})`}
                        strokeLinecap="butt"
                    />
                ))}
                <text x={CX} y={CY - 4} textAnchor="middle" fontSize="22" fontWeight="bold" fill={NAVY}>{total}</text>
                <text x={CX} y={CY + 14} textAnchor="middle" fontSize="9" fill="#94A3B8">USUARIOS</text>
            </svg>
            <div className="mt-3 space-y-1.5">
                {segments.map(s => (
                    <div key={s.k} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="text-slate-700 flex-1">{LABELS[s.k] ?? s.k}</span>
                        <span className="font-mono font-semibold text-slate-900">{s.v}</span>
                        <span className="text-slate-400 w-10 text-right">{(s.pct * 100).toFixed(0)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Country bars
// ─────────────────────────────────────────────
const CountryBars: React.FC<{ data: CountryStat[] }> = ({ data }) => {
    if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>;
    const max = Math.max(...data.map(c => c.count), 1);
    return (
        <div className="space-y-3">
            {data.map(c => (
                <div key={c.country}>
                    <div className="flex items-center justify-between text-xs mb-1">
                        <span className="flex items-center gap-1 text-slate-700">
                            <span className="text-base">{c.flag}</span>
                            <span className="font-medium">{c.country}</span>
                        </span>
                        <span className="font-mono font-bold text-slate-900">{c.count}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(c.count / max) * 100}%`, backgroundColor: TEAL }} />
                    </div>
                </div>
            ))}
        </div>
    );
};

// ─────────────────────────────────────────────
// Activity feed
// ─────────────────────────────────────────────
const ActivityFeed: React.FC<{ actions: RecentAction[] }> = ({ actions }) => {
    const ACTION_LABELS: Record<string, string> = {
        kyc_approve: 'Aprobó KYC', kyc_reject: 'Rechazó KYC',
        tx_approve: 'Aprobó transacción', tx_reject: 'Rechazó transacción',
        admin_create: 'Asignó nuevo admin', admin_remove: 'Removió admin',
        bank_account_activate: 'Activó cuenta', bank_account_deactivate: 'Desactivó cuenta',
        mfa_enroll: 'Activó 2FA', mfa_unenroll: 'Desactivó 2FA',
        user_block: 'Bloqueó usuario', user_reset_pin: 'Reseteó PIN',
        user_note: 'Agregó nota', alert_close: 'Cerró alerta', alert_escalate: 'Escaló alerta',
    };
    if (actions.length === 0) {
        return <p className="text-sm text-slate-400 text-center py-8">Sin actividad reciente</p>;
    }
    return (
        <div className="space-y-2">
            {actions.map(a => {
                const roleColor = ROLE_COLORS[a.admin_role as keyof typeof ROLE_COLORS] ?? '#94A3B8';
                return (
                    <div key={a.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                        <div
                            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                            style={{ backgroundColor: roleColor + '33', color: NAVY }}
                        >
                            {a.admin_email[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm" style={{ color: NAVY }}>
                                <span className="font-semibold">{a.admin_email.split('@')[0]}</span>
                                <span className="text-slate-500"> · {ACTION_LABELS[a.action] ?? a.action}</span>
                            </p>
                            <p className="text-xs text-slate-400">{formatDate(a.created_at)}</p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Util: 1234567 → "1.2M"
function formatShort(n: number): string {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}
