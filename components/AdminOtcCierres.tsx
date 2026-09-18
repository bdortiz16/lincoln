import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    RefreshCw, Send, X, MessageSquare, CheckCircle2, Clock, XCircle,
    AlertTriangle, Landmark, Wallet, User, Hash, Copy, Lock, Zap, Paperclip,
    ChevronRight, Bell, BellOff,
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
//
// LA PALETA
//   Fondos #070808 / #0C0E0D / #121413, texto #F4F4F2 / #878E88, bordes
//   translúcidos. El verde es PUNTUAL — un punto, un borde, un botón — nunca
//   un bloque grande: antes la cabecera del detalle era un panel verde claro
//   dentro de una pantalla negra y se leía como un error de maquetación.
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

// ─── Paleta ─────────────────────────────────────────────
const FONDO   = '#070808';
const PANEL   = '#0C0E0D';
const ELEVADO = '#121413';
const BORDE   = 'rgba(255,255,255,0.09)';
const BORDE2  = 'rgba(255,255,255,0.14)';
const TXT     = '#F4F4F2';
const TXT2    = '#878E88';
const TXT3    = 'rgba(244,244,242,0.45)';
const VERDE   = '#4ADE80';
const AMBAR   = '#FBBF24';
const ROJO    = '#F87171';

// El estado se dice con un punto y una palabra, no con un bloque de color.
const ESTADO: Record<string, { label: string; c: string }> = {
    abierta:        { label: 'SIN TOMAR',      c: AMBAR },
    en_proceso:     { label: 'EN PROCESO',     c: '#60A5FA' },
    esperando_pago: { label: 'ESPERANDO PAGO', c: VERDE },
    pagada:         { label: 'POR VERIFICAR',  c: AMBAR },
    completada:     { label: 'COMPLETADO',     c: VERDE },
    cancelada:      { label: 'CANCELADO',      c: TXT2 },
};
const caraDe = (s: string) => ESTADO[s] ?? { label: String(s ?? '—').toUpperCase(), c: TXT2 };

const Pill: React.FC<{ estado: string }> = ({ estado }) => {
    const { label, c } = caraDe(estado);
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            border: `1px solid ${c}44`, background: `${c}12`, color: c,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', padding: '3px 9px', borderRadius: 999,
        }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: c }} /> {label}
        </span>
    );
};

// Billeteras del cliente donde se le acredita lo que recibe. El cierre NO es
// un envío: la mesa cambia una moneda por otra dentro de la cuenta.
const BILLETERA: Record<string, string> = {
    COP: 'Saldo Lincoin', COP_BREB: 'Bre-B', COP_ACH: 'ACH', USD: 'Saldo USDT',
};

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
// Cuánto le queda al cliente para subir el comprobante. Vencido, el servidor
// cancela la solicitud solo.
const restante = (d: any) => {
    const t = new Date(d ?? '').getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.floor((t - Date.now()) / 1000);
    if (s <= 0) return 'vencido';
    return `quedan ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

// ─── Campana ────────────────────────────────────────────
// Un cierre nuevo es alguien esperando. La bandeja se relee sola, pero nadie
// mira una pantalla fija: sin sonido, la solicitud entra y se queda ahi hasta
// que a alguien se le ocurre volver a mirar.
//
// Se sintetiza en vez de cargar un archivo: no hay que servir un asset ni
// esperar a que baje para que suene.
let _campanaCtx: any = null;
function sonarCampana() {
    try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        _campanaCtx = _campanaCtx || new AC();
        const ctx = _campanaCtx;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        // Dos golpes descendentes: se reconoce como campana y no como alarma.
        ([[987.77, 0], [739.99, 0.16]] as Array<[number, number]>).forEach(([freq, t]) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, now + t);
            g.gain.exponentialRampToValueAtTime(0.25, now + t + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.55);
            o.connect(g); g.connect(ctx.destination);
            o.start(now + t);
            o.stop(now + t + 0.6);
        });
    } catch { /* audio no disponible */ }
}

const CLAVE_SONIDO = 'lincoin_otc_campana';

const INPUT: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDE2}`,
    borderRadius: 9, padding: '9px 11px', color: TXT, fontSize: 13, outline: 'none',
    fontFamily: "'Archivo', system-ui, sans-serif",
};
const ROTULO: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 700, color: TXT3, letterSpacing: '0.6px', textTransform: 'uppercase',
};

export const AdminOtcCierres: React.FC = () => {
    const [filtro, setFiltro]   = useState('vivos');
    const [filas, setFilas]     = useState<any[]>([]);
    const [cargando, setCargando] = useState(true);
    const [abierta, setAbierta] = useState<string | null>(null);
    const [error, setError]     = useState<string | null>(null);
    // Se puede apagar: una campana que no se puede silenciar en un panel que
    // alguien tiene abierto todo el dia deja de ser un aviso y pasa a ser
    // ruido -- y lo que se hace con el ruido es ignorarlo.
    const [sonido, setSonido] = useState(() => {
        try { return localStorage.getItem(CLAVE_SONIDO) !== 'off'; } catch { return true; }
    });
    const conocidos = useRef<Set<string> | null>(null);
    const sonidoRef = useRef(sonido);
    useEffect(() => {
        sonidoRef.current = sonido;
        try { localStorage.setItem(CLAVE_SONIDO, sonido ? 'on' : 'off'); } catch { /* */ }
    }, [sonido]);

    const cargar = useCallback(async () => {
        const r = await callMesa('lista', { estado: filtro === 'todas' ? '' : filtro });
        if (r?.ok) {
            const lista = r.cierres ?? [];
            setFilas(lista); setError(null);
            // La PRIMERA lectura solo toma nota. Sonar ahi haria repicar la
            // campana cada vez que alguien abre el panel o cambia de filtro,
            // por cierres que ya estaban.
            const ids = new Set<string>(lista.map((c: any) => String(c.id)));
            if (conocidos.current == null) conocidos.current = ids;
            else {
                const nuevos = lista.filter((c: any) => !conocidos.current!.has(String(c.id)));
                conocidos.current = ids;
                if (nuevos.length && sonidoRef.current) sonarCampana();
            }
        }
        else setError(r?.message ?? r?.error ?? 'No pude cargar la bandeja.');
        setCargando(false);
    }, [filtro]);

    // Al cambiar de filtro la lista es otra: se vuelve a empezar para no tomar
    // como "nuevas" a las que simplemente no estaban en el filtro anterior.
    useEffect(() => { conocidos.current = null; }, [filtro]);

    useEffect(() => { setCargando(true); cargar(); }, [cargar]);
    // La bandeja se relee sola: un operador mirando la lista tiene que ver
    // entrar el cierre nuevo sin apretar nada.
    useEffect(() => {
        const t = setInterval(() => { if (!abierta) cargar(); }, 15000);
        return () => clearInterval(t);
    }, [cargar, abierta]);

    return (
        <div style={{ fontFamily: "'Archivo', system-ui, sans-serif" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 16 }}>
                <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: TXT, letterSpacing: '-0.4px' }}>Cierres OTC</h2>
                    <p style={{ fontSize: 12, color: TXT2, marginTop: 3 }}>Solicitudes de la mesa manual. Se atienden por orden de llegada.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={() => { const v = !sonido; setSonido(v); if (v) sonarCampana(); }}
                        title={sonido ? 'Avisar con sonido al entrar un cierre' : 'Sonido apagado'}
                        className="flex items-center gap-1.5 transition-colors hover:bg-white/[0.07]"
                        style={{ padding: '8px 13px', fontSize: 12, fontWeight: 700, color: sonido ? VERDE : TXT2, borderRadius: 9, border: `1px solid ${sonido ? VERDE + '44' : BORDE2}`, background: sonido ? VERDE + '10' : 'rgba(255,255,255,0.045)' }}>
                        {sonido ? <Bell size={13} /> : <BellOff size={13} />} {sonido ? 'Aviso' : 'Silencio'}
                    </button>
                    <button onClick={() => { setCargando(true); cargar(); }}
                        className="flex items-center gap-1.5 transition-colors hover:bg-white/[0.07]"
                        style={{ padding: '8px 13px', fontSize: 12, fontWeight: 700, color: TXT, borderRadius: 9, border: `1px solid ${BORDE2}`, background: 'rgba(255,255,255,0.045)' }}>
                        <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} /> Actualizar
                    </button>
                </div>
            </div>

            <div className="flex gap-1.5 flex-wrap" style={{ marginBottom: 14 }}>
                {FILTROS.map(f => {
                    const on = filtro === f.id;
                    return (
                        <button key={f.id} onClick={() => setFiltro(f.id)}
                            className="transition-colors"
                            style={{
                                padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 999,
                                color: on ? '#0C0E0D' : TXT2,
                                background: on ? TXT : 'rgba(255,255,255,0.045)',
                                border: on ? 'none' : `1px solid ${BORDE}`,
                            }}>
                            {f.label}
                        </button>
                    );
                })}
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, border: `1px solid ${ROJO}44`, background: `${ROJO}10`, borderRadius: 11, padding: '11px 13px', marginBottom: 14 }}>
                    <AlertTriangle size={14} style={{ color: ROJO, marginTop: 1, flexShrink: 0 }} />
                    <p style={{ fontSize: 12.5, color: ROJO }}>{error}</p>
                </div>
            )}

            <div style={{ background: PANEL, border: `1px solid ${BORDE}`, borderRadius: 14, overflow: 'hidden' }}>
                {cargando && filas.length === 0 && <p style={{ padding: 32, textAlign: 'center', fontSize: 13, color: TXT2 }}>Cargando…</p>}
                {!cargando && filas.length === 0 && (
                    <p style={{ padding: 44, textAlign: 'center', fontSize: 13, color: TXT2 }}>No hay cierres en este filtro.</p>
                )}
                {filas.map((c, i) => {
                    const sinLeer = c.last_msg_por === 'cliente' && (!c.visto_mesa || new Date(c.last_msg_at) > new Date(c.visto_mesa));
                    return (
                        <button key={c.id} onClick={() => setAbierta(c.id)}
                            className="w-full text-left transition-colors hover:bg-white/[0.025]"
                            style={{ padding: '15px 18px', display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.2fr) auto', gap: 14, alignItems: 'center', borderTop: i > 0 ? `1px solid ${BORDE}` : 'none' }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: TXT2 }}>{c.ref}</span>
                                    {sinLeer && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: VERDE, color: '#0C0E0D', fontSize: 8.5, fontWeight: 800, padding: '2px 6px', borderRadius: 999 }}>
                                            <MessageSquare size={9} /> NUEVO
                                        </span>
                                    )}
                                </div>
                                <p style={{ fontSize: 12.5, fontWeight: 700, color: c.side === 'vende_usdt' ? TXT : VERDE, marginTop: 4 }}>
                                    {c.side === 'vende_usdt' ? 'Vende USDT' : 'Compra USDT'}
                                </p>
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ fontSize: 14.5, fontWeight: 700, color: TXT }}>{nf(c.from_amount)} {c.from_currency}</p>
                                <p style={{ fontSize: 12, color: TXT2, marginTop: 2 }}>
                                    {c.to_amount != null ? `→ ${nf(c.to_amount, 0)} ${c.to_currency}` : '→ a cotizar'}
                                </p>
                                {(c.rate_final ?? c.rate_cotizada) != null && (
                                    <p style={{ fontSize: 10.5, color: TXT3, marginTop: 2 }}>
                                        {nf(c.rate_final ?? c.rate_cotizada)} {c.rate_final ? '· final' : '· indicativa'}
                                    </p>
                                )}
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ fontSize: 13, color: TXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cliente?.nombre ?? '—'}</p>
                                <p style={{ fontSize: 11.5, color: TXT3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cliente?.email ?? ''}</p>
                                <p style={{ fontSize: 10.5, color: TXT3, marginTop: 3 }}>{fecha(c.created_at)} · {espera(c.created_at)}</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                                <Pill estado={c.status} />
                                <ChevronRight size={15} style={{ color: TXT3, flexShrink: 0 }} />
                            </div>
                        </button>
                    );
                })}
            </div>

            {abierta && (
                <DetalleMesa id={abierta} onClose={() => { setAbierta(null); cargar(); }} onCambio={cargar} />
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
    const [lupa, setLupa] = useState<string | null>(null);
    // Confirmación propia en vez del window.confirm del navegador: completar
    // ACREDITA plata, y el diálogo tiene que decir cuánta y en qué billetera.
    const [pide, setPide] = useState<null | 'completar' | 'cancelar'>(null);
    const [motivo, setMotivo] = useState('');
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

    const marco = (hijo: React.ReactNode) => (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onClose}>
            {hijo}
        </div>
    );

    if (cargando && !cierre) {
        return marco(<div style={{ background: PANEL, border: `1px solid ${BORDE}`, borderRadius: 16, padding: 32, fontSize: 13, color: TXT2 }}>Cargando…</div>);
    }
    if (!cierre) {
        return marco(<div style={{ background: PANEL, border: `1px solid ${BORDE}`, borderRadius: 16, padding: 32, fontSize: 13, color: TXT2 }}>{aviso ?? 'No pude abrir el cierre.'}</div>);
    }

    const mia  = !!cierre.tomada_at;
    const viva = !['completada', 'cancelada'].includes(cierre.status);
    const bloqueado = viva && !mia;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.72)', fontFamily: "'Archivo', system-ui, sans-serif" }} onClick={onClose}>
            <div className="w-full max-w-5xl max-h-[94vh] overflow-hidden flex flex-col md:flex-row"
                style={{ background: FONDO, border: `1px solid ${BORDE2}`, borderRadius: 18, boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}
                onClick={e => e.stopPropagation()}>

                {/* ── Izquierda: la operación ── */}
                <div className="md:w-[52%] flex flex-col overflow-auto" style={{ borderRight: `1px solid ${BORDE}` }}>
                    <div style={{ padding: '18px 20px', borderBottom: `1px solid ${BORDE}` }}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, color: TXT2 }}>{cierre.ref}</span>
                            <Pill estado={cierre.status} />
                        </div>
                        <p style={{ ...ROTULO, marginTop: 12 }}>El cliente entrega</p>
                        <p style={{ fontSize: 26, fontWeight: 800, color: TXT, marginTop: 2, letterSpacing: '-0.6px' }}>
                            {nf(cierre.from_amount)} {cierre.from_currency}
                        </p>
                        <p style={{ fontSize: 13.5, color: TXT2, marginTop: 4 }}>
                            recibe <b style={{ color: VERDE }}>{cierre.to_amount != null ? `${nf(cierre.to_amount, 0)} ${cierre.to_currency}` : 'a cotizar'}</b>
                        </p>
                    </div>

                    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                            <KV label="Tasa final" valor={cierre.rate_final != null ? nf(cierre.rate_final) : 'sin fijar'} />
                            <KV label="Tasa que vio el cliente" valor={cierre.rate_cotizada != null ? nf(cierre.rate_cotizada) : 'no se pudo cotizar'} pie={cierre.rate_fuente ?? undefined} />
                            <KV label="Solicitado" valor={fecha(cierre.created_at)} pie={espera(cierre.created_at)} />
                            {cierre.status === 'esperando_pago' && cierre.vence_at && (
                                <KV label="Plazo para pagar" valor={fecha(cierre.vence_at)} pie={restante(cierre.vence_at)} />
                            )}
                        </div>

                        <div style={{ borderTop: `1px solid ${BORDE}`, paddingTop: 16 }}>
                            <p style={{ ...ROTULO, marginBottom: 9 }}>Cliente</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: TXT }}>
                                <User size={13} style={{ color: TXT3 }} /> {cliente?.company_name ?? cliente?.full_name ?? '—'}
                            </div>
                            <p style={{ fontSize: 12, color: TXT2, marginTop: 3 }}>{cliente?.email ?? '—'}</p>
                            {cliente?.kyc_status && (
                                <span style={{ display: 'inline-block', marginTop: 8, padding: '3px 9px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', color: TXT2, border: `1px solid ${BORDE2}` }}>
                                    KYC {String(cliente.kyc_status).toUpperCase()}
                                </span>
                            )}
                        </div>

                        <div style={{ borderTop: `1px solid ${BORDE}`, paddingTop: 16 }}>
                            <p style={{ ...ROTULO, marginBottom: 9 }}>Dónde se le acredita</p>
                            <div style={{ background: ELEVADO, border: `1px solid ${BORDE}`, borderRadius: 11, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                                {cierre.payout?.tipo === 'saldo' && (
                                    <>
                                        <Fila icon={Wallet} label="Billetera" valor={BILLETERA[cierre.payout.wallet] ?? cierre.payout.wallet} />
                                        <p style={{ fontSize: 11, color: TXT3, lineHeight: 1.5, marginTop: 2 }}>
                                            Se acredita en la cuenta del cliente. No sale plata hacia ningún banco: si después
                                            la quiere afuera, la manda él desde Enviar dinero, con sus topes y destinatarios.
                                        </p>
                                    </>
                                )}
                                {cierre.payout?.tipo === 'lincoin' && <Fila icon={Wallet} label="Billetera" valor="Saldo Lincoin" />}
                                {cierre.payout?.tipo === 'breb' && (
                                    <>
                                        <Fila icon={Zap}  label="Riel"  valor="Bre-B" />
                                        <Fila icon={Hash} label="Llave" valor={cierre.payout.llave} mono onCopy={() => copiar(String(cierre.payout.llave ?? ''))} />
                                    </>
                                )}
                                {(cierre.payout?.tipo === 'ach' || cierre.payout?.tipo === 'banco') && (
                                    <>
                                        <Fila icon={Landmark} label="Banco"   valor={cierre.payout.banco} />
                                        <Fila icon={Hash}     label="Cuenta"  valor={cierre.payout.cuenta} mono onCopy={() => copiar(String(cierre.payout.cuenta ?? ''))} />
                                        <Fila icon={User}     label="Titular" valor={cierre.payout.titular} />
                                    </>
                                )}
                                {cierre.payout?.tipo === 'wallet' && (
                                    <>
                                        <Fila icon={Wallet} label="Red"       valor={cierre.payout.red} />
                                        <Fila icon={Hash}   label="Dirección" valor={cierre.payout.direccion} mono onCopy={() => copiar(String(cierre.payout.direccion ?? ''))} />
                                    </>
                                )}
                                {!cierre.payout?.tipo && <p style={{ fontSize: 12, color: TXT3 }}>Sin datos de destino.</p>}
                            </div>
                        </div>

                        {/* Notas internas — el cliente no las ve, y se dice */}
                        <div style={{ borderTop: `1px solid ${BORDE}`, paddingTop: 16 }}>
                            <p style={{ ...ROTULO, marginBottom: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Lock size={10} /> Notas internas · el cliente no las ve
                            </p>
                            <textarea
                                value={notas}
                                onChange={e => { setNotas(e.target.value); setNotasGuardadas(false); }}
                                onBlur={async () => { if (!notasGuardadas) { await callMesa('notas', { id, notas }); setNotasGuardadas(true); } }}
                                rows={2}
                                placeholder="Contexto para el resto de la mesa…"
                                style={{ ...INPUT, fontSize: 12.5, resize: 'vertical' }}
                            />
                            {notasGuardadas && <p style={{ fontSize: 10.5, color: VERDE, marginTop: 5 }}>Guardado.</p>}
                        </div>
                    </div>
                </div>

                {/* ── Derecha: hilo + acciones ── */}
                <div className="md:w-[48%] flex flex-col min-h-0" style={{ background: PANEL }}>
                    <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <MessageSquare size={15} style={{ color: TXT3, flexShrink: 0 }} />
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: mia ? TXT : TXT2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {mia ? `Atiende ${cierre.tomada_por_nom ?? 'la mesa'}` : 'Sin tomar'}
                            </span>
                        </div>
                        <button onClick={onClose} className="transition-colors hover:bg-white/[0.07]"
                            style={{ padding: 6, borderRadius: 8, color: TXT2, flexShrink: 0, background: 'transparent', border: 'none' }}>
                            <X size={17} />
                        </button>
                    </div>

                    {aviso && (
                        <div style={{ margin: '12px 16px 0', display: 'flex', alignItems: 'flex-start', gap: 7, border: `1px solid ${AMBAR}44`, background: `${AMBAR}10`, borderRadius: 9, padding: '9px 11px' }}>
                            <AlertTriangle size={13} style={{ color: AMBAR, marginTop: 1, flexShrink: 0 }} />
                            <p style={{ fontSize: 12, color: TXT, lineHeight: 1.5 }}>{aviso}</p>
                        </div>
                    )}

                    <div className="flex-1 overflow-auto" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 180 }}>
                        {msgs.map(m => <Burbuja key={m.id} m={m} onVer={setLupa} />)}
                        <div ref={finRef} />
                    </div>

                    {/* Tomar primero: sin dueño no se habla ni se opera */}
                    {bloqueado && (
                        <div style={{ padding: '16px', borderTop: `1px solid ${BORDE}` }}>
                            <p style={{ fontSize: 12, color: TXT2, marginBottom: 10, lineHeight: 1.5 }}>
                                Tomá el cierre para escribirle al cliente y operarlo. Queda a tu nombre para que nadie más conteste en paralelo.
                            </p>
                            <button onClick={() => hacer('tomar')} disabled={ocupado}
                                className="lincoin-btn-white transition-colors"
                                style={{ width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700, opacity: ocupado ? 0.5 : 1 }}>
                                {ocupado ? 'Tomando…' : 'Tomar este cierre'}
                            </button>
                        </div>
                    )}

                    {viva && mia && (
                        <>
                            <div style={{ padding: '14px 16px', borderTop: `1px solid ${BORDE}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {['abierta', 'en_proceso', 'esperando_pago'].includes(cierre.status) && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <p style={ROTULO}>
                                            {cierre.status === 'esperando_pago' ? 'Corregir tasa e instrucciones' : 'Confirmar tasa y dar instrucciones'}
                                        </p>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input
                                                value={tasaInput}
                                                onChange={e => setTasaInput(e.target.value)}
                                                inputMode="decimal"
                                                placeholder="Tasa final"
                                                style={{ ...INPUT, fontFamily: 'ui-monospace, monospace' }}
                                            />
                                            <button
                                                onClick={async () => {
                                                    const n = Number(String(tasaInput).replace(/[^\d.]/g, ''));
                                                    if (!(n > 0)) { setAviso('Escribí la tasa final.'); return; }
                                                    if (await hacer('fijar_tasa', { rateFinal: n, instrucciones })) setInstrucciones('');
                                                }}
                                                disabled={ocupado}
                                                className="transition-colors hover:bg-white/[0.1]"
                                                style={{ flexShrink: 0, padding: '0 15px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, color: TXT, background: 'rgba(255,255,255,0.07)', border: `1px solid ${BORDE2}`, opacity: ocupado ? 0.5 : 1 }}
                                            >
                                                Confirmar
                                            </button>
                                        </div>
                                        <textarea
                                            value={instrucciones}
                                            onChange={e => setInstrucciones(e.target.value)}
                                            rows={2}
                                            placeholder="Instrucciones de pago para el cliente (se le envían por el chat)"
                                            style={{ ...INPUT, fontSize: 12.5, resize: 'vertical' }}
                                        />
                                    </div>
                                )}

                                {cierre.status === 'pagada' && (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, border: `1px solid ${AMBAR}44`, background: `${AMBAR}10`, borderRadius: 9, padding: '10px 12px' }}>
                                        <AlertTriangle size={13} style={{ color: AMBAR, marginTop: 1, flexShrink: 0 }} />
                                        <p style={{ fontSize: 12, color: TXT, lineHeight: 1.5 }}>
                                            El cliente marcó el envío. <b>Verificalo en tu banco o en la cadena antes de completar</b> — lo que él marque no es prueba de que el dinero llegó.
                                        </p>
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        onClick={() => {
                                            if (!cierre.rate_final) { setAviso('Fijá la tasa final antes de completar.'); return; }
                                            setPide('completar');
                                        }}
                                        disabled={ocupado}
                                        className="transition-colors"
                                        style={{ flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#0C0E0D', background: VERDE, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: ocupado ? 0.5 : 1 }}
                                    >
                                        <CheckCircle2 size={14} /> Completar
                                    </button>
                                    <button
                                        onClick={() => setPide('cancelar')}
                                        disabled={ocupado}
                                        className="transition-colors hover:bg-white/[0.04]"
                                        style={{ padding: '11px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: ROJO, background: 'transparent', border: `1px solid ${ROJO}44`, opacity: ocupado ? 0.5 : 1 }}
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>

                            {/* Composer */}
                            <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: `1px solid ${BORDE}` }}>
                                <input
                                    value={texto}
                                    onChange={e => setTexto(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                                    placeholder="Escribile al cliente…"
                                    style={INPUT}
                                />
                                <button onClick={enviar} disabled={ocupado || !texto.trim()}
                                    style={{ flexShrink: 0, width: 40, borderRadius: 9, background: texto.trim() ? VERDE : 'rgba(255,255,255,0.06)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {ocupado ? <RefreshCw size={15} className="animate-spin" style={{ color: '#0C0E0D' }} /> : <Send size={15} style={{ color: texto.trim() ? '#0C0E0D' : TXT2 }} />}
                                </button>
                            </div>
                        </>
                    )}

                    {!viva && (
                        <div style={{ padding: '14px 18px', borderTop: `1px solid ${BORDE}`, fontSize: 12, color: TXT3, lineHeight: 1.5 }}>
                            {cierre.status === 'completada'
                                ? <>Completado el {fecha(cierre.completada_at)}. El hilo queda como registro.</>
                                : <>Cancelado el {fecha(cierre.cancelada_at)}{cierre.motivo_cierre ? ` — ${cierre.motivo_cierre}` : ''}.</>}
                        </div>
                    )}
                </div>
            </div>

            {lupa && <Lupa url={lupa} onCerrar={() => setLupa(null)} />}

            {/* Confirmación de completar / cancelar */}
            {pide && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={e => { e.stopPropagation(); setPide(null); setMotivo(''); }}>
                    <div style={{ background: PANEL, border: `1px solid ${BORDE2}`, borderRadius: 16, padding: 22, width: '100%', maxWidth: 400 }} onClick={e => e.stopPropagation()}>
                        {pide === 'completar' ? (
                            <>
                                <h4 style={{ fontSize: 16, fontWeight: 800, color: TXT, letterSpacing: '-0.3px' }}>Completar {cierre.ref}</h4>
                                <p style={{ fontSize: 12, color: TXT2, marginTop: 4 }}>Esto acredita el saldo y cierra la operación.</p>
                                <div style={{ marginTop: 14, background: ELEVADO, border: `1px solid ${BORDE}`, borderRadius: 11, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                                    <Fila icon={Wallet} label="Se acredita" valor={`${nf(cierre.to_amount, 0)} ${cierre.to_currency}`} />
                                    <Fila icon={Landmark} label="En" valor={BILLETERA[cierre.payout?.wallet] ?? (cierre.payout?.wallet ?? '—')} />
                                    <Fila icon={Hash} label="A la tasa" valor={nf(cierre.rate_final)} />
                                </div>
                                <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                                    <AlertTriangle size={13} style={{ color: AMBAR, marginTop: 1, flexShrink: 0 }} />
                                    <p style={{ fontSize: 11.5, color: TXT2, lineHeight: 1.5 }}>
                                        Verificá que el envío del cliente haya llegado. Lo que él marque no es prueba de que el dinero entró.
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                    <button onClick={() => setPide(null)} className="transition-colors hover:bg-white/[0.06]"
                                        style={{ padding: '11px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: TXT2, background: 'transparent', border: 'none' }}>
                                        Volver
                                    </button>
                                    <button onClick={async () => { setPide(null); await hacer('completar'); }} disabled={ocupado}
                                        style={{ flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#0C0E0D', background: VERDE, border: 'none', opacity: ocupado ? 0.5 : 1 }}>
                                        Sí, acreditar y completar
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h4 style={{ fontSize: 16, fontWeight: 800, color: TXT, letterSpacing: '-0.3px' }}>Cancelar {cierre.ref}</h4>
                                <p style={{ fontSize: 12, color: TXT2, marginTop: 4 }}>El motivo queda en el hilo y el cliente lo ve.</p>
                                <textarea
                                    autoFocus
                                    value={motivo}
                                    onChange={e => setMotivo(e.target.value)}
                                    rows={3}
                                    placeholder="Ej: el comprobante no corresponde al monto acordado"
                                    style={{ ...INPUT, fontSize: 12.5, marginTop: 12, resize: 'vertical' }}
                                />
                                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                    <button onClick={() => { setPide(null); setMotivo(''); }} className="transition-colors hover:bg-white/[0.06]"
                                        style={{ padding: '11px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: TXT2, background: 'transparent', border: 'none' }}>
                                        Volver
                                    </button>
                                    <button
                                        onClick={async () => { const m = motivo.trim(); if (!m) return; setPide(null); setMotivo(''); await hacer('cancelar_mesa', { motivo: m }); }}
                                        disabled={ocupado || !motivo.trim()}
                                        style={{ flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, color: motivo.trim() ? '#0C0E0D' : TXT2, background: motivo.trim() ? ROJO : 'rgba(255,255,255,0.06)', border: 'none', opacity: ocupado ? 0.5 : 1 }}>
                                        Cancelar el cierre
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// La mesa tiene que VER el comprobante para verificar el ingreso, no abrirlo en
// otra pestaña: comparar lo que dice el papel con lo que dice la orden exige
// tener las dos cosas a la vista.
//
// La URL firmada no siempre delata la extensión, así que se intenta pintar como
// imagen y recién si el navegador no puede se cae al enlace. Probar, no adivinar.
const Adjunto: React.FC<{ url: string; onVer?: (url: string) => void }> = ({ url, onVer }) => {
    const [falla, setFalla] = useState(false);
    const esPdf = /\.pdf(\?|$)/i.test(url);
    if (esPdf || falla) {
        return (
            <a href={url} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 7, padding: '8px 11px', borderRadius: 9, border: `1px solid ${BORDE2}`, background: 'rgba(255,255,255,0.05)', fontSize: 12, color: TXT, fontWeight: 600 }}>
                <Paperclip size={12} /> {esPdf ? 'Abrir comprobante (PDF)' : 'Abrir comprobante'}
            </a>
        );
    }
    return (
        <button onClick={() => onVer?.(url)} title="Ampliar"
            style={{ display: 'block', width: '100%', marginTop: 7, padding: 0, border: 'none', background: 'transparent', cursor: 'zoom-in' }}>
            <img src={url} alt="Comprobante" onError={() => setFalla(true)}
                style={{ display: 'block', width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 9, border: `1px solid ${BORDE2}`, background: 'rgba(0,0,0,0.35)' }} />
        </button>
    );
};

const Lupa: React.FC<{ url: string; onCerrar: () => void }> = ({ url, onCerrar }) => (
    <div onClick={e => { e.stopPropagation(); onCerrar(); }}
        className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.93)' }}>
        <button onClick={e => { e.stopPropagation(); onCerrar(); }} aria-label="Cerrar"
            style={{ position: 'absolute', top: 16, right: 16, width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.12)', border: 'none', color: TXT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} />
        </button>
        <img src={url} alt="Comprobante" onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }} />
    </div>
);

const KV: React.FC<{ label: string; valor: string; pie?: string }> = ({ label, valor, pie }) => (
    <div>
        <p style={ROTULO}>{label}</p>
        <p style={{ fontSize: 14, fontWeight: 700, color: TXT, marginTop: 3 }}>{valor}</p>
        {pie && <p style={{ fontSize: 10.5, color: TXT3, marginTop: 2 }}>{pie}</p>}
    </div>
);

const Fila: React.FC<{ icon: any; label: string; valor: any; mono?: boolean; onCopy?: () => void }> = ({ icon: Icon, label, valor, mono, onCopy }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <Icon size={12} style={{ color: TXT3, flexShrink: 0 }} />
        <span style={{ color: TXT2, minWidth: 68 }}>{label}</span>
        <span style={{ flex: 1, color: TXT, wordBreak: 'break-all', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{valor ?? '—'}</span>
        {onCopy && (
            <button onClick={onCopy} title="Copiar" className="transition-colors hover:bg-white/[0.08]"
                style={{ padding: 4, borderRadius: 6, color: TXT3, background: 'transparent', border: 'none', flexShrink: 0 }}>
                <Copy size={11} />
            </button>
        )}
    </div>
);

const Burbuja: React.FC<{ m: any; onVer?: (url: string) => void }> = ({ m, onVer }) => {
    // El mensaje de sistema va centrado y sin burbuja: narra lo que pasó, no lo
    // dijo nadie. Mezclarlo con los de la mesa haría creer que un operador
    // escribió "tasa confirmada" cuando lo escribió el propio flujo.
    if (m.autor === 'sistema') {
        return <p style={{ textAlign: 'center', fontSize: 11.5, color: TXT3, lineHeight: 1.5, padding: '2px 14px' }}>{m.body}</p>;
    }
    const deLaMesa = m.autor === 'mesa';
    return (
        <div style={{ display: 'flex', justifyContent: deLaMesa ? 'flex-end' : 'flex-start' }}>
            <div style={{
                maxWidth: '82%', padding: '9px 12px', borderRadius: 12,
                background: deLaMesa ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.055)',
                border: `1px solid ${deLaMesa ? 'rgba(74,222,128,0.22)' : BORDE}`,
            }}>
                <p style={{ fontSize: 9.5, fontWeight: 700, color: deLaMesa ? VERDE : TXT2, marginBottom: 3, letterSpacing: '0.4px' }}>
                    {deLaMesa ? (m.autor_nom ?? 'MESA').toUpperCase() : 'CLIENTE'}
                </p>
                {m.body && <p style={{ fontSize: 13, color: TXT, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</p>}
                {m.adjunto_url && <Adjunto url={m.adjunto_url} onVer={onVer} />}
                <p style={{ fontSize: 10, color: TXT3, marginTop: 4, textAlign: 'right' }}>{fecha(m.created_at)}</p>
            </div>
        </div>
    );
};
