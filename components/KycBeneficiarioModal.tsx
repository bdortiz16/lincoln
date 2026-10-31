import React, { useRef, useState } from 'react';
import { X, Download, AlertTriangle } from 'lucide-react';

// Ficha KYC de un beneficiario: lo que TusDatos respondió sobre la persona
// (identidad en la Registraduría, veredicto y hallazgos). Se abre encima del
// detalle del beneficiario y usa la MISMA ficha que ya trajo la acción
// 'estado' — no gasta otra consulta ni otro crédito.

// Los hallazgos vienen con mucha repetición: "proceso civil", "proceso civil
// 002", "proceso civil 003"… son el mismo tipo numerado. Se agrupan y se
// cuenta cuántos hay. Lo usan esta ficha y la sección Antecedentes del
// detalle, para que las dos cuenten lo mismo.
export const agruparHallazgos = (hallazgos: any[]) => {
    const limpiar = (t: string) => String(t).replace(/\s*\d{1,3}\s*$/, '').trim();
    const grupos: any[] = [];
    const porClave = new Map<string, any>();
    for (const h of hallazgos) {
        const texto = limpiar(h.texto || h.codigo);
        const c = `${h.nivel}|${texto}`;
        if (porClave.has(c)) { porClave.get(c).n += 1; continue; }
        const g = { ...h, texto, n: 1 };
        porClave.set(c, g); grupos.push(g);
    }
    return grupos;
};

// Archivo viene de Google Fonts, y el navegador no deja leer las reglas de
// una hoja de otro dominio: la captura salía con la letra del sistema. Se
// baja el CSS de la fuente, cada archivo se vuelve data: y se le pasa a la
// captura ya armado. Una vez por sesión.
const ARCHIVO_CSS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap';
let fuenteEmbebida: Promise<string> | null = null;
const cssDeLaFuente = () => {
    fuenteEmbebida ??= (async () => {
        const css = await (await fetch(ARCHIVO_CSS)).text();
        const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
        const datos = await Promise.all(urls.map(async u => {
            const b = await (await fetch(u)).blob();
            return new Promise<string>((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = mal; fr.readAsDataURL(b); });
        }));
        return urls.reduce((acc, u, i) => acc.split(u).join(datos[i]), css);
    })().catch(e => { fuenteEmbebida = null; throw e; });
    return fuenteEmbebida;
};

const CATEGORIA: Record<string, string> = {
    alto: 'Riesgo alto', medio: 'Riesgo medio', bajo: 'Riesgo bajo',
    ninguno: 'Sin antecedentes', informativo: 'Sin antecedentes', sin_validar: 'Documento sin validar',
};
const ESTADO: Record<string, string> = {
    finalizado: 'Finalizada', procesando: 'En curso', sin_autorizacion: 'Sin autorización del titular',
};
const FUENTE: Record<string, string> = { registraduria: 'Registraduría' };

const fmtFecha = (d?: string, conHora = false) => {
    if (!d) return null;
    // Una fecha sola ("2008-03-14") se lee como medianoche UTC, que en
    // Colombia es el día anterior. Se arma en hora local.
    const solo = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    const t = solo ? new Date(+solo[1], +solo[2] - 1, +solo[3]) : new Date(d);
    if (isNaN(t.getTime())) return String(d);
    return conHora
        ? t.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
        : t.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const Fila: React.FC<{ l: string; v: React.ReactNode; mono?: boolean }> = ({ l, v, mono }) => (
    <div className="flex items-start justify-between gap-4" style={{ padding: '11px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 12.5, color: '#878E88', flexShrink: 0 }}>{l}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F2', textAlign: 'right', wordBreak: 'break-word', ...(mono ? { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 } : {}) }}>{v}</span>
    </div>
);

const Rotulo: React.FC<{ t: string; primero?: boolean }> = ({ t, primero }) => (
    <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88', marginTop: primero ? 0 : 18, marginBottom: 2 }}>{t}</p>
);

export const KycBeneficiarioModal: React.FC<{
    ficha: any;
    nombre: string;
    iniciales: string;
    subtitulo: string;
    docType?: string;
    docNumber?: string;
    insignia: React.ReactNode;
    onCerrar: () => void;
}> = ({ ficha: k, nombre, iniciales, subtitulo, docType, docNumber, insignia, onCerrar }) => {
    const cajaRef = useRef<HTMLDivElement>(null);
    const [generando, setGenerando] = useState(false);
    const [errorPdf, setErrorPdf] = useState<string | null>(null);

    // El PDF es una FOTO de esta misma ventana: mismos colores, misma fuente,
    // mismas filas. Se copia la caja fuera de pantalla, sin el alto máximo
    // (que en pantalla corta el cuerpo y lo pone a desplazar) y sin los
    // botones, se captura entera y va a una sola página del tamaño exacto.
    // Las librerías se bajan solo al tocar el botón.
    //
    // Una ficha de Sarblock trae el catálogo completo de la consulta: con eso
    // se arma el reporte de verificación con marca Lincoin (varias hojas A4,
    // todas las fuentes y el porqué del veredicto) en vez de la foto.
    const descargarPdf = async () => {
        if (generando) return;
        if (k?.proveedor === 'sarblock' && Array.isArray(k?.sarblock?.catalog)) {
            setGenerando(true); setErrorPdf(null);
            try {
                const { descargarReporteLincoin } = await import('./reporte/ReporteLincoin');
                await descargarReporteLincoin({ ...k, documento: k.documento ?? docNumber, tipoDocumento: k.tipoDocumento ?? docType });
            } catch (e) {
                console.warn('[kyc] reporte', e);
                setErrorPdf('No se pudo generar el reporte. Vuelve a intentarlo.');
            } finally { setGenerando(false); }
            return;
        }
        const caja = cajaRef.current;
        if (!caja) return;
        setGenerando(true); setErrorPdf(null);
        const fuera = document.createElement('div');
        try {
            const [{ toJpeg }, { jsPDF }, fontEmbedCSS] = await Promise.all([import('html-to-image'), import('jspdf'), cssDeLaFuente()]);
            const ancho = caja.offsetWidth;
            const copia = caja.cloneNode(true) as HTMLDivElement;
            copia.querySelectorAll('[data-sin-pdf]').forEach(n => n.remove());
            copia.classList.remove('animate-in', 'zoom-in-95', 'duration-300');
            Object.assign(copia.style, { maxHeight: 'none', width: `${ancho}px`, maxWidth: 'none' });
            const cuerpo = copia.querySelector<HTMLElement>('[data-cuerpo]');
            if (cuerpo) Object.assign(cuerpo.style, { overflowY: 'visible', flex: 'none' });
            Object.assign(fuera.style, { position: 'fixed', left: '-10000px', top: '0', pointerEvents: 'none' });
            fuera.appendChild(copia);
            document.body.appendChild(fuera);
            await document.fonts.ready;
            const alto = copia.offsetHeight;
            // JPEG y no PNG: en PNG la página pesaba 8 MB; sobre fondo
            // oscuro el JPEG no deja marcas que se noten.
            const img = await toJpeg(copia, { quality: 0.92, pixelRatio: 2, backgroundColor: '#0C0E0D', width: ancho, height: alto, fontEmbedCSS });
            const pdf = new jsPDF({ unit: 'px', format: [ancho, alto], orientation: alto >= ancho ? 'portrait' : 'landscape', hotfixes: ['px_scaling'], compress: true });
            pdf.addImage(img, 'JPEG', 0, 0, ancho, alto);
            const doc = String(docNumber ?? '').replace(/\D/g, '');
            pdf.save(`kyc-${doc || nombre.replace(/[^\w]+/g, '-').toLowerCase()}.pdf`);
        } catch (e) {
            console.warn('[kyc] pdf', e);
            setErrorPdf('No se pudo generar el PDF. Vuelve a intentarlo.');
        } finally {
            fuera.remove();
            setGenerando(false);
        }
    };

    const est = String(k?.estado ?? '');
    const cat = String(k?.categoria ?? '');
    const grupos = Array.isArray(k?.hallazgos) ? agruparHallazgos(k.hallazgos) : [];
    const anteriores: any[] = Array.isArray(k?.nombresAnteriores) ? k.nombresAnteriores : [];
    const fuentesError: string[] = Array.isArray(k?.fuentesConError) ? k.fuentesConError : [];
    const rojo = (t: string) => <span style={{ color: '#F87171' }}>{t}</span>;

    return (
        // Un nivel por encima del detalle (z-50): al cerrar se vuelve a él.
        <div className="fixed inset-0 z-[60] p-3 sm:p-4" style={{ background: 'rgba(4,5,4,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} onClick={onCerrar}>
            <div ref={cajaRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full animate-in zoom-in-95 duration-300"
                style={{
                    maxWidth: 640, maxHeight: 'calc(100dvh - 24px)', display: 'flex', flexDirection: 'column',
                    background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18,
                    overflow: 'hidden', fontFamily: "'Archivo', system-ui, sans-serif",
                }}>
                {/* Cabecera: de quién es la ficha */}
                <div style={{ padding: '18px 20px 15px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                    <div className="flex items-center gap-3">
                        <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <span style={{ color: '#878E88', fontWeight: 800, fontSize: 14 }}>{iniciales}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88' }}>KYC</p>
                            <p style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: '-0.3px', color: '#F4F4F2', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{nombre}</p>
                            <p style={{ fontSize: 12, color: '#878E88', marginTop: 2 }}>{subtitulo}</p>
                        </div>
                        <button data-sin-pdf onClick={onCerrar} aria-label="Cerrar" style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <X size={14} style={{ color: '#878E88' }} strokeWidth={1.7} />
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 11 }}>{insignia}</div>
                </div>

                {/* Cuerpo */}
                <div data-cuerpo style={{ padding: '16px 24px 14px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
                    <Rotulo t="IDENTIDAD" primero />
                    <div>
                        <Fila l="Nombre inscrito" v={String(k?.nombreInscrito ?? nombre)} />
                        {(k?.nombreReal || k?.nombre) && (
                            <Fila l="Nombre en el documento" v={k?.nombreCoincide === false ? rojo(String(k.nombreReal ?? k.nombre)) : String(k.nombreReal ?? k.nombre)} />
                        )}
                        {docNumber && <Fila l="Documento" v={`${docType ?? ''} ${docNumber}`.trim()} />}
                        {k?.documentoVigente != null && (
                            <Fila l="Estado del documento" v={k.documentoVigente ? 'Vigente' : rojo(`No vigente${k.estadoDocumento ? ` · ${k.estadoDocumento}` : ''}`)} />
                        )}
                        {k?.lugarExpedicion && <Fila l="Lugar de expedición" v={String(k.lugarExpedicion)} />}
                        {k?.fechaExpedicionDoc && <Fila l="Fecha de expedición" v={fmtFecha(k.fechaExpedicionDoc)} />}
                        {k?.lugarFuente && <Fila l="Fuente" v={FUENTE[String(k.lugarFuente)] ?? String(k.lugarFuente)} />}
                    </div>

                    <Rotulo t="VERIFICACIÓN" />
                    <div>
                        <Fila l="Estado de la consulta" v={ESTADO[est] ?? (est || '—')} />
                        {cat && <Fila l="Categoría" v={CATEGORIA[cat] ?? cat} />}
                        {k?.operable != null && <Fila l="Operable" v={k.operable ? 'Sí' : rojo('No')} />}
                        {k?.aprobadoManual === true && <Fila l="Revisión de cumplimiento" v="Aprobado por Lincoin" />}
                        {k?.bloqueo && <Fila l="Motivo del bloqueo" v={rojo(String(k.bloqueo))} />}
                        {k?.at && <Fila l="Última consulta" v={fmtFecha(k.at, true)} />}
                        {k?.reportId && <Fila l="Reporte" v={String(k.reportId)} mono />}
                    </div>

                    {est === 'finalizado' && (
                        <>
                            <Rotulo t="HALLAZGOS" />
                            <p style={{ fontSize: 12, color: '#878E88', padding: '8px 0 2px' }}>
                                {k?.altos ?? 0} alto{(k?.altos ?? 0) === 1 ? '' : 's'} · {k?.medios ?? 0} medio{(k?.medios ?? 0) === 1 ? '' : 's'} · {k?.bajos ?? 0} bajo{(k?.bajos ?? 0) === 1 ? '' : 's'}
                            </p>
                            {grupos.length > 0 ? (
                                <div style={{ marginTop: 8, background: '#121413', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '3px 12px 11px' }}>
                                    {grupos.map((h: any, i: number) => (
                                        <div key={`${h.codigo}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
                                            <span style={{
                                                flexShrink: 0, marginTop: 1, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.5px',
                                                border: `1px solid ${h.nivel === 'alto' ? 'rgba(248,113,113,0.32)' : 'rgba(251,191,36,0.32)'}`,
                                                color: h.nivel === 'alto' ? '#F87171' : '#FBBF24',
                                                borderRadius: 999, padding: '2px 7px',
                                            }}>{h.nivel === 'alto' ? 'ALTO' : 'MEDIO'}</span>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <p style={{ fontSize: 12, color: '#F4F4F2', margin: 0, lineHeight: 1.45 }}>
                                                    {h.texto}
                                                    {h.n > 1 && <span style={{ color: '#878E88', fontWeight: 700 }}> ×{h.n}</span>}
                                                </p>
                                                {h.fuente && <p style={{ fontSize: 10.5, color: 'rgba(244,244,242,0.45)', margin: '1px 0 0' }}>{h.fuente}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ fontSize: 12, color: 'rgba(244,244,242,0.45)', paddingTop: 4 }}>
                                    {(k?.altos ?? 0) + (k?.medios ?? 0) > 0 ? 'El detalle de los hallazgos no quedó guardado en esta consulta.' : 'No se encontraron antecedentes de riesgo.'}
                                </p>
                            )}
                        </>
                    )}

                    {fuentesError.length > 0 && (
                        <>
                            <Rotulo t="FUENTES QUE NO RESPONDIERON" />
                            <p style={{ fontSize: 12, color: '#878E88', padding: '8px 0 0', lineHeight: 1.55 }}>{fuentesError.join(' · ')}</p>
                        </>
                    )}

                    {anteriores.length > 0 && (
                        <>
                            <Rotulo t="NOMBRES ANTERIORES" />
                            <div>
                                {anteriores.map((a, i) => (
                                    <Fila key={i} l={String(a?.nombre ?? '—')} v={a?.hasta ? `hasta ${fmtFecha(a.hasta)}` : '—'} />
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Botonera */}
                <div data-sin-pdf style={{ padding: '14px 24px 22px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, background: '#0C0E0D' }}>
                    {errorPdf && (
                        <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 12, background: '#121413', border: '1px solid rgba(251,191,36,0.26)', borderRadius: 10, padding: '10px 13px' }}>
                            <AlertTriangle size={14} color="#FBBF24" style={{ flexShrink: 0, marginTop: 1 }} />
                            <p style={{ fontSize: 12, color: '#878E88', margin: 0, lineHeight: 1.5 }}>
                                {errorPdf}
                            </p>
                        </div>
                    )}
                    <div className="flex items-center" style={{ gap: 9 }}>
                        <button onClick={onCerrar} className="hover:bg-white/[0.09] transition-colors"
                            style={{ flex: 1, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontSize: 13.5, fontWeight: 600 }}>
                            Cerrar
                        </button>
                        <button onClick={descargarPdf} disabled={generando} className="lincoin-btn-white flex items-center justify-center gap-2 transition-colors"
                            style={{ flex: 1.4, height: 44, borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: 'none', opacity: generando ? 0.55 : 1, cursor: generando ? 'default' : 'pointer' }}>
                            <Download size={14} /> {generando ? 'Generando…' : 'Descargar PDF'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
