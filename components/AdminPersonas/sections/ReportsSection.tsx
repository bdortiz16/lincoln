import React, { useEffect, useState } from 'react';
import { Download, BarChart3, FileText, RefreshCw } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { downloadCsv, fetchTransactionsReport, fetchMonthlyVolumeReport, fetchKycFunnelReport } from '../lib/reports';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { SectionHeader, NAVY, TEAL, EmptyState } from './shared';

interface ReportsSectionProps {
    profile: AdminProfile;
}

export const ReportsSection: React.FC<ReportsSectionProps> = ({ profile }) => {
    const [tab, setTab] = useState<'charts' | 'export' | 'regulatory'>('charts');

    return (
        <div className="p-4 md:p-8">
            <SectionHeader title="Reportes" subtitle="Gráficos, exportaciones CSV y reportes regulatorios" />

            <div className="flex gap-2 mb-6 flex-wrap">
                {[
                    { id: 'charts' as const,     label: 'Gráficos',     icon: BarChart3 },
                    { id: 'export' as const,     label: 'Exportar CSV', icon: Download },
                    { id: 'regulatory' as const, label: 'Regulatorio',  icon: FileText },
                ].map(t => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                            style={{
                                backgroundColor: tab === t.id ? NAVY : 'white',
                                color: tab === t.id ? 'white' : '#475569',
                                border: '1px solid #E2E8F0',
                            }}
                        >
                            <Icon size={14} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'charts' && <ChartsTab />}
            {tab === 'export' && <ExportTab profile={profile} />}
            {tab === 'regulatory' && <RegulatoryTab profile={profile} />}
        </div>
    );
};

const ChartsTab: React.FC = () => {
    const [volumeData, setVolumeData] = useState<Array<{ month: string; currency: string; volume: number; count: number }>>([]);
    const [kyc, setKyc] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        const [v, k] = await Promise.all([fetchMonthlyVolumeReport(6), fetchKycFunnelReport()]);
        setVolumeData(v);
        setKyc(k);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const monthlyTotals = Object.values(
        volumeData.reduce((acc: Record<string, { month: string; volume: number; count: number }>, r) => {
            if (!acc[r.month]) acc[r.month] = { month: r.month, volume: 0, count: 0 };
            acc[r.month].volume += r.volume;
            acc[r.month].count += r.count;
            return acc;
        }, {})
    ).sort((a, b) => a.month.localeCompare(b.month));

    return (
        <div>
            <div className="flex items-center justify-end mb-4">
                <button onClick={load} className="text-slate-500 hover:text-slate-700 p-1.5 rounded">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-4">
                <h3 className="font-bold mb-1" style={{ color: NAVY }}>Volumen mensual (últimos 6 meses)</h3>
                <p className="text-xs text-slate-500 mb-4">Suma agregada de todas las monedas</p>
                <BarChart data={monthlyTotals} accessor={(d: any) => d.volume} labelAccessor={(d: any) => d.month.slice(5)} />
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
                    {monthlyTotals.map(m => (
                        <div key={m.month} className="text-center">
                            <p className="font-semibold text-slate-800">{m.month}</p>
                            <p className="font-mono">{m.volume.toLocaleString('es-CO', { maximumFractionDigits: 0 })}</p>
                            <p className="text-slate-400">{m.count} tx</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h3 className="font-bold mb-4" style={{ color: NAVY }}>Estado KYC</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(kyc).map(([status, count]) => (
                        <div key={status} className="bg-slate-50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-bold" style={{ color: NAVY }}>{count}</p>
                            <p className="text-xs text-slate-500 capitalize">{status === 'none' ? 'Sin estado' : status}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const BarChart: React.FC<{ data: any[]; accessor: (d: any) => number; labelAccessor: (d: any) => string }> =
    ({ data, accessor, labelAccessor }) => {
        if (data.length === 0) return <p className="text-slate-400 text-sm text-center py-8">Sin datos</p>;
        const max = Math.max(...data.map(accessor), 1);
        const width = 600;
        const height = 200;
        const padding = 20;
        const barWidth = (width - padding * 2) / data.length - 8;

        return (
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 240 }}>
                {data.map((d, i) => {
                    const h = ((accessor(d) / max) * (height - padding * 2));
                    const x = padding + i * ((width - padding * 2) / data.length) + 4;
                    const y = height - padding - h;
                    return (
                        <g key={i}>
                            <rect x={x} y={y} width={barWidth} height={h} rx={4} fill={TEAL} />
                            <text x={x + barWidth / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="#64748B">
                                {labelAccessor(d)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        );
    };

const ExportTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
    const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [busy, setBusy] = useState<string | null>(null);

    const exportTransactions = async () => {
        setBusy('tx');
        const rows = await fetchTransactionsReport(from + 'T00:00:00', to + 'T23:59:59');
        downloadCsv('cuypay_transacciones', rows as any);
        await logAdminAction({ admin: profile, action: 'export_transactions', metadata: { from, to, count: rows.length } });
        setBusy(null);
    };
    const exportUsers = async () => {
        setBusy('users');
        const { data } = await supabasePersonas
            .from('users')
            .select('id, email, full_name, cuypay_id, country, kyc_status, kyc_verified_at, created_at, admin_role')
            .order('created_at', { ascending: false });
        downloadCsv('cuypay_usuarios', (data ?? []) as any);
        await logAdminAction({ admin: profile, action: 'export_users', metadata: { count: data?.length ?? 0 } });
        setBusy(null);
    };
    const exportAuditLog = async () => {
        setBusy('audit');
        const { data } = await supabasePersonas
            .from('admin_actions')
            .select('created_at, admin_email, admin_role, action, target_type, target_id, metadata')
            .gte('created_at', from + 'T00:00:00')
            .lte('created_at', to + 'T23:59:59')
            .order('created_at', { ascending: false });
        downloadCsv('cuypay_audit_log', (data ?? []) as any);
        await logAdminAction({ admin: profile, action: 'export_audit_log', metadata: { from, to, count: data?.length ?? 0 } });
        setBusy(null);
    };

    return (
        <div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
                <h3 className="font-bold mb-3" style={{ color: NAVY }}>Periodo</h3>
                <div className="flex gap-3">
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Desde</label>
                        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Hasta</label>
                        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ExportCard title="Transacciones" desc="Todas las TX del periodo" onClick={exportTransactions} busy={busy === 'tx'} />
                <ExportCard title="Usuarios" desc="Lista completa de usuarios" onClick={exportUsers} busy={busy === 'users'} />
                <ExportCard title="Audit Log" desc="Acciones administrativas del periodo" onClick={exportAuditLog} busy={busy === 'audit'} />
            </div>
        </div>
    );
};

const ExportCard: React.FC<{ title: string; desc: string; onClick: () => void; busy: boolean }> = ({ title, desc, onClick, busy }) => (
    <button onClick={onClick} disabled={busy} className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:border-green-500 transition-colors disabled:opacity-50">
        <div className="flex items-center justify-between mb-2">
            <Download size={18} color={NAVY} />
            {busy && <RefreshCw size={14} className="animate-spin text-slate-400" />}
        </div>
        <p className="font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500 mt-1">{desc}</p>
    </button>
);

const RegulatoryTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    return (
        <div className="space-y-3">
            <RegReport
                title="Reporte de operaciones sospechosas (ROS)"
                desc="Alertas de compliance con severidad alta o crítica del último mes"
                action={async () => {
                    const since = new Date(Date.now() - 30 * 86400000).toISOString();
                    const { data } = await supabasePersonas
                        .from('compliance_alerts')
                        .select('created_at, severity, status, rule_name, description, user_id, transaction_id, metadata')
                        .gte('created_at', since)
                        .in('severity', ['high', 'critical'])
                        .order('created_at', { ascending: false });
                    downloadCsv('cuypay_ros', (data ?? []) as any);
                    await logAdminAction({ admin: profile, action: 'export_regulatory_ros', metadata: { count: data?.length ?? 0 } });
                }}
            />
            <RegReport
                title="Volumen mensual (UIAF)"
                desc="Total transado por moneda, agrupado por mes (últimos 12 meses)"
                action={async () => {
                    const rows = await fetchMonthlyVolumeReport(12);
                    downloadCsv('cuypay_volumen_mensual', rows);
                    await logAdminAction({ admin: profile, action: 'export_regulatory_volume' });
                }}
            />
            <RegReport
                title="Embudo KYC"
                desc="Usuarios por estado de verificación"
                action={async () => {
                    const kyc = await fetchKycFunnelReport();
                    const rows = Object.entries(kyc).map(([status, count]) => ({ status, count }));
                    downloadCsv('cuypay_kyc_funnel', rows);
                    await logAdminAction({ admin: profile, action: 'export_regulatory_kyc' });
                }}
            />
        </div>
    );
};

const RegReport: React.FC<{ title: string; desc: string; action: () => Promise<void> }> = ({ title, desc, action }) => {
    const [busy, setBusy] = useState(false);
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
            <FileText size={24} color={NAVY} className="shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
            </div>
            <button onClick={async () => { setBusy(true); await action(); setBusy(false); }} disabled={busy}
                className="px-3 py-2 text-sm font-semibold text-white rounded-lg flex items-center gap-1.5"
                style={{ backgroundColor: NAVY }}>
                <Download size={14} />
                {busy ? '...' : 'Descargar'}
            </button>
        </div>
    );
};
