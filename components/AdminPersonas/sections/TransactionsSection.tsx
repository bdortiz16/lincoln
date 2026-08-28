import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertCircle, Shield, BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import {
    PERMISSIONS, hasFullCurrencyAccess, canSeeTransaction,
    type AdminProfile,
} from '../lib/adminAuth';
import { TxDetailDrawer } from './TxDetailDrawer';
import { NAVY, StatusBadge, formatDate, formatAmount } from './shared';

// ─────────────────────────────────────────────
// Normalización de transacciones
// ─────────────────────────────────────────────
// La tabla `transactions` ha pasado por varios esquemas:
//  - Legacy (Empresas inicial):     amount, currency, status='Pendiente', raw_data jsonb
//  - Nuevo (Admin Personas F2-F6):  from_amount, from_currency, to_amount, to_currency,
//                                    bank_name, account_number, status='pending', approved_*
// Esta función lee cualquiera de los dos y devuelve un shape unificado para la UI.

export interface TxRow {
    id: string;
    user_id: string | null;
    type: string;
    statusKey: 'pending' | 'approved' | 'rejected' | 'completed' | 'other';
    statusRaw: string | null;
    from_amount: number | null;
    from_currency: string | null;
    to_amount: number | null;
    to_currency: string | null;
    bank_name: string | null;
    account_number: string | null;
    receipt_url: string | null;
    created_at: string;
    raw: any;                  // fila completa para el drawer
}

const normalizeStatus = (s: string | null | undefined): TxRow['statusKey'] => {
    if (!s) return 'pending';
    const v = s.toLowerCase();
    if (v === 'pending' || v === 'pendiente' || v === 'pending_review') return 'pending';
    if (v === 'approved' || v === 'aprobada' || v === 'aprobado') return 'approved';
    if (v === 'rejected' || v === 'rechazada' || v === 'rechazado') return 'rejected';
    if (v === 'completed' || v === 'completada' || v === 'completado') return 'completed';
    return 'other';
};

const pick = <T,>(...vals: (T | null | undefined)[]): T | null => {
    for (const v of vals) if (v !== null && v !== undefined && v !== '') return v;
    return null;
};

// ─────────────────────────────────────────────
// Update status: prueba varios candidatos hasta acertar con
// el CHECK constraint que la tabla tenga configurado.
// La app Android puede aceptar 'approved' o 'completed' o 'Aprobada' etc.
// ─────────────────────────────────────────────
const STATUS_CANDIDATES = {
    approved: ['approved', 'completed', 'success', 'confirmed', 'Aprobada', 'Aprobado', 'Completado', 'Completada'],
    rejected: ['rejected', 'cancelled', 'canceled', 'failed', 'denied', 'Rechazada', 'Rechazado'],
} as const;

export async function tryUpdateTxStatus(
    txId: string,
    decision: 'approved' | 'rejected',
    adminId: string,
): Promise<{ ok: true; appliedStatus: string } | { ok: false; error: string }> {
    const candidates = STATUS_CANDIDATES[decision];
    let lastErr = '';
    for (const status of candidates) {
        // Intento 1: con approved_by + approved_at
        const fullPayload: Record<string, any> = { status, approved_by: adminId, approved_at: new Date().toISOString() };
        const r1 = await supabasePersonas.from('transactions').update(fullPayload).eq('id', txId);
        if (!r1.error) return { ok: true, appliedStatus: status };

        // Intento 2: si la columna approved_by/approved_at no existe, reintentar solo con status
        if (/approved_by|approved_at|column .* does not exist/i.test(r1.error.message)) {
            const r2 = await supabasePersonas.from('transactions').update({ status }).eq('id', txId);
            if (!r2.error) return { ok: true, appliedStatus: status };
            lastErr = r2.error.message;
            // si tampoco fue un check_constraint, parar
            if (!/check constraint|status_check/i.test(r2.error.message)) {
                return { ok: false, error: r2.error.message };
            }
            continue;
        }

        // Si fue un CHECK constraint del status → probar siguiente candidato
        if (/check constraint|status_check/i.test(r1.error.message)) {
            lastErr = r1.error.message;
            continue;
        }

        // Cualquier otro error → fallar inmediatamente
        return { ok: false, error: r1.error.message };
    }
    return { ok: false, error: lastErr || 'Ningún valor de status fue aceptado por el CHECK constraint' };
}

export const normalizeTx = (row: any): TxRow => {
    const rd = row?.raw_data ?? {};
    return {
        id: String(row.id),
        // CuyPayANDROID usa `owner_user_id`; legacy usa `user_id`
        user_id: pick<string>(row.owner_user_id, row.user_id, rd.owner_user_id, rd.user_id),
        // CuyPayANDROID usa `kind` (load/send/swap/etc); legacy usa `type`
        type: pick<string>(row.kind, row.type, rd.kind, rd.type) ?? 'transferencia',
        statusKey: normalizeStatus(row.status),
        statusRaw: row.status ?? null,
        from_amount: pick<number>(row.from_amount, row.amount, rd.from_amount, rd.amount),
        from_currency: pick<string>(row.from_currency, row.currency, rd.from_currency, rd.currency),
        to_amount: pick<number>(row.to_amount, rd.to_amount),
        to_currency: pick<string>(row.to_currency, rd.to_currency),
        bank_name: pick<string>(row.bank_name, rd.bank_name, rd.bank, rd.bankName),
        account_number: pick<string>(row.account_number, rd.account_number, rd.account, rd.accountNumber),
        receipt_url: pick<string>(row.receipt_url, rd.receipt_url, rd.receiptUrl),
        created_at: row.created_at,
        raw: row,
    };
};

// ─────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────
interface Props {
    profile: AdminProfile;
    /** Si es true, no envuelve en p-4/p-8 (porque se renderiza dentro de un tab) */
    embedded?: boolean;
}

export const TransactionsSection: React.FC<Props> = ({ profile, embedded = false }) => {
    const [allTxs, setAllTxs] = useState<TxRow[]>([]);
    const [loading, setLoading] = useState(true);
    // Vista interna: resumen (dashboard) / cargues (load) / envíos (send)
    const [view, setView] = useState<'dashboard' | 'load' | 'send'>('dashboard');
    // Default a "Pendientes" — el operador entra a ver lo que necesita aprobar
    const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'completed'>('pending');
    const [detailTxId, setDetailTxId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Filtros adicionales para la tabla (Cargues / Envíos)
    const [search, setSearch] = useState('');
    const [currencyFilter, setCurrencyFilter] = useState<'all' | string>('all');
    const [missingAccountOnly, setMissingAccountOnly] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [minAmount, setMinAmount] = useState('');
    // Map id → datos básicos del usuario, para resolver t.user_id → nombre/email/CuyPay ID
    // en la tabla de Cargues/Envíos sin hacer un JOIN por fila.
    const [userMap, setUserMap] = useState<Map<string, { full_name: string | null; email: string | null; cuypay_id: string | null }>>(new Map());

    const canApprove = PERMISSIONS.canApproveTx(profile.role);

    const [zeroRowsWarn, setZeroRowsWarn] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        setZeroRowsWarn(false);
        // Cargamos en paralelo transacciones + lista mínima de usuarios para
        // poder mostrar 'quién hizo' cada cargue/envío sin un JOIN por fila.
        const [txRes, usersRes] = await Promise.all([
            supabasePersonas
                .from('transactions')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .limit(500),
            supabasePersonas
                .from('users')
                .select('id, full_name, email, cuypay_id')
                .limit(2000),
        ]);

        // Map de usuarios (sigue funcionando aunque la query falle).
        const m = new Map<string, { full_name: string | null; email: string | null; cuypay_id: string | null }>();
        for (const u of ((usersRes.data as any[]) ?? [])) {
            m.set(u.id, { full_name: u.full_name ?? null, email: u.email ?? null, cuypay_id: u.cuypay_id ?? null });
        }
        setUserMap(m);

        if (txRes.error) {
            console.error('[TransactionsSection] load error:', txRes.error);
            setError(txRes.error.message);
            setAllTxs([]);
        } else {
            const all = (txRes.data as any[]).map(normalizeTx);
            const inScope = hasFullCurrencyAccess(profile)
                ? all
                : all.filter(t => canSeeTransaction(profile, {
                    from_currency: t.from_currency,
                    to_currency: t.to_currency,
                    currency: t.from_currency,
                }));
            setAllTxs(inScope);
            if (txRes.count === 0 || all.length === 0) setZeroRowsWarn(true);
        }
        setLoading(false);
    }, [profile]);

    useEffect(() => { load(); }, [load]);

    // Realtime: si hay un INSERT mientras la pantalla está abierta, recargar
    useEffect(() => {
        const channel = supabasePersonas
            .channel('admin-transactions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
                load();
            })
            .subscribe();
        return () => { supabasePersonas.removeChannel(channel); };
    }, [load]);

    // Clasificación de kind: load = carga de saldo, send = pago/envío
    const isLoad = (t: TxRow) => {
        const k = (t.raw?.kind ?? t.type ?? '').toLowerCase();
        return k === 'load' || k === 'carga' || k === 'deposit' || k === 'topup' || k === 'recarga';
    };
    const isSend = (t: TxRow) => {
        const k = (t.raw?.kind ?? t.type ?? '').toLowerCase();
        return k === 'send' || k === 'envio' || k === 'envío' || k === 'pago' || k === 'payment' || k === 'withdraw' || k === 'retiro';
    };

    // Lista de la vista actual (load/send) + filtro de estado + filtros extra
    const dateFromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const dateToTs   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : null;
    const minAmtNum  = minAmount.trim() ? Number(minAmount.replace(/[^\d.]/g, '')) : null;
    const searchQ    = search.trim().toLowerCase();

    const viewTxs = allTxs
        .filter(t => view === 'load' ? isLoad(t) : view === 'send' ? isSend(t) : true)
        .filter(t => filter === 'all' ? true : t.statusKey === filter)
        .filter(t => currencyFilter === 'all' ? true : (t.from_currency ?? '').toUpperCase() === currencyFilter)
        .filter(t => !missingAccountOnly || !t.bank_name)
        .filter(t => {
            if (dateFromTs == null && dateToTs == null) return true;
            const ts = new Date(t.created_at).getTime();
            if (dateFromTs != null && ts < dateFromTs) return false;
            if (dateToTs   != null && ts > dateToTs)   return false;
            return true;
        })
        .filter(t => minAmtNum == null || Number.isNaN(minAmtNum) || (Number(t.from_amount ?? 0) >= minAmtNum))
        .filter(t => {
            if (!searchQ) return true;
            const u = t.user_id ? userMap.get(t.user_id) : null;
            const hay = [
                t.id, t.user_id, u?.full_name, u?.email, u?.cuypay_id,
                t.bank_name, t.account_number, t.from_currency, t.to_currency,
            ].filter(Boolean).map(x => String(x).toLowerCase());
            return hay.some(h => h.includes(searchQ));
        });

    // Lista de monedas que aparecen en la vista actual, para el dropdown
    const availableCurrencies = Array.from(new Set(
        allTxs
            .filter(t => view === 'load' ? isLoad(t) : view === 'send' ? isSend(t) : true)
            .map(t => (t.from_currency ?? '').toUpperCase())
            .filter(Boolean)
    )).sort();

    const filtersActive =
        search.trim() !== '' ||
        currencyFilter !== 'all' ||
        missingAccountOnly ||
        dateFrom !== '' || dateTo !== '' ||
        minAmount.trim() !== '';

    const clearFilters = () => {
        setSearch(''); setCurrencyFilter('all'); setMissingAccountOnly(false);
        setDateFrom(''); setDateTo(''); setMinAmount('');
    };

    const content = (
        <>
            {/* Sub-navegación: Resumen / Cargues / Envíos */}
            <div className="flex gap-2 mb-5 flex-wrap items-center">
                {([
                    { id: 'dashboard', label: 'Resumen', icon: BarChart3 },
                    { id: 'load',      label: 'Cargues', icon: TrendingUp },
                    { id: 'send',      label: 'Envíos',  icon: TrendingDown },
                ] as const).map(v => {
                    const Icon = v.icon;
                    const active = view === v.id;
                    return (
                        <button
                            key={v.id}
                            onClick={() => setView(v.id)}
                            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
                            style={{
                                backgroundColor: active ? NAVY : 'white',
                                color: active ? 'white' : '#334155',
                                border: '1px solid #E2E8F0',
                            }}
                        >
                            <Icon size={15} />
                            {v.label}
                        </button>
                    );
                })}
                {canApprove && (
                    <span
                        className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200"
                        title="Aprobar/rechazar requiere código 2FA"
                    >
                        <Shield size={12} />
                        2FA al aprobar
                    </span>
                )}
                <button onClick={load} className={canApprove ? "p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" : "ml-auto p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"} title="Refrescar">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-sm text-red-800">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold">Error consultando transacciones</p>
                        <p className="text-xs font-mono mt-0.5 break-all">{error}</p>
                    </div>
                </div>
            )}

            {/* VISTA: RESUMEN (dashboard interno) */}
            {view === 'dashboard' && !error && (
                <TxDashboard txs={allTxs} isLoad={isLoad} isSend={isSend} onGoToView={setView} />
            )}

            {/* VISTA: CARGUES / ENVÍOS (tabla con filtro de estado) */}
            {view !== 'dashboard' && (
                <>
                    <div className="flex gap-2 mb-3 flex-wrap items-center">
                        {(['all', 'pending', 'approved', 'rejected', 'completed'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                style={{
                                    backgroundColor: filter === f ? NAVY : 'white',
                                    color: filter === f ? 'white' : '#475569',
                                    border: '1px solid #E2E8F0',
                                }}
                            >
                                {f === 'all' ? 'Todas' : f === 'pending' ? 'Pendientes' : f === 'approved' ? 'Aprobadas' : f === 'rejected' ? 'Rechazadas' : 'Completadas'}
                            </button>
                        ))}
                    </div>

                    {/* Toolbar de filtros: search + moneda + sin-cuenta + rango fechas + monto mínimo */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                            {/* Search (span 4) */}
                            <div className="md:col-span-4">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Buscar</label>
                                <input
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Nombre, email, CuyPayID, banco, número de cuenta…"
                                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                                />
                            </div>
                            {/* Moneda */}
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Moneda</label>
                                <select
                                    value={currencyFilter}
                                    onChange={e => setCurrencyFilter(e.target.value)}
                                    className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs bg-white"
                                >
                                    <option value="all">Todas</option>
                                    {availableCurrencies.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                            {/* Rango fechas */}
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Desde</label>
                                <input
                                    type="date" value={dateFrom}
                                    onChange={e => setDateFrom(e.target.value)}
                                    className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Hasta</label>
                                <input
                                    type="date" value={dateTo}
                                    onChange={e => setDateTo(e.target.value)}
                                    className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs"
                                />
                            </div>
                            {/* Monto mínimo */}
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Monto ≥</label>
                                <input
                                    value={minAmount}
                                    onChange={e => setMinAmount(e.target.value)}
                                    placeholder="1000000"
                                    inputMode="numeric"
                                    className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-mono"
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={missingAccountOnly}
                                    onChange={e => setMissingAccountOnly(e.target.checked)}
                                />
                                Solo <span className="text-amber-700 font-semibold">sin cuenta asignada</span>
                            </label>
                            <div className="flex items-center gap-2 ml-auto">
                                <span className="text-xs text-slate-500">
                                    Mostrando <b className="text-slate-900">{viewTxs.length}</b>
                                </span>
                                {filtersActive && (
                                    <button
                                        onClick={clearFilters}
                                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100"
                                    >
                                        Limpiar filtros
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                                    <tr>
                                        <th className="text-left px-4 py-3">Tipo</th>
                                        <th className="text-left px-4 py-3">Usuario</th>
                                        <th className="text-left px-4 py-3">Monto</th>
                                        <th className="text-left px-4 py-3">Banco / Cuenta</th>
                                        <th className="text-left px-4 py-3">Estado</th>
                                        <th className="text-left px-4 py-3">Fecha</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Cargando...</td></tr>}
                                    {!loading && viewTxs.length === 0 && !error && (
                                        <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                                            Sin {view === 'load' ? 'cargues' : 'envíos'} {filter !== 'all' && `con estado "${filter}"`}
                                        </td></tr>
                                    )}
                                    {viewTxs.map(t => {
                                        const u = t.user_id ? userMap.get(t.user_id) : null;
                                        return (
                                        <tr
                                            key={t.id}
                                            onClick={() => setDetailTxId(t.id)}
                                            className="border-t border-slate-100 hover:bg-teal-50/50 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-3 font-medium text-slate-900 capitalize align-top">{t.type}</td>
                                            <td className="px-4 py-3 align-top">
                                                {u ? (
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-slate-900 truncate">{u.full_name ?? '—'}</div>
                                                        <div className="text-xs text-slate-500 truncate">{u.email ?? '—'}</div>
                                                        <div className="text-[10px] text-slate-400 font-mono truncate">{u.cuypay_id ?? (t.user_id ? `${t.user_id.slice(0, 8)}…` : '—')}</div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-slate-400 font-mono">
                                                        {t.user_id ? `${t.user_id.slice(0, 8)}…` : '—'}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-mono align-top">
                                                {formatAmount(t.from_amount, t.from_currency)}
                                                {t.to_currency && t.to_currency !== t.from_currency && (
                                                    <span className="text-slate-400"> → {formatAmount(t.to_amount, t.to_currency)}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 text-xs">
                                                {t.bank_name ? (
                                                    <>
                                                        <div className="font-semibold text-slate-800">{t.bank_name}</div>
                                                        <div className="font-mono">{t.account_number ?? ''}</div>
                                                    </>
                                                ) : (
                                                    <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5 text-[11px]">
                                                        Sin cuenta asignada
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 align-top"><StatusBadge status={t.statusKey === 'other' ? t.statusRaw : t.statusKey} /></td>
                                            <td className="px-4 py-3 text-slate-500 text-xs align-top">{formatDate(t.created_at)}</td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {detailTxId && (
                <TxDetailDrawer
                    txId={detailTxId}
                    profile={profile}
                    onClose={() => setDetailTxId(null)}
                    onUpdated={load}
                />
            )}
        </>
    );

    if (embedded) return <div>{content}</div>;

    return (
        <div className="p-4 md:p-8">
            <div className="mb-4">
                <h1 className="text-xl md:text-2xl font-bold leading-tight" style={{ color: NAVY }}>Transacciones</h1>
                <p className="text-slate-500 text-xs md:text-sm mt-1">
                    {canApprove ? 'Aprueba o rechaza operaciones pendientes' : 'Solo lectura'}
                </p>
            </div>
            {content}
        </div>
    );
};

// ─────────────────────────────────────────────
// Dashboard interno de Transacciones
// KPIs separados por Cargues (load) y Envíos (send)
// ─────────────────────────────────────────────
const TxDashboard: React.FC<{
    txs: TxRow[];
    isLoad: (t: TxRow) => boolean;
    isSend: (t: TxRow) => boolean;
    onGoToView: (v: 'load' | 'send') => void;
}> = ({ txs, isLoad, isSend, onGoToView }) => {
    const loads = txs.filter(isLoad);
    const sends = txs.filter(isSend);

    const sumBy = (list: TxRow[], statusKey?: TxRow['statusKey']) =>
        list
            .filter(t => !statusKey || t.statusKey === statusKey)
            .reduce((s, t) => s + (Number(t.from_amount) || 0), 0);

    const countBy = (list: TxRow[], statusKey: TxRow['statusKey']) =>
        list.filter(t => t.statusKey === statusKey).length;

    // Agrupar montos por moneda (para mostrar multi-divisa)
    const byCurrency = (list: TxRow[], statusKey?: TxRow['statusKey']) => {
        const m: Record<string, number> = {};
        for (const t of list) {
            if (statusKey && t.statusKey !== statusKey) continue;
            const c = t.from_currency ?? '—';
            m[c] = (m[c] ?? 0) + (Number(t.from_amount) || 0);
        }
        return m;
    };

    const Money: React.FC<{ map: Record<string, number> }> = ({ map }) => {
        const entries = Object.entries(map).filter(([, v]) => v > 0);
        if (entries.length === 0) return <span className="text-slate-400">—</span>;
        return (
            <div className="space-y-0.5">
                {entries.map(([c, v]) => (
                    <div key={c} className="font-mono text-sm font-bold" style={{ color: NAVY }}>
                        {formatAmount(v, c)}
                    </div>
                ))}
            </div>
        );
    };

    const Panel: React.FC<{
        title: string;
        icon: any;
        accent: string;
        list: TxRow[];
        onClick: () => void;
    }> = ({ title, icon: Icon, accent, list, onClick }) => {
        const pending = countBy(list, 'pending');
        return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accent}22` }}>
                            <Icon size={18} style={{ color: accent }} />
                        </div>
                        <div>
                            <p className="font-bold" style={{ color: NAVY }}>{title}</p>
                            <p className="text-xs text-slate-500">{list.length} operaciones</p>
                        </div>
                    </div>
                    {pending > 0 && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                            {pending} pendiente{pending === 1 ? '' : 's'}
                        </span>
                    )}
                </div>
                <div className="p-5 grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Completado</p>
                        <Money map={byCurrency(list, 'completed')} />
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Pendiente</p>
                        <Money map={byCurrency(list, 'pending')} />
                    </div>
                </div>
                <button
                    onClick={onClick}
                    className="w-full px-5 py-3 border-t border-slate-100 text-sm font-semibold text-left hover:bg-slate-50 transition-colors flex items-center justify-between"
                    style={{ color: accent }}
                >
                    Ver detalle de {title.toLowerCase()}
                    <span>→</span>
                </button>
            </div>
        );
    };

    const totalPendingCount = countBy(loads, 'pending') + countBy(sends, 'pending');

    return (
        <div className="space-y-5">
            {/* Banner resumen */}
            <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, #1e3a5f)` }}>
                <p className="text-xs uppercase tracking-wider opacity-70 font-semibold">Operaciones totales</p>
                <p className="text-3xl font-bold mt-1">{txs.length}</p>
                <div className="mt-3 flex items-center gap-4 text-sm">
                    <span className="opacity-90">{loads.length} cargues</span>
                    <span className="opacity-50">·</span>
                    <span className="opacity-90">{sends.length} envíos</span>
                    {totalPendingCount > 0 && (
                        <>
                            <span className="opacity-50">·</span>
                            <span className="px-2 py-0.5 rounded-full bg-amber-400/90 text-amber-950 font-bold text-xs">
                                {totalPendingCount} por aprobar
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Cargues vs Envíos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Panel title="Cargues" icon={TrendingUp} accent="#059669" list={loads} onClick={() => onGoToView('load')} />
                <Panel title="Envíos" icon={TrendingDown} accent="#DC2626" list={sends} onClick={() => onGoToView('send')} />
            </div>
        </div>
    );
};
