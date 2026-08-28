import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Wifi, RefreshCw, Moon, Layers, Plus, Trash2, Edit3, X, AlertCircle } from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import {
    logAdminAction, PERMISSIONS, hasFullCurrencyAccess, canSeePair,
    type AdminProfile,
} from '../lib/adminAuth';
import { NAVY, TEAL } from './shared';
import { useToast } from '../lib/toast';
import { callFinity, extractRate } from '../../FinitySection';

// ─────────────────────────────────────────────
// Cliente de datos del panel. Por defecto: proyecto Personas
// (LincoinANDROID, donde vive el feed original). setRatesDbClient()
// permite apuntar el panel a OTRO proyecto (el admin de Empresas lo
// apunta a su propio Supabase, que tiene su feed fastforex-sync).
// Las rutas /admin-personas y /admin-empresas son page-loads separados,
// así que el override nunca se cruza entre paneles.
// ─────────────────────────────────────────────
let ratesDb: typeof supabasePersonas = supabasePersonas;
// Solo el admin de EMPRESAS repunta el cliente. Ese host es el que tiene
// Finity (riel Colombia): ahí se muestra además el "Panel de tasas Finity"
// con el par USD/COP en exclusión mutua con FastForex.
let finityHost = false;
export const setRatesDbClient = (client: typeof supabasePersonas) => { ratesDb = client; finityHost = true; };

// Timeout duro para consultas: una petición que se cuelga (redes filtradas
// tipo Cisco Umbrella no responden NI fallan) dejaba el panel en
// "Cargando..." eterno. Con esto, a los N segundos revienta con un error
// visible en vez de colgarse.
const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(
            () => rej(new Error(`${label}: sin respuesta en ${ms / 1000}s (¿red filtrada o proyecto inaccesible?)`)),
            ms,
        )),
    ]);


// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────
interface PairConfig {
    id: string | null;          // null = todavía no guardado en DB
    from_currency: string;
    to_currency: string;
    base_fee_pct: number;
    tiers: TierRow[];
    is_active: boolean;
    manual_mode?: boolean;       // true = el admin decidió Manual; sobrevive al cron
    updated_at: string | null;
}
interface TierRow { from_usd: number; to_usd: number | null; pct: number; }
interface GlobalConfig {
    night_enabled: boolean;
    night_start_hour: number;
    night_end_hour: number;
    night_extra_pct: number;
    timezone: string;
}
interface Snapshot {
    from_currency: string;
    to_currency: string;
    rate: number;
    captured_at: string;
    source?: string;     // 'xe', 'fawaz', 'manual' — define el modo del toggle
}

const FLAGS: Record<string, string> = {
    COP: '🇨🇴', CLP: '🇨🇱', PEN: '🇵🇪',
    MXN: '🇲🇽', BRL: '🇧🇷', VES: '🇻🇪', USD: '🇺🇸',
};
// USD se quitó del listado tradeable a pedido del user. Lincoin opera
// solo en LATAM. VES queda incluido por la integración Venezuela.
const ORDER = ['COP', 'CLP', 'PEN', 'MXN', 'BRL', 'VES'];

// Tiers por defecto
const DEFAULT_TIERS: TierRow[] = [
    { from_usd: 0,      to_usd: 1000,   pct: 2.5 },
    { from_usd: 1000,   to_usd: 10000,  pct: 2.0 },
    { from_usd: 10000,  to_usd: 100000, pct: 1.5 },
    { from_usd: 100000, to_usd: null,   pct: 1.0 },
];

// Fee default por par (VES 1.0 %, cross LATAM 0.8 %)
const defaultFee = (from: string, to: string): number => {
    if (from === 'VES' || to === 'VES') return 1.0;
    return 0.8;
};

// Seed completo de pares — todos los cruces entre las 7 monedas (42 pares).
// Se renderiza inmediatamente aunque la tabla fx_pair_config esté vacía.
const SEED_PAIRS: PairConfig[] = ORDER.flatMap(from =>
    ORDER.filter(to => to !== from).map<PairConfig>(to => ({
        id: null,
        from_currency: from,
        to_currency: to,
        base_fee_pct: defaultFee(from, to),
        tiers: DEFAULT_TIERS,
        is_active: true,
        updated_at: null,
    }))
);

// Pares USD↔COP — SOLO en el host de empresas (finityHost). Aparecen en la
// tabla de FastForex para poder prender/apagar la conversión; su toggle es
// la contraparte del Panel de tasas Finity (exclusión mutua).
const USD_SEED_PAIRS: PairConfig[] = [
    { id: null, from_currency: 'USD', to_currency: 'COP', base_fee_pct: 4, tiers: DEFAULT_TIERS, is_active: true, updated_at: null },
    { id: null, from_currency: 'COP', to_currency: 'USD', base_fee_pct: 4, tiers: DEFAULT_TIERS, is_active: true, updated_at: null },
];

const formatTime = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const fmtRate = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pairKey = (from: string, to: string) => `${from}/${to}`;
// Cada cuántos segundos se refresca la tasa. FastForex (proveedor primario
// actual) actualiza cada 5 minutos, así que pedir más seguido sería gastar
// requests sin obtener data nueva.
const REFRESH_SECONDS = 300;

interface FxHealth {
    preferred_source: 'FASTFOREX' | 'MANUAL' | string;
    last_sync_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
    consecutive_failures: number;
    fallback_enabled: boolean;
    ff_snapshots_24h?: number;          // FastForex (único proveedor API)
    manual_snapshots_24h?: number;
    cf_snapshots_24h?: number;          // legacy, ya no se muestra
    fawaz_snapshots_24h?: number;       // legacy, ya no se muestra
    xe_snapshots_24h?: number;          // legacy, ya no se muestra
    pen_cop_rate?: number | null;
    pen_cop_source?: string | null;
    pen_cop_updated_at?: string | null;
}
const formatMmSs = (s: number) => {
    const m = Math.floor(Math.max(0, s) / 60);
    const sec = Math.max(0, s) % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
};

// ─────────────────────────────────────────────
// Panel de tasas Finity — par USD (USDT) → COP con la tasa REAL del riel
// Finity (Colombia), refrescada cada 30 s vía finity-proxy. Solo se
// renderiza en el host de empresas. Su toggle y el del par USD/COP de
// FastForex son mutuamente excluyentes: habilitar uno apaga el otro.
// ─────────────────────────────────────────────
const FinityRatesCard: React.FC<{
    profile: AdminProfile;
    enabled: boolean;
    busy: boolean;
    canManage: boolean;
    onToggle: (next: boolean) => void;
    feePct: number;                      // comisión editable (incluye IVA), persiste en fx_pair_config
    onSaveFee: (pct: number) => Promise<void>;
}> = ({ profile, enabled, busy, canManage, onToggle, feePct, onSaveFee }) => {
    const [rate, setRate] = useState<number | null>(null);
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);
    const [fetching, setFetching] = useState(true);
    // Respuesta CRUDA de /rates para mapear el campo correcto (Finity
    // devuelve varios — compra/venta/promedio — y hay que elegir el real).
    const [rateRaw, setRateRaw] = useState<{ path?: string; status?: number; data?: any } | null>(null);
    // Sondeo de endpoints del proxy Finity (acción `discover`): reporta qué
    // rutas existen en el sandbox. 404/-1 = no existe; cualquier otro status
    // = el endpoint SÍ existe (aunque pida params o permisos).
    const [discovering, setDiscovering] = useState(false);
    const [discoverReport, setDiscoverReport] = useState<Record<string, Array<{ path: string; status: number }>> | null>(null);
    const [discoverError, setDiscoverError] = useState<string | null>(null);
    // Prueba de credenciales (acción `ping`): valida client_id/secret contra
    // el servidor configurado y muestra el veredicto textual.
    const [pinging, setPinging] = useState(false);
    const [pingResult, setPingResult] = useState<{ ok: boolean; text: string } | null>(null);
    // Servidor Finity activo (ping al montar): si es sandbox, la tasa es de
    // PRUEBA y se marca en ámbar para que nadie la confunda con la real.
    const [srvBase, setSrvBase] = useState('');
    useEffect(() => {
        callFinity('ping', profile.id).then(r => setSrvBase(String(r?.base ?? ''))).catch(() => {});
    }, [profile.id]);

    const doPing = async () => {
        setPinging(true);
        setPingResult(null);
        try {
            const r = await withTimeout(callFinity('ping', profile.id), 15000, 'ping Finity');
            // `base` viene del proxy: el servidor Finity REAL al que apunta.
            // sandbox.finity.com.co = datos de ejemplo · api.finity.com.co = real.
            const base = r?.base ? ` · servidor: ${String(r.base).replace(/^https?:\/\//, '')}` : '';
            setPingResult({
                ok: !!r?.ok,
                text: (r?.message ?? r?.error ?? (r?.ok ? 'Credenciales válidas.' : 'Sin respuesta del proxy.')) + base,
            });
        } catch (e: any) {
            setPingResult({ ok: false, text: String(e?.message ?? e) });
        }
        setPinging(false);
    };

    const doDiscover = async () => {
        setDiscovering(true);
        setDiscoverError(null);
        try {
            const r = await withTimeout(callFinity('discover', profile.id), 45000, 'discover Finity');
            if (r?.base) setPingResult(prev => prev ?? { ok: true, text: `sondeo contra servidor ${String(r.base).replace(/^https?:\/\//, '')}` });
            if (r?.ok && r.report) setDiscoverReport(r.report);
            else setDiscoverError(r?.message ?? r?.error ?? 'El proxy no devolvió reporte (¿secrets FINITY_* configurados?).');
        } catch (e: any) {
            setDiscoverError(String(e?.message ?? e));
        }
        setDiscovering(false);
    };

    const refresh = useCallback(async () => {
        setFetching(true);
        try {
            const r = await withTimeout(
                callFinity('rates', profile.id, { query: { from: 'USD', to: 'COP' } }),
                10000, 'tasa Finity',
            );
            setRateRaw({ path: r?.path, status: r?.status, data: r?.data });
            const v = r?.ok ? extractRate(r.data) : null;
            if (v != null) { setRate(v); setUpdatedAt(new Date().toISOString()); }
        } catch { /* la tarjeta muestra "sin respuesta" */ }
        setFetching(false);
    }, [profile.id]);

    useEffect(() => {
        refresh();
        const t = setInterval(refresh, 30000);
        return () => clearInterval(t);
    }, [refresh]);

    const clientRate = rate != null ? rate * (1 - feePct / 100) : null;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900">Panel de tasas Finity</h3>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${enabled ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-teal-500 animate-pulse' : 'bg-slate-400'}`} />
                        {enabled ? 'Activo — la app usa la tasa Finity para USD/COP' : 'Apagado — prende el toggle para operar USD/COP con la tasa Finity'}
                    </span>
                    {/sandbox/i.test(srvBase) && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            ⚠ SANDBOX — la tasa es de PRUEBA (la real requiere credenciales de producción)
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5" title="La comisión de cada empresa se ajusta en Admin → OTC, no aquí">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Comisión por defecto</span>
                        <span className="text-sm font-bold text-slate-700">{feePct}%</span>
                    </div>
                    <button
                        onClick={doPing}
                        disabled={pinging}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                        title="Valida FINITY_CLIENT_ID / FINITY_CLIENT_SECRET contra el servidor configurado"
                    >
                        🔑 {pinging ? 'Probando…' : 'Probar credenciales'}
                    </button>
                    <button
                        onClick={doDiscover}
                        disabled={discovering}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                        title="Sondea las rutas de la API de Finity y reporta cuáles existen"
                    >
                        🔍 {discovering ? 'Sondeando…' : 'Detectar endpoints'}
                    </button>
                    <button
                        onClick={refresh}
                        disabled={fetching}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                    >
                        <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                </div>
            </div>

            {pingResult && (
                <div className={`px-5 py-2 border-b text-[11px] font-semibold ${pingResult.ok ? 'bg-teal-50 border-teal-100 text-teal-800' : 'bg-red-50 border-red-100 text-red-700'}`}>
                    {pingResult.ok ? '✅' : '⛔'} Credenciales: {pingResult.text}
                </div>
            )}
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-600 leading-relaxed">
                <b style={{ color: NAVY }}>Riel Colombia:</b> tasa USD (USDT) → COP en vivo desde Finity, refresca cada 30 s.
                Al <b>habilitar</b> este par, el par USD/COP de FastForex (tabla de abajo) se <b>apaga</b> automáticamente — y al habilitarlo allá, este se apaga. Nunca operan los dos a la vez.
                {' '}La comisión que ve cada cliente se ajusta en <b>Admin → OTC</b> (cada empresa puede tener una distinta) — aquí solo se ve la comisión por defecto.
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="text-left px-5 py-3 font-semibold">Par</th>
                            <th className="text-center px-5 py-3 font-semibold">Conversión</th>
                            <th className="text-right px-5 py-3 font-semibold">Tasa Finity</th>
                            <th className="text-right px-5 py-3 font-semibold">Tasa cliente (incluye {feePct}%)</th>
                            <th className="text-left px-5 py-3 font-semibold">Última Act.</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="border-t border-slate-100">
                            <td className="px-5 py-3 whitespace-nowrap font-semibold text-slate-800">
                                🇺🇸 USD <span className="text-slate-400 font-normal">(USDT)</span> → 🇨🇴 COP
                            </td>
                            <td className="px-5 py-3 text-center">
                                {canManage ? (
                                    <button
                                        onClick={() => onToggle(!enabled)}
                                        disabled={busy}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-teal-500' : 'bg-slate-300'}`}
                                        title={enabled ? 'Desactivar Finity (USD/COP vuelve a FastForex)' : 'Activar Finity (apaga el par USD/COP en FastForex)'}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                ) : (
                                    <span className="text-xs text-slate-400">{enabled ? 'Habilitada' : 'Deshabilitada'}</span>
                                )}
                            </td>
                            <td className="px-5 py-3 text-right font-mono font-semibold" style={{ color: NAVY }}>
                                {fetching && rate == null ? 'Consultando…' : rate != null ? fmtRate(rate) : '— sin respuesta —'}
                            </td>
                            <td className="px-5 py-3 text-right font-mono font-semibold text-teal-700">
                                {clientRate != null ? fmtRate(clientRate) : '—'}
                            </td>
                            <td className="px-5 py-3 text-xs text-slate-500">{updatedAt ? formatTime(updatedAt) : '—'}</td>
                        </tr>
                        {rate == null && !fetching && (
                            <tr>
                                <td colSpan={5} className="px-5 pb-3 text-[11px] text-amber-700">
                                    Finity no devolvió tasa (credenciales o endpoint por confirmar — dale a <b>🔍 Detectar endpoints</b> arriba y mándanos el reporte).
                                    El toggle igual funciona: prende/apaga el par USD/COP de FastForex.
                                </td>
                            </tr>
                        )}
                        {rateRaw && (
                            <tr>
                                <td colSpan={5} className="px-5 pb-3">
                                    <details>
                                        <summary className="text-[11px] text-slate-500 cursor-pointer select-none">
                                            Ver respuesta cruda de Finity ({rateRaw.path ?? '¿?'} · status {rateRaw.status ?? '¿?'}) — para verificar el campo de la tasa
                                        </summary>
                                        <pre className="mt-2 text-[10px] bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all">
{JSON.stringify(rateRaw.data ?? null, null, 2)}
                                        </pre>
                                    </details>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {(discoverReport || discoverError) && (
                <div className="px-5 py-4 border-t border-slate-100">
                    <p className="text-xs font-bold text-slate-700 mb-2">Reporte de endpoints Finity</p>
                    {discoverError && (
                        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">⚠️ {discoverError}</p>
                    )}
                    {discoverReport && (
                        <div className="grid md:grid-cols-2 gap-3">
                            {Object.entries(discoverReport).map(([resource, paths]) => (
                                <div key={resource} className="border border-slate-200 rounded-lg p-3">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{resource}</p>
                                    {paths.map(({ path, status }) => {
                                        // 405 = la ruta existe pero solo acepta otro método (POST):
                                        // típico de endpoints de cotización/creación.
                                        const exists = status !== 404 && status !== -1;
                                        const postOnly = status === 405;
                                        return (
                                            <div key={path} className="flex items-center justify-between text-[11px] font-mono py-0.5">
                                                <span className={exists ? 'font-bold text-teal-700' : 'text-slate-400'}>{path}</span>
                                                <span className={`ml-2 px-1.5 rounded ${exists ? 'bg-teal-50 text-teal-700 font-bold' : 'bg-slate-100 text-slate-400'}`}>
                                                    {status === -1 ? 'error' : status}{postOnly ? ' ✓ existe (solo POST)' : exists ? ' ✓ existe' : ''}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="text-[10px] text-slate-400 mt-2">
                        404 / 405 = la ruta no existe · cualquier otro status (200, 400, 401, 422…) = el endpoint SÍ existe. Mándanos pantallazo de este reporte.
                    </p>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Panel principal
// ─────────────────────────────────────────────
export const RatesPanel: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const [pairs, setPairs] = useState<PairConfig[]>([]);
    const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
    const [global, setGlobal] = useState<GlobalConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshingApi, setRefreshingApi] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS);
    // Tasas que el admin va a publicar (INSERT en fx_rate_snapshots, lo que leen las apps)
    const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
    // Por par: 'manual' si el admin desactivó el toggle API. Vacío = modo API (default).
    const [rateMode, setRateMode] = useState<Record<string, 'manual' | 'api'>>({});
    const [publishing, setPublishing] = useState(false);
    const [editingTiersFor, setEditingTiersFor] = useState<PairConfig | null>(null);
    const [chartPair, setChartPair] = useState<PairConfig | null>(null);
    const [health, setHealth] = useState<FxHealth | null>(null);
    // Tasa ~24h atrás por par, para mostrar delta diario debajo de la tasa actual.
    const [rate24hAgo, setRate24hAgo] = useState<Record<string, number>>({});
    // Diagnóstico visible: a qué proyecto apunta y qué recibió. Clave para
    // depurar sin consola (proyecto equivocado, RLS, red filtrada, etc.).
    // Declarado ANTES de load(): referenciar estado declarado más abajo desde
    // un callback ya causó crashes TDZ dos veces en producción.
    const [debugInfo, setDebugInfo] = useState<{
        phase: string; url?: string; pairs?: number; snaps?: number; error?: string | null;
    }>({ phase: 'iniciando' });
    // Cuándo empezó la fase actual — el contador de 1s re-renderiza, así que
    // "hace Ns" avanza solo. Distingue "pantallazo temprano" de "colgado".
    const phaseAtRef = useRef(Date.now());
    useEffect(() => { phaseAtRef.current = Date.now(); }, [debugInfo.phase]);
    // Reintentos automáticos de load() cuando hay timeouts (máx 2 por ciclo).
    const loadRetryRef = useRef(0);
    // Toggle del Panel de tasas Finity (USD/COP) en curso.
    const [finityBusy, setFinityBusy] = useState(false);

    const canManage = PERMISSIONS.canManageBankAccounts(profile.role);
    const toast = useToast();

    // ─────────────────────────────────────────────
    // Estado de conversión por par — prende/apaga el par en la app al
    // instante escribiendo fx_pair_config.is_active. Las apps mobile
    // leen esa columna para decidir si ofrecen la conversión.
    // ─────────────────────────────────────────────
    const toggleConversion = async (p: PairConfig) => {
        const next = !(p.is_active !== false);   // toggle (undefined cuenta como ON)
        const match = (x: PairConfig) => x.from_currency === p.from_currency && x.to_currency === p.to_currency;
        // Optimista
        setPairs(prev => prev.map(x => match(x) ? { ...x, is_active: next } : x));
        const { error } = await ratesDb
            .from('fx_pair_config')
            .upsert({
                from_currency: p.from_currency,
                to_currency:   p.to_currency,
                is_active:     next,
                updated_by:    profile.id,
                updated_at:    new Date().toISOString(),
            }, { onConflict: 'from_currency,to_currency' });
        if (error) {
            // revertir
            setPairs(prev => prev.map(x => match(x) ? { ...x, is_active: !next } : x));
            toast.error(`No pude ${next ? 'habilitar' : 'deshabilitar'} ${p.from_currency}→${p.to_currency}: ${error.message}`);
            return;
        }
        toast.success(`Conversión ${p.from_currency}→${p.to_currency} ${next ? 'HABILITADA' : 'DESHABILITADA'} en la app.`);
        await logAdminAction({
            admin: profile,
            action: next ? 'fx_pair.enable' : 'fx_pair.disable',
            targetType: 'fx_pair',
            targetId: `${p.from_currency}-${p.to_currency}`,
            metadata: { is_active: next },
        });
    };

    // ─────────────────────────────────────────────
    // Sync centralizado vía RPC sync_xe_rates_now() (Antigravity).
    // - Si los datos en fx_rate_snapshots tienen <5 min → devuelve cached:true sin llamar a XE.
    // - Si tienen >5 min → llama a XE, guarda en fx_rate_snapshots, devuelve cached:false.
    // El admin NO llama directo a APIs externas — todo pasa por este RPC.
    // ─────────────────────────────────────────────
    const callSyncXe = useCallback(async (): Promise<{ ok: boolean; cached?: boolean; sourceChanged?: boolean; pairsInserted?: number; nextRefreshIn?: number; error?: string }> => {
        try {
            const { data, error } = await ratesDb.rpc('sync_xe_rates_now');
            if (error) return { ok: false, error: error.message };
            const d = (data ?? {}) as any;
            return {
                ok: !!d.success,
                cached: !!d.cached,
                sourceChanged: !!d.source_changed,
                pairsInserted: typeof d.pairs_inserted === 'number' ? d.pairs_inserted : undefined,
                nextRefreshIn: typeof d.next_refresh_in === 'number' ? d.next_refresh_in : undefined,
                error: d.error,
            };
        } catch (e: any) {
            return { ok: false, error: e?.message ?? 'desconocido' };
        }
    }, []);

    // Mapa par → manual_mode derivado del estado actual de `pairs`.
    // Usado para filtrar snapshots: si el par está en manual, ignoramos las filas
    // que el cron escriba con source≠MANUAL.
    const buildManualByKey = useCallback((): Map<string, boolean> => {
        const m = new Map<string, boolean>();
        for (const p of pairs) m.set(pairKey(p.from_currency, p.to_currency), p.manual_mode === true);
        return m;
    }, [pairs]);

    // Helper: trae lo más reciente de fx_rate_snapshots por par (es lo que leen las apps).
    // Si pasás `manualByKey`, el filtro es simétrico:
    //   - par en MANUAL → solo filas con source='MANUAL' (ignoramos lo que escriba el cron).
    //   - par en API    → solo filas con source≠'MANUAL' (ignoramos la última manual,
    //                      así al volver a API el panel muestra la tasa del API aunque
    //                      el cron no haya escrito una fila más reciente todavía).
    // Sin manualByKey, devuelve la última fila de cualquier source (compat hacia atrás).
    const fetchSnapshotsFromDb = useCallback(async (manualByKey?: Map<string, boolean>): Promise<Record<string, Snapshot>> => {
        const res = await ratesDb
            .from('fx_rate_snapshots')
            .select('from_currency, to_currency, rate, captured_at, source')
            .order('captured_at', { ascending: false })
            .limit(1000);
        const out: Record<string, Snapshot> = {};
        for (const s of (res.data as Snapshot[]) ?? []) {
            const k = pairKey(s.from_currency, s.to_currency);
            const isManualRow = String(s.source ?? '').toUpperCase() === 'MANUAL';
            if (manualByKey) {
                const isManualPair = manualByKey.get(k) === true;
                if (isManualPair && !isManualRow) continue;
                if (!isManualPair && isManualRow) continue;
            }
            if (!out[k]) out[k] = s;
        }
        return out;
    }, []);

    // Salud del sistema FX (view fx_health_dashboard): preferred_source,
    // last_sync_at, last_error, consecutive_failures, contadores 24h, etc.
    // Si la view no existe (migración pendiente) → silencioso, no crashea.
    const loadHealth = useCallback(async () => {
        // El dropdown lee preferred_source de xe_config (source of truth), no de la
        // view fx_health_dashboard — la view a veces lo deriva de la última snapshot
        // y eso pisa la elección del admin al recargar la página.
        const [healthRes, configRes] = await Promise.all([
            ratesDb.from('fx_health_dashboard').select('*').maybeSingle()
                .then(r => r).catch(() => ({ data: null } as any)),
            ratesDb.from('xe_config').select('preferred_source').eq('id', 1).maybeSingle()
                .then(r => r).catch(() => ({ data: null } as any)),
        ]);
        const healthData = (healthRes.data ?? null) as FxHealth | null;
        const cfgSource = (configRes.data as { preferred_source?: string } | null)?.preferred_source;
        if (healthData || cfgSource) {
            setHealth({
                ...(healthData ?? ({} as any)),
                preferred_source: cfgSource ?? healthData?.preferred_source ?? 'FASTFOREX',
            } as FxHealth);
        } else {
            // Sin datos (view/config inaccesibles): render con defaults en vez
            // de dejar el widget en "Cargando salud..." infinito.
            setHealth({
                preferred_source: 'FASTFOREX',
                last_sync_at: null,
                last_error: null,
                last_error_at: null,
                consecutive_failures: 0,
                fallback_enabled: true,
            } as FxHealth);
        }
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setDebugInfo(d => ({ ...d, phase: 'sync', url: String((ratesDb as any)?.supabaseUrl ?? '') }));

        // 0) Pedir al RPC que sincronice XE si hace falta (caché de 5 min interno).
        //    SOLO en el host personas (Antigravity): en empresas el feed real es
        //    el cron fastforex-sync y el RPC es un stub — llamarlo solo agrega
        //    latencia y, en redes filtradas (Umbrella), un punto de cuelgue.
        if (!finityHost) {
            await withTimeout(callSyncXe(), 8000, 'sync').catch(() => null);
        }
        setDebugInfo(d => ({ ...d, phase: 'consultando pares/tasas' }));

        // Timeout INDIVIDUAL por consulta con valor de respaldo: una petición
        // colgada (nunca resuelve NI falla) no puede arrastrar a las demás.
        const q = <T,>(p: PromiseLike<T>, fallback: T, label: string): Promise<T> =>
            withTimeout(Promise.resolve(p), 6000, label).catch(() => fallback);

        // 1) Lo que tengamos en DB (fees personalizados, ventana nocturna, snapshots
        //    persistidos + tasa de ~24h atrás por par para el delta diario).
        const now = Date.now();
        // Ventana amplia [now-30h, now-22h] — FastForex es reciente y puede no
        // tener filas en una ventana angosta. Tomamos cualquier source de cron
        // (excluimos MANUAL para que el delta refleje mercado, no dedazos).
        const since30h = new Date(now - 30 * 60 * 60 * 1000).toISOString();
        const upto22h  = new Date(now - 22 * 60 * 60 * 1000).toISOString();
        const [pairsRes, globalRes, snapsRes, snaps24hRes] = await withTimeout(Promise.all([
            q(ratesDb.from('fx_pair_config').select('*').then(r => r).catch(() => ({ data: [] } as any)), { data: [], error: { message: 'fx_pair_config: timeout' } } as any, 'fx_pair_config'),
            q(ratesDb.from('fx_global_config').select('*').eq('id', 1).maybeSingle().then(r => r).catch(() => ({ data: null } as any)), { data: null } as any, 'fx_global_config'),
            q(ratesDb.from('fx_rate_snapshots').select('from_currency, to_currency, rate, captured_at, source').order('captured_at', { ascending: false }).limit(500).then(r => r).catch(() => ({ data: [] } as any)), { data: [], error: { message: 'fx_rate_snapshots: timeout' } } as any, 'fx_rate_snapshots'),
            q(ratesDb.from('fx_rate_snapshots')
                .select('from_currency, to_currency, rate, captured_at, source')
                .neq('source', 'MANUAL')
                .gte('captured_at', since30h)
                .lte('captured_at', upto22h)
                .order('captured_at', { ascending: false })
                .limit(4000)
                .then(r => r).catch(() => ({ data: [] } as any)), { data: [] } as any, 'snapshots 24h'),
        ]), 15000, 'carga de pares');

        let dbRows = (pairsRes.data as PairConfig[]) ?? [];
        const pairsFailed = String((pairsRes as any)?.error?.message ?? '').includes('timeout');
        // Memoria local: la última config leída con éxito se recuerda; si la
        // red estanca la lectura, se usa esa en vez de los valores de fábrica
        // (que mostraban 4% / toggle apagado y parecían "cambios perdidos").
        const PAIRS_CACHE_KEY = `cuypay_fx_pairs_${String((ratesDb as any)?.supabaseUrl ?? '')}`;
        if (!pairsFailed && dbRows.length > 0) {
            try { localStorage.setItem(PAIRS_CACHE_KEY, JSON.stringify(dbRows)); } catch { /* sin storage */ }
        } else if (pairsFailed && dbRows.length === 0) {
            try {
                const cached = JSON.parse(localStorage.getItem(PAIRS_CACHE_KEY) || '[]');
                if (Array.isArray(cached) && cached.length > 0) dbRows = cached;
            } catch { /* sin cache */ }
        }
        const loadErrs: string[] = [];
        if ((pairsRes as any)?.error?.message) loadErrs.push(String((pairsRes as any).error.message));
        if ((snapsRes as any)?.error?.message) loadErrs.push(String((snapsRes as any).error.message));
        setDebugInfo({
            phase: 'ok',
            url: String((ratesDb as any)?.supabaseUrl ?? '¿?'),
            pairs: dbRows.length,
            snaps: ((snapsRes.data as any[]) ?? []).length,
            error: loadErrs.length ? loadErrs.join(' · ') : null,
        });
        // Red flaky (Umbrella estanca peticiones al azar): si alguna consulta
        // clave dio timeout, reintentamos la carga completa hasta 2 veces —
        // una petición nueva suele pasar aunque la anterior se haya estancado.
        if (loadErrs.some(e => e.includes('timeout')) && loadRetryRef.current < 2) {
            loadRetryRef.current += 1;
            const attempt = loadRetryRef.current;
            setDebugInfo(d => ({ ...d, phase: `reintentando (${attempt}/2) — hubo timeouts` }));
            setTimeout(() => { load().catch(() => {}); }, 4000);
        } else if (loadErrs.length === 0) {
            loadRetryRef.current = 0;
        }
        const dbMap = new Map<string, PairConfig>();
        for (const r of dbRows) dbMap.set(pairKey(r.from_currency, r.to_currency), r);

        const seedList = finityHost ? [...SEED_PAIRS, ...USD_SEED_PAIRS] : SEED_PAIRS;
        const merged = seedList.map(seed => {
            const db = dbMap.get(pairKey(seed.from_currency, seed.to_currency));
            // base_fee_pct puede venir null de filas creadas por los toggles —
            // que no pise el default del seed.
            return db
                ? { ...seed, ...db, tiers: db.tiers ?? seed.tiers, base_fee_pct: (db as any).base_fee_pct ?? seed.base_fee_pct }
                : seed;
        });
        // Filtrar por moneda asignada del admin (tesorería delegada).
        // super_admin / treasury global ven todo. Treasury de COP solo
        // ve pares que involucran COP en ambas direcciones.
        const visible = hasFullCurrencyAccess(profile)
            ? merged
            : merged.filter(p => canSeePair(profile, p.from_currency, p.to_currency));
        // Si la consulta de config DIO TIMEOUT y ya teníamos estado con datos
        // de DB, NO pisar con seeds: se perderían visualmente el toggle
        // Finity y la comisión que el admin acaba de guardar.
        const pairsTimedOut = String((pairsRes as any)?.error?.message ?? '').includes('timeout');
        setPairs(prev => (pairsTimedOut && prev.length > 0 ? prev : visible));

        // 2) Tasas: filtro simétrico por modo del par.
        //    - manual_mode=true  → solo aceptamos filas source='MANUAL' (el cron de
        //      Antigravity, mientras no respete manual_mode, sigue escribiendo
        //      CURRENCYFREAKS encima — las descartamos para no pisar al admin).
        //    - manual_mode=false → solo aceptamos filas source≠'MANUAL'. Sin esto,
        //      al volver a API el panel seguía mostrando la última tasa MANUAL
        //      hasta que el cron escribiera una fila más reciente.
        const manualByKey = new Map<string, boolean>();
        for (const p of visible) {
            manualByKey.set(pairKey(p.from_currency, p.to_currency), p.manual_mode === true);
        }
        const dbSnapMap: Record<string, Snapshot> = {};
        for (const s of (snapsRes.data as Snapshot[]) ?? []) {
            const k = pairKey(s.from_currency, s.to_currency);
            const isManualPair = manualByKey.get(k) === true;
            const isManualRow  = String(s.source ?? '').toUpperCase() === 'MANUAL';
            if (isManualPair && !isManualRow) continue;
            if (!isManualPair && isManualRow) continue;
            if (!dbSnapMap[k]) dbSnapMap[k] = s;
        }

        // Las apps leen de fx_rate_snapshots → es la única fuente del admin.
        setSnapshots(dbSnapMap);

        // Mapa de tasa ~24h atrás por par para el delta diario. Snapshots están
        // ordenadas DESC dentro de la ventana [now-25h, now-23h]; nos quedamos
        // con la PRIMERA fila por par = la más reciente dentro de la ventana =
        // la más cercana a "exactamente 24h atrás".
        const dbDayAgoMap: Record<string, number> = {};
        for (const s of (snaps24hRes.data as Array<{ from_currency: string; to_currency: string; rate: number }> | null) ?? []) {
            const k = pairKey(s.from_currency, s.to_currency);
            if (dbDayAgoMap[k] === undefined) {
                const v = Number(s.rate);
                if (isFinite(v) && v > 0) dbDayAgoMap[k] = v;
            }
        }
        setRate24hAgo(dbDayAgoMap);

        // 3) Prefill rateEdits para pares en manual_mode=true que no tengan edición
        //    en curso, así el input siempre arranca con la tasa publicada en lugar
        //    de quedar vacío (después de publishAll setRateEdits queda en {} y se
        //    sentía como si el input estuviera "desactivado").
        setRateEdits(prev => {
            const next = { ...prev };
            let changed = false;
            for (const p of visible) {
                const k = pairKey(p.from_currency, p.to_currency);
                if (p.manual_mode === true && !next[k]) {
                    const snap = dbSnapMap[k];
                    if (snap) {
                        next[k] = String(snap.rate);
                        changed = true;
                    }
                }
            }
            return changed ? next : prev;
        });

        setGlobal(globalRes.data as GlobalConfig | null);
        // Si la consulta de salud cuelga o falla, renderizamos defaults:
        // el widget JAMÁS puede quedarse en "Cargando salud..." eterno.
        await withTimeout(loadHealth(), 8000, 'salud FX').catch(() => {
            setHealth(prev => prev ?? ({
                preferred_source: 'FASTFOREX',
                last_sync_at: null,
                last_error: 'Sin conexión con el proyecto (timeout)',
                last_error_at: null,
                consecutive_failures: 0,
                fallback_enabled: true,
            } as FxHealth));
        });
        setLoading(false);
        // Deps: primitivas del profile, NO el objeto — si el padre recrea el
        // profile en cada render (AdminDashboard lo hacía), un dep de objeto
        // reinicia load() en bucle y el panel nunca sale de "Cargando".
    }, [callSyncXe, loadHealth, profile.id, profile.role, profile.assignedCurrency]);

    // load() es async: si algo adentro lanza, sin este catch el panel se
    // queda en "Cargando pares..." para siempre y nadie ve el motivo.
    useEffect(() => {
        load().catch((e: any) => {
            console.error('[RatesPanel] load error:', e);
            toast.error(`Error cargando el panel FX: ${e?.message ?? e}`, 12000);
            setDebugInfo(d => ({ ...d, phase: 'error', error: String(e?.message ?? e) }));
            setLoading(false);
        });
    }, [load]);

    // ─────────────────────────────────────────────
    // Exclusión mutua Finity ⇄ FastForex para USD/COP (solo empresas).
    // Finity ON  → el par USD/COP de FastForex se APAGA (is_active=false).
    // Finity OFF → el par vuelve a FastForex (is_active=true).
    // Prender el par en la tabla FastForex apaga Finity automáticamente:
    // el estado Finity se DERIVA de is_active (una sola fuente de verdad
    // en fx_pair_config, sin flags extra).
    // ─────────────────────────────────────────────
    const usdCopFinityOn = finityHost && pairs.some(p =>
        p.from_currency === 'USD' && p.to_currency === 'COP' && p.is_active === false);
    // Comisión Finity editable (incluye IVA). Vive en fx_pair_config.base_fee_pct
    // del par USD→COP; 4% de fábrica si aún no se ha guardado.
    const usdCopCfg = pairs.find(p => p.from_currency === 'USD' && p.to_currency === 'COP');
    const finityFeePct = (() => {
        const n = Number(usdCopCfg?.base_fee_pct);
        return isFinite(n) && n > 0 ? n : 4;
    })();
    const saveFinityFee = async (pct: number) => {
        const stamp = new Date().toISOString();
        const prevPct = finityFeePct;
        const setFee = (arr: PairConfig[], v: number) => arr.map(p =>
            ((p.from_currency === 'USD' && p.to_currency === 'COP') || (p.from_currency === 'COP' && p.to_currency === 'USD'))
                ? { ...p, base_fee_pct: v } : p);
        // Optimista + timeout: en redes que estancan peticiones, el guardado
        // no puede quedarse mudo — o confirma o revierte con mensaje.
        setPairs(prev => setFee(prev, pct));
        const res: any = await withTimeout(
            Promise.resolve(ratesDb.from('fx_pair_config').upsert([
                { from_currency: 'USD', to_currency: 'COP', base_fee_pct: pct, updated_by: profile.id, updated_at: stamp },
                { from_currency: 'COP', to_currency: 'USD', base_fee_pct: pct, updated_by: profile.id, updated_at: stamp },
            ], { onConflict: 'from_currency,to_currency' })),
            15000, 'guardar comisión Finity',
        ).catch((e: any) => ({ error: { message: String(e?.message ?? e) } }));
        if (res?.error) {
            setPairs(prev => setFee(prev, prevPct));
            // Columna nueva: si el proyecto aún no la tiene, el mensaje lo dice claro.
            toast.error(`No se guardó la comisión (se revirtió a ${prevPct}%): ${res.error.message}${/base_fee_pct/.test(String(res.error.message)) ? ' — corre el ALTER TABLE de base_fee_pct en el SQL Editor.' : ''}`);
            return;
        }
        toast.success(`Comisión Finity guardada: ${pct}% (incluye IVA). Se aplica sobre la tasa Finity para el cliente.`);
        await logAdminAction({
            admin: profile,
            action: 'finity_usdcop.fee',
            targetType: 'fx_pair',
            targetId: 'USD-COP(Finity)',
            metadata: { pct },
        });
    };
    const toggleFinityUsdCop = async (next: boolean) => {
        setFinityBusy(true);
        const stamp = new Date().toISOString();
        const flip = (arr: PairConfig[], active: boolean) => arr.map(p =>
            ((p.from_currency === 'USD' && p.to_currency === 'COP') || (p.from_currency === 'COP' && p.to_currency === 'USD'))
                ? { ...p, is_active: active } : p);
        // Optimista: el toggle responde YA; si el guardado falla, se revierte.
        setPairs(prev => flip(prev, !next));
        const res: any = await withTimeout(
            Promise.resolve(ratesDb.from('fx_pair_config').upsert([
                { from_currency: 'USD', to_currency: 'COP', is_active: !next, updated_by: profile.id, updated_at: stamp },
                { from_currency: 'COP', to_currency: 'USD', is_active: !next, updated_by: profile.id, updated_at: stamp },
            ], { onConflict: 'from_currency,to_currency' })),
            15000, 'guardar toggle Finity',
        ).catch((e: any) => ({ error: { message: String(e?.message ?? e) } }));
        if (res?.error) {
            setPairs(prev => flip(prev, next));
            toast.error(`No se guardó el cambio de Finity (se revirtió): ${res.error.message}. Reintenta.`);
        } else {
            toast.success(next
                ? 'Panel Finity ACTIVADO para USD/COP. El par en FastForex quedó apagado.'
                : 'Panel Finity desactivado. USD/COP vuelve a operar con FastForex.');
            await logAdminAction({
                admin: profile,
                action: next ? 'finity_usdcop.enable' : 'finity_usdcop.disable',
                targetType: 'fx_pair',
                targetId: 'USD-COP(Finity)',
                metadata: { finity: next },
            });
        }
        setFinityBusy(false);
    };

    // Helper: trae lo más reciente de fx_rate_snapshots por par (es lo que leen las apps)

    const refreshFromApi = async () => {
        setRefreshingApi(true);
        try {
            // "Forzar sync" = limpiar caché (last_sync_at=NULL) y luego invocar la función SQL.
            // Si el UPDATE falla por RLS, el sync igual corre — usa lo que tenga la caché.
            await ratesDb.from('xe_config').update({ last_sync_at: null }).eq('id', 1).then(r => r).catch(() => {});
            const sync = await callSyncXe();
            const dbMap = await fetchSnapshotsFromDb(buildManualByKey());
            setSnapshots(dbMap);
            await loadHealth();
            setSecondsLeft(REFRESH_SECONDS);
            if (!sync.ok) {
                toast.error(`Error en sync_xe_rates_now(): ${sync.error ?? 'desconocido'}`);
            } else if (sync.cached) {
                toast.info(`Tasas refrescadas desde caché. Próximo sync en ${formatMmSs(sync.nextRefreshIn ?? 0)}.`);
            } else {
                toast.success(`Sync forzado: ${sync.pairsInserted ?? 0} tasas nuevas en fx_rate_snapshots.`);
            }
        } catch (e: any) {
            toast.error(`Error refrescando tasas: ${e?.message ?? 'desconocido'}`);
        }
        setRefreshingApi(false);
    };

    // Controles de la card de salud
    const setPreferredSource = async (src: 'FASTFOREX' | 'MANUAL') => {
        // 1) Persistir en xe_config. UPDATE + .select() para verificar que
        //    realmente se escribió. UPSERT no sirve acá porque xe_config tiene
        //    columnas NOT NULL extra (account_id) que no conocemos — Postgres
        //    valida el INSERT del upsert antes del ON CONFLICT y revienta.
        //    La fila id=1 ya existe (la migración 2026_xe_config_admin_rls.sql
        //    la garantiza), así que UPDATE es suficiente.
        const upd = await ratesDb
            .from('xe_config')
            .update({ preferred_source: src })
            .eq('id', 1)
            .select('preferred_source');
        const wrote = !upd.error && Array.isArray(upd.data) && upd.data.length > 0
            && String((upd.data[0] as any).preferred_source ?? '').toUpperCase() === src.toUpperCase();
        if (!wrote) {
            const reason = upd.error?.message ?? 'UPDATE no impactó ninguna fila (xe_config sin id=1 o RLS).';
            const { error: rpcErr } = await ratesDb
                .rpc('fx_set_preferred_source', { source: src });
            if (rpcErr) {
                toast.error(`No pude cambiar la fuente. UPDATE: ${reason} · RPC: ${rpcErr.message}`, 10000);
                await loadHealth();
                return;
            }
        }

        // 2) Propagar el modo a TODOS los pares visibles.
        //    MANUAL → todos pasan a manual_mode=true (el cron de Antigravity los respeta y
        //    deja de escribir esas filas). CURRENCYFREAKS → todos vuelven a manual_mode=false.
        const isManualSrc = src === 'MANUAL';
        const pairUpserts = pairs.map(p => ({
            from_currency: p.from_currency,
            to_currency:   p.to_currency,
            manual_mode:   isManualSrc,
            updated_by:    profile.id,
            updated_at:    new Date().toISOString(),
        }));
        let pairsPersisted = pairUpserts.length;
        if (pairUpserts.length > 0) {
            const upRes = await ratesDb
                .from('fx_pair_config')
                .upsert(pairUpserts, { onConflict: 'from_currency,to_currency' });
            if (upRes.error) {
                pairsPersisted = 0;
                if (/manual_mode/.test(upRes.error.message)) {
                    toast.warn('Fuente cambiada, pero falta correr la migración 2026_fx_manual_mode.sql para que el modo Manual persista al cron.');
                } else {
                    toast.warn(`Fuente cambiada, pero no pude persistir el modo por par: ${upRes.error.message}`);
                }
            }
        }

        // 3) UI: pintar todos los toggles con el modo nuevo y, si pasamos a MANUAL,
        //    prellenar los inputs con la tasa de mercado actual para que el admin la edite.
        const nextMode: Record<string, 'manual' | 'api'> = {};
        const nextEdits: Record<string, string> = isManualSrc ? { ...rateEdits } : {};
        for (const p of pairs) {
            const k = pairKey(p.from_currency, p.to_currency);
            nextMode[k] = isManualSrc ? 'manual' : 'api';
            if (isManualSrc && !nextEdits[k]) {
                const snap = snapshots[k];
                if (snap) nextEdits[k] = String(snap.rate);
            }
        }
        setRateMode(nextMode);
        setRateEdits(nextEdits);

        await logAdminAction({
            admin: profile,
            action: 'fx_set_preferred_source',
            metadata: { source: src, pairs_updated: pairsPersisted },
        });

        // 4) En MANUAL no llamamos al sync (el admin va a tipear y publicar).
        //    En CURRENCYFREAKS forzamos sync para traer tasas frescas.
        if (isManualSrc) {
            // Sincronizar pairs state con manual_mode=true para que isManual
            // siga devolviendo true al limpiarse rateMode (después de publishAll, etc.).
            setPairs(prev => prev.map(p => ({ ...p, manual_mode: true })));
            await loadHealth();
            toast.success(`✓ Modo MANUAL activado en ${pairsPersisted || pairs.length} pares. Editá las tasas y presioná "Publicar todas".`);
            return;
        }

        toast.info(`Fuente cambiada a ${src}. Sincronizando…`);
        await ratesDb.from('xe_config').update({ last_sync_at: null }).eq('id', 1).then(r => r).catch(() => {});
        const sync = await callSyncXe();

        // Filtro construido con el modo NUEVO (no con `pairs` state que todavía
        // tiene manual_mode viejo). Sin esto, al volver a API el snapshot seguía
        // mostrando la tasa MANUAL recién publicada en vez de la del cron.
        const intendedManualByKey = new Map<string, boolean>();
        for (const p of pairs) {
            intendedManualByKey.set(pairKey(p.from_currency, p.to_currency), isManualSrc);
        }
        const dbMap = await fetchSnapshotsFromDb(intendedManualByKey);
        setSnapshots(dbMap);
        // Sincronizar pairs state con el nuevo manual_mode para que el resto del
        // ciclo de render (isManual, render de inputs, etc.) coincida con la DB.
        setPairs(prev => prev.map(p => ({ ...p, manual_mode: isManualSrc })));
        await loadHealth();
        setSecondsLeft(REFRESH_SECONDS);

        if (sync.ok && sync.sourceChanged && (sync.pairsInserted ?? 0) > 0) {
            toast.success(`✓ Fuente cambiada a ${src}. Sync forzado: ${sync.pairsInserted} tasas nuevas (frescas de ${src}).`);
        } else if (sync.ok && !sync.cached && (sync.pairsInserted ?? 0) > 0) {
            toast.success(`✓ Fuente: ${src}. ${sync.pairsInserted} tasas nuevas en la tabla.`);
        } else if (sync.ok && sync.cached) {
            toast.success(`✓ Fuente: ${src}. Las tasas actuales ya son recientes — no fue necesario llamar a la API.`);
        } else if (!sync.ok) {
            toast.error(`Fuente: ${src} guardada, pero el sync falló: ${sync.error ?? 'desconocido'}`, 10000);
        } else {
            toast.success(`✓ Fuente: ${src}.`);
        }
    };

    const toggleFallback = async (enabled: boolean) => {
        // UPDATE directo primero (igual que setPreferredSource).
        const upd = await ratesDb
            .from('xe_config')
            .update({ fallback_enabled: enabled })
            .eq('id', 1);
        if (upd.error) {
            const { error: rpcErr } = await ratesDb
                .rpc('fx_toggle_fallback', { enabled });
            if (rpcErr) {
                toast.error(`No pude cambiar el fallback. UPDATE: ${upd.error.message} · RPC: ${rpcErr.message}`, 10000);
                return;
            }
        }
        toast.success(`Fallback automático ${enabled ? 'activado' : 'desactivado'}`);
        await logAdminAction({ admin: profile, action: 'fx_toggle_fallback', metadata: { enabled } });
        loadHealth();
    };

    // Tic cada segundo para el contador visible.
    useEffect(() => {
        const tick = setInterval(() => setSecondsLeft(s => (s > 0 ? s - 1 : 0)), 1000);
        return () => clearInterval(tick);
    }, []);

    // Sincronizar el contador con el ciclo real del cron: next_sync = last_sync + 5 min.
    // Sin esto el "actualiza en X" arrancaba en 5:00 al cargar la página, aunque la
    // API ya hubiera publicado data nueva hace 4 min — quedabas esperando 5 min
    // de más para ver tasas frescas.
    useEffect(() => {
        if (!health?.last_sync_at) return;
        const lastSyncMs = new Date(health.last_sync_at).getTime();
        if (!isFinite(lastSyncMs)) return;
        const nextSyncMs = lastSyncMs + REFRESH_SECONDS * 1000;
        const remaining  = Math.max(0, Math.round((nextSyncMs - Date.now()) / 1000));
        setSecondsLeft(remaining);
    }, [health?.last_sync_at]);

    // Al llegar a 0: forzar sync REAL (sin caché) y recargar de DB. Sin toast.
    // Igual que el botón "Forzar sync ahora": limpiamos last_sync_at primero
    // para que Antigravity vaya a CurrencyFreaks de verdad en vez de devolver cached.
    useEffect(() => {
        if (secondsLeft !== 0) return;
        let cancelled = false;
        (async () => {
            try {
                await ratesDb.from('xe_config').update({ last_sync_at: null }).eq('id', 1).then(r => r).catch(() => {});
                await callSyncXe();
                const dbMap = await fetchSnapshotsFromDb(buildManualByKey());
                if (!cancelled) {
                    setSnapshots(dbMap);
                    await loadHealth();
                }
            } catch { /* reintenta en el próximo ciclo */ }
            if (!cancelled) setSecondsLeft(REFRESH_SECONDS);
        })();
        return () => { cancelled = true; };
    }, [secondsLeft, callSyncXe, fetchSnapshotsFromDb, loadHealth, buildManualByKey]);

    const rateDirty = Object.keys(rateEdits).length > 0;

    // Inserta filas en fx_rate_snapshots. Maneja error de RLS/tabla faltante.
    const insertSnapshots = async (rows: Array<{ from_currency: string; to_currency: string; rate: number; source: string }>) => {
        const { error } = await ratesDb.from('fx_rate_snapshots').insert(rows);
        if (error) {
            const isRls = /row-level security|policy/i.test(error.message);
            const isMissing = /does not exist|relation/i.test(error.message);
            toast.error(
                isMissing
                    ? 'La tabla fx_rate_snapshots no existe. Corre 2026_fx_public_read.sql.'
                    : isRls
                    ? 'Falta permiso para publicar. Corre la migración 2026_fx_admin_publish_rates.sql en el SQL Editor.'
                    : `Error publicando: ${error.message}`,
                10000  // sticky 10s para errores que requieren acción
            );
            return false;
        }
        return true;
    };

    // Modo del toggle:
    //   1) Si el admin lo tocó localmente sin publicar → override transitorio.
    //   2) Si no → fx_pair_config.manual_mode (persistido, sobrevive al cron).
    //   3) Fallback: source de la última snapshot.
    const isManual = (k: string): boolean => {
        if (rateMode[k]) return rateMode[k] === 'manual';
        const pair = pairs.find(p => pairKey(p.from_currency, p.to_currency) === k);
        if (pair?.manual_mode === true)  return true;
        if (pair?.manual_mode === false) return false;
        return String(snapshots[k]?.source ?? '').toLowerCase() === 'manual';
    };

    // Toggle por par: API ↔ Manual.
    // Al pasar a manual, prellenamos el input con la tasa de mercado actual.
    // Al volver a API, limpiamos la edición.
    const toggleMode = (k: string, snap: Snapshot | undefined) => {
        if (isManual(k)) {
            // De Manual → API: marcamos override 'api' (sobrevive aunque la última
            // snapshot tenga source='manual'; publicar API revierte el source).
            setRateMode(prev => ({ ...prev, [k]: 'api' }));
            setRateEdits(prev => { const c = { ...prev }; delete c[k]; return c; });
        } else {
            // De API → Manual: prellenamos input con la tasa de mercado actual.
            setRateMode(prev => ({ ...prev, [k]: 'manual' }));
            if (snap) setRateEdits(prev => ({ ...prev, [k]: String(snap.rate) }));
        }
    };

    // Publica TODOS los pares en fx_rate_snapshots:
    //   - Manual → la tasa typed (source 'MANUAL')
    //   - API    → la tasa actual SOLO si tenemos snapshot fresco (source no-MANUAL).
    //              Si el par recién flipea de manual a API y la última snapshot es
    //              MANUAL, NO publicamos un fake con source='FASTFOREX' (sería mentir
    //              sobre la fuente). Solo actualizamos fx_pair_config.manual_mode=false
    //              y forzamos un sync para que el cron escriba el rate real ya.
    const publishAll = async () => {
        const snapshotRows: Array<{ from_currency: string; to_currency: string; rate: number; source: string }> = [];
        const modeChanges: Array<{ from_currency: string; to_currency: string; manual_mode: boolean }> = [];
        let flippedToApiWithoutSnap = false;

        for (const p of pairs) {
            const k = pairKey(p.from_currency, p.to_currency);
            const wantManual = isManual(k);
            modeChanges.push({
                from_currency: p.from_currency,
                to_currency:   p.to_currency,
                manual_mode:   wantManual,
            });

            if (wantManual) {
                const v = Number(String(rateEdits[k] ?? '').replace(',', '.'));
                if (!isFinite(v) || v <= 0) continue;
                snapshotRows.push({ from_currency: p.from_currency, to_currency: p.to_currency, rate: v, source: 'MANUAL' });
            } else {
                const snap = snapshots[k];
                if (!snap) continue;
                const snapSource = String(snap.source ?? '').toUpperCase();
                // Si la última snapshot conocida es MANUAL, NO la republicamos
                // como FASTFOREX — el cron va a escribir el valor real cuando
                // detecte manual_mode=false.
                if (snapSource === 'MANUAL') {
                    flippedToApiWithoutSnap = true;
                    continue;
                }
                snapshotRows.push({ from_currency: p.from_currency, to_currency: p.to_currency, rate: snap.rate, source: snapSource || 'FASTFOREX' });
            }
        }

        if (snapshotRows.length === 0 && modeChanges.length === 0) {
            toast.warn('No hay tasas para publicar.');
            return;
        }

        setPublishing(true);

        // (1) Insertar snapshots si hay (Manual con valor + API con snapshot fresco).
        if (snapshotRows.length > 0) {
            const ok = await insertSnapshots(snapshotRows);
            if (!ok) { setPublishing(false); return; }
        }

        // (2) Persistir el modo por par EN TODOS los pares (aunque no hayamos
        //     insertado snapshot para alguno) — es lo único que detiene al cron
        //     de pisar el modo Manual del admin.
        const upserts = modeChanges.map(m => ({
            ...m,
            updated_by: profile.id,
            updated_at: new Date().toISOString(),
        }));
        const upRes = await ratesDb
            .from('fx_pair_config')
            .upsert(upserts, { onConflict: 'from_currency,to_currency' });
        if (upRes.error) {
            if (/manual_mode/i.test(upRes.error.message)) {
                toast.error('El cambio de modo NO persistió: falta la migración 2026_fx_manual_mode.sql. Pedile a Antigravity que la corra.', 12000);
            } else if (/row-level security|policy/i.test(upRes.error.message)) {
                toast.error(`Falta permiso para escribir en fx_pair_config (RLS). El admin tiene rol correcto? · ${upRes.error.message}`, 12000);
            } else {
                toast.error(`fx_pair_config NO se actualizó: ${upRes.error.message}`, 12000);
            }
            setPublishing(false);
            // Recargar igual para reflejar el estado real del backend.
            await load();
            return;
        }

        // (3) Si algún par pasó a API sin snapshot API fresca, fuerzo sync ya
        //     para que el cron escriba rates reales (no esperamos 5 min).
        if (flippedToApiWithoutSnap) {
            await ratesDb.from('xe_config').update({ last_sync_at: null }).eq('id', 1).then(r => r).catch(() => {});
            await callSyncXe();
        }

        const manualCount = snapshotRows.filter(r => r.source === 'MANUAL').length;
        const apiCount    = snapshotRows.length - manualCount;
        await logAdminAction({ admin: profile, action: 'fx_rates_publish_all', metadata: { api: apiCount, manual: manualCount, mode_changes: modeChanges.length } });
        if (flippedToApiWithoutSnap) {
            toast.success(`✓ ${snapshotRows.length} tasas publicadas (${apiCount} API · ${manualCount} manual). Sincronizando FastForex para los pares que volvieron a API…`);
        } else {
            toast.success(`✓ ${snapshotRows.length} tasas publicadas (${apiCount} API · ${manualCount} manual). Las apps ya las leen.`);
        }
        setRateMode({});
        setRateEdits({});
        await load();
        setPublishing(false);
    };

    return (
        <div className="space-y-6">
            {/* HEADER */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-2xl font-bold" style={{ color: NAVY }}>Rates</h2>
                    {!hasFullCurrencyAccess(profile) && profile.assignedCurrency && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">
                            Vista filtrada por {profile.assignedCurrency}
                        </span>
                    )}
                </div>
            </div>

            {/* HEALTH DASHBOARD — estado del sistema FX */}
            <FxHealthCard
                health={health}
                onForceSync={refreshFromApi}
                forcing={refreshingApi}
                onChangeSource={setPreferredSource}
                onToggleFallback={toggleFallback}
                canManage={canManage}
            />

            {/* CONFIG GLOBAL + VENTANA NOCTURNA */}
            <NightWindowCard profile={profile} initial={global} onSaved={load} canManage={canManage} />

            {/* PANEL FINITY — solo host empresas (riel Colombia, USD/COP) */}
            {finityHost && (
                <FinityRatesCard
                    profile={profile}
                    enabled={usdCopFinityOn}
                    busy={finityBusy}
                    canManage={canManage}
                    onToggle={toggleFinityUsdCop}
                    feePct={finityFeePct}
                    onSaveFee={saveFinityFee}
                />
            )}

            {/* PANEL TABLA */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">Panel de Tasas de Cambio</h3>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            En vivo · actualiza en {formatMmSs(secondsLeft)}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setSecondsLeft(REFRESH_SECONDS); refreshFromApi(); }}
                            disabled={refreshingApi}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                        >
                            <RefreshCw size={14} className={refreshingApi ? 'animate-spin' : ''} />
                            Actualizar ahora
                        </button>
                        {canManage && (
                            <button
                                onClick={publishAll}
                                disabled={publishing}
                                className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
                                style={{ backgroundColor: NAVY }}
                            >
                                <Wifi size={14} />
                                {publishing ? 'Publicando...' : 'Publicar todas'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Línea de diagnóstico SIEMPRE visible: proyecto al que apunta el
                    panel, cuántos pares/tasas llegaron y el error si hubo. Permite
                    depurar con un pantallazo, sin consola del navegador. */}
                <div className="px-5 py-1.5 border-b border-slate-100 text-[10px] text-slate-400 font-mono">
                    Diagnóstico: {debugInfo.phase} (hace {Math.max(0, Math.round((Date.now() - phaseAtRef.current) / 1000))}s)
                    {debugInfo.url ? ` · proyecto ${debugInfo.url.replace(/^https?:\/\//, '')}` : ''}
                    {typeof debugInfo.pairs === 'number' ? ` · pares en DB: ${debugInfo.pairs}` : ''}
                    {typeof debugInfo.snaps === 'number' ? ` · tasas recibidas: ${debugInfo.snaps}` : ''}
                    {debugInfo.error ? ` · ⚠️ ${debugInfo.error}` : ''}
                    {debugInfo.error && (
                        <button
                            onClick={() => { loadRetryRef.current = 0; load().catch(() => {}); }}
                            className="ml-2 font-bold underline text-slate-500 hover:text-slate-700"
                        >
                            Reintentar carga
                        </button>
                    )}
                </div>

                <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-600 leading-relaxed">
                    <b style={{ color: NAVY }}>Cómo funciona:</b> la columna "Tasa publicada" muestra la última fila de <code>fx_rate_snapshots</code> (lo que leen las apps). Esa tabla la pobla el cron de Antigravity con FastForex como fuente primaria (refresca cada 5 min).
                    <b>API activado</b> (verde) = dejás que la API/cron escriba. <b>API desactivado</b> (gris) = pasás a Manual y escribís tu tasa.
                    <b>Publicar todas</b> inserta una fila nueva con cada tasa (las Manual ganan a la cron porque son más recientes). La comisión no toca la tasa: se aplica al monto (Tiers).
                </div>


                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-5 py-3 font-semibold">Par</th>
                                <th className="text-center px-5 py-3 font-semibold">Conversión</th>
                                <th className="text-right px-5 py-3 font-semibold">Tasa publicada</th>
                                <th className="text-center px-5 py-3 font-semibold">Modo</th>
                                <th className="text-right px-5 py-3 font-semibold">Tasa que publicarás</th>
                                <th className="text-left px-5 py-3 font-semibold">Última Act.</th>
                                <th className="px-5 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                                    Cargando pares... ({debugInfo.phase}{debugInfo.error ? ` — ${debugInfo.error}` : ''})
                                </td></tr>
                            )}
                            {pairs.map(p => {
                                const k = pairKey(p.from_currency, p.to_currency);
                                const snap = snapshots[k];
                                return (
                                    <tr key={k} className="border-t border-slate-100 hover:bg-slate-50/60">
                                        {/* Par (clickable: abre el gráfico histórico) */}
                                        <td className="px-5 py-3 whitespace-nowrap">
                                            <button
                                                onClick={() => setChartPair(p)}
                                                title={`Ver gráfica histórica ${p.from_currency}/${p.to_currency}`}
                                                className="flex items-center gap-2 font-semibold cursor-pointer rounded-md px-1 -mx-1 py-0.5 hover:bg-slate-100 hover:underline focus:outline-none focus:ring-2 focus:ring-[#2DD4BF] focus:ring-opacity-50"
                                                style={{ color: NAVY }}
                                            >
                                                <span className="text-base">{FLAGS[p.from_currency] ?? '🏳️'}</span>
                                                <span>{p.from_currency}</span>
                                                <span className="text-slate-400">→</span>
                                                <span className="text-base">{FLAGS[p.to_currency] ?? '🏳️'}</span>
                                                <span>{p.to_currency}</span>
                                            </button>
                                        </td>
                                        {/* Toggle Estado de conversión — apaga/enciende el par en la app
                                            al instante vía fx_pair_config.is_active */}
                                        <td className="px-5 py-3 text-center">
                                            <button
                                                onClick={() => canManage && toggleConversion(p)}
                                                disabled={!canManage}
                                                title={p.is_active !== false
                                                    ? 'Conversión HABILITADA en la app — click para deshabilitar'
                                                    : 'Conversión DESHABILITADA en la app — click para habilitar'}
                                                className={`inline-flex items-center gap-2 ${!canManage ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                            >
                                                <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${p.is_active !== false ? 'bg-emerald-500' : 'bg-red-400'}`}>
                                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${p.is_active !== false ? 'left-[18px]' : 'left-0.5'}`} />
                                                </span>
                                                <span className={`text-[11px] font-bold uppercase tracking-wider w-8 text-left ${p.is_active !== false ? 'text-emerald-700' : 'text-red-600'}`}>
                                                    {p.is_active !== false ? 'ON' : 'OFF'}
                                                </span>
                                            </button>
                                        </td>
                                        {/* Tasa mercado (vivo) + delta diario debajo */}
                                        <td className="px-5 py-3 text-right font-mono text-slate-900">
                                            {snap ? (
                                                <>
                                                    <div>{fmtRate(snap.rate)}</div>
                                                    {(() => {
                                                        const ref = rate24hAgo[k];
                                                        if (!ref || ref <= 0) return null;
                                                        const delta = snap.rate - ref;
                                                        const pct = (delta / ref) * 100;
                                                        const up = delta >= 0;
                                                        const color = up ? 'text-emerald-600' : 'text-red-600';
                                                        const sign = up ? '+' : '−';
                                                        const absDelta = Math.abs(delta);
                                                        const absPct   = Math.abs(pct);
                                                        return (
                                                            <div className={`text-[10px] ${color} font-semibold mt-0.5`}>
                                                                {sign}{fmtRate(absDelta)} {sign}{absPct.toFixed(2)}%
                                                            </div>
                                                        );
                                                    })()}
                                                </>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                        {/* Toggle API/Manual */}
                                        <td className="px-5 py-3 text-center">
                                            <button
                                                onClick={() => canManage && toggleMode(k, snap)}
                                                disabled={!canManage}
                                                title={isManual(k) ? 'Manual — click para volver a API' : 'API — click para pasar a Manual'}
                                                className={`inline-flex items-center gap-2 ${!canManage ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                            >
                                                <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${isManual(k) ? 'bg-slate-300' : 'bg-emerald-500'}`}>
                                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${isManual(k) ? 'left-0.5' : 'left-[18px]'}`} />
                                                </span>
                                                <span className={`text-[11px] font-bold uppercase tracking-wider w-12 text-left ${isManual(k) ? 'text-slate-500' : 'text-emerald-700'}`}>
                                                    {isManual(k) ? 'Manual' : 'API'}
                                                </span>
                                            </button>
                                        </td>
                                        {/* Tasa que publicarás (read-only si API, editable si Manual) */}
                                        <td className="px-5 py-3 text-right">
                                            {isManual(k) ? (
                                                <input
                                                    value={rateEdits[k] ?? ''}
                                                    onChange={e => setRateEdits(prev => ({ ...prev, [k]: e.target.value.replace(/[^0-9.,]/g, '') }))}
                                                    placeholder={snap ? fmtRate(snap.rate) : '—'}
                                                    disabled={!canManage}
                                                    autoFocus
                                                    className="w-32 text-right px-2 py-1.5 rounded-lg border border-amber-400 bg-amber-50 font-mono text-sm outline-none focus:border-amber-500"
                                                />
                                            ) : (
                                                <span className="font-mono text-slate-900">
                                                    {snap ? fmtRate(snap.rate) : <span className="text-slate-300">—</span>}
                                                </span>
                                            )}
                                        </td>
                                        {/* Última act. */}
                                        <td className="px-5 py-3 text-slate-500 text-xs">
                                            {snap ? formatTime(snap.captured_at) : <span className="text-slate-400 italic">Iniciando...</span>}
                                        </td>
                                        {/* Acciones: gráfico histórico + tiers */}
                                        <td className="px-5 py-3 text-right">
                                            {canManage && (
                                                <button
                                                    onClick={() => setEditingTiersFor(p)}
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg hover:bg-slate-100 text-slate-600"
                                                    title="Editar tiers por volumen"
                                                >
                                                    <Layers size={12} />
                                                    Tiers ({p.tiers?.length ?? 0})
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {rateDirty && (
                    <div className="px-5 py-3 border-t border-amber-200 bg-amber-50 text-amber-800 text-xs flex items-center justify-between">
                        <span>{Object.keys(rateEdits).length} tasa(s) sin publicar · al publicar se insertan en fx_rate_snapshots (lo que leen las apps)</span>
                        <button onClick={() => setRateEdits({})} className="font-semibold hover:underline">Descartar</button>
                    </div>
                )}
            </div>

            {/* CONFIG GLOBAL ya se renderizó arriba */}

            {editingTiersFor && (
                <TiersEditorModal
                    pair={editingTiersFor}
                    onClose={() => setEditingTiersFor(null)}
                    onSaved={() => { setEditingTiersFor(null); load(); }}
                    profile={profile}
                />
            )}
            {chartPair && (
                <RateChartModal
                    pair={chartPair}
                    onClose={() => setChartPair(null)}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Card: Ventana nocturna global
// ─────────────────────────────────────────────
const NightWindowCard: React.FC<{
    profile: AdminProfile;
    initial: GlobalConfig | null;
    onSaved: () => void;
    canManage: boolean;
}> = ({ profile, initial, onSaved, canManage }) => {
    const toast = useToast();
    const [enabled, setEnabled] = useState(false);
    const [startH, setStartH] = useState(3);
    const [endH, setEndH] = useState(8);
    const [extra, setExtra] = useState(1.0);
    // Estado separado para el input (string) — evita el bug "05" donde React
    // no re-renderiza porque Number("05") === Number("5") y queda el cero.
    const [extraInput, setExtraInput] = useState('1');
    const [tz, setTz] = useState('America/Bogota');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (initial) {
            setEnabled(initial.night_enabled);
            setStartH(initial.night_start_hour);
            setEndH(initial.night_end_hour);
            setExtra(initial.night_extra_pct);
            setExtraInput(String(initial.night_extra_pct));
            setTz(initial.timezone);
        }
    }, [initial]);

    const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    const save = async () => {
        setSaving(true);
        setSaveMsg(null);
        // Si la fila id=1 no existe, upsert la crea. Soporta el primer guardado
        // aunque la migración F7 no haya hecho el INSERT inicial.
        const { error } = await ratesDb.from('fx_global_config').upsert({
            id: 1,
            night_enabled: enabled,
            night_start_hour: startH,
            night_end_hour: endH,
            night_extra_pct: extra,
            timezone: tz,
            updated_by: profile.id,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

        if (error) {
            const isMissingTable = /does not exist/i.test(error.message);
            const isRls = /row-level security|policy/i.test(error.message);
            toast.error(
                isMissingTable
                    ? 'La tabla fx_global_config NO existe. Corre 2026_phase_7_fx_commissions.sql.'
                    : isRls
                    ? 'RLS bloqueando. Corre 2026_fx_public_read.sql para habilitar UPDATE.'
                    : `Error: ${error.message}`,
                10000,
            );
            setSaving(false);
            return;
        }

        await logAdminAction({ admin: profile, action: 'fx_global_update', metadata: { enabled, startH, endH, extra, tz } });
        toast.success('✓ Configuración nocturna guardada');
        setSaving(false);
        onSaved();
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${NAVY}10` }}>
                        <Moon size={18} color={NAVY} />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900">Configuración Global</h3>
                        <p className="text-xs text-slate-500">Ventana nocturna y % extra para todos los pares</p>
                    </div>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => setEnabled(e.target.checked)}
                        disabled={!canManage}
                        className="sr-only peer"
                    />
                    <span className="w-11 h-6 rounded-full bg-slate-200 peer-checked:bg-emerald-500 relative transition-colors">
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                    </span>
                    <span className="text-sm font-semibold" style={{ color: enabled ? '#065F46' : '#475569' }}>
                        {enabled ? 'Activada' : 'Desactivada'}
                    </span>
                </label>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
                <Field label="Hora inicio">
                    <HourSelect
                        value={startH}
                        onChange={setStartH}
                        disabled={!canManage || !enabled}
                    />
                </Field>
                <Field label="Hora fin">
                    <HourSelect
                        value={endH}
                        onChange={setEndH}
                        disabled={!canManage || !enabled}
                    />
                </Field>
                <Field label="% extra nocturno">
                    <div className="relative">
                        <input
                            type="number" step="0.1" min={0}
                            value={extraInput}
                            onChange={e => {
                                const v = e.target.value;
                                setExtraInput(v);
                                setExtra(v === '' ? 0 : Number(v) || 0);
                            }}
                            onBlur={() => {
                                // Al perder foco normalizamos el string para mostrar
                                // un valor limpio (sin ceros a la izquierda).
                                setExtraInput(String(extra));
                            }}
                            disabled={!canManage || !enabled}
                            className="w-full px-3 py-2 pr-8 rounded-lg border border-slate-200 font-mono disabled:bg-slate-50 disabled:text-slate-400"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
                    </div>
                </Field>
                <Field label="Zona horaria">
                    <select
                        value={tz}
                        onChange={e => setTz(e.target.value)}
                        disabled={!canManage}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                        <option value="America/Bogota">America/Bogota</option>
                        <option value="America/Lima">America/Lima</option>
                        <option value="America/Santiago">America/Santiago</option>
                        <option value="America/Mexico_City">America/Mexico_City</option>
                        <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                        <option value="America/Caracas">America/Caracas</option>
                    </select>
                </Field>
            </div>

            {saveMsg && (
                <div className={`px-5 py-2.5 text-xs font-medium border-t ${
                    saveMsg.kind === 'ok'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                        : 'bg-red-50 text-red-800 border-red-100'
                }`}>
                    {saveMsg.text}
                </div>
            )}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-slate-600">
                    Vigente: <span className="font-semibold">{enabled ? `${String(startH).padStart(2,'0')}:00 → ${String(endH).padStart(2,'0')}:00 (${tz})` : '— sin recargo nocturno —'}</span>
                </p>
                {canManage && (
                    <button onClick={save} disabled={saving} style={{ backgroundColor: NAVY }} className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50">
                        {saving ? 'Guardando...' : 'Guardar configuración'}
                    </button>
                )}
            </div>
        </div>
    );
};

// Select de hora 24h: muestra "00:00, 01:00, ..., 23:00" (estilo reloj militar)
const HourSelect: React.FC<{ value: number; onChange: (v: number) => void; disabled?: boolean }> =
    ({ value, onChange, disabled }) => (
        <select
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            disabled={disabled}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono disabled:bg-slate-50 disabled:text-slate-400 bg-white"
        >
            {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
        </select>
    );

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">{label}</label>
        {children}
    </div>
);

// ─────────────────────────────────────────────
// Modal: Editor de tiers por volumen USD
// ─────────────────────────────────────────────
const TiersEditorModal: React.FC<{
    pair: PairConfig;
    onClose: () => void;
    onSaved: () => void;
    profile: AdminProfile;
}> = ({ pair, onClose, onSaved, profile }) => {
    const toast = useToast();
    const [rows, setRows] = useState<TierRow[]>(pair.tiers ?? []);
    const [saving, setSaving] = useState(false);

    const setRow = (i: number, patch: Partial<TierRow>) => {
        setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
    };
    const addRow = () => {
        const last = rows[rows.length - 1];
        const from = last?.to_usd ?? 0;
        setRows([...rows, { from_usd: from, to_usd: null, pct: 1 }]);
    };
    const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

    const [err, setErr] = useState<string | null>(null);

    const save = async () => {
        setSaving(true);
        setErr(null);
        const sorted = [...rows].sort((a, b) => a.from_usd - b.from_usd);
        const { error } = await ratesDb.from('fx_pair_config').upsert({
            from_currency: pair.from_currency,
            to_currency: pair.to_currency,
            base_fee_pct: pair.base_fee_pct,
            tiers: sorted,
            is_active: pair.is_active,
            updated_by: profile.id,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'from_currency,to_currency' });

        if (error) {
            const isMissingTable = /does not exist/i.test(error.message);
            const isRls = /row-level security|policy/i.test(error.message);
            setErr(
                isMissingTable
                    ? 'La tabla fx_pair_config NO existe. Corre la migración 2026_phase_7_fx_commissions.sql en Supabase.'
                    : isRls
                    ? 'RLS bloqueando. Corre 2026_fx_public_read.sql para permitir UPDATE a super_admin/treasury.'
                    : `Error: ${error.message}`,
            );
            setSaving(false);
            return;
        }

        await logAdminAction({ admin: profile, action: 'fx_tiers_update', targetType: 'fx_pair', targetId: pair.id ?? `${pair.from_currency}/${pair.to_currency}`, metadata: { pair: `${pair.from_currency}/${pair.to_currency}`, tiers: sorted } });
        toast.success(`✓ Tiers actualizados para ${pair.from_currency} → ${pair.to_currency}`);
        setSaving(false);
        onSaved();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                    <div>
                        <h3 className="font-bold text-lg" style={{ color: NAVY }}>
                            Tiers por volumen — {FLAGS[pair.from_currency]} {pair.from_currency} → {FLAGS[pair.to_currency]} {pair.to_currency}
                        </h3>
                        <p className="text-xs text-slate-500">
                            Comisión por tramos de volumen en USD. El % no cambia la tasa: define
                            cuánto recibe el cliente según el volumen de la operación.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
                </div>

                <div className="p-5">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs uppercase tracking-wider text-slate-500">
                                <th className="text-left pb-2 font-semibold">Desde (USD)</th>
                                <th className="text-left pb-2 font-semibold">Hasta (USD)</th>
                                <th className="text-left pb-2 font-semibold">Comisión %</th>
                                <th className="pb-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                    <td className="py-2 pr-2">
                                        <input
                                            type="number" min={0} inputMode="decimal"
                                            value={r.from_usd === 0 ? '' : r.from_usd}
                                            placeholder="0"
                                            onChange={e => {
                                                const v = e.target.value;
                                                setRow(i, { from_usd: v === '' ? 0 : Number(v) });
                                            }}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                                        />
                                    </td>
                                    <td className="py-2 pr-2">
                                        <input
                                            type="number" min={0} inputMode="decimal"
                                            value={r.to_usd ?? ''}
                                            placeholder="∞ (sin límite)"
                                            onChange={e => setRow(i, { to_usd: e.target.value === '' ? null : Number(e.target.value) })}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                                        />
                                    </td>
                                    <td className="py-2 pr-2">
                                        <input
                                            type="number" step="0.01" inputMode="decimal"
                                            value={r.pct === 0 ? '' : r.pct}
                                            placeholder="0"
                                            onChange={e => {
                                                const v = e.target.value;
                                                setRow(i, { pct: v === '' ? 0 : Number(v) });
                                            }}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                                        />
                                    </td>
                                    <td className="py-2 text-right">
                                        <button onClick={() => removeRow(i)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600">
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <button onClick={addRow} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-dashed border-slate-300 rounded-lg hover:bg-slate-50">
                        <Plus size={12} /> Añadir tier
                    </button>

                    <div className="mt-5 p-3 rounded-lg bg-slate-50 text-xs text-slate-600 leading-relaxed">
                        <strong>Lógica:</strong> al transaccionar, el sistema convierte el monto a USD usando la tasa actual y busca el tier
                        cuyo rango lo contenga (<code>from_usd ≤ monto &lt; to_usd</code>). El último tier deja <code>Hasta</code> vacío (sin límite superior).
                        Si la <strong>ventana nocturna</strong> está activa, se suma el % extra global.
                    </div>
                </div>

                {err && (
                    <div className="px-5 py-2.5 bg-red-50 border-t border-red-200 text-xs text-red-800 font-medium">
                        {err}
                    </div>
                )}
                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 sticky bottom-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button onClick={save} disabled={saving} style={{ backgroundColor: NAVY }} className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50">
                        {saving ? 'Guardando...' : 'Guardar tiers'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Card: salud del sistema FX (view fx_health_dashboard + controles)
// ─────────────────────────────────────────────
const fmtAge = (iso: string | null): string => {
    if (!iso) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 60) return `hace ${sec}s`;
    if (sec < 3600) return `hace ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `hace ${Math.floor(sec / 3600)} h`;
    return `hace ${Math.floor(sec / 86400)} d`;
};

// ─────────────────────────────────────────────
// Modal con gráfico histórico de un par.
// Lee fx_rate_snapshots ordenado por captured_at en el rango elegido y
// dibuja una curva SVG inline (sin libs extra). Muestra min/max/última y
// el badge de fuente de la última fila.
// ─────────────────────────────────────────────
const CHART_RANGES: Array<{ key: '24h' | '7d' | '30d'; label: string; hours: number }> = [
    { key: '24h', label: '24 h', hours: 24 },
    { key: '7d',  label: '7 días', hours: 24 * 7 },
    { key: '30d', label: '30 días', hours: 24 * 30 },
];

const RateChartModal: React.FC<{
    pair: PairConfig;
    onClose: () => void;
}> = ({ pair, onClose }) => {
    const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
    const [rows, setRows] = useState<Array<{ rate: number; captured_at: string; source: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hideOutliers, setHideOutliers] = useState(false);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [hoverY, setHoverY] = useState<number | null>(null);   // posición Y del cursor en coords SVG (para crosshair horizontal)
    const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            const hours = CHART_RANGES.find(r => r.key === range)?.hours ?? 24;
            const sinceISO = new Date(Date.now() - hours * 3600 * 1000).toISOString();
            // Hasta 3 intentos con backoff — en redes filtradas (proxys
            // corporativos) los fetch mueren al azar con "Failed to fetch".
            let lastErr: string | null = null;
            for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
                try {
                    const { data, error } = await ratesDb
                        .from('fx_rate_snapshots')
                        .select('rate, captured_at, source')
                        .eq('from_currency', pair.from_currency)
                        .eq('to_currency', pair.to_currency)
                        .gte('captured_at', sinceISO)
                        .order('captured_at', { ascending: true })
                        .limit(2000);
                    if (cancelled) return;
                    if (!error) {
                        setRows((data ?? []) as any);
                        setError(null);
                        setLoading(false);
                        return;
                    }
                    lastErr = error.message;
                } catch (e: any) {
                    lastErr = String(e?.message ?? e);
                }
                await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
            }
            if (cancelled) return;
            setError(lastErr ?? 'Sin conexión');
            setRows([]);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [pair.from_currency, pair.to_currency, range, reloadKey]);

    // Geometría del SVG.
    // PADL ancho para acomodar etiquetas de eje Y con miles ("1,022.1700" ≈ 60px
    // a 10px monospace). PADR ancho para la pill del "last price" a la derecha.
    const W = 760, H = 280, PADL = 76, PADR = 72, PADT = 16, PADB = 36;
    const PRICE_LABEL_W = 60;
    const innerW = W - PADL - PADR;
    const innerH = H - PADT - PADB;

    // El gráfico solo refleja la curva de FastForex (cron oficial). Manual y
    // legacy (FAWAZ/CURRENCYFREAKS/XE) se descartan: si el admin sobreescribió
    // un par a mano, lo ve en la tabla principal, pero el chart muestra el
    // mercado puro para que no se mezcle con dedazos.
    const filteredBySource = rows.filter(r => String(r.source ?? '').toUpperCase() === 'FASTFOREX');

    // ── Bucketización ──
    // El cron escribe ~1 fila por minuto por par → 24h trae ~400-500 puntos
    // con ruido vertical. Agrupamos por bucket temporal y nos quedamos con el
    // ÚLTIMO valor del bucket (refleja "tasa publicada al cierre del intervalo"):
    //   24h → 5 min  (288 buckets máx)
    //   7d  → 1 hora (168 buckets máx)
    //   30d → 6 horas (120 buckets máx)
    const bucketMs = range === '24h' ? 5 * 60 * 1000
                  : range === '7d'  ? 60 * 60 * 1000
                  :                    6 * 60 * 60 * 1000;
    type Candle = {
        bucketStart: number;
        open: number; high: number; low: number; close: number;
        // Para compat con código que ya usaba `rate`/`captured_at`/`source`:
        rate: number;             // = close
        captured_at: string;      // momento del close
        source: string;           // source del close
    };
    const bucketedAll: Candle[] = (() => {
        const buckets = new Map<number, { firstT: number; lastT: number; open: number; high: number; low: number; close: number; captured_at: string; source: string }>();
        for (const r of filteredBySource) {
            const t = new Date(r.captured_at).getTime();
            if (!isFinite(t)) continue;
            const v = Number(r.rate);
            if (!isFinite(v) || v <= 0) continue;
            const bucketStart = Math.floor(t / bucketMs) * bucketMs;
            const prev = buckets.get(bucketStart);
            if (!prev) {
                buckets.set(bucketStart, { firstT: t, lastT: t, open: v, high: v, low: v, close: v, captured_at: r.captured_at, source: r.source });
            } else {
                if (t < prev.firstT) { prev.firstT = t; prev.open  = v; }
                if (t > prev.lastT)  { prev.lastT  = t; prev.close = v; prev.captured_at = r.captured_at; prev.source = r.source; }
                if (v > prev.high) prev.high = v;
                if (v < prev.low)  prev.low  = v;
            }
        }
        return Array.from(buckets.entries())
            .map(([bucketStart, b]): Candle => ({
                bucketStart,
                open: b.open, high: b.high, low: b.low, close: b.close,
                rate: b.close, captured_at: b.captured_at, source: b.source,
            }))
            .sort((a, b) => a.bucketStart - b.bucketStart);
    })();

    // (2) Quitar atípicos por IQR (Q1 - 1.5·IQR, Q3 + 1.5·IQR). Útil cuando un
    //     dedazo manual mete 2020 entre miles de filas normales en ~1020.
    const bucketed = (() => {
        if (!hideOutliers || bucketedAll.length < 4) return bucketedAll;
        const sorted = bucketedAll.map(b => b.rate).slice().sort((a, b) => a - b);
        const q = (p: number) => {
            const idx = (sorted.length - 1) * p;
            const lo = Math.floor(idx), hi = Math.ceil(idx);
            return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
        };
        const Q1 = q(0.25), Q3 = q(0.75);
        const IQR = Q3 - Q1;
        const lo = Q1 - 1.5 * IQR;
        const hi = Q3 + 1.5 * IQR;
        return bucketedAll.filter(b => b.rate >= lo && b.rate <= hi);
    })();
    const outliersDropped = bucketedAll.length - bucketed.length;

    const values = bucketed.map(b => b.rate);
    const hasData = values.length >= 2;
    // En modo velas el rango Y necesita cubrir high/low de TODAS las velas,
    // no solo el close (sino los wicks se salen del área).
    const minV = hasData ? Math.min(...bucketed.map(b => b.low))  : 0;
    const maxV = hasData ? Math.max(...bucketed.map(b => b.high)) : 1;
    const spanV = (maxV - minV) || (maxV * 0.001 || 1);
    const minT = hasData ? bucketed[0].bucketStart : 0;
    const maxT = hasData ? bucketed[bucketed.length - 1].bucketStart : 1;
    const spanT = (maxT - minT) || 1;

    const xOf = (t: number) => PADL + ((t - minT) / spanT) * innerW;
    const yOf = (v: number) => PADT + (1 - (v - minV) / spanV) * innerH;

    const path = hasData
        ? bucketed.reduce((acc, b, i) => {
            const x = xOf(b.bucketStart);
            const y = yOf(b.rate);
            return acc + `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
        }, '').trim()
        : '';
    const areaPath = hasData
        ? `${path} L${xOf(maxT).toFixed(2)},${H - PADB} L${xOf(minT).toFixed(2)},${H - PADB} Z`
        : '';

    // Eje Y: 5 ticks
    const yTicks = hasData
        ? Array.from({ length: 5 }, (_, i) => minV + (spanV * (4 - i)) / 4)
        : [];
    // Eje X: 6 ticks equiespaciados con timestamps de cada bucket.
    const xTicks = hasData
        ? Array.from({ length: 6 }, (_, i) => minT + (spanT * i) / 5)
        : [];
    const formatXLabel = (t: number) => {
        const d = new Date(t);
        if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (range === '7d')  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    const last = bucketed[bucketed.length - 1];
    const first = bucketed[0];
    // OHLC mostrado en el header: si hay hover, el de la vela bajo el cursor;
    // si no, el de la última vela (estilo TradingView).
    const ohlc = hoverIdx !== null && bucketed[hoverIdx] ? bucketed[hoverIdx] : last;
    const delta = first && last ? Number(last.rate) - Number(first.rate) : 0;
    const deltaPct = first && Number(first.rate) > 0 ? (delta / Number(first.rate)) * 100 : 0;
    const deltaUp = delta >= 0;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold" style={{ color: NAVY }}>
                            {pair.from_currency} → {pair.to_currency}
                        </h3>
                        {hasData && (
                            <p className="text-xs text-slate-500 font-mono">
                                <span className="text-slate-400">O</span> {fmtRate(ohlc.open)}{' '}
                                <span className="text-slate-400">H</span> {fmtRate(ohlc.high)}{' '}
                                <span className="text-slate-400">L</span> {fmtRate(ohlc.low)}{' '}
                                <span className="text-slate-400">C</span> {fmtRate(ohlc.close)}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                        <X size={18} />
                    </button>
                </div>

                {/* Controles + estadísticas */}
                <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-1">
                            {CHART_RANGES.map(r => (
                                <button
                                    key={r.key}
                                    onClick={() => { setRange(r.key); setHoverIdx(null); }}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${range === r.key ? 'bg-[#0F172A]' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                                >
                                    {r.label}
                                </button>
                            ))}
                            <span className="w-px h-5 bg-slate-300 mx-1" />
                            <button
                                onClick={() => setChartType('candles')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${chartType === 'candles' ? 'bg-[#0F172A]' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                                title="Velas OHLC"
                            >
                                Velas
                            </button>
                            <button
                                onClick={() => setChartType('line')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${chartType === 'line' ? 'bg-[#0F172A]' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                                title="Línea (cierre)"
                            >
                                Línea
                            </button>
                        </div>
                        {hasData && (
                            <div className="flex items-center gap-4 text-xs">
                                <div>
                                    <span className="text-slate-500">Última: </span>
                                    <span className="font-bold text-slate-900">{fmtRate(Number(last.rate))}</span>
                                </div>
                                <div>
                                    <span className="text-slate-500">Mín / Máx: </span>
                                    <span className="font-mono text-slate-700">{fmtRate(minV)} / {fmtRate(maxV)}</span>
                                </div>
                                <div className={`inline-flex items-center gap-1 font-bold ${deltaUp ? 'text-emerald-700' : 'text-red-600'}`}>
                                    {deltaUp ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(2)}%
                                </div>
                            </div>
                        )}
                    </div>
                    {/* Filtros: solo outliers (la fuente queda fija a FastForex) */}
                    <div className="flex items-center justify-end flex-wrap gap-2 text-[11px]">
                        <label className="inline-flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={hideOutliers}
                                onChange={e => { setHideOutliers(e.target.checked); setHoverIdx(null); }}
                                className="rounded"
                            />
                            <span>Quitar atípicos (IQR)</span>
                            {hideOutliers && outliersDropped > 0 && (
                                <span className="text-amber-700 font-bold">−{outliersDropped}</span>
                            )}
                        </label>
                    </div>
                </div>

                {/* Chart */}
                <div className="p-6 flex-1 overflow-auto">
                    {loading && (
                        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
                            Cargando historial…
                        </div>
                    )}
                    {!loading && error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800 flex items-center justify-between gap-3 flex-wrap">
                            <span>Error leyendo fx_rate_snapshots: {error}</span>
                            <button
                                onClick={() => setReloadKey(k => k + 1)}
                                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 shrink-0"
                            >
                                Reintentar
                            </button>
                        </div>
                    )}
                    {!loading && !error && !hasData && (
                        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
                            No hay suficientes datos en este rango.
                        </div>
                    )}
                    {!loading && !error && hasData && (
                        <div className="relative">
                        <svg
                            viewBox={`0 0 ${W} ${H}`}
                            className="w-full h-auto select-none"
                            preserveAspectRatio="xMidYMid meet"
                            onMouseMove={e => {
                                const svg = e.currentTarget;
                                const rect = svg.getBoundingClientRect();
                                const xPct = (e.clientX - rect.left) / rect.width;
                                const yPct = (e.clientY - rect.top)  / rect.height;
                                const xInSvg = xPct * W;
                                const yInSvg = yPct * H;
                                if (xInSvg < PADL || xInSvg > W - PADR) { setHoverIdx(null); setHoverY(null); return; }
                                const tAtX = minT + ((xInSvg - PADL) / innerW) * spanT;
                                let bestIdx = 0;
                                let bestDist = Infinity;
                                for (let i = 0; i < bucketed.length; i++) {
                                    const dist = Math.abs(bucketed[i].bucketStart - tAtX);
                                    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                                }
                                setHoverIdx(bestIdx);
                                setHoverY(Math.max(PADT, Math.min(H - PADB, yInSvg)));
                            }}
                            onMouseLeave={() => { setHoverIdx(null); setHoverY(null); }}
                        >
                            {/* Grid horizontal + eje Y */}
                            {yTicks.map((v, i) => {
                                const y = PADT + (i * innerH) / 4;
                                return (
                                    <g key={i}>
                                        <line x1={PADL} y1={y} x2={W - PADR} y2={y} stroke="#e2e8f0" strokeDasharray="2,3" />
                                        <text x={PADL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#64748b" fontFamily="monospace">
                                            {fmtRate(v)}
                                        </text>
                                    </g>
                                );
                            })}
                            {/* Eje X: 6 ticks equiespaciados con tick mark vertical */}
                            {xTicks.map((t, i) => {
                                const x = xOf(t);
                                const anchor = i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
                                return (
                                    <g key={`xt-${i}`}>
                                        <line x1={x} y1={H - PADB} x2={x} y2={H - PADB + 4} stroke="#cbd5e1" />
                                        <text x={x} y={H - PADB + 16} textAnchor={anchor} fontSize="10" fill="#64748b">
                                            {formatXLabel(t)}
                                        </text>
                                    </g>
                                );
                            })}

                            {chartType === 'line' && (
                                <>
                                    {/* Área sombreada */}
                                    <path d={areaPath} fill={TEAL} opacity="0.12" />
                                    {/* Línea */}
                                    <path d={path} stroke={TEAL} strokeWidth="2" fill="none" />
                                    {/* Punto final */}
                                    <circle cx={xOf(last.bucketStart)} cy={yOf(last.rate)} r="4" fill={TEAL} stroke="white" strokeWidth="2" />
                                </>
                            )}

                            {chartType === 'candles' && (() => {
                                // Ancho de cada vela en px del viewBox.
                                const slot = innerW / Math.max(1, bucketed.length);
                                const bodyW = Math.max(1.5, Math.min(10, slot * 0.7));
                                return bucketed.map((c, i) => {
                                    const cx = xOf(c.bucketStart);
                                    const yHigh = yOf(c.high);
                                    const yLow  = yOf(c.low);
                                    const yOpen  = yOf(c.open);
                                    const yClose = yOf(c.close);
                                    const up = c.close >= c.open;
                                    const color = up ? '#16a34a' : '#dc2626';   // emerald-600 / red-600
                                    const bodyTop  = Math.min(yOpen, yClose);
                                    const bodyH    = Math.max(1, Math.abs(yClose - yOpen));
                                    return (
                                        <g key={`c-${i}`}>
                                            {/* Mecha (high-low) */}
                                            <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth="1" />
                                            {/* Cuerpo (open-close) */}
                                            <rect
                                                x={cx - bodyW / 2}
                                                y={bodyTop}
                                                width={bodyW}
                                                height={bodyH}
                                                fill={color}
                                                stroke={color}
                                            />
                                        </g>
                                    );
                                });
                            })()}

                            {/* Línea horizontal del último cierre (estilo "last price" de TradingView) */}
                            <line
                                x1={PADL} x2={W - PADR}
                                y1={yOf(last.rate)} y2={yOf(last.rate)}
                                stroke={last.close >= last.open ? '#16a34a' : '#dc2626'}
                                strokeOpacity="0.4"
                                strokeDasharray="2,3"
                            />
                            <rect
                                x={W - PADR + 2}
                                y={yOf(last.rate) - 8}
                                width={PRICE_LABEL_W}
                                height={16}
                                rx={3}
                                fill={last.close >= last.open ? '#16a34a' : '#dc2626'}
                            />
                            <text
                                x={W - PADR + 2 + PRICE_LABEL_W / 2}
                                y={yOf(last.rate) + 3}
                                textAnchor="middle"
                                fontSize="10"
                                fill="white"
                                fontFamily="monospace"
                            >
                                {fmtRate(last.rate)}
                            </text>

                            {/* Crosshair (vertical + horizontal) cuando hay hover */}
                            {hoverIdx !== null && bucketed[hoverIdx] && (
                                <g pointerEvents="none">
                                    <line
                                        x1={xOf(bucketed[hoverIdx].bucketStart)}
                                        y1={PADT}
                                        x2={xOf(bucketed[hoverIdx].bucketStart)}
                                        y2={H - PADB}
                                        stroke="#0F172A"
                                        strokeOpacity="0.35"
                                        strokeDasharray="3,3"
                                    />
                                    {hoverY !== null && (
                                        <>
                                            <line
                                                x1={PADL} x2={W - PADR}
                                                y1={hoverY} y2={hoverY}
                                                stroke="#0F172A"
                                                strokeOpacity="0.35"
                                                strokeDasharray="3,3"
                                            />
                                            {/* Etiqueta de precio en eje Y a la altura del cursor */}
                                            <rect x={PADL - PRICE_LABEL_W - 4} y={hoverY - 8} width={PRICE_LABEL_W} height={16} rx={3} fill="#0F172A" />
                                            <text x={PADL - 6} y={hoverY + 3} textAnchor="end" fontSize="10" fill="white" fontFamily="monospace">
                                                {fmtRate(minV + (1 - (hoverY - PADT) / innerH) * spanV)}
                                            </text>
                                        </>
                                    )}
                                    {/* Etiqueta de fecha en eje X al centro de la vela hover */}
                                    <rect x={xOf(bucketed[hoverIdx].bucketStart) - 38} y={H - PADB + 2} width={76} height={16} fill="#0F172A" />
                                    <text x={xOf(bucketed[hoverIdx].bucketStart)} y={H - PADB + 13} textAnchor="middle" fontSize="10" fill="white">
                                        {formatXLabel(bucketed[hoverIdx].bucketStart)}
                                    </text>
                                    {chartType === 'line' && (
                                        <circle
                                            cx={xOf(bucketed[hoverIdx].bucketStart)}
                                            cy={yOf(bucketed[hoverIdx].rate)}
                                            r="5"
                                            fill="white"
                                            stroke={TEAL}
                                            strokeWidth="2.5"
                                        />
                                    )}
                                </g>
                            )}
                        </svg>
                        {/* Tooltip flotante (HTML, posicionado por %) */}
                        {hoverIdx !== null && bucketed[hoverIdx] && (() => {
                            const hb = bucketed[hoverIdx];
                            const xPct = ((xOf(hb.bucketStart) / W) * 100);
                            const flipLeft = xPct > 65;
                            return (
                                <div
                                    className="absolute top-2 bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none"
                                    style={{
                                        left:  flipLeft ? 'auto' : `calc(${xPct}% + 12px)`,
                                        right: flipLeft ? `calc(${100 - xPct}% + 12px)` : 'auto',
                                    }}
                                >
                                    <div className="font-bold text-slate-900 font-mono">{fmtRate(hb.rate)}</div>
                                    <div className="text-slate-500">{new Date(hb.captured_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
                                        {SOURCE_LABEL[String(hb.source ?? '').toUpperCase()] ?? hb.source ?? '—'}
                                    </div>
                                </div>
                            );
                        })()}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between flex-wrap gap-2">
                    <span>
                        {bucketed.length} puntos · agrupados {range === '24h' ? 'por 5 min' : range === '7d' ? 'por hora' : 'por 6 h'} ·
                        {' '}{rows.length} filas en {CHART_RANGES.find(r => r.key === range)?.label}
                    </span>
                    {hasData && (
                        <span>
                            Última fuente:&nbsp;
                            <b className="text-slate-700">{(SOURCE_LABEL[String(last.source ?? '').toUpperCase()] ?? last.source ?? '—')}</b>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

// Labels human-readable para cada source. Solo FastForex (API primaria) y Manual.
const SOURCE_LABEL: Record<string, string> = {
    FASTFOREX: 'FastForex',
    MANUAL:    'Tasa Manual',
};

const SOURCE_BADGE: Record<string, { bg: string; text: string; border: string }> = {
    FASTFOREX: { bg: 'bg-teal-50',   text: 'text-teal-800',  border: 'border-teal-300' },
    MANUAL:    { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
};

const FxHealthCard: React.FC<{
    health: FxHealth | null;
    onForceSync: () => void;
    forcing: boolean;
    onChangeSource: (s: 'FASTFOREX' | 'MANUAL') => void | Promise<void>;
    onToggleFallback: (enabled: boolean) => void;
    canManage: boolean;
}> = ({ health, onForceSync, forcing, onChangeSource, onToggleFallback, canManage }) => {
    // Dropdown con confirmación explícita: el cambio se queda como "pendiente"
    // hasta que el admin pulsa Guardar. Sin esto el cambio se persistía en background
    // y, si la UPDATE a xe_config fallaba silenciosamente (RLS, fila sin id=1, etc.),
    // al recargar volvía al valor anterior sin aviso.
    const [pendingSrc, setPendingSrc] = useState<string | null>(null);
    const [savingSrc,  setSavingSrc]  = useState(false);
    useEffect(() => { setPendingSrc(null); }, [health?.preferred_source]);
    const dbSource = String(health?.preferred_source ?? 'FASTFOREX').toUpperCase();
    const hasPendingChange = pendingSrc !== null && pendingSrc.toUpperCase() !== dbSource;

    if (!health) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <p className="text-sm text-slate-500">
                    Cargando salud del sistema FX…
                    <span className="block text-[11px] mt-1 text-slate-400">
                        Si esto no carga, falta correr la migración <code>0023_fx_error_tracking_and_source.sql</code> que crea la view <code>fx_health_dashboard</code>.
                    </span>
                </p>
            </div>
        );
    }

    const failures = Number(health.consecutive_failures) || 0;
    const healthy = failures === 0;
    const broken  = failures > 3;
    const statusColor = broken ? 'bg-red-500' : healthy ? 'bg-emerald-500' : 'bg-amber-500';
    const statusLabel = broken ? 'Sistema con fallas' : healthy ? 'Sistema Operativo' : 'Funcionando con errores';
    const statusBg = broken ? 'bg-red-50 border-red-200' : healthy ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200';
    const preferredSource = (pendingSrc ?? String(health.preferred_source ?? 'FASTFOREX')).toUpperCase();
    const srcBadge = SOURCE_BADGE[preferredSource] ?? SOURCE_BADGE.MANUAL;

    return (
        <div className={`rounded-2xl border-2 ${statusBg} shadow-sm overflow-hidden`}>
            {/* Header: estado + fuente actual + forzar sync */}
            <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-3 border-b border-slate-200/60">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${statusColor} ${healthy ? 'animate-pulse' : ''}`} />
                        <span className="font-bold text-sm" style={{ color: NAVY }}>{statusLabel}</span>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${srcBadge.bg} ${srcBadge.text} ${srcBadge.border}`}>
                        <Wifi size={10} /> {SOURCE_LABEL[preferredSource] ?? preferredSource}
                    </span>
                </div>
                <button
                    onClick={onForceSync}
                    disabled={forcing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-300 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                    <RefreshCw size={12} className={forcing ? 'animate-spin' : ''} />
                    {forcing ? 'Sincronizando…' : 'Forzar sync ahora'}
                </button>
            </div>

            {/* Métricas y error */}
            <div className="px-5 py-3 space-y-2 bg-white">
                <div className="flex items-center justify-between flex-wrap gap-3 text-xs">
                    <span className="text-slate-600">Última sync: <b className="text-slate-900">{fmtAge(health.last_sync_at)}</b></span>
                    <span className="text-slate-600">
                        Últimas 24 h →
                        <b className="ml-1.5 text-teal-700">FF: {health.ff_snapshots_24h ?? 0}</b>
                        {typeof health.manual_snapshots_24h === 'number' && (
                            <>
                                <span className="text-slate-400 mx-1">·</span>
                                <b className="text-slate-700">Manual: {health.manual_snapshots_24h}</b>
                            </>
                        )}
                    </span>
                </div>

                {(health.last_error || (health.consecutive_failures ?? 0) > 0) && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-800">
                        <div className="font-bold flex items-center gap-1.5 mb-0.5">
                            <AlertCircle size={12} /> {health.consecutive_failures ?? 0} falla{(health.consecutive_failures ?? 0) === 1 ? '' : 's'} consecutiva{(health.consecutive_failures ?? 0) === 1 ? '' : 's'}
                        </div>
                        {health.last_error && <p className="break-words">{health.last_error}</p>}
                        {health.last_error_at && <p className="text-[10px] mt-0.5 opacity-70">{fmtAge(health.last_error_at)}</p>}
                    </div>
                )}

            </div>

            {/* Controles */}
            {canManage && (
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-200/60 flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                        <span className="font-semibold text-slate-700">Fuente preferida:</span>
                        <select
                            value={preferredSource}
                            onChange={e => setPendingSrc(e.target.value)}
                            disabled={savingSrc}
                            className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold disabled:opacity-60"
                        >
                            <option value="FASTFOREX">FastForex</option>
                            <option value="MANUAL">Manual</option>
                        </select>
                        {hasPendingChange && (
                            <>
                                <button
                                    onClick={async () => {
                                        if (!pendingSrc) return;
                                        setSavingSrc(true);
                                        try { await onChangeSource(pendingSrc as any); }
                                        finally { setSavingSrc(false); }
                                    }}
                                    disabled={savingSrc}
                                    className="px-3 py-1 rounded-lg bg-[#2DD4BF] text-[#0F172A] text-xs font-bold hover:bg-[#14B8A6] disabled:opacity-60"
                                >
                                    {savingSrc ? 'Guardando…' : 'Guardar'}
                                </button>
                                <button
                                    onClick={() => setPendingSrc(null)}
                                    disabled={savingSrc}
                                    className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                                >
                                    Cancelar
                                </button>
                            </>
                        )}
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <span className="font-semibold text-slate-700">Fallback automático:</span>
                        <button
                            onClick={() => onToggleFallback(!Boolean(health.fallback_enabled))}
                            className={`relative inline-block w-9 h-5 rounded-full transition-colors ${health.fallback_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                            aria-label="Toggle fallback"
                        >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${health.fallback_enabled ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                        <span className="text-slate-500">{health.fallback_enabled ? 'Sí' : 'No'}</span>
                    </label>
                </div>
            )}
        </div>
    );
};
