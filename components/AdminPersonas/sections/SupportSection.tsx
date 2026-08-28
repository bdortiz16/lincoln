import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Headphones, MessageSquare, Users, BookOpen, BarChart3, Megaphone,
    ExternalLink, AlertTriangle, Bot, Phone, Save, RefreshCw, Send,
    CheckCircle2, Inbox, MonitorPlay, CalendarDays, FileText, X,
    Settings2, Eye, Clock, Mail,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useToast } from '../lib/toast';
import { SectionHeader, NAVY, TEAL } from './shared';

// ─────────────────────────────────────────────
// SupportSection — centro de soporte con bandeja de Crisp EMBEBIDA.
//
// La bandeja habla con la edge function crisp-proxy (que guarda el
// token de plugin de Crisp como secret y valida el JWT del admin).
// Crisp no permite llamadas directas del browser a su API — por eso
// el proxy. Ver supabase/functions/crisp-proxy/index.ts.
// ─────────────────────────────────────────────

const CRISP_WEBSITE_ID = '972ae8c4-146c-475c-82dd-2d54a766dfbe';
const CRISP_BASE = `https://app.crisp.chat/website/${CRISP_WEBSITE_ID}`;

// Llamada genérica al proxy con el JWT del admin.
async function callCrisp(action: string, opts?: { method?: 'GET' | 'POST'; params?: Record<string, string>; body?: any }): Promise<any> {
    const env: any = (import.meta as any).env ?? {};
    const supabaseUrl = env.VITE_SUPABASE_PERSONAS_URL || env.VITE_SUPABASE_URL || '';
    const apikey      = env.VITE_SUPABASE_PERSONAS_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
    const { data: sess } = await supabasePersonas.auth.getSession();
    const token = sess?.session?.access_token ?? '';
    const qs = new URLSearchParams({ action, ...(opts?.params ?? {}) });
    const resp = await fetch(`${supabaseUrl}/functions/v1/crisp-proxy?${qs.toString()}`, {
        method: opts?.method ?? 'GET',
        headers: {
            'Authorization': `Bearer ${token || apikey}`,
            'apikey': apikey,
            'Content-Type': 'application/json',
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
    if (resp.status === 404) return { error: 'proxy_not_deployed' };
    return resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
}

interface Conv {
    session_id: string;
    nickname: string;
    email: string | null;
    avatar: string | null;
    state: string;
    unread: number;
    updated_at: number;
    last_message: string;
}
interface Msg {
    fingerprint: number;
    from: 'user' | 'operator';
    type: string;
    content: string;
    timestamp: number;
    nickname: string | null;
}

// ─────────────────────────────────────────────
// CrispInbox — la bandeja embebida (lista + hilo + composer)
// ─────────────────────────────────────────────
const CrispInbox: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [convs, setConvs]           = useState<Conv[]>([]);
    const [loadingConvs, setLoadingConvs] = useState(true);
    const [active, setActive]         = useState<Conv | null>(null);
    const [msgs, setMsgs]             = useState<Msg[]>([]);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [draft, setDraft]           = useState('');
    const [sending, setSending]       = useState(false);
    const [setupHint, setSetupHint]   = useState<string | null>(null);
    const [fatal, setFatal]           = useState<string | null>(null);
    const threadRef = useRef<HTMLDivElement>(null);

    const loadConvs = useCallback(async (silent = false) => {
        if (!silent) setLoadingConvs(true);
        const r = await callCrisp('conversations', { params: { page: '1' } });
        if (r?.error === 'proxy_not_deployed') { setFatal('proxy'); setLoadingConvs(false); return; }
        if (r?.error === 'crisp_not_configured') { setSetupHint(r.hint ?? 'Faltan secrets de Crisp'); setLoadingConvs(false); return; }
        if (r?.error) { setFatal(String(r.detail?.reason ?? r.detail ?? r.error)); setLoadingConvs(false); return; }
        setSetupHint(null); setFatal(null);
        setConvs(r?.conversations ?? []);
        setLoadingConvs(false);
    }, []);

    const loadMsgs = useCallback(async (sid: string, silent = false) => {
        if (!silent) setLoadingMsgs(true);
        const r = await callCrisp('messages', { params: { session_id: sid } });
        if (!r?.error) {
            setMsgs(r?.messages ?? []);
            // autoscroll al fondo
            setTimeout(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }), 50);
        }
        setLoadingMsgs(false);
    }, []);

    useEffect(() => { loadConvs(); }, [loadConvs]);

    // Poll: hilo activo cada 15s, lista cada 45s
    useEffect(() => {
        if (!active) return;
        const t = setInterval(() => loadMsgs(active.session_id, true), 15000);
        return () => clearInterval(t);
    }, [active, loadMsgs]);
    useEffect(() => {
        const t = setInterval(() => loadConvs(true), 45000);
        return () => clearInterval(t);
    }, [loadConvs]);

    const openConv = (c: Conv) => { setActive(c); setMsgs([]); loadMsgs(c.session_id); };

    const send = async () => {
        if (!active || !draft.trim() || sending) return;
        setSending(true);
        const content = draft.trim();
        const r = await callCrisp('send', { method: 'POST', body: { session_id: active.session_id, content, nickname: profile.full_name ?? 'Lincoin Soporte' } });
        setSending(false);
        if (r?.error) { toast.error(`No se envió: ${r.detail?.reason ?? r.error}`); return; }
        setDraft('');
        // Optimista: agregamos el mensaje al hilo sin esperar el poll
        setMsgs(prev => [...prev, { fingerprint: Date.now(), from: 'operator', type: 'text', content, timestamp: Date.now(), nickname: profile.full_name ?? 'Soporte' }]);
        setTimeout(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }), 50);
        await logAdminAction({ admin: profile, action: 'crisp.message_sent', targetType: 'crisp_conversation', targetId: active.session_id, metadata: { chars: content.length } });
    };

    const resolve = async () => {
        if (!active) return;
        const r = await callCrisp('resolve', { method: 'POST', body: { session_id: active.session_id } });
        if (r?.error) { toast.error(`No pude resolver: ${r.detail?.reason ?? r.error}`); return; }
        toast.success('Conversación marcada como resuelta.');
        setConvs(prev => prev.map(c => c.session_id === active.session_id ? { ...c, state: 'resolved' } : c));
        setActive(prev => prev ? { ...prev, state: 'resolved' } : prev);
    };

    // ── Estados especiales ──
    if (fatal === 'proxy') {
        return (
            <SetupCard title="Falta deployar la edge function crisp-proxy">
                <p>La bandeja embebida necesita la función <code>crisp-proxy</code> en Supabase (repo: <code>supabase/functions/crisp-proxy/index.ts</code>).</p>
                <p className="mt-1">Pegala en el Dashboard → Edge Functions → New function → <b>crisp-proxy</b> → Deploy, y configurá los secrets <code>CRISP_IDENTIFIER</code> y <code>CRISP_KEY</code>.</p>
            </SetupCard>
        );
    }
    if (setupHint) {
        return (
            <SetupCard title="Conectar Crisp por API">
                <p>{setupHint}</p>
                <ol className="list-decimal ml-4 mt-2 space-y-1">
                    <li>Entrá a <a className="underline font-semibold" href="https://marketplace.crisp.chat" target="_blank" rel="noreferrer">marketplace.crisp.chat</a> → New Plugin (privado)</li>
                    <li>En el plugin → <b>API tokens</b> → generá identifier + key con scopes de conversaciones (sessions read, messages read/write, states write)</li>
                    <li>Activá el plugin en el website de Lincoin</li>
                    <li>Supabase → Edge Functions → Secrets → agregá <code>CRISP_IDENTIFIER</code> y <code>CRISP_KEY</code></li>
                </ol>
            </SetupCard>
        );
    }
    if (fatal) {
        return (
            <SetupCard title="Error hablando con Crisp">
                <p className="font-mono text-[11px]">{fatal}</p>
                <button onClick={() => loadConvs()} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ backgroundColor: NAVY }}>Reintentar</button>
            </SetupCard>
        );
    }

    const stateBadge = (s: string) => {
        const map: Record<string, { bg: string; tx: string; label: string }> = {
            pending:    { bg: '#FEF3C7', tx: '#92400E', label: 'Pendiente' },
            unresolved: { bg: '#DBEAFE', tx: '#1E40AF', label: 'Abierta' },
            resolved:   { bg: '#D1FAE5', tx: '#065F46', label: 'Resuelta' },
        };
        const v = map[s] ?? { bg: '#F1F5F9', tx: '#475569', label: s };
        return <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: v.bg, color: v.tx }}>{v.label}</span>;
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100" style={{ backgroundColor: NAVY }}>
                <div className="flex items-center gap-2">
                    <Inbox size={15} style={{ color: TEAL }} />
                    <p className="text-sm font-bold text-white">Bandeja de entrada</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: TEAL + '33', color: TEAL }}>
                        {convs.length} conversaciones
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => { loadConvs(); if (active) loadMsgs(active.session_id); }} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300" title="Refrescar">
                        <RefreshCw size={13} className={loadingConvs ? 'animate-spin' : ''} />
                    </button>
                    <a href={`${CRISP_BASE}/inbox/`} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300" title="Abrir en Crisp">
                        <ExternalLink size={13} />
                    </a>
                </div>
            </div>

            <div className="flex" style={{ height: '540px' }}>
                {/* Lista de conversaciones */}
                <div className="w-72 shrink-0 border-r border-slate-100 overflow-y-auto">
                    {loadingConvs && convs.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-10">Cargando conversaciones…</p>
                    )}
                    {!loadingConvs && convs.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-10">Sin conversaciones todavía</p>
                    )}
                    {convs.map(c => (
                        <button
                            key={c.session_id}
                            onClick={() => openConv(c)}
                            className={`w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition-colors ${active?.session_id === c.session_id ? 'bg-teal-50' : ''}`}
                        >
                            <div className="flex items-center gap-2">
                                {c.avatar
                                    ? <img src={c.avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                                    : <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: TEAL, color: NAVY }}>
                                        {(c.nickname?.[0] ?? '?').toUpperCase()}
                                      </div>}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-xs font-bold truncate" style={{ color: NAVY }}>{c.nickname}</p>
                                        {c.unread > 0 && <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shrink-0">{c.unread}</span>}
                                    </div>
                                    <p className="text-[11px] text-slate-500 truncate">{c.last_message || '—'}</p>
                                </div>
                                {stateBadge(c.state)}
                            </div>
                        </button>
                    ))}
                </div>

                {/* Hilo */}
                <div className="flex-1 flex flex-col min-w-0">
                    {!active ? (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <MessageSquare size={28} className="mx-auto text-slate-300 mb-2" />
                                <p className="text-xs text-slate-400">Elegí una conversación de la lista</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Header del hilo */}
                            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                                <div className="min-w-0">
                                    <p className="text-sm font-bold truncate" style={{ color: NAVY }}>{active.nickname}</p>
                                    {active.email && <p className="text-[11px] text-slate-500 truncate">{active.email}</p>}
                                </div>
                                {active.state !== 'resolved' && (
                                    <button
                                        onClick={resolve}
                                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 inline-flex items-center gap-1"
                                    >
                                        <CheckCircle2 size={12} /> Resolver
                                    </button>
                                )}
                            </div>
                            {/* Mensajes */}
                            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-slate-50/50">
                                {loadingMsgs && msgs.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Cargando mensajes…</p>}
                                {msgs.map(m => (
                                    <div key={m.fingerprint} className={`flex ${m.from === 'operator' ? 'justify-end' : 'justify-start'}`}>
                                        <div
                                            className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                                                m.from === 'operator'
                                                    ? 'text-white rounded-br-md'
                                                    : 'bg-white border border-slate-200 rounded-bl-md'
                                            }`}
                                            style={m.from === 'operator' ? { backgroundColor: NAVY } : { color: NAVY }}
                                        >
                                            {m.type !== 'text' && <span className="text-[10px] uppercase font-bold opacity-60 block">[{m.type}]</span>}
                                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                                            <p className={`text-[9px] mt-1 ${m.from === 'operator' ? 'text-slate-300' : 'text-slate-400'}`}>
                                                {new Date(m.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {/* Composer */}
                            <div className="flex items-center gap-2 px-3 py-3 border-t border-slate-100">
                                <input
                                    value={draft}
                                    onChange={e => setDraft(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                                    placeholder="Escribí tu respuesta…"
                                    className="flex-1 px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-teal-500 outline-none"
                                />
                                <button
                                    onClick={send}
                                    disabled={sending || !draft.trim()}
                                    className="p-2.5 rounded-xl text-white disabled:opacity-50"
                                    style={{ backgroundColor: TEAL }}
                                    title="Enviar (Enter)"
                                >
                                    <Send size={16} style={{ color: NAVY }} />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const SetupCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-xs text-amber-900">
        <p className="text-sm font-bold mb-2 flex items-center gap-2"><AlertTriangle size={14} /> {title}</p>
        {children}
    </div>
);

// ─────────────────────────────────────────────
// WhatsAppSettingCard — edita app_settings key='support_whatsapp'.
// ─────────────────────────────────────────────
const WhatsAppSettingCard: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [value, setValue]     = useState('');
    const [initial, setInitial] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving]   = useState(false);
    const canManage = profile.role === 'super_admin';

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabasePersonas
            .from('app_settings')
            .select('value')
            .eq('key', 'support_whatsapp')
            .maybeSingle();
        if (error) {
            toast.error(`No pude leer support_whatsapp: ${error.message}`);
            setLoading(false);
            return;
        }
        const v = (data as any)?.value;
        const num = typeof v === 'string' ? v : (v?.number ?? v?.phone ?? '');
        setValue(num);
        setInitial(num);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const save = async () => {
        const trimmed = value.trim();
        if (!/^\+?[0-9\s-]{7,20}$/.test(trimmed)) {
            toast.error('Número inválido — usá formato internacional, ej: +573001234567');
            return;
        }
        const normalized = trimmed.replace(/[\s-]/g, '');
        setSaving(true);
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert({ key: 'support_whatsapp', value: normalized }, { onConflict: 'key' });
        setSaving(false);
        if (error) {
            toast.error(`No pude actualizar: ${error.message}`);
            return;
        }
        setInitial(normalized);
        setValue(normalized);
        toast.success(`WhatsApp de soporte actualizado a ${normalized} — la app lo usa desde ahora.`);
        await logAdminAction({
            admin: profile,
            action: 'support_whatsapp.update',
            targetType: 'app_settings',
            targetId: 'support_whatsapp',
            metadata: { value: normalized },
        });
    };

    const dirty = value.trim() !== initial;

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#DCFCE7' }}>
                    <Phone size={16} className="text-emerald-600" />
                </div>
                <div>
                    <p className="text-sm font-bold" style={{ color: NAVY }}>WhatsApp de soporte</p>
                    <p className="text-xs text-slate-500">
                        El número que abre la app cuando el usuario toca "Contactar soporte"
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                    <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        disabled={loading || !canManage}
                        placeholder={loading ? 'Cargando…' : '+573001234567'}
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 text-sm font-mono focus:border-teal-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                    />
                </div>
                <button
                    onClick={save}
                    disabled={saving || loading || !dirty || !canManage}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white inline-flex items-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: NAVY }}
                >
                    <Save size={14} /> {saving ? 'Guardando…' : 'Actualizar'}
                </button>
                <button
                    onClick={load}
                    disabled={loading}
                    className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-500"
                    title="Recargar valor actual"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>
            {!canManage && (
                <p className="text-[11px] text-slate-400 mt-2">Solo Super Admin puede editar este número.</p>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// YouTubeSettingCard — edita app_settings key='support_video_url'.
// El video tutorial de YouTube que ve el usuario en la sección de
// ayuda de la app (y acá mismo con preview embebido).
// ─────────────────────────────────────────────
function extractYouTubeId(url: string): string | null {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
}

const YouTubeSettingCard: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [value, setValue]     = useState('');
    const [initial, setInitial] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving]   = useState(false);
    const canManage = profile.role === 'super_admin';

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabasePersonas
            .from('app_settings')
            .select('value')
            .eq('key', 'support_video_url')
            .maybeSingle();
        if (error) { toast.error(`No pude leer support_video_url: ${error.message}`); setLoading(false); return; }
        const v = (data as any)?.value;
        const u = typeof v === 'string' ? v : (v?.url ?? '');
        setValue(u); setInitial(u); setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const save = async () => {
        const trimmed = value.trim();
        if (trimmed && !extractYouTubeId(trimmed)) {
            toast.error('Eso no parece un link de YouTube válido (youtube.com/watch?v=… o youtu.be/…).');
            return;
        }
        setSaving(true);
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert({ key: 'support_video_url', value: trimmed }, { onConflict: 'key' });
        setSaving(false);
        if (error) { toast.error(`No pude actualizar: ${error.message}`); return; }
        setInitial(trimmed);
        toast.success(trimmed
            ? 'Video de soporte actualizado — la app lo muestra desde ahora.'
            : 'Video de soporte quitado.');
        await logAdminAction({
            admin: profile,
            action: 'support_video_url.update',
            targetType: 'app_settings',
            targetId: 'support_video_url',
            metadata: { value: trimmed || null },
        });
    };

    const videoId = extractYouTubeId(initial);
    const dirty = value.trim() !== initial;

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FEE2E2' }}>
                    <MonitorPlay size={16} className="text-red-600" />
                </div>
                <div>
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Video tutorial (YouTube)</p>
                    <p className="text-xs text-slate-500">
                        El video de ayuda que ve el usuario en la sección Soporte de la app
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
                <input
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    disabled={loading || !canManage}
                    placeholder={loading ? 'Cargando…' : 'https://www.youtube.com/watch?v=…'}
                    className="flex-1 min-w-[260px] px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-teal-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
                <button
                    onClick={save}
                    disabled={saving || loading || !dirty || !canManage}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white inline-flex items-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: NAVY }}
                >
                    <Save size={14} /> {saving ? 'Guardando…' : 'Actualizar'}
                </button>
            </div>
            {/* Preview embebido — YouTube sí permite embed */}
            {videoId && (
                <div className="mt-4 rounded-xl overflow-hidden border border-slate-200" style={{ aspectRatio: '16 / 9', maxWidth: 480 }}>
                    <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title="Video de soporte"
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                </div>
            )}
            {!canManage && (
                <p className="text-[11px] text-slate-400 mt-2">Solo Super Admin puede editar el video.</p>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// CalendlySettingCard — edita app_settings key='calendly_url'.
// Este link alimenta 3 CTAs de la landing: "Agenda una reunión"
// (Empresas), "Habla con un Especialista" y "Solicita una Demo".
// ─────────────────────────────────────────────
const CalendlySettingCard: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [value, setValue]     = useState('');
    const [initial, setInitial] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving]   = useState(false);
    const canManage = profile.role === 'super_admin';

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabasePersonas
            .from('app_settings').select('value').eq('key', 'calendly_url').maybeSingle();
        if (error) { toast.error(`No pude leer calendly_url: ${error.message}`); setLoading(false); return; }
        const v = (data as any)?.value;
        const u = typeof v === 'string' ? v : (v?.url ?? '');
        setValue(u); setInitial(u); setLoading(false);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const save = async () => {
        const trimmed = value.trim();
        if (trimmed && !/^https:\/\/(www\.)?calendly\.com\//.test(trimmed)) {
            toast.error('El link debe ser de Calendly (https://calendly.com/…).');
            return;
        }
        setSaving(true);
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert({ key: 'calendly_url', value: trimmed }, { onConflict: 'key' });
        setSaving(false);
        if (error) { toast.error(`No pude actualizar: ${error.message}`); return; }
        setInitial(trimmed);
        toast.success('Link de Calendly actualizado — la landing lo usa desde ahora.');
        await logAdminAction({
            admin: profile, action: 'calendly_url.update',
            targetType: 'app_settings', targetId: 'calendly_url',
            metadata: { value: trimmed || null },
        });
    };

    const dirty = value.trim() !== initial;
    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#DBEAFE' }}>
                    <CalendarDays size={16} className="text-blue-600" />
                </div>
                <div>
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Link de Calendly</p>
                    <p className="text-xs text-slate-500">
                        Lo usan "Agenda una reunión", "Habla con un Especialista" y "Solicita una Demo" en la web
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
                <input
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    disabled={loading || !canManage}
                    placeholder={loading ? 'Cargando…' : 'https://calendly.com/tu-usuario/reunion'}
                    className="flex-1 min-w-[260px] px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-teal-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
                <button
                    onClick={save}
                    disabled={saving || loading || !dirty || !canManage}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white inline-flex items-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: NAVY }}
                >
                    <Save size={14} /> {saving ? 'Guardando…' : 'Actualizar'}
                </button>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// PageDocsCard — "Documentación de páginas": editores de los textos
// legales/informativos del footer de la landing. Cada página vive en
// app_settings con su propia key; la web pública lee esos textos.
// ─────────────────────────────────────────────
const SITE_PAGES: Array<{ key: string; label: string }> = [
    { key: 'page_data_treatment',    label: 'Tratamiento de datos' },
    { key: 'page_terms',             label: 'Términos y Condiciones' },
    { key: 'page_contact',           label: 'Contacta con Nosotros' },
    { key: 'page_shipping_request',  label: 'Solicitud de Envíos' },
    { key: 'page_collection_request', label: 'Solicitud de Cobro' },
    { key: 'page_sagrilaft',         label: 'Política Sagrilaft' },
    // Textos legales que consumen las APPS (iOS/Android) en vivo:
    { key: 'legal_add_beneficiary_terms', label: 'T&C: Agregar Tercero (app)' },
];

export const PageDocsCard: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [editing, setEditing] = useState<{ key: string; label: string } | null>(null);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving]   = useState(false);
    const canManage = profile.role === 'super_admin';

    const openEditor = async (p: { key: string; label: string }) => {
        setEditing(p); setContent(''); setLoading(true);
        const { data, error } = await supabasePersonas
            .from('app_settings').select('value').eq('key', p.key).maybeSingle();
        if (error) toast.error(`No pude leer ${p.label}: ${error.message}`);
        const v = (data as any)?.value;
        setContent(typeof v === 'string' ? v : (v?.content ?? ''));
        setLoading(false);
    };

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert({ key: editing.key, value: content }, { onConflict: 'key' });
        setSaving(false);
        if (error) { toast.error(`No pude guardar: ${error.message}`); return; }
        toast.success(`"${editing.label}" actualizado — la web lo muestra desde ahora.`);
        await logAdminAction({
            admin: profile, action: 'site_page.update',
            targetType: 'app_settings', targetId: editing.key,
            metadata: { label: editing.label, chars: content.length },
        });
        setEditing(null);
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F1F5F9' }}>
                    <FileText size={16} className="text-slate-600" />
                </div>
                <div>
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Documentación de páginas</p>
                    <p className="text-xs text-slate-500">
                        Editá el texto de las páginas del sitio y los legales que muestran las apps iOS/Android
                    </p>
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SITE_PAGES.map(p => (
                    <button
                        key={p.key}
                        onClick={() => openEditor(p)}
                        disabled={!canManage}
                        className="px-3 py-3 rounded-xl border border-slate-200 bg-white hover:border-teal-300 hover:shadow-sm transition-all text-left disabled:opacity-60"
                    >
                        <FileText size={14} className="text-slate-400 mb-1" />
                        <p className="text-xs font-bold leading-tight" style={{ color: NAVY }}>{p.label}</p>
                    </button>
                ))}
            </div>

            {editing && (
                <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={() => setEditing(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                            <p className="font-bold" style={{ color: NAVY }}>{editing.label}</p>
                            <button onClick={() => setEditing(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="p-5 flex-1 overflow-y-auto">
                            {loading ? (
                                <p className="text-sm text-slate-400 text-center py-10">Cargando contenido…</p>
                            ) : (
                                <>
                                    <textarea
                                        value={content}
                                        onChange={e => setContent(e.target.value)}
                                        rows={16}
                                        placeholder={`Escribí acá el contenido de "${editing.label}"…`}
                                        className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm leading-relaxed focus:border-teal-500 outline-none resize-y"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1 text-right">{content.length.toLocaleString('es-CO')} caracteres</p>
                                </>
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                            <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                                Cancelar
                            </button>
                            <button
                                onClick={save}
                                disabled={saving || loading}
                                className="px-4 py-2 text-sm font-bold rounded-xl text-white inline-flex items-center gap-2 disabled:opacity-50"
                                style={{ backgroundColor: NAVY }}
                            >
                                <Save size={14} /> {saving ? 'Guardando…' : 'Guardar página'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// EmailFormatCard — "Formato de correos": vista previa del diseño de
// marca que llevan TODOS los correos transaccionales (header navy +
// logo, línea accent por tipo de evento, hero, CTA, footer) y el mapa
// de qué edge function envía cada notificación + qué webhook necesita.
// El diseño real vive en las edges (notify-transaction,
// send-compliance-email, notify-limit-increase, notify-account-events);
// esta tarjeta lo replica para previsualizar.
// ─────────────────────────────────────────────
const EMAIL_SAMPLES: Array<{ id: string; label: string; hero: string; accent: string; title: string; body: string; cta: string }> = [
    {
        id: 'kyc', label: 'Cuenta aprobada', accent: '#10B981', hero: 'Cuenta aprobada',
        title: 'Verificación completada',
        body: 'Hola <strong>Bryan David</strong>, ¡bienvenido! Tu identidad fue verificada con éxito y tu cuenta Lincoin quedó completamente activa. Ya puedes cargar dinero, enviar a tus contactos y convertir divisas.',
        cta: 'Abrir Lincoin →',
    },
    {
        id: 'tx', label: 'Envío realizado', accent: '#2DD4BF', hero: 'Envío realizado',
        title: 'COP 200.000,00',
        body: 'Hola <strong>Bryan David</strong>, tu envío a <strong>Kevin Andrés López</strong> fue procesado con éxito. Hemos debitado COP 200.000,00 de tu saldo.',
        cta: 'Ver transacción →',
    },
    {
        id: 'sec', label: 'Alerta de seguridad', accent: '#F59E0B', hero: 'Alerta de seguridad',
        title: 'Tu PIN fue actualizado',
        body: 'Hola <strong>Bryan David</strong>, tu PIN de seguridad fue cambiado correctamente. <strong>Si no fuiste tú, responde a este correo de inmediato.</strong>',
        cta: 'Revisar seguridad',
    },
    {
        id: 'reject', label: 'Rechazo', accent: '#DC2626', hero: 'Documentación rechazada',
        title: 'Ampliación de topes',
        body: 'Hola <strong>Bryan David</strong>, lamentablemente no pudimos aprobar tu solicitud. <strong>Motivo:</strong> los documentos no son legibles. Puedes volver a intentarlo con documentación adicional.',
        cta: 'Contactar soporte',
    },
    {
        id: 'otp', label: 'Código de verificación', accent: '#2DD4BF', hero: 'Verificación',
        title: 'Tu código de verificación',
        body: 'Usa este código para verificar tu correo en Lincoin. Expira en 10 minutos.<div style="margin:18px 0;padding:18px;background:#F1F5F9;border-radius:12px;text-align:center;font-size:34px;font-weight:800;letter-spacing:10px;color:#0F172A;font-family:monospace">511551</div>Si no solicitaste este código, ignora este correo.',
        cta: 'Abrir Lincoin →',
    },
];

const EMAIL_LOGO_URI = `data:image/svg+xml;base64,${btoa(`
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="96" height="96" rx="22" fill="#0F172A"/>
  <rect x="22" y="22" width="56" height="56" rx="16" fill="none" stroke="#2DD4BF" stroke-width="7" stroke-linejoin="round"/>
  <circle cx="58" cy="56" r="8" fill="#2DD4BF"/>
</svg>`.trim())}`;

function buildSampleEmail(s: typeof EMAIL_SAMPLES[number], footerNote = ''): string {
    const noteHtml = footerNote.trim()
        ? `<div style="margin:20px 0 0 0;padding:12px 14px;background:#F8FAFC;border:1px solid #e2e8f0;border-radius:10px">
             <p style="margin:0;font-size:10px;color:#64748b;line-height:1.7">${footerNote
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>
           </div>`
        : '';
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08)">
<tr><td style="background:#0F172A;padding:22px 28px">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="width:42px;height:42px;vertical-align:middle"><img src="${EMAIL_LOGO_URI}" width="42" height="42" style="display:block;border-radius:10px"/></td>
    <td style="padding-left:12px;vertical-align:middle">
      <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px">CUY<span style="color:#2DD4BF">PAY</span></span>
      <div style="margin-top:2px;font-size:10px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase">Notificaciones</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="background:${s.accent};height:4px;font-size:1px">&zwnj;</td></tr>
<tr><td style="background:#fff;padding:30px 28px 24px">
  <p style="margin:0 0 6px 0;font-size:10px;font-weight:700;color:${s.accent};text-transform:uppercase;letter-spacing:1.5px">${s.hero}</p>
  <p style="margin:0 0 8px 0;font-size:24px;font-weight:800;color:#0F172A;letter-spacing:-0.5px;line-height:1.2">${s.title}</p>
  <div style="border-top:1px solid #f1f5f9;margin:18px 0"></div>
  <p style="margin:0 0 20px 0;font-size:14px;color:#475569;line-height:1.7">${s.body}</p>
  <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#0F172A">
    <a href="#" style="display:inline-block;padding:12px 26px;font-size:13px;font-weight:700;color:#fff;text-decoration:none">${s.cta}</a>
  </td></tr></table>
  <p style="margin:22px 0 0 0;font-size:11px;color:#94a3b8;line-height:1.6">Si no reconocés esta actividad, contactanos respondiendo a este correo o desde el chat de soporte.</p>
  ${noteHtml}
</td></tr>
<tr><td style="background:#0F172A;padding:16px 28px">
  <table width="100%"><tr>
    <td><p style="margin:0;font-size:10px;color:rgba(255,255,255,0.45)">&copy; 2026 Lincoin &middot; Todos los derechos reservados</p></td>
    <td align="right"><span style="font-size:10px;color:#2DD4BF;font-weight:600">cuypay.com</span></td>
  </tr></table>
</td></tr>
</table></td></tr></table></body></html>`;
}

// Mapa de notificaciones: evento → edge → webhook que lo dispara
const EMAIL_EVENTS: Array<{ group: string; events: string; edge: string; webhook: string }> = [
    { group: 'Transacciones',      events: 'Cargues, envíos, conversiones (creadas y completadas)',                          edge: 'notify-transaction',      webhook: 'transactions · INSERT + UPDATE' },
    { group: 'Cuenta',             events: 'Aprobación/rechazo de cuenta (KYC), bloqueo/reactivación',                       edge: 'notify-account-events',   webhook: 'users · UPDATE' },
    { group: 'Seguridad',          events: 'PIN cambiado/reseteado, 2FA activado/desactivado, cambio de correo (siempre se envían)', edge: 'notify-account-events',   webhook: 'users · UPDATE (el mismo)' },
    { group: 'Terceros',           events: 'Contacto aprobado/rechazado, bloqueado/reactivado (al dueño)',                   edge: 'notify-account-events',   webhook: 'beneficiaries · UPDATE' },
    { group: 'Documentación',      events: 'Solicitud de docs aprobada/rechazada/reabierta',                                 edge: 'send-compliance-email',   webhook: 'document_requests · UPDATE' },
    { group: 'Topes',              events: 'Ampliación de topes aprobada/rechazada (correo + push FCM)',                     edge: 'notify-limit-increase',   webhook: 'limit_increase_requests · UPDATE' },
    { group: 'Códigos de verificación', events: 'OTP de correo, registro, recuperación de clave (los "pines")',              edge: 'Supabase Auth',           webhook: 'Authentication → Email Templates (pegar template de marca)' },
];

// Catálogo de eventos con textos editables. Los keys tienen que coincidir
// EXACTO con los que leen las edges (TPL[key]).
const TPL_EVENTS: Array<{ group: string; vars: string; items: Array<[string, string]> }> = [
    {
        group: 'Transacciones', vars: '{nombre} {monto} {de} {para}',
        items: [
            ['tx_load', 'Depósito recibido (en revisión)'],
            ['tx_send', 'Retiro en proceso'],
            ['tx_convert', 'Conversión completada'],
            ['tx_pay_received', 'Dinero recibido'],
            ['tx_pay_sent', 'Transferencia enviada'],
            ['tx_otc_deposit', 'Depósito OTC acreditado'],
            ['tx_otc_withdraw', 'Retiro OTC procesado'],
        ],
    },
    {
        group: 'Cuenta', vars: '{nombre} {correo} {motivo}',
        items: [
            ['kyc_approved', 'Cuenta aprobada'],
            ['kyc_rejected', 'Verificación rechazada'],
            ['account_blocked', 'Cuenta suspendida'],
            ['account_unblocked', 'Cuenta reactivada'],
        ],
    },
    {
        group: 'Seguridad', vars: '{nombre} {correo}',
        items: [
            ['pin_changed', 'PIN actualizado'],
            ['pin_reset', 'PIN reseteado'],
            ['2fa_on', '2FA activado'],
            ['2fa_off', '2FA desactivado'],
            ['email_changed', 'Correo de acceso cambiado'],
        ],
    },
    {
        group: 'Terceros', vars: '{nombre} {contacto} {motivo}',
        items: [
            ['ben_approved', 'Contacto aprobado'],
            ['ben_rejected', 'Contacto rechazado'],
            ['ben_blocked', 'Contacto bloqueado'],
            ['ben_unblocked', 'Contacto reactivado'],
        ],
    },
    {
        group: 'Documentación', vars: '{nombre} {categoria} {motivo}',
        items: [
            ['doc_approved', 'Documentación aprobada'],
            ['doc_rejected', 'Documentación rechazada'],
            ['doc_reopened', 'Solicitud reabierta'],
        ],
    },
    {
        group: 'Topes', vars: '{nombre} {monto} {contacto} {motivo}',
        items: [
            ['limit_approved', 'Ampliación aprobada'],
            ['limit_rejected', 'Ampliación rechazada'],
        ],
    },
];

const EmailFormatCard: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [sample, setSample] = useState(EMAIL_SAMPLES[0]);
    // Bloque editable de términos/información: app_settings 'email_footer_note'.
    // Las edges lo leen en cada envío y lo pintan al pie de todos los correos.
    const [footerNote, setFooterNote] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    const canManage = profile.role === 'super_admin';
    // Textos por evento (app_settings 'email_templates'): {key: {subject,title,message}}
    const [templates, setTemplates] = useState<Record<string, any>>({});
    const [tplKey, setTplKey] = useState('');
    const [tplDraft, setTplDraft] = useState<{ subject: string; title: string; message: string }>({ subject: '', title: '', message: '' });
    const [tplSaving, setTplSaving] = useState(false);

    useEffect(() => {
        (async () => {
            const { data } = await supabasePersonas
                .from('app_settings').select('key, value').in('key', ['email_footer_note', 'email_templates']);
            for (const row of (data ?? []) as any[]) {
                if (row.key === 'email_footer_note') {
                    const v = row.value;
                    setFooterNote(typeof v === 'string' ? v : (v?.content ?? ''));
                }
                if (row.key === 'email_templates' && row.value && typeof row.value === 'object') {
                    setTemplates(row.value);
                }
            }
        })();
    }, []);

    const selectTplKey = (key: string) => {
        setTplKey(key);
        const t = templates[key] ?? {};
        setTplDraft({ subject: t.subject ?? '', title: t.title ?? '', message: t.message ?? '' });
    };

    const tplGroup = TPL_EVENTS.find(g => g.items.some(([k]) => k === tplKey));

    const saveTemplate = async (reset = false) => {
        if (!tplKey) return;
        setTplSaving(true);
        const next = { ...templates };
        if (reset) {
            delete next[tplKey];
        } else {
            const clean: Record<string, string> = {};
            if (tplDraft.subject.trim()) clean.subject = tplDraft.subject.trim();
            if (tplDraft.title.trim())   clean.title   = tplDraft.title.trim();
            if (tplDraft.message.trim()) clean.message = tplDraft.message.trim();
            if (Object.keys(clean).length === 0) delete next[tplKey];
            else next[tplKey] = clean;
        }
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert({ key: 'email_templates', value: next }, { onConflict: 'key' });
        setTplSaving(false);
        if (error) { toast.error(`No pude guardar: ${error.message}`); return; }
        setTemplates(next);
        if (reset) setTplDraft({ subject: '', title: '', message: '' });
        toast.success(reset ? 'Texto restablecido al original.' : 'Textos guardados — los próximos correos los usan.');
        await logAdminAction({
            admin: profile, action: reset ? 'email_template.reset' : 'email_template.update',
            targetType: 'app_settings', targetId: `email_templates.${tplKey}`,
            metadata: {},
        });
    };

    const saveNote = async () => {
        setNoteSaving(true);
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert({ key: 'email_footer_note', value: footerNote }, { onConflict: 'key' });
        setNoteSaving(false);
        if (error) { toast.error(`No pude guardar: ${error.message}`); return; }
        toast.success('Texto guardado — los próximos correos ya lo incluyen.');
        await logAdminAction({
            admin: profile, action: 'email_footer_note.update',
            targetType: 'app_settings', targetId: 'email_footer_note',
            metadata: { chars: footerNote.length },
        });
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F1F5F9' }}>
                    <Mail size={16} className="text-slate-600" />
                </div>
                <div>
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Formato de correos</p>
                    <p className="text-xs text-slate-500">
                        Diseño de marca que llevan todas las notificaciones por correo, y qué función envía cada una
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Vista previa */}
                <div>
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        {EMAIL_SAMPLES.map(s => (
                            <button
                                key={s.id}
                                onClick={() => setSample(s)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                                style={{
                                    backgroundColor: sample.id === s.id ? NAVY : 'white',
                                    color: sample.id === s.id ? 'white' : '#475569',
                                    borderColor: '#E2E8F0',
                                }}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                    <iframe
                        title="email-preview"
                        srcDoc={buildSampleEmail(sample, footerNote)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50"
                        style={{ height: 480 }}
                        sandbox=""
                    />

                    {/* Bloque editable: términos e información extra */}
                    <div className="mt-3 border border-slate-200 rounded-xl p-3">
                        <p className="text-xs font-bold" style={{ color: NAVY }}>
                            Términos / información adicional (al pie de todos los correos)
                        </p>
                        <p className="text-[11px] text-slate-500 mb-2">
                            Lo que escribas acá aparece en el recuadro gris al final de cada correo
                            (mira la vista previa arriba). Déjalo vacío para no mostrar nada.
                        </p>
                        <textarea
                            value={footerNote}
                            onChange={e => setFooterNote(e.target.value)}
                            rows={4}
                            disabled={!canManage}
                            placeholder="Ej: Lincoin S.A.S. · NIT 901.XXX.XXX-X · Los servicios se rigen por los Términos y Condiciones publicados en cuypay.com/terminos…"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs leading-relaxed focus:border-teal-500 outline-none resize-y disabled:opacity-60"
                        />
                        <div className="flex justify-end mt-2">
                            <button
                                onClick={saveNote}
                                disabled={noteSaving || !canManage}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                                style={{ backgroundColor: NAVY }}
                            >
                                <Save size={12} /> {noteSaving ? 'Guardando…' : 'Guardar texto'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mapa de notificaciones */}
                <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Qué se envía y desde dónde</p>
                    {EMAIL_EVENTS.map(e => (
                        <div key={e.group} className="border border-slate-200 rounded-xl px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-bold" style={{ color: NAVY }}>{e.group}</p>
                                <code className="text-[10px] text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">{e.edge}</code>
                            </div>
                            <p className="text-[11px] text-slate-600 mt-0.5">{e.events}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Webhook: {e.webhook}</p>
                        </div>
                    ))}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed">
                        <p className="font-semibold text-slate-800 mb-1">Para que un grupo envíe correos:</p>
                        <p>1. La edge function debe estar desplegada (Edge Functions).</p>
                        <p>2. El secret <code>RESEND_API_KEY</code> configurado (compartido por todas).</p>
                        <p>3. El Database Webhook creado (Database → Webhooks) apuntando a la edge con la tabla y evento indicados.</p>
                        <p className="mt-1 text-slate-500">Las alertas de seguridad (PIN/2FA/correo) se envían siempre; el resto respeta las preferencias de notificación del usuario.</p>
                    </div>
                </div>
            </div>

            {/* ── Editor de textos por evento ── */}
            <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-sm font-bold mb-1" style={{ color: NAVY }}>Editar textos de los correos</p>
                <p className="text-xs text-slate-500 mb-3">
                    Elige un correo y personaliza su asunto, título y mensaje. Lo que dejes vacío usa el texto
                    original. Puedes usar variables como <code className="bg-slate-100 px-1 rounded">{'{nombre}'}</code>{' '}
                    o <code className="bg-slate-100 px-1 rounded">{'{monto}'}</code> — se reemplazan con los datos reales al enviar.
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
                    {/* Lista de eventos */}
                    <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                        {TPL_EVENTS.map(g => (
                            <div key={g.group}>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{g.group}</p>
                                {g.items.map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => selectTplKey(key)}
                                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                                        style={{
                                            backgroundColor: tplKey === key ? NAVY : 'transparent',
                                            color: tplKey === key ? 'white' : '#334155',
                                        }}
                                    >
                                        <span className="truncate">{label}</span>
                                        {templates[key] && (
                                            <span
                                                className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                                style={{
                                                    backgroundColor: tplKey === key ? 'rgba(255,255,255,0.2)' : '#CCFBF1',
                                                    color: tplKey === key ? 'white' : '#0F766E',
                                                }}
                                            >
                                                editado
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>

                    {/* Formulario del evento seleccionado */}
                    <div className="border border-slate-200 rounded-xl p-4">
                        {!tplKey && (
                            <p className="text-sm text-slate-400 text-center py-12">
                                Elige un correo de la lista para editar sus textos.
                            </p>
                        )}
                        {tplKey && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-bold" style={{ color: NAVY }}>
                                        {TPL_EVENTS.flatMap(g => g.items).find(([k]) => k === tplKey)?.[1]}
                                    </p>
                                    {tplGroup && (
                                        <p className="text-[10px] text-slate-400">
                                            Variables: <code className="bg-slate-100 px-1 rounded">{tplGroup.vars}</code>
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Asunto</label>
                                    <input
                                        value={tplDraft.subject}
                                        onChange={e => setTplDraft(d => ({ ...d, subject: e.target.value }))}
                                        disabled={!canManage}
                                        placeholder="Vacío = asunto original"
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Título (encabezado grande)</label>
                                    <input
                                        value={tplDraft.title}
                                        onChange={e => setTplDraft(d => ({ ...d, title: e.target.value }))}
                                        disabled={!canManage}
                                        placeholder="Vacío = título original"
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Mensaje</label>
                                    <textarea
                                        value={tplDraft.message}
                                        onChange={e => setTplDraft(d => ({ ...d, message: e.target.value }))}
                                        disabled={!canManage}
                                        rows={5}
                                        placeholder={'Vacío = mensaje original.\nEj: Hola {nombre}, tu depósito de {monto} fue recibido y está en revisión…'}
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm leading-relaxed resize-y disabled:opacity-60"
                                    />
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    {templates[tplKey] && (
                                        <button
                                            onClick={() => saveTemplate(true)}
                                            disabled={tplSaving || !canManage}
                                            className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
                                        >
                                            Restablecer original
                                        </button>
                                    )}
                                    <button
                                        onClick={() => saveTemplate(false)}
                                        disabled={tplSaving || !canManage}
                                        className="px-4 py-2 text-xs font-bold rounded-lg text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                                        style={{ backgroundColor: NAVY }}
                                    >
                                        <Save size={12} /> {tplSaving ? 'Guardando…' : 'Guardar textos'}
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400">
                                    Nota: el correo del código de verificación (los "pines") se edita en Supabase →
                                    Authentication → Email Templates, no desde acá.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// QuickLinksCard — los 3 "Enlaces rápidos" del footer de la landing
// (Blog / Soporte / Acerca de Nosotros). Cada uno con su URL editable
// en app_settings.
// ─────────────────────────────────────────────
const QUICK_LINKS: Array<{ key: string; label: string }> = [
    { key: 'link_blog',    label: 'Blog' },
    { key: 'link_support', label: 'Soporte' },
    { key: 'link_about',   label: 'Acerca de Nosotros' },
];

// Redes sociales del footer (los 3 iconos)
const SOCIAL_LINKS: Array<{ key: string; label: string }> = [
    { key: 'link_facebook',  label: 'Facebook' },
    { key: 'link_linkedin',  label: 'LinkedIn' },
    { key: 'link_instagram', label: 'Instagram' },
];

// Contacto del modal "Contáctanos aquí" de la landing
const CONTACT_LINKS: Array<{ key: string; label: string }> = [
    { key: 'support_email', label: 'Correo de contacto' },
];

const ALL_SITE_LINKS = [...QUICK_LINKS, ...SOCIAL_LINKS, ...CONTACT_LINKS];

const QuickLinksCard: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const toast = useToast();
    const [values, setValues]   = useState<Record<string, string>>({});
    const [initial, setInitial] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving]   = useState(false);
    const canManage = profile.role === 'super_admin';

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabasePersonas
            .from('app_settings')
            .select('key, value')
            .in('key', ALL_SITE_LINKS.map(l => l.key));
        if (error) { toast.error(`No pude leer los enlaces: ${error.message}`); setLoading(false); return; }
        const map: Record<string, string> = {};
        for (const row of (data ?? []) as any[]) {
            const v = row.value;
            map[row.key] = typeof v === 'string' ? v : (v?.url ?? v?.email ?? '');
        }
        setValues(map); setInitial(map); setLoading(false);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const dirty = ALL_SITE_LINKS.some(l => (values[l.key] ?? '') !== (initial[l.key] ?? ''));

    const save = async () => {
        for (const l of ALL_SITE_LINKS) {
            const v = (values[l.key] ?? '').trim();
            if (!v) continue;
            if (l.key === 'support_email') {
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
                    toast.error('El correo de contacto no es válido.');
                    return;
                }
            } else if (!/^https?:\/\//.test(v)) {
                toast.error(`El link de "${l.label}" debe empezar con https://`);
                return;
            }
        }
        setSaving(true);
        const rows = ALL_SITE_LINKS.map(l => ({ key: l.key, value: (values[l.key] ?? '').trim() }));
        const { error } = await supabasePersonas
            .from('app_settings')
            .upsert(rows, { onConflict: 'key' });
        setSaving(false);
        if (error) { toast.error(`No pude guardar: ${error.message}`); return; }
        setInitial({ ...values });
        toast.success('Enlaces del sitio actualizados.');
        await logAdminAction({
            admin: profile, action: 'site_links.update',
            targetType: 'app_settings', targetId: 'site_links',
            metadata: Object.fromEntries(rows.map(r => [r.key, r.value || null])),
        });
    };

    const renderGroup = (title: string, links: Array<{ key: string; label: string }>, placeholder: string) => (
        <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{title}</p>
            <div className="space-y-2">
                {links.map(l => (
                    <div key={l.key} className="flex items-center gap-2">
                        <span className="w-40 shrink-0 text-xs font-bold text-slate-600">{l.label}</span>
                        <input
                            value={values[l.key] ?? ''}
                            onChange={e => setValues(prev => ({ ...prev, [l.key]: e.target.value }))}
                            disabled={loading || !canManage}
                            placeholder={loading ? 'Cargando…' : placeholder}
                            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                        />
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#E0E7FF' }}>
                    <ExternalLink size={16} className="text-indigo-600" />
                </div>
                <div>
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Enlaces del sitio</p>
                    <p className="text-xs text-slate-500">
                        Footer de la landing: enlaces rápidos, redes sociales y correo del modal "Contáctanos"
                    </p>
                </div>
            </div>
            <div className="space-y-4">
                {renderGroup('Enlaces rápidos', QUICK_LINKS, 'https://…')}
                {renderGroup('Redes sociales', SOCIAL_LINKS, 'https://facebook.com/cuypay')}
                {renderGroup('Contacto', CONTACT_LINKS, 'soporte@cuypay.com')}
            </div>
            <div className="flex justify-end mt-3">
                <button
                    onClick={save}
                    disabled={saving || loading || !dirty || !canManage}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white inline-flex items-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: NAVY }}
                >
                    <Save size={14} /> {saving ? 'Guardando…' : 'Actualizar enlaces'}
                </button>
            </div>
        </div>
    );
};

// Accesos rápidos compactos a la consola de Crisp (pestaña nueva)
const SHORTCUTS: Array<{ icon: React.ComponentType<any>; label: string; url: string }> = [
    { icon: MessageSquare, label: 'Bandeja',    url: `${CRISP_BASE}/inbox/` },
    { icon: Users,         label: 'Contactos',  url: `${CRISP_BASE}/contacts/` },
    { icon: BookOpen,      label: 'Base de conocimiento', url: `${CRISP_BASE}/helpdesk/` },
    { icon: Bot,           label: 'Agente IA',  url: `${CRISP_BASE}/campaigns/` },
    { icon: Megaphone,     label: 'Campañas',   url: `${CRISP_BASE}/campaigns/` },
    { icon: BarChart3,     label: 'Analíticas', url: `${CRISP_BASE}/analytics/` },
];

// ─────────────────────────────────────────────
// SiteAnalytics — dashboard de visitas del sitio: cuánta gente entró a
// cada página y cuánto tiempo se quedó. Lee public.site_events (la
// landing y las páginas estáticas insertan un evento por vista y
// actualizan duration_seconds al salir).
// ─────────────────────────────────────────────
const PAGE_LABELS: Record<string, string> = {
    home:       'Página principal',
    privacy:    'Tratamiento de datos',
    terms:      'Términos y Condiciones',
    contact:    'Contacta con Nosotros',
    support:    'Soporte (página)',
    shipping:   'Solicitud de Envíos',
    collection: 'Solicitud de Cobro',
    sagrilaft:  'Política Sagrilaft',
    about:      'Acerca de Nosotros',
    blog:       'Blog',
};

interface SiteEvent { page: string; duration_seconds: number | null; created_at: string; }

const SiteAnalytics: React.FC = () => {
    const [events, setEvents]   = useState<SiteEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [range, setRange]     = useState<7 | 30>(7);

    const load = async () => {
        setLoading(true); setMissing(false);
        const since = new Date(Date.now() - range * 24 * 3600 * 1000).toISOString();
        const { data, error } = await supabasePersonas
            .from('site_events')
            .select('page, duration_seconds, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(10000);
        if (error) {
            if (/relation|Could not find the table|schema cache/i.test(error.message)) setMissing(true);
            setEvents([]); setLoading(false);
            return;
        }
        setEvents((data as SiteEvent[]) ?? []);
        setLoading(false);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);

    if (missing) {
        return (
            <SetupCard title="Falta la tabla site_events">
                <p>El tracking de visitas necesita esta tabla. Corré en el SQL Editor:</p>
                <pre className="bg-white border border-amber-200 rounded-lg p-3 text-[10px] overflow-x-auto mt-2">{`CREATE TABLE IF NOT EXISTS public.site_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page text NOT NULL,
  referrer text,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_events_insert ON public.site_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY site_events_update ON public.site_events
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY site_events_read ON public.site_events
  FOR SELECT TO authenticated USING (true);
NOTIFY pgrst, 'reload schema';`}</pre>
                <button onClick={load} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ backgroundColor: NAVY }}>Reintentar</button>
            </SetupCard>
        );
    }

    // Agregaciones
    const total = events.length;
    const withDur = events.filter(e => e.duration_seconds != null && e.duration_seconds > 0);
    const avgDur = withDur.length > 0
        ? Math.round(withDur.reduce((a, e) => a + (e.duration_seconds ?? 0), 0) / withDur.length)
        : 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = events.filter(e => new Date(e.created_at) >= today).length;

    const byPage = new Map<string, { views: number; durSum: number; durCount: number }>();
    for (const e of events) {
        const b = byPage.get(e.page) ?? { views: 0, durSum: 0, durCount: 0 };
        b.views += 1;
        if (e.duration_seconds != null && e.duration_seconds > 0) { b.durSum += e.duration_seconds; b.durCount += 1; }
        byPage.set(e.page, b);
    }
    const pageRows = Array.from(byPage.entries())
        .map(([page, b]) => ({
            page,
            label: PAGE_LABELS[page] ?? page,
            views: b.views,
            avg: b.durCount > 0 ? Math.round(b.durSum / b.durCount) : 0,
        }))
        .sort((a, b) => b.views - a.views);
    const maxViews = Math.max(1, ...pageRows.map(r => r.views));

    const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-slate-500">
                    Visitas a la landing y a las páginas del sitio, con tiempo de permanencia.
                </p>
                <div className="flex items-center gap-1">
                    {[7, 30].map(d => (
                        <button
                            key={d}
                            onClick={() => setRange(d as 7 | 30)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${range === d ? 'text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
                            style={range === d ? { backgroundColor: NAVY } : {}}
                        >
                            {d} días
                        </button>
                    ))}
                    <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Refrescar">
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1"><Eye size={11} /> Visitas ({range}d)</p>
                    <p className="text-3xl font-bold mt-1" style={{ color: NAVY }}>{total.toLocaleString('es-CO')}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1"><Eye size={11} /> Visitas hoy</p>
                    <p className="text-3xl font-bold mt-1" style={{ color: NAVY }}>{todayCount.toLocaleString('es-CO')}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1"><Clock size={11} /> Tiempo promedio</p>
                    <p className="text-3xl font-bold mt-1" style={{ color: NAVY }}>{fmtDur(avgDur)}</p>
                </div>
            </div>

            {/* Por página */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Por página</p>
                </div>
                {loading ? (
                    <p className="text-sm text-slate-400 text-center py-10">Cargando…</p>
                ) : pageRows.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-10">
                        Sin visitas registradas todavía — el tracking arranca con el próximo deploy de la landing.
                    </p>
                ) : (
                    <div className="divide-y divide-slate-50">
                        {pageRows.map(r => (
                            <div key={r.page} className="px-4 py-3">
                                <div className="flex items-center justify-between gap-3 mb-1">
                                    <p className="text-sm font-semibold" style={{ color: NAVY }}>{r.label}</p>
                                    <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
                                        <span className="inline-flex items-center gap-1"><Eye size={11} /> {r.views.toLocaleString('es-CO')}</span>
                                        <span className="inline-flex items-center gap-1"><Clock size={11} /> {fmtDur(r.avg)}</span>
                                    </div>
                                </div>
                                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${(r.views / maxViews) * 100}%`, backgroundColor: TEAL }} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export const SupportSection: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const [tab, setTab] = useState<'inbox' | 'config' | 'analytics'>('inbox');

    const TABS = [
        { id: 'inbox' as const,     label: 'Bandeja',            icon: Inbox },
        { id: 'config' as const,    label: 'Configuración',      icon: Settings2 },
        { id: 'analytics' as const, label: 'Analíticas del sitio', icon: BarChart3 },
    ];

    return (
        <div className="space-y-5">
            <SectionHeader
                title="Soporte"
                subtitle="Bandeja de Crisp, configuración del sitio y analíticas de visitas"
            />

            {/* Sub-tabs */}
            <div className="flex gap-2 flex-wrap">
                {TABS.map(t => (
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
                        <t.icon size={14} />
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'inbox' && (
                <>
                    <CrispInbox profile={profile} />
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                            <Headphones size={11} /> Consola completa de Crisp
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {SHORTCUTS.map(s => (
                                <a
                                    key={s.label}
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold hover:border-teal-300 hover:shadow-sm transition-all"
                                    style={{ color: NAVY }}
                                >
                                    <s.icon size={13} className="text-slate-400" />
                                    {s.label}
                                    <ExternalLink size={10} className="text-slate-300" />
                                </a>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {tab === 'config' && (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <WhatsAppSettingCard profile={profile} />
                        <CalendlySettingCard profile={profile} />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <YouTubeSettingCard profile={profile} />
                        <QuickLinksCard profile={profile} />
                    </div>
                    <PageDocsCard profile={profile} />
                    <EmailFormatCard profile={profile} />
                </>
            )}

            {tab === 'analytics' && <SiteAnalytics />}
        </div>
    );
};
