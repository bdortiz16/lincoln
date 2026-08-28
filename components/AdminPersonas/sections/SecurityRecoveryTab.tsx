import React, { useEffect, useState } from 'react';
import { Mail, KeyRound, Shield, Copy, Wand2, LogOut, LifeBuoy } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { NAVY, TEAL } from './shared';

// ─────────────────────────────────────────────
// Seguridad / Recuperación de acceso: cuando el usuario perdió el acceso a
// su correo (y sin correo no puede resetear clave ni 2FA), el admin puede
// desde acá cambiar el correo de login, asignar una contraseña temporal,
// apagar el 2FA y resetear el PIN. Todo pasa por el RPC
// admin_recover_user_access (SECURITY DEFINER, solo super_admin/support/
// compliance) de la migración 2026_2fa_and_recovery.sql /
// 2026_2fa_hardening.sql.
//
// Se usa en UserDetailDrawer (tab Seguridad) y en KycDetailModal (tab
// Seguridad del modal de Compliance → KYC). Carga la fila del usuario por
// su cuenta para no depender de lo que el padre tenga hidratado.
// ─────────────────────────────────────────────
export const SecurityRecoveryTab: React.FC<{
    userId: string;
    profile: AdminProfile;
    confirm: (opts: any) => Promise<boolean>;
    onChanged?: () => void | Promise<void>;
}> = ({ userId, profile, confirm, onChanged }) => {
    const [user, setUser] = useState<any>(null);
    const [newEmail, setNewEmail] = useState('');
    const [tempPw, setTempPw] = useState('');
    const [reset2fa, setReset2fa] = useState(false);
    const [resetPin, setResetPin] = useState(false);
    const [closeSessions, setCloseSessions] = useState(true);
    const [busy, setBusy] = useState(false);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [copied, setCopied] = useState(false);

    const loadUser = async () => {
        const { data } = await supabasePersonas
            .from('users').select('*').eq('id', userId).maybeSingle();
        setUser(data ?? null);
    };
    useEffect(() => { loadUser(); }, [userId]);

    const genPassword = () => {
        // Sin caracteres ambiguos (0/O, 1/l/I) para poder dictarla por teléfono
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        const buf = new Uint32Array(10);
        crypto.getRandomValues(buf);
        setTempPw('Cuy-' + Array.from(buf, n => chars[n % chars.length]).join(''));
        setCopied(false);
    };

    const copyPw = async () => {
        try {
            await navigator.clipboard.writeText(tempPw);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard puede estar bloqueado; el input queda visible */ }
    };

    const emailOk = !newEmail.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail.trim());
    const pwOk = !tempPw || tempPw.length >= 8;
    const hasChanges = !!newEmail.trim() || !!tempPw || reset2fa || resetPin;

    const apply = async () => {
        const summary: string[] = [];
        if (newEmail.trim()) summary.push(`cambiar el correo a ${newEmail.trim().toLowerCase()}`);
        if (tempPw) summary.push('asignar una contraseña temporal');
        if (reset2fa) summary.push('apagar el 2FA');
        if (resetPin) summary.push('resetear el PIN');
        if (closeSessions) summary.push('cerrar todas las sesiones activas');

        const ok = await confirm({
            title: 'Recuperar acceso',
            message: `Se va a: ${summary.join(', ')}. ¿Continuar?`,
            variant: 'warning',
            confirmLabel: 'Aplicar',
        });
        if (!ok) return;

        setBusy(true);
        const { data, error } = await supabasePersonas.rpc('admin_recover_user_access', {
            p_user_id: userId,
            p_new_email: newEmail.trim() || null,
            p_temp_password: tempPw || null,
            p_reset_2fa: reset2fa,
            p_reset_pin: resetPin,
            p_close_sessions: closeSessions,
        });
        setBusy(false);

        if (error) {
            if (/admin_recover_user_access|schema cache|does not exist|not find/i.test(error.message)) {
                setNeedsSetup(true);
                return;
            }
            await confirm({
                title: 'Error',
                message: error.message,
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
            return;
        }

        await logAdminAction({
            admin: profile,
            action: 'user_recover_access',
            targetType: 'user',
            targetId: userId,
            metadata: {
                email: user?.email,
                applied: (data as any)?.applied ?? summary,
                new_email: newEmail.trim() || undefined,
            },
        });

        await confirm({
            title: 'Acceso recuperado',
            message: tempPw
                ? 'Cambios aplicados. Comparte la contraseña temporal con el usuario por un canal seguro y pídele que la cambie al entrar.'
                : 'Cambios aplicados. El usuario ya puede volver a entrar.',
            variant: 'success',
            alertOnly: true,
        });

        setNewEmail('');
        setTempPw('');
        setReset2fa(false);
        setResetPin(false);
        await loadUser();
        await onChanged?.();
    };

    return (
        <div className="space-y-4">
            {/* Estado actual */}
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="font-bold text-sm" style={{ color: user?.is_2fa_enabled ? '#047857' : NAVY }}>
                        {user?.is_2fa_enabled ? 'Activo' : 'Inactivo'}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">2FA</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="font-bold text-sm" style={{ color: NAVY }}>{user?.pin_hash ? 'Sí' : 'No'}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">PIN</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="font-bold text-sm truncate" style={{ color: NAVY }} title={user?.email}>
                        {user?.email ?? '—'}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Correo actual</p>
                </div>
            </div>

            <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex items-start gap-2 text-sm text-slate-700">
                <LifeBuoy size={16} className="mt-0.5 shrink-0" style={{ color: TEAL }} />
                <p>
                    <strong>Recuperación de acceso:</strong> si el usuario perdió el acceso a su correo y por eso
                    no puede resetear su clave ni su 2FA, desde acá puedes devolverle el acceso. Verifica su
                    identidad por otro canal (videollamada, documento) antes de aplicar cambios.
                </p>
            </div>

            {needsSetup && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                    <p className="font-semibold mb-1">Falta la migración en Supabase</p>
                    <p>
                        El RPC <code>admin_recover_user_access</code> no existe todavía. Pega el contenido de{' '}
                        <code>supabase/migrations/2026_2fa_hardening.sql</code> en el SQL Editor del proyecto
                        Personas y vuelve a intentar.
                    </p>
                </div>
            )}

            {/* Cambiar correo */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                    <Mail size={15} className="text-slate-500" />
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Cambiar correo de acceso</p>
                </div>
                <p className="text-xs text-slate-500">
                    Cambia el correo con el que inicia sesión (queda confirmado de inmediato, sin verificación
                    por email — para eso es esta herramienta).
                </p>
                <input
                    type="email"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="nuevo-correo@ejemplo.com"
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${emailOk ? 'border-slate-200' : 'border-red-300 bg-red-50'}`}
                />
                {!emailOk && <p className="text-xs text-red-600">Ese correo no parece válido.</p>}
            </div>

            {/* Contraseña temporal */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                    <KeyRound size={15} className="text-slate-500" />
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Contraseña temporal</p>
                </div>
                <p className="text-xs text-slate-500">
                    Asigna una clave provisional (mínimo 8 caracteres). Compártela por un canal seguro y pide al
                    usuario cambiarla al entrar.
                </p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={tempPw}
                        onChange={e => { setTempPw(e.target.value); setCopied(false); }}
                        placeholder="Deja vacío para no cambiarla"
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm font-mono ${pwOk ? 'border-slate-200' : 'border-red-300 bg-red-50'}`}
                    />
                    <button
                        onClick={genPassword}
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
                        title="Generar contraseña segura"
                    >
                        <Wand2 size={14} /> Generar
                    </button>
                    {tempPw && (
                        <button
                            onClick={copyPw}
                            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
                            title="Copiar"
                        >
                            <Copy size={14} /> {copied ? 'Copiada ✓' : 'Copiar'}
                        </button>
                    )}
                </div>
                {!pwOk && <p className="text-xs text-red-600">Mínimo 8 caracteres.</p>}
            </div>

            {/* Resets */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Shield size={15} className="text-slate-500" />
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Resets</p>
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={reset2fa} onChange={e => setReset2fa(e.target.checked)} className="mt-0.5" />
                    <span>
                        <strong>Apagar 2FA</strong>
                        <span className="block text-xs text-slate-500">
                            Borra el secreto TOTP; el usuario podrá entrar sin código y reconfigurarlo después.
                        </span>
                    </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={resetPin} onChange={e => setResetPin(e.target.checked)} className="mt-0.5" />
                    <span>
                        <strong>Resetear PIN</strong>
                        <span className="block text-xs text-slate-500">La app le pedirá crear un PIN nuevo.</span>
                    </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={closeSessions} onChange={e => setCloseSessions(e.target.checked)} className="mt-0.5" />
                    <span>
                        <strong className="flex items-center gap-1"><LogOut size={12} /> Cerrar sesiones activas</strong>
                        <span className="block text-xs text-slate-500">
                            Recomendado: invalida los dispositivos ya logueados (por si la cuenta estaba comprometida).
                        </span>
                    </span>
                </label>
            </div>

            <button
                onClick={apply}
                disabled={busy || !hasChanges || !emailOk || !pwOk}
                style={{ backgroundColor: NAVY }}
                className="w-full text-white font-semibold px-4 py-2.5 rounded-xl text-sm disabled:opacity-50"
            >
                {busy ? 'Aplicando…' : 'Aplicar recuperación de acceso'}
            </button>
        </div>
    );
};
