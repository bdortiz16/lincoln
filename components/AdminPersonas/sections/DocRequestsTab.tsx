import React, { useEffect, useMemo, useState } from 'react';
import {
    FileSearch, Plus, RefreshCw, Search, X, CheckCircle2, XCircle,
    AlertTriangle, ChevronRight, Clock, Paperclip, Gauge, FileWarning,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { SectionHeader, NAVY, formatDate, EmptyState } from './shared';
import { UserLimitsCard } from './UserLimitsCard';
import { BlockUserModal, type BlockPayload } from './BlockUserModal';

// ─────────────────────────────────────────────
// Documentación — el oficial de compliance solicita información o
// archivos al usuario por un movimiento sospechoso o por requerimiento
// normativo. El usuario responde desde la app con texto y/o adjuntos;
// el oficial aprueba, rechaza o escala.
//
// Schema esperado (a crear por Antigravity — ver banner de setup):
//   public.document_requests (
//     id uuid pk, user_id uuid, transaction_id uuid null,
//     category text, title text, description text,
//     status text default 'pending'
//       check (status in ('pending','submitted','approved','rejected','escalated','canceled')),
//     due_date date, requested_by uuid, requested_at timestamptz default now(),
//     reviewed_by uuid null, reviewed_at timestamptz null, review_notes text null,
//     user_response text null, responded_at timestamptz null,
//     attachments jsonb default '[]'::jsonb
//   )
//
// Si la tabla todavía no existe, mostramos un banner con el SQL para
// que el admin se lo pase a Antigravity, en vez de tirar un error.
// ─────────────────────────────────────────────

interface DocRequest {
    id: string;
    user_id: string;
    transaction_id: string | null;
    // La categoría es "de solicitud" (source_of_funds, block_unlock, etc.)
    // O un slug de documento individual (cedula_front, selfie, etc.) cuando la
    // fila fue insertada por la app mobile — 1 fila por archivo subido.
    category: string;
    title: string;
    description: string;
    status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'escalated' | 'canceled';
    due_date: string | null;
    requested_by: string;
    requested_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
    user_response: string | null;
    responded_at: string | null;
    attachments: any[] | null;
    // URL pública del archivo subido por el mobile a bucket doc_requests/
    // Puede venir null si la fila fue creada por el admin (bloqueo de compliance)
    // o si es una request "clásica" con varios attachments.
    file_url: string | null;
    user?: { id: string; email: string; full_name: string | null; cuypay_id: string | null } | null;
    // 'lir' = fila mapeada desde limit_increase_requests (tabla dedicada que
    // usa la app mobile para ampliación de topes). Cambia a qué tabla van los
    // updates de aprobar/rechazar.
    _source?: 'doc' | 'lir';
    // Solo filas 'lir': si el aumento es para un CONTACTO de la libreta
    // (no para el usuario), viene el id + nombre del beneficiario. El trigger
    // apply_limit_increase aplica los topes en beneficiaries en ese caso.
    beneficiary_id?: string | null;
    beneficiary_name?: string | null;
}

// Slugs de documentos que el mobile mete como `category`. Los mismos que
// están en DOC_SLUG_LABELS. Cuando category matchea uno de estos, sabemos
// que la fila es de tipo "un archivo por documento" y renderizamos preview.
const DOC_SLUG_SET = new Set<string>([
    'cedula_front','cedula_back','selfie','proof_address','proof_income',
    'bank_statement','source_of_funds','tax_return',
]);
const isDocSlug = (cat: string): boolean => DOC_SLUG_SET.has(cat);

const CATEGORY_LABELS: Record<string, string> = {
    source_of_funds:     'Origen de fondos',
    transaction_purpose: 'Propósito de la TX',
    beneficiary_id:      'ID del beneficiario',
    employment:          'Empleo / ingresos',
    address:             'Comprobante de domicilio',
    limit_increase:      'Ampliación de topes',   // iniciada por el user desde la app
    block_unlock:        'Levantamiento de bloqueo', // creada al bloquear con docs requeridos
    other:               'Otro',
    // Slugs de docs individuales (mobile uploads)
    cedula_front:    'Cédula / ID (frente)',
    cedula_back:     'Cédula / ID (dorso)',
    selfie:          'Selfie con documento',
    proof_address:   'Comprobante de dirección',
    proof_income:    'Comprobante de ingresos',
    bank_statement:  'Extracto bancario',
    tax_return:      'Declaración de impuestos',
};

// Etiquetas legibles de los slugs de required_documents que guarda BlockUserModal
// (mismos values que REQUIRED_DOCS en BlockUserModal.tsx). Se usan para renderizar
// el checklist en el ReviewModal cuando la request es de category='block_unlock'.
const DOC_SLUG_LABELS: Record<string, string> = {
    cedula_front:    'Cédula / ID (frente)',
    cedula_back:     'Cédula / ID (dorso)',
    selfie:          'Selfie con documento',
    proof_address:   'Comprobante de dirección',
    proof_income:    'Comprobante de ingresos',
    bank_statement:  'Extracto bancario',
    source_of_funds: 'Declaración de origen de fondos',
    tax_return:      'Declaración de impuestos',
};

const STATUS_LABELS: Record<DocRequest['status'], { label: string; bg: string; text: string }> = {
    pending:   { label: 'Pendiente',  bg: '#FEF3C7', text: '#92400E' },
    submitted: { label: 'Respondida', bg: '#DBEAFE', text: '#1E40AF' },
    approved:  { label: 'Aprobada',   bg: '#D1FAE5', text: '#065F46' },
    rejected:  { label: 'Rechazada',  bg: '#FEE2E2', text: '#991B1B' },
    escalated: { label: 'Escalada',   bg: '#FED7AA', text: '#9A3412' },
    canceled:  { label: 'Cancelada',  bg: '#F1F5F9', text: '#475569' },
};

const SETUP_SQL = `-- ───────────────────────────────────────────────────────
-- Tabla para que Compliance solicite documentación a usuarios
-- ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  transaction_id  uuid NULL REFERENCES public.transactions(id) ON DELETE SET NULL,
  category        text NOT NULL CHECK (category IN
                    ('source_of_funds','transaction_purpose','beneficiary_id',
                     'employment','address','other')),
  title           text NOT NULL,
  description     text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN
                    ('pending','submitted','approved','rejected','escalated','canceled')),
  due_date        date,
  requested_by    uuid NOT NULL REFERENCES public.users(id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid REFERENCES public.users(id),
  reviewed_at     timestamptz,
  review_notes    text,
  user_response   text,
  responded_at    timestamptz,
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS document_requests_user_id_idx ON public.document_requests(user_id);
CREATE INDEX IF NOT EXISTS document_requests_status_idx  ON public.document_requests(status);
CREATE INDEX IF NOT EXISTS document_requests_tx_idx      ON public.document_requests(transaction_id);

ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

-- Admins de compliance/super_admin pueden todo
CREATE POLICY doc_req_admin_all ON public.document_requests
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.admin_role IN ('super_admin','compliance'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.admin_role IN ('super_admin','compliance'))
  );

-- Usuario solo ve y responde sus propias solicitudes
CREATE POLICY doc_req_user_read ON public.document_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY doc_req_user_respond ON public.document_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid()
              AND status = 'submitted'   -- solo puede pasar a "respondida"
              AND user_response IS NOT NULL);

-- Storage bucket para que el usuario adjunte archivos
INSERT INTO storage.buckets (id, name, public)
VALUES ('doc_requests', 'doc_requests', false)
ON CONFLICT (id) DO NOTHING;`;

interface Props {
    profile: AdminProfile;
}

export const DocRequestsTab: React.FC<Props> = ({ profile }) => {
    const [rows, setRows] = useState<DocRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'open' | 'pending' | 'submitted' | 'approved' | 'rejected'>('open');
    const [search, setSearch] = useState('');
    const [showCreate, setShowCreate] = useState<{ userId?: string; category?: DocRequest['category'] } | false>(false);
    const [reviewing, setReviewing] = useState<DocRequest | null>(null);
    // Bloqueo permanente lanzado desde el ReviewModal cuando los docs no cumplen.
    // Guardamos { userId, requestId, userLabel } para poder cerrar la doc request
    // como 'rejected' después de que el admin confirma el permanente.
    const [permBlockFor, setPermBlockFor] = useState<{
        userId: string;
        requestId: string;
        userLabel: string;
    } | null>(null);
    const [permSaving, setPermSaving] = useState(false);

    // Solicitudes de ampliación de topes de la app mobile — viven en su
    // propia tabla limit_increase_requests (id, user_id, status
    // pending/approved/rejected, requested_amount, user_response,
    // attachments jsonb, admin_notes, reviewed_at, created_at). Las
    // mapeamos al shape de DocRequest para listarlas junto al resto.
    const fetchLimitIncreaseRows = async (): Promise<DocRequest[]> => {
        try {
            // beneficiary_id / requested_daily_amount pueden no existir aún
            // (migración pendiente) → retry sin ellas
            let { data: lir, error: lerr } = await supabasePersonas
                .from('limit_increase_requests')
                .select('id, user_id, beneficiary_id, status, requested_amount, requested_daily_amount, user_response, attachments, admin_notes, reviewed_at, created_at')
                .order('created_at', { ascending: false })
                .limit(200);
            if (lerr && /beneficiary_id|requested_daily_amount/i.test(lerr.message)) {
                ({ data: lir, error: lerr } = await supabasePersonas
                    .from('limit_increase_requests')
                    .select('id, user_id, status, requested_amount, user_response, attachments, admin_notes, reviewed_at, created_at')
                    .order('created_at', { ascending: false })
                    .limit(200));
            }
            if (lerr || !lir) return [];
            // Hidratar nombre/email de los dueños (sin depender de FK embed)
            const ids = Array.from(new Set((lir as any[]).map(r => r.user_id).filter(Boolean)));
            const usersById: Record<string, any> = {};
            if (ids.length > 0) {
                const { data: us } = await supabasePersonas
                    .from('users')
                    .select('id, email, full_name, cuypay_id')
                    .in('id', ids);
                for (const u of (us ?? []) as any[]) usersById[u.id] = u;
            }
            // Hidratar nombres de contactos cuando el aumento es por beneficiario
            const benIds = Array.from(new Set((lir as any[]).map(r => r.beneficiary_id).filter(Boolean)));
            const bensById: Record<string, any> = {};
            if (benIds.length > 0) {
                const { data: bs } = await supabasePersonas
                    .from('beneficiaries')
                    .select('*')
                    .in('id', benIds);
                for (const b of (bs ?? []) as any[]) bensById[b.id] = b;
            }
            const benNameOf = (id: string | null | undefined): string | null => {
                if (!id) return null;
                const b = bensById[id];
                return b?.full_name ?? b?.name ?? b?.alias ?? b?.nickname ?? b?.email ?? null;
            };
            return (lir as any[]).map(r => {
                const amt = r.requested_amount != null
                    ? `${Number(r.requested_amount).toLocaleString('es-CO')} USD`
                    : null;
                const dailyAmt = r.requested_daily_amount != null && String(r.requested_daily_amount).trim() !== ''
                    ? `${Number(r.requested_daily_amount).toLocaleString('es-CO')} USD`
                    : null;
                const amountsTx = [
                    amt ? `Mensual solicitado: ${amt}.` : '',
                    dailyAmt ? ` Diario solicitado: ${dailyAmt}.` : '',
                ].join('');
                const benName = benNameOf(r.beneficiary_id);
                const benLabel = r.beneficiary_id ? ` — Contacto ${benName ?? String(r.beneficiary_id).slice(0, 8)}` : '';
                return {
                    id:             r.id,
                    user_id:        r.user_id,
                    transaction_id: null,
                    category:       'limit_increase',
                    title:          `Ampliación de topes${benLabel}${amt ? ` — ${amt}` : ''}${dailyAmt ? ` (diario ${dailyAmt})` : ''}`,
                    description:    r.beneficiary_id
                        ? `Solicitud de aumento para el Contacto ${benName ?? String(r.beneficiary_id).slice(0, 8)}. ${amountsTx} Al aprobar, los topes se aplican al CONTACTO (no al usuario).`
                        : `El usuario solicita aumentar sus topes de operación. ${amountsTx}`,
                    // su 'pending' = esperando revisión del admin con docs ya
                    // adjuntos → equivale a nuestro 'submitted' (cuenta como Abierta)
                    status:         (r.status === 'pending' ? 'submitted' : r.status) as DocRequest['status'],
                    due_date:       null,
                    requested_by:   r.user_id,
                    requested_at:   r.created_at,
                    reviewed_by:    null,
                    reviewed_at:    r.reviewed_at,
                    review_notes:   r.admin_notes,
                    user_response:  r.user_response,
                    responded_at:   r.created_at,
                    attachments:    Array.isArray(r.attachments) ? r.attachments : [],
                    file_url:       null,
                    user:           usersById[r.user_id] ?? null,
                    _source:        'lir',
                    beneficiary_id:   r.beneficiary_id ?? null,
                    beneficiary_name: benName,
                } as DocRequest;
            });
        } catch {
            return [];   // tabla inexistente u otro error — no rompemos el tab
        }
    };

    // Merge de ambas fuentes ordenado por fecha desc.
    const mergeAndSet = async (docRows: DocRequest[]) => {
        const lirRows = await fetchLimitIncreaseRows();
        const all = [...docRows.map(d => ({ ...d, _source: d._source ?? 'doc' as const })), ...lirRows]
            .sort((a, b) => String(b.requested_at ?? '').localeCompare(String(a.requested_at ?? '')));
        setRows(all);
    };

    const load = async () => {
        setLoading(true);
        setError(null);
        setNeedsSetup(false);
        const { data, error: err } = await supabasePersonas
            .from('document_requests')
            .select(`
                id, user_id, transaction_id, category, title, description, status,
                due_date, requested_by, requested_at, reviewed_by, reviewed_at,
                review_notes, user_response, responded_at, attachments, file_url,
                user:users!document_requests_user_id_fkey ( id, email, full_name, cuypay_id )
            `)
            .order('requested_at', { ascending: false })
            .limit(500);
        if (err) {
            // Si la tabla no existe, mostramos el banner de setup en vez de un toast feo.
            // PostgreSQL directo tira '42P01: relation ... does not exist'.
            // PostgREST (Supabase) lo traduce a "Could not find the table ... in the schema cache"
            // con código 'PGRST205' o similar — ambos significan lo mismo desde el front.
            const tableMissing =
                /relation .* does not exist/i.test(err.message) ||
                /Could not find the table/i.test(err.message) ||
                /schema cache/i.test(err.message) ||
                err.code === '42P01' ||
                err.code === 'PGRST205';
            if (tableMissing) {
                setNeedsSetup(true);
                setLoading(false);
                return;
            }
            // Si falla por la FK aliasada (PostgREST no encuentra el constraint),
            // reintentamos sin el embed.
            if (/Could not find a relationship|PGRST200/i.test(err.message)) {
                const r = await supabasePersonas
                    .from('document_requests')
                    .select('id, user_id, transaction_id, category, title, description, status, due_date, requested_by, requested_at, reviewed_by, reviewed_at, review_notes, user_response, responded_at, attachments, file_url')
                    .order('requested_at', { ascending: false })
                    .limit(500);
                if (r.error) {
                    setError(r.error.message);
                    setLoading(false);
                    return;
                }
                await mergeAndSet((r.data ?? []) as DocRequest[]);
                setLoading(false);
                return;
            }
            setError(err.message);
            setLoading(false);
            return;
        }
        await mergeAndSet((data ?? []) as unknown as DocRequest[]);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const counts = useMemo(() => {
        const c = { all: rows.length, open: 0, pending: 0, submitted: 0, approved: 0, rejected: 0 };
        for (const r of rows) {
            if (r.status === 'pending')   { c.pending++; c.open++; }
            if (r.status === 'submitted') { c.submitted++; c.open++; }
            if (r.status === 'approved')  c.approved++;
            if (r.status === 'rejected')  c.rejected++;
        }
        return c;
    }, [rows]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter(r => {
            if (filter === 'open' && (r.status !== 'pending' && r.status !== 'submitted')) return false;
            if (filter !== 'all' && filter !== 'open' && r.status !== filter) return false;
            if (q) {
                const hay = [r.title, r.description, r.user?.email, r.user?.full_name, r.user?.cuypay_id, r.transaction_id]
                    .filter(Boolean).map(x => String(x).toLowerCase());
                if (!hay.some(h => h.includes(q))) return false;
            }
            return true;
        });
    }, [rows, filter, search]);

    if (needsSetup) {
        return <SetupBanner sql={SETUP_SQL} onRetry={load} />;
    }

    return (
        <div className="space-y-4">
            <SectionHeader
                title="Documentación"
                subtitle="Solicitar info o archivos al usuario por movimientos sospechosos o requerimientos normativos"
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
                            onClick={() => setShowCreate({})}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg text-white"
                            style={{ backgroundColor: NAVY }}
                        >
                            <Plus size={14} />
                            Nueva solicitud
                        </button>
                    </div>
                }
            />

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
                    {error}
                </div>
            )}

            {/* Counters */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <CounterChip label="Abiertas" value={counts.open} active={filter === 'open'} onClick={() => setFilter('open')} color="#0C0E0D" bg="#F1F5F9" />
                <CounterChip label="Pendientes" value={counts.pending} active={filter === 'pending'} onClick={() => setFilter('pending')} color="#92400E" bg="#FEF3C7" />
                <CounterChip label="Respondidas" value={counts.submitted} active={filter === 'submitted'} onClick={() => setFilter('submitted')} color="#1E40AF" bg="#DBEAFE" />
                <CounterChip label="Aprobadas" value={counts.approved} active={filter === 'approved'} onClick={() => setFilter('approved')} color="#065F46" bg="#D1FAE5" />
                <CounterChip label="Rechazadas" value={counts.rejected} active={filter === 'rejected'} onClick={() => setFilter('rejected')} color="#991B1B" bg="#FEE2E2" />
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                    placeholder="Buscar por usuario, título, TX ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 focus:border-green-500 outline-none text-sm"
                />
            </div>

            {/* Lista */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-slate-400 text-sm">Cargando…</div>
                ) : filtered.length === 0 ? (
                    <EmptyState icon={FileSearch} title="Sin solicitudes" message="No hay solicitudes en este filtro. Creá una nueva con el botón arriba." />
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {filtered.map(r => {
                            // Etiqueta amistosa: si es un slug de doc mobile,
                            // usamos el label del checklist. Si es una categoría
                            // clásica, usamos su label. Si nada matchea, mostramos
                            // la key cruda (defensivo).
                            const catLabel = CATEGORY_LABELS[r.category] ?? r.category;
                            const isMobileDoc = isDocSlug(r.category);
                            return (
                                <li key={r.id}>
                                    <button
                                        onClick={() => setReviewing(r)}
                                        className="w-full text-left p-4 hover:bg-slate-50 flex items-center gap-3"
                                    >
                                        {/* Thumbnail si la fila trae file_url (subido por mobile).
                                            Si no, círculo con inicial del usuario. */}
                                        {r.file_url ? (
                                            <img
                                                src={r.file_url}
                                                alt={catLabel}
                                                className="shrink-0 w-12 h-12 rounded-lg object-cover border border-slate-200 bg-slate-100"
                                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        ) : (
                                            <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm" style={{ backgroundColor: '#F1F5F9', color: NAVY }}>
                                                {(r.user?.full_name?.[0] ?? r.user?.email?.[0] ?? '?').toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-semibold text-sm" style={{ color: NAVY }}>
                                                    {isMobileDoc ? catLabel : r.title}
                                                </p>
                                                <StatusPill status={r.status} />
                                                {!isMobileDoc && (
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                        {catLabel}
                                                    </span>
                                                )}
                                                {isMobileDoc && (
                                                    <span className="text-[10px] uppercase tracking-wider text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                                                        subido desde app
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 truncate mt-0.5">
                                                {r.user?.full_name ?? r.user?.email ?? r.user_id.slice(0, 8)} ·{' '}
                                                {formatDate(r.requested_at)}
                                                {r.transaction_id && <> · TX <span className="font-mono">{r.transaction_id.slice(0, 8)}…</span></>}
                                                {r.due_date && <> · vence <b>{r.due_date}</b></>}
                                            </p>
                                        </div>
                                        {((r.attachments?.length ?? 0) > 0 || r.file_url) && (
                                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                                <Paperclip size={10} /> {(r.attachments?.length ?? 0) + (r.file_url ? 1 : 0)}
                                            </span>
                                        )}
                                        <ChevronRight size={16} className="text-slate-300 shrink-0" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {showCreate !== false && (
                <CreateRequestModal
                    prefillUserId={showCreate.userId}
                    prefillCategory={showCreate.category}
                    profile={profile}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); load(); }}
                />
            )}
            {reviewing && (
                <ReviewModal
                    profile={profile}
                    request={reviewing}
                    onClose={() => setReviewing(null)}
                    onUpdated={() => { setReviewing(null); load(); }}
                    onRequestMore={(userId) => {
                        // Cerramos la review actual y abrimos el modal de crear
                        // pre-cargado con el mismo user + categoría de bloqueo,
                        // así el admin pide otra documentación extra sin
                        // aprobar la actual.
                        setReviewing(null);
                        setShowCreate({ userId, category: 'block_unlock' });
                    }}
                    onPermanentBlock={(userId) => {
                        // Escalada a bloqueo permanente: docs enviados no
                        // justifican los movimientos. Cerramos el review y
                        // abrimos BlockUserModal en modo 'permanent'.
                        const label = reviewing.user?.full_name
                            ? `${reviewing.user.full_name} (${reviewing.user.email})`
                            : (reviewing.user?.email ?? userId);
                        setReviewing(null);
                        setPermBlockFor({ userId, requestId: reviewing.id, userLabel: label });
                    }}
                />
            )}

            {permBlockFor && (
                <BlockUserModal
                    userLabel={permBlockFor.userLabel}
                    initialType="permanent"
                    saving={permSaving}
                    onCancel={() => setPermBlockFor(null)}
                    onConfirm={async (payload: BlockPayload) => {
                        setPermSaving(true);
                        // 1) Marcar la doc request original como 'rejected'
                        //    con nota explicativa.
                        await supabasePersonas
                            .from('document_requests')
                            .update({
                                status:       'rejected',
                                review_notes: `Bloqueo permanente aplicado — ${payload.customInfo ?? payload.notes ?? payload.reason}`,
                                reviewed_by:  profile.id,
                                reviewed_at:  new Date().toISOString(),
                            })
                            .eq('id', permBlockFor.requestId);
                        // 2) Aplicar el bloqueo permanente en users. Fallback
                        //    progresivo si alguna col no existe.
                        const combinedNotes = payload.customInfo && payload.notes
                            ? `[PERMANENTE — info requerida] ${payload.customInfo}\n\n${payload.notes}`
                            : payload.customInfo
                                ? `[PERMANENTE — info requerida] ${payload.customInfo}`
                                : payload.notes;
                        const patch: Record<string, any> = {
                            is_active:          false,
                            is_blocked:         true,
                            blocked_reason:     payload.reason,
                            blocked_at:         new Date().toISOString(),
                            block_type:         'permanent',
                            block_reason:       payload.reason,
                            block_notes:        combinedNotes,
                            required_documents: [],
                            kyc_status:         'rejected',
                        };
                        let { error: uerr } = await supabasePersonas
                            .from('users')
                            .update(patch)
                            .eq('id', permBlockFor.userId);
                        if (uerr && /column/i.test(uerr.message)) {
                            const minimal = { is_active: false, is_blocked: true, kyc_status: 'rejected' };
                            await supabasePersonas.from('users').update(minimal).eq('id', permBlockFor.userId);
                        }
                        // 3) Audit
                        await logAdminAction({
                            admin: profile,
                            action: 'user_block.permanent',
                            targetType: 'user',
                            targetId: permBlockFor.userId,
                            metadata: {
                                reason:     payload.reason,
                                notes:      payload.notes,
                                customInfo: payload.customInfo,
                                origin_document_request_id: permBlockFor.requestId,
                            },
                        });
                        setPermSaving(false);
                        setPermBlockFor(null);
                        load();
                    }}
                />
            )}
        </div>
    );
};

const CounterChip: React.FC<{ label: string; value: number; active: boolean; onClick: () => void; color: string; bg: string }> =
    ({ label, value, active, onClick, color, bg }) => (
        <button
            onClick={onClick}
            className="rounded-xl p-3 text-left transition-all"
            style={{
                backgroundColor: bg,
                boxShadow: active ? `inset 0 0 0 2px ${color}` : undefined,
            }}
        >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color, opacity: 0.7 }}>{label}</p>
            <p className="text-xl font-bold mt-0.5" style={{ color }}>{value}</p>
        </button>
    );

const StatusPill: React.FC<{ status: DocRequest['status'] }> = ({ status }) => {
    const s = STATUS_LABELS[status];
    return (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.text }}>
            {s.label}
        </span>
    );
};

const SetupBanner: React.FC<{ sql: string; onRetry: () => void }> = ({ sql, onRetry }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(sql);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };
    return (
        <div className="space-y-3">
            <SectionHeader
                title="Documentación"
                subtitle="Solicitar info o archivos al usuario por movimientos sospechosos"
            />
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-amber-900">Tabla todavía no creada</p>
                        <p className="text-xs text-amber-800 mt-1">
                            Pasale el SQL de abajo a Antigravity (o ejecutalo vos en el SQL Editor de Supabase Personas).
                            Una vez aplicado, dale "Reintentar" y la sección queda lista para usar.
                        </p>
                    </div>
                </div>
            </div>
            <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">SQL para aplicar</p>
                    <div className="flex gap-2">
                        <button
                            onClick={copy}
                            className="text-[11px] text-green-300 hover:text-green-200 font-semibold"
                        >
                            {copied ? '✓ Copiado' : 'Copiar'}
                        </button>
                        <button
                            onClick={onRetry}
                            className="text-[11px] text-slate-300 hover:text-white font-semibold"
                        >
                            Reintentar
                        </button>
                    </div>
                </div>
                <pre className="text-[11px] text-slate-200 font-mono whitespace-pre-wrap">{sql}</pre>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// CreateRequestModal — Compliance arma una nueva solicitud
// ─────────────────────────────────────────────
const CreateRequestModal: React.FC<{
    profile: AdminProfile;
    onClose: () => void;
    onCreated: () => void;
    /** Cuando se abre desde "Solicitar otra documentación", pre-seleccionamos
     *  al mismo user + categoría block_unlock para que el admin solo llene
     *  título/descripción con lo nuevo que necesita. */
    prefillUserId?: string;
    prefillCategory?: DocRequest['category'];
}> = ({ profile, onClose, onCreated, prefillUserId, prefillCategory }) => {
    const [userQuery, setUserQuery]   = useState('');
    const [userResults, setUserResults] = useState<{ id: string; email: string; full_name: string | null; cuypay_id: string | null }[]>([]);
    const [searching, setSearching]   = useState(false);
    const [picked, setPicked]         = useState<{ id: string; email: string; full_name: string | null } | null>(null);
    const [txId, setTxId]             = useState('');
    // Movimientos recientes del user elegido — para elegir la TX de un
    // dropdown en vez de tipear el UUID a mano (que rompía con
    // 'invalid input syntax for type uuid' si pegabas texto).
    const [userTxs, setUserTxs]       = useState<Array<{ id: string; kind: string | null; amount: number | null; currency: string | null; status: string | null; created_at: string }>>([]);
    const [loadingTxs, setLoadingTxs] = useState(false);
    const [txsFailed, setTxsFailed]   = useState(false);
    // Combobox de TX: texto de búsqueda + dropdown abierto
    const [txQuery, setTxQuery]       = useState('');
    const [txOpen, setTxOpen]         = useState(false);
    const [category, setCategory]     = useState<DocRequest['category']>(prefillCategory ?? 'source_of_funds');
    const [title, setTitle]           = useState('');
    const [description, setDescription] = useState('');
    const [dueDate, setDueDate]       = useState('');
    const [saving, setSaving]         = useState(false);
    const [error, setError]           = useState<string | null>(null);

    // Si vino prefillUserId, hidratamos el picked al montar buscando el user
    // por id así el modal muestra la card "Seleccionado" directo sin obligar
    // a re-buscar por nombre.
    useEffect(() => {
        if (!prefillUserId || picked) return;
        (async () => {
            const { data } = await supabasePersonas
                .from('users')
                .select('id, email, full_name, cuypay_id')
                .eq('id', prefillUserId)
                .maybeSingle();
            if (data) setPicked(data as any);
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefillUserId]);

    // Al elegir usuario, traemos sus últimos movimientos para el dropdown
    // de TX. Si la query falla (RLS / columna distinta), caemos al input
    // manual con validación de UUID.
    useEffect(() => {
        if (!picked) { setUserTxs([]); setTxId(''); return; }
        let cancelled = false;
        (async () => {
            setLoadingTxs(true); setTxsFailed(false); setTxId('');

            // Camino preferido: RPC admin_list_user_transactions (SECURITY
            // DEFINER — esquiva la RLS de transactions y el nombre de columna).
            const rpc = await supabasePersonas.rpc('admin_list_user_transactions', { p_user_id: picked.id, p_limit: 30 });
            if (cancelled) return;
            if (!rpc.error && (rpc.data as any)?.ok) {
                setUserTxs(((rpc.data as any).transactions as any[]) ?? []);
                setLoadingTxs(false);
                return;
            }

            // Fallback: SELECT directo. El nombre de la columna que apunta al
            // dueño de la TX varía según el deploy del schema (user_id /
            // owner_user_id / sender_id...). Probamos en orden y cacheamos la
            // que funcione para no re-probar en cada apertura del modal.
            const CANDIDATES = ['user_id', 'owner_user_id', 'sender_id', 'from_user_id'];
            const CACHE_KEY = 'cuypay.admin.tx_owner_col';
            const cached = localStorage.getItem(CACHE_KEY);
            const order = cached ? [cached, ...CANDIDATES.filter(c => c !== cached)] : CANDIDATES;

            let rows: any[] | null = null;
            for (const col of order) {
                const { data, error: txErr } = await supabasePersonas
                    .from('transactions')
                    .select('id, kind, amount, currency, status, created_at')
                    .eq(col, picked.id)
                    .order('created_at', { ascending: false })
                    .limit(30);
                if (cancelled) return;
                if (!txErr) {
                    rows = (data as any[]) ?? [];
                    localStorage.setItem(CACHE_KEY, col);
                    break;
                }
                // Solo seguimos probando si el error es de columna inexistente;
                // otros errores (RLS, red) cortan el loop.
                if (!/column|does not exist|schema cache/i.test(txErr.message)) break;
            }
            if (cancelled) return;
            if (rows === null) { setTxsFailed(true); setUserTxs([]); }
            else { setUserTxs(rows); }
            setLoadingTxs(false);
        })();
        return () => { cancelled = true; };
    }, [picked]);

    // Solo mostramos usuarios con KYC verificado — no tiene sentido
    // pedir documentación a quien todavía no completó KYC (de hecho la
    // solicitud está pensada justamente para usuarios ya verificados
    // que hacen movimientos sospechosos o requerimientos normativos).
    const VERIFIED_STATUSES = ['verified', 'approved', 'completed'];

    // Carga inicial: al abrir el modal traemos los 20 verificados más
    // recientes así el admin tiene una lista para elegir sin tener
    // que escribir nada.
    useEffect(() => {
        if (picked) return;
        let cancelled = false;
        (async () => {
            setSearching(true);
            const { data } = await supabasePersonas
                .from('users')
                .select('id, email, full_name, cuypay_id, created_at')
                .in('kyc_status', VERIFIED_STATUSES)
                .order('created_at', { ascending: false })
                .limit(20);
            if (!cancelled) {
                setUserResults((data as any) ?? []);
                setSearching(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Búsqueda debounceada cuando el admin escribe.
    // Filtramos server-side por email / nombre / Lincoin ID,
    // siempre limitado a usuarios verificados.
    useEffect(() => {
        if (picked) return;
        const q = userQuery.trim();
        const t = setTimeout(async () => {
            setSearching(true);
            let query = supabasePersonas
                .from('users')
                .select('id, email, full_name, cuypay_id, created_at')
                .in('kyc_status', VERIFIED_STATUSES)
                .order('created_at', { ascending: false })
                .limit(20);
            if (q.length >= 1) {
                query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%,cuypay_id.ilike.%${q}%`);
            }
            const { data } = await query;
            setUserResults((data as any) ?? []);
            setSearching(false);
        }, 250);
        return () => clearTimeout(t);
    }, [userQuery, picked]);

    const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const submit = async () => {
        if (!picked) { setError('Elegí un usuario'); return; }
        if (!title.trim() || !description.trim()) { setError('Título y descripción son obligatorios'); return; }
        // Validación amigable del TX ID — evita el 'invalid input syntax
        // for type uuid' de Postgres cuando se pega texto libre.
        if (txId.trim() && !UUID_RX.test(txId.trim())) {
            setError('El TX ID no es un UUID válido. Elegí la transacción del selector o dejá el campo vacío.');
            return;
        }
        setSaving(true);
        setError(null);
        const { error: err, data } = await supabasePersonas.from('document_requests').insert({
            user_id:        picked.id,
            transaction_id: txId.trim() || null,
            category,
            title:          title.trim(),
            description:    description.trim(),
            due_date:       dueDate || null,
            requested_by:   profile.id,
            status:         'pending',
        }).select('id').single();
        setSaving(false);
        if (err) { setError(err.message); return; }
        // Cuando se solicitan documentos, la app mobile lee users.kyc_status
        // para decidir si muestra el banner "Verificación pendiente" y bloquea
        // ciertas features. Sincronizamos aquí — si el user ya estaba approved
        // vuelve a pending mientras revisa/sube la documentación.
        await supabasePersonas
            .from('users')
            .update({ kyc_status: 'pending' })
            .eq('id', picked.id);
        await logAdminAction({
            admin: profile,
            action: 'doc_request.create',
            targetType: 'user',
            targetId: picked.id,
            metadata: { request_id: data?.id, category, transaction_id: txId || null, kyc_status_pushed: 'pending' },
        });
        onCreated();
    };

    return (
        <ModalShell onClose={onClose} title="Nueva solicitud de documentación">
            <div className="space-y-3">
                {/* Picker de usuario */}
                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Usuario *</label>
                    {picked ? (
                        <div className="mt-1 flex items-center justify-between p-2 bg-green-50 rounded-lg">
                            <div>
                                <p className="text-sm font-semibold" style={{ color: NAVY }}>{picked.full_name ?? picked.email}</p>
                                <p className="text-xs text-slate-500">{picked.email}</p>
                            </div>
                            <button onClick={() => { setPicked(null); setUserQuery(''); }} className="text-xs text-slate-500 hover:text-slate-900">
                                Cambiar
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="relative mt-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <input
                                    value={userQuery}
                                    onChange={e => setUserQuery(e.target.value)}
                                    placeholder="Buscar por email, nombre o Lincoin ID…"
                                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-green-500 outline-none"
                                />
                            </div>
                            <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden bg-white">
                                {searching && userResults.length === 0 ? (
                                    <p className="px-3 py-4 text-xs text-slate-400 text-center">Cargando verificados…</p>
                                ) : userResults.length === 0 ? (
                                    <p className="px-3 py-4 text-xs text-slate-400 text-center">
                                        {userQuery.trim()
                                            ? `Sin resultados verificados para "${userQuery}"`
                                            : 'No hay usuarios verificados'}
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-slate-500 px-3 py-1.5 bg-slate-50 border-b border-slate-100 uppercase tracking-wider font-bold">
                                            {userQuery.trim()
                                                ? `Verificados encontrados (${userResults.length})`
                                                : `Últimos ${userResults.length} verificados`}
                                        </p>
                                        <ul className="max-h-56 overflow-y-auto">
                                            {userResults.map(u => {
                                                const initial = (u.full_name?.[0] ?? u.email[0] ?? '?').toUpperCase();
                                                return (
                                                    <li key={u.id} className="border-b border-slate-100 last:border-b-0">
                                                        <button
                                                            onClick={() => setPicked(u)}
                                                            className="w-full text-left px-3 py-2 hover:bg-green-50 text-sm flex items-center gap-2.5 transition-colors"
                                                        >
                                                            <div
                                                                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                                                                style={{ backgroundColor: '#CCFBF1', color: NAVY }}
                                                            >
                                                                {initial}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="font-semibold truncate" style={{ color: NAVY }}>
                                                                    {u.full_name ?? u.email}
                                                                </p>
                                                                <p className="text-[11px] text-slate-500 truncate">
                                                                    {u.email}{u.cuypay_id ? ` · ${u.cuypay_id}` : ''}
                                                                </p>
                                                            </div>
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* TX opcional — COMBOBOX buscable de movimientos del user.
                    Tipeás para filtrar por fecha (2026-07), tipo (carga/envío/
                    conversión), monto, moneda, estado o UUID. Al elegir se
                    guarda el UUID real — imposible el 'invalid input syntax
                    for type uuid' de Postgres. */}
                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Transacción asociada (opcional)
                    </label>
                    {!picked ? (
                        <p className="mt-1 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            Elegí primero el usuario para ver sus movimientos recientes.
                        </p>
                    ) : loadingTxs ? (
                        <p className="mt-1 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            Cargando movimientos de {picked.full_name ?? picked.email}…
                        </p>
                    ) : (() => {
                        const KIND_LABEL: Record<string, string> = {
                            load: 'Carga', carga: 'Carga',
                            send: 'Envío', envio: 'Envío',
                            convert: 'Conversión', tx_created: 'Conversión',
                            pay_received: 'Pago recibido', pay_sent: 'Pago enviado',
                            otc_deposit: 'Depósito OTC', otc_withdraw: 'Retiro OTC',
                        };
                        const fmtTx = (t: typeof userTxs[number]) => ({
                            fecha:    new Date(t.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }),
                            fechaIso: t.created_at.slice(0, 10),
                            kindLbl:  KIND_LABEL[t.kind ?? ''] ?? (t.kind ?? 'Movimiento'),
                            monto:    t.amount != null
                                ? `${Number(t.amount).toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${t.currency ?? ''}`.trim()
                                : '—',
                        });
                        const selected = userTxs.find(t => t.id === txId);
                        // Selección hecha → chip con resumen + botón para quitar
                        if (selected) {
                            const f = fmtTx(selected);
                            return (
                                <div className="mt-1 flex items-center justify-between gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                                    <div className="min-w-0 text-xs">
                                        <span className="font-bold" style={{ color: NAVY }}>{f.kindLbl}</span>
                                        <span className="text-slate-600"> · {f.monto} · {f.fecha} · {selected.status ?? ''}</span>
                                        <span className="block font-mono text-[10px] text-slate-400 truncate">{selected.id}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => { setTxId(''); setTxQuery(''); }}
                                        className="p-1 rounded hover:bg-green-100 text-slate-500 shrink-0"
                                        title="Quitar transacción"
                                    >
                                        <X size={13} />
                                    </button>
                                </div>
                            );
                        }
                        // UUID pegado a mano (txId sin match en la lista) → chip genérico
                        if (txId && UUID_RX.test(txId)) {
                            return (
                                <div className="mt-1 flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                                    <span className="font-mono text-[11px] text-slate-600 truncate">{txId}</span>
                                    <button type="button" onClick={() => { setTxId(''); setTxQuery(''); }} className="p-1 rounded hover:bg-slate-200 text-slate-500 shrink-0" title="Quitar">
                                        <X size={13} />
                                    </button>
                                </div>
                            );
                        }
                        // Sin selección → combobox
                        const q = txQuery.trim().toLowerCase();
                        const filtered = userTxs.filter(t => {
                            if (!q) return true;
                            const f = fmtTx(t);
                            return [f.fecha, f.fechaIso, f.kindLbl, t.kind ?? '', f.monto, t.currency ?? '', t.status ?? '', t.id]
                                .some(s => String(s).toLowerCase().includes(q));
                        });
                        const pastedUuid = UUID_RX.test(txQuery.trim());
                        return (
                            <div className="relative mt-1">
                                <div className="relative">
                                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={txQuery}
                                        onChange={e => { setTxQuery(e.target.value); setTxOpen(true); }}
                                        onFocus={() => setTxOpen(true)}
                                        onBlur={() => setTimeout(() => setTxOpen(false), 150)}
                                        placeholder={txsFailed
                                            ? 'No pude cargar los movimientos — pegá el UUID acá'
                                            : userTxs.length === 0
                                                ? 'Este usuario no tiene movimientos — pegá un UUID si hace falta'
                                                : `Buscar en ${userTxs.length} movimientos: fecha, tipo, monto o UUID…`}
                                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs focus:border-green-500 outline-none"
                                    />
                                </div>
                                {txOpen && (filtered.length > 0 || pastedUuid) && (
                                    <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                        {pastedUuid && (
                                            <button
                                                type="button"
                                                onMouseDown={() => { setTxId(txQuery.trim()); setTxOpen(false); }}
                                                className="w-full text-left px-3 py-2.5 hover:bg-green-50 border-b border-slate-100"
                                            >
                                                <span className="text-xs font-semibold" style={{ color: NAVY }}>Usar este UUID</span>
                                                <span className="block font-mono text-[10px] text-slate-500 truncate">{txQuery.trim()}</span>
                                            </button>
                                        )}
                                        {filtered.map(t => {
                                            const f = fmtTx(t);
                                            return (
                                                <button
                                                    key={t.id}
                                                    type="button"
                                                    onMouseDown={() => { setTxId(t.id); setTxOpen(false); }}
                                                    className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0"
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-xs font-bold" style={{ color: NAVY }}>{f.kindLbl}</span>
                                                        <span className="text-xs font-mono text-slate-700 shrink-0">{f.monto}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2 mt-0.5">
                                                        <span className="text-[11px] text-slate-500">{f.fecha} · {t.status ?? '—'}</span>
                                                        <span className="font-mono text-[9px] text-slate-400 shrink-0">…{t.id.slice(-12)}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                        {filtered.length === 0 && !pastedUuid && (
                                            <p className="px-3 py-3 text-xs text-slate-400 text-center">Sin resultados para "{txQuery}"</p>
                                        )}
                                    </div>
                                )}
                                {txQuery.trim() && !pastedUuid && filtered.length === 0 && !txOpen && (
                                    <p className="text-[11px] text-amber-700 mt-1">
                                        Sin coincidencias — para asociar por UUID pegalo completo (formato 8-4-4-4-12).
                                    </p>
                                )}
                            </div>
                        );
                    })()}
                </div>

                {/* Categoría */}
                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Categoría</label>
                    <select
                        value={category}
                        onChange={e => setCategory(e.target.value as DocRequest['category'])}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
                    >
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                        ))}
                    </select>
                </div>

                {/* Título + descripción */}
                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Título *</label>
                    <input
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="ej: Comprobante de origen de fondos"
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    />
                </div>
                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Descripción / qué pedimos *</label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        rows={4}
                        placeholder="Describí en detalle qué información o archivos necesitás. Esto lo lee el usuario en la app."
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    />
                </div>

                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Vence (opcional)</label>
                    <input
                        type="date"
                        value={dueDate}
                        onChange={e => setDueDate(e.target.value)}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    />
                </div>

                {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}

                {/* Aviso de compliance_hold: la app móvil bloquea send/load
                    mientras haya una solicitud activa. El usuario sigue
                    pudiendo convertir saldos entre wallets (mover dentro
                    de Lincoin), solo no aumentar exposición externa. */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                        <p className="font-semibold">Esto activa Compliance Hold</p>
                        <p className="mt-0.5 opacity-80">
                            Mientras la solicitud esté abierta, el usuario <b>NO podrá enviar (send) ni cargar (load)</b> plata.
                            Sí podrá convertir saldos entre sus wallets. El hold se libera cuando vos aprobás la solicitud.
                        </p>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <button onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button
                        onClick={submit}
                        disabled={saving || !picked || !title.trim() || !description.trim()}
                        className="px-3 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50"
                        style={{ backgroundColor: NAVY }}
                    >
                        {saving ? 'Enviando…' : 'Enviar solicitud y activar hold'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

// ─────────────────────────────────────────────
// ReviewModal — ver detalle, aprobar/rechazar/escalar
// ─────────────────────────────────────────────
const ReviewModal: React.FC<{
    profile: AdminProfile;
    request: DocRequest;
    onClose: () => void;
    onUpdated: () => void;
    onRequestMore?: (user_id: string) => void;    // "Solicitar otra documentación"
    onPermanentBlock?: (user_id: string) => void; // "Bloqueo permanente" (docs no cumplen)
}> = ({ profile, request, onClose, onUpdated, onRequestMore, onPermanentBlock }) => {
    // Al abrir un block_unlock, el review_notes viene serializado con el motivo
    // + array de docs requeridos (lo escribimos en ComplianceSection.applyBlock).
    // Extraemos el JSON para render sin desechar el texto libre si el admin
    // ya empezó a escribir notas después.
    const parsedMeta = (() => {
        const looksLikeBlockUnlock = request.category === 'block_unlock'
            || (request.category === 'other' && request.title.startsWith('[BLOQUEO]'));
        if (!looksLikeBlockUnlock) return null;
        try {
            const raw = request.review_notes;
            if (!raw) return null;
            const j = JSON.parse(raw);
            if (Array.isArray(j?.required)) {
                return {
                    required: j.required as string[],
                    reason: j.reason as string | undefined,
                    // Presente cuando el bloqueo es de un TERCERO (beneficiary)
                    // y no del usuario dueño — cambia a quién desbloquea el
                    // botón "Aprobar y desbloquear".
                    beneficiary_id:   j.beneficiary_id as string | undefined,
                    beneficiary_name: j.beneficiary_name as string | undefined,
                };
            }
        } catch { /* review_notes ya no es JSON, el admin la sobrescribió */ }
        return null;
    })();
    const isBeneficiaryBlock = !!parsedMeta?.beneficiary_id;

    const [notes, setNotes] = useState(parsedMeta ? '' : (request.review_notes ?? ''));
    const [saving, setSaving] = useState<DocRequest['status'] | null>(null);
    const [error, setError]   = useState<string | null>(null);
    // Para el atajo "Aprobar y ajustar topes" cuando es category='limit_increase'
    const [showLimitsAfterApprove, setShowLimitsAfterApprove] = useState(false);

    const isLimitIncrease = request.category === 'limit_increase';
    // Fila mapeada desde limit_increase_requests (tabla dedicada del mobile)
    const isLir = request._source === 'lir';
    // También tratamos como block_unlock las requests que quedaron con
    // category='other' + prefijo '[BLOQUEO]' en title (fallback cuando el
    // CHECK constraint todavía no acepta 'block_unlock').
    const isBlockUnlock   = request.category === 'block_unlock'
                         || (request.category === 'other' && request.title.startsWith('[BLOQUEO]'));

    // Reabrir una request rechazada / cerrada — vuelve a status='pending'
    // y limpia respuesta previa para que el user re-envíe. Se usa cuando el
    // admin quiere darle otra chance al usuario en block_unlock.
    const reopen = async () => {
        setSaving('pending');
        setError(null);
        // Rama limit_increase_requests: reabrir = volver a 'pending' (su
        // estado de "esperando revisión") sin tocar nada más.
        if (isLir) {
            const { error: lerr } = await supabasePersonas
                .from('limit_increase_requests')
                .update({
                    status:      'pending',
                    admin_notes: notes.trim() || 'Reabierta por revisor.',
                    reviewed_at: new Date().toISOString(),
                })
                .eq('id', request.id);
            setSaving(null);
            if (lerr) { setError(lerr.message); return; }
            await logAdminAction({
                admin: profile,
                action: 'limit_increase.reopen',
                targetType: 'limit_increase_request',
                targetId: request.id,
                metadata: { user_id: request.user_id },
            });
            onUpdated();
            return;
        }
        const { error: err } = await supabasePersonas
            .from('document_requests')
            .update({
                status:        'pending',
                review_notes:  notes.trim() || 'Reabierta por revisor — subí de nuevo los documentos.',
                reviewed_by:   profile.id,
                reviewed_at:   new Date().toISOString(),
                // Limpiamos respuesta previa para que el user tenga que
                // volver a subir. El histórico queda en el audit log.
                user_response: null,
                responded_at:  null,
                attachments:   [],
            })
            .eq('id', request.id);
        setSaving(null);
        if (err) { setError(err.message); return; }
        // Si era un block_unlock aprobado por error, dejamos users como estaba
        // — solo tocamos users.kyc_status si venía 'rejected' y el admin
        // reabre (le damos otra chance). Para solicitudes de TERCEROS no
        // tocamos al dueño: el beneficiario sigue blocked hasta aprobar.
        if (isBlockUnlock && !isBeneficiaryBlock) {
            await supabasePersonas
                .from('users')
                .update({ kyc_status: 'pending' })
                .eq('id', request.user_id);
        }
        await logAdminAction({
            admin: profile,
            action: 'doc_request.reopen',
            targetType: 'document_request',
            targetId: request.id,
            metadata: { user_id: request.user_id, notes: notes || null },
        });
        onUpdated();
    };

    const setStatus = async (status: DocRequest['status'], openLimitsAfter = false) => {
        setSaving(status);
        setError(null);

        // ── Rama limit_increase_requests (tabla dedicada del mobile) ──
        // Solo soporta approved / rejected / pending. No toca users.kyc_status
        // (es una solicitud de topes, no de identidad).
        if (isLir) {
            const lirStatus =
                status === 'approved' ? 'approved' :
                status === 'rejected' ? 'rejected' : 'pending';
            const { error: lerr } = await supabasePersonas
                .from('limit_increase_requests')
                .update({
                    status:      lirStatus,
                    admin_notes: notes.trim() || null,
                    reviewed_at: new Date().toISOString(),
                })
                .eq('id', request.id);
            setSaving(null);
            if (lerr) { setError(lerr.message); return; }
            await logAdminAction({
                admin: profile,
                action: `limit_increase.${lirStatus}`,
                targetType: 'limit_increase_request',
                targetId: request.id,
                metadata: {
                    user_id: request.user_id,
                    beneficiary_id: request.beneficiary_id ?? null,
                    notes: notes || null,
                },
            });
            if (openLimitsAfter && status === 'approved') {
                setShowLimitsAfterApprove(true);
            } else {
                onUpdated();
            }
            return;
        }

        const { error: err } = await supabasePersonas
            .from('document_requests')
            .update({
                status,
                review_notes: notes.trim() || null,
                reviewed_by:  profile.id,
                reviewed_at:  new Date().toISOString(),
            })
            .eq('id', request.id);
        setSaving(null);
        if (err) { setError(err.message); return; }
        // Sync a users.kyc_status + is_active según el status Y la categoría:
        //   rejected  → kyc_status='rejected'  (mobile: "Documentos rechazados")
        //   approved  → kyc_status='approved'  (mobile: libera restricciones)
        //   Además, si es block_unlock y aprobamos → limpiamos el bloqueo:
        //     is_active=true, is_blocked=false, block_reason=null, required_documents=[]
        //   (así el banner rojo del ComplianceBanner desaparece del mobile)
        let kycPush: string | null = null;
        if (status === 'rejected') kycPush = 'rejected';
        else if (status === 'approved') kycPush = 'approved';

        if (isBeneficiaryBlock && parsedMeta?.beneficiary_id) {
            // La solicitud es por un TERCERO bloqueado: aprobar = LEVANTAR el
            // bloqueo (is_active + limpiar block_*). NO tocamos kyc_status —
            // el estado KYC es la verdad de Didit, dimensión aparte del
            // bloqueo. Rechazar tampoco lo toca: el tercero sigue bloqueado.
            if (status === 'approved') {
                const benPatch: Record<string, any> = {
                    is_active: true,
                    block_type: null, block_reason: null, block_notes: null,
                    required_documents: [],
                };
                let { error: berr } = await supabasePersonas
                    .from('beneficiaries')
                    .update(benPatch)
                    .eq('id', parsedMeta.beneficiary_id);
                if (berr && /column/i.test(berr.message)) {
                    await supabasePersonas.from('beneficiaries').update({ is_active: true }).eq('id', parsedMeta.beneficiary_id);
                }
            }
        } else {
            const userPatch: Record<string, any> = {};
            if (kycPush) userPatch.kyc_status = kycPush;
            if (isBlockUnlock && status === 'approved') {
                userPatch.is_active          = true;
                userPatch.is_blocked         = false;
                userPatch.block_reason       = null;
                userPatch.block_notes        = null;
                userPatch.required_documents = [];
                userPatch.blocked_reason     = null;
                userPatch.blocked_at         = null;
            }
            if (Object.keys(userPatch).length > 0) {
                let { error: uerr } = await supabasePersonas
                    .from('users')
                    .update(userPatch)
                    .eq('id', request.user_id);
                // Fallback si alguna col nueva no existe todavía (usuarios sin la migración)
                if (uerr && /column/i.test(uerr.message)) {
                    const minimal: Record<string, any> = {};
                    if (kycPush) minimal.kyc_status = kycPush;
                    if (isBlockUnlock && status === 'approved') minimal.is_active = true;
                    await supabasePersonas.from('users').update(minimal).eq('id', request.user_id);
                }
            }
        }
        await logAdminAction({
            admin: profile,
            action: `doc_request.${status}`,
            targetType: 'document_request',
            targetId: request.id,
            metadata: { user_id: request.user_id, notes: notes || null, kyc_status_pushed: kycPush },
        });
        // Si es ampliación de topes y el admin la aprobó, no cerramos —
        // mostramos el UserLimitsCard para subirle los topes en el acto.
        if (openLimitsAfter && status === 'approved') {
            setShowLimitsAfterApprove(true);
        } else {
            onUpdated();
        }
    };

    return (
        <ModalShell onClose={onClose} title="Solicitud de documentación">
            <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <StatusPill status={request.status} />
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {CATEGORY_LABELS[request.category]}
                    </span>
                    <span className="text-[11px] text-slate-500">
                        <Clock size={10} className="inline" /> {formatDate(request.requested_at)}
                    </span>
                    {request.due_date && (
                        <span className="text-[11px] text-amber-700 font-semibold">vence {request.due_date}</span>
                    )}
                </div>

                <div>
                    <p className="text-lg font-bold" style={{ color: NAVY }}>{request.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {request.user?.full_name ?? request.user?.email ?? request.user_id.slice(0, 8)}
                        {request.transaction_id && <> · TX <span className="font-mono">{request.transaction_id.slice(0, 8)}…</span></>}
                    </p>
                </div>

                {/* Aumento de topes POR CONTACTO: dejar clarísimo a quién aplica */}
                {isLir && request.beneficiary_id && (
                    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm text-violet-900">
                        <p className="font-bold mb-0.5">
                            Solicitud de aumento para el Contacto {request.beneficiary_name ?? request.beneficiary_id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-violet-800">
                            Al aprobar, los topes se aplican al <strong>contacto</strong> (tabla beneficiaries),
                            no a los topes globales del usuario {request.user?.full_name ?? request.user?.email ?? ''}.
                        </p>
                    </div>
                )}

                <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Lo que pedimos</p>
                    <p className="text-sm whitespace-pre-wrap" style={{ color: NAVY }}>{request.description}</p>
                </div>

                {isBlockUnlock && parsedMeta && parsedMeta.required.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-red-700 mb-2 flex items-center gap-1">
                            <XCircle size={11} /> Documentos requeridos para levantar el bloqueo
                            {isBeneficiaryBlock && (
                                <span className="ml-1 normal-case tracking-normal font-semibold text-red-900 bg-red-100 px-1.5 py-0.5 rounded">
                                    Tercero: {parsedMeta.beneficiary_name ?? parsedMeta.beneficiary_id?.slice(0, 8)}
                                </span>
                            )}
                        </p>
                        <ul className="space-y-1">
                            {parsedMeta.required.map((slug: string) => (
                                <li key={slug} className="text-sm flex items-start gap-2" style={{ color: NAVY }}>
                                    <span className="text-red-500 shrink-0">•</span>
                                    <span>{DOC_SLUG_LABELS[slug] ?? slug}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {request.file_url && (
                    <div className="bg-slate-900 rounded-lg p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-2 pt-1">
                            Archivo subido desde la app · {CATEGORY_LABELS[request.category] ?? request.category}
                        </p>
                        <a
                            href={request.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="block bg-slate-950 rounded-md overflow-hidden"
                            title="Abrir archivo original en pestaña nueva"
                        >
                            <img
                                src={request.file_url}
                                alt={CATEGORY_LABELS[request.category] ?? request.category}
                                className="w-full max-h-[420px] object-contain"
                                onError={(e) => {
                                    const el = e.currentTarget as HTMLImageElement;
                                    el.style.display = 'none';
                                    const fallback = el.parentElement?.querySelector<HTMLDivElement>('.file-fallback');
                                    if (fallback) fallback.style.display = 'block';
                                }}
                            />
                            <div
                                className="file-fallback p-6 text-center text-slate-300 text-sm"
                                style={{ display: 'none' }}
                            >
                                <Paperclip size={20} className="mx-auto mb-2" />
                                No se pudo previsualizar. Click para abrir el archivo original.
                                <br />
                                <span className="text-[10px] break-all opacity-70">{request.file_url}</span>
                            </div>
                        </a>
                        <div className="flex items-center justify-between px-2 py-2 text-[11px] text-slate-400">
                            <span>
                                {request.responded_at ? `Subido ${formatDate(request.responded_at)}` : 'Fecha desconocida'}
                            </span>
                            <a href={request.file_url} target="_blank" rel="noreferrer" className="text-green-400 hover:text-green-300 font-semibold">
                                Abrir original ↗
                            </a>
                        </div>
                    </div>
                )}

                {request.user_response ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-green-700 mb-1">
                            Respuesta del usuario · {formatDate(request.responded_at)}
                        </p>
                        <p className="text-sm whitespace-pre-wrap" style={{ color: NAVY }}>{request.user_response}</p>
                        {(request.attachments?.length ?? 0) > 0 && (
                            <AttachmentGallery attachments={request.attachments ?? []} />
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 italic">El usuario aún no respondió.</p>
                )}

                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Notas del revisor</label>
                    <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={3}
                        placeholder="Comentarios internos / razón de aprobación o rechazo"
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    />
                </div>

                {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}

                {/* Recordatorio del efecto en compliance_hold según el botón */}
                {(request.status === 'pending' || request.status === 'submitted' || request.status === 'escalated') && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-700 space-y-1">
                        <p className="font-semibold text-slate-900">Efecto sobre el Compliance Hold del usuario</p>
                        <p>✓ <b className="text-emerald-700">Aprobar</b>: libera el hold si no quedan otras solicitudes activas. El usuario puede volver a send/load.</p>
                        <p>✕ <b className="text-red-700">Rechazar</b>: cierra la solicitud, también libera el hold.</p>
                        <p>↑ <b className="text-amber-700">Escalar</b>: mantiene el hold mientras otra área revisa.</p>
                    </div>
                )}

                {/* Atajo cuando es ampliación de topes: aprobar + abrir editor de topes inline */}
                {isLimitIncrease && showLimitsAfterApprove && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-3">
                        <p className="text-sm font-bold text-emerald-900 flex items-center gap-1">
                            <CheckCircle2 size={14} /> Solicitud aprobada. {request.beneficiary_id
                                ? `Topes del contacto ${request.beneficiary_name ?? ''} (ajustá si hace falta):`
                                : 'Ahora subile los topes:'}
                        </p>
                        <UserLimitsCard
                            userId={request.beneficiary_id ?? request.user_id}
                            subject={request.beneficiary_id ? 'beneficiary' : 'user'}
                            profile={profile}
                            autoOpenEdit
                            onSaved={() => onUpdated()}
                        />
                    </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                    {/* Solicitud en estado ACTIVO (pending / submitted / escalated):
                        se muestran los botones de decisión.
                        En terminal (approved / rejected / canceled) sólo mostramos
                        acciones de reabrir/cerrar según el caso. */}
                    {(request.status === 'pending' || request.status === 'submitted' || request.status === 'escalated') && (
                        <>
                            {isLimitIncrease && !showLimitsAfterApprove && (
                                <button
                                    onClick={() => setStatus('approved', true)}
                                    disabled={saving !== null}
                                    className="flex items-center gap-1 px-3 py-2 text-sm font-bold text-white rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50"
                                    title="Aprueba la solicitud y abre el editor de topes para subirle el límite a este usuario"
                                >
                                    <Gauge size={14} /> {saving === 'approved' ? '…' : 'Aprobar y ajustar topes'}
                                </button>
                            )}
                            <button
                                onClick={() => setStatus('approved')}
                                disabled={saving !== null}
                                className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                            >
                                <CheckCircle2 size={14} />
                                {saving === 'approved'
                                    ? '…'
                                    : isBlockUnlock
                                        ? 'Aprobar y desbloquear'
                                        : 'Aprobar y liberar hold'}
                            </button>
                            {isBlockUnlock && onRequestMore && (
                                <button
                                    onClick={() => { onRequestMore(request.user_id); }}
                                    disabled={saving !== null}
                                    className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                                    title="Cierra esta y abre una nueva solicitud de documentación para el mismo usuario"
                                >
                                    <FileWarning size={14} /> Solicitar otra documentación
                                </button>
                            )}
                            {isBlockUnlock && !isBeneficiaryBlock && onPermanentBlock && (
                                <button
                                    onClick={() => { onPermanentBlock(request.user_id); }}
                                    disabled={saving !== null}
                                    className="flex items-center gap-1 px-3 py-2 text-sm font-bold text-white rounded-lg bg-red-900 hover:bg-black disabled:opacity-50"
                                    title="Los documentos no justifican los movimientos — bloquear al usuario permanentemente"
                                >
                                    <XCircle size={14} /> Bloqueo permanente
                                </button>
                            )}
                            {/* Rechazar: para block_unlock solo tiene sentido si el user
                                ya respondió (hay algo que rechazar). Si no respondió,
                                lo mejor es "Solicitar otra documentación" o "Bloqueo permanente". */}
                            {(!isBlockUnlock || request.user_response) && (
                                <button
                                    onClick={() => setStatus('rejected')}
                                    disabled={saving !== null}
                                    className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50"
                                    title={isBlockUnlock
                                        ? 'Rechaza los docs enviados; el user queda con la solicitud cerrada. Si querés que reintente, mejor "Reabrir" desde el estado rechazado.'
                                        : 'Rechaza la solicitud'}
                                >
                                    <XCircle size={14} /> {saving === 'rejected' ? '…' : 'Rechazar'}
                                </button>
                            )}
                            {!isBlockUnlock && !isLir && (
                                <button
                                    onClick={() => setStatus('escalated')}
                                    disabled={saving !== null}
                                    className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                                >
                                    <AlertTriangle size={14} /> {saving === 'escalated' ? '…' : 'Escalar'}
                                </button>
                            )}
                            {request.status === 'pending' && (
                                <button
                                    onClick={() => setStatus('canceled')}
                                    disabled={saving !== null}
                                    className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
                                >
                                    Cancelar solicitud
                                </button>
                            )}
                        </>
                    )}

                    {/* Solicitud RECHAZADA: única acción disponible es reabrir
                        (le da al user otra chance de subir los docs). */}
                    {request.status === 'rejected' && (
                        <button
                            onClick={reopen}
                            disabled={saving !== null}
                            className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50"
                            title="Vuelve la solicitud a estado pendiente. Limpia la respuesta anterior y el user tendrá que subir los documentos otra vez."
                        >
                            <RefreshCw size={14} /> {saving === 'pending' ? '…' : 'Reabrir — el user vuelve a subir docs'}
                        </button>
                    )}

                    {/* Solicitud APROBADA o CANCELADA: solo cerrar (no hay acción). */}
                    {(request.status === 'approved' || request.status === 'canceled') && (
                        <p className="text-xs text-slate-500 italic">
                            Solicitud {request.status === 'approved' ? 'aprobada' : 'cancelada'} — no hay más acciones disponibles.
                        </p>
                    )}

                    <div className="ml-auto" />
                    <button onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
                </div>
            </div>
        </ModalShell>
    );
};

// ─────────────────────────────────────────────
// AttachmentGallery — grilla de adjuntos con miniatura, lightbox y
// enlace firmado. Los attachments del mobile suelen venir como PATHS
// de Storage privado (no URLs) — un <a href> pelado navegaba a una
// ruta inexistente. Acá generamos signed URLs (1h) probando los
// buckets conocidos.
// ─────────────────────────────────────────────
const ATTACH_BUCKETS = ['doc_requests', 'kyc-documents', 'kyc_media'];

const AttachmentGallery: React.FC<{ attachments: any[] }> = ({ attachments }) => {
    const [urls, setUrls]     = useState<Record<number, string | null>>({});
    const [broken, setBroken] = useState<Record<number, boolean>>({});
    const [lightbox, setLightbox] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const out: Record<number, string | null> = {};
            for (let i = 0; i < attachments.length; i++) {
                const a = attachments[i] ?? {};
                const raw = String(a.url ?? a.path ?? a.file ?? a.storage_path ?? '');
                if (/^https?:\/\//.test(raw)) { out[i] = raw; continue; }
                if (!raw) { out[i] = null; continue; }
                let path = raw.replace(/^\/+/, '');
                let bucket = a.bucket ?? ATTACH_BUCKETS[0];
                for (const b of ATTACH_BUCKETS) {
                    if (path.startsWith(`${b}/`)) { bucket = b; path = path.slice(b.length + 1); break; }
                }
                let signed: string | null = null;
                // probamos el bucket detectado y después el resto
                for (const b of [bucket, ...ATTACH_BUCKETS.filter(x => x !== bucket)]) {
                    try {
                        const { data } = await supabasePersonas.storage.from(b).createSignedUrl(path, 3600);
                        if (data?.signedUrl) { signed = data.signedUrl; break; }
                    } catch { /* siguiente bucket */ }
                }
                out[i] = signed;
                if (cancelled) return;
            }
            if (!cancelled) setUrls(out);
        })();
        return () => { cancelled = true; };
    }, [attachments]);

    const nameOf = (a: any, i: number) => {
        const raw = String(a?.name ?? a?.url ?? a?.path ?? '');
        const base = raw.split('/').pop()?.split('?')[0];
        return base || `Archivo ${i + 1}`;
    };

    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
                {attachments.map((a: any, i: number) => {
                    const url = urls[i];
                    const isPending = !(i in urls);
                    return (
                        <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                            {isPending ? (
                                <div className="h-28 bg-slate-100 animate-pulse" />
                            ) : url && !broken[i] ? (
                                <button
                                    type="button"
                                    onClick={() => setLightbox(url)}
                                    className="block w-full h-28 cursor-zoom-in bg-slate-950"
                                    title="Ampliar"
                                >
                                    <img
                                        src={url}
                                        alt={nameOf(a, i)}
                                        className="w-full h-full object-cover"
                                        onError={() => setBroken(prev => ({ ...prev, [i]: true }))}
                                    />
                                </button>
                            ) : (
                                <div className="h-28 flex flex-col items-center justify-center gap-1 bg-slate-50 text-slate-400">
                                    <Paperclip size={18} />
                                    <span className="text-[9px]">{url ? 'Sin vista previa' : 'Enlace no disponible'}</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-t border-slate-100">
                                <span className="text-[10px] font-semibold text-slate-700 truncate" title={nameOf(a, i)}>
                                    {nameOf(a, i)}
                                </span>
                                {url && (
                                    <a
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] font-bold text-green-700 hover:underline shrink-0"
                                        title="Abrir original en pestaña nueva"
                                    >
                                        Abrir ↗
                                    </a>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            {lightbox && (
                <div
                    className="fixed inset-0 bg-black/85 z-[90] flex items-center justify-center p-6 cursor-zoom-out"
                    onClick={() => setLightbox(null)}
                >
                    <img src={lightbox} alt="Adjunto" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                    <button
                        onClick={() => setLightbox(null)}
                        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                    >
                        <X size={20} />
                    </button>
                </div>
            )}
        </>
    );
};

// Wrapper simple de modal centrado.
const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
    <div
        className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
        onClick={onClose}
    >
        <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
        >
            <div className="sticky top-0 bg-white px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="font-bold" style={{ color: NAVY }}>{title}</p>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
                    <X size={18} />
                </button>
            </div>
            <div className="px-5 py-4">
                {children}
            </div>
        </div>
    </div>
);
