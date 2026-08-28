import React, { useEffect, useMemo, useState } from 'react';
import {
    Ticket, Plus, RefreshCw, AlertCircle, X, Save, Trash2, Tag,
    Copy, Check, Percent,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, NAVY, TEAL, EmptyState } from './shared';

// ─────────────────────────────────────────────
// CouponsTab — CRUD de cupones que el cliente aplica en el
// convertidor para obtener un descuento sobre la tasa.
//
// Estructura (compatible con lo que ya consume PersonalDashboard.tsx):
//   { code: string, discount: number (%), active: boolean,
//     description?: string, max_uses?: number, used_count?: number,
//     expires_at?: string|null }
//
// Persistido como array JSON en public.app_settings.value['coupons'].
// Mantenemos compat con el campo `discount` (% sobre la tasa) que
// PersonalDashboard ya lee. Los campos nuevos (description, expires_at,
// max_uses, used_count) son additivos: si Antigravity todavía no los
// lee, no rompen nada.
//
// El cliente ve el cupón aplicado en:
//   • El convertidor (input de código + label de descuento aplicado)
//   • El detalle de la TX (ver detalles → "Cupón aplicado: WELCOME20")
// ─────────────────────────────────────────────

interface Coupon {
    code: string;
    discount: number;            // % de descuento sobre la tasa
    active: boolean;
    description?: string | null;
    expires_at?: string | null;
    max_uses?: number | null;    // null = ilimitado
    used_count?: number;
    created_at?: string;
}

interface Props {
    profile: AdminProfile;
}

const APP_SETTINGS_ID = 'global';   // si tu app_settings usa otro pk, ajustar

export const CouponsTab: React.FC<Props> = ({ profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving]   = useState(false);
    const [error, setError]     = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing]   = useState<Coupon | null>(null);

    // Shape confirmado por Antigravity:
    //   app_settings(key text, value jsonb)
    //   Fila key='coupons' tiene value = { "coupons": [ { code, active, discount, expires_at? }, ... ] }
    //
    // El RPC resolve_coupon_discount lee desde value->'coupons' directo,
    // y un trigger en la tabla hace upsert correctamente sin caer en
    // duplicate key. Por eso podemos usar .upsert simple con onConflict='key'.
    const load = async () => {
        setLoading(true); setError(null);
        const { data, error: err } = await supabasePersonas
            .from('app_settings')
            .select('value')
            .eq('key', 'coupons')
            .maybeSingle();
        if (err) { setError(err.message); setLoading(false); return; }
        const arr = ((data as any)?.value?.coupons ?? []) as Coupon[];
        setCoupons(Array.isArray(arr) ? arr : []);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const persist = async (next: Coupon[]) => {
        setSaving(true); setError(null);
        const { error: upErr } = await supabasePersonas
            .from('app_settings')
            .upsert(
                { key: 'coupons', value: { coupons: next } },
                { onConflict: 'key' }
            );
        setSaving(false);
        if (upErr) { setError(upErr.message); return false; }
        setCoupons(next);
        return true;
    };

    const upsertCoupon = async (c: Coupon, isNew: boolean) => {
        const next = isNew
            ? [...coupons, { ...c, created_at: new Date().toISOString(), used_count: 0 }]
            : coupons.map(x => x.code === editing?.code ? c : x);
        const ok = await persist(next);
        if (!ok) return false;
        await logAdminAction({
            admin: profile,
            action: isNew ? 'coupon.create' : 'coupon.update',
            targetType: 'coupon', targetId: c.code,
            metadata: { code: c.code, discount: c.discount, active: c.active },
        });
        return true;
    };

    const toggleActive = async (c: Coupon) => {
        const next = coupons.map(x => x.code === c.code ? { ...x, active: !x.active } : x);
        const ok = await persist(next);
        if (!ok) return;
        await logAdminAction({
            admin: profile,
            action: c.active ? 'coupon.deactivate' : 'coupon.activate',
            targetType: 'coupon', targetId: c.code,
        });
    };

    const removeCoupon = async (c: Coupon) => {
        const ok = await confirm({
            title: 'Eliminar cupón',
            message: `¿Eliminar el cupón ${c.code}? No se puede deshacer.`,
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        const next = coupons.filter(x => x.code !== c.code);
        const saved = await persist(next);
        if (!saved) return;
        await logAdminAction({
            admin: profile, action: 'coupon.delete',
            targetType: 'coupon', targetId: c.code,
        });
    };

    const activeCount = coupons.filter(c => c.active).length;
    const totalUses   = coupons.reduce((s, c) => s + (c.used_count ?? 0), 0);

    return (
        <div className="space-y-4">
            {confirmDialog}
            <SectionHeader
                title="Cupones"
                subtitle="Códigos que el cliente aplica en el convertidor para obtener una mejor tasa"
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
                            Nuevo cupón
                        </button>
                    </div>
                }
            />

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
                <StatCard label="Activos"     value={activeCount.toString()} color="#0F766E" bg="#CCFBF1" icon={<Ticket size={14} />} />
                <StatCard label="Total"       value={coupons.length.toString()} color="#0F172A" bg="#F1F5F9" icon={<Tag size={14} />} />
                <StatCard label="Usos totales" value={totalUses.toString()} color="#1E40AF" bg="#DBEAFE" icon={<Check size={14} />} />
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">{error}</div>
            )}

            {/* Hint del flujo */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 flex items-start gap-2">
                <Percent size={14} className="mt-0.5 shrink-0" />
                <p>
                    El descuento se aplica como % <b>sobre la tasa de cambio</b> que ve el cliente
                    al convertir. Ej: cupón <code>WELCOME20</code> con 20% → la app calcula
                    <i>tasa × (1 + 20/100)</i> al mostrar lo que recibe el usuario. El cupón aplicado
                    queda registrado en el detalle de la TX para que el cliente lo vea.
                </p>
            </div>

            {/* Tabla */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3 w-16">Activo</th>
                                <th className="text-left px-4 py-3">Código</th>
                                <th className="text-left px-4 py-3">Descripción</th>
                                <th className="text-right px-4 py-3">Descuento</th>
                                <th className="text-right px-4 py-3">Usos</th>
                                <th className="text-left px-4 py-3">Vence</th>
                                <th className="text-right px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
                            )}
                            {!loading && coupons.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-12">
                                    <EmptyState icon={Ticket} title="Sin cupones" message="Creá el primero con el botón arriba." />
                                </td></tr>
                            )}
                            {coupons.map(c => {
                                const expired = c.expires_at && new Date(c.expires_at) < new Date();
                                const maxedOut = c.max_uses && (c.used_count ?? 0) >= c.max_uses;
                                return (
                                    <tr key={c.code}
                                        onClick={() => setEditing(c)}
                                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                                    >
                                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                            <Toggle checked={c.active} onChange={() => toggleActive(c)} />
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-bold text-[12px]"
                                                  style={{ backgroundColor: TEAL + '22', color: NAVY }}>
                                                <Ticket size={11} />{c.code}
                                            </span>
                                            <CopyButton text={c.code} />
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                                            {c.description || <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="font-mono font-bold text-emerald-700">+{c.discount}%</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs">
                                            {c.max_uses
                                                ? <>{c.used_count ?? 0}<span className="text-slate-400">/{c.max_uses}</span></>
                                                : <>{c.used_count ?? 0}<span className="text-slate-400"> · sin límite</span></>
                                            }
                                        </td>
                                        <td className="px-4 py-3 text-xs">
                                            {c.expires_at ? (
                                                <span className={expired ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                                                    {expired ? '⚠ Vencido · ' : ''}{c.expires_at.slice(0, 10)}
                                                </span>
                                            ) : <span className="text-slate-400">Sin vencimiento</span>}
                                            {maxedOut && <p className="text-[10px] text-amber-700 font-semibold">⚠ Sin usos disponibles</p>}
                                        </td>
                                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => removeCoupon(c)}
                                                className="p-1 rounded hover:bg-red-50 text-red-600"
                                                title="Eliminar"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {saving && <p className="text-[11px] text-slate-400 italic text-right">Guardando…</p>}

            {(creating || editing) && (
                <CouponModal
                    coupon={editing}
                    existingCodes={coupons.map(c => c.code)}
                    onClose={() => { setCreating(false); setEditing(null); }}
                    onSave={async (c) => {
                        const ok = await upsertCoupon(c, !editing);
                        if (ok) { setCreating(false); setEditing(null); }
                    }}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Modal crear / editar
// ─────────────────────────────────────────────
const CouponModal: React.FC<{
    coupon: Coupon | null;
    existingCodes: string[];
    onClose: () => void;
    onSave: (c: Coupon) => Promise<void>;
}> = ({ coupon, existingCodes, onClose, onSave }) => {
    const isEdit = !!coupon;
    const [code, setCode]             = useState(coupon?.code ?? '');
    const [discount, setDiscount]     = useState<number>(coupon?.discount ?? 10);
    const [description, setDesc]      = useState(coupon?.description ?? '');
    const [expiresAt, setExpiresAt]   = useState(coupon?.expires_at?.slice(0, 10) ?? '');
    const [maxUses, setMaxUses]       = useState<number | ''>(coupon?.max_uses ?? '');
    const [isActive, setIsActive]     = useState(coupon?.active ?? true);
    const [busy, setBusy]             = useState(false);
    const [err, setErr]               = useState<string | null>(null);

    const codeUpper = code.trim().toUpperCase();
    const codeTaken = !isEdit && existingCodes.includes(codeUpper);

    const save = async () => {
        if (!codeUpper) { setErr('El código es obligatorio.'); return; }
        if (codeTaken)  { setErr('Ya existe un cupón con ese código.'); return; }
        if (discount <= 0 || discount > 100) { setErr('Descuento debe estar entre 0.01 y 100.'); return; }
        setBusy(true); setErr(null);
        await onSave({
            code:        codeUpper,
            discount,
            active:      isActive,
            description: description.trim() || null,
            expires_at:  expiresAt ? new Date(expiresAt + 'T23:59:59').toISOString() : null,
            max_uses:    maxUses === '' ? null : Number(maxUses),
            used_count:  coupon?.used_count ?? 0,
            created_at:  coupon?.created_at,
        });
        setBusy(false);
    };

    // Preview del cálculo
    const sampleRate = 4000; // ej. 1 USD = 4000 COP
    const improved   = sampleRate * (1 + discount / 100);

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
                 onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                    <p className="font-bold" style={{ color: NAVY }}>
                        {isEdit ? `Editar cupón ${coupon!.code}` : 'Nuevo cupón'}
                    </p>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-900"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Código *" hint="Mayúsculas, sin espacios. Ej: WELCOME20">
                            <input
                                value={code}
                                onChange={e => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                                placeholder="WELCOME20"
                                maxLength={24}
                                disabled={isEdit}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono font-bold disabled:bg-slate-50"
                            />
                            {codeTaken && (
                                <p className="text-[10px] text-red-600 mt-0.5">Este código ya existe</p>
                            )}
                        </Field>
                        <Field label="Descuento (% sobre la tasa) *" icon={<Percent size={10} />}>
                            <input
                                type="number"
                                min={0.01} max={100} step={0.01}
                                value={discount}
                                onChange={e => setDiscount(Number(e.target.value))}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono font-bold text-emerald-700"
                            />
                        </Field>
                    </div>

                    <Field label="Descripción (opcional)" hint="Texto interno para que el equipo recuerde de qué campaña es">
                        <input
                            value={description}
                            onChange={e => setDesc(e.target.value)}
                            placeholder="Ej: campaña Black Friday 2026 — solo nuevos usuarios"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                        />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Vence el (opcional)">
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={e => setExpiresAt(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                            />
                        </Field>
                        <Field label="Máximo de usos (opcional)" hint="Vacío = sin límite">
                            <input
                                type="number"
                                min={1}
                                value={maxUses}
                                onChange={e => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))}
                                placeholder="100"
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                            />
                        </Field>
                    </div>

                    {/* Preview del impacto */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Preview del descuento</p>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                                <p className="text-slate-500">Tasa normal</p>
                                <p className="font-mono font-bold" style={{ color: NAVY }}>1 USD = {sampleRate.toLocaleString('es-CO')} COP</p>
                            </div>
                            <div>
                                <p className="text-emerald-700">Con el cupón ({discount}%)</p>
                                <p className="font-mono font-bold text-emerald-700">1 USD = {improved.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP</p>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">
                            Por cada 100 USD, el cliente recibe <b className="text-emerald-700">{(100 * improved).toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP</b> en
                            lugar de {(100 * sampleRate).toLocaleString('es-CO')} COP.
                        </p>
                    </div>

                    {/* Active toggle */}
                    <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold" style={{ color: NAVY }}>
                                {isActive ? 'Activo — el cliente puede usarlo' : 'Inactivo — no se aplica'}
                            </p>
                            <p className="text-[10px] text-slate-500">
                                Podés activar/desactivar más tarde desde la tabla
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
                            disabled={busy || !codeUpper || codeTaken}
                            className="px-3 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-1 disabled:opacity-50"
                            style={{ backgroundColor: NAVY }}
                        >
                            <Save size={13} /> {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear cupón')}
                        </button>
                        <button onClick={onClose} className="ml-auto px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

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
        style={{ backgroundColor: checked ? TEAL : '#CBD5E1' }}
    >
        <span
            className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
            style={{ transform: checked ? 'translateX(20px)' : 'translateX(4px)' }}
        />
    </button>
);

const StatCard: React.FC<{ label: string; value: string; color: string; bg: string; icon: React.ReactNode }> = ({ label, value, color, bg, icon }) => (
    <div className="rounded-xl p-3" style={{ backgroundColor: bg }}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color, opacity: 0.7 }}>
            {icon}
            {label}
        </div>
        <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
);

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const onCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore */ }
    };
    return (
        <button onClick={onCopy} className="ml-1.5 p-0.5 rounded hover:bg-slate-100 text-slate-400" title="Copiar">
            {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
        </button>
    );
};
