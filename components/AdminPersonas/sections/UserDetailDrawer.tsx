import React, { useEffect, useState } from 'react';
import {
    X, User as UserIcon, Mail, Phone, Globe, Calendar, Hash, Shield,
    Wallet, ArrowLeftRight, Activity, AlertTriangle, FileText, MoreVertical,
    Ban, KeyRound, Star, RefreshCw, Gauge
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { NAVY, TEAL, formatDate, formatAmount, StatusBadge } from './shared';
import { normalizeTx, type TxRow } from './TransactionsSection';
import { UserLimitsCard } from './UserLimitsCard';
import { UserBeneficiariesLimits } from './UserBeneficiariesLimits';
import { SecurityRecoveryTab } from './SecurityRecoveryTab';

interface Props {
    userId: string;
    onClose: () => void;
    profile: AdminProfile;
}

type Tab = 'overview' | 'wallets' | 'transactions' | 'limits' | 'aml' | 'alerts' | 'security' | 'notes';

export const UserDetailDrawer: React.FC<Props> = ({ userId, onClose, profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [tab, setTab] = useState<Tab>('overview');
    const [user, setUser] = useState<any>(null);
    const [wallets, setWallets] = useState<any[]>([]);
    const [txs, setTxs] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [actions, setActions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showActions, setShowActions] = useState(false);
    const [noteText, setNoteText] = useState('');

    // Helper: query una tabla por owner_user_id; si la columna no existe,
    // reintenta con user_id (tolera ambos esquemas).
    const queryByOwner = async (table: string) => {
        let res = await supabasePersonas.from(table).select('*')
            .eq('owner_user_id', userId).order('created_at', { ascending: false }).limit(100);
        if (res.error && /owner_user_id/.test(res.error.message)) {
            res = await supabasePersonas.from(table).select('*')
                .eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
        }
        return res;
    };

    const load = async () => {
        setLoading(true);
        const [u, w, t, a, ac] = await Promise.all([
            supabasePersonas.from('users').select('*').eq('id', userId).maybeSingle(),
            // Fuente de verdad de saldos: public.wallets.
            // OJO: Antigravity nos pasó la spec con 'wallet_type' pero la columna
            // real se llama 'account_type' (verificado vía information_schema).
            // No filtramos por account_type para que el admin vea todas las
            // billeteras del usuario (main / referral / lo que sea). Ordenamos
            // primero por is_primary y luego por created_at.
            (async () => {
                let r = await supabasePersonas
                    .from('wallets')
                    .select('id, currency, balance, flag, account_type, style, is_primary, created_at')
                    .eq('owner_user_id', userId)
                    .order('is_primary', { ascending: false })
                    .order('created_at', { ascending: true });
                if (r.error && /created_at|column/i.test(r.error.message)) {
                    r = await supabasePersonas
                        .from('wallets')
                        .select('id, currency, balance, flag, account_type, is_primary')
                        .eq('owner_user_id', userId);
                }
                return r;
            })(),
            queryByOwner('transactions'),
            (async () => {
                let r = await supabasePersonas.from('compliance_alerts').select('*')
                    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
                return r;
            })(),
            supabasePersonas.from('admin_actions').select('*').eq('target_type', 'user').eq('target_id', userId).order('created_at', { ascending: false }).limit(50),
        ]);
        setUser(u.data);
        // Wallets vienen tal como las devuelve la tabla. Si la query falló (RLS,
        // tabla inexistente, etc.) dejamos un array vacío + log para que el
        // empty state explique.
        if (w.error) {
            console.warn('[UserDetailDrawer] wallets query error:', w.error.message);
            setWallets([]);
        } else {
            // Fallback de id sintético por si el query falló y reintentó sin id.
            const ws = ((w.data as any[]) ?? []).map((row, i) => ({
                ...row,
                id: row.id ?? `${row.currency}-${i}`,
            }));
            setWallets(ws);
        }
        setTxs(((t.data as any[]) ?? []).map(normalizeTx));
        setAlerts((a.data as any[]) ?? []);
        setActions((ac.data as any[]) ?? []);
        setLoading(false);
    };

    useEffect(() => { load(); }, [userId]);

    const blockUser = async () => {
        const ok = await confirm({
            title: 'Bloquear cuenta',
            message: '¿Bloquear esta cuenta? El usuario no podrá iniciar sesión.',
            variant: 'warning',
            confirmLabel: 'Bloquear',
        });
        if (!ok) return;
        // ⚠️ SECURITY: antes usábamos kyc_status='rejected' como proxy de
        // "bloqueado" — corrompía el estado real del KYC y mentía a Didit.
        // Ahora usamos la columna dedicada is_blocked (migración 2026_user_block.sql).
        // El trigger guard_users_sensitive_cols solo permite cambiar is_blocked
        // desde un admin con admin_role IS NOT NULL.
        const { error } = await supabasePersonas.from('users').update({ is_blocked: true }).eq('id', userId);
        if (error) {
            await confirm({
                title: 'Error',
                message: `No pude bloquear: ${error.message}`,
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
            return;
        }
        await logAdminAction({ admin: profile, action: 'user_block', targetType: 'user', targetId: userId, metadata: { email: user?.email } });
        await load();
        setShowActions(false);
    };

    const resetPin = async () => {
        const ok = await confirm({
            title: 'Resetear PIN',
            message: '¿Forzar al usuario a restablecer su PIN en el próximo inicio?',
            variant: 'warning',
            confirmLabel: 'Resetear',
        });
        if (!ok) return;
        await supabasePersonas.from('users').update({ pin_hash: null }).eq('id', userId);
        await logAdminAction({ admin: profile, action: 'user_reset_pin', targetType: 'user', targetId: userId, metadata: { email: user?.email } });
        setShowActions(false);
        await confirm({
            title: 'PIN reseteado',
            message: 'El usuario deberá crear uno nuevo en su próximo login.',
            variant: 'success',
            alertOnly: true,
        });
    };

    const saveNote = async () => {
        if (!noteText.trim()) return;
        await logAdminAction({
            admin: profile,
            action: 'user_note',
            targetType: 'user',
            targetId: userId,
            metadata: { email: user?.email, note: noteText.trim() },
        });
        setNoteText('');
        await load();
    };

    const tabs: Array<{ id: Tab; label: string; icon: any; badge?: number }> = [
        { id: 'overview',     label: 'Resumen',      icon: UserIcon },
        { id: 'wallets',      label: 'Billeteras',   icon: Wallet,         badge: wallets.length },
        { id: 'transactions', label: 'Transacciones', icon: ArrowLeftRight, badge: txs.length },
        { id: 'limits',       label: 'Topes',        icon: Gauge },
        { id: 'aml',          label: 'AML',          icon: Shield },
        { id: 'alerts',       label: 'Alertas',      icon: AlertTriangle,  badge: alerts.filter(a => a.status === 'open').length },
        { id: 'security',     label: 'Seguridad',    icon: KeyRound },
        { id: 'notes',        label: 'Bitácora',     icon: FileText,       badge: actions.length },
    ];

    const totalBalance = wallets.reduce((s, w) => s + (Number(w.balance) || 0), 0);

    return (
        <div className="fixed inset-0 z-50 flex">
            {confirmDialog}
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="ml-auto relative bg-white w-full md:max-w-2xl h-full flex flex-col shadow-2xl">
                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
                        style={{ backgroundColor: TEAL, color: NAVY }}>
                        {(user?.full_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg truncate" style={{ color: NAVY }}>
                            {user?.full_name ?? 'Cargando…'}
                        </p>
                        <p className="text-sm text-slate-500 truncate">{user?.email}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="font-mono text-xs text-slate-600">{user?.cuypay_id ?? '—'}</span>
                            <StatusBadge status={user?.kyc_status} />
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 relative">
                        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100" title="Refrescar">
                            <RefreshCw size={16} className={loading ? 'animate-spin text-slate-400' : 'text-slate-500'} />
                        </button>
                        <button onClick={() => setShowActions(!showActions)} className="p-2 rounded-lg hover:bg-slate-100" title="Acciones">
                            <MoreVertical size={16} className="text-slate-500" />
                        </button>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" title="Cerrar">
                            <X size={18} className="text-slate-500" />
                        </button>
                        {showActions && (
                            <div className="absolute top-12 right-0 bg-white border border-slate-200 rounded-xl shadow-xl py-2 w-56 z-10">
                                <button onClick={blockUser} className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2 text-red-600">
                                    <Ban size={14} /> Bloquear cuenta
                                </button>
                                <button onClick={resetPin} className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                    <KeyRound size={14} /> Resetear PIN
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="px-3 border-b border-slate-200 overflow-x-auto">
                    <div className="flex gap-1">
                        {tabs.map(t => {
                            const Icon = t.icon;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setTab(t.id)}
                                    className="px-3 py-3 text-sm font-semibold transition-colors flex items-center gap-1.5 border-b-2 whitespace-nowrap"
                                    style={{
                                        borderColor: tab === t.id ? TEAL : 'transparent',
                                        color: tab === t.id ? NAVY : '#64748B',
                                    }}
                                >
                                    <Icon size={14} />
                                    {t.label}
                                    {t.badge !== undefined && t.badge > 0 && (
                                        <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-700 font-bold">
                                            {t.badge}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto p-5">
                    {loading && <p className="text-slate-400">Cargando...</p>}

                    {!loading && tab === 'overview' && (
                        <div className="space-y-4">
                            <KpiRow items={[
                                { label: 'Saldo total', value: totalBalance.toLocaleString('es-CO', { minimumFractionDigits: 2 }) },
                                { label: 'Transacciones', value: txs.length.toString() },
                                { label: 'Alertas abiertas', value: alerts.filter(a => a.status === 'open').length.toString() },
                            ]} />

                            {/* Mini-dashboard del usuario: volumen cargado vs enviado */}
                            <UserVolumeCard txs={txs} />

                            <DataGrid items={[
                                { label: 'Correo', value: user?.email, icon: Mail },
                                { label: 'Teléfono', value: user?.phone ?? '—', icon: Phone },
                                { label: 'País', value: `${user?.flag ?? ''} ${user?.country ?? '—'}`, icon: Globe },
                                { label: 'Registrado', value: formatDate(user?.created_at), icon: Calendar },
                                { label: 'CuyPay ID', value: user?.cuypay_id ?? '—', icon: Hash },
                                { label: 'KYC verificado', value: user?.kyc_verified_at ? formatDate(user.kyc_verified_at) : '—', icon: Shield },
                                { label: 'Proveedor KYC', value: user?.kyc_provider ?? '—', icon: Shield },
                                { label: 'PIN configurado', value: user?.pin_hash ? 'Sí' : 'No', icon: KeyRound },
                            ]} />
                        </div>
                    )}

                    {!loading && tab === 'wallets' && (
                        <div className="space-y-3">
                            {wallets.length === 0 && (
                                <p className="text-sm text-slate-500 text-center py-8">
                                    Sin billeteras: el query a <code>public.wallets</code> no devolvió filas para este usuario.
                                    Verificá la policy RLS si la tabla existe en producción.
                                </p>
                            )}
                            {wallets.length > 0 && (() => {
                                const CRYPTO = new Set(['USDT', 'USDC', 'BTC', 'ETH', 'SOL', 'MATIC', 'BNB', 'TRX']);
                                const isCrypto = (cur: string) => CRYPTO.has(String(cur ?? '').toUpperCase());
                                const withBalance = wallets.filter(w => Number(w.balance) > 0).length;
                                return (
                                    <>
                                        <p className="text-xs text-slate-500">
                                            {wallets.length} {wallets.length === 1 ? 'billetera' : 'billeteras'} · {withBalance} con saldo
                                        </p>
                                        <div className="space-y-2">
                                            {wallets.map(w => {
                                                const positive = Number(w.balance) > 0;
                                                const crypto   = isCrypto(w.currency);
                                                const decimals = crypto ? 8 : 2;
                                                const locale   = crypto ? 'en-US' : 'es-CO';
                                                // Tailwind necesita classnames literales (no interpolación)
                                                const containerCls = !positive
                                                    ? 'bg-slate-50 border-transparent'
                                                    : crypto
                                                        ? 'bg-teal-50 border-teal-100'
                                                        : 'bg-emerald-50 border-emerald-100';
                                                const balanceCls = !positive
                                                    ? 'text-slate-400'
                                                    : crypto
                                                        ? 'text-teal-700'
                                                        : 'text-emerald-700';
                                                return (
                                                    <div
                                                        key={w.id}
                                                        className={`rounded-xl p-3 flex items-center justify-between border ${containerCls}`}
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <span className="text-xl shrink-0">{w.flag ?? (crypto ? '🪙' : '🏳️')}</span>
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <p className="font-bold text-sm" style={{ color: NAVY }}>{w.currency}</p>
                                                                    {w.is_primary && (
                                                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-amber-100 text-amber-800">
                                                                            Principal
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[10px] text-slate-500">
                                                                    {crypto ? 'Crypto' : 'Fiat'} · {w.account_type ?? 'main'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <p className={`font-mono font-bold text-right ${balanceCls}`}>
                                                            {Number(w.balance).toLocaleString(locale, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: decimals,
                                                            })}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}

                    {!loading && tab === 'transactions' && (
                        <div className="space-y-2">
                            {txs.length === 0 && <p className="text-sm text-slate-500 text-center py-8">Sin transacciones</p>}
                            {txs.map(t => (
                                <div key={t.id} className="bg-slate-50 rounded-xl p-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                            style={{ backgroundColor: TEAL + '33' }}>
                                            <Activity size={14} color={NAVY} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold capitalize" style={{ color: NAVY }}>{t.type}</p>
                                            <p className="text-xs text-slate-500">{formatDate(t.created_at)}</p>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-sm font-mono font-semibold">{formatAmount(t.from_amount, t.from_currency)}</p>
                                        <StatusBadge status={t.statusKey === 'other' ? t.statusRaw : t.statusKey} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && tab === 'limits' && (
                        <div className="space-y-6">
                            <UserLimitsCard userId={userId} profile={profile} />
                            <div className="border-t border-slate-200 pt-5">
                                <UserBeneficiariesLimits ownerUserId={userId} profile={profile} />
                            </div>
                        </div>
                    )}

                    {!loading && tab === 'aml' && (
                        <AmlAnalysis txs={txs} />
                    )}

                    {!loading && tab === 'alerts' && (
                        <div className="space-y-2">
                            {alerts.length === 0 && <p className="text-sm text-slate-500 text-center py-8">Sin alertas para este usuario</p>}
                            {alerts.map(a => (
                                <div key={a.id} className="bg-slate-50 rounded-xl p-4 flex items-start gap-3">
                                    <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <p className="text-sm font-semibold" style={{ color: NAVY }}>{a.rule_name}</p>
                                            <StatusBadge status={a.status} />
                                            <span className="text-xs uppercase font-bold text-amber-700">{a.severity}</span>
                                        </div>
                                        <p className="text-xs text-slate-600">{a.description}</p>
                                        <p className="text-xs text-slate-400 mt-1">{formatDate(a.created_at)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && tab === 'security' && (
                        <SecurityRecoveryTab
                            userId={userId}
                            profile={profile}
                            confirm={confirm}
                            onChanged={load}
                        />
                    )}

                    {!loading && tab === 'notes' && (
                        <div>
                            <div className="mb-4">
                                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Agregar nota</label>
                                <textarea
                                    value={noteText}
                                    onChange={e => setNoteText(e.target.value)}
                                    placeholder="Ej: Cliente solicitó verificación adicional..."
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                                    rows={2}
                                />
                                <button
                                    onClick={saveNote}
                                    disabled={!noteText.trim()}
                                    style={{ backgroundColor: NAVY }}
                                    className="mt-2 text-white font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                                >
                                    Guardar
                                </button>
                            </div>
                            <div className="space-y-2 border-t border-slate-100 pt-4">
                                <p className="text-xs font-bold text-slate-600 uppercase">Historial de acciones</p>
                                {actions.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Sin actividad aún</p>}
                                {actions.map(ac => (
                                    <div key={ac.id} className="bg-slate-50 rounded-xl p-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-slate-700">{ac.action}</span>
                                            <span className="text-xs text-slate-400">{formatDate(ac.created_at)}</span>
                                        </div>
                                        <p className="text-xs text-slate-600">
                                            por {ac.admin_email} ({ac.admin_role})
                                        </p>
                                        {ac.metadata?.note && (
                                            <p className="text-sm text-slate-800 mt-1 italic">"{ac.metadata.note}"</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Mini-dashboard: volumen cargado vs enviado del usuario, agrupado por moneda
// ─────────────────────────────────────────────
// Análisis AML: a quién le envía el usuario, cuántas veces, monto acumulado.
// Marca en rojo las contrapartes con muchas repeticiones (posible structuring).
// ─────────────────────────────────────────────
const AmlAnalysis: React.FC<{ txs: TxRow[] }> = ({ txs }) => {
    const kindOf = (t: TxRow) => (t.raw?.kind ?? t.type ?? '').toLowerCase();
    const isSend = (t: TxRow) => ['send','envio','envío','pago','payment','withdraw','retiro'].includes(kindOf(t));

    // Nombre de la contraparte: counterparty_name ó campos del raw_data
    const counterpartyOf = (t: TxRow): string => {
        const rd = t.raw?.raw_data ?? {};
        return (
            t.raw?.counterparty_name ??
            rd.receiverName ?? rd.receiver_name ?? rd.to ?? rd.beneficiary ??
            t.bank_name ??
            '—'
        );
    };

    // Agrupar envíos por contraparte
    const sends = txs.filter(isSend);
    const groups: Record<string, { name: string; count: number; total: number; currency: string; last: string }> = {};
    for (const t of sends) {
        const name = counterpartyOf(t);
        const key = name.toLowerCase();
        const g = (groups[key] ??= { name, count: 0, total: 0, currency: t.from_currency ?? '', last: t.created_at });
        g.count += 1;
        g.total += Number(t.from_amount) || 0;
        if (t.created_at > g.last) g.last = t.created_at;
    }
    const list = Object.values(groups).sort((a, b) => b.count - a.count);

    // Totales globales
    const totalSent = sends.reduce((s, t) => s + (Number(t.from_amount) || 0), 0);
    const uniqueDest = list.length;
    const topRepeat = list[0]?.count ?? 0;

    if (sends.length === 0) {
        return <p className="text-sm text-slate-500 text-center py-8">Este usuario no ha hecho envíos todavía.</p>;
    }

    return (
        <div className="space-y-4">
            {/* KPIs AML */}
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="font-bold text-lg" style={{ color: NAVY }}>{sends.length}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Envíos</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="font-bold text-lg" style={{ color: NAVY }}>{uniqueDest}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Destinatarios</p>
                </div>
                <div className={`rounded-xl p-3 text-center ${topRepeat >= 5 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <p className="font-bold text-lg" style={{ color: topRepeat >= 5 ? '#991B1B' : NAVY }}>{topRepeat}×</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Máx. a 1 persona</p>
                </div>
            </div>

            {topRepeat >= 5 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-sm text-red-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <p>
                        <strong>Posible patrón de repetición:</strong> este usuario envió {topRepeat} veces a la
                        misma contraparte. Revisá si hay structuring (fraccionar montos para evadir umbrales).
                    </p>
                </div>
            )}

            {/* Tabla de contrapartes */}
            <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    A quién le envía ({uniqueDest})
                </p>
                <div className="bg-slate-50 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 bg-slate-100 grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
                        <span>Contraparte</span>
                        <span className="text-right"># envíos</span>
                        <span className="text-right">Monto total</span>
                    </div>
                    {list.map((g, i) => (
                        <div key={i} className={`px-3 py-2.5 border-b border-white last:border-b-0 grid grid-cols-[1fr_auto_auto] gap-3 items-center ${g.count >= 5 ? 'bg-red-50/60' : ''}`}>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{g.name}</p>
                                <p className="text-[10px] text-slate-400">último: {formatDate(g.last)}</p>
                            </div>
                            <span className={`text-right text-sm font-bold ${g.count >= 5 ? 'text-red-700' : 'text-slate-700'}`}>
                                {g.count}
                            </span>
                            <span className="text-right text-sm font-mono font-semibold" style={{ color: NAVY }}>
                                {formatAmount(g.total, g.currency)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">
                <strong>Lectura AML:</strong> "Máx. a 1 persona" alto + montos justo bajo el umbral de reporte
                puede indicar <em>structuring</em>. Muchos destinatarios distintos con montos altos puede indicar
                <em> layering</em>. Cruza esto con las alertas automáticas y las reglas AML.
            </p>
        </div>
    );
};

const UserVolumeCard: React.FC<{ txs: TxRow[] }> = ({ txs }) => {
    const kindOf = (t: TxRow) => (t.raw?.kind ?? t.type ?? '').toLowerCase();
    const isLoad = (t: TxRow) => ['load','carga','deposit','topup','recarga'].includes(kindOf(t));
    const isSend = (t: TxRow) => ['send','envio','envío','pago','payment','withdraw','retiro'].includes(kindOf(t));
    const isDone = (t: TxRow) => t.statusKey === 'completed' || t.statusKey === 'approved';

    const sumByCurrency = (pred: (t: TxRow) => boolean) => {
        const m: Record<string, number> = {};
        for (const t of txs) {
            if (!pred(t) || !isDone(t)) continue;
            const c = t.from_currency ?? '—';
            m[c] = (m[c] ?? 0) + (Number(t.from_amount) || 0);
        }
        return Object.entries(m).filter(([, v]) => v > 0);
    };

    const loaded = sumByCurrency(isLoad);
    const sent = sumByCurrency(isSend);

    if (loaded.length === 0 && sent.length === 0) return null;

    return (
        <div className="grid grid-cols-2 gap-2">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">Total cargado</p>
                {loaded.length === 0 ? <p className="text-sm text-slate-400">—</p> : loaded.map(([c, v]) => (
                    <p key={c} className="font-mono font-bold text-sm text-emerald-800">{formatAmount(v, c)}</p>
                ))}
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1">Total enviado</p>
                {sent.length === 0 ? <p className="text-sm text-slate-400">—</p> : sent.map(([c, v]) => (
                    <p key={c} className="font-mono font-bold text-sm text-red-800">{formatAmount(v, c)}</p>
                ))}
            </div>
        </div>
    );
};

const KpiRow: React.FC<{ items: Array<{ label: string; value: string }> }> = ({ items }) => (
    <div className="grid grid-cols-3 gap-2">
        {items.map(i => (
            <div key={i.label} className="bg-slate-50 rounded-xl p-3 text-center">
                <p className="font-bold text-lg" style={{ color: NAVY }}>{i.value}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{i.label}</p>
            </div>
        ))}
    </div>
);

const DataGrid: React.FC<{ items: Array<{ label: string; value: any; icon: any }> }> = ({ items }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.map(i => {
            const Icon = i.icon;
            return (
                <div key={i.label} className="bg-slate-50 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
                        <Icon size={12} />
                        {i.label}
                    </div>
                    <p className="text-sm font-semibold break-all" style={{ color: NAVY }}>
                        {i.value || '—'}
                    </p>
                </div>
            );
        })}
    </div>
);
