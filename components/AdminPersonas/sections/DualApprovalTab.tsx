import React, { useEffect, useState, useCallback } from 'react';
import { Shield, AlertTriangle, Save } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { NAVY, EmptyState } from './shared';

interface DualThreshold {
    id: string;
    currency: string;
    amount_threshold: number;
    is_active: boolean;
}

/**
 * Doble aprobación por umbrales de monto.
 *
 * Cuando una TX cuyo monto supera el umbral configurado para esa moneda
 * intenta aprobarse, solo se registra el voto del admin. La TX queda en
 * "pending dual approval" hasta que un segundo admin distinto la apruebe.
 *
 * Antes vivía en Seguridad → Doble aprobación; se movió a Tesorería
 * porque es una configuración operativa de aprobación de transacciones.
 */
export const DualApprovalTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const [thresholds, setThresholds] = useState<DualThreshold[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabasePersonas
            .from('dual_approval_thresholds')
            .select('*')
            .order('currency');
        setThresholds((data as DualThreshold[]) ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async (t: DualThreshold) => {
        const newVal = Number(editing[t.id] ?? t.amount_threshold);
        if (isNaN(newVal) || newVal <= 0) return;
        await supabasePersonas
            .from('dual_approval_thresholds')
            .update({ amount_threshold: newVal, updated_by: profile.id, updated_at: new Date().toISOString() })
            .eq('id', t.id);
        await logAdminAction({
            admin: profile,
            action: 'dual_threshold_update',
            targetType: 'threshold',
            targetId: t.id,
            metadata: { currency: t.currency, from: t.amount_threshold, to: newVal },
        });
        setEditing(prev => { const c = { ...prev }; delete c[t.id]; return c; });
        await load();
    };

    const toggle = async (t: DualThreshold) => {
        await supabasePersonas
            .from('dual_approval_thresholds')
            .update({ is_active: !t.is_active })
            .eq('id', t.id);
        await logAdminAction({
            admin: profile,
            action: t.is_active ? 'dual_threshold_deactivate' : 'dual_threshold_activate',
            targetType: 'threshold',
            targetId: t.id,
            metadata: { currency: t.currency },
        });
        load();
    };

    return (
        <div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-700 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-900">
                    Transacciones por encima del umbral requerirán <strong>2 aprobadores diferentes</strong> (super_admin o treasury) antes de procesarse.
                </p>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && thresholds.length === 0 && (
                <EmptyState icon={Shield} title="Sin umbrales" message="Configura límites para activar doble aprobación" />
            )}

            <div className="space-y-2">
                {thresholds.map(t => (
                    <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
                        <div className="w-16 font-bold" style={{ color: NAVY }}>{t.currency}</div>
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Umbral</label>
                            <input
                                value={editing[t.id] ?? t.amount_threshold.toString()}
                                onChange={e => setEditing(prev => ({ ...prev, [t.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-sm"
                            />
                        </div>
                        <div className="flex gap-2 shrink-0">
                            {editing[t.id] !== undefined && editing[t.id] !== t.amount_threshold.toString() && (
                                <button onClick={() => save(t)} className="px-3 py-2 text-sm bg-green-50 text-green-700 rounded-lg font-semibold flex items-center gap-1">
                                    <Save size={14} /> Guardar
                                </button>
                            )}
                            <button
                                onClick={() => toggle(t)}
                                className="px-2.5 py-1 rounded-full text-xs font-semibold"
                                style={{
                                    backgroundColor: t.is_active ? '#D1FAE5' : '#FEE2E2',
                                    color: t.is_active ? '#065F46' : '#991B1B',
                                }}
                            >
                                {t.is_active ? 'Activo' : 'Inactivo'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 bg-slate-50 rounded-xl p-4 text-xs text-slate-500">
                <strong>Cómo funciona:</strong> Cuando un admin (treasury/super) intenta aprobar una TX por encima del umbral,
                solo se registra su voto. La TX queda en "pending dual approval". Cuando un segundo admin distinto la aprueba,
                la TX cambia a "approved". Cualquiera puede rechazar con un voto.
            </div>
        </div>
    );
};
