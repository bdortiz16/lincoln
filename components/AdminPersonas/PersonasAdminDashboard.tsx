import React, { useEffect, useState, useCallback } from 'react';
import {
    Users, ShieldCheck, LogOut,
    Search, RefreshCw, AlertTriangle,
    TrendingUp, FileSearch, Banknote, Shield, ArrowRightLeft, Gift, BookOpen,
    Menu, X, Headphones, Scale
} from 'lucide-react';
import { CuyPayIcon } from './CuyPayIcon';
import { AccountingSection } from './sections/AccountingSection';
import { supabasePersonas } from '../../lib/supabaseClient';
import {
    canAccess, getDefaultSection, logAdminAction, PERMISSIONS,
    ROLE_LABELS, ROLE_COLORS, type AdminProfile, type Section
} from './lib/adminAuth';
import { ComplianceSection } from './sections/ComplianceSection';
import { TreasurySection } from './sections/TreasurySection';
import { RatesPanel } from './sections/RatesPanel';
import { PromotionsSection } from './sections/PromotionsSection';
import { AuditLogSection } from './sections/AuditLogSection';
import { SecuritySection } from './sections/SecuritySection';
import { UserDetailDrawer } from './sections/UserDetailDrawer';
import { OverviewSection } from './sections/OverviewSection';
import { SupportSection } from './sections/SupportSection';
import { LegalDocsSection } from './sections/LegalDocsSection';
import { SectionHeader, StatusBadge, formatDate, NAVY, TEAL, EmptyState } from './sections/shared';

interface PersonasAdminDashboardProps {
    profile: AdminProfile;
    onLogout: () => void;
}

interface PersonasUser {
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    country: string | null;
    flag: string | null;
    cuypay_id: string | null;
    kyc_status: string | null;
    is_blocked?: boolean | null;
    created_at: string;
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export const PersonasAdminDashboard: React.FC<PersonasAdminDashboardProps> = ({ profile, onLogout }) => {
    const [section, setSection] = useState<Section>(getDefaultSection(profile.role));
    const [sidebarOpen, setSidebarOpen] = useState(false); // drawer en móvil

    const navItems: Array<{ id: Section; icon: any; label: string }> = [
        { id: 'overview',      icon: TrendingUp,    label: 'Resumen' },
        { id: 'users',         icon: Users,         label: 'Usuarios' },
        { id: 'compliance',    icon: ShieldCheck,   label: 'Compliance' },
        { id: 'accounting',    icon: BookOpen,      label: 'Contabilidad' },
        { id: 'treasury',      icon: Banknote,      label: 'Tesorería' },
        { id: 'fx',            icon: ArrowRightLeft,label: 'Tasas FX' },
        { id: 'promotions',    icon: Gift,          label: 'Promociones' },
        { id: 'support',       icon: Headphones,    label: 'Soporte' },
        { id: 'legal',         icon: Scale,         label: 'Legal' },
        { id: 'audit-log',     icon: FileSearch,    label: 'Audit Log' },
        { id: 'security',      icon: Shield,        label: 'Seguridad' },
    ];

    const visibleItems = navItems.filter(item => canAccess(profile.role, item.id));
    const roleColor = ROLE_COLORS[profile.role];
    const currentLabel = visibleItems.find(i => i.id === section)?.label ?? '';

    const selectSection = (s: Section) => {
        setSection(s);
        setSidebarOpen(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 md:flex">
            {/* TOPBAR — solo móvil */}
            <header className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-200 flex items-center gap-3 px-4 py-3">
                <button
                    onClick={() => setSidebarOpen(true)}
                    className="p-2 -ml-2 rounded-lg hover:bg-slate-100"
                    aria-label="Abrir menú"
                >
                    <Menu size={22} color={NAVY} />
                </button>
                <CuyPayIcon size={32} className="rounded-lg shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-xs leading-tight" style={{ color: NAVY }}>CUYPAY · Admin</p>
                    <p className="text-xs text-slate-500 truncate">{currentLabel}</p>
                </div>
                <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: roleColor }}
                    title={ROLE_LABELS[profile.role]}
                />
            </header>

            {/* OVERLAY oscuro detrás del drawer móvil */}
            {sidebarOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/50 z-40"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* SIDEBAR — drawer en móvil, fijo en desktop */}
            <aside
                className={`
                    fixed md:static inset-y-0 left-0 z-50
                    w-72 md:w-64 bg-white border-r border-slate-200 flex flex-col
                    transform transition-transform duration-200
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:translate-x-0
                `}
            >
                <div className="p-5 md:p-6 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <CuyPayIcon size={40} className="rounded-xl shrink-0" />
                        <div className="min-w-0">
                            <p className="font-bold text-sm" style={{ color: NAVY }}>CUYPAY</p>
                            <p className="text-xs text-slate-500 uppercase tracking-wider truncate">Admin Personas</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setSidebarOpen(false)}
                        className="md:hidden p-1.5 rounded-lg hover:bg-slate-100 shrink-0"
                        aria-label="Cerrar menú"
                    >
                        <X size={18} color="#475569" />
                    </button>
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    {visibleItems.map(item => (
                        <SidebarItem
                            key={item.id}
                            icon={item.icon}
                            label={item.label}
                            active={section === item.id}
                            onClick={() => selectSection(item.id)}
                        />
                    ))}
                </nav>

                <div className="p-3 border-t border-slate-200">
                    <div className="px-3 py-3 mb-2 rounded-lg" style={{ backgroundColor: '#F8FAFC' }}>
                        <p className="text-xs text-slate-500">Sesión activa</p>
                        <p className="text-sm font-semibold text-slate-800 truncate">{profile.fullName}</p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: roleColor }} />
                            <span className="text-xs font-semibold" style={{ color: NAVY }}>
                                {ROLE_LABELS[profile.role]}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={onLogout}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <LogOut size={16} />
                        Cerrar sesión
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-auto min-w-0">
                {!canAccess(profile.role, section) ? (
                    <div className="p-4 md:p-8">
                        <EmptyState icon={AlertTriangle} title="Acceso denegado" message="No tienes permisos para esta sección" />
                    </div>
                ) : (
                    <>
                        {section === 'overview' && <OverviewSection profile={profile} />}
                        {section === 'users' && <UsersSection profile={profile} />}
                        {section === 'compliance' && <ComplianceSection profile={profile} />}
                        {section === 'accounting' && <AccountingSection profile={profile} />}
                        {section === 'treasury' && <TreasurySection profile={profile} />}
                        {section === 'fx' && (
                            <div className="p-4 md:p-8">
                                <SectionHeader title="Tasas FX" subtitle="Fuente preferida, ventana nocturna, panel de tasas en vivo y comisiones por par" />
                                <RatesPanel profile={profile} />
                            </div>
                        )}
                        {section === 'promotions' && <PromotionsSection profile={profile} />}
                        {section === 'support' && (
                            <div className="p-4 md:p-8">
                                <SupportSection profile={profile} />
                            </div>
                        )}
                        {section === 'legal' && <LegalDocsSection profile={profile} />}
                        {section === 'audit-log' && <AuditLogSection />}
                        {section === 'security' && <SecuritySection profile={profile} />}
                    </>
                )}
            </main>
        </div>
    );
};

const SidebarItem: React.FC<{ icon: any; label: string; active: boolean; onClick: () => void }> =
    ({ icon: Icon, label, active, onClick }) => (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{
                backgroundColor: active ? `${TEAL}1A` : 'transparent',
                color: active ? NAVY : '#475569',
            }}
        >
            <Icon size={18} />
            {label}
        </button>
    );

// Overview ahora vive en sections/OverviewSection.tsx (gráficos ricos, KPIs con sparklines)

// ─────────────────────────────────────────────
// Users (lectura)
// ─────────────────────────────────────────────
const UsersSection: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const [users, setUsers] = useState<PersonasUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [detailUserId, setDetailUserId] = useState<string | null>(null);

    type Bucket = 'verified' | 'pending' | 'rejected' | 'blocked' | 'other';
    // Por defecto mostramos sólo "Verificados" — son los usuarios que ya
    // completaron KYC y que el admin opera todos los días. Los pendientes
    // (que suelen ser ~80% del total) están a un click en su stat card.
    const [statusFilter, setStatusFilter] = useState<'all' | Bucket>('verified');

    const load = useCallback(async () => {
        setLoading(true);
        // Intento traer is_blocked; si la columna no existe (migración pendiente),
        // reintento sin ella para no romper la lista.
        let { data, error } = await supabasePersonas
            .from('users')
            .select('id, email, full_name, phone, country, flag, cuypay_id, kyc_status, is_blocked, created_at')
            .order('created_at', { ascending: false })
            .limit(500);
        if (error && /is_blocked/.test(error.message)) {
            const retry = await supabasePersonas
                .from('users')
                .select('id, email, full_name, phone, country, flag, cuypay_id, kyc_status, created_at')
                .order('created_at', { ascending: false })
                .limit(500);
            data = retry.data as any;
        }
        setUsers((data as PersonasUser[]) ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    // Normaliza kyc_status + is_blocked a un bucket discreto.
    const bucketOf = (u: PersonasUser): Bucket => {
        if (u.is_blocked === true) return 'blocked';
        const s = String(u.kyc_status ?? '').toLowerCase();
        if (s === 'verified' || s === 'approved' || s === 'completed') return 'verified';
        if (s === 'pending'  || s === 'in_progress' || s === 'in_review') return 'pending';
        if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'failed') return 'rejected';
        return 'other';
    };

    // Conteos para los stat cards (no se filtran por search).
    const counts = users.reduce<Record<'all' | Bucket, number>>(
        (acc, u) => {
            acc.all += 1;
            acc[bucketOf(u)] += 1;
            return acc;
        },
        { all: 0, verified: 0, pending: 0, rejected: 0, blocked: 0, other: 0 },
    );

    const filtered = users.filter(u => {
        if (statusFilter !== 'all' && bucketOf(u) !== statusFilter) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return [u.full_name, u.email, u.cuypay_id, u.phone, u.id, u.country]
            .some(v => v && String(v).toLowerCase().includes(q));
    });

    const stats: Array<{ key: 'all' | Bucket; label: string; color: string; bg: string }> = [
        { key: 'all',      label: 'Total',       color: '#0F172A', bg: '#F8FAFC' },
        { key: 'verified', label: 'Verificados', color: '#065F46', bg: '#D1FAE5' },
        { key: 'pending',  label: 'Pendientes',  color: '#92400E', bg: '#FEF3C7' },
        { key: 'rejected', label: 'Cancelados',  color: '#991B1B', bg: '#FEE2E2' },
        { key: 'blocked',  label: 'Bloqueados',  color: '#7F1D1D', bg: '#FCA5A5' },
    ];

    return (
        <div className="p-4 md:p-8 space-y-4">
            <SectionHeader
                title="Usuarios"
                subtitle={`${users.length} usuarios registrados`}
                right={
                    <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                }
            />

            {/* Stat cards clickeables: setStatusFilter al click */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {stats.map(s => {
                    const active = statusFilter === s.key;
                    return (
                        <button
                            key={s.key}
                            onClick={() => setStatusFilter(s.key)}
                            className={`text-left rounded-xl p-3 border transition-shadow ${active ? 'shadow-md ring-2' : 'hover:shadow-sm'}`}
                            style={{
                                backgroundColor: s.bg,
                                borderColor: active ? s.color : 'transparent',
                                // @ts-ignore — ring color dinámico
                                ['--tw-ring-color' as any]: s.color,
                            }}
                        >
                            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: s.color, opacity: 0.7 }}>
                                {s.label}
                            </div>
                            <div className="text-2xl font-bold mt-0.5" style={{ color: s.color }}>
                                {(counts[s.key] ?? 0).toLocaleString('es-CO')}
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Toolbar: search + limpiar + contador */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        placeholder="Buscar por nombre, correo, CuyPay ID, teléfono o UUID..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 focus:border-teal-500 outline-none text-sm"
                    />
                </div>
                {(statusFilter !== 'all' || search) && (
                    <button
                        onClick={() => { setStatusFilter('all'); setSearch(''); }}
                        className="px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                        Limpiar filtros
                    </button>
                )}
                <span className="text-xs text-slate-500 ml-auto">
                    Mostrando <b className="text-slate-900">{filtered.length}</b> de {users.length}
                </span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Usuario</th>
                                <th className="text-left px-4 py-3">CuyPay ID</th>
                                <th className="text-left px-4 py-3">Correo</th>
                                <th className="text-left px-4 py-3">País</th>
                                <th className="text-left px-4 py-3">KYC</th>
                                <th className="text-left px-4 py-3">Registrado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Cargando...</td></tr>}
                            {!loading && filtered.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                                    {users.length === 0 ? 'Sin usuarios' : 'Sin resultados con los filtros actuales'}
                                </td></tr>
                            )}
                            {filtered.map(u => {
                                const blocked = u.is_blocked === true;
                                return (
                                <tr
                                    key={u.id}
                                    onClick={() => setDetailUserId(u.id)}
                                    className={`border-t border-slate-100 hover:bg-teal-50/50 cursor-pointer transition-colors ${blocked ? 'bg-red-50/40' : ''}`}
                                >
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="font-medium text-slate-900">{u.full_name ?? '—'}</div>
                                            {blocked && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">BLOQUEADO</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{u.cuypay_id ?? '—'}</td>
                                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                                    <td className="px-4 py-3">{u.flag ?? ''} {u.country ?? '—'}</td>
                                    <td className="px-4 py-3"><StatusBadge status={u.kyc_status} /></td>
                                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(u.created_at)}</td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            {detailUserId && (
                <UserDetailDrawer
                    userId={detailUserId}
                    profile={profile}
                    onClose={() => { setDetailUserId(null); load(); }}
                />
            )}
        </div>
    );
};


// (KYC ahora vive como tab dentro de Compliance — sección unificada)

