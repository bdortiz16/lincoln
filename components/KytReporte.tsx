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
import { hallazgosEnEspanol, bandaDeRiesgo } from '../lib/kytTextos';

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

// ── POR QUÉ ESTÁ VACÍA ────────────────────────────────────────────
// El reporte decía "No se pudo obtener la investigación de transacciones" y
// ahí terminaba. Esa frase tapa por igual tres cosas muy distintas: que el plan
// contratado no incluye ese endpoint, que la ruta cambió, y que el proveedor
// contestó bien pero sin datos. Quien lee el reporte no puede hacer nada con
// "no se pudo" — con "HTTP 403: plan does not include this endpoint" sí.
//
// El objeto `fuentes` se venía guardando con exactamente ese dato y no se
// mostraba en ningún lado. Es el mismo error que nos costó medio día con el
// proveedor de rieles: dos horas de hipótesis valen menos que una pantalla que
// muestre la respuesta cruda.
const PorQueVacio: React.FC<{ f?: any; que: string }> = ({ f, que }) => {
  if (!f) return <Vacio>No se consultó {que} en este reporte.</Vacio>;
  const dicho = String(f.motivo ?? '').trim();
  return (
    <div style={{ borderLeft: `3px solid ${T.linea}`, paddingLeft: 9 }}>
      <p style={{ fontSize: 10, color: T.suave, margin: 0, lineHeight: 1.6 }}>
        No hay datos de {que}.{' '}
        {f.status === 0 ? 'No se pudo llegar al proveedor (fallo de red o tiempo agotado).'
          : f.ok === false ? <>El proveedor respondió <b style={{ color: T.tinta }}>HTTP {f.status}</b>.</>
          : <>El proveedor respondió <b style={{ color: T.tinta }}>HTTP {f.status}</b> pero sin información utilizable.</>}
        {dicho ? <> Dijo textualmente: <i style={{ color: T.tinta }}>«{dicho}»</i>.</> : null}
      </p>
      <p style={{ fontSize: 9, color: T.tenue, margin: '4px 0 0', lineHeight: 1.55, fontStyle: 'italic' }}>
        Ausencia de información, no ausencia de riesgo.
      </p>
    </div>
  );
};

export const KytReporte: React.FC<{ d: any; onClose: () => void }> = ({ d, onClose }) => {
  const ac = d.actividad;
  const tk = d.tokenActividad;
  const cad = d.cadena; // el explorador de la cadena: de donde salen los saldos
  const ex = d.exposicion;
  const tr = d.rutas;

  // Los hallazgos van EN ESPAÑOL. Salían tal cual los manda MistTrack
  // —"Involved Illicit Activity"— en un documento que se le entrega a un banco
  // colombiano. Lo que el traductor no reconoce queda en inglés a propósito:
  // ver lib/kytTextos.ts.
  const motivos = Array.from(new Set([
    ...hallazgosEnEspanol(d.detalle), ...hallazgosEnEspanol(d.hallazgos),
  ]));
  if (d.hackingEvent) motivos.unshift(`Incidente: ${d.hackingEvent}`);
  const senalada = motivos.length > 0 || d.categoria === 'alto' || d.categoria === 'medio';

  // LA BANDA ES NUESTRA LECTURA, NO SU PUNTAJE.
  // MistTrack le puso 3/100 a una dirección cuyo propio detail_list dice
  // "Involved Illicit Activity", y nosotros pintábamos ese 3 de verde con
  // "está señalada directamente" escrito al lado. Una dirección señalada no
  // sale en verde. Su puntaje se sigue mostrando tal cual.
  const lectura = bandaDeRiesgo(d.categoria, motivos);
  const b = banda(lectura.categoria);

  const directos: any[] = (tr?.rutas ?? []).filter((r: any) => r.saltos === 1);
  const indirectos: any[] = (tr?.rutas ?? []).filter((r: any) => r.saltos > 1);
  const ranking: any[] = tr?.ranking ?? [];

  // Las fuentes que el reporte pide, paga y guarda — y hasta ahora no dibujaba.
  const inv = d.investigacion;   // transactions_investigation, USD 1,00
  const cp = d.contrapartes;     // address_counterparty,        USD 0,50
  const comp = d.comportamiento; // address_action,              USD 0,50
  const perfil = d.perfil;       // address_trace,               USD 0,50
  const fu = d.fuentes;          // por qué quedó vacía cada una

  // Las contrapartes reales, con dirección y monto, sin necesidad de rastrear.
  // Las señaladas primero; después por monto. Es el orden en que se mira.
  const contactos: any[] = [
    ...(inv?.entradas ?? []).map((x: any) => ({ ...x, entrante: true })),
    ...(inv?.salidas ?? []).map((x: any) => ({ ...x, entrante: false })),
  ]
    .filter((x: any) => x.direccion)
    .map((x: any) => ({ ...x, senalada: x.tipoNum === 2, txs: x.hashes?.length ?? null }))
    .sort((a: any, b: any) =>
      Number(b.senalada) - Number(a.senalada) || (b.monto ?? 0) - (a.monto ?? 0));

  const senaladasEntrantes = contactos.filter(x => x.senalada && x.entrante);
  const senaladasSalientes = contactos.filter(x => x.senalada && !x.entrante);
  const montoEntrante = contactos.filter(x => x.entrante).reduce((t, x) => t + Number(x.monto ?? 0), 0);
  const montoSaliente = contactos.filter(x => !x.entrante).reduce((t, x) => t + Number(x.monto ?? 0), 0);

  const listas = (o: any): [string, string[]][] =>
    Object.entries(o ?? {}).filter(([, v]) => Array.isArray(v) && v.length) as [string, string[]][];
  const ROT: Record<string, string> = {
    exchange: 'Exchanges', dex: 'DEX', mixer: 'Mixers', nft: 'NFT',
    phishing: 'Phishing', ransom: 'Ransomware', stealing: 'Robo de fondos', laundering: 'Lavado',
    wallet: 'Billetera', ens: 'ENS', twitter: 'Twitter',
  };

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
        <div className="flex items-start justify-between flex-wrap" style={{ gap: 16, border: `1px solid ${T.linea}`, padding: '14px 16px' }}>
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

        {/* ── LO QUE TIENE, según el explorador de la cadena ──
            MistTrack es un proveedor de riesgo, no un explorador: para esta
            misma dirección devolvió "sin dato" en saldo y transacciones
            mientras Tronscan mostraba 766.000 USDT y 106 transacciones. Los
            saldos salen de la cadena; el riesgo, de MistTrack. Cada uno lo
            suyo, y acá se dice de dónde salió cada número. */}
        {cad ? (
          <>
            <div className="flex" style={{ border: `1px solid ${T.linea}`, borderTop: 'none', flexWrap: 'wrap' }}>
              <Ind rot="Valor total en USD"><Cifra v={n(cad.valorUsd)} u="USD" /></Ind>
              <Ind rot="Saldo USDT"><Cifra v={n(cad.saldoUsdt)} u="USDT" /></Ind>
              <Ind rot={`Saldo ${d.coin}`}><Cifra v={n(cad.saldoNativo)} u={d.coin} /></Ind>
              <Ind rot="Transacciones">
                <Cifra v={n(cad.transacciones, 0)} />
                {cad.entradas != null || cad.salidas != null ? (
                  <p style={{ fontSize: 8.5, color: T.suave, margin: '3px 0 0' }}>
                    ↓ {n(cad.entradas, 0) ?? '—'} · ↑ {n(cad.salidas, 0) ?? '—'}
                  </p>
                ) : null}
              </Ind>
              <Ind rot="Creada · última actividad">
                <p style={{ fontSize: 10.5, fontWeight: 700, margin: 0, lineHeight: 1.35 }}>
                  {cad.creada ? fecha(cad.creada, false) : <span style={{ color: T.tenue, fontWeight: 400 }}>sin dato</span>}
                  <br />
                  <span style={{ fontSize: 9, color: T.suave }}>{cad.ultimaActividad ? fecha(cad.ultimaActividad, false) : '—'}</span>
                </p>
              </Ind>
            </div>
            {cad.tokens?.length > 1 && (
              <div style={{ border: `1px solid ${T.linea}`, borderTop: 'none', padding: '6px 12px', background: T.fondo }}>
                <p style={{ fontSize: 8.5, color: T.suave, margin: 0, lineHeight: 1.6 }}>
                  <b>Otros activos:</b>{' '}
                  {cad.tokens.filter((t: any) => t.simbolo !== 'USDT' && t.simbolo !== d.coin).slice(0, 8)
                    .map((t: any) => `${t.simbolo} ${n(t.cantidad, 2) ?? '—'}${t.usd != null ? ` (USD ${n(t.usd)})` : ''}`)
                    .join(' · ') || '—'}
                </p>
              </div>
            )}
            <div style={{ border: `1px solid ${T.linea}`, borderTop: 'none', padding: '5px 12px' }}>
              <p style={{ fontSize: 8.5, color: T.tenue, margin: 0, fontStyle: 'italic' }}>
                Saldos y conteos según {cad.fuente === 'tronscan' ? 'Tronscan' : 'TronGrid'}, consultado el {fecha(cad.consultadoAt)}.
                Son los de ese momento: una dirección activa cambia de saldo entre una consulta y la siguiente.
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Sin explorador: lo que haya devuelto MistTrack de la moneda nativa. */}
            <div className="flex" style={{ border: `1px solid ${T.linea}`, borderTop: 'none', flexWrap: 'wrap' }}>
              <Ind rot={`Saldo ${d.coin}`}><Cifra v={n(ac?.saldo)} u={d.coin} /></Ind>
              <Ind rot={`Recibido ${d.coin}`}><Cifra v={n(ac?.recibido)} /></Ind>
              <Ind rot={`Enviado ${d.coin}`}><Cifra v={n(ac?.enviado)} /></Ind>
              <Ind rot="Transacciones"><Cifra v={n(ac?.txs, 0)} /></Ind>
              <Ind rot="Antigüedad"><Cifra v={ac?.primera ? fecha(ac.primera, false) : null} /></Ind>
            </div>
            {d.coin === 'TRX' && (
              <div style={{ border: `1px solid ${T.linea}`, borderTop: 'none', padding: '6px 12px' }}>
                <p style={{ fontSize: 9, color: T.tenue, margin: 0, fontStyle: 'italic', lineHeight: 1.55 }}>
                  No se pudo consultar el explorador de la cadena para esta dirección
                  {d.cadenaFuentes ? ` (${Object.entries(d.cadenaFuentes).map(([k, v]: [string, any]) => `${k}: ${v?.status === 0 ? 'sin conexión' : `HTTP ${v?.status}`}${v?.motivo ? ` — ${v.motivo}` : ''}`).join('; ')})` : ''}.
                  Los indicadores de arriba son solo lo que devolvió el proveedor de riesgo.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── El ESTABLE según MistTrack, cuando lo devuelve ──
            Se muestra aparte del explorador porque es otra fuente y puede no
            coincidir; el lector tiene que poder ver las dos. */}
        {tk ? (
          <div className="flex" style={{ border: `1px solid ${T.linea}`, borderTop: 'none', flexWrap: 'wrap' }}>
            <Ind rot={`Saldo ${tk.simbolo ?? 'USDT'}`}><Cifra v={n(tk.saldo)} u={tk.simbolo ?? 'USDT'} /></Ind>
            <Ind rot={`Recibido ${tk.simbolo ?? 'USDT'}`}><Cifra v={n(tk.recibido)} /></Ind>
            <Ind rot={`Enviado ${tk.simbolo ?? 'USDT'}`}><Cifra v={n(tk.enviado)} /></Ind>
            <Ind rot="Transacciones"><Cifra v={n(tk.txs, 0)} /></Ind>
            <Ind rot="Antigüedad"><Cifra v={tk.primera ? fecha(tk.primera, false) : null} /></Ind>
          </div>
        ) : !cad ? (
          <div style={{ border: `1px solid ${T.linea}`, borderTop: 'none', padding: '7px 12px' }}>
            <p style={{ fontSize: 9, color: T.tenue, margin: 0, fontStyle: 'italic' }}>
              El proveedor de riesgo no devolvió saldo ni movimientos de stablecoins para esta
              dirección. Los indicadores de arriba son solo de {d.coin}, la moneda nativa de la red —
              una dirección puede mover stablecoins y tener {d.coin} en cero.
            </p>
          </div>
        ) : null}

        {/* Indicadores — riesgo y exposición */}
        <div className="flex" style={{ border: `1px solid ${T.linea}`, borderTop: 'none', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px', borderRight: `1px solid ${T.linea}` }}>
            <div style={{ background: b.bg, padding: '5px 8px' }}>
              <p style={{ fontSize: 8, color: b.c, margin: 0, fontWeight: 700 }}>NIVEL DE RIESGO</p>
            </div>
            <div style={{ background: b.bg, padding: '10px 8px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: b.c, margin: 0 }}>{b.t}</p>
              <p style={{ fontSize: 9, color: b.c, margin: '2px 0 0', opacity: 0.92 }}>
                {d.puntaje == null ? 'sin puntaje' : `Puntaje del proveedor: ${d.puntaje}`}
                {senalada ? ' · SEÑALADA' : ''}
              </p>
            </div>
          </div>
          {/* Salían en "sin dato" salvo que alguien hubiera apretado "Rastrear"
              antes de imprimir, aunque `investigacion` ya los tuviera. */}
          <Ind rot="Fuentes entrantes señaladas">
            <Cifra v={inv ? String(senaladasEntrantes.length) : tr ? String(entrantes.length) : null} />
          </Ind>
          <Ind rot="Destinos señalados">
            <Cifra v={inv ? String(senaladasSalientes.length) : tr ? String(salientes.length) : null} />
          </Ind>
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
        {/* POR QUÉ LA BANDA NO COINCIDE CON EL PUNTAJE.
            Sin esta explicación, un lector ve "RIESGO ALTO" arriba de un
            "Puntaje: 3" y no sabe a cuál de los dos creerle — que es peor que
            cualquiera de los dos solo. */}
        {lectura.elevada && (
          <p style={{ fontSize: 10, margin: '0 0 7px', lineHeight: 1.6, color: T.suave,
                      borderLeft: `3px solid ${T.ambar}`, paddingLeft: 9 }}>
            <b style={{ color: T.tinta }}>Sobre el puntaje:</b> {lectura.motivo} Por eso el nivel de
            riesgo de este reporte es <b style={{ color: T.tinta }}>{b.t.replace('RIESGO ', '').toLowerCase()}</b>{' '}
            y no el que sugiere el puntaje{d.puntaje != null ? ` de ${d.puntaje}` : ''}. El número del
            proveedor se muestra sin alterar.
          </p>
        )}
        {/* LOS MONTOS SALEN DE `investigacion`, NO DEL RASTREO.
            Antes esta línea solo sabía sumar si alguien había apretado
            "Rastrear intermediarios" antes de imprimir; si no, decía "no se
            pudo obtener el detalle" con el detalle ya en la mano. */}
        <p style={{ fontSize: 10.5, margin: 0, lineHeight: 1.7 }}>
          {contactos.length ? (
            <>La dirección operó con <b>{contactos.length}</b> {contactos.length === 1 ? 'contraparte' : 'contrapartes'}:
              recibió <b>{n(montoEntrante) ?? '—'}</b> y envió <b>{n(montoSaliente) ?? '—'}</b>.{' '}
              {(senaladasEntrantes.length || senaladasSalientes.length)
                ? <span style={{ color: T.rojo, fontWeight: 700 }}>
                    De esas, {senaladasEntrantes.length} {senaladasEntrantes.length === 1 ? 'fuente entrante está señalada' : 'fuentes entrantes están señaladas'}{' '}
                    y {senaladasSalientes.length} {senaladasSalientes.length === 1 ? 'destino está señalado' : 'destinos están señalados'}.{' '}
                  </span>
                : <>Ninguna de ellas aparece señalada por el proveedor.{' '}</>}
            </>
          ) : tr ? (
            <>La dirección analizada recibió <b>{n(sum(entrantes)) ?? '—'}</b> desde fuentes señaladas
              y envió <b>{n(sum(salientes)) ?? '—'}</b> hacia destinos señalados.{' '}</>
          ) : (
            <>No hay detalle de transacciones con contrapartes (ver el motivo en la sección 2).{' '}</>
          )}
          {ex?.items?.length
            ? <>Se identificaron <b>{ex.items.length}</b> {ex.items.length === 1 ? 'vínculo' : 'vínculos'} con
                entidades de riesgo{ex.saltoMinimo != null && ex.saltoMinimo < 99
                  ? `, el más cercano a ${ex.saltoMinimo} ${ex.saltoMinimo === 1 ? 'salto' : 'saltos'}` : ''}.{' '}</>
            : senalada
              ? <>El proveedor no reportó vínculos con <i>terceras</i> entidades de riesgo, lo cual es
                 habitual cuando el señalamiento recae sobre la dirección misma: no la hace menos
                 riesgosa.{' '}</>
              : <>El proveedor no reportó vínculos con entidades de riesgo.{' '}</>}
        </p>

        {/* ── QUÉ HACER CON ESTO ──
            El reporte describía y no concluía. Quien lo lee tiene que decidir si
            recibe plata de esta dirección o le manda, y esa decisión no estaba
            escrita en ningún lado. */}
        <div style={{ marginTop: 10, border: `1.5px solid ${b.bg === T.fondo ? T.linea : b.bg}`, padding: '10px 12px' }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: T.suave, margin: '0 0 5px', letterSpacing: '0.4px' }}>
            QUÉ IMPLICA
          </p>
          <p style={{ fontSize: 10.5, margin: 0, lineHeight: 1.65 }}>
            {lectura.categoria === 'alto' ? (
              <><b style={{ color: T.rojo }}>No operar con esta dirección.</b> Un exchange o un banco
                que corra este mismo análisis va a ver lo mismo. Los fondos que pasen por acá quedan
                expuestos a congelamiento, y el titular que los reciba queda obligado a explicar su
                origen. Si ya hubo una operación, conviene documentarla antes de que la pregunten.</>
            ) : lectura.categoria === 'medio' ? (
              <><b style={{ color: T.ambar }}>Revisión manual antes de operar.</b> Hay señalamientos
                que no alcanzan para descartar la dirección pero sí para pedir el origen de los fondos
                y dejarlo por escrito.</>
            ) : lectura.categoria === 'bajo' ? (
              <>Sin señalamientos en la información disponible hoy. <b>No es una garantía:</b> una
                dirección limpia hoy puede aparecer señalada mañana, y este reporte no vuelve a
                consultarse solo. Para eso está el monitoreo.</>
            ) : (
              <><b>No hay clasificación.</b> Que no haya resultado no significa que la dirección esté
                limpia: significa que no sabemos. Tratala como no verificada.</>
            )}
          </p>
          {/* NUNCA se afirma que algo está bloqueado. Lincoin no bloquea nada y
              este proveedor tampoco: decir "fondos bloqueados" sería inventar un
              hecho sobre plata ajena. */}
          <p style={{ fontSize: 9, color: T.suave, margin: '6px 0 0', lineHeight: 1.55, fontStyle: 'italic' }}>
            Este reporte no bloquea ni congela nada, y no informa fondos bloqueados: Lincoin no tiene
            control sobre esta dirección. Describe exposición para que la decisión la tome quien opera.
          </p>
        </div>

        {/* ── 2. Contactos directos ──
            ESTA SECCIÓN MOSTRABA SOLO LAS RUTAS RASTREADAS e ignoraba
            `investigacion`, que ya viene con el reporte y trae direcciones,
            montos y hashes de TODAS las contrapartes — no solo las señaladas.
            Se pedía, se pagaba (USD 1,00), se guardaba, y no se dibujaba: el
            reporte decía "no se pudo obtener la investigación" con la
            investigación adentro. */}
        <h2 style={H}>2. Contactos directos: quién interactuó con quién</h2>
        {contactos.length ? (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>FLUJO</th><th style={th}>CONTRAPARTE</th>
                <th style={th}>QUIÉN ES</th><th style={th}>LECTURA AML</th>
                <th style={th}>MONTO</th><th style={th}>TXS</th>
              </tr></thead>
              <tbody>
                {contactos.slice(0, 30).map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 700, color: T.azul, fontSize: 9 }}>
                      {r.entrante ? 'Recibió de' : 'Envió a'}
                    </td>
                    <td style={{ ...td, fontFamily: MONO, fontSize: 8.5, color: r.senalada ? T.rojo : T.tinta, fontWeight: r.senalada ? 700 : 400 }}>
                      {corta(r.direccion)}
                    </td>
                    <td style={{ ...td, fontSize: 9 }}>{r.etiqueta ?? '—'}</td>
                    <td style={{ ...td, fontSize: 9, color: r.senalada ? T.rojo : T.suave }}>
                      {r.senalada
                        ? (r.entrante ? 'Fuente entrante SEÑALADA' : 'Destino SEÑALADO')
                        : r.tipo === 'contrato' ? 'Contrato'
                        : r.tipo === 'entidad' ? 'Entidad identificada'
                        : 'Sin señalamiento'}
                    </td>
                    <td style={td}>{n(r.monto) ?? '—'}</td>
                    <td style={td}>{r.txs ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {contactos.length > 30 && (
              <p style={{ fontSize: 9, color: T.suave, margin: '6px 0 0' }}>
                Se muestran las 30 primeras de {contactos.length}
                {inv?.paginas > 1 ? `, y el proveedor reporta ${inv.paginas} páginas de contrapartes en total` : ''}.
              </p>
            )}
          </>
        ) : directos.length ? (
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
        ) : <PorQueVacio f={fu?.investigacion} que="la investigación de transacciones" />}

        {/* ── 2b. Contrapartes por monto (address_counterparty) ──
            Otra consulta que se paga (USD 0,50) y no se dibujaba. Es el
            "con quién opera y por cuánta plata", agrupado por entidad. */}
        {cp?.items?.length ? (
          <>
            <h2 style={H}>2b. Contrapartes por volumen</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>CONTRAPARTE</th><th style={th}>MONTO (USD)</th><th style={th}>% DEL VOLUMEN</th>
              </tr></thead>
              <tbody>
                {cp.items.map((x: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 700 }}>{x.nombre ?? '—'}</td>
                    <td style={td}>{n(x.montoUsd) ?? '—'}</td>
                    <td style={td}>{x.pct != null ? `${x.pct} %` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : cp?.noSoportada ? (
          <>
            <h2 style={H}>2b. Contrapartes por volumen</h2>
            <Vacio>
              El proveedor no analiza contrapartes para este tipo de dirección (la reporta como
              billetera caliente de un servicio). No es una falla de la consulta ni ausencia de
              actividad.
            </Vacio>
          </>
        ) : null}

        {/* ── 2c. Quién es esta dirección ──
            address_labels y address_trace: dos consultas más que se pagan
            (USD 0,10 y USD 0,50) y que el reporte no dibujaba. Son lo que
            convierte una cadena de 34 caracteres en algo que un oficial de
            cumplimiento puede nombrar en un informe. */}
        {(d.etiquetas?.length || d.etiquetaProveedor || perfil) && (
          <>
            <h2 style={H}>2c. Identidad y trayectoria de la dirección</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {(d.etiquetaProveedor || d.etiquetas?.length) && (
                  <tr>
                    <td style={{ ...td, width: 175, fontWeight: 700, background: T.fondo }}>Etiquetas del proveedor</td>
                    <td style={td}>
                      {[d.etiquetaProveedor, ...textos(d.etiquetas)].filter(Boolean)
                        .filter((v, i, a) => a.indexOf(v) === i).join(' · ')}
                    </td>
                  </tr>
                )}
                {perfil?.primeraFuente && (
                  <tr>
                    <td style={{ ...td, fontWeight: 700, background: T.fondo }}>Primer origen de fondos</td>
                    <td style={{ ...td, fontFamily: MONO, fontSize: 8.5 }}>{perfil.primeraFuente}</td>
                  </tr>
                )}
                {listas(perfil?.plataformas).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...td, fontWeight: 700, background: T.fondo }}>{ROT[k] ?? k}</td>
                    <td style={td}>{v.join(' · ')}</td>
                  </tr>
                ))}
                {/* Los eventos maliciosos van en rojo: no son "otra fila más". */}
                {listas(perfil?.eventos).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...td, fontWeight: 700, background: T.fondo, color: T.rojo }}>{ROT[k] ?? k}</td>
                    <td style={{ ...td, color: T.rojo, fontWeight: 700 }}>{v.join(' · ')}</td>
                  </tr>
                ))}
                {listas(perfil?.relaciones).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...td, fontWeight: 700, background: T.fondo }}>{ROT[k] ?? k}</td>
                    <td style={td}>{v.join(' · ')}</td>
                  </tr>
                ))}
                {d.hackingEvent && (
                  <tr>
                    <td style={{ ...td, fontWeight: 700, background: T.fondo, color: T.rojo }}>Incidente asociado</td>
                    <td style={{ ...td, color: T.rojo, fontWeight: 700 }}>{d.hackingEvent}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {!perfil && <div style={{ marginTop: 6 }}><PorQueVacio f={fu?.perfil} que="la trayectoria de la dirección" /></div>}
          </>
        )}

        {/* ── 2d. En qué usa su volumen (address_action) ──
            La séptima consulta que se paga y no se dibujaba. No es exposición a
            riesgo —eso sale de risk_detail— es en qué gasta y de dónde recibe. */}
        {comp && (
          <>
            <h2 style={H}>2d. Comportamiento de la dirección</h2>
            <div className="flex" style={{ gap: 14, flexWrap: 'wrap' }}>
              {([['recibido', 'DE DÓNDE RECIBE'], ['enviado', 'A DÓNDE ENVÍA']] as const).map(([k, rot]) =>
                comp[k]?.length ? (
                  <div key={k} style={{ flex: '1 1 260px' }}>
                    <p style={{ fontSize: 8.5, fontWeight: 700, color: T.suave, margin: '0 0 4px' }}>{rot}</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {comp[k].map((x: any, i: number) => (
                          <tr key={i}>
                            <td style={{ ...td, fontSize: 9 }}>{x.accion}</td>
                            <td style={{ ...td, fontSize: 9, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {x.pct != null ? `${x.pct.toFixed(1)} %` : '—'}
                              {x.veces != null ? ` · ${x.veces} tx` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null,
              )}
            </div>
          </>
        )}

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
            {/* Acá faltaban LAS DIRECCIONES, que es lo que se vino a buscar:
                la tabla nombraba la entidad ("htx", "nobitex.ir") y la
                distancia, pero no decía en qué wallet estaba ni por dónde se
                llegaba. Con hop_dic el proveedor manda el camino entero, así
                que cada fila puede mostrar la dirección señalada y los
                intermediarios reales. Cuando no lo manda, se dice. */}
            <p style={{ fontSize: 10.5, margin: '0 0 7px', lineHeight: 1.65 }}>
              {ex.items.some((i: any) => Array.isArray(i.camino) && i.camino.length)
                ? <>El análisis de riesgo reporta estos vínculos con su camino, distancia y volumen:</>
                : <>El análisis de riesgo reporta estos vínculos con su distancia y volumen. El proveedor
                   no devolvió las direcciones del camino para esta consulta, así que las columnas de
                   wallets van vacías:</>}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>ENTIDAD SEÑALADA</th><th style={th}>WALLET SEÑALADA</th>
                <th style={th}>PASA POR</th><th style={th}>TIPO</th>
                <th style={th}>EXPOSICIÓN</th><th style={th}>DISTANCIA</th><th style={th}>VOLUMEN</th>
              </tr></thead>
              <tbody>
                {ex.items.map((it: any, i: number) => {
                  const camino: any[] = Array.isArray(it.camino) ? it.camino : [];
                  // Salto 1 = la entidad señalada. Último salto = la analizada.
                  const wallets: string[] = camino[0]?.direcciones ?? [];
                  const medios: string[] = camino.slice(1, -1).flatMap((nv: any) => nv.direcciones ?? []);
                  return (
                    <tr key={i}>
                      <td style={{ ...td, color: T.rojo, fontWeight: 700 }}>{it.entidad ?? '—'}</td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 8.5, color: T.rojo }}>
                        {wallets.length
                          ? <>{corta(wallets[0])}{wallets.length > 1 ? ` +${wallets.length - 1}` : ''}</>
                          : '—'}
                      </td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 8.5 }}>
                        {medios.length
                          ? <>{medios.slice(0, 2).map(corta).join(' → ')}{medios.length > 2 ? ` +${medios.length - 2}` : ''}</>
                          : (camino.length ? 'directo' : '—')}
                      </td>
                      <td style={td}>{it.tipoEs ?? '—'}</td>
                      <td style={td}>{it.exposicion === 'direct' ? 'Directa' : it.exposicion === 'indirect' ? 'Indirecta' : '—'}</td>
                      <td style={td}>{it.saltos != null ? `${it.saltos} saltos` : '—'}</td>
                      <td style={td}>
                        {n(it.volumen) ?? '—'}
                        {it.pct != null ? <><br /><span style={{ fontSize: 8, color: T.suave }}>{it.pct} % del volumen</span></> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Las direcciones completas, para poder copiarlas y pegarlas en un
                explorador. Cortadas no sirven para verificar nada. */}
            {(() => {
              const todas = Array.from(new Set(
                ex.items.flatMap((it: any) => (Array.isArray(it.camino) ? it.camino : [])
                  .flatMap((nv: any) => nv.direcciones ?? [])),
              )) as string[];
              if (!todas.length) return null;
              return (
                <div style={{ marginTop: 8, border: `1px solid ${T.linea}`, padding: '8px 10px', background: T.fondo }}>
                  <p style={{ fontSize: 8.5, fontWeight: 700, color: T.suave, margin: '0 0 5px' }}>
                    DIRECCIONES DEL CAMINO, COMPLETAS
                  </p>
                  {todas.slice(0, 20).map((a: string, i: number) => (
                    <p key={i} style={{ fontFamily: MONO, fontSize: 8.5, margin: '2px 0', wordBreak: 'break-all', color: T.tinta }}>{a}</p>
                  ))}
                </div>
              );
            })()}
          </>
        ) : senalada ? (
          // Una dirección señalada ELLA MISMA normalmente no tiene rutas hacia
          // terceros. Decir "no se identificaron rutas" a secas, debajo de
          // "Sospecha de dirección maliciosa", se lee como un atenuante.
          <Vacio>
            No se identificaron rutas hacia <i>terceras</i> entidades señaladas. En una dirección que
            ya está señalada ella misma esto es habitual y no la hace menos riesgosa: el hallazgo es
            sobre ella, no sobre su entorno.
          </Vacio>
        ) : <PorQueVacio f={fu?.investigacion} que="rutas indirectas" />}

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
        ) : contactos.filter(x => x.senalada).length ? (
          // Hay contrapartes señaladas aunque no se haya corrido el rastreo:
          // se rankean por monto, que es la información que sí tenemos.
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>#</th><th style={th}>DIRECCIÓN SEÑALADA</th>
              <th style={th}>QUIÉN ES</th><th style={th}>FLUJO</th>
              <th style={th}>MONTO</th><th style={th}>TXS</th>
            </tr></thead>
            <tbody>
              {contactos.filter(x => x.senalada).slice(0, 25).map((x: any, i: number) => (
                <tr key={i}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 8.5, color: T.rojo, fontWeight: 700 }}>{corta(x.direccion)}</td>
                  <td style={td}>{x.etiqueta ?? '—'}</td>
                  <td style={{ ...td, fontWeight: 700, color: T.azul, fontSize: 9 }}>
                    {x.entrante ? 'Le envió fondos' : 'Recibió fondos'}
                  </td>
                  <td style={td}>{n(x.monto) ?? '—'}</td>
                  <td style={td}>{x.txs ?? '—'}</td>
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

        {/* ── Qué se consultó y qué contestó cada fuente ──
            Va al final, chico, y no es relleno: cuando el reporte sale con
            secciones vacías, esto es lo único que distingue "no hay nada que
            reportar" de "el plan contratado no incluye ese endpoint". Sin esta
            tabla, las dos cosas se ven igual — y la segunda se arregla, la
            primera no. */}
        {fu && (
          <div style={{ marginTop: 18, breakInside: 'avoid' }}>
            <p style={{ fontSize: 8.5, fontWeight: 700, color: T.suave, margin: '0 0 5px', letterSpacing: '0.4px' }}>
              FUENTES CONSULTADAS
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {Object.entries(fu).map(([k, v]: [string, any]) => (
                  <tr key={k}>
                    <td style={{ ...td, fontSize: 9, width: 150, textTransform: 'capitalize' }}>{k}</td>
                    <td style={{ ...td, fontSize: 9, width: 90, color: v?.ok ? T.verde : T.rojo, fontWeight: 700 }}>
                      {v?.status === 0 ? 'sin conexión' : `HTTP ${v?.status}`}
                    </td>
                    <td style={{ ...td, fontSize: 9, width: 90 }}>
                      {v?.conDatos ? 'con datos' : 'sin datos'}
                    </td>
                    <td style={{ ...td, fontSize: 9, color: T.suave }}>{v?.motivo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
