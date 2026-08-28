import React, { useState } from 'react';
import { Eye, EyeOff, Terminal, AlertTriangle, Lock } from 'lucide-react';
import { supabasePersonas, isSupabasePersonasConfigured } from '../../lib/supabaseClient';

interface PersonasAdminLoginProps {
    onLoginSuccess: () => void;
}

const BG = '#070808';      // navy más oscuro que la web de Empresas
const BG_CARD = '#111827';
const BORDER = '#1F2937';
const TEAL = '#4ADE80';
const TEXT_MUTED = '#64748B';

/**
 * Login del panel de admin Personas.
 *
 * Diseño intencionalmente distinto a la web pública de Empresas:
 *  - Fondo muy oscuro (no gradiente bonito)
 *  - Tipografía monoespaciada (look "consola/backend")
 *  - Sin logo LINCOIN grande (para no confundirse con la web pública)
 *  - Etiquetas claras: BACKEND · PERSONAS · ADMIN
 */
export const PersonasAdminLogin: React.FC<PersonasAdminLoginProps> = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async () => {
        setError(null);
        if (!isSupabasePersonasConfigured) {
            setError('Supabase Personas no está configurado. Revisa VITE_SUPABASE_PERSONAS_URL y VITE_SUPABASE_PERSONAS_ANON_KEY en Vercel.');
            return;
        }
        if (!email.trim() || !password) {
            setError('Ingresa correo y contraseña.');
            return;
        }
        setLoading(true);
        try {
            const { data: authData, error: authError } = await supabasePersonas.auth.signInWithPassword({
                email: email.trim(),
                password,
            });
            if (authError) throw authError;
            if (!authData.user) throw new Error('No se pudo iniciar sesión.');

            // Verificar admin_role en la DB de Personas
            const { data: profile, error: profileError } = await supabasePersonas
                .from('users')
                .select('admin_role')
                .eq('id', authData.user.id)
                .maybeSingle();

            if (profileError) throw profileError;
            if (!profile?.admin_role) {
                await supabasePersonas.auth.signOut();
                throw new Error('Esta cuenta no tiene permisos de administrador.');
            }

            onLoginSuccess();
        } catch (err: any) {
            setError(err?.message || 'Error al iniciar sesión.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="min-h-screen w-full flex items-center justify-center p-4"
            style={{
                backgroundColor: BG,
                backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(45,212,191,0.08) 0%, transparent 50%)',
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
            }}
        >
            <div className="w-full max-w-md">

                {/* Header — etiquetas tipo "backend" */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Terminal size={14} color={TEAL} />
                        <span style={{ color: TEAL, fontSize: '11px', letterSpacing: '0.2em' }}>
                            LINCOIN · INTERNAL
                        </span>
                    </div>
                    <h1 className="text-white font-bold" style={{ fontSize: '20px', letterSpacing: '-0.01em' }}>
                        Backend · Personas
                    </h1>
                    <p style={{ color: TEXT_MUTED, fontSize: '13px', marginTop: '4px' }}>
                        Panel de operaciones para usuarios de la app móvil
                    </p>
                </div>

                {/* Card */}
                <div
                    className="rounded-lg overflow-hidden"
                    style={{
                        backgroundColor: BG_CARD,
                        border: `1px solid ${BORDER}`,
                    }}
                >
                    {/* Barra superior tipo IDE/terminal */}
                    <div
                        className="flex items-center gap-2 px-4 py-2.5"
                        style={{ borderBottom: `1px solid ${BORDER}`, backgroundColor: '#0C0E0D' }}
                    >
                        <div className="flex gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#EF4444' }} />
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#22C55E' }} />
                        </div>
                        <span style={{ color: TEXT_MUTED, fontSize: '11px', marginLeft: '8px' }}>
                            ~/cuypay-personas/admin
                        </span>
                    </div>

                    <div className="p-6">
                        {error && (
                            <div
                                className="mb-4 flex items-start gap-2 rounded-md p-3"
                                style={{ backgroundColor: '#3F1D1D', border: '1px solid #7F1D1D' }}
                            >
                                <AlertTriangle size={14} color="#FCA5A5" className="mt-0.5 shrink-0" />
                                <p style={{ color: '#FCA5A5', fontSize: '12px', lineHeight: 1.5 }}>{error}</p>
                            </div>
                        )}

                        <label
                            className="block mb-1.5"
                            style={{ color: TEAL, fontSize: '10px', letterSpacing: '0.15em' }}
                        >
                            $ EMAIL
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                            placeholder="adminpersonas@cuypay.com"
                            className="w-full px-3 py-2.5 rounded-md outline-none transition-colors mb-4"
                            style={{
                                backgroundColor: BG,
                                border: `1px solid ${BORDER}`,
                                color: 'white',
                                fontSize: '13px',
                                fontFamily: 'inherit',
                            }}
                            autoComplete="email"
                        />

                        <label
                            className="block mb-1.5"
                            style={{ color: TEAL, fontSize: '10px', letterSpacing: '0.15em' }}
                        >
                            $ PASSWORD
                        </label>
                        <div className="relative mb-6">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                placeholder="••••••••"
                                className="w-full px-3 py-2.5 pr-10 rounded-md outline-none transition-colors"
                                style={{
                                    backgroundColor: BG,
                                    border: `1px solid ${BORDER}`,
                                    color: 'white',
                                    fontSize: '13px',
                                    fontFamily: 'inherit',
                                }}
                                autoComplete="current-password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors hover:text-white"
                                style={{ color: TEXT_MUTED }}
                                aria-label={showPassword ? 'Ocultar' : 'Mostrar'}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>

                        <button
                            onClick={handleLogin}
                            disabled={loading}
                            className="w-full font-bold rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            style={{
                                backgroundColor: TEAL,
                                color: BG,
                                padding: '11px',
                                fontSize: '13px',
                                fontFamily: 'inherit',
                                letterSpacing: '0.05em',
                            }}
                        >
                            {loading ? (
                                <>
                                    <div className="w-3.5 h-3.5 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
                                    AUTENTICANDO…
                                </>
                            ) : (
                                <>
                                    <Lock size={14} />
                                    AUTENTICAR
                                </>
                            )}
                        </button>
                    </div>

                    {/* Footer del card */}
                    <div
                        className="px-6 py-3 flex items-center justify-between"
                        style={{ borderTop: `1px solid ${BORDER}`, backgroundColor: '#0C0E0D' }}
                    >
                        <span style={{ color: TEXT_MUTED, fontSize: '10px', letterSpacing: '0.1em' }}>
                            DB: cuypay-personas
                        </span>
                        <span style={{ color: '#22C55E', fontSize: '10px', letterSpacing: '0.1em' }}>
                            ● ONLINE
                        </span>
                    </div>
                </div>

                {/* Aviso debajo */}
                <div className="mt-6 text-center">
                    <p style={{ color: TEXT_MUTED, fontSize: '11px', lineHeight: 1.6 }}>
                        Acceso restringido a personal autorizado.<br />
                        Las credenciales son distintas a las de Empresas.
                    </p>
                </div>

            </div>
        </div>
    );
};
