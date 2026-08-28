import React, { useEffect, useState } from 'react';
import { Gauge, Save, AlertCircle, CheckCircle2, RefreshCw, Info } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { SectionHeader, NAVY, TEAL } from './shared';

// ─────────────────────────────────────────────
// OperationalLimitsTab — defaults globales que se aplican a TODO
// usuario que no tenga custom_daily_limit / custom_monthly_limit.
//
// Persiste en app_settings WHERE key='operational_limits'
//   value = { daily: number, monthly: number, currency: text }
//
// Mismo patrón del CouponsTab — upsert con onConflict='key' apoyado
// en el trigger que ya tiene la tabla.
// ─────────────────────────────────────────────

interface GlobalLimits {
    daily: number;
    monthly: number;
    currency: string;
}

interface Props {
    profile: AdminProfile;
}

export const OperationalLimitsTab: React.FC<Props> = ({ profile }) => {
    const [data, setData]     = useState<GlobalLimits | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError]   = useState<string | null>(null);
    const [okMsg, setOkMsg]   = useState<string | null>(null);

    const [draftDaily, setDraftDaily]       = useState('');
    const [draftMonthly, setDraftMonthly]   = useState('');
    const [draftCurrency, setDraftCurrency] = useState('USD');

    const load = async () => {
        setLoading(true); setError(null); setOkMsg(null);
        const { data: row, error: err } = await supabasePersonas
            .from('app_settings')
            .select('value')
            .eq('key', 'operational_limits')
            .maybeSingle();
        if (err) { setError(err.message); setLoading(false); return; }
        const v = (row as any)?.value ?? { daily: 800, monthly: 3000, currency: 'USD' };
        const g: GlobalLimits = {
            daily:    Number(v.daily ?? 800),
            monthly:  Number(v.monthly ?? 3000),
            currency: String(v.currency ?? 'USD'),
        };
        setData(g);
        setDraftDaily(String(g.daily));
        setDraftMonthly(String(g.monthly));
        setDraftCurrency(g.currency);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const save = async () => {
        const d = Number(draftDaily);
        const m = Number(draftMonthly);
        if (!Number.isFinite(d) || d <= 0) { setError('Tope diario debe ser un número mayor a 0.'); return; }
        if (!Number.isFinite(m) || m <= 0) { setError('Tope mensual debe ser un número mayor a 0.'); return; }
        if (m < d) { setError('Tope mensual no puede ser menor que el diario.'); return; }

        setSaving(true); setError(null); setOkMsg(null);
        const next: GlobalLimits = { daily: d, monthly: m, currency: draftCurrency.trim() || 'USD' };
        const { error: upErr } = await supabasePersonas
            .from('app_settings')
            .upsert({ key: 'operational_limits', value: next }, { onConflict: 'key' });
        setSaving(false);
        if (upErr) { setError(upErr.message); return; }
        await logAdminAction({
            admin: profile,
            action: 'operational_limits.update',
            targetType: 'app_settings', targetId: 'operational_limits',
            metadata: next,
        });
        setData(next);
        setOkMsg('Límites globales actualizados.');
        setTimeout(() => setOkMsg(null), 3000);
    };

    const dirty = data && (
        Number(draftDaily) !== data.daily ||
        Number(draftMonthly) !== data.monthly ||
        draftCurrency !== data.currency
    );

    return (
        <div className="space-y-4">
            <SectionHeader
                title="Límites Operativos"
                subtitle="Topes por defecto que aplican a todos los usuarios sin override custom"
                right={
                    <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                }
            />

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0" />
                <p>
                    Estos son los <b>defaults globales</b>. Cada user puede tener overrides personales (visibles en su perfil →
                    pestaña "Topes y Límites"). Cuando el user tiene custom limits, los defaults globales NO le aplican —
                    se respeta el valor individual hasta que volvés al default.
                </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                {loading ? (
                    <p className="text-sm text-slate-400">Cargando…</p>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label="Tope diario" hint="Por usuario, por día (rolling 24h)">
                                <input
                                    type="number" min={0} step="any"
                                    value={draftDaily}
                                    onChange={e => setDraftDaily(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                                />
                            </Field>
                            <Field label="Tope mensual" hint="Por usuario, por mes (rolling 30d)">
                                <input
                                    type="number" min={0} step="any"
                                    value={draftMonthly}
                                    onChange={e => setDraftMonthly(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                                />
                            </Field>
                            <Field label="Moneda" hint="En la que se interpretan los topes">
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

                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800 flex items-start gap-2">
                                <AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{error}</span>
                            </div>
                        )}
                        {okMsg && (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-xs text-emerald-800 flex items-start gap-2">
                                <CheckCircle2 size={12} className="mt-0.5 shrink-0" /><span>{okMsg}</span>
                            </div>
                        )}

                        <div className="flex justify-end pt-2 border-t border-slate-100">
                            <button
                                onClick={save}
                                disabled={saving || !dirty}
                                className="px-3 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-1 disabled:opacity-50"
                                style={{ backgroundColor: NAVY }}
                            >
                                <Save size={13} /> {saving ? 'Guardando…' : 'Guardar defaults globales'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
        <div className="mt-1">{children}</div>
        {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
);
