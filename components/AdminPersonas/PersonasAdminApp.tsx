import React, { useEffect, useState } from 'react';
import { supabasePersonas } from '../../lib/supabaseClient';
import { PersonasAdminLogin } from './PersonasAdminLogin';
import { PersonasAdminDashboard } from './PersonasAdminDashboard';
import { fetchCurrentAdminProfile, type AdminProfile } from './lib/adminAuth';
import { ToastProvider } from './lib/toast';

/**
 * Root del panel admin de Personas (URL /admin-personas).
 *
 * Verifica que el usuario tenga `admin_role` (no solo is_admin)
 * para soportar la jerarquía de roles delegados:
 *  - super_admin → ve todo
 *  - compliance  → KYC, monitoreo AML
 *  - treasury    → cuentas, transacciones, conciliación
 *  - audit       → solo lectura
 *  - support     → soporte limitado
 */
export const PersonasAdminApp: React.FC = () => {
    const [state, setState] = useState<'login' | 'verifying' | 'authed'>('login');
    const [profile, setProfile] = useState<AdminProfile | null>(null);

    // Verifica si ya hay sesión + rol válido
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data: { session } } = await supabasePersonas.auth.getSession();
            if (cancelled) return;
            if (!session?.user) return; // se queda en 'login'

            setState('verifying');
            const p = await fetchCurrentAdminProfile();

            if (cancelled) return;
            if (p) {
                setProfile(p);
                setState('authed');
            } else {
                // Sesión sin rol → cerrar
                await supabasePersonas.auth.signOut();
                setState('login');
            }
        })().catch(() => {
            if (!cancelled) setState('login');
        });
        return () => { cancelled = true; };
    }, []);

    const handleLoginSuccess = async () => {
        const p = await fetchCurrentAdminProfile();
        if (!p) {
            await supabasePersonas.auth.signOut();
            return;
        }
        setProfile(p);
        setState('authed');
    };

    const handleLogout = () => {
        setState('login');
        setProfile(null);
        supabasePersonas.auth.signOut().catch(() => {/* silencioso */});
    };

    if (state === 'verifying') {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#070808' }}>
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-[#4ADE80] rounded-full animate-spin" />
                    <p className="text-white/40 text-xs tracking-widest uppercase">Verificando admin</p>
                </div>
            </div>
        );
    }

    if (state === 'authed' && profile) {
        return (
            <ToastProvider>
                <PersonasAdminDashboard profile={profile} onLogout={handleLogout} />
            </ToastProvider>
        );
    }

    return <PersonasAdminLogin onLoginSuccess={handleLoginSuccess} />;
};
