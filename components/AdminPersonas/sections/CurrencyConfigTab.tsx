import React, { useEffect, useState } from 'react';
import { Globe, RefreshCw, AlertCircle, Download, Send } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, PERMISSIONS, type AdminProfile } from '../lib/adminAuth';
import { NAVY, TEAL, EmptyState } from './shared';
import { useToast } from '../lib/toast';

// ─────────────────────────────────────────────
// CurrencyConfigTab — prender/apagar monedas en la app al instante.
//
// Lee public.currency_config (currency, can_load, can_send) y expone
// 2 toggles por moneda:
//   • Permitir Cargas  → can_load  (depósitos en esa moneda)
//   • Permitir Envíos  → can_send  (retiros/envíos en esa moneda)
//
// Las apps mobile leen estas columnas para mostrar/ocultar la moneda
// en los flujos de carga y envío — el cambio es inmediato.
// ─────────────────────────────────────────────

interface CurrencyRow {
    currency: string;
    can_load: boolean;
    can_send: boolean;
}

const FLAGS: Record<string, string> = {
    USD: '🇺🇸', COP: '🇨🇴', PEN: '🇵🇪', CLP: '🇨🇱', MXN: '🇲🇽', BRL: '🇧🇷', VES: '🇻🇪', EUR: '🇪🇺',
};
const NAMES: Record<string, string> = {
    USD: 'Dólar estadounidense', COP: 'Peso colombiano', PEN: 'Sol peruano',
    CLP: 'Peso chileno', MXN: 'Peso mexicano', BRL: 'Real brasileño',
    VES: 'Bolívar venezolano', EUR: 'Euro',
};

const SETUP_SQL = `CREATE TABLE IF NOT EXISTS public.currency_config (
  currency  text PRIMARY KEY,
  can_load  boolean NOT NULL DEFAULT true,
  can_send  boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.currency_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY currency_config_read ON public.currency_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY currency_config_write ON public.currency_config
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
            AND u.admin_role IN ('super_admin','treasury'))
  );
INSERT INTO public.currency_config (currency) VALUES
  ('USD'),('COP'),('PEN'),('CLP'),('MXN'),('BRL'),('VES')
ON CONFLICT (currency) DO NOTHING;`;

export const CurrencyConfigTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [rows, setRows] = useState<CurrencyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [tableMissing, setTableMissing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canManage = PERMISSIONS.canManageBankAccounts(profile.role);

    const load = async () => {
        setLoading(true); setError(null); setTableMissing(false);
        const { data, error: err } = await supabasePersonas
            .from('currency_config')
            .select('currency, can_load, can_send')
            .order('currency');
        if (err) {
            const missing = /relation .* does not exist|Could not find the table|schema cache/i.test(err.message)
                || err.code === '42P01' || err.code === 'PGRST205';
            if (missing) setTableMissing(true);
            else setError(err.message);
            setLoading(false);
            return;
        }
        setRows((data as CurrencyRow[]) ?? []);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const toggle = async (currency: string, field: 'can_load' | 'can_send') => {
        if (!canManage) return;
        const row = rows.find(r => r.currency === currency);
        if (!row) return;
        const next = !row[field];
        // Optimista
        setRows(prev => prev.map(r => r.currency === currency ? { ...r, [field]: next } : r));
        const { error: err } = await supabasePersonas
            .from('currency_config')
            .update({ [field]: next, updated_by: profile.id, updated_at: new Date().toISOString() })
            .eq('currency', currency);
        if (err) {
            setRows(prev => prev.map(r => r.currency === currency ? { ...r, [field]: !next } : r));
            toast.error(`No pude actualizar ${currency}: ${err.message}`);
            return;
        }
        const what = field === 'can_load' ? 'Cargas' : 'Envíos';
        toast.success(`${what} en ${currency} ${next ? 'HABILITADAS' : 'DESHABILITADAS'} en la app.`);
        await logAdminAction({
            admin: profile,
            action: `currency.${field}.${next ? 'enable' : 'disable'}`,
            targetType: 'currency',
            targetId: currency,
            metadata: { [field]: next },
        });
    };

    if (tableMissing) {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                <p className="text-sm font-bold text-amber-900 flex items-center gap-2">
                    <AlertCircle size={15} /> Falta la tabla currency_config
                </p>
                <p className="text-xs text-amber-800">
                    Corré este SQL en Supabase para crearla con seed de las 7 monedas:
                </p>
                <pre className="bg-white border border-amber-200 rounded-lg p-3 text-[10px] overflow-x-auto">{SETUP_SQL}</pre>
                <button onClick={load} className="px-3 py-2 text-xs font-bold rounded-lg text-white" style={{ backgroundColor: NAVY }}>
                    Reintentar
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-bold flex items-center gap-2" style={{ color: NAVY }}>
                        <Globe size={15} /> Monedas habilitadas
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Apagá una moneda y desaparece del flujo de la app al instante — sin deploy.
                    </p>
                </div>
                <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Refrescar">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>
            )}

            {loading ? (
                <p className="text-sm text-slate-400 text-center py-8">Cargando monedas…</p>
            ) : rows.length === 0 ? (
                <EmptyState icon={Globe} title="Sin monedas" message="La tabla currency_config está vacía — insertá las monedas con el seed del SQL." />
            ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-5 py-3 font-semibold">Moneda</th>
                                <th className="text-center px-5 py-3 font-semibold">
                                    <span className="inline-flex items-center gap-1"><Download size={11} /> Permitir Cargas</span>
                                </th>
                                <th className="text-center px-5 py-3 font-semibold">
                                    <span className="inline-flex items-center gap-1"><Send size={11} /> Permitir Envíos</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.currency} className="border-t border-slate-100 hover:bg-slate-50/60">
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">{FLAGS[r.currency] ?? '🏳️'}</span>
                                            <div>
                                                <p className="font-bold" style={{ color: NAVY }}>{r.currency}</p>
                                                <p className="text-[11px] text-slate-500">{NAMES[r.currency] ?? ''}</p>
                                            </div>
                                        </div>
                                    </td>
                                    {(['can_load', 'can_send'] as const).map(field => (
                                        <td key={field} className="px-5 py-3 text-center">
                                            <button
                                                onClick={() => toggle(r.currency, field)}
                                                disabled={!canManage}
                                                title={r[field]
                                                    ? `${field === 'can_load' ? 'Cargas' : 'Envíos'} habilitados — click para apagar`
                                                    : `${field === 'can_load' ? 'Cargas' : 'Envíos'} deshabilitados — click para prender`}
                                                className={`inline-flex items-center gap-2 ${!canManage ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                            >
                                                <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${r[field] ? 'bg-emerald-500' : 'bg-red-400'}`}>
                                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${r[field] ? 'left-[18px]' : 'left-0.5'}`} />
                                                </span>
                                                <span className={`text-[11px] font-bold uppercase tracking-wider w-8 text-left ${r[field] ? 'text-emerald-700' : 'text-red-600'}`}>
                                                    {r[field] ? 'ON' : 'OFF'}
                                                </span>
                                            </button>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
