import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowDown, Send, RefreshCw, ChevronLeft, MessageSquare,
    CheckCircle2, Clock, XCircle, AlertTriangle, Wallet, ShieldCheck, Paperclip, Plus, ChevronDown, ChevronUp, X, ScanLine,
} from 'lucide-react';
import { FinityRateChart } from './FinityRateChart';
import { llamarFuncion } from '../lib/edge';
import { hallazgosEnEspanol } from '../lib/kytTextos';
import { nombreCuenta } from '../lib/nombreCuenta';
import { Panel, Recarga, ESTILOS as ESTILOS_RISK } from './risk/RiskCliente';
import { EscanerQr } from './EscanerQr';
import { direccionDeQr } from '../lib/direccionQr';

// ─────────────────────────────────────────────
// OtcManual — Mesa OTC manual del cliente.
//
// El riel ACH convierte solo. Este no: el cliente dice cuanto quiere mover, la
// mesa confirma a que tasa lo toma, se acuerdan las instrucciones, alguien
// paga, la mesa libera. Esa conversacion pasa acá adentro, pegada a la orden —
// no en un chat de soporte aparte, porque lo que hay que poder releer despues
// es el hilo de ESTE cierre.
//
// LA TASA QUEDA FIJA AL PEDIR EL CIERRE, Y SE DICE
//   Antes la pantalla decía "indicativa: la mesa confirma la final", pero el
//   servidor fija la tasa cotizada al CREAR el cierre y desde ahí corre el
//   plazo de pago (otc-mesa 'crear'). Prometer una confirmación que no llega
//   deja al cliente esperando mientras se le vence el plazo (revisión del 23
//   nov). Ahora se dice lo que pasa: la tasa en vivo se fija al solicitar. La
//   mesa puede renegociarla en el hilo (fijar_tasa) y ahí el plazo vuelve a
//   empezar.
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
        if (!t) return { ok: false, error: 'El servicio no respondió. Intenta de nuevo.' };
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
    // Completada y después anulada por la mesa: lo acreditado se descontó.
    anulada:        { label: 'ANULADA',             color: '#F87171', borde: 'rgba(248,113,113,0.4)', fondo: 'transparent',           Icon: XCircle },
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
    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
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

    // onAcreditado llega como función nueva en cada render del tablero. Con
    // ella en las dependencias, cargarMios cambiaba en cada render y su efecto
    // volvía a pedir los cierres una y otra vez. Se lee desde una ref.
    const onAcreditadoRef = useRef(onAcreditado);
    onAcreditadoRef.current = onAcreditado;
    const avisarAcreditado = useCallback((c: any) => {
        if (!c || c.status !== 'completada' || !c.id) return;
        if (avisados.current.has(c.id)) return;
        avisados.current.add(c.id);
        const billetera = String(c.payout?.wallet ?? (c.side === 'vende_usdt' ? 'COP' : 'USD'));
        const monto = Number(c.to_amount);
        if (monto > 0) onAcreditadoRef.current?.(billetera, monto);
    }, []);

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
        <div style={{ fontFamily: "'Archivo', system-ui, sans-serif" }}>
            {onVolver && (
                <button onClick={onVolver} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#878E88', marginBottom: 14 }}>
                    <ChevronLeft size={15} /> Volver
                </button>
            )}
            <NuevoCierre
                userId={userId}
                showToast={showToast}
                saldos={saldos}
                onCreado={async (id) => { await cargarMios(); setAbierta(id); setVista('detalle'); }}
                lateral={<MisCierres cierres={cierres} cargando={cargando} onAbrir={(id) => { setAbierta(id); setVista('detalle'); }} />}
            />
        </div>
    );
};

// ─── Tus cierres (columna derecha, como "Tus últimas conversiones" de ACH) ─
const MisCierres: React.FC<{ cierres: any[]; cargando: boolean; onAbrir: (id: string) => void }> = ({ cierres, cargando, onAbrir }) => {
    const [todos, setTodos] = useState(false);
    const lista = todos ? cierres : cierres.slice(0, 5);
    return (
        <div style={{ ...PANEL, borderRadius: 14, padding: 20 }}>
            <p style={LBL_ACH}>TUS CIERRES</p>
            {cargando && <p style={{ color: '#878E88', fontSize: 12.5, marginTop: 10 }}>Cargando…</p>}
            {!cargando && cierres.length === 0 && (
                <p style={{ fontSize: 12.5, color: '#878E88', marginTop: 10, lineHeight: 1.5 }}>Tus cierres con la mesa aparecerán aquí, con su chat.</p>
            )}
            <div style={{ marginTop: 4 }}>
                {lista.map((c, i) => {
                    const cara = caraDe(c.status);
                    const sinLeer = c.last_msg_por === 'mesa' && (!c.visto_cliente || new Date(c.last_msg_at) > new Date(c.visto_cliente));
                    return (
                        <button key={c.id} onClick={() => onAbrir(c.id)} className="text-left w-full hover:bg-white/[0.03] transition-colors"
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 6px', margin: '0 -6px', borderRadius: 8, background: 'transparent', border: 'none', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {nf(c.from_amount)} {c.from_currency} → {c.to_currency}
                                </p>
                                <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{c.ref}</span> · {fecha(c.created_at)}
                                </p>
                                <span style={{ display: 'inline-flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                                    <span style={{ border: `1px solid ${cara.borde}`, background: cara.fondo, color: cara.color, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.6px', padding: '2px 7px', borderRadius: 999 }}>{cara.label}</span>
                                    {sinLeer && <span style={{ background: '#4ADE80', color: '#0C0E0D', fontSize: 8.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999 }}>NUEVO MENSAJE</span>}
                                </span>
                            </div>
                            <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: c.to_amount != null && c.status === 'completada' ? '#4ADE80' : '#F4F4F2', textAlign: 'right' }}>
                                {c.to_amount != null ? `${c.status === 'completada' ? '+' : ''}${nf(c.to_amount, c.to_currency === 'COP' ? 0 : 2)} ${c.to_currency}` : <span style={{ color: '#878E88', fontWeight: 500, fontSize: 12 }}>a cotizar</span>}
                            </span>
                        </button>
                    );
                })}
            </div>
            {cierres.length > 5 && (
                <button onClick={() => setTodos(t => !t)} style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: '#4ADE80' }}>
                    {todos ? 'Ver menos' : `Ver todos (${cierres.length})`}
                </button>
            )}
        </div>
    );
};

// ─── Formulario de cotización ───────────────────────────
// 23 nov: con el diseño de la conversión ACH (pedido del dueño: "mejor el
// diseño como era en ACH, hasta las banderas, y el cliente en COP sabía
// cuánto recibía"). La mesa manual quedó como el único riel de la Mesa OTC.
const LBL_ACH: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88', margin: 0 };
const BANDERA_CO = 'linear-gradient(180deg,#FCD116 0 50%,#003893 50% 75%,#CE1126 75%)';
const Moneda: React.FC<{ m: string }> = ({ m }) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 13px' }}>
        {m === 'COP'
            ? <span style={{ width: 20, height: 20, borderRadius: 999, background: BANDERA_CO, display: 'block' }} />
            : <span style={{ width: 20, height: 20, borderRadius: 999, background: '#26A17B', color: '#fff', fontSize: 12, fontWeight: 800, display: 'grid', placeItems: 'center' }}>₮</span>}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{m}</span>
    </span>
);
const Fila: React.FC<{ k: React.ReactNode; v: React.ReactNode; color?: string; suave?: boolean }> = ({ k, v, color, suave }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, color: '#878E88' }}>{k}</span>
        <span style={{ fontSize: 13, fontWeight: suave ? 600 : 700, color: color ?? (suave ? '#878E88' : '#F4F4F2'), textAlign: 'right' }}>{v}</span>
    </div>
);

// ── El monto con puntos de miles (23 nov) ──
// El dueño escribió 10.000 y la caja mostraba "10000", sin puntos. Ahora el
// monto se guarda limpio ("10000.5") y se muestra como en Colombia
// ("10.000,5"): punto de miles y coma decimal.
//
// AL ESCRIBIR, los puntos que hay en la caja son SIEMPRE de miles: los puso la
// pantalla. La primera versión adivinaba ("un punto con 1 o 2 cifras al final
// es decimal") y borrar un cero de "10.000" dejaba "10.00" → 10 USDT, y escribir
// "0." se comía el punto (0.5 salía 5). Un punto recién tecleado al final sí
// es la coma decimal (el teclado numérico del celular muchas veces solo trae
// punto). Lo pegado de otro lado se lee aparte (montoPegado).
const aCanonico = (txt: string, maxDec: number, antes = ''): string => {
    let t = String(txt ?? '').replace(/[^\d.,]/g, '');
    if (maxDec > 0 && t.endsWith('.') && t.length > antes.length && !t.slice(0, -1).includes(',')) t = `${t.slice(0, -1)},`;
    const coma = t.indexOf(',');
    const ent = (coma >= 0 ? t.slice(0, coma) : t).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (maxDec <= 0 || coma < 0) return ent;
    return `${ent || '0'}.${t.slice(coma + 1).replace(/\D/g, '').slice(0, maxDec)}`;
};
// Un monto PEGADO puede venir en cualquier formato: "1.234.567,89",
// "1,234,567.89", "10.5", "10,5". Con los dos separadores, el último es el
// decimal; con uno solo repetido, son miles; con uno solo seguido de tres
// cifras exactas, también son miles ("1.234" y "1,234"); si no, es decimal.
const montoPegado = (txt: string, maxDec: number): string => {
    const t = String(txt ?? '').replace(/[^\d.,]/g, '');
    const p = t.lastIndexOf('.'), c = t.lastIndexOf(',');
    let ent = t, dec: string | null = null;
    if (p >= 0 && c >= 0) { const i = Math.max(p, c); ent = t.slice(0, i); dec = t.slice(i + 1); }
    else if (p >= 0 || c >= 0) {
        const sep = p >= 0 ? '.' : ',';
        const i = Math.max(p, c);
        const tras = t.slice(i + 1);
        if (t.split(sep).length === 2 && tras.length !== 3) { ent = t.slice(0, i); dec = tras; }
    }
    ent = ent.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const d = (dec ?? '').replace(/\D/g, '').slice(0, maxDec);
    return maxDec > 0 && d ? `${ent || '0'}.${d}` : ent;
};
// Lo que recibe, con el MISMO redondeo del servidor (otc-mesa
// redondearRecibe): pesos enteros y USDT con 2 decimales, hacia abajo. Si la
// pantalla redondeara distinto, el cliente vería un número y le acreditarían
// otro.
const redondearRecibe = (v: number, moneda: string) => {
    const f = moneda === 'COP' ? 1 : 100;
    return Math.floor(v * f + 1e-6) / f;
};
const aPantalla = (c: string): string => {
    if (!c) return '';
    const [e, d] = c.split('.');
    const ent = Number(e || '0').toLocaleString('es-CO', { maximumFractionDigits: 0 });
    return d !== undefined ? `${ent},${d}` : ent;
};

const NuevoCierre: React.FC<{ userId: string; showToast?: (m: string) => void; saldos?: Record<string, number>; onCreado: (id: string) => void; lateral?: React.ReactNode }> = ({ userId, showToast, onCreado, lateral }) => {
    const [side, setSide]     = useState<'vende_usdt' | 'compra_usdt'>('vende_usdt');
    const [monto, setMonto]   = useState('');
    const [tasa, setTasa]     = useState<number | null>(null);
    const [referencia, setReferencia] = useState<number | null>(null);
    const [margenPct, setMargenPct]   = useState<number>(0.5);
    const [ajusteCop, setAjusteCop]   = useState<number>(0);
    const [motivoSinTasa, setMotivoSinTasa] = useState<string | null>(null);
    const [cargandoTasa, setCargandoTasa]   = useState(true);
    const [actualizadaAt, setActualizadaAt] = useState<Date | null>(null);
    // Desde el 19 nov el cliente ya NO elige en qué billetera recibe el COP:
    // la mesa decide el canal al acreditar. Lo que sí tiene que decir, para
    // vender USDT, es desde qué wallet los manda: se revisa su riesgo antes
    // de dejarle pedir el cierre (ver WalletOrigen y kyt otc_wallet).
    const [wallet, setWallet] = useState('');
    const [red, setRed]       = useState<RedOtc>('TRX');
    const [verif, setVerif]   = useState<any>(null);
    const [exigeWallet, setExigeWallet] = useState(true);
    const [nota, setNota]     = useState('');
    // Las consultas de Lincoin Risk: verificar la wallet gasta una (23 nov).
    const [cuentaRisk, setCuentaRisk] = useState<any>(null);
    const [comprando, setComprando] = useState(false);
    const leerCuentaRisk = useCallback(async () => {
        const r = await llamarFuncion('sarblock', { action: 'risk_cuenta' }, 30000).catch(() => null);
        if (r?.ok) setCuentaRisk(r);
    }, []);
    useEffect(() => { leerCuentaRisk(); }, [leerCuentaRisk]);
    const [enviando, setEnviando] = useState(false);
    const [error, setError]   = useState<string | null>(null);

    // Si la mesa está cerrada, el servidor lo dice al cotizar. No se deduce del
    // reloj del navegador: ese reloj lo pone el cliente.
    const [mesa, setMesa] = useState<{ abierta: boolean; proxima: string | null } | null>(null);
    const [ventanaMin, setVentanaMin] = useState<number | null>(null);

    // Cada pedido lleva un número y solo el último se pinta. Sin esto, cambiar
    // de "Vendo" a "Compro" con una cotización en vuelo dejaba la tasa de
    // VENTA en la pantalla de compra cuando llegaba tarde.
    const pedidoTasa = useRef(0);
    const pedirTasa = useCallback(async () => {
        const mio = ++pedidoTasa.current;
        setCargandoTasa(true);
        const r = await callOtcMesa('cotizar', { user_id: userId, side });
        if (mio !== pedidoTasa.current) return;
        if (r?.mesa) setMesa({ abierta: !!r.mesa.abierta, proxima: r.mesa.proxima ?? null });
        if (Number(r?.ventanaMin) > 0) setVentanaMin(Number(r.ventanaMin));
        if (r?.margenPct != null) setMargenPct(Number(r.margenPct));
        if (typeof r?.exigeWallet === 'boolean') setExigeWallet(r.exigeWallet);
        if (r?.ajusteCop != null) setAjusteCop(Number(r.ajusteCop));
        if (r?.ok && r.rate != null) {
            setTasa(Number(r.rate));
            setReferencia(r.referencia != null ? Number(r.referencia) : null);
            setMotivoSinTasa(null);
            setActualizadaAt(new Date());
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

    const n = Number(monto);
    const montoOk = Number.isFinite(n) && n > 0;
    const envMoneda = side === 'vende_usdt' ? 'USDT' : 'COP';
    const recMoneda = side === 'vende_usdt' ? 'COP' : 'USDT';
    const recibe = (montoOk && tasa != null) ? redondearRecibe(side === 'vende_usdt' ? n * tasa : n / tasa, recMoneda) : null;
    const plazoTxt = ventanaMin ? `${ventanaMin} minutos` : 'un plazo corto';
    // La verificación vale para ESA wallet en ESA red: si la cambia, hay que
    // volver a verificar (el servidor exige lo mismo al crear).
    const walletLimpia = wallet.trim();
    const pideWallet = side === 'vende_usdt' && exigeWallet;
    const walletOk = !pideWallet || (!!verif && verif.permitido === true
        && String(verif.address ?? '').toLowerCase() === walletLimpia.toLowerCase() && verif.coin === red);

    // Candado síncrono: dos toques a "Enviar solicitud" creaban dos cierres.
    const enviarEnCursoRef = useRef(false);
    const enviar = async () => {
        if (enviarEnCursoRef.current) return;
        enviarEnCursoRef.current = true;
        try { await enviarUnaVez(); } finally { enviarEnCursoRef.current = false; }
    };
    const enviarUnaVez = async () => {
        setError(null);
        if (!montoOk) { setError('Escribe cuánto quieres enviar.'); return; }
        if (!walletOk) { setError('Verifica la wallet desde donde envías los USDT: solo se aceptan wallets de riesgo bajo.'); return; }
        setEnviando(true);
        const r = await callOtcMesa('crear', {
            user_id: userId, side, fromAmount: n, nota: nota.trim(),
            ...(side === 'vende_usdt' && walletLimpia ? { walletOrigen: { coin: red, address: walletLimpia } } : {}),
        });
        setEnviando(false);
        if (!r?.ok) {
            setError(r?.message ?? r?.error ?? 'No se pudo crear el cierre.');
            return;
        }
        showToast?.(`Cierre ${r.ref} enviado a la mesa.`);
        setMonto(''); setNota('');
        setWallet(''); setVerif(null);
        onCreado(r.id);
    };

    // El número grande, como en ACH: la parte entera y los decimales en chico.
    const grande = (v: number | null, dec: number) => {
        if (v == null) return <span style={{ color: '#878E88' }}>0</span>;
        // Se redondea el número entero ANTES de partirlo. Partir primero
        // daba ",100" cuando los decimales eran ,995 o más.
        const f = Math.pow(10, dec);
        const total = Math.round(v * f);
        const ent = Math.floor(total / f);
        const d = total - ent * f;
        return <>{ent.toLocaleString('es-CO')}<span style={{ fontSize: '0.65em', color: '#878E88', fontWeight: 700 }}>,{String(d).padStart(dec, '0')}</span></>;
    };
    const cerrada = !!mesa && !mesa.abierta;
    const deshabilitado = enviando || cerrada || !walletOk || !montoOk;

    return (
        <div>
            <style>{`.otc-grid{display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:18px}@media(max-width:1100px){.otc-grid{grid-template-columns:minmax(0,1fr)}}.otc-fila{display:flex;align-items:center;gap:12px;margin-top:10px}@media(max-width:520px){.otc-fila{flex-wrap:wrap}.otc-fila .otc-num{flex:1 1 100% !important}.otc-esc-txt{display:none}}`}</style>

            {/* Encabezado: título y la tasa en vivo, como la conversión ACH */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
                <div>
                    <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2' }}>
                        {side === 'vende_usdt' ? 'Convertir USDT a pesos colombianos' : 'Comprar USDT con pesos colombianos'}
                    </h1>
                    <p style={{ fontSize: 14, color: '#878E88', marginTop: 3, lineHeight: 1.5 }}>
                        Mesa OTC con asesor: {side === 'vende_usdt' ? 'envías tus USDT y recibes pesos' : 'pagas en pesos y recibes USDT'}. Al pedir el cierre la tasa queda fija y la mesa te acompaña por el chat hasta acreditar.
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#878E88', border: `1px solid ${cerrada ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.1)'}`, background: 'rgba(255,255,255,0.04)', padding: '7px 13px', borderRadius: 999 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: cerrada ? '#FBBF24' : '#4ADE80', display: 'inline-block' }} />
                        {cerrada ? 'Mesa cerrada' : 'Mesa abierta · tasa en vivo'}
                    </span>
                    <button onClick={pedirTasa} title="Actualizar la tasa" style={{ padding: 8, borderRadius: 9, border: '1px solid rgba(255,255,255,0.11)', background: 'rgba(255,255,255,0.04)' }}>
                        <RefreshCw size={14} strokeWidth={1.7} className={cargandoTasa ? 'animate-spin' : ''} style={{ color: '#878E88' }} />
                    </button>
                </div>
            </div>

            <div className="otc-grid">
                {/* ── Tarjeta del cierre ── */}
                <div style={{ ...PANEL, borderRadius: 14, padding: 24, alignSelf: 'start' }}>
                    {/* Lado */}
                    <div style={{ display: 'flex', gap: 7, marginBottom: 16 }}>
                        {([['vende_usdt', 'Vendo USDT'], ['compra_usdt', 'Compro USDT']] as const).map(([v, l]) => (
                            // Cambiar de lado cambia la moneda de la caja: 10.000
                            // USDT no pueden quedar convertidos en 10.000 COP.
                            <button key={v} onClick={() => { if (v !== side) { setSide(v); setMonto(''); } }}
                                style={{ flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 700,
                                    color: side === v ? '#0C0E0D' : '#878E88', background: side === v ? '#F4F4F2' : 'rgba(255,255,255,0.045)',
                                    border: side === v ? 'none' : '1px solid rgba(255,255,255,0.10)' }}>
                                {l}
                            </button>
                        ))}
                    </div>

                    {/* Vende USDT: PRIMERO la wallet desde donde los manda (pedido
                        del dueño, 19 nov): es lo que decide si se puede pedir el
                        cierre, así que va antes del monto. */}
                    {side === 'vende_usdt' && pideWallet && (
                        <div style={{ marginBottom: 14, padding: '14px 14px 16px', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 13, background: 'rgba(255,255,255,0.02)' }}>
                            <WalletOrigen
                                wallet={wallet} red={red} verif={verif}
                                onWallet={(v) => {
                                    setWallet(v); setVerif(null);
                                    // TRON se reconoce sola; una 0x pasa a Ethereum
                                    // solo si estaba en TRON (BNB Chain la elige él).
                                    const r = redDe(v);
                                    if (r === 'TRX') setRed('TRX');
                                    else if (r && red === 'TRX') setRed(r);
                                }}
                                onRed={(r) => { setRed(r); setVerif(null); }}
                                onVerificado={setVerif}
                                consultas={cuentaRisk ? Number(cuentaRisk.saldo ?? 0) : null}
                                onSaldo={(n) => setCuentaRisk((c: any) => (c ? { ...c, saldo: n } : c))}
                                onComprar={cuentaRisk?.tienda ? () => setComprando(true) : undefined}
                            />
                        </div>
                    )}

                    {/* ENVÍAS */}
                    <div style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 13, padding: '15px 17px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <span style={LBL_ACH}>ENVÍAS</span>
                            <span style={{ fontSize: 12, color: '#878E88' }}>
                                {side === 'vende_usdt'
                                    ? (walletOk && walletLimpia ? <>Desde tu wallet verificada · <b style={{ color: '#F4F4F2' }}>{red}</b></> : 'Desde tu wallet, después de verificarla')
                                    : 'Por transferencia, con las instrucciones de la mesa'}
                            </span>
                        </div>
                        {/* En celular el número va en su propia fila: con la
                            moneda al lado no cabía y salía cortado. */}
                        <div className="otc-fila">
                            <input className="otc-num"
                                inputMode="decimal" placeholder="0" value={aPantalla(monto)}
                                onChange={e => setMonto(aCanonico(e.target.value, envMoneda === 'USDT' ? 2 : 0, aPantalla(monto)))}
                                onPaste={e => {
                                    // Pegar en la caja vacía o con todo seleccionado
                                    // reemplaza el monto; pegar en medio de un número
                                    // se deja al navegador.
                                    const el = e.currentTarget;
                                    const todo = !el.value || (el.selectionStart === 0 && el.selectionEnd === el.value.length);
                                    if (!todo) return;
                                    e.preventDefault();
                                    setMonto(montoPegado(e.clipboardData.getData('text'), envMoneda === 'USDT' ? 2 : 0));
                                }}
                                style={{ flex: 1, minWidth: 0, background: 'transparent', outline: 'none', border: 'none', fontSize: 'clamp(26px, 7vw, 34px)', fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2', fontFamily: "'Archivo', system-ui, sans-serif" }}
                            />
                            <Moneda m={envMoneda} />
                        </div>
                        {/* La tasa justo debajo del monto (pedido del dueño, 23 nov). */}
                        {tasa != null && (
                            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#878E88' }}>
                                Tasa <b style={{ color: '#F4F4F2' }}>1 USDT = {nf(tasa)} COP</b> · queda fija al solicitar
                            </p>
                        )}
                    </div>
                    {/* Flecha entre cajas */}
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '-13px 0', position: 'relative', zIndex: 2 }}>
                        <span style={{ width: 36, height: 36, borderRadius: 999, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center' }}>
                            <ArrowDown size={16} strokeWidth={1.7} style={{ color: '#878E88' }} />
                        </span>
                    </div>
                    {/* RECIBES */}
                    <div style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 13, padding: '15px 17px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <span style={LBL_ACH}>{recMoneda === 'COP' ? 'RECIBES EN PESOS (ESTIMADO)' : 'RECIBES EN USDT (ESTIMADO)'}</span>
                            <span style={{ fontSize: 12, color: '#878E88' }}>{recMoneda === 'COP' ? 'La mesa te confirma la cuenta' : 'A tu saldo USDT de Lincoin'}</span>
                        </div>
                        <div className="otc-fila">
                            <p className="otc-num" style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 'clamp(26px, 7vw, 34px)', fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {grande(recibe, 2)}
                            </p>
                            <Moneda m={recMoneda} />
                        </div>
                    </div>

                    {/* Desglose: cómo se arma la tasa, a la vista. Con referencia
                        y margen el cliente puede verificar la cuenta él mismo. */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 18, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {cargandoTasa && tasa == null ? (
                            <p style={{ color: '#878E88', fontSize: 12.5 }}>Consultando la tasa…</p>
                        ) : tasa != null ? (
                            <>
                                <Fila k={`Tasa aplicada (incluye margen ${nf(margenPct)} %)`} v={`1 USDT = ${nf(tasa)} COP`} />
                                <Fila k="Tasa de referencia" v={`1 USDT = ${nf(referencia ?? 0)} COP`} suave />
                                <Fila k="Margen Lincoin" v={`${nf(margenPct)} % · ${nf((referencia ?? 0) * margenPct / 100)} COP por USDT`} suave />
                                <Fila k={recMoneda === 'COP' ? 'Recibes en pesos (estimado)' : 'Recibes en USDT (estimado)'}
                                    v={recibe != null ? `${nf(recibe, recMoneda === 'COP' ? 0 : 2)} ${recMoneda}` : '—'} />
                                <Fila k="Llega" v={side === 'vende_usdt' ? 'Cuando la mesa confirme tus USDT' : 'Cuando la mesa confirme tu pago'} color="#4ADE80" />
                                {/* La tasa se renueva sola cada minuto; el botón es para
                                    no esperar. Era un "actualizar" subrayado pegado al
                                    texto (23 nov, al dueño no le gustó): ahora es un
                                    botón con la hora de la última tasa al lado. */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 2, padding: '10px 12px', borderRadius: 11, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ margin: 0, color: '#F4F4F2', fontSize: 12, fontWeight: 600 }}>Tasa en vivo</p>
                                        <p style={{ margin: '2px 0 0', color: '#878E88', fontSize: 11.5, lineHeight: 1.45 }}>
                                            Al solicitar el cierre esta tasa queda fija y tienes {plazoTxt} para enviar y subir el comprobante.
                                            {actualizadaAt ? ` Tasa de las ${actualizadaAt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}; se renueva cada minuto.` : ''}
                                        </p>
                                    </div>
                                    <button onClick={pedirTasa} disabled={cargandoTasa}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, height: 34, padding: '0 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', color: '#F4F4F2', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', cursor: cargandoTasa ? 'default' : 'pointer', opacity: cargandoTasa ? 0.6 : 1 }}>
                                        <RefreshCw size={13} strokeWidth={2} className={cargandoTasa ? 'animate-spin' : ''} style={{ color: '#4ADE80' }} />
                                        {cargandoTasa ? 'Actualizando…' : 'Actualizar tasa'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                                <AlertTriangle size={13} style={{ color: '#FBBF24', marginTop: 1, flexShrink: 0 }} />
                                <p style={{ color: '#878E88', fontSize: 12.5, lineHeight: 1.5 }}>
                                    No hay cotización automática en este momento{motivoSinTasa ? ` (${motivoSinTasa})` : ''}. Puedes pedir el cierre igual: la mesa lo cotiza a mano.
                                </p>
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: 16 }}>
                        <label style={LABEL}>Mensaje para la mesa (opcional)</label>
                        <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} placeholder="Ej: necesito cerrar hoy antes de las 4 p. m." style={{ ...INPUT, resize: 'vertical' }} />
                    </div>

                    {error && (
                        <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 7, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.06)', borderRadius: 10, padding: '10px 12px' }}>
                            <AlertTriangle size={13} style={{ color: '#F87171', marginTop: 1, flexShrink: 0 }} />
                            <p style={{ color: '#F87171', fontSize: 12.5 }}>{error}</p>
                        </div>
                    )}

                    {/* La mesa cerrada se dice ANTES del botón, y con la hora de
                        vuelta. El servidor rechaza igual si el botón llega
                        habilitado desde una pestaña vieja. */}
                    {cerrada && (
                        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 11, border: '1px solid rgba(251,191,36,0.32)', background: 'rgba(251,191,36,0.07)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <Clock size={13} style={{ color: '#FBBF24', flexShrink: 0 }} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>La mesa está cerrada</span>
                            </div>
                            <p style={{ fontSize: 12, color: '#878E88', margin: '6px 0 0', lineHeight: 1.55 }}>
                                {mesa?.proxima
                                    ? `Vuelve a abrir ${mesa.proxima}. Puedes dejar tu consulta en un cierre abierto y te contestamos apenas abra.`
                                    : 'Escríbenos y te contestamos apenas abra.'}
                            </p>
                        </div>
                    )}

                    {/* CTA, como en ACH */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 16, paddingTop: 16 }}>
                        <p style={{ fontSize: 12, color: '#878E88', maxWidth: 330, lineHeight: 1.5 }}>
                            No se mueve nada de tu saldo al pedir el cierre. La tasa queda fija y la mesa te escribe por el chat.
                        </p>
                        <button onClick={enviar} disabled={deshabilitado} className="lincoin-btn-white"
                            style={{ padding: '14px 30px', borderRadius: 10, fontSize: 14.5, fontWeight: 700, border: 'none', opacity: deshabilitado ? 0.45 : 1, cursor: deshabilitado ? 'not-allowed' : undefined }}>
                            {enviando ? 'Enviando a la mesa…' : cerrada ? 'Mesa cerrada' : 'Solicitar cierre'}
                        </button>
                    </div>
                    {!walletOk && (
                        <p style={{ color: '#878E88', fontSize: 11.5, textAlign: 'right', marginTop: 8, lineHeight: 1.5 }}>
                            {!walletLimpia ? 'Escribe y verifica la wallet desde donde envías para habilitar el cierre.'
                                : !verif ? 'Verifica la wallet para habilitar el cierre.'
                                : 'Esta wallet no se puede usar en la mesa: usa una de riesgo bajo.'}
                        </p>
                    )}
                </div>

                {/* ── Columna derecha: la tasa con su historial y tus cierres ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignSelf: 'start' }}>
                    <div style={{ ...PANEL, borderRadius: 14, padding: 8 }}>
                        <FinityRateChart from="USD" to="COP" ajusteCop={ajusteCop} />
                    </div>
                    {lateral}
                </div>
            </div>

            {/* La compra de consultas, la misma de Lincoin Risk, sin salir de la mesa. */}
            <style>{ESTILOS_RISK}</style>
            <Panel titulo="Comprar consultas" abierto={comprando && !!cuentaRisk?.tienda} cerrar={() => { setComprando(false); leerCuentaRisk(); }}>
                {cuentaRisk?.tienda ? <Recarga cuenta={cuentaRisk} listo={() => { setComprando(false); leerCuentaRisk(); }} /> : null}
            </Panel>
        </div>
    );
};

// ─── La wallet desde donde el cliente manda los USDT ────
type RedOtc = 'TRX' | 'ETH' | 'BNB';
const REDES_OTC: Array<{ v: RedOtc; l: string; pie: string }> = [
    { v: 'TRX', l: 'TRON', pie: 'TRC20' },
    { v: 'ETH', l: 'Ethereum', pie: 'ERC20' },
    { v: 'BNB', l: 'BNB Chain', pie: 'BEP20' },
];
// La red se deduce del formato cuando se puede (TRON empieza por T; las EVM
// por 0x y ahí el cliente elige cuál de las dos).
const redDe = (w: string): RedOtc | null => {
    const x = w.trim();
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(x)) return 'TRX';
    if (/^0x[0-9a-fA-F]{40}$/.test(x)) return 'ETH';
    return null;
};
const CARA_RIESGO: Record<string, { t: string; c: string }> = {
    bajo: { t: 'RIESGO BAJO', c: '#4ADE80' },
    medio: { t: 'RIESGO MEDIO', c: '#FBBF24' },
    alto: { t: 'RIESGO ALTO', c: '#F87171' },
    sin_dato: { t: 'SIN RESULTADO', c: '#878E88' },
};
const fechaCorta = (v: any) => {
    if (v == null || v === '') return '—';
    const t = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
    return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Verificar la wallet gasta 1 consulta de Lincoin Risk (23 nov, pedido del
// dueño: "el usuario debe tener consultas para poder verificar la wallet").
// `consultas` es el saldo (null mientras no se sabe); sin consultas no se
// verifica y se ofrece la compra ahí mismo (`onComprar`).
const WalletOrigen: React.FC<{
    wallet: string; red: RedOtc; verif: any;
    onWallet: (v: string) => void; onRed: (r: RedOtc) => void; onVerificado: (v: any) => void;
    consultas?: number | null; onSaldo?: (n: number) => void; onComprar?: () => void;
}> = ({ wallet, red, verif, onWallet, onRed, onVerificado, consultas = null, onSaldo, onComprar }) => {
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Escanear el QR de la wallet (23 nov): copiar a mano una dirección de 34
    // caracteres es donde más se equivoca la gente, y un carácter mal puesto
    // verifica otra wallet.
    const [escaneando, setEscaneando] = useState(false);
    const w = wallet.trim();
    const esEvm = /^0x/i.test(w);
    const sinConsultas = consultas != null && consultas <= 0;

    const verificar = async () => {
        if (!w || cargando || sinConsultas) return;
        setCargando(true); setError(null); onVerificado(null);
        const r = await llamarFuncion('kyt', { action: 'otc_wallet', coin: red, address: w }, 60000).catch(() => null);
        setCargando(false);
        if (typeof r?.saldoConsultas === 'number') onSaldo?.(r.saldoConsultas);
        if (r?.error === 'sin_consultas') { onSaldo?.(0); return; }
        if (!r?.ok) { setError(r?.mensaje ?? r?.error ?? 'No se pudo revisar la wallet. Intenta de nuevo.'); return; }
        onVerificado(r);
    };

    // Wallet nueva aceptada por excepción (23 nov): se ve en verde y con su
    // nombre; el nivel que dio el análisis queda escrito al lado, sin taparlo.
    const nueva = verif?.excepcion === 'wallet_nueva' && verif?.permitido === true;
    const cara = verif ? (nueva ? { t: 'WALLET NUEVA · ACEPTADA', c: '#4ADE80' } : (CARA_RIESGO[verif.categoria] ?? CARA_RIESGO.sin_dato)) : null;
    const motivos = verif ? hallazgosEnEspanol(verif.hallazgos ?? [], 6) : [];
    const n2 = (v: any, d = 2) => v == null ? '—' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: d });

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Wallet size={14} style={{ color: '#878E88' }} />
                    <span style={{ fontSize: 12.5, color: '#F4F4F2', fontWeight: 600 }}>Wallet desde donde envías los USDT</span>
                </span>
                {consultas != null && (
                    <button onClick={onComprar} disabled={!onComprar} title="Consultas de Lincoin Risk"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 5px 4px 11px', borderRadius: 999, fontFamily: 'inherit', cursor: onComprar ? 'pointer' : 'default',
                            background: sinConsultas ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${sinConsultas ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.10)'}` }}>
                        <ShieldCheck size={12} style={{ color: sinConsultas ? '#FBBF24' : '#4ADE80' }} />
                        <span style={{ fontSize: 11.5, color: '#878E88' }}>Consultas</span>
                        <b style={{ fontSize: 12.5, color: sinConsultas ? '#FBBF24' : '#F4F4F2' }}>{consultas.toLocaleString('es-CO')}</b>
                        {onComprar && <span style={{ fontSize: 11, fontWeight: 700, color: '#0C0E0D', background: '#F4F4F2', borderRadius: 999, padding: '3px 9px' }}>+ Comprar</span>}
                    </button>
                )}
            </div>
            <p style={{ fontSize: 11.5, color: '#878E88', marginBottom: 10, lineHeight: 1.5 }}>
                Revisamos su riesgo antes de abrir el cierre. Se aceptan wallets de riesgo bajo (o nuevas, sin otras señales), y los USDT tienen que salir de esta misma wallet.
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {REDES_OTC.map(o => {
                    const activa = red === o.v;
                    const deshabilitada = (o.v === 'TRX' && esEvm) || (o.v !== 'TRX' && !!w && !esEvm);
                    return (
                        <button key={o.v} onClick={() => !deshabilitada && onRed(o.v)} disabled={deshabilitada}
                            style={{ padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                                color: activa ? '#0C0E0D' : '#878E88', background: activa ? '#F4F4F2' : 'rgba(255,255,255,0.045)',
                                border: activa ? 'none' : '1px solid rgba(255,255,255,0.10)', opacity: deshabilitada ? 0.35 : 1 }}>
                            {o.l} <span style={{ fontWeight: 500, opacity: 0.8 }}>· {o.pie}</span>
                        </button>
                    );
                })}
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
                <input
                    value={wallet}
                    onChange={e => onWallet(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') verificar(); }}
                    placeholder={red === 'TRX' ? 'T…' : '0x…'}
                    spellCheck={false}
                    style={{ ...INPUT, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                />
                <button onClick={() => setEscaneando(true)} title="Escanear el QR de la wallet" aria-label="Escanear el QR de la wallet"
                    className="transition-colors hover:bg-white/[0.09]"
                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                        color: '#F4F4F2', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <ScanLine size={15} style={{ color: '#4ADE80' }} />
                    <span className="otc-esc-txt">Escanear</span>
                </button>
                <button onClick={verificar} disabled={!w || cargando || sinConsultas}
                    style={{ flexShrink: 0, padding: '0 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: !w || sinConsultas ? 'not-allowed' : 'pointer',
                        color: w && !sinConsultas ? '#0C0E0D' : '#878E88', background: w && !sinConsultas ? '#4ADE80' : 'rgba(255,255,255,0.06)', border: 'none', opacity: cargando ? 0.6 : 1 }}>
                    {cargando ? 'Revisando…' : verif ? 'Revisar de nuevo' : 'Verificar'}
                </button>
            </div>

            {/* Sin consultas: no se verifica, y la compra queda a un clic. */}
            {sinConsultas ? (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderRadius: 12, padding: '12px 14px',
                    border: '1px solid rgba(251,191,36,0.35)', background: 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: '1 1 260px' }}>
                        <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'rgba(251,191,36,0.12)' }}>
                            <ShieldCheck size={15} style={{ color: '#FBBF24' }} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>No tienes consultas para verificar la wallet</p>
                            <p style={{ margin: '3px 0 0', fontSize: 11.5, color: '#878E88', lineHeight: 1.5 }}>
                                La revisión de riesgo usa 1 consulta de Lincoin Risk, las mismas de AML y KYT. Compra un paquete y verifica en el acto.
                            </p>
                        </div>
                    </div>
                    {onComprar && (
                        <button onClick={onComprar} className="lincoin-btn-white"
                            style={{ flexShrink: 0, height: 36, padding: '0 16px', borderRadius: 10, border: 'none', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                            Comprar consultas
                        </button>
                    )}
                </div>
            ) : consultas != null && !verif ? (
                <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 0', fontSize: 11.5, color: '#878E88', lineHeight: 1.5 }}>
                    <ShieldCheck size={12} style={{ color: '#4ADE80', flexShrink: 0 }} />
                    Verificar usa 1 consulta de Lincoin Risk. Una wallet que ya verificaste y sigue vigente no se cobra otra vez; si la revisión no da resultado, se devuelve.
                </p>
            ) : null}

            {error && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 7, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.06)', borderRadius: 10, padding: '10px 12px' }}>
                    <AlertTriangle size={13} style={{ color: '#F87171', marginTop: 1, flexShrink: 0 }} />
                    <p style={{ color: '#F87171', fontSize: 12.5, lineHeight: 1.5 }}>{error}</p>
                </div>
            )}

            {verif && cara && (
                <div style={{ marginTop: 10, border: `1px solid ${cara.c}55`, borderRadius: 12, padding: '12px 13px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${cara.c}55`, color: cara.c, fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', padding: '3px 9px', borderRadius: 999 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 999, background: cara.c }} /> {cara.t}
                        </span>
                        <span style={{ fontSize: 12, color: '#878E88' }}>
                            Puntaje <b style={{ color: '#F4F4F2' }}>{verif.puntaje ?? '—'}</b> / 100 · {verif.red}
                            {nueva && verif.categoria && verif.categoria !== 'bajo' ? ` · nivel del análisis: ${verif.categoria}` : ''}
                        </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 12 }}>
                        <Dato label="Saldo USDT" valor={n2(verif.saldo?.usdt)} />
                        <Dato label={`Saldo ${red === 'TRX' ? 'TRX' : red === 'ETH' ? 'ETH' : 'BNB'}`} valor={n2(verif.saldo?.nativo, 4)} />
                        <Dato label="Transacciones" valor={n2(verif.actividad?.transacciones, 0)} />
                        <Dato label="Primera actividad" valor={fechaCorta(verif.actividad?.primera)} />
                        <Dato label="Última actividad" valor={fechaCorta(verif.actividad?.ultima)} />
                        {verif.saldo?.valorUsd != null && <Dato label="Valor total (USD)" valor={n2(verif.saldo.valorUsd)} />}
                    </div>

                    {Array.isArray(verif.etiquetas) && verif.etiquetas.length > 0 && (
                        <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 10, lineHeight: 1.5 }}>
                            Etiquetas: {verif.etiquetas.map((e: any) => typeof e === 'string' ? e : (e?.label ?? e?.name ?? '')).filter(Boolean).join(', ')}
                        </p>
                    )}
                    {motivos.length > 0 && (
                        <ul style={{ marginTop: 8, paddingLeft: 16, color: '#F4F4F2', fontSize: 12, lineHeight: 1.55 }}>
                            {motivos.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                    )}

                    <div style={{ marginTop: 11, display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                        {verif.permitido
                            ? <CheckCircle2 size={14} style={{ color: '#4ADE80', marginTop: 1, flexShrink: 0 }} />
                            : <XCircle size={14} style={{ color: '#F87171', marginTop: 1, flexShrink: 0 }} />}
                        <p style={{ fontSize: 12, color: verif.permitido ? '#F4F4F2' : '#F87171', lineHeight: 1.5 }}>
                            {verif.permitido
                                ? (nueva
                                    ? 'Wallet nueva, sin historial y sin otras señales: se acepta para la mesa. Ya puedes solicitar el cierre.'
                                    : 'Wallet aprobada para la mesa. Ya puedes solicitar el cierre.')
                                : `${verif.motivoBloqueo ?? 'Esta wallet no pasó la revisión de riesgo.'} No se puede usar para la mesa.`}
                        </p>
                    </div>
                    <p style={{ fontSize: 10.5, color: 'rgba(244,244,242,0.45)', marginTop: 6 }}>
                        Revisado el {fecha(verif.consultadoAt)}. El resultado refleja la información disponible hoy.
                    </p>
                </div>
            )}

            {escaneando && (
                <EscanerQr
                    titulo="Escanear la wallet"
                    ayuda="Apunta la cámara al QR de recibir de tu wallet (TRON, Ethereum o BNB Chain). La dirección se pega sola; después tocas Verificar."
                    onCerrar={() => setEscaneando(false)}
                    onLeido={(texto) => {
                        const d = direccionDeQr(texto);
                        if (!d) return 'Ese QR no tiene una dirección de TRON, Ethereum o BNB Chain. Escanea el QR de recibir de tu wallet.';
                        onWallet(d.direccion);
                        // TRON la reconoce onWallet; en EVM solo se cambia la red si
                        // el QR la dice (cadena 56 = BNB Chain).
                        if (d.red && d.red !== 'TRX') onRed(d.red);
                        setError(null);
                        return null;
                    }}
                />
            )}
        </div>
    );
};

// ─── Detalle + hilo ─────────────────────────────────────
const DetalleCierre: React.FC<{ id: string; userId: string; showToast?: (m: string) => void; onCompletado?: (c: any) => void; onVolver: () => void }> = ({ id, userId, showToast, onCompletado, onVolver }) => {
    const [cierre, setCierre]   = useState<any>(null);
    const [msgs, setMsgs]       = useState<any[]>([]);
    const [texto, setTexto]     = useState('');
    const [enviando, setEnviando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [marcando, setMarcando] = useState(false);
    // Cancelar pide un segundo toque: un toque suelto (o el pulgar sobre el
    // botón rojo al hacer scroll) tiraba un cierre con la tasa ya fija.
    const [confirmaCancelar, setConfirmaCancelar] = useState(false);
    const [cargando, setCargando] = useState(true);
    const [detalles, setDetalles] = useState(false);
    const [lupa, setLupa] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const finRef = useRef<HTMLDivElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

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
                if (c && ['completada', 'cancelada', 'anulada'].includes(c.status)) return c;
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

    const adjuntar = async (f: File | null | undefined) => {
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
            const r = await callOtcMesa('comprobante', { user_id: userId, id, archivo: b64, nombre: f.name, tipo: f.type });
            if (r?.ok) { cargar(); showToast?.('Comprobante subido.'); }
            else setError(r?.message ?? r?.error ?? 'No se pudo subir el comprobante.');
        } catch (e: any) {
            setError(e?.message ?? 'No se pudo leer el archivo.');
        }
        setSubiendo(false);
        if (fileRef.current) fileRef.current.value = '';
    };

    const accion = async (action: string, extra: Record<string, unknown> = {}) => {
        const r = await callOtcMesa(action, { user_id: userId, id, ...extra });
        if (r?.ok) { cargar(); return true; }
        setError(r?.message ?? r?.error ?? 'No se pudo.');
        return false;
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
    const vivo  = !['completada', 'cancelada', 'anulada'].includes(cierre.status);
    // Un cancelado (casi siempre por plazo vencido) sigue aceptando mensajes:
    // el servidor lo permite a propósito para el cliente que alcanzó a pagar.
    // La pantalla le escondía la caja justo en ese momento.
    const puedeEscribir = vivo || cierre.status === 'cancelada';
    const enPago = cierre.status === 'esperando_pago';
    // Ya marcó el pago: cancelar es decisión de la mesa (el servidor lo
    // rechaza), así que el botón no se ofrece.
    const puedeCancelar = vivo && cierre.status !== 'pagada';
    // Si ya subió comprobante se ve en el hilo. Es el mismo hecho que comprueba
    // el servidor antes de aceptar "ya pagué".
    const tieneComprobante = msgs.some((m: any) => m.autor === 'cliente' && m.adjunto_url);
    const destino = destinoTexto(cierre.payout);

    return (
        <div style={{ maxWidth: 620, margin: '0 auto', fontFamily: "'Archivo', system-ui, sans-serif" }}>
            <button onClick={onVolver} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#878E88', marginBottom: 12 }}>
                <ChevronLeft size={15} /> Mis cierres
            </button>

            {/* Toda la operación en una sola pieza: barra, detalles, hilo y
                acciones. El chat es la superficie principal — es donde pasa la
                operación — y el estado vive arriba, siempre a la vista. */}
            <div style={{ ...PANEL, overflow: 'hidden' }}>

                {/* ── Barra de la orden ── */}
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: 16, fontWeight: 800, color: '#F4F4F2', letterSpacing: '-0.4px', lineHeight: 1.3 }}>
                                {cierre.side === 'vende_usdt'
                                    ? <>Vender {nf(cierre.from_amount)} USDT</>
                                    : <>Comprar USDT con {nf(cierre.from_amount, 0)} COP</>}
                            </p>
                            <p style={{ fontSize: 13, color: '#878E88', marginTop: 2 }}>
                                {cierre.to_amount != null
                                    ? <>por <b style={{ color: '#F4F4F2', fontWeight: 700 }}>{nf(cierre.to_amount, cierre.to_currency === 'COP' ? 0 : 2)} {cierre.to_currency}</b></>
                                    : 'a cotizar'}
                            </p>
                            {/* La tasa, debajo del monto y sin abrir "Ver detalles"
                                (pedido del dueño, 23 nov): es lo primero que se
                                quiere confirmar antes de pagar. */}
                            {tasaVigente != null && (
                                <p style={{ fontSize: 13, color: '#878E88', marginTop: 2 }}>
                                    Tasa <b style={{ color: '#F4F4F2', fontWeight: 700 }}>1 USDT = {nf(tasaVigente)} COP</b>
                                    <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.4px', color: cierre.rate_final ? '#4ADE80' : '#FBBF24', border: `1px solid ${cierre.rate_final ? 'rgba(74,222,128,0.35)' : 'rgba(251,191,36,0.35)'}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                                        {cierre.rate_final ? 'FIJA' : 'INDICATIVA'}
                                    </span>
                                </p>
                            )}
                            {enPago && cierre.vence_at && <PagaEn hasta={cierre.vence_at} />}
                        </div>
                        <span style={{ border: `1px solid ${cara.borde}`, background: cara.fondo, color: cara.color, fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', padding: '4px 10px', borderRadius: 999, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {cara.label}
                        </span>
                    </div>

                    <button
                        onClick={() => setDetalles(v => !v)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, fontSize: 12, fontWeight: 600, color: '#4ADE80', background: 'transparent', border: 'none', padding: 0 }}
                    >
                        Ver detalles {detalles ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {detalles && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                            <Dato label="Referencia" valor={cierre.ref} mono />
                            <Dato label="Tasa" valor={tasaVigente != null ? nf(tasaVigente) : '—'}
                                pie={cierre.rate_final ? 'fija para este cierre' : cierre.rate_cotizada ? 'indicativa' : undefined} />
                            <Dato label="Solicitado" valor={fecha(cierre.created_at)} />
                            {destino && <Dato label={destino.label} valor={destino.valor} mono={destino.mono} />}
                            {cierre.payout?.origen?.address && (
                                <Dato label="Wallet de origen" valor={cierre.payout.origen.address} pie={`${cierre.payout.origen.coin ?? ''} · riesgo ${cierre.payout.origen.categoria ?? '—'}`} mono />
                            )}
                        </div>
                    )}
                </div>

                {/* ── El hilo ── */}
                <div style={{ maxHeight: 400, minHeight: 200, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {msgs.map(m => <Burbuja key={m.id} m={m} onVer={setLupa} />)}
                    <div ref={finRef} />
                </div>

                {error && (
                    <div style={{ margin: '0 16px 10px', display: 'flex', alignItems: 'flex-start', gap: 7, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.06)', borderRadius: 10, padding: '9px 11px' }}>
                        <AlertTriangle size={13} style={{ color: '#F87171', marginTop: 1, flexShrink: 0 }} />
                        <p style={{ color: '#F87171', fontSize: 12, lineHeight: 1.5 }}>{error}</p>
                    </div>
                )}

                {/* ── Acciones ── */}
                {(enPago || puedeCancelar) && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                        {enPago && !tieneComprobante && (
                            <p style={{ fontSize: 11.5, color: '#878E88', marginBottom: 9, lineHeight: 1.5 }}>
                                Envía el pago y adjunta el comprobante con el <b style={{ color: '#F4F4F2' }}>+</b> de abajo. Tiene que verse el monto. Si todavía no sabes a dónde enviar, pregúntale a la mesa por aquí.
                            </p>
                        )}
                        {/* Apiladas en móvil, en línea en escritorio: en el ancho
                            de un teléfono, dos botones lado a lado quedan
                            demasiado angostos para leerse de un vistazo. */}
                        <div className="flex flex-col sm:flex-row" style={{ gap: 8 }}>
                            {enPago && (
                                <button
                                    onClick={async () => { setMarcando(true); await accion('marcar_pagada'); setMarcando(false); }}
                                    disabled={!tieneComprobante || marcando}
                                    className={tieneComprobante ? 'lincoin-btn-white transition-colors' : undefined}
                                    style={{
                                        flex: 1, padding: '13px 0', borderRadius: 11, border: 'none', fontWeight: 700, fontSize: 14,
                                        ...(tieneComprobante ? {} : { background: 'rgba(255,255,255,0.05)', color: '#878E88' }),
                                        cursor: tieneComprobante ? 'pointer' : 'not-allowed', opacity: marcando ? 0.6 : 1,
                                    }}
                                >
                                    {marcando ? 'Avisando a la mesa…' : 'Marcar como pagado'}
                                </button>
                            )}
                            {puedeCancelar && (confirmaCancelar ? (
                                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 12.5, color: '#878E88' }}>¿Cancelar este cierre?</span>
                                    <button
                                        onClick={async () => { await accion('cancelar'); setConfirmaCancelar(false); }}
                                        style={{ padding: '11px 16px', borderRadius: 11, fontWeight: 700, fontSize: 13, color: '#0C0E0D', background: '#F87171', border: 'none', whiteSpace: 'nowrap' }}
                                    >
                                        Sí, cancelar
                                    </button>
                                    <button
                                        onClick={() => setConfirmaCancelar(false)}
                                        style={{ padding: '11px 16px', borderRadius: 11, fontWeight: 600, fontSize: 13, color: '#F4F4F2', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', whiteSpace: 'nowrap' }}
                                    >
                                        No
                                    </button>
                                </span>
                            ) : (
                                <button
                                    onClick={() => setConfirmaCancelar(true)}
                                    className="sm:w-auto transition-colors hover:bg-white/[0.04]"
                                    style={{ padding: '13px 20px', borderRadius: 11, fontWeight: 600, fontSize: 13, color: '#F87171', background: 'transparent', border: '1px solid rgba(248,113,113,0.3)', whiteSpace: 'nowrap' }}
                                >
                                    Cancelar solicitud
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Composer, con el adjuntar adentro ── */}
                {puedeEscribir ? (
                    <>
                    {!vivo && (
                        <p style={{ padding: '12px 18px 0', borderTop: '1px solid rgba(255,255,255,0.07)', color: '#878E88', fontSize: 12, lineHeight: 1.5 }}>
                            Este cierre está cancelado{cierre.motivo_cierre ? ` — ${cierre.motivo_cierre}` : ''}. Si ya enviaste el dinero, escríbele a la mesa: lo resuelve sobre esta misma solicitud.
                        </p>
                    )}
                    <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: vivo ? '1px solid rgba(255,255,255,0.07)' : 'none', alignItems: 'center' }}>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                            onChange={e => adjuntar(e.target.files?.[0])}
                            style={{ display: 'none' }}
                        />
                        {vivo && <button
                            onClick={() => fileRef.current?.click()}
                            disabled={subiendo}
                            title="Adjuntar comprobante"
                            className="transition-colors hover:bg-white/[0.09]"
                            style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 999, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4F4F2' }}
                        >
                            {subiendo ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={18} />}
                        </button>}
                        <input
                            value={texto}
                            onChange={e => setTexto(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                            placeholder="Escribe a la mesa…"
                            style={{ ...INPUT, fontSize: 13.5 }}
                        />
                        <button onClick={enviar} disabled={enviando || !texto.trim()}
                            style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 999, background: texto.trim() ? '#4ADE80' : 'rgba(255,255,255,0.055)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {enviando ? <RefreshCw size={15} className="animate-spin" style={{ color: '#0C0E0D' }} /> : <Send size={15} style={{ color: texto.trim() ? '#0C0E0D' : '#878E88' }} />}
                        </button>
                    </div>
                    </>
                ) : (
                    <p style={{ padding: '13px 18px', borderTop: '1px solid rgba(255,255,255,0.07)', color: 'rgba(244,244,242,0.45)', fontSize: 12, lineHeight: 1.5 }}>
                        Este cierre está {cierre.status === 'completada' ? 'completado' : cierre.status === 'anulada' ? 'anulado' : 'cancelado'}
                        {(cierre.status === 'cancelada' || cierre.status === 'anulada') && cierre.motivo_cierre ? ` — ${cierre.motivo_cierre}` : ''}. El hilo queda como registro.
                    </p>
                )}
            </div>

            {lupa && <Lupa url={lupa} onCerrar={() => setLupa(null)} />}
        </div>
    );
};

// "Paga en 04:52" — el plazo dicho como lo que le toca hacer, no como un dato
// del sistema. Ambar en el ultimo minuto, rojo al vencer: el color tiene que
// cambiar ANTES de que sea tarde, no cuando ya lo es.
const PagaEn: React.FC<{ hasta: string }> = ({ hasta }) => {
    const seg = useCuentaAtras(hasta);
    if (seg == null) return null;
    const color = seg === 0 ? '#F87171' : seg <= 60 ? '#FBBF24' : '#4ADE80';
    return (
        <p style={{ fontSize: 13, color: '#878E88', marginTop: 6 }}>
            {seg === 0 ? 'Plazo vencido' : <>Paga en <b style={{ color, fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 15 }}>{reloj(seg)}</b></>}
        </p>
    );
};

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
// Un comprobante se mira, no se abre en otra pestana. Un enlace obliga a salir
// de la conversacion justo cuando hay que comparar lo que dice el papel con lo
// que dice la orden. Se muestra adentro y se amplia con un click.
//
// El tipo real lo sabe el servidor, pero la URL firmada no siempre delata la
// extension: se intenta pintar como imagen y, si el navegador no puede, recien
// ahi se cae al enlace. Probar en vez de adivinar.
const Adjunto: React.FC<{ url: string; onVer?: (url: string) => void }> = ({ url, onVer }) => {
    const [falla, setFalla] = useState(false);
    const esPdf = /\.pdf(\?|$)/i.test(url);

    if (esPdf || falla) {
        return (
            <a href={url} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '8px 11px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', fontSize: 12.5, color: '#F4F4F2', fontWeight: 600 }}>
                <Paperclip size={13} /> {esPdf ? 'Abrir comprobante (PDF)' : 'Abrir comprobante'}
            </a>
        );
    }
    return (
        <button
            onClick={() => onVer?.(url)}
            style={{ display: 'block', marginTop: 7, padding: 0, border: 'none', background: 'transparent', cursor: 'zoom-in', width: '100%' }}
            title="Ampliar"
        >
            <img
                src={url}
                alt="Comprobante"
                onError={() => setFalla(true)}
                style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)' }}
            />
        </button>
    );
};

// Overlay para ver el comprobante en grande sin salir de la conversacion.
const Lupa: React.FC<{ url: string; onCerrar: () => void }> = ({ url, onCerrar }) => {
    // Escape tambien cierra: en escritorio es lo primero que se aprieta.
    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onCerrar]);

    return (
        <div onClick={onCerrar}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '76px 16px 16px' }}>
            {/* La X tiene su propio fondo oscuro y su borde: un comprobante es
                casi siempre una captura BLANCA, y una X translucida encima de
                eso desaparece. No puede depender del color de la imagen. */}
            <button onClick={onCerrar} aria-label="Cerrar"
                className="transition-colors hover:bg-black"
                style={{
                    position: 'absolute', top: 18, right: 18, width: 52, height: 52, borderRadius: 999,
                    background: 'rgba(12,14,13,0.92)', border: '1.5px solid rgba(255,255,255,0.45)',
                    color: '#F4F4F2', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 18px rgba(0,0,0,0.6)', zIndex: 2, cursor: 'pointer',
                }}>
                <X size={26} strokeWidth={2.6} />
            </button>
            <img src={url} alt="Comprobante" onClick={e => e.stopPropagation()}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }} />
            <p style={{ position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', fontSize: 11.5, color: 'rgba(244,244,242,0.55)' }}>
                Toca fuera de la imagen para cerrar
            </p>
        </div>
    );
};

// Como se describe cada destino del COP en el detalle del cierre.
export const NOMBRE_BILLETERA: Record<string, string> = {
    COP: 'Saldo Lincoin', COP_BREB: nombreCuenta(1), COP_ACH: nombreCuenta(2), USD: 'Saldo USDT',
    COP_C3: nombreCuenta(3), COP_C4: nombreCuenta(4),
};

export function destinoTexto(p: any): { label: string; valor: string; mono?: boolean } | null {
    if (!p?.tipo) return null;
    // Sin billetera todavía: desde el 19 nov la elige la mesa al acreditar.
    if (p.tipo === 'saldo') return { label: 'Se acredita en', valor: p.wallet ? (NOMBRE_BILLETERA[p.wallet] ?? String(p.wallet)) : 'Lo confirma la mesa' };
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

const Burbuja: React.FC<{ m: any; onVer?: (url: string) => void }> = ({ m, onVer }) => {
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
                {m.adjunto_url && <Adjunto url={m.adjunto_url} onVer={onVer} />}
                <p style={{ fontSize: 10, color: 'rgba(244,244,242,0.45)', marginTop: 4, textAlign: 'right' }}>{fecha(m.created_at)}</p>
            </div>
        </div>
    );
};
