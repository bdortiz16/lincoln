import React, { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { NAVY, TEAL } from './shared';

// ─────────────────────────────────────────────
// LimitUsageBar — barra compacta de uso del tope mensual para listar
// usuarios/beneficiarios sin abrir el drawer. Lazy-load por fila:
// monta → un solo RPC → renderiza.
//
// Color:
//   < 70%   → verde
//   70–90%  → ámbar
//   ≥ 90%   → rojo
// ─────────────────────────────────────────────

interface Props {
    subjectId: string;
    subject?: 'user' | 'beneficiary';
    /** 'compact' = solo barra + porcentaje. 'full' = label + barra + números. */
    variant?: 'compact' | 'full';
}

interface LimitsSummary {
    currency: string;
    monthly_max: number;
    monthly_used: number;
    monthly_pct: number;
    is_custom_monthly: boolean;
}

export const LimitUsageBar: React.FC<Props> = ({ subjectId, subject = 'user', variant = 'compact' }) => {
    const [s, setS]     = useState<LimitsSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const rpc = subject === 'beneficiary' ? 'get_beneficiary_limits_summary' : 'get_user_limits_summary';
            const key = subject === 'beneficiary' ? 'p_beneficiary_id' : 'p_user_id';
            const { data, error } = await supabasePersonas.rpc(rpc, { [key]: subjectId });
            if (cancelled) return;
            if (error || data?.error) { setLoading(false); return; }
            setS(data as LimitsSummary);
            setLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [subjectId, subject]);

    if (loading) {
        return (
            <div className={variant === 'full' ? 'space-y-1' : 'flex items-center gap-2'}>
                <div className="h-1.5 w-full bg-slate-100 rounded-full animate-pulse" style={{ minWidth: 80 }} />
            </div>
        );
    }
    if (!s) return null;

    const pct = s.monthly_pct;
    const color = pct >= 90 ? '#DC2626' : pct >= 70 ? '#F59E0B' : '#10B981';
    const bg    = pct >= 90 ? '#FEE2E2' : pct >= 70 ? '#FEF3C7' : '#D1FAE5';

    if (variant === 'compact') {
        return (
            <div className="flex items-center gap-2 min-w-[120px]" title={`Tope mensual: ${fmt(s.monthly_used)} / ${fmt(s.monthly_max)} ${s.currency}`}>
                <Gauge size={11} style={{ color }} />
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
                </div>
                <span className="text-[10px] font-mono font-bold shrink-0" style={{ color }}>
                    {pct.toFixed(0)}%
                </span>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <Gauge size={11} style={{ color }} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tope mensual</span>
                {s.is_custom_monthly && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: TEAL + '22', color: NAVY }}>
                        custom
                    </span>
                )}
                <span className="text-[10px] font-mono ml-auto" style={{ color }}>
                    {pct.toFixed(1)}%
                </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
            </div>
            <p className="text-[10px] font-mono text-slate-500">
                {fmt(s.monthly_used)} / {fmt(s.monthly_max)} {s.currency}
            </p>
        </div>
    );
};

function fmt(n: number): string {
    return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}
