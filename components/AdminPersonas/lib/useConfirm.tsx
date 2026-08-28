import React, { useState } from 'react';
import { AlertCircle, Bell, CheckCircle2 } from 'lucide-react';
import { NAVY } from '../sections/shared';

// ─────────────────────────────────────────────
// useConfirm — reemplaza window.confirm()/alert() con un modal
// estilizado CuyPay. Devuelve `dialog` JSX y `confirm(opts)` que
// retorna Promise<boolean>.
//
// Uso:
//   const { confirm, dialog } = useConfirm();
//
//   const ok = await confirm({
//     title: 'Eliminar banner',
//     message: '¿Seguro? No se puede deshacer.',
//     variant: 'danger',
//     confirmLabel: 'Eliminar',
//   });
//   if (!ok) return;
//
//   await confirm({
//     title: 'Aviso',
//     message: 'No hay datos.',
//     alertOnly: true,
//   });
//
//   return <>{dialog}<button onClick={...}>...</button></>;
// ─────────────────────────────────────────────

export type ConfirmVariant = 'primary' | 'danger' | 'success' | 'warning';

export interface ConfirmOptions {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: ConfirmVariant;
    alertOnly?: boolean;
}

const VARIANT_STYLES: Record<ConfirmVariant, { icon: typeof AlertCircle; iconBg: string; iconColor: string; btnBg: string }> = {
    primary: { icon: Bell,           iconBg: '#CCFBF1', iconColor: NAVY,      btnBg: NAVY },
    danger:  { icon: AlertCircle,    iconBg: '#FEE2E2', iconColor: '#DC2626', btnBg: '#DC2626' },
    success: { icon: CheckCircle2,   iconBg: '#DCFCE7', iconColor: '#16A34A', btnBg: '#16A34A' },
    warning: { icon: AlertCircle,    iconBg: '#FEF3C7', iconColor: '#D97706', btnBg: '#D97706' },
};

export function useConfirm() {
    const [state, setState] = useState<(ConfirmOptions & { resolver: (ok: boolean) => void }) | null>(null);

    const confirm = (opts: ConfirmOptions) =>
        new Promise<boolean>(resolve => setState({ ...opts, resolver: resolve }));

    const close = (ok: boolean) => {
        if (!state) return;
        state.resolver(ok);
        setState(null);
    };

    const dialog = state ? (
        <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in"
            onClick={() => close(false)}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200"
                style={{ animation: 'cuyconfirm-pop 180ms cubic-bezier(.22,1.2,.36,1)' }}
                onClick={e => e.stopPropagation()}
            >
                <style>{`
                    @keyframes cuyconfirm-pop {
                        from { opacity: 0; transform: scale(.94) translateY(8px); }
                        to   { opacity: 1; transform: scale(1) translateY(0); }
                    }
                `}</style>
                <div className="p-5">
                    <div className="flex items-start gap-3">
                        {(() => {
                            const v = VARIANT_STYLES[state.variant ?? 'primary'];
                            const Icon = v.icon;
                            return (
                                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: v.iconBg }}>
                                    <Icon size={20} style={{ color: v.iconColor }} />
                                </div>
                            );
                        })()}
                        <div className="min-w-0 flex-1">
                            <p className="font-bold text-base" style={{ color: NAVY }}>{state.title}</p>
                            <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words">{state.message}</p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2 px-5 pb-5">
                    {!state.alertOnly && (
                        <button
                            onClick={() => close(false)}
                            className="flex-1 px-3 py-2.5 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                        >
                            {state.cancelLabel ?? 'Cancelar'}
                        </button>
                    )}
                    <button
                        onClick={() => close(true)}
                        className="flex-1 px-3 py-2.5 text-sm font-bold rounded-lg text-white shadow-sm hover:opacity-90 transition-opacity"
                        style={{ backgroundColor: VARIANT_STYLES[state.variant ?? 'primary'].btnBg }}
                        autoFocus
                    >
                        {state.confirmLabel ?? (state.alertOnly ? 'OK' : 'Confirmar')}
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    return { confirm, dialog };
}
