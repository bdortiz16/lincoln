// Lincoin Risk para la empresa — una sola pantalla:
//   · arriba, la consulta: un campo grande, el tipo se detecta solo;
//   · mientras consulta, se ven avanzar las fuentes;
//   · el resultado, con el veredicto grande y el porqué plegable;
//   · abajo, el historial reciente; el detalle y la recarga se abren en un
//     panel lateral para no perder el contexto.
// El saldo es tarjeta y botón de recarga a la vez.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { descargarReporteLincoin } from '../reporte/ReporteLincoin';
import { MapaColombia } from './MapaColombia';
import { llamarFuncion } from '../../lib/edge';
import { lugaresDeDespachos, mapaDePersonas } from '../../lib/ubicacion';

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
const veredicto = (f: any, nombre: string): Tono => {
  if (!f) return { t: '—', c: C.sub, corto: '—', txt: '' };
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
  const nombre = consulta.nombreOficial || consulta.nombreEscrito || 'Sin nombre';
  const v = veredicto(f, nombre.split(' ')[0]);
  const fuentes: any[] = f?.sarblock?.catalog ?? [];
  const limpias = fuentes.filter(x => x.status === 'CLEAR' || x.status === 'VERIFIED').length;
  const motivos: any[] = f?.hallazgos ?? [];
  const descargar = async () => {
    setPdf(true);
    try { await descargarReporteLincoin({ ...f, empresa: consulta.empresa, consultadoPor: consulta.por, consultadoAt: consulta.at }); } finally { setPdf(false); }
  };
  return (
    <div className="lr-entra">
      <div style={{ padding: compacto ? '18px 20px' : '22px 24px', background: `linear-gradient(135deg, ${v.c}14, transparent 60%)`, borderBottom: `1px solid ${C.borde}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Punto c={v.c} tam={10} />
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: v.c }}>{v.t}</span>
        </div>
        <p style={{ fontSize: 13.5, color: C.texto, margin: '6px 0 0', lineHeight: 1.5 }}>{v.txt}</p>
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{nombre}</p>
          <p style={{ fontSize: 12.5, color: C.sub, margin: '3px 0 0' }}>
            {consulta.tipoDocumento} {consulta.documento} · {hace(consulta.at)}{consulta.deCache ? ' · del padrón Lincoin Risk' : ''}
          </p>
          {f?.nombreIncompleto && <p style={{ fontSize: 12, color: C.sub, margin: '6px 0 0' }}>Escrito como “{consulta.nombreEscrito}”: es el mismo nombre, incompleto.</p>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <Vence v={consulta.vence} />
            {(consulta.riesgos ?? []).filter((r: string) => r !== 'ninguno').map((r: string) => (
              <span key={r} style={{ fontSize: 11.5, color: C.texto, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '3px 9px' }}>{TIPOS[r] ?? r}</span>
            ))}
          </div>
        </div>
      </div>
      <div style={{ padding: compacto ? '14px 20px' : '16px 24px', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5, color: C.sub }}>
        <span><b style={{ color: C.texto }}>{fuentes.length}</b> fuentes revisadas</span>
        <span><b style={{ color: C.texto }}>{limpias}</b> sin novedad</span>
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

// ── Pantalla ────────────────────────────────────────────────────────────
export const RiskCliente: React.FC = () => {
  const [cuenta, setCuenta] = useState<any>(null);
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
  const [lista, setLista] = useState<'registradas' | 'busquedas'>('registradas');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('todos');
  const [riesgo, setRiesgo] = useState('');
  const [vence, setVence] = useState('');
  const [existente, setExistente] = useState<any>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const sondeo = useRef<number | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const refrescar = useCallback(async () => setCuenta(await llamar('risk_cuenta')), []);
  const cargarHist = useCallback(async () => {
    const [h, b, m] = await Promise.all([
      llamar('risk_registradas', { q, nivel: cat, riesgo, vence, pagina: 1 }),
      llamar('risk_busquedas', { q, pagina: 1 }),
      llamar('risk_mapa'),
    ]);
    setHist(h); setBusq(b); setMapa(m?.ok ? mapaDePersonas(m.personas ?? []) : null);
  }, [q, cat, riesgo, vence]);
  useEffect(() => { refrescar(); }, [refrescar]);
  useEffect(() => { const t = setTimeout(cargarHist, 220); return () => clearTimeout(t); }, [cargarHist]);
  useEffect(() => () => { if (sondeo.current) clearInterval(sondeo.current); }, []);

  // El tipo se detecta solo: un guion o 9 dígitos que empiezan por 8 o 9
  // son un NIT. Siempre se puede cambiar a mano.
  const digitos = doc.replace(/\D/g, '');
  const pareceNit = /-/.test(doc) || (/^[89]\d{8}$/.test(digitos));
  const esEmpresa = empresaForzada ?? pareceNit;
  // Mientras se escribe: ¿ya está consultada? Si sí y está vigente, se
  // muestra de una y no hace falta volver a consultar.
  useEffect(() => {
    setExistente(null);
    if (digitos.length < 6 || fase !== 'form') return;
    const t = setTimeout(async () => {
      const r = await llamar('risk_existente', { tipoPersona: esEmpresa ? 'juridica' : 'natural', tipoDocumento: esEmpresa ? 'NIT' : tipoDoc, documento: doc });
      if (r?.ok && r.existe) setExistente(r.consulta);
    }, 350);
    return () => clearTimeout(t);
  }, [doc, esEmpresa, tipoDoc, fase]);
  const vigenteYa = existente && existente.vence?.estado !== 'vencida';
  const verExistente = async () => {
    const r = await llamar('risk_ver', { consultaId: existente.id, desdeBusqueda: true });
    if (r?.ok) { setActual(r.consulta); setAviso('Ya la tenías consultada: no se usó ninguna consulta.'); setFase('resultado'); cargarHist(); }
  };
  const listo = digitos.length >= 5 && autorizado && (!esEmpresa || nombre.trim().length >= 3) && (cuenta?.saldo ?? 0) > 0;

  const consultar = async () => {
    if (!listo || fase === 'consultando') return;
    setError(null); setActual(null); setFase('consultando');
    const r = await llamar('risk_consultar', { tipoPersona: esEmpresa ? 'juridica' : 'natural', tipoDocumento: esEmpresa ? 'NIT' : tipoDoc, documento: doc, nombre, autorizado });
    refrescar();
    if (!r?.ok) { setError({ t: r?.motivo ?? 'No se pudo consultar.', sinSaldo: r?.sinSaldo }); setFase('form'); return; }
    const terminar = (c: any) => { setActual(c); setFase('resultado'); cargarHist(); refrescar(); };
    if (r.existente) setAviso('Ya la tenías consultada y sigue vigente: no se usó ninguna consulta.');
    if (!r.enCurso) { terminar(r.consulta); return; }
    sondeo.current = window.setInterval(async () => {
      const x = await llamar('risk_resultado', { consultaId: r.consultaId });
      if (!x?.ok || x.enCurso) return;
      if (sondeo.current) clearInterval(sondeo.current);
      if (x.consulta.estado === 'fallida') { setError({ t: 'La consulta no se pudo completar. Te devolvimos la consulta.' }); setFase('form'); refrescar(); return; }
      terminar(x.consulta);
    }, 4000);
  };
  const nueva = () => { setAviso(null); setFase('form'); setActual(null); setDoc(''); setNombre(''); setEmpresaForzada(null); setError(null); setTimeout(() => campo.current?.focus(), 0); };
  const abrir = async (id: string) => { const r = await llamar('risk_ver', { consultaId: id }); if (r?.ok) setDetalle(r.consulta); };

  if (!cuenta) return <p style={{ color: C.sub, padding: 20 }}>Cargando…</p>;
  const bajo = cuenta.saldo <= cuenta.umbral;
  const conteo = hist?.conteo ?? {};

  return (
    <div style={{ maxWidth: 820, margin: '18px auto 60px', padding: '0 4px' }}>
      <style>{ESTILOS}</style>

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

      {/* Consulta */}
      <div style={{ ...TARJETA, marginTop: 18, overflow: 'hidden' }}>
        {fase !== 'resultado' && (
          <div style={{ padding: '20px 24px 22px', opacity: fase === 'consultando' ? 0.5 : 1, pointerEvents: fase === 'consultando' ? 'none' : 'auto', transition: 'opacity .2s' }}>
            <div className="lr-input" style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.elevado, border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '6px 6px 6px 16px', transition: 'all .15s' }}>
              <span style={{ color: C.sub, fontSize: 16 }}>⌕</span>
              <input ref={campo} value={doc} onChange={e => setDoc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') consultar(); }} autoFocus inputMode="numeric"
                placeholder="Cédula o NIT de la persona o empresa" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.texto, fontSize: 16, fontFamily: 'inherit', padding: '10px 0' }} />
              {vigenteYa
                ? <button onClick={verExistente} style={{ ...BTN, height: 42 }}>Ver consulta</button>
                : <button onClick={consultar} disabled={!listo} style={{ ...BTN, height: 42, opacity: listo ? 1 : 0.35, cursor: listo ? 'pointer' : 'not-allowed' }}>{existente ? 'Consultar de nuevo' : 'Consultar'}</button>}
            </div>

            {existente && (
              <div className="lr-entra" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: C.elevado, border: `1px solid ${vigenteYa ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 12, padding: '12px 14px' }}>
                <Punto c={GRUPO[existente.grupo]?.c ?? C.sub} tam={9} />
                <span style={{ flex: 1, minWidth: 200 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{existente.nombreOficial || existente.nombreEscrito} · {GRUPO[existente.grupo]?.t ?? ''}</span>
                  <span style={{ display: 'block', fontSize: 12, color: C.sub }}>
                    {vigenteYa ? `Ya la consultaste ${hace(existente.at)}. No hace falta volver a consultar.` : `La consulta venció. Consultar de nuevo usa 1 consulta.`}
                  </span>
                </span>
                <Vence v={existente.vence} />
              </div>
            )}
            {digitos.length >= 3 && !vigenteYa && (
              <div className="lr-entra" style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, color: C.sub }}>Es</span>
                  {[['Persona', false], ['Empresa', true]].map(([t, e]) => (
                    <button key={String(t)} onClick={() => setEmpresaForzada(e as boolean)} className="lr-chip"
                      style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        background: esEmpresa === e ? '#F4F4F2' : 'transparent', color: esEmpresa === e ? '#15181A' : C.texto, border: '1px solid rgba(255,255,255,0.14)' }}>{t as string}</button>
                  ))}
                  {!esEmpresa && (
                    <select value={tipoDoc} onChange={e => setTipoDoc(e.target.value)} style={{ ...INP, width: 'auto', padding: '5px 10px', fontSize: 12.5, borderRadius: 999 }}>
                      <option value="CC">Cédula</option><option value="CE">Cédula de extranjería</option><option value="PPT">PPT</option><option value="PP">Pasaporte</option>
                    </select>
                  )}
                  {pareceNit && empresaForzada === null && <span style={{ fontSize: 11.5, color: C.tenue }}>Parece un NIT</span>}
                </div>
                <input value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') consultar(); }}
                  placeholder={esEmpresa ? 'Razón social (obligatoria)' : 'Nombre completo (opcional, confirma que el documento es suyo)'} style={INP} />
                <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12, color: C.sub, lineHeight: 1.45, cursor: 'pointer' }}>
                  <input type="checkbox" checked={autorizado} onChange={e => setAutorizado(e.target.checked)} style={{ width: 15, height: 15, marginTop: 1, accentColor: '#4ADE80', flexShrink: 0 }} />
                  Tengo autorización del titular o una finalidad legítima de debida diligencia.
                </label>
              </div>
            )}
            {error && (
              <div className="lr-entra" style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: C.elevado, border: `1px solid ${error.sinSaldo ? 'rgba(251,191,36,0.3)' : 'rgba(248,113,113,0.3)'}`, borderRadius: 12, padding: '11px 14px' }}>
                <span style={{ fontSize: 13 }}>{error.t}</span>
                {error.sinSaldo && <button onClick={() => setRecarga(true)} style={{ ...BTN, height: 34, fontSize: 12.5 }}>Recargar</button>}
              </div>
            )}
            {cuenta.saldo === 0 && !error && (
              <p style={{ fontSize: 12.5, color: C.sub, margin: '14px 0 0' }}>No tienes consultas disponibles. <button onClick={() => setRecarga(true)} style={{ background: 'none', border: 'none', color: C.texto, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Recarga para empezar</button></p>
            )}
          </div>
        )}
        {fase === 'consultando' && <div style={{ borderTop: `1px solid ${C.borde}` }}><Avance /></div>}
        {fase === 'resultado' && actual && (
          <>
            {aviso && <div style={{ padding: '10px 24px', fontSize: 12.5, color: C.verde, background: 'rgba(74,222,128,0.06)', borderBottom: `1px solid ${C.borde}` }}>✓ {aviso}</div>}
            <Resultado consulta={actual} acciones={<button onClick={nueva} style={BTN2}>Nueva consulta</button>} />
          </>
        )}
      </div>

      {/* Mapa de calor */}
      {mapa && (mapa.departamentos?.length > 0 || mapa.sinUbicacion > 0) && (
        <div style={{ ...TARJETA, marginTop: 28, padding: '18px 20px', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <MapaColombia datos={Object.fromEntries((mapa.departamentos ?? []).map((d: any) => [d.depto, { valor: d.personas, nombre: d.nombre, detalle: `${d.personas} persona(s) · ${d.procesos} proceso(s)` }]))} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Dónde aparecen tus registrados</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 14px', lineHeight: 1.5 }}>Según la ciudad de sus procesos en la Rama Judicial. Más intenso, más personas.</p>
            {(mapa.departamentos ?? []).sort((x: any, y: any) => y.personas - x.personas).slice(0, 6).map((d: any) => (
              <div key={d.depto} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '6px 0' }}>
                <span style={{ flex: 1 }}>{d.nombre}</span>
                <span style={{ width: 90, height: 6, borderRadius: 999, background: C.elevado, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(d.personas / Math.max(...mapa.departamentos.map((x: any) => x.personas))) * 100}%`, background: C.verde }} />
                </span>
                <span style={{ color: C.sub, width: 70, textAlign: 'right' }}>{d.personas} {d.personas === 1 ? 'persona' : 'personas'}</span>
              </div>
            ))}
            {mapa.sinUbicacion > 0 && <p style={{ fontSize: 11.5, color: C.tenue, margin: '8px 0 0' }}>{mapa.sinUbicacion} sin procesos que indiquen ubicación.</p>}
          </div>
        </div>
      )}

      {/* Personas registradas · Historial de búsqueda */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div role="tablist" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: C.elevado, border: `1px solid ${C.borde}` }}>
            {([['registradas', `Personas registradas · ${hist?.conteo?.todos ?? 0}`], ['busquedas', `Historial de búsqueda · ${busq?.total ?? 0}`]] as const).map(([k, t]) => (
              <button key={k} onClick={() => setLista(k)} style={{ padding: '7px 15px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: lista === k ? '#F4F4F2' : 'transparent', color: lista === k ? '#15181A' : C.sub }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ ...TARJETA, marginTop: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.borde}`, display: 'grid', gap: 10 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o documento" style={{ ...INP, background: 'transparent', border: 'none', padding: '6px 2px' }} />
            {lista === 'registradas' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {[['todos', 'Todas'], ['bajo', 'Bajo'], ['medio', 'Medio'], ['alto', 'Alto']].map(([k, t]) => (
                  <button key={k} onClick={() => setCat(k)} className="lr-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: cat === k ? 'rgba(255,255,255,0.09)' : 'transparent', color: cat === k ? C.texto : C.sub, border: `1px solid ${cat === k ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}` }}>
                    {k !== 'todos' && <Punto c={GRUPO[k].c} tam={6} />}{t}<span style={{ color: C.tenue }}>{hist?.conteo?.[k] ?? 0}</span>
                  </button>
                ))}
                <span style={{ width: 1, height: 18, background: C.borde, margin: '0 4px' }} />
                <select value={riesgo} onChange={e => setRiesgo(e.target.value)} style={{ ...INP, width: 'auto', padding: '5px 10px', fontSize: 12, borderRadius: 999 }}>
                  <option value="">Todos los riesgos</option>
                  {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}{hist?.riesgos?.[k] ? ` (${hist.riesgos[k]})` : ''}</option>)}
                </select>
                <select value={vence} onChange={e => setVence(e.target.value)} style={{ ...INP, width: 'auto', padding: '5px 10px', fontSize: 12, borderRadius: 999 }}>
                  <option value="">Cualquier vencimiento</option><option value="por_vencer">Por vencer (≤30 días)</option><option value="vencidas">Vencidas</option>
                </select>
              </div>
            )}
          </div>

          {lista === 'registradas' && (!hist ? <p style={{ padding: 18, color: C.sub, fontSize: 13, margin: 0 }}>Cargando…</p>
            : hist.filas.length === 0 ? (
              <div style={{ padding: '28px 18px', textAlign: 'center' }}>
                <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>{q || cat !== 'todos' || riesgo || vence ? 'Nada con ese filtro' : 'Aún no has consultado a nadie'}</p>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>{q || cat !== 'todos' || riesgo || vence ? 'Prueba con otro filtro.' : 'Escribe una cédula o un NIT arriba para empezar.'}</p>
              </div>
            ) : hist.filas.map((c: any, i: number) => {
              const g = GRUPO[c.grupo];
              return (
                <button key={c.id} onClick={() => abrir(c.id)} className="lr-fila lr-entra" style={{ animationDelay: `${i * 25}ms`, display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 14, padding: '13px 18px', background: 'transparent', border: 'none', borderTop: i ? `1px solid ${C.borde}` : 'none', color: C.texto, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ width: 34, height: 34, borderRadius: '50%', background: C.elevado, border: `1px solid ${C.borde}`, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: C.sub, flexShrink: 0 }}>
                    {String(c.nombreOficial || c.nombreEscrito || '?').split(' ').slice(0, 2).map((p: string) => p[0]).join('')}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nombreOficial || c.nombreEscrito || 'Sin nombre'}</span>
                    <span style={{ display: 'block', fontSize: 12, color: C.sub, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.tipoDocumento} {c.documento} · consultada {hace(c.at)}{(c.riesgos ?? []).filter((r: string) => r !== 'ninguno').length ? ` · ${(c.riesgos as string[]).filter(r => r !== 'ninguno').map(r => TIPOS[r]).join(', ')}` : ''}
                    </span>
                  </span>
                  <Vence v={c.vence} />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: g.c, minWidth: 54 }}><Punto c={g.c} tam={7} />{g.t}</span>
                  <span style={{ color: C.tenue, fontSize: 16 }}>›</span>
                </button>
              );
            }))}

          {lista === 'busquedas' && (!busq ? <p style={{ padding: 18, color: C.sub, fontSize: 13, margin: 0 }}>Cargando…</p>
            : busq.filas.length === 0 ? <p style={{ padding: '28px 18px', textAlign: 'center', color: C.sub, fontSize: 13, margin: 0 }}>Todavía no hay búsquedas.</p>
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
            }))}
        </div>
        <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0' }}>
          {lista === 'registradas' ? 'Cada persona guarda su consulta más reciente. Al vencer, consultar de nuevo usa 1 consulta. El historial no se puede borrar.' : 'Cada vez que se buscó a alguien, aunque ya estuviera consultado. No se puede borrar.'}
        </p>
      </div>

      <Panel titulo="Consulta" abierto={!!detalle} cerrar={() => setDetalle(null)}>{detalle && <Resultado consulta={detalle} compacto />}</Panel>
      <Panel titulo="Recargar consultas" abierto={recarga} cerrar={() => { setRecarga(false); refrescar(); }}>
        <Recarga cuenta={cuenta} listo={() => { setRecarga(false); refrescar(); setTimeout(() => campo.current?.focus(), 0); }} />
      </Panel>
    </div>
  );
};
