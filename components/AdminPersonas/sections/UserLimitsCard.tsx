import React, { useEffect, useState } from 'react';
import { Gauge, RefreshCw, Save, X, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { NAVY, TEAL } from './shared';

// ─────────────────────────────────────────────
// UserLimitsCard — muestra el consumo daily/monthly del sujeto vs su
// tope efectivo, y permite al admin ajustar topes custom que
// sobrescriben el default global.
//
// `subject` controla contra qué RPC habla:
//   • 'user'        → get_user_limits_summary / admin_set_user_limits
//   • 'beneficiary' → get_beneficiary_limits_summary / admin_set_beneficiary_limits
// (mismas firmas, mismo shape de respuesta — ver
//  supabase/migrations/2026_user_limits.sql y 2026_beneficiary_limits.sql)
//
// Se usa en 3 lugares:
//   • UserDetailDrawer (tab "Topes") — propios + uno por beneficiario
//   • Compliance KYC Terceros → drawer/modal de un beneficiario
//   • Quick-action desde DocRequestsTab cuando el admin aprueba
//     una solicitud de "Ampliación de topes" (category='limit_increase')
// ─────────────────────────────────────────────

export type LimitsSubject = 'user' | 'beneficiary';

interface LimitsSummary {
    currency: string;
    daily_max: number;
    monthly_max: number;
    daily_used: number;
    monthly_used: number;
    daily_pct: number;
    monthly_pct: number;
    is_custom_daily: boolean;
    is_custom_monthly: boolean;
}

interface Props {
    /** ID del sujeto: user.id o beneficiary.id */
    userId: string;
    profile: AdminProfile;
    /** Por defecto 'user'. Pasar 'beneficiary' para apuntar a beneficiaries. */
    subject?: LimitsSubject;
    /** Si es true, muestra el form de ajuste abierto al cargar. Útil para
     *  quick-action desde Compliance "Aprobar y ajustar topes". */
    autoOpenEdit?: boolean;
    onSaved?: () => void;
}

export const UserLimitsCard: React.FC<Props> = ({ userId, profile, subject = 'user', autoOpenEdit, onSaved }) => {
    const [summary, setSummary] = useState<LimitsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);
    const [editing, setEditing] = useState(!!autoOpenEdit);
    const [saving, setSaving]   = useState(false);

    // Form local del editor
    const [draftDaily, setDraftDaily]     = useState<string>('');
    const [draftMonthly, setDraftMonthly] = useState<string>('');
    const [draftCurrency, setDraftCurrency] = useState<string>('USD');

    // Mapa subject → nombres RPC + payload key
    const RPC = subject === 'beneficiary'
        ? { get: 'get_beneficiary_limits_summary', set: 'admin_set_beneficiary_limits', idKey: 'p_beneficiary_id', target: 'beneficiary' as const, action: 'beneficiary_limits.update' as const, editorLabel: 'Ajustar topes para este beneficiario' }
        : { get: 'get_user_limits_summary',        set: 'admin_set_user_limits',        idKey: 'p_user_id',        target: 'user'        as const, action: 'user_limits.update'        as const, editorLabel: 'Ajustar topes para este usuario' };

    const load = async () => {
        setLoading(true); setError(null);
        const { data, error: err } = await supabasePersonas.rpc(RPC.get, { [RPC.idKey]: userId });
        if (err) { setError(err.message); setLoading(false); return; }
        if (data?.error) { setError(data.error); setLoading(false); return; }
        const s = data as LimitsSummary;
        setSummary(s);
        setDraftDaily(s.is_custom_daily   ? String(s.daily_max)   : '');
        setDraftMonthly(s.is_custom_monthly ? String(s.monthly_max) : '');
        setDraftCurrency(s.currency);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId, subject]);

    const save = async (resetToGlobal = false) => {
        setSaving(true); setError(null);
        const payload: Record<string, any> = resetToGlobal
            ? { [RPC.idKey]: userId, p_daily_limit: null, p_monthly_limit: null, p_currency: null }
            : {
                [RPC.idKey]:     userId,
                p_daily_limit:   draftDaily.trim()   ? Number(draftDaily)   : null,
                p_monthly_limit: draftMonthly.trim() ? Number(draftMonthly) : null,
                p_currency:      draftCurrency.trim() || null,
            };
        const { data, error: err } = await supabasePersonas.rpc(RPC.set, payload);
        setSaving(false);
        if (err) { setError(err.message); return; }
        if (data?.error) { setError(data.error); return; }
        await logAdminAction({
            admin: profile, action: RPC.action,
            targetType: RPC.target, targetId: userId,
            metadata: payload,
        });
        setEditing(false);
        await load();
        onSaved?.();
    };

    if (loading) return <div className="p-6 text-center text-slate-400 text-sm">Cargando topes…</div>;
    if (error) return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
    );
    if (!summary) return null;

    return (
        <div className="space-y-4">
            {/* Cards de daily + monthly */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <LimitProgressCard
                    label="Tope diario"
                    used={summary.daily_used}
                    max={summary.daily_max}
                    pct={summary.daily_pct}
                    currency={summary.currency}
                    isCustom={summary.is_custom_daily}
                />
                <LimitProgressCard
                    label="Tope mensual"
                    used={summary.monthly_used}
                    max={summary.monthly_max}
                    pct={summary.monthly_pct}
                    currency={summary.currency}
                    isCustom={summary.is_custom_monthly}
                />
            </div>

            {/* Acciones */}
            <div className="flex items-center gap-2 flex-wrap">
                <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-2 text-sm font-semibold rounded-lg text-white inline-flex items-center gap-2"
                    style={{ backgroundColor: NAVY }}
                >
                    <Gauge size={14} /> Ajustar Topes
                </button>
                {(summary.is_custom_daily || summary.is_custom_monthly) && (
                    <button
                        onClick={() => save(true)}
                        disabled={saving}
                        className="px-3 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-2 disabled:opacity-50"
                        title="Sacar los topes custom y volver a los defaults globales"
                    >
                        <RotateCcw size={14} /> Volver al default global
                    </button>
                )}
                <button
                    onClick={load}
                    className="ml-auto p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                    title="Refrescar"
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* Editor inline */}
            {editing && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-semibold" style={{ color: NAVY }}>
                        {RPC.editorLabel}
                    </p>
                    <p className="text-xs text-slate-500">
                        Dejá un campo vacío para usar el default global de ese tope. Si llenás ambos, el user opera con esos límites.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Field label="Tope diario">
                            <input
                                type="number" min={0} step="any"
                                value={draftDaily}
                                onChange={e => setDraftDaily(e.target.value)}
                                placeholder={`Default global`}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                            />
                        </Field>
                        <Field label="Tope mensual">
                            <input
                                type="number" min={0} step="any"
                                value={draftMonthly}
                                onChange={e => setDraftMonthly(e.target.value)}
                                placeholder={`Default global`}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                            />
                        </Field>
                        <Field label="Moneda">
                            <select
                                value={draftCurrency}
                                onChange={e => setDraftCurrency(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
                            >
                                {['USD', 'COP', 'PEN', 'CLP', 'MXN', 'BRL', 'VES', 'EUR'].map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </Field>
                    </div>
                    <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
                        <button onClick={() => setEditing(false)} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                            Cancelar
                        </button>
                        <button
                            onClick={() => save(false)}
                            disabled={saving}
                            className="px-3 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-1 disabled:opacity-50"
                            style={{ backgroundColor: NAVY }}
                        >
                            <Save size={13} /> {saving ? 'Guardando…' : 'Guardar topes'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const LimitProgressCard: React.FC<{
    label: string; used: number; max: number; pct: number; currency: string; isCustom: boolean;
}> = ({ label, used, max, pct, currency, isCustom }) => {
    const barColor = pct >= 90 ? '#DC2626' : pct >= 70 ? '#F59E0B' : '#10B981';
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
                {isCustom && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: TEAL + '22', color: NAVY }}>
                        custom
                    </span>
                )}
            </div>
            <p className="text-2xl font-bold font-mono" style={{ color: NAVY }}>
                {formatNum(used)} <span className="text-sm text-slate-400">/ {formatNum(max)} {currency}</span>
            </p>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-2">
                <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }} />
            </div>
            <p className="text-[10px] text-slate-500 mt-1 font-mono">{pct.toFixed(1)}% usado</p>
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
        <div className="mt-1">{children}</div>
    </div>
);

function formatNum(n: number): string {
    return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}
