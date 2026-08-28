import React, { useEffect, useState, useCallback } from 'react';
import { FileSearch, RefreshCw, Filter } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { ROLE_LABELS, ROLE_COLORS, type AdminRole } from '../lib/adminAuth';
import { SectionHeader, formatDate, NAVY, EmptyState } from './shared';

interface AdminActionRow {
    id: string;
    admin_email: string;
    admin_role: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    metadata: any;
    created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
    kyc_approve: 'Aprobó KYC',
    kyc_reject: 'Rechazó KYC',
    tx_approve: 'Aprobó transacción',
    tx_reject: 'Rechazó transacción',
    bank_account_activate: 'Activó cuenta bancaria',
    bank_account_deactivate: 'Desactivó cuenta bancaria',
    admin_create: 'Creó admin',
    admin_update_role: 'Cambió rol de admin',
    admin_remove: 'Removió admin',
};

const PAGE_SIZE = 50;

export const AuditLogSection: React.FC = () => {
    const [rows, setRows] = useState<AdminActionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [filterRole, setFilterRole] = useState<'all' | AdminRole>('all');
    const [filterAction, setFilterAction] = useState<'all' | string>('all');

    const load = useCallback(async () => {
        setLoading(true);
        let query = supabasePersonas
            .from('admin_actions')
            .select('id, admin_email, admin_role, action, target_type, target_id, metadata, created_at')
            .order('created_at', { ascending: false })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        if (filterRole !== 'all') query = query.eq('admin_role', filterRole);
        if (filterAction !== 'all') query = query.eq('action', filterAction);

        const { data } = await query;
        const fetched = (data as AdminActionRow[]) ?? [];
        setHasMore(fetched.length > PAGE_SIZE);
        setRows(fetched.slice(0, PAGE_SIZE));
        setLoading(false);
    }, [page, filterRole, filterAction]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="p-4 md:p-8">
            <SectionHeader
                title="Audit Log"
                subtitle="Registro inmutable de todas las acciones administrativas"
                right={
                    <button onClick={() => { setPage(0); load(); }} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                }
            />

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <Filter size={14} className="text-slate-400" />
                <select
                    value={filterRole}
                    onChange={(e) => { setPage(0); setFilterRole(e.target.value as any); }}
                    className="text-sm rounded-lg border border-slate-200 px-3 py-1.5 bg-white"
                >
                    <option value="all">Todos los roles</option>
                    {(Object.keys(ROLE_LABELS) as AdminRole[]).map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                </select>
                <select
                    value={filterAction}
                    onChange={(e) => { setPage(0); setFilterAction(e.target.value); }}
                    className="text-sm rounded-lg border border-slate-200 px-3 py-1.5 bg-white"
                >
                    <option value="all">Todas las acciones</option>
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && rows.length === 0 && (
                <EmptyState icon={FileSearch} title="Sin registros" message="Aún no se han registrado acciones administrativas con estos filtros" />
            )}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="text-left px-4 py-3">Fecha</th>
                            <th className="text-left px-4 py-3">Admin</th>
                            <th className="text-left px-4 py-3">Rol</th>
                            <th className="text-left px-4 py-3">Acción</th>
                            <th className="text-left px-4 py-3">Detalles</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const roleKey = r.admin_role as AdminRole;
                            const roleColor = ROLE_COLORS[roleKey] ?? '#94A3B8';
                            const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : null;
                            return (
                                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                                    <td className="px-4 py-3 text-slate-700">{r.admin_email}</td>
                                    <td className="px-4 py-3">
                                        <span
                                            className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                                            style={{ backgroundColor: `${roleColor}33`, color: NAVY }}
                                        >
                                            {ROLE_LABELS[roleKey] ?? r.admin_role}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-medium text-slate-900">{ACTION_LABELS[r.action] ?? r.action}</td>
                                    <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
                                        {meta?.email || meta?.cuypay_id || r.target_id || '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {(page > 0 || hasMore) && (
                <div className="flex items-center justify-between mt-4">
                    <button
                        disabled={page === 0}
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        className="px-3 py-1.5 text-sm rounded-lg bg-white border border-slate-200 disabled:opacity-40"
                    >
                        ← Anterior
                    </button>
                    <span className="text-xs text-slate-500">Página {page + 1}</span>
                    <button
                        disabled={!hasMore}
                        onClick={() => setPage(p => p + 1)}
                        className="px-3 py-1.5 text-sm rounded-lg bg-white border border-slate-200 disabled:opacity-40"
                    >
                        Siguiente →
                    </button>
                </div>
            )}
        </div>
    );
};
