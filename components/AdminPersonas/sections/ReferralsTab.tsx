import React, { useEffect, useState, useCallback } from 'react';
import { Gift, Save, RefreshCw, TrendingUp, Users, DollarSign, AlertTriangle } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { NAVY, TEAL, formatAmount } from './shared';

/**
 * Configuración de referidos.
 *
 * El programa de referidos comparte un % de la comisión cobrada en cada
 * conversión con el usuario que refirió. Ese % se guarda en:
 *
 *   public.app_settings (key='referral_rate', value=jsonb numeric)
 *
 * Solo super_admin puede editarlo. La app móvil (Android/iOS) lee este
 * valor al hacer una conversión para calcular cuánto sumar al balance
 * del referidor.
 *
 * Además mostramos stats si la tabla `referrals` existe.
 */

interface ReferralStats {
    totalReferrals: number;
    totalPaidOut: number;
    activeReferrers: number;
}

export const ReferralsTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const isSuperAdmin = profile.role === 'super_admin';

    const [rate, setRate] = useState<number | null>(null);
    const [rateInput, setRateInput] = useState('');
    const [stats, setStats] = useState<ReferralStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setMsg(null);

        // 1) Rate actual desde app_settings (jsonb)
        const settingsRes = await supabasePersonas
            .from('app_settings')
            .select('value')
            .eq('key', 'referral_rate')
            .maybeSingle()
            .then(r => r)
            .catch(() => ({ data: null } as any));

        // value en jsonb puede venir como número, string o {value:number}
        const raw = settingsRes.data?.value;
        const parsed = typeof raw === 'number' ? raw
                      : typeof raw === 'string' ? Number(raw)
                      : typeof raw?.value === 'number' ? raw.value
                      : null;
        if (parsed !== null && isFinite(parsed)) {
            setRate(parsed);
            setRateInput(String(parsed));
        }

        // 2) Stats — la tabla referrals puede no existir aún
        try {
            const referralsRes = await supabasePersonas
                .from('referrals')
                .select('id, referrer_user_id, amount_paid', { count: 'exact' });
            if (referralsRes.error) throw referralsRes.error;
            const rows = (referralsRes.data as any[]) ?? [];
            const totalPaid = rows.reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
            const activeReferrers = new Set(rows.map(r => r.referrer_user_id).filter(Boolean)).size;
            setStats({
                totalReferrals: referralsRes.count ?? rows.length,
                totalPaidOut: totalPaid,
                activeReferrers,
            });
        } catch {
            setStats(null);
        }

        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async () => {
        if (!isSuperAdmin) return;
        const newRate = Number(rateInput.replace(',', '.'));
        if (!isFinite(newRate) || newRate < 0 || newRate > 1) {
            setMsg({ kind: 'err', text: 'El valor debe ser un decimal entre 0 y 1 (ej: 0.01 = 1 %)' });
            return;
        }
        setSaving(true);
        setMsg(null);
        // upsert para soportar el primer guardado si la fila aún no existe
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert({
                key: 'referral_rate',
                value: newRate,
                updated_at: new Date().toISOString(),
                updated_by: profile.id,
            }, { onConflict: 'key' });

        if (error) {
            const isMissing = /does not exist|relation/i.test(error.message);
            const isRls = /row-level security|policy/i.test(error.message);
            setMsg({
                kind: 'err',
                text: isMissing
                    ? 'La tabla app_settings no existe en Supabase. Corre la migración del proyecto Android primero.'
                    : isRls
                    ? 'RLS bloqueando el guardado. Asegurate de que super_admin pueda hacer UPDATE en app_settings.'
                    : `Error guardando: ${error.message}`,
            });
            setSaving(false);
            return;
        }

        await logAdminAction({
            admin: profile,
            action: 'referral_rate_update',
            targetType: 'app_setting',
            targetId: 'referral_rate',
            metadata: { from: rate, to: newRate },
        });
        setRate(newRate);
        setMsg({ kind: 'ok', text: `✓ Comisión de referidos actualizada a ${(newRate * 100).toFixed(2)}%` });
        setSaving(false);
    };

    const dirty = rate !== null && Number(rateInput.replace(',', '.')) !== rate;

    return (
        <div className="space-y-6">
            {/* Card principal — editor del rate */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${TEAL}33` }}>
                        <Gift size={18} color={NAVY} />
                    </div>
                    <div className="flex-1">
                        <p className="font-bold" style={{ color: NAVY }}>Comisión de referidos</p>
                        <p className="text-xs text-slate-800">% de la comisión que se reparte al usuario que refirió</p>
                    </div>
                    <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100" title="Refrescar">
                        <RefreshCw size={14} className={loading ? 'animate-spin text-slate-400' : 'text-slate-600'} />
                    </button>
                </div>

                <div className="p-5">
                    <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                        Tasa actual
                    </label>
                    <div className="flex items-stretch gap-3 flex-wrap">
                        <div className="relative flex-1 min-w-[200px]">
                            <input
                                type="number"
                                step="0.001"
                                min="0"
                                max="1"
                                value={rateInput}
                                onChange={e => setRateInput(e.target.value)}
                                onBlur={() => rate !== null && !rateInput && setRateInput(String(rate))}
                                disabled={!isSuperAdmin}
                                className="w-full px-4 py-3 pr-24 rounded-xl border border-slate-500 font-mono text-lg outline-none focus:border-green-500 disabled:bg-slate-50 disabled:text-slate-900"
                                placeholder="0.01"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-800 font-mono pointer-events-none">
                                = {rateInput && isFinite(Number(rateInput.replace(',', '.'))) ? (Number(rateInput.replace(',', '.')) * 100).toFixed(2) : '—'} %
                            </span>
                        </div>
                        {isSuperAdmin && (
                            <button
                                onClick={save}
                                disabled={!dirty || saving}
                                style={{ backgroundColor: NAVY }}
                                className="px-5 py-3 text-sm font-bold text-white rounded-xl disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2"
                            >
                                <Save size={14} />
                                {saving ? 'Guardando...' : 'Guardar'}
                            </button>
                        )}
                    </div>

                    {!isSuperAdmin && (
                        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            Solo super_admin puede modificar este valor. Tu rol actual es {profile.role}.
                        </p>
                    )}

                    {msg && (
                        <p className={`mt-3 text-xs font-medium rounded-lg p-2.5 ${
                            msg.kind === 'ok'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-red-50 text-red-800 border border-red-200'
                        }`}>
                            {msg.text}
                        </p>
                    )}

                    <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-800 leading-relaxed">
                        <strong>Cómo funciona:</strong> cuando un usuario A refiere a un usuario B y B hace
                        una conversión que genera comisión, el sistema acredita a A el valor
                        <code className="font-mono mx-1 px-1.5 py-0.5 bg-slate-100 rounded">comisión × referral_rate</code>
                        en su balance. La app móvil (Android/iOS) lee este valor desde
                        <code className="font-mono mx-1 px-1.5 py-0.5 bg-slate-100 rounded">app_settings.referral_rate</code>
                        en cada operación. Valor decimal entre 0 y 1 — por ejemplo <code className="font-mono">0.01</code> = 1 %.
                    </div>
                </div>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <StatCard
                        icon={Users}
                        label="Referidores activos"
                        value={String(stats.activeReferrers)}
                    />
                    <StatCard
                        icon={TrendingUp}
                        label="Total referidos"
                        value={String(stats.totalReferrals)}
                    />
                    <StatCard
                        icon={DollarSign}
                        label="Pagado en referidos"
                        value={formatAmount(stats.totalPaidOut, '')}
                    />
                </div>
            )}
        </div>
    );
};

const StatCard: React.FC<{ icon: any; label: string; value: string }> = ({ icon: Icon, label, value }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${TEAL}22` }}>
                <Icon size={16} color={NAVY} />
            </div>
            <p className="text-[10px] uppercase tracking-wider text-slate-800 font-semibold">{label}</p>
        </div>
        <p className="text-xl font-bold font-mono" style={{ color: NAVY }}>{value}</p>
    </div>
);
