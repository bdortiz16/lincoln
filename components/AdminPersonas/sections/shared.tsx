import React from 'react';

export const NAVY = '#0C0E0D';
export const TEAL = '#4ADE80';

export const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('es-CO', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return String(iso); }
};

export const formatAmount = (amount: number | null, currency: string | null) => {
    if (amount == null) return '—';
    return `${currency ?? ''} ${amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`.trim();
};

export const StatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
        pending:   { bg: '#FEF3C7', text: '#92400E', label: 'Pendiente' },
        approved:  { bg: '#D1FAE5', text: '#065F46', label: 'Aprobada' },
        rejected:  { bg: '#FEE2E2', text: '#991B1B', label: 'Rechazada' },
        completed: { bg: '#DBEAFE', text: '#1E40AF', label: 'Completada' },
        verified:  { bg: '#D1FAE5', text: '#065F46', label: 'Verificado' },
    };
    const s = map[status ?? ''] ?? { bg: '#F1F5F9', text: '#475569', label: status ?? '—' };
    return (
        <span
            className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={{ backgroundColor: s.bg, color: s.text }}
        >
            {s.label}
        </span>
    );
};

export const SectionHeader: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode }> =
    ({ title, subtitle, right }) => (
        <div className="flex items-start justify-between gap-3 mb-4 md:mb-6 flex-wrap">
            <div className="min-w-0 flex-1">
                <h1 className="text-xl md:text-2xl font-bold leading-tight" style={{ color: NAVY }}>{title}</h1>
                {subtitle && <p className="text-slate-500 text-xs md:text-sm mt-1">{subtitle}</p>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
        </div>
    );

export const EmptyState: React.FC<{ icon: any; title: string; message?: string }> =
    ({ icon: Icon, title, message }) => (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-10 text-center">
            <Icon size={36} className="mx-auto mb-3 text-slate-400" />
            <p className="font-semibold text-slate-700 text-sm md:text-base">{title}</p>
            {message && <p className="text-xs md:text-sm text-slate-500 mt-1">{message}</p>}
        </div>
    );
