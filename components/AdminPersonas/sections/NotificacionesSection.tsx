import React, { useEffect, useMemo, useState } from 'react';
import {
    Bell, Send, RefreshCw, Sparkles, AlertCircle, CheckCircle2, Clock,
    Image as ImageIcon, Plus, X, ChevronDown, Smartphone, Eye, Save,
    Calendar, Globe, Coins, ShieldCheck, Users as UsersIcon, Pause, Trash2,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, NAVY, TEAL, formatDate, EmptyState } from './shared';
import { LincoinIcon } from '../LincoinIcon';

// ─────────────────────────────────────────────
// NotificacionesSection — gestiona campañas push promocionales contra
// el backend ya implementado por Antigravity:
//
//   Tablas:
//     • public.push_notifications (status: draft/scheduled/sending/sent/failed)
//     • public.device_push_tokens  (FCM tokens por device + platform)
//
//   Edge functions (Supabase Personas):
//     • admin-push      action=send    body={ notification_id }
//     • admin-push      action=opened  body={ notification_id }   ← la usa la app
//     • admin-ai-push   action=generate body={ brief, segment, lang }
//
//   Segment jsonb shape:
//     { target: 'all' }
//     { target: 'country',  value: 'CO' }
//     { target: 'currency', value: 'COP' }
//     { target: 'kyc',      value: 'verified' }
// ─────────────────────────────────────────────

type SegmentTarget = 'all' | 'country' | 'currency' | 'kyc';

interface Segment {
    target: SegmentTarget;
    value?: string;
}

type PushStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

interface PushRow {
    id: string;
    title: string;
    body: string;
    link: string | null;
    image_url: string | null;
    segment: Segment;
    status: PushStatus;
    schedule_at: string | null;
    sent_at: string | null;
    created_by: string;
    created_at: string;
    total_count:     number | null;
    delivered_count: number | null;
    opened_count:    number | null;
    failed_count:    number | null;
    error_message:   string | null;
}

interface DeviceToken {
    platform: 'ios' | 'android';
    is_active: boolean;
}

const COUNTRY_OPTIONS = [
    { code: 'CO', name: 'Colombia',  flag: '🇨🇴' },
    { code: 'PE', name: 'Perú',      flag: '🇵🇪' },
    { code: 'CL', name: 'Chile',     flag: '🇨🇱' },
    { code: 'MX', name: 'México',    flag: '🇲🇽' },
    { code: 'BR', name: 'Brasil',    flag: '🇧🇷' },
    { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
];

const CURRENCY_OPTIONS = ['COP', 'PEN', 'CLP', 'MXN', 'BRL', 'VES', 'EUR'];

const KYC_OPTIONS = [
    { value: 'verified', label: 'Verificados (KYC OK)' },
    { value: 'pending',  label: 'KYC pendiente' },
    { value: 'rejected', label: 'KYC rechazado' },
];

const STATUS_LABELS: Record<PushStatus, { label: string; bg: string; text: string }> = {
    draft:     { label: 'Borrador',  bg: '#F1F5F9', text: '#475569' },
    scheduled: { label: 'Programada', bg: '#DBEAFE', text: '#1E40AF' },
    sending:   { label: 'Enviando…', bg: '#FEF3C7', text: '#92400E' },
    sent:      { label: 'Enviada',   bg: '#D1FAE5', text: '#065F46' },
    failed:    { label: 'Falló',     bg: '#FEE2E2', text: '#991B1B' },
};

const SETUP_SQL_HINT = `Las tablas push_notifications y device_push_tokens no existen aún
en este Supabase. Antigravity confirmó el schema — pedile que aplique
las migraciones. Mientras tanto, la sección queda vacía pero funcional.`;

// ─────────────────────────────────────────────
// invokeEdge — wrapper sobre fetch directo a /functions/v1/<name>
// Reemplaza supabase.functions.invoke porque el SDK traga errores
// (devuelve "Failed to send a request to the Edge Function" sin
// detalle del status o body real). Acá vemos status + body crudos.
// ─────────────────────────────────────────────
async function invokeEdge(name: string, body: any): Promise<any> {
    const env: any = (import.meta as any).env ?? {};
    const sbUrl  = env.VITE_SUPABASE_PERSONAS_URL || env.VITE_SUPABASE_URL || '';
    const apikey = env.VITE_SUPABASE_PERSONAS_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
    const { data: sess } = await supabasePersonas.auth.getSession();
    const accessToken = sess?.session?.access_token ?? apikey;

    const url = `${sbUrl}/functions/v1/${name}`;
    let resp: Response;
    try {
        resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'apikey':        apikey,
            },
            body: JSON.stringify(body),
        });
    } catch (netErr: any) {
        // Fallo a nivel red (CORS, DNS, fetch abortado…)
        throw new Error(`Network error contactando ${name}: ${netErr?.message ?? netErr}`);
    }

    const text = await resp.text().catch(() => '');
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

    if (!resp.ok) {
        // Loggeamos todo para que sea trivial debuggear desde DevTools.
        console.error(`[invokeEdge] ${name} → HTTP ${resp.status}`, {
            url, status: resp.status, statusText: resp.statusText, body: text,
        });
        const detail = parsed?.error ?? parsed?.message ?? text?.slice(0, 200) ?? resp.statusText;
        throw new Error(`${name} HTTP ${resp.status}: ${detail}`);
    }
    return parsed;
}

interface Props {
    profile: AdminProfile;
}

export const NotificacionesSection: React.FC<Props> = ({ profile }) => {
    const [rows, setRows]       = useState<PushRow[]>([]);
    const [tokens, setTokens]   = useState<DeviceToken[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);
    const [filter, setFilter]   = useState<'all' | PushStatus>('all');
    const [editing, setEditing] = useState<PushRow | null>(null);
    const [creating, setCreating] = useState(false);
    const { confirm, dialog: confirmDialog } = useConfirm();

    const load = async () => {
        setLoading(true);
        setError(null);
        const [pushRes, tokRes] = await Promise.all([
            supabasePersonas
                .from('push_notifications')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(500),
            supabasePersonas
                .from('device_push_tokens')
                .select('platform, is_active')
                .eq('is_active', true)
                .limit(20000),
        ]);
        if (pushRes.error) {
            if (/relation .* does not exist/i.test(pushRes.error.message) || pushRes.error.code === '42P01') {
                setError(SETUP_SQL_HINT);
            } else {
                setError(pushRes.error.message);
            }
        } else {
            setRows((pushRes.data ?? []) as PushRow[]);
        }
        if (!tokRes.error) setTokens((tokRes.data ?? []) as DeviceToken[]);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    // ── Stats top-row ───────────────────────────────
    const stats = useMemo(() => {
        const since = new Date(); since.setDate(since.getDate() - 30);
        const sent30 = rows.filter(r => r.status === 'sent' && r.sent_at && new Date(r.sent_at) >= since);
        const totalDeliv = sent30.reduce((s, r) => s + (r.delivered_count ?? 0), 0);
        const totalOpens = sent30.reduce((s, r) => s + (r.opened_count ?? 0), 0);
        const openRate   = totalDeliv ? (totalOpens / totalDeliv) * 100 : 0;
        const tokIos     = tokens.filter(t => t.platform === 'ios').length;
        const tokAndroid = tokens.filter(t => t.platform === 'android').length;
        return {
            sent30:  sent30.length,
            tokIos, tokAndroid, tokTotal: tokIos + tokAndroid,
            openRate,
        };
    }, [rows, tokens]);

    const filtered = useMemo(
        () => (filter === 'all' ? rows : rows.filter(r => r.status === filter)),
        [rows, filter],
    );

    // ── Acciones de fila ──────────────────────────
    const sendNow = async (row: PushRow) => {
        const ok = await confirm({
            title: 'Enviar notificación push',
            message: `Vas a enviar "${row.title}" a ${describeSegment(row.segment)} AHORA. Esta acción es irreversible.`,
            confirmLabel: 'Enviar ahora',
        });
        if (!ok) return;
        // optimistic local update
        setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: 'sending' } : r));
        try {
            await invokeEdge('admin-push', { action: 'send', notification_id: row.id });
            await logAdminAction({
                admin: profile, action: 'push.send', targetType: 'push_notification', targetId: row.id,
                metadata: { segment: row.segment, title: row.title },
            });
        } catch (e: any) {
            await confirm({
                title: 'Falló el envío',
                message: `${e?.message ?? e}\n\nEl borrador quedó guardado y podés reintentar.`,
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
        }
        load();
    };

    const cancelScheduled = async (row: PushRow) => {
        const ok = await confirm({
            title: 'Cancelar envío programado',
            message: `"${row.title}" vuelve a estado borrador y NO se enviará automáticamente.`,
            confirmLabel: 'Cancelar envío',
            cancelLabel: 'Mantener',
            variant: 'danger',
        });
        if (!ok) return;
        const { error: err } = await supabasePersonas
            .from('push_notifications')
            .update({ status: 'draft', schedule_at: null })
            .eq('id', row.id);
        if (err) {
            await confirm({ title: 'Error', message: err.message, variant: 'danger', alertOnly: true, confirmLabel: 'Cerrar' });
            return;
        }
        await logAdminAction({
            admin: profile, action: 'push.cancel_schedule', targetType: 'push_notification', targetId: row.id,
        });
        load();
    };

    const removeRow = async (row: PushRow) => {
        if (row.status === 'sent' || row.status === 'sending') return;
        const ok = await confirm({
            title: 'Eliminar notificación',
            message: `Vas a borrar "${row.title}". Solo se borra el borrador — no afecta envíos pasados.`,
            confirmLabel: 'Eliminar',
            variant: 'danger',
        });
        if (!ok) return;
        const { error: err } = await supabasePersonas.from('push_notifications').delete().eq('id', row.id);
        if (err) {
            await confirm({ title: 'Error', message: err.message, variant: 'danger', alertOnly: true, confirmLabel: 'Cerrar' });
            return;
        }
        await logAdminAction({
            admin: profile, action: 'push.delete', targetType: 'push_notification', targetId: row.id,
        });
        load();
    };

    return (
        <div className="p-4 md:p-8 space-y-4">
            <SectionHeader
                title="Notificaciones Push"
                subtitle="Campañas push promocionales para las apps de Lincoin (iOS / Android)"
                right={
                    <div className="flex items-center gap-2">
                        <button
                            onClick={load}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                        <button
                            onClick={() => setCreating(true)}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg text-white"
                            style={{ backgroundColor: NAVY }}
                        >
                            <Plus size={14} />
                            Nueva notificación
                        </button>
                    </div>
                }
            />

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <StatCard
                    label="Enviadas · 30 días"
                    value={stats.sent30.toLocaleString('es-CO')}
                    icon={<Send size={14} />}
                    color={NAVY}
                    bg="#F1F5F9"
                />
                <StatCard
                    label="Dispositivos activos"
                    value={stats.tokTotal.toLocaleString('es-CO')}
                    sub={`📱 iOS ${stats.tokIos} · 🤖 Android ${stats.tokAndroid}`}
                    icon={<Smartphone size={14} />}
                    color="#0F766E"
                    bg="#CCFBF1"
                />
                <StatCard
                    label="Open rate promedio"
                    value={`${stats.openRate.toFixed(1)}%`}
                    icon={<Eye size={14} />}
                    color="#065F46"
                    bg="#D1FAE5"
                />
                <StatCard
                    label="Total en sistema"
                    value={rows.length.toLocaleString('es-CO')}
                    icon={<Bell size={14} />}
                    color="#1E40AF"
                    bg="#DBEAFE"
                />
            </div>

            {/* Error / setup banner */}
            {error && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                    <AlertCircle size={16} className="text-amber-700 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-900 whitespace-pre-wrap">{error}</p>
                </div>
            )}

            {/* Filter chips */}
            <div className="flex gap-1.5 flex-wrap">
                {(['all', 'draft', 'scheduled', 'sending', 'sent', 'failed'] as const).map(k => {
                    const active = filter === k;
                    const count  = k === 'all' ? rows.length : rows.filter(r => r.status === k).length;
                    const label  = k === 'all' ? 'Todas' : STATUS_LABELS[k].label;
                    return (
                        <button
                            key={k}
                            onClick={() => setFilter(k)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
                            style={{
                                backgroundColor: active ? NAVY : 'white',
                                color: active ? 'white' : '#475569',
                                borderColor: active ? NAVY : '#E2E8F0',
                            }}
                        >
                            {label} <span className="opacity-60">· {count}</span>
                        </button>
                    );
                })}
            </div>

            {/* Tabla */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Título</th>
                                <th className="text-left px-4 py-3">Segmento</th>
                                <th className="text-left px-4 py-3">Estado</th>
                                <th className="text-left px-4 py-3">Programada</th>
                                <th className="text-right px-4 py-3">Entregadas</th>
                                <th className="text-left px-4 py-3 w-44">Open rate</th>
                                <th className="text-right px-4 py-3">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
                            )}
                            {!loading && filtered.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-12">
                                    <EmptyState
                                        icon={Bell}
                                        title="Sin notificaciones"
                                        message="Creá una nueva con el botón de arriba."
                                    />
                                </td></tr>
                            )}
                            {filtered.map(r => {
                                const delivered = r.delivered_count ?? 0;
                                const total     = r.total_count ?? 0;
                                const opened    = r.opened_count ?? 0;
                                const openRate  = delivered ? (opened / delivered) * 100 : 0;
                                return (
                                    <tr
                                        key={r.id}
                                        onClick={() => setEditing(r)}
                                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                                    >
                                        <td className="px-4 py-3 max-w-xs">
                                            <p className="font-semibold text-slate-900 truncate">{r.title}</p>
                                            <p className="text-[11px] text-slate-500 truncate">{r.body}</p>
                                        </td>
                                        <td className="px-4 py-3"><SegmentBadge segment={r.segment} /></td>
                                        <td className="px-4 py-3">
                                            <StatusPill status={r.status} />
                                            {r.status === 'failed' && r.error_message && (
                                                <p className="text-[10px] text-red-700 mt-0.5 max-w-xs truncate" title={r.error_message}>
                                                    {r.error_message}
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-600">
                                            {r.schedule_at ? formatDate(r.schedule_at) : (r.sent_at ? formatDate(r.sent_at) : '—')}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs">
                                            {r.status === 'draft'
                                                ? <span className="text-slate-400">—</span>
                                                : <>{delivered}<span className="text-slate-400">/{total}</span></>
                                            }
                                            {(r.failed_count ?? 0) > 0 && (
                                                <span className="ml-1 text-red-600">· ❌ {r.failed_count}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {delivered > 0 ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                                                        <div
                                                            className="h-full"
                                                            style={{
                                                                width: `${Math.min(100, openRate)}%`,
                                                                backgroundColor: openRate >= 20 ? '#10B981' : openRate >= 10 ? '#F59E0B' : '#94A3B8',
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="text-[11px] font-semibold text-slate-700 w-10 text-right">
                                                        {openRate.toFixed(1)}%
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-slate-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                            <RowActions row={r} onSend={sendNow} onCancel={cancelScheduled} onDelete={removeRow} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {(creating || editing) && (
                <NotificationModal
                    profile={profile}
                    row={editing}
                    onClose={() => { setCreating(false); setEditing(null); }}
                    onSaved={() => { setCreating(false); setEditing(null); load(); }}
                />
            )}
            {confirmDialog}
        </div>
    );
};

// ─────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────

const StatCard: React.FC<{
    label: string; value: string; icon: React.ReactNode; color: string; bg: string; sub?: string;
}> = ({ label, value, icon, color, bg, sub }) => (
    <div className="rounded-2xl p-4" style={{ backgroundColor: bg }}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color, opacity: 0.7 }}>
            {icon}
            {label}
        </div>
        <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
        {sub && <p className="text-[10px] mt-0.5" style={{ color, opacity: 0.7 }}>{sub}</p>}
    </div>
);

const StatusPill: React.FC<{ status: PushStatus }> = ({ status }) => {
    const s = STATUS_LABELS[status];
    return (
        <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.text }}>
            {s.label}
        </span>
    );
};

const SegmentBadge: React.FC<{ segment: Segment }> = ({ segment }) => {
    const { icon, label, bg, text } = segmentDisplay(segment);
    return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: bg, color: text }}>
            {icon}
            {label}
        </span>
    );
};

function segmentDisplay(seg: Segment): { icon: React.ReactNode; label: string; bg: string; text: string } {
    switch (seg.target) {
        case 'all':
            return { icon: <UsersIcon size={10} />, label: 'Todos', bg: '#F1F5F9', text: '#0F172A' };
        case 'country': {
            const c = COUNTRY_OPTIONS.find(x => x.code === seg.value);
            return { icon: <Globe size={10} />, label: c ? `${c.flag} ${c.name}` : (seg.value ?? 'País'), bg: '#DBEAFE', text: '#1E40AF' };
        }
        case 'currency':
            return { icon: <Coins size={10} />, label: seg.value ?? 'Moneda', bg: '#FEF3C7', text: '#92400E' };
        case 'kyc':
            return { icon: <ShieldCheck size={10} />, label: KYC_OPTIONS.find(k => k.value === seg.value)?.label ?? 'KYC', bg: '#D1FAE5', text: '#065F46' };
    }
}

function describeSegment(seg: Segment): string {
    return segmentDisplay(seg).label;
}

const RowActions: React.FC<{
    row: PushRow;
    onSend:   (r: PushRow) => void;
    onCancel: (r: PushRow) => void;
    onDelete: (r: PushRow) => void;
}> = ({ row, onSend, onCancel, onDelete }) => {
    return (
        <div className="inline-flex gap-1">
            {row.status === 'draft' && (
                <button
                    onClick={() => onSend(row)}
                    className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1"
                >
                    <Send size={11} /> Enviar
                </button>
            )}
            {row.status === 'scheduled' && (
                <button
                    onClick={() => onCancel(row)}
                    className="px-2 py-1 text-[11px] font-semibold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center gap-1"
                >
                    <Pause size={11} /> Cancelar
                </button>
            )}
            {(row.status === 'draft' || row.status === 'failed') && (
                <button
                    onClick={() => onDelete(row)}
                    className="px-2 py-1 text-[11px] font-semibold rounded bg-red-50 text-red-700 hover:bg-red-100"
                    title="Eliminar"
                >
                    <Trash2 size={11} />
                </button>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Modal de crear / editar
// ─────────────────────────────────────────────
const NotificationModal: React.FC<{
    profile: AdminProfile;
    row: PushRow | null;
    onClose: () => void;
    onSaved: () => void;
}> = ({ profile, row, onClose, onSaved }) => {
    const isReadOnly = row?.status === 'sent' || row?.status === 'sending';
    const [title, setTitle]         = useState(row?.title ?? '');
    const [body, setBody]           = useState(row?.body ?? '');
    const [link, setLink]           = useState(row?.link ?? '');
    const [imageUrl, setImageUrl]   = useState(row?.image_url ?? '');
    const [segTarget, setSegTarget] = useState<SegmentTarget>(row?.segment?.target ?? 'all');
    const [segValue, setSegValue]   = useState(row?.segment?.value ?? '');
    const [scheduleOn, setScheduleOn] = useState(!!row?.schedule_at);
    const [scheduleAt, setScheduleAt] = useState(row?.schedule_at?.slice(0, 16) ?? '');
    const [brief, setBrief]         = useState('');
    const [showBrief, setShowBrief] = useState(false);
    const [busy, setBusy]           = useState<'save' | 'send' | 'schedule' | 'ai' | null>(null);
    const [err, setErr]             = useState<string | null>(null);
    const { confirm, dialog: confirmDialog } = useConfirm();

    // Si cambia target a 'all', limpiamos value
    useEffect(() => {
        if (segTarget === 'all') setSegValue('');
        else if (!segValue) {
            if (segTarget === 'country')  setSegValue('CO');
            if (segTarget === 'currency') setSegValue('COP');
            if (segTarget === 'kyc')      setSegValue('verified');
        }
    }, [segTarget]); // eslint-disable-line

    const segment: Segment = useMemo(() => (
        segTarget === 'all' ? { target: 'all' } : { target: segTarget, value: segValue }
    ), [segTarget, segValue]);

    const validate = (): string | null => {
        if (!title.trim()) return 'El título es obligatorio.';
        if (!body.trim())  return 'El cuerpo es obligatorio.';
        if (segTarget !== 'all' && !segValue) return 'Elegí un valor para el segmento.';
        if (scheduleOn && !scheduleAt) return 'Elegí fecha y hora para programar.';
        return null;
    };

    const persist = async (status: 'draft' | 'scheduled'): Promise<string | null> => {
        const payload: any = {
            title:       title.trim(),
            body:        body.trim(),
            link:        link.trim() || null,
            image_url:   imageUrl.trim() || null,
            segment,
            status,
            schedule_at: status === 'scheduled' ? new Date(scheduleAt).toISOString() : null,
            created_by:  profile.id,
        };
        if (row?.id) {
            const { error } = await supabasePersonas
                .from('push_notifications').update(payload).eq('id', row.id);
            if (error) { setErr(error.message); return null; }
            return row.id;
        }
        const { data, error } = await supabasePersonas
            .from('push_notifications').insert(payload).select('id').single();
        if (error) { setErr(error.message); return null; }
        return (data as any).id as string;
    };

    const handleSaveDraft = async () => {
        const v = validate(); if (v) { setErr(v); return; }
        setErr(null); setBusy('save');
        const id = await persist('draft');
        setBusy(null);
        if (!id) return;
        await logAdminAction({
            admin: profile, action: 'push.save_draft', targetType: 'push_notification', targetId: id,
            metadata: { segment, title: title.trim() },
        });
        onSaved();
    };

    const handleSchedule = async () => {
        if (!scheduleOn) { setErr('Activá "Programar envío" antes.'); return; }
        const v = validate(); if (v) { setErr(v); return; }
        setErr(null); setBusy('schedule');
        const id = await persist('scheduled');
        setBusy(null);
        if (!id) return;
        await logAdminAction({
            admin: profile, action: 'push.schedule', targetType: 'push_notification', targetId: id,
            metadata: { segment, schedule_at: scheduleAt, title: title.trim() },
        });
        onSaved();
    };

    const handleSendNow = async () => {
        const v = validate(); if (v) { setErr(v); return; }
        const ok = await confirm({
            title: 'Enviar notificación push',
            message: `Vas a enviar a ${describeSegment(segment)} AHORA. Esta acción es irreversible.`,
            confirmLabel: 'Enviar ahora',
        });
        if (!ok) return;
        setErr(null); setBusy('send');
        const id = await persist('draft');
        if (!id) { setBusy(null); return; }
        try {
            await invokeEdge('admin-push', { action: 'send', notification_id: id });
            await logAdminAction({
                admin: profile, action: 'push.send', targetType: 'push_notification', targetId: id,
                metadata: { segment, title: title.trim() },
            });
            onSaved();
        } catch (e: any) {
            setErr(`Falló el envío: ${e?.message ?? e}. El borrador quedó guardado.`);
            setBusy(null);
        }
    };

    const handleGenerate = async () => {
        if (!brief.trim()) { setErr('Escribí un brief.'); return; }
        setErr(null); setBusy('ai');
        try {
            const data = await invokeEdge('admin-ai-push', { action: 'generate', brief: brief.trim(), segment, lang: 'es' });
            if (data?.title) setTitle(data.title);
            if (data?.body)  setBody(data.body);
        } catch (e: any) {
            setErr(`IA falló: ${e?.message ?? e}`);
        }
        setBusy(null);
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                    <p className="font-bold" style={{ color: NAVY }}>
                        {row ? `Editar notificación` : 'Nueva notificación push'}
                    </p>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-900"><X size={18} /></button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
                    {/* Form */}
                    <div className="space-y-3">
                        {/* IA */}
                        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                            <button
                                onClick={() => setShowBrief(s => !s)}
                                className="flex items-center justify-between w-full text-purple-800 text-xs font-bold"
                            >
                                <span className="inline-flex items-center gap-1"><Sparkles size={12} /> Generar con IA</span>
                                <ChevronDown size={14} className={`transition-transform ${showBrief ? 'rotate-180' : ''}`} />
                            </button>
                            {showBrief && (
                                <div className="mt-2 space-y-2">
                                    <textarea
                                        value={brief}
                                        onChange={e => setBrief(e.target.value)}
                                        placeholder="ej: anunciar nueva ruta COP→BRL sin fees por 48 h, llamado a la acción para enviar dinero ahora"
                                        rows={3}
                                        className="w-full px-3 py-2 rounded-lg border border-purple-200 text-xs"
                                        disabled={isReadOnly}
                                    />
                                    <button
                                        onClick={handleGenerate}
                                        disabled={busy !== null || !brief.trim() || isReadOnly}
                                        className="px-3 py-1.5 rounded text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1"
                                    >
                                        {busy === 'ai' ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                        {busy === 'ai' ? 'Generando…' : 'Generar'}
                                    </button>
                                </div>
                            )}
                        </div>

                        <Field label="Título" hint={`${title.length}/65 · iOS recorta a ~40`}>
                            <input
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="ej: Nuevas tasas esta semana 👀"
                                maxLength={65}
                                disabled={isReadOnly}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold disabled:bg-slate-50"
                            />
                        </Field>

                        <Field label="Cuerpo" hint={`${body.length}/178`}>
                            <textarea
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                placeholder="ej: Abrí Lincoin y mirá qué pares te conviene cambiar hoy."
                                rows={3}
                                maxLength={178}
                                disabled={isReadOnly}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm disabled:bg-slate-50"
                            />
                        </Field>

                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Link (deep-link opcional)" icon={<Smartphone size={10} />}>
                                <input
                                    value={link}
                                    onChange={e => setLink(e.target.value)}
                                    placeholder="cuypay://convert"
                                    disabled={isReadOnly}
                                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs font-mono disabled:bg-slate-50"
                                />
                            </Field>
                            <Field label="Imagen URL (opcional)" icon={<ImageIcon size={10} />}>
                                <input
                                    value={imageUrl}
                                    onChange={e => setImageUrl(e.target.value)}
                                    placeholder="https://…"
                                    disabled={isReadOnly}
                                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs disabled:bg-slate-50"
                                />
                            </Field>
                        </div>

                        <Field label="Segmento" icon={<UsersIcon size={10} />}>
                            <select
                                value={segTarget}
                                onChange={e => setSegTarget(e.target.value as SegmentTarget)}
                                disabled={isReadOnly}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white disabled:bg-slate-50"
                            >
                                <option value="all">Todos los usuarios</option>
                                <option value="country">Por país</option>
                                <option value="currency">Por moneda (wallet)</option>
                                <option value="kyc">Por estado de KYC</option>
                            </select>
                            {segTarget !== 'all' && (
                                <select
                                    value={segValue}
                                    onChange={e => setSegValue(e.target.value)}
                                    disabled={isReadOnly}
                                    className="mt-2 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white disabled:bg-slate-50"
                                >
                                    {segTarget === 'country' && COUNTRY_OPTIONS.map(c => (
                                        <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                                    ))}
                                    {segTarget === 'currency' && CURRENCY_OPTIONS.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                    {segTarget === 'kyc' && KYC_OPTIONS.map(k => (
                                        <option key={k.value} value={k.value}>{k.label}</option>
                                    ))}
                                </select>
                            )}
                        </Field>

                        <div className="bg-slate-50 rounded-xl p-3">
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={scheduleOn}
                                    onChange={e => setScheduleOn(e.target.checked)}
                                    disabled={isReadOnly}
                                />
                                <Calendar size={12} /> Programar envío
                            </label>
                            {scheduleOn && (
                                <input
                                    type="datetime-local"
                                    value={scheduleAt}
                                    onChange={e => setScheduleAt(e.target.value)}
                                    disabled={isReadOnly}
                                    className="mt-2 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white disabled:bg-slate-50"
                                />
                            )}
                        </div>

                        {err && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800 flex items-start gap-2">
                                <AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{err}</span>
                            </div>
                        )}

                        {/* Metricas si es row enviado */}
                        {row && row.status !== 'draft' && (
                            <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-700 space-y-1">
                                <p className="font-bold text-slate-900">Estadísticas</p>
                                <p>📬 Entregadas: <b>{row.delivered_count ?? 0}</b> / {row.total_count ?? 0}</p>
                                <p>👁 Abiertas: <b>{row.opened_count ?? 0}</b></p>
                                {(row.failed_count ?? 0) > 0 && <p className="text-red-700">❌ Fallaron: <b>{row.failed_count}</b></p>}
                                {row.error_message && <p className="text-red-700 text-[11px]">{row.error_message}</p>}
                                {row.sent_at && <p className="text-slate-500"><Clock size={10} className="inline" /> Enviada {formatDate(row.sent_at)}</p>}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                            {!isReadOnly && (
                                <>
                                    <button
                                        onClick={handleSaveDraft}
                                        disabled={busy !== null}
                                        className="px-3 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
                                    >
                                        <Save size={13} /> {busy === 'save' ? 'Guardando…' : 'Guardar borrador'}
                                    </button>
                                    {scheduleOn ? (
                                        <button
                                            onClick={handleSchedule}
                                            disabled={busy !== null}
                                            className="px-3 py-2 text-sm font-semibold rounded-lg text-white inline-flex items-center gap-1 disabled:opacity-50"
                                            style={{ backgroundColor: '#2563EB' }}
                                        >
                                            <Calendar size={13} /> {busy === 'schedule' ? 'Programando…' : 'Programar'}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleSendNow}
                                            disabled={busy !== null}
                                            className="px-3 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-1 disabled:opacity-50"
                                            style={{ backgroundColor: NAVY }}
                                        >
                                            <Send size={13} /> {busy === 'send' ? 'Enviando…' : 'Enviar ahora'}
                                        </button>
                                    )}
                                </>
                            )}
                            <button onClick={onClose} className="ml-auto px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
                        </div>
                    </div>

                    {/* Previews iOS + Android */}
                    <PreviewPane title={title} body={body} imageUrl={imageUrl} />
                </div>
            </div>
            {confirmDialog}
        </div>
    );
};

// ─────────────────────────────────────────────
// PreviewPane — toggle entre iOS lockscreen y Android (Material You).
// Memoriza la última selección del usuario en localStorage para que la
// preferencia persista entre sesiones.
// ─────────────────────────────────────────────
const PreviewPane: React.FC<{ title: string; body: string; imageUrl: string }> = ({ title, body, imageUrl }) => {
    const [platform, setPlatform] = useState<'ios' | 'android'>(() => {
        try {
            const v = localStorage.getItem('cuypay.push.preview');
            return v === 'android' ? 'android' : 'ios';
        } catch { return 'ios'; }
    });
    const switchTo = (p: 'ios' | 'android') => {
        setPlatform(p);
        try { localStorage.setItem('cuypay.push.preview', p); } catch { /* ignore */ }
    };
    const t = title || 'Tu título acá';
    const b = body  || 'El cuerpo del mensaje va acá. Mantenelo corto.';

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Preview · lockscreen
                </p>
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-white">
                    {(['ios', 'android'] as const).map(p => (
                        <button
                            key={p}
                            onClick={() => switchTo(p)}
                            className="px-2 py-0.5 text-[10px] font-bold rounded transition-colors"
                            style={{
                                backgroundColor: platform === p ? NAVY : 'transparent',
                                color: platform === p ? 'white' : '#475569',
                            }}
                        >
                            {p === 'ios' ? '🍎 iOS' : '🤖 Android'}
                        </button>
                    ))}
                </div>
            </div>

            {platform === 'ios' ? (
                <IosPhoneMockup>
                    <IosNotificationCard title={t} body={b} imageUrl={imageUrl} timeAgo="ahora" />
                </IosPhoneMockup>
            ) : (
                <AndroidPhoneMockup>
                    <AndroidNotificationCard title={t} body={b} imageUrl={imageUrl} timeAgo="ahora" />
                </AndroidPhoneMockup>
            )}

            <p className="text-[10px] text-slate-400 text-center">
                La imagen y el deep-link solo se muestran en dispositivos reales.
            </p>
        </div>
    );
};

// ─────────────────────────────────────────────
// Pequeño componente Field para evitar repetir markup en el form.
// ─────────────────────────────────────────────
const Field: React.FC<{ label: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ label, hint, icon, children }) => (
    <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
            {icon}{label}
        </label>
        <div className="mt-1">{children}</div>
        {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
);

// ─────────────────────────────────────────────
// iOS lockscreen mock (estilo iPhone, fondo navy con notifs traslúcidas).
// ─────────────────────────────────────────────
const IosPhoneMockup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
        <div
            className="rounded-[2rem] p-3 shadow-xl"
            style={{ backgroundImage: 'linear-gradient(160deg, #1e293b 0%, #0f172a 60%, #020617 100%)' }}
        >
            <div className="flex items-center justify-center mb-2">
                <div className="w-20 h-1 bg-slate-700 rounded-full" />
            </div>
            <div className="text-center text-white mb-3">
                <p className="text-[11px] opacity-70">notificación</p>
                <p className="text-5xl font-light tracking-tight">9:41</p>
            </div>
            <div className="space-y-2">{children}</div>
        </div>
    </div>
);

const IosNotificationCard: React.FC<{
    title: string; body: string; imageUrl?: string; timeAgo: string;
}> = ({ title, body, imageUrl, timeAgo }) => (
    <div
        className="rounded-2xl px-3 py-2.5 flex items-start gap-2.5"
        style={{ backgroundColor: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(20px)' }}
    >
        {/* App icon Lincoin: SVG con fondo navy + símbolo teal. */}
        <LincoinIcon size={36} className="rounded-xl shrink-0 shadow" />
        <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-bold leading-tight text-black truncate">{title}</p>
                <span className="text-[10px] text-slate-500 shrink-0">{timeAgo}</span>
            </div>
            <p className="text-[12px] text-black/80 leading-snug line-clamp-2 mt-0.5">{body}</p>
        </div>
        {imageUrl && (
            <img
                src={imageUrl}
                alt=""
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                className="w-10 h-10 rounded-lg object-cover shrink-0"
            />
        )}
    </div>
);

// ─────────────────────────────────────────────
// Android lockscreen mock (Material You estilo Android 14+).
// Fondo con wallpaper genérico oscuro + reloj grande arriba + tarjeta
// blanca con el app icon + nombre arriba (NO al lado como en iOS).
// ─────────────────────────────────────────────
const AndroidPhoneMockup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
        <div
            className="rounded-[2rem] p-3 shadow-xl"
            style={{ backgroundImage: 'linear-gradient(170deg, #14532d 0%, #134e4a 50%, #082f49 100%)' }}
        >
            <div className="flex items-center justify-center mb-2">
                <div className="w-16 h-1 bg-slate-700 rounded-full" />
            </div>
            <div className="text-center text-white mb-3">
                <p className="text-[60px] font-extralight tracking-tighter leading-none">9:41</p>
                <p className="text-[10px] opacity-70 mt-1">jueves 26 de junio</p>
            </div>
            <div className="space-y-2">{children}</div>
        </div>
    </div>
);

const AndroidNotificationCard: React.FC<{
    title: string; body: string; imageUrl?: string; timeAgo: string;
}> = ({ title, body, imageUrl, timeAgo }) => (
    // Material 3 style: header (icon + app name + time) arriba, contenido debajo,
    // imagen grande estilo BigPicture al pie si la hay.
    <div className="rounded-3xl bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-3 pb-2">
            {/* Header con app icon, nombre y hora */}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                <LincoinIcon size={16} className="rounded shrink-0" />
                <span className="font-semibold">Lincoin</span>
                <span className="opacity-60">·</span>
                <span className="opacity-60">{timeAgo}</span>
            </div>
            {/* Título + body */}
            <p className="text-[13px] font-bold text-black leading-tight mt-1.5 line-clamp-1">{title}</p>
            <p className="text-[12px] text-slate-800 leading-snug mt-0.5 line-clamp-2">{body}</p>
        </div>
        {/* Imagen big-picture al pie (Material 3 BigPicture style) */}
        {imageUrl && (
            <img
                src={imageUrl}
                alt=""
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                className="w-full h-32 object-cover"
            />
        )}
    </div>
);
