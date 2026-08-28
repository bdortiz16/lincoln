import React, { useState } from 'react';
import { Zap, RefreshCw, Copy, Search, Landmark, Activity, Send, X } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';

// ─────────────────────────────────────────────
// AdminGasFreeSection — Panel "GasFree USDT" del admin de Empresas.
//
// Modelo NUEVO (reemplaza Tatum): cada cliente tiene una wallet GasFree
// (su cajita de depósito USDT en TRON). GasFree genera esas direcciones
// a partir del EOA que deriva CuyPay. Los depósitos y envíos NO usan TRX
// — la comisión de red se paga en USDT. Todo pasa por aquí.
// ─────────────────────────────────────────────

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

// La función ahora exige sesión de admin real (antes bastaba la llave
// pública — cualquiera pudo haber movido fondos de la recaudadora con
// solo esa key, ya visible en el bundle JS). Se manda el JWT real de la
// sesión, o AdminBypass si es una sesión de administrador sin Supabase Auth.
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
    // Body vacío (timeout/504) rompía JSON.parse con "Unexpected end of JSON
    // input" — se maneja devolviendo un error legible.
    const txt = await r.text();
    if (!txt) return { error: r.ok ? 'Respuesta vacía del servidor (posible timeout). Reintenta.' : `HTTP ${r.status} sin cuerpo` };
    try { return JSON.parse(txt); } catch { return { error: `Respuesta no válida (HTTP ${r.status}): ${txt.slice(0, 200)}` }; }
}
async function callFinityProxy(body: Record<string, unknown>): Promise<any> {
    const r = await fetch(`${SURL}/functions/v1/finity-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${SKEY}` },
        body: JSON.stringify(body),
    });
    return r.json();
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const AdminGasFreeSection: React.FC = () => {
    const { getAllUsers, updateUserProfile } = useDatabase();
    const [q, setQ] = useState('');
    // Ajuste manual del Dólar digital — para cuadrar el libro contable
    // contra el saldo real on-chain de la wallet GasFree (ej. saldos
    // heredados de flujos anteriores que ya no reflejan lo real).
    const [usdEdit, setUsdEdit] = useState<{ userId: string; value: string } | null>(null);
    const [usdSaving, setUsdSaving] = useState(false);
    const [usdErr, setUsdErr] = useState<string | null>(null);
    const saveUsd = async (u: any) => {
        if (!usdEdit || usdEdit.userId !== u.id) return;
        // Vacío = 0 (para "quitar" el saldo sin tener que escribir "0" a mano)
        const raw = usdEdit.value.trim();
        const next = raw === '' ? 0 : parseFloat(raw);
        if (isNaN(next) || next < 0) { setUsdErr('Monto inválido — usa un número igual o mayor a 0.'); return; }
        setUsdErr(null);
        setUsdSaving(true);
        try {
            await updateUserProfile(u.id, { balances: { ...u.balances, USD: next } });
            setUsdEdit(null);
        } catch (e: any) {
            setUsdErr(`No se pudo guardar: ${e?.message ?? 'error desconocido'}`);
        } finally { setUsdSaving(false); }
    };
    const [copied, setCopied] = useState<string | null>(null);

    // Estado de la recaudadora GasFree
    const [rec, setRec] = useState<any>(null);
    const [recLoading, setRecLoading] = useState(false);

    // Saldos de la plataforma Finity (USDt + Peso Finity/COP)
    const [finityBal, setFinityBal] = useState<{ usdt: number | null; cop: number | null; sandbox?: boolean; error?: string; raw?: any; status?: any; source?: string; needsPortalCreds?: boolean } | null>(null);
    const [finityBalLoading, setFinityBalLoading] = useState(false);
    const loadFinityBalances = async () => {
        setFinityBalLoading(true);
        try {
            const r = await callFinityProxy({ action: 'treasury_balances' });
            if (r?.error) setFinityBal({ usdt: r.usdt ?? null, cop: r.cop ?? null, error: r.error, raw: r.raw ?? r, needsPortalCreds: r.needsPortalCreds });
            else setFinityBal({ usdt: r.usdt ?? null, cop: r.cop ?? null, sandbox: r.sandbox, raw: r.raw, status: r.status, source: r.source });
        } catch (e: any) { setFinityBal({ usdt: null, cop: null, error: e?.message ?? 'Error' }); }
        setFinityBalLoading(false);
    };

    // ── Recuperación de wallet (localizar índice de una dirección + barrer) ──
    const [recAddr, setRecAddr] = useState('');
    const [recRange, setRecRange] = useState('25');
    const [recBusy, setRecBusy] = useState(false);
    const [recResult, setRecResult] = useState<{ found?: boolean; index?: number; mnemonic?: string; balanceUsdt?: number; gasFreeAddress?: string; scannedUpTo?: number; error?: string; swept?: number; traceId?: string } | null>(null);
    const locateAddr = async () => {
        setRecBusy(true); setRecResult(null);
        try {
            const r = await callGasfree({ action: 'find_address', address: recAddr.trim(), extra: Number(recRange) || 25 });
            setRecResult(r?.error ? { error: r.error } : r);
        } catch (e: any) { setRecResult({ error: e?.message ?? 'Error' }); }
        setRecBusy(false);
    };
    const sweepIdx = async (index: number, mnemonic?: string) => {
        if (!confirm(`¿Barrer el USDT del índice ${index} a la Tesorería? Esto mueve los fondos on-chain.`)) return;
        setRecBusy(true);
        try {
            const r = await callGasfree({ action: 'sweep_index', index, mnemonic });
            setRecResult((prev) => ({ ...(prev ?? {}), ...(r?.error ? { error: r.error } : { swept: r.swept, traceId: r.traceId }) }));
        } catch (e: any) { setRecResult((prev) => ({ ...(prev ?? {}), error: e?.message ?? 'Error' })); }
        setRecBusy(false);
    };
    // Auditoría de wallets: detectar colisiones (mismo índice en correos distintos).
    const [auditBusy, setAuditBusy] = useState(false);
    const [audit, setAudit] = useState<{ considered?: number; uniqueIndexes?: number; noIndex?: number; collisions?: { index: number; emails: string[] }[]; error?: string } | null>(null);
    const runAudit = async () => {
        setAuditBusy(true); setAudit(null);
        try {
            const r = await callGasfree({ action: 'audit_indexes' });
            setAudit(r?.error ? { error: r.error } : r);
        } catch (e: any) { setAudit({ error: e?.message ?? 'Error' }); }
        setAuditBusy(false);
    };
    // Reparación de colisión: reasignar a un usuario (por correo) una wallet nueva.
    const [fixEmail, setFixEmail] = useState('');
    const [fixBusy, setFixBusy] = useState(false);
    const [fixResult, setFixResult] = useState<{ email?: string; oldIndex?: number | null; newIndex?: number; gasFreeAddress?: string; error?: string } | null>(null);
    const reassignWallet = async () => {
        if (!confirm(`¿Reasignar una wallet NUEVA a ${fixEmail.trim()}? No mueve fondos; solo cambia a qué wallet apunta ese usuario de aquí en adelante.`)) return;
        setFixBusy(true); setFixResult(null);
        try {
            const r = await callGasfree({ action: 'reset_user_index', email: fixEmail.trim() });
            setFixResult(r?.error ? { error: r.error } : r);
        } catch (e: any) { setFixResult({ error: e?.message ?? 'Error' }); }
        setFixBusy(false);
    };

    // Por usuario: dirección GasFree + saldo
    const [rows, setRows] = useState<Record<string, { loading?: boolean; gasFreeAddress?: string; balance?: number; active?: boolean; error?: string; debug?: any }>>({});
    const [loadingAll, setLoadingAll] = useState(false);
    const [sweepMsg, setSweepMsg] = useState<string | null>(null);
    const [sweepingAll, setSweepingAll] = useState(false);

    const allUsers = getAllUsers();
    const businesses = allUsers.filter((u: any) => u.role !== 'admin' && u.role !== 'personal');
    const filtered = businesses.filter((u: any) => {
        if (!q) return true;
        const s = q.toLowerCase();
        return (u.name ?? '').toLowerCase().includes(s) || (u.email ?? '').toLowerCase().includes(s) || (u.id ?? '').toLowerCase().includes(s);
    });

    const copy = (t: string) => { navigator.clipboard?.writeText(t); setCopied(t); setTimeout(() => setCopied(null), 1500); };

    const loadRec = async () => {
        setRecLoading(true);
        try {
            const r = await callGasfree({ action: 'status' });
            setRec(r?.error ? { error: r.error } : r);
        } catch (e: any) { setRec({ error: e?.message ?? 'Error' }); }
        setRecLoading(false);
    };

    const loadUser = async (userId: string) => {
        setRows(p => ({ ...p, [userId]: { ...p[userId], loading: true } }));
        try {
            const r = await callGasfree({ action: 'user_address', userId });
            if (r?.error) setRows(p => ({ ...p, [userId]: { error: r.error } }));
            else setRows(p => ({ ...p, [userId]: { gasFreeAddress: r.gasFreeAddress, balance: r.balance, active: r.active, debug: r.debug } }));
        } catch (e: any) { setRows(p => ({ ...p, [userId]: { error: e?.message ?? 'Error' } })); }
    };

    const loadAll = async () => {
        setLoadingAll(true);
        for (const u of filtered) { await loadUser(u.id); }
        setLoadingAll(false);
    };

    const [sweepingOne, setSweepingOne] = useState<string | null>(null);
    const sweepOne = async (userId: string) => {
        if (!window.confirm('¿Barrer el USDT de este cliente a la recaudadora? (comisión en USDT)')) return;
        setSweepingOne(userId); setSweepMsg(null);
        try {
            const r = await callGasfree({ action: 'sweep_user', userId });
            if (r?.error) setSweepMsg(`❌ ${r.error}`);
            else { setSweepMsg(`✅ Barridos ${fmt(r.swept)} USDT a la recaudadora · traceId ${r.traceId}`); loadUser(userId); }
        } catch (e: any) { setSweepMsg(`❌ ${e?.message ?? 'Error'}`); }
        setSweepingOne(null);
    };

    const [locating, setLocating] = useState<string | null>(null);
    const locateFunds = async (userId: string) => {
        setLocating(userId); setSweepMsg(null);
        try {
            const r = await callGasfree({ action: 'locate', userId });
            if (r?.error) { setSweepMsg(`❌ ${r.error}`); }
            else {
                const debugLine = r.gasFreeUsdt.mainnet === 0
                    ? `\n\n🔧 Diagnóstico (mainnet): ${JSON.stringify(r.debugRaw?.gfMain).slice(0, 400)}`
                    : '';
                setSweepMsg(
                    `🔍 USDT localizado para esta wallet GasFree:\n${r.gasFreeAddress}\n` +
                    `  • en MAINNET: ${fmt(r.gasFreeUsdt.mainnet)} USDT\n` +
                    `  • en NILE (testnet): ${fmt(r.gasFreeUsdt.nile)} USDT` +
                    debugLine
                );
            }
        } catch (e: any) { setSweepMsg(`❌ ${e?.message ?? 'Error'}`); }
        setLocating(null);
    };

    const sweepAll = async () => {
        if (!window.confirm('¿Barrer el USDT de todas las wallets GasFree de clientes hacia la recaudadora? (comisión en USDT por cada barrido)')) return;
        setSweepingAll(true); setSweepMsg(null);
        try {
            const r = await callGasfree({ action: 'sweep_all' });
            if (r?.error) setSweepMsg(`❌ ${r.error}`);
            else {
                const done = (r.results ?? []).filter((x: any) => x.ok);
                const failed = (r.results ?? []).filter((x: any) => x.error);
                const total = done.reduce((a: number, x: any) => a + (x.swept ?? 0), 0);
                const errs = failed.length ? '\n\n' + failed.map((x: any) => `• ${x.userId}: ${x.error}`).join('\n') : '';
                setSweepMsg(`✅ Barridos ${done.length} (${fmt(total)} USDT) a la recaudadora. ${failed.length} con error/sin saldo.${errs}`);
                loadAll();
            }
        } catch (e: any) { setSweepMsg(`❌ ${e?.message ?? 'Error'}`); }
        setSweepingAll(false);
    };

    const mask = (a?: string) => a && a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-6)}` : (a ?? '—');

    // ── Tesorería: parámetro de alerta editable (ej. avisar cuando el
    // saldo de la recaudadora supere 10,000 USDT) ──
    const [treasuryCfg, setTreasuryCfg] = useState<{ alertThresholdUsdt: number; notes: string; alertProviderId: string | null } | null>(null);
    const [treasuryEdit, setTreasuryEdit] = useState<{ alertThresholdUsdt: string; notes: string; alertProviderId: string }>({ alertThresholdUsdt: '', notes: '', alertProviderId: '' });
    const [treasurySaving, setTreasurySaving] = useState(false);
    const loadTreasuryCfg = async () => {
        const r = await callGasfree({ action: 'get_treasury_config' });
        if (!r?.error) { setTreasuryCfg(r); setTreasuryEdit({ alertThresholdUsdt: String(r.alertThresholdUsdt), notes: r.notes ?? '', alertProviderId: r.alertProviderId ?? '' }); }
    };
    const saveTreasuryCfg = async () => {
        setTreasurySaving(true);
        try {
            const r = await callGasfree({ action: 'set_treasury_config', config: { alertThresholdUsdt: Number(treasuryEdit.alertThresholdUsdt) || 0, notes: treasuryEdit.notes, alertProviderId: treasuryEdit.alertProviderId || null } });
            if (!r?.error) setTreasuryCfg(r);
        } finally { setTreasurySaving(false); }
    };

    // ── Proveedores: registro editable (a quién se paga con el USDT
    // acumulado en Tesorería) ──
    const [providers, setProvidersList] = useState<any[]>([]);
    const [providersLoaded, setProvidersLoaded] = useState(false);
    const [newProvider, setNewProvider] = useState({ name: '', detail: '' });
    const loadProviders = async () => {
        const r = await callGasfree({ action: 'get_providers' });
        if (!r?.error) { setProvidersList(r.providers ?? []); setProvidersLoaded(true); }
    };
    const saveProviders = async (list: any[]) => {
        setProvidersList(list);
        await callGasfree({ action: 'set_providers', providers: list });
    };
    const addProvider = () => {
        if (!newProvider.name.trim()) return;
        const next = [...providers, { id: `p_${Date.now()}`, name: newProvider.name.trim(), detail: newProvider.detail.trim() }];
        setNewProvider({ name: '', detail: '' });
        saveProviders(next);
    };
    const removeProvider = (id: string) => saveProviders(providers.filter(p => p.id !== id));
    // A qué proveedor se le paga cuando el saldo de Tesorería supera el
    // umbral configurado — antes solo era una nota de texto libre, sin
    // ligar al registro real de Proveedores (puede haber varios inscritos).
    const alertProvider = providers.find((p: any) => p.id === treasuryCfg?.alertProviderId) ?? null;

    // ── Pago manual a proveedor desde Tesorería — no depende de ningún
    // mínimo acumulado, es a discreción del admin. Comisión GasFree en vivo. ──
    const [payTarget, setPayTarget] = useState<any>(null); // proveedor siendo pagado
    const [payAmount, setPayAmount] = useState('');
    const [paying, setPaying] = useState(false);
    const [payMsg, setPayMsg] = useState<string | null>(null);
    const payFeeEstimate = rec?.token
        ? fmt(rec.token.transferFee / 1e6) + (rec.active ? '' : ` (+${fmt(rec.token.activateFee / 1e6)} activación)`)
        : null;
    const doPayProvider = async () => {
        const amt = parseFloat(payAmount);
        if (!payTarget || isNaN(amt) || amt <= 0) return;
        if (!window.confirm(`¿Pagar ${fmt(amt)} USDT a ${payTarget.name} (${mask(payTarget.detail)})? Se cobra aparte la comisión GasFree vigente.`)) return;
        setPaying(true); setPayMsg(null);
        try {
            const r = await callGasfree({ action: 'send', toAddress: payTarget.detail, amount: amt, providerName: payTarget.name });
            if (r?.error) setPayMsg(`❌ ${r.error}`);
            else {
                setPayMsg(`✅ Pagados ${fmt(amt)} USDT a ${payTarget.name} · comisión GasFree ${fmt(r.feeChargedUsdt)} USDT · traceId ${r.traceId}`);
                setPayTarget(null); setPayAmount('');
                loadRec();
            }
        } catch (e: any) { setPayMsg(`❌ ${e?.message ?? 'Error'}`); }
        setPaying(false);
    };

    // ── Movimientos de Tesorería (auditoría: entradas por barrido +
    // salidas por pago a proveedores, con la comisión real de cada uno) ──
    const [showMovements, setShowMovements] = useState(false);
    const [movements, setMovements] = useState<any[] | null>(null);
    const [movementsLoading, setMovementsLoading] = useState(false);
    const loadMovements = async () => {
        setMovementsLoading(true);
        try {
            const r = await callGasfree({ action: 'get_treasury_movements' });
            setMovements(r?.movements ?? []);
        } catch { setMovements([]); }
        setMovementsLoading(false);
    };
    const openMovements = () => { setShowMovements(true); loadMovements(); };

    React.useEffect(() => { loadRec(); loadTreasuryCfg(); loadProviders(); loadFinityBalances(); /* eslint-disable-next-line */ }, []);

    // Auto-refresco de los saldos de Finity cada minuto.
    React.useEffect(() => {
        const id = setInterval(() => { loadFinityBalances(); }, 60_000);
        return () => clearInterval(id);
        /* eslint-disable-next-line */
    }, []);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div>
                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                    <Zap size={20} className="text-[#0D9488]" /> GasFree · Custodia USDT (TRON)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                    Cada cliente tiene su <b>wallet GasFree</b> (cajita USDT). Los depósitos y envíos <b>no usan TRX</b> — la comisión de red se paga en USDT.
                </p>
            </div>

            {/* Tesorería (recaudadora): aquí llega el USDT de las conversiones de
                clientes; desde aquí se pagan los envíos y a los proveedores.
                Estilo billetera (igual al del cliente) — se carga sola al
                entrar, sin tener que darle a "Actualizar" primero. */}
            <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-[#0F172A] to-[#0F172A] text-white shadow-xl relative">
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
                <div className="relative z-10 p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center font-bold text-lg shrink-0">₮</div>
                            <div>
                                <p className="font-bold text-sm flex items-center gap-2"><Landmark size={14} className="text-[#2DD4BF]" /> Tesorería GasFree (recaudadora)</p>
                                <p className="text-[11px] text-teal-100/70">Aquí llega el USDT de conversiones · desde aquí salen envíos y pagos a proveedores</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button onClick={openMovements} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
                                <Activity size={13} /> Movimientos y comisiones
                            </button>
                            <button onClick={loadRec} disabled={recLoading} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg disabled:opacity-60 transition-colors">
                                <RefreshCw size={13} className={recLoading ? 'animate-spin' : ''} /> {recLoading ? 'Consultando…' : rec?.gasFreeAddress ? 'Actualizar' : 'Generar wallet'}
                            </button>
                        </div>
                    </div>

                    {!rec && !recLoading && (
                        <p className="text-xs text-teal-100/70">
                            Todavía no se ha generado la wallet de la recaudadora — dale a "Generar wallet". No necesitas configurar ninguna llave a mano: se deriva sola, igual que la wallet de cada cliente.
                        </p>
                    )}
                    {recLoading && !rec && (
                        <div className="h-12 w-40 bg-white/10 rounded-lg animate-pulse" />
                    )}
                    {rec && (rec.error ? (
                        <div className="text-xs font-semibold text-red-200 bg-red-500/10 border border-red-400/30 rounded-lg p-3 whitespace-pre-wrap">❌ {rec.error}</div>
                    ) : (
                        <>
                            <div>
                                <p className="text-4xl font-bold tracking-tight">
                                    {fmt(rec.balance)} <span className="text-base font-normal text-teal-200">USDT</span>
                                </p>
                                <button onClick={() => rec.gasFreeAddress && copy(rec.gasFreeAddress)} className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-teal-100/80 hover:text-white font-mono">
                                    {rec.gasFreeAddress}
                                    <Copy size={12} />
                                    {copied === rec.gasFreeAddress && <span className="text-teal-300 font-sans">copiado</span>}
                                </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                                <WalletStat label="Red" value={rec.net === 'tron' ? 'Mainnet' : 'Nile testnet'} />
                                <WalletStat label="Estado" value={rec.active ? 'Activa' : 'Se activa en el 1er envío'} />
                                <WalletStat label="Comisión por envío" value={rec.token ? `${fmt(rec.token.transferFee / 1e6)} (+${fmt(rec.token.activateFee / 1e6)} activ.)` : '—'} />
                                <WalletStat label="Proveedor" value={rec.provider?.name ?? '—'} />
                            </div>
                        </>
                    ))}
                    {rec && !rec.error && treasuryCfg && (
                        <div className={`text-xs font-bold rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap ${rec.balance >= treasuryCfg.alertThresholdUsdt ? 'bg-amber-400/15 text-amber-200' : 'bg-white/5 text-teal-100/70'}`}>
                            <span>
                                {rec.balance >= treasuryCfg.alertThresholdUsdt
                                    ? `⚠️ El saldo de Tesorería (${fmt(rec.balance)} USDT) superó el umbral configurado (${fmt(treasuryCfg.alertThresholdUsdt)} USDT).`
                                    : `Umbral de alerta: ${fmt(treasuryCfg.alertThresholdUsdt)} USDT (saldo actual ${fmt(rec.balance)} USDT).`}
                                {' '}{alertProvider ? <>Proveedor destino: <span className="text-white">{alertProvider.name}</span>.</> : 'Sin proveedor destino asignado.'}
                            </span>
                            {rec.balance >= treasuryCfg.alertThresholdUsdt && alertProvider && (
                                <button onClick={() => { setPayTarget(alertProvider); setPayAmount(''); setPayMsg(null); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 text-[#3a2a00] rounded-lg font-bold hover:bg-amber-300 transition-colors shrink-0">
                                    <Send size={12} /> Pagar a {alertProvider.name}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Saldos en la plataforma Finity (USDt + Peso Finity/COP) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                    <div>
                        <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
                            <Landmark size={15} className="text-[#0D9488]" /> Saldos en Finity
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Saldo real de la cuenta Finity de CuyPay (partner de dispersión COP). · Se actualiza solo cada minuto.</p>
                    </div>
                    <button onClick={loadFinityBalances} disabled={finityBalLoading} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors text-slate-700">
                        <RefreshCw size={13} className={finityBalLoading ? 'animate-spin' : ''} /> {finityBalLoading ? 'Consultando…' : 'Actualizar'}
                    </button>
                </div>
                {finityBal?.error ? (
                    <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">❌ {finityBal.error}</div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-slate-200 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">USDt · Dólar Digital</p>
                            <p className="text-2xl font-black text-slate-800 tabular-nums">
                                {finityBalLoading && !finityBal ? '—' : finityBal?.usdt != null ? `$${finityBal.usdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                                <span className="text-sm font-bold text-slate-400 ml-1">USDt</span>
                            </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Peso Finity · COP</p>
                            <p className="text-2xl font-black text-slate-800 tabular-nums">
                                {finityBalLoading && !finityBal ? '—' : finityBal?.cop != null ? `$${finityBal.cop.toLocaleString('es-CO', { maximumFractionDigits: 2 })}` : '—'}
                                <span className="text-sm font-bold text-slate-400 ml-1">COP</span>
                            </p>
                        </div>
                    </div>
                )}
                {finityBal?.sandbox && (
                    <p className="text-[11px] font-bold text-amber-600 mt-3">⚠ El conector está en SANDBOX — estos saldos son de prueba, no reales.</p>
                )}
                {finityBal && finityBal.usdt == null && finityBal.cop == null && !finityBal.error && !finityBalLoading && (
                    <p className="text-[11px] text-slate-400 mt-3">No se pudieron leer los saldos de Finity (revisa credenciales del conector o el formato de la respuesta).</p>
                )}
            </div>

            {/* Recuperación de wallet: localizar el índice HD de una dirección
                y barrer su USDT a Tesorería (para depósitos que llegaron a una
                wallet cuyo índice se perdió). */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
                <p className="font-bold text-slate-800 text-sm">🛟 Recuperar wallet / localizar depósito</p>
                <p className="text-[11px] text-slate-500 -mt-1.5">Pega la dirección USDT (GasFree) donde llegó un depósito. Localiza su índice y barre el saldo a Tesorería.</p>
                <div className="flex items-end gap-2 flex-wrap">
                    <input
                        value={recAddr}
                        onChange={(e) => setRecAddr(e.target.value)}
                        placeholder="Dirección USDT (TRC-20) · ej. TJQ5z9xMnZkt2KN24iUJCjM8itCAPP4v9H"
                        className="flex-1 min-w-[240px] px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2DD4BF]"
                    />
                    <input
                        value={recRange}
                        onChange={(e) => setRecRange(e.target.value.replace(/[^0-9]/g, ''))}
                        title="Rango extra de índices a escanear"
                        className="w-20 px-2 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2DD4BF]"
                        placeholder="rango"
                    />
                    <button onClick={locateAddr} disabled={recBusy || !recAddr.trim()} className="px-3 py-2 text-xs font-bold rounded-lg bg-[#0F172A] text-white hover:bg-[#152e52] disabled:opacity-60">
                        {recBusy ? 'Buscando…' : 'Localizar'}
                    </button>
                </div>
                <p className="text-[10px] text-slate-400 -mt-1">Sube el "rango" (ej. 300) si no la encuentra — escanea más índices.</p>
                {recResult && (
                    <div className="text-xs bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                        {recResult.error ? (
                            <p className="text-red-700 font-semibold">❌ {recResult.error}</p>
                        ) : recResult.found ? (
                            <>
                                <p className="text-slate-700">✅ Encontrada en el <b>índice {recResult.index}</b>{recResult.mnemonic ? ` (${recResult.mnemonic})` : ''} · saldo <b>{Number(recResult.balanceUsdt ?? 0).toFixed(2)} USDT</b></p>
                                <p className="text-[11px] font-mono text-slate-400 break-all">{recResult.gasFreeAddress}</p>
                                {typeof recResult.index === 'number' && Number(recResult.balanceUsdt ?? 0) > 0 && (
                                    <button onClick={() => sweepIdx(recResult.index!, recResult.mnemonic)} disabled={recBusy} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#2DD4BF] text-[#0F172A] hover:bg-[#26bda9] disabled:opacity-60">
                                        {recBusy ? 'Barriendo…' : `Barrer ${Number(recResult.balanceUsdt ?? 0).toFixed(2)} USDT a Tesorería`}
                                    </button>
                                )}
                                {recResult.swept != null && (
                                    <p className="text-green-700 font-semibold">✅ Barrido {Number(recResult.swept).toFixed(2)} USDT · TxID {String(recResult.traceId ?? '').slice(0, 14)}…</p>
                                )}
                            </>
                        ) : (
                            <p className="text-slate-500">No se encontró esa dirección en los índices escaneados (hasta {recResult.scannedUpTo}). Verifica la dirección o aumenta el rango.</p>
                        )}
                    </div>
                )}

                {/* Auditoría de colisiones */}
                <div className="pt-3 mt-1 border-t border-amber-200/70">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[11px] font-bold text-slate-600">🔍 Auditar wallets (verificar que cada usuario tenga la suya, única)</p>
                        <button onClick={runAudit} disabled={auditBusy} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-60">
                            {auditBusy ? 'Auditando…' : 'Auditar'}
                        </button>
                    </div>
                    {audit && (
                        <div className="text-xs bg-white border border-slate-200 rounded-lg p-3 mt-2 space-y-1">
                            {audit.error ? (
                                <p className="text-red-700 font-semibold">❌ {audit.error}</p>
                            ) : (
                                <>
                                    <p className="text-slate-600">Usuarios revisados: <b>{audit.considered}</b> · índices únicos: <b>{audit.uniqueIndexes}</b> · sin wallet aún: <b>{audit.noIndex}</b></p>
                                    {audit.collisions && audit.collisions.length > 0 ? (
                                        <div className="mt-1">
                                            <p className="text-red-700 font-bold">⚠ {audit.collisions.length} colisión(es) — mismos índices en usuarios distintos:</p>
                                            {audit.collisions.map((c) => (
                                                <div key={c.index} className="mt-1 pl-2 border-l-2 border-red-300">
                                                    <p className="text-slate-700">Índice <b>{c.index}</b>: {c.emails.join(', ')}</p>
                                                    <p className="text-[10px] text-slate-400">Reasigna wallet a todos menos uno (abajo).</p>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-green-700 font-bold">✅ Sin colisiones — cada usuario tiene su wallet única.</p>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Reparar colisión: reasignar wallet nueva a un usuario */}
                <div className="pt-3 mt-1 border-t border-amber-200/70">
                    <p className="text-[11px] font-bold text-slate-600 mb-1.5">🔧 Reparar colisión de wallet (reasignar wallet nueva a un usuario)</p>
                    <div className="flex items-end gap-2 flex-wrap">
                        <input
                            value={fixEmail}
                            onChange={(e) => setFixEmail(e.target.value)}
                            placeholder="correo del usuario · ej. xatechgerencia@gmail.com"
                            className="flex-1 min-w-[240px] px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2DD4BF]"
                        />
                        <button onClick={reassignWallet} disabled={fixBusy || !fixEmail.trim()} className="px-3 py-2 text-xs font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60">
                            {fixBusy ? 'Reasignando…' : 'Reasignar wallet'}
                        </button>
                    </div>
                    {fixResult && (
                        <div className="text-xs bg-white border border-slate-200 rounded-lg p-3 mt-2">
                            {fixResult.error ? (
                                <p className="text-red-700 font-semibold">❌ {fixResult.error}</p>
                            ) : (
                                <>
                                    <p className="text-green-700 font-semibold">✅ {fixResult.email}: índice {fixResult.oldIndex ?? '—'} → <b>{fixResult.newIndex}</b></p>
                                    <p className="text-[11px] font-mono text-slate-500 break-all mt-1">Nueva wallet: {fixResult.gasFreeAddress ?? '(se genera al primer uso)'}</p>
                                    <p className="text-[11px] text-slate-400 mt-1">El usuario debe cerrar sesión y volver a entrar para ver su nueva dirección.</p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Parámetro editable: umbral de alerta de Tesorería */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <p className="font-bold text-slate-800 text-sm">⚙️ Parámetro de Tesorería</p>
                <p className="text-[11px] text-slate-400 -mt-1.5">Cuando el saldo supere este umbral, aquí queda claro a cuál proveedor inscrito se le debe pagar (si hay varios registrados abajo).</p>
                <div className="flex items-end gap-3 flex-wrap">
                    <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500">Alertar cuando el saldo supere (USDT)</label>
                        <input value={treasuryEdit.alertThresholdUsdt} onChange={e => setTreasuryEdit(p => ({ ...p, alertThresholdUsdt: e.target.value.replace(/[^\d.]/g, '') }))}
                            className="mt-1 w-40 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#2DD4BF]" placeholder="10000" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500">Proveedor destino</label>
                        <select value={treasuryEdit.alertProviderId} onChange={e => setTreasuryEdit(p => ({ ...p, alertProviderId: e.target.value }))}
                            className="mt-1 w-48 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#2DD4BF] bg-white">
                            <option value="">— Sin asignar —</option>
                            {providers.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 min-w-[220px]">
                        <label className="text-[10px] font-bold uppercase text-slate-500">Notas (opcional)</label>
                        <input value={treasuryEdit.notes} onChange={e => setTreasuryEdit(p => ({ ...p, notes: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#2DD4BF]" placeholder="Notas adicionales" />
                    </div>
                    <button onClick={saveTreasuryCfg} disabled={treasurySaving} style={{ color: '#FFFFFF' }} className="px-4 py-2 text-sm font-bold bg-[#0F172A] rounded-lg hover:bg-[#152e52] disabled:opacity-60">
                        {treasurySaving ? 'Guardando…' : 'Guardar'}
                    </button>
                </div>
            </div>

            {/* Proveedores: a quién se paga con el USDT de Tesorería */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <p className="font-bold text-slate-800 text-sm">🏢 Proveedores</p>
                <p className="text-[11px] text-slate-400">Registro de a quién se le paga con el USDT acumulado en Tesorería (ej. proveedor de liquidez COP).</p>
                <div className="space-y-2">
                    {providers.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm">
                            <div><span className="font-bold text-slate-800">{p.name}</span>{p.detail && <span className="text-slate-400"> · {mask(p.detail)}</span>}</div>
                            <div className="flex items-center gap-3 shrink-0">
                                <button onClick={() => { setPayTarget(p); setPayAmount(''); setPayMsg(null); }} className="inline-flex items-center gap-1 text-xs font-bold text-[#0D9488] hover:underline" title="Pagar a este proveedor desde Tesorería — manual, sin mínimo acumulado">
                                    <Send size={12} /> Pagar
                                </button>
                                <button onClick={() => removeProvider(p.id)} className="text-red-500 hover:underline text-xs font-bold">Eliminar</button>
                            </div>
                        </div>
                    ))}
                    {providersLoaded && providers.length === 0 && <p className="text-xs text-slate-400">Aún no hay proveedores registrados.</p>}
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                    <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500">Nombre</label>
                        <input value={newProvider.name} onChange={e => setNewProvider(p => ({ ...p, name: e.target.value }))} className="mt-1 w-44 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#2DD4BF]" placeholder="Proveedor X" />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-[10px] font-bold uppercase text-slate-500">Detalle (wallet, banco, nota)</label>
                        <input value={newProvider.detail} onChange={e => setNewProvider(p => ({ ...p, detail: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#2DD4BF]" placeholder="T... o datos bancarios" />
                    </div>
                    <button onClick={addProvider} style={{ color: '#FFFFFF' }} className="px-4 py-2 text-sm font-bold bg-[#0D9488] rounded-lg hover:bg-[#0f766e]">+ Agregar</button>
                </div>
            </div>

            {/* Acciones + buscador */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por empresa, correo o ID…" className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#2DD4BF]" />
                </div>
                <button onClick={loadAll} disabled={loadingAll || filtered.length === 0} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60">
                    <RefreshCw size={14} className={loadingAll ? 'animate-spin' : ''} /> {loadingAll ? 'Cargando…' : 'Cargar wallets (todos)'}
                </button>
                <button onClick={sweepAll} disabled={sweepingAll} style={{ color: '#FFFFFF' }} className="flex items-center gap-2 px-3 py-2 text-sm font-bold bg-[#0F172A] rounded-lg hover:bg-[#152e52] disabled:opacity-60">
                    <Landmark size={14} className={sweepingAll ? 'animate-pulse' : ''} /> {sweepingAll ? 'Barriendo…' : 'Barrer todo a recaudadora'}
                </button>
            </div>
            {sweepMsg && <div className="text-xs font-semibold rounded-lg px-3 py-2 border bg-slate-50 border-slate-200 text-slate-700 whitespace-pre-wrap">{sweepMsg}</div>}

            {/* Tabla de clientes */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="text-left px-4 py-3">Empresa</th>
                            <th className="text-left px-4 py-3">Wallet GasFree (USDT · TRC-20)</th>
                            <th className="text-right px-4 py-3">Saldo USDT (on-chain)</th>
                            <th className="text-right px-4 py-3">Dólar digital (libro)</th>
                            <th className="text-right px-4 py-3">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((u: any) => {
                            // Dirección ya guardada en el perfil (persiste entre recargas).
                            // La wallet GasFree es DETERMINISTA: siempre la misma para el
                            // cliente, "Generar" y "Actualizar" devuelven la misma.
                            const savedAddr = u.gasfreeAddress ?? u.raw_data?.gasfreeAddress ?? null;
                            const live = rows[u.id] ?? {};
                            const row = { ...live, gasFreeAddress: live.gasFreeAddress ?? savedAddr };
                            return (
                                <tr key={u.id} className="border-t border-slate-100">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-full bg-teal-50 text-[#0D9488] flex items-center justify-center font-bold text-xs shrink-0">₮</div>
                                            <div>
                                                <p className="font-bold text-slate-800">{u.name || '—'}</p>
                                                <p className="text-xs text-slate-400">{u.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                                        {row.error ? <span className="text-red-500">{row.error}</span>
                                            : row.gasFreeAddress ? (
                                                <div>
                                                    <span className="inline-flex items-center gap-1">{mask(row.gasFreeAddress)}
                                                        <button onClick={() => copy(row.gasFreeAddress!)} className="text-slate-400 hover:text-[#0D9488]"><Copy size={12} /></button>
                                                        {copied === row.gasFreeAddress && <span className="text-[10px] text-teal-600">copiado</span>}
                                                    </span>
                                                    {live.debug && (
                                                        <p className="text-[10px] text-slate-400 mt-1 normal-case">
                                                            {live.debug.net === 'tron' ? 'Mainnet' : 'Nile testnet'} · deposita USDT SOLO a esta dirección de arriba.
                                                        </p>
                                                    )}
                                                </div>
                                            ) : <span className="text-slate-300">— sin cargar —</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <p className="font-bold text-slate-800">
                                            {typeof row.balance === 'number' ? `${fmt(row.balance)} ₮` : '—'}
                                        </p>
                                        {row.gasFreeAddress && (
                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full mt-0.5">
                                                <Zap size={9} /> TRON · Gas Free
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {usdEdit?.userId === u.id ? (
                                            <div className="inline-flex flex-col items-end gap-1">
                                                <div className="inline-flex items-center gap-1">
                                                    <input autoFocus type="number" step="0.01" min="0" value={usdEdit.value}
                                                        onChange={e => setUsdEdit({ userId: u.id, value: e.target.value })}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveUsd(u); if (e.key === 'Escape') { setUsdEdit(null); setUsdErr(null); } }}
                                                        className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-right text-xs outline-none focus:border-[#2DD4BF]" />
                                                    <button onClick={() => saveUsd(u)} disabled={usdSaving} style={{ color: '#FFFFFF' }} className="px-2 py-1 bg-[#0F172A] rounded-lg text-[10px] font-bold disabled:opacity-50">{usdSaving ? '…' : 'OK'}</button>
                                                    <button onClick={() => { setUsdEdit(null); setUsdErr(null); }} className="text-slate-400 text-xs">✕</button>
                                                </div>
                                                {usdErr && <p className="text-[10px] font-bold text-red-600 max-w-[160px] text-right">{usdErr}</p>}
                                            </div>
                                        ) : (
                                            <button onClick={() => { setUsdEdit({ userId: u.id, value: String(u.balances?.USD ?? 0) }); setUsdErr(null); }} className="font-bold text-slate-800 hover:underline" title="Click para ajustar (ej. cuadrar contra el saldo on-chain real)">
                                                ${fmt(u.balances?.USD ?? 0)}
                                            </button>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="inline-flex items-center gap-3">
                                            <button onClick={() => loadUser(u.id)} disabled={row.loading} className="inline-flex items-center gap-1 text-xs font-bold text-[#0D9488] hover:underline disabled:opacity-50">
                                                <RefreshCw size={13} className={row.loading ? 'animate-spin' : ''} /> {row.loading ? 'Cargando…' : (row.gasFreeAddress ? 'Actualizar saldo' : 'Generar wallet')}
                                            </button>
                                            {row.gasFreeAddress && (
                                                <button onClick={() => sweepOne(u.id)} disabled={sweepingOne === u.id} className="inline-flex items-center gap-1 text-xs font-bold text-[#0F172A] hover:underline disabled:opacity-50" title="Barrer el USDT de este cliente a la recaudadora">
                                                    <Landmark size={13} /> {sweepingOne === u.id ? 'Barriendo…' : 'Barrer'}
                                                </button>
                                            )}
                                            <button onClick={() => locateFunds(u.id)} disabled={locating === u.id} className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:underline disabled:opacity-50" title="Buscar el USDT en mainnet y testnet">
                                                <Search size={13} /> {locating === u.id ? 'Buscando…' : 'Localizar USDT'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-sm">Sin clientes de empresa.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <p className="text-[11px] text-slate-400">
                ⚡ La wallet GasFree es la dirección donde el cliente deposita USDT (TRC-20). No requiere TRX. El barrido a la recaudadora y los envíos pagan la comisión en USDT.
            </p>

            {/* Modal: pagar a proveedor desde Tesorería */}
            {payTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => !paying && setPayTarget(null)}>
                    <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-5 border-b border-slate-100">
                            <div>
                                <h3 className="font-bold text-slate-800">Pagar a {payTarget.name}</h3>
                                <p className="text-xs text-slate-400 mt-0.5 font-mono break-all">{payTarget.detail}</p>
                            </div>
                            <button onClick={() => setPayTarget(null)} disabled={paying} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Monto a pagar (USDT)</label>
                                <input autoFocus type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                                    placeholder="0.00" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-lg font-mono outline-none focus:border-[#2DD4BF]" />
                            </div>
                            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500">
                                Manual, sin esperar ningún mínimo acumulado en Tesorería.{' '}
                                {payFeeEstimate != null
                                    ? <>Comisión GasFree vigente hoy: <b className="text-slate-700">{payFeeEstimate} USDT</b> (se cobra aparte del monto).</>
                                    : 'Actualiza la Tesorería arriba para ver la comisión vigente.'}
                            </div>
                            {payMsg && (
                                <div className={`text-xs font-semibold rounded-lg p-3 whitespace-pre-wrap ${payMsg.startsWith('✅') ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                                    {payMsg}
                                </div>
                            )}
                        </div>
                        <div className="px-5 pb-5">
                            <button onClick={doPayProvider} disabled={paying || !payAmount} style={{ color: '#FFFFFF' }} className="w-full h-11 bg-[#0F172A] hover:bg-[#152e52] rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                                <Send size={15} /> {paying ? 'Pagando…' : 'Confirmar pago'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: movimientos y comisiones de Tesorería */}
            {showMovements && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setShowMovements(false)}>
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 shrink-0">
                            <div>
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Activity size={16} className="text-[#0D9488]" /> Movimientos de Tesorería</h3>
                                <p className="text-xs text-slate-400 mt-0.5">Entradas (barridos de clientes) y salidas (pagos a proveedores), con la comisión real de cada una.</p>
                            </div>
                            <button onClick={() => setShowMovements(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                        </div>
                        <div className="overflow-y-auto flex-1">
                            {movementsLoading && <p className="p-6 text-center text-sm text-slate-400">Cargando…</p>}
                            {!movementsLoading && movements?.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Sin movimientos todavía.</p>}
                            {!movementsLoading && movements && movements.length > 0 && (
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider sticky top-0">
                                        <tr>
                                            <th className="text-left px-4 py-2.5">Movimiento</th>
                                            <th className="text-right px-4 py-2.5">Monto</th>
                                            <th className="text-right px-4 py-2.5">Comisión GasFree</th>
                                            <th className="text-left px-4 py-2.5">Fecha</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {movements.map((m: any) => (
                                            <tr key={m.id} className="border-t border-slate-100">
                                                <td className="px-4 py-2.5">
                                                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full mr-1.5 ${m.direction === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                        {m.direction === 'in' ? '↓ Entrada' : '↑ Salida'}
                                                    </span>
                                                    <span className="text-slate-700">{m.direction === 'in' ? (m.fromUserEmail ?? 'Barrido de cliente') : (m.providerName ?? mask(m.toAddress))}</span>
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-800">{fmt(m.amount)} ₮</td>
                                                <td className="px-4 py-2.5 text-right text-amber-600 font-semibold">{m.feeChargedUsdt != null ? `${fmt(m.feeChargedUsdt)} USDT` : '—'}</td>
                                                <td className="px-4 py-2.5 text-xs text-slate-400">{m.at ? new Date(m.at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Chip de estadística para la tarjeta oscura tipo billetera (Tesorería).
const WalletStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="bg-white/5 rounded-lg p-2.5">
        <p className="text-[9px] uppercase tracking-wider text-teal-100/60">{label}</p>
        <p className="text-xs font-bold text-white truncate" title={value}>{value}</p>
    </div>
);

const Info: React.FC<{ label: string; value?: string; onCopy?: () => void; copied?: boolean }> = ({ label, value, onCopy, copied }) => (
    <div className="bg-slate-50 rounded-lg p-2.5">
        <p className="text-[9px] uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-sm font-bold font-mono text-slate-800 break-all flex items-center gap-1">
            {value ?? '—'}
            {onCopy && value && <button onClick={onCopy} className="text-slate-400 hover:text-[#0D9488] shrink-0"><Copy size={12} /></button>}
            {copied && <span className="text-[10px] text-teal-600">copiado</span>}
        </p>
    </div>
);
