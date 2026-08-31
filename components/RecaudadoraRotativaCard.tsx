import React, { useEffect, useState } from 'react';
import { Vault, RefreshCw, Copy, Archive, CheckCircle2, Clock } from 'lucide-react';

// ─────────────────────────────────────────────────────────
// RecaudadoraRotativaCard — Wallet recaudadora del admin, ROTATIVA.
//
// La recaudadora cambia de dirección cada PERÍODO (corte el día 30 a las
// 12:00 hora Colombia). Cada período se deriva del mismo mnemónico maestro en
// una rama HD separada, así una sola semilla controla la actual y todas las
// archivadas. Los depósitos de los clientes se barren a la recaudadora vigente;
// las anteriores quedan archivadas (visibles aquí, siempre bajo control).
// ─────────────────────────────────────────────────────────

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

function adminAuthHeader(): string {
    const ADMIN_PASS = (import.meta.env.VITE_ADMIN_PASSWORD as string) || '';
    try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) {
            const d = JSON.parse(localStorage.getItem(k) || '{}');
            if (d.access_token) return `Bearer ${d.access_token}`;
        }
    } catch { /* sin sesión supabase */ }
    return ADMIN_PASS ? `AdminBypass ${ADMIN_PASS}` : `Bearer ${SKEY}`;
}
async function callGasfree(body: Record<string, unknown>): Promise<any> {
    const r = await fetch(`${SURL}/functions/v1/gasfree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: adminAuthHeader() },
        body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!txt) return { error: r.ok ? 'Respuesta vacía (posible timeout). Reintenta.' : `HTTP ${r.status} sin cuerpo` };
    try { return JSON.parse(txt); } catch { return { error: `Respuesta no válida (HTTP ${r.status})` }; }
}

interface PeriodInfo {
    period: number;
    label: string;
    address: string;
    gasFreeAddress?: string | null;
    balance?: number;
    opensAt?: string;
    closesAt?: string;
    current?: boolean;
    archived?: boolean;
    pinned?: boolean;
    error?: string;
}

const fmtUsd = (n?: number) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso?: string) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
};

export const RecaudadoraRotativaCard: React.FC = () => {
    const [current, setCurrent] = useState<any | null>(null);
    const [periods, setPeriods] = useState<PeriodInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const [cur, list] = await Promise.all([
                callGasfree({ action: 'recaudadora_current' }),
                callGasfree({ action: 'recaudadora_list', back: 12 }),
            ]);
            if (cur?.error) throw new Error(cur.error);
            setCurrent(cur);
            setPeriods(Array.isArray(list?.periods) ? list.periods : []);
        } catch (e: any) {
            setError(e?.message ?? 'Error');
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const copy = (addr: string) => {
        try { navigator.clipboard.writeText(addr); setCopied(addr); setTimeout(() => setCopied(null), 1800); } catch { /* */ }
    };

    const [acting, setActing] = useState<string | null>(null);
    const doPin = async () => {
        if (!confirm('¿Fijar la recaudadora actual para que NO rote sola? Desde ya la rotación es 100% manual.')) return;
        setActing('pin'); setError(null);
        const r = await callGasfree({ action: 'recaudadora_pin' });
        setActing(null);
        if (r?.error) setError(r.error); else load();
    };
    const doRotate = async () => {
        if (!confirm('¿Rotar la recaudadora A MANO ahora?\n\nSe genera una dirección NUEVA para recibir de aquí en adelante. La actual queda ARCHIVADA — su saldo NO se mueve (lo consolidas aparte cuando quieras).')) return;
        setActing('rotate'); setError(null);
        const r = await callGasfree({ action: 'recaudadora_rotate' });
        setActing(null);
        if (r?.error) setError(r.error); else load();
    };
    const isHotKey = current && current.rotates === false && current.manual !== true;
    const isManual = current?.manual === true;

    const archived = periods.filter(p => p.archived);
    const archivedWithBalance = archived.filter(p => (p.balance ?? 0) > 0);
    const [consolidateMsg, setConsolidateMsg] = useState<string | null>(null);
    const doConsolidate = async () => {
        const total = archivedWithBalance.reduce((s, p) => s + (p.balance ?? 0), 0);
        if (!confirm(`¿Barrer ${fmtUsd(total)} USDT de ${archivedWithBalance.length} recaudadora(s) archivada(s) hacia la actual?\n\nMueve dinero on-chain y paga la comisión GasFree por cada barrido.`)) return;
        setActing('consolidate'); setError(null); setConsolidateMsg(null);
        const r = await callGasfree({ action: 'recaudadora_consolidate' });
        setActing(null);
        if (r?.error) setError(r.error);
        else { setConsolidateMsg(`✅ Consolidado: ${fmtUsd(r.totalSwept)} USDT barridos a la recaudadora actual.`); load(); }
    };

    return (
        <div style={{ background: '#121413', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 22 }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Vault size={17} style={{ color: '#4ADE80' }} />
                    </div>
                    <div>
                        <p style={{ color: '#F4F4F2', fontWeight: 700, fontSize: 15 }}>Wallet recaudadora <span style={{ color: '#4ADE80' }}>rotativa</span></p>
                        <p style={{ color: '#878E88', fontSize: 11.5 }}>Rota el 30 de cada mes · 12:00 hora Colombia · archiva las anteriores</p>
                    </div>
                </div>
                <button onClick={load} disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-60"
                    style={{ color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {loading ? 'Cargando…' : 'Actualizar'}
                </button>
            </div>

            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', borderRadius: 12, padding: 12, fontSize: 12.5, marginBottom: 12 }}>
                    ⚠️ {error}
                    {/GASFREE_TRON_MNEMONIC/i.test(error) && (
                        <div style={{ marginTop: 6, color: '#f8b4b4' }}>Configura <b>GASFREE_TRON_MNEMONIC</b> (y <b>GASFREE_NET</b>) en Supabase → Edge Functions → Secrets.</div>
                    )}
                </div>
            )}

            {/* Recaudadora ACTUAL */}
            {current && !current.error && (
                <div style={{ background: '#0C0E0D', border: '1px solid rgba(74,222,128,0.28)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5" style={{ color: '#4ADE80', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>
                            <CheckCircle2 size={13} /> Activa {current.label ? `· ${current.label}` : ''}
                        </span>
                        <span style={{ color: '#F4F4F2', fontWeight: 800, fontSize: 18 }}>{fmtUsd(current.balance)} <span style={{ color: '#878E88', fontSize: 12, fontWeight: 600 }}>USDT</span></span>
                    </div>
                    <div className="flex items-start gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                            <code style={{ color: '#F4F4F2', fontSize: 12.5, wordBreak: 'break-all', flex: 1 }}>{current.address ?? '—'}</code>
                            {current.address && (
                                <button onClick={() => copy(current.address)} className="shrink-0 p-1.5 rounded-md" style={{ border: '1px solid rgba(255,255,255,0.12)', color: copied === current.address ? '#4ADE80' : '#878E88' }} title="Copiar">
                                    {copied === current.address ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                                </button>
                            )}
                        </div>
                        {current.address && (
                            <div className="shrink-0 text-center">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(current.address)}&color=0A0A0A&bgcolor=FFFFFF&margin=6`}
                                    alt="QR recaudadora rotativa" style={{ width: 104, height: 104, borderRadius: 10, background: '#fff', padding: 4 }} />
                                <p style={{ fontSize: 10, color: '#878E88', marginTop: 4, fontWeight: 700 }}>Escanear dirección</p>
                            </div>
                        )}
                    </div>
                    {isHotKey ? (
                        <div className="mt-2.5" style={{ color: '#878E88', fontSize: 11.5 }}>Recaudadora fija (LINCOIN_TRON_HOT_KEY) — no rota.</div>
                    ) : isManual ? (
                        <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
                            <span className="flex items-center gap-1.5" style={{ color: '#4ADE80', fontSize: 11.5, fontWeight: 700 }}>
                                <CheckCircle2 size={12} /> Fija (manual) — no rota sola. La rotas tú cuando quieras.
                            </span>
                            <button onClick={doRotate} disabled={acting === 'rotate'} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60"
                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2' }}>
                                {acting === 'rotate' ? 'Rotando…' : '↻ Rotar a mano'}
                            </button>
                        </div>
                    ) : (
                        <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
                            <span className="flex items-center gap-1.5" style={{ color: '#878E88', fontSize: 11.5 }}>
                                <Clock size={12} /> Aún rota sola. Próxima: <b style={{ color: '#F4F4F2' }}>{fmtDate(current.nextRotation)}</b>
                            </span>
                            <button onClick={doPin} disabled={acting === 'pin'} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60"
                                style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: '#4ADE80' }}>
                                {acting === 'pin' ? 'Fijando…' : '📌 Fijar (dejar de rotar)'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Archivadas */}
            {archived.length > 0 && (
                <div>
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <p className="flex items-center gap-1.5" style={{ color: '#878E88', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
                            <Archive size={12} /> Archivadas ({archived.length})
                        </p>
                        {archivedWithBalance.length > 0 && (
                            <button onClick={doConsolidate} disabled={acting === 'consolidate'} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60"
                                style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: '#4ADE80' }}>
                                {acting === 'consolidate' ? 'Consolidando…' : `⇊ Consolidar ${archivedWithBalance.length} → actual`}
                            </button>
                        )}
                    </div>
                    {consolidateMsg && <p style={{ color: '#4ADE80', fontSize: 11.5, fontWeight: 600, marginBottom: 8 }}>{consolidateMsg}</p>}
                    <div className="flex flex-col gap-1.5">
                        {archived.map((p) => (
                            <div key={p.period} className="flex items-center justify-between" style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '9px 12px' }}>
                                <div className="min-w-0">
                                    <span style={{ color: '#F4F4F2', fontSize: 12, fontWeight: 700 }}>{p.label}</span>
                                    <code style={{ color: '#878E88', fontSize: 11, marginLeft: 8, wordBreak: 'break-all' }}>{p.address ? `${p.address.slice(0, 10)}…${p.address.slice(-6)}` : (p.error ?? '—')}</code>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span style={{ color: (p.balance ?? 0) > 0 ? '#4ADE80' : '#878E88', fontSize: 12.5, fontWeight: 700 }}>{fmtUsd(p.balance)}</span>
                                    {p.address && (
                                        <button onClick={() => copy(p.address)} className="p-1 rounded" style={{ color: copied === p.address ? '#4ADE80' : '#878E88' }} title="Copiar">
                                            {copied === p.address ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
