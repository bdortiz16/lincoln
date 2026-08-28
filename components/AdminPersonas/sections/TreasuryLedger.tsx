import React, { useEffect, useState, useCallback } from 'react';
import {
    Building2, Coins, Plus, X, RefreshCw, ChevronDown, Trash2,
    TrendingUp, TrendingDown, ArrowLeftRight, Pencil, AlertCircle, Receipt,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import {
    logAdminAction, PERMISSIONS, hasFullCurrencyAccess, canSeeBankAccount,
    COUNTRY_TO_CURRENCY, type AdminProfile,
} from '../lib/adminAuth';
import { NAVY, TEAL, formatAmount } from './shared';
import { useToast } from '../lib/toast';
import { useConfirm } from '../lib/useConfirm';
import {
    BankAccountFormModal, BankMovementsDrawer, countryByCode,
    type BankAccount, type BankAccountBalance,
} from './BankAccountsSection';

interface TreasuryAccount {
    id: string;
    name: string;
    type: 'bank' | 'crypto';
    currency: string;
    country_code: string | null;
    exchange: string | null;
    balance: number;
    is_active: boolean;
    is_profit?: boolean;
    is_treasury?: boolean;
}

interface Movement {
    id: string;
    kind: string;
    from_account_id: string | null;
    to_account_id: string | null;
    from_amount: number;
    to_amount: number;
    from_currency: string | null;
    to_currency: string | null;
    exchange_rate: number | null;
    fee_amount: number;
    tax_amount: number;
    notes: string | null;
    created_at: string;
}

const COUNTRY_NAMES: Record<string, string> = {
    CO: '🇨🇴 Colombia', CL: '🇨🇱 Chile', PE: '🇵🇪 Perú', MX: '🇲🇽 México', BR: '🇧🇷 Brasil',
};
const KIND_LABELS: Record<string, string> = {
    internal_transfer: 'Transferencia interna',
    fx_buy_usdt: 'Compra USDT',
    fx_sell_usdt: 'Venta USDT',
    client_load: 'Cargue de cliente',
    client_payout: 'Pago a cliente',
    adjustment: 'Ajuste manual',
    expense: 'Gasto',
    profit: 'Utilidad',
    capital_in: 'Aporte / Capital',
};

const CAPITAL_CATEGORIES = [
    'Capital propio',
    'Préstamo de socio',
    'Reintegro',
    'Devolución de proveedor',
    'Otro ingreso',
];

const EXPENSE_CATEGORIES = [
    'Comisión bancaria',
    'Impuesto',
    'Cuota de manejo',
    'Comisión de exchange',
    'Retención',
    'Otro gasto',
];

type ActionType = 'internal_transfer' | 'fx_buy_usdt' | 'fx_sell_usdt' | 'capital_in' | 'expense' | 'profit' | null;

export const TreasuryLedger: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
    const [movements, setMovements] = useState<Movement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [action, setAction] = useState<ActionType>(null);
    const canManage = PERMISSIONS.canManageBankAccounts(profile.role);
    const fullAccess = hasFullCurrencyAccess(profile);

    // Cuentas bancarias reales (las que usa la app) + su saldo por transacciones
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [bankBalances, setBankBalances] = useState<Record<string, BankAccountBalance>>({});
    const [expanded, setExpanded] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<BankAccount | null>(null);
    const [formCountry, setFormCountry] = useState<string | null>(null);
    const [movementsFor, setMovementsFor] = useState<BankAccount | null>(null);

    // Pasivos por moneda = pagos pendientes a clientes (transactions kind=send pending)
    const [pendingPayouts, setPendingPayouts] = useState<Record<string, number>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const [accRes, movRes, balRes, bankRes, bankBalRes] = await Promise.all([
            supabasePersonas.from('treasury_accounts').select('*').order('type').order('currency'),
            supabasePersonas.from('treasury_movements').select('*').order('created_at', { ascending: false }).limit(100),
            // currency_balances trae pending_out = pagos pendientes por moneda
            supabasePersonas.from('currency_balances').select('currency, pending_out').then(r => r).catch(() => ({ data: [] } as any)),
            supabasePersonas.from('cuypay_bank_accounts').select('*').order('country_code', { ascending: true }).then(r => r).catch(() => ({ data: [] } as any)),
            supabasePersonas.from('bank_account_balances').select('*').then(r => r).catch(() => ({ data: [] } as any)),
        ]);
        if (accRes.error) {
            setError(/does not exist|relation/i.test(accRes.error.message)
                ? 'Faltan las tablas de tesorería. Corre la migración 2026_treasury_ledger.sql en Supabase.'
                : accRes.error.message);
            setAccounts([]);
        } else {
            setAccounts((accRes.data as TreasuryAccount[]) ?? []);
        }
        setMovements((movRes.data as Movement[]) ?? []);
        const pp: Record<string, number> = {};
        for (const r of (balRes.data as any[]) ?? []) pp[r.currency] = Number(r.pending_out) || 0;
        setPendingPayouts(pp);

        const allBanks = (bankRes.data as BankAccount[]) ?? [];
        setBankAccounts(fullAccess ? allBanks : allBanks.filter(a => canSeeBankAccount(profile, a.country_code)));
        const bbMap: Record<string, BankAccountBalance> = {};
        for (const b of (bankBalRes.data as BankAccountBalance[]) ?? []) bbMap[b.bank_account_id] = b;
        setBankBalances(bbMap);
        setLoading(false);
    }, [profile, fullAccess]);

    useEffect(() => { load(); }, [load]);

    const toggleActive = async (a: BankAccount) => {
        if (!canManage) return;
        await supabasePersonas.from('cuypay_bank_accounts').update({ is_active: !a.is_active }).eq('id', a.id);
        await logAdminAction({
            admin: profile, action: a.is_active ? 'bank_account_deactivate' : 'bank_account_activate',
            targetType: 'bank_account', targetId: a.id, metadata: { bank: a.bank_name, country: a.country_code },
        });
        toast.success(`✓ ${a.bank_name} ${a.is_active ? 'desactivada' : 'activada'}`);
        load();
    };

    const removeBank = async (a: BankAccount) => {
        if (!canManage) return;
        const ok = await confirm({
            title: 'Eliminar cuenta',
            message: `¿Eliminar la cuenta "${a.bank_name}" (${a.country_code} · ${a.account_number})?`,
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        const { error } = await supabasePersonas.from('cuypay_bank_accounts').delete().eq('id', a.id);
        if (error) { toast.error('No se pudo eliminar: ' + error.message); return; }
        await logAdminAction({
            admin: profile, action: 'bank_account_delete',
            targetType: 'bank_account', targetId: a.id, metadata: { bank: a.bank_name, country: a.country_code },
        });
        toast.success(`✓ Cuenta "${a.bank_name}" eliminada`);
        load();
    };

    const openNew = (country: string | null) => { setEditing(null); setFormCountry(country); setShowForm(true); };
    const openEdit = (a: BankAccount) => { setEditing(a); setFormCountry(a.country_code); setShowForm(true); };

    const accountName = (id: string | null) => accounts.find(a => a.id === id)?.name ?? '—';

    // Totales por país (bancos) + cripto (USDT operativo, Tesorería, Utilidades).
    const byCountry: Record<string, { currency: string; total: number; accounts: TreasuryAccount[] }> = {};
    const profitWallets = accounts.filter(a => a.is_profit);
    const treasuryWallets = accounts.filter(a => a.is_treasury && !a.is_profit);
    const usdtWallets = accounts.filter(a => a.type === 'crypto' && !a.is_profit && !a.is_treasury);
    for (const a of accounts.filter(x => x.type === 'bank' && !x.is_profit && !x.is_treasury)) {
        const k = a.country_code ?? '—';
        (byCountry[k] ??= { currency: a.currency, total: 0, accounts: [] });
        byCountry[k].total += Number(a.balance) || 0;
        byCountry[k].accounts.push(a);
    }
    const usdtTotal = usdtWallets.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const treasuryTotal = treasuryWallets.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const profitTotal = profitWallets.reduce((s, a) => s + (Number(a.balance) || 0), 0);

    // Cuentas bancarias reales agrupadas por país (las que usa la app)
    const bankByCountry: Record<string, BankAccount[]> = {};
    for (const a of bankAccounts) (bankByCountry[a.country_code] ??= []).push(a);

    // Lista unificada de países = los que tienen saldo en el libro o cuentas configuradas
    const countryCodes = Array.from(new Set([...Object.keys(byCountry), ...Object.keys(bankByCountry)]))
        .filter(c => c && c !== '—')
        .sort();

    // Liquidez: saldo real en tesorería por moneda vs pagos pendientes
    const treasuryByCurrency: Record<string, number> = {};
    for (const a of accounts.filter(x => !x.is_profit)) {
        treasuryByCurrency[a.currency] = (treasuryByCurrency[a.currency] ?? 0) + (Number(a.balance) || 0);
    }
    const liquidityAlerts = Object.entries(pendingPayouts)
        .filter(([ccy, pending]) => pending > 0 && (treasuryByCurrency[ccy] ?? 0) < pending)
        .map(([ccy, pending]) => ({ currency: ccy, available: treasuryByCurrency[ccy] ?? 0, pending, deficit: pending - (treasuryByCurrency[ccy] ?? 0) }));

    return (
        <div className="space-y-6">
            {confirmDialog}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h3 className="text-lg font-bold" style={{ color: NAVY }}>Libro de tesorería</h3>
                    <p className="text-xs text-slate-500">Saldos por cuenta + movimientos contables (transferencias, compra/venta USDT)</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Refrescar">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                    {canManage && (
                        <>
                            <ActionButton label="Transferir" icon={ArrowLeftRight} onClick={() => setAction('internal_transfer')} />
                            <ActionButton label="Comprar USDT" icon={TrendingDown} onClick={() => setAction('fx_buy_usdt')} />
                            <ActionButton label="Vender USDT" icon={TrendingUp} onClick={() => setAction('fx_sell_usdt')} />
                            <ActionButton label="Gastos" icon={Receipt} onClick={() => setAction('expense')} />
                            <ActionButton label="Utilidad" icon={Coins} onClick={() => setAction('profit')} />
                            <ActionButton label="Aporte" icon={Plus} onClick={() => setAction('capital_in')} />
                            <button onClick={() => openNew(null)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: NAVY }}>
                                <Plus size={14} /> Nueva cuenta
                            </button>
                        </>
                    )}
                </div>
            </div>

            {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-sm text-red-800">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <p>{error}</p>
                </div>
            )}

            {/* Alerta de liquidez: pagos pendientes que superan el saldo disponible */}
            {liquidityAlerts.length > 0 && (
                <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertCircle size={18} className="text-red-600" />
                        <p className="font-bold text-red-800">Liquidez insuficiente</p>
                    </div>
                    <div className="space-y-2">
                        {liquidityAlerts.map(a => (
                            <div key={a.currency} className="flex items-center justify-between flex-wrap gap-2 text-sm bg-white rounded-lg p-3 border border-red-100">
                                <div>
                                    <span className="font-bold" style={{ color: NAVY }}>{a.currency}</span>
                                    <span className="text-slate-600"> · pagos pendientes {formatAmount(a.pending, a.currency)} · disponible {formatAmount(a.available, a.currency)}</span>
                                </div>
                                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">
                                    Faltan {formatAmount(a.deficit, a.currency)}
                                </span>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-red-700 mt-2">
                        Para fondear: usá COP de otro cliente (cruce) o comprá USDT con otra moneda y vendelo a {liquidityAlerts[0]?.currency}.
                    </p>
                </div>
            )}

            {/* Billeteras por país (expandibles) — dentro están las cuentas bancarias */}
            <div className="space-y-3">
                {countryCodes.map(code => {
                    const led = byCountry[code];
                    const co = countryByCode(code);
                    const ccy = led?.currency ?? COUNTRY_TO_CURRENCY[code] ?? '';
                    const ledgerTotal = led?.total ?? 0;
                    const banks = bankByCountry[code] ?? [];
                    const isOpen = expanded === code;
                    return (
                        <div key={code} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <button
                                onClick={() => setExpanded(isOpen ? null : code)}
                                className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors text-left"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${TEAL}22` }}>
                                        <Building2 size={18} color={NAVY} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-900 flex items-center gap-2">
                                            <span className="text-lg leading-none">{co?.flag ?? '🏳️'}</span>
                                            {co?.name ?? COUNTRY_NAMES[code] ?? code}
                                            <span className="text-xs font-normal text-slate-400">· {ccy}</span>
                                        </p>
                                        <p className="text-[11px] text-slate-400 mt-0.5">{banks.length} cuenta{banks.length === 1 ? '' : 's'} bancaria{banks.length === 1 ? '' : 's'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Saldo en libro</p>
                                        <p className="text-xl font-bold font-mono" style={{ color: NAVY }}>{formatAmount(ledgerTotal, ccy)}</p>
                                    </div>
                                    <ChevronDown size={18} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                </div>
                            </button>

                            {isOpen && (
                                <div className="border-t border-slate-100 p-4 bg-slate-50/40">
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cuentas bancarias</p>
                                        {canManage && (
                                            <button onClick={() => openNew(code)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: NAVY }}>
                                                <Plus size={12} /> Nueva cuenta
                                            </button>
                                        )}
                                    </div>
                                    {banks.length === 0 ? (
                                        <p className="text-sm text-slate-400 italic py-3 text-center">Sin cuentas bancarias en {co?.name ?? code}. {canManage && 'Agregá la primera.'}</p>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {banks.map(a => (
                                                <BankAccountCard
                                                    key={a.id}
                                                    account={a}
                                                    balance={bankBalances[a.id]}
                                                    ccy={ccy}
                                                    canManage={canManage}
                                                    onToggle={() => toggleActive(a)}
                                                    onEdit={() => openEdit(a)}
                                                    onDelete={() => removeBank(a)}
                                                    onMovements={() => setMovementsFor(a)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* USDT operativo (exchanges) */}
                {usdtWallets.length > 0 && (
                    <CryptoAccordion
                        title="USDT (operativo · exchanges)"
                        subtitle={`${usdtWallets.length} wallet${usdtWallets.length === 1 ? '' : 's'}`}
                        total={usdtTotal}
                        currency="USDT"
                        accent="teal"
                        wallets={usdtWallets}
                        isOpen={expanded === '__usdt__'}
                        onToggle={() => setExpanded(expanded === '__usdt__' ? null : '__usdt__')}
                    />
                )}

                {/* Tesorería (USDT principal — reserva) */}
                {treasuryWallets.length > 0 && (
                    <CryptoAccordion
                        title="Tesorería"
                        subtitle="reserva principal en USDT"
                        total={treasuryTotal}
                        currency="USDT"
                        accent="slate"
                        wallets={treasuryWallets}
                        isOpen={expanded === '__treasury__'}
                        onToggle={() => setExpanded(expanded === '__treasury__' ? null : '__treasury__')}
                    />
                )}

                {/* Utilidades (ganancia acumulada) */}
                {profitWallets.length > 0 && (
                    <CryptoAccordion
                        title="Utilidades"
                        subtitle="ganancia acumulada"
                        total={profitTotal}
                        currency={profitWallets[0]?.currency ?? 'USDT'}
                        accent="amber"
                        wallets={profitWallets}
                        isOpen={expanded === '__profit__'}
                        onToggle={() => setExpanded(expanded === '__profit__' ? null : '__profit__')}
                    />
                )}
            </div>

            {/* Libro de movimientos */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">Movimientos recientes</h4>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Tipo</th>
                                <th className="text-left px-4 py-3">Origen → Destino</th>
                                <th className="text-right px-4 py-3">Sale</th>
                                <th className="text-right px-4 py-3">Entra</th>
                                <th className="text-right px-4 py-3">Fee / Imp.</th>
                                <th className="text-left px-4 py-3">Fecha</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Cargando...</td></tr>}
                            {!loading && movements.length === 0 && !error && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Sin movimientos registrados</td></tr>
                            )}
                            {movements.map(m => (
                                <tr key={m.id} className="border-t border-slate-100">
                                    <td className="px-4 py-3 font-medium text-slate-800">{KIND_LABELS[m.kind] ?? m.kind}</td>
                                    <td className="px-4 py-3 text-slate-600 text-xs">
                                        {m.kind === 'expense' ? (
                                            <span>{accountName(m.from_account_id)} <span className="text-slate-400">·</span> {m.notes ?? 'Gasto'}</span>
                                        ) : (
                                            <span>{accountName(m.from_account_id)} <span className="text-slate-400">→</span> {accountName(m.to_account_id)}</span>
                                        )}
                                        {m.exchange_rate ? <div className="text-[10px] text-slate-400">tasa {Number(m.exchange_rate).toLocaleString('en-US', { maximumFractionDigits: 6 })}</div> : null}
                                        {m.kind !== 'expense' && m.notes ? <div className="text-[10px] text-slate-400 truncate max-w-[240px]">{m.notes}</div> : null}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-red-700">{m.from_amount ? `- ${formatAmount(m.from_amount, m.from_currency)}` : '—'}</td>
                                    <td className="px-4 py-3 text-right font-mono text-emerald-700">{m.to_amount ? `+ ${formatAmount(m.to_amount, m.to_currency)}` : '—'}</td>
                                    <td className="px-4 py-3 text-right text-xs text-slate-500">
                                        {m.fee_amount ? `fee ${formatAmount(m.fee_amount, m.from_currency)}` : ''}
                                        {m.tax_amount ? <div>imp {formatAmount(m.tax_amount, m.from_currency)}</div> : null}
                                        {!m.fee_amount && !m.tax_amount ? '—' : ''}
                                    </td>
                                    <td className="px-4 py-3 text-slate-500 text-xs">{new Date(m.created_at).toLocaleString('es-CO')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {action && (
                <MovementModal
                    action={action}
                    accounts={accounts}
                    profile={profile}
                    onClose={() => setAction(null)}
                    onDone={() => { setAction(null); load(); }}
                />
            )}

            {showForm && (
                <BankAccountFormModal
                    profile={profile}
                    initial={editing}
                    defaultCountry={formCountry}
                    onClose={() => { setShowForm(false); setEditing(null); }}
                    onSaved={() => { setShowForm(false); setEditing(null); load(); }}
                />
            )}

            {movementsFor && (
                <BankMovementsDrawer account={movementsFor} onClose={() => setMovementsFor(null)} />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Acordeón consistente para billeteras cripto/utilidad/tesorería
// (mismo cuadrado que los acordeones de país)
// ─────────────────────────────────────────────
const CryptoAccordion: React.FC<{
    title: string;
    subtitle: string;
    total: number;
    currency: string;
    accent: 'teal' | 'slate' | 'amber';
    wallets: TreasuryAccount[];
    isOpen: boolean;
    onToggle: () => void;
}> = ({ title, subtitle, total, currency, accent, wallets, isOpen, onToggle }) => {
    const accentMap = {
        teal:  { bg: 'bg-teal-100',  text: 'text-teal-700',  border: 'border-teal-200' },
        slate: { bg: 'bg-slate-200', text: 'text-slate-800', border: 'border-slate-300' },
        amber: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
    } as const;
    const a = accentMap[accent];
    return (
        <div className={`bg-white rounded-2xl border-2 ${a.border} shadow-sm overflow-hidden`}>
            <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${a.bg}`}>
                        <Coins size={18} className={a.text} />
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold text-slate-900">{title}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Saldo</p>
                        <p className={`text-xl font-bold font-mono ${a.text}`}>{formatAmount(total, currency)}</p>
                    </div>
                    <ChevronDown size={18} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
            </button>
            {isOpen && (
                <div className="border-t border-slate-100 p-4 bg-slate-50/40">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Wallets</p>
                    <div className="space-y-1.5">
                        {wallets.map(w => (
                            <div key={w.id} className="flex justify-between items-center bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
                                <div className="min-w-0">
                                    <p className="font-semibold text-slate-800 truncate">{w.exchange ?? w.name}</p>
                                    {w.exchange && w.exchange !== w.name && <p className="text-[10px] text-slate-400 truncate">{w.name}</p>}
                                </div>
                                <span className={`font-mono font-bold ${a.text}`}>{formatAmount(w.balance, w.currency)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Tarjeta de una cuenta bancaria dentro de la billetera
// ─────────────────────────────────────────────
const BankAccountCard: React.FC<{
    account: BankAccount;
    balance?: BankAccountBalance;
    ccy: string;
    canManage: boolean;
    onToggle: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onMovements: () => void;
}> = ({ account: a, balance: bal, ccy, canManage, onToggle, onEdit, onDelete, onMovements }) => {
    const confirmed = Number(bal?.confirmed_balance ?? 0);
    const pIn = Number(bal?.pending_in ?? 0);
    const pOut = Number(bal?.pending_out ?? 0);
    const projected = confirmed + pIn - pOut;
    return (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Building2 size={16} className="text-slate-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold text-slate-900 truncate">{a.bank_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{a.account_type ?? 'Cuenta'} · {a.account_number}</p>
                        {a.holder && <p className="text-[11px] text-slate-400 truncate">{a.holder}</p>}
                    </div>
                </div>
                <button
                    onClick={onToggle}
                    disabled={!canManage}
                    className="px-2.5 py-1 rounded-full text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
                    style={{ backgroundColor: a.is_active ? '#D1FAE5' : '#FEE2E2', color: a.is_active ? '#065F46' : '#991B1B' }}
                >
                    {a.is_active ? 'Activa' : 'Inactiva'}
                </button>
            </div>

            <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Saldo por transacciones</p>
                    {bal?.completed_count ? <span className="text-[10px] text-slate-500">{bal.completed_count} TX</span> : null}
                </div>
                <p className="text-lg font-bold font-mono" style={{ color: NAVY }}>{formatAmount(confirmed, ccy)}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                        <div className="flex items-center gap-1 text-emerald-700"><TrendingUp size={11} /><span className="font-semibold">Pend. in</span></div>
                        <p className="font-mono mt-0.5">{formatAmount(pIn, ccy)}</p>
                    </div>
                    <div>
                        <div className="flex items-center gap-1 text-red-700"><TrendingDown size={11} /><span className="font-semibold">Pend. out</span></div>
                        <p className="font-mono mt-0.5">{formatAmount(pOut, ccy)}</p>
                    </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Proyectado</span>
                    <span className="text-sm font-mono font-bold" style={{ color: NAVY }}>{formatAmount(projected, ccy)}</span>
                </div>
                <button onClick={onMovements} className="mt-2 w-full text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg py-1.5 transition-colors">
                    {bal?.pending_count ? `Ver ${bal.pending_count} TX pendiente${bal.pending_count === 1 ? '' : 's'} →` : 'Ver movimientos →'}
                </button>
            </div>

            {canManage && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end gap-1">
                    <button onClick={onEdit} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
                        <Pencil size={12} /> Editar
                    </button>
                    <button onClick={onDelete} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 size={12} /> Eliminar
                    </button>
                </div>
            )}
        </div>
    );
};

const ActionButton: React.FC<{ label: string; icon: any; onClick: () => void }> = ({ label, icon: Icon, onClick }) => (
    <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50">
        <Icon size={14} /> {label}
    </button>
);

// ─────────────────────────────────────────────
// Modal de movimiento
// ─────────────────────────────────────────────
const MovementModal: React.FC<{
    action: Exclude<ActionType, null>;
    accounts: TreasuryAccount[];
    profile: AdminProfile;
    onClose: () => void;
    onDone: () => void;
}> = ({ action, accounts, profile, onClose, onDone }) => {
    const toast = useToast();
    const [fromId, setFromId] = useState('');
    const [toId, setToId] = useState('');
    const [fromAmount, setFromAmount] = useState('');
    const [toAmount, setToAmount] = useState('');
    const [fee, setFee] = useState('');
    const [tax, setTax] = useState('');
    const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const profitWallets = accounts.filter(a => a.is_profit && a.is_active);
    const banks = accounts.filter(a => a.type === 'bank' && a.is_active && !a.is_profit);
    const cryptos = accounts.filter(a => a.type === 'crypto' && a.is_active && !a.is_profit);

    const fromAcc = accounts.find(a => a.id === fromId);
    const toAcc = accounts.find(a => a.id === toId);

    const isFx = action === 'fx_buy_usdt' || action === 'fx_sell_usdt';
    const isTransfer = action === 'internal_transfer';
    const isExpense = action === 'expense';
    const isProfit = action === 'profit';
    const isCapital = action === 'capital_in';
    // "Otro …" en gasto/aporte → obligar a describir en notas
    const isOtherCategory = (isExpense || isCapital) && /^otro/i.test(category);
    // Utilidad cross-moneda: el origen no está en la misma moneda que la billetera de utilidades
    const profitCross = isProfit && fromAcc && toAcc && fromAcc.currency !== toAcc.currency;
    // ¿Mostrar el campo "monto que entra"? FX siempre; utilidad solo si cambia de moneda
    const showToAmount = isFx || profitCross;
    const needsDest = isFx || isTransfer || isProfit || isCapital;
    // Capital_in: NO hay cuenta origen (el dinero viene de afuera del libro)
    const skipOrigin = isCapital;

    // Qué cuentas mostrar según la acción
    let fromOptions: TreasuryAccount[];
    let toOptions: TreasuryAccount[];
    if (isTransfer) {
        fromOptions = banks;
        toOptions = fromAcc ? banks.filter(a => a.currency === fromAcc.currency && a.id !== fromAcc.id) : [];
    } else if (action === 'fx_buy_usdt') {
        fromOptions = banks; toOptions = cryptos;
    } else if (action === 'fx_sell_usdt') {
        fromOptions = cryptos; toOptions = banks;
    } else if (isProfit) {
        fromOptions = banks.concat(cryptos);  // de cualquier cuenta operativa
        toOptions = profitWallets;            // a la billetera de utilidades
    } else if (isCapital) {
        // Aporte: no hay origen (viene de afuera); destino = cualquier cuenta activa
        fromOptions = [];
        toOptions = banks.concat(cryptos);
    } else { // expense → cualquier cuenta como origen, sin destino
        fromOptions = banks.concat(cryptos).concat(profitWallets);
        toOptions = banks.concat(cryptos);
    }

    const titles: Record<string, string> = {
        internal_transfer: 'Transferencia interna (misma moneda)',
        fx_buy_usdt: 'Comprar USDT (moneda local → USDT)',
        fx_sell_usdt: 'Vender USDT (USDT → moneda local)',
        capital_in: 'Registrar aporte (capital propio, préstamo, reintegro)',
        expense: 'Registrar gasto',
        profit: 'Registrar utilidad',
    };

    const rate = (() => {
        const f = Number(fromAmount), t = Number(toAmount);
        if (showToAmount && f > 0 && t > 0) return t / f;
        return null;
    })();

    const save = async () => {
        setErr(null);
        const fa = Number(fromAmount);
        if (fa <= 0) { setErr('Falta el monto'); return; }
        if (!skipOrigin && !fromId) { setErr('Falta la cuenta origen'); return; }
        if (needsDest && !toId) { setErr('Falta la cuenta destino'); return; }
        // Si la categoría es "Otro …", obligar a describir en notas para que
        // no queden registros opacos en el libro.
        if ((isExpense || isCapital) && /^otro/i.test(category) && !notes.trim()) {
            setErr(`Describí qué tipo de ${isCapital ? 'aporte' : 'gasto'} es (campo Notas) — la categoría "Otro" requiere detalle.`);
            return;
        }

        // Monto que entra al destino:
        //  - transferencia interna / utilidad misma moneda / aporte: igual al monto ingresado
        //  - FX / utilidad cross-moneda: lo que tipeás en "monto que entra"
        //  - gasto: no hay destino
        let ta = 0;
        if (isTransfer) ta = fa;
        else if (showToAmount) ta = Number(toAmount);
        else if (isProfit) ta = fa; // misma moneda
        else if (isCapital) ta = fa;

        // Para gasto y aporte, la categoría va en las notas
        const finalNotes = (isExpense || isCapital)
            ? `${category}${notes.trim() ? ' · ' + notes.trim() : ''}`
            : (notes.trim() || null);

        setSaving(true);
        const { error } = await supabasePersonas.rpc('treasury_apply_movement', {
            p_kind: action,
            p_from_account: skipOrigin ? null : (fromId || null),
            p_to_account: needsDest ? (toId || null) : null,
            p_from_amount: skipOrigin ? 0 : (fa || 0),  // aporte no debita ninguna cuenta
            p_to_amount: ta || 0,
            p_exchange_rate: rate,
            p_fee_amount: isFx ? (Number(fee) || 0) : 0,
            p_fee_currency: isFx ? (fromAcc?.currency ?? null) : null,
            p_tax_amount: isFx ? (Number(tax) || 0) : 0,
            p_tax_currency: isFx ? (fromAcc?.currency ?? null) : null,
            p_notes: finalNotes,
        });
        if (error) {
            setErr(/does not exist|function|kind_check/i.test(error.message)
                ? 'Falta correr la migración de tesorería en Supabase (2026_treasury_ledger.sql + 2026_treasury_expense.sql + 2026_treasury_capital_in.sql).'
                : error.message);
            setSaving(false);
            return;
        }
        await logAdminAction({
            admin: profile, action: `treasury_${action}`, targetType: 'treasury',
            metadata: { from: fromAcc?.name, to: toAcc?.name, fromAmount: fa, toAmount: ta, category: (isExpense || isCapital) ? category : undefined },
        });
        const labels: Record<string, string> = {
            internal_transfer: 'Transferencia registrada',
            fx_buy_usdt: 'Compra de USDT registrada',
            fx_sell_usdt: 'Venta de USDT registrada',
            expense: 'Gasto registrado',
            profit: 'Utilidad registrada',
            capital_in: 'Aporte registrado',
        };
        toast.success(`✓ ${labels[action] ?? 'Movimiento registrado'}`);
        setSaving(false);
        onDone();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold" style={{ color: NAVY }}>{titles[action]}</h3>
                    <button onClick={onClose}><X size={18} /></button>
                </div>
                <div className="p-5 space-y-4">
                    {isExpense && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
                            Registra un gasto que <strong>reduce el saldo</strong> de la cuenta: comisiones, impuestos, cuota de manejo, etc.
                        </div>
                    )}
                    {isProfit && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                            Mandá la <strong>utilidad</strong> (tu margen) a la billetera de utilidades. Si la cuenta origen
                            está en otra moneda que la billetera, ingresá el monto convertido (ej. el COP de ganancia que pasaste a USDT).
                        </div>
                    )}
                    {isCapital && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900">
                            Registra un <strong>ingreso propio</strong> a una cuenta: capital inicial, préstamo de socio,
                            reintegro, etc. <strong>Suma al saldo</strong> de la cuenta destino (no sale de ninguna cuenta del libro).
                        </div>
                    )}

                    {!skipOrigin && (
                        <Field label={action === 'fx_sell_usdt' ? 'Wallet USDT (origen)' : isExpense ? 'Cuenta que paga el gasto' : isProfit ? 'Cuenta de donde sale la utilidad' : 'Cuenta origen'}>
                            <select value={fromId} onChange={e => setFromId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white">
                                <option value="">— Elegir —</option>
                                {fromOptions.map(a => <option key={a.id} value={a.id}>{a.name} ({formatAmount(a.balance, a.currency)})</option>)}
                            </select>
                        </Field>
                    )}

                    {(isExpense || isCapital) && (
                        <Field label={isCapital ? 'Tipo de aporte' : 'Tipo de gasto'}>
                            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white">
                                {(isCapital ? CAPITAL_CATEGORIES : EXPENSE_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </Field>
                    )}

                    {!isCapital && (
                        <Field label={isExpense ? `Monto del gasto ${fromAcc ? `(${fromAcc.currency})` : ''}` : `Monto que sale ${fromAcc ? `(${fromAcc.currency})` : ''}`}>
                            <input value={fromAmount} onChange={e => setFromAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" placeholder="0.00" />
                        </Field>
                    )}

                    {isTransfer && fromAcc && toOptions.length === 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                            No hay otra cuenta en <strong>{fromAcc.currency}</strong> para transferir.
                            Para mover de un país a otro (ej. BRL → COP) usá <strong>Comprar USDT</strong> y luego <strong>Vender USDT</strong>.
                        </div>
                    )}

                    {needsDest && (
                        <Field label={action === 'fx_buy_usdt' ? 'Wallet USDT (destino)' : isProfit ? 'Billetera de utilidades' : isCapital ? 'Cuenta que recibe el aporte' : 'Cuenta destino'}>
                            <select value={toId} onChange={e => setToId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white">
                                <option value="">— Elegir —</option>
                                {toOptions.filter(a => a.id !== fromId).map(a => <option key={a.id} value={a.id}>{a.name} ({formatAmount(a.balance, a.currency)})</option>)}
                            </select>
                            {isTransfer && <p className="text-[11px] text-slate-500 mt-1">Solo cuentas en la misma moneda que el origen.</p>}
                        </Field>
                    )}

                    {isCapital && (
                        <Field label={`Monto del aporte ${toAcc ? `(${toAcc.currency})` : ''}`}>
                            <input value={fromAmount} onChange={e => setFromAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" placeholder="0.00" />
                        </Field>
                    )}

                    {showToAmount && (
                        <Field label={`Monto que entra ${toAcc ? `(${toAcc.currency})` : ''}`}>
                            <input value={toAmount} onChange={e => setToAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" placeholder="0.00" />
                            {rate && <p className="text-xs text-slate-500 mt-1">Tasa implícita: {rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}</p>}
                        </Field>
                    )}

                    {/* Fee/impuesto SOLO en compra/venta USDT (costos del exchange) */}
                    {isFx && (
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Comisión (fee)">
                                <input value={fee} onChange={e => setFee(e.target.value.replace(/[^0-9.]/g, ''))}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" placeholder="0.00" />
                            </Field>
                            <Field label="Impuesto">
                                <input value={tax} onChange={e => setTax(e.target.value.replace(/[^0-9.]/g, ''))}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" placeholder="0.00" />
                            </Field>
                        </div>
                    )}

                    {isTransfer && (
                        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
                            Entra a destino exactamente lo que sale del origen. Si el banco cobra una comisión por la transferencia, regístrala aparte con el botón <strong>Gastos</strong>.
                        </p>
                    )}

                    <Field label={isOtherCategory ? 'Notas · requerido para "Otro"' : 'Notas'}>
                        <input value={notes} onChange={e => setNotes(e.target.value)}
                            className={isOtherCategory
                                ? 'w-full px-3 py-2 rounded-lg border border-amber-400'
                                : 'w-full px-3 py-2 rounded-lg border border-slate-300'}
                            placeholder={
                                isOtherCategory && isCapital ? 'Describe el aporte (ej: venta de activo, devolucion X)'
                                : isOtherCategory && isExpense ? 'Describe el gasto (ej: software, papeleria)'
                                : isExpense ? 'Detalle (opcional)'
                                : isCapital ? 'Detalle (opcional)'
                                : 'Ej: compra USDT en Binance @ 0.20'
                            } />
                    </Field>

                    {err && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{err}</p>}
                </div>
                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button onClick={save} disabled={saving} style={{ backgroundColor: NAVY }} className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50">
                        {saving ? 'Registrando...' : isExpense ? 'Registrar gasto' : isProfit ? 'Registrar utilidad' : isCapital ? 'Registrar aporte' : 'Registrar movimiento'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">{label}</label>
        {children}
    </div>
);
