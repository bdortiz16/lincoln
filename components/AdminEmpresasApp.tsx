import React, { useState } from 'react';
import { ThemeProvider } from '../context/ThemeContext';
import { SystemConfigProvider } from '../context/SystemConfigContext';
import { DatabaseProvider, useDatabase } from '../context/DatabaseContext';
import { ExchangeRateProvider } from '../context/ExchangeRateContext';
import { ToastProvider } from './AdminPersonas/lib/toast';
import { setRatesDbClient } from './AdminPersonas/sections/RatesPanel';
import { supabase } from '../lib/supabaseClient';
import { AdminDashboard } from './AdminDashboard';
import { AdminIdleGuard } from './AdminIdleGuard';
import { Logo } from './Logo';
import { TurnstileWidget, captchaEnabled } from './TurnstileWidget';
import { Lock, LogOut, ShieldCheck, Fingerprint } from 'lucide-react';

// ─────────────────────────────────────────────
// AdminEmpresasApp — /admin-empresas (y /admin)
//
// Ruta AISLADA con su PROPIO login, igual que /admin-personas: no pasa
// por la landing ni por el routing por roles de App.tsx (que generaba
// bugs de ingreso: redirecciones al dashboard de cliente, splash
// intermedio, etc.). Aquí solo existen dos estados: login de admin o
// el AdminDashboard.
// ─────────────────────────────────────────────

// El panel de Tasas del admin de Empresas lee/escribe en el PROPIO
// proyecto de empresas (feed fastforex-sync + tablas de
// 2026_fx_snapshots_empresas.sql), no en LincoinANDROID.
// Guard por ruta: este módulo vive en el mismo bundle que /admin-personas
// y el override solo debe aplicar cuando la página ES admin-empresas.
if (typeof window !== 'undefined' &&
    (window.location.pathname === '/admin-empresas' || window.location.pathname === '/admin')) {
    setRatesDbClient(supabase);
}

const AdminEmpresasInner: React.FC = () => {
    const { currentUser, isAuthLoading, loginUser, logoutUser, mfaPending, getMfaError, getLoginError, completeMFALogin, isPasswordRecovery, setNewPassword, cancelMFALogin, emailStepPending, completeEmailLogin, resendEmailCode, accountLocked, passkeyPending, loginConPasskey, mfaPasos } = useDatabase();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mfaCode, setMfaCode] = useState('');
    const [mfaError, setMfaError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [captchaToken, setCaptchaToken] = useState('');
    const [captchaKey, setCaptchaKey] = useState(0);
    const [useBackup, setUseBackup] = useState(false);
    const [emailCode, setEmailCode] = useState('');
    const [resendMsg, setResendMsg] = useState<string | null>(null);
    const [pwd1, setPwd1] = useState('');
    const [pwd2, setPwd2] = useState('');
    const [pwdMsg, setPwdMsg] = useState<string | null>(null);
    const [pwdBusy, setPwdBusy] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (captchaEnabled && !captchaToken) { setError('Completa la verificación anti-bot (CAPTCHA).'); return; }
        setSubmitting(true);
        setError(null);
        try {
            const result = await loginUser(email.trim(), password, captchaToken || undefined);
            // El token de CAPTCHA es de un solo uso — se resetea para el próximo intento.
            setCaptchaToken(''); setCaptchaKey(k => k + 1);
            // 2FA pendiente: la contraseña FUE correcta. La pantalla cambia al
            // paso del código (vía mfaPending). No mostrar "credenciales".
            if (result === 'MFA_REQUIRED') { setSubmitting(false); return; }
            const user = result;
            if (!user) {
                setError(getLoginError() ?? 'Credenciales incorrectas.');
            } else if (user.role !== 'admin') {
                setError('Esta cuenta no tiene permisos de administrador.');
                await logoutUser();
            }
            // Si es admin, currentUser se setea y el render cambia solo.
        } catch {
            setError('No se pudo iniciar sesión. Intenta de nuevo.');
        }
        setSubmitting(false);
    };

    // Se acepta el código de 6 dígitos de la app O un código de respaldo
    // (8 caracteres, formato XXXX-XXXX). El de respaldo existe justo para
    // cuando la app o el secreto ya no sirven.
    const codeReady = useBackup
        ? mfaCode.replace(/[^A-Za-z0-9]/g, '').length === 8
        : mfaCode.length === 6;

    // Paso 2: el código que llegó al correo.
    const handleVerifyEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (emailCode.length !== 6 || verifying) return;
        setVerifying(true); setMfaError(null);
        try {
            await completeEmailLogin(emailCode);
            // Si hubo error, el contexto lo deja escrito; si no, la pantalla
            // avanza sola al paso del código de la app.
            const err = getMfaError();
            if (err) setMfaError(err);
            setEmailCode('');
        } catch { setMfaError('No se pudo verificar. Intenta de nuevo.'); }
        setVerifying(false);
    };

    // Último paso: la llave del dispositivo. No reemplaza al código de la app
    // —va después—, y sale de un clic a propósito: el navegador no abre el
    // lector de huella sin que alguien lo pida.
    const handlePasskey = async () => {
        if (verifying) return;
        setVerifying(true); setMfaError(null);
        try {
            const user = await loginConPasskey();
            if (!user) setMfaError(getMfaError() ?? 'La llave no se pudo verificar.');
            else if (user.role !== 'admin') { setMfaError('Esta cuenta no tiene permisos de administrador.'); await logoutUser(); }
        } catch { setMfaError('No se pudo verificar la llave.'); }
        setVerifying(false);
    };

    const handleVerify2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!codeReady || verifying) return;
        setVerifying(true); setMfaError(null);
        try {
            const user = await completeMFALogin(mfaCode);
            // Sin usuario NO siempre es un fallo: con llave registrada, el
            // código correcto avanza al tercer paso sin abrir la sesión. El
            // contexto deja escrito un mensaje solo cuando de verdad falló.
            if (!user) { const err = getMfaError(); if (err) setMfaError(err); else setMfaCode(''); }
            else if (user.role !== 'admin') { setMfaError('Esta cuenta no tiene permisos de administrador.'); await logoutUser(); }
            // Si es admin, currentUser se setea y el render cambia solo.
        } catch { setMfaError('No se pudo verificar. Intenta de nuevo.'); }
        setVerifying(false);
    };

    if (isAuthLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0C0E0D' }}>
                <p className="text-white/60 text-sm font-medium tracking-widest uppercase">Verificando sesión…</p>
            </div>
        );
    }

    if (currentUser?.role === 'admin') {
        return (
            <>
                {/* Media hora sin uso y el panel se cierra solo. El corte de
                    verdad está en el servidor; esto es la parte visible. */}
                <AdminIdleGuard userId={currentUser.id} onCerrar={async () => { await logoutUser(); }} />
                <AdminDashboard onLogout={async () => { await logoutUser(); }} />
            </>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#0C0E0D' }}>
            <div className="w-full max-w-sm">
                <div className="flex justify-center mb-6">
                    <Logo variant="white" business />
                </div>
                <div className="bg-white rounded-2xl shadow-2xl p-6">
                    <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck size={18} className="text-[#16A34A]" />
                        <h1 className="font-bold text-lg text-[#0C0E0D]">Admin Empresas</h1>
                    </div>
                    <p className="text-xs text-slate-500 mb-5">Acceso exclusivo para administradores.</p>

                    {accountLocked ? (
                        <div className="space-y-3">
                            <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.32)' }}>
                                <p className="text-sm font-bold mb-1" style={{ color: '#F87171' }}>Cuenta bloqueada</p>
                                <p className="text-xs leading-relaxed" style={{ color: '#878E88' }}>
                                    Se bloqueó por intentos fallidos. Enviamos al titular un correo con los datos
                                    del intento y un enlace para reactivarla. También se bloqueó la conexión desde
                                    donde se hicieron los intentos.
                                </p>
                            </div>
                            <button type="button" onClick={() => { cancelMFALogin(); setMfaCode(''); setEmailCode(''); setMfaError(null); setPassword(''); setUseBackup(false); }}
                                className="w-full py-3 rounded-xl text-sm font-bold" style={{ backgroundColor: '#121413', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }}>
                                Volver al inicio
                            </button>
                        </div>
                    ) : isPasswordRecovery ? (
                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            if (pwd1.length < 10) { setPwdMsg('Usa al menos 10 caracteres.'); return; }
                            if (pwd1 !== pwd2) { setPwdMsg('Las dos contraseñas no coinciden.'); return; }
                            setPwdBusy(true); setPwdMsg(null);
                            const err = await setNewPassword(pwd1);
                            setPwdBusy(false);
                            setPwdMsg(err ? `No se pudo cambiar: ${err}` : '✅ Contraseña cambiada. Ahora inicia sesión normalmente.');
                            if (!err) { setPwd1(''); setPwd2(''); }
                        }} className="space-y-3">
                            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                                <ShieldCheck size={16} className="text-[#16A34A]" />
                                <p className="text-xs text-slate-600">
                                    Abriste el enlace de recuperación. Define tu contraseña nueva — este enlace <b>no</b> da acceso al panel.
                                </p>
                            </div>
                            <input type="password" value={pwd1} onChange={e => setPwd1(e.target.value)} placeholder="Contraseña nueva" autoComplete="new-password"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                            <input type="password" value={pwd2} onChange={e => setPwd2(e.target.value)} placeholder="Repítela" autoComplete="new-password"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                            {pwdMsg && <p className={`text-xs rounded-xl p-2.5 border ${pwdMsg.startsWith('✅') ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'}`}>{pwdMsg}</p>}
                            <button type="submit" disabled={pwdBusy} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#152e52] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                                <Lock size={14} /> {pwdBusy ? 'Guardando…' : 'Guardar contraseña'}
                            </button>
                        </form>
                    ) : emailStepPending ? (
                        <form onSubmit={handleVerifyEmail} className="space-y-3">
                            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                                <ShieldCheck size={16} className="text-[#16A34A]" />
                                <p className="text-xs text-slate-600">
                                    Verificación 1 de {mfaPasos}. Ingresa el código de 6 dígitos.
                                </p>
                            </div>
                            <input
                                value={emailCode}
                                onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                autoFocus
                                inputMode="numeric"
                                placeholder="123 456"
                                className="w-full px-3 py-3 rounded-xl border border-slate-200 text-center font-mono text-lg tracking-widest focus:border-[#4ADE80] outline-none"
                            />
                            {mfaError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{mfaError}</p>}
                            {resendMsg && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-2.5">{resendMsg}</p>}
                            <button type="submit" disabled={verifying || emailCode.length !== 6} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#152e52] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
                                <Lock size={14} /> {verifying ? 'Verificando…' : 'Continuar'}
                            </button>
                            <button type="button" onClick={async () => { setResendMsg('Enviando…'); const ok = await resendEmailCode(); setResendMsg(ok ? 'Código reenviado.' : 'No se pudo reenviar. Espera un momento.'); }} className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 underline">
                                Reenviar código
                            </button>
                            <button type="button" onClick={() => { cancelMFALogin(); setEmailCode(''); setMfaCode(''); setMfaError(null); setResendMsg(null); setPassword(''); setUseBackup(false); }} className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800">
                                Cancelar
                            </button>
                        </form>
                    ) : passkeyPending ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                                <ShieldCheck size={16} className="text-[#16A34A]" />
                                <p className="text-xs text-slate-600">
                                    Verificación {mfaPasos} de {mfaPasos}. Confirma con tu llave.
                                </p>
                            </div>
                            {mfaError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{mfaError}</p>}
                            <button type="button" onClick={handlePasskey} disabled={verifying} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#152e52] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
                                <Fingerprint size={15} /> {verifying ? 'Esperando…' : 'Continuar'}
                            </button>
                            <button type="button" onClick={() => { cancelMFALogin(); setEmailCode(''); setMfaCode(''); setMfaError(null); setResendMsg(null); setPassword(''); setUseBackup(false); }} className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800">
                                Cancelar
                            </button>
                        </div>
                    ) : mfaPending ? (
                        <form onSubmit={handleVerify2FA} className="space-y-3">
                            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                                <ShieldCheck size={16} className="text-[#16A34A]" />
                                <p className="text-xs text-slate-600">{useBackup
                                    ? 'Ingresa uno de tus códigos de respaldo (formato XXXX-XXXX). Cada uno sirve una sola vez.'
                                    : `Verificación 2 de ${mfaPasos}. Ingresa el código de 6 dígitos.`}</p>
                            </div>
                            <input
                                value={mfaCode}
                                onChange={e => setMfaCode(useBackup
                                    ? e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9)
                                    : e.target.value.replace(/\D/g, '').slice(0, 6))}
                                autoFocus
                                inputMode={useBackup ? 'text' : 'numeric'}
                                placeholder={useBackup ? 'ABCD-2345' : '123 456'}
                                className="w-full px-3 py-3 rounded-xl border border-slate-200 text-center font-mono text-lg tracking-widest focus:border-[#4ADE80] outline-none"
                            />
                            {mfaError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{mfaError}</p>}
                            <button type="submit" disabled={verifying || !codeReady} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#152e52] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
                                <Lock size={14} /> {verifying ? 'Verificando…' : 'Verificar código'}
                            </button>
                            <button type="button" onClick={() => { setUseBackup(v => !v); setMfaCode(''); setMfaError(null); }} className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 underline">
                                {useBackup ? 'Volver al código normal' : 'Usar un código de respaldo'}
                            </button>
                            <button type="button" onClick={() => { cancelMFALogin(); setMfaCode(''); setMfaError(null); setPassword(''); setUseBackup(false); }} className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800">
                                Cancelar
                            </button>
                        </form>
                    ) : (<>
                    {currentUser && currentUser.role !== 'admin' && (
                        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                            Tu sesión actual ({currentUser.email}) no es de administrador.
                            <button onClick={() => logoutUser()} className="ml-1 font-bold underline">Cerrar sesión</button>
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-3">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Correo</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                autoComplete="username"
                                required
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none"
                                placeholder="correo@empresa.com"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Contraseña</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoComplete="current-password"
                                required
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none"
                                placeholder="••••••••"
                            />
                        </div>
                        {captchaEnabled && <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaKey} className="flex justify-center" />}
                        {error && (
                            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{error}</p>
                        )}
                        <button
                            type="submit"
                            disabled={submitting || (captchaEnabled && !captchaToken)}
                            style={{ color: '#FFFFFF' }}
                            className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#152e52] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                        >
                            <Lock size={14} /> {submitting ? 'Ingresando…' : 'Ingresar'}
                        </button>
                    </form>
                    </>)}
                </div>
                <p className="text-center text-[10px] text-white/30 mt-4">
                    Lincoin · Panel de administración de empresas
                </p>
            </div>
        </div>
    );
};

export const AdminEmpresasApp: React.FC = () => (
    <ThemeProvider>
        <SystemConfigProvider>
            <DatabaseProvider>
                <ExchangeRateProvider>
                    <ToastProvider>
                        <AdminEmpresasInner />
                    </ToastProvider>
                </ExchangeRateProvider>
            </DatabaseProvider>
        </SystemConfigProvider>
    </ThemeProvider>
);
