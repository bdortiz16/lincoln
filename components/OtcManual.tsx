import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowLeftRight, Send, RefreshCw, ChevronLeft, MessageSquare,
    CheckCircle2, Clock, XCircle, AlertTriangle, Landmark, Wallet, Paperclip,
} from 'lucide-react';
import { FinityRateChart } from './FinityRateChart';

// ─────────────────────────────────────────────
// OtcManual — Mesa OTC manual del cliente.
//
// El riel ACH convierte solo. Este no: el cliente dice cuanto quiere mover, la
// mesa confirma a que tasa lo toma, se acuerdan las instrucciones, alguien
// paga, la mesa libera. Esa conversacion pasa acá adentro, pegada a la orden —
// no en un chat de soporte aparte, porque lo que hay que poder releer despues
// es el hilo de ESTE cierre.
//
// LA TASA QUE SE MUESTRA ES INDICATIVA, Y SE DICE
//   La pantalla cotiza con la tasa viva, pero la operacion tarda minutos y se
//   negocia. Presentar ese numero como precio cerrado seria prometer algo que
//   no se sostiene: se muestra como indicativa y la final la fija la mesa en
//   el hilo. Cuando la mesa la fija, la pantalla pasa a mostrar ESA.
// ─────────────────────────────────────────────

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

function authHeader(): string {
    try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) {
            const d = JSON.parse(localStorage.getItem(k) || '{}');
            if (d.access_token) return `Bearer ${d.access_token}`;
        }
    } catch { /* sin sesión supabase */ }
    return `Bearer ${SKEY}`;
}

export async function callOtcMesa(action: string, body: Record<string, unknown> = {}): Promise<any> {
    try {
        const r = await fetch(`${SURL}/functions/v1/otc-mesa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader() },
            body: JSON.stringify({ action, ...body }),
            signal: AbortSignal.timeout(25000),
        });
        const t = await r.text();
        if (!t) return { ok: false, error: 'El servicio no respondió. Reintentá.' };
        try { return JSON.parse(t); } catch { return { ok: false, error: `Respuesta no válida (HTTP ${r.status})` }; }
    } catch (e: any) {
        return { ok: false, error: e?.name === 'TimeoutError' ? 'La mesa tardó demasiado en responder.' : `Error de red: ${String(e?.message ?? e)}` };
    }
}

// ─── Estados, con su cara ───────────────────────────────
const ESTADO: Record<string, { label: string; color: string; borde: string; fondo: string; Icon: any }> = {
    abierta:        { label: 'ESPERANDO A LA MESA', color: '#FBBF24', borde: 'rgba(251,191,36,0.4)',  fondo: 'rgba(251,191,36,0.07)', Icon: Clock },
    en_proceso:     { label: 'EN PROCESO',          color: '#FBBF24', borde: 'rgba(251,191,36,0.4)',  fondo: 'rgba(251,191,36,0.07)', Icon: MessageSquare },
    esperando_pago: { label: 'ESPERANDO PAGO',      color: '#4ADE80', borde: 'rgba(74,222,128,0.45)', fondo: 'rgba(74,222,128,0.07)', Icon: Send },
    pagada:         { label: 'VERIFICANDO',         color: '#FBBF24', borde: 'rgba(251,191,36,0.4)',  fondo: 'rgba(251,191,36,0.07)', Icon: Clock },
    completada:     { label: 'COMPLETADA',          color: '#4ADE80', borde: 'rgba(74,222,128,0.45)', fondo: 'transparent',           Icon: CheckCircle2 },
    cancelada:      { label: 'CANCELADA',           color: '#F87171', borde: 'rgba(248,113,113,0.4)', fondo: 'transparent',           Icon: XCircle },
};
const caraDe = (s: string) => ESTADO[s] ?? { label: String(s ?? '—').toUpperCase(), color: '#878E88', borde: 'rgba(255,255,255,0.14)', fondo: 'transparent', Icon: Clock };

const nf = (n: number, dec = 2) => Number(n ?? 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: dec });
const fecha = (d: any) => {
    const t = new Date(d ?? '');
    if (!d || Number.isNaN(t.getTime())) return '—';
    return t.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const PANEL: React.CSSProperties = {
    background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16,
};
const INPUT: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, padding: '11px 13px', color: '#F4F4F2', fontSize: 14, outline: 'none',
    fontFamily: "'Archivo', system-ui, sans-serif",
};
const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#878E88', letterSpacing: '0.4px', textTransform: 'uppercase', display: 'block', marginBottom: 6 };

interface Props {
    userId: string;
    showToast?: (msg: string) => void;
    onVolver?: () => void;
    // Saldos COP del cliente, por codigo de billetera. Van a la vista junto a
    // cada opcion: elegir donde recibir sin ver cuanto hay en cada una obliga
    // a salir de la pantalla para decidir.
    saldos?: Record<string, number>;
    // Se llama UNA vez cuando un cierre pasa a completado. La mesa acredita del
    // lado del servidor, asi que sin este aviso el saldo de la pantalla queda
    // viejo hasta que el cliente recarga -- justo despues de recibir plata, que
    // es cuando mas mira el numero.
    onAcreditado?: (billetera: string, monto: number) => void;
}

export const OtcManual: React.FC<Props> = ({ userId, showToast, onVolver, saldos, onAcreditado }) => {
    const [vista, setVista] = useState<'nueva' | 'detalle'>('nueva');
    const [abierta, setAbierta] = useState<string | null>(null);
    const [cierres, setCierres] = useState<any[]>([]);
    const [cargando, setCargando] = useState(true);
    // Cierres por los que ya se aviso. Sin esto, cada relectura del hilo
    // volveria a sumar el saldo en la vista.
    const avisados = useRef<Set<string>>(new Set());
    const primeraLectura = useRef(true);

    const avisarAcreditado = useCallback((c: any) => {
        if (!c || c.status !== 'completada' || !c.id) return;
        if (avisados.current.has(c.id)) return;
        avisados.current.add(c.id);
        const billetera = String(c.payout?.wallet ?? (c.side === 'vende_usdt' ? 'COP' : 'USD'));
        const monto = Number(c.to_amount);
        if (monto > 0) onAcreditado?.(billetera, monto);
    }, [onAcreditado]);

    const cargarMios = useCallback(async () => {
        const r = await callOtcMesa('mios', { user_id: userId });
        if (r?.ok) {
            setCierres(r.cierres ?? []);
            // La primera lectura no avisa: son cierres viejos, ya contados en
            // el saldo que vino del servidor.
            if (primeraLectura.current) {
                for (const c of r.cierres ?? []) if (c.status === 'completada') avisados.current.add(c.id);
                primeraLectura.current = false;
            } else {
                for (const c of r.cierres ?? []) avisarAcreditado(c);
            }
        }
        setCargando(false);
    }, [userId, avisarAcreditado]);

    useEffect(() => { cargarMios(); }, [cargarMios]);

    if (vista === 'detalle' && abierta) {
        return (
            <DetalleCierre
                id={abierta}
                userId={userId}
                showToast={showToast}
                onCompletado={avisarAcreditado}
                onVolver={() => { setVista('nueva'); setAbierta(null); cargarMios(); }}
            />
        );
    }

    return (
        <div style={{ maxWidth: 620, margin: '0 auto', fontFamily: "'Archivo', system-ui, sans-serif" }}>
            {onVolver && (
                <button onClick={onVolver} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#878E88', marginBottom: 14 }}>
                    <ChevronLeft size={15} /> Elegir otro riel
                </button>
            )}

            <NuevoCierre
                userId={userId}
                showToast={showToast}
                saldos={saldos}
                onCreado={async (id) => { await cargarMios(); setAbierta(id); setVista('detalle'); }}
            />

            <div style={{ marginTop: 22 }}>
                <p style={{ ...LABEL, marginBottom: 10 }}>Mis cierres</p>
                {cargando && <p style={{ color: '#878E88', fontSize: 13 }}>Cargando…</p>}
                {!cargando && cierres.length === 0 && (
                    <div style={{ ...PANEL, padding: '22px 20px', textAlign: 'center' }}>
                        <p style={{ color: '#878E88', fontSize: 13 }}>Todavía no pediste ningún cierre.</p>
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cierres.map(c => {
                        const cara = caraDe(c.status);
                        const sinLeer = c.last_msg_por === 'mesa' && (!c.visto_cliente || new Date(c.last_msg_at) > new Date(c.visto_cliente));
                        return (
                            <button
                                key={c.id}
                                onClick={() => { setAbierta(c.id); setVista('detalle'); }}
                                className="text-left hover:bg-white/[0.03] transition-colors"
                                style={{ ...PANEL, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#878E88' }}>{c.ref}</span>
                                        <span style={{ border: `1px solid ${cara.borde}`, background: cara.fondo, color: cara.color, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.6px', padding: '2px 7px', borderRadius: 999 }}>
                                            {cara.label}
                                        </span>
                                        {sinLeer && (
                                            <span style={{ background: '#4ADE80', color: '#0C0E0D', fontSize: 8.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999 }}>
                                                NUEVO MENSAJE
                                            </span>
                                        )}
                                    </div>
                                    <p style={{ color: '#F4F4F2', fontSize: 14.5, fontWeight: 700, marginTop: 5 }}>
                                        {nf(c.from_amount)} {c.from_currency}
                                        <span style={{ color: '#878E88', fontWeight: 500 }}> → </span>
                                        {c.to_amount != null ? `${nf(c.to_amount, 0)} ${c.to_currency}` : <span style={{ color: '#878E88', fontWeight: 500, fontSize: 13 }}>a cotizar</span>}
                                    </p>
                                    <p style={{ color: 'rgba(244,244,242,0.45)', fontSize: 11.5, marginTop: 3 }}>{fecha(c.created_at)}</p>
                                </div>
                                <ChevronLeft size={16} style={{ color: '#878E88', transform: 'rotate(180deg)', flexShrink: 0 }} />
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ─── Formulario de cotización ───────────────────────────
const NuevoCierre: React.FC<{ userId: string; showToast?: (m: string) => void; saldos?: Record<string, number>; onCreado: (id: string) => void }> = ({ userId, showToast, saldos, onCreado }) => {
    const [side, setSide]     = useState<'vende_usdt' | 'compra_usdt'>('vende_usdt');
    const [monto, setMonto]   = useState('');
    const [tasa, setTasa]     = useState<number | null>(null);
    const [referencia, setReferencia] = useState<number | null>(null);
    const [margenPct, setMargenPct]   = useState<number>(0.25);
    const [motivoSinTasa, setMotivoSinTasa] = useState<string | null>(null);
    const [cargandoTasa, setCargandoTasa]   = useState(true);
    // Billetera del cliente donde se le acredita lo que recibe. NO es un
    // envio: la mesa cambia una moneda por otra dentro de la cuenta. Sacar
    // esa plata hacia un banco es otra operacion, la de Enviar dinero, con
    // sus propios destinatarios y sus propios topes.
    const [destino, setDestino] = useState<'COP' | 'COP_BREB' | 'COP_ACH'>('COP');
    const [nota, setNota]     = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError]   = useState<string | null>(null);

    const pedirTasa = useCallback(async () => {
        setCargandoTasa(true);
        const r = await callOtcMesa('cotizar', { user_id: userId, side });
        if (r?.margenPct != null) setMargenPct(Number(r.margenPct));
        if (r?.ok && r.rate != null) {
            setTasa(Number(r.rate));
            setReferencia(r.referencia != null ? Number(r.referencia) : null);
            setMotivoSinTasa(null);
        } else {
            setTasa(null); setReferencia(null);
            // El servidor solo manda `motivo` cuando quien pregunta es la
            // mesa: nombra al proveedor. Para el cliente queda vacío y el
            // texto de abajo se lee igual de bien sin él.
            setMotivoSinTasa(r?.motivo ?? null);
        }
        setCargandoTasa(false);
    }, [userId, side]);

    // La tasa se refresca sola cada minuto: una cotización de hace diez
    // minutos en pantalla es peor que no tener ninguna.
    useEffect(() => {
        pedirTasa();
        const t = setInterval(pedirTasa, 60_000);
        return () => clearInterval(t);
    }, [pedirTasa]);

    const n = Number(String(monto).replace(/[^\d.]/g, ''));
    const montoOk = Number.isFinite(n) && n > 0;
    const recibe = (montoOk && tasa != null) ? (side === 'vende_usdt' ? n * tasa : n / tasa) : null;
    const envMoneda = side === 'vende_usdt' ? 'USDT' : 'COP';
    const recMoneda = side === 'vende_usdt' ? 'COP' : 'USDT';

    const enviar = async () => {
        setError(null);
        if (!montoOk) { setError('Escribí cuánto querés enviar.'); return; }
        setEnviando(true);
        const payout = side === 'compra_usdt'
            ? { tipo: 'saldo', wallet: 'USD' }
            : { tipo: 'saldo', wallet: destino };
        const r = await callOtcMesa('crear', { user_id: userId, side, fromAmount: n, payout, nota: nota.trim() });
        setEnviando(false);
        if (!r?.ok) {
            setError(r?.message ?? r?.error ?? 'No se pudo crear el cierre.');
            return;
        }
        showToast?.(`Cierre ${r.ref} enviado a la mesa.`);
        setMonto(''); setNota('');
        onCreado(r.id);
    };

    return (
        <div style={{ ...PANEL, padding: '22px 22px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <ArrowLeftRight size={17} style={{ color: '#4ADE80' }} />
                <h3 style={{ color: '#F4F4F2', fontWeight: 800, fontSize: 18, letterSpacing: '-0.4px' }}>Mesa OTC · Manual</h3>
            </div>
            <p style={{ color: '#878E88', fontSize: 12.5, marginTop: 5, lineHeight: 1.55 }}>
                Operación negociada con un asesor. Decinos cuánto querés mover y la mesa te confirma la tasa por el chat.
            </p>

            {/* El precio de referencia, a la vista y con su historial. Cerrar
                una operacion negociada sin ver como se viene moviendo la tasa
                es decidir a ciegas. */}
            <div style={{ marginTop: 16, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '11px 14px 8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#878E88', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        Referencia USD / COP
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 800, color: '#F4F4F2', letterSpacing: '-0.3px' }}>
                        {referencia != null ? nf(referencia) : '—'}
                    </span>
                </div>
                <FinityRateChart from="USD" to="COP" />
            </div>

            {/* Lado */}
            <div style={{ display: 'flex', gap: 7, marginTop: 16 }}>
                {([['vende_usdt', 'Vendo USDT'], ['compra_usdt', 'Compro USDT']] as const).map(([v, l]) => (
                    <button
                        key={v}
                        onClick={() => setSide(v)}
                        style={{
                            flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                            color: side === v ? '#0C0E0D' : '#878E88',
                            background: side === v ? '#F4F4F2' : 'rgba(255,255,255,0.045)',
                            border: side === v ? 'none' : '1px solid rgba(255,255,255,0.10)',
                        }}
                    >
                        {l}
                    </button>
                ))}
            </div>

            {/* Envías / Recibís */}
            <div style={{ marginTop: 16 }}>
                <label style={LABEL}>Envías</label>
                <div style={{ position: 'relative' }}>
                    <input
                        value={monto}
                        onChange={e => setMonto(e.target.value)}
                        inputMode="decimal"
                        placeholder="0"
                        style={{ ...INPUT, paddingRight: 68, fontSize: 19, fontWeight: 700 }}
                    />
                    <span style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: '#878E88', fontSize: 13, fontWeight: 700 }}>
                        {envMoneda}
                    </span>
                </div>
            </div>

            <div style={{ marginTop: 12 }}>
                <label style={LABEL}>Recibís (estimado)</label>
                <div style={{ ...INPUT, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
                    <span style={{ fontSize: 19, fontWeight: 700, color: recibe != null ? '#4ADE80' : '#878E88' }}>
                        {recibe != null ? nf(recibe, recMoneda === 'COP' ? 0 : 2) : '—'}
                    </span>
                    <span style={{ color: '#878E88', fontSize: 13, fontWeight: 700 }}>{recMoneda}</span>
                </div>
            </div>

            {/* Como se arma la tasa, a la vista. Un numero solo no deja
                comprobar nada; con referencia y margen el cliente puede
                verificar la cuenta el mismo. */}
            <div style={{ marginTop: 11 }}>
                {cargandoTasa ? (
                    <p style={{ color: '#878E88', fontSize: 12 }}>Consultando la tasa…</p>
                ) : tasa != null ? (
                    <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.02)' }}>
                            <Renglon k="Tasa de referencia" v={`${nf(referencia ?? 0)} COP/USD`} />
                            <Renglon k={`Margen Lincoin (${margenPct}%)`} v={`− ${nf((referencia ?? 0) * margenPct / 100)}`} />
                            <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '2px 0' }} />
                            <Renglon k="Tu tasa" v={`${nf(tasa)} COP/USD`} fuerte />
                        </div>
                        <p style={{ color: 'rgba(244,244,242,0.45)', fontSize: 11.5, marginTop: 7, lineHeight: 1.5 }}>
                            Indicativa: la mesa confirma la tasa final antes de que envíes nada.
                            <button onClick={pedirTasa} style={{ marginLeft: 6, color: '#4ADE80', textDecoration: 'underline', fontSize: 11.5 }}>actualizar</button>
                        </p>
                    </>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                        <AlertTriangle size={13} style={{ color: '#FBBF24', marginTop: 1, flexShrink: 0 }} />
                        <p style={{ color: '#878E88', fontSize: 12, lineHeight: 1.5 }}>
                            No hay cotización automática en este momento{motivoSinTasa ? ` (${motivoSinTasa})` : ''}. Podés pedir el cierre igual: la mesa lo cotiza a mano.
                        </p>
                    </div>
                )}
            </div>

            {/* Dónde recibe */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                {side === 'vende_usdt' ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                            <Landmark size={14} style={{ color: '#878E88' }} />
                            <span style={{ fontSize: 12.5, color: '#F4F4F2', fontWeight: 600 }}>En qué billetera querés el COP</span>
                        </div>
                        <p style={{ fontSize: 11.5, color: '#878E88', marginBottom: 11, lineHeight: 1.5 }}>
                            Se acredita en tu cuenta. Sacarlo hacia un banco es aparte, desde Enviar dinero.
                        </p>
                        {/* Los mismos tres rieles, con los mismos nombres, que
                            en la billetera Peso colombiano. Si acá se llamaran
                            distinto habría que traducir mentalmente entre dos
                            pantallas para saber dónde va a caer la plata. */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                            {([
                                ['COP',      'Saldo Lincoin', 'Cuenta principal'],
                                ['COP_BREB', 'Bre-B',         'Pagos inmediatos'],
                                ['COP_ACH',  'ACH',           'Interbancario'],
                            ] as const).map(([v, l, pie]) => (
                                <button
                                    key={v}
                                    onClick={() => setDestino(v)}
                                    className="text-left transition-colors"
                                    style={{
                                        padding: '10px 11px', borderRadius: 10,
                                        border: `1px solid ${destino === v ? 'rgba(74,222,128,0.45)' : 'rgba(255,255,255,0.10)'}`,
                                        background: destino === v ? 'rgba(74,222,128,0.07)' : 'rgba(255,255,255,0.025)',
                                    }}
                                >
                                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: destino === v ? '#4ADE80' : '#F4F4F2' }}>{l}</span>
                                    <span style={{ display: 'block', fontSize: 10.5, color: '#878E88', marginTop: 2 }}>{pie}</span>
                                    {saldos?.[v] != null && (
                                        <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(244,244,242,0.45)', marginTop: 3 }}>
                                            {nf(saldos[v], 0)}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <Wallet size={14} style={{ color: '#878E88', marginTop: 2, flexShrink: 0 }} />
                        <div>
                            <span style={{ fontSize: 12.5, color: '#F4F4F2', fontWeight: 600, display: 'block' }}>El USDT va a tu saldo</span>
                            <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 3, lineHeight: 1.5 }}>
                                Se acredita en tu billetera USDT de Lincoin. Para mandarlo a una dirección externa, usá Enviar dinero.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <div style={{ marginTop: 14 }}>
                <label style={LABEL}>Mensaje para la mesa (opcional)</label>
                <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} placeholder="Ej: necesito cerrar hoy antes de las 4pm" style={{ ...INPUT, resize: 'vertical' }} />
            </div>

            {error && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 7, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.06)', borderRadius: 10, padding: '10px 12px' }}>
                    <AlertTriangle size={13} style={{ color: '#F87171', marginTop: 1, flexShrink: 0 }} />
                    <p style={{ color: '#F87171', fontSize: 12.5 }}>{error}</p>
                </div>
            )}

            <button
                onClick={enviar}
                disabled={enviando}
                className="lincoin-btn-white transition-colors"
                style={{ width: '100%', marginTop: 16, padding: '13px 0', borderRadius: 11, border: 'none', fontWeight: 700, fontSize: 14, opacity: enviando ? 0.6 : 1 }}
            >
                {enviando ? 'Enviando a la mesa…' : 'Solicitar cierre'}
            </button>
            <p style={{ color: 'rgba(244,244,242,0.45)', fontSize: 11, textAlign: 'center', marginTop: 9, lineHeight: 1.5 }}>
                No se mueve nada de tu saldo al pedir el cierre. La mesa te escribe por el chat.
            </p>
        </div>
    );
};

// ─── Detalle + hilo ─────────────────────────────────────
const DetalleCierre: React.FC<{ id: string; userId: string; showToast?: (m: string) => void; onCompletado?: (c: any) => void; onVolver: () => void }> = ({ id, userId, showToast, onCompletado, onVolver }) => {
    const [cierre, setCierre]   = useState<any>(null);
    const [msgs, setMsgs]       = useState<any[]>([]);
    const [texto, setTexto]     = useState('');
    const [enviando, setEnviando] = useState(false);
    const [cargando, setCargando] = useState(true);
    const finRef = useRef<HTMLDivElement | null>(null);

    const cargar = useCallback(async () => {
        const r = await callOtcMesa('detalle', { user_id: userId, id });
        if (r?.ok) { setCierre(r.cierre); setMsgs(r.mensajes ?? []); onCompletado?.(r.cierre); }
        setCargando(false);
    }, [id, userId, onCompletado]);

    // Se releé cada 8 s mientras el cierre está vivo. Un hilo que solo se
    // actualiza al recargar la página no sirve para acordar una tasa.
    useEffect(() => {
        cargar();
        const t = setInterval(() => {
            setCierre((c: any) => {
                if (c && (c.status === 'completada' || c.status === 'cancelada')) return c;
                cargar();
                return c;
            });
        }, 8000);
        return () => clearInterval(t);
    }, [cargar]);

    useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

    const enviar = async () => {
        const t = texto.trim();
        if (!t || enviando) return;
        setEnviando(true);
        const r = await callOtcMesa('mensaje', { user_id: userId, id, body: t });
        setEnviando(false);
        if (r?.ok) { setTexto(''); cargar(); }
        else showToast?.(r?.message ?? r?.error ?? 'No se pudo enviar el mensaje.');
    };

    const accion = async (action: string, extra: Record<string, unknown> = {}) => {
        const r = await callOtcMesa(action, { user_id: userId, id, ...extra });
        if (r?.ok) { cargar(); showToast?.('Listo.'); }
        else showToast?.(r?.message ?? r?.error ?? 'No se pudo.');
    };

    if (cargando && !cierre) {
        return <div style={{ maxWidth: 620, margin: '0 auto', color: '#878E88', fontSize: 13, textAlign: 'center', padding: 40 }}>Cargando…</div>;
    }
    if (!cierre) {
        return (
            <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center', padding: 40 }}>
                <p style={{ color: '#878E88', fontSize: 13 }}>No pudimos abrir ese cierre.</p>
                <button onClick={onVolver} style={{ color: '#4ADE80', fontSize: 13, marginTop: 10, textDecoration: 'underline' }}>Volver</button>
            </div>
        );
    }

    const cara = caraDe(cierre.status);
    const tasaVigente = cierre.rate_final ?? cierre.rate_cotizada;
    const vivo = !['completada', 'cancelada'].includes(cierre.status);
    const enPago = cierre.status === 'esperando_pago';
    // Si ya subio comprobante se ve en el hilo. Es el mismo hecho que comprueba
    // el servidor antes de aceptar "ya pague".
    const tieneComprobante = msgs.some((m: any) => m.autor === 'cliente' && m.adjunto_url);

    return (
        <div style={{ maxWidth: 620, margin: '0 auto', fontFamily: "'Archivo', system-ui, sans-serif" }}>
            <button onClick={onVolver} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#878E88', marginBottom: 14 }}>
                <ChevronLeft size={15} /> Mis cierres
            </button>

            {/* Cabecera de la orden */}
            <div style={{ ...PANEL, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#878E88' }}>{cierre.ref}</span>
                    <div style={{ textAlign: 'right' }}>
                        <span style={{ border: `1px solid ${cara.borde}`, background: cara.fondo, color: cara.color, fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', padding: '3px 9px', borderRadius: 999 }}>
                            {cara.label}
                        </span>
                        {enPago && cierre.vence_at && <Contador hasta={cierre.vence_at} />}
                    </div>
                </div>
                <p style={{ color: '#F4F4F2', fontSize: 22, fontWeight: 800, marginTop: 10, letterSpacing: '-0.5px' }}>
                    {nf(cierre.from_amount)} {cierre.from_currency}
                    <span style={{ color: '#878E88', fontWeight: 500 }}> → </span>
                    {cierre.to_amount != null ? `${nf(cierre.to_amount, 0)} ${cierre.to_currency}` : <span style={{ color: '#878E88', fontSize: 16, fontWeight: 600 }}>a cotizar</span>}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <Dato label="Tasa" valor={tasaVigente != null ? nf(tasaVigente) : '—'}
                        pie={cierre.rate_final ? 'confirmada por la mesa' : cierre.rate_cotizada ? 'indicativa' : undefined} />
                    <Dato label="Solicitado" valor={fecha(cierre.created_at)} />
                    {(() => {
                        const d = destinoTexto(cierre.payout);
                        return d ? <Dato label={d.label} valor={d.valor} mono={d.mono} /> : null;
                    })()}
                    {cierre.payout?.tipo === 'ach' && <Dato label="Titular" valor={cierre.payout.titular ?? '—'} />}
                </div>
            </div>

            {/* Acciones del cliente */}
            {enPago && (
                <SubirComprobante
                    venceAt={cierre.vence_at}
                    yaSubido={tieneComprobante}
                    onSubir={async (archivo, nombre, tipo) => {
                        const r = await callOtcMesa('comprobante', { user_id: userId, id, archivo, nombre, tipo });
                        if (r?.ok) { cargar(); showToast?.('Comprobante subido.'); return null; }
                        return r?.message ?? r?.error ?? 'No se pudo subir el comprobante.';
                    }}
                    onMarcarPagado={async () => {
                        const r = await callOtcMesa('marcar_pagada', { user_id: userId, id });
                        if (r?.ok) { cargar(); showToast?.('Avisamos a la mesa. Están verificando el ingreso.'); return null; }
                        return r?.message ?? r?.error ?? 'No se pudo marcar como pagado.';
                    }}
                />
            )}
            {['abierta', 'en_proceso', 'esperando_pago'].includes(cierre.status) && (
                <button onClick={() => accion('cancelar')}
                    style={{ width: '100%', marginTop: 8, padding: '10px 0', borderRadius: 11, fontWeight: 600, fontSize: 12.5, color: '#F87171', background: 'transparent', border: '1px solid rgba(248,113,113,0.3)' }}>
                    Cancelar solicitud
                </button>
            )}

            {/* Hilo */}
            <div style={{ ...PANEL, marginTop: 14, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <MessageSquare size={14} style={{ color: '#878E88' }} />
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#F4F4F2' }}>Chat con la mesa</span>
                </div>
                <div style={{ maxHeight: 380, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {msgs.map(m => <Burbuja key={m.id} m={m} />)}
                    <div ref={finRef} />
                </div>
                {vivo ? (
                    <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                        <input
                            value={texto}
                            onChange={e => setTexto(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                            placeholder="Escribí a la mesa…"
                            style={{ ...INPUT, fontSize: 13.5 }}
                        />
                        <button onClick={enviar} disabled={enviando || !texto.trim()}
                            style={{ flexShrink: 0, width: 42, borderRadius: 10, background: texto.trim() ? '#4ADE80' : 'rgba(255,255,255,0.06)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {enviando ? <RefreshCw size={15} className="animate-spin" style={{ color: '#0C0E0D' }} /> : <Send size={15} style={{ color: texto.trim() ? '#0C0E0D' : '#878E88' }} />}
                        </button>
                    </div>
                ) : (
                    <p style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.07)', color: 'rgba(244,244,242,0.45)', fontSize: 12 }}>
                        Este cierre está {cierre.status === 'completada' ? 'completado' : 'cancelado'}. El hilo queda como registro.
                    </p>
                )}
            </div>
        </div>
    );
};

// Segundos que faltan para una fecha, vivos. El contador de pantalla es
// informativo: quien decide si llego a tiempo es el servidor, porque un reloj
// de navegador se para, se adelanta o se edita.
function useCuentaAtras(hasta: string | null | undefined): number | null {
    const [seg, setSeg] = useState<number | null>(null);
    useEffect(() => {
        if (!hasta) { setSeg(null); return; }
        const calc = () => setSeg(Math.max(0, Math.floor((new Date(hasta).getTime() - Date.now()) / 1000)));
        calc();
        const t = setInterval(calc, 1000);
        return () => clearInterval(t);
    }, [hasta]);
    return seg;
}
const reloj = (seg: number) => `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;

// ─── Comprobante, contra reloj ──────────────────────────
// El comprobante es OBLIGATORIO: "ya pagué" sin respaldo obliga a la mesa a
// salir a buscar en el banco un pago del que solo sabe que alguien dice que
// existe. Y hay plazo, porque la tasa acordada no se sostiene mientras el
// mercado se mueve.
//
// El contador de esta pantalla es informativo. Quien decide si llegó a tiempo
// es el servidor: un reloj del navegador se para, se adelanta o se edita.
const SubirComprobante: React.FC<{
    venceAt: string | null;
    yaSubido: boolean;
    onSubir: (archivo: string, nombre: string, tipo: string) => Promise<string | null>;
    onMarcarPagado: () => Promise<string | null>;
}> = ({ venceAt, yaSubido, onSubir, onMarcarPagado }) => {
    const restante = useCuentaAtras(venceAt);
    const [subiendo, setSubiendo] = useState(false);
    const [marcando, setMarcando] = useState(false);
    const [error, setError]   = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const elegir = async (f: File | null | undefined) => {
        if (!f) return;
        setError(null);
        if (f.size > 5 * 1024 * 1024) { setError('El comprobante no puede pesar más de 5 MB.'); return; }
        setSubiendo(true);
        try {
            const b64: string = await new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res(String(fr.result ?? ''));
                fr.onerror = () => rej(new Error('no se pudo leer el archivo'));
                fr.readAsDataURL(f);
            });
            const msg = await onSubir(b64, f.name, f.type);
            if (msg) setError(msg);
        } catch (e: any) {
            setError(e?.message ?? 'No se pudo leer el archivo.');
        }
        setSubiendo(false);
        if (fileRef.current) fileRef.current.value = '';
    };

    const marcar = async () => {
        setError(null); setMarcando(true);
        const msg = await onMarcarPagado();
        if (msg) setError(msg);
        setMarcando(false);
    };

    const vencido = restante === 0;

    return (
        <div style={{ ...PANEL, marginTop: 10, padding: '16px 18px' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>Envía y subí el comprobante</p>
            <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 5, lineHeight: 1.5 }}>
                {vencido
                    ? 'Se venció el plazo. Si ya enviaste el dinero, escribile a la mesa por el chat antes de montar otra solicitud.'
                    : 'Tiene que verse el monto enviado. Imagen o PDF, hasta 5 MB.'}
            </p>

            <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={e => elegir(e.target.files?.[0])}
                style={{ display: 'none' }}
            />

            {/* Paso 1: el comprobante. Paso 2: avisar. Separados porque son dos
                hechos distintos -- tener la prueba y declarar que ya pago -- y
                juntarlos obligaba a subir de nuevo para corregir cualquier cosa. */}
            <button
                onClick={() => fileRef.current?.click()}
                disabled={subiendo || vencido}
                style={{
                    width: '100%', marginTop: 12, padding: '11px 0', borderRadius: 11,
                    border: `1px solid ${yaSubido ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.14)'}`,
                    background: yaSubido ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.05)',
                    color: yaSubido ? '#4ADE80' : '#F4F4F2',
                    fontWeight: 700, fontSize: 13, opacity: (subiendo || vencido) ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                }}
            >
                {subiendo
                    ? <><RefreshCw size={15} className="animate-spin" /> Subiendo…</>
                    : yaSubido
                        ? <><CheckCircle2 size={15} /> Comprobante subido · cambiar</>
                        : <><Paperclip size={15} /> Subir comprobante</>}
            </button>

            <button
                onClick={marcar}
                disabled={!yaSubido || marcando || vencido}
                className={yaSubido && !vencido ? 'lincoin-btn-white transition-colors' : undefined}
                style={{
                    width: '100%', marginTop: 8, padding: '12px 0', borderRadius: 11, border: 'none',
                    fontWeight: 700, fontSize: 13.5,
                    ...(yaSubido && !vencido ? {} : { background: 'rgba(255,255,255,0.05)', color: '#878E88' }),
                    opacity: marcando ? 0.6 : 1,
                    cursor: (!yaSubido || vencido) ? 'not-allowed' : 'pointer',
                }}
            >
                {marcando ? 'Avisando a la mesa…' : 'Marcar como pagado'}
            </button>
            {!yaSubido && !vencido && (
                <p style={{ fontSize: 11, color: 'rgba(244,244,242,0.45)', textAlign: 'center', marginTop: 7 }}>
                    Primero subí el comprobante.
                </p>
            )}

            {error && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    <AlertTriangle size={13} style={{ color: '#F87171', marginTop: 1, flexShrink: 0 }} />
                    <p style={{ color: '#F87171', fontSize: 12, lineHeight: 1.5 }}>{error}</p>
                </div>
            )}
        </div>
    );
};

// El tiempo que queda, debajo del estado. Ambar en el ultimo minuto, rojo al
// vencer: el color tiene que cambiar antes de que sea tarde, no cuando ya lo es.
const Contador: React.FC<{ hasta: string }> = ({ hasta }) => {
    const seg = useCuentaAtras(hasta);
    if (seg == null) return null;
    const color = seg === 0 ? '#F87171' : seg <= 60 ? '#FBBF24' : '#4ADE80';
    return (
        <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 17, fontWeight: 800, color, marginTop: 6, letterSpacing: '-0.3px' }}>
            {seg === 0 ? 'vencido' : reloj(seg)}
        </p>
    );
};

const Renglon: React.FC<{ k: string; v: string; fuerte?: boolean }> = ({ k, v, fuerte }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 11.5, color: fuerte ? '#F4F4F2' : '#878E88', fontWeight: fuerte ? 700 : 500 }}>{k}</span>
        <span style={{ fontSize: fuerte ? 13.5 : 12, color: fuerte ? '#4ADE80' : '#878E88', fontWeight: fuerte ? 800 : 600 }}>{v}</span>
    </div>
);

// Como se describe cada destino del COP en el detalle del cierre.
export const NOMBRE_BILLETERA: Record<string, string> = {
    COP: 'Saldo Lincoin', COP_BREB: 'Bre-B', COP_ACH: 'ACH', USD: 'Saldo USDT',
};

export function destinoTexto(p: any): { label: string; valor: string; mono?: boolean } | null {
    if (!p?.tipo) return null;
    if (p.tipo === 'saldo') return { label: 'Se acredita en', valor: NOMBRE_BILLETERA[p.wallet] ?? String(p.wallet ?? '—') };
    // Formas viejas: cierres creados antes de que el destino fuera una
    // billetera propia. Se siguen mostrando para no romper el historial.
    if (p.tipo === 'lincoin') return { label: 'Se acredita en', valor: 'Peso Lincoin' };
    if (p.tipo === 'breb')    return { label: 'Llave Bre-B', valor: p.llave ?? '—', mono: true };
    if (p.tipo === 'ach' || p.tipo === 'banco') return { label: 'Cuenta', valor: `${p.banco ?? '—'} · ${p.cuenta ?? '—'}`, mono: true };
    if (p.tipo === 'wallet')  return { label: `Wallet ${p.red ?? ''}`.trim(), valor: p.direccion ?? '—', mono: true };
    return null;
}

const Dato: React.FC<{ label: string; valor: string; pie?: string; mono?: boolean }> = ({ label, valor, pie, mono }) => (
    <div>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(244,244,242,0.45)', letterSpacing: '0.4px', textTransform: 'uppercase' }}>{label}</p>
        <p style={{ fontSize: 13.5, color: '#F4F4F2', fontWeight: 600, marginTop: 3, wordBreak: 'break-all', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{valor}</p>
        {pie && <p style={{ fontSize: 10.5, color: '#878E88', marginTop: 1 }}>{pie}</p>}
    </div>
);

const Burbuja: React.FC<{ m: any }> = ({ m }) => {
    // El mensaje de sistema va centrado y sin burbuja: narra lo que pasó, no
    // lo dijo nadie. Mezclarlo con los de la mesa haría creer que un operador
    // escribió "tasa confirmada" cuando lo escribió el propio flujo.
    if (m.autor === 'sistema') {
        return (
            <p style={{ textAlign: 'center', fontSize: 11.5, color: 'rgba(244,244,242,0.45)', lineHeight: 1.5, padding: '2px 12px' }}>
                {m.body}
            </p>
        );
    }
    const mio = m.autor === 'cliente';
    return (
        <div style={{ display: 'flex', justifyContent: mio ? 'flex-end' : 'flex-start' }}>
            <div style={{
                maxWidth: '78%', padding: '9px 12px', borderRadius: 12,
                background: mio ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.055)',
                border: `1px solid ${mio ? 'rgba(74,222,128,0.22)' : 'rgba(255,255,255,0.09)'}`,
            }}>
                {!mio && <p style={{ fontSize: 10, fontWeight: 700, color: '#4ADE80', marginBottom: 3 }}>MESA LINCOIN</p>}
                {m.body && <p style={{ fontSize: 13.5, color: '#F4F4F2', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</p>}
                {m.adjunto_url && (
                    <a href={m.adjunto_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#4ADE80', textDecoration: 'underline', display: 'inline-block', marginTop: 5 }}>
                        Ver comprobante
                    </a>
                )}
                <p style={{ fontSize: 10, color: 'rgba(244,244,242,0.45)', marginTop: 4, textAlign: 'right' }}>{fecha(m.created_at)}</p>
            </div>
        </div>
    );
};
