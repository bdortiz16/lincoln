import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';

// ════════════════════════════════════════════════════════
// Sistema de toasts global del admin.
//
// Uso:
//   const toast = useToast();
//   toast.success('Cambios guardados');
//   toast.error('No pude guardar — revisa la conexión');
//   toast.info('Sincronizando…');
// ════════════════════════════════════════════════════════

type ToastKind = 'success' | 'error' | 'warn' | 'info';
interface ToastItem {
    id: number;
    kind: ToastKind;
    text: string;
    durationMs: number;
}

interface ToastApi {
    success: (text: string, durationMs?: number) => void;
    error:   (text: string, durationMs?: number) => void;
    warn:    (text: string, durationMs?: number) => void;
    info:    (text: string, durationMs?: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export const useToast = (): ToastApi => {
    const ctx = useContext(ToastCtx);
    if (!ctx) {
        // Fallback silencioso por si alguien lo usa fuera del provider.
        return {
            success: () => {}, error: () => {}, warn: () => {}, info: () => {},
        };
    }
    return ctx;
};

let toastIdCounter = 1;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [items, setItems] = useState<ToastItem[]>([]);

    const push = useCallback((kind: ToastKind, text: string, durationMs = 3500) => {
        const id = toastIdCounter++;
        setItems(prev => [...prev, { id, kind, text, durationMs }]);
    }, []);

    const remove = useCallback((id: number) => {
        setItems(prev => prev.filter(t => t.id !== id));
    }, []);

    const api: ToastApi = {
        success: (text, ms) => push('success', text, ms),
        error:   (text, ms) => push('error',   text, ms ?? 6000),  // los errores duran más
        warn:    (text, ms) => push('warn',    text, ms),
        info:    (text, ms) => push('info',    text, ms),
    };

    return (
        <ToastCtx.Provider value={api}>
            {children}
            <ToastViewport items={items} onClose={remove} />
        </ToastCtx.Provider>
    );
};

const ToastViewport: React.FC<{ items: ToastItem[]; onClose: (id: number) => void }> = ({ items, onClose }) => {
    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]">
            {items.map(t => <ToastCard key={t.id} item={t} onClose={() => onClose(t.id)} />)}
        </div>
    );
};

const STYLES: Record<ToastKind, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
    success: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', icon: <CheckCircle2 size={16} className="text-emerald-600" /> },
    error:   { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-900',     icon: <XCircle size={16} className="text-red-600" /> },
    warn:    { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-900',   icon: <AlertTriangle size={16} className="text-amber-600" /> },
    info:    { bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-900',   icon: <CheckCircle2 size={16} className="text-slate-600" /> },
};

const ToastCard: React.FC<{ item: ToastItem; onClose: () => void }> = ({ item, onClose }) => {
    const [show, setShow] = useState(false);
    const s = STYLES[item.kind];

    useEffect(() => {
        // Animación de entrada en el siguiente tick.
        const t = setTimeout(() => setShow(true), 10);
        // Cierre automático tras durationMs.
        const close = setTimeout(() => {
            setShow(false);
            setTimeout(onClose, 200); // espera que termine la transición
        }, item.durationMs);
        return () => { clearTimeout(t); clearTimeout(close); };
    }, [item.durationMs, onClose]);

    return (
        <div
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${s.bg} ${s.border} ${s.text} shadow-lg transition-all duration-200 ${show ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}`}
            role="alert"
        >
            <span className="shrink-0 mt-0.5">{s.icon}</span>
            <p className="text-sm leading-snug flex-1 break-words">{item.text}</p>
            <button onClick={onClose} className="shrink-0 p-0.5 rounded hover:bg-black/5 transition-colors" aria-label="Cerrar">
                <X size={14} className="opacity-60" />
            </button>
        </div>
    );
};
