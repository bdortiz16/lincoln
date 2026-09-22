// ══════════════════════════════════════════════════════════════════
//  Reporte de posibles contaminadores — marca Lincoin.
//
//  Sigue la estructura pedida: cabecera con la dirección, dos filas de
//  indicadores, lectura rápida de exposición, contactos directos, rutas
//  indirectas agrupadas, ranking de posibles contaminadores y nota
//  metodológica.
//
//  Se imprime con el diálogo del navegador en vez de generarse con una
//  librería: el texto queda SELECCIONABLE y el documento es vectorial, que es
//  lo que hace falta si se adjunta a un expediente. Además no entra una
//  dependencia nueva ni nada por CDN, que acá está descartado.
//
//  EN PAPEL VA EN CLARO aunque la app sea oscura: un documento impreso en negro
//  gasta tóner, se ve sucio y es ilegible en fotocopia.
//
//  NO SE INVENTA NINGÚN NÚMERO. Donde el proveedor no devolvió el dato va
//  "sin dato" y se explica por qué. Un "0.00" que en realidad significa "no sé"
//  es lo peor que puede decir un reporte de cumplimiento: alguien opera con eso.
// ══════════════════════════════════════════════════════════════════
import React from 'react';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const T = {
  tinta: '#15181A',
  suave: '#5C625E',
  tenue: '#9B9F9B',
  linea: 'rgba(21,24,26,0.14)',
  fondo: '#F4F5F4',
  azul: '#1F3A5F',
  verde: '#22A35C',
  rojo: '#C0392B',
  ambar: '#B7791F',
};

const banda = (cat?: string) =>
  cat === 'alto' ? { c: '#FFFFFF', bg: T.rojo, t: 'RIESGO ALTO' }
  : cat === 'medio' ? { c: '#FFFFFF', bg: T.ambar, t: 'RIESGO MEDIO' }
  : cat === 'bajo' ? { c: '#FFFFFF', bg: T.verde, t: 'RIESGO BAJO' }
  : { c: T.tinta, bg: T.fondo, t: 'SIN CLASIFICAR' };

const n = (v: any, dec = 2) =>
  v == null || !Number.isFinite(Number(v)) ? null
    : Number(v).toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const corta = (a?: string | null) => {
  const s = String(a ?? '');
  return s.length > 16 ? `${s.slice(0, 7)}…${s.slice(-5)}` : (s || '—');
};

const fecha = (t?: string | null, conHora = true) => {
  if (!t) return '—';
  try {
    const d = new Date(t);
    return conHora
      ? d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
};

const textos = (arr: any, max = 40): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((x: any) => typeof x === 'string' ? x : (x?.label ?? x?.name ?? x?.type ?? ''))
    .map((s: any) => String(s).trim()).filter(Boolean).slice(0, max);

const th: React.CSSProperties = {
  fontSize: 8.5, fontWeight: 700, color: '#FFFFFF', background: T.azul,
  padding: '7px 8px', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  fontSize: 9.5, color: T.tinta, padding: '6px 8px',
  borderBottom: `1px solid ${T.linea}`, verticalAlign: 'top',
};
const H: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, margin: '22px 0 8px', color: T.tinta };

const Ind: React.FC<{ rot: string; children: React.ReactNode }> = ({ rot, children }) => (
  <div style={{ flex: '1 1 118px', borderRight: `1px solid ${T.linea}` }}>
    <div style={{ background: T.fondo, padding: '5px 8px', borderBottom: `1px solid ${T.linea}` }}>
      <p style={{ fontSize: 8, color: T.suave, margin: 0, fontWeight: 600 }}>{rot}</p>
    </div>
    <div style={{ padding: '10px 8px', textAlign: 'center' }}>{children}</div>
  </div>
);

const Cifra: React.FC<{ v: string | null; u?: string }> = ({ v, u }) => (
  <p style={{ fontSize: v && v.length > 12 ? 11 : 14, fontWeight: 800, margin: 0, lineHeight: 1.25, wordBreak: 'break-word' }}>
    {v ?? <span style={{ color: T.tenue, fontWeight: 400, fontSize: 10.5 }}>sin dato</span>}
    {v && u ? <><br /><span style={{ fontSize: 9.5, fontWeight: 700, color: T.suave }}>{u}</span></> : null}
  </p>
);

const Vacio: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10, color: T.tenue, margin: 0, fontStyle: 'italic', lineHeight: 1.6 }}>{children}</p>
);

export const KytReporte: React.FC<{ d: any; onClose: () => void }> = ({ d, onClose }) => {
  const b = banda(d.categoria);
  const ac = d.actividad;
  const ex = d.exposicion;
  const tr = d.rutas;

  const motivos = Array.from(new Set([...textos(d.detalle), ...textos(d.hallazgos)]));
  if (d.hackingEvent) motivos.unshift(`Incidente: ${d.hackingEvent}`);
  const senalada = motivos.length > 0 || d.categoria === 'alto' || d.categoria === 'medio';

  const directos: any[] = (tr?.rutas ?? []).filter((r: any) => r.saltos === 1);
  const indirectos: any[] = (tr?.rutas ?? []).filter((r: any) => r.saltos > 1);
  const ranking: any[] = tr?.ranking ?? [];

  const entrantes = directos.filter(r => r.flujo === 'entrada');
  const salientes = directos.filter(r => r.flujo === 'salida');
  const sum = (a: any[]) => a.reduce((t, x) => t + Number(x.monto ?? 0), 0);

  const porTipo = (t: string) => ex?.items?.filter((i: any) => i.exposicion === t)
    .reduce((s: number, i: any) => s + Number(i.volumen ?? 0), 0) ?? null;
  const expDirecta = porTipo('direct');
  const expIndirecta = porTipo('indirect');

  return (
    <div className="fixed inset-0 lincoin-print-root" style={{ zIndex: 90, background: 'rgba(4,5,5,0.8)', overflow: 'auto' }}>
      <div className="no-imprimir flex items-center justify-between flex-wrap"
        style={{ gap: 12, position: 'sticky', top: 0, padding: '12px 18px', background: '#0C0E0D', borderBottom: '1px solid rgba(255,255,255,0.12)', fontFamily: FONT }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>Reporte de posibles contaminadores</span>
        <div className="flex items-center" style={{ gap: 10 }}>
          <button onClick={() => window.print()}
            style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, background: '#F4F4F2', color: '#0A0A0A', border: 'none', borderRadius: 9, padding: '10px 18px', cursor: 'pointer' }}>
            Guardar como PDF
          </button>
          <button onClick={onClose}
            style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, background: 'none', color: '#878E88', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '10px 16px', cursor: 'pointer' }}>
            Cerrar
          </button>
        </div>
      </div>

      <div id="lincoin-reporte" style={{ fontFamily: FONT, color: T.tinta, background: '#FFFFFF', maxWidth: 860, margin: '20px auto', padding: '30px 34px 40px' }}>

        {/* ── Cabecera ── */}
        <div className="flex items-start justify-between" style={{ gap: 16, border: `1px solid ${T.linea}`, padding: '14px 16px' }}>
          <div className="flex items-start" style={{ gap: 16 }}>
            <div style={{ paddingRight: 16, borderRight: `1px solid ${T.linea}` }}>
              {/* El wordmark exacto: Archivo 800 y el punto verde. */}
              <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.6px', margin: 0 }}>
                Lincoin<span style={{ color: T.verde }}>.</span>
              </p>
            </div>
            <div>
              <p style={{ fontSize: 9.5, fontWeight: 700, color: T.azul, margin: 0 }}>INTELIGENCIA DE RIESGO AML</p>
              <p style={{ fontSize: 19, fontWeight: 800, margin: '3px 0 0', lineHeight: 1.15 }}>
                Reporte de posibles contaminadores
              </p>
              <p style={{ fontSize: 9.5, color: T.suave, margin: '4px 0 0' }}>
                Red {d.coin} · Análisis de exposición directa e indirecta
              </p>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 9.5, color: T.suave, margin: 0 }}>Generado el {fecha(d.generadoAt)}</p>
            {d.empresa && <p style={{ fontSize: 9.5, color: T.suave, margin: '2px 0 0' }}>Solicitado por {d.empresa}</p>}
          </div>
        </div>

        {/* Dirección analizada */}
        <div className="flex" style={{ border: `1px solid ${T.linea}`, borderTop: 'none' }}>
          <div style={{ background: T.fondo, padding: '8px 12px', borderRight: `1px solid ${T.linea}`, minWidth: 150 }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: T.suave, margin: 0 }}>Dirección analizada</p>
          </div>
          <div style={{ padding: '8px 12px', flex: 1 }}>
            <p style={{ fontFamily: MONO, fontSize: 11, margin: 0, wordBreak: 'break-all' }}>{d.address}</p>
          </div>
        </div>

        {/* Indicadores — actividad */}
        <div className="flex" style={{ border: `1px solid ${T.linea}`, borderTop: 'none', flexWrap: 'wrap' }}>
          <Ind rot="Saldo"><Cifra v={n(ac?.saldo)} u={d.coin} /></Ind>
          <Ind rot="Total recibido"><Cifra v={n(ac?.recibido)} /></Ind>
          <Ind rot="Total enviado"><Cifra v={n(ac?.enviado)} /></Ind>
          <Ind rot="Transacciones"><Cifra v={n(ac?.txs, 0)} /></Ind>
          <Ind rot="Antigüedad"><Cifra v={ac?.primera ? fecha(ac.primera, false) : null} /></Ind>
        </div>

        {/* Indicadores — riesgo y exposición */}
        <div className="flex" style={{ border: `1px solid ${T.linea}`, borderTop: 'none', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px', borderRight: `1px solid ${T.linea}` }}>
            <div style={{ background: b.bg, padding: '5px 8px' }}>
              <p style={{ fontSize: 8, color: b.c, margin: 0, fontWeight: 700 }}>NIVEL DE RIESGO</p>
            </div>
            <div style={{ background: b.bg, padding: '10px 8px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: b.c, margin: 0 }}>{b.t}</p>
              <p style={{ fontSize: 9, color: b.c, margin: '2px 0 0', opacity: 0.92 }}>
                {d.puntaje == null ? 'sin puntaje' : `Puntaje: ${d.puntaje}`}
                {senalada ? ' · SEÑALADA' : ''}
              </p>
            </div>
          </div>
          <Ind rot="Fuentes entrantes señaladas"><Cifra v={tr ? String(entrantes.length) : null} /></Ind>
          <Ind rot="Destinos señalados"><Cifra v={tr ? String(salientes.length) : null} /></Ind>
          <Ind rot="Exposición directa"><Cifra v={n(expDirecta)} /></Ind>
          <Ind rot="Exposición indirecta"><Cifra v={n(expIndirecta)} /></Ind>
        </div>

        {/* ── 1. Lectura rápida ── */}
        <h2 style={H}>1. Lectura rápida de exposición</h2>
        {/* El señalamiento directo va PRIMERO y en rojo. Sin esto, un lector
            apurado leía los montos de exposición en 0 y se quedaba tranquilo,
            debajo de una dirección marcada como maliciosa. */}
        {senalada && (
          <p style={{ fontSize: 10.5, margin: '0 0 7px', lineHeight: 1.65, color: T.rojo, fontWeight: 700 }}>
            Esta dirección está señalada directamente: {motivos.slice(0, 6).join(' · ')}. El hallazgo
            recae sobre la dirección analizada, no sobre su entorno.
          </p>
        )}
        <p style={{ fontSize: 10.5, margin: 0, lineHeight: 1.7 }}>
          {tr
            ? <>La dirección analizada recibió <b>{n(sum(entrantes)) ?? '—'}</b> desde fuentes señaladas
                y envió <b>{n(sum(salientes)) ?? '—'}</b> hacia destinos señalados.{' '}</>
            : <>No se pudo obtener el detalle de transacciones con contrapartes señaladas.{' '}</>}
          {ex?.items?.length
            ? <>Se identificaron <b>{ex.items.length}</b> {ex.items.length === 1 ? 'vínculo' : 'vínculos'} con
                entidades de riesgo{ex.saltoMinimo != null && ex.saltoMinimo < 99
                  ? `, el más cercano a ${ex.saltoMinimo} ${ex.saltoMinimo === 1 ? 'salto' : 'saltos'}` : ''}.{' '}</>
            : <>El proveedor no reportó vínculos con entidades de riesgo.{' '}</>}
          El ranking prioriza posibles contaminadores por monto, recurrencia y cercanía.
        </p>

        {/* ── 2. Contactos directos ── */}
        <h2 style={H}>2. Contactos directos: quién interactuó con quién</h2>
        {directos.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>FLUJO OBSERVADO</th><th style={th}>CONTRAPARTE SEÑALADA</th>
              <th style={th}>LECTURA AML</th><th style={th}>MONTO</th><th style={th}>TXS</th>
            </tr></thead>
            <tbody>
              {directos.map((r: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 700, color: T.azul }}>
                    {r.flujo === 'entrada' ? 'Señalada → Analizada' : 'Analizada → Señalada'}
                  </td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 8.5, color: T.rojo }}>{corta(r.contaminante)}</td>
                  <td style={td}>
                    {r.flujo === 'entrada'
                      ? 'Posible fuente de exposición entrante'
                      : 'Transferencia saliente a destino reportado'}
                  </td>
                  <td style={td}>{n(r.monto) ?? '—'}</td>
                  <td style={td}>{r.txs ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tr ? (
          <p style={{ fontSize: 10.5, margin: 0, lineHeight: 1.65 }}>
            No se registraron transacciones directas con contrapartes señaladas entre las{' '}
            {tr.contrapartesRevisadas} contrapartes revisadas.
          </p>
        ) : <Vacio>No se pudo obtener la investigación de transacciones para esta dirección.</Vacio>}

        {/* ── 3. Rutas indirectas ── */}
        <h2 style={H}>3. Rutas indirectas agrupadas</h2>
        {indirectos.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>POSIBLE CONTAMINADOR</th><th style={th}>INTERMEDIARIO</th>
              <th style={th}>FLUJO OBSERVADO</th><th style={th}>TXS</th>
              <th style={th}>MONTO</th><th style={th}>DISTANCIA</th>
            </tr></thead>
            <tbody>
              {indirectos.map((r: any, i: number) => {
                // El camino completo cuando lo manda el proveedor (hop_dic).
                // Antes esta celda mostraba UN intermediario aunque el camino
                // tuviera tres, y la columna de flujo decía siempre lo mismo —
                // una frase fija en un reporte que se le entrega a un banco.
                const medios: string[] = r.intermediarios?.length
                  ? r.intermediarios : (r.intermediario ? [r.intermediario] : []);
                return (
                <tr key={i}>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 8.5, color: T.rojo, fontWeight: 700 }}>{corta(r.contaminante)}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 8.5 }}>
                    {medios.length ? medios.slice(0, 2).map(corta).join(' → ') : '—'}
                    {medios.length > 2 ? ` +${medios.length - 2}` : ''}
                  </td>
                  <td style={{ ...td, color: r.flujo ? T.azul : T.suave, fontWeight: 700, fontSize: 9 }}>
                    {r.flujo === 'saliente' ? 'Enviado desde la analizada'
                      : r.flujo === 'entrante' ? 'Recibido en la analizada'
                      : r.flujo === 'ambos' ? 'Enviado y recibido'
                      : 'Sentido no confirmado'}
                  </td>
                  <td style={td}>{r.txs ?? '—'}</td>
                  <td style={td}>{n(r.monto) ?? '—'}</td>
                  <td style={td}>
                    {r.saltos} saltos
                    {r.fuente === 'proveedor' ? ' · proveedor' : ''}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        ) : ex?.items?.length ? (
          // Sin intermediarios rastreados pero CON vínculos del veredicto: se
          // muestra lo que hay. Dejar la sección vacía teniendo el dato sería
          // esconder justamente lo que se vino a buscar.
          <>
            <p style={{ fontSize: 10.5, margin: '0 0 7px', lineHeight: 1.65 }}>
              No se reconstruyeron los intermediarios, pero el análisis de riesgo sí reporta estos
              vínculos con su distancia y volumen:
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>ENTIDAD SEÑALADA</th><th style={th}>TIPO</th>
                <th style={th}>EXPOSICIÓN</th><th style={th}>DISTANCIA</th><th style={th}>VOLUMEN</th>
              </tr></thead>
              <tbody>
                {ex.items.map((it: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...td, color: T.rojo, fontWeight: 700 }}>{it.entidad ?? '—'}</td>
                    <td style={td}>{it.tipoEs ?? '—'}</td>
                    <td style={td}>{it.exposicion === 'direct' ? 'Directa' : it.exposicion === 'indirect' ? 'Indirecta' : '—'}</td>
                    <td style={td}>{it.saltos != null ? `${it.saltos} saltos` : '—'}</td>
                    <td style={td}>{n(it.volumen) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <Vacio>No se identificaron rutas indirectas hacia entidades señaladas en la información disponible.</Vacio>}

        {/* ── 4. Ranking ── */}
        <h2 style={H}>4. Ranking de posibles contaminadores</h2>
        {ranking.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>#</th><th style={th}>DIRECCIÓN RELACIONADA</th>
              <th style={th}>TIPO DOMINANTE</th><th style={th}>EVIDENCIAS</th>
              <th style={th}>MONTO VINCULADO</th><th style={th}>INTERPRETACIÓN</th>
            </tr></thead>
            <tbody>
              {ranking.map((r: any, i: number) => (
                <tr key={i}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 8.5, color: T.rojo, fontWeight: 700 }}>{corta(r.contaminante)}</td>
                  <td style={td}>
                    {r.flujoDominante === 'salida' ? 'Transferencia saliente a destino reportado'
                      : r.flujoDominante === 'entrada' ? 'Fuente entrante reportada'
                      : (r.etiqueta ?? 'Contraparte señalada')}
                  </td>
                  <td style={td}>{r.evidencias}</td>
                  <td style={td}>{n(r.monto) ?? '—'}</td>
                  <td style={{ ...td, fontSize: 9 }}>
                    {r.flujoDominante === 'salida'
                      ? 'Revisar si la billetera envió fondos a una entidad reportada.'
                      : 'Revisar el origen de los fondos recibidos desde esta contraparte.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vacio>No hay contaminadores para rankear con la información obtenida.</Vacio>}

        {/* Alcance del rastreo — hasta dónde se miró de verdad */}
        {tr && (
          <p style={{ fontSize: 9, color: T.suave, margin: '8px 0 0', lineHeight: 1.6 }}>
            Alcance: se revisaron {tr.contrapartesRevisadas} contrapartes directas y se expandieron{' '}
            {tr.expandidos} de ellas para buscar rutas de segundo nivel.
            {tr.delProveedor > 0 && ` ${tr.delProveedor} ${tr.delProveedor === 1 ? 'ruta proviene' : 'rutas provienen'} del camino completo que reporta el proveedor (hop_dic), que no está sujeto a ese alcance.`}
            {tr.completo === false && ' Quedaron contrapartes sin expandir: la ausencia de más rutas en estas tablas no descarta que existan otras.'}
            {' '}El sentido del flujo solo se afirma cuando la contraparte aparece entre las revisadas;
            en las demás filas se indica que no está confirmado.
          </p>
        )}

        {/* Nota metodológica */}
        <div style={{ marginTop: 22, paddingTop: 12, borderTop: `2px solid ${T.tinta}`, breakInside: 'avoid' }}>
          <p style={{ fontSize: 9, color: T.suave, margin: 0, lineHeight: 1.65 }}>
            <b style={{ color: T.tinta }}>Nota metodológica:</b> este reporte identifica exposición y
            posibles fuentes de contaminación con base en transacciones registradas en la cadena.{' '}
            <b>No atribuye culpabilidad ni causalidad definitiva</b> sin revisión manual, contexto de
            fondos y verificación independiente. Un vínculo indirecto puede originarse en operaciones
            ajenas al titular de la dirección. El resultado refleja la información disponible el{' '}
            {fecha(d.consultadoAt ?? d.generadoAt)} y puede cambiar; una dirección sin hallazgos no
            constituye garantía. Los campos marcados como sin dato indican ausencia de información del
            proveedor, no ausencia de riesgo.
          </p>
          <p style={{ fontSize: 9, color: T.tenue, margin: '8px 0 0', lineHeight: 1.6 }}>
            Emitido por Lincoin · www.lincoin.me · Lincoin no es un banco.
          </p>
        </div>
      </div>
    </div>
  );
};

export default KytReporte;
