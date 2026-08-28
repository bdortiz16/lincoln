import React, { useEffect, useState, useCallback } from 'react';
import {
    DollarSign, RefreshCw, TrendingUp, TrendingDown, Wallet,
    Plus, X, Trash2, ArrowRightLeft, Building2, Upload, FileSpreadsheet, ArrowLeftRight, BarChart3, FileText, Shield, Gift, Coins, Briefcase, Gauge, Globe
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, PERMISSIONS, type AdminProfile, type AdminRole } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, NAVY, TEAL, EmptyState, formatDate } from './shared';
import { TransactionsSection } from './TransactionsSection';
import { TreasuryDashboard } from './TreasuryDashboard';
import { ReportsSection } from './ReportsSection';
import { RatesPanel } from './RatesPanel';
import { DualApprovalTab } from './DualApprovalTab';
import { ReferralsTab } from './ReferralsTab';
import { TreasuryLedger } from './TreasuryLedger';
import { OperationalLimitsTab } from './OperationalLimitsTab';
import { CurrencyConfigTab } from './CurrencyConfigTab';

interface TreasurySectionProps {
    profile: AdminProfile;
}

interface ReserveByCurrency {
    currency: string;
    inflows: number;
    outflows: number;
    netPosition: number;
    txCount: number;
}

interface Partner {
    id: string;
    name: string;
    type: string | null;
    country_code: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    is_active: boolean;
    notes: string | null;
}

// 'fx' (Tasas FX) salió del set de tabs y vive como entrada propia en el
// sidebar (PersonasAdminDashboard → section 'fx'). El switch interno de abajo
// igual lo soporta por compatibilidad, pero el botón ya no aparece.
type TreasuryTab = 'dashboard' | 'transactions' | 'ledger' | 'fx' | 'currencies' | 'ops' | 'referrals';
type OpsSubTab = 'reserves' | 'partners' | 'reconcile' | 'reports' | 'dual-approval' | 'limits';

// Cada rol ve sólo los tabs que le corresponden. 'ops' agrupa reservas,
// partners, conciliación, reportes, doble aprobación y topes operativos
// en un solo botón.
const TABS_BY_ROLE: Record<AdminRole, TreasuryTab[]> = {
    super_admin: ['dashboard', 'transactions', 'ledger', 'currencies', 'ops'],
    treasury:    ['dashboard', 'transactions', 'ledger', 'currencies', 'ops'],
    audit:       ['dashboard', 'transactions', 'ledger', 'ops'],
    support:     ['transactions'],
    compliance:  ['transactions', 'ops'],
};

// Qué sub-tabs ve cada rol dentro de 'ops'
const OPS_SUBTABS_BY_ROLE: Record<AdminRole, OpsSubTab[]> = {
    super_admin: ['reserves', 'partners', 'reconcile', 'reports', 'dual-approval', 'limits'],
    treasury:    ['reserves', 'partners', 'reconcile', 'reports', 'dual-approval', 'limits'],
    audit:       ['reserves', 'reports'],
    support:     [],
    compliance:  ['reports', 'limits'],
};

export const TreasurySection: React.FC<TreasurySectionProps> = ({ profile }) => {
    const allowedTabs = TABS_BY_ROLE[profile.role] ?? [];
    const [tab, setTab] = useState<TreasuryTab>(allowedTabs[0] ?? 'dashboard');

    const allTabs: Array<{ id: TreasuryTab; label: string; icon: any }> = [
        { id: 'dashboard',     label: 'Dashboard',        icon: BarChart3 },
        { id: 'transactions',  label: 'Transacciones',    icon: ArrowLeftRight },
        { id: 'ledger',        label: 'Cuentas y movimientos', icon: Coins },
        // Tasas FX se movió al sidebar como entrada independiente.
        { id: 'currencies',    label: 'Monedas',          icon: Globe },
        { id: 'ops',           label: 'Operaciones',      icon: Briefcase },
        // Referidos se movió al sidebar 'Promociones'.
    ];
    const visibleTabs = allTabs.filter(t => allowedTabs.includes(t.id));

    return (
        <div className="p-4 md:p-8">
            <SectionHeader
                title="Tesorería"
                subtitle="Dashboard, transacciones, reservas, cuentas, FX, partners, conciliación, doble aprobación y referidos"
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

            {tab === 'dashboard' && <TreasuryDashboard />}
            {tab === 'transactions' && <TransactionsSection profile={profile} embedded />}
            {tab === 'ledger' && <TreasuryLedger profile={profile} />}
            {tab === 'currencies' && <CurrencyConfigTab profile={profile} />}
            {tab === 'fx' && <RatesPanel profile={profile} />}
            {tab === 'ops' && <OpsSection profile={profile} />}
            {tab === 'referrals' && <ReferralsTab profile={profile} />}
        </div>
    );
};

// ─────────────────────────────────────────────
// SECCIÓN: OPERACIONES (sub-tabs: Reservas, Partners, Conciliación, Reportes, Doble aprobación, Topes operativos)
// ─────────────────────────────────────────────
const OpsSection: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const allowed = OPS_SUBTABS_BY_ROLE[profile.role] ?? [];
    const [sub, setSub] = useState<OpsSubTab>(allowed[0] ?? 'reports');

    const subTabs: Array<{ id: OpsSubTab; label: string; icon: any; description: string }> = [
        { id: 'reserves',      label: 'Reservas',         icon: Wallet,          description: 'Flujo de caja por moneda · últimos 30 días' },
        { id: 'partners',      label: 'Partners',         icon: Building2,       description: 'Directorio de partners / contrapartes' },
        { id: 'reconcile',     label: 'Conciliación',     icon: FileSpreadsheet, description: 'Conciliar extractos bancarios con TX' },
        { id: 'reports',       label: 'Reportes',         icon: FileText,        description: 'Reportes regulatorios y exportes' },
        { id: 'dual-approval', label: 'Doble aprobación', icon: Shield,          description: 'Política de doble firma para TX grandes' },
        { id: 'limits',        label: 'Topes operativos', icon: Gauge,           description: 'Default global de topes diario / mensual + moneda' },
    ];
    const visible = subTabs.filter(t => allowed.includes(t.id));

    if (visible.length === 0) {
        return <p className="text-sm text-slate-500 italic">No tienes permisos para ver estas operaciones.</p>;
    }

    const activeTab = visible.find(t => t.id === sub) ?? visible[0];

    return (
        <div className="flex flex-col md:flex-row gap-5">
            {/* Menú lateral de sub-áreas */}
            {visible.length > 1 && (
                <nav className="flex md:flex-col gap-2 md:w-64 md:shrink-0 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
                    {visible.map(t => {
                        const Icon = t.icon;
                        const active = sub === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setSub(t.id)}
                                className={`text-left p-3 rounded-xl border transition-colors flex items-start gap-2.5 shrink-0 w-56 md:w-full ${
                                    active ? 'border-slate-900 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                            >
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: active ? NAVY : '#F1F5F9' }}>
                                    <Icon size={14} color={active ? 'white' : '#475569'} />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-sm" style={{ color: NAVY }}>{t.label}</p>
                                    <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{t.description}</p>
                                </div>
                            </button>
                        );
                    })}
                </nav>
            )}

            {/* Panel de contenido del sub-tab activo */}
            <div className="flex-1 min-w-0">
                {activeTab && (
                    <div className="flex items-center gap-2.5 mb-4">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${TEAL}1A` }}>
                            <activeTab.icon size={16} color={NAVY} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg leading-tight" style={{ color: NAVY }}>{activeTab.label}</h3>
                            <p className="text-xs text-slate-500">{activeTab.description}</p>
                        </div>
                    </div>
                )}
                <div className="border-t border-slate-200 pt-4">
                    {sub === 'reserves' && allowed.includes('reserves') && <ReservesTab />}
                    {sub === 'partners' && allowed.includes('partners') && <PartnersTab profile={profile} />}
                    {sub === 'reconcile' && allowed.includes('reconcile') && <ReconcileTab profile={profile} />}
                    {sub === 'reports' && allowed.includes('reports') && <ReportsSection profile={profile} />}
                    {sub === 'dual-approval' && allowed.includes('dual-approval') && <DualApprovalTab profile={profile} />}
                    {sub === 'limits' && allowed.includes('limits') && <OperationalLimitsTab profile={profile} />}
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// TAB: RESERVES (de F1, mejorado)
// ─────────────────────────────────────────────
const ReservesTab: React.FC = () => {
    const [reserves, setReserves] = useState<ReserveByCurrency[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        // Esquema real (CuyPayANDROID): kind (load/send), amount, currency.
        const { data } = await supabasePersonas
            .from('transactions')
            .select('kind, status, amount, currency, created_at')
            .gte('created_at', since);

        const FINAL = ['approved', 'completed', 'aprobada', 'completado', 'aprobado'];
        const map = new Map<string, ReserveByCurrency>();
        for (const t of (data ?? [])) {
            const status = String((t as any).status ?? '').toLowerCase();
            if (!FINAL.includes(status)) continue;
            const cur = (t as any).currency ?? 'UNK';
            const amt = Number((t as any).amount) || 0;
            const kind = String((t as any).kind ?? '').toLowerCase();
            const r = map.get(cur) ?? { currency: cur, inflows: 0, outflows: 0, netPosition: 0, txCount: 0 };
            if (kind === 'load') r.inflows += amt;
            if (kind === 'send') r.outflows += amt;
            r.txCount += 1;
            map.set(cur, r);
        }
        for (const r of map.values()) r.netPosition = r.inflows - r.outflows;
        setReserves(Array.from(map.values()).sort((a, b) => Math.abs(b.netPosition) - Math.abs(a.netPosition)));
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 text-xs text-slate-600 leading-relaxed">
                <b style={{ color: NAVY }}>¿Qué es esto?</b> Flujo de caja por moneda en los <b>últimos 30 días</b>:
                cuánto <b>entró</b> (cargues de clientes) vs cuánto <b>salió</b> (pagos a clientes) y la <b>posición neta</b>.
                Si la neta es positiva estás acumulando esa moneda; si es negativa, la estás drenando. Es complementaria al saldo
                actual de cada cuenta (que es la foto del momento).
            </div>
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-500">Movimientos últimos 30 días</p>
                <button onClick={load} className="text-slate-500 hover:text-slate-700 p-1.5 rounded">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && reserves.length === 0 && (
                <EmptyState icon={Wallet} title="Sin movimientos" message="No hay transacciones completadas en los últimos 30 días" />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reserves.map(r => (
                    <div key={r.currency} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${TEAL}1A` }}>
                                    <DollarSign size={18} color={NAVY} />
                                </div>
                                <div>
                                    <p className="font-bold text-lg" style={{ color: NAVY }}>{r.currency}</p>
                                    <p className="text-xs text-slate-500">{r.txCount} transacciones</p>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-slate-500 flex items-center gap-1"><TrendingUp size={14} className="text-green-600" /> Ingresos</span>
                                <span className="font-mono font-semibold text-green-700">+{r.inflows.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-slate-500 flex items-center gap-1"><TrendingDown size={14} className="text-red-600" /> Egresos</span>
                                <span className="font-mono font-semibold text-red-700">-{r.outflows.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                <span className="font-bold" style={{ color: NAVY }}>Posición neta</span>
                                <span className="font-mono font-bold" style={{ color: r.netPosition >= 0 ? '#065F46' : '#991B1B' }}>
                                    {r.netPosition >= 0 ? '+' : ''}{r.netPosition.toLocaleString('es-CO', { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// TAB: PARTNERS
// ─────────────────────────────────────────────
const PartnersTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [partners, setPartners] = useState<Partner[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);

    const canManage = PERMISSIONS.canManageBankAccounts(profile.role);

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabasePersonas.from('partners').select('*').order('name');
        setPartners((data as Partner[]) ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const remove = async (p: Partner) => {
        const ok = await confirm({
            title: 'Eliminar',
            message: `¿Eliminar "${p.name}"?`,
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        await supabasePersonas.from('partners').delete().eq('id', p.id);
        await logAdminAction({ admin: profile, action: 'partner_remove', targetType: 'partner', targetId: p.id, metadata: { name: p.name } });
        load();
    };

    return (
        <div>
            {confirmDialog}
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-500">{partners.length} partners</p>
                {canManage && (
                    <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: NAVY }}>
                        <Plus size={14} /> Nuevo partner
                    </button>
                )}
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && partners.length === 0 && (
                <EmptyState icon={Building2} title="Sin partners" message="Agrega bancos, partners de liquidez, KYC, etc." />
            )}

            <div className="space-y-2">
                {partners.map(p => (
                    <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-semibold text-slate-900">{p.name}</span>
                                {p.type && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 capitalize">{p.type}</span>}
                                {p.country_code && <span className="text-xs text-slate-500">{p.country_code}</span>}
                            </div>
                            <div className="text-xs text-slate-500 space-x-3">
                                {p.contact_email && <span>{p.contact_email}</span>}
                                {p.contact_phone && <span>{p.contact_phone}</span>}
                            </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: p.is_active ? '#D1FAE5' : '#FEE2E2', color: p.is_active ? '#065F46' : '#991B1B' }}>
                            {p.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                        {canManage && (
                            <button onClick={() => remove(p)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600">
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {showAdd && <AddPartnerModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} profile={profile} />}
        </div>
    );
};

const AddPartnerModal: React.FC<{ onClose: () => void; onSaved: () => void; profile: AdminProfile }> = ({ onClose, onSaved, profile }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState('bank');
    const [country, setCountry] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);

    const save = async () => {
        if (!name.trim()) return;
        setLoading(true);
        const { data } = await supabasePersonas.from('partners').insert({
            name: name.trim(),
            type,
            country_code: country.toUpperCase().slice(0, 2) || null,
            contact_email: email.trim() || null,
            contact_phone: phone.trim() || null,
        }).select().single();
        if (data) {
            await logAdminAction({ admin: profile, action: 'partner_create', targetType: 'partner', targetId: (data as any).id, metadata: { name, type } });
        }
        setLoading(false);
        onSaved();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg" style={{ color: NAVY }}>Nuevo partner</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Nombre</label>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3" />
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Tipo</label>
                <select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3 bg-white">
                    <option value="bank">Banco</option>
                    <option value="liquidity">Liquidez</option>
                    <option value="kyc">KYC</option>
                    <option value="payment">Pagos</option>
                    <option value="custodian">Custodio</option>
                    <option value="other">Otro</option>
                </select>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">País (ISO)</label>
                <input value={country} onChange={e => setCountry(e.target.value.toUpperCase().slice(0, 2))} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3 font-mono" placeholder="CO" />
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3" />
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Teléfono</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-6" />
                <button onClick={save} disabled={loading || !name.trim()} style={{ backgroundColor: NAVY }} className="w-full text-white font-bold py-3 rounded-xl disabled:opacity-50">
                    {loading ? 'Guardando...' : 'Crear partner'}
                </button>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// TAB: RECONCILIATION (CSV upload + auto-match)
// ─────────────────────────────────────────────
const ReconcileTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const [uploading, setUploading] = useState(false);
    const [matched, setMatched] = useState<number>(0);
    const [unmatched, setUnmatched] = useState<number>(0);
    const [message, setMessage] = useState<string | null>(null);

    const handleFile = async (file: File) => {
        setUploading(true);
        setMessage(null);
        try {
            const text = await file.text();
            const lines = text.split('\n').slice(1).filter(Boolean); // skip header
            // Formato esperado: fecha,descripcion,monto,tipo(credito|debito)
            const parsed = lines.map(line => {
                const [date, description, amount, type] = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
                return {
                    posted_at: new Date(date).toISOString(),
                    description,
                    amount: Math.abs(Number(amount.replace(/[^0-9.-]/g, ''))),
                    is_credit: type?.toLowerCase().startsWith('cr'),
                };
            }).filter(l => !isNaN(l.amount));

            if (parsed.length === 0) throw new Error('CSV vacío o formato inválido. Esperado: fecha,descripcion,monto,tipo');

            // Crear el statement
            const { data: stmt, error: stmtErr } = await supabasePersonas.from('bank_statements').insert({
                statement_date: new Date().toISOString().slice(0, 10),
                uploaded_by: profile.id,
            }).select().single();
            if (stmtErr) throw stmtErr;

            // Insertar líneas
            const linesPayload = parsed.map(l => ({ statement_id: (stmt as any).id, ...l, match_status: 'unmatched' as const }));
            const { data: insertedLines, error: linesErr } = await supabasePersonas
                .from('bank_statement_lines')
                .insert(linesPayload)
                .select();
            if (linesErr) throw linesErr;

            // Intentar auto-matching simple: por monto y ±2 días
            let m = 0;
            for (const line of (insertedLines ?? [])) {
                const l: any = line;
                if (!l.is_credit) continue; // solo casamos entradas con loads aprobados
                const dayBefore = new Date(new Date(l.posted_at).getTime() - 2 * 86400000).toISOString();
                const dayAfter = new Date(new Date(l.posted_at).getTime() + 2 * 86400000).toISOString();
                const { data: cand } = await supabasePersonas
                    .from('transactions')
                    .select('id')
                    .eq('type', 'load')
                    .eq('from_amount', l.amount)
                    .gte('created_at', dayBefore)
                    .lte('created_at', dayAfter)
                    .limit(1);
                if (cand && cand.length > 0) {
                    await supabasePersonas
                        .from('bank_statement_lines')
                        .update({ matched_transaction_id: (cand[0] as any).id, match_status: 'matched' })
                        .eq('id', l.id);
                    m++;
                }
            }

            const total = (insertedLines ?? []).length;
            setMatched(m);
            setUnmatched(total - m);
            setMessage(`Importado: ${total} líneas, ${m} casadas automáticamente`);
            await logAdminAction({
                admin: profile,
                action: 'bank_statement_import',
                targetType: 'bank_statement',
                targetId: (stmt as any).id,
                metadata: { lines: total, matched: m },
            });
        } catch (e: any) {
            setMessage('Error: ' + (e?.message ?? 'desconocido'));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div>
            <div className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center">
                <Upload size={40} className="mx-auto mb-3 text-slate-400" />
                <p className="font-semibold text-slate-700 mb-1">Importar extracto bancario</p>
                <p className="text-xs text-slate-500 mb-4">
                    CSV con columnas: <code className="font-mono">fecha, descripcion, monto, tipo</code><br />
                    Tipo: <code className="font-mono">credito</code> (entrada) o <code className="font-mono">debito</code> (salida)
                </p>
                <input
                    type="file"
                    accept=".csv"
                    disabled={uploading}
                    onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                    className="block mx-auto text-sm"
                />
                {uploading && <p className="mt-3 text-sm text-slate-500">Procesando...</p>}
            </div>

            {message && (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
                    {message}
                </div>
            )}

            {(matched > 0 || unmatched > 0) && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                        <p className="text-3xl font-bold text-green-700">{matched}</p>
                        <p className="text-sm text-green-900">Casadas automáticamente</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <p className="text-3xl font-bold text-amber-700">{unmatched}</p>
                        <p className="text-sm text-amber-900">Sin casar (revisar manualmente)</p>
                    </div>
                </div>
            )}
        </div>
    );
};
