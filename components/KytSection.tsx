// ══════════════════════════════════════════════════════════════════
//  KYT · Verificación de direcciones — Lincoin Empresas
//
//  Consulta puntual + direcciones guardadas con monitoreo. Una consulta sirve
//  para el momento en que se hace: el riesgo de una dirección cambia, y la que
//  hoy está limpia mañana aparece con exposición a un mixer. Por eso lo que
//  importa se guarda y se vuelve a consultar.
//
//  SOLO INFORMA. No bloquea ninguna operación.
//
//  SIN RESULTADO NO ES LIMPIA. Si el proveedor no responde, la pantalla lo dice
//  con esas palabras y pide tratar la dirección como no verificada. Nunca se
//  convierte la ausencia de información en un verde tranquilizador.
//
//  NADA DE DATOS DE EJEMPLO. El diseño traía un "8 / 100" y unas direcciones de
//  muestra; acá no se dibuja ningún número que el proveedor no haya devuelto.
//  Un puntaje inventado en una pantalla de cumplimiento es peor que una
//  pantalla vacía: se opera con él.
// ══════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, FileText, Loader2, ShieldQuestion, History, X, ChevronDown, Check } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';
import { hallazgosEnEspanol, bandaDeRiesgo, indicadoresDe, nivelProveedorEs, sancionadaPorProveedor, fechaProveedor, caminoDe, flujoRuta, recomendacionSb, nivelSarblockEs, severidadEs, confianzaEs, senalEs } from '../lib/kytTextos';
import { KytReporte } from './KytReporte';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const C = {
  card: '#0C0E0D',
  text: '#F4F4F2',
  sub: '#878E88',
  dim: 'rgba(244,244,242,0.45)',
  bd: 'rgba(255,255,255,0.09)',
  bdSoft: 'rgba(255,255,255,0.07)',
  bdHard: 'rgba(255,255,255,0.14)',
  green: '#4ADE80',
};
const ANILLO = '0 0 0 2px rgba(74,222,128,0.5)';

// El diseño pedía "sin rojos ni amarillos" y riesgo alto en blanco. Se cambió
// a pedido, y con razón: el resto de la app YA marca riesgo alto en #F87171 —
// la lista de beneficiarios, el AML del envío. Que KYT fuera la única pantalla
// donde riesgo alto se ve en blanco obligaba a reaprender el código de color
// justo donde hay que decidir si se opera con una contraparte señalada.
// Son los mismos tonos de ContactsSection, a propósito.
const ROJO  = { c: '#F87171', b: 'rgba(248,113,113,0.42)', f: 'rgba(248,113,113,0.08)' };
const AMBAR = { c: '#FBBF24', b: 'rgba(251,191,36,0.42)',  f: 'rgba(251,191,36,0.07)' };
const VERDE = { c: '#4ADE80', b: 'rgba(74,222,128,0.5)',   f: 'transparent' };
const NEUTRO = { c: '#878E88', b: 'rgba(255,255,255,0.22)', f: 'transparent' };

const esBajo = (cat?: string) => cat === 'bajo';
const tono = (cat?: string) =>
  cat === 'alto' ? ROJO : cat === 'medio' ? AMBAR : cat === 'bajo' ? VERDE : NEUTRO;

// ── Redes de MistTrack ────────────────────────────────────────────
// Las 18 cadenas de su documentación. El rediseño había dejado tres fijas
// porque el diseño mostraba tres botones; eso escondía quince redes que el
// proveedor sí consulta. La lista real se le pide a /v1/status al abrir y
// esto queda como respaldo.
//
// OJO CON zkSync: su código va en mayúscula y minúscula MEZCLADAS. No se
// puede normalizar a mayúsculas — se manda tal cual.
//
// El color es el de cada cadena. La paleta reserva los colores de marca
// justamente para las insignias de moneda, que es lo que son.
// TRON va PRIMERA. Es la que se usa en casi todas las consultas -- el USDT de
// Lincoin vive ahí— y una lista se lee de arriba hacia abajo: lo más usado no
// puede estar en el medio obligando a buscarlo.
const REDES: { v: string; t: string; c: string }[] = [
  { v: 'TRX',    t: 'TRON',         c: '#EF0027' },
  { v: 'BTC',    t: 'Bitcoin',      c: '#F7931A' },
  { v: 'ETH',    t: 'Ethereum',     c: '#627EEA' },
  { v: 'BNB',    t: 'BNB Chain',    c: '#F0B90B' },
  { v: 'SOL',    t: 'Solana',       c: '#9945FF' },
  { v: 'MATIC',  t: 'Polygon',      c: '#8247E5' },
  { v: 'ARB',    t: 'Arbitrum',     c: '#28A0F0' },
  { v: 'BASE',   t: 'Base',         c: '#0052FF' },
  { v: 'AVAX',   t: 'Avalanche',    c: '#E84142' },
  { v: 'OP',     t: 'Optimism',     c: '#FF0420' },
  { v: 'zkSync', t: 'zkSync Era',   c: '#8C8DFC' },
  { v: 'TON',    t: 'Toncoin',      c: '#0098EA' },
  { v: 'SUI',    t: 'Sui',          c: '#4DA2FF' },
  { v: 'LTC',    t: 'Litecoin',     c: '#A6A9AA' },
  { v: 'DOGE',   t: 'Dogecoin',     c: '#C2A633' },
  { v: 'BCH',    t: 'Bitcoin Cash', c: '#8DC351' },
  { v: 'IOTX',   t: 'IoTeX',        c: '#00D4D5' },
  { v: 'HSK',    t: 'HashKey',      c: '#1F6FEB' },
];

const redDe = (v?: string) => REDES.find(r => r.v.toLowerCase() === String(v ?? '').toLowerCase());
const nombreRed = (v?: string) => redDe(v)?.t ?? String(v ?? '');

// Insignia de la red: círculo del color de la cadena con su símbolo. Es lo
// mismo que ya hace la app con las insignias de moneda.
//
// No se dibujan los logos reales a propósito: reproducir dieciocho logos de
// memoria garantiza que varios queden mal, y un logo mal dibujado en una
// pantalla de cumplimiento se lee como descuido. Si querés los logos de
// verdad, lo correcto es vendorizar un set con licencia (cryptocurrency-icons
// es MIT) DENTRO del repo — nunca por CDN, que acá está descartado.
// ── Selector de red ───────────────────────────────────────────────────
//
// Antes eran dieciocho botones en cuatro filas: ocupaban más espacio que el
// campo de la dirección, que es lo que uno viene a llenar. Y con dieciocho
// opciones a la vista, ninguna resalta -- ni siquiera la que se usa siempre.
//
// Una lista muestra UNA, la elegida, y guarda el resto detrás de un clic.
// TRON queda arriba porque es casi siempre la respuesta.
const SelectorRed: React.FC<{
  redes: { v: string; t: string; c: string }[];
  valor: string;
  onElegir: (v: string) => void;
}> = ({ redes, valor, onElegir }) => {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const actual = redes.find(r => r.v.toLowerCase() === valor.toLowerCase()) ?? redes[0];

  // Cerrar al hacer clic afuera o con Escape. Un desplegable que se queda
  // abierto tapando el campo de al lado estorba más de lo que ayuda.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  return (
    <div ref={caja} style={{ position: 'relative', width: 232 }}>
      <button onClick={() => setAbierto(v => !v)} aria-haspopup="listbox" aria-expanded={abierto}
        style={{
          width: '100%', fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: C.text,
          background: 'rgba(255,255,255,0.035)', border: `1px solid ${abierto ? 'rgba(255,255,255,0.22)' : C.bd}`,
          borderRadius: 9, padding: '10px 12px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left',
        }}
        onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
        {actual && <Insignia v={actual.v} size={20} />}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {actual?.t ?? 'Elegí una red'}
        </span>
        <ChevronDown size={15} style={{ color: C.sub, flexShrink: 0, transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {abierto && (
        <div role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 40,
            background: C.card, border: `1px solid ${C.bdSoft}`, borderRadius: 11,
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)', padding: 5,
            maxHeight: 292, overflowY: 'auto',
          }}>
          {redes.map(r => {
            const act = valor.toLowerCase() === r.v.toLowerCase();
            return (
              <button key={r.v} role="option" aria-selected={act}
                onClick={() => { onElegir(r.v); setAbierto(false); }}
                style={{
                  width: '100%', fontFamily: FONT, fontSize: 13, fontWeight: act ? 700 : 500,
                  color: act ? C.text : C.sub, background: act ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: 'none', borderRadius: 8, padding: '9px 10px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left',
                }}
                onMouseEnter={e => { if (!act) e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; }}
                onMouseLeave={e => { if (!act) e.currentTarget.style.background = 'transparent'; }}>
                <Insignia v={r.v} size={20} />
                <span style={{ flex: 1, minWidth: 0 }}>{r.t}</span>
                {act && <Check size={14} style={{ color: C.text, flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Insignia: React.FC<{ v: string; size?: number }> = ({ v, size = 22 }) => {
  const r = redDe(v);
  const color = r?.c ?? '#878E88';
  const sigla = (r?.v ?? v).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: color, display: 'inline-grid', placeItems: 'center',
        // Texto oscuro sobre los colores claros (amarillos, verdes, grises):
        // blanco sobre #F0B90B no se lee.
        color: /^#(F7931A|F0B90B|A6A9AA|C2A633|8DC351|00D4D5|8C8DFC|4DA2FF)$/i.test(color) ? '#15181A' : '#FFFFFF',
        fontSize: size * 0.36, fontWeight: 800, letterSpacing: '-0.3px',
        fontFamily: FONT, lineHeight: 1,
      }}
    >{sigla}</span>
  );
};

// Formato por red. Las EVM comparten formato; el resto tiene el suyo. Una red
// que no reconocemos NO se rechaza: preferimos que el proveedor la rechace
// antes que bloquear una cadena que él sí soporta y nosotros no anotamos.
const EVM_SET = new Set(['eth', 'bnb', 'matic', 'arb', 'op', 'base', 'avax', 'zksync', 'hsk', 'iotx']);
const FORMATOS: Record<string, RegExp> = {
  TRX:  /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  BTC:  /^(bc1[0-9a-z]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  BCH:  /^((bitcoincash:)?[qp][0-9a-z]{41}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  LTC:  /^(ltc1[0-9a-z]{11,71}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,33})$/,
  DOGE: /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/,
  SOL:  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  SUI:  /^0x[0-9a-fA-F]{64}$/,
  TON:  /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/,
};
const formatoOk = (coin: string, dir: string) => {
  if (EVM_SET.has(coin.toLowerCase())) return /^0x[0-9a-fA-F]{40}$/.test(dir);
  const re = FORMATOS[coin.toUpperCase()];
  return re ? re.test(dir) : dir.length >= 20 && dir.length <= 120;
};

const enmascarar = (a?: string) => {
  const s = String(a ?? '');
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
};

// ── Rutas: el camino y el sentido de la plata en cada tramo ──
// 23 nov: la pantalla dibujaba "TDKwiu → TRV6t7 → TRFDKB" y al lado decía
// "recibiste". Las flechas eran solo el orden del camino, no el sentido de
// la plata, y se leían como "envié". Ahora cada flecha es el sentido real de
// ese tramo, visto con esta dirección a la izquierda:
//   ← la plata fue hacia esta dirección · → salió de ella
//   ⇄ hubo de las dos                    · — no se sabe
const FLECHA: Record<string, string> = { entrante: '←', saliente: '→', ambos: '⇄' };

const tramoEnPalabras = (t: string | null | undefined, v: string) =>
  t === 'entrante' ? `${v} le envió fondos a esta dirección`
  : t === 'saliente' ? `esta dirección le envió fondos a ${v}`
  : t === 'ambos' ? `esta dirección y ${v} se enviaron fondos en los dos sentidos`
  : null;

// La ruta dicha en una frase, tramo por tramo. Es lo que contesta la
// pregunta "¿recibí o envié?" sin tener que leer flechas.
function fraseRuta(r: any, nodos: string[], tramos: (string | null)[]): string | null {
  const inter = nodos.slice(1, -1);
  const flujo = flujoRuta(r);
  const [t0, t1] = tramos;
  if (!inter.length) {
    return t0 === 'entrante' ? 'Esta dirección recibió fondos directamente de la señalada.'
      : t0 === 'saliente' ? 'Esta dirección le envió fondos directamente a la señalada.'
      : t0 === 'ambos' ? 'Esta dirección y la señalada se enviaron fondos directamente, en los dos sentidos.'
      : null;
  }
  const v = enmascarar(inter[0]);
  const primero = tramoEnPalabras(t0, v);
  if (!primero) return null;
  const Primero = primero.charAt(0).toUpperCase() + primero.slice(1);
  if (inter.length === 1 && t1) {
    // Si el primer tramo ya nombró al intermediario como sujeto, no se repite.
    const quien = t0 === 'entrante' ? '' : `${v} `;
    const segundo = t1 === 'entrante' ? `${quien}recibió fondos de la señalada`
      : t1 === 'saliente' ? `${quien}le envió fondos a la señalada`
      : `${t0 === 'entrante' ? 'se envió' : `${v} y la señalada se enviaron`} fondos en los dos sentidos${t0 === 'entrante' ? ' con la señalada' : ''}`;
    const lectura = flujo === 'entrante' ? 'La plata de la señalada pudo llegar a esta dirección por este camino.'
      : flujo === 'saliente' ? 'La plata de esta dirección pudo llegar a la señalada por este camino.'
      : flujo === 'ambos' ? 'La plata pudo ir y venir entre la señalada y esta dirección por este camino.'
      : flujo === 'cruzado' ? `Entre la señalada y esta dirección no pasa plata por este camino: solo comparten a ${v}.`
      : '';
    return `${Primero}, y ${segundo}. ${lectura}`;
  }
  // Camino del proveedor: solo se sabe el tramo que toca a esta dirección.
  return `Primer tramo: ${primero}. El proveedor no informa el sentido de los tramos siguientes.`;
}

const hora = (t?: string | null) => {
  if (!t) return '—';
  try {
    const d = new Date(t);
    const hoy = new Date().toDateString() === d.toDateString();
    const hm = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
    return hoy ? `hoy ${hm}` : `${d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} ${hm}`;
  } catch { return '—'; }
};

const hace = (t?: string | null) => {
  if (!t) return '—';
  const ms = Date.now() - new Date(t).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `hace ${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

// Los hallazgos del proveedor, EN ESPAÑOL. Salían tal cual llegan de MistTrack
// —"Involved Illicit Activity"— en una pantalla en castellano. Lo que el
// traductor no reconoce queda en inglés a propósito: ver lib/kytTextos.ts.
const textos = (arr: any[] | undefined, max = 30): string[] => hallazgosEnEspanol(arr, max);

// ── NUESTRA lectura del riesgo, aplicada apenas llega el resultado ──
//
// MistTrack le puso 3/100 a una dirección cuyo propio detail_list dice
// "Involved Illicit Activity". La pantalla pintaba ese 3 de verde y arriba
// escribía "está señalada directamente": dos cosas ciertas que, juntas, se leen
// como tranquilizadoras.
//
// Se corrige acá, una sola vez, para que la pantalla y el reporte no puedan
// discrepar. El puntaje del proveedor NO se toca — se muestra su número tal
// cual y se explica por qué la banda no coincide.
function conLectura(r: any): any {
  if (!r?.ok) return r;
  const motivos = Array.from(new Set([
    ...hallazgosEnEspanol(r.detalle), ...hallazgosEnEspanol(r.hallazgos),
  ]));
  const l = bandaDeRiesgo(r.categoria, motivos);
  return { ...r, categoria: l.categoria, categoriaProveedor: r.categoria, lectura: l };
}

// ── Círculo del puntaje ───────────────────────────────────────────
// El círculo lleva NUESTRA banda (el color) y el puntaje del proveedor (el
// número). Cuando los dos coinciden, se ve un 85 en rojo y se entiende solo.
// Cuando la banda subió por un señalamiento directo, un "3" en rojo se lee
// como un error: el número se va a la línea de texto, con su etiqueta, y el
// círculo muestra el aviso.
const Puntaje: React.FC<{ n: number | null; cat?: string; size?: number; elevado?: boolean }> = ({ n, cat, size = 44, elevado }) => {
  const t = tono(cat);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      border: `2px solid ${t.b}`, background: t.f, display: 'grid', placeItems: 'center',
    }}>
      <span style={{ fontSize: size * 0.36, fontWeight: 800, color: t.c, fontVariantNumeric: 'tabular-nums' }}>
        {elevado ? '!' : n == null ? '–' : n}
      </span>
    </div>
  );
};

const Pill: React.FC<{ texto: string; cat?: string }> = ({ texto, cat }) => {
  const t = tono(cat);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '1px', whiteSpace: 'nowrap',
      color: t.c, border: `1px solid ${t.b}`, borderRadius: 999, padding: '3px 9px',
    }}>{texto}</span>
  );
};

const Mini: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 11, padding: '13px 15px' }}>
    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: '0 0 6px' }}>{label}</p>
    <p style={{ fontSize: 12.5, color: C.text, margin: 0, lineHeight: 1.55 }}>{children}</p>
  </div>
);

// ── El resultado cuando lo hizo Sarblock (desde el 23 nov, EVM y TRON) ──
// Sarblock no trae caminos por saltos ni contrapartes: trae una
// recomendación ("el campo para decidir", según su documentación), un
// puntaje, señales y chequeos. Se muestra eso, con sus palabras, y no se
// rellena lo que no dio. El análisis profundo (rutas) se pide aparte.
const TONO_REC: Record<string, typeof VERDE> = { CLEAR: VERDE, MONITOR: AMBAR, REVIEW: AMBAR, BLOCK: ROJO };
const ResultadoSarblock: React.FC<{
  sb: any; cadena: any; rastreando: boolean; conRutas: boolean; onProfundo: () => void;
}> = ({ sb, cadena, rastreando, conRutas, onProfundo }) => {
  const rec = recomendacionSb(sb?.recomendacion);
  const t = TONO_REC[String(sb?.recomendacion ?? '')] ?? NEUTRO;
  const senales: any[] = Array.isArray(sb?.senales) ? sb.senales : [];
  const ch = sb?.chequeos ?? {};
  const fecha = (v: any) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };
  return (
    <>
      <div style={{ marginBottom: 14, border: `1px solid ${t.b}`, background: t.f, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 15px', borderBottom: `1px solid ${C.bdSoft}` }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: '0 0 4px' }}>RECOMENDACIÓN DEL PROVEEDOR</p>
          <p style={{ fontSize: 15, fontWeight: 800, color: t.c, margin: 0 }}>
            {rec ? rec.titulo : 'Sin recomendación'}
            {sb?.recomendacion && <span style={{ fontFamily: MONO, fontSize: 11, color: C.sub, fontWeight: 600, marginLeft: 8 }}>{sb.recomendacion}</span>}
          </p>
          {rec && <p style={{ fontSize: 12.5, color: C.text, margin: '3px 0 0', lineHeight: 1.55 }}>{rec.detalle}</p>}
          {sb?.degraded && (
            <p style={{ fontSize: 11.5, color: AMBAR.c, margin: '6px 0 0', lineHeight: 1.55 }}>
              Parte de la evidencia no se pudo consultar: el resultado es válido, pero menos completo.
            </p>
          )}
        </div>
        {senales.length ? senales.map((x: any, i: number) => (
          <div key={i} style={{ padding: '10px 15px', borderTop: i ? `1px solid ${C.bdSoft}` : 'none' }}>
            <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>
              {senalEs(x.code, x.category)}
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.sub, fontWeight: 600, marginLeft: 8 }}>{x.code}</span>
            </p>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>
              {[
                x.severity ? `severidad ${severidadEs(x.severity)}` : null,
                x.network ? `red ${x.network}` : null,
                x.entity ? `entidad ${x.entity}` : null,
                x.exposureUsd != null ? `exposición USD ${Number(x.exposureUsd).toLocaleString('es-CO', { maximumFractionDigits: 2 })}` : null,
              ].filter(Boolean).join(' · ') || 'sin más detalle'}
            </p>
          </div>
        )) : (
          <p style={{ fontSize: 12.5, color: C.sub, margin: 0, padding: '11px 15px', lineHeight: 1.55 }}>
            Sin señales de riesgo{ch.total != null ? ` en los ${ch.total} chequeos que corre el análisis` : ''}. No es una garantía: una dirección limpia hoy puede aparecer señalada mañana.
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <Mini label="PUNTAJE">
          {sb?.score?.value != null ? `${sb.score.value} / 100` : 'sin puntaje'}
          {sb?.riskLevel ? ` · nivel ${nivelSarblockEs(sb.riskLevel).toLowerCase()}` : ''}
          {sb?.score?.confidence ? ` · confianza ${confianzaEs(sb.score.confidence)}` : ''}
          {sb?.score?.floor === 90 ? ' · mínimo 90 por una sanción o un congelamiento' : sb?.score?.floor === 70 ? ' · mínimo 70 por un hackeo documentado' : ''}
        </Mini>
        <Mini label="CHEQUEOS">
          {ch.total != null ? `${ch.clean ?? 0} de ${ch.total} sin hallazgos` : 'sin dato'}
          {Array.isArray(ch.flagged) && ch.flagged.length ? ` · con hallazgos: ${ch.flagged.join(', ')}` : ''}
        </Mini>
        <Mini label="EXPOSICIÓN A EXCHANGES">
          {sb?.exposicion?.exchangeSharePct != null
            ? `${sb.exposicion.exchangeSharePct} % de lo recibido en los últimos 12 meses vino de exchanges`
            : <span style={{ color: C.sub }}>El proveedor no lo sabe para esta dirección.</span>}
        </Mini>
        <Mini label="ACTIVIDAD">
          {[
            Array.isArray(sb?.redesActivas) && sb.redesActivas.length ? `Movimientos en ${sb.redesActivas.join(', ')}` : null,
            cadena?.transacciones != null ? `${Number(cadena.transacciones).toLocaleString('es-CO')} transacciones` : null,
            fecha(cadena?.creada) ? `activa desde ${fecha(cadena.creada)!.getFullYear()}` : null,
            fecha(cadena?.ultimaActividad) ? `último mov. ${hace(cadena.ultimaActividad)}` : null,
          ].filter(Boolean).join(' · ') || <span style={{ color: C.sub }}>Sin datos de actividad.</span>}
        </Mini>
      </div>

      {/* El análisis profundo: rutas por saltos e intermediarios. Lo hace
          otro proveedor y se paga por contraparte, por eso no va en cada
          consulta: se pide cuando hace falta. */}
      {!conRutas && (
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, marginTop: 12, border: `1px solid ${C.bdSoft}`, borderRadius: 11, padding: '11px 15px' }}>
          <p style={{ fontSize: 12, color: C.sub, margin: 0, lineHeight: 1.55, flex: '1 1 320px' }}>
            <b style={{ color: C.text, fontWeight: 700 }}>Análisis profundo.</b> Rastrea las rutas por saltos hacia
            entidades señaladas y los intermediarios, con otro proveedor de analítica. Usa varias consultas de tu tope diario.
          </p>
          <button onClick={onProfundo} disabled={rastreando}
            style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.bdHard}`, borderRadius: 8, padding: '7px 12px', cursor: rastreando ? 'default' : 'pointer', opacity: rastreando ? 0.5 : 1, whiteSpace: 'nowrap' }}>
            {rastreando ? 'Rastreando…' : 'Rastrear intermediarios'}
          </button>
        </div>
      )}
    </>
  );
};

type Res = any;
type Fila = any;

// `volverA`: a dónde lleva la flecha. Se entra desde Lincoin Risk (la
// ventana que pregunta AML o KYT, 23 nov).
// `consultas`: el saldo de consultas de Lincoin Risk. Desde el 23 nov el KYT
// las gasta igual que la consulta AML (pedido del dueño: "las mismas de AML
// sirven para el KYT"); null = todavía no se sabe. `onSaldo` avisa el saldo
// que devuelve el servidor después de cada consulta.
export const KytSection: React.FC<{
  onBack?: () => void; volverA?: string;
  consultas?: number | null; onSaldo?: (n: number) => void; onRecargar?: () => void;
}> = ({ onBack, volverA = 'Lincoin Risk', consultas = null, onSaldo, onRecargar }) => {
  const [coin, setCoin] = useState('TRX');
  // Las redes las manda el proveedor (/v1/status). Si no contesta, el servidor
  // devuelve la lista conocida: un selector vacío deja la pantalla inservible.
  const [redes, setRedes] = useState(REDES);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);

  const [lista, setLista] = useState<Fila[]>([]);
  const [meta, setMeta] = useState<{ tope: number; horas: number; ultimaRonda: string | null }>({ tope: 50, horas: 24, ultimaRonda: null });
  const [filtro, setFiltro] = useState<'todas' | 'cambio' | 'orden'>('todas');
  const [aliasPara, setAliasPara] = useState<null | { coin: string; address: string }>(null);
  const [alias, setAlias] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [reporte, setReporte] = useState<any | null>(null);
  const [rutas, setRutas] = useState<any | null>(null);
  const [rastreando, setRastreando] = useState(false);
  const [armando, setArmando] = useState(false);

  const cargarLista = useCallback(async () => {
    const r = await llamarFuncion('kyt', { action: 'lista' }, 20000).catch(() => null);
    if (r?.ok) {
      setLista(Array.isArray(r.direcciones) ? r.direcciones : []);
      setMeta({ tope: r.tope ?? 50, horas: r.horas ?? 24, ultimaRonda: r.ultimaRonda ?? null });
    }
  }, []);
  useEffect(() => { cargarLista(); }, [cargarLista]);

  useEffect(() => {
    let vivo = true;
    llamarFuncion('kyt', { action: 'cadenas' }, 20000)
      .then(r => {
        if (!vivo || !Array.isArray(r?.cadenas) || !r.cadenas.length) return;
        // Solo se muestran las que sabemos nombrar y colorear. Una fila con
        // doscientos códigos crudos no es un selector, es una lista de errores
        // esperando a pasar.
        const vivas = r.cadenas
          .map((x: any) => String(typeof x === 'string' ? x : (x?.coin ?? x?.symbol ?? x?.value ?? '')).trim())
          .filter(Boolean)
          .map((v: string) => redDe(v))
          .filter(Boolean) as typeof REDES;
        // El proveedor devuelve las cadenas en SU orden. Se reordenan según
        // el nuestro para que TRON siga primera: si no, el orden de la lista
        // cambia según lo que conteste un tercero.
        if (vivas.length) {
          const pos = new Map(REDES.map((r, i) => [r.v, i]));
          setRedes([...vivas].sort((a, b) => (pos.get(a.v) ?? 99) - (pos.get(b.v) ?? 99)));
        }
      })
      .catch(() => { /* se queda el respaldo */ });
    return () => { vivo = false; };
  }, []);

  const consultar = async () => {
    const a = dir.trim();
    if (!formatoOk(coin, a)) {
      setRes({ ok: false, error: 'formato_red', mensaje: `Esa dirección no tiene el formato de ${nombreRed(coin)}. Revisá la red que elegiste.` });
      return;
    }
    setBusy(true); setRes(null); setRutas(null);
    try {
      let r = await llamarFuncion('kyt', { action: 'consultar', coin, address: a }, 45000);
      // El análisis del proveedor puede tardar más que la espera del
      // servidor. Volver a pedirlo devuelve el mismo análisis y no se cobra
      // otra vez, así que se reintenta solo dos veces antes de decir "en curso".
      for (let i = 0; i < 2 && r?.error === 'en_curso'; i++) {
        await new Promise(ok => setTimeout(ok, 6000));
        r = await llamarFuncion('kyt', { action: 'consultar', coin, address: a }, 45000);
      }
      if (typeof r?.saldoConsultas === 'number') onSaldo?.(r.saldoConsultas);
      setRes(r ? conLectura(r) : { ok: false, error: 'sin_respuesta', mensaje: 'No obtuvimos respuesta. Probá de nuevo.' });
      // La consulta deja la wallet en monitoreo (23 nov): se refresca la
      // lista para que aparezca sin recargar la pantalla.
      if (r?.monitoreoNuevo) cargarLista();
    } catch {
      setRes({ ok: false, error: 'red', mensaje: 'No obtuvimos respuesta. Probá de nuevo.' });
    }
    setBusy(false);
  };

  const guardar = async () => {
    if (!aliasPara) return;
    setGuardando(true);
    const r = await llamarFuncion('kyt', { action: 'guardar', coin: aliasPara.coin, address: aliasPara.address, alias }, 20000).catch(() => null);
    setGuardando(false);
    if (r?.ok) { setAliasPara(null); setAlias(''); cargarLista(); }
    else alert(r?.mensaje ?? 'No se pudo guardar. Probá de nuevo.');
  };

  const quitar = async (id: string) => {
    setLista(l => l.filter(x => x.id !== id));   // se va de la vista al instante
    await llamarFuncion('kyt', { action: 'quitar', id }, 15000).catch(() => null);
    cargarLista();
  };

  const abrirHistorial = async () => {
    setVerHistorial(true);
    const r = await llamarFuncion('kyt', { action: 'alertas' }, 20000).catch(() => null);
    setAlertas(Array.isArray(r?.alertas) ? r.alertas : []);
  };

  const yaGuardada = res?.ok && lista.some(
    (x: Fila) => x.coin === res.coin && String(x.address).toLowerCase() === String(res.address).toLowerCase()
  );

  const conCambio = lista.filter(x => x.subio);
  // Saldo conocido y en cero: no se consulta (el servidor también lo frena).
  const sinConsultas = consultas != null && consultas <= 0;
  const visibles = filtro === 'cambio' ? conCambio : filtro === 'orden' ? lista.filter(x => !x.subio) : lista;

  // "Riesgo alto · 3 / 100" en una sola línea se lee como un error de la
  // pantalla, no como dos fuentes distintas. Cuando nuestra banda subió por
  // encima del puntaje del proveedor, el número va aparte y con dueño.
  // El nivel con el nombre que le da el proveedor (Bajo, Moderado, Alto,
  // Severo): el mismo que dice su reporte. Ver bandaDeRiesgo en kytTextos.
  const nivelTexto = (cat?: string, nivel?: string | null, proveedor?: string, walletNueva?: boolean) => {
    // Wallet nueva (23 nov, decisión del dueño): su única observación es no
    // tener historial y Lincoin la clasifica riesgo bajo (el servidor ya
    // manda categoria 'bajo'; aquí se dice por qué).
    if (walletNueva) return 'Riesgo bajo · wallet nueva';
    // Cada proveedor con su escala: Sarblock dice Medio o Crítico donde
    // MistTrack dice Moderado o Severo. Traducir uno a la del otro sería
    // poner en su boca una palabra que no usó.
    const n = proveedor === 'sarblock' ? nivelSarblockEs(nivel) : nivelProveedorEs(nivel, cat);
    return n === 'Sin clasificar' ? n : n === 'Sin riesgo' ? n : `Riesgo ${n.toLowerCase()}`;
  };

  const btnFiltro = (k: typeof filtro, t: string) => (
    <button
      key={k}
      onClick={() => setFiltro(k)}
      style={{
        fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
        color: filtro === k ? C.text : C.sub,
        background: filtro === k ? 'rgba(255,255,255,0.08)' : 'transparent',
        border: `1px solid ${filtro === k ? C.bdHard : 'transparent'}`,
        borderRadius: 9, padding: '7px 13px', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
      onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >{t}</button>
  );

  return (
    <div style={{ fontFamily: FONT, color: C.text, padding: '34px 44px 60px', maxWidth: 1080 }} className="animate-in fade-in duration-300">
      {/* ── Encabezado ── */}
      <div className="flex items-center" style={{ gap: 14, marginBottom: 8 }}>
        {onBack && (
          <button onClick={onBack} className="transition-colors hover:text-[#F4F4F2]"
            style={{ fontSize: 13.5, fontWeight: 600, color: C.sub, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
            <ArrowLeft size={16} strokeWidth={1.6} /> {volverA}
          </button>
        )}
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Verificación de direcciones (KYT)</h1>
        {consultas != null && (
          <button onClick={onRecargar} disabled={!onRecargar}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, padding: '9px 10px 9px 15px', borderRadius: 14, cursor: onRecargar ? 'pointer' : 'default', fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${consultas <= 0 ? 'rgba(251,191,36,0.45)' : C.bdSoft}` }}
            onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: consultas <= 0 ? '#FBBF24' : C.sub }}>{consultas <= 0 ? 'SIN CONSULTAS' : 'CONSULTAS'}</span>
              <span style={{ display: 'block', fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px', color: consultas <= 0 ? '#FBBF24' : C.text }}>{consultas.toLocaleString('es-CO')}</span>
            </span>
            {onRecargar && <span style={{ height: 32, padding: '0 12px', borderRadius: 9, background: '#F4F4F2', color: '#15181A', fontSize: 12.5, fontWeight: 700, display: 'grid', placeItems: 'center' }}>+ Recargar</span>}
          </button>
        )}
      </div>
      <p style={{ fontSize: 13.5, color: C.sub, margin: '0 0 24px', maxWidth: 640, lineHeight: 1.6 }}>
        Consultá una dirección antes de operar con ella. Te decimos si está señalada por actividad
        ilícita, con qué puntaje y por qué. No bloquea nada — es información para que decidas.
      </p>

      {/* ── Consulta ── */}
      <div style={{ background: C.card, border: `1px solid ${C.bdSoft}`, borderRadius: 14, padding: '22px 24px', marginBottom: 14 }}>
        <div className="flex flex-wrap items-end" style={{ gap: 14 }}>
          <div>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: '0 0 7px' }}>RED</p>
            {/* UNA LISTA, NO DIECIOCHO BOTONES.
                Desplegadas ocupaban cuatro filas y pesaban más que el campo de
                la dirección, que es lo que uno viene a llenar. Una sola en
                pantalla, las demás a un clic. */}
            <SelectorRed redes={redes} valor={coin} onElegir={setCoin} />
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: '0 0 7px' }}>DIRECCIÓN</p>
            <input
              value={dir} onChange={e => setDir(e.target.value)} spellCheck={false}
              onKeyDown={e => { if (e.key === 'Enter' && !busy) consultar(); }}
              placeholder="Pegá la dirección de la billetera"
              style={{
                width: '100%', fontFamily: MONO, fontSize: 13.5, color: C.text,
                background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.bd}`,
                borderRadius: 9, padding: '12px 13px', outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>
          <button onClick={consultar} disabled={busy || !dir.trim() || sinConsultas}
            style={{
              fontFamily: FONT, fontSize: 13.5, fontWeight: 700,
              background: C.text, color: '#0A0A0A', border: 'none', borderRadius: 9,
              padding: '12px 22px', cursor: busy || !dir.trim() || sinConsultas ? 'default' : 'pointer',
              opacity: busy || !dir.trim() || sinConsultas ? 0.45 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
            }}
            onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? 'Consultando' : 'Consultar'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: C.sub, margin: '12px 0 0', lineHeight: 1.55 }}>
          La dirección tiene que ser de la red que elegiste. La misma cadena de caracteres en otra
          red es otra dirección y otro riesgo.
        </p>
        {consultas != null && (
          <p style={{ fontSize: 12, color: sinConsultas ? '#FBBF24' : C.sub, margin: '6px 0 0', lineHeight: 1.55 }}>
            {sinConsultas
              ? <>No te quedan consultas.{onRecargar ? <> <button onClick={onRecargar} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: 'inherit', fontWeight: 700, color: C.text, textDecoration: 'underline' }}>Recarga para consultar</button></> : null}</>
              : <>Usa 1 consulta de Lincoin Risk (las mismas de AML). Si la dirección ya la consultaste y sigue vigente, no se cobra otra vez; si no sale un resultado, se devuelve.</>}
          </p>
        )}
      </div>

      {/* ── Resultado ── */}
      {res && !res.ok && (
        <div style={{ background: C.card, border: `1px solid ${C.bdHard}`, borderRadius: 14, padding: '20px 24px', marginBottom: 14 }}>
          <div className="flex items-start" style={{ gap: 12 }}>
            <ShieldQuestion size={19} strokeWidth={1.5} style={{ color: C.sub, flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                {res.error === 'sin_consultas' ? 'No te quedan consultas'
                  : res.error === 'sin_consulta' ? 'Primero consulta la dirección'
                  : res.error === 'sin_credencial' ? 'El servicio no está habilitado todavía'
                  : res.error === 'en_curso' ? 'El análisis sigue en curso'
                  : res.error === 'servicio' ? 'La verificación no está disponible ahora'
                  : res.error === 'tope_diario' ? 'Llegaste al tope de consultas de hoy'
                  : res.error === 'formato_red' ? 'La dirección no coincide con la red'
                  : 'Sin resultado'}
              </p>
              <p style={{ fontSize: 13, color: C.sub, margin: '5px 0 0', lineHeight: 1.6 }}>{res.mensaje}</p>
              {res.error === 'sin_consultas' && onRecargar && (
                <button onClick={onRecargar}
                  style={{ marginTop: 10, fontFamily: FONT, fontSize: 13, fontWeight: 700, background: '#F4F4F2', color: '#15181A', border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }}>
                  Recargar consultas
                </button>
              )}
              {/* El código del error del proveedor (sin su nombre). Sin esto,
                  "no está disponible" no dejaba saber si era la llave, los
                  créditos o una caída, y había que buscarlo en otro lado. */}
              {res.referencia && (
                <p style={{ fontSize: 11.5, color: C.sub, margin: '6px 0 0' }}>
                  Referencia: <span style={{ fontFamily: MONO, color: C.text }}>{res.referencia}</span>
                </p>
              )}
              {res.error === 'sin_resultado' && (
                <p style={{ fontSize: 12.5, color: C.text, margin: '9px 0 0', fontWeight: 600, lineHeight: 1.55 }}>
                  Que no haya resultado no significa que la dirección esté limpia. Significa que no
                  sabemos. Tratala como no verificada.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {res && res.ok && (
        <div style={{ background: C.card, border: `1px solid ${C.bdSoft}`, borderRadius: 14, padding: '20px 24px', marginBottom: 30 }}>
          <div className="flex items-start justify-between flex-wrap" style={{ gap: 16, marginBottom: 16 }}>
            <div className="flex items-center" style={{ gap: 14, minWidth: 0 }}>
              <Puntaje n={res.puntaje ?? null} cat={res.categoria} elevado={!!res.lectura?.elevada} />
              <Insignia v={res.coin} size={24} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                  {nivelTexto(res.categoria, res.nivel, res.proveedor, !!res.walletNueva)}
                  {res.puntaje != null && (
                    <span style={{ color: C.sub, fontWeight: 600 }}> · {res.puntaje} / 100</span>
                  )}
                </p>
                {/* Entidad y sanciones: la ficha con que abre el reporte del
                    proveedor ("Address Entity", "Sanctions"). */}
                <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.45 }}>
                  Entidad: <b style={{ color: C.text, fontWeight: 700 }}>{res.etiquetaProveedor || textos(res.etiquetas, 1)[0] || 'sin identificar'}</b>
                  {(() => {
                    const sanc = res.proveedor === 'sarblock' ? !!res.sarblock?.sancionada : sancionadaPorProveedor(res.detalle, res.hallazgos);
                    return <>{' · '}Sanciones: <b style={{ color: sanc ? ROJO.c : C.text, fontWeight: 700 }}>{sanc ? 'Sí' : 'No'}</b></>;
                  })()}
                </p>
                {/* Dos líneas cortas en vez de una larga que en el celular se
                    partía en cuatro renglones. */}
                <p style={{ fontFamily: MONO, fontSize: 12, color: C.sub, margin: '4px 0 0' }}>
                  {enmascarar(res.address)} · {nombreRed(res.coin)}
                </p>
                <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>
                  Consultada {hora(res.consultadoAt)}{res.delPadron ? ' · de una consulta reciente' : ''}
                </p>
              </div>
            </div>
            {/* En el celular los tres botones iban en una sola fila y el
                tercero —el del reporte— quedaba cortado fuera de la pantalla.
                Ahora la fila envuelve. */}
            <div className="flex items-center" style={{ gap: 10, flexWrap: 'wrap', maxWidth: '100%' }}>
              <button
                onClick={() => { if (!yaGuardada) { setAlias(''); setAliasPara({ coin: res.coin, address: res.address }); } }}
                disabled={!!yaGuardada}
                className="transition-colors"
                style={{
                  fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
                  color: yaGuardada ? C.green : C.text,
                  background: 'rgba(255,255,255,0.05)',
                  border: `1px solid ${yaGuardada ? 'rgba(74,222,128,0.4)' : C.bdHard}`,
                  borderRadius: 9, padding: '10px 15px',
                  cursor: yaGuardada ? 'default' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                }}
                onMouseEnter={e => { if (!yaGuardada) e.currentTarget.style.borderColor = 'rgba(74,222,128,0.5)'; }}
                onMouseLeave={e => { if (!yaGuardada) e.currentTarget.style.borderColor = C.bdHard; }}
                onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
              >
                <Eye size={15} strokeWidth={1.5} /> {yaGuardada ? 'Ya la monitoreás' : 'Guardar y monitorear'}
              </button>
              {res.delPadron && (
                // Una ficha vieja puede no traer lo que hoy mostramos. Antes no
                // había forma de pedir una consulta fresca y la pantalla se
                // quedaba a medias sin explicación.
                <button
                  onClick={async () => {
                    setBusy(true);
                    const r = await llamarFuncion('kyt', { action: 'consultar', coin: res.coin, address: res.address, force: true }, 45000).catch(() => null);
                    // Pasa por la misma lectura que la consulta inicial: sin
                    // esto, re-consultar devolvía la banda del proveedor y una
                    // dirección señalada volvía a salir en verde.
                    if (typeof r?.saldoConsultas === 'number') onSaldo?.(r.saldoConsultas);
                    if (r) setRes(conLectura(r));
                    setBusy(false);
                  }}
                  className="transition-colors hover:text-[#F4F4F2]"
                  style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.sub, background: 'none', border: 'none', padding: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Consultar de nuevo
                </button>
              )}
              <button
                onClick={async () => {
                  setArmando(true);
                  const r = await llamarFuncion('kyt', { action: 'reporte', coin: res.coin, address: res.address }, 60000).catch(() => null);
                  setArmando(false);
                  if (typeof r?.saldoConsultas === 'number') onSaldo?.(r.saldoConsultas);
                  // Si ya se rastrearon rutas, van al reporte: es el dato
                  // mas caro de obtener y seria absurdo dejarlo fuera.
                  // Sin rastreo en pantalla, el del servidor: `{ ...r, rutas }` lo
                  // pisaba con null y el reporte salía sin rutas.
                  if (r?.ok) setReporte({ ...r, rutas: rutas ?? r.rutas });
                  else alert(r?.mensaje ?? 'No pudimos armar el reporte. Probá de nuevo.');
                }}
                disabled={armando}
                className="transition-colors"
                style={{
                  fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text,
                  background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bdHard}`,
                  borderRadius: 9, padding: '10px 15px', cursor: armando ? 'default' : 'pointer',
                  opacity: armando ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 7,
                }}
                onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
              >
                <FileText size={15} strokeWidth={1.5} /> {armando ? 'Armando…' : 'Reporte AML'}
              </button>
              {/* El enlace "Ver reporte completo" llevaba al reporte de
                  MistTrack, afuera de Lincoin. Se quitó: lo que ese reporte
                  dice tiene que estar en el nuestro. Si algo falta acá, se
                  agrega acá — no se manda al cliente a otro sitio. */}
            </div>
          </div>

          {/* ── LO QUE SE MIRA PRIMERO ──
              El orden importa y me costó un error: la dirección puede estar
              señalada ELLA MISMA, y eso es más grave que tener una ruta hacia
              alguien señalado. `risk_detail` describe exposición HACIA OTRAS
              entidades, así que una dirección que ES la maliciosa viene sin
              rutas — y el bloque de rutas decía "sin rutas hacia entidades
              señaladas", que junto a "Suspected Malicious Address" se lee como
              tranquilizador. Dos frases ciertas que juntas mienten.

              Ahora manda el señalamiento directo, y el aviso de "sin rutas"
              SOLO aparece cuando la dirección tampoco está señalada. */}
          {res.proveedor === 'sarblock' && res.sarblock && (
            <ResultadoSarblock
              sb={res.sarblock} cadena={res.cadena} rastreando={rastreando} conRutas={!!rutas}
              onProfundo={async () => {
                setRastreando(true);
                const r = await llamarFuncion('kyt', { action: 'rutas', coin: res.coin, address: res.address }, 90000).catch(() => null);
                setRastreando(false);
                if (r?.ok) setRutas(r); else alert(r?.mensaje ?? 'No pudimos rastrear las rutas.');
              }}
            />
          )}
          {res.proveedor !== 'sarblock' && (() => {
            // Lo que el proveedor dice de la dirección MISMA va separado de
            // con quién interactuó. "Interact With High-risk Tag Address" en
            // una dirección de Binance con puntaje 3 salía como "señalada
            // directamente" y "riesgo medio", contra el "Bajo (3)" del reporte
            // del proveedor (22 nov).
            const ind = indicadoresDe(res.detalle);
            const propios = [...(res.hackingEvent ? [`Incidente: ${res.hackingEvent}`] : []), ...ind.propios];
            const senalada = propios.length > 0;
            const conRutas = Array.isArray(res.exposicion?.items) && res.exposicion.items.length > 0;

            return (
              <>
                {senalada && (
                  <div style={{ marginBottom: 14, border: `1px solid ${tono(res.categoria).b}`, background: tono(res.categoria).f, borderRadius: 12, padding: '14px 16px' }}>
                    <p style={{ fontSize: 13.5, fontWeight: 800, color: tono(res.categoria).c, margin: 0 }}>
                      El proveedor etiqueta esta dirección
                    </p>
                    <p style={{ fontSize: 12.5, color: C.text, margin: '7px 0 0', lineHeight: 1.6 }}>
                      {propios.slice(0, 8).join(' · ')}
                    </p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '9px 0 0', lineHeight: 1.55 }}>
                      La etiqueta es sobre esta dirección, no sobre su entorno. El nivel de riesgo y el
                      puntaje son los del proveedor, sin cambios.
                    </p>
                  </div>
                )}
                {ind.interacciones.length > 0 && (
                  <div style={{ marginBottom: 14, border: `1px solid ${C.bdSoft}`, borderRadius: 12, padding: '13px 16px' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: C.text, margin: 0 }}>
                      Interacciones reportadas por el proveedor
                    </p>
                    <p style={{ fontSize: 12.5, color: C.text, margin: '6px 0 0', lineHeight: 1.6 }}>
                      {ind.interacciones.slice(0, 8).join(' · ')}
                    </p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '8px 0 0', lineHeight: 1.55 }}>
                      Indican con quién operó la dirección, no que la dirección misma esté señalada. El
                      proveedor ya las tuvo en cuenta en el puntaje de {res.puntaje ?? '—'} / 100.
                    </p>
                  </div>
                )}

                {conRutas ? (
                  <div style={{ marginBottom: 14, border: `1px solid ${tono(res.categoria).b}`, background: tono(res.categoria).f, borderRadius: 12, overflow: 'hidden' }}>
                    <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 15px', borderBottom: `1px solid ${C.bdSoft}` }}>
                      <p style={{ fontSize: 13, fontWeight: 800, color: tono(res.categoria).c, margin: 0 }}>
                        {res.exposicion.items.length} {res.exposicion.items.length === 1 ? 'ruta hacia una entidad señalada' : 'rutas hacia entidades señaladas'}
                      </p>
                      <button
                        onClick={async () => {
                          setRastreando(true);
                          const r = await llamarFuncion('kyt', { action: 'rutas', coin: res.coin, address: res.address }, 90000).catch(() => null);
                          setRastreando(false);
                          if (r?.ok) setRutas(r); else alert(r?.mensaje ?? 'No pudimos rastrear las rutas.');
                        }}
                        disabled={rastreando}
                        style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.bdHard}`, borderRadius: 8, padding: '7px 12px', cursor: rastreando ? 'default' : 'pointer', opacity: rastreando ? 0.5 : 1 }}>
                        {rastreando ? 'Rastreando…' : 'Rastrear intermediarios'}
                      </button>
                    </div>
                    {res.exposicion.items.map((it: any, i: number) => {
                      // `camino` es el hop_dic del proveedor ya ordenado: salto 1
                      // la entidad señalada, último salto esta dirección. Cuando
                      // viene, los intermediarios dejan de ser un número y pasan
                      // a tener dirección — que es lo que hace falta para ir a
                      // mirarlos. Cuando no viene, se sigue diciendo cuántos son.
                      const camino: any[] | null = Array.isArray(it.camino) && it.camino.length ? it.camino : null;
                      // De esta dirección hacia la señalada: el camino viene en
                      // capas desde la señalada, así que los intermediarios se
                      // dan vuelta. Antes salía "esta dirección → capa 2 → capa
                      // 3 → señalada", con la capa que tocó a esta dirección al
                      // lado de la señalada. El conector es "—": el proveedor
                      // da el camino, no el sentido de la plata en cada tramo.
                      const medios = camino ? camino.slice(1, -1).flatMap((n: any) => n.direcciones ?? []).reverse() : [];
                      return (
                      <div key={i} style={{ padding: '11px 15px', borderTop: i ? `1px solid ${C.bdSoft}` : 'none' }}>
                        <p style={{ fontFamily: MONO, fontSize: 11.5, color: C.sub, margin: 0, wordBreak: 'break-all', lineHeight: 1.6 }}>
                          esta dirección
                          {medios.length
                            ? <>
                                {medios.slice(0, 4).map((m: string, k: number) => (
                                  <React.Fragment key={k}> {'—'} <span style={{ color: C.text }}>{enmascarar(m)}</span></React.Fragment>
                                ))}
                                {medios.length > 4 ? ` — +${medios.length - 4}` : ''}
                              </>
                            : (it.saltos && it.saltos > 1 ? ` — ${it.saltos - 1} ${it.saltos - 1 === 1 ? 'intermediario' : 'intermediarios'}` : '')}
                          {' — '}
                          <span style={{ color: ROJO.c, fontWeight: 700 }}>{it.entidad ?? 'entidad señalada'}</span>
                        </p>
                        {camino && camino[0]?.direcciones?.length ? (
                          <p style={{ fontFamily: MONO, fontSize: 10.5, color: C.sub, margin: '4px 0 0', wordBreak: 'break-all' }}>
                            en {enmascarar(camino[0].direcciones[0])}
                            {camino[0].direcciones.length > 1 ? ` y ${camino[0].direcciones.length - 1} más` : ''}
                          </p>
                        ) : null}
                        <p style={{ fontSize: 12, color: C.text, margin: '5px 0 0' }}>
                          {it.tipoEs ?? 'tipo no informado'}
                          {it.saltos != null ? ` · ${it.saltos} ${it.saltos === 1 ? 'salto' : 'saltos'}` : ''}
                          {it.volumen != null ? ` · ${Number(it.volumen).toLocaleString('es-CO', { maximumFractionDigits: 2 })} de volumen vinculado` : ''}
                          {it.pct != null ? ` · ${it.pct} % de su volumen` : ''}
                          {it.exposicion === 'direct' ? ' · exposición directa' : ''}
                        </p>
                      </div>
                      );
                    })}
                    <p style={{ fontSize: 11.5, color: C.sub, margin: 0, padding: '11px 15px', borderTop: `1px solid ${C.bdSoft}`, lineHeight: 1.55 }}>
                      El camino va de esta dirección a la entidad señalada, capa por capa. El proveedor
                      no informa en qué sentido se movió la plata en cada tramo: para saber si esta
                      dirección recibió o envió, usá «Rastrear intermediarios».
                      Una ruta contaminada no significa que el titular haya hecho algo: puede venir de
                      operaciones ajenas. Pero sí es lo que suele llevar a que un exchange congele fondos.
                    </p>
                  </div>
                ) : senalada ? (
                  // Señalada pero sin rutas: NO se dice "sin rutas" a secas. Se
                  // explica por qué no las hay, que es lo que evita leerlo como
                  // un atenuante del señalamiento.
                  <div style={{ marginBottom: 14, border: `1px solid ${C.bdSoft}`, borderRadius: 12, padding: '12px 15px' }}>
                    <p style={{ fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.6 }}>
                      El proveedor no reportó rutas hacia terceros señalados. En una dirección que ya
                      está señalada ella misma, eso es habitual y <b style={{ color: C.text }}>no la
                      hace menos riesgosa</b>: el hallazgo es sobre ella, no sobre su entorno.
                    </p>
                  </div>
                ) : (
                  <div style={{ marginBottom: 14, border: `1px solid ${C.bdSoft}`, borderRadius: 12, padding: '12px 15px' }}>
                    <p style={{ fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.6 }}>
                      <b style={{ color: C.text, fontWeight: 700 }}>Sin señalamientos ni rutas hacia entidades señaladas</b> en
                      la información disponible. No es una garantía: puede aparecer después.
                    </p>
                  </div>
                )}
              </>
            );
          })()}

          {/* ── RUTAS: acá aparecen los intermediarios con nombre y apellido ──
              Dos fuentes, y la diferencia se dice en pantalla porque cambia
              cuánto vale cada fila:

                · `proveedor` — el camino que manda MistTrack con el puntaje
                  (hop_dic). Es el camino COMPLETO, salto por salto. No tiene
                  presupuesto ni tope.

                · `rastreo` — el que recorremos nosotros pidiendo las
                  contrapartes de cada contraparte. Llega hasta donde alcanza el
                  presupuesto, y eso se dice.

              Lo que el proveedor NO manda es el sentido del flujo. En el
              rastreo sale de la investigación de cada tramo (la analizada y
              cada intermediario dicen a quién le mandaron y de quién
              recibieron), y la ruta solo es "recibió" o "envió" si TODOS los
              tramos van para ese lado (ver rastrearDesde en la función kyt).
              En el camino del proveedor solo se conoce el tramo que toca a
              esta dirección. Lo que no se sabe se dice — nunca se supone uno,
              porque "le envió a una dirección señalada" y "recibió de una" no
              son la misma frase para nadie. */}
          {rutas && (
            <div style={{ marginBottom: 14, border: `1px solid ${C.bdHard}`, borderRadius: 12, overflow: 'hidden' }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: 0, padding: '11px 15px', borderBottom: `1px solid ${C.bdSoft}` }}>
                RUTAS
                {rutas.delProveedor > 0 ? ` · ${rutas.delProveedor} del proveedor` : ''}
                {rutas.rastreadas > 0 ? ` · ${rutas.rastreadas} rastreadas` : ''}
                {rutas.contrapartesRevisadas > 0 ? ` · ${rutas.expandidos} de ${rutas.contrapartesRevisadas} contrapartes expandidas` : ''}
              </p>

              {/* Lo primero que se lee: si esta dirección recibió de una señalada
                  o le envió. Se cuenta con el sentido de TODOS los tramos: antes
                  bastaba que un intermediario le hubiera mandado 0,01 para que
                  dijera "Recibiste de 25 direcciones contaminadas", aunque ese
                  intermediario les hubiera MANDADO a ellas. Se habla de "esta
                  dirección" y no de "vos": la que se consulta casi nunca es la
                  del cliente (es la de un proveedor, un cliente suyo, un
                  exchange). */}
              {(() => {
                if (!rutas.rutas.length) return null;
                const R = rutas.rutas.map((r: any) => ({ r, f: flujoRuta(r), ...caminoDe(r, rutas.address) }));
                const uniq = (xs: any[]) => new Set(xs.filter(Boolean).map((x: any) => String(x).toLowerCase())).size;
                const con = (fs: string[], directa: boolean) => R.filter((x: any) => fs.includes(x.f) && (x.nodos.length === 2) === directa);
                const entD = con(['entrante', 'ambos'], true), entI = con(['entrante', 'ambos'], false);
                const salD = con(['saliente', 'ambos'], true), salI = con(['saliente', 'ambos'], false);
                const cruz = R.filter((x: any) => x.f === 'cruzado');
                const sinS = R.filter((x: any) => !x.f);
                const nS = (xs: any[]) => uniq(xs.map((x: any) => x.r.contaminante));
                const nI = (xs: any[]) => uniq(xs.map((x: any) => x.nodos[1]));
                const sen = (n: number) => `${n} ${n === 1 ? 'dirección señalada' : 'direcciones señaladas'}`;
                const int = (n: number) => `${n} ${n === 1 ? 'intermediario' : 'intermediarios'}`;
                const Rojo: React.FC<{ children: React.ReactNode }> = ({ children }) => <b style={{ color: ROJO.c, fontWeight: 800 }}>{children}</b>;
                return (
                  <div style={{ padding: '12px 15px', borderBottom: `1px solid ${C.bdSoft}`, background: 'rgba(255,255,255,0.02)' }}>
                    <p style={{ fontSize: 12.5, color: C.text, margin: 0, lineHeight: 1.65 }}>
                      {entD.length > 0 && <><Rojo>Esta dirección recibió</Rojo> directamente de {sen(nS(entD))}. </>}
                      {entI.length > 0 && <><Rojo>Esta dirección recibió</Rojo> de {int(nI(entI))} que a su vez {nI(entI) === 1 ? 'recibió' : 'recibieron'} de {sen(nS(entI))}. </>}
                      {salD.length > 0 && <><Rojo>Esta dirección le envió</Rojo> directamente a {sen(nS(salD))}. </>}
                      {salI.length > 0 && <><Rojo>Esta dirección le envió</Rojo> a {int(nI(salI))} que a su vez le {nI(salI) === 1 ? 'envió' : 'enviaron'} a {sen(nS(salI))}. </>}
                      {cruz.length > 0 && <><b style={{ fontWeight: 800 }}>{sen(nS(cruz))}</b> solo {nS(cruz) === 1 ? 'comparte' : 'comparten'} intermediario con esta dirección: la plata no pasa entre {nS(cruz) === 1 ? 'ella' : 'ellas'} y esta dirección por ese camino. </>}
                      {sinS.length > 0 && <>{sinS.length} {sinS.length === 1 ? 'ruta queda' : 'rutas quedan'} sin sentido confirmado: sabemos que el camino existe, no si la plata entró o salió por él.</>}
                    </p>
                    <p style={{ fontSize: 11, color: C.sub, margin: '6px 0 0', lineHeight: 1.55 }}>
                      Flechas: ← la plata fue hacia esta dirección · → salió de ella · ⇄ en los dos sentidos · — sin dato.
                      No se comparan fechas: un camino compatible no prueba que sea la misma plata.
                    </p>
                  </div>
                );
              })()}

              {rutas.rutas.length === 0 ? (
                <p style={{ fontSize: 12.5, color: C.sub, margin: 0, padding: '13px 15px', lineHeight: 1.6 }}>
                  No se encontraron rutas hacia entidades señaladas.
                  {!rutas.completo && ' Quedaron contrapartes sin revisar: esto no descarta que existan otras rutas.'}
                </p>
              ) : rutas.rutas.map((r: any, i: number) => {
                const { nodos, tramos } = caminoDe(r, rutas.address);
                // Caminos largos del proveedor: los seis primeros nodos y la
                // señalada; lo del medio no tiene sentido conocido igual.
                const largo = nodos.length > 7;
                const vis = largo ? nodos.slice(0, 6) : nodos.slice(0, -1);
                const frase = fraseRuta(r, nodos, tramos);
                const conector = (t: string | null | undefined) => (
                  <span style={{ color: t ? C.text : C.sub, fontWeight: t ? 700 : 400, padding: '0 5px' }}>{FLECHA[t ?? ''] ?? '—'}</span>
                );
                return (
                  <div key={i} style={{ padding: '11px 15px', borderTop: i ? `1px solid ${C.bdSoft}` : 'none' }}>
                    <p style={{ fontFamily: MONO, fontSize: 11, color: C.sub, margin: 0, wordBreak: 'break-all', lineHeight: 1.6 }}>
                      {vis.map((nd: string, k: number) => (
                        <React.Fragment key={k}>
                          {k > 0 && conector(tramos[k - 1])}
                          <span style={{ color: k === 0 ? C.sub : C.text }}>{k === 0 ? 'esta dirección' : enmascarar(nd)}</span>
                        </React.Fragment>
                      ))}
                      {largo ? <>{conector(null)}<span style={{ color: C.sub }}>+{nodos.length - 7}</span>{conector(null)}</> : conector(tramos[nodos.length - 2])}
                      <span style={{ color: ROJO.c, fontWeight: 700 }}>{enmascarar(nodos[nodos.length - 1])}</span>
                    </p>
                    <p style={{ fontSize: 12, color: C.text, margin: '5px 0 0' }}>
                      {r.etiquetaContaminante ?? r.tipoEs ?? 'contraparte señalada'}
                      {r.saltos != null ? ` · ${r.saltos} ${r.saltos === 1 ? 'salto' : 'saltos'}` : ''}
                      {r.monto != null
                        ? r.fuente === 'proveedor'
                          ? ` · ${Number(r.monto).toLocaleString('es-CO', { maximumFractionDigits: 2 })} de volumen vinculado`
                          : ` · ${Number(r.monto).toLocaleString('es-CO', { maximumFractionDigits: 6 })} en el tramo con esta dirección`
                        : ''}
                    </p>
                    {frase && (
                      <p style={{ fontSize: 11.5, color: flujoRuta(r) === 'cruzado' ? C.sub : C.text, margin: '4px 0 0', lineHeight: 1.55 }}>
                        {frase}
                      </p>
                    )}
                    {/* Los dos avisos que no se pueden callar. */}
                    {!tramos[0] && (
                      <p style={{ fontSize: 11, color: C.sub, margin: '4px 0 0', lineHeight: 1.55 }}>
                        Sentido no confirmado: esa contraparte no apareció entre las revisadas, así que
                        no sabemos si la plata salió o entró por acá.
                      </p>
                    )}
                    {r.fuente === 'proveedor' && r.terminaEnLaDireccion === false && (
                      <p style={{ fontSize: 11, color: C.sub, margin: '4px 0 0', lineHeight: 1.55 }}>
                        El camino que devolvió el proveedor no termina en esta dirección. Se muestra tal
                        cual llegó, sin atribuírselo.
                      </p>
                    )}
                  </div>
                );
              })}

              {rutas.sinSentidoDeFlujo && (
                <p style={{ fontSize: 11.5, color: C.sub, margin: 0, padding: '11px 15px', borderTop: `1px solid ${C.bdSoft}`, lineHeight: 1.55 }}>
                  No pudimos obtener las contrapartes de esta dirección, así que ninguna ruta tiene
                  sentido de flujo confirmado. El camino sí es el que reportó el proveedor.
                </p>
              )}
              {!rutas.completo && rutas.rutas.length > 0 && (
                <p style={{ fontSize: 11.5, color: C.sub, margin: 0, padding: '11px 15px', borderTop: `1px solid ${C.bdSoft}`, lineHeight: 1.55 }}>
                  Quedaron contrapartes sin expandir. Esta lista es lo que hay, no todo lo que puede haber.
                </p>
              )}
            </div>
          )}

          {res.proveedor !== 'sarblock' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {/* EL POR QUÉ, con la estructura real del proveedor.
                `detail_list` es la descripción del riesgo en texto y
                `hacking_event` el incidente asociado; antes se leía risk_detail
                buscando label/name —claves que esa lista no tiene— así que con
                un 85/100 en pantalla la tarjeta decía que no había hallazgos.
                Un puntaje alto sin el por qué es inservible: es exactamente lo
                que hay que poder explicar después. */}
            <Mini label="POR QUÉ">
              {(() => {
                const motivos = textos(res.detalle);
                if (res.hackingEvent) motivos.unshift(`Incidente: ${res.hackingEvent}`);
                if (motivos.length) return motivos.slice(0, 8).join(' · ');
                if (esBajo(res.categoria)) return 'Sin señalamientos de sanciones, mixers ni mercados ilícitos.';
                return res.nivel
                  ? <>Clasificada como <b style={{ fontWeight: 700 }}>{res.nivel}</b> por el proveedor, sin desglose de motivos.</>
                  : <span style={{ color: C.sub }}>El proveedor no detalló los hallazgos.</span>;
              })()}
            </Mini>
            <Mini label="EXPOSICIÓN">
              {res.exposicion
                ? <>
                    {res.exposicion.pctIndirecto != null
                      ? `${res.exposicion.pctIndirecto} % del volumen es exposición indirecta`
                      : `${res.exposicion.indirectas} ${res.exposicion.indirectas === 1 ? 'vínculo indirecto' : 'vínculos indirectos'}`}
                    {res.exposicion.directas > 0
                      ? ` · ${res.exposicion.directas} ${res.exposicion.directas === 1 ? 'directa' : 'directas'}`
                      : ''}
                    {res.exposicion.saltoMinimo != null && res.exposicion.saltoMinimo < 99
                      ? ` · a ${res.exposicion.saltoMinimo} ${res.exposicion.saltoMinimo === 1 ? 'salto' : 'saltos'}`
                      : ''}
                  </>
                : <span style={{ color: C.sub }}>El proveedor no devolvió vínculos con entidades de riesgo.</span>}
            </Mini>
            <Mini label="ACTIVIDAD">
              {res.actividad
                ? [
                    // Las fechas del proveedor vienen en segundos (decía "desde 1970").
                    fechaProveedor(res.actividad.primera) ? `Activa desde ${new Date(fechaProveedor(res.actividad.primera)!).getFullYear()}` : null,
                    res.cadena?.transacciones != null
                      ? `${Number(res.cadena.transacciones).toLocaleString('es-CO')} transacciones`
                      : res.actividad.txs != null ? `${Number(res.actividad.txs).toLocaleString('es-CO')} transacciones en ${res.coin}` : null,
                    fechaProveedor(res.actividad.ultima) ? `último mov. ${hace(fechaProveedor(res.actividad.ultima))}` : null,
                  ].filter(Boolean).join(' · ')
                : <span style={{ color: C.sub }}>El proveedor no devolvió la actividad de la dirección.</span>}
            </Mini>
          </div>}

          {/* ── El detalle entidad por entidad ──
              Esto es lo que de verdad explica un puntaje alto: CON QUIÉN está
              vinculada, de qué tipo, si es directa o a través de intermediarios,
              a cuántos saltos y por cuánto volumen. Va como filas y no como
              chips porque son cinco datos por vínculo, no una etiqueta. */}
          {Array.isArray(res.exposicion?.items) && res.exposicion.items.length > 0 && (
            <div style={{ marginTop: 12, border: `1px solid ${C.bdSoft}`, borderRadius: 11, overflow: 'hidden' }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: 0, padding: '11px 15px', borderBottom: `1px solid ${C.bdSoft}` }}>
                VÍNCULOS DETECTADOS
              </p>
              {res.exposicion.items.map((it: any, i: number) => (
                <div key={i} className="flex items-center justify-between flex-wrap"
                  style={{ gap: 10, padding: '11px 15px', borderTop: i ? `1px solid ${C.bdSoft}` : 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{it.entidad ?? 'Entidad sin nombre'}</p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '3px 0 0' }}>
                      {it.tipoEs ?? 'tipo no informado'}
                      {it.exposicion ? ` · exposición ${it.exposicion === 'direct' ? 'directa' : 'indirecta'}` : ''}
                      {it.saltos != null ? ` · ${it.saltos} ${it.saltos === 1 ? 'salto' : 'saltos'}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center" style={{ gap: 10, flexShrink: 0 }}>
                    {it.volumen != null && (
                      <span style={{ fontFamily: MONO, fontSize: 12, color: C.sub }}>
                        {Number(it.volumen).toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                      </span>
                    )}
                    <Pill
                      texto={it.exposicion === 'direct' ? 'DIRECTA' : 'INDIRECTA'}
                      cat={it.exposicion === 'direct' ? 'alto' : 'medio'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Contrapartes de la dirección (address_counterparty) ──
              Lo que el reporte del proveedor llama "Address Counterparties":
              con qué entidades opera y qué parte de su volumen es cada una.
              Antes solo salía en el Reporte AML; la consulta tiene que decir
              lo mismo que el documento del proveedor. */}
          {Array.isArray(res.contrapartes?.items) && res.contrapartes.items.length > 0 ? (
            <div style={{ marginTop: 12, border: `1px solid ${C.bdSoft}`, borderRadius: 11, overflow: 'hidden' }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: 0, padding: '11px 15px', borderBottom: `1px solid ${C.bdSoft}` }}>
                CONTRAPARTES DE LA DIRECCIÓN
              </p>
              {res.contrapartes.items.slice(0, 10).map((x: any, i: number) => (
                <div key={i} className="flex items-center justify-between" style={{ gap: 10, padding: '9px 15px', borderTop: i ? `1px solid ${C.bdSoft}` : 'none' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: C.sub, fontWeight: 600, marginRight: 8 }}>{i + 1}</span>{x.nombre ?? 'Sin identificar'}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: C.sub, flexShrink: 0 }}>
                    {x.montoUsd != null ? `USD ${Number(x.montoUsd).toLocaleString('es-CO', { maximumFractionDigits: 3 })}` : '—'}
                    {x.pct != null ? ` · ${x.pct} %` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : res.contrapartes?.noSoportada ? (
            <p style={{ fontSize: 11.5, color: C.sub, margin: '12px 0 0', lineHeight: 1.55 }}>
              Contrapartes: el proveedor no las analiza para este tipo de dirección (billetera caliente de un servicio).
            </p>
          ) : null}

          {/* Constancia: el reporte del proveedor quedó archivado (con su
              huella) y el proveedor registró esta consulta. Es lo que permite
              mostrar, después, que lo que dijimos es lo que dijo él. */}
          {res.constancia && (
            <p style={{ fontSize: 11.5, color: C.sub, margin: '12px 0 0', lineHeight: 1.6 }}>
              <b style={{ color: C.text, fontWeight: 700 }}>Constancia:</b>{' '}
              {res.constancia.proveedor === 'sarblock' ? 'respuesta del análisis del proveedor archivada el' : 'reporte del proveedor archivado el'}{' '}
              {new Date(res.constancia.archivadoAt).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {' · '}huella SHA-256 <span style={{ fontFamily: MONO }}>{String(res.constancia.sha256 ?? '').slice(0, 16)}…</span>
              {res.constancia.analisisId ? <> · análisis <span style={{ fontFamily: MONO }}>{res.constancia.analisisId}</span></> : null}
              {res.constancia.str?.at ? <> · registrado por el proveedor el {res.constancia.str.at} UTC{res.constancia.str.puntaje != null ? ` con puntaje ${res.constancia.str.puntaje}` : ''}{res.constancia.str.nivel ? ` (${nivelProveedorEs(res.constancia.str.nivel).toLowerCase()})` : ''}</> : null}
            </p>
          )}
          {/* Si una consulta pagada no dejó constancia, se dice por qué: el
              Reporte AML sin el original archivado respalda menos, y quien lo
              va a presentar tiene que saberlo antes. */}
          {!res.constancia && res.constanciaMotivo && (
            <p style={{ fontSize: 11.5, color: C.sub, margin: '12px 0 0', lineHeight: 1.6 }}>
              <b style={{ color: C.text, fontWeight: 700 }}>Constancia:</b> el reporte original del proveedor no
              quedó archivado en esta consulta ({res.constanciaMotivo.replace(/MistTrack/g, 'el proveedor')}).
            </p>
          )}

          {/* Plataformas y eventos (address_trace): el puntaje dice cuánto,
              esto dice con quién. */}
          {res.perfil && (Array.isArray(res.perfil.plataformas) || Array.isArray(res.perfil.eventos)) && (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              {!!res.perfil.eventos?.length && (
                <Mini label="EVENTOS ASOCIADOS">{res.perfil.eventos.slice(0, 6).join(' · ')}</Mini>
              )}
              {!!res.perfil.plataformas?.length && (
                <Mini label="PLATAFORMAS CON LAS QUE OPERÓ">{res.perfil.plataformas.slice(0, 8).join(' · ')}</Mini>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Direcciones monitoreadas ── */}
      <div className="flex items-baseline flex-wrap" style={{ gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Direcciones monitoreadas</h2>
        <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>
          Se re-consultan cada {meta.horas} h. Si el riesgo cambia, te avisamos por correo y acá.
        </p>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.bdSoft}`, borderRadius: 14, overflow: 'hidden' }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '14px 18px', borderBottom: `1px solid ${C.bdSoft}` }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {btnFiltro('todas', 'Todas')}
            {btnFiltro('cambio', 'Con cambio de riesgo')}
            {btnFiltro('orden', 'En orden')}
          </div>
          <span className="flex items-center" style={{ gap: 7, fontSize: 12, color: C.sub, whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
            Última ronda de monitoreo: {hora(meta.ultimaRonda)}
          </span>
        </div>

        {visibles.length === 0 ? (
          <div style={{ padding: '34px 18px', textAlign: 'center' }}>
            <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>
              {lista.length === 0 ? 'Todavía no monitoreás ninguna dirección' : 'Nada en este filtro'}
            </p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0' }}>
              {lista.length === 0
                ? 'Consultá una dirección y guardala para que la revisemos cada día.'
                : 'Cambiá el filtro para ver el resto.'}
            </p>
          </div>
        ) : visibles.map((f: Fila) => (
          <div key={f.id} className="flex items-center flex-wrap"
            style={{ gap: 14, padding: '15px 18px', borderBottom: `1px solid ${C.bdSoft}` }}>
            <Puntaje n={f.puntaje ?? null} cat={f.categoria} size={34} />
            <div style={{ minWidth: 170, flex: '1 1 210px' }}>
              <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{f.alias || enmascarar(f.address)}</span>
                <span className="inline-flex items-center" style={{ gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', color: C.sub, border: `1px solid ${C.bd}`, borderRadius: 999, padding: '2px 8px 2px 3px' }}>
                  <Insignia v={f.coin} size={14} /> {nombreRed(f.coin)}
                </span>
              </div>
              <p style={{ fontFamily: MONO, fontSize: 11.5, color: C.sub, margin: '4px 0 0' }}>
                {enmascarar(f.address)} · revisada {hora(f.revisadoAt)}
              </p>
            </div>
            <p style={{ flex: '1 1 240px', fontSize: 12.5, margin: 0, lineHeight: 1.55, color: f.subio ? C.text : C.sub }}>
              {f.subio
                ? `Subió de ${f.puntajeInicial ?? '–'} a ${f.puntaje ?? '–'}: ${f.motivo ?? 'cambió la clasificación'} ${hace(f.subioAt)}.${f.avisoEnviado ? ' Aviso enviado por correo.' : ''}`
                : 'Sin cambios desde que la guardaste.'}
            </p>
            <Pill texto={f.subio ? 'RIESGO SUBIÓ' : 'EN ORDEN'} cat={f.subio ? 'alto' : 'bajo'} />
            <button onClick={() => quitar(f.id)}
              className="transition-colors hover:text-[#F4F4F2]"
              style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.sub, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
              onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
              <EyeOff size={14} strokeWidth={1.5} /> Dejar de monitorear
            </button>
          </div>
        ))}

        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '13px 18px' }}>
          <span style={{ fontSize: 12, color: C.sub }}>
            {lista.length} de {meta.tope} direcciones monitoreadas · {conCambio.length} con cambio de riesgo
          </span>
          <button onClick={abrirHistorial}
            className="transition-colors hover:text-[#F4F4F2]"
            style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.sub, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onFocus={e => { e.currentTarget.style.boxShadow = ANILLO; }} onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
            <History size={14} strokeWidth={1.5} /> Ver historial de alertas
          </button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: C.sub, margin: '20px 0 0', maxWidth: 680, lineHeight: 1.6 }}>
        El resultado refleja la información disponible hoy sobre la dirección y puede cambiar. Una
        dirección sin hallazgos no es una garantía, y esta consulta no reemplaza tus propios controles.
      </p>

      {/* ── Modal del alias ── */}
      {aliasPara && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 80, background: 'rgba(4,5,5,0.72)', backdropFilter: 'blur(4px)', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 400, background: C.card, border: `1px solid ${C.bdHard}`, borderRadius: 16, padding: 24, fontFamily: FONT }}>
            <div className="flex items-start justify-between" style={{ gap: 12 }}>
              <div>
                <h3 style={{ fontSize: 16.5, fontWeight: 800, margin: 0 }}>Guardar y monitorear</h3>
                <p style={{ fontFamily: MONO, fontSize: 11.5, color: C.sub, margin: '5px 0 0' }}>{enmascarar(aliasPara.address)}</p>
              </div>
              <button onClick={() => setAliasPara(null)} style={{ color: C.sub, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '14px 0 10px', lineHeight: 1.6 }}>
              Ponele un nombre para reconocerla. La vamos a re-consultar cada {meta.horas} h y te
              avisamos si el riesgo cambia.
            </p>
            <input
              value={alias} onChange={e => setAlias(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && !guardando) guardar(); }}
              placeholder="Proveedor Shenzhen"
              style={{ width: '100%', fontFamily: FONT, fontSize: 14, color: C.text, background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.bd}`, borderRadius: 9, padding: '11px 13px', outline: 'none' }}
            />
            <button onClick={guardar} disabled={guardando}
              style={{ width: '100%', marginTop: 16, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, background: C.text, color: '#0A0A0A', border: 'none', borderRadius: 9, padding: '12px 0', cursor: guardando ? 'default' : 'pointer', opacity: guardando ? 0.5 : 1 }}>
              {guardando ? 'Guardando…' : 'Guardar y monitorear'}
            </button>
          </div>
        </div>
      )}

      {reporte && <KytReporte d={reporte} onClose={() => setReporte(null)} />}

      {/* ── Historial de alertas ── */}
      {verHistorial && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 80, background: 'rgba(4,5,5,0.72)', backdropFilter: 'blur(4px)', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 560, maxHeight: '80vh', overflow: 'auto', background: C.card, border: `1px solid ${C.bdHard}`, borderRadius: 16, padding: 24, fontFamily: FONT }}>
            <div className="flex items-start justify-between" style={{ gap: 12, marginBottom: 14 }}>
              <h3 style={{ fontSize: 16.5, fontWeight: 800, margin: 0 }}>Historial de alertas</h3>
              <button onClick={() => setVerHistorial(false)} style={{ color: C.sub, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><X size={18} /></button>
            </div>
            {alertas.length === 0 ? (
              <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>No hay alertas registradas. Aparecen acá cuando una dirección monitoreada cambia de banda de riesgo.</p>
            ) : alertas.map(a => (
              <div key={a.id} style={{ padding: '12px 0', borderTop: `1px solid ${C.bdSoft}` }}>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{a.alias || enmascarar(a.address)}</span>
                  <span style={{ fontSize: 11.5, color: C.sub }}>{hora(a.created_at)}</span>
                </div>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.55 }}>
                  {a.score_antes ?? '–'} → <span style={{ color: C.text, fontWeight: 700 }}>{a.score_despues ?? '–'}</span>
                  {a.motivo ? ` · ${a.motivo}` : ''}
                  {a.aviso_enviado ? ' · aviso enviado' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default KytSection;
