import React, { useEffect, useMemo, useState } from 'react';
import {
    X, ShieldCheck, Mail, Phone, MapPin, Calendar, Hash, IdCard,
    Eye, Camera, CheckCircle2, AlertTriangle, RefreshCw, Copy, ChevronDown,
    Home, Download, ExternalLink, Gauge, Wallet, KeyRound,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { NAVY, TEAL, formatDate } from './shared';
import { UserLimitsCard } from './UserLimitsCard';
import { UserBeneficiariesLimits } from './UserBeneficiariesLimits';
import { UserWalletsCard } from './UserWalletsCard';
import { SecurityRecoveryTab } from './SecurityRecoveryTab';

// ─────────────────────────────────────────────
// KycDetailModal — vista rica del detalle KYC al estilo Didit.
// Reusable para usuarios de cuenta (public.users) y terceros
// (public.beneficiaries). El layout es el mismo; las diferencias son
// solo qué campos están disponibles en cada tabla, que se manejan con
// optional chaining.
//
// Secciones:
//   • Header con avatar, nombre, status badge clickeable.
//   • Tabs: Resumen / Verificación de ID / Prueba de vida / Coincidencia
//           facial / Verificación de correo / Validación.
//   • Card Detalles de contacto.
//   • Card Advertencias (flags conocidos del raw_data + heurísticas).
//   • Card Detalles de la sesión Didit.
//   • Card Desglose de costos (placeholder — Didit calcula esto server-side).
//
// Lo importante: el header del status es clickeable → abre un sub-modal
// "Seleccionar nuevo estado" con Aprobado / Rechazado / Reenviado.
// Guardar escribe en la tabla origen (users.kyc_status o
// beneficiaries.kyc_status), loguea al audit y refresca.
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
    didit_session_id?: string | null;
    raw_data?: any;
    is_active?: boolean | null;
    is_blocked?: boolean | null;
    owner_user_id?: string | null;
    linked_user_id?: string | null;
    created_at?: string;
    owner?: { full_name?: string | null; email?: string | null; cuypay_id?: string | null } | null;
}

type Tab = 'resumen' | 'topes' | 'saldos' | 'seguridad' | 'id' | 'vida' | 'facial' | 'direccion' | 'correo' | 'aml' | 'dispositivo';
type NewStatus = 'approved' | 'rejected' | 'in_progress';

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<any> }> = [
    { id: 'resumen',     label: 'Resumen',                 icon: ShieldCheck },
    { id: 'topes',       label: 'Topes',                   icon: Gauge },
    // saldos/seguridad aplican solo a usuarios de cuenta (se filtran para terceros)
    { id: 'saldos',      label: 'Saldos',                  icon: Wallet },
    { id: 'seguridad',   label: 'Seguridad',               icon: KeyRound },
    { id: 'id',          label: 'Verificación de ID',      icon: IdCard },
    { id: 'vida',        label: 'Prueba de vida',          icon: Eye },
    { id: 'facial',      label: 'Coincidencia facial',     icon: Camera },
    { id: 'direccion',   label: 'Verificación de dirección', icon: Home },
    { id: 'correo',      label: 'Verificación de correo',  icon: Mail },
    { id: 'aml',         label: 'Detección AML',           icon: CheckCircle2 },
    { id: 'dispositivo', label: 'Dispositivo e IP',        icon: MapPin },
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

// ─────────────────────────────────────────────
// proxifyDecisionMedia — reescribe IN-PLACE toda URL de media privada de
// Didit dentro de la decision para que pase por el proxy autenticado de
// la edge (?action=get-image&jwt=…&url=…). Los <img>/<video> del browser
// no pueden mandar headers de auth, así que las URLs crudas de Didit
// devolvían 401/403 (ícono de imagen rota).
//
// - Solo toca strings http(s) cuya key sugiera media (image/photo/video/
//   selfie/portrait/front/back/document).
// - No toca URLs que ya son de nuestro Supabase (Storage firmadas) ni las
//   ya proxificadas.
// - Camina el objeto recursivamente (cubre id_verification, liveness,
//   face_match, validations.poa, _raw, etc. sin listar cada campo).
// ─────────────────────────────────────────────
const MEDIA_KEY_RX = /(image|photo|video|selfie|portrait|front|back|document)/i;

function proxifyDecisionMedia(node: any, supabaseUrl: string, jwt: string, depth = 0): void {
    if (!node || typeof node !== 'object' || depth > 6) return;
    for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string'
            && v.startsWith('http')
            && MEDIA_KEY_RX.test(k)
            && !v.includes(supabaseUrl)              // ya es nuestra (Storage / proxy)
            && !v.includes('action=get-image')) {
            (node as any)[k] = `${supabaseUrl}/functions/v1/didit-kyc?action=get-image`
                + `&jwt=${encodeURIComponent(jwt)}`
                + `&url=${encodeURIComponent(v)}`;
        } else if (v && typeof v === 'object') {
            proxifyDecisionMedia(v, supabaseUrl, jwt, depth + 1);
        }
    }
}

interface Props {
    kind: KycEntityKind;
    entity: KycEntity;
    profile: AdminProfile;
    canApprove: boolean;
    onClose: () => void;
    onSaved?: () => void;   // se llama después de cambiar estado / refresh
}

export const KycDetailModal: React.FC<Props> = ({ kind, entity, profile, canApprove, onClose, onSaved }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [tab, setTab]               = useState<Tab>('resumen');
    const [statusOpen, setStatusOpen] = useState(false);
    const [savingStatus, setSaving]   = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
    // Comment opcional para el cambio de estado (audit + se envía a Didit).
    const [statusComment, setStatusComment] = useState('');
    // Acción seleccionada en el sub-modal (para confirmar con comment).
    const [pendingStatus, setPendingStatus] = useState<NewStatus | null>(null);

    // Si users.raw_data.diditSessionId no existe (KYC viejo o flow alterno),
    // el admin puede pegar acá el ID que ve en el panel de Didit (URL del
    // panel termina en /verifications/{session_id}). Lo guardamos en
    // users.raw_data.diditSessionId / beneficiaries.didit_session_id y
    // re-disparamos el fetch de la decisión.
    const [manualSessionId, setManualSessionId] = useState('');
    const [linking, setLinking] = useState(false);
    const [linkErr, setLinkErr] = useState<string | null>(null);

    // Sobreescritura local del sessionId — cuando el admin lo vincula manualmente
    // queremos verlo activo sin esperar al refresh del padre.
    const [overrideSessionId, setOverrideSessionId] = useState<string | null>(null);

    // Lightbox: cuando el admin clickea cualquier imagen (documento, selfie,
    // comprobante), abrimos overlay oscuro en grande dentro de la misma
    // página, en vez de abrir ventana nueva. Antes usábamos <a target="_blank">
    // con "Abrir original" — feo de navegar.
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    // Estado controlado del status: queremos reflejar el cambio en vivo sin
    // esperar al onSaved del padre.
    const [statusValue, setStatusValue] = useState<string>(String(entity.kyc_status ?? '—'));
    useEffect(() => { setStatusValue(String(entity.kyc_status ?? '—')); }, [entity.kyc_status]);

    // raw_data se hidrata on-demand: la lista no la trae para evitar romper la
    // query con posibles restricciones de RLS sobre la columna. Acá pedimos
    // SOLO los campos extra que necesita el modal (raw_data, didit_session_id).
    // Si la query falla, el modal igual funciona con lo que vino del padre.
    const [extra, setExtra] = useState<{ raw_data?: any; didit_session_id?: string | null }>({});
    useEffect(() => {
        let cancelled = false;
        const cols = kind === 'user' ? 'raw_data' : 'didit_session_id';
        (async () => {
            const { data } = await supabasePersonas
                .from(kind === 'user' ? 'users' : 'beneficiaries')
                .select(cols)
                .eq('id', entity.id)
                .maybeSingle();
            if (cancelled) return;
            setExtra((data as any) ?? {});
        })().catch(() => { /* silencioso — el modal sigue mostrando lo que vino del padre */ });
        return () => { cancelled = true; };
    }, [entity.id, kind]);

    // Decisión completa de Didit (hidrata todas las tabs ricas). Se pide a
    // la edge function admin_get_details — el primer fetch llega cacheado
    // si la decisión es <5 min vieja; "Refrescar desde Didit" fuerza re-fetch.
    const [decision, setDecision] = useState<any>(null);
    const [decisionLoading, setDecisionLoading] = useState(false);
    const [decisionErr, setDecisionErr] = useState<string | null>(null);
    // Diagnostics que devuelve la edge cuando el lookup falla — útil para
    // ver qué status devolvió cada path de Didit (404, 200 sin match, etc.)
    const [diagnostics, setDiagnostics] = useState<Array<{ path: string; status: number; bodyPreview?: string; matched?: number }> | null>(null);

    const table       = kind === 'user' ? 'users' : 'beneficiaries';
    const initial     = (entity.full_name?.[0] ?? entity.email?.[0] ?? '?').toUpperCase();
    const sessionId   = overrideSessionId
        ?? entity.didit_session_id
        ?? extra.didit_session_id
        ?? entity.raw_data?.diditSessionId
        ?? extra.raw_data?.diditSessionId
        ?? null;
    const statusKey   = statusValue.toLowerCase();
    const badge       = STATUS_BADGE[statusKey] ?? { bg: '#F1F5F9', text: '#475569', label: statusValue.toUpperCase() };

    // Flags conocidos (heurísticos — Didit los enumera más finos en su panel).
    // Usamos statusValue (estado vivo del modal) en lugar de entity.kyc_status
    // para que al aprobar/rechazar dentro del modal el warning se actualice
    // sin esperar al refresh del padre.
    const warnings = useMemo(() => {
        const out: Array<{ label: string }> = [];
        const rd = entity.raw_data ?? extra.raw_data ?? {};
        if (rd.duplicate_session)          out.push({ label: 'Posible usuario duplicado de otra sesión' });
        if (rd.barcode_not_detected)       out.push({ label: 'Código de barras no detectado' });
        if (rd.email_compromised)          out.push({ label: 'Correo electrónico comprometido detectado' });
        if (rd.phone_disposable)           out.push({ label: 'Número de teléfono desechable' });
        if (statusValue === 'rejected')    out.push({ label: 'Verificación rechazada por el proveedor' });
        if (!entity.kyc_verified_at && (statusValue === 'pending' || statusValue === 'in_progress')) {
            out.push({ label: 'Sesión iniciada hace más de 24h sin completarse' });
        }
        return out;
    }, [entity, extra, statusValue]);

    const copy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); } catch {/* ignore */}
    };

    // changeStatus ahora llama POST ?action=update_status del backend de
    // Antigravity, que sincroniza Didit + Lincoin + cache + kyc_events audit
    // en una sola llamada. Acepta comment opcional (obligatorio para reject/
    // resubmit por buena práctica de compliance, pero el backend decide).
    const changeStatus = async (newStatus: NewStatus, comment: string) => {
        if (!canApprove) return;
        setSaving(true);
        setRefreshMsg(null);
        try {
            // Mapeo: in_progress (REENVIADO en UI) → 'resubmit' que entiende
            // el backend de Antigravity.
            const apiStatus = newStatus === 'in_progress' ? 'resubmit' : newStatus;
            const env: any = (import.meta as any).env ?? {};
            const supabaseUrl = env.VITE_SUPABASE_PERSONAS_URL || env.VITE_SUPABASE_URL || '';
            const apikey      = env.VITE_SUPABASE_PERSONAS_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
            const { data: sess } = await supabasePersonas.auth.getSession();
            const accessToken = sess?.session?.access_token ?? '';
            const body: Record<string, any> = {
                user_id: entity.id,
                new_status: apiStatus,
            };
            if (sessionId) body.session_id = sessionId;
            if (comment.trim()) body.comment = comment.trim();
            const edgeHeaders = {
                'Authorization': `Bearer ${accessToken || apikey}`,
                'apikey': apikey,
                'Content-Type': 'application/json',
            };
            // Camino primario: action update_status (una sola llamada que hace
            // Didit push + users update). Metemos el action TAMBIÉN en el body
            // porque algunas versiones deployadas de la edge solo leen body.action.
            const resp = await fetch(`${supabaseUrl}/functions/v1/didit-kyc?action=update_status`, {
                method: 'POST',
                headers: edgeHeaders,
                body: JSON.stringify({ ...body, action: 'update_status' }),
            });
            const data: any = await resp.json().catch(() => null);
            const failMsg = data?.error ?? '';
            const actionUnsupported = /unknown action|falta action/i.test(failMsg);
            if ((!resp.ok || data?.ok === false) && !actionUnsupported) {
                throw new Error(failMsg || `HTTP ${resp.status}`);
            }
            // Fallback: la edge deployada no conoce update_status (versión
            // vieja). Reproducimos el flow con los 2 actions legacy:
            //   1. admin_set_didit_status → push a Didit (best-effort)
            //   2. admin_set_status       → UPDATE users.kyc_status
            if (actionUnsupported) {
                const canonical = newStatus === 'approved' ? 'verified' : newStatus;
                // 1) push a Didit (no abortamos si falla — Lincoin manda)
                try {
                    await fetch(`${supabaseUrl}/functions/v1/didit-kyc`, {
                        method: 'POST',
                        headers: edgeHeaders,
                        body: JSON.stringify({
                            action: 'admin_set_didit_status',
                            userId: entity.id,
                            status: canonical,
                            session_id: sessionId || undefined,
                        }),
                    });
                } catch { /* best-effort */ }
                // 2) update de users (este sí es obligatorio)
                const r2 = await fetch(`${supabaseUrl}/functions/v1/didit-kyc`, {
                    method: 'POST',
                    headers: edgeHeaders,
                    body: JSON.stringify({
                        action: 'admin_set_status',
                        userId: entity.id,
                        status: canonical,
                    }),
                });
                const d2: any = await r2.json().catch(() => null);
                if (!r2.ok || d2?.ok === false) {
                    throw new Error(d2?.error ?? `HTTP ${r2.status} (fallback admin_set_status)`);
                }
            }
            // Sync inmediato del badge local. El backend ya escribió Didit +
            // users.kyc_status + cache, pero la prop entity todavía tiene el
            // valor viejo hasta el próximo onSaved + refetch del padre.
            const mappedLocal = newStatus === 'approved' ? 'verified' : newStatus;
            setStatusValue(mappedLocal);
            await logAdminAction({
                admin: profile,
                action: 'kyc_status_change',
                targetType: kind === 'user' ? 'user' : 'beneficiary',
                targetId: entity.id,
                metadata: {
                    from: entity.kyc_status, to: mappedLocal,
                    didit_status: apiStatus, comment: comment.trim() || null,
                    source: 'kyc_detail_modal',
                },
            });
            setRefreshMsg(`✓ ${apiStatus.toUpperCase()} sincronizado con Didit y Lincoin`);
            setStatusOpen(false);
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

    // Pide a la edge function la decisión completa de Didit. Para usuarios
    // pasamos userId (la function busca raw_data.diditSessionId). Para
    // beneficiaries pasamos session_id directo porque la columna vive en
    // beneficiaries.didit_session_id, no en users.
    // Contrato nuevo de la edge function (alineado con lo que Antigravity está
    // exponiendo): GET ?action=full&user_id=<uuid> con Authorization Bearer
    // <admin_jwt>. Acepta session_id directo o beneficiary_id como variantes.
    // Response shape:
    //   { session_id, status, summary, id_verification, liveness, face_match,
    //     email_verification, validations, cost_breakdown, _raw }
    const fetchDecision = async (force = false) => {
        if (!sessionId && kind === 'beneficiary') {
            setDecisionErr('Esta entidad no tiene didit_session_id — no hay decisión que pedir.');
            return;
        }
        setDecisionLoading(true);
        setDecisionErr(null);
        try {
            // Construimos el URL con query params para hacer GET (que es lo
            // que el backend espera). supabasePersonas.functions.invoke()
            // siempre hace POST, así que usamos fetch directo.
            // force=true → bypasea el cache del backend y trae fresh de Didit
            // (usado por el botón "Refrescar desde Didit").
            const params = new URLSearchParams({ action: 'full' });
            if (force) params.set('force', 'true');
            if (kind === 'user') {
                params.set('user_id', entity.id);
                if (sessionId) params.set('session_id', sessionId);
            } else {
                params.set('beneficiary_id', entity.id);
                if (sessionId) params.set('session_id', sessionId);
            }
            // Auth + URL: la edge function vive en el proyecto PERSONAS
            // (jnbmqzalkeheqoukjmhy = LincoinANDROID) — confirmado por
            // Antigravity: GET https://jnbmqzalkeheqoukjmhy.supabase.co/
            // functions/v1/didit-kyc?action=ping responde OK con todos los
            // env vars en true.
            // Importante usar VITE_SUPABASE_PERSONAS_URL (no VITE_SUPABASE_URL
            // que apunta al proyecto Empresas, donde la función NO existe).
            const env: any = (import.meta as any).env ?? {};
            const supabaseUrl = env.VITE_SUPABASE_PERSONAS_URL || env.VITE_SUPABASE_URL || '';
            const apikey      = env.VITE_SUPABASE_PERSONAS_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
            const { data: sess } = await supabasePersonas.auth.getSession();
            const accessToken = sess?.session?.access_token ?? '';
            const resp = await fetch(`${supabaseUrl}/functions/v1/didit-kyc?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken || apikey}`,
                    'apikey': apikey,
                },
            });
            const data: any = await resp.json().catch(() => null);
            if (!resp.ok) {
                throw new Error(data?.error ?? `HTTP ${resp.status}`);
            }
            // Las URLs de media de Didit son privadas (401/403 desde un <img>
            // pelado porque el browser no puede mandar el API key). Las
            // reescribimos para que pasen por nuestro proxy autenticado
            // (?action=get-image) que inyecta el key server-side. Las URLs
            // que ya son de nuestro Supabase Storage quedan como están.
            proxifyDecisionMedia(data, supabaseUrl, accessToken || apikey);
            // Detectar dos casos donde no hay decisión real para mostrar:
            //   1. data.error === 'no_session' → el user no tiene
            //      users.didit_session_id (Antigravity's contract).
            //   2. Placeholder de mi propio backend viejo (pong=true, sin
            //      ninguna sección de decisión) — caso transición mientras
            //      Antigravity no deploya su action=full.
            const isNoSession   = data?.error === 'no_session';
            const isPlaceholder = data && data.pong === true && !data.session_id
                && !data.summary && !data.id_verification && !data.liveness;
            if (data?.ok === false || isNoSession || isPlaceholder) {
                setDecisionErr(
                    isNoSession
                        ? 'Este usuario no tiene sesión Didit vinculada. Pegá el ID de sesión abajo y dale "Vincular sesión".'
                        : isPlaceholder
                            ? 'El backend nuevo (action=full) no está deployado todavía. Vinculá manualmente la sesión Didit más abajo.'
                            : (data?.error ?? 'Didit no devolvió decisión')
                );
                if (data?.diagnostics) setDiagnostics(data.diagnostics);
            } else if (data) {
                // El nuevo contrato devuelve la decisión completa al top-level
                // (no envuelta en data.decision). El modal igual sigue
                // esperando un objeto plano con summary/id_verification/etc.
                setDecision(data);
                if (data.session_id && !sessionId) setOverrideSessionId(data.session_id);
                // Sync del badge SOLO si Didit devuelve un status canónico
                // conocido. Si viene null/unknown/vacío, dejamos el statusValue
                // local (kyc_status de la DB) — sino el badge quedaba en
                // "UNKNOWN" en lugar del estado real local.
                const diditStatus = data?.status ?? data?.summary?.status;
                if (typeof diditStatus === 'string' && diditStatus) {
                    const norm = String(diditStatus).toLowerCase().trim();
                    const mapped =
                        norm === 'approved'           ? 'verified' :
                        norm === 'declined'           ? 'rejected' :
                        norm === 'in review'          ? 'in_review' :
                        norm === 'in progress'        ? 'in_progress' :
                        norm === 'completed'          ? 'verified' :
                        norm === 'pending'            ? 'pending' :
                        '';  // unknown / vacío → no override
                    if (mapped) {
                        setStatusValue(mapped);
                        // Persistir a DB si Didit dice algo distinto del estado
                        // local — así la LISTA del dashboard también refleja el
                        // último real, no solo el modal.
                        if (mapped !== entity.kyc_status) {
                            const patch: Record<string, any> = { kyc_status: mapped };
                            if (mapped === 'verified' && !entity.kyc_verified_at) {
                                patch.kyc_verified_at = new Date().toISOString();
                            }
                            const { error: updErr } = await supabasePersonas
                                .from(table).update(patch).eq('id', entity.id);
                            if (!updErr) {
                                await logAdminAction({
                                    admin: profile,
                                    action: 'kyc_status_sync_from_didit',
                                    targetType: kind,
                                    targetId: entity.id,
                                    metadata: { from: entity.kyc_status, to: mapped, didit_status: diditStatus },
                                });
                                onSaved?.();
                            }
                        }
                    }
                }
            }
        } catch (e: any) {
            setDecisionErr(`Edge function falló: ${e?.message ?? 'desconocido'}`);
        }
        setDecisionLoading(false);
    };

    // Auto-fetch al abrir el modal:
    //   • Si hay sessionId → pedimos decisión directa (rápido).
    //   • Si NO hay sessionId pero es un user → igual disparamos: la edge
    //     function intenta auto-descubrirlo en Didit por vendor_data=userId
    //     y, si lo encuentra, lo persiste y devuelve la decisión.
    //   • Para beneficiaries sin session_id no hacemos nada (no tenemos
    //     vendor_data confiable para buscar).
    useEffect(() => {
        if (sessionId || kind === 'user') fetchDecision(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, kind, entity.id]);

    // Vincular manualmente una sesión Didit a este usuario/tercero.
    // El admin pega el UUID que ve en el panel de Didit y lo persistimos en
    // raw_data.diditSessionId (users) o didit_session_id (beneficiaries) para
    // que el siguiente fetch lo encuentre. Necesario para KYCs viejos hechos
    // antes de que se guardara el session_id, o cuando el backfill por
    // vendor_data no logra rescatarlo.
    const linkSession = async () => {
        const sid = manualSessionId.trim();
        if (!sid) {
            setLinkErr('Pegá un ID de sesión Didit (lo encontrás en la URL del panel de Didit).');
            return;
        }
        setLinking(true);
        setLinkErr(null);
        try {
            // Contrato nuevo (Antigravity): el session_id vive en la columna
            // users.didit_session_id (no en raw_data). El admin tiene RLS para
            // hacer update directo. Para beneficiaries la columna se llama
            // igual: beneficiaries.didit_session_id.
            const table = kind === 'user' ? 'users' : 'beneficiaries';
            const { error: updErr } = await supabasePersonas.from(table)
                .update({ didit_session_id: sid }).eq('id', entity.id);
            if (updErr) throw updErr;
            await logAdminAction({
                admin: profile, action: 'kyc_link_didit_session',
                targetType: kind, targetId: entity.id,
                metadata: { session_id: sid },
            });
            setOverrideSessionId(sid);
            setManualSessionId('');
            // Disparar fetch ahora que el session_id está vinculado — el
            // action=full del backend va a traer la decisión completa.
            await fetchDecision(true);
            onSaved?.();
        } catch (e: any) {
            setLinkErr(`No pude vincular la sesión: ${e?.message ?? 'desconocido'}`);
        }
        setLinking(false);
    };

    // Refresh contra Didit — fuerza re-fetch (bypass cache de 5 min).
    // fetchDecision se encarga de persistir kyc_status en la DB si Didit
    // devuelve un status canónico distinto del local, así la lista del
    // dashboard también queda sincronizada (no solo el modal).
    const refreshFromDidit = async () => {
        if (!sessionId) {
            setRefreshMsg('Esta entidad no tiene didit_session_id — no hay nada que refrescar.');
            return;
        }
        setRefreshing(true);
        setRefreshMsg(null);
        const localBefore = entity.kyc_status;
        try {
            await fetchDecision(true);
            // statusValue es state — para saber si cambió consultamos el
            // valor más reciente vía setStatusValue del fetchDecision.
            setRefreshMsg(
                statusValue && statusValue !== localBefore
                    ? `✓ Status actualizado: ${localBefore ?? '—'} → ${statusValue}`
                    : '✓ Datos actualizados desde Didit'
            );
            onSaved?.();
        } catch (e: any) {
            setRefreshMsg(`Edge function falló: ${e?.message ?? 'desconocido'}`);
        }
        setRefreshing(false);
    };

    // Helpers para sacar campos típicos del JSON de Didit (la forma exacta
    // varía por versión de API — probamos varias rutas conocidas).
    const d = decision ?? {};
    // Antigravity contract: id_verification, liveness, face_match,
    // email_verification, validations, cost_breakdown. Fallbacks a nombres
    // alternativos por compat con la respuesta directa de Didit.
    const idVer    = d.id_verification ?? d.kyc ?? d.document ?? null;
    // (vars liveness, faceMatch, addrVer, emailVer, dbVal definidas abajo)
    const liveness = d.liveness ?? d.liveness_check ?? null;
    const faceMatch= d.face_match ?? d.face_comparison ?? null;
    // Antigravity → "poa_verification" (proof of address). Fallback a los nombres
    // viejos por compat.
    // POA: la edge v5 expone validations.poa pero su transform es lossy
    // (mapea poa.address que NO existe en el raw → llega null). El dato real
    // vive en _raw.didit_decision.poa_verifications[0] con poa_address /
    // poa_formatted_address / issuer. FUSIONAMOS: el crudo pisa al transform,
    // y el transform llena lo que el crudo no tenga.
    const poaEdge = d?.validations?.poa ?? null;
    const poaRaw  = d?._raw?.didit_decision?.poa_verifications?.[0] ?? null;
    const addrVer = d.poa_verification ?? d.address_verification ?? d.address
        ?? ((poaRaw || poaEdge) ? { ...(poaEdge ?? {}), ...(poaRaw ?? {}) } : null);
    // Email: mismo patrón que POA — el transform de la edge es mínimo
    // ({email, passed}); el raw trae las brechas de seguridad (breaches),
    // el score y el detalle que muestra la consola de Didit. Fusionamos.
    const emailEdge = (d.email_verification && typeof d.email_verification === 'object') ? d.email_verification
        : (d.email && typeof d.email === 'object') ? d.email : null;
    const emailRawD = d?._raw?.didit_decision?.email_verifications?.[0] ?? null;
    const emailVer  = (emailRawD || emailEdge) ? { ...(emailEdge ?? {}), ...(emailRawD ?? {}) } : null;
    // Antigravity → "validations". También aceptamos los nombres viejos.
    const dbVal    = d.validations ?? d.database_verification ?? d.validation ?? d.aml ?? null;

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
                        {(() => {
                            // Avatar con cadena de fallbacks, mejor → peor:
                            //   1. portrait_image_url (cara recortada del doc)
                            //   2. selfie de liveness (la que tomó el user)
                            //   3. front_image_url (frente del doc, tiene cara)
                            //   4. inicial sobre TEAL
                            // Click → ampliar la que esté usando en el lightbox.
                            const id   = decision?.id_verification ?? {};
                            const live = decision?.liveness ?? {};
                            const avatarUrl =
                                id.portrait_image_url ?? id.portrait_url ?? id.images?.portrait ??
                                live.selfie_url ?? live.image_url ?? live.images?.selfie ??
                                id.front_url ?? id.front_image_url ?? id.images?.front ??
                                null;
                            if (avatarUrl) {
                                return (
                                    <button
                                        type="button"
                                        onClick={() => setLightboxUrl(avatarUrl)}
                                        className="w-12 h-12 rounded-full overflow-hidden shrink-0 border-2 border-white shadow-sm cursor-zoom-in p-0 bg-slate-100"
                                        title="Ampliar"
                                    >
                                        <img src={avatarUrl} alt={entity.full_name ?? ''} className="w-full h-full object-cover" />
                                    </button>
                                );
                            }
                            return (
                                <div
                                    className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
                                    style={{ backgroundColor: TEAL, color: NAVY }}
                                >
                                    {initial}
                                </div>
                            );
                        })()}
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold truncate" style={{ color: NAVY }}>
                                {entity.full_name ?? '—'}
                            </h3>
                            <p className="text-xs text-slate-500 truncate">{entity.email ?? entity.phone ?? '—'}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
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

                {/* Refresh banner: si hay didit_session_id mostramos botón */}
                {sessionId && (
                    <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between gap-3 text-xs text-blue-900">
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="truncate"><b>Sesión Didit:</b> <code className="font-mono">{sessionId.slice(0, 24)}…</code></span>
                            {/* Chip indicador: si la decisión vino de cache backend o fresh de Didit */}
                            {decision?._source === 'cache' && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold" title="Decisión leída del cache (5 min). Click Refrescar para forzar fetch a Didit.">
                                    📦 Cacheado
                                </span>
                            )}
                            {decision?._source === 'didit_live' && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold" title="Decisión fresh desde Didit (no cache)">
                                    🔄 Actualizado
                                </span>
                            )}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                            {refreshMsg && <span className="text-blue-700">{refreshMsg}</span>}
                            <button
                                onClick={refreshFromDidit}
                                disabled={refreshing}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-blue-200 hover:bg-blue-50 disabled:opacity-50"
                            >
                                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                                Refrescar desde Didit
                            </button>
                        </div>
                    </div>
                )}

                {/* Banner para vincular manualmente cuando no hay session_id.
                    Caso típico: KYC viejo que nunca guardó diditSessionId en
                    raw_data, y la edge function tampoco lo encontró por
                    vendor_data en Didit. Solo mostramos este banner DESPUÉS
                    de que el auto-discovery falló (decisionErr presente o el
                    fetch terminó sin encontrar nada). */}
                {!sessionId && !decisionLoading && decisionErr && (
                    <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-900">
                        <div className="flex items-start gap-2 mb-2">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
                            <div className="flex-1">
                                <p className="font-semibold">No pude conectar con la sesión Didit automáticamente.</p>
                                <p className="opacity-80 mt-0.5">
                                    Como último recurso: abrí el panel de Didit, buscá al usuario por correo,
                                    copiá el <b>ID de sesión</b> (UUID al final de la URL) y pegalo acá.
                                </p>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        setLinkErr(null);
                                        try {
                                            // Ping = GET sin Authorization (el handler no requiere auth).
                                            // Antes usábamos functions.invoke() que hace POST con body +
                                            // headers de auth, lo que causaba "Failed to send a request".
                                            const env: any = (import.meta as any).env ?? {};
                                            const supabaseUrl = env.VITE_SUPABASE_PERSONAS_URL || env.VITE_SUPABASE_URL || '';
                                            const resp = await fetch(`${supabaseUrl}/functions/v1/didit-kyc?action=ping`, { method: 'GET' });
                                            const data = await resp.json().catch(() => null);
                                            if (!resp.ok) { setLinkErr(`PING falló: HTTP ${resp.status}`); return; }
                                            setLinkErr(`PING OK: ${JSON.stringify(data?.env ?? data)}`);
                                        } catch (e: any) {
                                            setLinkErr(`PING crashea: ${e?.message ?? 'desconocido'}`);
                                        }
                                    }}
                                    className="mt-2 px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-amber-300 hover:bg-amber-100"
                                >
                                    🔍 Probar conexión (ping)
                                </button>
                                {diagnostics && diagnostics.length > 0 && (
                                    <details className="mt-2">
                                        <summary className="cursor-pointer text-amber-700 font-semibold">
                                            Ver detalle ({diagnostics.length} paths probados)
                                        </summary>
                                        <table className="mt-1.5 w-full text-[10px] font-mono">
                                            <tbody>
                                                {diagnostics.map((d, i) => (
                                                    <tr key={i} className="border-t border-amber-200">
                                                        <td className="py-1 pr-2">{d.path}</td>
                                                        <td className="py-1 pr-2 font-bold" style={{ color: d.status >= 200 && d.status < 300 ? '#065F46' : d.status >= 400 ? '#991B1B' : '#92400E' }}>
                                                            {d.status || 'err'}
                                                        </td>
                                                        <td className="py-1 text-amber-800">
                                                            {d.matched !== undefined ? `${d.matched} match` : (d.bodyPreview ?? '')}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </details>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                value={manualSessionId}
                                onChange={e => setManualSessionId(e.target.value)}
                                placeholder="5ea35b4a-2af7-4c3d-837f-fd211691893d"
                                className="flex-1 px-2.5 py-1.5 rounded-md border border-amber-300 bg-white font-mono text-[11px] outline-none focus:border-amber-500"
                            />
                            <button
                                onClick={linkSession}
                                disabled={linking || !manualSessionId.trim()}
                                className="px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50"
                                style={{ backgroundColor: NAVY, color: 'white' }}
                            >
                                {linking ? 'Vinculando…' : 'Vincular sesión'}
                            </button>
                        </div>
                        {linkErr && <p className="text-red-700 mt-2">{linkErr}</p>}
                    </div>
                )}

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

                            <Card title="Detalles de la sesión">
                                <KV
                                    label="ID de sesión"
                                    value={sessionId ?? '—'}
                                    mono
                                    onCopy={sessionId ? () => copy(sessionId) : undefined}
                                />
                                <KV label="Creado el" value={entity.created_at ? formatDate(entity.created_at) : '—'} />
                                <KV label="KYC verificado" value={entity.kyc_verified_at ? formatDate(entity.kyc_verified_at) : '—'} />
                                <KV label="Proveedor KYC" value={entity.kyc_provider && entity.kyc_provider !== 'Didit' ? entity.kyc_provider : 'Lincoin'} />
                                <KV label="Lincoin ID" value={entity.cuypay_id ?? '—'} mono />
                                <KV label="UUID" value={entity.id} mono onCopy={() => copy(entity.id)} />
                            </Card>

                            <Card title="Desglose de costos">
                                <CostRow label="Verificación de Identidad"        value="—" />
                                <CostRow label="Detección de Vida Activa"         value="—" />
                                <CostRow label="Coincidencia Facial"              value="—" />
                                <CostRow label="Verificación de Correo"           value="—" />
                                <CostRow label="Validación de Base de Datos"      value="—" />
                                <div className="border-t border-slate-200 mt-2 pt-2">
                                    <CostRow label="Total" value="—" bold />
                                </div>
                                <p className="text-[10px] text-slate-400 mt-2">
                                    Los costos los calcula Didit server-side. Para hidratar acá necesitamos que la
                                    edge function <code>didit-kyc</code> exponga <code>cost_breakdown</code>.
                                </p>
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

                    {tab !== 'resumen' && tab !== 'topes' && tab !== 'saldos' && tab !== 'seguridad' && (
                        <div className="md:col-span-2">
                            {decisionLoading && (
                                <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500 flex items-center gap-2">
                                    <RefreshCw size={14} className="animate-spin" /> Cargando datos de Didit…
                                </div>
                            )}
                            {!decisionLoading && decisionErr && (
                                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900">
                                    <p className="font-semibold mb-1">No pude cargar la decisión de Didit</p>
                                    <p>{decisionErr}</p>
                                </div>
                            )}
                            {!decisionLoading && !decisionErr && !decision && !sessionId && (
                                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600">
                                    Esta entidad no tiene <code>didit_session_id</code> — no hay datos del proveedor para mostrar.
                                </div>
                            )}
                            {decision && tab === 'id'         && <IdVerificationTab data={idVer} raw={decision} onImageClick={setLightboxUrl} />}
                            {decision && tab === 'vida'       && <LivenessTab data={liveness} raw={decision} onImageClick={setLightboxUrl} />}
                            {decision && tab === 'facial'     && <FaceMatchTab data={faceMatch} raw={decision} onImageClick={setLightboxUrl} />}
                            {decision && tab === 'direccion'  && <AddressTab data={addrVer} raw={decision} onImageClick={setLightboxUrl} />}
                            {decision && tab === 'correo'     && <EmailTab data={emailVer} raw={decision} email={entity.email} />}
                            {decision && tab === 'aml'         && <AmlTab data={dbVal} raw={decision} entity={entity} />}
                            {decision && tab === 'dispositivo' && <DeviceIpTab raw={decision} />}
                        </div>
                    )}
                </div>
            </div>

            {/* Sub-modal: cambiar estado (2 pasos: elegir acción → confirmar
                con comentario opcional → POST al backend que sincroniza
                Didit + Lincoin + cache + audit en una sola llamada). */}
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
                                    El backend va a sincronizar Didit y Lincoin simultáneamente. El cambio queda en el audit log.
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
                                        ? 'Vas a aprobar la verificación. Esto se sincroniza con Didit y permite al usuario operar.'
                                        : pendingStatus === 'rejected'
                                        ? 'Vas a rechazar la verificación. Esto se sincroniza con Didit y bloquea al usuario hasta nuevo intento.'
                                        : 'Vas a pedirle al usuario que reenvíe la verificación.'}
                                </p>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Comentario {pendingStatus !== 'approved' && <span className="text-slate-400 font-normal">(recomendado)</span>}
                                </label>
                                <textarea
                                    value={statusComment}
                                    onChange={(e) => setStatusComment(e.target.value)}
                                    rows={3}
                                    placeholder={pendingStatus === 'rejected' ? 'Motivo del rechazo (ej: documento ilegible, datos no coinciden, etc.)' : pendingStatus === 'in_progress' ? 'Qué debe reenviar el usuario...' : 'Opcional'}
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
                                        {savingStatus ? 'Sincronizando…' : `Confirmar ${STATUS_OPTIONS.find(o => o.value === pendingStatus)?.label}`}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Lightbox: overlay con la imagen/video/PDF clickeado en grande.
                IMPORTANTE: stopPropagation en TODOS los onClicks — sin esto
                el click se propaga al modal padre (que tiene onClick={onClose})
                y cierra ambas ventanas a la vez. */}
            {lightboxUrl && (
                <div
                    className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center p-4"
                    onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
                        className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white z-10"
                        aria-label="Cerrar"
                    >
                        <X size={22} />
                    </button>
                    {/\.(mp4|webm|mov)(\?|$)/i.test(lightboxUrl) ? (
                        <video
                            src={lightboxUrl}
                            controls
                            autoPlay
                            className="max-w-full max-h-full rounded-lg"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : /\.pdf(\?|$)/i.test(lightboxUrl) ? (
                        <iframe
                            src={lightboxUrl}
                            title="Documento PDF"
                            className="w-[95vw] h-[90vh] rounded-lg bg-white"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <img
                            src={lightboxUrl}
                            alt="vista ampliada"
                            className="max-w-full max-h-full object-contain rounded-lg"
                            onClick={(e) => e.stopPropagation()}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

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

const CostRow: React.FC<{ label: string; value: string; bold?: boolean }> = ({ label, value, bold }) => (
    <div className={`flex items-center justify-between text-xs ${bold ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
        <span>{label}</span>
        <span className="font-mono">{value}</span>
    </div>
);

// ─── Tabs Didit ────────────────────────────────────────────────
// La forma exacta del JSON de Didit cambia entre versiones de API.
// Cada sub-tab acepta `data` (el sub-objeto típico) y `raw` (decisión
// completa) por si necesita caer a un fallback. Mostramos siempre
// también el JSON crudo en un <details> para no perder nada.

const fmt = (v: any): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
};

const StatusPill: React.FC<{ status?: string | null }> = ({ status }) => {
    if (!status) return <span className="text-xs text-slate-400">—</span>;
    const s = String(status).toLowerCase();
    const ok = ['approved', 'verified', 'valid', 'passed', 'success', 'match', 'matched'].includes(s);
    const bad = ['declined', 'rejected', 'failed', 'invalid', 'no_match', 'not_matched'].includes(s);
    const bg = ok ? '#D1FAE5' : bad ? '#FEE2E2' : '#FEF3C7';
    const fg = ok ? '#065F46' : bad ? '#991B1B' : '#92400E';
    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: bg, color: fg }}>
            {status}
        </span>
    );
};

const RawJsonDetails: React.FC<{ data: any; label?: string }> = ({ data, label = 'Ver JSON crudo de Didit' }) => (
    <details className="mt-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
        <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
            {label}
        </summary>
        <pre className="p-3 overflow-auto max-h-80 text-[10px] text-slate-700">{JSON.stringify(data, null, 2)}</pre>
    </details>
);

// Reproductor de video inline (para liveness .webm). Click → lightbox full-screen.
const VideoCard: React.FC<{ label: string; url?: string | null; onClick?: (url: string) => void }> = ({ label, url, onClick }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
            {url && onClick && (
                <button
                    type="button"
                    onClick={() => onClick(url)}
                    className="p-1 text-slate-400 hover:text-slate-700"
                    title="Ampliar"
                >
                    <Eye size={12} />
                </button>
            )}
        </div>
        {url ? (
            <video
                src={url}
                controls
                playsInline
                className="rounded-lg w-full max-h-64 bg-black"
            />
        ) : (
            <div className="h-32 flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded-lg">Sin video</div>
        )}
    </div>
);

// Card para documentos. Si es imagen → ImageCard. Si es PDF → embed <iframe>
// inline (muestra el PDF dentro de la card sin tener que abrir ventana nueva).
// Click en la preview → lightbox fullscreen con iframe también.
const DocumentCard: React.FC<{ label: string; url?: string | null; filename?: string | null; onImageClick?: (url: string) => void }> = ({ label, url, filename, onImageClick }) => {
    if (!url) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{label}</p>
                <div className="h-32 flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded-lg">Sin documento</div>
            </div>
        );
    }
    const isImage = /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(url);
    if (isImage) return <ImageCard label={label} url={url} onClick={onImageClick} />;
    // URLs proxificadas (?action=get-image) o firmadas no tienen extensión —
    // no podemos saber el tipo por el nombre. SmartDocPreview intenta <img>
    // primero y cae a <iframe> (PDF) si la imagen no decodifica.
    const isProxied = url.includes('action=get-image') || url.includes('/storage/v1/object/sign/');
    if (isProxied) return <SmartDocPreview label={label} url={url} onImageClick={onImageClick} />;
    const fname = filename ?? (url.split('/').pop()?.split('?')[0] ?? 'documento.pdf');
    const isPdf = /\.pdf(\?|$)/i.test(url);
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate" title={fname}>
                    {label}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                    {onImageClick && (
                        <button
                            type="button"
                            onClick={() => onImageClick(url)}
                            className="p-1 text-slate-400 hover:text-slate-700"
                            title="Ampliar"
                        >
                            <Eye size={12} />
                        </button>
                    )}
                    <a
                        href={url}
                        download={fname}
                        className="p-1 text-slate-400 hover:text-slate-700"
                        title="Descargar"
                    >
                        <Download size={12} />
                    </a>
                </div>
            </div>
            {isPdf ? (
                <button
                    type="button"
                    onClick={() => onImageClick?.(url)}
                    className="block w-full p-0 border-0 bg-transparent cursor-zoom-in"
                    title="Ampliar PDF"
                >
                    <iframe
                        src={`${url}#toolbar=0&navpanes=0`}
                        title={fname}
                        className="rounded-lg w-full h-64 bg-slate-100 pointer-events-none"
                    />
                </button>
            ) : (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-slate-200 text-slate-600">
                        <span className="text-[10px] font-bold">DOC</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 truncate flex-1" title={fname}>{fname}</p>
                </div>
            )}
        </div>
    );
};

// SmartDocPreview — para URLs sin extensión (proxy get-image / signed URLs).
// Intenta renderizar como imagen; si el browser no puede decodificarla
// (probablemente es un PDF), cae a un <iframe> que Chrome renderiza nativo.
const SmartDocPreview: React.FC<{ label: string; url: string; onImageClick?: (url: string) => void }> = ({ label, url, onImageClick }) => {
    const [mode, setMode] = React.useState<'img' | 'pdf'>('img');
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                <a href={url} target="_blank" rel="noreferrer" className="p-1 text-slate-400 hover:text-slate-700" title="Abrir original">
                    <Download size={12} />
                </a>
            </div>
            {mode === 'img' ? (
                <button
                    type="button"
                    onClick={() => onImageClick?.(url)}
                    className="block w-full p-0 border-0 bg-transparent cursor-zoom-in"
                    title="Ampliar"
                >
                    <img
                        src={url}
                        alt={label}
                        className="rounded-lg w-full h-64 object-contain bg-slate-100"
                        onError={() => setMode('pdf')}
                    />
                </button>
            ) : (
                <iframe
                    src={`${url}#toolbar=0&navpanes=0`}
                    title={label}
                    className="rounded-lg w-full h-64 bg-slate-100"
                />
            )}
        </div>
    );
};

const ImageCard: React.FC<{ label: string; url?: string | null; onClick?: (url: string) => void }> = ({ label, url, onClick }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{label}</p>
        {url ? (
            <button
                type="button"
                onClick={() => onClick?.(url)}
                className="block w-full p-0 border-0 bg-transparent cursor-zoom-in"
                title="Ampliar"
            >
                <img src={url} alt={label} className="rounded-lg w-full object-cover max-h-64 hover:opacity-90 transition-opacity" />
            </button>
        ) : (
            <div className="h-32 flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded-lg">Sin imagen</div>
        )}
    </div>
);

const IdVerificationTab: React.FC<{ data: any; raw: any; onImageClick?: (url: string) => void }> = ({ data, raw, onImageClick }) => {
    // Antigravity contract: { front_url, back_url, portrait_image_url,
    // ocr_fields, document_type, decision }. Fallbacks a la API directa de
    // Didit por compat con versiones antiguas.
    // Keys del contrato Antigravity (front_url…) + keys CRUDAS de la API de
    // Didit v2/v3 (front_image, full_front_image…) — la edge actual devuelve
    // el JSON de Didit sin transformar, así que sin estos fallbacks las
    // imágenes no aparecían aunque el OCR sí.
    const front    = data?.front_url ?? data?.front_image_url ?? data?.document_front ?? data?.images?.front
                  ?? data?.front_image ?? data?.full_front_image ?? null;
    const back     = data?.back_url  ?? data?.back_image_url  ?? data?.document_back  ?? data?.images?.back
                  ?? data?.back_image ?? data?.full_back_image ?? null;
    const portrait = data?.portrait_image_url ?? data?.portrait_url ?? data?.images?.portrait
                  ?? data?.portrait_image ?? null;

    // Unificar fuentes de OCR: a veces Antigravity los anida bajo ocr_fields,
    // a veces los expone al root de id_verification. Mezclamos todas para que
    // un mismo lookup (fields.age, fields.issuing_state_name, etc.) los
    // encuentre sin importar dónde estén.
    const fields = {
        ...(data ?? {}),
        ...(data?.ocr_fields ?? {}),
        ...(data?.extracted_fields ?? {}),
        ...(data?.fields ?? {}),
        ...(data?.ocr ?? {}),
    };
    const extra = fields?.extra_fields ?? data?.extra_fields ?? {};

    // Helper para fechas que pueden estar legítimamente nulas (documentos
    // que no expiran, como la cédula colombiana). Si la API devuelve null/''
    // mostramos "No expira" — si simplemente falta la key, "—".
    const expiryRaw = fields.date_of_expiry ?? fields.expires_at ?? fields.expiration_date;
    const hasExpiryKey = 'date_of_expiry' in fields || 'expires_at' in fields || 'expiration_date' in fields;
    const expiry =
        expiryRaw                ? fmt(expiryRaw) :
        hasExpiryKey             ? 'No expira' :   // key existe pero null/'' → no expira
        '—';

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <p className="font-semibold" style={{ color: NAVY }}>Verificación de ID</p>
                <StatusPill status={data?.decision ?? data?.status ?? raw?.summary?.id_verification_status} />
            </div>
            <div className={`grid grid-cols-1 ${portrait ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-3 mb-4`}>
                <ImageCard label="Frente del documento" url={front} onClick={onImageClick} />
                <ImageCard label="Reverso del documento" url={back} onClick={onImageClick} />
                {portrait && <ImageCard label="Retrato del documento" url={portrait} onClick={onImageClick} />}
            </div>
            <Card title="Campos extraídos (OCR)">
                <KV label="Tipo de documento"   value={fmt(fields.document_type ?? fields.document_subtype)} />
                <KV label="Número de documento" value={fmt(fields.document_number ?? fields.personal_number)} mono />
                <KV label="Nombre completo"     value={fmt(fields.full_name ?? `${fields.first_name ?? ''} ${fields.last_name ?? ''}`.trim())} />
                <KV label="Fecha de nacimiento" value={fmt(fields.date_of_birth ?? fields.dob)} />
                <KV label="Edad"                value={fmt(fields.age)} />
                <KV label="Lugar de nacimiento" value={fmt(fields.place_of_birth)} />
                <KV label="Nacionalidad"        value={fmt(fields.nationality ?? fields.issuing_state_name)} />
                <KV label="Género"              value={fmt(fields.gender)} />
                <KV label="Fecha de emisión"    value={fmt(fields.date_of_issue ?? fields.issued_at)} />
                <KV label="Fecha de expiración" value={expiry} />
                <KV label="País emisor"         value={fmt(fields.issuing_state_name ?? fields.issuing_country ?? fields.country ?? fields.issuing_state)} />
                <KV label="Grupo sanguíneo"     value={fmt(extra?.blood_group)} />
            </Card>
            <RawJsonDetails data={data ?? raw} />
        </div>
    );
};

const LivenessTab: React.FC<{ data: any; raw: any; onImageClick?: (url: string) => void }> = ({ data, raw, onImageClick }) => {
    // Antigravity contract: { selfie_url, video_url (.webm), score,
    // age_estimation, decision }.
    // + keys crudas de Didit: reference_image (frame del video usado como
    // selfie), selfie_image. video_url ya coincide con el raw.
    const selfie   = data?.selfie_url ?? data?.selfie_image_url ?? data?.image_url ?? data?.images?.selfie
                  ?? data?.reference_image ?? data?.selfie_image ?? null;
    const video    = data?.video_url ?? data?.liveness_video_url ?? null;
    const score    = data?.score ?? data?.confidence ?? raw?.summary?.liveness_score;
    const ageEst   = data?.age_estimation ?? data?.estimated_age;
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <p className="font-semibold" style={{ color: NAVY }}>Prueba de vida</p>
                <StatusPill status={data?.decision ?? data?.status ?? raw?.summary?.liveness_status} />
            </div>
            <div className={`grid grid-cols-1 ${video ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-3`}>
                <ImageCard label="Selfie" url={selfie} onClick={onImageClick} />
                {video && <VideoCard label="Video de prueba de vida" url={video} onClick={onImageClick} />}
                <Card title="Detalles">
                    <KV label="Score"             value={typeof score === 'number' ? `${(score * (score <= 1 ? 100 : 1)).toFixed(1)}%` : fmt(score)} />
                    <KV label="Edad estimada"     value={fmt(ageEst)} />
                    <KV label="Método"            value={fmt(data?.method ?? data?.type)} />
                    <KV label="Detección spoof"   value={fmt(data?.spoof_detected)} />
                    <KV label="Calidad"           value={fmt(data?.quality)} />
                </Card>
            </div>
            <RawJsonDetails data={data ?? raw} />
        </div>
    );
};

const FaceMatchTab: React.FC<{ data: any; raw: any; onImageClick?: (url: string) => void }> = ({ data, raw, onImageClick }) => {
    // Antigravity contract: { score, decision }. La API cruda de Didit trae
    // además source_image (cara del documento) y target_image (selfie) que
    // mostramos lado a lado cuando existen.
    const score = data?.score ?? data?.confidence ?? data?.match_score ?? raw?.summary?.face_match_score;
    const sourceImg = data?.source_image ?? data?.source_image_url ?? null;
    const targetImg = data?.target_image ?? data?.target_image_url ?? null;
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <p className="font-semibold" style={{ color: NAVY }}>Coincidencia facial</p>
                <StatusPill status={data?.decision ?? data?.status ?? raw?.summary?.face_match_status} />
            </div>
            {(sourceImg || targetImg) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {sourceImg && <ImageCard label="Cara del documento" url={sourceImg} onClick={onImageClick} />}
                    {targetImg && <ImageCard label="Selfie comparada" url={targetImg} onClick={onImageClick} />}
                </div>
            )}
            <Card title="Comparación documento ↔ selfie">
                <KV label="Score de match" value={typeof score === 'number' ? `${(score * (score <= 1 ? 100 : 1)).toFixed(1)}%` : fmt(score)} />
                <KV label="Threshold"      value={fmt(data?.threshold)} />
                <KV label="Es la misma persona" value={fmt(data?.is_match ?? data?.matched)} />
            </Card>
            <RawJsonDetails data={data ?? raw} />
        </div>
    );
};

const AddressTab: React.FC<{ data: any; raw: any; onImageClick?: (url: string) => void }> = ({ data, raw, onImageClick }) => {
    // Antigravity contract (data = decision.poa_verification):
    //   • poa_formatted_address              → string completa
    //   • poa_parsed_address.{city,region,postal_code,country}
    //   • document_type / document_subtype   → "UTILITY_BILL" / "INTERNET_BILL"
    //   • issuer                              → "Movistar"
    //   • name_on_document                    → "BRYAN DAVID ORTIZ"
    //   • name_match_score_id_verification    → 95
    //   • document_file                       → URL del PDF/imagen del comprobante
    //
    // Mantenemos fallbacks a los nombres planos viejos por compat.
    // Rutas exactas del raw de Didit (poa_verifications[0]):
    //   document_type / issuer / poa_address / poa_formatted_address /
    //   poa_parsed_address.{city,country,postal_code}
    const parsed   = data?.poa_parsed_address ?? {};
    const proof    = data?.document_file ?? data?.proof_url ?? data?.utility_bill_url ?? data?.document_url
                  ?? data?.document_image ?? data?.file_url ?? data?.poa_document ?? data?.poa_file ?? null;
    const rawAddr  = data?.poa_address ?? data?.address ?? data?.street ?? null;
    const fmtAddr  = data?.poa_formatted_address ?? null;
    const matchScore = data?.name_match_score_id_verification;
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <p className="font-semibold" style={{ color: NAVY }}>Verificación de dirección</p>
                <StatusPill status={data?.decision ?? data?.status ?? raw?.summary?.address_verification_status} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <DocumentCard label="Comprobante de domicilio" url={proof} onImageClick={onImageClick} />
                <Card title="Dirección y documento">
                    <KV label="Dirección"           value={fmt(rawAddr ?? fmtAddr)} />
                    {fmtAddr && rawAddr && fmtAddr !== rawAddr && (
                        <KV label="Dirección formateada" value={fmt(fmtAddr)} />
                    )}
                    <KV label="Ciudad"              value={fmt(parsed.city ?? data?.city)} />
                    <KV label="Estado / región"     value={fmt(parsed.region ?? data?.state ?? data?.region)} />
                    <KV label="Código postal"       value={fmt(parsed.postal_code ?? data?.postal_code ?? data?.zip)} />
                    <KV label="País"                value={fmt(parsed.country ?? data?.country)} />
                    <KV label="Tipo de comprobante" value={fmt(data?.document_type)} />
                    <KV label="Subtipo"             value={fmt(data?.document_subtype)} />
                    <KV label="Emisor"              value={fmt(data?.issuer)} />
                    <KV label="Nombre en documento" value={fmt(data?.name_on_document)} />
                    <KV
                        label="Match con ID"
                        value={typeof matchScore === 'number' ? `${matchScore}%` : fmt(matchScore)}
                    />
                </Card>
            </div>
            <RawJsonDetails data={data ?? raw} />
        </div>
    );
};

const EmailTab: React.FC<{ data: any; raw: any; email?: string | null }> = ({ data, raw, email }) => {
    // Antigravity contract: { status, provider_check }. El raw de Didit
    // agrega breaches[] (estilo HIBP: title/breach_date/pwn_count/
    // description/data_classes) y opcionalmente un timeline de eventos.
    const pc = data?.provider_check ?? {};
    const breaches: any[] = Array.isArray(data?.breaches) ? data.breaches
        : Array.isArray(data?.breach_details) ? data.breach_details
        : Array.isArray(data?.email_breaches) ? data.email_breaches
        : Array.isArray(pc?.breaches) ? pc.breaches
        : [];
    const lifecycle: any[] = Array.isArray(data?.lifecycle) ? data.lifecycle
        : Array.isArray(data?.events) ? data.events
        : Array.isArray(data?.timeline) ? data.timeline
        : Array.isArray(data?.steps) ? data.steps
        : [];
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <p className="font-semibold" style={{ color: NAVY }}>Verificación de correo</p>
                <StatusPill status={data?.status ?? raw?.summary?.email_verification_status} />
            </div>
            <Card title="Correo verificado">
                <KV label="Correo"               value={fmt(data?.email ?? pc?.email ?? email)} />
                <KV label="Es desechable"        value={fmt(data?.is_disposable ?? pc?.is_disposable)} />
                <KV label="Comprometido (breach)" value={fmt(data?.is_compromised ?? pc?.is_compromised ?? data?.breach_detected ?? (breaches.length > 0))} />
                <KV label="Brechas encontradas"  value={String(breaches.length)} />
                <KV label="Dominio válido (MX)"  value={fmt(data?.mx_valid ?? pc?.mx_valid ?? data?.has_mx)} />
                <KV label="SMTP válido"          value={fmt(data?.smtp_valid ?? pc?.smtp_valid)} />
                <KV label="Edad del dominio"     value={fmt(data?.domain_age ?? pc?.domain_age)} />
            </Card>

            {/* Brechas de seguridad — mismo detalle que la consola de Didit:
                nombre, fecha, cuentas expuestas, descripción y clases de datos */}
            {breaches.length > 0 && (
                <div className="mt-3 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-700 flex items-center gap-1">
                        <AlertTriangle size={11} /> Brechas de seguridad donde apareció este correo
                    </p>
                    {breaches.map((b: any, i: number) => {
                        const title   = b.title ?? b.name ?? b.Name ?? `Brecha ${i + 1}`;
                        const date    = b.breach_date ?? b.BreachDate ?? b.date ?? null;
                        const count   = b.pwn_count ?? b.PwnCount ?? b.exposed_count ?? null;
                        const desc    = String(b.description ?? b.Description ?? '').replace(/<[^>]+>/g, '');
                        const classes: string[] = b.data_classes ?? b.DataClasses ?? b.classes ?? [];
                        return (
                            <div key={i} className="bg-red-50 border border-red-200 rounded-xl p-4">
                                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                                    <p className="text-sm font-bold" style={{ color: NAVY }}>{title}</p>
                                    <div className="flex items-center gap-3 text-[11px] text-red-800">
                                        {date  && <span>📅 {date}</span>}
                                        {count != null && <span>👥 {Number(count).toLocaleString('es-CO')} correos expuestos</span>}
                                    </div>
                                </div>
                                {desc && <p className="text-xs text-slate-700 leading-relaxed mb-2">{desc}</p>}
                                {classes.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {classes.map((c: string) => (
                                            <span key={c} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white border border-red-200 text-red-800">
                                                {c}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Ciclo de vida — timeline de eventos del OTP si el raw lo trae */}
            {lifecycle.length > 0 && (
                <div className="mt-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Ciclo de vida</p>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                        {lifecycle.map((ev: any, i: number) => {
                            const ts   = ev.timestamp ?? ev.created_at ?? ev.time ?? '';
                            const name = ev.name ?? ev.event ?? ev.title ?? ev.step ?? `Paso ${i + 1}`;
                            const st   = ev.status ?? ev.state ?? '';
                            const tsStr = ts ? new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
                            return (
                                <div key={i} className="flex items-center gap-3 text-xs">
                                    <span className="font-mono text-slate-400 w-16 shrink-0">{tsStr || '—'}</span>
                                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                                    <span className="font-semibold" style={{ color: NAVY }}>{fmt(name)}</span>
                                    {st && <span className="text-slate-500">{fmt(st)}</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <RawJsonDetails data={data ?? raw} />
        </div>
    );
};

// AmlTab — versión visual estilo Didit: status grande, badge persona/empresa,
// contador de coincidencias, monitoreo continuo, chips de listas chequeadas,
// datos examinados, lista de comprobaciones.
const AmlTab: React.FC<{ data: any; raw: any; entity: KycEntity }> = ({ data, raw, entity }) => {
    const sc = data?.sanctions_check ?? {};
    const sd = data?.screened_data ?? {};
    const status = data?.status ?? data?.decision ?? raw?.summary?.validation_status;
    const isApproved = String(status ?? '').toLowerCase().match(/approved|verified|passed|ok/);
    const totalMatches = data?.total_matches ?? sc?.total_matches ?? 0;
    const entityType = data?.entity_type ?? 'person';  // person / company
    const monitoring = data?.continuous_monitoring ?? data?.monitoring ?? false;
    // Listas chequeadas — chips. Si Antigravity manda data.lists_checked usamos eso.
    const lists: string[] = data?.lists_checked ?? data?.screening_lists ?? [
        'PEPs (niveles 1-4), SIPs y SIEs',
        'Sanciones y listas de vigilancia',
        'Acciones regulatorias y advertencias',
    ];
    // Datos examinados (lo que Didit usó para cruzar contra las listas)
    const examined = {
        full_name:       sd?.full_name      ?? entity.full_name,
        nationality:     sd?.nationality    ?? raw?.id_verification?.ocr_fields?.nationality ?? raw?.id_verification?.nationality ?? '—',
        date_of_birth:   sd?.date_of_birth  ?? raw?.id_verification?.ocr_fields?.date_of_birth ?? raw?.id_verification?.date_of_birth ?? '—',
        document_number: sd?.document_number ?? raw?.id_verification?.ocr_fields?.document_number ?? raw?.id_verification?.document_number ?? '—',
    };

    return (
        <div className="space-y-4">
            {/* Card principal estilo Didit */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                    <button className="flex items-center gap-2 text-sm font-semibold" style={{ color: NAVY }}>
                        <CheckCircle2 size={16} className={isApproved ? 'text-emerald-600' : 'text-amber-600'} />
                        DETECCIÓN AML
                    </button>
                    <StatusPill status={status} />
                </div>

                {/* Línea: tipo de entidad + contador + monitoreo */}
                <div className="flex items-center gap-4 flex-wrap mb-4 pb-4 border-b border-slate-100">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                        <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">👤</span>
                        {entityType === 'company' ? 'Empresa' : 'Persona'}
                    </span>
                    <span className="text-xs text-slate-700">
                        Coincidencias totales: <b className="text-slate-900">{totalMatches}</b>
                    </span>
                    <span className="text-xs text-slate-700 flex items-center gap-1.5 ml-auto">
                        <RefreshCw size={12} />
                        Monitoreo continuo
                        <span className={`inline-block w-8 h-4 rounded-full relative ${monitoring ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                            <span className={`absolute top-0.5 ${monitoring ? 'right-0.5' : 'left-0.5'} w-3 h-3 rounded-full bg-white`} />
                        </span>
                    </span>
                </div>

                {/* Banner de resultado */}
                <div className={`rounded-xl p-4 mb-4 ${isApproved ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                    <div className="flex items-start gap-2 mb-3">
                        <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${isApproved ? 'text-emerald-600' : 'text-amber-600'}`} />
                        <p className="text-sm font-semibold" style={{ color: isApproved ? '#065F46' : '#92400E' }}>
                            {totalMatches > 0 ? `${totalMatches} coincidencia(s) encontrada(s)` : 'No se encontraron resultados'}
                        </p>
                    </div>
                    <p className="text-xs text-slate-700 mb-2">Cribado realizado contra:</p>
                    <div className="flex items-center gap-2 flex-wrap">
                        {lists.map((l, i) => (
                            <span key={i} className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-[11px] text-slate-700 font-medium">
                                {l}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Datos examinados */}
                <Card title="Datos examinados">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
                        <KV label="Nombre completo"    value={fmt(examined.full_name)} />
                        <KV label="Nacionalidad"       value={fmt(examined.nationality)} />
                        <KV label="Fecha de nacimiento" value={fmt(examined.date_of_birth)} />
                        <KV label="Número de documento" value={fmt(examined.document_number)} mono />
                    </div>
                </Card>
            </div>

            {/* Lista de comprobaciones detalladas */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-sm" style={{ color: NAVY }}>
                        Lista de comprobaciones
                    </p>
                    <span className={`text-xs font-semibold ${isApproved ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {isApproved ? '(No se detectaron riesgos)' : '(Revisar)'}
                    </span>
                </div>
                <div className="space-y-1.5">
                    <KV label="Match en base de datos"               value={fmt(data?.db_match)} />
                    <KV label="PEP (persona expuesta políticamente)" value={fmt(sc?.pep_match ?? data?.pep_match ?? data?.is_pep)} />
                    <KV label="Lista de sanciones"                   value={fmt(sc?.sanctions_match ?? data?.sanctions_match ?? data?.is_sanctioned)} />
                    <KV label="Adverse media"                        value={fmt(sc?.adverse_media ?? data?.adverse_media ?? data?.is_adverse_media)} />
                    <KV label="Watchlist"                            value={fmt(sc?.watchlist_match ?? data?.watchlist_match)} />
                    <KV label="Score de riesgo"                      value={fmt(sc?.risk_score ?? data?.risk_score)} />
                    <KV label="Veredicto final"                      value={fmt(data?.verdict ?? raw?.summary?.status)} />
                </div>
                <RawJsonDetails data={data ?? raw} label="Ver JSON crudo de AML" />
            </div>
        </div>
    );
};

// DeviceIpTab — info de dispositivo, IP, ubicación geográfica + mapa.
// Usa OpenStreetMap embed (sin API key) si hay lat/lng.
const DeviceIpTab: React.FC<{ raw: any }> = ({ raw }) => {
    // Rutas exactas del raw de Didit: _raw.didit_decision.ip_analysis con
    //   ip_address / location.{latitude,longitude} / proxy / vpn / tor
    // Mantenemos el resto de claves legacy como fallback.
    const d = raw?._raw?.didit_decision?.ip_analysis
        ?? raw?.validations?.ip
        ?? raw?.device_and_ip ?? raw?.ip_analysis ?? raw?.device_analysis
        ?? raw?.device ?? raw?.ip ?? raw?._raw?.device_analysis ?? {};
    // En el raw real de Didit, `ip` es un OBJETO: { ip_address?, location:
    // {latitude, longitude}, distance_from_poa_document: {distance, direction} }
    // — no un string. Si lo tratamos como string, la fila IP muestra el JSON
    // entero y lat/lng quedan vacíos.
    const ipObj = (d?.ip && typeof d.ip === 'object') ? d.ip : null;
    const ip = d?.ip_address
        ?? ipObj?.ip_address ?? ipObj?.address
        ?? (typeof d?.ip === 'string' ? d.ip : null)
        ?? raw?.ip_address ?? '—';
    const location = ipObj?.location ?? d?.location ?? d?.geolocation ?? {};
    // Distancia entre la IP y el domicilio del comprobante (dato de riesgo útil)
    const poaDist = ipObj?.distance_from_poa_document ?? d?.distance_from_poa_document ?? null;
    // Number() por si Didit devuelve las coordenadas como string ("4.6097")
    const latRaw = location?.latitude  ?? location?.lat ?? d?.latitude  ?? d?.lat;
    const lngRaw = location?.longitude ?? location?.lng ?? d?.longitude ?? d?.lng;
    const lat = latRaw != null && latRaw !== '' ? Number(latRaw) : undefined;
    const lng = lngRaw != null && lngRaw !== '' ? Number(lngRaw) : undefined;
    const city    = location?.city    ?? d?.city    ?? '—';
    const region  = location?.region  ?? location?.state  ?? d?.region  ?? '—';
    const country = location?.country ?? location?.country_name ?? d?.country ?? '—';
    const isp     = d?.isp ?? d?.organization ?? d?.org ?? '—';
    const ua      = d?.user_agent ?? d?.userAgent ?? '—';
    const os      = d?.os ?? d?.operating_system ?? '—';
    const browser = d?.browser ?? '—';
    const isVpn   = d?.vpn   ?? d?.is_vpn   ?? d?.vpn_detected;
    const isProxy = d?.proxy ?? d?.is_proxy ?? d?.proxy_detected;
    const isTor   = d?.tor   ?? d?.is_tor   ?? d?.tor_detected;
    const status  = d?.status ?? d?.decision ?? raw?.summary?.device_analysis_status;
    const hasMap  = Number.isFinite(lat) && Number.isFinite(lng);
    // bbox para OpenStreetMap embed: rectángulo de ~0.04° alrededor del punto
    const bbox = hasMap ? `${lng - 0.04},${lat - 0.02},${lng + 0.04},${lat + 0.02}` : '';
    const osmUrl = hasMap
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
        : '';

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                    <p className="font-semibold text-sm flex items-center gap-2" style={{ color: NAVY }}>
                        <MapPin size={14} />
                        ANÁLISIS DE DISPOSITIVO E IP
                    </p>
                    <StatusPill status={status} />
                </div>

                {hasMap ? (
                    <iframe
                        title="Mapa de ubicación IP"
                        src={osmUrl}
                        className="w-full h-72 rounded-xl border border-slate-200 mb-4"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-72 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400 mb-4">
                        Sin coordenadas de ubicación disponibles
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Card title="IP y ubicación">
                        <KV label="IP"             value={fmt(ip)} mono />
                        <KV label="Ciudad"         value={fmt(city)} />
                        <KV label="Región"         value={fmt(region)} />
                        <KV label="País"           value={fmt(country)} />
                        <KV label="ISP / Proveedor" value={fmt(isp)} />
                        <KV label="Latitud"        value={hasMap ? String(lat) : '—'} mono />
                        <KV label="Longitud"       value={hasMap ? String(lng) : '—'} mono />
                        {poaDist?.distance != null && (
                            <KV
                                label="Distancia al domicilio"
                                value={`${poaDist.distance} km ${poaDist.direction ?? ''}`.trim()}
                            />
                        )}
                    </Card>
                    <Card title="Dispositivo y riesgo">
                        <KV label="Sistema operativo" value={fmt(os)} />
                        <KV label="Navegador"         value={fmt(browser)} />
                        <KV label="User agent"        value={fmt(ua)} />
                        <KV label="VPN detectado"     value={fmt(isVpn)} />
                        <KV label="Proxy detectado"   value={fmt(isProxy)} />
                        <KV label="TOR detectado"     value={fmt(isTor)} />
                    </Card>
                </div>

                <RawJsonDetails data={d} label="Ver JSON crudo de dispositivo/IP" />
            </div>
        </div>
    );
};
