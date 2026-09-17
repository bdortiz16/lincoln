// ══════════════════════════════════════════════════════════════════
//  Reporte AML de una dirección — marca Lincoin, para imprimir o guardar.
//
//  Se imprime con el diálogo del navegador en vez de generar el PDF con una
//  librería. Es a propósito:
//    · el texto queda SELECCIONABLE y el documento es vectorial, que es lo que
//      hace falta si alguien lo va a adjuntar a un expediente;
//    · no entra una dependencia nueva a un bundle que ya pesa 2,6 MB;
//    · y no viaja nada por CDN, que en este proyecto está descartado por
//      decisión explícita del index.html.
//  El costo es que el navegador muestra su diálogo y hay que elegir "Guardar
//  como PDF". Si se quiere descarga directa de un clic, eso sí necesita jsPDF.
//
//  EN PAPEL VA EN CLARO. La app es oscura, pero un documento que se imprime en
//  negro gasta tóner, se ve sucio y es ilegible en fotocopia. El reporte es un
//  documento, no una pantalla.
//
//  NO SE INVENTA NADA. Cada sección que el proveedor no devolvió dice que no la
//  devolvió, en vez de mostrar ceros. Un "0.00 USDT de exposición" que en
//  realidad significa "no sé" es lo peor que puede decir un reporte de
//  cumplimiento: alguien opera con eso.
// ══════════════════════════════════════════════════════════════════
import React from 'react';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const T = {
  tinta: '#15181A',
  suave: '#5C625E',
  tenue: '#9B9F9B',
  linea: 'rgba(21,24,26,0.12)',
  fondo: '#F7F8F7',
  verde: '#22A35C',
  rojo: '#C0392B',
  ambar: '#B7791F',
};

const banda = (cat?: string) =>
  cat === 'alto' ? { c: T.rojo, t: 'RIESGO ALTO' }
  : cat === 'medio' ? { c: T.ambar, t: 'RIESGO MEDIO' }
  : cat === 'bajo' ? { c: T.verde, t: 'RIESGO BAJO' }
  : { c: T.tenue, t: 'SIN CLASIFICAR' };

const num = (v: any, dec = 2) =>
  v == null || !Number.isFinite(Number(v)) ? null
    : Number(v).toLocaleString('es-CO', { maximumFractionDigits: dec });

const fecha = (t?: string | null) => {
  if (!t) return '—';
  try {
    return new Date(t).toLocaleString('es-CO', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
};

const textos = (arr: any, max = 40): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((x: any) => typeof x === 'string' ? x : (x?.label ?? x?.name ?? x?.type ?? ''))
    .map((s: any) => String(s).trim()).filter(Boolean).slice(0, max);

const Seccion: React.FC<{ n: number; titulo: string; children: React.ReactNode }> = ({ n, titulo, children }) => (
  <section style={{ marginTop: 22, breakInside: 'avoid' }}>
    <h2 style={{ fontSize: 12, fontWeight: 800, color: T.tinta, margin: '0 0 9px', letterSpacing: '-0.1px' }}>
      {n}. {titulo}
    </h2>
    {children}
  </section>
);

const SinDato: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 11, color: T.tenue, margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>{children}</p>
);

const th: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', color: '#FFFFFF',
  background: T.tinta, padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  fontSize: 10.5, color: T.tinta, padding: '6px 8px',
  borderBottom: `1px solid ${T.linea}`, verticalAlign: 'top',
};

export const KytReporte: React.FC<{ d: any; onClose: () => void }> = ({ d, onClose }) => {
  const b = banda(d.categoria);
  const inv = d.investigacion;
  const cp = d.contrapartes;
  const ex = d.exposicion;
  const ac = d.actividad;
  const pf = d.perfil;
  const co = d.comportamiento;

  const motivos = textos(d.detalle);
  if (d.hackingEvent) motivos.unshift(`Incidente asociado: ${d.hackingEvent}`);

  const listaPerfil = (o: any): string[] => {
    if (!o) return [];
    return Object.entries(o).flatMap(([k, v]) =>
      (Array.isArray(v) && v.length) ? [`${k}: ${(v as string[]).slice(0, 6).join(', ')}`] : []);
  };

  return (
    <div className="fixed inset-0 lincoin-print-root" style={{ zIndex: 90, background: 'rgba(4,5,5,0.8)', overflow: 'auto' }}>
      {/* Barra de acciones — no se imprime */}
      <div className="no-imprimir flex items-center justify-between flex-wrap"
        style={{ gap: 12, position: 'sticky', top: 0, padding: '12px 18px', background: '#0C0E0D', borderBottom: '1px solid rgba(255,255,255,0.12)', fontFamily: FONT }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>Reporte AML · vista previa</span>
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

      {/* La hoja */}
      <div id="lincoin-reporte" style={{
        fontFamily: FONT, color: T.tinta, background: '#FFFFFF',
        maxWidth: 820, margin: '20px auto', padding: '34px 38px 44px',
      }}>
        {/* Cabecera */}
        <div className="flex items-start justify-between" style={{ gap: 16, paddingBottom: 14, borderBottom: `2px solid ${T.tinta}` }}>
          <div>
            {/* El wordmark, exacto: Archivo 800 y el punto verde. */}
            <p style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.7px', margin: 0 }}>
              Lincoin<span style={{ color: T.verde }}>.</span>
            </p>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', color: T.suave, margin: '3px 0 0' }}>
              VERIFICACIÓN DE DIRECCIONES · KYT
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Reporte de riesgo AML</p>
            <p style={{ fontSize: 10.5, color: T.suave, margin: '4px 0 0' }}>
              Generado el {fecha(d.generadoAt)}
            </p>
            {d.empresa && (
              <p style={{ fontSize: 10.5, color: T.suave, margin: '2px 0 0' }}>Solicitado por {d.empresa}</p>
            )}
          </div>
        </div>

        {/* Dirección + veredicto */}
        <div style={{ marginTop: 16, border: `1px solid ${T.linea}`, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <div style={{ padding: '11px 14px', borderRight: `1px solid ${T.linea}`, minWidth: 210 }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', color: T.suave, margin: '0 0 4px' }}>DIRECCIÓN ANALIZADA</p>
              <p style={{ fontFamily: MONO, fontSize: 11.5, margin: 0, wordBreak: 'break-all' }}>{d.address}</p>
              <p style={{ fontSize: 10, color: T.suave, margin: '4px 0 0' }}>Red {d.coin}</p>
            </div>
            <div style={{ padding: '11px 14px', background: T.fondo, borderRight: `1px solid ${T.linea}`, textAlign: 'center', minWidth: 132 }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', color: T.suave, margin: '0 0 4px' }}>NIVEL DE RIESGO</p>
              <p style={{ fontSize: 15, fontWeight: 800, color: b.c, margin: 0 }}>{b.t}</p>
              <p style={{ fontSize: 10.5, color: T.suave, margin: '3px 0 0' }}>
                {d.puntaje == null ? 'sin puntaje' : `Puntaje ${d.puntaje} / 100`}
                {d.nivel ? ` · ${d.nivel}` : ''}
              </p>
            </div>
            <div style={{ padding: '11px 14px', flex: 1, minWidth: 190 }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', color: T.suave, margin: '0 0 4px' }}>ETIQUETAS</p>
              <p style={{ fontSize: 10.5, margin: 0, lineHeight: 1.5 }}>
                {textos(d.etiquetas).length ? textos(d.etiquetas).join(' · ') : <span style={{ color: T.tenue, fontStyle: 'italic' }}>sin etiqueta</span>}
              </p>
            </div>
          </div>
        </div>

        {/* 1. RUTAS — primero, porque es lo que se mira.
            Saber que existe un camino hacia una entidad señalada, y a cuántos
            saltos, es lo que permite anticipar un congelamiento de fondos. Va
            antes que el puntaje explicado: el puntaje resume, la ruta explica. */}
        <Seccion n={1} titulo="Rutas hacia entidades señaladas">
          {ex && Array.isArray(ex.items) && ex.items.length ? (
            <>
              <p style={{ fontSize: 11, margin: '0 0 8px', lineHeight: 1.65 }}>
                Se detectaron <b>{ex.items.length}</b> {ex.items.length === 1 ? 'ruta' : 'rutas'} desde
                esta dirección hacia entidades señaladas
                {ex.saltoMinimo != null && ex.saltoMinimo < 99
                  ? `, la más cercana a ${ex.saltoMinimo} ${ex.saltoMinimo === 1 ? 'salto' : 'saltos'}`
                  : ''}
                {ex.directas > 0 ? `, incluyendo ${ex.directas} de exposición directa` : ''}.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>RUTA OBSERVADA</th><th style={th}>ENTIDAD SEÑALADA</th>
                  <th style={th}>TIPO</th><th style={th}>DISTANCIA</th><th style={th}>VOLUMEN</th>
                </tr></thead>
                <tbody>
                  {ex.items.map((it: any, i: number) => (
                    <tr key={i}>
                      <td style={{ ...td, fontSize: 9.5 }}>
                        Analizada{it.saltos > 1 ? ` → ${it.saltos - 1} interm.` : ''} → <b>Señalada</b>
                      </td>
                      <td style={{ ...td, color: T.rojo, fontWeight: 700 }}>{it.entidad ?? '—'}</td>
                      <td style={td}>{it.tipoEs ?? '—'}</td>
                      <td style={td}>{it.saltos != null ? `${it.saltos} ${it.saltos === 1 ? 'salto' : 'saltos'}` : '—'}</td>
                      <td style={td}>{num(it.volumen) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.rutas?.rutas?.length > 0 && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 700, margin: '14px 0 6px' }}>
                    Rutas rastreadas con intermediario
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th}>INTERMEDIARIO</th><th style={th}>CONTAMINANTE</th>
                      <th style={th}>FLUJO</th><th style={th}>SALTOS</th><th style={th}>MONTO</th>
                    </tr></thead>
                    <tbody>
                      {d.rutas.rutas.map((r: any, i: number) => (
                        <tr key={i}>
                          <td style={{ ...td, fontFamily: MONO, fontSize: 9, wordBreak: 'break-all' }}>{r.intermediario ?? 'directo'}</td>
                          <td style={{ ...td, fontFamily: MONO, fontSize: 9, color: T.rojo, wordBreak: 'break-all' }}>{r.contaminante ?? '—'}</td>
                          <td style={td}>{r.flujo ?? '—'}</td>
                          <td style={td}>{r.saltos ?? '—'}</td>
                          <td style={td}>{num(r.monto) ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {d.rutas.completo === false && (
                    <p style={{ fontSize: 9.5, color: T.tenue, margin: '6px 0 0', lineHeight: 1.55 }}>
                      Se revisaron {d.rutas.expandidos} de {d.rutas.contrapartesRevisadas} contrapartes.
                      La ausencia de más rutas en esta tabla no descarta que existan otras.
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <p style={{ fontSize: 11, margin: 0, lineHeight: 1.65 }}>
              No se detectaron rutas desde esta dirección hacia entidades señaladas en la
              información disponible. <b>Esto no constituye una garantía</b>: una ruta puede
              aparecer después, y la ausencia de vínculos reportados no equivale a ausencia de
              exposición.
            </p>
          )}
        </Seccion>

        {/* 2. Por qué */}
        <Seccion n={2} titulo="Por qué tiene este nivel de riesgo">
          {motivos.length
            ? <ul style={{ margin: 0, paddingLeft: 17 }}>
                {motivos.slice(0, 12).map((m, i) => (
                  <li key={i} style={{ fontSize: 11, lineHeight: 1.65, color: T.tinta }}>{m}</li>
                ))}
              </ul>
            : d.categoria === 'bajo'
              ? <p style={{ fontSize: 11, margin: 0, lineHeight: 1.65 }}>
                  El análisis no encontró señalamientos de sanciones, mixers, actividad ilícita ni
                  mercados reportados para esta dirección.
                </p>
              : <SinDato>El proveedor no entregó el desglose de motivos para este nivel de riesgo.</SinDato>}
        </Seccion>

        {/* 2. Actividad */}
        <Seccion n={3} titulo="Actividad de la dirección">
          {ac ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>SALDO</th><th style={th}>TOTAL RECIBIDO</th>
                <th style={th}>TOTAL ENVIADO</th><th style={th}>TRANSACCIONES</th>
                <th style={th}>PRIMERA VEZ</th><th style={th}>ÚLTIMO MOVIMIENTO</th>
              </tr></thead>
              <tbody><tr>
                <td style={td}>{num(ac.saldo) ?? '—'}</td>
                <td style={td}>{num(ac.recibido) ?? '—'}</td>
                <td style={td}>{num(ac.enviado) ?? '—'}</td>
                <td style={td}>{num(ac.txs, 0) ?? '—'}</td>
                <td style={td}>{ac.primera ? fecha(ac.primera).split(',')[0] : '—'}</td>
                <td style={td}>{ac.ultima ? fecha(ac.ultima).split(',')[0] : '—'}</td>
              </tr></tbody>
            </table>
          ) : <SinDato>El proveedor no devolvió la actividad de esta dirección.</SinDato>}
        </Seccion>

        {/* 3. Exposición */}
        <Seccion n={4} titulo="Detalle de la exposición">
          {ex && Array.isArray(ex.items) && ex.items.length ? (
            <>
              <p style={{ fontSize: 11, margin: '0 0 8px', lineHeight: 1.6 }}>
                Se detectaron <b>{ex.items.length}</b> vínculos con entidades de riesgo
                {ex.directas > 0 ? `, de los cuales ${ex.directas} son de exposición directa` : ''}
                {ex.pctIndirecto != null ? `. La exposición indirecta representa el ${ex.pctIndirecto} % del volumen vinculado` : ''}
                {ex.saltoMinimo != null && ex.saltoMinimo < 99 ? `, con la más cercana a ${ex.saltoMinimo} ${ex.saltoMinimo === 1 ? 'salto' : 'saltos'}` : ''}.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>ENTIDAD</th><th style={th}>TIPO</th>
                  <th style={th}>EXPOSICIÓN</th><th style={th}>SALTOS</th><th style={th}>VOLUMEN</th>
                </tr></thead>
                <tbody>
                  {ex.items.map((it: any, i: number) => (
                    <tr key={i}>
                      <td style={td}>{it.entidad ?? '—'}</td>
                      <td style={td}>{it.tipoEs ?? '—'}</td>
                      <td style={{ ...td, color: it.exposicion === 'direct' ? T.rojo : T.tinta, fontWeight: it.exposicion === 'direct' ? 700 : 400 }}>
                        {it.exposicion === 'direct' ? 'Directa' : it.exposicion === 'indirect' ? 'Indirecta' : '—'}
                      </td>
                      <td style={td}>{it.saltos ?? '—'}</td>
                      <td style={td}>{num(it.volumen) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <SinDato>
                El proveedor no devolvió vínculos con entidades de riesgo para esta dirección. Eso
                no equivale a ausencia de exposición: significa que no hay vínculos reportados en
                la información disponible hoy.
              </SinDato>}
        </Seccion>

        {/* 4. Contrapartes señaladas */}
        <Seccion n={5} titulo="Contrapartes señaladas">
          {inv && Array.isArray(inv.maliciosas) && inv.maliciosas.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>DIRECCIÓN</th><th style={th}>ETIQUETA</th>
                <th style={th}>FLUJO</th><th style={th}>MONTO</th>
              </tr></thead>
              <tbody>
                {inv.maliciosas.map((m: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...td, fontFamily: MONO, fontSize: 9.5, wordBreak: 'break-all' }}>{m.direccion ?? '—'}</td>
                    <td style={{ ...td, color: T.rojo, fontWeight: 700 }}>{m.etiqueta ?? 'señalada'}</td>
                    <td style={td}>{m.flujo === 'entrada' ? 'Recibió de' : 'Envió a'}</td>
                    <td style={td}>{num(m.monto) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : inv
            ? <p style={{ fontSize: 11, margin: 0, lineHeight: 1.65 }}>
                Se revisaron {(inv.entradas?.length ?? 0) + (inv.salidas?.length ?? 0)} contrapartes
                y <b>ninguna está señalada</b> como maliciosa en la información disponible.
              </p>
            : <SinDato fuente={d.fuentes?.investigacion}>El proveedor no devolvió la investigación de contrapartes para esta dirección.</SinDato>}
        </Seccion>

        {/* 5. Principales contrapartes */}
        <Seccion n={6} titulo="Principales contrapartes por volumen">
          {cp?.noSoportada
            ? <SinDato>
                El proveedor no analiza contrapartes para este tipo de dirección (billeteras
                calientes de plataformas). No es un error del reporte.
              </SinDato>
            : cp && Array.isArray(cp.items) && cp.items.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>CONTRAPARTE</th><th style={th}>MONTO (USD)</th><th style={th}>% DEL VOLUMEN</th></tr></thead>
                <tbody>
                  {cp.items.map((x: any, i: number) => (
                    <tr key={i}>
                      <td style={td}>{x.nombre ?? '—'}</td>
                      <td style={td}>{num(x.montoUsd) ?? '—'}</td>
                      <td style={td}>{x.pct != null ? `${num(x.pct, 1)} %` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <SinDato fuente={d.fuentes?.contrapartes}>El proveedor no devolvió contrapartes para esta dirección.</SinDato>}
        </Seccion>

        {/* 6. Comportamiento */}
        <Seccion n={7} titulo="En qué usa su volumen">
          {co ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>FLUJO</th><th style={th}>TIPO DE OPERACIÓN</th><th style={th}>OPERACIONES</th><th style={th}>PROPORCIÓN</th></tr></thead>
              <tbody>
                {[...(co.recibido ?? []).map((x: any) => ({ ...x, f: 'Entrante' })),
                  ...(co.enviado ?? []).map((x: any) => ({ ...x, f: 'Saliente' }))].map((x: any, i: number) => (
                  <tr key={i}>
                    <td style={td}>{x.f}</td>
                    <td style={td}>{x.accion}</td>
                    <td style={td}>{num(x.veces, 0) ?? '—'}</td>
                    <td style={td}>{x.pct != null ? `${num(x.pct, 1)} %` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <SinDato fuente={d.fuentes?.comportamiento}>El proveedor no devolvió el análisis de comportamiento.</SinDato>}
        </Seccion>

        {/* 7. Perfil */}
        <Seccion n={8} titulo="Plataformas y eventos asociados">
          {pf ? (
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              {pf.primeraFuente && <p style={{ margin: '0 0 4px' }}><b>Origen del gas:</b> {pf.primeraFuente}</p>}
              {listaPerfil(pf.eventos).length > 0 && (
                <p style={{ margin: '0 0 4px', color: T.rojo }}><b>Eventos maliciosos —</b> {listaPerfil(pf.eventos).join(' | ')}</p>
              )}
              {listaPerfil(pf.plataformas).length > 0 && (
                <p style={{ margin: '0 0 4px' }}><b>Plataformas —</b> {listaPerfil(pf.plataformas).join(' | ')}</p>
              )}
              {listaPerfil(pf.relaciones).length > 0 && (
                <p style={{ margin: 0 }}><b>Identidades vinculadas —</b> {listaPerfil(pf.relaciones).join(' | ')}</p>
              )}
            </div>
          ) : <SinDato>El proveedor no devolvió el perfil de plataformas ni eventos asociados.</SinDato>}
        </Seccion>

        {/* Nota metodológica */}
        <div style={{ marginTop: 26, paddingTop: 13, borderTop: `1px solid ${T.linea}`, breakInside: 'avoid' }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: T.tinta, margin: '0 0 5px' }}>NOTA METODOLÓGICA</p>
          <p style={{ fontSize: 9.5, color: T.suave, margin: 0, lineHeight: 1.65 }}>
            Este reporte identifica exposición y posibles fuentes de contaminación a partir de
            transacciones registradas en la cadena. <b>No atribuye culpabilidad ni causalidad</b>: un
            vínculo indirecto puede originarse en operaciones ajenas al titular de la dirección. El
            resultado refleja la información disponible el {fecha(d.consultadoAt ?? d.generadoAt)} y
            puede cambiar. Una dirección sin hallazgos no constituye garantía, y este análisis no
            reemplaza la revisión manual, el contexto del origen de fondos ni la verificación
            independiente. Las secciones marcadas como no devueltas por el proveedor indican
            ausencia de información, no ausencia de riesgo.
          </p>
          <p style={{ fontSize: 9.5, color: T.tenue, margin: '10px 0 0', lineHeight: 1.6 }}>
            Emitido por Lincoin · Análisis de riesgo sobre infraestructura de terceros especializados
            en inteligencia de cadena. Lincoin no es un banco. www.lincoin.me
          </p>
        </div>
      </div>
    </div>
  );
};

export default KytReporte;
