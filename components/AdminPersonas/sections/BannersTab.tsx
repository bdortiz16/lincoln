import React, { useEffect, useState } from 'react';
import {
    Image as ImageIcon, Plus, RefreshCw, AlertCircle, X, Save,
    Eye, Trash2, ExternalLink, Ticket, Tag,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, NAVY, TEAL, formatDate, EmptyState } from './shared';

// ─────────────────────────────────────────────
// BannersTab — gestiona la tabla public.app_banners.
//
// Schema (spec final con Antigravity, ver
// supabase/migrations/2026_app_banners.sql):
//
//   id           uuid PK
//   title        text NOT NULL     — texto del cartel que sostiene la mascota
//   description  text NOT NULL     — descripción larga de la promo
//   coupon_code  text NULLABLE     — código promocional editable
//   image_url    text NULLABLE     — imagen de la campaña (opcional)
//   action_url   text NULLABLE     — deep link al tappear el cartel
//   is_active    boolean DEFAULT true
//   created_at, updated_at
//
// La app móvil consume directo:
//   SELECT * FROM app_banners WHERE is_active = true
//
// El previsualizador a la derecha del form dibuja cómo se ve el cartel
// en la app: cartel negro con borde doble cian (#00E0C3) sobre el fondo
// oscuro premium de la app (#0D1117 / #121413).
// ─────────────────────────────────────────────

interface Banner {
    id: string;
    title: string;
    description: string;
    coupon_code: string | null;
    image_url: string | null;
    action_url: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

const BRAND_CYAN = '#00E0C3';
const BRAND_DARK = '#0D1117';
const BRAND_PANEL = '#121413';

interface Props {
    profile: AdminProfile;
}

export const BannersTab: React.FC<Props> = ({ profile }) => {
    const [rows, setRows]       = useState<Banner[]>([]);
    const [loading, setLoading] = useState(true);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [error, setError]     = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing]   = useState<Banner | null>(null);
    const { confirm, dialog: confirmDialog } = useConfirm();

    const load = async () => {
        setLoading(true); setError(null); setNeedsSetup(false);
        const { data, error: err } = await supabasePersonas
            .from('app_banners')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
        if (err) {
            const missing =
                /relation .* does not exist/i.test(err.message) ||
                /Could not find the table/i.test(err.message) ||
                err.code === '42P01' || err.code === 'PGRST205';
            if (missing) setNeedsSetup(true);
            else setError(err.message);
            setLoading(false); return;
        }
        setRows((data ?? []) as Banner[]);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const toggleActive = async (b: Banner) => {
        const { error: err } = await supabasePersonas
            .from('app_banners')
            .update({ is_active: !b.is_active })
            .eq('id', b.id);
        if (err) {
            await confirm({ title: 'Error', message: err.message, variant: 'danger', alertOnly: true, confirmLabel: 'Cerrar' });
            return;
        }
        await logAdminAction({
            admin: profile,
            action: b.is_active ? 'banner.deactivate' : 'banner.activate',
            targetType: 'app_banner', targetId: b.id,
        });
        load();
    };

    const removeBanner = async (b: Banner) => {
        const ok = await confirm({
            title: 'Eliminar banner',
            message: `¿Eliminar el banner "${b.title}"? Esta acción no se puede deshacer.`,
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        const { error: err } = await supabasePersonas
            .from('app_banners').delete().eq('id', b.id);
        if (err) {
            await confirm({ title: 'Error', message: err.message, variant: 'danger', alertOnly: true, confirmLabel: 'Cerrar' });
            return;
        }
        await logAdminAction({
            admin: profile, action: 'banner.delete',
            targetType: 'app_banner', targetId: b.id,
        });
        load();
    };

    if (needsSetup) {
        return (
            <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm font-semibold text-amber-900">Tabla app_banners todavía no creada</p>
                    <p className="text-xs text-amber-800 mt-1">
                        Aplicá <code>supabase/migrations/2026_app_banners.sql</code> en Supabase Personas
                        y recargá. Crea la tabla, el índice de activos, RLS y el trigger updated_at.
                    </p>
                </div>
            </div>
        );
    }

    const activeCount = rows.filter(r => r.is_active).length;

    return (
        <div className="space-y-4">
            {confirmDialog}
            <SectionHeader
                title="Banners de Campaña"
                subtitle="Carteles que sostiene la mascota Cuy en el home de la app móvil"
                right={
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
                              style={{ backgroundColor: TEAL + '22', color: NAVY }}>
                            {activeCount} activos · {rows.length} total
                        </span>
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
                            Nuevo banner
                        </button>
                    </div>
                }
            />

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">{error}</div>
            )}

            {/* Lista */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3 w-16">Activo</th>
                                <th className="text-left px-4 py-3">Título</th>
                                <th className="text-left px-4 py-3">Descripción</th>
                                <th className="text-left px-4 py-3">Cupón</th>
                                <th className="text-left px-4 py-3">Acción</th>
                                <th className="text-left px-4 py-3">Actualizado</th>
                                <th className="text-right px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
                            )}
                            {!loading && rows.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-12">
                                    <EmptyState icon={ImageIcon} title="Sin banners" message="Creá el primero con el botón arriba." />
                                </td></tr>
                            )}
                            {rows.map(b => (
                                <tr key={b.id}
                                    onClick={() => setEditing(b)}
                                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                                >
                                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                        <Toggle checked={b.is_active} onChange={() => toggleActive(b)} />
                                    </td>
                                    <td className="px-4 py-3 max-w-xs">
                                        <p className="font-semibold text-slate-900 truncate">{b.title}</p>
                                    </td>
                                    <td className="px-4 py-3 max-w-sm">
                                        <p className="text-xs text-slate-600 line-clamp-2">{b.description}</p>
                                    </td>
                                    <td className="px-4 py-3">
                                        {b.coupon_code ? (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 rounded"
                                                  style={{ backgroundColor: TEAL + '22', color: NAVY }}>
                                                <Ticket size={10} />{b.coupon_code}
                                            </span>
                                        ) : <span className="text-xs text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500 font-mono truncate max-w-[160px]">
                                        {b.action_url ? (
                                            <span className="inline-flex items-center gap-1"><ExternalLink size={10} />{b.action_url}</span>
                                        ) : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(b.updated_at)}</td>
                                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => removeBanner(b)}
                                            className="p-1 rounded hover:bg-red-50 text-red-600"
                                            title="Eliminar"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {(creating || editing) && (
                <BannerModal
                    profile={profile}
                    row={editing}
                    onClose={() => { setCreating(false); setEditing(null); }}
                    onSaved={() => { setCreating(false); setEditing(null); load(); }}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Modal create / edit con preview a la izquierda (cartel oscuro
// con borde doble cian) y el form a la derecha.
// ─────────────────────────────────────────────
const BannerModal: React.FC<{
    profile: AdminProfile;
    row: Banner | null;
    onClose: () => void;
    onSaved: () => void;
}> = ({ profile, row, onClose, onSaved }) => {
    const [title, setTitle]         = useState(row?.title ?? '');
    const [description, setDesc]    = useState(row?.description ?? '');
    const [couponCode, setCoupon]   = useState(row?.coupon_code ?? '');
    const [imageUrl, setImageUrl]   = useState(row?.image_url ?? '');
    const [actionUrl, setActionUrl] = useState(row?.action_url ?? '');
    const [isActive, setIsActive]   = useState(row?.is_active ?? true);
    const [busy, setBusy]           = useState(false);
    const [err, setErr]             = useState<string | null>(null);

    const save = async () => {
        if (!title.trim() || !description.trim()) {
            setErr('Título y descripción son obligatorios.'); return;
        }
        setBusy(true); setErr(null);
        const payload = {
            title:       title.trim(),
            description: description.trim(),
            coupon_code: couponCode.trim() || null,
            image_url:   imageUrl.trim() || null,
            action_url:  actionUrl.trim() || null,
            is_active:   isActive,
        };
        let id: string | null = null;
        if (row?.id) {
            const { error } = await supabasePersonas
                .from('app_banners').update(payload).eq('id', row.id);
            if (error) { setErr(error.message); setBusy(false); return; }
            id = row.id;
        } else {
            const { data, error } = await supabasePersonas
                .from('app_banners').insert(payload).select('id').single();
            if (error) { setErr(error.message); setBusy(false); return; }
            id = (data as any).id;
        }
        setBusy(false);
        await logAdminAction({
            admin: profile,
            action: row?.id ? 'banner.update' : 'banner.create',
            targetType: 'app_banner', targetId: id ?? undefined,
            metadata: { title: title.trim() },
        });
        onSaved();
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto"
                 onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                    <p className="font-bold" style={{ color: NAVY }}>
                        {row ? 'Editar banner' : 'Nuevo banner'}
                    </p>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-900"><X size={18} /></button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 p-5">
                    {/* PREVIEW (2 cols) */}
                    <div className="lg:col-span-2 space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                            <Eye size={10} /> Preview en el home
                        </p>
                        <BannerPreview
                            title={title || 'Título de la promo'}
                            description={description || 'La descripción larga aparece debajo cuando el user expande el cartel.'}
                            couponCode={couponCode}
                            imageUrl={imageUrl}
                        />
                        <p className="text-[10px] text-slate-400 text-center">
                            Cartel oscuro con borde doble cian — paleta oficial Lincoin.
                        </p>
                    </div>

                    {/* FORM (3 cols) */}
                    <div className="lg:col-span-3 space-y-3">
                        <Field label="Título" hint={`${title.length}/80 — texto principal del cartel`}>
                            <input
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="¡Promo COP→BRL hasta el viernes!"
                                maxLength={80}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold"
                            />
                        </Field>

                        <Field label="Descripción" hint={`${description.length}/240 — texto expandido`}>
                            <textarea
                                value={description}
                                onChange={e => setDesc(e.target.value)}
                                placeholder="Aprovechá la mejor tasa del mes para enviar plata a Brasil sin comisión adicional."
                                rows={3}
                                maxLength={240}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                            />
                        </Field>

                        <Field label="Código de cupón (opcional)" icon={<Ticket size={10} />} hint="Editable, mayúsculas recomendado">
                            <input
                                value={couponCode}
                                onChange={e => setCoupon(e.target.value.toUpperCase())}
                                placeholder="BRASIL15"
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono font-bold"
                            />
                        </Field>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Field label="Imagen URL (opcional)" icon={<ImageIcon size={10} />}>
                                <input
                                    value={imageUrl}
                                    onChange={e => setImageUrl(e.target.value)}
                                    placeholder="https://…/promo.png"
                                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs"
                                />
                            </Field>
                            <Field label="Action URL (opcional)" icon={<ExternalLink size={10} />}>
                                <input
                                    value={actionUrl}
                                    onChange={e => setActionUrl(e.target.value)}
                                    placeholder="cuypay://convert?from=COP&to=BRL"
                                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs font-mono"
                                />
                            </Field>
                        </div>

                        <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-semibold" style={{ color: NAVY }}>
                                    {isActive ? 'Visible en la app' : 'Oculto en la app'}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                    {isActive ? 'Los usuarios lo ven al abrir el home' : 'No aparece hasta que lo actives'}
                                </p>
                            </div>
                            <Toggle checked={isActive} onChange={() => setIsActive(v => !v)} />
                        </div>

                        {err && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800 flex items-start gap-2">
                                <AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{err}</span>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2 border-t border-slate-100">
                            <button
                                onClick={save}
                                disabled={busy || !title.trim() || !description.trim()}
                                className="px-3 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-1 disabled:opacity-50"
                                style={{ backgroundColor: NAVY }}
                            >
                                <Save size={13} /> {busy ? 'Guardando…' : (row ? 'Guardar cambios' : 'Crear banner')}
                            </button>
                            <button onClick={onClose} className="ml-auto px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Preview del cartel: paleta oscura premium con doble borde cian.
// Reusa la dark palette oficial #0D1117 / #121413 + acento #00E0C3.
// ─────────────────────────────────────────────
const BannerPreview: React.FC<{
    title: string; description: string; couponCode?: string; imageUrl?: string;
}> = ({ title, description, couponCode, imageUrl }) => (
    <div className="rounded-2xl p-3" style={{ backgroundColor: BRAND_DARK }}>
        {/* Phone status bar fake */}
        <div className="flex items-center justify-between text-white px-1 mb-2">
            <p className="text-[10px] opacity-70">9:41</p>
            <p className="text-[10px] opacity-70">📶 🔋</p>
        </div>

        {/* Contenido del home placeholder (saldo + chips) */}
        <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: BRAND_PANEL }}>
            <p className="text-[9px] uppercase tracking-wider opacity-70" style={{ color: BRAND_CYAN }}>Tu saldo</p>
            <p className="text-xl font-bold text-white">$ 1.250.000 <span className="text-xs opacity-60">COP</span></p>
            <div className="grid grid-cols-3 gap-1.5 mt-2">
                {['Enviar', 'Cargar', 'Convertir'].map(b => (
                    <div key={b} className="rounded-lg py-1.5 text-center text-[9px] text-white font-semibold"
                         style={{ backgroundColor: '#0C0E0D' }}>
                        {b}
                    </div>
                ))}
            </div>
        </div>

        {/* CARTEL — doble borde cian sobre fondo oscuro */}
        <div className="relative" style={{ padding: 4 }}>
            <div
                className="rounded-2xl"
                style={{
                    backgroundColor: BRAND_DARK,
                    border: `2px solid ${BRAND_CYAN}`,
                    boxShadow: `0 0 0 4px ${BRAND_PANEL}, 0 0 0 6px ${BRAND_CYAN}40`,
                }}
            >
                {imageUrl && (
                    <img
                        src={imageUrl}
                        alt=""
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        className="w-full h-24 object-cover rounded-t-2xl"
                    />
                )}
                <div className="p-3">
                    <p className="text-sm font-bold leading-tight text-white">{title}</p>
                    <p className="text-[11px] mt-1 leading-snug text-white/70 line-clamp-3">{description}</p>
                    {couponCode && (
                        <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-bold text-[11px]"
                             style={{ backgroundColor: BRAND_CYAN, color: BRAND_DARK }}>
                            <Tag size={10} />
                            {couponCode}
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Brazo del cuy asomando (placeholder esquemático) */}
        <div className="text-center mt-2">
            <p className="text-[9px] uppercase tracking-wider opacity-50" style={{ color: BRAND_CYAN }}>
                ↑ sostenido por el Cuy
            </p>
        </div>
    </div>
);

// ─────────────────────────────────────────────
// Helpers
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

const Toggle: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
    <button
        onClick={onChange}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
        style={{ backgroundColor: checked ? BRAND_CYAN : '#CBD5E1' }}
    >
        <span
            className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
            style={{ transform: checked ? 'translateX(20px)' : 'translateX(4px)' }}
        />
    </button>
);
