import React, { useEffect, useMemo, useState } from 'react';
import {
    Gift, Mail, Sparkles, Send, RefreshCw, AlertCircle, CheckCircle2,
    Users as UsersIcon, FileText, Eye, Bell, Image as ImageIcon, Ticket,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, NAVY, TEAL } from './shared';
import { ReferralsTab } from './ReferralsTab';
import { NotificacionesSection } from './NotificacionesSection';
import { BannersTab } from './BannersTab';
import { CouponsTab } from './CouponsTab';

// ─────────────────────────────────────────────
// PromotionsSection — agrupa funcionalidades de marketing/retención:
//   • Referidos: config del referral_rate (mismo componente que vivía en
//     Tesorería; lo movimos acá porque conceptualmente es campaña).
//   • Correo:   composer con preview que la IA puede llenar a partir de
//     un brief corto, y envío a TODOS los usuarios de cuenta (NO terceros).
//     El envío real lo hace una edge function que conecta con el proveedor
//     de email (Resend / SendGrid). Si no está deployada, mostramos el
//     mensaje exacto para que el admin sepa qué pedirle a Antigravity.
//   • Notificaciones: campañas push promocionales a las apps iOS/Android,
//     conectada al backend admin-push + admin-ai-push (ver
//     NotificacionesSection.tsx).
// ─────────────────────────────────────────────

type PromoTab = 'referrals' | 'mail' | 'push' | 'banners' | 'coupons';

interface Props {
    profile: AdminProfile;
}

export const PromotionsSection: React.FC<Props> = ({ profile }) => {
    const [tab, setTab] = useState<PromoTab>('referrals');

    const TABS: Array<{ id: PromoTab; label: string; icon: React.ComponentType<any> }> = [
        { id: 'referrals', label: 'Referidos',      icon: Gift },
        { id: 'mail',      label: 'Correo',         icon: Mail },
        { id: 'push',      label: 'Notificaciones', icon: Bell },
        { id: 'banners',   label: 'Banners',        icon: ImageIcon },
        { id: 'coupons',   label: 'Cupones',        icon: Ticket },
    ];

    return (
        <div className="p-4 md:p-8">
            <SectionHeader
                title="Promociones"
                subtitle="Comisión de referidos, campañas de correo y notificaciones push"
            />

            <div className="flex gap-2 mb-6 flex-wrap">
                {TABS.map(t => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                            style={{
                                backgroundColor: active ? NAVY : 'white',
                                color: active ? 'white' : '#475569',
                                border: '1px solid #E2E8F0',
                            }}
                        >
                            <Icon size={14} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'referrals' && <ReferralsTab profile={profile} />}
            {tab === 'mail'      && <MailComposer profile={profile} />}
            {tab === 'push'      && <NotificacionesSection profile={profile} />}
            {tab === 'banners'   && <BannersTab profile={profile} />}
            {tab === 'coupons'   && <CouponsTab profile={profile} />}
        </div>
    );
};

// ─────────────────────────────────────────────
// Composer de correo masivo a usuarios de cuenta.
// Flujo: brief → IA genera subject+body → preview con logo Lincoin →
//         enviar a todos los users (NO terceros, NO usuarios bloqueados).
// La llamada de generación llama edge function 'admin-ai-email' (action=generate)
// y el envío llama edge function 'admin-broadcast-email' (action=send).
// Ambas son placeholders del lado backend — si no responden, surface a UI.
// ─────────────────────────────────────────────
const MailComposer: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [brief, setBrief]       = useState('');
    const [subject, setSubject]   = useState('');
    const [body, setBody]         = useState('');
    const [generating, setGen]    = useState(false);
    const [sending, setSending]   = useState(false);
    const [result, setResult]     = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
    const [audience, setAudience] = useState({ total: 0, eligible: 0, blocked: 0 });

    // Conteo en vivo de a cuántos llegaríamos.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data, error } = await supabasePersonas
                .from('users')
                .select('id, email, is_blocked', { count: 'exact' })
                .not('email', 'is', null)
                .limit(2000);
            if (cancelled) return;
            if (error) return;
            const rows = (data as Array<{ id: string; email: string | null; is_blocked: boolean | null }>) ?? [];
            const total    = rows.length;
            const blocked  = rows.filter(r => r.is_blocked === true).length;
            const eligible = rows.filter(r => r.email && r.is_blocked !== true).length;
            setAudience({ total, eligible, blocked });
        })().catch(() => {/* la cuenta es nice-to-have */});
        return () => { cancelled = true; };
    }, []);

    const generateWithAI = async () => {
        if (!brief.trim()) {
            setResult({ kind: 'err', msg: 'Escribí un brief (qué querés comunicar) antes de generar.' });
            return;
        }
        setGen(true);
        setResult(null);
        try {
            const { data, error } = await supabasePersonas.functions.invoke('admin-ai-email', {
                body: { action: 'generate', brief, language: 'es-CO' },
            });
            if (error) throw error;
            if (data?.subject) setSubject(data.subject);
            if (data?.body)    setBody(data.body);
            if (!data?.subject && !data?.body) {
                setResult({ kind: 'err', msg: 'La edge function admin-ai-email no devolvió subject/body. Pedile a Antigravity que la deploye con action=generate.' });
            } else {
                setResult({ kind: 'ok', msg: 'Borrador listo — revisalo antes de enviar.' });
            }
        } catch (e: any) {
            setResult({ kind: 'err', msg: `IA no respondió: ${e?.message ?? 'desconocido'}. Edge function 'admin-ai-email' probablemente no está deployada.` });
        }
        setGen(false);
    };

    const sendBroadcast = async () => {
        if (!subject.trim() || !body.trim()) {
            setResult({ kind: 'err', msg: 'Subject y body no pueden estar vacíos.' });
            return;
        }
        const confirmMsg = `Vas a enviar este correo a ${audience.eligible.toLocaleString('es-CO')} usuarios de cuenta (los ${audience.blocked} bloqueados quedan fuera). Esta acción es irreversible. ¿Confirmás?`;
        const ok = await confirm({
            title: 'Confirmar',
            message: confirmMsg,
        });
        if (!ok) return;
        setSending(true);
        setResult(null);
        try {
            const { data, error } = await supabasePersonas.functions.invoke('admin-broadcast-email', {
                body: {
                    action:       'send',
                    subject,
                    body_html:    renderHtml(subject, body),
                    body_text:    body,
                    audience:     'users_active',  // backend filtra users con email y is_blocked=false
                    triggered_by: profile.id,
                },
            });
            if (error) throw error;
            await logAdminAction({
                admin: profile,
                action: 'broadcast_email_send',
                metadata: { subject, recipients: data?.recipients ?? audience.eligible },
            });
            setResult({ kind: 'ok', msg: `✓ Enviado a ${data?.recipients ?? audience.eligible} usuarios.` });
            setBrief(''); setSubject(''); setBody('');
        } catch (e: any) {
            setResult({ kind: 'err', msg: `Falló el envío: ${e?.message ?? 'desconocido'}. Edge function 'admin-broadcast-email' probablemente no está deployada — Antigravity tiene que crearla (provider: Resend o SendGrid).` });
        }
        setSending(false);
    };

    const previewHtml = useMemo(() => renderHtml(subject || '(sin asunto)', body || '(sin contenido)'), [subject, body]);

    return (
        <div className="space-y-4">
            {confirmDialog}
            {/* Audiencia */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center" style={{ color: NAVY }}>
                        <UsersIcon size={18} />
                    </div>
                    <div>
                        <p className="text-sm font-bold" style={{ color: NAVY }}>
                            Llegaríamos a <span className="text-green-700">{audience.eligible.toLocaleString('es-CO')}</span> usuarios de cuenta
                        </p>
                        <p className="text-xs text-slate-500">
                            de {audience.total.toLocaleString('es-CO')} totales · {audience.blocked} bloqueados quedan fuera · los terceros nunca reciben
                        </p>
                    </div>
                </div>
            </div>

            {/* Brief para IA */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Sparkles size={12} /> Brief para la IA
                    </p>
                </div>
                <textarea
                    value={brief}
                    onChange={e => setBrief(e.target.value)}
                    rows={3}
                    placeholder="Ej: anunciar nueva ruta PEN→COP sin fees por 48 h, llamado a la acción para enviar dinero ahora."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-green-500 resize-none"
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                        onClick={generateWithAI}
                        disabled={generating || !brief.trim()}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-2 disabled:opacity-50"
                        style={{ backgroundColor: NAVY }}
                    >
                        {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {generating ? 'Generando…' : 'Generar con IA'}
                    </button>
                </div>
            </div>

            {/* Editor manual */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                        <FileText size={12} /> Contenido
                    </p>
                    <input
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        placeholder="Asunto del correo"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold outline-none focus:border-green-500 mb-2"
                    />
                    <textarea
                        value={body}
                        onChange={e => setBody(e.target.value)}
                        rows={12}
                        placeholder="Cuerpo del correo (texto plano — el preview de la derecha lo envuelve con el branding Lincoin)."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-green-500 resize-y"
                    />
                </div>

                {/* Preview HTML */}
                <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-col">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5 px-2">
                        <Eye size={12} /> Vista previa
                    </p>
                    <iframe
                        title="Email preview"
                        srcDoc={previewHtml}
                        className="w-full flex-1 min-h-[420px] rounded-lg border border-slate-100 bg-slate-50"
                    />
                </div>
            </div>

            {/* Footer con resultado y enviar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                    {result && (
                        <div
                            className={`inline-flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
                                result.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
                            }`}
                        >
                            {result.kind === 'ok' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                            <span>{result.msg}</span>
                        </div>
                    )}
                </div>
                <button
                    onClick={sendBroadcast}
                    disabled={sending || !subject.trim() || !body.trim()}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: TEAL, color: NAVY }}
                >
                    {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? 'Enviando…' : `Enviar a ${audience.eligible.toLocaleString('es-CO')} usuarios`}
                </button>
            </div>

            <p className="text-[11px] text-slate-400">
                <b>Importante:</b> los terceros (beneficiarios cargados por usuarios para enviar dinero) NUNCA reciben este correo —
                solo los titulares de cuenta. El envío masivo es irreversible.
            </p>
        </div>
    );
};

// Plantilla HTML branded con los colores y logo de Lincoin.
// Acepta subject + cuerpo en texto plano y devuelve HTML listo para enviar.
function renderHtml(subject: string, body: string): string {
    const safeBody = String(body)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, '<br/>')}</p>`).join('');
    const safeSubject = String(subject).replace(/</g, '&lt;');
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>${safeSubject}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)">
        <tr><td style="background:#0F172A;padding:20px 28px;text-align:left">
          <span style="display:inline-block;width:36px;height:36px;border-radius:10px;background:#4ADE80;line-height:36px;text-align:center;color:#0F172A;font-weight:800;font-family:-apple-system,sans-serif">C</span>
          <span style="display:inline-block;margin-left:10px;color:#ffffff;font-weight:800;letter-spacing:1px;font-size:14px;vertical-align:6px">LINCOIN</span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 16px;font-size:20px;color:#0F172A">${safeSubject}</h1>
          <div style="font-size:14px;color:#334155">${safeBody}</div>
          <div style="margin:28px 0 0">
            <a href="https://cuypay.com" style="display:inline-block;background:#4ADE80;color:#0F172A;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px">Abrir Lincoin</a>
          </div>
        </td></tr>
        <tr><td style="padding:20px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:11px;color:#64748B">
          Recibís este correo porque sos usuario verificado de Lincoin.<br/>
          Si no querés recibir más campañas, respondé a este mail con la palabra <b>BAJA</b>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
