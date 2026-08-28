import React, { useEffect, useState } from 'react';
import { Vault, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import { useSystemConfig } from '../context/SystemConfigContext';

// ─────────────────────────────────────────────
// CollectionWalletCard — Wallet RECAUDADORA del admin (OTC Crypto).
//
// Dirección USDT (TRC-20) editable donde se concentra el recaudo: cada vez
// que un cliente CONVIERTE su Dólar digital a COP, el USDT on-chain de su
// dirección GasFree se barre automáticamente hacia esta wallet
// (gasfree · recover_user_funds). Se guarda en la config del sistema
// (collectionWalletTron) — la lee el dashboard del cliente al convertir.
// ─────────────────────────────────────────────

export const CollectionWalletCard: React.FC = () => {
    const { config, updateConfig } = useSystemConfig() as any;
    const saved = String(config?.collectionWalletTron ?? '');
    const [addr, setAddr] = useState(saved);
    const [state, setState] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
    useEffect(() => { setAddr(saved); }, [saved]);

    const isTronAddr = (a: string) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a.trim());

    const save = async () => {
        const clean = addr.trim();
        if (clean && !isTronAddr(clean)) {
            setState('err');
            return;
        }
        setState('saving');
        try {
            await updateConfig({ collectionWalletTron: clean });
            setState('ok');
            setTimeout(() => setState('idle'), 2500);
        } catch {
            setState('err');
        }
    };

    return (
        <div className="bg-white rounded-xl border-2 border-[#4ADE80]/40 shadow-sm p-5">
            <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2">
                <Vault size={16} className="text-[#16A34A]" /> Wallet recaudadora (admin)
            </h3>
            <p className="text-xs text-slate-500 mb-4">
                Dirección <b>USDT · TRC-20</b> donde se concentra el recaudo: al convertir un cliente su Dólar
                digital a COP, el USDT de su dirección GasFree se <b>barre automáticamente</b> hacia esta wallet.
            </p>
            <div className="flex gap-2 flex-wrap">
                <input
                    value={addr}
                    onChange={e => { setAddr(e.target.value); if (state !== 'idle') setState('idle'); }}
                    placeholder="TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    spellCheck={false}
                    className="flex-1 min-w-[280px] px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:border-[#4ADE80] outline-none"
                />
                <button
                    onClick={save}
                    disabled={state === 'saving' || addr.trim() === saved}
                    style={{ color: '#FFFFFF' }}
                    className="px-5 py-2.5 rounded-xl bg-[#0C0E0D] hover:bg-[#152e52] font-bold text-sm flex items-center gap-2 disabled:opacity-50 transition-colors"
                >
                    <Save size={14} /> {state === 'saving' ? 'Guardando…' : 'Guardar'}
                </button>
            </div>
            {state === 'ok' && (
                <p className="mt-2 text-xs font-bold text-green-700 flex items-center gap-1">
                    <CheckCircle size={13} /> Wallet recaudadora guardada. Los barridos de las próximas conversiones irán a esta dirección.
                </p>
            )}
            {state === 'err' && (
                <p className="mt-2 text-xs font-bold text-red-600 flex items-center gap-1">
                    <AlertTriangle size={13} /> Dirección inválida — debe ser una dirección TRON (TRC-20): empieza por T y tiene 34 caracteres.
                </p>
            )}
            {!saved && state === 'idle' && (
                <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">
                    ⚠️ Sin wallet recaudadora configurada: las conversiones NO barren el USDT (queda en la dirección de cada cliente hasta que la configures).
                </p>
            )}
        </div>
    );
};
