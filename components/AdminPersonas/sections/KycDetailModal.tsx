import React, { useEffect, useMemo, useState } from 'react';
import {
    X, ShieldCheck, Mail, Phone, MapPin, Hash, IdCard,
    CheckCircle2, AlertTriangle, Copy, ChevronDown,
    Gauge, Wallet, KeyRound,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { NAVY, TEAL, formatDate, origenKyc } from './shared';
import { UserLimitsCard } from './UserLimitsCard';
import { UserBeneficiariesLimits } from './UserBeneficiariesLimits';
import { UserWalletsCard } from './UserWalletsCard';
import { SecurityRecoveryTab } from './SecurityRecoveryTab';

// ─────────────────────────────────────────────
// KycDetailModal — detalle de la cuenta y de su estado de verificación.
// Reusable para usuarios de cuenta (public.users) y terceros
// (public.beneficiaries). El layout es el mismo; las diferencias son
// solo qué campos están disponibles en cada tabla, que se manejan con
// optional chaining.
//
// Secciones:
//   • Header con inicial, nombre y status badge clickeable.
//   • Tabs: Resumen / Topes / Saldos / Seguridad.
//   • Card Detalles de contacto, Advertencias, Detalles de la cuenta.
//
// SIN PROVEEDOR EXTERNO DE KYC
//   Lincoin no tiene proveedor de verificación de identidad conectado. El
//   estado KYC lo fija un admin a mano desde este modal, y el cambio se
//   escribe directo en la tabla origen (users.kyc_status o
//   beneficiaries.kyc_status) más su entrada en el audit log.
//
//   Eso significa que no hay documento, selfie, prueba de vida ni cruce
//   contra listas detrás del estado: es el juicio de quien lo aprueba. Se
//   deja dicho en la UI para que nadie lea "APROBADO" como si fuera el
//   veredicto de una verificación que no ocurrió.
// ─────────────────────────────────────────────

export type KycEntityKind = 'user' | 'beneficiary';

export interface KycEntity {
    id: string;
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
    flag?: string | null;
    cuypay_id?: string | null;
    doc_type?: string | null;
    doc_number?: string | null;
    kyc_status?: string | null;
    kyc_provider?: string | null;
    kyc_verified_at?: string | null;
    raw_data?: any;
    is_active?: boolean | null;
    is_blocked?: boolean | null;
    owner_user_id?: string | null;
    linked_user_id?: string | null;
    created_at?: string;
    owner?: { full_name?: string | null; email?: string | null; cuypay_id?: string | null } | null;
}

type Tab = 'resumen' | 'topes' | 'saldos' | 'seguridad';
type NewStatus = 'approved' | 'rejected' | 'in_progress';

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<any> }> = [
    { id: 'resumen',   label: 'Resumen',   icon: ShieldCheck },
    { id: 'topes',     label: 'Topes',     icon: Gauge },
    // saldos/seguridad aplican solo a usuarios de cuenta (se filtran para terceros)
    { id: 'saldos',    label: 'Saldos',    icon: Wallet },
    { id: 'seguridad', label: 'Seguridad', icon: KeyRound },
];

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
    verified:    { bg: '#D1FAE5', text: '#065F46', label: 'APROBADO' },
    approved:    { bg: '#D1FAE5', text: '#065F46', label: 'APROBADO' },
    completed:   { bg: '#D1FAE5', text: '#065F46', label: 'APROBADO' },
    pending:     { bg: '#FEF3C7', text: '#92400E', label: 'PENDIENTE' },
    in_progress: { bg: '#FEF3C7', text: '#92400E', label: 'EN PROGRESO' },
    in_review:   { bg: '#FEF3C7', text: '#92400E', label: 'EN REVISIÓN' },
    rejected:    { bg: '#FEE2E2', text: '#991B1B', label: 'RECHAZADO' },
    cancelled:   { bg: '#FEE2E2', text: '#991B1B', label: 'CANCELADO' },
    expired:     { bg: '#F1F5F9', text: '#475569', label: 'EXPIRADO' },
};
const STATUS_OPTIONS: Array<{ value: NewStatus; label: string; bg: string; text: string }> = [
    { value: 'approved',    label: 'APROBADO',  bg: '#D1FAE5', text: '#065F46' },
    { value: 'rejected',    label: 'RECHAZADO', bg: '#FEE2E2', text: '#991B1B' },
    { value: 'in_progress', label: 'REENVIADO', bg: '#EDE9FE', text: '#5B21B6' },
];

interface Props {
    kind: KycEntityKind;
    entity: KycEntity;
    profile: AdminProfile;
    canApprove: boolean;
    onClose: () => void;
    onSaved?: () => void;   // se llama después de cambiar estado
}

export const KycDetailModal: React.FC<Props> = ({ kind, entity, profile, canApprove, onClose, onSaved }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [tab, setTab]               = useState<Tab>('resumen');
    const [statusOpen, setStatusOpen] = useState(false);
    const [savingStatus, setSaving]   = useState(false);
    const [statusMsg, setStatusMsg]   = useState<string | null>(null);
    // Comment del cambio de estado — queda en el audit log. Con verificación
    // manual es lo único que explica POR QUE se aprobó o rechazó, así que
    // vale más que cuando había un proveedor que dejaba su propio rastro.
    const [statusComment, setStatusComment] = useState('');
    // Acción seleccionada en el sub-modal (para confirmar con comment).
    const [pendingStatus, setPendingStatus] = useState<NewStatus | null>(null);

    // Estado controlado del status: queremos reflejar el cambio en vivo sin
    // esperar al onSaved del padre.
    const [statusValue, setStatusValue] = useState<string>(String(entity.kyc_status ?? '—'));
    useEffect(() => { setStatusValue(String(entity.kyc_status ?? '—')); }, [entity.kyc_status]);

    // raw_data se hidrata on-demand: la lista no la trae para evitar romper la
    // query con posibles restricciones de RLS sobre la columna. Si la query
    // falla, el modal igual funciona con lo que vino del padre.
    const [extra, setExtra] = useState<{ raw_data?: any }>({});
    useEffect(() => {
        if (kind !== 'user') { setExtra({}); return; }
        let cancelled = false;
        (async () => {
            const { data } = await supabasePersonas
                .from('users')
                .select('raw_data')
                .eq('id', entity.id)
                .maybeSingle();
            if (cancelled) return;
            setExtra((data as any) ?? {});
        })().catch(() => { /* silencioso — el modal sigue mostrando lo que vino del padre */ });
        return () => { cancelled = true; };
    }, [entity.id, kind]);

    const table     = kind === 'user' ? 'users' : 'beneficiaries';
    const initial   = (entity.full_name?.[0] ?? entity.email?.[0] ?? '?').toUpperCase();
    const statusKey = statusValue.toLowerCase();
    const badge     = STATUS_BADGE[statusKey] ?? { bg: '#F1F5F9', text: '#475569', label: statusValue.toUpperCase() };

    // Flags heurísticos sobre lo que está guardado en la cuenta.
    // Usamos statusValue (estado vivo del modal) en lugar de entity.kyc_status
    // para que al aprobar/rechazar dentro del modal el warning se actualice
    // sin esperar al refresh del padre.
    const warnings = useMemo(() => {
        const out: Array<{ label: string }> = [];
        const rd = entity.raw_data ?? extra.raw_data ?? {};
        if (rd.duplicate_session)       out.push({ label: 'Posible usuario duplicado de otra sesión' });
        if (rd.email_compromised)       out.push({ label: 'Correo electrónico comprometido detectado' });
        if (rd.phone_disposable)        out.push({ label: 'Número de teléfono desechable' });
        if (statusValue === 'rejected') out.push({ label: 'Verificación rechazada' });
        if (!entity.doc_number)         out.push({ label: 'Sin documento de identidad registrado' });
        return out;
    }, [entity, extra, statusValue]);

    const copy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); } catch {/* ignore */}
    };

    // changeStatus escribe DIRECTO en la tabla origen. Antes pasaba por una
    // edge function que además empujaba el estado al proveedor; sin proveedor
    // no hay a quién empujarle nada, y el UPDATE + audit log es todo el
    // trabajo que queda.
    const changeStatus = async (newStatus: NewStatus, comment: string) => {
        if (!canApprove) return;
        setSaving(true);
        setStatusMsg(null);
        try {
            const mapped = newStatus === 'approved' ? 'verified' : newStatus;
            const patch: Record<string, any> = { kyc_status: mapped };
            // La fecha de verificación se sella al aprobar y se limpia si se
            // revierte: dejarla puesta en una cuenta rechazada haría creer que
            // alguna vez pasó una verificación que ya no está vigente.
            patch.kyc_verified_at = mapped === 'verified' ? new Date().toISOString() : null;
            // Queda explícito quién la aprobó. Sin proveedor, el responsable
            // del estado es la persona que lo puso.
            patch.kyc_provider = mapped === 'verified' ? 'Manual (Lincoin)' : null;

            const { error: updErr } = await supabasePersonas
                .from(table).update(patch).eq('id', entity.id);
            if (updErr) throw updErr;

            setStatusValue(mapped);
            await logAdminAction({
                admin: profile,
                action: 'kyc_status_change',
                targetType: kind === 'user' ? 'user' : 'beneficiary',
                targetId: entity.id,
                metadata: {
                    from: entity.kyc_status, to: mapped,
                    comment: comment.trim() || null,
                    source: 'kyc_detail_modal',
                    manual: true,
                },
            });
            setStatusMsg(`✓ Estado cambiado a ${badgeLabel(mapped)}`);
            setStatusOpen(false);
            setPendingStatus(null);
            setStatusComment('');
            onSaved?.();
        } catch (e: any) {
            await confirm({
                title: 'Error',
                message: `No pude cambiar el estado: ${e?.message ?? 'desconocido'}`,
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
        }
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            {confirmDialog}
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
                            style={{ backgroundColor: TEAL, color: NAVY }}
                        >
                            {initial}
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold truncate" style={{ color: NAVY }}>
                                {entity.full_name ?? '—'}
                            </h3>
                            <p className="text-xs text-slate-500 truncate">{entity.email ?? entity.phone ?? '—'}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {statusMsg && <span className="text-xs text-emerald-700">{statusMsg}</span>}
                        {/* Status badge clickeable */}
                        <button
                            onClick={() => canApprove && setStatusOpen(true)}
                            disabled={!canApprove}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${canApprove ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                            style={{ backgroundColor: badge.bg, color: badge.text }}
                            title={canApprove ? 'Cambiar estado' : 'Solo lectura'}
                        >
                            <CheckCircle2 size={12} /> {badge.label}
                            {canApprove && <ChevronDown size={12} />}
                        </button>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X size={18} /></button>
                    </div>
                </div>

                {/* Aviso permanente: el estado es un juicio humano, no el
                    veredicto de una verificación automática. */}
                <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex items-start gap-2 text-[11px] text-slate-600">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-slate-400" />
                    <span>
                        Verificación <b>manual</b>. Lincoin no tiene conectado un proveedor de KYC:
                        no hay validación de documento, prueba de vida ni cruce contra listas detrás de este estado.
                    </span>
                </div>

                {/* Tabs */}
                <div className="px-6 border-b border-slate-200 flex gap-1 overflow-x-auto">
                    {TABS.filter(t => kind === 'user' || (t.id !== 'saldos' && t.id !== 'seguridad')).map(t => {
                        const Icon   = t.icon;
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                                    active
                                        ? 'border-[#4ADE80] text-slate-900'
                                        : 'border-transparent text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <Icon size={13} /> {t.label}
                            </button>
                        );
                    })}
                </div>

                {/* Contenido */}
                <div className="flex-1 overflow-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50">
                    {tab === 'resumen' && (
                        <>
                            <Card title="Detalles de contacto">
                                <KV label="Estado emisor" value={entity.flag ? `${entity.flag} ${entity.country ?? '—'}` : (entity.country ?? '—')} icon={MapPin} />
                                <KV label="Correo electrónico" value={entity.email ?? '—'} icon={Mail} />
                                <KV label="Número de teléfono" value={entity.phone ?? '—'} icon={Phone} />
                                {kind === 'beneficiary' && (
                                    <KV
                                        label="Dueño (creador)"
                                        value={
                                            entity.owner?.full_name ?? entity.owner?.email ?? entity.owner?.cuypay_id ??
                                            (entity.owner_user_id ? `${entity.owner_user_id.slice(0, 8)}…` : '—')
                                        }
                                    />
                                )}
                            </Card>

                            <Card title="Documento de identidad">
                                <KV label="Tipo" value={entity.doc_type ?? '—'} icon={IdCard} />
                                <KV
                                    label="Número"
                                    value={entity.doc_number ?? '—'}
                                    icon={Hash}
                                    mono
                                    onCopy={entity.doc_number ? () => copy(entity.doc_number!) : undefined}
                                />
                                <p className="text-[10px] text-slate-400 pt-1">
                                    Lo declaró el titular al registrarse. No está contrastado contra la entidad emisora.
                                </p>
                            </Card>

                            <Card title="Advertencia" tone={warnings.length > 0 ? 'warn' : 'neutral'}>
                                {warnings.length === 0 && (
                                    <p className="text-xs text-slate-500">Sin advertencias activas.</p>
                                )}
                                {warnings.map((w, i) => (
                                    <div key={i} className="flex items-start gap-2 py-1 text-xs text-amber-900">
                                        <AlertTriangle size={12} className="mt-0.5 text-amber-600 shrink-0" />
                                        <span>{w.label}</span>
                                    </div>
                                ))}
                            </Card>

                            <Card title="Detalles de la cuenta">
                                <KV label="Creado el" value={entity.created_at ? formatDate(entity.created_at) : '—'} />
                                <KV label="KYC aprobado" value={entity.kyc_verified_at ? formatDate(entity.kyc_verified_at) : '—'} />
                                <KV label="Origen del estado" value={origenKyc(entity.kyc_provider)} />
                                <KV label="Lincoin ID" value={entity.cuypay_id ?? '—'} mono />
                                <KV label="UUID" value={entity.id} mono onCopy={() => copy(entity.id)} />
                            </Card>
                        </>
                    )}

                    {tab === 'topes' && (
                        <div className="md:col-span-2 space-y-6">
                            <UserLimitsCard
                                userId={entity.id}
                                profile={profile}
                                subject={kind === 'user' ? 'user' : 'beneficiary'}
                            />
                            {kind === 'user' && (
                                <div className="border-t border-slate-200 pt-5">
                                    <UserBeneficiariesLimits ownerUserId={entity.id} profile={profile} />
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'saldos' && kind === 'user' && (
                        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
                            <UserWalletsCard userId={entity.id} />
                        </div>
                    )}

                    {tab === 'seguridad' && kind === 'user' && (
                        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
                            <SecurityRecoveryTab
                                userId={entity.id}
                                profile={profile}
                                confirm={confirm}
                                onChanged={onSaved}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Sub-modal: cambiar estado (2 pasos: elegir acción → confirmar
                con comentario → UPDATE en la tabla + audit log). */}
            {statusOpen && (
                <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setStatusOpen(false); setPendingStatus(null); setStatusComment(''); }}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-3">
                            <h3 className="text-base font-bold" style={{ color: NAVY }}>
                                {pendingStatus
                                    ? `Confirmar: ${STATUS_OPTIONS.find(o => o.value === pendingStatus)?.label}`
                                    : 'Selecciona nuevo estado'}
                            </h3>
                            <button onClick={() => { setStatusOpen(false); setPendingStatus(null); setStatusComment(''); }} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} /></button>
                        </div>

                        {!pendingStatus && (
                            <>
                                <p className="text-xs text-slate-500 mb-4">
                                    Estás fijando el estado a mano y quedás como responsable en el audit log.
                                </p>
                                <div className="space-y-2">
                                    {STATUS_OPTIONS.map(o => (
                                        <button
                                            key={o.value}
                                            onClick={() => setPendingStatus(o.value)}
                                            disabled={savingStatus}
                                            className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 hover:border-slate-300 disabled:opacity-50"
                                        >
                                            <span
                                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                                                style={{ backgroundColor: o.bg, color: o.text }}
                                            >
                                                {o.value === 'approved' ? '✅ ' : o.value === 'rejected' ? '❌ ' : '🔄 '}{o.label}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {o.value === 'approved' ? 'Aprueba la verificación' : o.value === 'rejected' ? 'Rechaza la verificación' : 'Reabre / pide reenviar'}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}

                        {pendingStatus && (
                            <>
                                <p className="text-xs text-slate-600 mb-3">
                                    {pendingStatus === 'approved'
                                        ? 'Vas a aprobar la verificación a mano. El usuario va a poder operar.'
                                        : pendingStatus === 'rejected'
                                        ? 'Vas a rechazar la verificación. El usuario queda sin poder operar hasta nuevo intento.'
                                        : 'Vas a pedirle al usuario que reenvíe la verificación.'}
                                </p>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Comentario <span className="text-slate-400 font-normal">(en qué te basaste)</span>
                                </label>
                                <textarea
                                    value={statusComment}
                                    onChange={(e) => setStatusComment(e.target.value)}
                                    rows={3}
                                    placeholder={
                                        pendingStatus === 'rejected' ? 'Motivo del rechazo (ej: documento ilegible, datos no coinciden…)'
                                        : pendingStatus === 'in_progress' ? 'Qué debe reenviar el usuario…'
                                        : 'Qué documentación revisaste para aprobar'
                                    }
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-green-500 outline-none text-xs"
                                />
                                <div className="flex items-center gap-2 mt-4">
                                    <button
                                        onClick={() => { setPendingStatus(null); setStatusComment(''); }}
                                        disabled={savingStatus}
                                        className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                                    >
                                        Atrás
                                    </button>
                                    <button
                                        onClick={() => changeStatus(pendingStatus, statusComment)}
                                        disabled={savingStatus}
                                        className="flex-1 px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                                        style={{ backgroundColor: STATUS_OPTIONS.find(o => o.value === pendingStatus)?.text ?? NAVY }}
                                    >
                                        {savingStatus ? 'Guardando…' : `Confirmar ${STATUS_OPTIONS.find(o => o.value === pendingStatus)?.label}`}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

function badgeLabel(status: string): string {
    return STATUS_BADGE[status]?.label ?? status.toUpperCase();
}

// ─── Subcomponentes ───────────────────────────────────────────

const Card: React.FC<React.PropsWithChildren<{ title: string; tone?: 'neutral' | 'warn' }>> = ({ title, tone = 'neutral', children }) => (
    <div className={`bg-white rounded-2xl border p-4 ${tone === 'warn' ? 'border-amber-200' : 'border-slate-200'}`}>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: tone === 'warn' ? '#92400E' : '#64748B' }}>
            {title}
        </p>
        <div className="space-y-1.5">{children}</div>
    </div>
);

const KV: React.FC<{
    label: string;
    value: React.ReactNode;
    icon?: React.ComponentType<any>;
    mono?: boolean;
    onCopy?: () => void;
}> = ({ label, value, icon: Icon, mono, onCopy }) => (
    <div className="flex items-center gap-2 text-xs">
        {Icon && <Icon size={12} className="text-slate-400 shrink-0" />}
        <span className="text-slate-500 min-w-[110px]">{label}</span>
        <span className={`flex-1 text-right truncate ${mono ? 'font-mono text-slate-700' : 'text-slate-800'}`}>{value}</span>
        {onCopy && (
            <button onClick={onCopy} className="p-1 rounded hover:bg-slate-100 text-slate-400" title="Copiar">
                <Copy size={10} />
            </button>
        )}
    </div>
);
