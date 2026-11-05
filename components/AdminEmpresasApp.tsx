import React, { useState, useEffect, useCallback } from 'react';
import { ThemeProvider } from '../context/ThemeContext';
import { SystemConfigProvider } from '../context/SystemConfigContext';
import { DatabaseProvider, useDatabase } from '../context/DatabaseContext';
import { ExchangeRateProvider } from '../context/ExchangeRateContext';
import { ToastProvider } from './AdminPersonas/lib/toast';
import { setRatesDbClient } from './AdminPersonas/sections/RatesPanel';
import { supabase, enlaceClave, marcarEnlaceClave, olvidarEnlaceClave } from '../lib/supabaseClient';
import { AdminDashboard } from './AdminDashboard';
import { AdminIdleGuard } from './AdminIdleGuard';
import { Logo } from './Logo';
import { TurnstileWidget, captchaEnabled } from './TurnstileWidget';
import { Lock, LogOut, ShieldCheck, Fingerprint } from 'lucide-react';
import { SelectorPais, paisElegido, olvidarPais, type PaisDisponible } from './SelectorPais';
import { ActivarDosPasosColaborador } from './ActivarDosPasosColaborador';
import { PromptCodigo2fa } from './PromptCodigo2fa';

// /colaboradores entra por aquí mismo: el mismo panel, con la puerta del
// equipo interno. Cambian los textos, no las reglas (las pone el servidor).
// Se lee en cada render y no una vez al cargar: si un colaborador entra por
// /admin-empresas, PuertaDePais cambia la dirección a la suya y, al salir, el
// ingreso tiene que mostrarle "Colaboradores", no "Admin Empresas".
const esColaboradoresAhora = () => typeof window !== 'undefined' && /^\/colaboradores\/?$/.test(window.location.pathname);

// El token de la invitación (lincoin.me/colaboradores?invitacion=…). No se usa
// al abrir la página —los filtros de correo abren los enlaces solos y lo
// gastaban—, sino al tocar "Crear mi contraseña".
const tokenInvitacion: string | null = (() => {
    try { return new URLSearchParams(window.location.search).get('invitacion'); } catch { return null; }
})();

// ─────────────────────────────────────────────
// PuertaDePais — entre las verificaciones y el panel.
//
// Le pregunta al servidor qué rol y qué países tiene esta cuenta, y con eso
// muestra la pantalla de elección. El panel recién se dibuja después.
//
// El servidor es el que manda: esta pantalla solo ofrece lo que `mi_acceso`
// devuelve, y el filtro de datos vive allá también. Forzar esta pantalla no
// abre nada — simplemente no llegarían datos de ese país.
// ─────────────────────────────────────────────
const PuertaDePais: React.FC<{ onSalir: () => Promise<void> }> = ({ onSalir }) => {
    const { currentUser } = useDatabase();
    const [acceso, setAcceso] = useState<{ rol: string; paises: PaisDisponible[]; funciones: string[] | null } | null>(null);
    const [elegido, setElegido] = useState<string | null>(paisElegido());
    const [error, setError] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        try {
            const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
            const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
            const { data: s } = await supabase.auth.getSession();
            const jwt = s?.session?.access_token;
            const r = await fetch(`${SURL}/functions/v1/admin-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${jwt ?? SKEY}` },
                body: JSON.stringify({ action: 'mi_acceso' }),
            });
            const d = await r.json();
            if (d?.ok) setAcceso({ rol: String(d.rol ?? 'lectura'), paises: Array.isArray(d.paises) ? d.paises : [], funciones: Array.isArray(d.funciones) ? d.funciones.map(String) : null });
            else setError(d?.error ?? 'No se pudieron cargar tus permisos.');
        } catch {
            setError('No se pudieron cargar tus permisos.');
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    // La puerta según el rol que dice el servidor, no según por dónde entró:
    // un colaborador que llegó a /admin-empresas (la app de clientes manda ahí
    // a toda cuenta admin cuando todavía no sabe cuál es) queda en
    // /colaboradores. Sin recargar: la sesión y el 2FA de este ingreso siguen.
    useEffect(() => {
        if (acceso?.rol !== 'colaborador' || esColaboradoresAhora()) return;
        try { window.history.replaceState(window.history.state, '', '/colaboradores'); } catch { /* solo la dirección */ }
    }, [acceso?.rol]);

    // Si la elección guardada ya no está entre los países permitidos, se
    // descarta. Pasa cuando a alguien le cambian el alcance con la sesión
    // abierta: seguir mostrando el país anterior sería mostrarle datos que
    // ya no le corresponden.
    useEffect(() => {
        if (!acceso || !elegido) return;
        if (!acceso.paises.some((p) => p.code === elegido && p.estado === 'on')) {
            olvidarPais();
            setElegido(null);
        }
    }, [acceso, elegido]);

    if (error) {
        return (
            <div style={{ minHeight: '100vh', background: '#0C0E0D', color: '#F4F4F2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <div style={{ maxWidth: 380, textAlign: 'center' }}>
                    <p style={{ fontWeight: 800, fontSize: 17, margin: '0 0 8px' }}>No se pudieron cargar tus permisos</p>
                    <p style={{ fontSize: 13, color: '#878E88', lineHeight: 1.55, margin: '0 0 18px' }}>
                        No entrás al panel sin ellos: sin saber qué te corresponde, mostrarte todo
                        sería peor que no mostrarte nada.
                    </p>
                    <button onClick={() => { setError(null); cargar(); }}
                        style={{ background: '#4ADE80', color: '#0A0B0A', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800, cursor: 'pointer' }}>
                        Reintentar
                    </button>
                </div>
            </div>
        );
    }

    // Colaborador sin 2FA: primero lo activa. El servidor tampoco le
    // contesta nada más (falta2faColaborador); esta es la parte visible.
    const mfaOn = !!((currentUser as any)?.mfaEnabled || (currentUser as any)?.raw_data?.mfaEnabled);
    if (acceso?.rol === 'colaborador' && !mfaOn) {
        return <ActivarDosPasosColaborador onSalir={async () => { olvidarPais(); await onSalir(); }} />;
    }

    if (!elegido) {
        return (
            <SelectorPais
                paises={acceso?.paises ?? []}
                rol={acceso?.rol ?? ''}
                cargando={!acceso}
                onElegir={setElegido}
                onSalir={onSalir}
            />
        );
    }

    // Con el país ya guardado de una visita anterior, el panel se dibujaba
    // ANTES de que llegaran los permisos: sin rol, AdminDashboard es el panel
    // completo del dueño, y un colaborador veía por un momento el Dashboard,
    // todo el menú y la seguridad hasta que llegaba su rol (visto el
    // 2026-11-04 con la primera colaboradora). El panel se dibuja solo con el
    // acceso ya leído.
    if (!acceso) {
        return (
            <div style={{ minHeight: '100vh', background: '#0C0E0D', color: '#878E88', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontFamily: "'Archivo', system-ui, sans-serif" }}>
                Cargando tus permisos…
            </div>
        );
    }

    return <AdminDashboard rol={acceso.rol} paises={acceso.paises.map(p => p.code)} funciones={acceso.funciones ?? undefined} onLogout={async () => { olvidarPais(); await onSalir(); }} />;
};

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
// y el override solo debe aplicar cuando la página ES admin-empresas (o
// /colaboradores, que es el mismo panel).
if (typeof window !== 'undefined' &&
    /^\/(admin-empresas|admin|colaboradores)\/?$/.test(window.location.pathname)) {
    setRatesDbClient(supabase);
}

const AdminEmpresasInner: React.FC = () => {
    const { currentUser, isAuthLoading, loginUser, logoutUser, mfaPending, getMfaError, getLoginError, completeMFALogin, isPasswordRecovery, setNewPassword, cancelMFALogin, emailStepPending, completeEmailLogin, resendEmailCode, accountLocked, passkeyPending, loginConPasskey, mfaPasos, mfaCuenta } = useDatabase();
    const esColaboradores = esColaboradoresAhora();
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
    const [invEstado, setInvEstado] = useState<'listo' | 'usando' | 'error'>('listo');

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
                setError((esColaboradores ? 'Esta cuenta no tiene acceso de colaborador.' : 'Esta cuenta no tiene permisos de administrador.'));
                await logoutUser();
            }
            // Si es admin, currentUser se setea y el render cambia solo.
        } catch {
            setError('No se pudo iniciar sesión. Intenta de nuevo.');
        }
        setSubmitting(false);
    };

    // Se acepta el código de 6 dígitos de la app O un código de respaldo
    // (10 caracteres, formato XXXXX-XXXXX; los emitidos antes de septiembre
    // de 2026 tienen 8). El de respaldo existe justo para cuando la app o el
    // secreto ya no sirven.
    const codeReady = useBackup
        ? [8, 10].includes(mfaCode.replace(/[^A-Za-z0-9]/g, '').length)
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
            else if (user.role !== 'admin') { setMfaError((esColaboradores ? 'Esta cuenta no tiene acceso de colaborador.' : 'Esta cuenta no tiene permisos de administrador.')); await logoutUser(); }
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
            else if (user.role !== 'admin') { setMfaError((esColaboradores ? 'Esta cuenta no tiene acceso de colaborador.' : 'Esta cuenta no tiene permisos de administrador.')); await logoutUser(); }
            // Si es admin, currentUser se setea y el render cambia solo.
        } catch { setMfaError('No se pudo verificar. Intenta de nuevo.'); }
        setVerifying(false);
    };

    if (tokenInvitacion && esColaboradores) {
        const usarInvitacion = async () => {
            setInvEstado('usando');
            const { error: errInv } = await supabase.auth.verifyOtp({ token_hash: tokenInvitacion, type: 'recovery' });
            if (errInv) { olvidarEnlaceClave(); setInvEstado('error'); return; }
            // Con la sesión ya abierta, se recarga sin el token: la marca hace
            // que la pantalla abra "crear contraseña", como el enlace viejo.
            marcarEnlaceClave();
            window.location.replace('/colaboradores');
        };
        return (
            <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#0C0E0D' }}>
                <div className="w-full max-w-sm">
                    <div className="flex justify-center mb-6"><Logo variant="white" /></div>
                    <div className="bg-white rounded-2xl shadow-2xl p-6">
                        <div className="flex items-center gap-2 mb-1">
                            <ShieldCheck size={18} className="text-[#16A34A]" />
                            <h1 className="font-bold text-lg text-[#0C0E0D]">Tu acceso de colaborador</h1>
                        </div>
                        {invEstado === 'error' ? (
                            <>
                                <p className="text-sm text-slate-600 mb-4 leading-relaxed">El enlace para crear tu contraseña ya se usó o venció. Pide que te reenvíen la invitación.</p>
                                <a href="/colaboradores" className="block w-full py-3 rounded-xl text-center bg-[#0C0E0D] font-bold text-sm" style={{ color: '#FFFFFF' }}>Ir al ingreso</a>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-slate-600 mb-4 leading-relaxed">Toca el botón para crear tu contraseña. El enlace sirve una sola vez.</p>
                                <button type="button" onClick={usarInvitacion} disabled={invEstado === 'usando'}
                                    className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#161A17] font-bold text-sm disabled:opacity-60" style={{ color: '#FFFFFF' }}>
                                    {invEstado === 'usando' ? 'Abriendo…' : 'Crear mi contraseña'}
                                </button>
                            </>
                        )}
                    </div>
                    <p className="text-center text-[10px] text-white/30 mt-4">Lincoin · Panel de colaboradores</p>
                </div>
            </div>
        );
    }

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
                <PuertaDePais onSalir={async () => { await logoutUser(); }} />
                {/* La ventana de códigos para lo que se hace ANTES del panel
                    (p. ej. el colaborador activando su 2FA, que pide el código
                    del correo). El panel monta la suya encima. */}
                <PromptCodigo2fa />
            </>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#0C0E0D' }}>
            <div className="w-full max-w-sm">
                <div className="flex justify-center mb-6">
                    <Logo variant="white" business={!esColaboradores} />
                </div>
                <div className="bg-white rounded-2xl shadow-2xl p-6">
                    <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck size={18} className="text-[#16A34A]" />
                        <h1 className="font-bold text-lg text-[#0C0E0D]">{esColaboradores ? 'Colaboradores' : 'Admin Empresas'}</h1>
                    </div>
                    <p className="text-xs text-slate-500 mb-5">{esColaboradores ? 'Entra con el correo que te asignaron.' : 'Acceso exclusivo para administradores.'}</p>

                    {accountLocked ? (
                        <div className="space-y-3">
                            <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.32)' }}>
                                <p className="text-sm font-bold mb-1" style={{ color: '#F87171' }}>Cuenta bloqueada</p>
                                <p className="text-xs leading-relaxed" style={{ color: '#878E88' }}>
                                    Se bloqueó por intentos fallidos. Enviamos al titular un correo con los datos
                                    del intento y un enlace para reactivarla.
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
                            setPwdMsg(err ? `No se pudo guardar: ${err}` : esColaboradores ? '✅ Contraseña creada. Ahora entra con tu correo y tu contraseña.' : '✅ Contraseña cambiada. Ahora inicia sesión normalmente.');
                            if (!err) { setPwd1(''); setPwd2(''); }
                        }} className="space-y-3">
                            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                                <ShieldCheck size={16} className="text-[#16A34A]" />
                                <p className="text-xs text-slate-600">
                                    {esColaboradores
                                        ? <>Crea tu contraseña (mínimo 10 caracteres). Después entra con tu correo y esta contraseña.</>
                                        : <>Abriste el enlace de recuperación. Define tu contraseña nueva — este enlace <b>no</b> da acceso al panel.</>}
                                </p>
                            </div>
                            <input type="password" value={pwd1} onChange={e => setPwd1(e.target.value)} placeholder="Contraseña nueva" autoComplete="new-password"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                            <input type="password" value={pwd2} onChange={e => setPwd2(e.target.value)} placeholder="Repítela" autoComplete="new-password"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                            {pwdMsg && <p className={`text-xs rounded-xl p-2.5 border ${pwdMsg.startsWith('✅') ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'}`}>{pwdMsg}</p>}
                            <button type="submit" disabled={pwdBusy} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#161A17] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
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
                            {/* De QUÉ cuenta es el código: una sesión guardada de otra
                                persona en este computador se nota antes de escribir nada
                                (dos códigos errados bloquean la cuenta del titular). */}
                            {mfaCuenta && (
                                <p className="text-xs text-slate-500">
                                    Cuenta: <b className="text-slate-800">{mfaCuenta}</b> · ¿No es la tuya?{' '}
                                    <button type="button" onClick={() => { cancelMFALogin(); setEmailCode(''); setMfaCode(''); setMfaError(null); setResendMsg(null); setPassword(''); setUseBackup(false); }} className="underline font-semibold text-slate-800">Entrar con otra cuenta</button>
                                </p>
                            )}
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
                            <button type="submit" disabled={verifying || emailCode.length !== 6} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#161A17] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
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
                            <button type="button" onClick={handlePasskey} disabled={verifying} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#161A17] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
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
                                    ? 'Ingresa uno de tus códigos de respaldo (formato XXXXX-XXXXX). Cada uno sirve una sola vez.'
                                    : `Verificación 2 de ${mfaPasos}. Ingresa el código de 6 dígitos.`}</p>
                            </div>
                            <input
                                value={mfaCode}
                                onChange={e => setMfaCode(useBackup
                                    ? e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 11)
                                    : e.target.value.replace(/\D/g, '').slice(0, 6))}
                                autoFocus
                                inputMode={useBackup ? 'text' : 'numeric'}
                                placeholder={useBackup ? 'ABCD-2345' : '123 456'}
                                className="w-full px-3 py-3 rounded-xl border border-slate-200 text-center font-mono text-lg tracking-widest focus:border-[#4ADE80] outline-none"
                            />
                            {mfaError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{mfaError}</p>}
                            <button type="submit" disabled={verifying || !codeReady} style={{ color: '#FFFFFF' }} className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#161A17] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
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
                    {/* El enlace del correo (crear o recuperar la contraseña) se
                        abrió vencido o ya usado: Supabase vuelve con un error
                        en la URL y antes no se decía nada. */}
                    {enlaceClave.error && !currentUser && (
                        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                            {enlaceClave.error === 'vencido'
                                ? (esColaboradores ? 'El enlace para crear tu contraseña ya se usó o venció. Pide que te reenvíen la invitación.' : 'El enlace del correo ya se usó o venció. Pide uno nuevo.')
                                : 'No se pudo abrir el enlace del correo. Pide que te lo reenvíen.'}
                        </div>
                    )}
                    {currentUser && currentUser.role !== 'admin' && (
                        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                            Tu sesión actual ({currentUser.email}) no es de administrador.
                            <button onClick={() => logoutUser()} className="ml-1 font-bold underline">Cerrar sesión</button>
                        </div>
                    )}

                    {/* Al guardar la contraseña la pantalla pasa sola al login
                        (se cierra la sesión del enlace): el aviso se muestra
                        acá, si no se perdía con el formulario anterior. */}
                    {pwdMsg?.startsWith('✅') && (
                        <p className="mb-3 text-xs rounded-xl p-2.5 border text-green-700 bg-green-50 border-green-200">{pwdMsg}</p>
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
                            className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#161A17] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                        >
                            <Lock size={14} /> {submitting ? 'Ingresando…' : 'Ingresar'}
                        </button>
                    </form>
                    </>)}
                </div>
                <p className="text-center text-[10px] text-white/30 mt-4">
                    {esColaboradores ? 'Lincoin · Panel de colaboradores' : 'Lincoin · Panel de administración de empresas'}
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
