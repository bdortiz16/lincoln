import React, { useState } from 'react';
import { FileText, X, Save, Eye, Code, AlertTriangle } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useToast } from '../lib/toast';
import { SectionHeader, NAVY } from './shared';

// ─────────────────────────────────────────────
// LegalDocsSection — editor de los documentos legales que consumen la web
// y las apps iOS/Android. Lee/escribe la tabla `legal_content` del proyecto
// Personas (columna content_html). A diferencia del admin viejo
// (admin-personas.html), acá el guardado ocurre con la SESIÓN AUTENTICADA
// del admin React (supabasePersonas.auth), así que la RLS de escritura
// ("solo authenticated") lo permite. Además usa .select() para CONFIRMAR
// que se actualizó una fila: si RLS bloquea, PostgREST devuelve 200 con 0
// filas y SIN error → antes eso pasaba como "guardado ok" pero no tocaba
// nada. Acá lo detectamos y avisamos.
// ─────────────────────────────────────────────
const LEGAL_DOCS: Array<{ id: string; label: string }> = [
    { id: 'terms',           label: 'Términos y Condiciones' },
    { id: 'privacy',         label: 'Política de Privacidad' },
    { id: 'data-treatment',  label: 'Tratamiento de Datos' },
    { id: 'contact',         label: 'Contacta con Nosotros' },
    { id: 'send-request',    label: 'Solicitud de Envíos' },
    { id: 'charge-request',  label: 'Solicitud de Cobro' },
    { id: 'sagrilaft',       label: 'Política Sagrilaft' },
    { id: 'add-third-party', label: 'T&C: Agregar Tercero' },
];

export const LegalDocsSection: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving]   = useState(false);
    const [preview, setPreview] = useState(false);
    const canManage = profile.role === 'super_admin' || profile.role === 'compliance';

    const openEditor = async (d: { id: string; label: string }) => {
        setEditing(d); setContent(''); setPreview(false); setLoading(true);
        const { data, error } = await supabasePersonas
            .from('legal_content').select('content_html').eq('id', d.id).maybeSingle();
        if (error) toast.error(`No pude leer ${d.label}: ${error.message}`);
        setContent((data as any)?.content_html ?? '');
        setLoading(false);
    };

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        const { data, error } = await supabasePersonas
            .from('legal_content')
            .update({
                content_html: content,
                is_active: true,                 // que quede activo → la app lo lee
                updated_at: new Date().toISOString(),
                updated_by: profile.id,          // uuid del admin (NO el email)
            })
            .eq('id', editing.id)
            .select('id');                       // confirmar filas afectadas
        setSaving(false);
        if (error) { toast.error(`No se guardó: ${error.message}`); return; }
        if (!data || data.length === 0) {
            toast.error('No se guardó: 0 filas afectadas. Revisá que el documento exista en legal_content y que la RLS permita escribir (sesión autenticada).');
            return;
        }
        toast.success(`"${editing.label}" guardado — la app lo muestra desde ahora.`);
        await logAdminAction({
            admin: profile, action: 'legal_content.update',
            targetType: 'legal_content', targetId: editing.id,
            metadata: { label: editing.label, chars: content.length },
        });
        setEditing(null);
    };

    return (
        <div className="p-4 md:p-8">
            <SectionHeader
                title="Legal"
                subtitle="Documentos legales que muestran la web y las apps iOS/Android. Se guardan en legal_content y se sirven en vivo."
            />
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F1F5F9' }}>
                        <FileText size={16} className="text-slate-600" />
                    </div>
                    <div>
                        <p className="text-sm font-bold" style={{ color: NAVY }}>Documentos legales</p>
                        <p className="text-xs text-slate-500">Editá el HTML de cada documento. Se guarda en la base y la app lo lee al instante.</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {LEGAL_DOCS.map(d => (
                        <button
                            key={d.id}
                            onClick={() => openEditor(d)}
                            className="px-3 py-3 rounded-xl border border-slate-200 bg-white hover:border-teal-300 hover:shadow-sm transition-all text-left"
                        >
                            <FileText size={14} className="text-slate-400 mb-1" />
                            <p className="text-xs font-bold leading-tight" style={{ color: NAVY }}>{d.label}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{d.id}</p>
                        </button>
                    ))}
                </div>
            </div>

            {editing && (
                <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={() => setEditing(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                            <p className="font-bold" style={{ color: NAVY }}>
                                {editing.label} <span className="font-mono text-xs text-slate-400">({editing.id})</span>
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPreview(p => !p)}
                                    className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5"
                                    style={{ color: NAVY }}
                                >
                                    {preview ? <><Code size={13} /> HTML</> : <><Eye size={13} /> Vista previa</>}
                                </button>
                                <button onClick={() => setEditing(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                                    <X size={18} className="text-slate-500" />
                                </button>
                            </div>
                        </div>
                        <div className="p-5 flex-1 overflow-y-auto">
                            {loading ? (
                                <p className="text-sm text-slate-400 text-center py-10">Cargando contenido…</p>
                            ) : preview ? (
                                <div
                                    className="prose prose-sm max-w-none border border-slate-200 rounded-xl p-4 text-sm leading-relaxed"
                                    dangerouslySetInnerHTML={{ __html: content || '<p style="color:#94a3b8">(vacío)</p>' }}
                                />
                            ) : (
                                <>
                                    <textarea
                                        value={content}
                                        onChange={e => setContent(e.target.value)}
                                        rows={18}
                                        placeholder={`Escribí el HTML de "${editing.label}"…`}
                                        className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm leading-relaxed font-mono focus:border-teal-500 outline-none resize-y"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1 text-right">{content.length.toLocaleString('es-CO')} caracteres</p>
                                </>
                            )}
                        </div>
                        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                            {!canManage
                                ? <p className="text-xs text-amber-600 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> Solo lectura (tu rol no puede editar)</p>
                                : <span />}
                            <div className="flex items-center gap-2">
                                <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                                    Cancelar
                                </button>
                                <button
                                    onClick={save}
                                    disabled={saving || loading || !canManage}
                                    className="px-4 py-2 text-sm font-bold rounded-xl text-white inline-flex items-center gap-2 disabled:opacity-50"
                                    style={{ backgroundColor: NAVY }}
                                >
                                    <Save size={14} /> {saving ? 'Guardando…' : 'Guardar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
