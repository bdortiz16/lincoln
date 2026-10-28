// ════════════════════════════════════════════════════════
// Reporte de verificación de antecedentes con marca Lincoin.
//
// Se arma desde la ficha guardada (raw_data.tusdatos.beneficiarios[doc])
// con el bloque `sarblock` que trae el catálogo completo de la consulta.
// Sarblock no entrega PDF: este reporte es nuestro, y por eso dice de dónde
// salen los datos (fuentes públicas consultadas a través de Sarblock) y no
// imita el documento de nadie.
//
// Cómo se genera: el reporte se dibuja en HTML (Archivo, paleta Lincoin
// sobre fondo claro), se pagina midiendo cada bloque para que ninguna fila
// quede partida entre dos hojas, y cada hoja A4 se captura y va a una
// página del PDF. Las librerías se cargan solo al descargar.
// ════════════════════════════════════════════════════════
import React, { useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';

// A4 a 96 dpi.
const ANCHO = 794, ALTO = 1123, MARGEN = 44;
const CABECERA_1 = 168, CABECERA_N = 56, PIE = 70;

// Paleta sobre fondo claro (CLAUDE.md): letras #15181A, verde #22A35C.
const T = {
  texto: '#15181A', sub: '#5F665F', tenue: '#8A918B', borde: 'rgba(21,24,26,0.10)', suave: '#F6F7F5',
  verde: '#22A35C', ambar: '#B7791F', rojo: '#C53030',
};

const ESTADO_FUENTE: Record<string, { t: string; c: string }> = {
  CLEAR: { t: 'Sin coincidencias', c: T.sub },
  MATCH: { t: 'Coincidencia', c: T.rojo },
  VERIFIED: { t: 'Verificada', c: T.verde },
  NOT_FOUND: { t: 'No registra', c: T.sub },
  UNAVAILABLE: { t: 'Sin respuesta', c: T.ambar },
  SKIPPED: { t: 'No aplica', c: T.tenue },
  NOT_EXECUTED: { t: 'No ejecutada', c: T.tenue },
  NOT_SCHEDULED: { t: 'Fuera del plan', c: T.tenue },
};
const ORDEN_CATEGORIAS = ['IDENTITY', 'SANCTIONS', 'DEBARMENT', 'PEP', 'REVIEW', 'COLOMBIA', 'VENEZUELA', 'ADVERSE_MEDIA', 'OTHER'];

function veredicto(f: any): { t: string; c: string; texto: string } {
  const bloquea = f.operable === false;
  if (f.nombreCoincide === false) return { t: 'BLOQUEADO · NOMBRE NO CORRESPONDE', c: T.rojo, texto: 'El nombre inscrito no corresponde al documento consultado.' };
  if (f.categoria === 'alto' || bloquea) return { t: bloquea ? 'BLOQUEADO · RIESGO ALTO' : 'RIESGO ALTO', c: T.rojo, texto: f.bloqueo || 'Coincidencia en una lista restrictiva.' };
  if (f.categoria === 'medio') return { t: 'RIESGO MEDIO · EN REVISIÓN', c: T.ambar, texto: f.bloqueo || 'Hallazgos que requieren revisión de cumplimiento.' };
  if (f.categoria === 'sin_validar') return { t: 'IDENTIDAD SIN VALIDAR', c: T.ambar, texto: 'No se pudo contrastar el documento contra la fuente oficial.' };
  if (f.categoria === 'bajo') return { t: 'RIESGO BAJO', c: T.verde, texto: 'Sin coincidencias restrictivas. Se puede operar.' };
  return { t: 'SIN HALLAZGOS', c: T.verde, texto: 'No se encontraron antecedentes en las fuentes consultadas.' };
}

const fecha = (d?: string, hora = true) => {
  if (!d) return '—';
  const t = new Date(d);
  return isNaN(t.getTime()) ? String(d) : t.toLocaleString('es-CO', hora ? { dateStyle: 'long', timeStyle: 'short' } : { dateStyle: 'long' });
};

const Wordmark: React.FC<{ tam: number }> = ({ tam }) => (
  <span style={{ fontFamily: 'Archivo, system-ui, sans-serif', fontWeight: 800, letterSpacing: tam > 20 ? '-0.9px' : '-0.5px', color: T.texto, fontSize: tam }}>
    Lincoin<span style={{ color: T.verde }}>.</span>
  </span>
);
const Rotulo: React.FC<{ t: string }> = ({ t }) => (
  <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '1.4px', color: T.sub, margin: '0 0 6px', textTransform: 'uppercase' }}>{t}</p>
);
const Fila: React.FC<{ l: string; v: React.ReactNode; c?: string }> = ({ l, v, c }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, padding: '7px 0', borderTop: `1px solid ${T.borde}` }}>
    <span style={{ fontSize: 11, color: T.sub, flexShrink: 0 }}>{l}</span>
    <span style={{ fontSize: 11, fontWeight: 600, color: c ?? T.texto, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
  </div>
);

// ── Los bloques del cuerpo, en orden. Cada uno es indivisible. ─────────
function bloques(f: any): { key: string; nodo: React.ReactNode; espacio?: number }[] {
  const sb = f.sarblock ?? {};
  const s = sb.summary ?? {};
  const id = sb.identity ?? {};
  const cat: any[] = Array.isArray(sb.catalog) ? sb.catalog : [];
  const v = veredicto(f);
  const out: { key: string; nodo: React.ReactNode; espacio?: number }[] = [];

  out.push({ key: 'veredicto', espacio: 16, nodo: (
    <div style={{ border: `1px solid ${T.borde}`, borderLeft: `3px solid ${v.c}`, borderRadius: 10, padding: '14px 16px', background: T.suave }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: v.c, margin: 0 }}>{v.t}</p>
      <p style={{ fontSize: 12.5, color: T.texto, margin: '5px 0 0', lineHeight: 1.5 }}>{v.texto}</p>
    </div>
  ) });

  const consultadas = cat.filter(e => e.consulted !== false && e.status !== 'SKIPPED' && e.status !== 'NOT_SCHEDULED').length;
  out.push({ key: 'resumen', espacio: 18, nodo: (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
      {[
        { n: consultadas, l: 'Fuentes consultadas' },
        { n: Number(s.matchedLists ?? 0), l: 'Coincidencias', c: Number(s.matchedLists ?? 0) > 0 ? T.rojo : undefined },
        { n: Number(s.unavailableLists ?? 0), l: 'Sin respuesta', c: Number(s.unavailableLists ?? 0) > 0 ? T.ambar : undefined },
        { n: s.hasPepResult ? 'Sí' : 'No', l: 'Persona expuesta (PEP)', c: s.hasPepResult ? T.ambar : undefined },
      ].map(x => (
        <div key={x.l} style={{ border: `1px solid ${T.borde}`, borderRadius: 10, padding: '11px 12px' }}>
          <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', margin: 0, color: x.c ?? T.texto }}>{x.n}</p>
          <p style={{ fontSize: 10, color: T.sub, margin: '2px 0 0' }}>{x.l}</p>
        </div>
      ))}
    </div>
  ) });

  out.push({ key: 'identidad', espacio: 18, nodo: (
    <div>
      <Rotulo t="Identidad" />
      <Fila l="Nombre inscrito" v={id.declaredName || f.nombreInscrito || '—'} />
      <Fila l="Nombre según la fuente oficial" v={id.verifiedName || '—'} c={f.nombreCoincide === false ? T.rojo : undefined} />
      <Fila l="Documento" v={`${f.tipoDocumento ?? ''} ${f.documento ?? ''}`.trim()} />
      <Fila l="Documento validado" v={id.validated === true ? 'Sí' : id.validated === false ? 'No' : '—'} c={id.validated === false ? T.ambar : undefined} />
      <Fila l="Similitud del nombre" v={typeof id.nameSimilarity === 'number' ? `${Math.round(id.nameSimilarity * 100)} %` : '—'} />
      <Fila l="Posible suplantación" v={id.spoofSuspected ? 'Sí' : 'No'} c={id.spoofSuspected ? T.rojo : undefined} />
    </div>
  ) });

  // Por qué: cada regla de la matriz de Lincoin que se activó, lo alto
  // primero. Es lo que explica un bloqueo o una revisión.
  const motivos: any[] = Array.isArray(f.hallazgos) ? f.hallazgos : [];
  out.push({ key: 'porque-titulo', espacio: 8, nodo: <Rotulo t="Por qué este veredicto" /> });
  if (motivos.length === 0) {
    out.push({ key: 'porque-vacio', espacio: 18, nodo: <p style={{ fontSize: 11.5, color: T.sub, margin: 0 }}>Ninguna regla de riesgo se activó con esta consulta.</p> });
  }
  motivos.forEach((m, i) => {
    out.push({ key: `porque-${i}`, espacio: i === motivos.length - 1 ? 18 : 6, nodo: (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, marginTop: 1, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.5px', borderRadius: 999, padding: '2px 7px',
          border: `1px solid ${m.nivel === 'alto' ? 'rgba(197,48,48,0.4)' : 'rgba(183,121,31,0.4)'}`, color: m.nivel === 'alto' ? T.rojo : T.ambar }}>
          {m.nivel === 'alto' ? 'ALTO' : 'MEDIO'}
        </span>
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>
          <span style={{ color: T.texto }}>{m.texto}</span>
          <span style={{ color: T.tenue }}> · {m.fuente}</span>
        </div>
      </div>
    ) });
  });
  if (f.criterio) out.push({ key: 'criterio', espacio: 18, nodo: <p style={{ fontSize: 9.5, color: T.tenue, margin: 0 }}>Matriz de riesgo aplicada: {f.criterio}. Bloquea: listas restrictivas; proceso penal o de extinción de dominio como parte pasiva; antecedentes de Policía, Procuraduría o Contraloría; prensa adversa grave y confirmada. Revisión: procesos civiles, de familia o laborales como parte pasiva; PEP; prensa de menor gravedad.</p> });

  // Detalle: coincidencias y también menciones que no cuentan (p. ej.
  // procesos como demandante), que quien revisa tiene que poder leer.
  const conMenciones = cat.filter(e => e.matched === true || Number(e.matchCount ?? 0) > 0);
  out.push({ key: 'detalle-titulo', espacio: 8, nodo: <Rotulo t="Coincidencias y menciones" /> });
  if (conMenciones.length === 0) {
    out.push({ key: 'detalle-vacio', espacio: 18, nodo: <p style={{ fontSize: 11.5, color: T.sub, margin: 0 }}>Sin coincidencias ni menciones en las fuentes consultadas.</p> });
  }
  conMenciones.forEach((e, i) => {
    const hits: any[] = Array.isArray(e.hits) ? e.hits : [];
    out.push({ key: `det-${i}`, espacio: 10, nodo: (
      <div style={{ border: `1px solid ${T.borde}`, borderLeft: `3px solid ${e.matched ? (e.isRestrictive ? T.rojo : T.ambar) : T.tenue}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700 }}>{e.label}</span>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', color: e.matched ? (e.isRestrictive ? T.rojo : T.ambar) : T.sub }}>
            {e.matched ? (e.isRestrictive ? 'COINCIDENCIA RESTRICTIVA' : 'COINCIDENCIA') : 'MENCIÓN SIN COINCIDENCIA'}
          </span>
        </div>
        <p style={{ fontSize: 10, color: T.sub, margin: '2px 0 0' }}>{e.categoryLabel}{e.statusReason ? ` · ${e.statusReason}` : ''}</p>
        {hits.slice(0, 8).map((h, j) => (
          <div key={j} style={{ marginTop: 6, fontSize: 10.5, color: T.texto, lineHeight: 1.45 }}>
            <b>{h.matchedName || '—'}</b>
            {typeof h.score === 'number' && <span style={{ color: T.sub }}> · coincidencia {Math.round(h.score * 100)} %</span>}
            {h.matchedField && <span style={{ color: T.sub }}> · {h.matchedField}</span>}
            {h.judicial && (
              <div style={{ color: T.sub }}>
                {h.judicial.court} · radicado {h.judicial.processKey} · {h.judicial.branch} · parte {h.judicial.partySide}
                {h.judicial.startDate ? ` · desde ${h.judicial.startDate}` : ''}{h.judicial.lastActionDate ? ` · última actuación ${h.judicial.lastActionDate}` : ''}
              </div>
            )}
            {(h.severity || h.identityConfidence) && (
              <div style={{ color: T.sub }}>Gravedad {h.severity ?? '—'} · certeza de identidad {h.identityConfidence ?? '—'}{Array.isArray(h.categories) && h.categories.length ? ` · ${h.categories.join(', ')}` : ''}</div>
            )}
            {h.sourceUrl && <div style={{ color: T.sub, wordBreak: 'break-all' }}>{h.sourceUrl}</div>}
          </div>
        ))}
        {hits.length > 8 && <p style={{ fontSize: 10, color: T.sub, margin: '6px 0 0' }}>Y {hits.length - 8} mención(es) más.</p>}
      </div>
    ) });
  });

  // Todas las fuentes, por categoría. Una fila = un bloque.
  out.push({ key: 'fuentes-titulo', espacio: 8, nodo: <div style={{ marginTop: 10 }}><Rotulo t="Fuentes consultadas" /></div> });
  const grupos = new Map<string, any[]>();
  for (const e of cat) { const k = String(e.category ?? 'OTHER'); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(e); }
  const claves = [...grupos.keys()].sort((a, b) => (ORDEN_CATEGORIAS.indexOf(a) + 99) % 99 - (ORDEN_CATEGORIAS.indexOf(b) + 99) % 99);
  for (const k of claves) {
    const filas = grupos.get(k)!;
    out.push({ key: `g-${k}`, espacio: 0, nodo: (
      <div style={{ background: T.suave, borderRadius: 6, padding: '6px 10px', marginTop: 6, fontSize: 10, fontWeight: 700, color: T.texto }}>{filas[0].categoryLabel ?? k}</div>
    ) });
    filas.forEach((e, i) => {
      const st = ESTADO_FUENTE[String(e.status)] ?? { t: String(e.status), c: T.sub };
      out.push({ key: `f-${k}-${i}`, espacio: 0, nodo: (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 1.7fr', gap: 10, padding: '6px 10px', borderBottom: `1px solid ${T.borde}`, fontSize: 10.5, alignItems: 'baseline' }}>
          <span style={{ color: T.texto }}>{e.label}</span>
          <span style={{ color: st.c, fontWeight: 700 }}>{st.t}</span>
          <span style={{ color: T.sub }}>{e.statusReason ?? ''}</span>
        </div>
      ) });
    });
  }
  return out;
}

// ── Las hojas ───────────────────────────────────────────────────────────
const Hoja: React.FC<{ f: any; n: number; total: number; children: React.ReactNode }> = ({ f, n, total, children }) => {
  const sb = f.sarblock ?? {};
  const nombre = sb.identity?.verifiedName || f.nombreReal || f.nombreInscrito || 'Sin nombre';
  return (
    <div className="hoja-lincoin" style={{ width: ANCHO, height: ALTO, boxSizing: 'border-box', padding: MARGEN, background: '#FFFFFF', color: T.texto, fontFamily: 'Archivo, system-ui, sans-serif', position: 'relative', overflow: 'hidden' }}>
      {n === 1 ? (
        <div style={{ height: CABECERA_1 - MARGEN, borderBottom: `1px solid ${T.borde}`, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Wordmark tam={26} />
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '1.4px', color: T.sub, margin: 0 }}>REPORTE DE VERIFICACIÓN DE ANTECEDENTES</p>
              <p style={{ fontSize: 10.5, color: T.sub, margin: '4px 0 0' }}>Consulta del {fecha(sb.completedAt ?? f.at)}</p>
            </div>
          </div>
          <p style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', margin: '18px 0 0' }}>{nombre}</p>
          <p style={{ fontSize: 11, color: T.sub, margin: '3px 0 0' }}>{`${f.tipoDocumento ?? ''} ${f.documento ?? ''}`.trim()} · ID de consulta {sb.checkId ?? f.jobid ?? '—'}</p>
          {f.empresa?.nombre && (
            <p style={{ fontSize: 10.5, color: T.sub, margin: '6px 0 0' }}>
              Consultado por <b style={{ color: T.texto }}>{f.empresa.nombre}</b>{f.empresa.nit ? ` · NIT ${f.empresa.nit}` : ''}{f.consultadoPor ? ` · ${f.consultadoPor}` : ''}{f.consultadoAt ? ` · ${fecha(f.consultadoAt)}` : ''}
            </p>
          )}
        </div>
      ) : (
        <div style={{ height: CABECERA_N - MARGEN + 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${T.borde}`, marginBottom: 14 }}>
          <Wordmark tam={16} />
          <span style={{ fontSize: 10, color: T.sub }}>{nombre} · {`${f.tipoDocumento ?? ''} ${f.documento ?? ''}`.trim()}</span>
        </div>
      )}
      <div>{children}</div>
      <div style={{ position: 'absolute', left: MARGEN, right: MARGEN, bottom: 26, borderTop: `1px solid ${T.borde}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 20 }}>
        <p style={{ fontSize: 8.5, color: T.tenue, margin: 0, lineHeight: 1.45, maxWidth: 560 }}>
          Resumen de la consulta de listas internacionales y fuentes públicas realizada a través de Sarblock. La calidad de cada dato es atribuible a su fuente.
          Documento de uso interno de cumplimiento{f.empresa?.nombre ? ` de ${f.empresa.nombre}` : ''}; contiene datos personales protegidos por la Ley 1581 de 2012.
          {sb.catalogVersion ? ` Catálogo de fuentes ${sb.catalogVersion}.` : ''}
        </p>
        <p style={{ fontSize: 9, color: T.sub, margin: 0, whiteSpace: 'nowrap' }}>Página {n} de {total}</p>
      </div>
    </div>
  );
};

const Reporte: React.FC<{ f: any; listo: (hojas: HTMLElement[]) => void }> = ({ f, listo }) => {
  const lista = bloques(f);
  const medir = useRef<HTMLDivElement>(null);
  const hojasRef = useRef<HTMLDivElement>(null);
  const [paginas, setPaginas] = useState<number[][] | null>(null);

  // Fase 1: medir cada bloque y repartirlos en hojas sin partir ninguno.
  useLayoutEffect(() => {
    if (paginas || !medir.current) return;
    const alturas = [...medir.current.children].map(el => (el as HTMLElement).offsetHeight);
    const util = (n: number) => ALTO - MARGEN * 2 - (n === 1 ? CABECERA_1 - MARGEN + 14 : CABECERA_N - MARGEN + 44) - PIE;
    const out: number[][] = [[]];
    let usado = 0;
    alturas.forEach((h, i) => {
      const alto = h + (lista[i].espacio ?? 0);
      // Un rótulo de grupo no se queda solo al final de una hoja.
      const esRotulo = String(lista[i].key).startsWith('g-') || String(lista[i].key).endsWith('-titulo');
      const siguiente = esRotulo ? (alturas[i + 1] ?? 0) : 0;
      if (usado + alto + siguiente > util(out.length) && out[out.length - 1].length) { out.push([]); usado = 0; }
      out[out.length - 1].push(i); usado += alto;
    });
    setPaginas(out);
  }, [paginas]);

  // Fase 2: las hojas están dibujadas; se entregan para capturarlas.
  useLayoutEffect(() => {
    if (paginas && hojasRef.current) listo([...hojasRef.current.querySelectorAll<HTMLElement>('.hoja-lincoin')]);
  }, [paginas]);

  if (!paginas) {
    return (
      <div ref={medir} style={{ width: ANCHO - MARGEN * 2, fontFamily: 'Archivo, system-ui, sans-serif' }}>
        {lista.map(b => <div key={b.key}>{b.nodo}</div>)}
      </div>
    );
  }
  return (
    <div ref={hojasRef}>
      {paginas.map((idx, p) => (
        <Hoja key={p} f={f} n={p + 1} total={paginas.length}>
          {idx.map(i => <div key={lista[i].key} style={{ marginBottom: lista[i].espacio ?? 0 }}>{lista[i].nodo}</div>)}
        </Hoja>
      ))}
    </div>
  );
};

// Archivo viene de Google Fonts y la captura no puede leer una hoja de otro
// dominio: se baja el CSS, cada archivo se vuelve data: y va a la captura.
const ARCHIVO_CSS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap';
let fuente: Promise<string> | null = null;
const cssDeLaFuente = () => {
  fuente ??= (async () => {
    const css = await (await fetch(ARCHIVO_CSS)).text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
    const datos = await Promise.all(urls.map(async u => {
      const b = await (await fetch(u)).blob();
      return new Promise<string>((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = mal; fr.readAsDataURL(b); });
    }));
    return urls.reduce((acc, u, i) => acc.split(u).join(datos[i]), css);
  })().catch(e => { fuente = null; throw e; });
  return fuente;
};

// Genera y descarga el PDF. Devuelve el número de páginas.
export async function descargarReporteLincoin(f: any): Promise<number> {
  if (!f?.sarblock?.catalog) throw new Error('Esta ficha no tiene el detalle de Sarblock para armar el reporte.');
  const [{ toJpeg }, { jsPDF }, fontEmbedCSS] = await Promise.all([import('html-to-image'), import('jspdf'), cssDeLaFuente()]);
  const fuera = document.createElement('div');
  Object.assign(fuera.style, { position: 'fixed', left: '-20000px', top: '0', pointerEvents: 'none' });
  document.body.appendChild(fuera);
  const raiz = ReactDOM.createRoot(fuera);
  try {
    const hojas = await new Promise<HTMLElement[]>(ok => raiz.render(<Reporte f={f} listo={ok} />));
    await document.fonts.ready;
    const pdf = new jsPDF({ unit: 'px', format: [ANCHO, ALTO], orientation: 'portrait', hotfixes: ['px_scaling'], compress: true });
    for (let i = 0; i < hojas.length; i++) {
      const img = await toJpeg(hojas[i], { quality: 0.92, pixelRatio: 2, backgroundColor: '#FFFFFF', width: ANCHO, height: ALTO, fontEmbedCSS });
      if (i > 0) pdf.addPage([ANCHO, ALTO], 'portrait');
      pdf.addImage(img, 'JPEG', 0, 0, ANCHO, ALTO);
    }
    const dia = new Date(f.sarblock.completedAt ?? f.at ?? Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
    pdf.save(`lincoin-verificacion-${String(f.documento ?? '').replace(/\D/g, '')}-${dia}.pdf`);
    return hojas.length;
  } finally {
    raiz.unmount();
    fuera.remove();
  }
}
