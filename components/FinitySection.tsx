import React, { useEffect, useState } from 'react';
import {
    Landmark, RefreshCw, CheckCircle, XCircle, Plus, Send, ChevronDown,
    ChevronUp, AlertTriangle, Wallet, Activity, DollarSign, ArrowDown, Clock,
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
        return { ok: false, error: e?.name === 'TimeoutError' ? 'El riel de pagos tardó demasiado (timeout). Reintenta.' : `Error de red: ${String(e?.message ?? e)}` };
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

// ── Celebración al COMPLETAR la conversión: fanfarria + confeti ──
let _fxAudioCtx: any = null;
function playConvertSuccessSound() {
    try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        _fxAudioCtx = _fxAudioCtx || new AC();
        const ctx = _fxAudioCtx;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        // Fanfarria ascendente + acorde final (más festiva que el cha-ching)
        ([[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.3], [1318.5, 0.3], [1568, 0.3]] as Array<[number, number]>).forEach(([freq, t]) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'triangle';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, now + t);
            g.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.6);
            o.connect(g); g.connect(ctx.destination);
            o.start(now + t);
            o.stop(now + t + 0.65);
        });
    } catch { /* audio no disponible */ }
}

const CONFETTI_COLORS = ['#4ADE80', '#F4F4F2', '#22A35C', '#A7F3D0', '#FDE68A', '#93C5FD'];
const ConfettiBurst: React.FC = () => (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: 18 }}>
        <style>{`
            @keyframes fx-fall { 0% { transform: translateY(-12%) translateX(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(115%) translateX(var(--dx)) rotate(720deg); opacity: 0; } }
            @keyframes fx-pop { 0% { transform: scale(0.4); } 45% { transform: scale(1.25); } 100% { transform: scale(1); } }
        `}</style>
        {Array.from({ length: 28 }).map((_, i) => (
            <span key={i} style={{
                position: 'absolute', top: '-6%', left: `${(i * 37) % 100}%`,
                width: i % 3 === 0 ? 9 : 6, height: i % 4 === 0 ? 12 : 7,
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                borderRadius: i % 2 === 0 ? 2 : '50%',
                ['--dx' as any]: `${((i % 7) - 3) * 22}px`,
                animation: `fx-fall ${1.6 + (i % 5) * 0.35}s ease-in ${(i % 6) * 0.12}s both`,
            }} />
        ))}
    </div>
);

// ── Costo FIJO por conversión (lo paga el cliente): 4 USDT ──
//   1,50 → envío de la wallet del cliente a la tesorería (GasFree)
//   1,50 → envío de la tesorería al proveedor (Finity)
//   1,00 → servicio Lincoin (utilidad)
// El neto que se convierte es monto − 4. Los saltos reales cuestan ~3
// (1,5 + 1,5) — el excedente queda como utilidad en el proveedor.
const CONVERT_FLAT_FEE_USDT = 4;
const CONVERT_FEE_HOP1_USDT = 1.5;
const CONVERT_FEE_HOP2_USDT = 1.5;
const CONVERT_FEE_SERVICE_USDT = 1;

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
    // Últimas conversiones del usuario (las pasa el dashboard desde sus
    // movimientos) — se muestran en la tarjeta lateral del convertidor.
    recentConversions?: Array<{ label: string; meta: string; result: string }>;
}> = ({ mode = 'full', userId, brebBalance, onDispersed, usdBalance, copBalance, onConverted, onSwept, feePctOverride, recentConversions }) => {
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
    // Celebración al llegar a COMPLETADO: fanfarria + confeti en la ventana.
    useEffect(() => { if (convertStep === 'completado') playConvertSuccessSound(); }, [convertStep]);
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
                setConvertResult({ ok: false, text: '⏱️ La tasa expiró. Dale "Convertir ahora" de nuevo con la tasa actualizada.' });
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
                message: 'El riel de pagos está tardando en responder. Dale a "Reintentar".',
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
        // COSTO FIJO de la conversión: 4 USDT que paga el cliente — cubren
        // 1,50 del envío wallet→tesorería + 1,50 de tesorería→proveedor
        // (Finity) + 1,00 de servicio Lincoin. La PRIMERA vez se suma la
        // activación de la wallet GasFree (1,5) → 5,5 solo esa vez. El neto
        // que se convierte es monto − costo; el USDT que sobra tras los
        // saltos reales queda como utilidad de Lincoin en el proveedor.
        const gasfreeCost = CONVERT_FLAT_FEE_USDT + Number(gasfreeFee?.activateFeeUsdt ?? 0);
        const netAmount = parseFloat((amount - gasfreeCost).toFixed(2));
        if (netAmount <= 0) {
            setConvertResult({ ok: false, text: `El monto debe ser mayor al costo fijo de conversión (${gasfreeCost.toFixed(2)} USDT).` });
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
        // Cierre de éxito compartido (convierta quien convierta: este
        // frontend o el AUTOPILOTO del servidor en segundo plano).
        const completeUI = async (clientCop: number, finityRate: number, utilityCop: number) => {
            setPendingConvert(null);
            setConvertStep('completado'); await sleep(300);
            await onConverted?.(p.amount, clientCop, finityRate, utilityCop);
            setConvertResult({
                ok: true,
                text: `✅ Conversión completada: ${p.amount.toLocaleString('en-US')} USD → ${clientCop.toLocaleString('es-CO')} COP en tu saldo ACH (tasa ${finityRate.toLocaleString('es-CO')}, comisión ${feePct}%).`,
            });
            setUsdAmount(''); load(); onSwept?.();
            await sleep(2800); setConvertStep(null);
            setConverting(false);
        };
        // ── RECLAMO (CAS): solo UNO convierte — este frontend o el
        // autopiloto del servidor. Si el servidor ya la tomó, aquí solo se
        // OBSERVA (y el cliente puede hasta cerrar la app: el servidor
        // termina solo y el COP le llega a ACH).
        try {
            const cl: any = await callGasfree({ action: 'my_convert_claim', userId, txId: p.txId }).catch(() => null);
            if (cl?.status === 'Completado') {
                const st: any = await callGasfree({ action: 'my_convert_status', userId, txId: p.txId }).catch(() => null);
                await completeUI(Number(st?.amount ?? 0), Number(st?.mouvRate ?? p.previewRate ?? 0), Number(st?.utilityCop ?? 0));
                return;
            }
            if (cl && cl.claimed === false && cl.phase === 'converting') {
                // El servidor la está convirtiendo — observar hasta 3 min.
                for (let i = 0; i < 45; i++) {
                    await sleep(4000);
                    const st: any = await callGasfree({ action: 'my_convert_status', userId, txId: p.txId }).catch(() => null);
                    if (st?.status === 'Completado') {
                        await completeUI(Number(st.amount ?? 0), Number(st.mouvRate ?? p.previewRate ?? 0), Number(st.utilityCop ?? 0));
                        return;
                    }
                    if (st?.status === 'Rechazado') {
                        setConvertStep('error');
                        setConvertResult({ ok: false, text: 'La conversión fue rechazada y tu USDT fue reembolsado.' });
                        setConverting(false);
                        return;
                    }
                    if (st?.phase === 'recharged') {
                        // El servidor soltó el reclamo → intentar tomarlo aquí.
                        const c2: any = await callGasfree({ action: 'my_convert_claim', userId, txId: p.txId }).catch(() => null);
                        if (c2?.claimed) break;
                    }
                }
                const stFinal: any = await callGasfree({ action: 'my_convert_status', userId, txId: p.txId }).catch(() => null);
                if (stFinal?.status === 'Completado') {
                    await completeUI(Number(stFinal.amount ?? 0), Number(stFinal.mouvRate ?? p.previewRate ?? 0), Number(stFinal.utilityCop ?? 0));
                    return;
                }
                if (stFinal?.phase === 'converting') {
                    setPendingConvert(p);
                    setConvertStep('error');
                    setConvertResult({ ok: false, text: '⏳ La conversión sigue procesándose EN SEGUNDO PLANO en el servidor — puedes salir tranquilo: cuando termine verás el COP en tu saldo ACH y el movimiento Completado.' });
                    setConverting(false);
                    return;
                }
                // phase volvió a recharged y lo reclamamos → convertir aquí abajo.
            }
        } catch { /* sin claim disponible → convertir local como siempre */ }
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
                // Soltar el reclamo: el autopiloto del servidor (o el botón
                // Reintentar) pueden retomarla.
                callGasfree({ action: 'my_convert_release', userId, txId: p.txId }).catch(() => {});
                callGasfree({ action: 'my_convert_kick', userId, txId: p.txId }).catch(() => {});
                setPendingConvert(p); // ← permite reintentar SOLO la conversión, sin reenviar USDT
                setConvertStep('error');
                setConvertResult({ ok: false, text: `Tu USDT ya está en el riel de pagos (${p.finityAmount.toFixed(2)} USDT) — no se reenvía. La conversión no se completó (${lastErr}) y SEGUIMOS intentándola en segundo plano: puedes salir de la app y el COP te llegará solo, o dale "Reintentar conversión".` });
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
            await sleep(2800); setConvertStep(null);
        } catch (e: any) {
            callGasfree({ action: 'my_convert_release', userId, txId: p.txId }).catch(() => {});
            callGasfree({ action: 'my_convert_kick', userId, txId: p.txId }).catch(() => {});
            setPendingConvert(p);
            setConvertStep('error');
            setConvertResult({ ok: false, text: `Error en la conversión: ${String(e?.message ?? e)}. Seguimos intentándola en segundo plano — o dale "Reintentar conversión".` });
        }
        setConverting(false);
    };

    const runConvert = async (amount: number, netAmount: number, gasfreeCost: number, previewRate: number | null) => {
        setConverting(true); setConvertResult(null); setConvertStep('enviando');
        try {
            // Saldo de la cuenta del proveedor ANTES de enviar — sirve para
            // confirmar después que la recarga quedó registrada en su
            // PLATAFORMA (no solo en la wallet on-chain).
            let providerBalBefore: number | null = null;
            try { providerBalBefore = await fetchFinityBalance(userId); } catch { /* opcional */ }
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
                creditUsd: netAmount,
            });
            if (settle?.error || !settle?.traceId) {
                setConvertStep('error');
                setConvertResult({ ok: false, text: `No se pudo enviar el USDT (${settle?.error ?? 'sin traceId'}). Reintenta o contacta soporte.` });
                setConverting(false);
                return;
            }
            setConvertStep('recibido'); await sleep(500);

            if (!settle.recharged) {
                // Los saltos NO confirmaron dentro del tope. NADA de éxito en
                // falso: la ventana se queda en "Recibido" VALIDANDO de verdad
                // que el USDT llegue al riel (poll al finalize con settleOnly:
                // si confirma, se hace la conversión REAL y el COP cae en ACH).
                for (let i = 0; i < 8; i++) {
                    await sleep(20000);
                    let fin: any = null;
                    try { fin = await callGasfree({ action: 'my_convert_finalize', userId, txId: String(settle.txId), settleOnly: true }); } catch { /* red */ }
                    if (fin?.recharged || fin?.phase === 'recharged') {
                        await finishConvert({
                            txId: String(settle.txId),
                            finityAmount: Number(fin?.usdtToProvider ?? settle.usdtToProvider ?? netAmount),
                            creditAmount: netAmount,
                            amount,
                            previewRate,
                            gasfreeFeeUsdt: Number(settle.feeChargedUsdt ?? 0),
                        });
                        return;
                    }
                    if (fin?.status === 'Rechazado') {
                        setConvertStep('error');
                        setConvertResult({ ok: false, text: 'El envío falló on-chain y tu USDT fue REEMBOLSADO a tu wallet. Puedes intentarlo de nuevo.' });
                        setUsdAmount(''); load(); onSwept?.();
                        setConverting(false);
                        return;
                    }
                    if (fin?.status === 'Completado') {
                        // Respaldo del servidor: acreditó en Saldo Lincoin (COP)
                        // mientras el equipo valida el riel. Honesto con el cliente.
                        setConvertStep('completado'); await sleep(300);
                        setConvertResult({ ok: true, text: `✅ Tu conversión quedó acreditada en tu Saldo Lincoin (COP) mientras validamos el riel ACH. Desde tu billetera COP puedes solicitar moverlo a ACH (Mover saldo).` });
                        setUsdAmount(''); load(); onSwept?.();
                        await sleep(2800); setConvertStep(null);
                        setConverting(false);
                        return;
                    }
                }
                // ~2,5 min sin confirmación: estado PENDIENTE honesto (no verde).
                setConvertStep('error');
                setConvertResult({ ok: false, text: `⏳ Tu envío (${Number(settle.usdtOut ?? 0).toFixed(2)} USDT) sigue confirmándose en la red. Tranquilo: la conversión CONTINÚA EN SEGUNDO PLANO en el servidor — puedes salir de la app y el COP te llegará solo a tu saldo ACH (lo verás en Movimientos).` });
                setPendingConvert({
                    txId: String(settle.txId), finityAmount: netAmount, creditAmount: netAmount,
                    amount, previewRate, gasfreeFeeUsdt: Number(settle.feeChargedUsdt ?? 0),
                });
                setUsdAmount(''); load(); onSwept?.();
                setConverting(false);
                return;
            }

            // ── CONFIRMACIÓN REAL EN LA PLATAFORMA DEL PROVEEDOR ──
            // La wallet YA recibió on-chain (ambos saltos confirmados), pero
            // la plataforma tarda unos segundos más en REGISTRAR la recarga.
            // Antes de convertir se exige verla registrada por DOS vías:
            //   a) el saldo de la cuenta subió por lo enviado, o
            //   b) aparece el movimiento "Recarga por Blockchain" con el
            //      monto enviado (reciente) en los movimientos del proveedor.
            // Si en ~2 min no se registra, la conversión queda EN PAUSA con
            // reintento — JAMÁS se convierte antes de la recarga (eso solo
            // funcionaba si la cuenta tenía saldo propio previo).
            const fwdUsd = Number(settle.usdtToProvider ?? netAmount);
            const rowsOf = (d: any): any[] => Array.isArray(d) ? d
                : Array.isArray(d?.data) ? d.data : Array.isArray(d?.items) ? d.items
                : Array.isArray(d?.movements) ? d.movements : Array.isArray(d?.results) ? d.results : [];
            const rechargeVisible = async (): Promise<boolean> => {
                // a) por delta de saldo
                if (providerBalBefore != null) {
                    try {
                        const nowBal = await fetchFinityBalance(userId);
                        if (nowBal != null && nowBal >= providerBalBefore + fwdUsd * 0.9) return true;
                    } catch { /* siguiente vía */ }
                }
                // b) por movimiento de recarga registrado
                try {
                    const mv = await callFinity('movements', userId);
                    const rows = rowsOf(mv?.data).slice(0, 12);
                    const nowMs = Date.now();
                    for (const r of rows) {
                        if (!/recarga|recharge|deposit|blockchain|top.?up/i.test(JSON.stringify(r))) continue;
                        const nums: number[] = [];
                        const collect = (o: any, depth = 0) => {
                            if (!o || typeof o !== 'object' || depth > 2) return;
                            for (const v of Object.values(o)) {
                                if (typeof v === 'number') nums.push(v);
                                else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) nums.push(parseFloat(v));
                                else if (v && typeof v === 'object') collect(v, depth + 1);
                            }
                        };
                        collect(r);
                        if (!nums.some(n => Math.abs(n - fwdUsd) <= Math.max(0.05, fwdUsd * 0.01))) continue;
                        // Si el movimiento trae fecha, exigir que sea reciente
                        // (evita confundirse con una recarga vieja del mismo monto).
                        const dateStr = (r.created_at ?? r.createdAt ?? r.date ?? r.creation_date ?? null) as string | null;
                        if (dateStr) { const t = Date.parse(dateStr); if (isFinite(t) && nowMs - t > 20 * 60 * 1000) continue; }
                        return true;
                    }
                } catch { /* siguiente tick */ }
                return false;
            };
            let platformOk = false;
            for (let i = 0; i < 24 && !platformOk; i++) {
                await sleep(5000);
                platformOk = await rechargeVisible();
            }
            if (!platformOk) {
                // El AUTOPILOTO del servidor sigue empujándola en segundo
                // plano — el cliente puede salir de la app tranquilo.
                callGasfree({ action: 'my_convert_kick', userId, txId: String(settle.txId) }).catch(() => {});
                setConvertStep('error');
                setConvertResult({ ok: false, text: '⏳ Tu USDT ya llegó a la wallet del riel y la plataforma aún no registra la recarga. Tranquilo: la conversión SIGUE EN SEGUNDO PLANO en el servidor — puedes salir de la app y el COP te llegará solo a tu saldo ACH (lo verás en Movimientos). También puedes darle "Reintentar conversión".' });
                setPendingConvert({
                    txId: String(settle.txId), finityAmount: fwdUsd, creditAmount: netAmount,
                    amount, previewRate, gasfreeFeeUsdt: Number(settle.feeChargedUsdt ?? 0),
                });
                setUsdAmount(''); load(); onSwept?.();
                setConverting(false);
                return;
            }

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
                    { key: 'enviando', label: 'Enviando', sub: 'Tu USDT sale hacia la tesorería Lincoin', Icon: Send },
                    { key: 'recibido', label: 'Recibido', sub: 'De la tesorería sale automático al proveedor…', Icon: Wallet },
                    { key: 'convirtiendo', label: 'Convirtiendo', sub: 'Convirtiendo a pesos (COP)', Icon: RefreshCw },
                    { key: 'completado', label: 'Completado', sub: 'COP acreditado en tu saldo ACH', Icon: CheckCircle },
                ];
                const isError = convertStep === 'error';
                const curIdx = isError ? -1 : order.indexOf(convertStep);
                return (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-in fade-in duration-200" style={{ fontFamily: "'Archivo', system-ui, sans-serif" }}>
                        <div className="absolute inset-0" style={{ background: 'rgba(4,5,4,0.74)', backdropFilter: 'blur(4px)' }} />
                        <div className="relative w-full max-w-md p-7 animate-in zoom-in-95 duration-300" style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18 }}>
                            {convertStep === 'completado' && <ConfettiBurst />}
                            <div className="flex flex-col items-center text-center mb-6">
                                {/* Wordmark Lincoin — tipográfico, punto verde (sin isotipo) */}
                                <span style={{ fontWeight: 800, fontSize: 23, letterSpacing: '-0.7px', color: '#F4F4F2', marginBottom: 10 }}>Lincoin<span style={{ color: '#4ADE80' }}>.</span></span>
                                <h3 className="text-lg font-extrabold" style={{ color: convertStep === 'completado' ? '#4ADE80' : '#F4F4F2', animation: convertStep === 'completado' ? 'fx-pop 0.55s ease-out' : undefined }}>
                                    {isError ? 'No se pudo completar' : convertStep === 'completado' ? '🎉 ¡Conversión completada!' : 'Procesando conversión'}
                                </h3>
                                <p className="text-xs mt-0.5" style={{ color: '#878E88' }}>
                                    {isError ? 'Revisa el detalle abajo' : 'USDT → COP · saldo ACH'}
                                </p>
                            </div>
                            {isError ? (
                                <div className="flex flex-col items-center py-4 gap-3">
                                    <XCircle size={42} strokeWidth={1.5} style={{ color: '#878E88' }} />
                                    <p className="text-xs font-semibold text-center px-1 leading-snug" style={{ color: '#F4F4F2' }}>{convertResult?.text ?? 'Ocurrió un error en el proceso.'}</p>
                                    {pendingConvert && (
                                        <button onClick={() => finishConvert(pendingConvert)} disabled={converting} className="lincoin-btn-white px-5 py-2.5 rounded-xl text-sm font-extrabold disabled:opacity-60 flex items-center gap-2" style={{ border: 'none' }}>
                                            <RefreshCw size={15} className={converting ? 'animate-spin' : ''} /> Reintentar conversión
                                        </button>
                                    )}
                                    <button onClick={() => { setConvertStep(null); }} className="text-xs font-bold" style={{ color: '#878E88' }}>Cerrar</button>
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
                                                    <div className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300"
                                                        style={{ background: done ? '#4ADE80' : active ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)', border: done ? 'none' : '1px solid rgba(255,255,255,0.1)' }}>
                                                        {done
                                                            ? <CheckCircle size={22} style={{ color: '#0A0C0B' }} />
                                                            : <StepIcon size={20} strokeWidth={1.6} className={active ? 'animate-pulse' : ''} style={{ color: active ? '#4ADE80' : 'rgba(244,244,242,0.3)' }} />}
                                                    </div>
                                                    {i < STEPS.length - 1 && (
                                                        <div className="w-0.5 h-6 my-0.5 rounded-full transition-colors duration-300" style={{ background: i < curIdx || convertStep === 'completado' ? '#4ADE80' : 'rgba(255,255,255,0.08)' }} />
                                                    )}
                                                </div>
                                                <div className={`flex-1 transition-opacity duration-300 ${active || done ? 'opacity-100' : 'opacity-50'}`}>
                                                    <p className="text-sm font-bold" style={{ color: done || active ? '#F4F4F2' : '#878E88' }}>{s.label}</p>
                                                    <p className="text-[11px] leading-tight" style={{ color: '#878E88' }}>{s.sub}</p>
                                                </div>
                                                {active && (
                                                    <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(255,255,255,0.12)', borderTopColor: '#4ADE80' }} />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {!isError && convertStep !== 'completado' && (
                                <div className="mt-5 text-center text-[11px] font-bold rounded-xl py-2.5 px-3 leading-snug"
                                    style={{ color: '#F4F4F2', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(74,222,128,0.3)', borderLeft: '2px solid #4ADE80' }}>
                                    No cierres ni recargues esta página hasta que la conversión termine.
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}
            {isConverterOnly ? (
                /* ── Encabezado del convertidor (handoff): título 25/800 + pill de tasa en vivo ── */
                <div className="flex items-start justify-between flex-wrap gap-3" style={{ fontFamily: "'Archivo', system-ui, sans-serif" }}>
                    <div>
                        <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2' }}>Convertir USDT a pesos colombianos</h1>
                        <p style={{ fontSize: 14, color: '#878E88', marginTop: 3 }}>De tu billetera de dólar digital a tu saldo ACH en COP, a la tasa del momento.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {ping === 'ok' && (
                            <span className="flex items-center gap-2" style={{ fontSize: 12, color: '#878E88', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', padding: '7px 13px', borderRadius: 999 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 999, background: '#4ADE80', display: 'inline-block' }} />
                                Tasa en vivo{rateExpiresAt != null && rateLeft > 0 ? <> · se actualiza en <b style={{ color: '#F4F4F2', fontVariantNumeric: 'tabular-nums' }}>{rateLeft} s</b></> : null}
                            </span>
                        )}
                        <button onClick={load} title="Refrescar" style={{ padding: 8, borderRadius: 9, border: '1px solid rgba(255,255,255,0.11)', background: 'rgba(255,255,255,0.04)' }}>
                            <RefreshCw size={14} strokeWidth={1.7} className={loading ? 'animate-spin' : ''} style={{ color: '#878E88' }} />
                        </button>
                    </div>
                </div>
            ) : (
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-[#0C0E0D] flex items-center gap-2">
                        <Landmark size={22} className="text-[#4ADE80]" /> Dispersiones bancarias
                    </h1>
                    <p className="text-slate-700 text-sm font-medium">
                        Paga a cuentas bancarias en Colombia
                        {brebBalance != null && (
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
            )}

            {/* Animación de carga mientras conecta O mientras carga la tasa —
                evita mostrar el convertidor a medias ("Sin tasa todavía"). */}
            {ping === 'checking' && (
                <div className="flex flex-col items-center justify-center py-24 gap-5 animate-in fade-in duration-300">
                    <div className="relative w-14 h-14">
                        <div className="absolute inset-0 rounded-full border-4" style={{ borderColor: isConverterOnly ? 'rgba(255,255,255,0.08)' : '#F1F5F9' }} />
                        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#4ADE80] animate-spin" />
                    </div>
                    <div className="text-center">
                        <p className="text-base font-extrabold" style={{ color: isConverterOnly ? '#F4F4F2' : '#0C0E0D' }}>Cargando convertidor…</p>
                        <p className="text-sm mt-1 font-semibold" style={{ color: isConverterOnly ? '#878E88' : '#334155' }}>Conectando con el riel de pagos y la tasa en vivo</p>
                    </div>
                    <div className="flex gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                </div>
            )}

            {/* No conectó al riel — mensaje claro + reintentar (neutro, sin rojo) */}
            {isConverterOnly && ping === 'fail' && (
                <div className="text-center animate-in fade-in duration-300" style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '28px 24px' }}>
                    <XCircle className="mx-auto mb-2" size={32} strokeWidth={1.5} style={{ color: '#878E88' }} />
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2' }}>No se pudo conectar con el riel de pagos</p>
                    <p style={{ fontSize: 12, color: '#878E88', marginTop: 4, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>{pingMsg}</p>
                    <button onClick={load} className="lincoin-btn-white" style={{ marginTop: 16, padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none' }}>Reintentar</button>
                </div>
            )}

            {ping === 'noconf' && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
                    <p className="font-bold mb-1">El riel de pagos aún no está configurado</p>
                    <p className="text-xs">El servicio no está disponible en este momento — contacta a soporte (soporte@lincoin.me).</p>
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

                    {/* ── Convertidor rediseñado (handoff): grid 1fr / 372px ── */}
                    {isConverterOnly && (() => {
                        const rate = extractRate(rateResp?.data);
                        const clientRate = rate != null ? rate * (1 - feePct / 100) : null;
                        const usd = Number(usdAmount) || 0;
                        // Costo FIJO por conversión: 4 USDT (1,5 + 1,5 + 1 de servicio).
                        // La PRIMERA vez se suma la activación de la wallet GasFree
                        // (1,5, cotizada en vivo) — total 5,5 solo esa vez.
                        const activationUsdt = Number(gasfreeFee?.activateFeeUsdt ?? 0);
                        const costUsdt = CONVERT_FLAT_FEE_USDT + activationUsdt;
                        const netUsd = Math.max(0, usd - costUsdt);
                        const copOut = clientRate != null ? netUsd * clientRate : 0;
                        const overBalance = usdBalance != null && usd > usdBalance;
                        const copInt = Math.floor(copOut);
                        const copDec = Math.round((copOut - copInt) * 100);
                        const S = { lbl: { fontSize: 10.5, fontWeight: 700 as const, letterSpacing: '1.4px', color: '#878E88' }, row: { fontSize: 13, color: '#878E88' } };
                        const flagCol = 'linear-gradient(180deg,#FCD116 0 50%,#003893 50% 75%,#CE1126 75%)';
                        return (
                        <div style={{ fontFamily: "'Archivo', system-ui, sans-serif" }}>
                            <style>{`.fx-grid{display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:18px}@media(max-width:1100px){.fx-grid{grid-template-columns:1fr}}`}</style>
                            <div className="fx-grid">
                                {/* ── Tarjeta convertidor ── */}
                                <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 24, alignSelf: 'start' }}>
                                    {/* CONVIERTES */}
                                    <div style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 13, padding: '15px 17px' }}>
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <span style={S.lbl}>CONVIERTES</span>
                                            <span style={{ fontSize: 12, color: '#878E88' }}>
                                                Disponible: <b style={{ color: '#F4F4F2' }}>{(usdBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</b>
                                                {usdBalance != null && usdBalance > 0 && (
                                                    <> · <button type="button" onClick={() => setUsdAmount(String(usdBalance))} style={{ color: '#4ADE80', fontWeight: 600 }}>Usar todo</button></>
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
                                            <input
                                                inputMode="decimal" placeholder="0.00" value={usdAmount}
                                                onChange={e => setUsdAmount(e.target.value.replace(/[^\d.]/g, ''))}
                                                className="flex-1 min-w-0 bg-transparent outline-none"
                                                style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2', border: 'none' }}
                                            />
                                            <span className="flex items-center gap-2 shrink-0" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 13px' }}>
                                                <span style={{ width: 20, height: 20, borderRadius: 999, background: '#26A17B', color: '#fff', fontSize: 12, fontWeight: 800, display: 'grid', placeItems: 'center' }}>₮</span>
                                                <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>USDT</span>
                                            </span>
                                        </div>
                                        {overBalance && <p style={{ fontSize: 12, color: '#878E88', marginTop: 4 }}>Supera tu saldo disponible.</p>}
                                        {!overBalance && usd > 0 && netUsd <= 0 && <p style={{ fontSize: 12, color: '#878E88', marginTop: 4 }}>El monto debe ser mayor al costo fijo de {costUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT{activationUsdt > 0 ? ' (incluye la activación de la 1ª vez)' : ''}.</p>}
                                    </div>
                                    {/* Flecha entre cajas */}
                                    <div className="flex justify-center" style={{ margin: '-13px 0', position: 'relative', zIndex: 2 }}>
                                        <span style={{ width: 36, height: 36, borderRadius: 999, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center' }}>
                                            <ArrowDown size={16} strokeWidth={1.7} style={{ color: '#878E88' }} />
                                        </span>
                                    </div>
                                    {/* RECIBES */}
                                    <div style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 13, padding: '15px 17px' }}>
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <span style={S.lbl}>RECIBES EN TU SALDO ACH</span>
                                            <span style={{ fontSize: 12, color: '#878E88' }}>Cuenta ACH · <b style={{ color: '#F4F4F2' }}>{(copBalance ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP</b></span>
                                        </div>
                                        <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
                                            <p className="flex-1 min-w-0 truncate" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2' }}>
                                                {copInt.toLocaleString('es-CO')}<span style={{ fontSize: 22, color: '#878E88', fontWeight: 700 }}>,{String(copDec).padStart(2, '0')}</span>
                                            </p>
                                            <span className="flex items-center gap-2 shrink-0" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 13px' }}>
                                                <span style={{ width: 20, height: 20, borderRadius: 999, background: flagCol, display: 'block' }} />
                                                <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>COP</span>
                                            </span>
                                        </div>
                                    </div>
                                    {/* Desglose */}
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 18, paddingTop: 14 }} className="space-y-2.5">
                                        <div className="flex items-center justify-between gap-3">
                                            <span style={S.row}>Tasa aplicada (incluye comisión {feePct} %)</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>{clientRate != null ? `1 USDT = ${clientRate.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP` : '—'}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span style={S.row}>Tasa de referencia</span>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: '#878E88' }}>{rate != null ? `1 USDT = ${rate.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP` : (loading ? 'obteniendo…' : '—')}</span>
                                        </div>
                                        {/* Al cliente SOLO se le muestran dos líneas: la comisión
                                            fija (4) y, la 1ª vez, la activación (1,5). El detalle
                                            interno de saltos no se expone. */}
                                        <div className="flex items-center justify-between gap-3">
                                            <span style={S.row}>Comisión de conversión (fija)</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>{CONVERT_FLAT_FEE_USDT.toFixed(2)} USDT</span>
                                        </div>
                                        {activationUsdt > 0 && (
                                            <div className="flex items-center justify-between gap-3">
                                                <span style={S.row}>Activación de tu wallet (solo la 1ª vez)</span>
                                                <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>{activationUsdt.toFixed(2)} USDT</span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between gap-3">
                                            <span style={S.row}>Neto que se convierte</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>{usd > 0 ? `${netUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT` : '—'}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span style={S.row}>Llega a tu saldo</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#4ADE80' }}>Hoy · en minutos</span>
                                        </div>
                                    </div>
                                    {/* CTA */}
                                    <div className="flex items-center justify-between gap-4 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 16, paddingTop: 16 }}>
                                        <p style={{ fontSize: 12, color: '#878E88', maxWidth: 320, lineHeight: 1.5 }}>Proceso automático y protegido de punta a punta. Sin costos ocultos.</p>
                                        <button
                                            onClick={doConvert}
                                            disabled={converting || !usdAmount || netUsd <= 0 || rate == null || overBalance}
                                            className="lincoin-btn-white"
                                            style={{ padding: '14px 30px', borderRadius: 10, fontSize: 14.5, fontWeight: 700, border: 'none', opacity: (converting || !usdAmount || netUsd <= 0 || rate == null || overBalance) ? 0.45 : 1 }}
                                        >
                                            {converting ? 'Convirtiendo…' : rate == null ? 'Obteniendo tasa…' : 'Convertir ahora'}
                                        </button>
                                    </div>
                                    {convertResult && (
                                        <div style={{ marginTop: 14, borderRadius: 10, padding: '11px 14px', fontSize: 12.5, lineHeight: 1.5,
                                            border: `1px solid ${convertResult.ok ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.12)'}`,
                                            background: convertResult.ok ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)',
                                            color: convertResult.ok ? '#4ADE80' : '#F4F4F2' }}>
                                            {convertResult.text}
                                        </div>
                                    )}
                                </div>
                                {/* ── Columna derecha ── */}
                                <div className="space-y-[18px]" style={{ alignSelf: 'start' }}>
                                    <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 8 }}>
                                        <FinityRateChart from="USD" to="COP" />
                                    </div>
                                    <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 20 }}>
                                        <span style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid rgba(255,255,255,0.11)', background: 'rgba(255,255,255,0.04)', display: 'grid', placeItems: 'center' }}>
                                            <Clock size={16} strokeWidth={1.6} style={{ color: '#878E88' }} />
                                        </span>
                                        <p style={{ fontSize: 14.5, fontWeight: 700, color: '#F4F4F2', marginTop: 12 }}>¿Conviertes más de $50.000?</p>
                                        <p style={{ fontSize: 12.5, color: '#878E88', marginTop: 4, lineHeight: 1.5 }}>Mesa OTC con tasa negociada y ejecución dedicada.</p>
                                        <a href="mailto:soporte@lincoin.me?subject=Mesa%20OTC%20Lincoin" className="block text-center transition-colors"
                                            style={{ marginTop: 14, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}>
                                            Hablar con la mesa OTC
                                        </a>
                                    </div>
                                    <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 20 }}>
                                        <p style={S.lbl}>TUS ÚLTIMAS CONVERSIONES</p>
                                        {recentConversions && recentConversions.length > 0 ? (
                                            <div style={{ marginTop: 6 }}>
                                                {recentConversions.slice(0, 3).map((c, i) => (
                                                    <div key={i} className="flex items-center justify-between gap-3" style={{ padding: '11px 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
                                                        <div className="min-w-0">
                                                            <p className="truncate" style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F2' }}>{c.label}</p>
                                                            <p className="truncate" style={{ fontSize: 11.5, color: '#878E88', marginTop: 1 }}>{c.meta}</p>
                                                        </div>
                                                        <span className="shrink-0" style={{ fontSize: 13, fontWeight: 700, color: '#4ADE80' }}>{c.result}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p style={{ fontSize: 12.5, color: '#878E88', marginTop: 10 }}>Tu historial de conversiones aparecerá aquí.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        );
                    })()}

                    {/* Tasa en tiempo real + conversión USD(T) → COP (solo flujo completo) */}
                    {!isConverterOnly && (
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
                                            <p className="text-xs font-semibold text-amber-700">No se pudo obtener la tasa en vivo (el riel está lento).</p>
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
                    )}

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
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(4,5,4,0.74)', backdropFilter: 'blur(4px)', fontFamily: "'Archivo', system-ui, sans-serif" }} onClick={() => setConvertConfirm(null)}>
                        <div className="w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200" style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18 }} onClick={e => e.stopPropagation()}>
                            <div className="px-6 pt-6">
                                <h3 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px', color: '#F4F4F2' }}>Confirmar conversión</h3>
                                <p style={{ fontSize: 12, color: '#878E88', marginTop: 2 }}>La tasa queda congelada mientras confirmas.</p>
                            </div>
                            {/* Monto grande */}
                            <div className="px-6 pt-4 text-center">
                                <p style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', color: '#F4F4F2' }}>{convertConfirm.amount.toLocaleString('en-US')} USDT</p>
                                <p style={{ fontSize: 19, fontWeight: 800, color: '#4ADE80', marginTop: 2 }}>≈ {convertConfirm.cop.toLocaleString('es-CO')} COP</p>
                                <p style={{ fontSize: 11, color: '#878E88', marginTop: 2 }}>llegan a tu saldo ACH</p>
                            </div>
                            {/* Desglose — un solo costo transparente */}
                            <div className="mx-6 mt-4 space-y-1.5" style={{ borderRadius: 13, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', padding: '12px 14px', fontSize: 12 }}>
                                <div className="flex justify-between"><span style={{ color: '#878E88' }}>Tasa aplicada</span><span style={{ fontWeight: 700, color: '#F4F4F2' }}>1 USDT = {convertConfirm.clientRate != null ? convertConfirm.clientRate.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—'} COP</span></div>
                                <div className="flex justify-between"><span style={{ color: '#878E88' }}>Costo total del cambio</span><span style={{ fontWeight: 700, color: '#F4F4F2' }}>{convertConfirm.gasfreeCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT (fijo)</span></div>
                                <div className="flex justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 6 }}><span style={{ color: '#878E88' }}>Neto convertido</span><span style={{ fontWeight: 700, color: '#F4F4F2' }}>{convertConfirm.netAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span></div>
                            </div>
                            {/* Contador de expiración de la tasa (sin rojo) */}
                            <div className="px-6 pt-4">
                                <div className="flex items-center justify-between mb-1" style={{ fontSize: 11, fontWeight: 700 }}>
                                    <span style={{ color: '#878E88' }}>{urgent ? 'La tasa está por refrescarse' : 'Tasa válida por'}</span>
                                    <span style={{ color: urgent ? '#F4F4F2' : '#4ADE80', fontVariantNumeric: 'tabular-nums' }}>{rateLeft} s</span>
                                </div>
                                <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                                    <div className="h-full rounded-full transition-all duration-1000 ease-linear" style={{ width: `${pct}%`, background: '#4ADE80', opacity: urgent ? 0.55 : 1 }} />
                                </div>
                            </div>
                            {/* Botones — primario BLANCO */}
                            <div className="px-6 py-6 flex gap-3">
                                <button onClick={() => setConvertConfirm(null)} className="flex-1 h-11 rounded-xl text-sm font-bold transition-colors"
                                    style={{ color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.14)', background: 'transparent' }}>
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => { const c = convertConfirm; setConvertConfirm(null); runConvert(c.amount, c.netAmount, c.gasfreeCost, c.previewRate); }}
                                    className="lincoin-btn-white flex-1 h-11 rounded-xl text-sm font-extrabold transition-colors"
                                    style={{ border: 'none' }}
                                >
                                    Confirmar conversión
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
