import React, { useEffect, useState, useCallback } from 'react';
import { Building2, RefreshCw, AlertTriangle, Plus, Trash2, X, Pencil, TrendingUp, TrendingDown, Users, PieChart, CalendarDays } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import {
    logAdminAction, PERMISSIONS, hasFullCurrencyAccess, canSeeBankAccount,
    COUNTRY_TO_CURRENCY, type AdminProfile,
} from '../lib/adminAuth';
import { NAVY, EmptyState, formatAmount } from './shared';
import { useToast } from '../lib/toast';
import { useConfirm } from '../lib/useConfirm';

export interface BankAccount {
    id: string;
    country_code: string;
    bank_name: string;
    account_type: string | null;
    account_number: string;
    holder: string | null;
    tax_id: string | null;
    tax_id_label: string | null;
    is_active: boolean;
}

interface Props {
    profile: AdminProfile;
    embedded?: boolean;
}

// 5 países LATAM en los que Lincoin opera + label de documento típico por país
export const COUNTRIES: Array<{
    code: string;        // ISO-2
    name: string;
    flag: string;
    currency: string;
    taxLabel: string;    // ej: NIT, RFC, CPF…
    accountTypes: string[];
}> = [
    { code: 'CO', name: 'Colombia',  flag: '🇨🇴', currency: 'COP', taxLabel: 'NIT',   accountTypes: ['Ahorros', 'Corriente'] },
    { code: 'CL', name: 'Chile',     flag: '🇨🇱', currency: 'CLP', taxLabel: 'RUT',   accountTypes: ['Vista', 'Corriente', 'Ahorro'] },
    { code: 'PE', name: 'Perú',      flag: '🇵🇪', currency: 'PEN', taxLabel: 'RUC',   accountTypes: ['Ahorros', 'Corriente'] },
    { code: 'MX', name: 'México',    flag: '🇲🇽', currency: 'MXN', taxLabel: 'RFC',   accountTypes: ['CLABE', 'Cheques', 'Ahorro'] },
    { code: 'BR', name: 'Brasil',    flag: '🇧🇷', currency: 'BRL', taxLabel: 'CNPJ',  accountTypes: ['Corrente', 'Poupança'] },
];

export const countryByCode = (c: string) => COUNTRIES.find(co => co.code === c);

export interface BankAccountBalance {
    bank_account_id: string;
    currency: string | null;
    confirmed_balance: number;
    pending_in: number;
    pending_out: number;
    pending_count: number;
    completed_count: number;
}

export const BankAccountsSection: React.FC<Props> = ({ profile, embedded = false }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [accountBalances, setAccountBalances] = useState<Record<string, BankAccountBalance>>({});
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<BankAccount | null>(null);
    const [showMovementsFor, setShowMovementsFor] = useState<BankAccount | null>(null);
    const canManage = PERMISSIONS.canManageBankAccounts(profile.role);
    const fullAccess = hasFullCurrencyAccess(profile);

    const load = useCallback(async () => {
        setLoading(true);
        const [accRes, accBalRes] = await Promise.all([
            supabasePersonas
                .from('cuypay_bank_accounts')
                .select('*')
                .order('country_code', { ascending: true }),
            // Vista de balance por cuenta bancaria (migración 2026_balance_per_bank_account.sql)
            supabasePersonas
                .from('bank_account_balances')
                .select('*')
                .then(r => r)
                .catch(() => ({ data: [] } as any)),
        ]);

        // Filtrar cuentas por moneda asignada del admin
        const allAccounts = (accRes.data as BankAccount[]) ?? [];
        const visible = fullAccess
            ? allAccounts
            : allAccounts.filter(a => canSeeBankAccount(profile, a.country_code));
        setAccounts(visible);

        const accBalMap: Record<string, BankAccountBalance> = {};
        for (const b of (accBalRes.data as BankAccountBalance[]) ?? []) {
            accBalMap[b.bank_account_id] = b;
        }
        setAccountBalances(accBalMap);

        setLoading(false);
    }, [profile, fullAccess]);

    useEffect(() => { load(); }, [load]);

    const toggleActive = async (a: BankAccount) => {
        if (!canManage) return;
        await supabasePersonas.from('cuypay_bank_accounts').update({ is_active: !a.is_active }).eq('id', a.id);
        await logAdminAction({
            admin: profile,
            action: a.is_active ? 'bank_account_deactivate' : 'bank_account_activate',
            targetType: 'bank_account',
            targetId: a.id,
            metadata: { bank: a.bank_name, country: a.country_code },
        });
        load();
    };

    const remove = async (a: BankAccount) => {
        if (!canManage) return;
        const ok = await confirm({
            title: 'Eliminar cuenta',
            message: `¿Eliminar la cuenta "${a.bank_name}" (${a.country_code} · ${a.account_number})?`,
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        const { error } = await supabasePersonas.from('cuypay_bank_accounts').delete().eq('id', a.id);
        if (error) {
            await confirm({
                title: 'Error',
                message: 'Error: ' + error.message,
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
            return;
        }
        await logAdminAction({
            admin: profile,
            action: 'bank_account_delete',
            targetType: 'bank_account',
            targetId: a.id,
            metadata: { bank: a.bank_name, country: a.country_code },
        });
        load();
    };

    const onSaved = () => { setShowForm(false); setEditing(null); load(); };

    // Agrupar por país para mostrar como secciones
    const byCountry: Record<string, BankAccount[]> = {};
    for (const a of accounts) {
        (byCountry[a.country_code] ??= []).push(a);
    }

    const content = (
        <>
            {confirmDialog}
            {/* Los saldos agregados por moneda viven en Tesorería → Movimientos
                (treasury_accounts). Aquí solo se gestionan las cuentas. */}

            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <p className="text-sm text-slate-500">
                    {accounts.length} cuenta{accounts.length === 1 ? '' : 's'} configurada{accounts.length === 1 ? '' : 's'}
                    {!fullAccess && profile.assignedCurrency && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">
                            Vista filtrada por {profile.assignedCurrency}
                        </span>
                    )}
                </p>
                <div className="flex items-center gap-2">
                    <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Refrescar">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                    {canManage && (
                        <button
                            onClick={() => { setEditing(null); setShowForm(true); }}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white rounded-lg"
                            style={{ backgroundColor: NAVY }}
                        >
                            <Plus size={14} />
                            Nueva cuenta
                        </button>
                    )}
                </div>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && accounts.length === 0 && (
                <EmptyState
                    icon={AlertTriangle}
                    title="Sin cuentas configuradas"
                    message={canManage
                        ? 'Click en "Nueva cuenta" para agregar la primera (una por país: Colombia, Chile, Perú, México, Brasil)'
                        : 'Pídele a un admin con permisos de tesorería que agregue cuentas'}
                />
            )}

            {/* Lista agrupada por país */}
            <div className="space-y-6">
                {Object.entries(byCountry).map(([code, items]) => {
                    const co = countryByCode(code);
                    return (
                        <div key={code}>
                            <div className="flex items-center gap-2 mb-2 px-1">
                                <span className="text-xl">{co?.flag ?? '🏳️'}</span>
                                <h3 className="font-semibold text-slate-800">{co?.name ?? code}</h3>
                                <span className="text-xs text-slate-500">· {co?.currency ?? ''}</span>
                                <span className="text-xs text-slate-400">· {items.length} cuenta{items.length === 1 ? '' : 's'}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {items.map(a => {
                                    const bal = accountBalances[a.id];
                                    const ccy = COUNTRY_TO_CURRENCY[a.country_code] ?? '';
                                    const confirmed = Number(bal?.confirmed_balance ?? 0);
                                    const pIn = Number(bal?.pending_in ?? 0);
                                    const pOut = Number(bal?.pending_out ?? 0);
                                    const projected = confirmed + pIn - pOut;
                                    return (
                                    <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-start gap-2 min-w-0">
                                                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                                    <Building2 size={16} className="text-slate-600" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-bold text-slate-900 truncate">{a.bank_name}</p>
                                                    <p className="text-xs text-slate-500 mt-0.5">{a.country_code} · {a.account_type ?? 'Cuenta'}</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => toggleActive(a)}
                                                disabled={!canManage}
                                                className="px-2.5 py-1 rounded-full text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
                                                style={{
                                                    backgroundColor: a.is_active ? '#D1FAE5' : '#FEE2E2',
                                                    color: a.is_active ? '#065F46' : '#991B1B',
                                                }}
                                            >
                                                {a.is_active ? 'Activa' : 'Inactiva'}
                                            </button>
                                        </div>
                                        <div className="space-y-1 text-sm">
                                            <div><span className="text-slate-500">Número:</span> <span className="font-mono font-semibold">{a.account_number}</span></div>
                                            {a.holder && <div><span className="text-slate-500">Titular:</span> <span className="font-semibold">{a.holder}</span></div>}
                                            {a.tax_id && <div><span className="text-slate-500">{a.tax_id_label ?? 'Doc'}:</span> <span className="font-mono">{a.tax_id}</span></div>}
                                        </div>

                                        {/* Balance del banco */}
                                        <div className="mt-4 pt-3 border-t border-slate-100 bg-slate-50/50 -mx-5 px-5 -mb-5 pb-4 pt-3 rounded-b-2xl">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Saldo confirmado</p>
                                                {bal?.completed_count ? (
                                                    <span className="text-[10px] text-slate-500">{bal.completed_count} TX</span>
                                                ) : null}
                                            </div>
                                            <p className="text-xl font-bold font-mono" style={{ color: NAVY }}>
                                                {formatAmount(confirmed, ccy)}
                                            </p>

                                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                                <div>
                                                    <div className="flex items-center gap-1 text-emerald-700">
                                                        <TrendingUp size={11} />
                                                        <span className="font-semibold">Ingresos pendientes</span>
                                                    </div>
                                                    <p className="font-mono mt-0.5">{formatAmount(pIn, ccy)}</p>
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-1 text-red-700">
                                                        <TrendingDown size={11} />
                                                        <span className="font-semibold">Salidas pendientes</span>
                                                    </div>
                                                    <p className="font-mono mt-0.5">{formatAmount(pOut, ccy)}</p>
                                                </div>
                                            </div>

                                            <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between">
                                                <span className="text-xs text-slate-500">Proyectado</span>
                                                <span className="text-sm font-mono font-bold" style={{ color: NAVY }}>{formatAmount(projected, ccy)}</span>
                                            </div>

                                            {bal?.pending_count ? (
                                                <button
                                                    onClick={() => setShowMovementsFor(a)}
                                                    className="mt-2 w-full text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg py-1.5 transition-colors"
                                                >
                                                    Ver {bal.pending_count} TX pendiente{bal.pending_count === 1 ? '' : 's'} →
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => setShowMovementsFor(a)}
                                                    className="mt-2 w-full text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg py-1.5 transition-colors"
                                                >
                                                    Ver movimientos →
                                                </button>
                                            )}
                                        </div>

                                        {canManage && (
                                            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => { setEditing(a); setShowForm(true); }}
                                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                                                >
                                                    <Pencil size={12} /> Editar
                                                </button>
                                                <button
                                                    onClick={() => remove(a)}
                                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg"
                                                >
                                                    <Trash2 size={12} /> Eliminar
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {showForm && (
                <BankAccountFormModal
                    profile={profile}
                    initial={editing}
                    onClose={() => { setShowForm(false); setEditing(null); }}
                    onSaved={onSaved}
                />
            )}

            {showMovementsFor && (
                <BankMovementsDrawer
                    account={showMovementsFor}
                    onClose={() => setShowMovementsFor(null)}
                />
            )}
        </>
    );

    if (embedded) return <div>{content}</div>;

    return (
        <div className="p-4 md:p-8">
            <div className="mb-4">
                <h1 className="text-xl md:text-2xl font-bold leading-tight" style={{ color: NAVY }}>Cuentas bancarias Lincoin</h1>
                <p className="text-slate-500 text-xs md:text-sm mt-1">Cuentas donde los usuarios depositan (una o más por país)</p>
            </div>
            {content}
        </div>
    );
};

// ─────────────────────────────────────────────
// Modal: crear / editar una cuenta bancaria
// ─────────────────────────────────────────────
export const BankAccountFormModal: React.FC<{
    profile: AdminProfile;
    initial: BankAccount | null;
    defaultCountry?: string | null;
    onClose: () => void;
    onSaved: () => void;
}> = ({ profile, initial, defaultCountry, onClose, onSaved }) => {
    const toast = useToast();
    const isEdit = !!initial;
    const [country, setCountry] = useState(initial?.country_code ?? defaultCountry ?? 'CO');
    const [bankName, setBankName] = useState(initial?.bank_name ?? '');
    const [accountType, setAccountType] = useState(initial?.account_type ?? '');
    const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? '');
    const [holder, setHolder] = useState(initial?.holder ?? '');
    const [taxId, setTaxId] = useState(initial?.tax_id ?? '');
    const [isActive, setIsActive] = useState(initial?.is_active ?? true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const co = countryByCode(country);

    // Si cambia el país, sugerimos un account type del catálogo
    useEffect(() => {
        if (!isEdit && co && !co.accountTypes.includes(accountType)) {
            setAccountType(co.accountTypes[0] ?? '');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [country]);

    const save = async () => {
        setErr(null);
        if (!bankName.trim()) { setErr('Falta el nombre del banco'); return; }
        if (!accountNumber.trim()) { setErr('Falta el número de cuenta'); return; }
        setSaving(true);
        const payload = {
            country_code: country,
            bank_name: bankName.trim(),
            account_type: accountType || null,
            account_number: accountNumber.trim(),
            holder: holder.trim() || null,
            tax_id: taxId.trim() || null,
            tax_id_label: co?.taxLabel ?? null,
            is_active: isActive,
        };
        try {
            if (isEdit && initial) {
                const { error } = await supabasePersonas.from('cuypay_bank_accounts').update(payload).eq('id', initial.id);
                if (error) throw error;
                await logAdminAction({
                    admin: profile, action: 'bank_account_update',
                    targetType: 'bank_account', targetId: initial.id,
                    metadata: { bank: payload.bank_name, country: payload.country_code },
                });
            } else {
                const { data, error } = await supabasePersonas.from('cuypay_bank_accounts').insert(payload).select().single();
                if (error) throw error;
                await logAdminAction({
                    admin: profile, action: 'bank_account_create',
                    targetType: 'bank_account', targetId: (data as any)?.id ?? '',
                    metadata: { bank: payload.bank_name, country: payload.country_code },
                });
            }
            toast.success(`✓ Cuenta "${payload.bank_name}" ${isEdit ? 'actualizada' : 'creada'}`);
            onSaved();
        } catch (e: any) {
            setErr(e?.message ?? 'Error guardando');
            toast.error('No se pudo guardar la cuenta');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                    <div>
                        <h3 className="font-bold text-lg" style={{ color: NAVY }}>
                            {isEdit ? 'Editar cuenta' : 'Nueva cuenta bancaria'}
                        </h3>
                        <p className="text-xs text-slate-500">Cuenta donde los usuarios cargan saldo en {co?.name ?? country}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4">
                    <FormRow label="País">
                        <div className="grid grid-cols-5 gap-2">
                            {COUNTRIES.map(c => (
                                <button
                                    key={c.code}
                                    onClick={() => setCountry(c.code)}
                                    type="button"
                                    className={`p-3 rounded-lg border-2 transition-colors flex flex-col items-center gap-0.5 ${
                                        country === c.code
                                            ? 'border-slate-900 bg-slate-50'
                                            : 'border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    <span className="text-xl leading-none">{c.flag}</span>
                                    <span className="text-[10px] font-semibold text-slate-600">{c.currency}</span>
                                </button>
                            ))}
                        </div>
                    </FormRow>

                    <FormRow label="Banco">
                        <input
                            value={bankName}
                            onChange={e => setBankName(e.target.value)}
                            placeholder={co?.code === 'CO' ? 'Ej: Bancolombia' : co?.code === 'BR' ? 'Ej: Itaú' : 'Ej: Banco …'}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-green-500 outline-none"
                        />
                    </FormRow>

                    <div className="grid grid-cols-2 gap-3">
                        <FormRow label="Tipo de cuenta">
                            <select
                                value={accountType ?? ''}
                                onChange={e => setAccountType(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-green-500 outline-none bg-white"
                            >
                                <option value="">—</option>
                                {(co?.accountTypes ?? []).map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </FormRow>
                        <FormRow label="Número de cuenta">
                            <input
                                value={accountNumber}
                                onChange={e => setAccountNumber(e.target.value.replace(/[^0-9-]/g, ''))}
                                placeholder="1234567890"
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono focus:border-green-500 outline-none"
                            />
                        </FormRow>
                    </div>

                    <FormRow label="Titular (nombre o razón social)">
                        <input
                            value={holder}
                            onChange={e => setHolder(e.target.value)}
                            placeholder="Lincoin S.A.S"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-green-500 outline-none"
                        />
                    </FormRow>

                    <FormRow label={`Documento del titular (${co?.taxLabel ?? 'Doc'})`}>
                        <input
                            value={taxId}
                            onChange={e => setTaxId(e.target.value)}
                            placeholder={co?.taxLabel ?? ''}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono focus:border-green-500 outline-none"
                        />
                    </FormRow>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isActive}
                            onChange={e => setIsActive(e.target.checked)}
                            className="w-4 h-4 rounded"
                        />
                        <span className="text-sm text-slate-700">Cuenta activa (visible a los usuarios al cargar saldo)</span>
                    </label>

                    {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{err}</p>}
                </div>

                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 sticky bottom-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button
                        onClick={save}
                        disabled={saving}
                        style={{ backgroundColor: NAVY }}
                        className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
                    >
                        {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear cuenta'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const FormRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">{label}</label>
        {children}
    </div>
);

// ─────────────────────────────────────────────
// Drawer: movimientos de una cuenta bancaria específica
// ─────────────────────────────────────────────
interface BankMovement {
    id: string;
    kind: string;
    status: string;
    amount: number;
    currency: string;
    created_at: string;
    bank_account_id: string | null;
    raw_data: any;
}

// Filtros de período rápidos del drawer de movimientos
type PeriodFilter = 'all' | 'today' | '7d' | 'month' | 'custom';

const ownerIdOf = (m: any): string | null =>
    m?.user_id ?? m?.owner_user_id ?? m?.sender_id ?? m?.from_user_id ?? null;

export const BankMovementsDrawer: React.FC<{
    account: BankAccount;
    onClose: () => void;
}> = ({ account, onClose }) => {
    const [movements, setMovements] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
    const [period, setPeriod] = useState<PeriodFilter>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    // Nombres de usuarios (dueños de movimientos y de billeteras)
    const [usersById, setUsersById] = useState<Record<string, any>>({});
    // Propiedad del saldo: billeteras de usuarios en la moneda de la cuenta
    const [custody, setCustody] = useState<Array<{ ownerId: string; balance: number }>>([]);
    const ccy = COUNTRY_TO_CURRENCY[account.country_code] ?? '';

    useEffect(() => {
        (async () => {
            setLoading(true);
            // select('*') a propósito: la columna del dueño varía por entorno
            // (user_id / owner_user_id / sender_id) y así no rompemos el query.
            const direct = await supabasePersonas
                .from('transactions')
                .select('*')
                .eq('bank_account_id', account.id)
                .order('created_at', { ascending: false })
                .limit(300);

            // Fallback: TX sin bank_account_id pero con bank_name en raw_data
            // y misma moneda que la cuenta
            const fallback = await supabasePersonas
                .from('transactions')
                .select('*')
                .is('bank_account_id', null)
                .eq('currency', ccy)
                .order('created_at', { ascending: false })
                .limit(500);

            const all = [...(direct.data ?? []), ...((fallback.data ?? []) as any[]).filter((t: any) => {
                const b = String(t.raw_data?.bank_name ?? t.raw_data?.bank ?? '').toLowerCase();
                return b === account.bank_name.toLowerCase();
            })];

            const seen = new Set<string>();
            const dedup = all.filter(t => {
                if (seen.has(t.id)) return false;
                seen.add(t.id);
                return true;
            });
            setMovements(dedup);

            // ── Propiedad del saldo: billeteras de usuarios en esta moneda ──
            let w = await supabasePersonas
                .from('wallets')
                .select('owner_user_id, balance, currency')
                .eq('currency', ccy);
            if (w.error && /owner_user_id/i.test(w.error.message)) {
                w = await supabasePersonas
                    .from('wallets')
                    .select('user_id, balance, currency')
                    .eq('currency', ccy) as any;
            }
            const byOwner: Record<string, number> = {};
            for (const row of ((w.data as any[]) ?? [])) {
                const oid = row.owner_user_id ?? row.user_id;
                if (!oid) continue;
                byOwner[oid] = (byOwner[oid] ?? 0) + (Number(row.balance) || 0);
            }
            const custodyList = Object.entries(byOwner)
                .map(([ownerId, balance]) => ({ ownerId, balance }))
                .sort((a, b) => b.balance - a.balance);
            setCustody(custodyList);

            // Hidratar nombres (dueños de billeteras + de movimientos)
            const ids = Array.from(new Set([
                ...custodyList.map(c => c.ownerId),
                ...dedup.map(ownerIdOf).filter(Boolean) as string[],
            ]));
            if (ids.length > 0) {
                const { data: us } = await supabasePersonas
                    .from('users')
                    .select('id, email, full_name, cuypay_id')
                    .in('id', ids.slice(0, 300));
                const map: Record<string, any> = {};
                for (const u of (us ?? []) as any[]) map[u.id] = u;
                setUsersById(map);
            }

            setLoading(false);
        })();
    }, [account.id, account.bank_name, ccy]);

    // ── Filtro por estado ──
    const statusOk = (m: any) => {
        if (filter === 'all') return true;
        const s = String(m.status ?? '').toLowerCase();
        if (filter === 'pending') return s === 'pending' || s === 'pendiente';
        return ['completed','approved','aprobada','completado','aprobado','sent','success'].includes(s);
    };

    // ── Filtro por período ──
    const periodOk = (m: any) => {
        const d = new Date(m.created_at);
        const now = new Date();
        if (period === 'today') {
            return d.toDateString() === now.toDateString();
        }
        if (period === '7d') {
            return d.getTime() >= now.getTime() - 7 * 24 * 3600 * 1000;
        }
        if (period === 'month') {
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        }
        if (period === 'custom') {
            if (dateFrom && d < new Date(dateFrom + 'T00:00:00')) return false;
            if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
            return true;
        }
        return true;
    };

    const filtered = movements.filter(m => statusOk(m) && periodOk(m));

    const totalIn  = filtered.filter(m => m.kind === 'load').reduce((s, m) => s + Number(m.amount || 0), 0);
    const totalOut = filtered.filter(m => m.kind === 'send').reduce((s, m) => s + Number(m.amount || 0), 0);

    // ── Agrupar por día (más reciente primero) ──
    const byDay: Array<{ day: string; label: string; items: any[]; in: number; out: number }> = [];
    for (const m of filtered) {
        const d = new Date(m.created_at);
        const day = d.toISOString().slice(0, 10);
        let g = byDay.find(x => x.day === day);
        if (!g) {
            g = {
                day,
                label: d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                items: [], in: 0, out: 0,
            };
            byDay.push(g);
        }
        g.items.push(m);
        if (m.kind === 'load') g.in += Number(m.amount || 0);
        if (m.kind === 'send') g.out += Number(m.amount || 0);
    }

    // ── Propiedad del saldo ──
    const custodyTotal = custody.reduce((s, c) => s + c.balance, 0);
    // Saldo de la cuenta por transacciones completadas (todas, sin filtros)
    const isDone = (m: any) => ['completed','approved','aprobada','completado','aprobado','sent','success']
        .includes(String(m.status ?? '').toLowerCase());
    const acctBalance = movements.filter(isDone).reduce((s, m) =>
        s + (m.kind === 'load' ? Number(m.amount || 0) : m.kind === 'send' ? -Number(m.amount || 0) : 0), 0);
    const houseBalance = acctBalance - custodyTotal; // comisiones / capital propio (estimado)
    const nameOf = (id: string) =>
        usersById[id]?.full_name ?? usersById[id]?.email ?? usersById[id]?.cuypay_id ?? `${id.slice(0, 8)}…`;
    const TOP_N = 12;
    const custodyTop = custody.filter(c => c.balance > 0).slice(0, TOP_N);
    const custodyRest = custody.filter(c => c.balance > 0).slice(TOP_N);
    const custodyRestSum = custodyRest.reduce((s, c) => s + c.balance, 0);

    const periodChips: Array<{ id: PeriodFilter; label: string }> = [
        { id: 'all',    label: 'Todo' },
        { id: 'today',  label: 'Hoy' },
        { id: '7d',     label: '7 días' },
        { id: 'month',  label: 'Este mes' },
        { id: 'custom', label: 'Rango' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
            {/* Header — pantalla completa */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-slate-100">
                    <Building2 size={20} color={NAVY} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Movimientos · {ccy}</p>
                    <p className="font-bold text-lg truncate" style={{ color: NAVY }}>{account.bank_name}</p>
                    <p className="text-xs text-slate-500 font-mono">{account.account_number}</p>
                </div>
                <div className="hidden md:flex items-center gap-6 mr-4">
                    <div className="text-right">
                        <p className="text-[10px] uppercase text-slate-500 font-semibold">Entradas (in)</p>
                        <p className="text-lg font-bold font-mono text-emerald-700">{formatAmount(totalIn, ccy)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] uppercase text-slate-500 font-semibold">Salidas (out)</p>
                        <p className="text-lg font-bold font-mono text-red-700">{formatAmount(totalOut, ccy)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] uppercase text-slate-500 font-semibold">Saldo (completadas)</p>
                        <p className="text-lg font-bold font-mono" style={{ color: NAVY }}>{formatAmount(acctBalance, ccy)}</p>
                    </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
                    <X size={18} className="text-slate-500" />
                </button>
            </div>

            {/* Filtros */}
            <div className="px-6 py-2.5 flex items-center gap-2 border-b border-slate-100 flex-wrap">
                {(['all','pending','completed'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className="px-3 py-1 rounded-lg text-xs font-semibold"
                        style={{
                            backgroundColor: filter === f ? NAVY : 'white',
                            color: filter === f ? 'white' : '#475569',
                            border: '1px solid #E2E8F0',
                        }}
                    >
                        {f === 'all' ? 'Todas' : f === 'pending' ? 'Pendientes' : 'Completadas'}
                    </button>
                ))}
                <span className="w-px h-5 bg-slate-200 mx-1" />
                <CalendarDays size={14} className="text-slate-400" />
                {periodChips.map(p => (
                    <button
                        key={p.id}
                        onClick={() => setPeriod(p.id)}
                        className="px-3 py-1 rounded-lg text-xs font-semibold"
                        style={{
                            backgroundColor: period === p.id ? '#16A34A' : 'white',
                            color: period === p.id ? 'white' : '#475569',
                            border: '1px solid #E2E8F0',
                        }}
                    >
                        {p.label}
                    </button>
                ))}
                {period === 'custom' && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={e => setDateFrom(e.target.value)}
                            className="px-2 py-1 rounded-lg border border-slate-200 text-xs"
                        />
                        <span>→</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={e => setDateTo(e.target.value)}
                            className="px-2 py-1 rounded-lg border border-slate-200 text-xs"
                        />
                    </div>
                )}
            </div>

            {/* Cuerpo: propiedad del saldo (izq) + movimientos por día (der) */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[380px_1fr]">
                {/* ── ¿De quién es el dinero? ── */}
                <div className="overflow-auto border-r border-slate-100 bg-slate-50 p-5 space-y-3">
                    <div className="flex items-center gap-2">
                        <PieChart size={15} className="text-slate-500" />
                        <p className="text-sm font-bold" style={{ color: NAVY }}>¿De quién es el dinero?</p>
                    </div>
                    <p className="text-xs text-slate-500">
                        Desglose del saldo en {ccy}: cuánto pertenece a los usuarios (sus billeteras)
                        y cuánto es de Lincoin (comisiones / capital propio).
                    </p>

                    <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-1">
                        <Row label={`Saldo por transacciones`} value={formatAmount(acctBalance, ccy)} bold navy />
                        <Row label={`En billeteras de usuarios (${custody.filter(c => c.balance > 0).length})`} value={formatAmount(custodyTotal, ccy)} />
                        <Row
                            label={houseBalance >= 0 ? 'Lincoin · comisiones / capital' : 'Descalce (billeteras > banco)'}
                            value={formatAmount(houseBalance, ccy)}
                            tone={houseBalance >= 0 ? 'emerald' : 'red'}
                        />
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                        <Users size={13} className="text-slate-500" />
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Por usuario</p>
                    </div>
                    {custodyTop.length === 0 && (
                        <p className="text-xs text-slate-400">Ningún usuario tiene saldo en {ccy}.</p>
                    )}
                    <div className="space-y-1.5">
                        {custodyTop.map(c => {
                            const pct = custodyTotal > 0 ? (c.balance / custodyTotal) * 100 : 0;
                            return (
                                <div key={c.ownerId} className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-xs font-semibold truncate" style={{ color: NAVY }}>{nameOf(c.ownerId)}</p>
                                        <p className="text-xs font-mono font-bold shrink-0" style={{ color: NAVY }}>
                                            {formatAmount(c.balance, ccy)}
                                        </p>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: '#4ADE80' }} />
                                        </div>
                                        <span className="text-[10px] text-slate-500 w-10 text-right">{pct.toFixed(1)}%</span>
                                    </div>
                                </div>
                            );
                        })}
                        {custodyRest.length > 0 && (
                            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 flex items-center justify-between">
                                <p className="text-xs text-slate-500">Otros ({custodyRest.length} usuarios)</p>
                                <p className="text-xs font-mono font-bold text-slate-600">{formatAmount(custodyRestSum, ccy)}</p>
                            </div>
                        )}
                    </div>
                    <p className="text-[10px] text-slate-400 pt-1">
                        * Billeteras {ccy} de todos los usuarios vs. el saldo por transacciones de esta cuenta.
                        Si Lincoin opera con varias cuentas en {ccy}, el desglose es global de la moneda.
                    </p>
                </div>

                {/* ── Movimientos agrupados por día ── */}
                <div className="overflow-auto">
                    {loading && <p className="p-6 text-slate-400">Cargando movimientos...</p>}
                    {!loading && filtered.length === 0 && (
                        <p className="p-6 text-slate-400 text-center">Sin movimientos para este filtro</p>
                    )}
                    {byDay.map(g => (
                        <div key={g.day}>
                            <div className="sticky top-0 px-6 py-2 bg-slate-100/95 backdrop-blur flex items-center justify-between gap-3 border-y border-slate-200">
                                <p className="text-xs font-bold capitalize" style={{ color: NAVY }}>{g.label}</p>
                                <p className="text-[11px] font-mono text-slate-600">
                                    {g.in > 0 && <span className="text-emerald-700">+{formatAmount(g.in, ccy)}</span>}
                                    {g.in > 0 && g.out > 0 && ' · '}
                                    {g.out > 0 && <span className="text-red-700">-{formatAmount(g.out, ccy)}</span>}
                                </p>
                            </div>
                            {g.items.map(m => {
                                const isIn = m.kind === 'load';
                                const oid = ownerIdOf(m);
                                return (
                                    <div key={m.id} className="px-6 py-3 border-b border-slate-100 flex items-center gap-3 hover:bg-slate-50">
                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isIn ? 'bg-emerald-50' : 'bg-red-50'}`}>
                                            {isIn ? <TrendingUp size={16} className="text-emerald-700" /> : <TrendingDown size={16} className="text-red-700" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold capitalize" style={{ color: NAVY }}>
                                                {m.kind === 'load' ? 'Carga' : m.kind === 'send' ? 'Pago' : m.kind}
                                                {oid && (
                                                    <span className="font-normal text-slate-500"> · {nameOf(oid)}</span>
                                                )}
                                            </p>
                                            <p className="text-xs text-slate-500">{new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className={`text-sm font-bold font-mono ${isIn ? 'text-emerald-700' : 'text-red-700'}`}>
                                                {isIn ? '+' : '-'} {formatAmount(m.amount, m.currency)}
                                            </p>
                                            <p className="text-[10px] uppercase text-slate-500 font-semibold mt-0.5">{m.status}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// Fila compacta label/valor del panel de propiedad
const Row: React.FC<{ label: string; value: string; bold?: boolean; navy?: boolean; tone?: 'emerald' | 'red' }> = ({ label, value, bold, navy, tone }) => (
    <div className="flex items-center justify-between gap-2 py-0.5">
        <p className={`text-xs ${bold ? 'font-bold' : ''} text-slate-600`}>{label}</p>
        <p
            className={`text-xs font-mono ${bold ? 'font-bold text-sm' : 'font-semibold'} ${
                tone === 'emerald' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : ''
            }`}
            style={!tone && navy ? { color: NAVY } : undefined}
        >
            {value}
        </p>
    </div>
);
