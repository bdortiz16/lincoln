import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    RefreshCw, Send, X, MessageSquare, CheckCircle2, Clock, XCircle,
    AlertTriangle, Landmark, Wallet, User, Hash, Copy, Lock,
} from 'lucide-react';

// ─────────────────────────────────────────────
// AdminOtcCierres — bandeja de la Mesa OTC manual.
//
// Cada fila es una operación que alguien está esperando. El orden por defecto
// es el de las que siguen vivas, más viejas primero: la bandeja tiene que
// mostrar a quién se está haciendo esperar, no las últimas que entraron.
//
// EL HILO VIVE PEGADO A LA ORDEN
//   Abrir un cierre muestra la operación y su conversación en la misma
//   pantalla. Es lo que hace falta para decidir: la tasa que se acordó, quién
//   dijo que ya pagó y a qué hora están en el mismo lugar que el botón de
//   completar.
//
// TOMAR ANTES DE HABLAR
//   Un cierre sin dueño lo puede contestar cualquiera, y dos operadores dando
//   dos tasas distintas al mismo cliente es la peor falla posible de una mesa.
//   Por eso el hilo y las acciones se desbloquean recién al tomarlo, y tomarlo
//   es exclusivo: el servidor lo resuelve con un CAS, no con un chequeo en
//   pantalla que dos clicks simultáneos se saltan.
// ─────────────────────────────────────────────

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

function adminAuthHeader(): string {
    try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) {
            const d = JSON.parse(localStorage.getItem(k) || '{}');
            if (d.access_token) return `Bearer ${d.access_token}`;
        }
    } catch { /* sin sesión */ }
    return `Bearer ${SKEY}`;
}

async function callMesa(action: string, body: Record<string, unknown> = {}): Promise<any> {
    try {
        const r = await fetch(`${SURL}/functions/v1/otc-mesa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: adminAuthHeader() },
            body: JSON.stringify({ action, ...body }),
            signal: AbortSignal.timeout(25000),
        });
        const t = await r.text();
        if (!t) return { ok: false, error: 'Sin respuesta del servicio.' };
        try { return JSON.parse(t); } catch { return { ok: false, error: `Respuesta no válida (HTTP ${r.status})` }; }
    } catch (e: any) {
        return { ok: false, error: e?.name === 'TimeoutError' ? 'Timeout.' : `Error de red: ${String(e?.message ?? e)}` };
    }
}

const ESTADO: Record<string, { label: string; bg: string; tx: string }> = {
    abierta:        { label: 'SIN TOMAR',      bg: '#FEF3C7', tx: '#92400E' },
    en_proceso:     { label: 'EN PROCESO',     bg: '#DBEAFE', tx: '#1E40AF' },
    esperando_pago: { label: 'ESPERANDO PAGO', bg: '#EDE9FE', tx: '#5B21B6' },
    pagada:         { label: 'PAGADA',         bg: '#FEF3C7', tx: '#92400E' },
    completada:     { label: 'COMPLETADO',     bg: '#D1FAE5', tx: '#065F46' },
    cancelada:      { label: 'CANCELADO',      bg: '#F1F5F9', tx: '#475569' },
};
const caraDe = (s: string) => ESTADO[s] ?? { label: String(s ?? '—').toUpperCase(), bg: '#F1F5F9', tx: '#475569' };

const FILTROS: Array<{ id: string; label: string }> = [
    { id: 'vivos',          label: 'En curso' },
    { id: 'abierta',        label: 'Sin tomar' },
    { id: 'esperando_pago', label: 'Esperando pago' },
    { id: 'pagada',         label: 'Por verificar' },
    { id: 'completada',     label: 'Completadas' },
    { id: 'cancelada',      label: 'Canceladas' },
    { id: 'todas',          label: 'Todas' },
];

const nf = (n: any, dec = 2) => Number(n ?? 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: dec });
const fecha = (d: any) => {
    const t = new Date(d ?? '');
    if (!d || Number.isNaN(t.getTime())) return '—';
    return t.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
// Cuánto lleva esperando. Es el dato que decide a cuál se entra primero.
const espera = (d: any) => {
    const t = new Date(d ?? '').getTime();
    if (!Number.isFinite(t)) return '';
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.floor(h / 24)} d`;
};

export const AdminOtcCierres: React.FC = () => {
    const [filtro, setFiltro]   = useState('vivos');
    const [filas, setFilas]     = useState<any[]>([]);
    const [cargando, setCargando] = useState(true);
    const [abierta, setAbierta] = useState<string | null>(null);
    const [error, setError]     = useState<string | null>(null);

    const cargar = useCallback(async () => {
        const r = await callMesa('lista', { estado: filtro === 'todas' ? '' : filtro });
        if (r?.ok) { setFilas(r.cierres ?? []); setError(null); }
        else setError(r?.message ?? r?.error ?? 'No pude cargar la bandeja.');
        setCargando(false);
    }, [filtro]);

    useEffect(() => { setCargando(true); cargar(); }, [cargar]);
    // La bandeja se relee sola: un operador mirando la lista tiene que ver
    // entrar el cierre nuevo sin apretar nada.
    useEffect(() => {
        const t = setInterval(() => { if (!abierta) cargar(); }, 15000);
        return () => clearInterval(t);
    }, [cargar, abierta]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Cierres OTC</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Solicitudes de la mesa manual. Se atienden por orden de llegada.</p>
                </div>
                <button onClick={() => { setCargando(true); cargar(); }} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50">
                    <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} /> Actualizar
                </button>
            </div>

            <div className="flex gap-1.5 flex-wrap">
                {FILTROS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFiltro(f.id)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                            filtro === f.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-xs text-red-700">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {cargando && filas.length === 0 && <p className="p-8 text-center text-sm text-slate-400">Cargando…</p>}
                {!cargando && filas.length === 0 && (
                    <p className="p-10 text-center text-sm text-slate-400">No hay cierres en este filtro.</p>
                )}
                {filas.map((c, i) => {
                    const cara = caraDe(c.status);
                    const sinLeer = c.last_msg_por === 'cliente' && (!c.visto_mesa || new Date(c.last_msg_at) > new Date(c.visto_mesa));
                    return (
                        <button
                            key={c.id}
                            onClick={() => setAbierta(c.id)}
                            className={`w-full text-left px-4 py-4 grid grid-cols-12 gap-3 items-center hover:bg-slate-50 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''}`}
                        >
                            <div className="col-span-12 sm:col-span-3 min-w-0">
                                <p className="font-mono text-xs text-slate-500 truncate">{c.ref}</p>
                                <p className="text-xs font-bold mt-0.5" style={{ color: c.side === 'vende_usdt' ? '#B91C1C' : '#065F46' }}>
                                    {c.side === 'vende_usdt' ? 'Vende USDT' : 'Compra USDT'}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-0.5">Mesa manual</p>
                            </div>
                            <div className="col-span-6 sm:col-span-2 min-w-0">
                                <p className="text-sm font-bold text-slate-800">{nf(c.from_amount)} {c.from_currency}</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {c.to_amount != null ? `→ ${nf(c.to_amount, 0)} ${c.to_currency}` : '→ a cotizar'}
                                </p>
                                {(c.rate_final ?? c.rate_cotizada) != null && (
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        {nf(c.rate_final ?? c.rate_cotizada)} {c.rate_final ? '· final' : '· indicativa'}
                                    </p>
                                )}
                            </div>
                            <div className="col-span-6 sm:col-span-3 min-w-0">
                                <p className="text-sm text-slate-700 truncate">{c.cliente?.nombre ?? '—'}</p>
                                <p className="text-xs text-slate-400 truncate">{c.cliente?.email ?? ''}</p>
                            </div>
                            <div className="col-span-6 sm:col-span-2">
                                <p className="text-xs text-slate-600">{fecha(c.created_at)}</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">{espera(c.created_at)}</p>
                            </div>
                            <div className="col-span-6 sm:col-span-2 flex items-center justify-end gap-2 flex-wrap">
                                {sinLeer && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                        <MessageSquare size={10} /> NUEVO
                                    </span>
                                )}
                                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ backgroundColor: cara.bg, color: cara.tx }}>
                                    {cara.label}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {abierta && (
                <DetalleMesa
                    id={abierta}
                    onClose={() => { setAbierta(null); cargar(); }}
                    onCambio={cargar}
                />
            )}
        </div>
    );
};

// ─── Detalle: la orden a la izquierda, el hilo a la derecha ──
const DetalleMesa: React.FC<{ id: string; onClose: () => void; onCambio: () => void }> = ({ id, onClose, onCambio }) => {
    const [cierre, setCierre] = useState<any>(null);
    const [cliente, setCliente] = useState<any>(null);
    const [msgs, setMsgs]     = useState<any[]>([]);
    const [texto, setTexto]   = useState('');
    const [cargando, setCargando] = useState(true);
    const [ocupado, setOcupado]   = useState(false);
    const [aviso, setAviso]   = useState<string | null>(null);
    const [tasaInput, setTasaInput] = useState('');
    const [instrucciones, setInstrucciones] = useState('');
    const [notas, setNotas]   = useState('');
    const [notasGuardadas, setNotasGuardadas] = useState(false);
    const finRef = useRef<HTMLDivElement | null>(null);

    const cargar = useCallback(async () => {
        const r = await callMesa('detalle', { id });
        if (r?.ok) {
            setCierre(r.cierre); setCliente(r.cliente ?? null); setMsgs(r.mensajes ?? []);
            setNotas(prev => (prev === '' ? (r.cierre?.notas_internas ?? '') : prev));
            setTasaInput(prev => (prev === '' && r.cierre?.rate_cotizada ? String(r.cierre.rate_cotizada) : prev));
        } else setAviso(r?.message ?? r?.error ?? 'No pude abrir el cierre.');
        setCargando(false);
    }, [id]);

    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => {
        const t = setInterval(() => {
            if (cierre && (cierre.status === 'completada' || cierre.status === 'cancelada')) return;
            cargar();
        }, 8000);
        return () => clearInterval(t);
    }, [cargar, cierre]);
    useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

    const hacer = async (action: string, extra: Record<string, unknown> = {}) => {
        setOcupado(true); setAviso(null);
        const r = await callMesa(action, { id, ...extra });
        setOcupado(false);
        if (!r?.ok) { setAviso(r?.message ?? r?.error ?? 'No se pudo.'); return false; }
        await cargar(); onCambio();
        return true;
    };

    const enviar = async () => {
        const t = texto.trim();
        if (!t || ocupado) return;
        setOcupado(true);
        const r = await callMesa('mensaje', { id, body: t });
        setOcupado(false);
        if (r?.ok) { setTexto(''); cargar(); onCambio(); }
        else setAviso(r?.message ?? r?.error ?? 'No se pudo enviar.');
    };

    const copiar = (t: string) => { try { navigator.clipboard.writeText(t); } catch { /* */ } };

    if (cargando && !cierre) {
        return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
                <div className="bg-white rounded-2xl p-8 text-sm text-slate-500">Cargando…</div>
            </div>
        );
    }
    if (!cierre) {
        return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
                <div className="bg-white rounded-2xl p-8 text-sm text-slate-600">{aviso ?? 'No pude abrir el cierre.'}</div>
            </div>
        );
    }

    const cara = caraDe(cierre.status);
    const mia  = !!cierre.tomada_at;
    const viva = !['completada', 'cancelada'].includes(cierre.status);
    const bloqueado = viva && !mia;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[94vh] overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>

                {/* ── Izquierda: la operación ── */}
                <div className="md:w-[52%] flex flex-col border-b md:border-b-0 md:border-r border-slate-200 overflow-auto">
                    <div className="px-5 py-4" style={{ backgroundColor: cara.bg }}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs" style={{ color: cara.tx }}>{cierre.ref}</span>
                            <span className="text-xs font-bold" style={{ color: cara.tx }}>{cara.label}</span>
                        </div>
                        <p className="text-[11px] font-bold uppercase tracking-wide mt-2" style={{ color: cara.tx }}>
                            {cierre.side === 'vende_usdt' ? 'El cliente entrega' : 'El cliente entrega'}
                        </p>
                        <p className="text-2xl font-bold mt-0.5" style={{ color: cara.tx }}>
                            {nf(cierre.from_amount)} {cierre.from_currency}
                        </p>
                    </div>

                    <div className="p-5 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <KV label="Recibe" valor={cierre.to_amount != null ? `${nf(cierre.to_amount, 0)} ${cierre.to_currency}` : 'a cotizar'} />
                            <KV label="Tasa final" valor={cierre.rate_final != null ? nf(cierre.rate_final) : '— sin fijar'} />
                            <KV label="Tasa que vio el cliente" valor={cierre.rate_cotizada != null ? nf(cierre.rate_cotizada) : '— no se pudo cotizar'} pie={cierre.rate_fuente ?? undefined} />
                            <KV label="Solicitado" valor={fecha(cierre.created_at)} pie={espera(cierre.created_at)} />
                        </div>

                        <div className="border-t border-slate-100 pt-4">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Cliente</p>
                            <div className="flex items-center gap-2 text-sm text-slate-700"><User size={13} className="text-slate-400" /> {cliente?.company_name ?? cliente?.full_name ?? '—'}</div>
                            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">{cliente?.email ?? '—'}</div>
                            {cliente?.kyc_status && (
                                <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                    KYC {String(cliente.kyc_status).toUpperCase()}
                                </span>
                            )}
                        </div>

                        <div className="border-t border-slate-100 pt-4">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                                {cierre.payout?.tipo === 'wallet' ? 'Dónde recibe el USDT' : 'Dónde recibe el COP'}
                            </p>
                            {cierre.payout?.tipo === 'banco' && (
                                <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                                    <Fila icon={Landmark} label="Banco"   valor={cierre.payout.banco} />
                                    <Fila icon={Hash}     label="Cuenta"  valor={cierre.payout.cuenta} mono onCopy={() => copiar(String(cierre.payout.cuenta ?? ''))} />
                                    <Fila icon={User}     label="Titular" valor={cierre.payout.titular} />
                                </div>
                            )}
                            {cierre.payout?.tipo === 'wallet' && (
                                <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                                    <Fila icon={Wallet} label="Red"       valor={cierre.payout.red} />
                                    <Fila icon={Hash}   label="Dirección" valor={cierre.payout.direccion} mono onCopy={() => copiar(String(cierre.payout.direccion ?? ''))} />
                                </div>
                            )}
                            {!cierre.payout?.tipo && <p className="text-xs text-slate-400">Sin datos de destino.</p>}
                        </div>

                        {/* Notas internas — el cliente no las ve, y se dice */}
                        <div className="border-t border-slate-100 pt-4">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                                <Lock size={10} /> Notas internas · el cliente no las ve
                            </p>
                            <textarea
                                value={notas}
                                onChange={e => { setNotas(e.target.value); setNotasGuardadas(false); }}
                                onBlur={async () => { if (!notasGuardadas) { await callMesa('notas', { id, notas }); setNotasGuardadas(true); } }}
                                rows={2}
                                placeholder="Contexto para el resto de la mesa…"
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 outline-none text-xs"
                            />
                            {notasGuardadas && <p className="text-[10px] text-emerald-600 mt-1">Guardado.</p>}
                        </div>
                    </div>
                </div>

                {/* ── Derecha: hilo + acciones ── */}
                <div className="md:w-[48%] flex flex-col min-h-0">
                    <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <MessageSquare size={15} className="text-slate-400 shrink-0" />
                            <span className="text-sm font-bold text-slate-800 truncate">
                                {mia ? `Atiende ${cierre.tomada_por_nom ?? 'la mesa'}` : 'Sin tomar'}
                            </span>
                        </div>
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 shrink-0"><X size={17} /></button>
                    </div>

                    {aviso && (
                        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-900 flex items-start gap-2">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" /> {aviso}
                        </div>
                    )}

                    <div className="flex-1 overflow-auto px-4 py-4 space-y-2.5 bg-slate-50 min-h-[180px]">
                        {msgs.map(m => <Burbuja key={m.id} m={m} />)}
                        <div ref={finRef} />
                    </div>

                    {/* Tomar primero: sin dueño no se habla ni se opera */}
                    {bloqueado && (
                        <div className="px-4 py-4 border-t border-slate-200 bg-white">
                            <p className="text-xs text-slate-500 mb-2">
                                Tomá el cierre para escribirle al cliente y operarlo. Queda a tu nombre para que nadie más conteste en paralelo.
                            </p>
                            <button onClick={() => hacer('tomar')} disabled={ocupado}
                                className="w-full py-2.5 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50">
                                {ocupado ? 'Tomando…' : 'Tomar este cierre'}
                            </button>
                        </div>
                    )}

                    {viva && mia && (
                        <>
                            {/* Acciones según el paso */}
                            <div className="px-4 py-3 border-t border-slate-200 bg-white space-y-2">
                                {['abierta', 'en_proceso', 'esperando_pago'].includes(cierre.status) && (
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            {cierre.status === 'esperando_pago' ? 'Corregir tasa e instrucciones' : 'Confirmar tasa y dar instrucciones'}
                                        </p>
                                        <div className="flex gap-2">
                                            <input
                                                value={tasaInput}
                                                onChange={e => setTasaInput(e.target.value)}
                                                inputMode="decimal"
                                                placeholder="Tasa final"
                                                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 outline-none text-sm font-mono"
                                            />
                                            <button
                                                onClick={async () => {
                                                    const n = Number(String(tasaInput).replace(/[^\d.]/g, ''));
                                                    if (!(n > 0)) { setAviso('Escribí la tasa final.'); return; }
                                                    if (await hacer('fijar_tasa', { rateFinal: n, instrucciones })) setInstrucciones('');
                                                }}
                                                disabled={ocupado}
                                                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 shrink-0"
                                            >
                                                Confirmar
                                            </button>
                                        </div>
                                        <textarea
                                            value={instrucciones}
                                            onChange={e => setInstrucciones(e.target.value)}
                                            rows={2}
                                            placeholder="Instrucciones de pago para el cliente (se le envían por el chat)"
                                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 outline-none text-xs"
                                        />
                                    </div>
                                )}

                                {cierre.status === 'pagada' && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-900">
                                        El cliente marcó el envío. <b>Verificalo en tu banco o en la cadena antes de completar</b> — lo que él marque no es prueba de que el dinero llegó.
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <button
                                        onClick={async () => {
                                            if (!cierre.rate_final) { setAviso('Fijá la tasa final antes de completar.'); return; }
                                            if (!window.confirm(`¿Completar ${cierre.ref}? Esto cierra la operación.`)) return;
                                            hacer('completar');
                                        }}
                                        disabled={ocupado}
                                        className="flex-1 py-2.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                                    >
                                        <CheckCircle2 size={14} /> Completar
                                    </button>
                                    <button
                                        onClick={() => {
                                            const m = window.prompt('¿Por qué se cancela? (queda en el hilo, el cliente lo ve)');
                                            if (m && m.trim()) hacer('cancelar_mesa', { motivo: m.trim() });
                                        }}
                                        disabled={ocupado}
                                        className="px-4 py-2.5 rounded-lg text-xs font-bold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>

                            {/* Composer */}
                            <div className="flex gap-2 px-4 py-3 border-t border-slate-200 bg-white">
                                <input
                                    value={texto}
                                    onChange={e => setTexto(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                                    placeholder="Escribile al cliente…"
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 outline-none text-sm"
                                />
                                <button onClick={enviar} disabled={ocupado || !texto.trim()}
                                    className="w-10 rounded-lg bg-slate-900 text-white flex items-center justify-center disabled:opacity-40">
                                    {ocupado ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                                </button>
                            </div>
                        </>
                    )}

                    {!viva && (
                        <div className="px-5 py-4 border-t border-slate-200 bg-white text-xs text-slate-500">
                            {cierre.status === 'completada'
                                ? <>Completado el {fecha(cierre.completada_at)}. El hilo queda como registro.</>
                                : <>Cancelado el {fecha(cierre.cancelada_at)}{cierre.motivo_cierre ? ` — ${cierre.motivo_cierre}` : ''}.</>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const KV: React.FC<{ label: string; valor: string; pie?: string }> = ({ label, valor, pie }) => (
    <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-sm font-semibold text-slate-800 mt-0.5">{valor}</p>
        {pie && <p className="text-[10px] text-slate-400 mt-0.5">{pie}</p>}
    </div>
);

const Fila: React.FC<{ icon: any; label: string; valor: any; mono?: boolean; onCopy?: () => void }> = ({ icon: Icon, label, valor, mono, onCopy }) => (
    <div className="flex items-center gap-2 text-xs">
        <Icon size={12} className="text-slate-400 shrink-0" />
        <span className="text-slate-500 min-w-[70px]">{label}</span>
        <span className={`flex-1 text-slate-800 break-all ${mono ? 'font-mono' : ''}`}>{valor ?? '—'}</span>
        {onCopy && <button onClick={onCopy} className="p-1 rounded hover:bg-slate-200 text-slate-400 shrink-0"><Copy size={11} /></button>}
    </div>
);

const Burbuja: React.FC<{ m: any }> = ({ m }) => {
    if (m.autor === 'sistema') {
        return <p className="text-center text-[11px] text-slate-400 px-6 leading-relaxed">{m.body}</p>;
    }
    const deLaMesa = m.autor === 'mesa';
    return (
        <div className={`flex ${deLaMesa ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl ${deLaMesa ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                <p className={`text-[10px] font-bold mb-1 ${deLaMesa ? 'text-slate-400' : 'text-slate-400'}`}>
                    {deLaMesa ? (m.autor_nom ?? 'Mesa') : 'Cliente'}
                </p>
                {m.body && <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{m.body}</p>}
                {m.adjunto_url && (
                    <a href={m.adjunto_url} target="_blank" rel="noreferrer" className={`text-[11px] underline mt-1 inline-block ${deLaMesa ? 'text-emerald-300' : 'text-emerald-700'}`}>
                        Ver comprobante
                    </a>
                )}
                <p className={`text-[10px] mt-1 text-right ${deLaMesa ? 'text-slate-500' : 'text-slate-400'}`}>{fecha(m.created_at)}</p>
            </div>
        </div>
    );
};
