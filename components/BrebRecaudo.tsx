import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Copy, QrCode, Check, AlertTriangle, RefreshCw, Download } from 'lucide-react';

// ─────────────────────────────────────────────
// BrebRecaudo — la llave Bre-B del cliente para que le paguen.
//
// NO ES UNA CUENTA APARTE. Lo que entra por la llave cae en la MISMA billetera
// Bre-B donde le acredita la mesa. Un segundo saldo obligaría a mover plata
// entre los dos a mano y crearía una forma nueva de tenerla en el lugar
// equivocado.
//
// LA LLAVE NO SE ELIGE
//   La deriva el proveedor del nombre de la empresa (“Panadería La Espiga” →
//   @PANADERIALAESPIG3456). No hay picker de @ ni de x, ni consulta de
//   disponibilidad: eso no existe en la API. Por eso la pantalla no pregunta
//   nada — genera y muestra.
//
// EL TITULAR NO ES EL CLIENTE
//   En la red Bre-B el titular registrado es la entidad del proveedor, no el
//   cliente; la llave lleva su nombre. Por eso acá se dice “tu llave para
//   recibir pagos” y nunca “tu cuenta bancaria”: lo segundo sería falso, y
//   Lincoin no es un banco.
// ─────────────────────────────────────────────

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

const PANEL = '#0C0E0D';
const BORDE = 'rgba(255,255,255,0.09)';
const BORDE2 = 'rgba(255,255,255,0.14)';
const TXT = '#F4F4F2';
const TXT2 = '#878E88';
const TXT3 = 'rgba(244,244,242,0.45)';
const VERDE = '#4ADE80';
const AMBAR = '#FBBF24';

type Props = {
    userId: string;
    authHeader: () => string;
    onCerrar: () => void;
    showToast?: (m: string, ms?: number) => void;
};

export const BrebRecaudo: React.FC<Props> = ({ userId, authHeader, onCerrar, showToast }) => {
    const [llave, setLlave] = useState<any>(null);
    const [cuenta, setCuenta] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [generando, setGenerando] = useState(false);
    const [error, setError] = useState<{ texto: string; intentadas?: string[] } | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [qrCargando, setQrCargando] = useState(false);
    const [copiado, setCopiado] = useState(false);

    // NUNCA mostrar el código crudo del servidor. "not_found" en un cartel es
    // lo mismo que no decir nada: el cliente no sabe si el problema es suyo, si
    // se arregla reintentando, o si tiene que escribirnos. Si no vino un
    // mensaje en castellano, se pone uno.
    const mensajeDe = (j: any, porDefecto: string): string => {
        const m = String(j?.message ?? '').trim();
        if (m) return m;
        return porDefecto;
    };

    // `authHeader` llega como una función suelta del padre, sin memoizar, así
    // que cambia de identidad en CADA render del padre — y el padre re-renderiza
    // solo cada 10 s. Con ella en las dependencias, `llamar` y `leer` se
    // recreaban, el efecto volvía a correr, y el modal se vaciaba a "Cargando…"
    // cada 10 segundos: la llave y el QR desaparecían de abajo del dedo, y se
    // disparaba un POST de más cada vez.
    //
    // Va en un ref: se usa siempre la última versión sin que su identidad
    // cuente como dependencia.
    const authRef = useRef(authHeader);
    authRef.current = authHeader;

    const llamar = useCallback(async (body: Record<string, unknown>) => {
        const r = await fetch(`${SURL}/functions/v1/mouv-proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authRef.current() },
            body: JSON.stringify({ userId, ...body }),
            signal: AbortSignal.timeout(20000),
        });
        return r;
    }, [userId]);

    // Primera lectura: NO emite nada. Emitir una llave es una acción del
    // cliente, no algo que pase por abrir una pantalla.
    const leer = useCallback(async () => {
        setCargando(true);
        try {
            const r = await llamar({ action: 'breb_llave', soloLeer: true });
            const j = await r.json().catch(() => null);
            if (j?.ok && j.llave?.valor) { setLlave(j.llave); setCuenta(j.cuenta ?? null); }
            else if (j?.cuenta) setCuenta(j.cuenta);
            // 'sin_llave' no es un error: es el estado normal de quien todavía
            // no generó la suya, y para eso está el botón.
            if (j?.error && j.error !== 'sin_llave') {
                setError({ texto: mensajeDe(j, 'No pudimos consultar tu llave de recaudo. Probá de nuevo en un momento.') });
            }
        } catch { /* la pantalla se muestra igual, con el botón de generar */ }
        setCargando(false);
    }, [llamar]);

    useEffect(() => { leer(); }, [leer]);

    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onCerrar]);

    const generar = async () => {
        setGenerando(true); setError(null);
        try {
            const r = await llamar({ action: 'breb_llave' });
            const j = await r.json().catch(() => null);
            if (j?.ok && j.llave?.valor) {
                setLlave(j.llave); setCuenta(j.cuenta ?? null);
                showToast?.('Tu llave de recaudo está lista.');
            } else {
                setError({
                    texto: mensajeDe(j, 'No se pudo generar la llave en este momento. Probá de nuevo o escribinos.'),
                    intentadas: j?.intentadas ?? undefined,
                });
            }
        } catch (e: any) {
            setError({ texto: `Error de red: ${String(e?.message ?? e)}` });
        }
        setGenerando(false);
    };

    // El PNG viene por nuestra función: la llave del proveedor no puede estar
    // en el navegador.
    const verQr = async () => {
        if (qr) { setQr(null); return; }
        setQrCargando(true); setError(null);
        try {
            const r = await llamar({ action: 'breb_qr' });
            if (!r.ok) {
                let msg = 'No se pudo traer el código QR en este momento.';
                try { const j = await r.json(); msg = mensajeDe(j, msg); } catch { /* sin cuerpo */ }
                setError({ texto: msg });
            } else {
                const blob = await r.blob();
                setQr(URL.createObjectURL(blob));
            }
        } catch (e: any) {
            setError({ texto: `Error de red: ${String(e?.message ?? e)}` });
        }
        setQrCargando(false);
    };

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(llave.valor);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1800);
        } catch { showToast?.('No se pudo copiar. Seleccionala a mano.'); }
    };

    const bajarQr = () => {
        if (!qr) return;
        const a = document.createElement('a');
        a.href = qr;
        a.download = `qr-${String(llave?.valor ?? 'lincoin').replace(/[^A-Za-z0-9]/g, '')}.png`;
        document.body.appendChild(a); a.click(); a.remove();
    };

    return (
        <div onClick={onCerrar}
            style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()}
                style={{ width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto', background: PANEL, border: `1px solid ${BORDE2}`, borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.7)', fontFamily: "'Archivo', system-ui, sans-serif" }}>

                <div style={{ padding: '18px 20px', borderBottom: `1px solid ${BORDE}`, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontSize: 15.5, fontWeight: 800, color: TXT, margin: 0, letterSpacing: '-0.3px' }}>Recibir pagos por Bre-B</h3>
                        <p style={{ fontSize: 12, color: TXT2, margin: '5px 0 0', lineHeight: 1.5 }}>
                            Tu llave para que te paguen desde cualquier banco. Lo que entre se acredita en tu saldo Bre-B.
                        </p>
                    </div>
                    <button onClick={onCerrar} aria-label="Cerrar"
                        style={{ width: 32, height: 32, flexShrink: 0, display: 'grid', placeItems: 'center', color: TXT2, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDE}`, borderRadius: 9 }}>
                        <X size={15} />
                    </button>
                </div>

                <div style={{ padding: '16px 20px 20px' }}>
                    {cuenta && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingBottom: 12, borderBottom: `1px solid ${BORDE}`, marginBottom: 14 }}>
                            <span style={{ fontSize: 11.5, color: TXT2 }}>Tu cuenta Lincoin</span>
                            <span style={{ fontSize: 15, fontWeight: 800, color: TXT, fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '0.5px' }}>{cuenta}</span>
                        </div>
                    )}

                    {cargando ? (
                        <p style={{ fontSize: 12.5, color: TXT2 }}>Cargando…</p>
                    ) : llave?.valor ? (
                        <>
                            <p style={{ fontSize: 9.5, fontWeight: 700, color: TXT3, letterSpacing: '0.7px', textTransform: 'uppercase', margin: '0 0 8px' }}>
                                Tu llave de recaudo
                            </p>
                            <div style={{ background: '#070808', border: `1px solid ${BORDE2}`, borderRadius: 12, padding: '14px 15px' }}>
                                <div style={{ fontSize: 17, fontWeight: 800, color: TXT, fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all', letterSpacing: '-0.2px' }}>
                                    {llave.valor}
                                </div>
                                <div style={{ fontSize: 11, color: TXT2, marginTop: 6 }}>A nombre de {llave.nombre}</div>
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                                <button onClick={copiar}
                                    className="flex-1 flex items-center justify-center transition-colors hover:bg-white/[0.09]"
                                    style={{ gap: 7, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, color: copiado ? VERDE : TXT, background: 'rgba(255,255,255,0.055)', border: `1px solid ${copiado ? VERDE + '55' : BORDE2}` }}>
                                    {copiado ? <Check size={15} /> : <Copy size={15} />} {copiado ? 'Copiada' : 'Copiar llave'}
                                </button>
                                <button onClick={verQr} disabled={qrCargando}
                                    className="flex items-center justify-center transition-colors hover:bg-white/[0.09]"
                                    style={{ gap: 7, padding: '11px 15px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: TXT, background: 'rgba(255,255,255,0.055)', border: `1px solid ${BORDE2}`, opacity: qrCargando ? 0.5 : 1 }}>
                                    {qrCargando ? <RefreshCw size={15} className="animate-spin" /> : <QrCode size={15} />} {qr ? 'Ocultar QR' : 'Ver QR'}
                                </button>
                            </div>

                            {qr && (
                                <div style={{ marginTop: 13, textAlign: 'center' }}>
                                    {/* Fondo blanco a propósito: un QR sobre negro no lo lee
                                        la mitad de los lectores. */}
                                    <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 14, display: 'inline-block' }}>
                                        <img src={qr} alt="Código QR de cobro" style={{ width: 200, height: 200, display: 'block' }} />
                                    </div>
                                    <button onClick={bajarQr}
                                        className="flex items-center justify-center mx-auto transition-colors hover:bg-white/[0.09]"
                                        style={{ gap: 6, marginTop: 10, padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, color: TXT, background: 'rgba(255,255,255,0.045)', border: `1px solid ${BORDE}` }}>
                                        <Download size={13} /> Descargar QR
                                    </button>
                                </div>
                            )}

                            <p style={{ fontSize: 11, color: TXT3, marginTop: 14, lineHeight: 1.6 }}>
                                Compartí la llave o el QR con quien te va a pagar. El pago llega en segundos y vas a
                                ver quién te pagó en tus movimientos.
                            </p>
                        </>
                    ) : (
                        <>
                            <p style={{ fontSize: 12.5, color: TXT2, lineHeight: 1.6, margin: 0 }}>
                                Todavía no tenés llave de recaudo. Se genera una sola vez, a nombre de tu empresa, y
                                no cambia.
                            </p>
                            <button onClick={generar} disabled={generando}
                                className="w-full transition-colors"
                                style={{ marginTop: 14, padding: '12px 0', borderRadius: 11, fontSize: 13.5, fontWeight: 700, color: '#0C0E0D', background: VERDE, border: 'none', opacity: generando ? 0.5 : 1 }}>
                                {generando ? 'Generando…' : 'Generar mi llave de recaudo'}
                            </button>
                        </>
                    )}

                    {error && (
                        <div style={{ marginTop: 13, padding: '11px 13px', borderRadius: 10, border: `1px solid ${AMBAR}44`, background: `${AMBAR}0F` }}>
                            <div className="flex items-start" style={{ gap: 8 }}>
                                <AlertTriangle size={13} style={{ color: AMBAR, flexShrink: 0, marginTop: 1 }} />
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ fontSize: 12, color: TXT, lineHeight: 1.55, margin: 0 }}>{error.texto}</p>
                                    {error.intentadas?.length ? (
                                        <p style={{ fontSize: 10.5, color: TXT2, marginTop: 5, lineHeight: 1.5, fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' }}>
                                            Se intentó: {error.intentadas.join(' · ')}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* El titular en la red Bre-B no es el cliente. Decirlo acá, en
                        chico pero siempre, evita que alguien lea esto como una
                        cuenta bancaria a su nombre — que no lo es. */}
                    <p style={{ fontSize: 10, color: TXT3, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BORDE}`, lineHeight: 1.55 }}>
                        La llave lleva el nombre de tu empresa y es tuya para cobrar. El titular registrado en la red
                        Bre-B es la entidad financiera aliada que opera el recaudo; Lincoin no es un banco.
                    </p>
                </div>
            </div>
        </div>
    );
};
