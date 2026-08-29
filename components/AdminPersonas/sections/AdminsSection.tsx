import React, { useEffect, useState, useCallback } from 'react';
import { Users, UserPlus, X, AlertTriangle, ShieldCheck, RefreshCw, Globe } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import {
    logAdminAction, ROLE_LABELS, ROLE_COLORS, TREASURY_CURRENCIES,
    type AdminProfile, type AdminRole, type AssignedCurrency,
} from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, formatDate, NAVY, EmptyState } from './shared';

interface AdminsSectionProps {
    profile: AdminProfile;
}

interface AdminUser {
    id: string;
    email: string;
    full_name: string | null;
    admin_role: AdminRole;
    assigned_currency: AssignedCurrency | null;
    created_at: string;
}

const CURRENCY_FLAGS: Record<AssignedCurrency, string> = {
    COP: '🇨🇴', CLP: '🇨🇱', PEN: '🇵🇪', MXN: '🇲🇽', BRL: '🇧🇷',
};

export const AdminsSection: React.FC<AdminsSectionProps> = ({ profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [admins, setAdmins] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [searchEmail, setSearchEmail] = useState('');
    const [chosenRole, setChosenRole] = useState<AdminRole>('compliance');
    const [chosenCurrency, setChosenCurrency] = useState<AssignedCurrency | ''>('');
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        // Intento con assigned_currency; si la columna no existe (migración no aplicada),
        // reintentar sin ella para no romper la pantalla.
        let { data, error } = await supabasePersonas
            .from('users')
            .select('id, email, full_name, admin_role, assigned_currency, created_at')
            .not('admin_role', 'is', null)
            .order('admin_role', { ascending: true });
        if (error && /assigned_currency/.test(error.message)) {
            const retry = await supabasePersonas
                .from('users')
                .select('id, email, full_name, admin_role, created_at')
                .not('admin_role', 'is', null)
                .order('admin_role', { ascending: true });
            data = retry.data as any;
        }
        setAdmins((data as AdminUser[]) ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const addAdmin = async () => {
        setError(null);
        if (!searchEmail.trim()) {
            setError('Ingresa un correo');
            return;
        }
        setProcessing(true);
        try {
            // Buscar el usuario por email
            const { data: target, error: fetchErr } = await supabasePersonas
                .from('users')
                .select('id, email, admin_role')
                .eq('email', searchEmail.trim().toLowerCase())
                .maybeSingle();

            if (fetchErr) throw fetchErr;
            if (!target) throw new Error('No se encontró un usuario con ese correo. Primero el usuario debe registrarse en la app móvil o ser creado en Authentication.');

            // Asignar rol + moneda (assigned_currency aplica solo a treasury;
            // para los demás roles se guarda NULL)
            const newCurrency = chosenRole === 'treasury' ? (chosenCurrency || null) : null;
            let { error: updateErr } = await supabasePersonas
                .from('users')
                .update({ admin_role: chosenRole, assigned_currency: newCurrency })
                .eq('id', target.id);
            // Si la columna assigned_currency aún no existe, reintentar solo con admin_role
            if (updateErr && /assigned_currency/.test(updateErr.message)) {
                if (chosenRole === 'treasury' && newCurrency) {
                    throw new Error('Para asignar una moneda específica debes correr la migración 2026_treasury_by_currency.sql en Supabase primero.');
                }
                const retry = await supabasePersonas
                    .from('users')
                    .update({ admin_role: chosenRole })
                    .eq('id', target.id);
                updateErr = retry.error;
            }
            if (updateErr) throw updateErr;

            await logAdminAction({
                admin: profile,
                action: target.admin_role ? 'admin_update_role' : 'admin_create',
                targetType: 'user',
                targetId: target.id,
                metadata: {
                    email: target.email,
                    role: chosenRole,
                    assigned_currency: newCurrency,
                    previous_role: target.admin_role,
                },
            });

            setShowAddModal(false);
            setSearchEmail('');
            setChosenRole('compliance');
            setChosenCurrency('');
            await load();
        } catch (e: any) {
            setError(e?.message ?? 'Error al asignar rol');
        } finally {
            setProcessing(false);
        }
    };

    const removeAdmin = async (admin: AdminUser) => {
        if (admin.id === profile.id) {
            await confirm({
                title: 'Acción bloqueada',
                message: 'No puedes quitarte tu propio rol. Pide a otro super_admin que lo haga.',
                variant: 'warning',
                alertOnly: true,
            });
            return;
        }
        const ok = await confirm({
            title: 'Quitar rol',
            message: `¿Quitar el rol de admin a ${admin.email}? El usuario seguirá existiendo pero perderá acceso al panel.`,
            variant: 'danger',
            confirmLabel: 'Quitar rol',
        });
        if (!ok) return;
        const { error } = await supabasePersonas
            .from('users')
            .update({ admin_role: null })
            .eq('id', admin.id);
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
            action: 'admin_remove',
            targetType: 'user',
            targetId: admin.id,
            metadata: { email: admin.email, previous_role: admin.admin_role },
        });
        await load();
    };

    return (
        <div className="p-4 md:p-8">
            {confirmDialog}
            <SectionHeader
                title="Administradores"
                subtitle={`${admins.length} usuarios con rol administrativo`}
                right={
                    <div className="flex gap-2">
                        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={() => setShowAddModal(true)}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white rounded-lg"
                            style={{ backgroundColor: NAVY }}
                        >
                            <UserPlus size={14} />
                            Asignar rol
                        </button>
                    </div>
                }
            />

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && admins.length === 0 && (
                <EmptyState icon={ShieldCheck} title="Sin administradores" message="Asigna roles a usuarios existentes para empezar" />
            )}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="text-left px-4 py-3">Admin</th>
                            <th className="text-left px-4 py-3">Rol</th>
                            <th className="text-left px-4 py-3">Moneda</th>
                            <th className="text-left px-4 py-3">Desde</th>
                            <th className="text-right px-4 py-3">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {admins.map(a => {
                            const roleColor = ROLE_COLORS[a.admin_role];
                            return (
                                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-900">{a.full_name ?? '—'}</div>
                                        <div className="text-xs text-slate-500">{a.email}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span
                                            className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold"
                                            style={{ backgroundColor: `${roleColor}33`, color: NAVY }}
                                        >
                                            {ROLE_LABELS[a.admin_role]}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {a.admin_role === 'treasury' ? (
                                            a.assigned_currency ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                                                    {CURRENCY_FLAGS[a.assigned_currency] ?? ''} {a.assigned_currency}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-slate-400 italic">Todas (global)</span>
                                            )
                                        ) : (
                                            <span className="text-xs text-slate-300">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(a.created_at)}</td>
                                    <td className="px-4 py-3 text-right">
                                        {a.id !== profile.id && (
                                            <button
                                                onClick={() => removeAdmin(a)}
                                                className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 inline-flex items-center gap-1"
                                            >
                                                <X size={12} />
                                                Quitar
                                            </button>
                                        )}
                                        {a.id === profile.id && (
                                            <span className="text-xs text-slate-400 italic">tú</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Modal de asignación */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold" style={{ color: NAVY }}>Asignar rol administrativo</h2>
                            <button onClick={() => { setShowAddModal(false); setError(null); }} className="text-slate-400 hover:text-slate-700">
                                <X size={20} />
                            </button>
                        </div>

                        <p className="text-sm text-slate-500 mb-4">
                            El usuario ya debe existir (registrado en la app móvil o creado en Supabase Auth).
                        </p>

                        {error && (
                            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                                <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
                                <p className="text-red-700 text-sm">{error}</p>
                            </div>
                        )}

                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Correo</label>
                        <input
                            type="email"
                            value={searchEmail}
                            onChange={(e) => setSearchEmail(e.target.value)}
                            placeholder="usuario@lincoin.me"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:border-green-500 mb-4"
                            autoFocus
                        />

                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Rol</label>
                        <div className="space-y-2 mb-6">
                            {(Object.keys(ROLE_LABELS) as AdminRole[]).map(role => (
                                <label
                                    key={role}
                                    className="flex items-start gap-3 p-3 rounded-lg cursor-pointer border-2 transition-colors"
                                    style={{
                                        borderColor: chosenRole === role ? NAVY : '#E2E8F0',
                                        backgroundColor: chosenRole === role ? '#F8FAFC' : 'white',
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="role"
                                        value={role}
                                        checked={chosenRole === role}
                                        onChange={() => setChosenRole(role)}
                                        className="mt-1"
                                    />
                                    <div className="flex-1">
                                        <p className="font-semibold text-slate-900 text-sm">{ROLE_LABELS[role]}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">{ROLE_DESCRIPTIONS[role]}</p>
                                    </div>
                                </label>
                            ))}
                        </div>

                        {/* Selector de moneda — solo aplica a tesorería */}
                        {chosenRole === 'treasury' && (
                            <div className="mb-6 p-4 rounded-xl border-2 border-amber-200 bg-amber-50">
                                <label className="flex items-center gap-2 text-xs font-bold text-amber-900 uppercase mb-2">
                                    <Globe size={14} />
                                    Delegación por moneda
                                </label>
                                <p className="text-xs text-amber-900 mb-3">
                                    Si asignás una moneda, esta persona <strong>solo verá y aprobará</strong> las transacciones, cuentas y pares FX
                                    que toquen esa moneda. Dejá vacío para tesorería global (ve todo).
                                </p>
                                <div className="grid grid-cols-6 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setChosenCurrency('')}
                                        className={`p-2 rounded-lg border-2 text-xs font-semibold transition-colors ${
                                            chosenCurrency === ''
                                                ? 'border-slate-900 bg-slate-50 text-slate-900'
                                                : 'border-slate-200 hover:border-slate-300 text-slate-500'
                                        }`}
                                    >
                                        🌎 Todas
                                    </button>
                                    {TREASURY_CURRENCIES.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setChosenCurrency(c)}
                                            className={`p-2 rounded-lg border-2 transition-colors flex flex-col items-center gap-0.5 ${
                                                chosenCurrency === c
                                                    ? 'border-slate-900 bg-slate-50'
                                                    : 'border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            <span className="text-lg leading-none">{CURRENCY_FLAGS[c]}</span>
                                            <span className="text-[10px] font-semibold text-slate-600">{c}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={addAdmin}
                            disabled={processing}
                            style={{ backgroundColor: NAVY }}
                            className="w-full text-white font-bold py-3 rounded-xl hover:opacity-90 disabled:opacity-50"
                        >
                            {processing ? 'Asignando...' : 'Asignar rol'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
    super_admin: 'Acceso completo. Puede gestionar otros admins y todas las áreas.',
    compliance: 'Revisa KYC, monitoreo AML y screening de listas.',
    treasury: 'Aprueba transacciones, gestiona reservas y cuentas bancarias.',
    audit: 'Solo lectura. Acceso a logs, reportes y auditoría.',
    support: 'Soporte al usuario. Lectura de usuarios y transacciones, sin aprobaciones.',
};
