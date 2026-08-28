import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    ShieldCheck, AlertTriangle, RefreshCw, CheckCircle2, XCircle, Search,
    Plus, X, Trash2, Bell, FileWarning, BarChart3, Ban, Users, UserPlus,
    FileSearch, Gauge,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, PERMISSIONS, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { useToast } from '../lib/toast';
import { SectionHeader, StatusBadge, formatDate, formatAmount, NAVY, TEAL, EmptyState } from './shared';
import { ComplianceDashboard } from './ComplianceDashboard';
import { KycDetailModal } from './KycDetailModal';
import { DocRequestsTab } from './DocRequestsTab';
import { UserLimitsCard } from './UserLimitsCard';
import { LimitUsageBar } from './LimitUsageBar';
import { BlockUserModal, type BlockPayload } from './BlockUserModal';

interface ComplianceSectionProps {
    profile: AdminProfile;
}

interface UserRow {
    id: string;
    email: string;
    full_name: string | null;
    cuypay_id: string | null;
    flag: string | null;
    country: string | null;
    kyc_status: string | null;
    kyc_provider: string | null;
    kyc_verified_at: string | null;
    is_blocked?: boolean | null;
    created_at: string;
    // raw_data?.diditDecision se popula cuando el admin abre el modal por
    // primera vez (la edge function cachea ahí). Lo usamos para mostrar la
    // foto del usuario en el avatar de la lista sin pegar más veces a Didit.
    raw_data?: any;
}

// Saca la mejor URL de foto disponible de un objeto decisión.
// Mismo orden de fallbacks que el avatar del modal:
//   portrait → selfie → frente del documento.
function avatarUrlFromDecision(dec: any): string | null {
    if (!dec) return null;
    const id = dec?.id_verification ?? {};
    const live = dec?.liveness ?? {};
    return id.portrait_image_url ?? id.portrait_url ?? id.images?.portrait
        ?? live.selfie_url ?? live.image_url ?? live.images?.selfie
        ?? id.front_url ?? id.front_image_url ?? id.images?.front
        ?? null;
}
// Compat: si en algún momento Antigravity cachea la decisión en
// users.raw_data.diditDecision, también la leemos sin pegar al edge.
function avatarUrlFromRaw(raw: any): string | null {
    return avatarUrlFromDecision(raw?.diditDecision);
}

// Cache compartido de URLs de avatar.
// Persiste en localStorage para sobrevivir reloads — la mayor parte del
// delay percibido al entrar a Compliance KYC viene de pegarle 17 veces al
// edge function `didit-kyc?action=full` a buscar la foto de cada user.
// Cacheándolo en disco, el segundo reload renderiza con fotos al toque.
// '' significa "ya probamos y no hay foto"; ausente = no probamos.
const AVATAR_CACHE_KEY = 'cuypay.admin.avatar_cache.v1';
const AVATAR_CACHE: Map<string, string | ''> = (() => {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(AVATAR_CACHE_KEY) : null;
        if (!raw) return new Map();
        const obj = JSON.parse(raw) as Record<string, string | ''>;
        return new Map(Object.entries(obj));
    } catch {
        return new Map();
    }
})();

// Persistimos el cache en localStorage en batch (timeout debouncing) para
// evitar escrituras síncronas cada vez que se setea un avatar.
let avatarPersistTimer: number | null = null;
function persistAvatarCache() {
    if (avatarPersistTimer != null) return;
    avatarPersistTimer = window.setTimeout(() => {
        avatarPersistTimer = null;
        try {
            const obj = Object.fromEntries(AVATAR_CACHE);
            localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(obj));
        } catch { /* quota / disabled */ }
    }, 500);
}

// Wrapper que usamos en lugar de AVATAR_CACHE.set() para persistir.
function rememberAvatar(userId: string, url: string | '') {
    AVATAR_CACHE.set(userId, url);
    persistAvatarCache();
}

// Componente que muestra el avatar de un user: prueba primero el cache
// y raw_data inline; si no, hace un fetch lazy al edge function
// action=full una sola vez. Mientras carga muestra la inicial.
const UserAvatar: React.FC<{ userId: string; rawData?: any; initial: string; blocked?: boolean }> = ({ userId, rawData, initial, blocked }) => {
    const inlineUrl = avatarUrlFromRaw(rawData);
    const [url, setUrl] = useState<string | ''>(() => AVATAR_CACHE.get(userId) ?? inlineUrl ?? '');
    const tried = useRef(false);

    useEffect(() => {
        if (url) return;                       // ya tenemos foto
        if (tried.current) return;             // ya intentamos y no había
        if (AVATAR_CACHE.has(userId)) {        // alguien más lo intentó
            setUrl(AVATAR_CACHE.get(userId) ?? '');
            return;
        }
        tried.current = true;
        (async () => {
            try {
                const env: any = (import.meta as any).env ?? {};
                const sbUrl = env.VITE_SUPABASE_PERSONAS_URL || env.VITE_SUPABASE_URL || '';
                const apikey = env.VITE_SUPABASE_PERSONAS_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
                const { data: sess } = await supabasePersonas.auth.getSession();
                const accessToken = sess?.session?.access_token ?? '';
                const resp = await fetch(`${sbUrl}/functions/v1/didit-kyc?action=full&user_id=${userId}`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken || apikey}`,
                        'apikey': apikey,
                    },
                });
                if (!resp.ok) { rememberAvatar(userId, ''); return; }
                const d = await resp.json().catch(() => null);
                const found = avatarUrlFromDecision(d) ?? '';
                rememberAvatar(userId, found);
                setUrl(found);
            } catch {
                rememberAvatar(userId, '');
            }
        })();
    }, [userId, url]);

    if (url) {
        return (
            <img
                src={url}
                alt={initial}
                onError={() => { rememberAvatar(userId, ''); setUrl(''); }}
                className="w-12 h-12 rounded-full object-cover shrink-0 border-2 border-white shadow-sm bg-slate-100"
            />
        );
    }
    return (
        <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0" style={{ backgroundColor: blocked ? '#FCA5A5' : TEAL, color: NAVY }}>
            {initial}
        </div>
    );
};

interface AmlRule {
    id: string;
    name: string;
    description: string | null;
    rule_type: string;
    amount_threshold: number | null;
    time_window_hours: number | null;
    severity: 'low' | 'medium' | 'high' | 'critical';
    is_active: boolean;
}

interface Alert {
    id: string;
    rule_name: string | null;
    severity: string;
    description: string | null;
    status: string;
    metadata: any;
    user_id: string | null;
    transaction_id: string | null;
    created_at: string;
}

// Tercero / beneficiario (public.beneficiaries). owner es el usuario que lo creó.
interface BeneficiaryRow {
    id: string;
    owner_user_id: string | null;
    full_name: string | null;
    doc_type: string | null;
    doc_number: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    didit_session_id: string | null;
    kyc_status: string | null;
    kyc_verified_at: string | null;
    linked_user_id: string | null;
    is_active: boolean | null;
    created_at: string;
    owner?: { full_name: string | null; email: string | null; cuypay_id: string | null } | null;
}

interface SanctionsEntry {
    id: string;
    list_type: string;
    full_name: string;
    aliases: string[] | null;
    country_code: string | null;
    notes: string | null;
    added_at: string;
}

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
    low:      { bg: '#F1F5F9', text: '#475569' },
    medium:   { bg: '#FEF3C7', text: '#92400E' },
    high:     { bg: '#FED7AA', text: '#9A3412' },
    critical: { bg: '#FEE2E2', text: '#991B1B' },
};

export const ComplianceSection: React.FC<ComplianceSectionProps> = ({ profile }) => {
    const [tab, setTab] = useState<'dashboard' | 'alerts' | 'kyc' | 'docs' | 'rules' | 'sanctions'>('dashboard');
    const canApprove = PERMISSIONS.canApproveKyc(profile.role);

    return (
        <div className="p-4 md:p-8">
            <SectionHeader
                title="Compliance"
                subtitle="Dashboard, alertas, KYC, reglas AML y screening"
            />

            <div className="flex gap-2 mb-6 flex-wrap">
                {[
                    { id: 'dashboard' as const, label: 'Dashboard',    icon: BarChart3 },
                    { id: 'alerts' as const,    label: 'Alertas',      icon: Bell },
                    { id: 'kyc' as const,       label: 'KYC',          icon: ShieldCheck },
                    { id: 'docs' as const,      label: 'Documentación', icon: FileSearch },
                    { id: 'rules' as const,     label: 'Reglas AML',   icon: FileWarning },
                    { id: 'sanctions' as const, label: 'Sanciones',    icon: Search },
                ].map(t => {
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

            {tab === 'dashboard' && <ComplianceDashboard />}
            {tab === 'alerts' && <AlertsTab profile={profile} />}
            {tab === 'kyc' && <KycTab profile={profile} canApprove={canApprove} />}
            {tab === 'docs' && <DocRequestsTab profile={profile} />}
            {tab === 'rules' && <RulesTab profile={profile} />}
            {tab === 'sanctions' && <SanctionsTab profile={profile} />}
        </div>
    );
};

// ─────────────────────────────────────────────
// TAB: ALERTS — alertas generadas automáticamente
// ─────────────────────────────────────────────
const AlertsTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'open' | 'all'>('open');
    const [processingId, setProcessingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        let q = supabasePersonas.from('compliance_alerts').select('*').order('created_at', { ascending: false }).limit(200);
        if (filter === 'open') q = q.eq('status', 'open');
        const { data } = await q;
        setAlerts((data as Alert[]) ?? []);
        setLoading(false);
    }, [filter]);

    useEffect(() => { load(); }, [load]);

    const updateStatus = async (a: Alert, status: 'closed' | 'escalated' | 'reviewing') => {
        setProcessingId(a.id);
        await supabasePersonas
            .from('compliance_alerts')
            .update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
            .eq('id', a.id);
        await logAdminAction({
            admin: profile,
            action: `alert_${status}`,
            targetType: 'compliance_alert',
            targetId: a.id,
            metadata: { rule: a.rule_name, severity: a.severity },
        });
        await load();
        setProcessingId(null);
    };

    return (
        <div>
            <div className="flex items-center gap-2 mb-4">
                {(['open', 'all'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{
                            backgroundColor: filter === f ? NAVY : 'white',
                            color: filter === f ? 'white' : '#475569',
                            border: '1px solid #E2E8F0',
                        }}
                    >
                        {f === 'open' ? `Abiertas (${alerts.length})` : 'Todas'}
                    </button>
                ))}
                <button onClick={load} className="ml-auto p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && alerts.length === 0 && (
                <EmptyState icon={ShieldCheck} title="Sin alertas" message="Ninguna alerta de compliance generada" />
            )}

            <div className="space-y-3">
                {alerts.map(a => {
                    const sev = SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.low;
                    return (
                        <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <div
                                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                        style={{ backgroundColor: sev.bg }}
                                    >
                                        <AlertTriangle size={16} color={sev.text} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="font-semibold text-slate-900">{a.rule_name ?? 'Regla'}</span>
                                            <span
                                                className="px-2 py-0.5 rounded-full text-xs font-bold uppercase"
                                                style={{ backgroundColor: sev.bg, color: sev.text }}
                                            >
                                                {a.severity}
                                            </span>
                                            <StatusBadge status={a.status} />
                                        </div>
                                        <p className="text-sm text-slate-600">{a.description}</p>
                                        <p className="text-xs text-slate-400 mt-1">{formatDate(a.created_at)}</p>
                                    </div>
                                </div>
                                {a.status === 'open' && (
                                    <div className="flex gap-1 shrink-0">
                                        <button
                                            onClick={() => updateStatus(a, 'closed')}
                                            disabled={processingId === a.id}
                                            className="px-2.5 py-1.5 bg-green-50 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-100 disabled:opacity-50"
                                        >
                                            Cerrar
                                        </button>
                                        <button
                                            onClick={() => updateStatus(a, 'escalated')}
                                            disabled={processingId === a.id}
                                            className="px-2.5 py-1.5 bg-orange-50 text-orange-700 text-xs font-semibold rounded-lg hover:bg-orange-100 disabled:opacity-50"
                                        >
                                            Escalar
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// TAB: KYC
// ─────────────────────────────────────────────
// Wrapper: switch entre 'KYC Cuenta' (usuarios) y 'KYC Terceros' (beneficiaries).
// El banner azul es compartido — el contenido cambia según la sub-pestaña.
const KycTab: React.FC<{ profile: AdminProfile; canApprove: boolean }> = ({ profile, canApprove }) => {
    const [subTab, setSubTab] = useState<'cuenta' | 'terceros'>('cuenta');
    return (
        <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2 text-sm text-blue-900">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <p>
                    El estado KYC lo determina <strong>Didit</strong> automáticamente y se sincroniza con Lincoin.
                    Si necesitás cambiarlo manualmente, abrí el detalle del usuario y usá el botón de estado —
                    el cambio se pushea a Didit y queda en el audit log.
                    Compliance puede <strong>bloquear</strong> un usuario o tercero si infringe una norma AML.
                </p>
            </div>
            <div className="flex gap-2 flex-wrap">
                {[
                    { id: 'cuenta'   as const, label: 'KYC Cuenta',   icon: Users },
                    { id: 'terceros' as const, label: 'KYC Terceros', icon: UserPlus },
                ].map(t => {
                    const Icon = t.icon;
                    const active = subTab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setSubTab(t.id)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 border"
                            style={{
                                backgroundColor: active ? NAVY : 'white',
                                color: active ? 'white' : '#475569',
                                borderColor: active ? NAVY : '#E2E8F0',
                            }}
                        >
                            <Icon size={12} />
                            {t.label}
                        </button>
                    );
                })}
            </div>
            {subTab === 'cuenta'   && <KycCuentaList   profile={profile} canApprove={canApprove} />}
            {subTab === 'terceros' && <KycTercerosList profile={profile} canApprove={canApprove} />}
        </div>
    );
};

// ─────────────────────────────────────────────
// SUB-TAB: KYC Cuenta — listado de public.users (lo que existía hasta hoy)
// ─────────────────────────────────────────────
const KycCuentaList: React.FC<{ profile: AdminProfile; canApprove: boolean }> = ({ profile, canApprove }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [detailUser, setDetailUser] = useState<UserRow | null>(null);
    const [blockTarget, setBlockTarget] = useState<UserRow | null>(null);
    const [search, setSearch] = useState('');

    // canApprove = super_admin o compliance → acá lo usamos como "puede bloquear"
    const canBlock = canApprove;

    // Cache de la lista en localStorage. Estrategia stale-while-revalidate:
    // al entrar, si tenemos snapshot, lo mostramos INSTANTÁNEO y disparamos
    // el refresh en background. La próxima vez que la sección se monta, la
    // lista aparece llena sin esperar a Supabase ni a los lazy fetches de
    // avatares. El botón "Actualizar" siempre fuerza un fetch limpio.
    const USERS_CACHE_KEY = 'cuypay.admin.kyc_users.v1';
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async (opts?: { force?: boolean }) => {
        // 1) Hidratamos desde cache si NO es un force-refresh
        let hadCache = false;
        if (!opts?.force) {
            try {
                const raw = localStorage.getItem(USERS_CACHE_KEY);
                if (raw) {
                    const cached = JSON.parse(raw);
                    if (Array.isArray(cached?.users) && cached.users.length > 0) {
                        setUsers(cached.users as UserRow[]);
                        setLoading(false);
                        hadCache = true;
                    }
                }
            } catch { /* cache corrupto, ignoramos */ }
        }

        // 2) Fetch real en background. Si NO había cache mostramos loading
        //    spinner full; si SÍ había, solo el chip "refreshing" sutil.
        if (!hadCache) setLoading(true);
        setRefreshing(true);

        // Mostramos TODOS los usuarios recientes (no solo pendientes). El KYC
        // lo decide Didit; acá compliance MONITOREA y puede BLOQUEAR.
        // Intento más completo: con raw_data (para mostrar foto en avatar)
        // + is_blocked. Si raw_data falla por RLS o is_blocked no existe
        // (migraciones pendientes), reintentamos sin esas columnas para
        // que los usuarios sigan apareciendo igual.
        const FULL  = 'id, email, full_name, cuypay_id, flag, country, kyc_status, kyc_provider, kyc_verified_at, is_blocked, created_at, raw_data';
        const NO_RD = 'id, email, full_name, cuypay_id, flag, country, kyc_status, kyc_provider, kyc_verified_at, is_blocked, created_at';
        const NO_BL = 'id, email, full_name, cuypay_id, flag, country, kyc_status, kyc_provider, kyc_verified_at, created_at';
        let { data, error } = await supabasePersonas
            .from('users').select(FULL)
            .order('created_at', { ascending: false }).limit(200);
        if (error && /raw_data/.test(error.message)) {
            const r1 = await supabasePersonas.from('users').select(NO_RD)
                .order('created_at', { ascending: false }).limit(200);
            data = r1.data as any; error = r1.error;
        }
        if (error && /is_blocked/.test(error.message)) {
            const r2 = await supabasePersonas.from('users').select(NO_BL)
                .order('created_at', { ascending: false }).limit(200);
            data = r2.data as any;
        }
        const rows = (data as UserRow[]) ?? [];
        setUsers(rows);
        setLoading(false);
        setRefreshing(false);

        // 3) Persistir el snapshot para la próxima visita
        try {
            localStorage.setItem(USERS_CACHE_KEY, JSON.stringify({ users: rows, ts: Date.now() }));
        } catch { /* quota / disabled */ }
    }, []);

    // 4) Realtime: si Antigravity tiene realtime habilitado para la tabla
    //    users, escuchamos UPDATEs/INSERTs y refrescamos al toque. Si no
    //    está habilitado, el subscribe falla silenciosamente — no rompe nada.
    useEffect(() => {
        const channel = supabasePersonas
            .channel('compliance-users-watch')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'users' },
                () => { load({ force: true }); }
            )
            .subscribe();
        return () => { supabasePersonas.removeChannel(channel); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => { load(); }, [load]);

    // El toggle ahora tiene 2 caminos:
    //   - Si es UN-block: seguimos con el prompt() rápido (motivo genérico).
    //   - Si es BLOCK: abrimos BlockUserModal para capturar motivo estructurado
    //     + checklist de documentos requeridos para desbloqueo.
    // El UPDATE real vive en applyBlock (invocado desde onConfirm del modal
    // o directo desde acá si es desbloqueo).
    const toggleBlock = (user: UserRow) => {
        if (!canBlock) return;
        const willBlock = !(user as any).is_blocked;
        if (willBlock) {
            setBlockTarget(user);
            return;
        }
        // Desbloqueo — sin modal, con confirm rápido
        void applyBlock(user, false, null);
    };

    const applyBlock = async (
        user: UserRow,
        willBlock: boolean,
        payload: BlockPayload | null,
    ) => {
        setProcessingId(user.id);

        // Escribimos SIEMPRE `is_active` (col booleana que las apps mobile leen
        // para mostrar la pantalla restrictiva) — is_active=false ⇔ bloqueado.
        // Cuando willBlock=true persistimos también block_reason / block_notes /
        // required_documents (2026_user_block_reason.sql). Cuando desbloqueamos,
        // limpiamos todo para que el banner rojo del mobile desaparezca.
        // block_type: 'temporary' | 'permanent' | null.
        // - permanent → app no muestra CTA de "subir docs", solo "contactá soporte"
        // - temporary → app muestra checklist required_documents
        // - null (unblock) → banner desaparece
        const blockType = willBlock ? (payload?.type ?? 'temporary') : null;
        // Si es permanente, prepend del customInfo dentro de block_notes para que
        // quede visible en el mobile sin agregar una col extra.
        const notesForDb = willBlock
            ? (payload?.type === 'permanent' && payload?.customInfo
                ? `[PERMANENTE — info requerida] ${payload.customInfo}${payload.notes ? `\n\n${payload.notes}` : ''}`
                : (payload?.notes ?? null))
            : null;
        const updateFull: Record<string, any> = {
            is_active:          !willBlock,
            is_blocked:         willBlock,
            blocked_reason:     willBlock ? (payload?.reason ?? null) : null,
            blocked_at:         willBlock ? new Date().toISOString() : null,
            block_type:         blockType,
            block_reason:       willBlock ? (payload?.reason ?? null) : null,
            block_notes:        notesForDb,
            required_documents: willBlock ? (payload?.required ?? []) : [],
        };
        let { error } = await supabasePersonas.from('users').update(updateFull).eq('id', user.id);
        if (error && /column/i.test(error.message)) {
            // Fallback progresivo: sin las columnas nuevas de bloqueo
            const retry = await supabasePersonas
                .from('users')
                .update({ is_active: !willBlock, is_blocked: willBlock })
                .eq('id', user.id);
            error = retry.error;
        }
        if (error && /is_blocked|column/i.test(error.message)) {
            // Fallback final: solo is_active (mínimo indispensable para el mobile)
            const retry2 = await supabasePersonas
                .from('users')
                .update({ is_active: !willBlock })
                .eq('id', user.id);
            error = retry2.error;
        }
        if (error) {
            await confirm({
                title: 'Error',
                message: error.message.includes('is_blocked')
                    ? 'Falta la columna is_blocked en users. Corre la migración 2026_user_block.sql en Supabase.'
                    : error.message,
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
            setProcessingId(null);
            return;
        }
        // Cuando bloqueamos con docs requeridos, ADEMÁS creamos un
        // document_requests con category='block_unlock' para que la solicitud
        // aparezca en Compliance → Documentación y el admin pueda hacer
        // review desde ahí (aprobar+desbloquear, rechazar, o pedir más docs).
        // Al desbloquear manualmente, cancelamos las block_unlock pendientes
        // que hayan quedado abiertas para ese user.
        // Solo TEMPORAL genera document_request. Los bloqueos permanentes
        // no necesitan flujo de docs porque el user no se autodesbloquea.
        if (willBlock && payload && payload.type === 'temporary' && payload.required.length > 0) {
            const reasonMap: Record<string, string> = {
                aml_infringement:    'Infracción de norma AML',
                suspicious_activity: 'Actividad sospechosa',
                pep_mismatch:        'PEP / lista de sanciones',
                identity_unverified: 'Identidad no verificada',
                fraud_suspected:     'Sospecha de fraude',
                duplicate_account:   'Cuenta duplicada',
                court_order:         'Orden judicial / regulatoria',
                other:               'Otro',
            };
            const reasonLabel = reasonMap[payload.reason] ?? payload.reason;
            const docsList = payload.required.join(', ');
            const description = payload.notes?.trim()
                ? `${payload.notes.trim()}\n\nDocumentos requeridos: ${docsList}`
                : `Documentos requeridos para desbloqueo: ${docsList}`;
            // Enriquecemos description con datos identificatorios del user así
            // el admin ve inmediatamente a quién le pidió qué en Documentación,
            // aún si la RLS del embed FK falla y user viene null en el list.
            const userLine = `Usuario: ${user.full_name ?? '—'} · ${user.email}${user.cuypay_id ? ` · ID ${user.cuypay_id}` : ''}`;
            const fullDescription = `${userLine}\n\n${description}`;

            // Vamos DIRECTO con category='other' + prefijo [BLOQUEO] en el
            // title, así el INSERT nunca depende de la migración del CHECK
            // constraint. El ReviewModal ya reconoce ese prefijo y trata la
            // fila como block_unlock (card roja + botones especiales).
            // Las slugs de docs requeridos se serializan en review_notes.
            const baseRow = {
                user_id:      user.id,
                title:        `[BLOQUEO] Bloqueo — ${reasonLabel}`,
                description:  fullDescription,
                requested_by: profile.id,
                status:       'pending' as const,
                category:     'other' as const,
                review_notes: JSON.stringify({ required: payload.required, reason: payload.reason }),
            };
            const { error: drErr } = await supabasePersonas
                .from('document_requests')
                .insert(baseRow);
            if (drErr) {
                console.error('[block_unlock] doc_request INSERT failed:', drErr);
                await confirm({
                    title: 'Usuario bloqueado, pero…',
                    message: `El bloqueo se aplicó en users OK. Pero NO pude crear la fila en document_requests para que aparezca en Compliance → Documentación:\n\n${drErr.message}\n\nCheckeá:\n • RLS: el rol admin_role debe estar en ('super_admin','compliance')\n • Que exista la tabla public.document_requests\n\nPodés crear la solicitud manualmente desde Documentación → "Nueva solicitud" para no perder el flow.`,
                    variant: 'danger',
                    alertOnly: true,
                    confirmLabel: 'Entendido',
                });
            } else {
                console.log('[block_unlock] doc_request created for user', user.id);
            }
        }
        if (!willBlock) {
            // Cancelar block_unlock pendientes del user. Cubrimos las 2
            // formas de crear la fila: category='block_unlock' (si la
            // migración del CHECK ya está aplicada) y category='other' con
            // title empezando en '[BLOQUEO]' (fallback que usamos siempre).
            const patch = {
                status:       'canceled',
                review_notes: 'Cancelada automáticamente al desbloquear al usuario.',
                reviewed_by:  profile.id,
                reviewed_at:  new Date().toISOString(),
            };
            await supabasePersonas.from('document_requests').update(patch)
                .eq('user_id', user.id).eq('category', 'block_unlock').eq('status', 'pending');
            await supabasePersonas.from('document_requests').update(patch)
                .eq('user_id', user.id).eq('category', 'other').eq('status', 'pending')
                .like('title', '[BLOQUEO]%');
        }

        await logAdminAction({
            admin: profile,
            action: willBlock ? 'user_block' : 'user_unblock',
            targetType: 'user',
            targetId: user.id,
            metadata: {
                email:      user.email,
                cuypay_id:  user.cuypay_id,
                reason:     willBlock ? (payload?.reason ?? null) : null,
                notes:      willBlock ? (payload?.notes  ?? null) : null,
                required:   willBlock ? (payload?.required ?? []) : [],
            },
        });
        setBlockTarget(null);
        await load();
        setProcessingId(null);
    };

    const kycBadge = (status: string | null) => {
        const map: Record<string, { bg: string; text: string; label: string }> = {
            verified:   { bg: '#D1FAE5', text: '#065F46', label: 'Verificado · Lincoin' },
            approved:   { bg: '#D1FAE5', text: '#065F46', label: 'Verificado · Lincoin' },
            pending:    { bg: '#FEF3C7', text: '#92400E', label: 'En proceso · Lincoin' },
            in_review:  { bg: '#FEF3C7', text: '#92400E', label: 'En revisión · Lincoin' },
            rejected:   { bg: '#FEE2E2', text: '#991B1B', label: 'Rechazado · Lincoin' },
        };
        const s = map[status ?? ''] ?? { bg: '#F1F5F9', text: '#475569', label: status ?? 'Sin KYC' };
        return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>;
    };

    // Mismo patrón de dashboard que KycTercerosList: 5 stat cards clickeables
    // (Total/Verificados/Pendientes/Cancelados/Bloqueados) + chip filter +
    // búsqueda extendida + 'limpiar filtros' + contador 'Mostrando N de M'.
    type Bucket = 'verified' | 'pending' | 'rejected' | 'blocked' | 'other';
    // Default 'verified': cuando el admin entra a Compliance KYC, le interesa
    // ver primero los usuarios ya verificados. Si quiere ver todos, click en
    // la card "Total" o "Limpiar filtros".
    const [statusFilter, setStatusFilter] = useState<'all' | Bucket>('verified');

    const bucketOf = (u: UserRow): Bucket => {
        if ((u as any).is_blocked === true) return 'blocked';
        const s = String(u.kyc_status ?? '').toLowerCase();
        if (s === 'verified' || s === 'approved' || s === 'completed') return 'verified';
        if (s === 'pending'  || s === 'in_progress' || s === 'in_review') return 'pending';
        if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'failed') return 'rejected';
        return 'other';
    };

    const counts = users.reduce<Record<'all' | Bucket, number>>(
        (acc, u) => { acc.all += 1; acc[bucketOf(u)] += 1; return acc; },
        { all: 0, verified: 0, pending: 0, rejected: 0, blocked: 0, other: 0 },
    );

    const filtered = users.filter(u => {
        if (statusFilter !== 'all' && bucketOf(u) !== statusFilter) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return [u.full_name, u.email, u.cuypay_id, u.id, u.country]
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
        <div className="space-y-4">
            {confirmDialog}
            {/* Stat cards clickeables (mismo patrón que KYC Terceros) */}
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
                                // @ts-ignore — ring color dinámico via CSS var
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

            {/* Toolbar: search + limpiar + actualizar + contador */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, correo, Lincoin ID, UUID o país..."
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 focus:border-teal-500 outline-none text-sm"
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
                <button
                    onClick={() => load({ force: true })}
                    disabled={refreshing}
                    className="px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-60"
                    title="Forzar refresh desde Supabase"
                >
                    <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Actualizando…' : 'Actualizar'}
                </button>
                <span className="text-xs text-slate-500 ml-auto">
                    Mostrando <b className="text-slate-900">{filtered.length}</b> de {users.length}
                </span>
            </div>

            {/* Mini banner cuando hay snapshot pero refresh en curso */}
            {refreshing && !loading && users.length > 0 && (
                <p className="text-[11px] text-slate-400 italic">
                    Mostrando snapshot local… actualizando desde Supabase en segundo plano.
                </p>
            )}

            {loading && <p className="text-slate-400">Cargando…</p>}
            {!loading && filtered.length === 0 && (
                <EmptyState
                    icon={ShieldCheck}
                    title={users.length === 0 ? 'Sin usuarios' : 'Sin resultados'}
                    message={users.length === 0 ? 'No hay usuarios cargados' : 'No hay usuarios que matcheen los filtros'}
                />
            )}

            {filtered.map(u => {
                const blocked = Boolean((u as any).is_blocked);
                return (
                <div key={u.id} className={`bg-white rounded-2xl border p-5 shadow-sm ${blocked ? 'border-red-300' : 'border-slate-200'}`}>
                    <div className="flex items-start gap-4">
                        <UserAvatar
                            userId={u.id}
                            rawData={u.raw_data}
                            initial={(u.full_name?.[0] ?? u.email[0]).toUpperCase()}
                            blocked={blocked}
                        />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-semibold text-slate-900 truncate">{u.full_name ?? '—'}</p>
                                        {kycBadge(u.kyc_status)}
                                        {blocked && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">BLOQUEADO</span>}
                                    </div>
                                    <p className="text-sm text-slate-500 truncate">{u.email}</p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        onClick={() => setDetailUser(u)}
                                        className="px-3 py-2 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-200"
                                    >
                                        Ver detalle
                                    </button>
                                    {canBlock && (
                                        <button
                                            onClick={() => toggleBlock(u)}
                                            disabled={processingId === u.id}
                                            className={`px-3 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1.5 ${
                                                blocked
                                                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                    : 'bg-red-50 text-red-700 hover:bg-red-100'
                                            }`}
                                        >
                                            {blocked ? <><CheckCircle2 size={14} /> Desbloquear</> : <><Ban size={14} /> Bloquear</>}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
                                <div><span className="block text-slate-400">Lincoin ID</span><span className="text-slate-700 font-mono">{u.cuypay_id ?? '—'}</span></div>
                                <div><span className="block text-slate-400">País</span><span className="text-slate-700">{u.flag ?? ''} {u.country ?? '—'}</span></div>
                                <div><span className="block text-slate-400">Proveedor KYC</span><span className="text-slate-700">{u.kyc_provider && u.kyc_provider !== 'Didit' ? u.kyc_provider : 'Lincoin'}</span></div>
                                <div><span className="block text-slate-400">Registrado</span><span className="text-slate-700">{formatDate(u.created_at)}</span></div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-slate-100">
                                <LimitUsageBar subjectId={u.id} subject="user" variant="full" />
                            </div>
                        </div>
                    </div>
                </div>
                );
            })}

            {detailUser && (
                <KycDetailModal
                    kind="user"
                    entity={{
                        id:               detailUser.id,
                        full_name:        detailUser.full_name,
                        email:            detailUser.email,
                        cuypay_id:        detailUser.cuypay_id,
                        country:          detailUser.country,
                        flag:             detailUser.flag,
                        kyc_status:       detailUser.kyc_status,
                        kyc_provider:     detailUser.kyc_provider,
                        kyc_verified_at:  detailUser.kyc_verified_at,
                        is_blocked:       (detailUser as any).is_blocked,
                        // raw_data se obtiene on-demand dentro del modal (no la
                        // pedimos en el list para mantener la query liviana y
                        // no chocar con RLS si tuviera column-level rules).
                        created_at:       detailUser.created_at,
                    }}
                    profile={profile}
                    canApprove={canApprove}
                    onClose={() => setDetailUser(null)}
                    onSaved={load}
                />
            )}

            {blockTarget && (
                <BlockUserModal
                    userLabel={
                        blockTarget.full_name
                            ? `${blockTarget.full_name} (${blockTarget.email})`
                            : blockTarget.email
                    }
                    saving={processingId === blockTarget.id}
                    onCancel={() => setBlockTarget(null)}
                    onConfirm={(payload) => applyBlock(blockTarget, true, payload)}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// SUB-TAB: KYC Terceros — listado de public.beneficiaries (los que un usuario
// dio de alta para enviar/recibir plata). Reusa el patrón visual de KycCuentaList
// + agrega la columna "Dueño" con el usuario que lo creó (JOIN owner_user_id).
// ─────────────────────────────────────────────
// Estados de KYC asignables a un beneficiario desde el admin.
// OJO: el BLOQUEO es una dimensión SEPARADA (is_active + block_*) — un
// tercero puede estar Aprobado por Didit Y bloqueado por un requisito de
// compliance a la vez. Por eso 'blocked' NO es un estado KYC elegible;
// se bloquea con el botón Bloquear.
const BEN_KYC_STATES: Array<{ value: string; label: string; bg: string; tx: string }> = [
    { value: 'approved', label: 'Aprobado',   bg: '#D1FAE5', tx: '#065F46' },
    { value: 'pending',  label: 'Pendiente',  bg: '#FEF3C7', tx: '#92400E' },
    { value: 'rejected', label: 'Rechazado',  bg: '#FEE2E2', tx: '#991B1B' },
];

const KycTercerosList: React.FC<{ profile: AdminProfile; canApprove: boolean }> = ({ profile, canApprove }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const toast = useToast();
    const [items, setItems]   = useState<BeneficiaryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [detail, setDetail] = useState<BeneficiaryRow | null>(null);
    const [limitsFor, setLimitsFor] = useState<BeneficiaryRow | null>(null);
    const [benBlockTarget, setBenBlockTarget] = useState<BeneficiaryRow | null>(null);
    const [search, setSearch] = useState('');
    const canBlock = canApprove;

    // De qué tabla salió cada fila: nos sirve para que toggleBlock haga UPDATE
    // contra la tabla correcta y no se vaya al hueco si una no existe.
    const [sourceTable, setSourceTable] = useState<'beneficiaries' | 'contacts'>('beneficiaries');

    const load = useCallback(async () => {
        setLoading(true);

        // Estrategia: probamos PRIMERO public.beneficiaries (lo que pidió la
        // spec de Antigravity). Si no existe o devuelve 0 filas, caemos a
        // public.contacts (tabla legacy de este repo) y normalizamos el shape.
        // Así el admin ve los terceros sin importar dónde estén guardados.

        // Helper: ejecuta select con embed FK; si la FK no está expuesta,
        // reintenta sin el embed.
        const queryTable = async (table: string, embed: string) => {
            const first = await supabasePersonas
                .from(table)
                .select(`*, ${embed}`)
                .order('created_at', { ascending: false })
                .limit(200);
            if (!first.error) return first;
            return supabasePersonas
                .from(table)
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200);
        };

        // 1) beneficiaries (spec). FK: owner_user_id → users.
        const ben = await queryTable('beneficiaries', 'owner:users!owner_user_id(full_name, email, cuypay_id)');
        const benRows = (ben.data as BeneficiaryRow[] | null) ?? [];
        if (!ben.error && benRows.length > 0) {
            setItems(benRows);
            setSourceTable('beneficiaries');
            setLoading(false);
            return;
        }

        // 2) Fallback: contacts (tabla legacy de este repo).
        //    Schema asumido: id, user_id, name, email, phone, created_at + opc
        //    country, doc_type, doc_number, kyc_status, is_active.
        const con = await queryTable('contacts', 'owner:users!user_id(full_name, email, cuypay_id)');
        const conRowsRaw = (con.data as any[] | null) ?? [];
        if (con.error && benRows.length === 0) {
            // Ambas fallaron. Dejamos lo que tengamos de beneficiaries (vacío) y
            // dejamos que la EmptyState explique al admin.
            setItems(benRows);
            setSourceTable('beneficiaries');
            setLoading(false);
            return;
        }
        const conRows: BeneficiaryRow[] = conRowsRaw.map(r => ({
            id:               r.id,
            owner_user_id:    r.user_id ?? r.owner_user_id ?? null,
            full_name:        r.full_name ?? r.name ?? null,
            doc_type:         r.doc_type ?? null,
            doc_number:       r.doc_number ?? null,
            country:          r.country ?? null,
            phone:            r.phone ?? null,
            email:            r.email ?? null,
            didit_session_id: r.didit_session_id ?? null,
            kyc_status:       r.kyc_status ?? null,
            kyc_verified_at:  r.kyc_verified_at ?? null,
            linked_user_id:   r.linked_user_id ?? null,
            is_active:        typeof r.is_active === 'boolean' ? r.is_active : true,
            created_at:       r.created_at,
            owner:            r.owner ?? null,
        }));
        // Mergeamos por id (sin duplicar si un mismo registro existe en ambas).
        const merged = new Map<string, BeneficiaryRow>();
        for (const b of benRows) merged.set(b.id, b);
        for (const c of conRows) if (!merged.has(c.id)) merged.set(c.id, c);
        setItems(Array.from(merged.values()).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')));
        // Tabla "ganadora" para el UPDATE del bloqueo:
        // - si beneficiaries trajo filas, asumimos que es la tabla principal
        // - si solo contacts trajo, usamos contacts
        setSourceTable(benRows.length > 0 ? 'beneficiaries' : 'contacts');
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    // Bloquear abre el BlockUserModal (motivo estructurado + checklist de
    // docs para desbloquear — mismo modal que usuarios). Desbloquear es
    // directo sin modal.
    const toggleBlock = (b: BeneficiaryRow) => {
        if (!canBlock) return;
        const willBlock = b.is_active !== false;
        if (willBlock) { setBenBlockTarget(b); return; }
        void applyBenUnblock(b);
    };

    const applyBenBlock = async (b: BeneficiaryRow, payload: BlockPayload) => {
        setProcessingId(b.id);
        const notesForDb = payload.type === 'permanent' && payload.customInfo
            ? `[PERMANENTE — info requerida] ${payload.customInfo}${payload.notes ? `\n\n${payload.notes}` : ''}`
            : (payload.notes || null);
        // El bloqueo NO toca kyc_status — el estado KYC es la verdad de Didit
        // y el bloqueo es una medida de compliance aparte (is_active + block_*).
        // Un tercero puede estar Aprobado Y bloqueado a la vez.
        const full: Record<string, any> = {
            is_active:          false,
            block_type:         payload.type,
            block_reason:       payload.reason,
            block_notes:        notesForDb,
            required_documents: payload.type === 'temporary' ? payload.required : [],
        };
        let { error } = await supabasePersonas.from(sourceTable).update(full).eq('id', b.id);
        if (error && /column/i.test(error.message)) {
            const retry = await supabasePersonas.from(sourceTable)
                .update({ is_active: false }).eq('id', b.id);
            error = retry.error;
        }
        setProcessingId(null);
        if (error) {
            toast.error(`No pude bloquear: ${error.message}`);
            return;
        }
        // Crear la solicitud en document_requests para que aparezca en
        // Compliance → Documentación. El user_id es el DUEÑO del tercero
        // (él es quien sube los documentos desde su app). Solo en bloqueo
        // temporal con docs requeridos.
        if (payload.type === 'temporary' && payload.required.length > 0) {
            if (!b.owner_user_id) {
                toast.warn('Bloqueado, pero el tercero no tiene owner_user_id — no pude crear la solicitud en Documentación.');
            } else {
                const reasonMap: Record<string, string> = {
                    aml_infringement:    'Infracción de norma AML',
                    suspicious_activity: 'Actividad sospechosa',
                    pep_mismatch:        'PEP / lista de sanciones',
                    identity_unverified: 'Identidad no verificada',
                    fraud_suspected:     'Sospecha de fraude',
                    duplicate_account:   'Cuenta duplicada',
                    court_order:         'Orden judicial / regulatoria',
                    other:               'Otro',
                };
                const reasonLabel = reasonMap[payload.reason] ?? payload.reason;
                const ownerLine = `Dueño: ${b.owner?.full_name ?? '—'} · ${b.owner?.email ?? b.owner_user_id}`;
                const { error: drErr } = await supabasePersonas.from('document_requests').insert({
                    user_id:      b.owner_user_id,
                    category:     'other',
                    title:        `[BLOQUEO] Tercero: ${b.full_name ?? 's/n'} — ${reasonLabel}`,
                    description:  `${ownerLine}\n\nTercero bloqueado: ${b.full_name ?? '—'} (${b.doc_number ?? 'sin doc'})\n\n${payload.notes?.trim() ? payload.notes.trim() + '\n\n' : ''}Documentos requeridos: ${payload.required.join(', ')}`,
                    requested_by: profile.id,
                    status:       'pending',
                    review_notes: JSON.stringify({
                        required: payload.required,
                        reason: payload.reason,
                        beneficiary_id: b.id,
                        beneficiary_name: b.full_name,
                    }),
                });
                if (drErr) {
                    console.error('[ben_block] doc_request INSERT failed:', drErr);
                    toast.warn(`Bloqueado, pero no pude crear la solicitud en Documentación: ${drErr.message}`);
                }
            }
        }

        toast.success(`${b.full_name ?? 'Beneficiario'} bloqueado — el dueño verá los documentos requeridos en la app (vía Didit).`);
        await logAdminAction({
            admin: profile,
            action: 'beneficiary_block',
            targetType: 'beneficiary',
            targetId: b.id,
            metadata: {
                full_name: b.full_name, owner_user_id: b.owner_user_id,
                type: payload.type, reason: payload.reason,
                notes: payload.notes || null, required: payload.required,
                customInfo: payload.customInfo ?? null,
            },
        });
        setBenBlockTarget(null);
        await load();
    };

    const applyBenUnblock = async (b: BeneficiaryRow) => {
        setProcessingId(b.id);
        // El desbloqueo tampoco toca kyc_status — salvo limpieza de filas
        // LEGACY que quedaron con kyc_status='blocked' de la versión
        // anterior: esas vuelven a su estado real de Didit.
        const restoredKyc = b.kyc_status === 'blocked'
            ? (b.kyc_verified_at ? 'approved' : 'pending')
            : undefined;
        const full: Record<string, any> = {
            is_active:          true,
            block_type:         null,
            block_reason:       null,
            block_notes:        null,
            required_documents: [],
            ...(restoredKyc ? { kyc_status: restoredKyc } : {}),
        };
        let { error } = await supabasePersonas.from(sourceTable).update(full).eq('id', b.id);
        if (error && /column/i.test(error.message)) {
            const retry = await supabasePersonas.from(sourceTable)
                .update({ is_active: true, ...(restoredKyc ? { kyc_status: restoredKyc } : {}) })
                .eq('id', b.id);
            error = retry.error;
        }
        setProcessingId(null);
        if (error) {
            toast.error(`No pude desbloquear: ${error.message}`);
            return;
        }
        // Cancelar las solicitudes de docs de ESTE tercero que sigan
        // pendientes (matcheamos por el beneficiary_id serializado en
        // review_notes).
        if (b.owner_user_id) {
            await supabasePersonas
                .from('document_requests')
                .update({
                    status:       'canceled',
                    review_notes: 'Cancelada automáticamente al desbloquear al tercero.',
                    reviewed_by:  profile.id,
                    reviewed_at:  new Date().toISOString(),
                })
                .eq('user_id', b.owner_user_id)
                .eq('status', 'pending')
                .like('title', '[BLOQUEO] Tercero:%')
                .like('review_notes', `%${b.id}%`);
        }
        toast.success(`${b.full_name ?? 'Beneficiario'} desbloqueado.`);
        await logAdminAction({
            admin: profile,
            action: 'beneficiary_unblock',
            targetType: 'beneficiary',
            targetId: b.id,
            metadata: { full_name: b.full_name, owner_user_id: b.owner_user_id },
        });
        await load();
    };

    // Cambiar el kyc_status del beneficiario desde el selector.
    // 'blocked' hace que la app mobile muestre el flujo de re-subir
    // documentación vía Didit para ese tercero.
    const setKycStatus = async (b: BeneficiaryRow, newStatus: string) => {
        if (!canBlock || newStatus === b.kyc_status) return;
        setProcessingId(b.id);
        // Optimista
        setItems(prev => prev.map(x => x.id === b.id ? { ...x, kyc_status: newStatus } : x));
        const { error } = await supabasePersonas
            .from(sourceTable)
            .update({ kyc_status: newStatus })
            .eq('id', b.id);
        setProcessingId(null);
        if (error) {
            setItems(prev => prev.map(x => x.id === b.id ? { ...x, kyc_status: b.kyc_status } : x));
            toast.error(`No pude cambiar el estado: ${error.message}`);
            return;
        }
        const label = BEN_KYC_STATES.find(s => s.value === newStatus)?.label ?? newStatus;
        toast.success(`${b.full_name ?? 'Beneficiario'} → ${label}${newStatus === 'blocked' ? '. La app le pedirá documentación vía Didit.' : ''}`);
        await logAdminAction({
            admin: profile,
            action: 'beneficiary_kyc_status.set',
            targetType: 'beneficiary',
            targetId: b.id,
            metadata: { full_name: b.full_name, owner_user_id: b.owner_user_id, from: b.kyc_status, to: newStatus },
        });
    };

    const kycBadge = (status: string | null) => {
        const map: Record<string, { bg: string; text: string; label: string }> = {
            verified:    { bg: '#D1FAE5', text: '#065F46', label: 'Verificado · Lincoin' },
            approved:    { bg: '#D1FAE5', text: '#065F46', label: 'Verificado · Lincoin' },
            in_progress: { bg: '#FEF3C7', text: '#92400E', label: 'En proceso · Lincoin' },
            pending:     { bg: '#FEF3C7', text: '#92400E', label: 'Pendiente · Lincoin' },
            rejected:    { bg: '#FEE2E2', text: '#991B1B', label: 'Rechazado · Lincoin' },
            blocked:     { bg: '#7F1D1D', text: '#FFFFFF', label: 'Bloqueado · Lincoin' },
        };
        const s = map[status ?? ''] ?? { bg: '#F1F5F9', text: '#475569', label: status ?? 'Sin KYC' };
        return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>;
    };

    // Helper: clasifica el kyc_status crudo a una "bucket" que usamos en chips.
    // Aceptamos sinónimos para no fallar contra distintos backends.
    type Bucket = 'verified' | 'pending' | 'rejected' | 'blocked' | 'other';
    const bucketOf = (b: BeneficiaryRow): Bucket => {
        if (b.is_active === false) return 'blocked';
        const s = String(b.kyc_status ?? '').toLowerCase();
        if (s === 'verified' || s === 'approved' || s === 'completed') return 'verified';
        if (s === 'pending' || s === 'in_progress' || s === 'in_review') return 'pending';
        if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'failed') return 'rejected';
        return 'other';
    };

    // Conteos para los stat cards (toda la lista, ignora search/filter).
    const counts = items.reduce<Record<Bucket | 'all', number>>(
        (acc, b) => {
            const k = bucketOf(b);
            acc.all      = (acc.all      ?? 0) + 1;
            acc[k]       = (acc[k]       ?? 0) + 1;
            return acc;
        },
        { all: 0, verified: 0, pending: 0, rejected: 0, blocked: 0, other: 0 },
    );

    // Filtros activos: chip (status) + search box (nombre/email/doc/id/dueño).
    // Default 'verified': cuando el admin entra a Compliance KYC, le interesa
    // ver primero los usuarios ya verificados. Si quiere ver todos, click en
    // la card "Total" o "Limpiar filtros".
    const [statusFilter, setStatusFilter] = useState<'all' | Bucket>('verified');

    const filtered = items.filter(b => {
        if (statusFilter !== 'all' && bucketOf(b) !== statusFilter) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return [
            b.full_name, b.email, b.doc_number, b.phone, b.id,
            b.owner?.email, b.owner?.full_name, b.owner?.cuypay_id, b.owner_user_id,
        ].some(v => v && String(v).toLowerCase().includes(q));
    });

    // Definición de los stat cards (orden visual de izquierda a derecha).
    const stats: Array<{ key: 'all' | Bucket; label: string; color: string; bg: string }> = [
        { key: 'all',      label: 'Total',       color: '#0F172A', bg: '#F8FAFC' },
        { key: 'verified', label: 'Verificados', color: '#065F46', bg: '#D1FAE5' },
        { key: 'pending',  label: 'Pendientes',  color: '#92400E', bg: '#FEF3C7' },
        { key: 'rejected', label: 'Cancelados',  color: '#991B1B', bg: '#FEE2E2' },
        { key: 'blocked',  label: 'Bloqueados',  color: '#7F1D1D', bg: '#FCA5A5' },
    ];

    return (
        <div className="space-y-4">
            {confirmDialog}
            {/* Stat cards (clickeables: filtran al hacer click) */}
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
                                // @ts-ignore — ring color via inline style; Tailwind ring no soporta hex dinámico
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

            {/* Toolbar: search + reset filter */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, email, documento, ID o dueño..."
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 focus:border-teal-500 outline-none text-sm"
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
                    Mostrando <b className="text-slate-900">{filtered.length}</b> de {items.length}
                </span>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && filtered.length === 0 && items.length === 0 && (
                <EmptyState
                    icon={UserPlus}
                    title="Sin terceros"
                    message="Buscamos en public.beneficiaries y public.contacts y no devolvieron filas. Si los usuarios ya cargaron contactos, probablemente la RLS de esas tablas no permite SELECT desde el admin — verificá que la policy incluya admin_role IN ('super_admin','compliance')."
                />
            )}
            {!loading && filtered.length === 0 && items.length > 0 && (
                <EmptyState icon={UserPlus} title="Sin resultados" message="No hay terceros que matcheen la búsqueda" />
            )}

            {filtered.map(b => {
                const blocked = b.is_active === false;
                const initial = (b.full_name?.[0] ?? b.email?.[0] ?? '?').toUpperCase();
                return (
                <div key={b.id} className={`bg-white rounded-2xl border p-5 shadow-sm ${blocked ? 'border-red-300' : 'border-slate-200'}`}>
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0" style={{ backgroundColor: blocked ? '#FCA5A5' : TEAL, color: NAVY }}>
                            {initial}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-semibold text-slate-900 truncate">{b.full_name ?? '—'}</p>
                                        {kycBadge(b.kyc_status)}
                                        {blocked && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">BLOQUEADO</span>}
                                    </div>
                                    <p className="text-sm text-slate-500 truncate">{b.email ?? b.phone ?? '—'}</p>
                                </div>
                                <div className="flex gap-2 shrink-0 flex-wrap items-center">
                                    {/* Selector de estado KYC — dimensión SEPARADA del bloqueo.
                                        Normalizamos sinónimos de Didit (verified/completed →
                                        approved) para que el select refleje el estado real. */}
                                    {canBlock && (() => {
                                        const raw = String(b.kyc_status ?? '').toLowerCase();
                                        const normalized =
                                            ['approved', 'verified', 'completed'].includes(raw) ? 'approved' :
                                            ['rejected', 'declined', 'cancelled', 'canceled', 'failed'].includes(raw) ? 'rejected' :
                                            'pending';
                                        const st = BEN_KYC_STATES.find(s => s.value === normalized);
                                        return (
                                            <select
                                                value={normalized}
                                                onChange={e => setKycStatus(b, e.target.value)}
                                                disabled={processingId === b.id}
                                                title="Cambiar estado KYC del beneficiario (independiente del bloqueo)"
                                                className="px-2.5 py-2 text-sm font-semibold rounded-lg border outline-none cursor-pointer disabled:opacity-50"
                                                style={st
                                                    ? { backgroundColor: st.bg, color: st.tx, borderColor: 'transparent' }
                                                    : { backgroundColor: '#F1F5F9', color: '#475569', borderColor: '#E2E8F0' }}
                                            >
                                                {BEN_KYC_STATES.map(s => (
                                                    <option key={s.value} value={s.value}>{s.label}</option>
                                                ))}
                                            </select>
                                        );
                                    })()}
                                    {/* Botón rojo cuando está BLOQUEADO (is_active=false):
                                        el dueño re-sube docs vía Didit */}
                                    {canBlock && b.is_active === false && (
                                        <button
                                            onClick={() => toast.info(
                                                `${b.full_name ?? 'El beneficiario'} está BLOQUEADO — el dueño lo verá reflejado en su app y podrá subir la documentación a través de Didit.`
                                            )}
                                            className="px-3 py-2 text-sm font-bold rounded-lg text-white bg-red-600 hover:bg-red-700 flex items-center gap-1.5"
                                            title="El usuario verá el estado bloqueado en la app y podrá re-subir documentación vía Didit"
                                        >
                                            <FileWarning size={14} /> Solicitar Documentación
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setDetail(b)}
                                        className="px-3 py-2 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-200"
                                    >
                                        Ver detalle
                                    </button>
                                    {canBlock && (
                                        <button
                                            onClick={() => setLimitsFor(b)}
                                            className="px-3 py-2 text-sm font-semibold rounded-lg flex items-center gap-1.5"
                                            style={{ backgroundColor: TEAL + '22', color: NAVY }}
                                            title="Ver y ajustar topes operativos de este beneficiario"
                                        >
                                            <Gauge size={14} /> Topes
                                        </button>
                                    )}
                                    {canBlock && (
                                        <button
                                            onClick={() => toggleBlock(b)}
                                            disabled={processingId === b.id}
                                            className={`px-3 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1.5 ${
                                                blocked
                                                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                    : 'bg-red-50 text-red-700 hover:bg-red-100'
                                            }`}
                                        >
                                            {blocked ? <><CheckCircle2 size={14} /> Desbloquear</> : <><Ban size={14} /> Bloquear</>}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-slate-100">
                                <LimitUsageBar subjectId={b.id} subject="beneficiary" variant="full" />
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
                                <div className="md:col-span-2">
                                    <span className="block text-slate-400">Dueño (quién lo creó)</span>
                                    <span className="block text-slate-800 font-semibold truncate">
                                        {b.owner?.full_name ?? (b.owner_user_id ? `${b.owner_user_id.slice(0, 8)}…` : '—')}
                                    </span>
                                    <span className="block text-slate-500 truncate">
                                        {b.owner?.email ?? '—'}
                                    </span>
                                    <span className="block text-slate-400 font-mono text-[10px] truncate">
                                        Lincoin ID: {b.owner?.cuypay_id ?? (b.owner_user_id ?? '—')}
                                    </span>
                                </div>
                                <div>
                                    <span className="block text-slate-400">País</span>
                                    <span className="text-slate-700">{b.country ?? '—'}</span>
                                </div>
                                <div>
                                    <span className="block text-slate-400">Documento</span>
                                    <span className="text-slate-700 font-mono">{b.doc_type ? `${b.doc_type} ` : ''}{b.doc_number ?? '—'}</span>
                                </div>
                                <div>
                                    <span className="block text-slate-400">Registrado</span>
                                    <span className="text-slate-700">{formatDate(b.created_at)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                );
            })}

            {detail && (
                <KycDetailModal
                    kind="beneficiary"
                    entity={{
                        id:               detail.id,
                        full_name:        detail.full_name,
                        email:            detail.email,
                        phone:            detail.phone,
                        country:          detail.country,
                        doc_type:         detail.doc_type,
                        doc_number:       detail.doc_number,
                        kyc_status:       detail.kyc_status,
                        kyc_verified_at:  detail.kyc_verified_at,
                        didit_session_id: detail.didit_session_id,
                        is_active:        detail.is_active,
                        owner_user_id:    detail.owner_user_id,
                        linked_user_id:   detail.linked_user_id,
                        owner:            detail.owner,
                        created_at:       detail.created_at,
                    }}
                    profile={profile}
                    canApprove={canApprove}
                    onClose={() => setDetail(null)}
                    onSaved={load}
                />
            )}

            {benBlockTarget && (
                <BlockUserModal
                    userLabel={
                        (benBlockTarget.full_name ?? 'Beneficiario')
                        + (benBlockTarget.owner?.full_name ? ` — de ${benBlockTarget.owner.full_name}` : '')
                    }
                    saving={processingId === benBlockTarget.id}
                    onCancel={() => setBenBlockTarget(null)}
                    onConfirm={(payload) => applyBenBlock(benBlockTarget, payload)}
                />
            )}

            {limitsFor && (
                <div
                    className="fixed inset-0 bg-black/50 z-[60] flex items-stretch justify-end"
                    onClick={() => setLimitsFor(null)}
                >
                    <div
                        className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: TEAL + '22' }}>
                                    <Gauge size={18} style={{ color: NAVY }} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs uppercase font-bold tracking-wider text-slate-500">Topes del beneficiario</p>
                                    <p className="font-bold truncate" style={{ color: NAVY }}>{limitsFor.full_name ?? '—'}</p>
                                    {limitsFor.owner?.full_name && (
                                        <p className="text-[11px] text-slate-500 truncate">Dueño: {limitsFor.owner.full_name}</p>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => setLimitsFor(null)}
                                className="p-2 hover:bg-slate-100 rounded-lg shrink-0"
                            >
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="p-5">
                            <UserLimitsCard
                                userId={limitsFor.id}
                                profile={profile}
                                subject="beneficiary"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// TAB: RULES — CRUD de reglas AML
// ─────────────────────────────────────────────
const RulesTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [rules, setRules] = useState<AmlRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabasePersonas.from('aml_rules').select('*').order('created_at', { ascending: false });
        setRules((data as AmlRule[]) ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleActive = async (r: AmlRule) => {
        await supabasePersonas.from('aml_rules').update({ is_active: !r.is_active }).eq('id', r.id);
        await logAdminAction({
            admin: profile,
            action: r.is_active ? 'aml_rule_deactivate' : 'aml_rule_activate',
            targetType: 'aml_rule',
            targetId: r.id,
            metadata: { name: r.name },
        });
        load();
    };

    const removeRule = async (r: AmlRule) => {
        const ok = await confirm({
            title: 'Eliminar regla',
            message: `¿Eliminar la regla "${r.name}"?`,
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        await supabasePersonas.from('aml_rules').delete().eq('id', r.id);
        await logAdminAction({ admin: profile, action: 'aml_rule_delete', targetType: 'aml_rule', targetId: r.id, metadata: { name: r.name } });
        load();
    };

    return (
        <div>
            {confirmDialog}
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-500">{rules.length} reglas configuradas</p>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white rounded-lg"
                    style={{ backgroundColor: NAVY }}
                >
                    <Plus size={14} /> Nueva regla
                </button>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && rules.length === 0 && (
                <EmptyState icon={FileWarning} title="Sin reglas" message="Crea reglas para auto-detectar TX sospechosas" />
            )}

            <div className="space-y-2">
                {rules.map(r => {
                    const sev = SEVERITY_COLORS[r.severity];
                    return (
                        <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="font-semibold text-slate-900">{r.name}</span>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-bold uppercase" style={{ backgroundColor: sev.bg, color: sev.text }}>{r.severity}</span>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                                        {RULE_TYPES.find(t => t.value === r.rule_type)?.label ?? r.rule_type}
                                    </span>
                                    {/* Alcance: general con/sin exención de topes justificados */}
                                    {(r as any).exempt_custom_limits !== false ? (
                                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-800" title="Los usuarios con topes aumentados o justificación aprobada no disparan esta regla">
                                            General · exime topes justificados
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-800" title="Aplica a TODOS los usuarios sin excepción">
                                            General · sin excepciones
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500">{r.description}</p>
                                <p className="text-xs text-slate-400 mt-1">
                                    {r.amount_threshold ? `Umbral: ${r.amount_threshold.toLocaleString('es-CO')} USD` : ''}
                                    {(r as any).tx_count ? ` · ${(r as any).tx_count} TXs` : ''}
                                    {r.time_window_hours ? ` · ventana ${r.time_window_hours}h` : ''}
                                </p>
                            </div>
                            <button
                                onClick={() => toggleActive(r)}
                                className="px-2.5 py-1 rounded-full text-xs font-semibold"
                                style={{
                                    backgroundColor: r.is_active ? '#D1FAE5' : '#FEE2E2',
                                    color: r.is_active ? '#065F46' : '#991B1B',
                                }}
                            >
                                {r.is_active ? 'Activa' : 'Inactiva'}
                            </button>
                            <button onClick={() => removeRule(r)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    );
                })}
            </div>

            {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} profile={profile} />}
        </div>
    );
};

// Catálogo de tipos de regla — cobertura típica de un oficial de
// cumplimiento en una remesadora. Cada tipo declara qué parámetros usa.
interface RuleTypeDef {
    value: string;
    group: string;
    label: string;
    hint: string;
    usesAmount?: boolean;
    amountLabel?: string;
    usesCount?: boolean;
    countLabel?: string;
    usesWindow?: boolean;
    usesAge?: boolean;
    usesCountries?: boolean;
    usesHours?: boolean;   // franja horaria (desde-hasta)
}

const RULE_TYPES: RuleTypeDef[] = [
    // ── Montos y volumen ──
    { value: 'high_amount',      group: 'Montos y volumen', label: 'Monto alto único',
      hint: 'Una sola transacción supera el umbral (en USD).',
      usesAmount: true },
    { value: 'daily_volume',     group: 'Montos y volumen', label: 'Volumen acumulado por usuario',
      hint: 'La suma de TODAS las TXs del usuario supera el umbral dentro de la ventana (independiente del destino).',
      usesAmount: true, usesWindow: true },
    { value: 'cross_border',     group: 'Montos y volumen', label: 'Acumulado transfronterizo',
      hint: 'El volumen acumulado hacia otros países supera el umbral en la ventana.',
      usesAmount: true, usesWindow: true, usesCountries: true },
    { value: 'round_amounts',    group: 'Montos y volumen', label: 'Montos redondos repetidos',
      hint: 'El usuario repite montos redondos idénticos (ej. 1.000 exactos) N veces en la ventana — patrón de estructuración.',
      usesCount: true, countLabel: 'Repeticiones', usesWindow: true },
    // ── Frecuencia y patrón ──
    { value: 'velocity',         group: 'Frecuencia y patrón', label: 'Velocidad de operaciones',
      hint: 'Demasiadas transacciones dentro de una ventana de tiempo.',
      usesCount: true, usesWindow: true },
    { value: 'frequent_low',     group: 'Frecuencia y patrón', label: 'Pitufeo (montos chicos frecuentes)',
      hint: 'Muchas TXs pequeñas para evadir umbrales — cuenta TXs por debajo del monto dentro de la ventana.',
      usesAmount: true, amountLabel: 'Monto máximo por TX (USD)', usesCount: true, usesWindow: true },
    { value: 'pass_through',     group: 'Frecuencia y patrón', label: 'Pass-through (carga y envía de inmediato)',
      hint: 'El usuario carga plata y la envía casi completa dentro de la ventana — cuenta puente.',
      usesAmount: true, amountLabel: 'Monto mínimo (USD)', usesWindow: true },
    { value: 'odd_hours',        group: 'Frecuencia y patrón', label: 'Horario inusual',
      hint: 'Transacciones por encima del monto dentro de la franja horaria configurada (ej. madrugada).',
      usesAmount: true, usesHours: true },
    // ── Perfil del usuario ──
    { value: 'new_account_volume', group: 'Perfil del usuario', label: 'Cuenta nueva con volumen alto',
      hint: 'Una cuenta con menos días de antigüedad que el límite mueve más del umbral.',
      usesAmount: true, usesAge: true },
    { value: 'dormant_reactivation', group: 'Perfil del usuario', label: 'Reactivación de cuenta dormida',
      hint: 'Una cuenta inactiva por más días que el límite vuelve a operar con más del umbral.',
      usesAmount: true, usesAge: true },
    { value: 'many_beneficiaries', group: 'Perfil del usuario', label: 'Muchos terceros nuevos',
      hint: 'El usuario registra N o más beneficiarios nuevos dentro de la ventana y les envía plata.',
      usesCount: true, countLabel: 'Terceros nuevos', usesWindow: true },
    { value: 'high_risk_country', group: 'Perfil del usuario', label: 'País de alto riesgo',
      hint: 'Transacciones desde/hacia países de la lista configurada (GAFI / sanciones).',
      usesAmount: true, amountLabel: 'Monto mínimo (USD, 0 = cualquiera)', usesCountries: true },
    { value: 'shared_device',    group: 'Perfil del usuario', label: 'Dispositivo/IP compartido',
      hint: 'N o más cuentas distintas operando desde el mismo dispositivo o IP.',
      usesCount: true, countLabel: 'Cuentas distintas' },
];

// Acción cuando la regla dispara — decide qué pasa con el usuario.
const RULE_ACTIONS: Array<{ value: string; label: string; desc: string }> = [
    { value: 'alert',      label: 'Solo alerta',                 desc: 'Genera la alerta en Compliance. El usuario sigue operando.' },
    { value: 'alert_hold', label: 'Alerta + hold de operaciones', desc: 'Genera la alerta y activa Compliance Hold (no puede enviar ni cargar hasta revisión).' },
    { value: 'alert_block', label: 'Alerta + bloqueo temporal',   desc: 'Genera la alerta y bloquea la cuenta automáticamente hasta que Compliance revise.' },
];

const RULE_CURRENCIES = ['USD', 'COP', 'PEN', 'CLP', 'MXN', 'BRL', 'VES'];

const CreateRuleModal: React.FC<{ onClose: () => void; onCreated: () => void; profile: AdminProfile }> = ({ onClose, onCreated, profile }) => {
    const toast = useToast();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [ruleType, setRuleType] = useState<string>('high_amount');
    const [threshold, setThreshold] = useState('');
    const [txCount, setTxCount] = useState('');
    const [windowHours, setWindowHours] = useState('24');
    const [ageDays, setAgeDays] = useState('30');
    const [hourFrom, setHourFrom] = useState('00');
    const [hourTo, setHourTo] = useState('05');
    const [countries, setCountries] = useState('');
    const [currencies, setCurrencies] = useState<Set<string>>(new Set());  // vacío = todas
    const [action, setAction] = useState('alert');
    const [cooldown, setCooldown] = useState('24');
    const [severity, setSeverity] = useState<AmlRule['severity']>('medium');
    // Regla GENERAL para todos — con la excepción clave del negocio:
    // usuarios que ya justificaron sus movimientos o tienen topes
    // aumentados aprobados (custom limits) quedan eximidos.
    const [exemptCustomLimits, setExemptCustomLimits] = useState(true);
    const [loading, setLoading] = useState(false);

    const rt = RULE_TYPES.find(r => r.value === ruleType)!;
    const groups = Array.from(new Set(RULE_TYPES.map(r => r.group)));

    const toggleCurrency = (c: string) => setCurrencies(prev => {
        const next = new Set(prev);
        if (next.has(c)) next.delete(c); else next.add(c);
        return next;
    });

    const canSave = name.trim().length > 0
        && (!rt.usesAmount || threshold.trim().length > 0)
        && (!rt.usesCount  || txCount.trim().length > 0)
        && (!rt.usesWindow || windowHours.trim().length > 0)
        && (!rt.usesAge    || ageDays.trim().length > 0)
        && (!rt.usesCountries || ruleType !== 'high_risk_country' || countries.trim().length > 0);

    const save = async () => {
        if (!canSave) return;
        setLoading(true);
        const countryList = countries.split(/[,\s]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
        // Intento completo con las columnas nuevas; si el schema no las tiene
        // (falta la migración 2026_aml_rules_v2.sql), retry sin ellas.
        const fullRow: Record<string, any> = {
            name: name.trim(),
            description: description.trim() || null,
            rule_type: ruleType,
            amount_threshold: rt.usesAmount && threshold ? Number(threshold) : null,
            tx_count: rt.usesCount && txCount ? Number(txCount) : null,
            time_window_hours: rt.usesWindow && windowHours ? Number(windowHours) : null,
            account_age_days: rt.usesAge && ageDays ? Number(ageDays) : null,
            hour_from: rt.usesHours ? Number(hourFrom) : null,
            hour_to: rt.usesHours ? Number(hourTo) : null,
            countries: rt.usesCountries ? countryList : [],
            currencies: Array.from(currencies),          // [] = todas
            rule_action: action,
            cooldown_hours: cooldown ? Number(cooldown) : null,
            severity,
            is_active: true,
            applies_to: 'all',
            exempt_custom_limits: exemptCustomLimits,
        };
        let { data, error } = await supabasePersonas.from('aml_rules').insert(fullRow).select().single();
        if (error && /column|check constraint/i.test(error.message)) {
            // Fallback: columnas base + todo lo demás anotado en description
            const extras: string[] = [
                exemptCustomLimits ? '[Exime topes justificados]' : '[Sin excepciones]',
                `[accion=${action}]`,
                fullRow.tx_count ? `[tx_count=${fullRow.tx_count}]` : '',
                fullRow.account_age_days ? `[antiguedad=${fullRow.account_age_days}d]` : '',
                rt.usesHours ? `[franja=${hourFrom}h-${hourTo}h]` : '',
                countryList.length ? `[paises=${countryList.join('/')}]` : '',
                currencies.size ? `[monedas=${Array.from(currencies).join('/')}]` : '',
                cooldown ? `[cooldown=${cooldown}h]` : '',
            ].filter(Boolean);
            const basic: Record<string, any> = {
                name: fullRow.name,
                description: [fullRow.description, ...extras].filter(Boolean).join(' '),
                // rule_type puede tener CHECK viejo de 4 valores — mapeamos los
                // nuevos al más cercano y anotamos el real en description
                rule_type: ['high_amount', 'velocity', 'cross_border', 'frequent_low'].includes(ruleType)
                    ? ruleType
                    : (rt.usesCount ? 'velocity' : 'high_amount'),
                amount_threshold: fullRow.amount_threshold,
                time_window_hours: fullRow.time_window_hours,
                severity, is_active: true,
            };
            if (basic.rule_type !== ruleType) basic.description = `[tipo=${ruleType}] ${basic.description}`;
            const retry = await supabasePersonas.from('aml_rules').insert(basic).select().single();
            data = retry.data; error = retry.error;
            if (!retry.error) {
                toast.warn('Regla creada en modo compatible — corré la migración 2026_aml_rules_v2.sql para persistir todos los parámetros como columnas.');
            }
        }
        setLoading(false);
        if (error) { toast.error(`No pude crear la regla: ${error.message}`); return; }
        if (data) {
            await logAdminAction({
                admin: profile, action: 'aml_rule_create', targetType: 'aml_rule', targetId: (data as any).id,
                metadata: { name, rule_type: ruleType, severity, rule_action: action, exempt_custom_limits: exemptCustomLimits },
            });
        }
        onCreated();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg" style={{ color: NAVY }}>Nueva regla AML</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Nombre *</label>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3" placeholder="Ej: TX única > 5.000 USD" />

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Tipo de regla</label>
                <select value={ruleType} onChange={e => setRuleType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white">
                    {groups.map(g => (
                        <optgroup key={g} label={g}>
                            {RULE_TYPES.filter(r => r.group === g).map(r => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1 mb-3">{rt.hint}</p>

                {/* Parámetros según tipo */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                    {rt.usesAmount && (
                        <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">
                                {rt.amountLabel ?? 'Umbral de monto (USD)'} *
                            </label>
                            <input value={threshold} onChange={e => setThreshold(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" placeholder="5000" />
                        </div>
                    )}
                    {rt.usesCount && (
                        <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">{rt.countLabel ?? 'Cantidad de TXs'} *</label>
                            <input value={txCount} onChange={e => setTxCount(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" placeholder="10" />
                        </div>
                    )}
                    {rt.usesWindow && (
                        <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Ventana (horas) *</label>
                            <input value={windowHours} onChange={e => setWindowHours(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" placeholder="24" />
                        </div>
                    )}
                    {rt.usesAge && (
                        <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">
                                {ruleType === 'dormant_reactivation' ? 'Días de inactividad *' : 'Antigüedad máxima (días) *'}
                            </label>
                            <input value={ageDays} onChange={e => setAgeDays(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" placeholder="30" />
                        </div>
                    )}
                    {rt.usesHours && (
                        <div className="col-span-2 grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Desde (hora 0-23)</label>
                                <input value={hourFrom} onChange={e => setHourFrom(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" placeholder="00" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Hasta (hora 0-23)</label>
                                <input value={hourTo} onChange={e => setHourTo(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" placeholder="05" />
                            </div>
                        </div>
                    )}
                    {rt.usesCountries && (
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">
                                Países (códigos ISO separados por coma){ruleType === 'high_risk_country' ? ' *' : ' — vacío = todos'}
                            </label>
                            <input value={countries} onChange={e => setCountries(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono uppercase" placeholder="VE, NG, IR, KP, MM, SY" />
                        </div>
                    )}
                </div>

                {/* Monedas — vacío = todas */}
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Monedas que evalúa (vacío = todas)</label>
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {RULE_CURRENCIES.map(c => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => toggleCurrency(c)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                currencies.has(c)
                                    ? 'text-white border-transparent'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                            }`}
                            style={currencies.has(c) ? { backgroundColor: NAVY } : {}}
                        >
                            {c}
                        </button>
                    ))}
                </div>

                {/* Acción al disparar */}
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Acción cuando dispara</label>
                <div className="space-y-1.5 mb-3">
                    {RULE_ACTIONS.map(a => (
                        <label
                            key={a.value}
                            className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                                action === a.value ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                        >
                            <input type="radio" name="rule-action" checked={action === a.value} onChange={() => setAction(a.value)} className="mt-0.5 accent-teal-600" />
                            <span className="text-xs">
                                <b style={{ color: NAVY }}>{a.label}</b>
                                <span className="block text-[11px] text-slate-500">{a.desc}</span>
                            </span>
                        </label>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Severidad</label>
                        <select value={severity} onChange={e => setSeverity(e.target.value as any)} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm">
                            <option value="low">Baja — solo registra</option>
                            <option value="medium">Media — alerta</option>
                            <option value="high">Alta — prioritaria</option>
                            <option value="critical">Crítica — inmediata</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Cooldown (horas)</label>
                        <input value={cooldown} onChange={e => setCooldown(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" placeholder="24" title="No repetir la alerta para el mismo usuario dentro de esta ventana" />
                    </div>
                </div>

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Descripción / notas</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3 resize-none text-sm" placeholder="Contexto para otros admins…" />

                {/* Alcance — GENERAL con exención */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Alcance</p>
                    <p className="text-xs text-slate-700 mb-2">
                        Esta regla es <b>general — aplica a todos los usuarios</b>.
                    </p>
                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={exemptCustomLimits}
                            onChange={e => setExemptCustomLimits(e.target.checked)}
                            className="mt-0.5 accent-teal-600"
                        />
                        <span className="text-xs text-slate-700">
                            <b>Eximir usuarios con topes aumentados o justificación aprobada</b>
                            <span className="block text-[11px] text-slate-500 mt-0.5">
                                Los usuarios con límites custom aprobados por Compliance (justificaron
                                sus movimientos vía Documentación) no disparan esta regla.
                            </span>
                        </span>
                    </label>
                </div>

                <button onClick={save} disabled={loading || !canSave} style={{ backgroundColor: NAVY }} className="w-full text-white font-bold py-3 rounded-xl disabled:opacity-50">
                    {loading ? 'Guardando...' : 'Crear regla'}
                </button>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// TAB: SANCTIONS — gestión de lista negra
// ─────────────────────────────────────────────
const SanctionsTab: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [entries, setEntries] = useState<SanctionsEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [search, setSearch] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabasePersonas.from('sanctions_list').select('*').order('added_at', { ascending: false }).limit(100);
        setEntries((data as SanctionsEntry[]) ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const removeEntry = async (e: SanctionsEntry) => {
        const ok = await confirm({
            title: 'Eliminar de la lista',
            message: `¿Eliminar a "${e.full_name}" de la lista?`,
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        await supabasePersonas.from('sanctions_list').delete().eq('id', e.id);
        await logAdminAction({ admin: profile, action: 'sanction_remove', targetType: 'sanction', targetId: e.id, metadata: { name: e.full_name, list: e.list_type } });
        load();
    };

    const filtered = entries.filter(e =>
        !search || e.full_name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div>
            {confirmDialog}
            <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre..."
                        className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200"
                    />
                </div>
                <button
                    onClick={() => setShowAdd(true)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white rounded-lg"
                    style={{ backgroundColor: NAVY }}
                >
                    <Plus size={14} /> Agregar
                </button>
            </div>

            {loading && <p className="text-slate-400">Cargando...</p>}
            {!loading && filtered.length === 0 && (
                <EmptyState icon={Search} title="Lista vacía" message="Agrega nombres a la lista de sanciones internas" />
            )}

            <div className="space-y-2">
                {filtered.map(e => (
                    <div key={e.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-slate-900">{e.full_name}</span>
                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-700">{e.list_type}</span>
                                {e.country_code && <span className="text-xs text-slate-500">{e.country_code}</span>}
                            </div>
                            {e.aliases && e.aliases.length > 0 && (
                                <p className="text-xs text-slate-500">Alias: {e.aliases.join(', ')}</p>
                            )}
                            {e.notes && <p className="text-xs text-slate-500 mt-1">{e.notes}</p>}
                        </div>
                        <button onClick={() => removeEntry(e)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600">
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>

            {showAdd && <AddSanctionModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} profile={profile} />}
        </div>
    );
};

const AddSanctionModal: React.FC<{ onClose: () => void; onAdded: () => void; profile: AdminProfile }> = ({ onClose, onAdded, profile }) => {
    const [name, setName] = useState('');
    const [listType, setListType] = useState('INTERNAL');
    const [aliasesStr, setAliasesStr] = useState('');
    const [country, setCountry] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);

    const save = async () => {
        if (!name.trim()) return;
        setLoading(true);
        const { data } = await supabasePersonas.from('sanctions_list').insert({
            full_name: name.trim(),
            list_type: listType,
            aliases: aliasesStr.split(',').map(s => s.trim()).filter(Boolean),
            country_code: country.trim() || null,
            notes: notes.trim() || null,
        }).select().single();
        if (data) {
            await logAdminAction({ admin: profile, action: 'sanction_add', targetType: 'sanction', targetId: (data as any).id, metadata: { name, list: listType } });
        }
        setLoading(false);
        onAdded();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg" style={{ color: NAVY }}>Agregar a sanciones</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Nombre completo</label>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3" />

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Lista</label>
                <select value={listType} onChange={e => setListType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3 bg-white">
                    <option value="INTERNAL">Interna (Lincoin)</option>
                    <option value="OFAC">OFAC</option>
                    <option value="UN">ONU</option>
                    <option value="EU">UE</option>
                    <option value="PEP">PEP</option>
                </select>

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Alias (separados por coma)</label>
                <input value={aliasesStr} onChange={e => setAliasesStr(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3" placeholder="Alias 1, Alias 2" />

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">País (ISO)</label>
                <input value={country} onChange={e => setCountry(e.target.value.toUpperCase().slice(0, 2))} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-3 font-mono" placeholder="CO" />

                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Notas</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 mb-6 text-sm" rows={3} />

                <button onClick={save} disabled={loading || !name.trim()} style={{ backgroundColor: NAVY }} className="w-full text-white font-bold py-3 rounded-xl disabled:opacity-50">
                    {loading ? 'Guardando...' : 'Agregar'}
                </button>
            </div>
        </div>
    );
};
