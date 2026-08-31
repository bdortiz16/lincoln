import React, { useState } from 'react';
import { ThemeProvider } from '../context/ThemeContext';
import { SystemConfigProvider } from '../context/SystemConfigContext';
import { DatabaseProvider, useDatabase } from '../context/DatabaseContext';
import { ExchangeRateProvider } from '../context/ExchangeRateContext';
import { ToastProvider } from './AdminPersonas/lib/toast';
import { setRatesDbClient } from './AdminPersonas/sections/RatesPanel';
import { supabase } from '../lib/supabaseClient';
import { AdminDashboard } from './AdminDashboard';
import { Logo } from './Logo';
import { Lock, LogOut, ShieldCheck } from 'lucide-react';

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
    const { currentUser, isAuthLoading, loginUser, logoutUser } = useDatabase();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const user = await loginUser(email.trim(), password);
            if (!user) {
                setError('Credenciales incorrectas.');
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

    if (isAuthLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0C0E0D' }}>
                <p className="text-white/60 text-sm font-medium tracking-widest uppercase">Verificando sesión…</p>
            </div>
        );
    }

    if (currentUser?.role === 'admin') {
        return <AdminDashboard onLogout={async () => { await logoutUser(); }} />;
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
                        {error && (
                            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{error}</p>
                        )}
                        <button
                            type="submit"
                            disabled={submitting}
                            style={{ color: '#FFFFFF' }}
                            className="w-full py-3 rounded-xl bg-[#0C0E0D] hover:bg-[#152e52] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                        >
                            <Lock size={14} /> {submitting ? 'Ingresando…' : 'Ingresar'}
                        </button>
                    </form>
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
