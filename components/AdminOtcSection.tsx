import React, { useState, useMemo, useEffect } from 'react';
import { ArrowLeftRight, Search, Power, Pencil, Check, X, ArrowDownToLine, ArrowUpFromLine, Users, Landmark, RefreshCw, Zap, MessageSquare, Clock } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { callFinity, extractRate } from './FinitySection';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────
// AdminOtcSection — Panel "Contabilidad OTC" del admin de Empresas.
//
// Primero pregunta el PARTNER con el que se opera la mesa — hoy Finity
// (riel ACH); Mouv (Bre-B) queda "próximamente" hasta apificar su mesa.
//
// Dentro (Finity): en la esquina va la TASA BASE de Finity USD→COP — la
// que sería "para todos" — y por cliente se define la COMISIÓN negociada;
// al lado se previsualiza la TASA CLIENTE resultante (base − comisión %),
// que es exactamente la que ese cliente ve en su convertidor ACH.
//
// Abajo: la contabilidad del canal — cuánto USDT ha entrado a la
// recaudadora por conversiones OTC, cuánto COP se acreditó a cambio,
// el saldo ACH de cada cliente, y el historial de movimientos con su
// estado (Pendiente / Completado / Rechazado).
// ─────────────────────────────────────────────

const DEFAULT_FEE_PCT = 4;
// Con el que arranca una cuenta a la que todavía no se le pactó el suyo. No es
// una tarifa de lista: el margen de la mesa manual se acuerda cliente por
// cliente, y esto solo evita que una cuenta quede sin margen por olvido.
const DEFAULT_MANUAL_PCT = 0.5;

// ─── Plazo de la mesa manual ────────────────────────────
// Lo unico global de este riel: cuantos minutos tiene el cliente para pagar y
// subir el comprobante. El MARGEN no vive aca — se pacta por cliente en la
// tabla, porque no es una tarifa de lista sino un acuerdo con cada cuenta.
const PlazoManual: React.FC = () => {
    const [ventana, setVentana] = React.useState('');
    const [guardado, setGuardado] = React.useState<number | null>(null);
    const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
    const [guardando, setGuardando] = React.useState(false);

    const leer = React.useCallback(async () => {
        const r = await callOtcMesaAdmin('config_get');
        if (r?.ok) { setGuardado(Number(r.ventanaMin)); setVentana(String(r.ventanaMin)); }
    }, []);
    React.useEffect(() => { leer(); }, [leer]);

    const guardar = async () => {
        setGuardando(true); setMsg(null);
        const r = await callOtcMesaAdmin('config_set', { ventanaMin: parseFloat(String(ventana).replace(',', '.')) });
        setGuardando(false);
        if (r?.ok) { setMsg({ ok: true, text: 'Guardado' }); leer(); }
        else setMsg({ ok: false, text: r?.error ?? 'No se pudo guardar' });
    };

    const cambio = guardado != null && String(guardado) !== String(ventana).trim();

    return (
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap">
            <Clock size={15} className="text-slate-400 shrink-0" />
            <div className="min-w-0">
                <p className="text-xs font-bold text-slate-700">Plazo para pagar</p>
                <p className="text-[11px] text-slate-400">Desde que la mesa fija la tasa. Vencido, la solicitud se cancela sola.</p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
                <input
                    value={ventana}
                    onChange={e => { const v = e.target.value; if (/^[0-9]*$/.test(v)) setVentana(v); }}
                    inputMode="numeric"
                    className="w-16 h-9 px-2 text-center text-base font-bold tabular-nums text-slate-800 border border-slate-200 rounded-lg outline-none focus:border-[#4ADE80]"
                />
                <span className="text-xs text-slate-400 font-medium">min</span>
                {cambio && (
                    <button onClick={guardar} disabled={guardando}
                        className="h-9 px-3 rounded-lg text-xs font-bold text-white bg-[#16A34A] hover:bg-[#0F766E] disabled:opacity-50">
                        {guardando ? 'Guardando…' : 'Guardar'}
                    </button>
                )}
                {msg && <span className={`text-[11px] font-bold ${msg.ok ? 'text-[#16A34A]' : 'text-red-600'}`}>{msg.text}</span>}
            </div>
        </div>
    );
};

// Llamada a la edge de la mesa con la sesión del admin.
async function callOtcMesaAdmin(action: string, body: Record<string, unknown> = {}): Promise<any> {
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    let token = SKEY;
    try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) token = d.access_token; }
    } catch { /* sin sesión */ }
    try {
        const r = await fetch(`${SURL}/functions/v1/otc-mesa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action, ...body }),
        });
        return await r.json().catch(() => null);
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}

const isOtcConvertTx = (t: any) => t.type === 'convert' && (t.source === 'MOUV' || t.source === 'FINITY' || t.gasfree === true);

const fmtCop = (n: number) => Math.round(n || 0).toLocaleString('es-CO');
const fmtUsdt = (n: number) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusStyle = (status: string) => {
    if (status === 'Completado') return 'bg-green-50 text-green-700 border-green-200';
    if (status === 'Rechazado') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
};

const MiniBarChart: React.FC<{ data: { label: string; value: number }[] }> = ({ data }) => {
    const max = Math.max(1, ...data.map(d => d.value));
    return (
        <div className="flex items-end gap-1.5 h-28">
            {data.map((d, i) => (
                <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1.5 group relative h-full justify-end">
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#0C0E0D] text-white text-[10px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                        {fmtCop(d.value)} COP
                    </div>
                    <div
                        className="w-full rounded-t-md bg-gradient-to-t from-[#16A34A] to-[#4ADE80] transition-all group-hover:opacity-80"
                        style={{ height: `${d.value > 0 ? Math.max(4, (d.value / max) * 100) : 1}%` }}
                    />
                    <span className="text-[9px] text-slate-400 whitespace-nowrap shrink-0">{d.label}</span>
                </div>
            ))}
        </div>
    );
};

export const AdminOtcSection: React.FC = () => {
    const { getAllUsers, getAllTransactions, updateUserRawData, currentUser } = useDatabase();
    const [q, setQ] = useState('');
    const [feeEdit, setFeeEdit] = useState<{ userId: string; value: string } | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

    // ── Partner de la mesa: se pregunta ANTES de mostrar el panel ──
    const [partner, setPartner] = useState<'finity' | 'manual' | null>(null);

    // ── Tasa BASE de Finity USD→COP (la "para todos", en la esquina) ──
    const [baseRate, setBaseRate] = useState<number | null>(null);
    const [rateLoading, setRateLoading] = useState(false);
    const [rateErr, setRateErr] = useState<string | null>(null);
    // La tasa del PROVEEDOR, sin el ajuste de Lincoin. El servidor solo la
    // manda al admin: al cliente le llega la tasa ya ajustada, que es la que
    // se le aplica.
    const [rateProveedor, setRateProveedor] = useState<number | null>(null);
    const loadBaseRate = async () => {
        if (!currentUser?.id || rateLoading) return;
        setRateLoading(true); setRateErr(null);
        try {
            const r = await callFinity('rates', currentUser.id, { query: { from: 'USD', to: 'COP' } });
            const v = extractRate(r?.data);
            const bruta = Number(r?.rateBruta);
            setRateProveedor(Number.isFinite(bruta) && bruta > 0 ? bruta : null);
            if (v != null && isFinite(v) && v > 0) setBaseRate(v);
            else setRateErr(`Finity no devolvió tasa (${r?.status ?? '—'}).`);
        } catch (e: any) { setRateErr(String(e?.message ?? e)); }
        setRateLoading(false);
    };
    useEffect(() => { if (partner) loadBaseRate(); }, [partner, currentUser?.id]);

    // ── Ajuste de la tasa: los "puntos" que se le bajan al proveedor ──
    const [ajuste, setAjuste] = useState<{ finityCop: number; mouvCop: number } | null>(null);
    const [ajusteEdit, setAjusteEdit] = useState<string>('');
    const [ajusteBusy, setAjusteBusy] = useState(false);
    const [ajusteMsg, setAjusteMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const cargarAjuste = async () => {
        const r = await llamarFuncion('admin-data', { action: 'otc_ajuste_get' });
        if (r?.ok && r.ajuste) {
            setAjuste({ finityCop: Number(r.ajuste.finityCop) || 0, mouvCop: Number(r.ajuste.mouvCop) || 0 });
            setAjusteEdit(String(Number(r.ajuste.finityCop) || 0));
        }
    };
    useEffect(() => { if (partner === 'finity') cargarAjuste(); }, [partner]);
    const guardarAjuste = async () => {
        if (ajusteBusy) return;
        const n = Number(String(ajusteEdit).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) { setAjusteMsg({ ok: false, text: 'Escribe un número de pesos, 0 o más.' }); return; }
        setAjusteBusy(true); setAjusteMsg(null);
        const r = await llamarFuncion('admin-data', { action: 'otc_ajuste_set', finityCop: n, mouvCop: ajuste?.mouvCop ?? 0 });
        setAjusteBusy(false);
        if (!r?.ok) { setAjusteMsg({ ok: false, text: r?.error ?? 'No se pudo guardar.' }); return; }
        setAjuste({ finityCop: Number(r.ajuste.finityCop) || 0, mouvCop: Number(r.ajuste.mouvCop) || 0 });
        setAjusteMsg({ ok: true, text: 'Ajuste guardado. Ya aplica para todos.' });
        loadBaseRate();
    };

    const clientRateOf = (feePct: number): number | null =>
        baseRate != null ? baseRate * (1 - feePct / 100) : null;

    // Debug: lista cruda de external accounts en Finity (movida aquí desde
    // la pantalla de Beneficiarios del cliente).
    const [eaRaw, setEaRaw] = useState<any>(null);
    const [eaLoading, setEaLoading] = useState(false);

    const allUsers = getAllUsers();
    // TODOS los clientes (igual que el resto del admin) — en Lincoin los
    // clientes son cuentas personales; el filtro viejo de "solo empresas"
    // dejaba la tabla vacía.
    const businesses = allUsers.filter((u: any) => u.role !== 'admin');
    const filtered = businesses.filter((u: any) => {
        if (!q) return true;
        const s = q.toLowerCase();
        return (u.name ?? '').toLowerCase().includes(s) || (u.email ?? '').toLowerCase().includes(s) || (u.id ?? '').toLowerCase().includes(s);
    });

    const [manualEdit, setManualEdit] = useState<{ userId: string; value: string } | null>(null);

    const otcConfigOf = (u: any) => (u.otcConfig ?? u.raw_data?.otcConfig ?? {}) as { enabled?: boolean; feePct?: number; manualPct?: number };

    // Escritura DIRECTA a raw_data (updateUserRawData): el update de perfil
    // completo se estrellaba contra el candado de columnas sensibles cuando
    // los saldos en memoria estaban desactualizados y el % no se guardaba.
    const toggleEnabled = async (u: any) => {
        const cfg = otcConfigOf(u);
        setSavingId(u.id); setSaveMsg(null);
        try {
            const ok = await updateUserRawData(u.id, { otcConfig: { ...cfg, enabled: !cfg.enabled } });
            if (!ok) setSaveMsg({ ok: false, text: `No se pudo ${cfg.enabled ? 'desactivar' : 'activar'} el OTC de ${u.name ?? u.email}. Reintenta.` });
        } finally { setSavingId(null); }
    };

    const saveFee = async (u: any) => {
        if (!feeEdit || feeEdit.userId !== u.id) return;
        // Acepta coma o punto decimal ("0,25" → 0.25)
        const next = parseFloat(feeEdit.value.replace(',', '.'));
        if (isNaN(next) || next < 0 || next >= 100) { setSaveMsg({ ok: false, text: 'Comisión inválida — escribe un % entre 0 y 100 (ej: 0.25).' }); return; }
        const cfg = otcConfigOf(u);
        setSavingId(u.id); setSaveMsg(null);
        try {
            const ok = await updateUserRawData(u.id, { otcConfig: { ...cfg, feePct: next } });
            setSaveMsg(ok
                ? { ok: true, text: `✅ Comisión de ${u.name ?? u.email} guardada: ${next}%.` }
                : { ok: false, text: 'La comisión NO quedó guardada en el servidor. Reintenta; si persiste, vuelve a iniciar sesión.' });
            if (ok) setFeeEdit(null);
        } finally { setSavingId(null); }
    };

    // Comision de la MESA MANUAL para este cliente. Mismo camino que saveFee
    // (escritura directa a raw_data) porque el update de perfil completo se
    // estrella contra el candado de columnas sensibles.
    const saveManual = async (u: any) => {
        if (!manualEdit || manualEdit.userId !== u.id) return;
        const next = parseFloat(manualEdit.value.replace(',', '.'));
        if (isNaN(next) || next < 0 || next > 5) { setSaveMsg({ ok: false, text: 'Comisión inválida — escribe un % entre 0 y 5 (ej: 0.5).' }); return; }
        const cfg = otcConfigOf(u);
        setSavingId(u.id); setSaveMsg(null);
        try {
            const ok = await updateUserRawData(u.id, { otcConfig: { ...cfg, manualPct: next } });
            setSaveMsg(ok
                ? { ok: true, text: `✅ Comisión de mesa manual de ${u.name ?? u.email} guardada: ${next}%.` }
                : { ok: false, text: 'La comisión NO quedó guardada en el servidor. Reintenta.' });
            if (ok) setManualEdit(null);
        } finally { setSavingId(null); }
    };

    // ── Contabilidad: movimientos del canal OTC/Mouv ──────────────────
    const otcTxs = useMemo(() => {
        const all = getAllTransactions() as any[];
        return all
            .filter(isOtcConvertTx)
            .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    }, [getAllTransactions]);

    const usersById = useMemo(() => new Map(businesses.map((u: any) => [u.id, u])), [businesses]);

    const totals = useMemo(() => {
        let usdt = 0, cop = 0, completados = 0, pendientes = 0, rechazados = 0;
        otcTxs.forEach((t: any) => {
            const isRejected = t.status === 'Rechazado';
            if (!isRejected) {
                usdt += Number(t.usdtOut ?? t.fromAmount ?? 0);
                cop += Number(t.amount ?? 0);
            }
            if (t.status === 'Completado') completados++;
            else if (isRejected) rechazados++;
            else pendientes++;
        });
        return { usdt, cop, completados, pendientes, rechazados, count: otcTxs.length };
    }, [otcTxs]);

    // El COP de las conversiones OTC entra al saldo del riel ACH (COP_ACH).
    const achBalanceOf = (u: any) => Number(u.balances?.COP_ACH ?? 0);
    const totalCopBalance = businesses.reduce((s: number, u: any) => s + achBalanceOf(u), 0);

    const perUserReport = useMemo(() => {
        const map = new Map<string, { user: any; usdt: number; cop: number; count: number }>();
        businesses.forEach((u: any) => map.set(u.id, { user: u, usdt: 0, cop: 0, count: 0 }));
        otcTxs.forEach((t: any) => {
            const entry = map.get(t.userId);
            if (!entry || t.status === 'Rechazado') return;
            entry.usdt += Number(t.usdtOut ?? t.fromAmount ?? 0);
            entry.cop += Number(t.amount ?? 0);
            entry.count++;
        });
        return Array.from(map.values()).sort((a, b) => achBalanceOf(b.user) - achBalanceOf(a.user));
    }, [otcTxs, businesses]);

    const dailyData = useMemo(() => {
        const now = new Date();
        const days: { label: string; value: number }[] = [];
        for (let i = 13; i >= 0; i--) {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const end = new Date(start); end.setDate(start.getDate() + 1);
            const cop = otcTxs
                .filter((t: any) => t.status !== 'Rechazado')
                .filter((t: any) => { const dt = new Date(t.createdAt ?? 0); return dt >= start && dt < end; })
                .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
            days.push({ label: start.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }), value: cop });
        }
        return days;
    }, [otcTxs]);

    const monthlyData = useMemo(() => {
        const now = new Date();
        const months: { label: string; value: number }[] = [];
        for (let i = 5; i >= 0; i--) {
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
            const cop = otcTxs
                .filter((t: any) => t.status !== 'Rechazado')
                .filter((t: any) => { const dt = new Date(t.createdAt ?? 0); return dt >= start && dt < end; })
                .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
            months.push({ label: start.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''), value: cop });
        }
        return months;
    }, [otcTxs]);

    // ── Puerta de PARTNER: se elige con quién se opera la mesa ──
    if (partner === null) {
        return (
            <div className="animate-in fade-in duration-300 max-w-2xl">
                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                    <ArrowLeftRight size={20} className="text-[#16A34A]" /> Contabilidad OTC
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 mb-5">¿Qué riel vas a configurar?</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button onClick={() => setPartner('finity')}
                        className="text-left bg-white rounded-2xl border-2 border-[#4ADE80] p-5 hover:bg-green-50/50 transition-colors shadow-sm">
                        <div className="flex items-center gap-2">
                            <span className="w-9 h-9 rounded-xl bg-green-50 text-[#16A34A] flex items-center justify-center"><Landmark size={17} /></span>
                            <span className="font-black text-slate-800 text-base">Finity</span>
                            <span className="ml-auto text-[9px] font-bold tracking-wider text-[#16A34A] border border-green-300 rounded-full px-2 py-0.5">DISPONIBLE</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2.5 leading-relaxed">Riel <b>ACH</b> · conversión automática USDT → COP. Tasa base de Finity + comisión negociada por cliente.</p>
                    </button>
                    {/* La mesa manual NO es un partner: es nuestra. Va igual aca
                        porque esta pantalla es donde se configura cada riel, y
                        adentro de Finity no la encontraba nadie. */}
                    <button onClick={() => setPartner('manual')}
                        className="text-left bg-white rounded-2xl border-2 border-slate-300 p-5 hover:bg-slate-50 transition-colors shadow-sm">
                        <div className="flex items-center gap-2">
                            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center"><MessageSquare size={17} /></span>
                            <span className="font-black text-slate-800 text-base">Mesa manual</span>
                            <span className="ml-auto text-[9px] font-bold tracking-wider text-slate-600 border border-slate-300 rounded-full px-2 py-0.5">NUESTRA</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2.5 leading-relaxed">Cierres negociados con asesor. Sin proveedor: cotiza sobre la misma referencia con su propio margen.</p>
                    </button>
                    <div className="text-left bg-slate-50 rounded-2xl border border-slate-200 p-5 opacity-70 cursor-not-allowed">
                        <div className="flex items-center gap-2">
                            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center"><Zap size={17} /></span>
                            <span className="font-black text-slate-600 text-base">Mouv</span>
                            <span className="ml-auto text-[9px] font-bold tracking-wider text-slate-400 border border-slate-300 rounded-full px-2 py-0.5">PRÓXIMAMENTE</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">Riel <b>Bre-B</b> · la mesa Mouv aún no está apificada — se opera manual.</p>
                    </div>
                </div>
            </div>
        );
    }

    // ── Mesa manual: su margen por defecto y la comisión de cada cliente ──
    // Pantalla propia y no una pestaña dentro de Finity: son rieles distintos,
    // con márgenes que se fijan distinto (un % acá, puntos en COP allá).
    if (partner === 'manual') {
        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <button onClick={() => setPartner(null)} className="text-[11px] text-slate-400 hover:text-slate-600 font-bold mb-1">← Cambiar riel</button>
                        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                            <MessageSquare size={20} className="text-slate-700" /> Mesa manual · margen por cliente
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Cierres negociados con asesor. El margen se pacta con cada cuenta, no es una tarifa de lista.
                        </p>
                    </div>
                    {/* La referencia, arriba a la derecha — igual que en Finity.
                        Sin ella, los porcentajes de la tabla no dicen en cuánto
                        queda la tasa. */}
                    <div className="bg-[#0C0E0D] rounded-2xl px-5 py-3.5 text-right shrink-0">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 flex items-center justify-end gap-1.5">
                            Tasa de referencia · USD → COP
                            <button onClick={loadBaseRate} title="Actualizar" className="text-slate-400 hover:text-white transition-colors">
                                <RefreshCw size={11} className={rateLoading ? 'animate-spin' : ''} />
                            </button>
                        </p>
                        {baseRate != null
                            ? <p className="text-2xl font-black tabular-nums" style={{ color: '#4ADE80' }}>{baseRate.toLocaleString('es-CO', { maximumFractionDigits: 2 })}</p>
                            : <p className="text-sm font-bold text-slate-400 py-1">{rateLoading ? 'Consultando…' : (rateErr ?? '—')}</p>}
                        <p className="text-[9px] text-slate-500">Sobre esta se aplica el margen de cada cliente</p>
                    </div>
                </div>

                <PlazoManual />

                <div className="relative max-w-md">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por empresa, correo o ID…" className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#4ADE80]" />
                </div>

                {saveMsg && (
                    <div className={`rounded-xl border px-4 py-2.5 text-xs font-bold ${saveMsg.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        {saveMsg.text}
                    </div>
                )}

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Empresa</th>
                                <th className="text-right px-4 py-3">Comisión mesa manual (%)</th>
                                <th className="text-right px-4 py-3">Tasa que vería (USD→COP)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((u: any) => {
                                const cfg = otcConfigOf(u);
                                // "0% pactado" y "sin pactar" son cosas distintas. Confundirlas
                                // es exactamente cómo se le termina cobrando a quien no se debe.
                                const propio = typeof cfg.manualPct === 'number' && !isNaN(cfg.manualPct);
                                const editando = manualEdit?.userId === u.id;
                                // Lo que se le aplica HOY: el pactado, o el de arranque si
                                // todavia no tiene. Mostrar "—" escondia el numero real.
                                const pctEfectivo = propio ? Number(cfg.manualPct) : DEFAULT_MANUAL_PCT;
                                const pctVista = editando ? parseFloat(String(manualEdit!.value).replace(',', '.')) : pctEfectivo;
                                const tasaVista = (baseRate != null && !isNaN(pctVista)) ? baseRate * (1 - pctVista / 100) : null;
                                return (
                                    <tr key={u.id} className="border-t border-slate-100">
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-slate-800">{u.name || '—'}</p>
                                            <p className="text-xs text-slate-400">{u.email}</p>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {editando ? (
                                                <div className="inline-flex items-center gap-2 bg-white border-2 border-[#4ADE80] rounded-xl pl-3 pr-1.5 py-1 shadow-sm shadow-green-100">
                                                    <input autoFocus type="text" inputMode="decimal" placeholder="0.5" value={manualEdit!.value}
                                                        onChange={e => { const v = e.target.value; if (/^[0-9]*[.,]?[0-9]*$/.test(v)) setManualEdit({ userId: u.id, value: v }); }}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveManual(u); if (e.key === 'Escape') setManualEdit(null); }}
                                                        className="w-16 bg-transparent text-right text-base font-bold text-slate-800 outline-none tabular-nums" />
                                                    <span className="text-sm text-slate-400 font-medium">%</span>
                                                    <div className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-200">
                                                        <button onClick={() => saveManual(u)} disabled={savingId === u.id} className="w-7 h-7 flex items-center justify-center rounded-full bg-[#16A34A] text-white hover:bg-[#0F766E] transition-colors disabled:opacity-50" title="Guardar">
                                                            <Check size={14} />
                                                        </button>
                                                        <button onClick={() => setManualEdit(null)} className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors" title="Cancelar">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setManualEdit({ userId: u.id, value: propio ? String(cfg.manualPct) : String(DEFAULT_MANUAL_PCT) })}
                                                    className="inline-flex items-center gap-2 group"
                                                    title="Comisión de la mesa manual para este cliente"
                                                >
                                                    <span className="text-right">
                                                        <span className={`block text-base font-bold tabular-nums transition-colors ${propio ? 'text-slate-800' : 'text-slate-400'} group-hover:text-[#16A34A]`}>
                                                            {pctEfectivo}%
                                                        </span>
                                                        <span className={`block text-[9px] ${propio ? 'text-[#16A34A]' : 'text-slate-400'}`}>
                                                            {propio ? 'pactado' : 'sin pactar'}
                                                        </span>
                                                    </span>
                                                    <span className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 bg-slate-50 group-hover:bg-[#16A34A] group-hover:text-white transition-colors">
                                                        <Pencil size={13} />
                                                    </span>
                                                </button>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {tasaVista != null ? (
                                                <div>
                                                    <span className={`text-base font-black tabular-nums ${editando ? 'text-[#16A34A]' : 'text-slate-800'}`}>
                                                        {tasaVista.toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                                                    </span>
                                                    <p className="text-[9px] text-slate-400">
                                                        ref {baseRate!.toLocaleString('es-CO', { maximumFractionDigits: 2 })} − {pctVista}%{editando ? ' · así le quedaría' : ''}
                                                    </p>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-slate-300">{rateLoading ? '…' : 'sin tasa de referencia'}</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {filtered.length === 0 && (
                                <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400 text-sm">Sin clientes registrados todavía.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                    <b>Sin pactar</b> quiere decir que a esa cuenta todavía no se le puso su margen y opera con
                    el de arranque ({DEFAULT_MANUAL_PCT}%). No se hereda el del riel ACH: son rieles con costos
                    distintos, y heredarlo aplicaría en silencio el porcentaje de ACH a la mesa manual.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-10 animate-in fade-in duration-300">
            {/* ── Configuración por cliente ───────────────────────────── */}
            <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <button onClick={() => setPartner(null)} className="text-[11px] text-slate-400 hover:text-slate-600 font-bold mb-1">← Cambiar partner</button>
                        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                            <ArrowLeftRight size={20} className="text-[#16A34A]" /> OTC · Partner Finity (ACH) por cliente
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
                            Activa el servicio y define la comisión de cada empresa. La <b>tasa cliente</b> resultante (base − comisión) es exactamente la que esa empresa ve en su convertidor ACH.
                        </p>
                    </div>
                    {/* Tasa BASE Finity — "la que sería para todos", en la esquina */}
                    <div className="bg-[#0C0E0D] rounded-2xl px-5 py-3.5 text-right shrink-0">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 flex items-center justify-end gap-1.5">
                            Tasa Finity · USD → COP
                            <button onClick={loadBaseRate} title="Actualizar tasa" className="text-slate-400 hover:text-white transition-colors">
                                <RefreshCw size={11} className={rateLoading ? 'animate-spin' : ''} />
                            </button>
                        </p>
                        {baseRate != null ? (
                            <p className="text-2xl font-black tabular-nums" style={{ color: '#4ADE80' }}>{baseRate.toLocaleString('es-CO', { maximumFractionDigits: 2 })}</p>
                        ) : (
                            <p className="text-sm font-bold text-slate-400 py-1">{rateLoading ? 'Consultando…' : (rateErr ?? '—')}</p>
                        )}
                        {/* Esta tarjeta muestra la tasa YA con los puntos
                            bajados — es la que ve el cliente. La del proveedor,
                            sin tocar, está en la tarjeta de abajo. */}
                        <p className="text-[9px] text-slate-500">
                            {ajuste && ajuste.finityCop > 0
                                ? `Con ${ajuste.finityCop} COP bajados — sin comisión del cliente`
                                : 'Tasa base (sin comisión) — aplica para todos'}
                        </p>
                    </div>
                </div>

                {/* ── Tasas de los proveedores y los puntos que se les bajan ── */}
                <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '18px 20px', fontFamily: "'Archivo', system-ui, sans-serif" }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2', margin: 0 }}>Tasas de los proveedores</p>
                    <p style={{ fontSize: 12, color: '#878E88', margin: '4px 0 0', lineHeight: 1.5, maxWidth: 620 }}>
                        Los puntos que le bajes a la tasa del proveedor son el margen de Lincoin. Se aplican
                        en el servidor: el cliente ve la tasa ya bajada y recibe según esa misma tasa.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 12, marginTop: 14 }}>
                        {/* FINITY */}
                        <div style={{ background: '#121413', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '14px 16px' }}>
                            <div className="flex items-center justify-between" style={{ gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', color: '#878E88' }}>FINITY · ACH</span>
                                <button onClick={loadBaseRate} title="Actualizar" style={{ color: '#878E88' }} className="hover:text-[#F4F4F2] transition-colors">
                                    <RefreshCw size={12} className={rateLoading ? 'animate-spin' : ''} />
                                </button>
                            </div>
                            <div style={{ marginTop: 10 }}>
                                <p style={{ fontSize: 11.5, color: '#878E88', margin: 0 }}>Tasa del proveedor</p>
                                <p style={{ fontSize: 19, fontWeight: 800, color: '#F4F4F2', margin: '2px 0 0' }}>
                                    {rateProveedor != null ? rateProveedor.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : (rateLoading ? '…' : '—')}
                                </p>
                            </div>
                            <div className="flex items-end" style={{ gap: 8, marginTop: 12 }}>
                                <label style={{ flex: 1 }}>
                                    <span style={{ display: 'block', fontSize: 11.5, color: '#878E88', marginBottom: 4 }}>Puntos que se le bajan (COP por dólar)</span>
                                    <input value={ajusteEdit} onChange={e => { setAjusteEdit(e.target.value.replace(/[^\d.,]/g, '')); setAjusteMsg(null); }}
                                        inputMode="decimal" placeholder="0"
                                        style={{ width: '100%', height: 38, padding: '0 11px', borderRadius: 9, background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', fontSize: 14, fontWeight: 700, outline: 'none' }} />
                                </label>
                                <button onClick={guardarAjuste} disabled={ajusteBusy}
                                    className="hover:bg-white/[0.09] transition-colors"
                                    style={{ height: 38, padding: '0 16px', borderRadius: 9, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', fontSize: 13, fontWeight: 700, opacity: ajusteBusy ? 0.6 : 1 }}>
                                    {ajusteBusy ? 'Guardando…' : 'Guardar'}
                                </button>
                            </div>
                            {/* El resultado, a la vista antes de guardar: es la
                                diferencia entre bajar 5 pesos y bajar 500. */}
                            {rateProveedor != null && (
                                <p style={{ fontSize: 12, color: '#878E88', marginTop: 10, lineHeight: 1.5 }}>
                                    Queda en{' '}
                                    <b style={{ color: '#4ADE80' }}>
                                        {Math.max(0, rateProveedor - (Number(String(ajusteEdit).replace(',', '.')) || 0)).toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP
                                    </b>
                                    {' '}por dólar. Es la tasa de referencia que ve el cliente.
                                </p>
                            )}
                            {ajusteMsg && (
                                <p style={{ fontSize: 11.5, marginTop: 8, color: ajusteMsg.ok ? '#4ADE80' : '#F87171', lineHeight: 1.45 }}>{ajusteMsg.text}</p>
                            )}
                            {ajuste && (
                                <p style={{ fontSize: 11, color: 'rgba(244,244,242,0.45)', marginTop: 6 }}>Guardado hoy: {ajuste.finityCop} COP por dólar.</p>
                            )}
                        </div>

                        {/* MOUV — se dice lo que hay, no lo que gustaría que hubiera. */}
                        <div style={{ background: '#121413', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '14px 16px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', color: '#878E88' }}>MOUV · BRE-B</span>
                            <div style={{ marginTop: 10 }}>
                                <p style={{ fontSize: 11.5, color: '#878E88', margin: 0 }}>Tasa del proveedor</p>
                                <p style={{ fontSize: 19, fontWeight: 800, color: '#878E88', margin: '2px 0 0' }}>Sin tasa</p>
                            </div>
                            <p style={{ fontSize: 12, color: '#878E88', marginTop: 12, lineHeight: 1.55 }}>
                                Mouv no entrega tasa de cambio: su integración hoy solo mueve pesos (Bre-B y
                                recaudo), y sus comisiones son fijas en COP, no una tasa. Toda la conversión
                                USD→COP —la que ve el cliente— sale de Finity.
                            </p>
                            <p style={{ fontSize: 11, color: 'rgba(244,244,242,0.45)', marginTop: 8, lineHeight: 1.5 }}>
                                Cuando Mouv apifique su mesa, el campo de puntos aparece acá. No lo pongo
                                todavía porque no tendría sobre qué aplicarse.
                            </p>
                        </div>

                    </div>
                </div>

                <div className="relative max-w-md">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por empresa, correo o ID…" className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#4ADE80]" />
                </div>

                {saveMsg && (
                    <div className={`rounded-xl border px-4 py-2.5 text-xs font-bold ${saveMsg.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        {saveMsg.text}
                    </div>
                )}

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Empresa</th>
                                <th className="text-center px-4 py-3">Estado OTC</th>
                                <th className="text-right px-4 py-3">Comisión ACH (%)</th>
                                <th className="text-right px-4 py-3">Tasa cliente (USD→COP)</th>
                                <th className="text-right px-4 py-3">Mesa manual (%)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((u: any) => {
                                const cfg = otcConfigOf(u);
                                const enabled = cfg.enabled === true;
                                const feePct = cfg.feePct ?? DEFAULT_FEE_PCT;
                                const editing = feeEdit?.userId === u.id;
                                const previewPct = editing ? parseFloat(feeEdit!.value) : feePct;
                                const previewRate = !isNaN(previewPct) ? clientRateOf(previewPct) : null;
                                return (
                                    <tr key={u.id} className="border-t border-slate-100">
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-slate-800">{u.name || '—'}</p>
                                            <p className="text-xs text-slate-400">{u.email}</p>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => toggleEnabled(u)}
                                                disabled={savingId === u.id}
                                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 ${enabled ? 'bg-green-50 text-[#16A34A] border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}
                                            >
                                                <Power size={13} /> {enabled ? 'Activo' : 'Inactivo'}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {feeEdit?.userId === u.id ? (
                                                <div className="inline-flex items-center gap-2 bg-white border-2 border-[#4ADE80] rounded-xl pl-3 pr-1.5 py-1 shadow-sm shadow-green-100">
                                                    <input autoFocus type="text" inputMode="decimal" placeholder="0.25" value={feeEdit.value}
                                                        onChange={e => { const v = e.target.value; if (/^[0-9]*[.,]?[0-9]*$/.test(v)) setFeeEdit({ userId: u.id, value: v }); }}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveFee(u); if (e.key === 'Escape') setFeeEdit(null); }}
                                                        className="w-16 bg-transparent text-right text-base font-bold text-slate-800 outline-none tabular-nums" />
                                                    <span className="text-sm text-slate-400 font-medium">%</span>
                                                    <div className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-200">
                                                        <button onClick={() => saveFee(u)} disabled={savingId === u.id} className="w-7 h-7 flex items-center justify-center rounded-full bg-[#16A34A] text-white hover:bg-[#0F766E] transition-colors disabled:opacity-50" title="Guardar">
                                                            <Check size={14} />
                                                        </button>
                                                        <button onClick={() => setFeeEdit(null)} className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors" title="Cancelar">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setFeeEdit({ userId: u.id, value: String(feePct) })}
                                                    className="inline-flex items-center gap-2 group"
                                                    title="Click para editar la comisión de esta empresa"
                                                >
                                                    <span className="text-base font-bold text-slate-800 tabular-nums group-hover:text-[#16A34A] transition-colors">{feePct}%</span>
                                                    <span className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 bg-slate-50 group-hover:bg-[#16A34A] group-hover:text-white transition-colors">
                                                        <Pencil size={13} />
                                                    </span>
                                                </button>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {previewRate != null ? (
                                                <div>
                                                    <span className={`text-base font-black tabular-nums ${editing ? 'text-[#16A34A]' : 'text-slate-800'}`}>
                                                        {previewRate.toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                                                    </span>
                                                    <p className="text-[9px] text-slate-400">base {baseRate!.toLocaleString('es-CO', { maximumFractionDigits: 2 })} − {isNaN(previewPct) ? '—' : previewPct}%{editing ? ' · así le quedaría' : ''}</p>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-slate-300">{rateLoading ? '…' : 'sin tasa base'}</span>
                                            )}
                                        </td>
                                        {/* Mesa manual: otro riel, otra comisión. Se edita igual
                                            que la de ACH y sale del mismo raw_data.otcConfig. */}
                                        <td className="px-4 py-3 text-right">
                                            {manualEdit?.userId === u.id ? (
                                                <div className="inline-flex items-center gap-2 bg-white border-2 border-[#4ADE80] rounded-xl pl-3 pr-1.5 py-1 shadow-sm shadow-green-100">
                                                    <input autoFocus type="text" inputMode="decimal" placeholder="0.25" value={manualEdit.value}
                                                        onChange={e => { const v = e.target.value; if (/^[0-9]*[.,]?[0-9]*$/.test(v)) setManualEdit({ userId: u.id, value: v }); }}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveManual(u); if (e.key === 'Escape') setManualEdit(null); }}
                                                        className="w-16 bg-transparent text-right text-base font-bold text-slate-800 outline-none tabular-nums" />
                                                    <span className="text-sm text-slate-400 font-medium">%</span>
                                                    <div className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-200">
                                                        <button onClick={() => saveManual(u)} disabled={savingId === u.id} className="w-7 h-7 flex items-center justify-center rounded-full bg-[#16A34A] text-white hover:bg-[#0F766E] transition-colors disabled:opacity-50" title="Guardar">
                                                            <Check size={14} />
                                                        </button>
                                                        <button onClick={() => setManualEdit(null)} className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors" title="Cancelar">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (() => {
                                                // Distinguir "tiene 0% pactado" de "todavía sin
                                                // pactar" — son cosas distintas y confundirlas es
                                                // justamente cobrarle a quien no se le debe cobrar.
                                                const propio = typeof cfg.manualPct === 'number' && !isNaN(cfg.manualPct);
                                                const efectivo = propio ? Number(cfg.manualPct) : DEFAULT_MANUAL_PCT;
                                                return (
                                                    <button
                                                        onClick={() => setManualEdit({ userId: u.id, value: String(efectivo) })}
                                                        className="inline-flex items-center gap-2 group"
                                                        title="Comisión de la mesa manual para este cliente"
                                                    >
                                                        <span className="text-right">
                                                            <span className={`block text-base font-bold tabular-nums transition-colors ${propio ? 'text-slate-800' : 'text-slate-400'} group-hover:text-[#16A34A]`}>
                                                                {efectivo}%
                                                            </span>
                                                            <span className={`block text-[9px] ${propio ? 'text-[#16A34A]' : 'text-slate-400'}`}>
                                                                {propio ? 'pactado' : 'sin pactar'}
                                                            </span>
                                                        </span>
                                                        <span className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 bg-slate-50 group-hover:bg-[#16A34A] group-hover:text-white transition-colors">
                                                            <Pencil size={13} />
                                                        </span>
                                                    </button>
                                                );
                                            })()}
                                        </td>
                                    </tr>
                                );
                            })}
                            {filtered.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-sm">Sin clientes registrados todavía.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <p className="text-[11px] text-slate-400">
                    ⚡ Con OTC inactivo, el botón "Mesa OTC" del cliente en Servicios muestra un aviso de servicio no habilitado. La comisión aquí se resta de la tasa base de Finity y la tasa resultante es la que ve el cliente en su convertidor ACH — cada empresa puede tener una distinta.
                </p>

                {/* Debug técnico: cuentas ACH inscritas en Finity (antes salía
                    en la pantalla de Beneficiarios del CLIENTE — aquí es su
                    lugar: solo el admin ve la lista completa de la empresa). */}
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                            <p className="text-sm font-bold text-slate-800">🔧 Cuentas inscritas en el proveedor (debug)</p>
                            <p className="text-[11px] text-slate-400">Lista cruda de external accounts en Finity con su estado de verificación — para diagnosticar emparejamientos y aprobaciones.</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {([['external_accounts', 'Cuentas'], ['movements', 'Movimientos'], ['balance', 'Saldo']] as const).map(([act, label]) => (
                                <button key={act} onClick={async () => {
                                    if (!currentUser?.id || eaLoading) return;
                                    setEaLoading(true);
                                    try { const r = await callFinity(act, currentUser.id); setEaRaw({ action: act, status: r?.status, path: r?.path, data: r?.data ?? r }); }
                                    catch (e: any) { setEaRaw({ action: act, error: String(e?.message ?? e) }); }
                                    setEaLoading(false);
                                }} disabled={eaLoading}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                    {eaLoading ? '…' : label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {eaRaw && (
                        <pre className="mt-3 text-[10px] bg-slate-50 border border-slate-100 rounded-lg p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
{JSON.stringify(eaRaw.data ?? eaRaw, null, 2)?.slice(0, 8000)}
                        </pre>
                    )}
                </div>
            </div>

            {/* ── Contabilidad ────────────────────────────────────────── */}
            <div className="space-y-6 pt-6 border-t border-slate-200">
                <div>
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                        <Landmark size={20} className="text-[#16A34A]" /> Contabilidad OTC · Canal Finity (ACH)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        USDT recibido y COP acreditado por conversiones OTC, saldo ACH de cada cliente, y el historial de movimientos.
                    </p>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <ArrowDownToLine size={14} /> USDT recibido
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">{fmtUsdt(totals.usdt)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">USDT · a la recaudadora</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <ArrowUpFromLine size={14} /> COP enviado
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">${fmtCop(totals.cop)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">COP · acreditado a clientes</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <Users size={14} /> Saldo ACH total
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">${fmtCop(totalCopBalance)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Suma de billeteras ACH (COP)</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wide mb-2">
                            <ArrowLeftRight size={14} /> Conversiones
                        </div>
                        <p className="text-xl font-black text-slate-800 tabular-nums">{totals.count}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5 flex gap-1.5">
                            <span className="text-green-600 font-bold">{totals.completados} ok</span>
                            <span className="text-amber-600 font-bold">{totals.pendientes} en proceso</span>
                            <span className="text-red-600 font-bold">{totals.rechazados} rechaz.</span>
                        </p>
                    </div>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">COP acreditado · últimos 14 días</p>
                        <MiniBarChart data={dailyData} />
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">COP acreditado · últimos 6 meses</p>
                        <MiniBarChart data={monthlyData} />
                    </div>
                </div>

                {/* Per-client COP balance report */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Saldo ACH por cliente</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Empresa</th>
                                <th className="text-right px-4 py-3">Saldo ACH actual</th>
                                <th className="text-right px-4 py-3">USDT convertido</th>
                                <th className="text-right px-4 py-3">COP recibido (histórico)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {perUserReport.map(({ user, usdt, cop, count }) => (
                                <tr key={user.id} className="border-t border-slate-100">
                                    <td className="px-4 py-3">
                                        <p className="font-bold text-slate-800">{user.name || '—'}</p>
                                        <p className="text-xs text-slate-400">{user.email}</p>
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">${fmtCop(achBalanceOf(user))}</td>
                                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{count > 0 ? fmtUsdt(usdt) : '—'}</td>
                                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{count > 0 ? `$${fmtCop(cop)}` : '—'}</td>
                                </tr>
                            ))}
                            {perUserReport.length === 0 && (
                                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">Sin clientes registrados todavía.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Movements */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Movimientos OTC recientes</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Fecha</th>
                                <th className="text-left px-4 py-3">Cliente</th>
                                <th className="text-right px-4 py-3">USDT</th>
                                <th className="text-right px-4 py-3">COP</th>
                                <th className="text-center px-4 py-3">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {otcTxs.slice(0, 50).map((t: any) => {
                                const u = usersById.get(t.userId);
                                return (
                                    <tr key={t.id} className="border-t border-slate-100">
                                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                                            {t.createdAt ? new Date(t.createdAt).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-slate-800">{u?.name ?? t.userName ?? '—'}</p>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtUsdt(Number(t.usdtOut ?? t.fromAmount ?? 0))}</td>
                                        <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">${fmtCop(Number(t.amount ?? 0))}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusStyle(t.status)}`}>
                                                {t.status === 'Completado' ? 'Completado' : t.status === 'Rechazado' ? 'Rechazado' : 'En proceso'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {otcTxs.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-sm">Sin movimientos OTC todavía.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
