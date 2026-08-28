import React, { useEffect, useMemo, useState } from 'react';
import {
    BookOpen, DollarSign, ArrowLeft, RefreshCw, FileText, TrendingUp,
    Search, Settings, Save, ChevronDown, ChevronUp, Wallet, Download,
    CalendarDays, BarChart3,
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import {
    canSeeTransaction, type AdminProfile, type AssignedCurrency,
} from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { SectionHeader, NAVY, formatDate, EmptyState } from './shared';

// ─────────────────────────────────────────────
// AccountingSection — Contabilidad por país con costo operativo por par.
//
// Schema real (verificado vía SQL Editor jun-2026):
//   • transactions.currency       → moneda origen (alias from_currency)
//   • transactions.dest_currency  → moneda destino (alias to_currency)
//   • transactions.fee            → numeric, EN LA MONEDA DE ORIGEN
//                                   (NO en USD — hay que convertir)
//   No existe `fee_usd` en el schema actual; se mantiene como fallback
//   por si en el futuro se agrega una columna ya normalizada.
//
// Reglas de negocio (v3 jul-2026):
//   1. T = fee del cliente EN SU MONEDA DE ORIGEN (sin convertir a USD).
//   2. C = fx_pair_costs.cost_usd (pasado a moneda local) + cost_pct% × T.
//   3. La comisión (T − C) es COMPLETA del país EMISOR — donde se le
//      descontó al cliente (COP→PEN: la comisión es de Colombia, en COP).
//   4. El IVA del país emisor va INCLUIDO en la comisión:
//      IVA = base × tasa/(1+tasa) · neto = base/(1+tasa)
//   5. Utilidad por país = (T − C) − IVA incluido, en SU moneda.
//
// Ejemplo COP → PEN: comisión 200.000 COP, IVA CO 19%
//   IVA = 200.000×0.19/1.19 = 31.933 COP → Colombia neto 168.067 COP
// ─────────────────────────────────────────────

const IVA_RATES: Record<AssignedCurrency, number> = {
    COP: 0.19,  CLP: 0.19,  PEN: 0.18,  MXN: 0.16,  BRL: 0.17,
};

// USD por unidad de cada moneda LATAM (aproximado, jun-2026).
// v3: los montos ya NO se convierten a USD — todo se muestra en la moneda
// local del país emisor (donde se cobró la comisión). Este mapa solo se
// usa para pasar el costo operativo (fx_pair_costs.cost_usd, que está en
// USD) a la moneda local.
const USD_PER_UNIT: Record<AssignedCurrency, number> = {
    COP: 1 / 4000,    // 4.000 COP ≈ 1 USD
    CLP: 1 / 950,     // 950 CLP ≈ 1 USD
    PEN: 1 / 3.7,     // 3.7 PEN ≈ 1 USD
    MXN: 1 / 17,      // 17 MXN ≈ 1 USD
    BRL: 1 / 5.5,     // 5.5 BRL ≈ 1 USD
};

// Formato local: COP/CLP sin decimales, el resto con 2.
const NO_DECIMALS = new Set(['COP', 'CLP']);
const fmtLocal = (v: number, cur: string | null | undefined): string => {
    const c = (cur ?? '').toUpperCase();
    const dec = NO_DECIMALS.has(c) ? 0 : 2;
    return `${c ? c + ' ' : ''}${v.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
};

const COUNTRY_BY_CURRENCY: Record<AssignedCurrency, { code: string; name: string; flag: string }> = {
    COP: { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
    CLP: { code: 'CL', name: 'Chile',    flag: '🇨🇱' },
    PEN: { code: 'PE', name: 'Perú',     flag: '🇵🇪' },
    MXN: { code: 'MX', name: 'México',   flag: '🇲🇽' },
    BRL: { code: 'BR', name: 'Brasil',   flag: '🇧🇷' },
};

interface TxRow {
    id: string;
    created_at: string;
    from_currency: string | null;
    to_currency: string | null;
    amount: number | null;
    dest_amount?: number | null;
    fee_usd?: number | null;
    fee?: number | null;
    commission?: number | null;
    commission_usd?: number | null;
    status: string | null;
}

// Normaliza un row crudo de transactions al shape canónico que usa el
// componente. El schema real expone `currency` + `dest_currency`, pero
// preferimos `from_currency` + `to_currency` en el código para que
// canSeeTransaction y el split funcionen sin if/else. Si la fila ya
// viene con los nombres canónicos (deploys más nuevos), pass-through.
function normalizeTx(raw: any): TxRow {
    const rd = raw.raw_data ?? {};
    // Monto de SALIDA (lo entregado en moneda destino): la columna varía
    // por deploy; probamos las conocidas y caemos a raw_data.
    const destAmount = Number(
        raw.dest_amount ?? raw.to_amount ?? raw.destination_amount ??
        raw.amount_out ?? raw.received_amount ??
        rd.destAmount ?? rd.dest_amount ?? rd.toAmount ?? rd.to_amount ??
        rd.receivedAmount ?? rd.convertedAmount ?? rd.converted_amount ?? 0
    );
    return {
        ...raw,
        from_currency: raw.from_currency ?? raw.currency ?? null,
        to_currency:   raw.to_currency   ?? raw.dest_currency ?? null,
        dest_amount:   Number.isFinite(destAmount) && destAmount > 0 ? destAmount : null,
    };
}

interface PairCost {
    cost_usd: number;
    cost_pct: number;
    notes?: string | null;
}

type PairCostMap = Record<string, PairCost>;  // key = "FROM-TO"
const pairKey = (from: string, to: string) => `${from.toUpperCase()}-${to.toUpperCase()}`;

// Devuelve la comisión del cliente EN SU MONEDA DE ORIGEN (sin convertir).
// El schema real guarda `fee` en la moneda de origen — se usa tal cual.
// Si solo existiera fee_usd/commission_usd (en dólares), se convierte a
// la moneda local para mantener todo homogéneo.
function feeOf(tx: TxRow): number {
    const local = Number(tx.fee ?? tx.commission ?? 0);
    if (local > 0) return local;
    const usdDirect = Number(tx.fee_usd ?? tx.commission_usd ?? 0);
    if (usdDirect > 0) {
        const fc = (tx.from_currency ?? '').toUpperCase() as AssignedCurrency;
        const perUnit = USD_PER_UNIT[fc];
        return perUnit ? usdDirect / perUnit : 0;
    }
    return 0;
}

// Costo operativo EN MONEDA LOCAL del emisor: cost_usd (USD) convertido +
// cost_pct% sobre la comisión local.
function effectiveCost(fee: number, pc: PairCost | undefined, fromCur: AssignedCurrency | string): number {
    if (!pc) return 0;
    const perUnit = USD_PER_UNIT[(fromCur ?? '').toUpperCase() as AssignedCurrency];
    const fixedLocal = perUnit ? (Number(pc.cost_usd) || 0) / perUnit : 0;
    return fixedLocal + ((Number(pc.cost_pct) || 0) / 100) * fee;
}

interface SplitResult {
    total: number;            // T — comisión cliente
    opCost: number;           // C — costo operativo del par
    netForSplit: number;      // T − C, base para split
    fromCurrency: AssignedCurrency | null;
    toCurrency:   AssignedCurrency | null;
    fromShare: number;        // (T−C)/2 país emisor
    toShare:   number;        // (T−C)/2 país receptor
    ivaRate:   number;
    ivaAmount: number;
    fromNet:   number;
    toNet:     number;
    netCompany: number;       // T − C − IVA
}

// REGLA (jul-2026, definida por Bryan): la comisión COMPLETA es del país
// EMISOR — donde se le descontó al cliente (BRL→COP: la comisión quedó en
// BRL, es de Brasil). No hay split 50/50. El IVA del país emisor va
// INCLUIDO dentro de la comisión (el 4% ya lo trae), así que se extrae:
//   IVA incluido = base × tasa/(1+tasa)   ·   neto = base/(1+tasa)
// Ejemplo COP 19%: comisión $200.000 → IVA $31.933, neto $168.067.
function splitCommission(tx: TxRow, costs: PairCostMap): SplitResult {
    const total = feeOf(tx);
    const fc = (tx.from_currency ?? '').toUpperCase() as AssignedCurrency;
    const tc = (tx.to_currency   ?? '').toUpperCase() as AssignedCurrency;
    const isFromKnown = fc in IVA_RATES;
    const isToKnown   = tc in IVA_RATES;
    const opCost = effectiveCost(total, costs[pairKey(fc, tc)], fc);
    const base = Math.max(0, total - opCost);   // comisión del EMISOR post costo op. (moneda local)
    const ivaRate = isFromKnown ? IVA_RATES[fc] : 0;
    const ivaAmount = base * (ivaRate / (1 + ivaRate));   // IVA incluido en la comisión
    return {
        total,
        opCost,
        netForSplit: base,
        fromCurrency: isFromKnown ? fc : null,
        toCurrency:   isToKnown   ? tc : null,
        fromShare: base,   // todo para el emisor
        toShare:   0,      // el receptor no participa de la comisión
        ivaRate,
        ivaAmount,
        fromNet:   base - ivaAmount,
        toNet:     0,
        netCompany: base - ivaAmount,
    };
}

interface CountryAggregate {
    currency: AssignedCurrency;
    grossFromOrigin: number;
    grossFromDest:   number;
    ivaPaid:         number;
    opCostShare:     number;   // mitad del costo operativo asignada a este país
    netReceived:     number;
    txCountOrigin:   number;
    txCountDest:     number;
}

interface Props {
    profile: AdminProfile;
}

export const AccountingSection: React.FC<Props> = ({ profile }) => {
    const [txs, setTxs]         = useState<TxRow[]>([]);
    const [costs, setCosts]     = useState<PairCostMap>({});
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);
    const [drill, setDrill]     = useState<AssignedCurrency | null>(null);
    const [period, setPeriod]   = useState<'7d' | '30d' | '90d' | 'all'>('30d');
    const [showCosts, setShowCosts] = useState(false);

    const canEditCosts = profile.role === 'super_admin' || profile.role === 'treasury';

    const loadCosts = async () => {
        const { data, error: err } = await supabasePersonas
            .from('fx_pair_costs').select('from_currency, to_currency, cost_usd, cost_pct, notes').limit(1000);
        if (err) {
            // Tabla puede no existir todavía — no es fatal, los costos quedan en 0.
            console.warn('[Accounting] fx_pair_costs no disponible:', err.message);
            setCosts({});
            return;
        }
        const map: PairCostMap = {};
        for (const r of (data ?? []) as any[]) {
            map[pairKey(r.from_currency, r.to_currency)] = {
                cost_usd: Number(r.cost_usd) || 0,
                cost_pct: Number(r.cost_pct) || 0,
                notes: r.notes,
            };
        }
        setCosts(map);
    };

    const load = async () => {
        setLoading(true);
        setError(null);
        const since = (() => {
            if (period === 'all') return null;
            const d = new Date();
            const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
            d.setDate(d.getDate() - days);
            return d.toISOString();
        })();
        // SELECT con PostgREST aliasing: traemos `currency` como `from_currency`,
        // `dest_currency` como `to_currency`, y `fee` (en moneda origen — feeOf()
        // lo convierte a USD). El schema actual NO tiene `fee_usd`, así que no
        // lo pedimos para no romper el query con 42703.
        // raw_data viaja para poder extraer el monto de SALIDA (lo entregado
        // en moneda destino), que según el deploy vive en dest_amount o
        // dentro de raw_data (destAmount/convertedAmount/...).
        const cols = 'id, created_at, from_currency:currency, to_currency:dest_currency, amount, status, fee, raw_data';
        let q = supabasePersonas.from('transactions').select(cols).order('created_at', { ascending: false }).limit(2000);
        if (since) q = q.gte('created_at', since);
        let { data, error: err } = await q;
        if (err && /column .* does not exist/i.test(err.message)) {
            // Fallback: si el alias falló por alguna razón (ej. ya están
            // los nombres canónicos en la DB), traemos todo y normalizamos.
            let q2 = supabasePersonas.from('transactions').select('*').order('created_at', { ascending: false }).limit(2000);
            if (since) q2 = q2.gte('created_at', since);
            const r = await q2;
            data = r.data as any;
            err  = r.error;
        }
        if (err) {
            setError(err.message);
            setLoading(false);
            return;
        }
        // Normalizamos siempre — el aliasing puede no estar disponible y
        // queremos un shape consistente downstream.
        const normalized = ((data as any[]) ?? []).map(normalizeTx);
        const eligible = normalized.filter(t => {
            const s = String(t.status ?? '').toLowerCase();
            const isDone = s === 'completed' || s === 'approved' || s === 'success' || s === 'verified';
            const isFx = t.from_currency && t.to_currency && t.from_currency !== t.to_currency;
            return isDone && isFx && feeOf(t) > 0;
        });
        const scoped = eligible.filter(t => canSeeTransaction(profile, t as any));
        setTxs(scoped);
        setLoading(false);
    };

    useEffect(() => { loadCosts(); }, []);
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period]);

    const aggregates: Record<AssignedCurrency, CountryAggregate> = useMemo(() => {
        const init: any = {};
        (Object.keys(IVA_RATES) as AssignedCurrency[]).forEach(c => {
            init[c] = {
                currency: c, grossFromOrigin: 0, grossFromDest: 0,
                ivaPaid: 0, opCostShare: 0, netReceived: 0,
                txCountOrigin: 0, txCountDest: 0,
            };
        });
        for (const t of txs) {
            const s = splitCommission(t, costs);
            // v2: comisión y costo operativo COMPLETOS al país emisor
            if (s.fromCurrency) {
                const a = init[s.fromCurrency] as CountryAggregate;
                a.grossFromOrigin += s.fromShare;
                a.ivaPaid         += s.ivaAmount;
                a.opCostShare     += s.opCost;
                a.netReceived     += s.fromNet;
                a.txCountOrigin   += 1;
            }
            if (s.toCurrency) {
                const a = init[s.toCurrency] as CountryAggregate;
                a.txCountDest += 1;   // solo informativo: no recibe comisión
            }
        }
        return init;
    }, [txs, costs]);

    // v3: totales POR MONEDA — sin convertir a USD, cada país en la suya.
    const totalsByCur = useMemo(() => {
        const m: Record<string, { gross: number; iva: number; opCost: number; net: number; tx: number }> = {};
        for (const t of txs) {
            const s = splitCommission(t, costs);
            if (!s.fromCurrency) continue;
            const g = (m[s.fromCurrency] ??= { gross: 0, iva: 0, opCost: 0, net: 0, tx: 0 });
            g.gross  += s.total;
            g.iva    += s.ivaAmount;
            g.opCost += s.opCost;
            g.net    += s.netCompany;
            g.tx     += 1;
        }
        return m;
    }, [txs, costs]);
    const totals = useMemo(() => ({ txTotal: txs.length }), [txs]);

    // Mostramos TODOS los pares direccionales entre las monedas soportadas
    // (5 × 4 = 20), aunque no hayan tenido TX en el período. Así el admin
    // puede configurar el costo operativo de cualquier corredor por
    // adelantado. Se incluyen además los pares con TX/costo registrados
    // por si en el futuro hay monedas fuera de IVA_RATES.
    const visiblePairs = useMemo(() => {
        const set = new Set<string>();
        const currencies = Object.keys(IVA_RATES) as AssignedCurrency[];
        for (const from of currencies) {
            for (const to of currencies) {
                if (from !== to) set.add(pairKey(from, to));
            }
        }
        for (const t of txs) {
            const fc = (t.from_currency ?? '').toUpperCase();
            const tc = (t.to_currency ?? '').toUpperCase();
            if (fc && tc && fc !== tc) set.add(pairKey(fc, tc));
        }
        for (const k of Object.keys(costs)) set.add(k);
        return Array.from(set).sort();
    }, [txs, costs]);

    if (drill) {
        return (
            <CountryDrillDown
                currency={drill}
                txs={txs}
                costs={costs}
                onBack={() => setDrill(null)}
            />
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-4">
            <SectionHeader
                title="Contabilidad"
                subtitle="Utilidades por país · la comisión completa es del país emisor · IVA incluido en la comisión"
                right={
                    <div className="flex items-center gap-2">
                        <select
                            value={period}
                            onChange={e => setPeriod(e.target.value as any)}
                            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white"
                        >
                            <option value="7d">Últimos 7 días</option>
                            <option value="30d">Últimos 30 días</option>
                            <option value="90d">Últimos 90 días</option>
                            <option value="all">Todo el histórico</option>
                        </select>
                        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                    </div>
                }
            />

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
                    No pude cargar transacciones: {error}
                </div>
            )}

            {/* Card grande: utilidad de la empresa POR MONEDA (sin convertir a USD) */}
            <div className="rounded-2xl p-6" style={{ backgroundColor: NAVY }}>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-green-300">
                        Utilidad neta por moneda · la comisión queda donde se cobró
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                        <TrendingUp size={12} className="text-emerald-300" />
                        <span>TXs FX: <b className="text-white">{totals.txTotal}</b></span>
                    </div>
                </div>
                {Object.keys(totalsByCur).length === 0 ? (
                    <p className="text-sm text-slate-300">Sin comisiones FX en este período.</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.entries(totalsByCur).map(([cur, t]) => {
                            const c = COUNTRY_BY_CURRENCY[cur as AssignedCurrency];
                            return (
                                <div key={cur} className="rounded-xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                                    <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                                        {c?.flag ?? ''} {c?.name ?? cur} · {t.tx} TX
                                    </p>
                                    <p className="text-2xl font-bold text-white font-mono">{fmtLocal(t.net, cur)}</p>
                                    <div className="mt-1.5 space-y-0.5 text-[11px]">
                                        <div className="flex justify-between text-slate-300">
                                            <span>Brutos</span><span className="font-mono">{fmtLocal(t.gross, cur)}</span>
                                        </div>
                                        <div className="flex justify-between text-rose-300">
                                            <span>Costo op.</span><span className="font-mono">−{fmtLocal(t.opCost, cur)}</span>
                                        </div>
                                        <div className="flex justify-between text-amber-300">
                                            <span>IVA a pagar</span><span className="font-mono">−{fmtLocal(t.iva, cur)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Grid por país */}
            <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Utilidad por país
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(Object.keys(IVA_RATES) as AssignedCurrency[]).map(cur => {
                        const a = aggregates[cur];
                        const c = COUNTRY_BY_CURRENCY[cur];
                        const empty = a.txCountOrigin === 0 && a.txCountDest === 0;
                        return (
                            <button
                                key={cur}
                                onClick={() => setDrill(cur)}
                                disabled={empty}
                                className={`text-left bg-white rounded-2xl border p-4 transition-shadow ${empty ? 'border-slate-100 opacity-60' : 'border-slate-200 hover:shadow-md hover:border-green-300'}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-2xl">{c.flag}</span>
                                        <div>
                                            <p className="font-semibold text-sm" style={{ color: NAVY }}>{c.name}</p>
                                            <p className="text-[10px] text-slate-400 uppercase">{cur} · IVA {(IVA_RATES[cur] * 100).toFixed(0)}%</p>
                                        </div>
                                    </div>
                                    {!empty && (
                                        <span className="text-[10px] text-green-700 font-semibold">
                                            ver detalle →
                                        </span>
                                    )}
                                </div>
                                <p className="text-xl font-bold mt-2 font-mono" style={{ color: empty ? '#94A3B8' : '#065F46' }}>
                                    {fmtLocal(a.netReceived, cur)}
                                </p>
                                <div className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                                    <div className="flex justify-between">
                                        <span>Comisiones cobradas ({a.txCountOrigin})</span>
                                        <span className="font-mono">{fmtLocal(a.grossFromOrigin, cur)}</span>
                                    </div>
                                    <div className="flex justify-between text-rose-700">
                                        <span>− Costo operativo</span>
                                        <span className="font-mono">−{fmtLocal(a.opCostShare, cur)}</span>
                                    </div>
                                    <div className="flex justify-between text-amber-700">
                                        <span>− IVA a pagar</span>
                                        <span className="font-mono">−{fmtLocal(a.ivaPaid, cur)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-400">
                                        <span>Recibió envíos ({a.txCountDest})</span>
                                        <span className="font-mono">sin comisión</span>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Panel de costos operativos por par */}
            <div className="bg-white rounded-2xl border border-slate-200">
                <button
                    onClick={() => setShowCosts(!showCosts)}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl"
                >
                    <div className="flex items-center gap-2">
                        <Settings size={14} className="text-slate-500" />
                        <p className="font-semibold text-sm" style={{ color: NAVY }}>
                            Costos operativos por par FX
                        </p>
                        <span className="text-[10px] text-slate-400">
                            {Object.keys(costs).length} pares configurados
                        </span>
                    </div>
                    {showCosts ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </button>
                {showCosts && (
                    <CostsEditor
                        pairs={visiblePairs}
                        costs={costs}
                        canEdit={canEditCosts}
                        onSaved={loadCosts}
                    />
                )}
            </div>

            {!loading && totals.txTotal === 0 && (
                <EmptyState icon={BookOpen} title="Sin TX FX en este período" message="Cambiá el rango de fechas o esperá a que se generen transacciones FX completadas con comisión." />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// CostsEditor — tabla editable de costos operativos por par.
// Solo super_admin y treasury pueden guardar (RLS lo verifica también).
// ─────────────────────────────────────────────
const CostsEditor: React.FC<{
    pairs: string[];
    costs: PairCostMap;
    canEdit: boolean;
    onSaved: () => void;
}> = ({ pairs, costs, canEdit, onSaved }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [draft, setDraft] = useState<Record<string, PairCost>>(() => {
        const d: Record<string, PairCost> = {};
        for (const k of pairs) d[k] = costs[k] ?? { cost_usd: 0, cost_pct: 0 };
        return d;
    });
    const [saving, setSaving] = useState<string | null>(null);
    const [savedMsg, setSavedMsg] = useState<string | null>(null);
    const [addingPair, setAddingPair] = useState(false);
    const [newFrom, setNewFrom] = useState<AssignedCurrency>('COP');
    const [newTo, setNewTo]     = useState<AssignedCurrency>('BRL');

    useEffect(() => {
        setDraft(prev => {
            const next = { ...prev };
            for (const k of pairs) {
                if (!(k in next)) next[k] = costs[k] ?? { cost_usd: 0, cost_pct: 0 };
            }
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pairs.join(',')]);

    const saveOne = async (key: string) => {
        if (!canEdit) return;
        setSaving(key);
        setSavedMsg(null);
        const [from, to] = key.split('-');
        const d = draft[key] ?? { cost_usd: 0, cost_pct: 0 };
        const { error } = await supabasePersonas.from('fx_pair_costs').upsert({
            from_currency: from,
            to_currency:   to,
            cost_usd: Number(d.cost_usd) || 0,
            cost_pct: Number(d.cost_pct) || 0,
            notes:    d.notes ?? null,
        }, { onConflict: 'from_currency,to_currency' });
        setSaving(null);
        if (error) {
            await confirm({
                title: 'Error al guardar',
                message: `No pude guardar ${key}: ${error.message}`,
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
            return;
        }
        setSavedMsg(`✓ ${key} guardado`);
        onSaved();
        setTimeout(() => setSavedMsg(null), 2500);
    };

    const addPair = async () => {
        if (newFrom === newTo) {
            await confirm({
                title: 'Monedas inválidas',
                message: 'Las monedas deben ser distintas',
                variant: 'warning',
                alertOnly: true,
            });
            return;
        }
        const key = pairKey(newFrom, newTo);
        setDraft(prev => ({ ...prev, [key]: prev[key] ?? { cost_usd: 0, cost_pct: 0 } }));
        setAddingPair(false);
    };

    const renderedPairs = Object.keys(draft).sort();

    return (
        <div className="border-t border-slate-100 p-4 space-y-3">
            {confirmDialog}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-[11px] text-slate-600">
                    Por cada TX del par, el sistema descuenta <b>cost_usd</b> +
                    (<b>cost_pct%</b> × comisión del cliente) de la comisión antes
                    de calcular el neto del país emisor.
                </p>
                {canEdit && !addingPair && (
                    <button
                        onClick={() => setAddingPair(true)}
                        className="text-[11px] font-semibold text-green-700 hover:underline"
                    >
                        + Agregar par
                    </button>
                )}
            </div>

            {addingPair && (
                <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg flex-wrap">
                    <span className="text-xs font-semibold text-slate-700">Nuevo par:</span>
                    <select value={newFrom} onChange={e => setNewFrom(e.target.value as AssignedCurrency)} className="px-2 py-1 text-xs rounded border border-slate-200 bg-white">
                        {(Object.keys(IVA_RATES) as AssignedCurrency[]).map(c => <option key={c} value={c}>{COUNTRY_BY_CURRENCY[c].flag} {c}</option>)}
                    </select>
                    <span className="text-xs text-slate-500">→</span>
                    <select value={newTo} onChange={e => setNewTo(e.target.value as AssignedCurrency)} className="px-2 py-1 text-xs rounded border border-slate-200 bg-white">
                        {(Object.keys(IVA_RATES) as AssignedCurrency[]).map(c => <option key={c} value={c}>{COUNTRY_BY_CURRENCY[c].flag} {c}</option>)}
                    </select>
                    <button onClick={addPair} className="px-2 py-1 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700">Agregar</button>
                    <button onClick={() => setAddingPair(false)} className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancelar</button>
                </div>
            )}

            {savedMsg && (
                <div className="text-xs text-emerald-700 font-semibold">{savedMsg}</div>
            )}

            {renderedPairs.length === 0 && (
                <p className="text-xs text-slate-400 py-4 text-center">
                    Sin pares todavía. Agregá uno o esperá a que haya TXs FX en este período.
                </p>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="text-slate-500 uppercase tracking-wider">
                        <tr>
                            <th className="text-left py-2 px-2">Par</th>
                            <th className="text-right py-2 px-2">Costo fijo (USD)</th>
                            <th className="text-right py-2 px-2">% sobre comisión</th>
                            <th className="text-left py-2 px-2">Notas</th>
                            <th className="text-right py-2 px-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {renderedPairs.map(key => {
                            const [from, to] = key.split('-');
                            const d = draft[key];
                            const fromFlag = COUNTRY_BY_CURRENCY[from as AssignedCurrency]?.flag ?? '';
                            const toFlag   = COUNTRY_BY_CURRENCY[to   as AssignedCurrency]?.flag ?? '';
                            const isDirty = (
                                (costs[key]?.cost_usd ?? 0) !== d.cost_usd ||
                                (costs[key]?.cost_pct ?? 0) !== d.cost_pct ||
                                ((costs[key]?.notes ?? '') !== (d.notes ?? ''))
                            );
                            return (
                                <tr key={key} className="border-t border-slate-100">
                                    <td className="py-2 px-2 font-mono font-semibold whitespace-nowrap">
                                        {fromFlag} {from} → {toFlag} {to}
                                    </td>
                                    <td className="py-2 px-2">
                                        <input
                                            type="number" min={0} step="0.01" inputMode="decimal"
                                            disabled={!canEdit}
                                            value={d.cost_usd === 0 ? '' : d.cost_usd}
                                            placeholder="0"
                                            onChange={e => setDraft(p => ({ ...p, [key]: { ...d, cost_usd: e.target.value === '' ? 0 : Number(e.target.value) } }))}
                                            className="w-full px-2 py-1 rounded border border-slate-200 font-mono text-right disabled:bg-slate-50"
                                        />
                                    </td>
                                    <td className="py-2 px-2">
                                        <input
                                            type="number" min={0} max={100} step="0.01" inputMode="decimal"
                                            disabled={!canEdit}
                                            value={d.cost_pct === 0 ? '' : d.cost_pct}
                                            placeholder="0"
                                            onChange={e => setDraft(p => ({ ...p, [key]: { ...d, cost_pct: e.target.value === '' ? 0 : Number(e.target.value) } }))}
                                            className="w-full px-2 py-1 rounded border border-slate-200 font-mono text-right disabled:bg-slate-50"
                                        />
                                    </td>
                                    <td className="py-2 px-2">
                                        <input
                                            type="text"
                                            disabled={!canEdit}
                                            value={d.notes ?? ''}
                                            placeholder="ej: wire SWIFT + spread XYZ"
                                            onChange={e => setDraft(p => ({ ...p, [key]: { ...d, notes: e.target.value } }))}
                                            className="w-full px-2 py-1 rounded border border-slate-200 text-xs disabled:bg-slate-50"
                                        />
                                    </td>
                                    <td className="py-2 px-2 text-right">
                                        {canEdit && (
                                            <button
                                                onClick={() => saveOne(key)}
                                                disabled={!isDirty || saving === key}
                                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold ${isDirty ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-slate-100 text-slate-400'} disabled:opacity-50`}
                                            >
                                                <Save size={10} /> {saving === key ? '…' : 'Guardar'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {!canEdit && (
                <p className="text-[10px] text-slate-400 italic">
                    Solo super_admin y treasury pueden editar los costos.
                </p>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// CountryDrillDown — TX por TX para un país.
// ─────────────────────────────────────────────
const CountryDrillDown: React.FC<{
    currency: AssignedCurrency;
    txs: TxRow[];
    costs: PairCostMap;
    onBack: () => void;
}> = ({ currency, txs, costs, onBack }) => {
    const [search, setSearch] = useState('');
    const [period, setPeriod] = useState<'all' | 'month' | 'last_month' | 'custom'>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const country = COUNTRY_BY_CURRENCY[currency];
    const ivaPct  = IVA_RATES[currency];

    // Todas las TX del país (sin filtros): base para el gráfico mensual
    const countryRows = useMemo(() => {
        return txs
            .map(t => ({ tx: t, split: splitCommission(t, costs) }))
            .filter(({ split }) => split.fromCurrency === currency || split.toCurrency === currency);
    }, [txs, costs, currency]);

    const periodOk = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        if (period === 'month') {
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        }
        if (period === 'last_month') {
            const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
        }
        if (period === 'custom') {
            if (dateFrom && d < new Date(dateFrom + 'T00:00:00')) return false;
            if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
            return true;
        }
        return true;
    };

    const rows = useMemo(() => {
        return countryRows
            .filter(({ tx }) => periodOk(tx.created_at))
            .filter(({ tx }) => {
                const q = search.trim().toLowerCase();
                if (!q) return true;
                return [tx.id, tx.from_currency, tx.to_currency]
                    .some(v => v && String(v).toLowerCase().includes(q));
            });
    }, [countryRows, search, period, dateFrom, dateTo]);

    // Agregado mensual (últimos 12 meses con datos) para el gráfico:
    // comisión neta del país vs IVA a pagar, mes a mes.
    const monthly = useMemo(() => {
        const m: Record<string, { gross: number; opCost: number; share: number; iva: number; net: number; volume: number; count: number }> = {};
        for (const { tx, split } of countryRows) {
            const key = String(tx.created_at).slice(0, 7); // YYYY-MM
            const g = (m[key] ??= { gross: 0, opCost: 0, share: 0, iva: 0, net: 0, volume: 0, count: 0 });
            if (split.fromCurrency === currency) {
                g.gross  += split.total;
                g.opCost += split.opCost;
                g.share  += split.fromShare;
                g.iva    += split.ivaAmount;
                g.net    += split.fromNet;
                g.volume += Number(tx.amount) || 0;
                g.count  += 1;
            }
        }
        return Object.entries(m)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-12)
            .map(([key, v]) => {
                const [y, mo] = key.split('-');
                const label = new Date(Number(y), Number(mo) - 1, 1)
                    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
                const short = new Date(Number(y), Number(mo) - 1, 1)
                    .toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
                return { key, label, short, ...v };
            });
    }, [countryRows, currency]);

    // Desglose por corredor (par FX) dentro del período filtrado — solo
    // TX donde este país es EMISOR (las que generan comisión).
    const byPair = useMemo(() => {
        const m: Record<string, { tx: number; volume: number; fee: number; iva: number; net: number }> = {};
        for (const { tx, split } of rows) {
            if (split.fromCurrency !== currency) continue;
            const key = `${tx.from_currency} → ${tx.to_currency}`;
            const g = (m[key] ??= { tx: 0, volume: 0, fee: 0, iva: 0, net: 0 });
            g.tx     += 1;
            g.volume += Number(tx.amount) || 0;
            g.fee    += split.total;
            g.iva    += split.ivaAmount;
            g.net    += split.fromNet;
        }
        return Object.entries(m).sort(([, a], [, b]) => b.fee - a.fee);
    }, [rows, currency]);

    // KPIs contables del período filtrado
    const kpis = useMemo(() => {
        let volume = 0, fee = 0, count = 0;
        for (const { tx, split } of rows) {
            if (split.fromCurrency !== currency) continue;
            volume += Number(tx.amount) || 0;
            fee    += split.total;
            count  += 1;
        }
        return {
            avgPct: volume > 0 ? (fee / volume) * 100 : 0,
            avgTicket: count > 0 ? volume / count : 0,
            volume,
            count,
        };
    }, [rows, currency]);

    // CSV del resumen mensual (cierre contable mes a mes)
    const exportMonthlyCsv = () => {
        const header = ['mes', 'moneda', 'tx_emisor', 'volumen_enviado', 'comisiones_brutas', 'costo_operativo', 'iva_a_pagar', 'utilidad_neta'];
        const lines = monthly.map(m => [
            m.key, currency, String(m.count), m.volume.toFixed(2), m.gross.toFixed(2),
            m.opCost.toFixed(2), m.iva.toFixed(2), m.net.toFixed(2),
        ]);
        const tot = monthly.reduce((a, m) => ({
            volume: a.volume + m.volume, gross: a.gross + m.gross,
            opCost: a.opCost + m.opCost, iva: a.iva + m.iva, net: a.net + m.net, count: a.count + m.count,
        }), { volume: 0, gross: 0, opCost: 0, iva: 0, net: 0, count: 0 });
        lines.push(['TOTALES', currency, String(tot.count), tot.volume.toFixed(2), tot.gross.toFixed(2), tot.opCost.toFixed(2), tot.iva.toFixed(2), tot.net.toFixed(2)]);
        const csv = [header, ...lines]
            .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `cuypay-cierre-mensual-${currency}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // Exportar el detalle filtrado a CSV (abre en Excel/Sheets)
    const exportCsv = () => {
        // Montos en la MONEDA LOCAL del país (columna 'moneda')
        const header = ['fecha', 'tx_id', 'par', 'moneda', `ingreso_${currency.toLowerCase()}`, `salida_${currency.toLowerCase()}`, 'pct_comision', 'comision_bruta', 'costo_op', 'iva_incluido', 'neto', 'rol'];
        const lines = rows.map(({ tx, split }) => {
            const isOrigin = split.fromCurrency === currency;
            const isDest   = split.toCurrency   === currency;
            const myIva    = isOrigin ? split.ivaAmount : 0;
            const myCost   = isOrigin ? split.opCost : 0;
            const myNet    = isOrigin ? split.fromNet : 0;
            const amount = Number(tx.amount) || 0;
            const pct = amount > 0 && split.total > 0 ? ((split.total / amount) * 100).toFixed(2) : '';
            return [
                new Date(tx.created_at).toISOString(),
                tx.id,
                `${tx.from_currency}->${tx.to_currency}`,
                isOrigin ? currency : String(split.fromCurrency ?? ''),
                isDest && Number(tx.dest_amount) > 0 ? Number(tx.dest_amount).toFixed(2) : '',
                isOrigin && amount > 0 ? amount.toFixed(2) : '',
                pct,
                (isOrigin ? split.total : 0).toFixed(2),
                myCost.toFixed(2),
                myIva.toFixed(2),
                myNet.toFixed(2),
                [isOrigin ? 'emisor' : '', isDest ? 'receptor(sin comision)' : ''].filter(Boolean).join('+'),
            ];
        });
        // Totales al final para cuadrar contra el resumen
        lines.push([]);
        lines.push(['TOTALES', '', '', currency, '', '', '', sum.asOrigin.toFixed(2), sum.opCost.toFixed(2), sum.iva.toFixed(2), sum.net.toFixed(2), '']);
        const csv = [header, ...lines]
            .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const suffix = period === 'all' ? 'todo' : period === 'custom' ? `${dateFrom || 'inicio'}_${dateTo || 'hoy'}` : period;
        a.download = `cuypay-contabilidad-${currency}-${suffix}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const sum = useMemo(() => {
        // v2: la comisión completa (y el costo op.) son del país EMISOR
        let asOrigin = 0, asDest = 0, iva = 0, opCost = 0, net = 0;
        for (const { split } of rows) {
            if (split.fromCurrency === currency) {
                asOrigin += split.fromShare;
                iva      += split.ivaAmount;
                opCost   += split.opCost;
                net      += split.fromNet;
            }
        }
        return { asOrigin, asDest, iva, opCost, net };
    }, [rows, currency]);

    return (
        <div className="p-4 md:p-8 space-y-4">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-semibold"
            >
                <ArrowLeft size={14} /> Volver a Contabilidad
            </button>

            <SectionHeader
                title={`${country.flag} ${country.name}`}
                subtitle={`La comisión completa es del país emisor · IVA ${(ivaPct * 100).toFixed(0)}% incluido en la comisión`}
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <StatCard label="Comisiones cobradas" value={fmtLocal(sum.asOrigin, currency)} color="#0F172A" bg="#F1F5F9" />
                <StatCard label="Costo op."           value={`−${fmtLocal(sum.opCost, currency)}`} color="#9F1239" bg="#FFE4E6" />
                <StatCard label={`IVA ${(ivaPct*100).toFixed(0)}% incluido`} value={`−${fmtLocal(sum.iva, currency)}`} color="#92400E" bg="#FEF3C7" />
                <StatCard label="Utilidad neta"       value={fmtLocal(sum.net, currency)} color="#065F46" bg="#D1FAE5" />
            </div>

            {/* Gráfico mensual: comisión neta vs IVA a pagar */}
            {monthly.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <BarChart3 size={14} className="text-slate-500" />
                        <p className="text-sm font-bold" style={{ color: NAVY }}>Mes a mes · comisión neta vs IVA a pagar</p>
                    </div>
                    <div className="flex items-end gap-3 h-36 overflow-x-auto pb-1">
                        {(() => {
                            const max = Math.max(...monthly.map(m => m.net + m.iva), 0.01);
                            return monthly.map(m => (
                                <div key={m.key} className="flex flex-col items-center gap-1 min-w-[52px]" title={`${m.label}: neto ${fmtLocal(m.net, currency)} · IVA ${fmtLocal(m.iva, currency)} · ${m.count} TX`}>
                                    <p className="text-[9px] font-mono text-slate-500">{(m.net + m.iva).toLocaleString('es-CO', { maximumFractionDigits: 0 })}</p>
                                    <div className="w-8 flex flex-col justify-end rounded-t-md overflow-hidden" style={{ height: `${Math.max(((m.net + m.iva) / max) * 100, 3)}%`, minHeight: 4 }}>
                                        <div style={{ height: `${(m.iva / Math.max(m.net + m.iva, 0.01)) * 100}%`, backgroundColor: '#F59E0B' }} />
                                        <div className="flex-1" style={{ backgroundColor: '#4ADE80' }} />
                                    </div>
                                    <p className="text-[9px] text-slate-500 capitalize whitespace-nowrap">{m.short}</p>
                                </div>
                            ));
                        })()}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#4ADE80' }} /> Comisión neta</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#F59E0B' }} /> IVA a pagar</span>
                    </div>
                </div>
            )}

            {/* Resumen mensual de cierre — lo que el contador necesita mes a mes */}
            {monthly.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <div className="flex items-center gap-2">
                            <FileText size={14} className="text-slate-500" />
                            <p className="text-sm font-bold" style={{ color: NAVY }}>Cierre mensual · {country.name}</p>
                        </div>
                        <button
                            onClick={exportMonthlyCsv}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                            style={{ backgroundColor: NAVY }}
                        >
                            <Download size={12} /> Descargar cierre (CSV)
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-slate-500 uppercase tracking-wider">
                                <tr>
                                    <th className="text-left py-2 px-2">Mes</th>
                                    <th className="text-right py-2 px-2">TX</th>
                                    <th className="text-right py-2 px-2">Volumen enviado</th>
                                    <th className="text-right py-2 px-2">Comisiones</th>
                                    <th className="text-right py-2 px-2">Costo op.</th>
                                    <th className="text-right py-2 px-2">IVA a pagar</th>
                                    <th className="text-right py-2 px-2">Utilidad neta</th>
                                </tr>
                            </thead>
                            <tbody>
                                {monthly.slice().reverse().map(m => (
                                    <tr key={m.key} className="border-t border-slate-100">
                                        <td className="py-2 px-2 capitalize font-semibold" style={{ color: NAVY }}>{m.label}</td>
                                        <td className="py-2 px-2 text-right font-mono">{m.count}</td>
                                        <td className="py-2 px-2 text-right font-mono text-slate-600">{fmtLocal(m.volume, currency)}</td>
                                        <td className="py-2 px-2 text-right font-mono">{fmtLocal(m.gross, currency)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-rose-700">{m.opCost > 0 ? `−${fmtLocal(m.opCost, currency)}` : '—'}</td>
                                        <td className="py-2 px-2 text-right font-mono text-amber-700 font-bold">−{fmtLocal(m.iva, currency)}</td>
                                        <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700">{fmtLocal(m.net, currency)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                        La columna "IVA a pagar" es el acumulado del mes que debes declarar — ya viene extraído de
                        la comisión (incluido), no se suma encima.
                    </p>
                </div>
            )}

            {/* KPIs contables + desglose por corredor (respetan los filtros de período) */}
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
                <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Indicadores del período</p>
                    <div>
                        <p className="text-[10px] uppercase text-slate-400">% comisión efectiva promedio</p>
                        <p className="text-xl font-bold font-mono" style={{ color: NAVY }}>{kpis.avgPct.toFixed(2)}%</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase text-slate-400">Ticket promedio (envío)</p>
                        <p className="text-xl font-bold font-mono" style={{ color: NAVY }}>{fmtLocal(kpis.avgTicket, currency)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase text-slate-400">Volumen enviado total</p>
                        <p className="text-xl font-bold font-mono" style={{ color: NAVY }}>{fmtLocal(kpis.volume, currency)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase text-slate-400">TX como emisor</p>
                        <p className="text-xl font-bold font-mono" style={{ color: NAVY }}>{kpis.count}</p>
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Por corredor (par FX)</p>
                    {byPair.length === 0 && (
                        <p className="text-xs text-slate-400 py-4 text-center">Sin comisiones como emisor en este período.</p>
                    )}
                    {byPair.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="text-slate-500 uppercase tracking-wider">
                                    <tr>
                                        <th className="text-left py-2 px-2">Corredor</th>
                                        <th className="text-right py-2 px-2">TX</th>
                                        <th className="text-right py-2 px-2">Volumen</th>
                                        <th className="text-right py-2 px-2">Comisiones</th>
                                        <th className="text-right py-2 px-2">% prom.</th>
                                        <th className="text-right py-2 px-2">IVA</th>
                                        <th className="text-right py-2 px-2">Neto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {byPair.map(([pair, g]) => (
                                        <tr key={pair} className="border-t border-slate-100">
                                            <td className="py-2 px-2 font-mono font-semibold" style={{ color: NAVY }}>{pair}</td>
                                            <td className="py-2 px-2 text-right font-mono">{g.tx}</td>
                                            <td className="py-2 px-2 text-right font-mono text-slate-600">{fmtLocal(g.volume, currency)}</td>
                                            <td className="py-2 px-2 text-right font-mono">{fmtLocal(g.fee, currency)}</td>
                                            <td className="py-2 px-2 text-right font-mono text-slate-600">
                                                {g.volume > 0 ? `${((g.fee / g.volume) * 100).toFixed(2)}%` : '—'}
                                            </td>
                                            <td className="py-2 px-2 text-right font-mono text-amber-700">−{fmtLocal(g.iva, currency)}</td>
                                            <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700">{fmtLocal(g.net, currency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        placeholder="Buscar por TX ID o par..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 focus:border-green-500 outline-none text-sm"
                    />
                </div>
                <CalendarDays size={14} className="text-slate-400" />
                {([
                    ['all', 'Todo'],
                    ['month', 'Este mes'],
                    ['last_month', 'Mes pasado'],
                    ['custom', 'Rango'],
                ] as const).map(([id, label]) => (
                    <button
                        key={id}
                        onClick={() => setPeriod(id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200"
                        style={{
                            backgroundColor: period === id ? '#16A34A' : 'white',
                            color: period === id ? 'white' : '#475569',
                        }}
                    >
                        {label}
                    </button>
                ))}
                {period === 'custom' && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1 rounded-lg border border-slate-200 text-xs" />
                        <span>→</span>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1 rounded-lg border border-slate-200 text-xs" />
                    </div>
                )}
                <button
                    onClick={exportCsv}
                    disabled={rows.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                    style={{ backgroundColor: NAVY }}
                    title="Descarga el detalle filtrado en CSV (Excel/Sheets)"
                >
                    <Download size={13} /> Descargar CSV
                </button>
                <span className="text-xs text-slate-500 ml-auto">{rows.length} TX</span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">Fecha</th>
                                <th className="text-left px-4 py-3">TX</th>
                                <th className="text-left px-4 py-3">Par</th>
                                <th className="text-right px-4 py-3">Ingreso {currency}</th>
                                <th className="text-right px-4 py-3">Salida {currency}</th>
                                <th className="text-right px-4 py-3">% Com.</th>
                                <th className="text-right px-4 py-3">Comisión</th>
                                <th className="text-right px-4 py-3">Costo op.</th>
                                <th className="text-right px-4 py-3">Mi share</th>
                                <th className="text-right px-4 py-3">IVA</th>
                                <th className="text-right px-4 py-3">Neto</th>
                                <th className="text-left px-4 py-3">Rol</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400">Sin TXs para mostrar</td></tr>
                            )}
                            {rows.map(({ tx, split }) => {
                                const isOrigin = split.fromCurrency === currency;
                                const isDest   = split.toCurrency   === currency;
                                const myShare  = isOrigin ? split.fromShare : 0;
                                const myShareDest = isDest ? split.toShare : 0;
                                const myIva    = isOrigin ? split.ivaAmount : 0;
                                // v2: costo operativo completo al emisor
                                const myCostHalf = isOrigin ? split.opCost : 0;
                                const myNet    = (isOrigin ? split.fromNet : 0) + (isDest ? split.toNet : 0);
                                return (
                                    <tr key={tx.id} className="border-t border-slate-100 hover:bg-slate-50">
                                        <td className="px-4 py-3 text-xs text-slate-600">{formatDate(tx.created_at)}</td>
                                        <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{String(tx.id).slice(0, 8)}…</td>
                                        <td className="px-4 py-3 font-mono text-xs">{tx.from_currency} → {tx.to_currency}</td>
                                        {/* Ambas columnas en la MONEDA DEL PAÍS: entró (destino=país)
                                            o salió (origen=país). Una de las dos siempre es '—'. */}
                                        <td className="px-4 py-3 text-right font-mono text-emerald-700">
                                            {isDest && Number(tx.dest_amount) > 0
                                                ? fmtLocal(Number(tx.dest_amount), currency)
                                                : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-red-700">
                                            {isOrigin && Number(tx.amount) > 0
                                                ? `−${fmtLocal(Number(tx.amount), currency)}`
                                                : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                                            {Number(tx.amount) > 0 && split.total > 0
                                                ? `${((split.total / Number(tx.amount)) * 100).toFixed(2)}%`
                                                : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">{fmtLocal(split.total, split.fromCurrency)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-rose-700">
                                            {myCostHalf > 0 ? `−${fmtLocal(myCostHalf, currency)}` : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            {isOrigin ? fmtLocal(myShare + myShareDest, currency) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-amber-700">
                                            {myIva > 0 ? `−${fmtLocal(myIva, currency)}` : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">
                                            {isOrigin ? fmtLocal(myNet, currency) : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1">
                                                {isOrigin && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">Emisor</span>}
                                                {isDest   && <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">Receptor</span>}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <p className="text-[11px] text-slate-500">
                <b>Fórmula:</b> la comisión completa es del país <b>emisor</b> (donde se le descontó al cliente) y queda en su moneda — sin convertir a dólares.
                Neto = (Comisión − Costo operativo) − IVA incluido, donde IVA incluido = base × tasa/(1+tasa).
                Ej. {(ivaPct * 100).toFixed(0)}%: comisión {fmtLocal(200000, currency)} → IVA {fmtLocal(200000 * ivaPct / (1 + ivaPct), currency)}, neto {fmtLocal(200000 / (1 + ivaPct), currency)}.
                El país receptor no participa de la comisión.
            </p>
        </div>
    );
};

const StatCard: React.FC<{ label: string; value: string; color: string; bg: string }> = ({ label, value, color, bg }) => (
    <div className="rounded-xl p-3" style={{ backgroundColor: bg }}>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color, opacity: 0.7 }}>{label}</p>
        <p className="text-xl font-bold mt-0.5 font-mono" style={{ color }}>{value}</p>
    </div>
);
