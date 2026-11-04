// Lincoin Risk para la empresa, en tres secciones (antes todo iba en una
// sola página larga y no se encontraba nada — pedido del dueño, 2026-11):
//   · Consultar: la consulta se llena sobre un carnet en blanco (el mismo
//     carnet del resultado); mientras consulta se ven avanzar las fuentes y
//     el resultado sale como carnet. Debajo, la lista de personas y empresas
//     ya consultadas: escribir el documento de una la reconoce y no se cobra
//     de nuevo mientras esté vigente;
//   · Mapa: dónde aparecen los consultados;
//   · Historial de búsqueda.
// El detalle y la recarga se abren en un panel lateral. El saldo es tarjeta
// y botón de recarga a la vez.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { descargarReporteLincoin } from '../reporte/ReporteLincoin';
import { MapaColombia } from './MapaColombia';
import { llamarFuncion } from '../../lib/edge';
import { lugaresDeDespachos, mapaDePersonas } from '../../lib/ubicacion';
import { tipoProbable } from '../../lib/nit';
import { CarnetRisk, ESTILOS_CARNET, Silueta, Wordmark, documentoLegible, fechaCorta, nivelDe } from './Carnet';

// Va con el token de la sesión: la función sabe de qué cuenta es sin que la
// pantalla mande un userId (y no se puede pedir el de otra).
export const llamar = (action: string, extra: Record<string, unknown> = {}) =>
  llamarFuncion('sarblock', { action, ...extra }, 60000);

export const C = { base: '#070808', fondo: '#0C0E0D', elevado: '#121413', borde: 'rgba(255,255,255,0.08)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', ambar: '#FBBF24', rojo: '#F87171' };
export const LBL: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, textTransform: 'uppercase', display: 'block', marginBottom: 6 };
export const INP: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.elevado, border: '1px solid rgba(255,255,255,0.11)', borderRadius: 10, padding: '11px 12px', color: C.texto, fontSize: 13.5, fontFamily: 'inherit', outline: 'none' };
export const BTN: React.CSSProperties = { height: 44, borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: 'none', background: '#F4F4F2', color: '#15181A', padding: '0 20px', cursor: 'pointer', fontFamily: 'inherit' };
export const BTN2: React.CSSProperties = { height: 44, borderRadius: 10, fontSize: 13.5, fontWeight: 600, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: C.texto, padding: '0 18px', cursor: 'pointer', fontFamily: 'inherit' };
export const TARJETA: React.CSSProperties = { background: C.fondo, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 18 };
export const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const num = (n: number) => Math.round(n).toLocaleString('es-CO');
export const hace = (d: string) => {
  const m = Math.round((Date.now() - Date.parse(d)) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const ESTILOS = `
@keyframes lr-giro { to { transform: rotate(360deg) } }
@keyframes lr-entra { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes lr-panel { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes lr-pulso { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
.lr-entra { animation: lr-entra .28s ease-out both }
.lr-fila:hover { background: rgba(255,255,255,0.035) }
.lr-chip:hover { border-color: rgba(255,255,255,0.28) !important }
.lr-input:focus-within { border-color: rgba(74,222,128,0.55) !important; box-shadow: 0 0 0 4px rgba(74,222,128,0.08) }
`;

// ── Veredicto ───────────────────────────────────────────────────────────
type Tono = { t: string; c: string; corto: string; txt: string };
const veredicto = (f: any, nombre: string, estado?: string): Tono => {
  if (!f) return { t: '—', c: C.sub, corto: '—', txt: '' };
  // La Registraduría no encontró el documento: no hubo revisión real.
  if (estado === 'no_verificado' || (f.documentoNoEncontrado && !f.hallazgo)) return { t: 'No se pudo verificar', corto: 'Sin verificar', c: C.sub, txt: 'No encontramos ese documento en la Registraduría. Revisa el tipo y el número.' + (estado === 'no_verificado' ? ' Te devolvimos la consulta.' : '') };
  if (f.nombreCoincide === false) return { t: 'El nombre no corresponde', corto: 'Revisar', c: C.rojo, txt: f.bloqueo };
  if (f.operable === false || f.categoria === 'alto') return { t: 'Riesgo alto', corto: 'Alto', c: C.rojo, txt: 'No se recomienda operar con esta persona.' };
  if (f.categoria === 'medio') return { t: 'Riesgo medio', corto: 'Medio', c: C.ambar, txt: 'Hay hallazgos que conviene revisar antes de operar.' };
  if (f.categoria === 'sin_validar') return { t: 'Identidad sin validar', corto: 'Revisar', c: C.ambar, txt: 'No se pudo contrastar el documento con la fuente oficial.' };
  return { t: f.categoria === 'bajo' ? 'Riesgo bajo' : 'Sin hallazgos', corto: 'Bajo', c: C.verde, txt: `Se puede operar con ${nombre || 'esta persona'}.` };
};
export const GRUPO: Record<string, { t: string; c: string }> = { alto: { t: 'Alto', c: C.rojo }, medio: { t: 'Medio', c: C.ambar }, bajo: { t: 'Bajo', c: C.verde } };
export const TIPOS: Record<string, string> = { sanciones: 'Listas restrictivas', judicial: 'Procesos judiciales', antecedentes: 'Antecedentes', pep: 'PEP', prensa: 'Prensa adversa', identidad: 'Identidad', ninguno: 'Sin hallazgos' };
// Vencimiento con color: verde, ámbar (≤30 días), rojo (≤7), gris (vencida).
const VENCE: Record<string, { c: string; t: (d: number) => string }> = {
  vigente: { c: C.verde, t: d => `Vence en ${d} días` },
  pronto: { c: C.ambar, t: d => `Vence en ${d} días` },
  critico: { c: C.rojo, t: d => d === 1 ? 'Vence mañana' : `Vence en ${d} días` },
  vencida: { c: C.tenue, t: () => 'Vencida' },
};
export const Vence: React.FC<{ v: any }> = ({ v }) => {
  if (!v) return null;
  const e = VENCE[v.estado] ?? VENCE.vigente;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: e.c, border: `1px solid ${e.c === C.tenue ? 'rgba(255,255,255,0.14)' : e.c + '55'}`, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: e.c }} />{e.t(v.dias)}</span>;
};

export const Punto: React.FC<{ c: string; tam?: number }> = ({ c, tam = 8 }) => <span style={{ width: tam, height: tam, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />;
const Giro: React.FC<{ tam?: number }> = ({ tam = 14 }) => <span style={{ width: tam, height: tam, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: C.verde, display: 'inline-block', animation: 'lr-giro .8s linear infinite', flexShrink: 0 }} />;

// Cifra que sube o baja animada (el saldo al recargar o consultar).
const Contador: React.FC<{ valor: number; style?: React.CSSProperties }> = ({ valor, style }) => {
  const [v, setV] = useState(valor);
  const previo = useRef(valor);
  useEffect(() => {
    const desde = previo.current, hasta = valor, t0 = performance.now();
    previo.current = valor;
    if (desde === hasta) return;
    let raf = 0;
    const paso = (t: number) => { const k = Math.min(1, (t - t0) / 700); setV(Math.round(desde + (hasta - desde) * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(paso); };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return <span style={style}>{num(v)}</span>;
};

// ── Panel lateral ───────────────────────────────────────────────────────
export const Panel: React.FC<{ titulo: string; abierto: boolean; cerrar: () => void; children: React.ReactNode; ancho?: number }> = ({ titulo, abierto, cerrar, children, ancho = 520 }) => {
  useEffect(() => {
    if (!abierto) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [abierto, cerrar]);
  if (!abierto) return null;
  return (
    <div onClick={cerrar} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(4,5,4,0.6)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={titulo}
        style={{ width: `min(${ancho}px, 100vw)`, height: '100%', background: C.fondo, borderLeft: `1px solid ${C.borde}`, display: 'flex', flexDirection: 'column', animation: 'lr-panel .22s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.borde}` }}>
          <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{titulo}</p>
          <button onClick={cerrar} aria-label="Cerrar" style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${C.borde}`, background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
};

// ── Resultado ───────────────────────────────────────────────────────────
export const Resultado: React.FC<{ consulta: any; compacto?: boolean; acciones?: React.ReactNode }> = ({ consulta, compacto, acciones }) => {
  const [pdf, setPdf] = useState(false);
  const f = consulta.ficha;
  const lugares = useMemo(() => lugaresDeDespachos(consulta.despachos), [consulta.despachos]);
  // Si hay incidencias se muestran de una: es lo primero que hay que leer.
  const [verPorque, setVerPorque] = useState((f?.hallazgos ?? []).length > 0 || !compacto);
  const nombre = consulta.nombreOficial || consulta.nombreEscrito || (consulta.estado === 'no_verificado' || f?.documentoNoEncontrado ? 'Documento no encontrado' : 'Sin nombre');
  const v = veredicto(f, nombre.split(' ')[0], consulta.estado);
  const fuentes: any[] = f?.sarblock?.catalog ?? [];
  // Antes decía "27 fuentes revisadas" aunque 22 no se hubieran revisado.
  const limpias = fuentes.filter(x => x.status === 'CLEAR' || x.status === 'VERIFIED').length;
  const noAplicaron = fuentes.filter(x => x.status === 'SKIPPED' || x.status === 'NOT_FOUND').length;
  const noDisponibles = fuentes.filter(x => x.status === 'UNAVAILABLE' || x.status === 'ERROR').length;
  const motivos: any[] = f?.hallazgos ?? [];
  const descargar = async () => {
    setPdf(true);
    try { await descargarReporteLincoin({ ...f, empresa: consulta.empresa, consultadoPor: consulta.por, consultadoAt: consulta.at }); } finally { setPdf(false); }
  };
  return (
    <div className="lr-entra">
      {/* La consulta como carnet (Carnet.tsx), y debajo el veredicto en
          palabras: el carnet resume, esto explica. */}
      <div style={{ padding: compacto ? '18px 16px 4px' : '22px 24px 6px' }}>
        <CarnetRisk consulta={consulta} />
      </div>
      <div style={{ padding: compacto ? '12px 20px 4px' : '14px 24px 4px', borderBottom: `1px solid ${C.borde}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Punto c={v.c} tam={9} />
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px', color: v.c }}>{v.t}</span>
          <Vence v={consulta.vence} />
        </div>
        <p style={{ fontSize: 13.5, color: C.texto, margin: '6px 0 12px', lineHeight: 1.5 }}>{v.txt}{nombre && consulta.at ? <span style={{ color: C.sub }}> · consultada {hace(consulta.at)}</span> : null}</p>
        {f?.nombreIncompleto && <p style={{ fontSize: 12, color: C.sub, margin: '-6px 0 12px' }}>Escrito como “{consulta.nombreEscrito}”: es el mismo nombre, incompleto.</p>}
      </div>
      <div style={{ padding: compacto ? '14px 20px' : '16px 24px', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5, color: C.sub }}>
        <span><b style={{ color: C.texto }}>{limpias}</b> sin novedad</span>
        {noAplicaron > 0 && <span><b style={{ color: C.texto }}>{noAplicaron}</b> no aplicaron</span>}
        {noDisponibles > 0 && <span><b style={{ color: C.ambar }}>{noDisponibles}</b> {noDisponibles === 1 ? 'no respondió' : 'no respondieron'}</span>}
        {motivos.length > 0 && <span><b style={{ color: v.c }}>{motivos.length}</b> {motivos.length === 1 ? 'hallazgo' : 'hallazgos'}</span>}
      </div>
      {motivos.length > 0 && (
        <div style={{ padding: compacto ? '0 20px 14px' : '0 24px 16px' }}>
          <button onClick={() => setVerPorque(x => !x)} style={{ background: 'none', border: 'none', color: C.texto, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
            {verPorque ? '▾' : '▸'} Por qué
          </button>
          {verPorque && (
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {motivos.slice(0, 8).map((h, i) => (
                <div key={i} className="lr-entra" style={{ animationDelay: `${i * 40}ms`, display: 'flex', gap: 10, padding: '10px 12px', background: C.elevado, borderRadius: 10, borderLeft: `2px solid ${h.nivel === 'alto' ? C.rojo : C.ambar}` }}>
                  <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>{h.texto}</span>
                </div>
              ))}
              {motivos.length > 8 && <p style={{ fontSize: 12, color: C.tenue, margin: 0 }}>Y {motivos.length - 8} más en el reporte.</p>}
            </div>
          )}
        </div>
      )}
      {lugares.length > 0 && (
        <div style={{ padding: compacto ? '0 20px 16px' : '0 24px 18px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 10px' }}>Dónde aparece</p>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <MapaColombia tam={22} color="248,113,113" datos={Object.fromEntries(lugares.reduce((m: Map<string, any>, l: any) => {
              const d = m.get(l.depto) ?? { valor: 0, nombre: l.deptoNombre, ciudades: [] as string[] };
              d.valor += l.procesos; d.ciudades.push(l.municipio); d.detalle = `${d.valor} proceso(s) · ${d.ciudades.join(', ')}`; m.set(l.depto, d); return m;
            }, new Map()))} />
            <div style={{ flex: 1, minWidth: 160, display: 'grid', gap: 6 }}>
              {lugares.map((l: any) => (
                <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                  <span>{l.municipio}<span style={{ color: C.tenue }}> · {l.deptoNombre}</span></span>
                  <span style={{ color: C.sub, whiteSpace: 'nowrap' }}>{l.procesos} {l.procesos === 1 ? 'proceso' : 'procesos'}</span>
                </div>
              ))}
              <p style={{ fontSize: 11, color: C.tenue, margin: '4px 0 0' }}>Según los despachos de sus procesos en la Rama Judicial. No es su dirección.</p>
            </div>
          </div>
        </div>
      )}
      <div style={{ padding: compacto ? '0 20px 20px' : '0 24px 22px', display: 'flex', gap: 9, flexWrap: 'wrap' }}>
        <button onClick={descargar} disabled={pdf || !f} style={{ ...BTN, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{pdf ? <><Giro /> Generando…</> : '↓ Descargar reporte PDF'}</button>
        {acciones}
      </div>
    </div>
  );
};

// ── Consulta en curso: las fuentes avanzan ──────────────────────────────
const PASOS = ['Identidad en la Registraduría', 'Listas internacionales (OFAC, ONU, UE…)', 'Personas expuestas políticamente', 'Policía, Procuraduría y Contraloría', 'Procesos en la Rama Judicial', 'Prensa adversa'];
const Avance: React.FC = () => {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(x => Math.min(PASOS.length - 1, x + 1)), 6000); return () => clearInterval(t); }, []);
  return (
    <div className="lr-entra" style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Consultando fuentes oficiales…</p>
      <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 14px' }}>Suele tardar menos de un minuto. Puedes quedarte aquí.</p>
      <div style={{ display: 'grid', gap: 9 }}>
        {PASOS.map((p, k) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: k < i ? C.texto : k === i ? C.texto : C.tenue }}>
            {k < i ? <span style={{ color: C.verde, width: 14, textAlign: 'center' }}>✓</span> : k === i ? <Giro /> : <span style={{ width: 14, textAlign: 'center', animation: 'lr-pulso 1.6s infinite' }}>·</span>}
            {p}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Recarga (panel por pasos) ───────────────────────────────────────────
const Recarga: React.FC<{ cuenta: any; listo: () => void }> = ({ cuenta, listo }) => {
  const t = cuenta.tienda;
  const paquetes = useMemo(() => [t.minimoCompra, t.minimoCompra * 3, t.minimoCompra * 10].map(n => Math.max(t.minimoCompra, Math.round(n / 50) * 50)), [t.minimoCompra]);
  const [cantidad, setCantidad] = useState<number>(paquetes[1]);
  const [otra, setOtra] = useState(false);
  const [bolsillo, setBolsillo] = useState<string>(t.bolsillos.find((b: any) => b.saldo > 0)?.clave ?? t.bolsillos[0]?.clave ?? '');
  const [paso, setPaso] = useState<'elegir' | 'confirmar' | 'listo'>('elegir');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const cot = (n: number) => { const s = Math.round(n * t.precioPorConsulta), i = Math.round(s * t.ivaPct / 100); return { subtotal: s, iva: i, total: s + i }; };
  const { subtotal, iva, total } = cot(cantidad);
  const elegido = t.bolsillos.find((b: any) => b.clave === bolsillo);
  const valido = cantidad >= t.minimoCompra && !!elegido && elegido.saldo >= total;

  if (!(t.precioPorConsulta > 0)) return <p style={{ padding: 20, color: C.sub, fontSize: 13 }}>La compra de consultas estará disponible muy pronto.</p>;
  if (paso === 'listo') return (
    <div className="lr-entra" style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', margin: '0 auto', display: 'grid', placeItems: 'center', background: 'rgba(74,222,128,0.12)', color: C.verde, fontSize: 26 }}>✓</div>
      <p style={{ fontSize: 18, fontWeight: 800, margin: '16px 0 4px' }}>¡Listo! Sumaste {num(cantidad)} consultas</p>
      <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>Se descontaron {pesos(total)} de {elegido?.etiqueta}.</p>
      <button onClick={listo} style={{ ...BTN, marginTop: 22 }}>Empezar a consultar</button>
    </div>
  );
  if (paso === 'confirmar') return (
    <div className="lr-entra" style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>Vas a comprar</p>
      <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.8px', margin: '2px 0 0' }}>{num(cantidad)} consultas</p>
      <div style={{ marginTop: 18, background: C.elevado, borderRadius: 12, padding: '14px 16px', fontSize: 13, display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.sub }}>{num(cantidad)} × {pesos(t.precioPorConsulta)}</span><span>{pesos(subtotal)}</span></div>
        {t.ivaPct > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.sub }}>IVA {t.ivaPct}%</span><span>{pesos(iva)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.borde}`, paddingTop: 8, marginTop: 2, fontWeight: 800, fontSize: 15 }}><span>Total</span><span>{pesos(total)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: C.sub }}><span>Se paga con</span><span>{elegido?.etiqueta}</span></div>
      </div>
      <p style={{ fontSize: 12, color: C.tenue, margin: '12px 0 0' }}>En la app se confirma con tu código de dos pasos. Las consultas no vencen.</p>
      {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: '10px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
        <button onClick={() => setPaso('elegir')} style={BTN2}>Atrás</button>
        <button disabled={ocupado} style={{ ...BTN, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={async () => {
          setOcupado(true); setError(null);
          const r = await llamar('risk_comprar', { cantidad, bolsillo });
          setOcupado(false);
          if (!r?.ok) { setError(r?.motivo ?? 'No se pudo completar la compra.'); return; }
          setPaso('listo');
        }}>{ocupado ? <><Giro /> Comprando…</> : `Pagar ${pesos(total)}`}</button>
      </div>
    </div>
  );
  return (
    <div style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 13, color: C.sub, margin: '0 0 12px' }}>Elige un paquete. {pesos(t.precioPorConsulta)} por consulta{t.ivaPct ? ` + IVA` : ''} · mínimo {num(t.minimoCompra)}.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {paquetes.map((n, k) => {
          const sel = !otra && cantidad === n;
          return (
            <button key={n} onClick={() => { setOtra(false); setCantidad(n); }} className="lr-chip"
              style={{ position: 'relative', textAlign: 'left', padding: '14px 12px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', color: C.texto,
                background: sel ? 'rgba(74,222,128,0.08)' : C.elevado, border: `1.5px solid ${sel ? 'rgba(74,222,128,0.6)' : 'rgba(255,255,255,0.1)'}` }}>
              {k === 1 && <span style={{ position: 'absolute', top: -9, left: 10, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', background: C.verde, color: '#0A0B0A', borderRadius: 999, padding: '2px 7px' }}>MÁS ELEGIDO</span>}
              <p style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{num(n)}</p>
              <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>consultas</p>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: '8px 0 0' }}>{pesos(cot(n).total)}</p>
            </button>
          );
        })}
      </div>
      <button onClick={() => setOtra(true)} style={{ background: 'none', border: 'none', color: otra ? C.texto : C.sub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0, marginTop: 12, fontFamily: 'inherit' }}>Otra cantidad</button>
      {otra && (
        <div className="lr-entra" style={{ marginTop: 8 }}>
          <input autoFocus type="number" min={t.minimoCompra} step={50} value={cantidad} onChange={e => setCantidad(Math.floor(Number(e.target.value) || 0))} style={INP} />
          {cantidad < t.minimoCompra && <p style={{ fontSize: 12, color: C.ambar, margin: '6px 0 0' }}>El mínimo es {num(t.minimoCompra)} consultas.</p>}
        </div>
      )}
      <p style={{ ...LBL, marginTop: 20 }}>Pagar con</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {t.bolsillos.map((b: any) => {
          const alcanza = b.saldo >= total, sel = bolsillo === b.clave;
          return (
            <button key={b.clave} onClick={() => setBolsillo(b.clave)} className="lr-chip"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', color: C.texto, textAlign: 'left',
                background: sel ? 'rgba(74,222,128,0.06)' : C.elevado, border: `1.5px solid ${sel ? 'rgba(74,222,128,0.55)' : 'rgba(255,255,255,0.1)'}` }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${sel ? C.verde : 'rgba(255,255,255,0.25)'}`, display: 'grid', placeItems: 'center' }}>{sel && <Punto c={C.verde} tam={7} />}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{b.etiqueta}</span>
                <span style={{ display: 'block', fontSize: 12, color: alcanza ? C.sub : C.rojo }}>{pesos(b.saldo)} disponibles{alcanza ? '' : ' · no alcanza'}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ position: 'sticky', bottom: 0, background: C.fondo, paddingTop: 16, marginTop: 8 }}>
        <button onClick={() => setPaso('confirmar')} disabled={!valido} style={{ ...BTN, width: '100%', opacity: valido ? 1 : 0.4, cursor: valido ? 'pointer' : 'not-allowed' }}>
          Continuar · {pesos(total)}
        </button>
      </div>
    </div>
  );
};

// ── Lista de consultados ────────────────────────────────────────────────
// Una fila por persona o empresa, con su consulta más reciente. Es la
// memoria para no consultar dos veces a la misma (pedido del dueño,
// 2026-11): al escribir su documento en el carnet de arriba se la reconoce,
// no se cobra de nuevo mientras esté vigente y su fila se resalta.
const TONO: Record<string, string> = { bajo: C.verde, medio: C.ambar, alto: C.rojo, revisar: C.rojo, sin_validar: C.ambar, sin_verificar: C.sub };
const COLS_REG = '38px minmax(0, 1.5fr) minmax(0, 1.2fr) 150px 92px';
const FilaConsultado: React.FC<{ c: any; resaltar?: boolean; primera?: boolean; retraso: number; onClick: () => void }> = ({ c, resaltar, primera, retraso, onClick }) => {
  const n = nivelDe(c);
  const tono = TONO[n.k] ?? C.sub;
  const empresa = c.tipoPersona === 'juridica' || String(c.tipoDocumento).toUpperCase() === 'NIT';
  const hallazgos = ((c.riesgos ?? []) as string[]).filter(r => r !== 'ninguno').map(r => TIPOS[r] ?? r);
  const vencida = c.vence?.estado === 'vencida';
  return (
    <button onClick={onClick} className="lr-fila lr-reg lr-entra" aria-label={`${c.nombreOficial || c.nombreEscrito || c.documento}: riesgo ${n.t}`}
      style={{ animationDelay: `${retraso}ms`, width: '100%', textAlign: 'left', display: 'grid', gridTemplateColumns: COLS_REG, alignItems: 'center', gap: 14, padding: '11px 16px',
        background: resaltar ? 'rgba(74,222,128,0.07)' : 'transparent', border: 'none', borderTop: primera ? 'none' : `1px solid ${C.borde}`, boxShadow: resaltar ? `inset 3px 0 0 ${C.verde}` : 'none', color: C.texto, cursor: 'pointer', fontFamily: 'inherit' }}>
      {/* La "foto" del carnet, en chiquito. */}
      <span style={{ width: 38, height: 44, borderRadius: 9, background: 'linear-gradient(180deg, #E3E7EB, #CDD3DA)', display: 'grid', placeItems: 'end center', overflow: 'hidden' }}>
        <Silueta empresa={empresa} tam={empresa ? 28 : 34} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="lr-nom" style={{ display: 'block', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nombreOficial || c.nombreEscrito || 'Sin nombre'}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.sub, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {documentoLegible(c.tipoDocumento, c.documento)}
          <span className="lr-movil" style={{ color: vencida ? C.rojo : C.sub }}> · {vencida ? 'vencida' : `vence ${fechaCorta(c.vence?.venceAt)}`}</span>
        </span>
      </span>
      <span className="lr-col-c" style={{ minWidth: 0, fontSize: 12 }}>
        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fechaCorta(c.at)}{c.por ? <span style={{ color: C.sub }}> · {c.por}</span> : null}</span>
        <span style={{ display: 'block', color: hallazgos.length ? '#FCA5A5' : C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{hallazgos.length ? `⚠ ${hallazgos.join(' · ')}` : 'Sin hallazgos'}</span>
      </span>
      <span className="lr-col-v"><Vence v={c.vence} /></span>
      <span style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: tono, background: `${tono}1A`, border: `1px solid ${tono}55`, borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' }}>
        <Punto c={tono} tam={6} />{n.t}
      </span>
    </button>
  );
};

// ── El formulario como carnet en blanco ─────────────────────────────────
// Pedido del dueño (2026-11): la consulta se llena sobre el mismo carnet que
// sale de resultado, no en un formulario suelto. Cuerpo claro, como el
// carnet; por eso los campos y los avisos tienen su propio estilo claro.
const IN_C: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid rgba(21,24,26,0.16)', borderRadius: 9, padding: '9px 11px', color: '#15181A', fontSize: 14, fontFamily: 'inherit', outline: 'none' };
const BTN_C: React.CSSProperties = { height: 42, borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: 'none', background: '#15181A', color: '#F4F4F2', padding: '0 20px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const BTN2_C: React.CSSProperties = { ...BTN_C, height: 34, fontSize: 12.5, padding: '0 13px', background: 'transparent', color: '#15181A', border: '1px solid rgba(21,24,26,0.22)' };
const AVISO_C: Record<'verde' | 'ambar' | 'rojo', React.CSSProperties> = {
  verde: { background: 'rgba(34,163,92,0.09)', border: '1px solid rgba(34,163,92,0.35)', color: '#14532D' },
  ambar: { background: 'rgba(194,120,3,0.09)', border: '1px solid rgba(194,120,3,0.35)', color: '#6B3F02' },
  rojo: { background: 'rgba(217,54,54,0.08)', border: '1px solid rgba(217,54,54,0.32)', color: '#9F1C14' },
};
const Aviso: React.FC<{ tono: 'verde' | 'ambar' | 'rojo'; children: React.ReactNode; accion?: React.ReactNode }> = ({ tono, children, accion }) => (
  <div className="lr-entra" style={{ ...AVISO_C[tono], borderRadius: 11, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12.5, lineHeight: 1.5 }}>
    <span style={{ flex: 1, minWidth: 200 }}>{children}</span>
    {accion}
  </div>
);
// QR en blanco: solo las tres esquinas, en gris. El de verdad (con la
// referencia de la consulta) sale en el carnet del resultado.
const QrVacio: React.FC = () => (
  <svg viewBox="0 0 21 21" width={84} height={84} aria-hidden="true" style={{ display: 'block', borderRadius: 8, border: '1.5px dashed rgba(21,24,26,0.2)', background: '#FFFFFF', padding: 6, boxSizing: 'border-box' }}>
    {[[0, 0], [14, 0], [0, 14]].map(([x, y]) => (
      <g key={`${x}-${y}`} fill="none" stroke="#CBD1CC"><rect x={x + 0.5} y={y + 0.5} width="6" height="6" /><rect x={x + 2} y={y + 2} width="3" height="3" fill="#CBD1CC" stroke="none" /></g>
    ))}
  </svg>
);

// La app pinta TODOS los campos oscuros con !important (index.css y App.tsx,
// del tema oscuro heredado): los del carnet, que es claro, necesitan un
// selector más específico para quedar blancos.
const ESTILOS_PANTALLA = `
.lc-claro input.lc-in:not([type=checkbox]):not([type=radio]):not([type=range]), .lc-claro select.lc-in { background-color: #FFFFFF !important; color: #15181A !important; border-color: rgba(21,24,26,0.16) !important; }
.lc-claro input.lc-in:not([type=checkbox]):not([type=radio]):not([type=range]):focus, .lc-claro select.lc-in:focus { border-color: #22A35C !important; box-shadow: 0 0 0 3px rgba(34,163,92,0.16) }
.lc-claro .lc-in::placeholder { color: #9AA19B !important; font-weight: 500 }
.lr-movil { display: none }
.lr-tab:hover { color: #F4F4F2 !important }
@media (max-width: 680px) {
  .lr-reg { grid-template-columns: 38px minmax(0, 1fr) auto !important; }
  .lr-reg .lr-col-c, .lr-reg .lr-col-v, .lr-reg-cab { display: none !important; }
  .lr-movil { display: inline !important; }
  .lr-reg .lr-nom { white-space: normal !important; display: -webkit-box !important; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.3; }
}
@media (max-width: 520px) {
  .lr-form .lc-sello > div:last-child { display: none }
  .lr-form .lc-sello > div:first-child { padding: 8px 12px !important; display: flex; align-items: center; gap: 10px; text-align: left !important }
}
`;

// ── Pantalla ────────────────────────────────────────────────────────────
type Vista = 'consultar' | 'mapa' | 'historial';
export const RiskCliente: React.FC = () => {
  const [cuenta, setCuenta] = useState<any>(null);
  const [vista, setVista] = useState<Vista>('consultar');
  const [doc, setDoc] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoDoc, setTipoDoc] = useState('CC');
  const [empresaForzada, setEmpresaForzada] = useState<boolean | null>(null);
  const [autorizado, setAutorizado] = useState(false);
  const [fase, setFase] = useState<'form' | 'consultando' | 'resultado'>('form');
  const [actual, setActual] = useState<any>(null);
  const [error, setError] = useState<{ t: string; sinSaldo?: boolean } | null>(null);
  const [recarga, setRecarga] = useState(false);
  const [detalle, setDetalle] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [busq, setBusq] = useState<any>(null);
  const [mapa, setMapa] = useState<any>(null);
  const [q, setQ] = useState('');
  const [qb, setQb] = useState('');
  const [cat, setCat] = useState('todos');
  const [riesgo, setRiesgo] = useState('');
  const [vence, setVence] = useState('');
  const [pagina, setPagina] = useState(1);
  const [existente, setExistente] = useState<any>(null);
  const [otroTipo, setOtroTipo] = useState(false);
  const [enCurso, setEnCurso] = useState<null | { id: string; at: string; por?: string | null }>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const sondeo = useRef<number | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const refrescar = useCallback(async () => setCuenta(await llamar('risk_cuenta')), []);
  const cargarReg = useCallback(async () => setHist(await llamar('risk_registradas', { q, nivel: cat, riesgo, vence, pagina })), [q, cat, riesgo, vence, pagina]);
  const cargarBusq = useCallback(async () => setBusq(await llamar('risk_busquedas', { q: qb, pagina: 1 })), [qb]);
  const cargarMapa = useCallback(async () => { const m = await llamar('risk_mapa'); setMapa(m?.ok ? mapaDePersonas(m.personas ?? []) : null); }, []);
  const cargarHist = useCallback(() => { cargarReg(); cargarBusq(); cargarMapa(); }, [cargarReg, cargarBusq, cargarMapa]);
  useEffect(() => { refrescar(); }, [refrescar]);
  useEffect(() => { const t = setTimeout(cargarReg, 220); return () => clearTimeout(t); }, [cargarReg]);
  useEffect(() => { const t = setTimeout(cargarBusq, 220); return () => clearTimeout(t); }, [cargarBusq]);
  useEffect(() => { cargarMapa(); }, [cargarMapa]);
  useEffect(() => { setPagina(1); }, [q, cat, riesgo, vence]);
  useEffect(() => () => { if (sondeo.current) clearInterval(sondeo.current); }, []);

  // El tipo se PRESELECCIONA por la forma del número (lib/nit tipoProbable:
  // un NIT con su dígito de verificación, 9 dígitos que empiezan por 8 o 9, o
  // un guion = empresa), pero siempre se elige a mano. Si lo elegido no
  // cuadra con el número, se avisa; el servidor vuelve a preguntar antes de
  // cobrar. Visto el 2026-10-30: un NIT de 10 dígitos (con DV) quedaba en
  // "Persona" y la consulta se gastó sin resultado.
  const digitos = doc.replace(/\D/g, '');
  const probable = tipoProbable(doc);
  const pareceNit = /-/.test(doc) || probable.tipo === 'empresa';
  const esEmpresa = empresaForzada ?? pareceNit;
  const choca = probable.tipo !== null && empresaForzada !== null && (probable.tipo === 'empresa') !== empresaForzada;
  const [confirmar, setConfirmar] = useState<null | { tipo: 'empresa' | 'persona'; motivo: string }>(null);
  useEffect(() => { setConfirmar(null); }, [doc, esEmpresa, tipoDoc]);
  // Mientras se escribe: ¿ya está consultada? Si sí y está vigente, se
  // muestra de una y no hace falta volver a consultar. También avisa si el
  // mismo número se consultó con otro tipo, o si se está consultando ahora.
  useEffect(() => {
    setExistente(null); setOtroTipo(false); setEnCurso(null);
    if (digitos.length < 6 || fase !== 'form') return;
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await llamar('risk_existente', { tipoPersona: esEmpresa ? 'juridica' : 'natural', tipoDocumento: esEmpresa ? 'NIT' : tipoDoc, documento: doc });
      if (!vivo || !r?.ok) return;
      if (r.existe) { setExistente(r.consulta); setOtroTipo(!!r.otroTipo); }
      if (r.enCurso) setEnCurso(r.enCurso);
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, esEmpresa, tipoDoc, fase]);
  // La razón social de una empresa sale del RUES por el NIT: antes había que
  // escribirla a mano y, sin ella, el botón no se prendía (2026-11). Si el
  // cliente la escribe, manda lo suyo; si la llenó el RUES y cambia el NIT,
  // se vuelve a buscar.
  const [rues, setRues] = useState<{ doc: string; razonSocial: string | null; estado: string | null } | 'buscando' | null>(null);
  const autoNombre = useRef<string | null>(null);
  // El valor actual del campo, para decidir sin funciones actualizadoras
  // (corren después y con un autoNombre que ya cambió).
  const nombreAhora = useRef(nombre);
  nombreAhora.current = nombre;
  useEffect(() => {
    if (fase !== 'form') return;
    // Ya no es una empresa (o se borró el NIT): la razón social que puso el
    // RUES no es de este documento y no se queda en el campo.
    if (!esEmpresa || digitos.length < 9) {
      setRues(null);
      if (autoNombre.current && nombreAhora.current === autoNombre.current) setNombre('');
      autoNombre.current = null;
      return;
    }
    setRues('buscando');
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await llamar('risk_razon_social', { documento: doc });
      if (!vivo) return;
      const razon = r?.ok && r.razonSocial ? String(r.razonSocial) : null;
      setRues({ doc: digitos, razonSocial: razon, estado: r?.estado ?? null });
      // Lo que escribió el cliente se respeta; lo que puso el RUES para otro
      // NIT se cambia (o se borra si este no aparece).
      const n = nombreAhora.current;
      if (!n.trim() || n === autoNombre.current) { autoNombre.current = razon; setNombre(razon ?? ''); }
    }, 450);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digitos, esEmpresa, fase]);
  const mismo = existente && !otroTipo ? existente : null;
  const vigenteYa = !!mismo && mismo.vence?.estado !== 'vencida';
  const verExistente = async () => {
    if (!existente) return;
    const r = await llamar('risk_ver', { consultaId: existente.id, desdeBusqueda: true });
    if (r?.ok) { setActual(r.consulta); setAviso('Ya la tenías consultada: no se usó ninguna consulta.'); setFase('resultado'); cargarHist(); }
  };
  const listo = digitos.length >= 5 && autorizado && (!esEmpresa || nombre.trim().length >= 3) && (cuenta?.saldo ?? 0) > 0;

  const terminar = (c: any) => { setActual(c); setFase('resultado'); cargarHist(); refrescar(); };
  // Se pregunta cada 4 s por el resultado de una consulta lanzada (la propia
  // o la que otro operador ya había lanzado para la misma persona).
  const esperar = (consultaId: string) => {
    setFase('consultando');
    if (sondeo.current) clearInterval(sondeo.current);
    sondeo.current = window.setInterval(async () => {
      const x = await llamar('risk_resultado', { consultaId });
      if (!x?.ok || x.enCurso) return;
      if (sondeo.current) clearInterval(sondeo.current);
      if (x.consulta.estado === 'fallida') { setError({ t: 'La consulta no se pudo completar. Te devolvimos la consulta.' }); setFase('form'); refrescar(); return; }
      terminar(x.consulta);
    }, 4000);
  };
  const consultar = async (confirmarTipo = false) => {
    if (!listo || fase === 'consultando') return;
    setError(null); setActual(null); setConfirmar(null); setAviso(null); setFase('consultando');
    const r = await llamar('risk_consultar', { tipoPersona: esEmpresa ? 'juridica' : 'natural', tipoDocumento: esEmpresa ? 'NIT' : tipoDoc, documento: doc, nombre, autorizado, confirmarTipo });
    refrescar();
    // El servidor vio que el número no cuadra con el tipo: pregunta antes de cobrar.
    if (r?.confirmarTipo) { setConfirmar({ tipo: r.confirmarTipo, motivo: r.motivo }); setFase('form'); return; }
    if (!r?.ok) { setError({ t: r?.motivo ?? 'No se pudo consultar.', sinSaldo: r?.sinSaldo }); setFase('form'); return; }
    if (r.existente) setAviso('Ya la tenías consultada y sigue vigente: no se usó ninguna consulta.');
    if (r.yaEnCurso) setAviso('Esa persona ya se estaba consultando: esperamos ese resultado y no se usó otra consulta.');
    if (!r.enCurso) { terminar(r.consulta); return; }
    esperar(r.consultaId);
  };
  const nueva = () => { setAviso(null); setFase('form'); setActual(null); setDoc(''); setNombre(''); setEmpresaForzada(null); setError(null); setTimeout(() => campo.current?.focus(), 0); };
  const abrir = async (id: string) => { const r = await llamar('risk_ver', { consultaId: id }); if (r?.ok) setDetalle(r.consulta); };
  // Una consulta vencida de la lista: se vuelve al carnet con sus datos.
  const renovar = (c: any) => {
    const emp = c.tipoPersona === 'juridica' || String(c.tipoDocumento).toUpperCase() === 'NIT';
    setDetalle(null); setVista('consultar'); setFase('form'); setActual(null); setAviso(null); setError(null);
    setEmpresaForzada(emp); if (!emp) setTipoDoc(String(c.tipoDocumento || 'CC').toUpperCase());
    setDoc(String(c.documento ?? '')); setNombre(c.nombreOficial || c.nombreEscrito || '');
    window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => campo.current?.focus(), 60);
  };

  if (!cuenta) return <p style={{ color: C.sub, padding: 20 }}>Cargando…</p>;
  const bajo = cuenta.saldo <= cuenta.umbral;
  const conteo = hist?.conteo ?? {};
  const filtrando = !!(q || cat !== 'todos' || riesgo || vence);

  // El botón del carnet cambia según lo que ya se sabe del documento.
  const boton = enCurso
    ? { t: 'Ver el avance', costo: 'Sin costo', activo: true, fn: () => { setAviso('Esa persona ya se estaba consultando: no se usó otra consulta.'); esperar(enCurso.id); } }
    : vigenteYa
      ? { t: 'Ver su consulta', costo: 'Sin costo', activo: true, fn: verExistente }
      : { t: mismo ? 'Consultar de nuevo' : 'Consultar', costo: 'Usa 1 consulta', activo: listo, fn: () => consultar() };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && boton.activo) boton.fn(); };
  const previo = mismo ? nivelDe(mismo) : null;
  const estadoRues = rues && rues !== 'buscando' && rues.estado ? String(rues.estado).toLowerCase() : '';
  // El RUES a veces ya trae "matrícula …" en el estado: no se repite.
  const txtEstadoRues = estadoRues ? (/matr/.test(estadoRues) ? estadoRues : `matrícula ${estadoRues}`) : '';
  const falta = digitos.length >= 5 && !listo && !vigenteYa && !enCurso && fase === 'form' ? [
    esEmpresa && nombre.trim().length < 3 ? (rues === 'buscando' ? 'que termine la búsqueda en el RUES' : 'la razón social') : null,
    !autorizado ? 'marcar la autorización' : null,
    (cuenta?.saldo ?? 0) <= 0 ? 'tener consultas disponibles' : null,
  ].filter(Boolean) as string[] : [];

  return (
    <div style={{ maxWidth: 860, margin: '18px auto 60px', padding: '0 4px' }}>
      <style>{ESTILOS}{ESTILOS_CARNET}{ESTILOS_PANTALLA}</style>

      {/* Encabezado + saldo (que también es la recarga) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.7px', margin: 0 }}>Lincoin Risk</h1>
          <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>¿Con quién vas a operar? Revísalo antes.</p>
        </div>
        <button onClick={() => setRecarga(true)} className="lr-chip"
          style={{ ...TARJETA, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px 10px 16px', cursor: 'pointer', color: C.texto, fontFamily: 'inherit', border: `1px solid ${bajo ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.10)'}` }}>
          <span style={{ textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: bajo ? C.ambar : C.sub }}>{cuenta.saldo === 0 ? 'SIN CONSULTAS' : bajo ? 'QUEDAN POCAS' : 'CONSULTAS'}</span>
            <Contador valor={cuenta.saldo} style={{ display: 'block', fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', color: bajo ? C.ambar : C.texto }} />
          </span>
          <span style={{ height: 34, padding: '0 12px', borderRadius: 9, background: '#F4F4F2', color: '#15181A', fontSize: 12.5, fontWeight: 700, display: 'grid', placeItems: 'center' }}>+ Recargar</span>
        </button>
      </div>

      {/* Secciones: antes todo iba en una sola página larga (consulta, mapa,
          lista e historial uno debajo del otro). */}
      <div role="tablist" aria-label="Secciones de Lincoin Risk" style={{ display: 'flex', gap: 24, marginTop: 20, borderBottom: `1px solid ${C.borde}`, overflowX: 'auto' }}>
        {([['consultar', 'Consultar', null], ['mapa', 'Mapa', null], ['historial', 'Historial de búsqueda', busq?.total ?? null]] as [Vista, string, number | null][]).map(([k, t, n]) => {
          const sel = vista === k;
          return (
            <button key={k} role="tab" aria-selected={sel} onClick={() => setVista(k)} className="lr-tab"
              style={{ position: 'relative', padding: '10px 0 12px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, color: sel ? C.texto : C.sub, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {t}
              {n ? <span style={{ fontSize: 11, fontWeight: 700, color: sel ? '#15181A' : C.sub, background: sel ? '#F4F4F2' : 'rgba(255,255,255,0.07)', borderRadius: 999, padding: '1px 7px' }}>{num(n)}</span> : null}
              {sel && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, borderRadius: 2, background: C.verde }} />}
            </button>
          );
        })}
      </div>

      {vista === 'consultar' && (
        <div style={{ marginTop: 20 }}>
          {fase !== 'resultado' && (
            <div className="lc-carnet lc-carnet-full lr-form lr-entra" style={{ opacity: fase === 'consultando' ? 0.6 : 1, pointerEvents: fase === 'consultando' ? 'none' : 'auto', transition: 'opacity .2s' }}>
              <div className="lc-cab" style={{ padding: '13px 18px' }}>
                <Wordmark tam={17} />
                <span style={{ position: 'relative', zIndex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', color: 'rgba(244,244,242,0.7)', whiteSpace: 'nowrap' }}>{esEmpresa ? 'EMPRESA' : 'PERSONA'}<span className="lc-dd"> · NUEVA CONSULTA</span></span>
              </div>
              <div style={{ height: 4, background: previo?.c ?? '#C5CBC6', transition: 'background .3s' }} />
              <div className="lc-claro">
                <div className="lc-cuerpo" style={{ gridTemplateColumns: '112px minmax(0, 1fr) 118px', gap: 16, padding: '16px 18px 12px' }}>
                  <div className="lc-foto" style={{ height: 136, borderRadius: 12, background: 'linear-gradient(180deg, #E3E7EB, #CDD3DA)', border: '1px solid rgba(21,24,26,0.08)', display: 'grid', placeItems: 'end center', overflow: 'hidden' }}>
                    <Silueta empresa={esEmpresa} tam={esEmpresa ? 78 : 92} />
                  </div>

                  <div style={{ minWidth: 0, display: 'grid', gap: 11 }}>
                    <div>
                      <span className="lc-lbl">Documento</span>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        {esEmpresa
                          ? <span style={{ ...IN_C, width: 'auto', fontWeight: 700, background: '#ECEFEC', color: '#3B423D' }}>NIT</span>
                          : <select className="lc-in" value={tipoDoc} onChange={e => setTipoDoc(e.target.value)} aria-label="Tipo de documento" style={{ ...IN_C, width: 'auto', fontWeight: 700, paddingRight: 6 }}>
                              <option value="CC">CC</option><option value="CE">CE</option><option value="PPT">PPT</option><option value="PP">Pasaporte</option>
                            </select>}
                        <input ref={campo} className="lc-in" value={doc} onChange={e => setDoc(e.target.value)} onKeyDown={enter} autoFocus inputMode="numeric" aria-label="Número de documento"
                          placeholder="Cédula o NIT" style={{ ...IN_C, flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, letterSpacing: '0.3px' }} />
                      </div>
                      {empresaForzada === null && probable.seguro && <span style={{ display: 'block', fontSize: 11, color: '#6B726C', marginTop: 4 }}>{probable.tipo === 'empresa' ? `Detectamos un NIT de empresa (${probable.nit})` : 'Detectamos una cédula'}</span>}
                      {empresaForzada === null && !probable.seguro && pareceNit && !probable.dvMal && <span style={{ display: 'block', fontSize: 11, color: '#6B726C', marginTop: 4 }}>Parece un NIT</span>}
                      {/* NIT con el dígito de verificación equivocado: se consulta
                          igual (va por los 9 dígitos), pero se avisa del DV bueno. */}
                      {probable.dvMal && esEmpresa && <span style={{ display: 'block', fontSize: 11, color: '#8A5502', marginTop: 4 }}>El dígito de verificación no cuadra: el NIT sería {probable.nit}. Se consulta por los 9 dígitos.</span>}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="lc-lbl" style={{ marginRight: 2 }}>Es</span>
                      {([['Persona', false], ['Empresa', true]] as const).map(([t, e]) => (
                        <button key={t} onClick={() => setEmpresaForzada(e)}
                          style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            background: esEmpresa === e ? '#15181A' : 'transparent', color: esEmpresa === e ? '#F4F4F2' : '#15181A', border: `1px solid ${esEmpresa === e ? '#15181A' : 'rgba(21,24,26,0.2)'}` }}>{t}</button>
                      ))}
                    </div>

                    <div>
                      <span className="lc-lbl">{esEmpresa ? 'Razón social' : 'Nombre y apellidos (opcional)'}</span>
                      <input className="lc-in" value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={enter}
                        placeholder={esEmpresa ? (rues === 'buscando' ? 'Buscando en el RUES…' : 'Como está en el RUES') : 'Confirma que el documento es suyo'} style={{ ...IN_C, marginTop: 4, fontWeight: 600 }} />
                      {esEmpresa && rues && rues !== 'buscando' && (
                        <span style={{ display: 'block', fontSize: 11, color: rues.razonSocial ? '#6B726C' : '#8A5502', marginTop: 4 }}>
                          {rues.razonSocial ? `Del RUES${txtEstadoRues ? ` · ${txtEstadoRues}` : ''}. Si no es, corrígela.` : 'No la encontramos en el RUES con ese NIT: escríbela tal como está registrada.'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* El sello: en blanco hasta consultar; si ya está consultada,
                      el nivel que tuvo. */}
                  <div className="lc-sello" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, textAlign: 'center', padding: '9px 6px 10px', transition: 'all .3s',
                      ...(previo ? { background: previo.c, color: '#FFFFFF' } : { background: 'transparent', border: '1.5px dashed rgba(21,24,26,0.22)', color: '#6B726C' }) }}>
                      <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', opacity: 0.9 }}>RIESGO</span>
                      <span style={{ display: 'block', fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1.15 }}>{fase === 'consultando' ? <Giro tam={20} /> : previo ? previo.t : '?'}</span>
                      <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, opacity: 0.92 }}>{fase === 'consultando' ? 'Consultando…' : previo ? (vigenteYa ? 'Ya consultada' : 'Consulta vencida') : 'Por consultar'}</span>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <QrVacio />
                      <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.8px', color: '#9AA19B', marginTop: 4 }}>{mismo ? `REF. ${String(mismo.id).replace(/-/g, '').slice(0, 8).toUpperCase()}` : 'REF. AL CONSULTAR'}</span>
                    </div>
                  </div>
                </div>

                {/* Lo que ya se sabe de ese documento y lo que hay que corregir. */}
                <div style={{ display: 'grid', gap: 8, padding: '0 18px' }}>
                  {enCurso && (
                    <Aviso tono="verde">Esta persona se está consultando ahora mismo{enCurso.por ? ` (la lanzó ${enCurso.por} ${hace(enCurso.at)})` : ''}. No lances otra: mira el avance.</Aviso>
                  )}
                  {!enCurso && vigenteYa && (
                    <Aviso tono="verde">✓ Ya consultaste a <b>{mismo.nombreOficial || mismo.nombreEscrito || documentoLegible(mismo.tipoDocumento, mismo.documento)}</b> el {fechaCorta(mismo.at)}. Sigue vigente hasta el {fechaCorta(mismo.vence?.venceAt)}: no hace falta consultarla de nuevo y no se cobra.</Aviso>
                  )}
                  {!enCurso && mismo && !vigenteYa && (
                    <Aviso tono="ambar" accion={<button onClick={verExistente} style={BTN2_C}>Ver la anterior</button>}>
                      Ya consultaste a <b>{mismo.nombreOficial || mismo.nombreEscrito || 'este documento'}</b> el {fechaCorta(mismo.at)}, pero la consulta venció el {fechaCorta(mismo.vence?.venceAt)}. Consultar de nuevo usa 1 consulta.
                    </Aviso>
                  )}
                  {!enCurso && existente && otroTipo && (
                    <Aviso tono="ambar" accion={<button onClick={verExistente} style={BTN2_C}>Ver su consulta</button>}>
                      Ese número ya lo consultaste como <b>{existente.tipoDocumento}</b>: {existente.nombreOficial || existente.nombreEscrito || 'sin nombre'} (riesgo {nivelDe(existente).t.toLowerCase()}). Si es la misma, no hace falta consultarla otra vez.
                    </Aviso>
                  )}
                  {/* Lo elegido a mano no cuadra con el número: se avisa, sin cambiar nada. */}
                  {choca && (
                    <Aviso tono="ambar" accion={<button onClick={() => setEmpresaForzada(probable.tipo === 'empresa')} style={BTN2_C}>Cambiar a {probable.tipo === 'empresa' ? 'Empresa' : 'Persona'}</button>}>
                      ⚠ Este número parece {probable.tipo === 'empresa' ? `un NIT de empresa${probable.nit ? ` (${probable.nit})` : ''}` : 'una cédula de persona'}.
                    </Aviso>
                  )}
                  {/* El servidor pidió confirmar el tipo antes de cobrar. */}
                  {confirmar && (
                    <Aviso tono="ambar" accion={<span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => { setEmpresaForzada(confirmar.tipo === 'empresa'); setConfirmar(null); }} style={{ ...BTN_C, height: 34, fontSize: 12.5, padding: '0 13px' }}>Cambiar a {confirmar.tipo === 'empresa' ? 'Empresa' : 'Persona'}</button>
                      <button onClick={() => consultar(true)} style={BTN2_C}>Consultar igual como {esEmpresa ? 'empresa' : 'persona'}</button>
                    </span>}>
                      {confirmar.motivo} No se ha usado ninguna consulta.
                    </Aviso>
                  )}
                  {error && (
                    <Aviso tono={error.sinSaldo ? 'ambar' : 'rojo'} accion={error.sinSaldo ? <button onClick={() => setRecarga(true)} style={{ ...BTN_C, height: 34, fontSize: 12.5, padding: '0 13px' }}>Recargar</button> : undefined}>{error.t}</Aviso>
                  )}
                </div>

                {/* Pie del carnet: la autorización y el botón. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 18px 14px', marginTop: 10, borderTop: '1px solid rgba(21,24,26,0.08)' }}>
                  <label style={{ flex: 1, minWidth: 220, display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12, color: '#3B423D', lineHeight: 1.45, cursor: 'pointer' }}>
                    <input type="checkbox" checked={autorizado} onChange={e => setAutorizado(e.target.checked)} style={{ width: 15, height: 15, marginTop: 1, accentColor: '#22A35C', flexShrink: 0 }} />
                    Tengo autorización del titular o una finalidad legítima de debida diligencia.
                  </label>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: boton.costo === 'Sin costo' ? '#1A7F45' : '#6B726C', whiteSpace: 'nowrap' }}>{boton.costo}</span>
                    <button onClick={boton.fn} disabled={!boton.activo} style={{ ...BTN_C, opacity: boton.activo ? 1 : 0.35, cursor: boton.activo ? 'pointer' : 'not-allowed' }}>
                      {fase === 'consultando' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Giro /> Consultando…</span> : boton.t}
                    </button>
                  </span>
                  {/* Qué falta para poder consultar: el botón apagado no lo decía y
                      parecía que las empresas no se podían consultar. */}
                  {falta.length > 0 && <p style={{ flexBasis: '100%', fontSize: 11.5, color: '#6B726C', margin: 0 }}>Para consultar falta: <b style={{ color: '#15181A', fontWeight: 600 }}>{falta.join(' · ')}</b>.</p>}
                  {cuenta.saldo === 0 && !error && (
                    <p style={{ flexBasis: '100%', fontSize: 11.5, color: '#6B726C', margin: 0 }}>No tienes consultas disponibles. <button onClick={() => setRecarga(true)} style={{ background: 'none', border: 'none', color: '#15181A', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit' }}>Recarga para empezar</button></p>
                  )}
                </div>
              </div>
            </div>
          )}
          {fase === 'consultando' && <div style={{ ...TARJETA, marginTop: 14 }}><Avance /></div>}
          {fase === 'resultado' && actual && (
            <div style={{ ...TARJETA, overflow: 'hidden' }}>
              {aviso && <div style={{ padding: '10px 24px', fontSize: 12.5, color: C.verde, background: 'rgba(74,222,128,0.06)', borderBottom: `1px solid ${C.borde}` }}>✓ {aviso}</div>}
              <Resultado consulta={actual} acciones={<button onClick={nueva} style={BTN2}>Nueva consulta</button>} />
            </div>
          )}

          {/* Personas y empresas ya consultadas. */}
          <div style={{ marginTop: 32 }}>
            <p style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px', margin: 0 }}>Personas y empresas consultadas <span style={{ color: C.sub, fontWeight: 600 }}>· {num(conteo.todos ?? 0)}</span></p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>Si escribes arriba el documento de alguien de esta lista, lo reconocemos: mientras su consulta esté vigente no se vuelve a cobrar.</p>
            <div style={{ ...TARJETA, marginTop: 12, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.borde}`, display: 'grid', gap: 10 }}>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o documento" aria-label="Buscar en las consultadas" style={{ ...INP, background: 'transparent', border: 'none', padding: '6px 2px' }} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[['todos', 'Todas'], ['bajo', 'Bajo'], ['medio', 'Medio'], ['alto', 'Alto']].map(([k, t]) => (
                    <button key={k} onClick={() => setCat(k)} className="lr-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: cat === k ? 'rgba(255,255,255,0.09)' : 'transparent', color: cat === k ? C.texto : C.sub, border: `1px solid ${cat === k ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}` }}>
                      {k !== 'todos' && <Punto c={GRUPO[k].c} tam={6} />}{t}<span style={{ color: C.tenue }}>{conteo[k] ?? 0}</span>
                    </button>
                  ))}
                  <span style={{ width: 1, height: 18, background: C.borde, margin: '0 4px' }} />
                  <select value={riesgo} onChange={e => setRiesgo(e.target.value)} aria-label="Tipo de riesgo" style={{ ...INP, width: 'auto', padding: '5px 10px', fontSize: 12, borderRadius: 999 }}>
                    <option value="">Todos los riesgos</option>
                    {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}{hist?.riesgos?.[k] ? ` (${hist.riesgos[k]})` : ''}</option>)}
                  </select>
                  <select value={vence} onChange={e => setVence(e.target.value)} aria-label="Vencimiento" style={{ ...INP, width: 'auto', padding: '5px 10px', fontSize: 12, borderRadius: 999 }}>
                    <option value="">Cualquier vencimiento</option><option value="por_vencer">Por vencer (≤30 días)</option><option value="vencidas">Vencidas</option>
                  </select>
                </div>
              </div>

              {!hist ? <p style={{ padding: 18, color: C.sub, fontSize: 13, margin: 0 }}>Cargando…</p>
                : hist.filas.length === 0 ? (
                  <div style={{ padding: '28px 18px', textAlign: 'center' }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>{filtrando ? 'Nada con ese filtro' : 'Aún no has consultado a nadie'}</p>
                    <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>{filtrando ? 'Prueba con otro filtro.' : 'Escribe una cédula o un NIT en el carnet para empezar.'}</p>
                  </div>
                ) : (
                  <>
                    <div className="lr-reg lr-reg-cab" style={{ display: 'grid', gridTemplateColumns: COLS_REG, gap: 14, padding: '9px 16px', borderBottom: `1px solid ${C.borde}`, fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textTransform: 'uppercase' }}>
                      <span /><span>Persona o empresa</span><span>Consultada · hallazgos</span><span>Vigencia</span><span style={{ justifySelf: 'end' }}>Riesgo</span>
                    </div>
                    {hist.filas.map((c: any, i: number) => (
                      <FilaConsultado key={c.id} c={c} primera={i === 0} retraso={Math.min(i, 12) * 20} resaltar={!!existente && existente.id === c.id} onClick={() => abrir(c.id)} />
                    ))}
                    {hist.paginas > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '10px 14px', borderTop: `1px solid ${C.borde}`, fontSize: 12.5, color: C.sub }}>
                        <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1} style={{ ...BTN2, height: 32, padding: '0 12px', fontSize: 12.5, opacity: pagina <= 1 ? 0.4 : 1 }}>‹ Anterior</button>
                        <span>Página {hist.pagina} de {hist.paginas}</span>
                        <button onClick={() => setPagina(p => Math.min(hist.paginas, p + 1))} disabled={pagina >= hist.paginas} style={{ ...BTN2, height: 32, padding: '0 12px', fontSize: 12.5, opacity: pagina >= hist.paginas ? 0.4 : 1 }}>Siguiente ›</button>
                      </div>
                    )}
                  </>
                )}
            </div>
            <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0' }}>Cada una guarda su consulta más reciente. Al vencer, consultar de nuevo usa 1 consulta. El historial no se puede borrar.</p>
          </div>
        </div>
      )}

      {vista === 'mapa' && (() => {
        const deptos: any[] = [...(mapa?.departamentos ?? [])].sort((x: any, y: any) => y.personas - x.personas);
        const maxP = Math.max(1, ...deptos.map(d => d.personas));
        return (
          <div className="lr-entra" style={{ ...TARJETA, marginTop: 20, padding: '20px 22px', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <MapaColombia tam={40} datos={Object.fromEntries(deptos.map(d => [d.depto, { valor: d.personas, nombre: d.nombre, detalle: `${d.personas} ${d.personas === 1 ? 'persona' : 'personas'} · ${d.procesos} ${d.procesos === 1 ? 'proceso' : 'procesos'}` }]))} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Dónde aparecen tus consultados</p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 14px', lineHeight: 1.5 }}>Según la ciudad de sus procesos en la Rama Judicial. No es su dirección. Más intenso, más personas.</p>
              {deptos.length === 0 && <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>{!mapa ? 'Cargando…' : 'Todavía ninguno de tus consultados tiene procesos que indiquen una ciudad.'}</p>}
              {deptos.slice(0, 10).map(d => (
                <div key={d.depto} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '6px 0' }}>
                  <span style={{ flex: 1 }}>{d.nombre}</span>
                  <span style={{ width: 90, height: 6, borderRadius: 999, background: C.elevado, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${(d.personas / maxP) * 100}%`, background: C.verde }} />
                  </span>
                  <span style={{ color: C.sub, width: 74, textAlign: 'right' }}>{d.personas} {d.personas === 1 ? 'persona' : 'personas'}</span>
                </div>
              ))}
              {mapa?.sinUbicacion > 0 && <p style={{ fontSize: 11.5, color: C.tenue, margin: '8px 0 0' }}>{mapa.sinUbicacion} sin procesos que indiquen ubicación.</p>}
            </div>
          </div>
        );
      })()}

      {vista === 'historial' && (
        <div className="lr-entra" style={{ marginTop: 20 }}>
          <div style={{ ...TARJETA, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.borde}` }}>
              <input value={qb} onChange={e => setQb(e.target.value)} placeholder="Buscar por nombre o documento" aria-label="Buscar en el historial" style={{ ...INP, background: 'transparent', border: 'none', padding: '6px 2px' }} />
            </div>
            {!busq ? <p style={{ padding: 18, color: C.sub, fontSize: 13, margin: 0 }}>Cargando…</p>
              : busq.filas.length === 0 ? <p style={{ padding: '28px 18px', textAlign: 'center', color: C.sub, fontSize: 13, margin: 0 }}>{qb ? 'Nada con esa búsqueda.' : 'Todavía no hay búsquedas.'}</p>
              : busq.filas.map((b: any, i: number) => {
                const r = ({ nueva: { t: 'Consulta nueva', c: C.texto }, existente: { t: 'Ya estaba consultada', c: C.sub }, renovada: { t: 'Consulta renovada', c: C.verde }, sin_saldo: { t: 'Sin consultas disponibles', c: C.ambar } } as Record<string, { t: string; c: string }>)[b.resultado] ?? { t: b.resultado, c: C.sub };
                return (
                  <button key={b.id} onClick={() => b.consultaId && abrir(b.consultaId)} disabled={!b.consultaId} className="lr-fila" style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 14, padding: '12px 18px', background: 'transparent', border: 'none', borderTop: i ? `1px solid ${C.borde}` : 'none', color: C.texto, cursor: b.consultaId ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.c, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{b.nombre || `${b.tipoDocumento} ${b.documento}`}</span>
                      <span style={{ display: 'block', fontSize: 12, color: C.sub }}>{b.tipoDocumento} {b.documento} · {new Date(b.at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })} · {b.por}</span>
                    </span>
                    <span style={{ fontSize: 12, color: r.c, whiteSpace: 'nowrap' }}>{r.t}</span>
                  </button>
                );
              })}
          </div>
          <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0' }}>Cada vez que se buscó a alguien, aunque ya estuviera consultado. No se puede borrar.</p>
        </div>
      )}

      <Panel titulo="Consulta" abierto={!!detalle} cerrar={() => setDetalle(null)}>
        {detalle && <Resultado consulta={detalle} compacto acciones={detalle.vence?.estado === 'vencida' ? <button onClick={() => renovar(detalle)} style={BTN2}>Consultar de nuevo</button> : undefined} />}
      </Panel>
      <Panel titulo="Recargar consultas" abierto={recarga} cerrar={() => { setRecarga(false); refrescar(); }}>
        <Recarga cuenta={cuenta} listo={() => { setRecarga(false); refrescar(); setVista('consultar'); setTimeout(() => campo.current?.focus(), 0); }} />
      </Panel>
    </div>
  );
};
