import React, { useEffect, useState } from 'react';
import {
    Landmark, RefreshCw, CheckCircle, XCircle, Plus, Send, ChevronDown,
    ChevronUp, AlertTriangle, Wallet, Activity, DollarSign,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { FinityRateChart } from './FinityRateChart';

// ─────────────────────────────────────────────
// FinitySection — Dispersiones bancarias vía Finity (riel de salida)
// para el dashboard de EMPRESAS.
//
// Habla con la edge finity-proxy (que guarda las credenciales OAuth m2m
// de Finity como secrets). Mientras confirmamos los paths/campos exactos
// contra la doc oficial, las respuestas se renderizan de forma GENÉRICA
// (tablas/list de lo que devuelva el sandbox) + un visor técnico
// colapsable para depurar. Cuando un endpoint responde 404 mostramos el
// aviso de "path por confirmar".
// ─────────────────────────────────────────────

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

export async function callFinity(action: string, userId: string, extra: Record<string, unknown> = {}) {
    // Timeout duro: si finity-proxy/Finity se cuelga, NO dejar la conversión
    // esperando para siempre. Se maneja también el cuerpo vacío (504/timeout).
    try {
        const r = await fetch(`${SURL}/functions/v1/finity-proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${SKEY}` },
            body: JSON.stringify({ action, user_id: userId, ...extra }),
            signal: AbortSignal.timeout(30000),
        });
        const t = await r.text();
        if (!t) return { ok: false, status: r.status, error: 'Respuesta vacía del servicio (posible timeout). Reintenta.' };
        try { return JSON.parse(t); } catch { return { ok: false, status: r.status, error: `Respuesta no válida (HTTP ${r.status}): ${t.slice(0, 150)}` }; }
    } catch (e: any) {
        return { ok: false, error: e?.name === 'TimeoutError' ? 'El servicio de Finity tardó demasiado (timeout). Reintenta.' : `Error de red: ${String(e?.message ?? e)}` };
    }
}

// JWT de la sesión propia — lo exige gasfree para "my_status" (nadie más
// que el propio usuario, ni con la llave pública, puede pedir su wallet).
function myAuthHeader(): string {
    try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) {
            const d = JSON.parse(localStorage.getItem(k) || '{}');
            if (d.access_token) return `Bearer ${d.access_token}`;
        }
    } catch { /* sin sesión supabase */ }
    return `Bearer ${SKEY}`;
}
async function callGasfree(body: Record<string, unknown>): Promise<any> {
    // Timeout largo: el asentamiento espera confirmaciones on-chain (hasta ~90s).
    try {
        const r = await fetch(`${SURL}/functions/v1/gasfree`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: myAuthHeader() },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(130000),
        });
        const t = await r.text();
        if (!t) return { error: 'Respuesta vacía (posible timeout). Reintenta.' };
        try { return JSON.parse(t); } catch { return { error: `Respuesta no válida (HTTP ${r.status}): ${t.slice(0, 150)}` }; }
    } catch (e: any) {
        return { error: e?.name === 'TimeoutError' ? 'El asentamiento tardó demasiado (timeout).' : String(e?.message ?? e) };
    }
}

// Saldo de la cuenta Finity como número, o null si no se pudo obtener
// (proxy sin desplegar, credenciales faltantes o endpoint por confirmar).
// Lo usan las tarjetas "Peso Lincoin" de los dashboards para mostrar el
// saldo REAL en Finity en vivo.
export async function fetchFinityBalance(userId: string): Promise<number | null> {
    try {
        const r = await callFinity('balance', userId);
        if (!r?.ok) return null;
        const d = r.data ?? {};
        const cand = d.balance ?? d.available ?? d.available_balance ?? d.availableBalance
            ?? d.amount ?? d.total
            ?? d.data?.balance ?? d.data?.available ?? d.data?.amount
            ?? (Array.isArray(d.data) ? d.data[0]?.balance ?? d.data[0]?.available : undefined);
        const n = Number(cand);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

// Comisión de Lincoin sobre la conversión (incluye IVA — misma regla que
// Contabilidad). Se lee de fx_pair_config.base_fee_pct del par USD→COP
// (editable desde Admin → Tasas → Panel Finity); 4% si no hay valor.
const DEFAULT_CONVERT_FEE_PCT = 4;

export async function fetchFinityFeePct(): Promise<number> {
    try {
        return (await fetchFinityUsdCopConfig()).feePct;
    } catch {
        return DEFAULT_CONVERT_FEE_PCT;
    }
}

// Config completa del par USD→COP para el convertidor de la app:
//   feePct   = comisión Lincoin (editable en Admin → Tasas → Panel Finity)
//   finityOn = el admin activó Finity para USD/COP (exclusión mutua: la
//              fila de FastForex queda is_active=false cuando Finity manda)
// LANZA error si la consulta falla — el caller decide reintentar. Devolver
// un default aquí escondía fallos de red como "Finity apagado".
export async function fetchFinityUsdCopConfig(): Promise<{ feePct: number; finityOn: boolean }> {
    const { data, error } = await supabase
        .from('fx_pair_config')
        .select('base_fee_pct, is_active')
        .eq('from_currency', 'USD')
        .eq('to_currency', 'COP')
        .maybeSingle();
    if (error) throw new Error(error.message);
    const n = Number((data as any)?.base_fee_pct);
    return {
        feePct: isFinite(n) && n > 0 ? n : DEFAULT_CONVERT_FEE_PCT,
        finityOn: (data as any)?.is_active === false,
    };
}

// Extrae un número de tasa de la respuesta de Finity sin conocer el shape
export function extractRate(d: any): number | null {
    if (d == null) return null;
    const cand = d.rate ?? d.value ?? d.price ?? d.cop ?? d.exchange_rate ?? d.exchangeRate
        ?? d.data?.rate ?? d.data?.value ?? d.data?.price
        ?? (Array.isArray(d) ? (d[0]?.rate ?? d[0]?.value) : undefined)
        ?? (Array.isArray(d?.data) ? (d.data[0]?.rate ?? d.data[0]?.value) : undefined);
    const n = Number(cand);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// Tasa de cambio de Finity como número (from→to), o null si no disponible.
// La usa el convertidor de la app para operar con la tasa Finity EN VIVO
// (con la tasa del sistema como respaldo).
export async function fetchFinityRateValue(userId: string, from: string, to: string): Promise<number | null> {
    try {
        const r = await callFinity('rates', userId, { query: { from, to } });
        if (!r?.ok) return null;
        // Si el proxy cayó al SANDBOX (producción rechazó las credenciales o
        // está caída), la tasa es de PRUEBA — jamás usarla como tasa real.
        if (r.sandbox === true) {
            console.warn('[finity] tasa ignorada: el proxy está en SANDBOX (producción no respondió)');
            return null;
        }
        return extractRate(r.data);
    } catch {
        return null;
    }
}

// Render genérico: objeto → grid de pares, array → tabla con las keys
const GenericData: React.FC<{ data: any }> = ({ data }) => {
    if (data == null) return <p className="text-xs text-slate-400">Sin datos.</p>;
    const arr = Array.isArray(data) ? data
        : Array.isArray((data as any).data) ? (data as any).data
        : Array.isArray((data as any).items) ? (data as any).items
        : Array.isArray((data as any).results) ? (data as any).results
        : null;
    if (arr) {
        if (arr.length === 0) return <p className="text-xs text-slate-400">Sin registros.</p>;
        const keys = Array.from(new Set(arr.flatMap((r: any) => Object.keys(r ?? {})))).slice(0, 7);
        return (
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="text-slate-500 uppercase tracking-wider">
                        <tr>{keys.map(k => <th key={k} className="text-left py-2 px-2">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                        {arr.slice(0, 50).map((row: any, i: number) => (
                            <tr key={i} className="border-t border-slate-100">
                                {keys.map(k => (
                                    <td key={k} className="py-2 px-2 font-mono text-slate-700 max-w-[220px] truncate">
                                        {typeof row?.[k] === 'object' ? JSON.stringify(row[k]) : String(row?.[k] ?? '—')}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    if (typeof data === 'object') {
        const entries = Object.entries(data).filter(([, v]) => typeof v !== 'object' || v === null).slice(0, 12);
        if (entries.length === 0) return <pre className="text-[10px] text-slate-500 overflow-auto">{JSON.stringify(data, null, 2)}</pre>;
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {entries.map(([k, v]) => (
                    <div key={k} className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-[9px] uppercase tracking-wider text-slate-400">{k}</p>
                        <p className="text-sm font-bold font-mono text-slate-800 truncate">{String(v ?? '—')}</p>
                    </div>
                ))}
            </div>
        );
    }
    return <p className="text-sm font-mono">{String(data)}</p>;
};

const PathWarning: React.FC<{ status?: number }> = ({ status }) => (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <p>
            La red respondió <b>{status ?? '—'}</b>: la ruta de este endpoint aún no está confirmada contra la
            documentación oficial. Pásale a Claude las páginas de la doc (botón "Copy Page") para ajustarla.
        </p>
    </div>
);

export const FinitySection: React.FC<{
    // 'full' = flujo completo de dispersión bancaria (Bre-B → cuentas
    // bancarias en Colombia): saldo de dispersión, cuentas destino,
    // movimientos, diagnóstico de endpoints — además del convertidor.
    // 'converter' = SOLO el convertidor USD(T)→COP (botón "OTC" en
    // Servicios) — nada de dispersión bancaria ni debug técnico.
    mode?: 'full' | 'converter';
    userId: string;
    // Saldo BreB Lincoin disponible para dispersar (viene del dashboard).
    // Si se pasa, las órdenes se validan contra él y al crear una orden
    // exitosa se notifica para debitar el saldo.
    brebBalance?: number;
    onDispersed?: (amount: number, reference: string) => void | Promise<void>;
    // Saldo USD (USDT) del cliente en Lincoin. Si se pasa, la conversión se
    // valida contra él y al confirmar SUCCESS se notifica para debitar USD
    // y acreditar el COP del cliente (tasa Finity con la comisión incluida).
    usdBalance?: number;
    // Saldo COP (Peso Lincoin) — solo se muestra como referencia arriba del
    // convertidor; para mover ese saldo el cliente tiene que salir y usar
    // "Enviar" en su billetera COP (esto no es una pantalla de transferencia).
    copBalance?: number;
    onConverted?: (usdAmount: number, copClientAmount: number, finityRate: number, utilityCop: number) => void | Promise<void>;
    // Se dispara después de intentar el barrido a la recaudadora (haya
    // salido bien o no) — el padre lo usa para refrescar el saldo GasFree
    // en vivo que se muestra en la tarjeta "USDT" del dashboard.
    onSwept?: () => void;
    // Comisión NEGOCIADA para este cliente/empresa (Admin → OTC). Si se
    // pasa, manda sobre la global — cada empresa puede tener un % distinto.
    // Evita además el fetch a fx_pair_config (la causa de que la comisión
    // "se dañara": esa lectura por red podía fallar/cachear un valor viejo).
    feePctOverride?: number;
}> = ({ mode = 'full', userId, brebBalance, onDispersed, usdBalance, copBalance, onConverted, onSwept, feePctOverride }) => {
    const isConverterOnly = mode === 'converter';
    const [ping, setPing] = useState<'checking' | 'ok' | 'fail' | 'noconf'>('checking');
    const [pingMsg, setPingMsg] = useState('');
    const [balance, setBalance] = useState<any>(null);
    const [movements, setMovements] = useState<any>(null);
    const [accounts, setAccounts] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [showRaw, setShowRaw] = useState(false);
    const [raw, setRaw] = useState<any>(null);

    // Formulario de nueva cuenta destino
    const [showAccForm, setShowAccForm] = useState(false);
    const [acc, setAcc] = useState({ bank: '', account_type: 'savings', account_number: '', holder_name: '', document_number: '' });
    // Formulario de dispersión
    const [showPayForm, setShowPayForm] = useState(false);
    const [pay, setPay] = useState({ external_account_id: '', amount: '', reference: '' });
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    // Tasa USD(T)→COP en tiempo real + conversión
    const [rateResp, setRateResp] = useState<any>(null);
    const [usdAmount, setUsdAmount] = useState('');
    const [converting, setConverting] = useState(false);
    const [convertResult, setConvertResult] = useState<{ ok: boolean; text: string } | null>(null);
    // Animación por pasos de la conversión: Enviando → Recibido → Convirtiendo → Completado
    const [convertStep, setConvertStep] = useState<null | 'enviando' | 'recibido' | 'convirtiendo' | 'completado' | 'error'>(null);
    // Conversión que quedó recargada en Finity pero NO se convirtió (Finity
    // lento/caído): permite reintentar SOLO la conversión sin reenviar USDT.
    const [pendingConvert, setPendingConvert] = useState<{ txId: string; finityAmount: number; creditAmount: number; amount: number; previewRate: number | null; gasfreeFeeUsdt: number } | null>(null);
    // Reemplaza window.confirm (el cuadro nativo del navegador) por un
    // diálogo con el diseño de la app.
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
    // Expiración REAL de la tasa según Finity (su expires_at). Un solo contador
    // (rateLeft) atado a ese timestamp — NO uno propio de 30 s. Cuando expira,
    // se refresca la tasa desde Finity (queda siempre viva) y, si el modal de
    // confirmación está abierto, se cierra para que el cliente vuelva a darle
    // "Convertir ahora" con la tasa actualizada.
    // Ventana FIJA de 30 s por cotización: el cliente siempre tiene 30 s para
    // decidir. Al expirar se refresca la tasa (y si el modal está abierto, se
    // cierra para que vuelva a darle "Convertir ahora").
    const RATE_WINDOW_MS = 30000;
    const rateExpiryOf = (_rt?: any): number => Date.now() + RATE_WINDOW_MS;
    const [rateExpiresAt, setRateExpiresAt] = useState<number | null>(null);
    const [rateLeft, setRateLeft] = useState(0);
    const [convertConfirm, setConvertConfirm] = useState<{ amount: number; netAmount: number; gasfreeCost: number; previewRate: number | null; clientRate: number | null; cop: number } | null>(null);
    useEffect(() => {
        if (!isConverterOnly || ping !== 'ok' || rateExpiresAt == null) { setRateLeft(0); return; }
        let alive = true;
        const tick = async () => {
            const left = Math.max(0, Math.ceil((rateExpiresAt - Date.now()) / 1000));
            setRateLeft(left);
            if (left > 0) return;
            if (converting) return; // no tocar la tasa durante una conversión en curso
            if (convertConfirm) {
                setConvertConfirm(null);
                setConvertResult({ ok: false, text: '⏱️ La tasa de Finity expiró. Dale "Convertir ahora" de nuevo con la tasa actualizada.' });
            }
            // Refrescar la tasa desde Finity (mantenerla viva).
            const rt = await callFinity('rates', userId, { query: { from: 'USD', to: 'COP' } });
            if (!alive) return;
            if (extractRate(rt?.data) != null) { setRateResp(rt); setRateExpiresAt(rateExpiryOf(rt)); }
            else setRateExpiresAt(Date.now() + 12000); // reintenta pronto si vino vacía
        };
        tick();
        const t = setInterval(tick, 1000);
        return () => { alive = false; clearInterval(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConverterOnly, ping, rateExpiresAt, convertConfirm, converting, userId]);
    // Comisión: la NEGOCIADA por cliente (Admin → OTC) manda siempre que
    // venga informada; solo si no hay override se cae a la global (y ahí
    // sí, por red, con su propia posible demora — pero ya no es lo normal).
    const [feePct, setFeePct] = useState(feePctOverride ?? DEFAULT_CONVERT_FEE_PCT);
    useEffect(() => {
        if (feePctOverride != null) { setFeePct(feePctOverride); return; }
        fetchFinityFeePct().then(setFeePct);
    }, [feePctOverride]);
    // Salvavidas: si por lo que sea se queda en "checking" (carga que no
    // resuelve), a los 10 s se fuerza a 'fail' para que aparezca el botón
    // "Reintentar" y no se quede colgado en "Cargando…" para siempre.
    useEffect(() => {
        if (ping !== 'checking') return;
        const t = setTimeout(() => {
            setPing(p => (p === 'checking' ? 'fail' : p));
            setPingMsg(m => m || 'No se pudo conectar con el riel de pagos. Reintenta.');
        }, 26000);
        return () => clearTimeout(t);
    }, [ping]);
    // Diagnóstico de endpoints (discover)
    const [discovering, setDiscovering] = useState(false);
    const [discoverReport, setDiscoverReport] = useState<any>(null);

    // Costo REAL de mover el USDT convertido desde la wallet GasFree PROPIA
    // del cliente hacia la recaudadora (barrido) — el cliente lo asume, se
    // descuenta del monto antes de aplicar la tasa Finity. Se cotiza en vivo
    // (nunca se cachea ni se asume un valor fijo — varía según la red).
    const [gasfreeFee, setGasfreeFee] = useState<{ transferFeeUsdt: number; activateFeeUsdt: number; totalFeeUsdt: number } | null>(null);
    useEffect(() => {
        if (!userId) return;
        callGasfree({ action: 'my_status', userId }).then(d => {
            if (d?.feeQuote) setGasfreeFee(d.feeQuote);
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const load = async () => {
        setLoading(true);
        // Timeout duro: si el proxy o Finity se cuelgan (no responden NI
        // fallan), la sección jamás puede quedarse en "Conectando…" eterno.
        const p = await Promise.race([
            callFinity('ping', userId).catch((e: any) => ({ error: 'network', message: `Error de red: ${String(e?.message ?? e)}` })),
            // 22s: el proxy en frío puede tardar hasta ~16s pidiendo el token a
            // Finity (intenta PROD y luego SANDBOX). Antes eran 15s y un Finity
            // lento-pero-vivo (típico tras un deploy) fallaba SIEMPRE en el
            // primer intento aunque hubiera respondido un segundo después.
            new Promise<any>(res => setTimeout(() => res({
                error: 'timeout',
                message: 'El servicio de Finity está tardando en responder. Dale a "Reintentar".',
            }), 22000)),
        ]);
        if (p.error === 'finity_not_configured') { setPing('noconf'); setPingMsg(p.message); setLoading(false); return; }
        if (p.error || !p.ok) { setPing('fail'); setPingMsg(p.message ?? p.error ?? 'Sin conexión'); setLoading(false); return; }
        setPing('ok'); setPingMsg('Conectado');
        // En modo 'converter' (botón OTC) solo necesitamos la tasa — el saldo
        // de dispersión, cuentas destino y movimientos son de la dispersión
        // bancaria (Bre-B), que no se muestra aquí.
        if (isConverterOnly) {
            // Se reintenta la tasa hasta obtener una parseable (a veces la
            // primera respuesta viene vacía). Mientras tanto, loading sigue en
            // true → la vista se mantiene en "Cargando…" hasta tener la tasa,
            // en vez de mostrar el convertidor a medias ("Sin tasa todavía").
            let rt = await callFinity('rates', userId, { query: { from: 'USD', to: 'COP' } });
            for (let i = 0; i < 3 && extractRate(rt?.data) == null; i++) {
                await new Promise(res => setTimeout(res, 1500));
                rt = await callFinity('rates', userId, { query: { from: 'USD', to: 'COP' } });
            }
            setRateResp(rt);
            setRateExpiresAt(extractRate(rt?.data) != null ? rateExpiryOf(rt) : null);
            // Todavía no hay un cron dedicado a muestrear la tasa Finity, así
            // que el historial del gráfico se construye orgánicamente: cada
            // apertura del convertidor registra un punto real (nunca uno de
            // sandbox) en fx_rate_snapshots — ver FinityRateChart.
            if (rt?.sandbox !== true) {
                const liveRate = extractRate(rt?.data);
                if (liveRate != null) {
                    supabase.from('fx_rate_snapshots')
                        .insert({ from_currency: 'USD', to_currency: 'COP', rate: liveRate, source: 'FINITY' })
                        .then(() => {}, () => {});
                }
            }
            setLoading(false);
            return;
        }
        const [b, m, a, rt] = await Promise.all([
            callFinity('balance', userId),
            callFinity('movements', userId),
            callFinity('external_accounts', userId),
            callFinity('rates', userId, { query: { from: 'USD', to: 'COP' } }),
        ]);
        setBalance(b); setMovements(m); setAccounts(a); setRateResp(rt);
        setRaw({ balance: b, movements: m, external_accounts: a, rates: rt });
        setLoading(false);
    };

    // Conversión USD(T)→COP con el flujo OFICIAL de 2 pasos de la doc:
    //   1. GET /v0/rates → cotización { id, rate, expires_at } (~30 s de vida)
    //   2. POST /v0/convert/internal { fromAsset, toAsset, amount, exchange_rate_id }
    //      → conversión UNCONFIRMED
    //   3. POST /v0/convert/confirm { id } ANTES de 60 s → SUCCESS
    // Al confirmar: el cliente recibe COP con la tasa Finity menos la comisión
    // Lincoin (feePct, incluye IVA); la diferencia es utilidad Lincoin.
    const doConvert = () => {
        const amount = Number(usdAmount);
        if (!amount || amount <= 0) { setConvertResult({ ok: false, text: 'Monto inválido.' }); return; }
        if (amount > 500000) { setConvertResult({ ok: false, text: 'El máximo por conversión es 500,000 USD.' }); return; }
        if (usdBalance != null && amount > usdBalance) {
            setConvertResult({ ok: false, text: `Saldo USD insuficiente: tienes ${usdBalance.toLocaleString('en-US')} USDT.` });
            return;
        }
        // El costo de mover el USDT convertido a la recaudadora (barrido) lo
        // asume el cliente — se descuenta del monto ANTES de convertir, no se
        // cobra aparte. Se cotiza en vivo (gasfreeFee), nunca se asume fijo.
        const gasfreeCost = gasfreeFee?.totalFeeUsdt ?? 0; // solo hop1: la 2ª comisión (tesorería→Finity) la absorbe Lincoin
        const netAmount = parseFloat((amount - gasfreeCost).toFixed(2));
        if (netAmount <= 0) {
            setConvertResult({ ok: false, text: `El monto debe ser mayor al costo de conversión (${gasfreeCost.toFixed(2)} USDT de comisión GasFree).` });
            return;
        }
        const previewRate = extractRate(rateResp?.data);
        const previewClient = previewRate != null ? previewRate * (1 - feePct / 100) : null;
        const cop = previewClient != null ? Math.round(netAmount * previewClient) : 0;
        // Arranca el contador en 30 s COMPLETOS al abrir la confirmación.
        setRateExpiresAt(Date.now() + RATE_WINDOW_MS);
        setConvertConfirm({ amount, netAmount, gasfreeCost, previewRate, clientRate: previewClient, cop });
    };

    // Mientras se procesa la conversión, el navegador avisa si intentan
    // recargar o cerrar la pestaña (evita interrumpir un envío en curso).
    useEffect(() => {
        const processing = converting && !!convertStep && convertStep !== 'completado' && convertStep !== 'error';
        if (!processing) return;
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; return ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [converting, convertStep]);

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Conversión interna en Finity + acreditación del COP. Se separó para poder
    // REINTENTARLA sin reenviar USDT (cuando Finity está lento y la recarga ya
    // se hizo). `finityAmount` = lo que hay en Finity; `creditAmount` = neto por
    // el que se acredita al cliente (Lincoin absorbe la 2ª comisión).
    const finishConvert = async (p: { txId: string; finityAmount: number; creditAmount: number; amount: number; previewRate: number | null; gasfreeFeeUsdt: number }) => {
        setConverting(true); setConvertStep('convirtiendo');
        try {
            let fd: any = null, lastErr = '';
            for (let attempt = 0; attempt < 2 && !fd; attempt++) {
                if (attempt > 0) await sleep(3000);
                const q = await callFinity('rates', userId, { query: { from: 'USD', to: 'COP' } });
                const quote = (q?.data ?? {}) as any;
                const createBody: Record<string, unknown> = { fromAsset: 'USD', toAsset: 'COP', amount: p.finityAmount };
                if (quote.id) createBody.exchange_rate_id = quote.id;
                if (quote.expires_at) createBody.expires_at = quote.expires_at;
                const c = await callFinity('convert', userId, { data: createBody });
                const convId = (c?.data as any)?.id;
                if (!c?.ok || !convId) { lastErr = c?.error ?? `HTTP ${c?.status ?? '—'}`; continue; }
                const f = await callFinity('convert_confirm', userId, { id: String(convId) });
                const d = (f?.data ?? {}) as any;
                if (f?.ok && String(d.status ?? '') === 'SUCCESS') { fd = d; break; }
                lastErr = f?.error ?? `estado ${d.status ?? '—'} (HTTP ${f?.status ?? '—'})`;
            }
            if (!fd) {
                setPendingConvert(p); // ← permite reintentar SOLO la conversión, sin reenviar USDT
                setConvertStep('error');
                setConvertResult({ ok: false, text: `Tu USDT ya está en Finity (${p.finityAmount.toFixed(2)} USDT) — no se reenvía. La conversión no se completó (${lastErr}); Finity puede estar lento. Dale "Reintentar conversión".` });
                setConverting(false);
                return;
            }
            const finityRate = Number(fd.exchangeRate ?? p.previewRate ?? 0);
            const grossCop = finityRate > 0 ? p.creditAmount * finityRate : Number(fd.to_amount ?? 0);
            const clientCop = Math.round(grossCop * (1 - feePct / 100));
            const utilityCop = Math.max(0, Math.round(grossCop - clientCop));
            const credit = await callGasfree({ action: 'my_convert_credit', userId, txId: p.txId, copAmount: clientCop, finityRate, feePct, utilityCop });
            if (credit?.error) {
                setPendingConvert(p);
                setConvertStep('error');
                setConvertResult({ ok: false, text: `La conversión se hizo pero no se pudo acreditar el COP (${credit.error}). Dale "Reintentar conversión" o contacta soporte con el ID ${String(p.txId).slice(0, 8)}.` });
                setConverting(false);
                return;
            }
            setPendingConvert(null);
            setConvertStep('completado'); await sleep(300);
            await onConverted?.(p.amount, clientCop, finityRate, utilityCop);
            setConvertResult({
                ok: true,
                text: `✅ Conversión completada: ${p.amount.toLocaleString('en-US')} USD → ${clientCop.toLocaleString('es-CO')} COP en tu saldo ACH (tasa ${finityRate.toLocaleString('es-CO')}, comisión ${feePct}%). Comisión GasFree ${Number(p.gasfreeFeeUsdt ?? 0).toFixed(2)} USDT.`,
            });
            setUsdAmount(''); load(); onSwept?.();
            await sleep(1400); setConvertStep(null);
        } catch (e: any) {
            setPendingConvert(p);
            setConvertStep('error');
            setConvertResult({ ok: false, text: `Error en la conversión: ${String(e?.message ?? e)}. Dale "Reintentar conversión".` });
        }
        setConverting(false);
    };

    const runConvert = async (amount: number, netAmount: number, gasfreeCost: number, previewRate: number | null) => {
        setConverting(true); setConvertResult(null); setConvertStep('enviando');
        try {
            // ORDEN CORRECTO (para que en el ledger de Finity la RECARGA vaya
            // ANTES que la Conversión interna, y sin caja):
            //   1) Recargar el USDT del cliente a Finity: cliente → tesorería →
            //      Finity, esperando la confirmación on-chain de cada salto.
            //   2) Recién con el USDT YA en Finity, hacer la Conversión interna.
            //   3) Acreditar el COP al cliente y completar.
            const previewClient = previewRate != null ? previewRate * (1 - feePct / 100) : null;
            const previewCop = previewClient != null ? Math.round(netAmount * previewClient) : 0;

            const settle = await callGasfree({
                action: 'my_convert_settle', userId,
                amount, copAmount: previewCop, finityRate: previewRate, feePct, utilityCop: 0,
            });
            if (settle?.error || !settle?.traceId) {
                setConvertStep('error');
                setConvertResult({ ok: false, text: `No se pudo enviar el USDT (${settle?.error ?? 'sin traceId'}). Reintenta o contacta soporte.` });
                setConverting(false);
                return;
            }
            setConvertStep('recibido'); await sleep(500);

            if (!settle.recharged) {
                // Los saltos no confirmaron dentro del tope → el USDT va en camino
                // a Finity pero aún no se puede convertir. Queda pendiente.
                setConvertStep('completado'); await sleep(300);
                setConvertResult({ ok: true, text: `✅ Envío realizado (${Number(settle.usdtOut ?? 0).toFixed(2)} USDT). La recarga a Finity se está confirmando en la red — si no se completa sola, vuelve a intentar la conversión en un momento.` });
                setUsdAmount(''); load(); onSwept?.();
                await sleep(1800); setConvertStep(null);
                setConverting(false);
                return;
            }

            // Espera de SEGURIDAD: darle 45 s a Finity para que REGISTRE la
            // recarga (su ledger la marca con su propio timestamp interno) antes
            // de convertir — así la "Recarga" queda antes que la "Conversión
            // interna" en el ledger de Finity y no al revés por 1 segundo.
            await sleep(45000);

            // 2+3) Conversión interna en Finity + acreditación. Se hace en
            //    finishConvert (reutilizable/reintentable sin reenviar USDT).
            //    Convierte EXACTAMENTE lo que llegó a Finity (usdtToProvider);
            //    al cliente se le acredita por netAmount (la 2ª comisión la
            //    absorbe Lincoin).
            await finishConvert({
                txId: String(settle.txId),
                finityAmount: Number(settle.usdtToProvider ?? netAmount),
                creditAmount: netAmount,
                amount,
                previewRate,
                gasfreeFeeUsdt: Number(settle.feeChargedUsdt ?? 0),
            });
            return;
        } catch (e: any) {
            setConvertStep('error');
            setConvertResult({ ok: false, text: `Error en la conversión: ${String(e?.message ?? e)}` });
        }
        setConverting(false);
    };

    const doDiscover = async () => {
        setDiscovering(true);
        const r = await callFinity('discover', userId);
        setDiscovering(false);
        setDiscoverReport(r.report ?? r);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId]);

    const createAccount = async () => {
        setSubmitting(true); setResult(null);
        const r = await callFinity('create_external_account', userId, { data: acc });
        setSubmitting(false);
        setResult({ ok: !!r.ok, text: r.ok ? 'Cuenta registrada.' : `La red respondió ${r.status}: ${JSON.stringify(r.data ?? r).slice(0, 300)}` });
        if (r.ok) { setShowAccForm(false); load(); }
    };

    const createWithdrawal = () => {
        const amount = Number(pay.amount);
        if (!amount || amount <= 0) { setResult({ ok: false, text: 'Monto inválido.' }); return; }
        if (brebBalance != null && amount > brebBalance) {
            setResult({ ok: false, text: `Saldo BreB insuficiente: tienes ${brebBalance.toLocaleString('es-CO')} COP. Mueve saldo desde Peso Lincoin en tu billetera COP.` });
            return;
        }
        setConfirmDialog({
            title: '¿Confirmar dispersión?',
            message: `¿Confirmas la dispersión de ${amount.toLocaleString('es-CO')} COP a la cuenta ${pay.external_account_id || '(sin cuenta)'}?`,
            onConfirm: () => runWithdrawal(amount),
        });
    };

    const runWithdrawal = async (amount: number) => {
        setSubmitting(true); setResult(null);
        const r = await callFinity('create_withdrawal', userId, { data: { ...pay, amount } });
        setSubmitting(false);
        setResult({ ok: !!r.ok, text: r.ok ? 'Orden de dispersión creada.' : `La red respondió ${r.status}: ${JSON.stringify(r.data ?? r).slice(0, 300)}` });
        if (r.ok) {
            await onDispersed?.(amount, pay.reference);
            setShowPayForm(false);
            load();
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pt-6">
            {/* ── Animación por pasos de la conversión ── */}
            {convertStep && (() => {
                const order = ['enviando', 'recibido', 'convirtiendo', 'completado'];
                const STEPS = [
                    { key: 'enviando', label: 'Enviando', sub: 'Procesando tu USDT', Icon: Send },
                    { key: 'recibido', label: 'Recibido', sub: 'Confirmando la recarga…', Icon: Wallet },
                    { key: 'convirtiendo', label: 'Convirtiendo', sub: 'Convirtiendo a Peso Lincoin', Icon: RefreshCw },
                    { key: 'completado', label: 'Completado', sub: 'COP acreditado en tu Peso Lincoin', Icon: CheckCircle },
                ];
                const isError = convertStep === 'error';
                const curIdx = isError ? -1 : order.indexOf(convertStep);
                return (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-in fade-in duration-200">
                        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
                        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-7 animate-in zoom-in-95 duration-300">
                            <div className="flex flex-col items-center text-center mb-6">
                                <div className="flex items-center gap-2 mb-3">
                                    <svg width="34" height="34" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="2" y="2" width="96" height="96" rx="24" fill="#0a0a0a" />
                                        <path d="M34 30 H47 V58 H58 V71 H34 Z" fill="#F4F4F2" />
                                        <circle cx="68" cy="67" r="12" fill="#4ADE80" />
                                    </svg>
                                    <span className="font-black text-2xl tracking-tight text-[#0C0E0D]">CUY<span className="text-[#4ADE80]">PAY</span></span>
                                </div>
                                <h3 className="text-lg font-extrabold text-[#0C0E0D]">
                                    {isError ? 'No se pudo completar' : convertStep === 'completado' ? '¡Conversión completada!' : 'Procesando conversión'}
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {isError ? 'Revisa el detalle abajo' : 'USDT → Peso Lincoin (COP)'}
                                </p>
                            </div>
                            {isError ? (
                                <div className="flex flex-col items-center py-4 gap-3">
                                    <XCircle size={44} className="text-red-500" />
                                    <p className="text-xs font-semibold text-slate-700 text-center px-1 leading-snug">{convertResult?.text ?? 'Ocurrió un error en el proceso.'}</p>
                                    {pendingConvert && (
                                        <button onClick={() => finishConvert(pendingConvert)} disabled={converting} className="px-5 py-2.5 rounded-xl bg-[#4ADE80] text-[#0C0E0D] text-sm font-extrabold hover:bg-[#6EE7A0] disabled:opacity-60 flex items-center gap-2">
                                            <RefreshCw size={15} className={converting ? 'animate-spin' : ''} /> Reintentar conversión
                                        </button>
                                    )}
                                    <button onClick={() => { setConvertStep(null); }} className="text-xs text-slate-500 font-bold hover:text-slate-700">Cerrar</button>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {STEPS.map((s, i) => {
                                        const done = i < curIdx || convertStep === 'completado' && i <= curIdx;
                                        const active = i === curIdx && convertStep !== 'completado';
                                        const StepIcon = s.Icon;
                                        return (
                                            <div key={s.key} className="flex items-center gap-3">
                                                <div className="flex flex-col items-center">
                                                    <div className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 ${done ? 'bg-[#4ADE80]' : active ? 'bg-[#0C0E0D]' : 'bg-slate-100'}`}>
                                                        {done
                                                            ? <CheckCircle size={22} className="text-[#0C0E0D]" />
                                                            : <StepIcon size={20} className={active ? 'text-[#4ADE80] animate-pulse' : 'text-slate-300'} />}
                                                    </div>
                                                    {i < STEPS.length - 1 && (
                                                        <div className={`w-0.5 h-6 my-0.5 rounded-full transition-colors duration-300 ${i < curIdx || convertStep === 'completado' ? 'bg-[#4ADE80]' : 'bg-slate-100'}`} />
                                                    )}
                                                </div>
                                                <div className={`flex-1 transition-opacity duration-300 ${active || done ? 'opacity-100' : 'opacity-50'}`}>
                                                    <p className={`text-sm font-bold ${done ? 'text-[#0C0E0D]' : active ? 'text-[#0C0E0D]' : 'text-slate-400'}`}>{s.label}</p>
                                                    <p className="text-[11px] text-slate-400 leading-tight">{s.sub}</p>
                                                </div>
                                                {active && (
                                                    <div className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-[#4ADE80] animate-spin" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {!isError && convertStep !== 'completado' && (
                                <div className="mt-5 text-center text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl py-2.5 px-3 leading-snug">
                                    ⚠️ No cierres ni recargues esta página hasta que la conversión termine.
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-[#0C0E0D] flex items-center gap-2">
                        <Landmark size={22} className="text-[#4ADE80]" /> {isConverterOnly ? 'OTC · Conversión USD → COP' : 'Dispersiones bancarias'}
                    </h1>
                    <p className="text-slate-700 text-sm font-medium">
                        {isConverterOnly ? 'Convierte tu saldo USD (digital) a COP a la tasa Lincoin' : 'Paga a cuentas bancarias en Colombia'}
                        {!isConverterOnly && brebBalance != null && (
                            <span className="ml-2 font-bold text-[#16A34A]">· Saldo BreB: {brebBalance.toLocaleString('es-CO')} COP</span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {ping === 'ok' && <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full flex items-center gap-1"><CheckCircle size={12} /> {pingMsg}</span>}
                    {ping === 'fail' && <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full flex items-center gap-1"><XCircle size={12} /> {pingMsg}</span>}
                    <button onClick={load} className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50" title="Refrescar">
                        <RefreshCw size={14} className={loading ? 'animate-spin text-[#0C0E0D]' : 'text-[#0C0E0D]'} />
                    </button>
                </div>
            </div>

            {/* Animación de carga mientras conecta O mientras carga la tasa —
                evita mostrar el convertidor a medias ("Sin tasa todavía"). */}
            {ping === 'checking' && (
                <div className="flex flex-col items-center justify-center py-24 gap-5 animate-in fade-in duration-300">
                    <div className="relative w-14 h-14">
                        <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
                        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#4ADE80] animate-spin" />
                    </div>
                    <div className="text-center">
                        <p className="text-base font-extrabold text-[#0C0E0D]">Cargando convertidor…</p>
                        <p className="text-sm text-slate-700 mt-1 font-semibold">Conectando con el riel de pagos y la tasa en vivo</p>
                    </div>
                    <div className="flex gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                </div>
            )}

            {/* No conectó al riel — mensaje claro + reintentar */}
            {isConverterOnly && ping === 'fail' && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center animate-in fade-in duration-300">
                    <XCircle className="mx-auto text-red-500 mb-2" size={34} />
                    <p className="text-sm font-extrabold text-red-700">No se pudo conectar con el riel de pagos</p>
                    <p className="text-xs text-slate-800 font-semibold mt-1 max-w-sm mx-auto">{pingMsg}</p>
                    <button onClick={load} className="mt-4 px-5 py-2.5 rounded-lg bg-[#0C0E0D] text-white text-xs font-bold hover:bg-[#152e52]">Reintentar</button>
                </div>
            )}

            {/* Billeteras — SOLO visualizador. Para mover saldo el cliente
                tiene que salir de aquí y usar "Enviar" en su billetera. */}
            {isConverterOnly && ping === 'ok' && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl p-4 border border-slate-200 bg-white flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-50 text-[#16A34A] flex items-center justify-center shrink-0">
                            <DollarSign size={18} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Saldo USD (digital)</p>
                            <p className="text-lg font-bold font-mono text-[#0C0E0D] truncate">{(usdBalance ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</p>
                        </div>
                    </div>
                    <div className="rounded-2xl p-4 border border-slate-200 bg-white flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 text-[#0C0E0D] flex items-center justify-center shrink-0">
                            <Wallet size={18} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Saldo ACH (COP)</p>
                            <p className="text-lg font-bold font-mono text-[#0C0E0D] truncate">{(copBalance ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP</p>
                        </div>
                    </div>
                </div>
            )}

            {ping === 'noconf' && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
                    <p className="font-bold mb-1">Falta configurar el riel bancario en Supabase</p>
                    <p className="text-xs">{pingMsg} — Edge Functions → Manage secrets → agrega <code>FINITY_CLIENT_ID</code> y <code>FINITY_CLIENT_SECRET</code>.</p>
                </div>
            )}

            {ping === 'ok' && (
                <>
                    {/* Saldo (solo dispersión bancaria completa — no aplica al convertidor OTC) */}
                    {!isConverterOnly && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5"><Wallet size={13} /> Saldo de dispersión</p>
                            {balance?.status === 404 ? <PathWarning status={404} /> : <GenericData data={balance?.data} />}
                        </div>
                    )}

                    {/* Tasa en tiempo real + conversión USD(T) → COP */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2 flex-wrap">
                            Conversión USD (digital) → COP · tasa en tiempo real
                            {/sandbox/i.test(pingMsg) && (
                                <span className="normal-case tracking-normal text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">
                                    ⚠ MODO PRUEBA — la tasa NO es real
                                </span>
                            )}
                        </p>
                        {(() => {
                            const rate = extractRate(rateResp?.data);
                            const clientRate = rate != null ? rate * (1 - feePct / 100) : null;
                            const usd = Number(usdAmount) || 0;
                            // El costo de mover el USDT convertido de la wallet GasFree del
                            // cliente a la recaudadora lo asume el cliente — se descuenta del
                            // monto ANTES de aplicar la tasa (no se cobra aparte).
                            const gasfreeCost = gasfreeFee?.totalFeeUsdt ?? 0; // solo hop1: la 2ª comisión (tesorería→Finity) la absorbe Lincoin
                            const netUsd = Math.max(0, usd - gasfreeCost);
                            return (
                                <div className="space-y-3">
                                    {rate != null ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div className="bg-slate-50 rounded-xl p-3">
                                                <p className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
                                                    <span>Tasa en vivo</span>
                                                    {rateExpiresAt != null && <span className={`normal-case font-bold ${rateLeft <= 8 ? 'text-red-500' : 'text-[#16A34A]'}`}>· se refresca en {rateLeft}s</span>}
                                                </p>
                                                <p className="text-lg font-bold font-mono text-[#0C0E0D]">1 USD = {rate.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP</p>
                                            </div>
                                            <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                                                <p className="text-[10px] uppercase tracking-wider text-green-700">Tasa cliente (incluye comisión {feePct}%)</p>
                                                <p className="text-lg font-bold font-mono text-[#16A34A]">1 USD = {clientRate!.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP</p>
                                            </div>
                                        </div>
                                    ) : rateResp?.status === 404 ? (
                                        <PathWarning status={404} />
                                    ) : loading ? (
                                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-center gap-2">
                                            <div className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-[#4ADE80] animate-spin" />
                                            <p className="text-xs font-bold text-slate-700">Obteniendo la tasa en vivo…</p>
                                        </div>
                                    ) : (
                                        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
                                            <p className="text-xs font-semibold text-amber-700">No se pudo obtener la tasa en vivo (Finity está lento).</p>
                                            <button onClick={load} className="mt-2 px-4 py-1.5 rounded-lg bg-[#0C0E0D] text-white text-xs font-bold hover:bg-[#152e52]">Reintentar</button>
                                        </div>
                                    )}
                                    <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Monto USD a convertir</label>
                                                {usdBalance != null && usdBalance > 0 && (
                                                    <span className="text-[11px] text-slate-500">
                                                        {!isConverterOnly && (
                                                            <>Saldo disponible: <b className="font-mono text-[#0C0E0D]">{usdBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</b>{' '}</>
                                                        )}
                                                        <button type="button" onClick={() => setUsdAmount(String(usdBalance))} className="font-bold text-[#16A34A] hover:underline">
                                                            Usar todo
                                                        </button>
                                                    </span>
                                                )}
                                            </div>
                                            <input
                                                inputMode="decimal"
                                                placeholder="0.00"
                                                value={usdAmount}
                                                onChange={e => setUsdAmount(e.target.value.replace(/[^\d.]/g, ''))}
                                                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:border-[#4ADE80] outline-none"
                                            />
                                            {usd > 0 && (
                                                <div className="mt-2 bg-slate-50 rounded-lg p-2.5 space-y-1 text-[11px]">
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-500">Monto a convertir</span>
                                                        <span className="font-mono font-bold text-slate-700">{usd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-500">Costo de convertir (comisión GasFree{gasfreeFee == null ? ' — cotizando…' : ''})</span>
                                                        <span className="font-mono font-bold text-amber-600">− {gasfreeCost.toFixed(2)} USDT</span>
                                                    </div>
                                                    {gasfreeFee && gasfreeFee.activateFeeUsdt > 0 && (
                                                        <div className="text-[10px] text-slate-400 pl-1 -mt-0.5 leading-tight">
                                                            ↳ {gasfreeFee.activateFeeUsdt.toFixed(2)} USDT activación de la wallet (solo la 1ª vez) + {gasfreeFee.transferFeeUsdt.toFixed(2)} USDT comisión de red GasFree
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between border-t border-slate-200 pt-1">
                                                        <span className="text-slate-500">Neto convertido</span>
                                                        <span className="font-mono font-bold text-slate-700">{netUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
                                                    </div>
                                                    {clientRate != null && (
                                                        <div className="flex justify-between border-t border-slate-200 pt-1">
                                                            <span className="text-slate-500 font-bold">Recibirás</span>
                                                            <span className="font-mono font-bold text-[#16A34A]">≈ {(netUsd * clientRate).toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={doConvert}
                                            disabled={converting || !usdAmount || netUsd <= 0 || rate == null}
                                            style={{ color: '#0C0E0D' }}
                                            className="py-2.5 px-5 rounded-xl bg-[#4ADE80] hover:bg-[#6EE7A0] text-sm font-bold disabled:opacity-50 transition-colors"
                                        >
                                            {converting ? 'Convirtiendo…' : rate == null ? 'Obteniendo tasa…' : 'Convertir ahora'}
                                        </button>
                                    </div>
                                    {convertResult && (
                                        <div className={`rounded-xl p-3 text-xs ${convertResult.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                                            {convertResult.text}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>

                    {/* Gráfico de la tasa Finity (solo convertidor OTC) */}
                    {isConverterOnly && <FinityRateChart from="USD" to="COP" />}

                    {/* Acciones, movimientos y debug — solo en el flujo completo de
                        dispersión bancaria. El convertidor OTC no los necesita. */}
                    {!isConverterOnly && (
                    <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Cuentas destino */}
                        <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Cuentas destino</p>
                                <button onClick={() => { setShowAccForm(!showAccForm); setResult(null); }} className="text-xs font-bold text-[#0C0E0D] flex items-center gap-1 hover:underline">
                                    <Plus size={12} /> Registrar cuenta
                                </button>
                            </div>
                            {showAccForm && (
                                <div className="space-y-2 mb-4 bg-slate-50 rounded-xl p-3">
                                    <input placeholder="Banco (ej. Bancolombia)" value={acc.bank} onChange={e => setAcc({ ...acc, bank: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                                    <div className="flex gap-2">
                                        <select value={acc.account_type} onChange={e => setAcc({ ...acc, account_type: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                                            <option value="savings">Ahorros</option>
                                            <option value="checking">Corriente</option>
                                        </select>
                                        <input placeholder="Número de cuenta" value={acc.account_number} onChange={e => setAcc({ ...acc, account_number: e.target.value })} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                                    </div>
                                    <input placeholder="Titular" value={acc.holder_name} onChange={e => setAcc({ ...acc, holder_name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                                    <input placeholder="Documento (CC/NIT)" value={acc.document_number} onChange={e => setAcc({ ...acc, document_number: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                                    <button onClick={createAccount} disabled={submitting} className="w-full py-2 rounded-lg bg-[#0C0E0D] text-sm font-bold disabled:opacity-50">
                                        {submitting ? 'Registrando…' : 'Registrar cuenta'}
                                    </button>
                                </div>
                            )}
                            {accounts?.status === 404 ? <PathWarning status={404} /> : <GenericData data={accounts?.data} />}
                        </div>

                        {/* Nueva dispersión */}
                        <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Nueva dispersión</p>
                                <button onClick={() => { setShowPayForm(!showPayForm); setResult(null); }} className="text-xs font-bold bg-[#0C0E0D] px-3 py-1.5 rounded-lg flex items-center gap-1">
                                    <Send size={12} /> Dispersar
                                </button>
                            </div>
                            {showPayForm ? (
                                <div className="space-y-2 bg-slate-50 rounded-xl p-3">
                                    <input placeholder="ID de cuenta destino (de la lista)" value={pay.external_account_id} onChange={e => setPay({ ...pay, external_account_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                                    <input placeholder="Monto (COP)" inputMode="numeric" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value.replace(/[^\d.]/g, '') })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                                    <input placeholder="Referencia / concepto" value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                                    <button onClick={createWithdrawal} disabled={submitting} className="w-full py-2 rounded-lg bg-[#4ADE80] text-[#0C0E0D] text-sm font-bold disabled:opacity-50">
                                        {submitting ? 'Enviando…' : 'Crear orden de dispersión'}
                                    </button>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-500">
                                    Crea una orden de retiro hacia una cuenta destino registrada. En sandbox no se mueve
                                    dinero real — úsalo para probar el flujo completo.
                                </p>
                            )}
                            {result && (
                                <div className={`mt-3 rounded-xl p-3 text-xs ${result.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                                    {result.text}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Movimientos */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5"><Activity size={13} /> Movimientos</p>
                        {movements?.status === 404 ? <PathWarning status={404} /> : <GenericData data={movements?.data} />}
                    </div>

                    {/* Diagnóstico de endpoints: sondea las rutas candidatas en Finity */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={doDiscover}
                            disabled={discovering}
                            className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                            {discovering ? 'Sondeando rutas…' : '🔍 Detectar endpoints'}
                        </button>
                        <button onClick={() => setShowRaw(!showRaw)} className="text-xs text-slate-500 flex items-center gap-1 hover:text-slate-800">
                            {showRaw ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Ver respuesta técnica (debug)
                        </button>
                    </div>
                    {discoverReport && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                Sondeo de rutas · 404 = no existe · cualquier otro código = el endpoint SÍ existe
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {Object.entries(discoverReport as Record<string, Array<{ path: string; status: number }>>).map(([resource, rows]) => (
                                    <div key={resource} className="bg-slate-50 rounded-xl p-3">
                                        <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">{resource}</p>
                                        {(rows ?? []).map(r => (
                                            <div key={r.path} className="flex items-center justify-between text-[11px] font-mono">
                                                <span className="text-slate-600 truncate">{r.path}</span>
                                                <span className={`font-bold ml-2 ${r.status === 404 || r.status === -1 ? 'text-slate-400' : 'text-emerald-700'}`}>{r.status === -1 ? 'error' : r.status}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-2">
                                Pásale una captura de esto a Claude para fijar las rutas definitivas.
                            </p>
                        </div>
                    )}
                    {showRaw && (
                        <pre className="bg-[#0C0E0D] text-green-200 text-[10px] rounded-2xl p-4 overflow-auto max-h-80">
                            {JSON.stringify(raw, null, 2)}
                        </pre>
                    )}
                    </>
                    )}
                </>
            )}

            {/* Reemplaza window.confirm — mismo diseño que el resto de la app */}
            {confirmDialog && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setConfirmDialog(null)}>
                    <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-6 space-y-2">
                            <h3 className="font-bold text-slate-800 text-lg">{confirmDialog.title}</h3>
                            <p className="text-sm text-slate-600 leading-relaxed">{confirmDialog.message}</p>
                        </div>
                        <div className="px-6 pb-6 flex gap-3">
                            <button onClick={() => setConfirmDialog(null)} className="flex-1 h-11 border border-slate-200 rounded-xl text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">
                                Cancelar
                            </button>
                            <button
                                onClick={() => { const cb = confirmDialog.onConfirm; setConfirmDialog(null); cb(); }}
                                style={{ color: '#0C0E0D' }}
                                className="flex-1 h-11 bg-[#4ADE80] hover:bg-[#6EE7A0] rounded-xl text-sm font-bold transition-colors"
                            >
                                Aceptar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmación de conversión con contador de expiración de la tasa */}
            {convertConfirm && (() => {
                const pct = Math.max(0, Math.min(100, (rateLeft / 30) * 100));
                const urgent = rateLeft <= 8;
                return (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setConvertConfirm(null)}>
                        <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                            {/* Encabezado con logo */}
                            <div className="flex items-center gap-2 px-6 pt-6">
                                <svg width="26" height="26" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="2" y="2" width="96" height="96" rx="24" fill="#0a0a0a" />
                                    <path d="M34 30 H47 V58 H58 V71 H34 Z" fill="#F4F4F2" />
                                    <circle cx="68" cy="67" r="12" fill="#4ADE80" />
                                </svg>
                                <h3 className="font-extrabold text-[#0C0E0D] text-lg">Confirmar conversión</h3>
                            </div>
                            {/* Monto grande */}
                            <div className="px-6 pt-4 text-center">
                                <p className="text-2xl font-black text-[#0C0E0D]">{convertConfirm.amount.toLocaleString('en-US')} USD</p>
                                <p className="text-[#16A34A] font-extrabold text-xl mt-1">≈ {convertConfirm.cop.toLocaleString('es-CO')} COP</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">en tu Peso Lincoin</p>
                            </div>
                            {/* Desglose */}
                            <div className="mx-6 mt-4 rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5 text-xs">
                                <div className="flex justify-between"><span className="text-slate-500">Tasa Lincoin</span><span className="font-mono font-bold text-slate-700">1 USD = {convertConfirm.clientRate != null ? convertConfirm.clientRate.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—'} COP</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Comisión GasFree</span><span className="font-mono font-bold text-amber-600">− {convertConfirm.gasfreeCost.toFixed(2)} USDT</span></div>
                                <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-500">Neto convertido</span><span className="font-mono font-bold text-slate-700">{convertConfirm.netAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span></div>
                            </div>
                            {/* Contador de expiración de la tasa */}
                            <div className="px-6 pt-4">
                                <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                                    <span className={urgent ? 'text-red-600' : 'text-slate-500'}>{urgent ? '⏱️ La tasa está por expirar' : 'Tasa válida por'}</span>
                                    <span className={urgent ? 'text-red-600' : 'text-[#16A34A]'}>{rateLeft}s</span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-1000 ease-linear ${urgent ? 'bg-red-500' : 'bg-[#4ADE80]'}`} style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                            {/* Botones */}
                            <div className="px-6 py-6 flex gap-3">
                                <button onClick={() => setConvertConfirm(null)} className="flex-1 h-11 border border-slate-200 rounded-xl text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => { const c = convertConfirm; setConvertConfirm(null); runConvert(c.amount, c.netAmount, c.gasfreeCost, c.previewRate); }}
                                    style={{ color: '#0C0E0D' }}
                                    className="flex-1 h-11 bg-[#4ADE80] hover:bg-[#6EE7A0] rounded-xl text-sm font-extrabold transition-colors"
                                >
                                    Confirmar
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
