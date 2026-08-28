import React, { useEffect, useState } from 'react';
import { UserPlus, ChevronRight, ChevronDown, AlertCircle, Shield, Globe } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { type AdminProfile } from '../lib/adminAuth';
import { NAVY, TEAL, EmptyState } from './shared';
import { UserLimitsCard } from './UserLimitsCard';

// ─────────────────────────────────────────────
// UserBeneficiariesLimits — lista todos los beneficiarios (terceros)
// que un usuario tiene registrados, con su tope custom o "default
// global" y un expansible para ajustarlos.
//
// Se renderiza en UserDetailDrawer → tab "Topes" justo debajo del
// card de topes propios del usuario. Cada beneficiario es un
// disclosure: click → muestra UserLimitsCard apuntando al beneficiary.
// ─────────────────────────────────────────────

interface Beneficiary {
    id: string;
    full_name: string | null;
    country: string | null;
    is_active: boolean | null;
    custom_daily_limit: number | null;
    custom_monthly_limit: number | null;
    limits_currency: string | null;
}

interface Props {
    ownerUserId: string;
    profile: AdminProfile;
}

export const UserBeneficiariesLimits: React.FC<Props> = ({ ownerUserId, profile }) => {
    const [items, setItems]     = useState<Beneficiary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);
    const [openId, setOpenId]   = useState<string | null>(null);

    const load = async () => {
        setLoading(true); setError(null);
        const { data, error: err } = await supabasePersonas
            .from('beneficiaries')
            .select('id, full_name, country, is_active, custom_daily_limit, custom_monthly_limit, limits_currency')
            .eq('owner_user_id', ownerUserId)
            .order('created_at', { ascending: false })
            .limit(200);
        if (err) {
            // Si la tabla no existe en este deploy, no es fatal: solo no mostramos nada.
            const missing = /relation .* does not exist/i.test(err.message) ||
                            /Could not find the table/i.test(err.message) ||
                            err.code === '42P01' || err.code === 'PGRST205';
            if (!missing) setError(err.message);
            setItems([]);
            setLoading(false);
            return;
        }
        setItems((data as Beneficiary[]) ?? []);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [ownerUserId]);

    if (loading) {
        return <div className="p-4 text-center text-slate-400 text-sm">Cargando beneficiarios…</div>;
    }
    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
        );
    }
    if (items.length === 0) {
        return (
            <EmptyState
                icon={UserPlus}
                title="Sin beneficiarios"
                message="Este usuario aún no ha dado de alta ningún tercero / beneficiario."
            />
        );
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <UserPlus size={14} style={{ color: NAVY }} />
                <p className="text-sm font-bold" style={{ color: NAVY }}>
                    Topes por beneficiario
                </p>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: TEAL + '22', color: NAVY }}>
                    {items.length}
                </span>
            </div>
            <p className="text-xs text-slate-500">
                Topes individuales que aplican cuando este usuario envía a cada tercero. Custom sobrescribe el default global.
            </p>

            <div className="space-y-2">
                {items.map(b => {
                    const isOpen = openId === b.id;
                    const hasCustom = b.custom_daily_limit != null || b.custom_monthly_limit != null;
                    return (
                        <div key={b.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                            <button
                                onClick={() => setOpenId(isOpen ? null : b.id)}
                                className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 text-left"
                            >
                                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                                     style={{ backgroundColor: hasCustom ? TEAL + '22' : '#F1F5F9' }}>
                                    <UserPlus size={14} style={{ color: hasCustom ? NAVY : '#64748B' }} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold truncate" style={{ color: NAVY }}>
                                        {b.full_name ?? '— sin nombre —'}
                                    </p>
                                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                        {b.country && <span>{b.country}</span>}
                                        {b.is_active === false && (
                                            <span className="text-red-600 font-semibold">bloqueado</span>
                                        )}
                                        {hasCustom ? (
                                            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: NAVY }}>
                                                <Shield size={10} /> custom
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1">
                                                <Globe size={10} /> default global
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {isOpen ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                            </button>
                            {isOpen && (
                                <div className="border-t border-slate-100 p-3 bg-slate-50">
                                    <UserLimitsCard
                                        userId={b.id}
                                        profile={profile}
                                        subject="beneficiary"
                                        onSaved={load}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
