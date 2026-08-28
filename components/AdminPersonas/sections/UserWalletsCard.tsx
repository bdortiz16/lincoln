import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { NAVY } from './shared';

// ─────────────────────────────────────────────
// UserWalletsCard — saldos (billeteras) de un usuario, compacto y
// reutilizable. Misma fuente de verdad que el drawer de Usuarios:
// public.wallets por owner_user_id (con fallback si difiere el schema).
// Se usa en el tab "Saldos" del KycDetailModal.
// ─────────────────────────────────────────────
const CRYPTO = new Set(['USDT', 'USDC', 'BTC', 'ETH', 'SOL', 'MATIC', 'BNB', 'TRX']);
const isCrypto = (cur: string) => CRYPTO.has(String(cur ?? '').toUpperCase());

export const UserWalletsCard: React.FC<{ userId: string }> = ({ userId }) => {
    const [wallets, setWallets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        let r = await supabasePersonas
            .from('wallets')
            .select('id, currency, balance, flag, account_type, is_primary, created_at')
            .eq('owner_user_id', userId)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true });
        if (r.error && /owner_user_id|created_at|column/i.test(r.error.message)) {
            r = await supabasePersonas
                .from('wallets')
                .select('*')
                .eq('user_id', userId);
        }
        if (r.error) {
            setError(r.error.message);
            setWallets([]);
        } else {
            setWallets(((r.data as any[]) ?? []).map((row, i) => ({
                ...row,
                id: row.id ?? `${row.currency}-${i}`,
            })));
        }
        setLoading(false);
    };

    useEffect(() => { load(); }, [userId]);

    if (loading) return <p className="text-sm text-slate-400 py-6 text-center">Cargando saldos…</p>;
    if (error) {
        return (
            <p className="text-sm text-slate-500 py-6 text-center">
                No pude leer las billeteras: <span className="font-mono text-xs">{error}</span>
            </p>
        );
    }
    if (wallets.length === 0) {
        return <p className="text-sm text-slate-500 py-6 text-center">Este usuario no tiene billeteras.</p>;
    }

    const withBalance = wallets.filter(w => Number(w.balance) > 0).length;

    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Wallet size={12} />
                {wallets.length} {wallets.length === 1 ? 'billetera' : 'billeteras'} · {withBalance} con saldo
            </p>
            {wallets.map(w => {
                const positive = Number(w.balance) > 0;
                const crypto   = isCrypto(w.currency);
                const decimals = crypto ? 8 : 2;
                const locale   = crypto ? 'en-US' : 'es-CO';
                const containerCls = !positive
                    ? 'bg-slate-50 border-transparent'
                    : crypto
                        ? 'bg-green-50 border-green-100'
                        : 'bg-emerald-50 border-emerald-100';
                const balanceCls = !positive
                    ? 'text-slate-400'
                    : crypto
                        ? 'text-green-700'
                        : 'text-emerald-700';
                return (
                    <div
                        key={w.id}
                        className={`rounded-xl p-3 flex items-center justify-between border ${containerCls}`}
                    >
                        <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xl shrink-0">{w.flag ?? (crypto ? '🪙' : '🏳️')}</span>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="font-bold text-sm" style={{ color: NAVY }}>{w.currency}</p>
                                    {w.is_primary && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-amber-100 text-amber-800">
                                            Principal
                                        </span>
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-500">
                                    {crypto ? 'Crypto' : 'Fiat'} · {w.account_type ?? 'main'}
                                </p>
                            </div>
                        </div>
                        <p className={`font-mono font-bold text-right ${balanceCls}`}>
                            {Number(w.balance).toLocaleString(locale, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: decimals,
                            })}
                        </p>
                    </div>
                );
            })}
        </div>
    );
};
