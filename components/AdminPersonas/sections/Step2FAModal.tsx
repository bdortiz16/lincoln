import React, { useEffect, useState } from 'react';
import { Shield, X, AlertTriangle, KeyRound } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { NAVY, TEAL } from './shared';

/**
 * Step-up MFA: pide código TOTP del Authenticator antes de ejecutar
 * una acción crítica (aprobar / rechazar transacción, etc.).
 *
 * Uso:
 *   <Step2FAModal
 *       action="aprobar esta transacción"
 *       onConfirmed={() => doApprove()}
 *       onClose={() => setShow(false)}
 *   />
 *
 * Comportamiento:
 * - Si el admin no tiene factor MFA TOTP enrollado, muestra un cartel
 *   pidiéndole que active 2FA en Seguridad → MFA primero. (Bloquea la
 *   acción crítica.)
 * - Si tiene factor enrollado, pide código de 6 dígitos.
 * - Llama supabase.auth.mfa.challenge() + verify() contra el factor.
 * - Solo dispara onConfirmed() si el código es correcto.
 */
export const Step2FAModal: React.FC<{
    action: string;
    onConfirmed: () => void | Promise<void>;
    onClose: () => void;
}> = ({ action, onConfirmed, onClose }) => {
    const [factorId, setFactorId] = useState<string | null>(null);
    const [checkingFactor, setCheckingFactor] = useState(true);
    const [code, setCode] = useState('');
    const [err, setErr] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);

    useEffect(() => {
        (async () => {
            const { data } = await supabasePersonas.auth.mfa.listFactors();
            const verified = data?.totp?.find(f => f.status === 'verified');
            setFactorId(verified?.id ?? null);
            setCheckingFactor(false);
        })();
    }, []);

    const submit = async () => {
        if (!factorId) return;
        if (!/^\d{6}$/.test(code)) {
            setErr('Ingresa los 6 dígitos del código');
            return;
        }
        setVerifying(true);
        setErr(null);
        try {
            const ch = await supabasePersonas.auth.mfa.challenge({ factorId });
            if (ch.error) throw ch.error;
            const vr = await supabasePersonas.auth.mfa.verify({
                factorId,
                challengeId: ch.data!.id,
                code,
            });
            if (vr.error) throw vr.error;
            await onConfirmed();
            onClose();
        } catch (e: any) {
            setErr(e?.message ?? 'Código inválido');
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${TEAL}33` }}>
                        <Shield size={18} color={NAVY} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-base" style={{ color: NAVY }}>Confirmación 2FA requerida</p>
                        <p className="text-xs text-slate-500 mt-0.5">Vas a {action}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
                        <X size={18} className="text-slate-500" />
                    </button>
                </div>

                <div className="p-5">
                    {checkingFactor && <p className="text-sm text-slate-400">Verificando 2FA...</p>}

                    {!checkingFactor && !factorId && (
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                            <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-semibold text-sm text-red-800">No tenés 2FA activado</p>
                                <p className="text-xs text-red-700 mt-1">
                                    Para aprobar o rechazar transacciones necesitás tener 2FA activo.
                                    Ve a <strong>Seguridad → MFA</strong> y enrollá tu Authenticator antes de continuar.
                                </p>
                            </div>
                        </div>
                    )}

                    {!checkingFactor && factorId && (
                        <>
                            <p className="text-sm text-slate-600 mb-3">
                                Ingresá el código de 6 dígitos que muestra tu app de Authenticator (Google Authenticator, 1Password, Authy, etc.)
                            </p>
                            <div className="relative">
                                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={code}
                                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="123 456"
                                    autoFocus
                                    inputMode="numeric"
                                    className="w-full pl-10 pr-3 py-3 rounded-lg border border-slate-200 focus:border-green-500 outline-none font-mono text-lg tracking-widest text-center"
                                    onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                                />
                            </div>
                            {err && (
                                <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</p>
                            )}
                        </>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
                        Cancelar
                    </button>
                    {factorId && (
                        <button
                            onClick={submit}
                            disabled={verifying || code.length !== 6}
                            style={{ backgroundColor: NAVY }}
                            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
                        >
                            {verifying ? 'Verificando...' : 'Confirmar'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
