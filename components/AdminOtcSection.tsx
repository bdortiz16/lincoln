import React, { useState, useMemo } from 'react';
import { ArrowLeftRight, Search, Power, Pencil, Check, X, ArrowDownToLine, ArrowUpFromLine, Users, Landmark } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';

// ─────────────────────────────────────────────
// AdminOtcSection — Panel "Contabilidad OTC" del admin de Empresas.
//
// Arriba: activa/desactiva el servicio OTC (convertidor Mouv, en
// Servicios → OTC) por cliente, y define la comisión de cada uno — cada
// empresa negocia un % distinto, a diferencia del convertidor general
// (tasa FastForex + comisión por tramos), que es igual para todos.
//
// Abajo: la contabilidad del canal Mouv — cuánto USDT ha entrado a la
// recaudadora por conversiones OTC, cuánto COP se acreditó a cambio,
// el saldo COP de cada cliente, y el historial de movimientos con su
// estado (Pendiente / Completado / Rechazado).
// ─────────────────────────────────────────────

const DEFAULT_FEE_PCT = 4;

const isOtcConvertTx = (t: any) => t.type === 'convert' && (t.source === 'MOUV' || t.gasfree === true);

const fmtCop = (n: number) => Math.round(n || 0).toLocaleString('es-CO');
const fmtUsdt = (n: number) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusStyle = (status: string) => {
    if (status === 'Completado') return 'bg-green-50 text-green-700 border-green-200';
    if (status === 'Rechazado') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
};

const MiniBarChart: React.FC<{ data: { label: string; value: number }[] }> = ({ data }) => {
    const max = Math.max(1, ...data.map(d => d.value));
    return (
        <div className="flex items-end gap-1.5 h-28">
            {data.map((d, i) => (
                <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1.5 group relative h-full justify-end">
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#0C0E0D] text-white text-[10px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                        {fmtCop(d.value)} COP
                    </div>
                    <div
                        className="w-full rounded-t-md bg-gradient-to-t from-[#16A34A] to-[#4ADE80] transition-all group-hover:opacity-80"
                        style={{ height: `${d.value > 0 ? Math.max(4, (d.value / max) * 100) : 1}%` }}
                    />
                    <span className="text-[9px] text-slate-400 whitespace-nowrap shrink-0">{d.label}</span>
                </div>
            ))}
        </div>
    );
};

export const AdminOtcSection: React.FC = () => {
    const { getAllUsers, getAllTransactions, updateUserProfile } = useDatabase();
    const [q, setQ] = useState('');
    const [feeEdit, setFeeEdit] = useState<{ userId: string; value: string } | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);

    const allUsers = getAllUsers();
    const businesses = allUsers.filter((u: any) => u.role !== 'admin' && u.role !== 'personal');
    const filtered = businesses.filter((u: any) => {
        if (!q) return true;
        const s = q.toLowerCase();
        return (u.name ?? '').toLowerCase().includes(s) || (u.email ?? '').toLowerCase().includes(s) || (u.id ?? '').toLowerCase().includes(s);
    });

    const otcConfigOf = (u: any) => (u.otcConfig ?? u.raw_data?.otcConfig ?? {}) as { enabled?: boolean; feePct?: number };

    const toggleEnabled = async (u: any) => {
        const cfg = otcConfigOf(u);
        setSavingId(u.id);
        try {
            await updateUserProfile(u.id, { raw_data: { otcConfig: { ...cfg, enabled: !cfg.enabled } } });
        } finally { setSavingId(null); }
    };

    const saveFee = async (u: any) => {
        if (!feeEdit || feeEdit.userId !== u.id) return;
        const next = parseFloat(feeEdit.value);
        if (isNaN(next) || next < 0) return;
        const cfg = otcConfigOf(u);
        setSavingId(u.id);
        try {
            await updateUserProfile(u.id, { raw_data: { otcConfig: { ...cfg, feePct: next } } });
        } finally { setSavingId(null); setFeeEdit(null); }
    };

    // ── Contabilidad: movimientos del canal OTC/Mouv ──────────────────
    const otcTxs = useMemo(() => {
        const all = getAllTransactions() as any[];
        return all
            .filter(isOtcConvertTx)
            .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    }, [getAllTransactions]);

    const usersById = useMemo(() => new Map(businesses.map((u: any) => [u.id, u])), [businesses]);

    const totals = useMemo(() => {
        let usdt = 0, cop = 0, completados = 0, pendientes = 0, rechazados = 0;
        otcTxs.forEach((t: any) => {
            const isRejected = t.status === 'Rechazado';
            if (!isRejected) {
                usdt += Number(t.usdtOut ?? t.fromAmount ?? 0);
                cop += Number(t.amount ?? 0);
            }
            if (t.status === 'Completado') completados++;
            else if (isRejected) rechazados++;
            else pendientes++;
        });
        return { usdt, cop, completados, pendientes, rechazados, count: otcTxs.length };
    }, [otcTxs]);

    const totalCopBalance = businesses.reduce((s: number, u: any) => s + Number(u.balances?.COP ?? 0), 0);

    const perUserReport = useMemo(() => {
        const map = new Map<string, { user: any; usdt: number; cop: number; count: number }>();
        businesses.forEach((u: any) => map.set(u.id, { user: u, usdt: 0, cop: 0, count: 0 }));
        otcTxs.forEach((t: any) => {
            const entry = map.get(t.userId);
            if (!entry || t.status === 'Rechazado') return;
            entry.usdt += Number(t.usdtOut ?? t.fromAmount ?? 0);
            entry.cop += Number(t.amount ?? 0);
            entry.count++;
        });
        return Array.from(map.values()).sort((a, b) => Number(b.user.balances?.COP ?? 0) - Number(a.user.balances?.COP ?? 0));
    }, [otcTxs, businesses]);

    const dailyData = useMemo(() => {
        const now = new Date();
        const days: { label: string; value: number }[] = [];
        for (let i = 13; i >= 0; i--) {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const end = new Date(start); end.setDate(start.getDate() + 1);
            const cop = otcTxs
                .filter((t: any) => t.status !== 'Rechazado')
                .filter((t: any) => { const dt = new Date(t.createdAt ?? 0); return dt >= start && dt < end; })
                .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
            days.push({ label: start.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }), value: cop });
        }
        return days;
    }, [otcTxs]);

    const monthlyData = useMemo(() => {
        const now = new Date();
        const months: { label: string; value: number }[] = [];
        for (let i = 5; i >= 0; i--) {
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
            const cop = otcTxs
                .filter((t: any) => t.status !== 'Rechazado')
                .filter((t: any) => { const dt = new Date(t.createdAt ?? 0); return dt >= start && dt < end; })
                .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
            months.push({ label: start.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''), value: cop });
        }
        return months;
    }, [otcTxs]);

    return (
        <div className="space-y-10 animate-in fade-in duration-300">
            {/* ── Configuración por cliente ───────────────────────────── */}
            <div className="space-y-6">
                <div>
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                        <ArrowLeftRight size={20} className="text-[#16A34A]" /> OTC · Convertidor Mouv por cliente
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Activa el servicio y define la comisión de cada empresa. El convertidor general (Servicios → Convertir Divisas) usa tasa FastForex y comisión por tramos igual para todos — este OTC usa la tasa Mouv con la comisión negociada por cliente.
                    </p>
                </div>

                <div className="relative max-w-md">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por empresa, correo o ID…" className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#4ADE80]" />
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Empresa</th>
                                <th className="text-center px-4 py-3">Estado OTC</th>
                                <th className="text-right px-4 py-3">Comisión Mouv (%)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((u: any) => {
                                const cfg = otcConfigOf(u);
                                const enabled = cfg.enabled === true;
                                const feePct = cfg.feePct ?? DEFAULT_FEE_PCT;
                                return (
                                    <tr key={u.id} className="border-t border-slate-100">
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-slate-800">{u.name || '—'}</p>
                                            <p className="text-xs text-slate-400">{u.email}</p>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => toggleEnabled(u)}
                                                disabled={savingId === u.id}
                                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 ${enabled ? 'bg-green-50 text-[#16A34A] border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}
                                            >
                                                <Power size={13} /> {enabled ? 'Activo' : 'Inactivo'}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {feeEdit?.userId === u.id ? (
                                                <div className="inline-flex items-center gap-2 bg-white border-2 border-[#4ADE80] rounded-xl pl-3 pr-1.5 py-1 shadow-sm shadow-green-100">
                                                    <input autoFocus type="number" step="0.01" value={feeEdit.value}
                                                        onChange={e => setFeeEdit({ userId: u.id, value: e.target.value })}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveFee(u); if (e.key === 'Escape') setFeeEdit(null); }}
                                                        className="w-14 bg-transparent text-right text-base font-bold text-slate-800 outline-none tabular-nums" />
                                                    <span className="text-sm text-slate-400 font-medium">%</span>
                                                    <div className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-200">
                                                        <button onClick={() => saveFee(u)} disabled={savingId === u.id} className="w-7 h-7 flex items-center justify-center rounded-full bg-[#16A34A] text-white hover:bg-[#0F766E] transition-colors disabled:opacity-50" title="Guardar">
                                                            <Check size={14} />
                                                        </button>
                                                        <button onClick={() => setFeeEdit(null)} className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors" title="Cancelar">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setFeeEdit({ userId: u.id, value: String(feePct) })}
                                                    className="inline-flex items-center gap-2 group"
                                                    title="Click para editar la comisión de esta empresa"
                                                >
                                                    <span className="text-base font-bold text-slate-800 tabular-nums group-hover:text-[#16A34A] transition-colors">{feePct}%</span>
                                                    <span className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 bg-slate-50 group-hover:bg-[#16A34A] group-hover:text-white transition-colors">
                                                        <Pencil size={13} />
                                                    </span>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {filtered.length === 0 && (
                                <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400 text-sm">Sin clientes de empresa.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <p className="text-[11px] text-slate-400">
                    ⚡ Con OTC inactivo, el botón "OTC" del cliente en Servicios muestra un aviso de servicio no habilitado. La comisión aquí es la que ve el cliente en el convertidor Mouv — cada empresa puede tener una distinta.
                </p>
            </div>

            {/* ── Contabilidad ────────────────────────────────────────── */}
            <div className="space-y-6 pt-6 border-t border-slate-200">
                <div>
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                        <Landmark size={20} className="text-[#16A34A]" /> Contabilidad OTC · Canal Mouv
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        USDT recibido y COP acreditado por conversiones OTC, saldo COP de cada cliente, y el historial de movimientos.
                    </p>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <ArrowDownToLine size={14} /> USDT recibido
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">{fmtUsdt(totals.usdt)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">USDT · a la recaudadora</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <ArrowUpFromLine size={14} /> COP enviado
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">${fmtCop(totals.cop)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">COP · acreditado a clientes</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <Users size={14} /> Saldo COP total
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">${fmtCop(totalCopBalance)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Suma de billeteras COP</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <ArrowLeftRight size={14} /> Conversiones
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">{totals.count}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5 flex gap-1.5">
                            <span className="text-green-600 font-bold">{totals.completados} ok</span>
                            <span className="text-amber-600 font-bold">{totals.pendientes} en proceso</span>
                            <span className="text-red-600 font-bold">{totals.rechazados} rechaz.</span>
                        </p>
                    </div>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">COP acreditado · últimos 14 días</p>
                        <MiniBarChart data={dailyData} />
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">COP acreditado · últimos 6 meses</p>
                        <MiniBarChart data={monthlyData} />
                    </div>
                </div>

                {/* Per-client COP balance report */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Saldo COP por cliente</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Empresa</th>
                                <th className="text-right px-4 py-3">Saldo COP actual</th>
                                <th className="text-right px-4 py-3">USDT convertido</th>
                                <th className="text-right px-4 py-3">COP recibido (histórico)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {perUserReport.map(({ user, usdt, cop, count }) => (
                                <tr key={user.id} className="border-t border-slate-100">
                                    <td className="px-4 py-3">
                                        <p className="font-bold text-slate-800">{user.name || '—'}</p>
                                        <p className="text-xs text-slate-400">{user.email}</p>
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">${fmtCop(Number(user.balances?.COP ?? 0))}</td>
                                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{count > 0 ? fmtUsdt(usdt) : '—'}</td>
                                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{count > 0 ? `$${fmtCop(cop)}` : '—'}</td>
                                </tr>
                            ))}
                            {perUserReport.length === 0 && (
                                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">Sin clientes de empresa.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Movements */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Movimientos OTC recientes</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Fecha</th>
                                <th className="text-left px-4 py-3">Cliente</th>
                                <th className="text-right px-4 py-3">USDT</th>
                                <th className="text-right px-4 py-3">COP</th>
                                <th className="text-center px-4 py-3">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {otcTxs.slice(0, 50).map((t: any) => {
                                const u = usersById.get(t.userId);
                                return (
                                    <tr key={t.id} className="border-t border-slate-100">
                                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                                            {t.createdAt ? new Date(t.createdAt).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-slate-800">{u?.name ?? t.userName ?? '—'}</p>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtUsdt(Number(t.usdtOut ?? t.fromAmount ?? 0))}</td>
                                        <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">${fmtCop(Number(t.amount ?? 0))}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusStyle(t.status)}`}>
                                                {t.status === 'Completado' ? 'Completado' : t.status === 'Rechazado' ? 'Rechazado' : 'En proceso'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {otcTxs.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-sm">Sin movimientos OTC todavía.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
