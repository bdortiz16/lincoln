import React, { useEffect, useState, useCallback } from 'react';
import { Smartphone, CheckCircle2, AlertTriangle, RefreshCw, KeyRound, UserCog } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile, type AdminRole } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, NAVY, TEAL, EmptyState } from './shared';
import { AdminsSection } from './AdminsSection';

interface SecuritySectionProps {
    profile: AdminProfile;
}

type SecurityTab = 'mfa' | 'admins';

// Filtro por rol.
// Doble aprobación y Topes Operativos se movieron a Tesorería → Operaciones
// porque son config operativa de TXs, no de seguridad de cuenta.
const TABS_BY_ROLE: Record<AdminRole, SecurityTab[]> = {
    super_admin: ['mfa', 'admins'],
    treasury:    ['mfa'],
    compliance:  ['mfa'],
    audit:       ['mfa'],
    support:     ['mfa'],
};

export const SecuritySection: React.FC<SecuritySectionProps> = ({ profile }) => {
    const allowedTabs = TABS_BY_ROLE[profile.role] ?? ['mfa'];
    const [tab, setTab] = useState<SecurityTab>(allowedTabs[0] ?? 'mfa');

    const allTabs: Array<{ id: SecurityTab; label: string; icon: any }> = [
        { id: 'mfa',    label: '2FA (mi cuenta)',     icon: KeyRound },
        { id: 'admins', label: 'Administradores',     icon: UserCog },
    ];
    const visibleTabs = allTabs.filter(t => allowedTabs.includes(t.id));

    return (
        <div className="p-4 md:p-8">
            <SectionHeader
                title="Seguridad"
                subtitle="2FA y gestión de administradores"
            />

            <div className="flex gap-2 mb-6 flex-wrap">
                {visibleTabs.map(t => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                            style={{
                                backgroundColor: tab === t.id ? NAVY : 'white',
                                color: tab === t.id ? 'white' : '#475569',
                                border: '1px solid #E2E8F0',
                            }}
                        >
                            <Icon size={14} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'mfa' && <MfaTab profile={profile} />}
            {tab === 'admins' && <AdminsSection profile={profile} />}
        </div>
    );
};

// ─────────────────────────────────────────────
// 2FA (TOTP) Enrollment
// ─────────────────────────────────────────────
const MfaTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [factors, setFactors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState(false);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [secret, setSecret] = useState<string | null>(null);
    const [factorId, setFactorId] = useState<string | null>(null);
    const [verifyCode, setVerifyCode] = useState('');
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabasePersonas.auth.mfa.listFactors();
        setFactors(data?.all ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const startEnrollment = async () => {
        setError(null);
        setEnrolling(true);
        const { data, error: enrollErr } = await supabasePersonas.auth.mfa.enroll({ factorType: 'totp' });
        if (enrollErr) {
            setError(enrollErr.message);
            setEnrolling(false);
            return;
        }
        if (data) {
            setQrCode((data as any).totp?.qr_code ?? null);
            setSecret((data as any).totp?.secret ?? null);
            setFactorId(data.id);
        }
    };

    const verify = async () => {
        if (!factorId || verifyCode.length !== 6) {
            setError('Ingresa los 6 dígitos del código');
            return;
        }
        setError(null);
        const challenge = await supabasePersonas.auth.mfa.challenge({ factorId });
        if (challenge.error || !challenge.data) {
            setError(challenge.error?.message ?? 'Error generando challenge');
            return;
        }
        const verify = await supabasePersonas.auth.mfa.verify({
            factorId,
            challengeId: challenge.data.id,
            code: verifyCode,
        });
        if (verify.error) {
            setError(verify.error.message);
            return;
        }
        await logAdminAction({
            admin: profile,
            action: 'mfa_enroll',
            targetType: 'user',
            targetId: profile.id,
        });
        setEnrolling(false);
        setQrCode(null);
        setSecret(null);
        setVerifyCode('');
        await load();
    };

    const unenroll = async (id: string) => {
        const ok = await confirm({
            title: 'Desactivar 2FA',
            message: '¿Desactivar 2FA en tu cuenta? Tu cuenta quedará menos protegida.',
            variant: 'warning',
            confirmLabel: 'Desactivar',
        });
        if (!ok) return;
        await supabasePersonas.auth.mfa.unenroll({ factorId: id });
        await logAdminAction({ admin: profile, action: 'mfa_unenroll', targetType: 'user', targetId: profile.id });
        await load();
    };

    const totpFactors = factors.filter(f => f.factor_type === 'totp');
    const hasActiveTotp = totpFactors.some(f => f.status === 'verified');

    return (
        <div>
            {confirmDialog}
            {loading && <p className="text-slate-400">Cargando...</p>}

            {!loading && !enrolling && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-start gap-4 mb-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: hasActiveTotp ? `${TEAL}1A` : '#FEF3C7' }}>
                            {hasActiveTotp ? <CheckCircle2 size={24} color={TEAL} /> : <AlertTriangle size={24} color="#D97706" />}
                        </div>
                        <div className="flex-1">
                            <p className="font-bold" style={{ color: NAVY }}>
                                {hasActiveTotp ? '2FA activado' : '2FA no configurado'}
                            </p>
                            <p className="text-sm text-slate-500 mt-1">
                                {hasActiveTotp
                                    ? 'Tu cuenta requiere código TOTP en cada inicio de sesión.'
                                    : 'Recomendamos activar 2FA con Google Authenticator, 1Password u otra app TOTP.'}
                            </p>
                        </div>
                    </div>

                    {hasActiveTotp ? (
                        <div className="space-y-2">
                            {totpFactors.filter(f => f.status === 'verified').map(f => (
                                <div key={f.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
                                    <div className="flex items-center gap-3">
                                        <Smartphone size={18} className="text-slate-500" />
                                        <div>
                                            <p className="text-sm font-semibold text-slate-800">{f.friendly_name ?? 'TOTP'}</p>
                                            <p className="text-xs text-slate-500">Verificado</p>
                                        </div>
                                    </div>
                                    <button onClick={() => unenroll(f.id)} className="text-red-600 hover:bg-red-50 px-3 py-1 rounded-lg text-xs font-semibold">
                                        Desactivar
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <button onClick={startEnrollment} style={{ backgroundColor: NAVY }} className="text-white font-bold px-4 py-2.5 rounded-xl hover:opacity-90">
                            Activar 2FA
                        </button>
                    )}
                </div>
            )}

            {enrolling && qrCode && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="font-bold mb-2" style={{ color: NAVY }}>Configura 2FA</h3>
                    <ol className="text-sm text-slate-600 space-y-2 mb-4 list-decimal list-inside">
                        <li>Abre tu app de autenticación (Google Authenticator, 1Password, Authy…)</li>
                        <li>Escanea el QR o ingresa el código manualmente</li>
                        <li>Ingresa los 6 dígitos que genera la app</li>
                    </ol>

                    <div className="flex flex-col md:flex-row gap-6 items-center">
                        <div className="bg-white p-3 rounded-xl border border-slate-200">
                            {/* qr_code es un data URI svg */}
                            <img src={qrCode} alt="QR" className="w-48 h-48" />
                        </div>
                        <div className="flex-1 w-full">
                            {secret && (
                                <>
                                    <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Código manual</label>
                                    <code className="block bg-slate-100 p-2 rounded font-mono text-sm break-all mb-4">{secret}</code>
                                </>
                            )}
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Código de 6 dígitos</label>
                            <input
                                value={verifyCode}
                                onChange={e => setVerifyCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                                placeholder="123456"
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-2xl tracking-widest text-center mb-3"
                                maxLength={6}
                            />
                            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
                            <div className="flex gap-2">
                                <button onClick={verify} disabled={verifyCode.length !== 6} style={{ backgroundColor: NAVY }} className="flex-1 text-white font-bold py-2.5 rounded-xl disabled:opacity-50">
                                    Verificar
                                </button>
                                <button onClick={() => { setEnrolling(false); setQrCode(null); setSecret(null); setError(null); }} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

