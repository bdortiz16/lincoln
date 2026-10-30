// ══════════════════════════════════════════════════════════════════
//  Contabilidad · Dashboard — Lincoin Empresas
//
//  El libro de la cuenta: cuánto entró, cuánto salió, cuánto quedó, y cada
//  movimiento con su comprobante. La pregunta es la de un contador: qué pasó
//  con la plata este mes. Por eso también está a quién se le envió y de quién
//  se recibió (cuánto, cuántas veces, mes a mes) y el estado de cuenta del
//  periodo con su saldo inicial y final, en pantalla, en PDF y en el Excel.
//  El modelo (asientos, terceros, saldos) vive en libroContable.ts.
//
//  POR MONEDA, SIEMPRE. La cuenta tiene pesos y dólares, y no se suman: un
//  neto que mezcle COP con USD es un número inventado. Arriba hay un selector
//  de moneda y todo lo demás obedece.
//
//  UNA CONVERSIÓN ES DOS ASIENTOS. Cambiar COP a USD es una salida en pesos y
//  una entrada en dólares. Se registra así, en cada moneda lo suyo, porque
//  es lo que pasó.
//
//  CUENTA LO COMPLETADO Y LO PROCESANDO: la plata ya salió (o ya entró). Lo
//  rechazado se lista tachado y no suma. Un comprobante solo existe para lo
//  Completado: lo emite el servidor apenas la operación se completa.
//
//  LOS COLORES: entrada verde, salida blanca, y gris para lo que no cuenta.
//  Validados contra la tarjeta oscura (ΔE 16 en daltonismo, 24 en visión
//  normal entre las dos series). Todo valor está además en texto, en la
//  tabla o en el tooltip: el color acompaña, no carga el dato solo.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { llamarFuncion } from '../lib/edge';
import { useDatabase } from '../context/DatabaseContext';
import { descargarXlsx, refCelda, type CeldaX, type Estilo, type Hoja } from '../lib/xlsx';
import { FacturacionConfig } from './FacturacionConfig';
import { AccesoContadorModal } from './AccesoContadorModal';
import { EstadoCuentaHoja } from './EstadoCuentaHoja';
import {
  ENTRA, MESES, MESES_L, SALE, asientosDe, claveTercero, cuenta, datosTercero, efecto, esDeTercero, estadoDeCuenta, fichaDeUsuario, fmtMon, terceros,
  type Asiento, type Dir, type FichaEmpresa, type Moneda, type Tercero,
} from './libroContable';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', medio: '#b9beba',
  entra: '#4ADE80', sale: '#F4F4F2', neutro: 'rgba(255,255,255,0.15)',
  guia: 'rgba(255,255,255,0.05)', hover: 'rgba(255,255,255,0.02)',
  tooltipFondo: '#161A17', tooltipBorde: 'rgba(255,255,255,0.14)',
};

export type Periodo = 'mes' | 'anio' | 'historico';

const fmtCorto = (v: number, m: Moneda) => {
  if (m === 'COP' && Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: Math.abs(v) >= 100e6 ? 0 : 1 })} M`;
  return v.toLocaleString('es-CO', { maximumFractionDigits: m === 'COP' ? 0 : 2 });
};

type Props = {
  transactions: any[];
  userId?: string | null;
  onVerMovimiento?: (tx: any) => void;
  /** Modo contador: la misma pantalla, sin nada que escriba. Los comprobantes
   *  llegan de afuera (el servidor los entrega tras verificar el vínculo). */
  soloLectura?: boolean;
  comprobantesExternos?: any[] | null;
  /** Datos del titular para la ficha y el estado de cuenta. Sin esto se
   *  toman de la sesión (cuando la empresa mira su propia contabilidad). */
  empresa?: FichaEmpresa | null;
};

// ── Factura de comisión por un depósito (modelo PSP) ─────────────────
// El depósito no se factura por el monto: se factura la COMISIÓN, con IVA
// incluido dentro del porcentaje, al cliente que mandó la plata. Ese cliente
// hay que elegirlo (por eso es a mano): se busca en el Siigo del usuario o
// se escribe. El cálculo de acá es el mismo que hace el servidor.
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtCop2 = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CAMPO: React.CSSProperties = { fontFamily: FONT, width: '100%', fontSize: 13.5, color: C.text, background: '#121413', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 11px', outline: 'none' };
const pctDeCfg = (cfg: any) => (cfg?.utilidad_pct != null && cfg.utilidad_pct !== '' ? String(cfg.utilidad_pct) : '');

type ClienteFactura = { identification: string; nombre: string; esEmpresa: boolean };
// El ordenante del envío (el cliente por cuenta de quien se pagó), si se
// eligió al enviar: la factura de la comisión va a su nombre.
// Documento sin dígito de verificación: un NIT llega con o sin DV. Sirve para
// reconocer a la misma empresa, que no se factura a sí misma.
const baseDoc = (s: unknown) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length === 10 ? d.slice(0, 9) : d; };

const ordenanteDe = (tx: any): ClienteFactura | null => {
  const o: any = tx?.recipient?.ordenante ?? tx?.raw_data?.recipient?.ordenante ?? tx?.ordenante ?? null;
  const doc = String(o?.doc ?? '').replace(/\D/g, '');
  return doc ? { identification: doc, nombre: String(o?.nombre ?? ''), esEmpresa: String(o?.docTipo ?? '') === 'NIT' } : null;
};

// A quién se le factura: un ordenante de Configuración con un clic, uno
// buscado en el Siigo del usuario, o uno escrito (se crea en Siigo al
// emitir). Lo usan la factura de un movimiento y la emisión en lote.
const SelectorCliente: React.FC<{ inicial?: ClienteFactura | null; notaInicial?: string; onCambio: (c: ClienteFactura | null) => void }> = ({ inicial = null, notaInicial, onCambio }) => {
  const { currentUser } = useDatabase();
  const cuU: any = currentUser ?? {};
  const listaOrd = Array.isArray(cuU?.raw_data?.ordenantes) ? cuU.raw_data.ordenantes : Array.isArray(cuU?.ordenantes) ? cuU.ordenantes : [];
  const ordenantes: { id: string; nombre: string; docTipo: string; doc: string }[] = listaOrd.filter((o: any) => o && o.doc);
  const [cliente, setCliente] = useState<ClienteFactura | null>(inicial);
  const [q, setQ] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<any[] | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [manual, setManual] = useState<{ doc: string; nombre: string; esEmpresa: boolean }>({ doc: '', nombre: '', esEmpresa: true });
  const docManual = manual.doc.replace(/\D/g, '');
  const elegido: ClienteFactura | null = cliente ?? (docManual.length >= 5 ? { identification: docManual, nombre: manual.nombre.trim(), esEmpresa: manual.esEmpresa } : null);
  const clave = elegido ? `${elegido.identification}|${elegido.nombre}|${elegido.esEmpresa}` : '';
  useEffect(() => { onCambio(elegido); }, [clave]); // eslint-disable-line react-hooks/exhaustive-deps
  const buscar = async () => {
    if (!q.trim()) return;
    setBuscando(true); setErrorBusqueda(null); setResultados(null);
    const r = await llamarFuncion('facturacion', { action: 'buscar_clientes', q: q.trim() }, 60000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setBuscando(false);
    if (!r?.ok) { setErrorBusqueda(r?.error ?? 'No se pudo buscar.'); return; }
    setResultados(r.clientes ?? []);
  };
  return (
    <>
      {inicial && cliente && notaInicial && inicial.identification === cliente.identification && (
        <p style={{ fontSize: 11.5, color: C.entra, margin: '0 0 6px' }}>{notaInicial}</p>
      )}
      {!cliente && ordenantes.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 11.5, color: C.sub, margin: '0 0 6px' }}>Tus ordenantes:</p>
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            {ordenantes.map(o => (
              <button key={o.id ?? o.doc} onClick={() => setCliente({ identification: String(o.doc).replace(/\D/g, ''), nombre: o.nombre, esEmpresa: o.docTipo === 'NIT' })}
                style={{ fontFamily: FONT, textAlign: 'left', fontSize: 12.5, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '7px 11px', cursor: 'pointer' }}>
                <b>{o.nombre}</b> <span style={{ color: C.sub }}>· {o.docTipo} {o.doc}</span>
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: C.sub, margin: '10px 0 0' }}>O busca otro cliente:</p>
        </div>
      )}
      {cliente ? (
        <div className="flex items-center justify-between" style={{ gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.06)' }}>
          <span style={{ fontSize: 13, color: C.text }}><b>{cliente.nombre || cliente.identification}</b> · {cliente.esEmpresa ? 'NIT' : 'CC'} {cliente.identification}</span>
          <button onClick={() => setCliente(null)} style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: 'none', cursor: 'pointer' }}>Cambiar</button>
        </div>
      ) : (
        <>
          <div className="flex" style={{ gap: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') buscar(); }} placeholder="Buscar en tu Siigo por NIT o nombre" style={CAMPO} />
            <button onClick={buscar} disabled={buscando || !q.trim()} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '0 14px', cursor: 'pointer', opacity: buscando || !q.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>{buscando ? '…' : 'Buscar'}</button>
          </div>
          {errorBusqueda && <p style={{ fontSize: 11.5, color: '#F87171', margin: '6px 0 0' }}>{errorBusqueda}</p>}
          {resultados && (
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.borde}`, borderRadius: 10 }}>
              {resultados.length === 0 && <p style={{ fontSize: 12, color: C.tenue, margin: 0, padding: '10px 12px' }}>Siigo no devolvió clientes con eso. Escribilo abajo y se crea en Siigo al emitir.</p>}
              {resultados.map((c: any, i: number) => (
                <button key={`${c.identification}-${i}`} onClick={() => setCliente({ identification: c.identification, nombre: c.nombre, esEmpresa: !!c.esEmpresa })}
                  className="w-full text-left hover:bg-white/[0.05] transition-colors" style={{ display: 'block', padding: '9px 12px', borderTop: i ? `1px solid ${C.borde}` : 'none', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{c.nombre || c.comercial || c.identification}</span>
                  <span style={{ fontSize: 11.5, color: C.sub, marginLeft: 8 }}>{c.esEmpresa ? 'NIT' : 'CC'} {c.identification}{c.activo === false ? ' · inactivo' : ''}</span>
                </button>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11.5, color: C.sub, margin: '10px 0 6px' }}>O escribilo (si no existe en Siigo, se crea al emitir):</p>
          <div className="grid grid-cols-3 gap-2">
            <input value={manual.doc} onChange={e => setManual(m => ({ ...m, doc: e.target.value }))} placeholder={manual.esEmpresa ? 'NIT (9 dígitos)' : 'Cédula'} inputMode="numeric" style={CAMPO} />
            <input value={manual.nombre} onChange={e => setManual(m => ({ ...m, nombre: e.target.value }))} placeholder={manual.esEmpresa ? 'Razón social' : 'Nombre completo'} style={{ ...CAMPO, gridColumn: 'span 2' }} />
          </div>
          <label className="flex items-center" style={{ gap: 8, marginTop: 8, fontSize: 12.5, color: C.sub, cursor: 'pointer' }}>
            <input type="checkbox" checked={manual.esEmpresa} onChange={e => setManual(m => ({ ...m, esEmpresa: e.target.checked }))} style={{ accentColor: C.entra }} /> Es empresa (NIT)
          </label>
        </>
      )}
    </>
  );
};

const FacturaComisionModal: React.FC<{ asiento: Asiento; cfg: any; onCerrar: () => void; onEmitida: () => void }> = ({ asiento, cfg, onCerrar, onEmitida }) => {
  const monto = Number(asiento.monto) || 0;
  const [pct, setPct] = useState<string>(pctDeCfg(cfg));
  // Si el envío ya trae su ordenante (se eligió al enviar), viene puesto.
  const ordTx = useMemo(() => ordenanteDe(asiento.tx), [asiento.tx]);
  const [elegido, setElegido] = useState<ClienteFactura | null>(ordTx);
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  // El IVA del ítem de comisión, tal como está en Siigo (o el elegido en Configuración).
  const item = String(cfg?.item_comision ?? '');
  const prod = (cfg?.catalogos?.productos ?? []).find((p: any) => String(p.code) === item) ?? null;
  const taxes: any[] = prod?.taxes ?? [];
  const conValor = taxes.filter(t => (Number(t.percentage) || 0) > 0);
  const ivaProd = conValor.find(t => /iva/i.test(String(t.name ?? ''))) ?? conValor[0] ?? null;
  const ivaElegido = cfg?.iva_tax_id ? (cfg?.catalogos?.impuestos ?? []).find((t: any) => String(t.id) === String(cfg.iva_tax_id)) : null;
  const iva = ivaProd ?? ivaElegido ?? null;
  const tarifa = iva ? (Number(iva.percentage) || 0) / 100 : 0;
  const p = Number(String(pct).replace(',', '.')) || 0;
  const comision = r2(monto * p / 100);
  const base = r2(comision / (1 + tarifa));
  const ivaV = r2(base * tarifa);
  // Modelo Comisión = factura de mandato: ítem 1 ingresos para terceros por
  // el monto completo transferido (sin IVA) + ítem 2 comisión con IVA
  // incluido. El total es el monto más la comisión.
  const mandato = String(cfg?.modelo ?? '') === 'comision';
  const itemTerceros = String(cfg?.item_terceros ?? '');
  const prodTerceros = (cfg?.catalogos?.productos ?? []).find((x: any) => String(x.code) === itemTerceros) ?? null;
  const terceros = mandato ? r2(monto) : 0;
  const total = r2(terceros + base + ivaV);
  const faltaItem = !item || (mandato && !itemTerceros);
  const emitir = async () => {
    if (!elegido || !(p > 0) || faltaItem) return;
    setEmitiendo(true); setResultado(null);
    const r = await llamarFuncion('facturacion', { action: 'emitir_comision', transactionId: String(asiento.tx.id), clienteIdentification: elegido.identification, clienteNombre: elegido.nombre, clienteEsEmpresa: elegido.esEmpresa, comisionPct: p }, 130000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setEmitiendo(false);
    if (!r?.ok) { setResultado({ ok: false, texto: r?.error ?? 'No se pudo emitir.' }); return; }
    // «No aplica» (p. ej. el cliente es la misma empresa): no se emitió nada.
    if (r.estado === 'omitida') { setResultado({ ok: false, texto: r.aviso ?? 'No se emitió: este movimiento no lleva factura.' }); return; }
    setResultado({ ok: true, texto: `Factura ${r.numero ?? ''} emitida por ${fmtCop2(Number(r.total ?? total))} COP.${r.aviso ? ` ${r.aviso}` : ''}` });
    setTimeout(onEmitida, 900);
  };
  const fila = (l: string, v: string, fuerte = false) => (
    <div className="flex items-center justify-between" style={{ padding: '6px 0', borderTop: `1px solid ${C.borde}` }}>
      <span style={{ fontSize: 12.5, color: fuerte ? C.text : C.sub, fontWeight: fuerte ? 800 : 400 }}>{l}</span>
      <span style={{ fontSize: 12.5, color: C.text, fontWeight: fuerte ? 800 : 600, fontFamily: 'ui-monospace, monospace' }}>{v}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[110] p-4" style={{ background: 'rgba(4,5,4,0.85)', display: 'grid', placeItems: 'center' }} onClick={onCerrar}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', background: '#0C0E0D', border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 18, fontFamily: FONT, padding: '20px 22px' }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Factura de comisión</p>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{asiento.tipo} · {asiento.contraparte || '—'} · {fmtCop2(monto)} COP</p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.borde}`, background: 'transparent', color: C.sub, fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>

        <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '18px 0 6px' }}>A QUIÉN SE LE FACTURA</p>
        <SelectorCliente inicial={ordTx} notaInicial="Ordenante elegido al hacer el envío." onCambio={setElegido} />

        <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '18px 0 6px' }}>COMISIÓN (% SOBRE {asiento.dir === 'in' ? 'EL DEPÓSITO' : 'EL MOVIMIENTO'}, IVA INCLUIDO)</p>
        <div className="flex items-center" style={{ gap: 10 }}>
          <input type="number" min={0} max={100} step={0.01} value={pct} onChange={e => setPct(e.target.value)} placeholder="0,6" inputMode="decimal" style={{ ...CAMPO, width: 120 }} />
          <span style={{ fontSize: 12, color: C.sub }}>{cfg?.utilidad_pct ? `Configurado: ${cfg.utilidad_pct} %` : 'Ponelo en Configuración para no escribirlo cada vez'}</span>
        </div>
        {!item && <p style={{ fontSize: 11.5, color: '#F59E0B', margin: '8px 0 0' }}>Falta elegir en Configuración el ítem de comisión (con IVA). Sin eso no se puede emitir.</p>}
        {mandato && !itemTerceros && <p style={{ fontSize: 11.5, color: '#F59E0B', margin: '8px 0 0' }}>Falta elegir en Configuración el ítem de ingresos recibidos para terceros (sin IVA). Sin eso no se puede emitir.</p>}
        <div style={{ marginTop: 12 }}>
          {fila(`Comisión ${p || 0} % sobre ${fmtCop2(monto)}`, `${fmtCop2(comision)} COP`, true)}
          {mandato && fila(`1 · Ingresos recibidos para terceros (${prodTerceros?.name ?? (itemTerceros || 'ítem sin IVA')}) · sin IVA`, `${fmtCop2(terceros)} COP`)}
          {fila(`${mandato ? '2 · Comisión, base gravable' : 'Base gravable'} (${prod?.name ?? (item || 'ítem de comisión')})`, `${fmtCop2(base)} COP`)}
          {fila(iva ? `${iva.name || 'IVA'} ${iva.percentage} %` : 'IVA (el ítem no tiene impuesto en Siigo)', `${fmtCop2(ivaV)} COP`)}
          {fila('Total de la factura', `${fmtCop2(total)} COP`, true)}
        </div>
        {mandato && <p style={{ fontSize: 11, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>Factura de mandato: el valor transferido completo ({fmtCop2(monto)} COP) más tu comisión (base + IVA) = {fmtCop2(total)} COP. Los ingresos para terceros no son ingreso propio y van sin IVA.</p>}
        <p style={{ fontSize: 11, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>La comisión no es {fmtCop2(comision)} + IVA: la base se calcula para que base + IVA dé la comisión. Siigo liquida el IVA con la tarifa del ítem; puede haber un centavo de redondeo.</p>

        {resultado && <p style={{ fontSize: 12.5, color: resultado.ok ? C.entra : '#F87171', margin: '12px 0 0', lineHeight: 1.5, wordBreak: 'break-word' }}>{resultado.texto}</p>}
        <div className="flex" style={{ gap: 9, marginTop: 16 }}>
          <button onClick={onCerrar} style={{ flex: 1, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.borde}`, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={emitir} disabled={emitiendo || !elegido || !(p > 0) || faltaItem} className="lincoin-btn-white"
            style={{ flex: 1.4, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', opacity: emitiendo || !elegido || !(p > 0) || faltaItem ? 0.45 : 1 }}>
            {emitiendo ? 'Emitiendo en Siigo…' : `Emitir factura por ${fmtCop2(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Emisión en lote ─────────────────────────────────────────────────
// Las facturas de los movimientos que quedaron sin ella. Se ENCOLAN en el
// servidor y Lincoin las emite una por una en segundo plano: se puede cerrar
// la ventana o la pantalla. (La primera versión emitía desde el navegador, y
// al cerrarse la pantalla en un lote de 144 se detuvo a mitad.) Una por una
// y no en paralelo: Siigo toma como duplicada una factura igual a otra de
// segundos antes, y el candado de cada comprobante impide emitir dos veces
// la misma. Cada envío va a nombre de su ordenante; los que no lo tienen, al
// cliente que se elija acá. Una anulada se vuelve a emitir al mismo cliente
// y con el mismo porcentaje. El servidor decide cada caso; esto es la vista.
type ModoLote = 'reemitir' | 'comision' | 'directo';
type ItemLote = { a: Asiento; txId: string; modo: ModoLote; ordenante: ClienteFactura | null };
type FacturaVivo = { estado: string | null; numero: string | null; error: string | null };
const ROJO = '#F87171', AMBAR = '#F59E0B';

const EmisionLoteModal: React.FC<{
  items: ItemLote[]; cfg: any; periodoTxt: string;
  /** El estado de cada factura según la última lectura de comprobantes, y
   *  cuántas lecturas van (para no confiar en una anterior a encolar). */
  vivo: Record<string, FacturaVivo | undefined>; lecturas: number;
  /** ¿El documento es de la misma empresa? No se factura a sí misma. */
  esPropio: (doc?: string | null) => boolean;
  onCerrar: () => void; onEncolado: () => void;
}> = ({ items, cfg, periodoTxt, vivo, lecturas, esPropio, onCerrar, onEncolado }) => {
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(items.map(i => i.txId)));
  const [pct, setPct] = useState<string>(pctDeCfg(cfg));
  const [cliente, setCliente] = useState<ClienteFactura | null>(null);
  // config: se elige · enviando: se encola en el servidor · cola: se mira el avance.
  const [fase, setFase] = useState<'config' | 'enviando' | 'cola'>('config');
  const [enviados, setEnviados] = useState<Set<string>>(() => new Set());
  const [rechazados, setRechazados] = useState<Record<string, string>>({});
  const [lecturaEnvio, setLecturaEnvio] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [deteniendo, setDeteniendo] = useState(false);
  const p = Number(String(pct).replace(',', '.')) || 0;
  const mandato = String(cfg?.modelo ?? '') === 'comision';
  const estadoDe = (txId: string) => vivo[txId]?.estado ?? null;
  const yaSalio = (i: ItemLote) => estadoDe(i.txId) === 'emitida';
  // Lo marcado que falta emitir: en una segunda vuelta (tras corregir el
  // cliente o el porcentaje) no se repiten las que ya salieron.
  const porEmitir = items.filter(i => marcados.has(i.txId) && !yaSalio(i));
  const nComision = porEmitir.filter(i => i.modo === 'comision').length;
  const sinOrdenante = porEmitir.filter(i => i.modo === 'comision' && !i.ordenante).length;
  const nReemitir = porEmitir.filter(i => i.modo === 'reemitir').length;
  const faltaItem = nComision > 0 && (!cfg?.item_comision || (mandato && !cfg?.item_terceros));
  const clientePropio = !!cliente && esPropio(cliente.identification);
  const listo = porEmitir.length > 0 && (sinOrdenante === 0 || (!!cliente && !clientePropio)) && (nComision === 0 || p > 0) && !faltaItem;
  // Lo que se va a facturar (solo lo calculable acá: las de comisión).
  const comisionDe = (i: ItemLote) => r2((Number(i.a.monto) || 0) * p / 100);
  const totalDe = (i: ItemLote) => r2((mandato ? Number(i.a.monto) || 0 : 0) + comisionDe(i));
  const sumaComision = porEmitir.filter(i => i.modo === 'comision').reduce((s, i) => s + comisionDe(i), 0);
  const sumaTotal = porEmitir.filter(i => i.modo === 'comision').reduce((s, i) => s + totalDe(i), 0);

  // El avance sale de los comprobantes: hasta que llega una lectura hecha
  // después de encolar, lo enviado se muestra "en cola".
  const fiable = lecturas > lecturaEnvio;
  type Fila = { rot: string; color: string; detalle?: string; mono?: boolean; cola?: boolean };
  const estadoFila = (i: ItemLote): Fila | null => {
    const v = vivo[i.txId];
    const e = v?.estado ?? null;
    if (fase === 'cola' && enviados.has(i.txId)) {
      if (rechazados[i.txId]) return { rot: 'no se encoló', color: ROJO, detalle: rechazados[i.txId] };
      if (!fiable) return { rot: 'en cola', color: C.sub, cola: true };
      if (e === 'en_cola') return /duplicad|esperar/i.test(v?.error ?? '') ? { rot: 'en espera', color: AMBAR, detalle: v?.error ?? undefined, cola: true } : { rot: 'en cola', color: C.sub, cola: true };
      if (e === 'emitiendo') return { rot: 'emitiendo…', color: C.text, cola: true };
    }
    if (e === 'emitida') return { rot: v?.numero ?? 'emitida', color: C.entra, mono: true };
    if (e === 'error' && (fase === 'cola' ? enviados.has(i.txId) : true)) return { rot: 'error', color: ROJO, detalle: v?.error ?? undefined };
    if (fase === 'cola' && enviados.has(i.txId)) return { rot: e === 'omitida' ? 'no aplica' : (e ?? 'sin estado'), color: C.sub, detalle: v?.error ?? undefined };
    return null;
  };
  const env = items.filter(i => enviados.has(i.txId));
  const filas = env.map(estadoFila);
  const nEmitidas = env.filter(i => yaSalio(i)).length;
  const nCola = filas.filter(f => f?.cola).length;
  const nError = filas.filter(f => f?.color === ROJO).length;
  const terminado = fase === 'cola' && fiable && nCola === 0;

  const encolar = async () => {
    if (!listo || fase !== 'config') return;
    setFase('enviando'); setAviso(null);
    const ids = porEmitir.map(i => i.txId);
    const r = await llamarFuncion('facturacion', { action: 'lote_encolar', transactionIds: ids, comisionPct: p, cliente }, 120000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!r?.ok) { setFase('config'); setAviso(r?.error ?? 'No se pudo poner en cola.'); return; }
    const rech: Record<string, string> = {};
    for (const o of (r.omitidos ?? []) as any[]) rech[String(o.id)] = String(o.motivo ?? 'No se encoló.');
    setRechazados(rech); setEnviados(new Set(ids)); setLecturaEnvio(lecturas); setFase('cola');
    if (Number(r.encolados) > 0 && !r.corriendo) setAviso('Quedaron en cola, pero la emisión no arrancó todavía. Se retoma sola en unos minutos.');
    onEncolado();
  };
  const detener = async () => {
    setDeteniendo(true);
    const r = await llamarFuncion('facturacion', { action: 'lote_cancelar' }, 60000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setDeteniendo(false);
    setAviso(r?.ok ? `Detenido. ${Number(r.cancelados) || 0} volvieron a como estaban (las que ya salieron quedan emitidas).` : (r?.error ?? 'No se pudo detener.'));
    onEncolado();
  };

  const alternar = (txId: string) => setMarcados(m => { const n = new Set(m); if (n.has(txId)) n.delete(txId); else n.add(txId); return n; });
  const todos = marcados.size === items.length;
  const aNombreDe = (i: ItemLote) => yaSalio(i) ? 'factura emitida'
    : i.modo === 'reemitir' ? 'al mismo cliente de la anulada'
    : i.modo === 'directo' ? 'según Configuración'
    : i.ordenante ? `a ${i.ordenante.nombre || i.ordenante.identification} (ordenante)`
    : cliente ? `a ${cliente.nombre || cliente.identification}` : 'al cliente que elijas';
  const enConfig = fase === 'config';

  return (
    <div className="fixed inset-0 z-[110] p-4" style={{ background: 'rgba(4,5,4,0.85)', display: 'grid', placeItems: 'center' }} onClick={() => { if (fase !== 'enviando') onCerrar(); }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', background: '#0C0E0D', border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 18, fontFamily: FONT, padding: '20px 22px' }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Emitir facturas en lote</p>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{items.length} movimiento{items.length === 1 ? '' : 's'} sin factura · {periodoTxt}</p>
          </div>
          <button onClick={() => { if (fase !== 'enviando') onCerrar(); }} aria-label="Cerrar" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.borde}`, background: 'transparent', color: C.sub, fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>

        {nComision > 0 && enConfig && (
          <>
            {sinOrdenante > 0 && (
              <>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '18px 0 6px' }}>A QUIÉN SE LE FACTURA</p>
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 8px', lineHeight: 1.5 }}>
                  {nComision - sinOrdenante > 0 ? `${nComision - sinOrdenante} van a nombre del ordenante elegido al enviar. ` : ''}
                  {sinOrdenante === 1 ? 'Uno no tiene ordenante: elige a quién se le factura.' : `${sinOrdenante} no tienen ordenante: elige a quién se les factura.`}
                </p>
                <SelectorCliente onCambio={setCliente} />
                {clientePropio && <p style={{ fontSize: 11.5, color: AMBAR, margin: '8px 0 0', lineHeight: 1.5 }}>{cliente?.nombre || 'Ese cliente'} es la misma empresa que factura: una empresa no se factura a sí misma. Elige el cliente por cuenta de quien se hizo el pago.</p>}
              </>
            )}
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '18px 0 6px' }}>COMISIÓN (% SOBRE CADA MOVIMIENTO, IVA INCLUIDO)</p>
            <div className="flex items-center" style={{ gap: 10 }}>
              <input type="number" min={0} max={100} step={0.01} value={pct} onChange={e => setPct(e.target.value)} placeholder="0,6" inputMode="decimal" style={{ ...CAMPO, width: 120 }} />
              <span style={{ fontSize: 12, color: C.sub }}>{cfg?.utilidad_pct ? `Configurado: ${cfg.utilidad_pct} %` : 'Ponelo en Configuración para no escribirlo cada vez'}</span>
            </div>
            {faltaItem && <p style={{ fontSize: 11.5, color: AMBAR, margin: '8px 0 0' }}>Faltan en Configuración el ítem de comisión{mandato ? ' y el de ingresos recibidos para terceros' : ''}. Sin eso no se puede emitir.</p>}
          </>
        )}

        {fase !== 'config' && (
          <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${terminado ? C.borde : 'rgba(74,222,128,0.30)'}`, background: terminado ? 'transparent' : 'rgba(74,222,128,0.05)' }}>
            <p style={{ fontSize: 13, color: C.text, margin: 0, fontWeight: 700 }}>
              {fase === 'enviando' ? 'Poniendo en cola…' : terminado ? 'Listo.' : 'Emitiendo en Siigo, una por una…'}
            </p>
            {fase === 'cola' && (
              <p style={{ fontSize: 12.5, margin: '4px 0 0', lineHeight: 1.5 }}>
                <span style={{ color: C.entra }}>{nEmitidas} emitida{nEmitidas === 1 ? '' : 's'}</span>
                {nError > 0 && <span style={{ color: ROJO }}> · {nError} con error</span>}
                {nCola > 0 && <span style={{ color: C.sub }}> · {nCola} en cola</span>}
              </p>
            )}
            {fase === 'cola' && !terminado && <p style={{ fontSize: 11.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>Sigue en segundo plano: puedes cerrar esta ventana o la pantalla. Las que salen van apareciendo con su número en Movimientos.</p>}
          </div>
        )}

        <div className="flex items-center justify-between" style={{ margin: '18px 0 6px', gap: 10 }}>
          <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>MOVIMIENTOS · {marcados.size} DE {items.length}</p>
          {enConfig && <button onClick={() => setMarcados(todos ? new Set() : new Set(items.map(i => i.txId)))} style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>{todos ? 'Quitar todos' : 'Marcar todos'}</button>}
        </div>
        <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, maxHeight: 300, overflowY: 'auto' }}>
          {items.map((i, k) => {
            const f = estadoFila(i);
            const on = marcados.has(i.txId);
            const fija = !enConfig || yaSalio(i);
            return (
              <label key={i.txId} className="flex items-start" style={{ gap: 10, padding: '9px 12px', borderTop: k ? `1px solid ${C.borde}` : 'none', cursor: fija ? 'default' : 'pointer', opacity: on ? 1 : 0.45 }}>
                <input type="checkbox" checked={on} disabled={fija} onChange={() => alternar(i.txId)} style={{ accentColor: C.entra, marginTop: 3 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="flex items-baseline justify-between" style={{ gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: C.text, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.a.tipo} · {i.a.contraparte || '—'}</span>
                    <span style={{ fontSize: 12.5, color: C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtMon(i.a.monto, i.a.moneda)}</span>
                  </span>
                  <span className="flex items-baseline justify-between" style={{ gap: 10, marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: C.sub, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {new Date(i.a.ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} · {i.modo === 'reemitir' && !yaSalio(i) ? 'Volver a emitir · ' : ''}{aNombreDe(i)}
                    </span>
                    {f ? <span style={{ fontSize: 11, fontWeight: 700, color: f.color, whiteSpace: 'nowrap', fontFamily: f.mono ? 'ui-monospace, monospace' : FONT }}>{f.rot}</span>
                      : i.modo === 'comision' && p > 0 && <span style={{ fontSize: 11, color: C.sub, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>factura {fmtCop2(totalDe(i))}</span>}
                  </span>
                  {f?.detalle && (f.color === ROJO || f.color === AMBAR) && (
                    <span style={{ display: 'block', fontSize: 10.5, color: f.color, marginTop: 3, lineHeight: 1.4, wordBreak: 'break-word' }}>{f.detalle}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        {nComision > 0 && p > 0 && enConfig && (
          <div style={{ marginTop: 10 }}>
            <div className="flex items-center justify-between" style={{ padding: '5px 0' }}>
              <span style={{ fontSize: 12.5, color: C.sub }}>Comisiones ({p} %, IVA incluido)</span>
              <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{fmtCop2(sumaComision)} COP</span>
            </div>
            <div className="flex items-center justify-between" style={{ padding: '5px 0', borderTop: `1px solid ${C.borde}` }}>
              <span style={{ fontSize: 12.5, color: C.text, fontWeight: 800 }}>Total de {nComision} factura{nComision === 1 ? '' : 's'}{mandato ? ' (transferido + comisión)' : ''}</span>
              <span style={{ fontSize: 12.5, color: C.text, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{fmtCop2(sumaTotal)} COP</span>
            </div>
          </div>
        )}
        {nReemitir > 0 && enConfig && <p style={{ fontSize: 11, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>{nReemitir === 1 ? 'La anulada se vuelve' : `Las ${nReemitir} anuladas se vuelven`} a emitir al mismo cliente y con el mismo porcentaje de la factura anulada, con el cálculo vigente.</p>}
        {enConfig && <p style={{ fontSize: 11, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>Lincoin las emite en segundo plano: después de confirmar puedes cerrar la ventana.</p>}
        {aviso && <p style={{ fontSize: 11.5, color: AMBAR, margin: '10px 0 0', lineHeight: 1.5 }}>{aviso}</p>}

        <div className="flex" style={{ gap: 9, marginTop: 16 }}>
          {fase === 'config' ? (
            <>
              <button onClick={onCerrar} style={{ flex: 1, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.borde}`, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={encolar} disabled={!listo} className="lincoin-btn-white"
                style={{ flex: 1.4, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: listo ? 'pointer' : 'not-allowed', opacity: listo ? 1 : 0.45 }}>
                {`Emitir ${porEmitir.length} factura${porEmitir.length === 1 ? '' : 's'}`}
              </button>
            </>
          ) : fase === 'enviando' ? (
            <button disabled className="lincoin-btn-white" style={{ flex: 1, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', opacity: 0.6 }}>Poniendo en cola…</button>
          ) : (
            <>
              {!terminado && (
                <button onClick={detener} disabled={deteniendo} title="Lo que todavía no salió vuelve a como estaba; lo emitido queda emitido"
                  style={{ flex: 1, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.borde}`, cursor: 'pointer', opacity: deteniendo ? 0.5 : 1 }}>
                  {deteniendo ? 'Deteniendo…' : 'Detener las que faltan'}
                </button>
              )}
              {terminado && nError > 0 && porEmitir.length > 0 && (
                <button onClick={() => { setFase('config'); setEnviados(new Set()); setRechazados({}); setAviso(null); }}
                  style={{ flex: 1, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.borde}`, cursor: 'pointer' }}>
                  Corregir y reintentar
                </button>
              )}
              <button onClick={onCerrar} className="lincoin-btn-white" style={{ flex: 1.4, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>Cerrar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({ children, style, className }) => (
  <div className={className} style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '18px 20px', minWidth: 0, ...style }}>{children}</div>
);
const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', color: C.sub, margin: 0 }}>{children}</p>
);
const Swatch: React.FC<{ color: string }> = ({ color }) => (
  <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block', flexShrink: 0 }} />
);

function useAncho<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const medir = () => setW(Math.max(240, el.clientWidth));
    medir();
    const ro = new ResizeObserver(medir); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Techo del eje: el primer múltiplo "redondo" (1, 2, 2,5, 5) que, en cuatro
// pasos, cubre el máximo. El eje siempre arranca en cero.
const techoDe = (max: number) => {
  const bruto = max / 4, mag = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  const cand = [1, 2, 2.5, 5, 10].map(k => k * mag);
  const paso = cand.find(k => k >= bruto) ?? cand[cand.length - 1];
  return paso * 4 >= max ? paso * 4 : paso * 5;
};

// ── Columnas: una sola serie, mes a mes (lo enviado a un tercero) ───
type Punto = { rot: string; rotLargo: string; v: number; n: number; elegido?: boolean };
const Columnas: React.FC<{ puntos: Punto[]; color: string; moneda: Moneda; rotSerie: string }> = ({ puntos, color, moneda, rotSerie }) => {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sobre, setSobre] = useState<number | null>(null);
  const alto = 170, padL = 50, padR = 10, padT = 12, padB = 24;
  const areaW = ancho - padL - padR, areaH = alto - padT - padB;
  const techo = techoDe(Math.max(1, ...puntos.map(p => p.v)));
  const n = puntos.length, slot = n > 0 ? areaW / n : areaW;
  const barW = Math.max(4, Math.min(24, slot * 0.58));
  const y = (v: number) => padT + areaH - (v / techo) * areaH;
  const tip = sobre != null ? puntos[sobre] : null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={ancho} height={alto} style={{ display: 'block', fontFamily: FONT }} onMouseLeave={() => setSobre(null)} role="img" aria-label={`${rotSerie} por mes`}>
        {[0, 1, 2, 3, 4].map(i => { const g = (techo / 4) * i; return (
          <g key={i}>
            <line x1={padL} x2={ancho - padR} y1={y(g)} y2={y(g)} stroke={C.guia} />
            <text x={padL - 8} y={y(g) + 3.5} textAnchor="end" fontSize={10} fill={C.tenue} style={{ fontVariantNumeric: 'tabular-nums' }}>{g === 0 ? '0' : fmtCorto(g, moneda)}</text>
          </g>
        ); })}
        {puntos.map((p, i) => {
          const x = padL + slot * i + (slot - barW) / 2;
          return (
            <g key={i} opacity={sobre != null && sobre !== i ? 0.45 : 1} style={{ transition: 'opacity 120ms' }} onMouseEnter={() => setSobre(i)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={areaH} fill="transparent" />
              {p.v > 0 && <path d={`M${x},${y(0)} V${y(p.v) + 3} q0,-3 3,-3 h${Math.max(0, barW - 6)} q3,0 3,3 V${y(0)} Z`} fill={color} />}
              <text x={padL + slot * i + slot / 2} y={alto - 7} textAnchor="middle" fontSize={10} fill={p.elegido ? C.text : C.tenue} fontWeight={p.elegido ? 700 : 400}>{p.rot}</text>
            </g>
          );
        })}
      </svg>
      {tip && (() => {
        const cx = padL + slot * (sobre as number) + slot / 2, izq = cx > ancho / 2;
        return (
          <div style={{ position: 'absolute', top: 4, left: izq ? undefined : Math.min(cx + 10, ancho - 190), right: izq ? Math.max(ancho - cx + 10, 0) : undefined, background: C.tooltipFondo, border: `1px solid ${C.tooltipBorde}`, borderRadius: 10, padding: '8px 11px', pointerEvents: 'none', minWidth: 170 }}>
            <p style={{ fontSize: 11, color: C.sub, margin: 0, textTransform: 'capitalize' }}>{tip.rotLargo}</p>
            <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}><span>{rotSerie}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMon(tip.v, moneda)}</b></p>
            <p style={{ fontSize: 11, color: C.sub, margin: '3px 0 0' }}>{tip.n} {tip.n === 1 ? 'operación' : 'operaciones'}</p>
          </div>
        );
      })()}
    </div>
  );
};

// ── Barras: entradas vs salidas, lado a lado ────────────────────────
type Cubo = { rot: string; rotLargo: string; entra: number; sale: number };
const Barras: React.FC<{ cubos: Cubo[]; titulo: string; moneda: Moneda }> = ({ cubos, titulo, moneda }) => {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sobre, setSobre] = useState<number | null>(null);
  const alto = 230, padL = 50, padR = 12, padT = 14, padB = 26;
  const areaW = ancho - padL - padR, areaH = alto - padT - padB;
  const techo = techoDe(Math.max(1, ...cubos.map(c => Math.max(c.entra, c.sale))));
  const n = cubos.length, slot = n > 0 ? areaW / n : areaW;
  const grupoW = Math.max(4, Math.min(26, slot * 0.62)), barW = grupoW / 2;
  const y = (v: number) => padT + areaH - (v / techo) * areaH;
  const hayAlgo = cubos.some(c => c.entra + c.sale > 0);
  const cadaN = Math.max(1, Math.ceil(n / 10));
  const tip = sobre != null ? cubos[sobre] : null;
  const barra = (x: number, v: number, fill: string) => v <= 0 ? null : (
    <path d={`M${x},${y(0)} V${y(v) + 3} q0,-3 3,-3 h${Math.max(0, barW - 6)} q3,0 3,3 V${y(0)} Z`} fill={fill} />
  );
  return (
    <Tarjeta style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column' }} className="lincoin-graf-barras">
      <div className="flex items-start justify-between flex-wrap" style={{ gap: 10 }}>
        <Rotulo>{titulo}</Rotulo>
        <div className="flex items-center" style={{ gap: 14, fontSize: 11.5, color: C.medio }}>
          <span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.entra} />Recibido</span>
          <span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.sale} />Enviado</span>
        </div>
      </div>
      <div ref={ref} style={{ position: 'relative', marginTop: 10, flex: 1 }}>
        {!hayAlgo && <p style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12.5, color: C.tenue, margin: 0 }}>Sin movimientos en el periodo.</p>}
        <svg width={ancho} height={alto} style={{ display: 'block', fontFamily: FONT }} onMouseLeave={() => setSobre(null)}>
          {[0, 1, 2, 3, 4].map(i => { const g = (techo / 4) * i; return (
            <g key={i}>
              <line x1={padL} x2={ancho - padR} y1={y(g)} y2={y(g)} stroke={C.guia} />
              <text x={padL - 8} y={y(g) + 3.5} textAnchor="end" fontSize={10} fill={C.tenue} style={{ fontVariantNumeric: 'tabular-nums' }}>{g === 0 ? '0' : fmtCorto(g, moneda)}</text>
            </g>
          ); })}
          <text x={padL - 8} y={padT - 4} textAnchor="end" fontSize={9} fill={C.tenue}>{moneda === 'COP' ? 'M COP' : 'USD'}</text>
          {cubos.map((c, i) => {
            const x0 = padL + slot * i + (slot - grupoW) / 2;
            const apag = sobre != null && sobre !== i;
            return (
              <g key={i} opacity={apag ? 0.45 : 1} style={{ transition: 'opacity 120ms' }} onMouseEnter={() => setSobre(i)}>
                <rect x={padL + slot * i} y={padT} width={slot} height={areaH} fill="transparent" />
                {barra(x0, c.entra, C.entra)}
                {barra(x0 + barW + 1, c.sale, C.sale)}
                {(i % cadaN === 0 || n <= 12) && <text x={padL + slot * i + slot / 2} y={alto - 8} textAnchor="middle" fontSize={10} fill={C.tenue}>{c.rot}</text>}
              </g>
            );
          })}
        </svg>
        {tip && tip.entra + tip.sale > 0 && (() => {
          const cx = padL + slot * (sobre as number) + slot / 2, izq = cx > ancho / 2;
          return (
            <div style={{ position: 'absolute', top: 6, left: izq ? undefined : Math.min(cx + 10, ancho - 200), right: izq ? Math.max(ancho - cx + 10, 0) : undefined, background: C.tooltipFondo, border: `1px solid ${C.tooltipBorde}`, borderRadius: 10, padding: '9px 12px', pointerEvents: 'none', minWidth: 180 }}>
              <p style={{ fontSize: 11, color: C.sub, margin: 0 }}>{tip.rotLargo}</p>
              <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}><span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.entra} />Recibido</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMon(tip.entra, moneda)}</b></p>
              <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '4px 0 0', gap: 12 }}><span className="flex items-center" style={{ gap: 6 }}><Swatch color={C.sale} />Enviado</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMon(tip.sale, moneda)}</b></p>
              <p className="flex items-center justify-between" style={{ fontSize: 12, color: C.text, margin: '6px 0 0', paddingTop: 6, borderTop: `1px solid ${C.borde}`, gap: 12 }}><span style={{ color: C.sub }}>Neto</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{(tip.entra - tip.sale >= 0 ? '+' : '−') + fmtMon(Math.abs(tip.entra - tip.sale), moneda)}</b></p>
            </div>
          );
        })()}
      </div>
    </Tarjeta>
  );
};

// Revisión de facturas duplicadas en Siigo: el mismo movimiento facturado
// dos veces (la contadora de XATECH las encontró, de intentos que Siigo creó
// sin contestar a tiempo). Solo lee Siigo: la duplicada se anula con nota
// crédito en Siigo, y eso lo decide la contadora. Las que Siigo tiene y
// Lincoin no se pueden registrar, para que «Emitir» no las vuelva a mandar.
type FacturaRev = { id: string; numero: string; fecha: string | null; total: number; cliente: string; anulada: boolean; notas_credito: string[]; registrada?: boolean; anterior?: boolean; comprobante?: string };
const DuplicadasModal: React.FC<{ empresaId?: string | null; soloLectura: boolean; onCerrar: () => void; onCambio: () => void }> = ({ empresaId, soloLectura, onCerrar, onCambio }) => {
  const [dias, setDias] = useState(30);
  const [cargando, setCargando] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [regMsg, setRegMsg] = useState<string | null>(null);
  const revisar = async (d: number) => {
    setDias(d); setCargando(true); setError(null);
    const r: any = await llamarFuncion('facturacion', { action: 'duplicadas', dias: d, ...(empresaId ? { empresaId } : {}) }, 150000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setCargando(false);
    if (!r?.ok) { setError(String(r?.error ?? 'No se pudo revisar.')); return; }
    setRes(r);
  };
  useEffect(() => { revisar(30); }, []);
  const registrar = async () => {
    const facturas = ((res?.sin_registrar ?? []) as any[]).map(s => ({ folio: s.folio, factura_id: s.factura?.id }));
    if (!facturas.length) return;
    setRegistrando(true); setRegMsg(null);
    const r: any = await llamarFuncion('facturacion', { action: 'duplicadas_registrar', facturas }, 150000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setRegistrando(false);
    if (!r?.ok) { setRegMsg(String(r?.error ?? 'No se pudieron registrar.')); return; }
    const n = (r.registradas ?? []).length;
    setRegMsg(`${n === 1 ? 'Quedó registrada 1 factura' : `Quedaron registradas ${n} facturas`} en Lincoin.${r.errores?.length ? ` No se pudo con: ${r.errores.join(' · ')}` : ''}`);
    onCambio();
    revisar(dias);
  };
  const monto = (v: unknown) => fmtMon(Number(String(v ?? '0').replace(/,/g, '')) || 0, 'COP');
  const fecha = (s: string | null) => s ? String(s).slice(0, 10) : '—';
  const titulo = (txt: string) => <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '18px 0 6px' }}>{txt}</p>;
  const fila = (f: FacturaRev, rotulo: { txt: string; color: string }) => (
    <div key={f.id} className="flex items-center justify-between" style={{ gap: 10, padding: '5px 0', fontSize: 12 }}>
      <span style={{ color: f.anulada ? C.tenue : C.text, fontVariantNumeric: 'tabular-nums', textDecoration: f.anulada ? 'line-through' : 'none' }}>{f.numero} · {fecha(f.fecha)} · {monto(f.total)}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: rotulo.color, whiteSpace: 'nowrap' }}>{rotulo.txt}</span>
    </div>
  );
  const duplicadas: any[] = res?.duplicadas ?? [];
  const sinRegistrar: any[] = res?.sin_registrar ?? [];
  const aSiMisma: any[] = res?.a_si_misma ?? [];
  const posibles: any[] = res?.posibles ?? [];
  const nAnular = duplicadas.reduce((s, d) => {
    const vig = (d.facturas as FacturaRev[]).filter(f => !f.anulada);
    return s + vig.length - 1;
  }, 0);

  return (
    <div className="fixed inset-0 z-[110] p-4" style={{ background: 'rgba(4,5,4,0.85)', display: 'grid', placeItems: 'center' }} onClick={() => { if (!registrando) onCerrar(); }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', background: '#0C0E0D', border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 18, fontFamily: FONT, padding: '20px 22px' }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Facturas duplicadas en Siigo</p>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>Se agrupan las facturas de Siigo por el comprobante Lincoin que llevan en la observación: un movimiento con dos facturas vigentes está duplicado.</p>
          </div>
          <button onClick={() => { if (!registrando) onCerrar(); }} aria-label="Cerrar" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.borde}`, background: 'transparent', color: C.sub, fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>
        <div className="flex items-center flex-wrap" style={{ gap: 6, marginTop: 14 }}>
          <span style={{ fontSize: 12, color: C.sub, marginRight: 4 }}>Revisar los últimos</span>
          {[30, 90, 180].map(d => (
            <button key={d} onClick={() => revisar(d)} disabled={cargando || registrando} aria-pressed={dias === d}
              style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', color: dias === d ? C.text : C.sub, background: dias === d ? 'rgba(74,222,128,0.10)' : 'transparent', border: `1px solid ${dias === d ? 'rgba(74,222,128,0.40)' : C.borde}`, opacity: cargando ? 0.6 : 1 }}>{d} días</button>
          ))}
        </div>

        {cargando && <p style={{ fontSize: 12.5, color: C.sub, margin: '16px 0 0' }}>Leyendo las facturas y notas crédito de Siigo… puede tardar un minuto.</p>}
        {error && !cargando && <p style={{ fontSize: 12.5, color: ROJO, margin: '16px 0 0', lineHeight: 1.5 }}>{error}</p>}

        {res && !cargando && (
          <>
            <p style={{ fontSize: 12, color: C.sub, margin: '14px 0 0', lineHeight: 1.5 }}>
              Se revisaron {Number(res.revisadas ?? 0).toLocaleString('es-CO')} facturas de Siigo desde el {fecha(res.desde)}.
              {!res.completo && ' Son demasiadas para una sola revisión: se leyeron las primeras 6.000. Elige un periodo más corto.'}
            </p>

            {titulo(duplicadas.length ? `DUPLICADAS · ${duplicadas.length} MOVIMIENTO${duplicadas.length === 1 ? '' : 'S'}` : 'DUPLICADAS')}
            {duplicadas.length === 0
              ? <p style={{ fontSize: 12.5, color: C.entra, margin: 0 }}>Ningún movimiento tiene dos facturas vigentes en este periodo.</p>
              : (
                <>
                  <p style={{ fontSize: 12, color: C.sub, margin: '0 0 8px', lineHeight: 1.5 }}>
                    Hay que anular {nAnular === 1 ? '1 factura' : `${nAnular} facturas`} con una nota crédito en Siigo (Ventas → Nota crédito, sobre la factura marcada «anular»). La que dice «queda» es la que Lincoin tiene registrada (si no tiene ninguna, la primera que salió); esa no se anula. Después vuelve a revisar: la anulada aparece tachada.
                  </p>
                  {duplicadas.map(d => {
                    const fs = d.facturas as FacturaRev[];
                    // La que queda: la registrada en Lincoin; si ninguna lo
                    // está, la primera que salió.
                    const queda = fs.find(f => !f.anulada && f.registrada) ?? fs.find(f => !f.anulada);
                    return (
                      <div key={d.comprobante} style={{ border: `1px solid ${C.borde}`, borderRadius: 10, padding: '9px 12px', marginBottom: 8 }}>
                        <p style={{ fontSize: 12.5, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>{d.comprobante} · {d.tipo} · {monto(d.monto)}</p>
                        {fs.map(f => fila(f, f.anulada
                          ? { txt: `anulada${f.notas_credito.length ? ` · ${f.notas_credito.join(', ')}` : ''}`, color: C.tenue }
                          : f.id === queda?.id ? { txt: f.registrada ? 'queda · registrada en Lincoin' : 'queda · la primera', color: C.entra } : { txt: 'anular', color: AMBAR }))}
                      </div>
                    );
                  })}
                </>
              )}

            {aSiMisma.length > 0 && (
              <>
                {titulo(`A NOMBRE DE LA MISMA EMPRESA · ${aSiMisma.reduce((s, d) => s + (d.facturas?.length ?? 0), 0)}`)}
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 8px', lineHeight: 1.5 }}>Facturas emitidas a la misma empresa que factura (pagos propios con la empresa como ordenante). Una empresa no se factura a sí misma: anúlalas con una nota crédito en Siigo. Lincoin ya no emite estas facturas.</p>
                {aSiMisma.map(d => (
                  <div key={d.comprobante} style={{ border: `1px solid ${C.borde}`, borderRadius: 10, padding: '9px 12px', marginBottom: 8 }}>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>{d.comprobante} · {d.tipo} · {monto(d.monto)}</p>
                    {(d.facturas as FacturaRev[]).map(f => fila(f, { txt: 'anular', color: AMBAR }))}
                  </div>
                ))}
              </>
            )}

            {sinRegistrar.length > 0 && (
              <>
                {titulo(`EN SIIGO Y NO EN LINCOIN · ${sinRegistrar.length}`)}
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 8px', lineHeight: 1.5 }}>Están emitidas en Siigo con la marca del movimiento, pero Lincoin no las tiene registradas: si se vuelven a emitir, saldrían duplicadas. Registrarlas no cambia nada en Siigo.</p>
                {sinRegistrar.map(s => (
                  <div key={s.comprobante} className="flex items-center justify-between" style={{ gap: 10, padding: '5px 0', fontSize: 12, borderBottom: `1px solid ${C.borde}` }}>
                    <span style={{ color: C.text }}>{s.comprobante} · {s.tipo} · {monto(s.monto)}</span>
                    <span style={{ color: C.sub, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{s.factura?.numero} · {fecha(s.factura?.fecha)}</span>
                  </div>
                ))}
                {!soloLectura && (
                  <button onClick={registrar} disabled={registrando} className="lincoin-btn-white"
                    style={{ marginTop: 10, fontFamily: FONT, padding: '9px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer', opacity: registrando ? 0.6 : 1 }}>
                    {registrando ? 'Registrando…' : `Registrarlas en Lincoin · ${sinRegistrar.length}`}
                  </button>
                )}
              </>
            )}
            {regMsg && <p style={{ fontSize: 12, color: C.sub, margin: '8px 0 0', lineHeight: 1.5 }}>{regMsg}</p>}

            {posibles.length > 0 && (
              <>
                {titulo(`POSIBLES DUPLICADAS SIN MARCA · ${posibles.length}`)}
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 8px', lineHeight: 1.5 }}>Facturas hechas fuera de Lincoin (sin el comprobante en la observación) con el mismo cliente y el mismo total que una de Lincoin. Pueden ser del mismo movimiento facturado a mano en Siigo: revísalas.</p>
                {posibles.map((p, i) => (
                  <div key={`${p.factura?.id}-${i}`} style={{ padding: '5px 0', fontSize: 12, borderBottom: `1px solid ${C.borde}` }}>
                    <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{p.factura?.numero} · {fecha(p.factura?.fecha)} · {monto(p.factura?.total)} · cliente {p.factura?.cliente}</span>
                    <span style={{ color: C.sub }}> — igual a {(p.de_lincoin as FacturaRev[]).map(f => `${f.numero} (${f.comprobante})`).join(', ')}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        <div className="flex" style={{ gap: 10, marginTop: 18 }}>
          <button onClick={onCerrar} disabled={registrando} style={{ flex: 1, fontFamily: FONT, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.borde}`, cursor: 'pointer' }}>Cerrar</button>
        </div>
      </div>
    </div>
  );
};

export const ContabilidadDashboard: React.FC<Props> = ({ transactions, userId, onVerMovimiento, soloLectura = false, comprobantesExternos = null, empresa = null }) => {
  const { currentUser } = useDatabase();
  // El titular: lo que mandó el servidor (contador) o la propia sesión.
  const ficha = empresa ?? (soloLectura ? null : fichaDeUsuario(currentUser));
  // La misma empresa no se factura a sí misma: un envío con la propia empresa
  // como ordenante (un pago propio) no se ofrece para facturar.
  const nitPropio = baseDoc(ficha?.nit);
  const esPropio = (doc?: string | null) => nitPropio.length >= 6 && !!doc && baseDoc(doc) === nitPropio;
  const [contadorAbierto, setContadorAbierto] = useState(false);
  const [estadoAbierto, setEstadoAbierto] = useState(false);
  // Terceros: a quién se le envió ('out') o de quién se recibió ('in'), y el
  // que está abierto con su detalle mes a mes.
  const [vistaTer, setVistaTer] = useState<Dir>('out');
  const [terAbierto, setTerAbierto] = useState<string | null>(null);
  const [limiteTer, setLimiteTer] = useState(10);
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  // El mes que se mira con "Mes". null = el mes en curso. La contadora cierra
  // el mes anterior ya entrado el siguiente: tiene que poder volver a
  // septiembre sin depender de "Este año" (que mezcla todo).
  const [mesVer, setMesVer] = useState<{ y: number; m: number } | null>(null);
  const [monedaSel, setMonedaSel] = useState<Moneda | null>(null);
  const [filtroDir, setFiltroDir] = useState<'todos' | 'in' | 'out' | 'conv'>('todos');
  // Solo lo que falta facturar (se combina con la dirección y la búsqueda).
  const [soloSinFactura, setSoloSinFactura] = useState(false);
  // Emisión en lote: la lista se congela al abrir, para que refrescar los
  // comprobantes mientras emite no la cambie a mitad.
  const [lote, setLote] = useState<ItemLote[] | null>(null);
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(25);
  const [folios, setFolios] = useState<Record<string, { folio: number; numero: string; enviado: boolean; factura?: { estado: string | null; numero: string | null; url: string | null; error: string | null; tipo: string | null; at?: string | null } }>>({});
  const [foliosEstado, setFoliosEstado] = useState<'cargando' | 'ok' | 'sin_tabla' | 'error'>('cargando');
  const [configAbierta, setConfigAbierta] = useState(false);
  const [facturacionActiva, setFacturacionActiva] = useState<boolean | null>(null);
  const [reintentando, setReintentando] = useState<number | null>(null);
  const [foliosVersion, setFoliosVersion] = useState(0);
  // Relectura liviana de los comprobantes (sin pedir la configuración otra vez).
  const [pulsoFolios, setPulsoFolios] = useState(0);
  // Cuántas lecturas de comprobantes van: el lote no confía en una que se
  // pidió antes de encolar.
  const [lecturas, setLecturas] = useState(0);

  const ahora = useMemo(() => new Date(), []);
  const mesY = mesVer?.y ?? ahora.getFullYear(), mesM = mesVer?.m ?? ahora.getMonth();
  const esMesActual = mesY === ahora.getFullYear() && mesM === ahora.getMonth();
  const rotMes = `${MESES_L[mesM].charAt(0).toUpperCase()}${MESES_L[mesM].slice(1)} ${mesY}`;
  const inicioMes = new Date(mesY, mesM, 1).getTime();
  const finMes = new Date(mesY, mesM + 1, 1).getTime();
  const inicioAnio = new Date(ahora.getFullYear(), 0, 1).getTime();
  const inicioMesAnt = new Date(mesY, mesM - 1, 1).getTime();
  const inicioAnioAnt = new Date(ahora.getFullYear() - 1, 0, 1).getTime();
  const rango = (p: Periodo): [number, number] => p === 'mes' ? [inicioMes, esMesActual ? Infinity : finMes] : p === 'anio' ? [inicioAnio, Infinity] : [0, Infinity];
  const rangoAnt = (p: Periodo): [number, number] | null => p === 'mes' ? [inicioMesAnt, inicioMes] : p === 'anio' ? [inicioAnioAnt, inicioAnio] : null;
  const en = (a: Asiento, [d, h]: [number, number]) => a.ts >= d && a.ts < h;

  // Los comprobantes emitidos por el servidor, para ponerle número a cada
  // movimiento. Si la tabla no existe todavía, la columna dice por qué.
  const mapaFolios = (filas: any[]): typeof folios => {
    const m: typeof folios = {};
    for (const r of filas) m[String(r.transaction_id)] = {
      folio: Number(r.folio), numero: String(r.numero), enviado: !!r.enviado_at,
      factura: { estado: r.factura_estado ?? null, numero: r.factura_numero ?? null, url: r.factura_url ?? null, error: r.factura_error ?? null, tipo: r.factura_tipo ?? null, at: r.factura_at ?? null },
    };
    return m;
  };
  useEffect(() => {
    // Modo contador: los comprobantes ya vienen del servidor.
    if (comprobantesExternos) { setFolios(mapaFolios(comprobantesExternos)); setFoliosEstado('ok'); return; }
    if (!userId || soloLectura) return;
    let vivo = true;
    (async () => {
      // `*` a propósito: si una columna nueva (factura_tipo) todavía no
      // existe porque falta correr su migración, nombrarla rompería toda la
      // consulta y la columna COMPROBANTE quedaría vacía.
      // Solo las columnas de la tabla (sin factura_detalle, que trae las
      // respuestas completas de Siigo y hacía lenta cada recarga). Si una
      // columna nueva todavía no existe (falta su migración), se cae a '*'.
      const cols = 'transaction_id, folio, numero, enviado_at, factura_estado, factura_numero, factura_url, factura_error, factura_tipo, factura_at';
      let { data, error } = await supabase.from('comprobantes').select(cols).eq('user_id', userId).limit(2000);
      if (error && /column|schema cache|PGRST/i.test(error.message)) ({ data, error } = await supabase.from('comprobantes').select('*').eq('user_id', userId).limit(2000));
      if (!vivo) return;
      if (error) { setFoliosEstado(/does not exist|42P01|schema cache/i.test(error.message) ? 'sin_tabla' : 'error'); return; }
      setFolios(mapaFolios((data ?? []) as any[])); setFoliosEstado('ok'); setLecturas(v => v + 1);
    })();
    return () => { vivo = false; };
  }, [userId, foliosVersion, pulsoFolios, soloLectura, comprobantesExternos]);
  // Las facturas las emite el servidor (automáticas, o una manual que tardó
  // más que la conexión): se vuelven a leer al volver a la pestaña y cada
  // 30 s, para no mostrar "pendiente" en una que ya salió.
  useEffect(() => {
    if (!userId || soloLectura || comprobantesExternos) return;
    const otraVez = () => { if (document.visibilityState === 'visible') setPulsoFolios(v => v + 1); };
    const t = setInterval(otraVez, 30000);
    document.addEventListener('visibilitychange', otraVez);
    window.addEventListener('focus', otraVez);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', otraVez); window.removeEventListener('focus', otraVez); };
  }, [userId, soloLectura, comprobantesExternos]);
  // Con una cola de lote andando (o su ventana abierta), cada 5 s: así se
  // ven salir las facturas una por una.
  type FolioFila = (typeof folios)[string];
  const enCola = useMemo(() => (Object.values(folios) as FolioFila[]).filter(f => f.factura?.estado === 'en_cola').length, [folios]);
  const emitiendoAhora = useMemo(() => (Object.values(folios) as FolioFila[]).some(f => f.factura?.estado === 'emitiendo' && f.factura.at && Date.now() - new Date(f.factura.at).getTime() < 300000), [folios]);
  const [loteAbierto, setLoteAbierto] = useState(false);
  const [dupAbierto, setDupAbierto] = useState(false);
  useEffect(() => {
    if (!userId || soloLectura || comprobantesExternos) return;
    if (!enCola && !emitiendoAhora && !loteAbierto) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') setPulsoFolios(v => v + 1); }, 5000);
    return () => clearInterval(t);
  }, [userId, soloLectura, comprobantesExternos, enCola > 0, emitiendoAhora, loteAbierto]); // eslint-disable-line react-hooks/exhaustive-deps
  const vivo = useMemo(() => {
    const m: Record<string, FacturaVivo> = {};
    for (const [k, f] of Object.entries(folios) as [string, FolioFila][]) m[k] = { estado: f.factura?.estado ?? null, numero: f.factura?.numero ?? null, error: f.factura?.error ?? null };
    return m;
  }, [folios]);
  const [deteniendoCola, setDeteniendoCola] = useState(false);
  const detenerCola = async () => {
    setDeteniendoCola(true);
    const r = await llamarFuncion('facturacion', { action: 'lote_cancelar' }, 60000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setDeteniendoCola(false);
    setPulsoFolios(v => v + 1);
    if (!r?.ok) alert(r?.error ?? 'No se pudo detener la cola.');
  };
  // ¿Tiene la facturación automática activa? Solo para decidir qué dice la
  // columna FACTURA y el botón de configuración. Y el chequeo del servidor:
  // movimientos completados que nunca recibieron comprobante (señal de que
  // el aviso automático de la base no está llegando).
  const [chequeo, setChequeo] = useState<{ sinComprobante: number; ultimos: number } | null>(null);
  const [cfgFact, setCfgFact] = useState<any>(null);
  // Factura de comisión (PSP): el movimiento (depósito) al que se le está
  // emitiendo, con el modal abierto.
  const [comisionPara, setComisionPara] = useState<any>(null);
  const [cambiandoAuto, setCambiandoAuto] = useState(false);
  const [reconciliando, setReconciliando] = useState(false);
  const [reconciliadoMsg, setReconciliadoMsg] = useState<string | null>(null);
  const reconciliarAhora = async () => {
    setReconciliando(true); setReconciliadoMsg(null);
    const r = await llamarFuncion('facturacion', { action: 'reconciliar' }, 240000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setReconciliando(false);
    if (!r?.ok) { setReconciliadoMsg(r?.error ?? 'No se pudo.'); return; }
    const an = r.anulaciones;
    const txtAnul = an ? (an.error ? ` · notas crédito: ${an.error}` : an.anuladas?.length ? ` · anuladas en Siigo con nota crédito: ${an.anuladas.join(', ')}` : '') : '';
    setReconciliadoMsg(`Comprobantes creados: ${r.creados} · documentos emitidos: ${r.emitidos}${r.pendientes ? ` · quedan ${r.pendientes} para la próxima vuelta` : ''}${r.errores?.length ? ` · errores: ${r.errores.join(' | ')}` : ''}${txtAnul}`);
    setFoliosVersion(v => v + 1);
  };
  useEffect(() => {
    if (!userId || soloLectura) return;
    llamarFuncion('facturacion', { action: 'config_get' }, 20000)
      .then((r: any) => { setFacturacionActiva(!!r?.config?.activo); setChequeo(r?.chequeo ?? null); setCfgFact(r?.config ?? null); })
      .catch(() => setFacturacionActiva(null));
  }, [userId, configAbierta, foliosVersion]);
  // El interruptor: activar exige la configuración completa; el servidor
  // dice qué falta, y eso se muestra tal cual.
  const alternarAutomatica = async () => {
    if (facturacionActiva == null) return;
    setCambiandoAuto(true);
    const r = await llamarFuncion('facturacion', { action: 'config_set', config: { activo: !facturacionActiva }, cambiarActivo: true }, 30000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setCambiandoAuto(false);
    if (!r?.ok) { alert(r?.error ?? 'No se pudo cambiar.'); return; }
    setFacturacionActiva(!!r?.config?.activo);
  };
  const reintentarFactura = async (folio: number) => {
    setReintentando(folio);
    const r = await llamarFuncion('facturacion', { action: 'reintentar', folio }, 130000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setReintentando(null);
    setFoliosVersion(v => v + 1);
    if (!r?.ok) alert(r?.error ?? 'No se pudo emitir la factura.');
  };
  // Emitir a mano el documento de un movimiento completado que quedó sin
  // él (antes de activar, omitido por la regla, o sin comprobante).
  const [emitiendo, setEmitiendo] = useState<string | null>(null);
  const emitirMovimiento = async (txId: string) => {
    setEmitiendo(txId);
    const r = await llamarFuncion('facturacion', { action: 'emitir_movimiento', transactionId: txId }, 130000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setEmitiendo(null);
    setFoliosVersion(v => v + 1);
    if (!r?.ok) alert(r?.error ?? 'No se pudo emitir el documento.');
  };
  const botonEmitir = (txId: string) => (
    <button onClick={() => emitirMovimiento(txId)} disabled={emitiendo === txId}
      title="Emitir ahora el documento en Siigo con la configuración actual"
      style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.borde}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', opacity: emitiendo === txId ? 0.5 : 1 }}>
      {emitiendo === txId ? '…' : 'Emitir'}
    </button>
  );
  // PSP: un depósito se factura por la COMISIÓN, a mano, eligiendo el
  // cliente. Este botón abre ese paso en vez de emitir de una.
  const esPsp = String(cfgFact?.modelo ?? '') === 'psp';
  const botonFacturaComision = (a: Asiento) => (
    <button onClick={() => setComisionPara(a)}
      title="Factura de venta por tu comisión sobre este depósito (IVA incluido), al cliente que elijas"
      style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: C.text, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
      Emitir factura
    </button>
  );
  // Modelo Comisión: cualquier movimiento se factura a mano con el mismo
  // modal (elegir cliente y porcentaje), por si la automática no aplicaba.
  const esComision = String(cfgFact?.modelo ?? '') === 'comision';
  // Comisión: solo los envíos se facturan (un cargue/depósito no lleva
  // factura en ese modelo). PSP: los depósitos, a mano.
  const botonSegunTipo = (a: Asiento, txId: string) => {
    if (esComision) return a.dir === 'out' && !esPropio(ordenanteDe(a.tx)?.identification) ? botonFacturaComision(a) : null;
    return (esPsp && a.dir === 'in' && ENTRA.has(String(a.tx?.type))) ? botonFacturaComision(a) : botonEmitir(txId);
  };
  // SIN FACTURA: un movimiento completado que se puede facturar y no tiene
  // factura emitida (ni una saliendo ahora). Devuelve cómo se emitiría en
  // lote, con la misma regla de los botones de cada fila; null = nada que
  // emitir. En el modelo Comisión solo cuentan los envíos en pesos (un
  // depósito "no aplica") y los envíos anulados, que se vuelven a emitir. Un
  // depósito anulado queda anulado: aparecía en el lote como «Volver a
  // emitir» (la FV-2-725 de XATECH, un depósito de 72 M).
  const modoLote = (a: Asiento): ModoLote | null => {
    if (a.estado !== 'Completado' || a.tipo === 'Conversión') return null;
    const tipoTx = String(a.tx?.type ?? '');
    if (!SALE.has(tipoTx) && !ENTRA.has(tipoTx)) return null;
    const txId = String(a.tx?.id ?? '');
    if (!txId) return null;
    const fa = folios[txId]?.factura;
    const est = fa?.estado ?? null;
    if (est === 'emitida' || est === 'en_cola') return null;
    if (est === 'emitiendo' && (!fa?.at || Date.now() - new Date(fa.at).getTime() < 180000)) return null;
    if (esComision) {
      if (a.dir === 'out' && esPropio(ordenanteDe(a.tx)?.identification)) return null;
      if (est === 'anulada') return a.dir === 'out' ? 'reemitir' : null;
      return a.dir === 'out' && a.moneda === 'COP' ? 'comision' : null;
    }
    if (esPsp && a.dir === 'in') return 'comision';
    return 'directo';
  };

  // Todos los asientos de la cuenta.
  const asientos = useMemo(() => (transactions ?? []).filter(t => t.userId === userId).flatMap(asientosDe), [transactions, userId]);
  const R = rango(periodo), RA = rangoAnt(periodo);
  const enP = asientos.filter(a => en(a, R));
  // Moneda: la que tenga más movimientos en el periodo, salvo que se elija.
  const hayCop = asientos.some(a => a.moneda === 'COP'), hayUsd = asientos.some(a => a.moneda === 'USD');
  const moneda: Moneda = monedaSel ?? (enP.filter(a => a.moneda === 'USD').length > enP.filter(a => a.moneda === 'COP').length ? 'USD' : 'COP');
  const del = enP.filter(a => a.moneda === moneda);
  const suma = (as: Asiento[], dir: Dir) => as.filter(a => a.dir === dir && cuenta(a.tx)).reduce((s, a) => s + a.monto, 0);
  // El NETO resta también el costo de los envíos: es lo que bajó el saldo,
  // y así cuadra con saldo final − saldo inicial del estado de cuenta.
  const costosP = del.filter(a => a.dir === 'out' && cuenta(a.tx)).reduce((s, a) => s + a.costo, 0);
  const recibido = suma(del, 'in'), enviado = suma(del, 'out'), neto = recibido - enviado - costosP;
  const nIn = del.filter(a => a.dir === 'in' && cuenta(a.tx)).length, nOut = del.filter(a => a.dir === 'out' && cuenta(a.tx)).length;
  const ant = RA ? asientos.filter(a => en(a, RA) && a.moneda === moneda) : null;
  const delta = (v: number, vAnt: number | null) => vAnt != null && vAnt > 0 ? ((v - vAnt) / vAnt) * 100 : null;
  const dRec = ant ? delta(recibido, suma(ant, 'in')) : null, dEnv = ant ? delta(enviado, suma(ant, 'out')) : null;

  // Cubos del gráfico.
  const cubos: Cubo[] = useMemo(() => {
    const vacio = (rot: string, rotLargo: string): Cubo => ({ rot, rotLargo, entra: 0, sale: 0 });
    let lista: Cubo[] = []; let clave: (ts: number) => number;
    if (periodo === 'mes') {
      const dias = new Date(mesY, mesM + 1, 0).getDate();
      lista = Array.from({ length: dias }, (_, i) => vacio(String(i + 1), `${i + 1} de ${MESES_L[mesM]}`));
      clave = ts => new Date(ts).getDate() - 1;
    } else if (periodo === 'anio') {
      lista = MESES.map((m, i) => vacio(m, `${MESES_L[i]} ${ahora.getFullYear()}`));
      clave = ts => new Date(ts).getMonth();
    } else {
      const tss = del.map(a => a.ts).filter(Boolean);
      const primero = tss.length ? new Date(Math.min(...tss)) : ahora;
      const desde = new Date(primero.getFullYear(), primero.getMonth(), 1);
      const n = Math.max(1, (ahora.getFullYear() - desde.getFullYear()) * 12 + (ahora.getMonth() - desde.getMonth()) + 1);
      const rec = Math.max(0, n - 24);
      lista = Array.from({ length: n - rec }, (_, i) => { const d = new Date(desde.getFullYear(), desde.getMonth() + rec + i, 1); return vacio(`${MESES[d.getMonth()]}${d.getMonth() === 0 || i === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ''}`, `${MESES_L[d.getMonth()]} ${d.getFullYear()}`); });
      clave = ts => { const d = new Date(ts); return (d.getFullYear() - desde.getFullYear()) * 12 + (d.getMonth() - desde.getMonth()) - rec; };
    }
    for (const a of del) { if (!cuenta(a.tx)) continue; const i = clave(a.ts); if (i < 0 || i >= lista.length) continue; if (a.dir === 'in') lista[i].entra += a.monto; else lista[i].sale += a.monto; }
    return lista;
  }, [periodo, moneda, del.length, recibido, enviado, mesY, mesM]); // eslint-disable-line react-hooks/exhaustive-deps

  // Meses que se pueden elegir: del mes en curso hacia atrás hasta el primer
  // movimiento de la cuenta (máximo 3 años).
  const opcionesMes = useMemo(() => {
    const tss = asientos.map(a => a.ts).filter(Boolean);
    const primero = tss.length ? new Date(Math.min(...tss)) : ahora;
    const out: { y: number; m: number }[] = [];
    let y = ahora.getFullYear(), m = ahora.getMonth();
    for (let i = 0; i < 36; i++) {
      out.push({ y, m });
      if (y < primero.getFullYear() || (y === primero.getFullYear() && m <= primero.getMonth())) break;
      m -= 1; if (m < 0) { m = 11; y -= 1; }
    }
    return out;
  }, [asientos, ahora]);
  const idxMes = opcionesMes.findIndex(o => o.y === mesY && o.m === mesM);
  const irAMes = (o: { y: number; m: number } | undefined) => {
    if (!o) return;
    setPeriodo('mes'); setLimite(25);
    setMesVer(o.y === ahora.getFullYear() && o.m === ahora.getMonth() ? null : o);
  };

  // Por tipo, en el periodo.
  const porTipo = useMemo(() => {
    // Por tipo Y dirección: una conversión COP→USD (sale) y una USD→COP
    // (entra) no se suman en una fila; tampoco un ajuste a favor con uno en
    // contra. Si un tipo tiene las dos, cada fila lo dice.
    const m: Record<string, { tipo: string; n: number; monto: number; dir: Dir }> = {};
    for (const a of del) { if (!cuenta(a.tx)) continue; const k = `${a.tipo}|${a.dir}`; const acc = m[k] ?? (m[k] = { tipo: a.tipo, n: 0, monto: 0, dir: a.dir }); acc.n += 1; acc.monto += a.monto; }
    const vals = Object.values(m);
    const ambas = new Set(vals.filter(v => vals.some(o => o.tipo === v.tipo && o.dir !== v.dir)).map(v => v.tipo));
    return vals.map(v => [ambas.has(v.tipo) ? `${v.tipo} · ${v.dir === 'in' ? 'entra' : 'sale'}` : v.tipo, v] as [string, typeof v])
      .sort((x, y) => y[1].monto - x[1].monto);
  }, [del]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxTipo = Math.max(1, ...porTipo.map(([, v]) => v.monto));

  // Últimos 12 meses, siempre.
  const meses12 = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - (11 - i), 1);
    const desde = d.getTime(), hasta = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const as = asientos.filter(a => a.moneda === moneda && a.ts >= desde && a.ts < hasta && cuenta(a.tx));
    const r = as.filter(a => a.dir === 'in').reduce((s, a) => s + a.monto, 0), e = as.filter(a => a.dir === 'out').reduce((s, a) => s + a.monto, 0);
    return { rot: `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, y: d.getFullYear(), m: d.getMonth(), recibido: r, enviado: e, movs: as.length };
  }), [asientos, moneda, ahora]);

  // Lista de movimientos: filtro y búsqueda juntos.
  const q = busca.trim().toLowerCase();
  const listaBase = del
    .filter(a => filtroDir === 'todos' || (filtroDir === 'conv' ? a.tipo === 'Conversión' : (a.dir === filtroDir && a.tipo !== 'Conversión')))
    .filter(a => !q || a.contraparte.toLowerCase().includes(q) || a.tipo.toLowerCase().includes(q) || String(folios[String(a.tx.id)]?.numero ?? '').toLowerCase().includes(q) || String(a.tx.providerRef ?? a.tx.reference ?? '').toLowerCase().includes(q))
    .sort((x, y) => y.ts - x.ts);
  // Mientras no llegan los comprobantes no se sabe qué tiene factura.
  // Lo que está en la cola del lote también está sin factura (todavía).
  const sinFactura = foliosEstado === 'ok' ? listaBase.filter(a => modoLote(a) != null || folios[String(a.tx?.id ?? '')]?.factura?.estado === 'en_cola') : [];
  const lista = soloSinFactura ? sinFactura : listaBase;
  const mostrados = lista.slice(0, limite);
  // El lote: lo que está sin factura en lo filtrado (periodo, moneda,
  // dirección y búsqueda), un ítem por movimiento.
  const puedeLote = !soloLectura && !!facturacionActiva && !!cfgFact;
  const itemsLote = (): ItemLote[] => {
    const vistos = new Set<string>();
    const out: ItemLote[] = [];
    for (const a of sinFactura) {
      const txId = String(a.tx.id);
      const modo = modoLote(a);
      if (!modo || vistos.has(txId)) continue;
      vistos.add(txId);
      out.push({ a, txId, modo, ordenante: modo === 'comision' && a.dir === 'out' ? ordenanteDe(a.tx) : null });
    }
    return out;
  };
  const nSinFactura = new Set(sinFactura.map(a => String(a.tx.id))).size;
  const nLote = new Set(sinFactura.filter(a => modoLote(a) != null).map(a => String(a.tx.id))).size;

  // ── Estado de cuenta del periodo, en la moneda elegida ──
  const [pDesde, pHasta] = R;
  const ec = useMemo(() => estadoDeCuenta(asientos, moneda, pDesde, pHasta), [asientos, moneda, pDesde, pHasta]);
  const fechaLarga = (ts: number) => new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  const primerTs = useMemo(() => asientos.filter(a => a.moneda === moneda && a.ts > 0).reduce((m, a) => Math.min(m, a.ts), Infinity), [asientos, moneda]);
  const desdeTxt = periodo === 'historico' ? (Number.isFinite(primerTs) ? fechaLarga(primerTs) : 'el inicio') : fechaLarga(pDesde);
  // El final de un mes cerrado es su último día; el de lo que sigue abierto, hoy.
  const hastaTxt = pHasta === Infinity ? `${fechaLarga(Date.now())} (hoy)` : fechaLarga(pHasta - 1);
  const periodoTxt = periodo === 'mes' ? rotMes : periodo === 'anio' ? `Año ${ahora.getFullYear()}` : 'Histórico';

  // ── Terceros del periodo: a quién se le envió y de quién se recibió ──
  const enviadoA = useMemo(() => terceros(del, 'out'), [asientos, moneda, pDesde, pHasta]); // eslint-disable-line react-hooks/exhaustive-deps
  const recibidoDe = useMemo(() => terceros(del, 'in'), [asientos, moneda, pDesde, pHasta]); // eslint-disable-line react-hooks/exhaustive-deps
  const listaTer = vistaTer === 'out' ? enviadoA : recibidoDe;
  const totalTer = listaTer.reduce((s, t) => s + t.total, 0);
  const maxTer = Math.max(1, ...listaTer.map(t => t.total));
  // El tercero abierto, mes a mes: los 12 meses que terminan en el mes
  // elegido (o en el actual), con todo lo de la cuenta, no solo el periodo.
  const serieTer = useMemo(() => {
    if (!terAbierto) return null;
    const ref = periodo === 'mes' ? new Date(mesY, mesM, 1) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const inicio = new Date(ref.getFullYear(), ref.getMonth() - 11, 1);
    const puntos: Punto[] = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(ref.getFullYear(), ref.getMonth() - (11 - i), 1);
      return { rot: `${MESES[d.getMonth()]}${d.getMonth() === 0 || i === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ''}`, rotLargo: `${MESES_L[d.getMonth()]} ${d.getFullYear()}`, v: 0, n: 0, elegido: periodo === 'mes' && i === 11 };
    });
    let historico = 0, nHistorico = 0;
    for (const a of asientos) {
      if (a.moneda !== moneda || a.dir !== vistaTer || !cuenta(a.tx) || !esDeTercero(a) || claveTercero(a) !== terAbierto) continue;
      historico += a.monto; nHistorico += 1;
      const d = new Date(a.ts);
      const i = (d.getFullYear() - inicio.getFullYear()) * 12 + d.getMonth() - inicio.getMonth();
      if (i >= 0 && i < 12) { puntos[i].v += a.monto; puntos[i].n += 1; }
    }
    return { puntos, doce: puntos.reduce((s, p) => s + p.v, 0), historico, nHistorico };
  }, [terAbierto, asientos, moneda, vistaTer, periodo, mesY, mesM, ahora]);

  // Excel: el estado de cuenta del periodo, los movimientos listados (con el
  // filtro y la búsqueda que estén puestos) y a quién se le envió y de quién
  // se recibió, con su gráfico y, si el periodo tiene varios meses, cuánto
  // por mes. Fechas y montos van como fecha y número reales, no como texto,
  // para que Excel pueda sumar y filtrar; el saldo va como fórmula.
  const excel = () => {
    const estadoDoc = (f: { estado: string | null; numero: string | null; tipo: string | null } | undefined) => {
      if (!f?.estado) return '';
      const tipo = f.tipo === 'FV' ? 'Factura' : f.tipo === 'DS' ? 'Doc. soporte' : '';
      const rot = f.estado === 'emitida' ? 'Emitida' : f.estado === 'anulada' ? 'Anulada' : f.estado === 'omitida' ? 'Omitida' : f.estado === 'pendiente' ? 'Pendiente' : f.estado === 'error' ? 'Error' : f.estado;
      return [tipo, rot].filter(Boolean).join(' · ');
    };
    const c = (v: any, s: Estilo): CeldaX => ({ v: v === undefined || v === '' ? null : v, s });
    const sMon: Estilo = moneda === 'COP' ? 'cop' : 'usd';
    const sTot: Estilo = moneda === 'COP' ? 'totalCop' : 'totalUsd';
    const sKpi: Estilo = moneda === 'COP' ? 'kpiCop' : 'kpiUsd';
    const fmtEje = moneda === 'COP' ? '"$"#,##0' : '#,##0.00';
    const conCosto = moneda === 'COP';
    const sumaCol = (col: number, d: number, h: number, v: number, s: Estilo): CeldaX => ({ f: `SUM(${refCelda(col, d)}:${refCelda(col, h)})`, v, s });
    const encabezado = (F: CeldaX[][], alt: Record<number, number>, comb: string[], titulo: string, sub: string, cols = 10) => {
      F.push([{ marca: true }]); alt[F.length - 1] = 28;
      F.push([c(titulo, 'titulo')]); alt[F.length - 1] = 24;
      F.push([c(sub, 'nota')]); comb.push(`A${F.length}:${refCelda(cols - 1, F.length - 1)}`);
    };
    const seccion = (F: CeldaX[][], alt: Record<number, number>, t: string, cols = 2) => {
      F.push([]);
      F.push([c(t, 'seccion'), ...Array.from({ length: cols - 1 }, () => c(null, 'seccion'))]); alt[F.length - 1] = 20;
    };

    // ── 1. Estado de cuenta: titular, resumen y cada movimiento del periodo
    //    con el saldo que dejó (fórmula: saldo anterior + entrada − salida −
    //    costo), del saldo inicial al final.
    const E: CeldaX[][] = [], combE: string[] = [], altE: Record<number, number> = {};
    encabezado(E, altE, combE, 'Estado de cuenta', `${ficha?.nombre ? `${ficha.nombre} · ` : ''}${periodoTxt} · ${moneda} · del ${desdeTxt} al ${hastaTxt}`);
    if (ficha) {
      seccion(E, altE, 'Titular');
      const datosFicha: [string, string][] = [
        ['Titular', ficha.nombre], [ficha.tipoDocumento || 'Documento', ficha.nit ?? ''],
        ['Dirección', [ficha.direccion, ficha.ciudad, ficha.pais].filter(Boolean).join(', ')],
        ['Representante legal', [ficha.representante, ficha.representanteDoc].filter(Boolean).join(' · ')],
        ['Correo', ficha.email ?? ''], ['Teléfono', ficha.telefono ?? ''], ['ID Lincoin', ficha.idLincoin ?? ''],
      ];
      for (const [k, v] of datosFicha) if (v) E.push([c(k, 'etiqueta'), c(v, 'kpiTexto')]);
    }
    seccion(E, altE, 'Resumen del periodo');
    const rIni = E.length; E.push([c('Saldo inicial', 'etiqueta'), c(ec.saldoInicial, sKpi)]);
    const rEnt = E.length; E.push([c(`(+) Entradas · ${ec.nEntradas}`, 'etiqueta'), c(ec.entradas, sKpi)]);
    const rSal = E.length; E.push([c(`(−) Salidas · ${ec.nSalidas}`, 'etiqueta'), c(ec.salidas, sKpi)]);
    const rCos = conCosto ? E.length : -1; if (conCosto) E.push([c('(−) Costos de envío', 'etiqueta'), c(ec.costos, sKpi)]);
    E.push([c('Saldo final', 'totalTexto'), { f: `${refCelda(1, rIni)}+${refCelda(1, rEnt)}-${refCelda(1, rSal)}${conCosto ? `-${refCelda(1, rCos)}` : ''}`, v: ec.saldoFinal, s: sTot }]);
    if (ec.nNoSuman) E.push([c(`${ec.nNoSuman} ${ec.nNoSuman === 1 ? 'operación rechazada o pendiente aparece' : 'operaciones rechazadas o pendientes aparecen'} abajo sin mover el saldo.`, 'nota')]);
    if (porTipo.length) {
      seccion(E, altE, 'Por concepto', 4);
      E.push(['Concepto', 'Dirección', 'Operaciones', 'Monto'].map(h => c(h, 'th')));
      for (const [tipo, v] of porTipo) E.push([c(tipo, 'texto'), c(v.dir === 'in' ? 'Entrada' : 'Salida', 'texto'), c(v.n, 'entero'), c(v.monto, sMon)]);
      if (conCosto && ec.costos > 0) E.push([c('Costo de envío', 'texto'), c('Salida', 'texto'), c(ec.filas.filter(f => f.costo != null).length, 'entero'), c(ec.costos, sMon)]);
    }
    seccion(E, altE, 'Movimientos', conCosto ? 11 : 10);
    const cabE = ['Fecha', 'Concepto', 'Tercero', 'Documento', 'Banco · cuenta', 'Comprobante', 'Estado', 'Entrada', 'Salida', ...(conCosto ? ['Costo del envío'] : []), 'Saldo'];
    const colEnt = 7, colSal = 8, colCos = conCosto ? 9 : -1, colSaldo = conCosto ? 10 : 9;
    const rCabE = E.length; E.push(cabE.map(h => c(h, 'th'))); altE[rCabE] = 30;
    const rSaldoIni = E.length;
    E.push([c(new Date(periodo === 'historico' && Number.isFinite(primerTs) ? primerTs : pDesde), 'fechaHora'), c('Saldo inicial', 'totalTexto'), ...Array.from({ length: colSaldo - 2 }, () => c(null, 'texto')), { f: refCelda(1, rIni), v: ec.saldoInicial, s: sTot }]);
    for (const f of ec.filas) {
      const a = f.a, r = E.length;
      const ter = datosTercero(a.tx, a.contraparte);
      const propio = a.tipo === 'Conversión' || a.tipo === 'Ajuste';
      E.push([
        c(new Date(a.ts), 'fechaHora'), c(a.tipo, 'texto'), c(propio ? a.contraparte : (ter.nombre || a.contraparte), 'texto'),
        c(propio ? '' : [ter.docTipo, ter.docNum].filter(Boolean).join(' '), 'texto'),
        c(propio ? '' : [ter.banco, ter.tipoCuenta, ter.cuenta].filter(Boolean).join(' · '), 'texto'),
        c(folios[String(a.tx.id)]?.numero ?? '', 'texto'), c(a.estado, 'texto'),
        c(f.entrada, sMon), c(f.salida, sMon), ...(conCosto ? [c(f.costo, sMon)] : []),
        { f: `${refCelda(colSaldo, r - 1)}+N(${refCelda(colEnt, r)})-N(${refCelda(colSal, r)})${conCosto ? `-N(${refCelda(colCos, r)})` : ''}`, v: f.saldo, s: sMon },
      ]);
    }
    const dE = rSaldoIni + 1, hE = E.length - 1;
    if (ec.filas.length) {
      E.push([c(null, 'totalTexto'), c('Totales del periodo', 'totalTexto'), ...Array.from({ length: 5 }, () => c(null, 'totalTexto')),
        sumaCol(colEnt, dE, hE, ec.entradas, sTot), sumaCol(colSal, dE, hE, ec.salidas, sTot), ...(conCosto ? [sumaCol(colCos, dE, hE, ec.costos, sTot)] : []),
        { f: refCelda(colSaldo, hE), v: ec.saldoFinal, s: sTot }]);
    }
    E.push([]);
    E.push([c('Suma lo completado y lo que está en proceso; lo rechazado se lista y no mueve el saldo. El saldo inicial es la suma de todos los movimientos anteriores al periodo, desde el primero en Lincoin. Una conversión es una salida en una moneda y una entrada en la otra.' + (conCosto ? ' El costo de cada envío se descuenta del saldo junto con el monto enviado.' : '') + ' Lincoin no es un banco y este documento no es un extracto bancario.', 'nota')]);
    combE.push(`A${E.length}:${refCelda(colSaldo, E.length - 1)}`); altE[E.length - 1] = 46;
    const hojaEstado: Hoja = {
      nombre: 'Estado de cuenta', filas: E, combinar: combE, altos: altE, cabecera: null, fijar: 0, color: '15181A', imprimirAncho: true,
      filtro: ec.filas.length ? `${refCelda(0, rCabE)}:${refCelda(colSaldo, hE)}` : null,
      anchos: [30, 16, 34, 18, 34, 14, 12, 16, 16, ...(conCosto ? [14] : []), 18],
    };

    // ── 2. Movimientos listados en pantalla (filtro y búsqueda incluidos),
    //    con lo de Siigo. El saldo de cada fila se acumula con TODOS los
    //    movimientos de la moneda desde el primero, así es el que tenía la
    //    cuenta justo después de esa operación.
    const saldoTras = new Map<Asiento, number>();
    let acumulado = 0;
    for (const x of asientos.filter(x => x.moneda === moneda).sort((p, q) => p.ts - q.ts)) {
      acumulado += efecto(x);
      saldoTras.set(x, acumulado);
    }
    const filasHoja = [...lista].sort((p, q) => p.ts - q.ts);
    const primera = filasHoja[0];
    const saldoInicial = primera ? (saldoTras.get(primera) ?? 0) - efecto(primera) : 0;
    let totEntradas = 0, totSalidas = 0, totCostos = 0;
    const movimientos: (string | number | Date | null)[][] = [
      ['Fecha', 'Tipo', 'Nombre', 'Tipo de documento', 'Número de documento', 'Banco', 'Tipo de cuenta', 'Cuenta / llave', 'Entrada', 'Salida', 'Costo del envío', 'Saldo', 'Moneda', 'Estado', 'Comprobante', 'Documento Siigo', 'Nº Siigo', 'Referencia', 'Id'],
      [primera ? new Date(primera.ts) : null, 'Saldo inicial', '', '', '', '', '', '', null, null, null, saldoInicial, moneda, '', '', '', '', '', ''],
    ];
    for (const a of filasHoja) {
      const f = folios[String(a.tx.id)];
      const suma = cuenta(a.tx);
      if (suma) { if (a.dir === 'in') totEntradas += a.monto; else { totSalidas += a.monto; totCostos += a.costo; } }
      const ter = datosTercero(a.tx, a.contraparte);
      movimientos.push([
        new Date(a.ts), a.tipo, ter.nombre, ter.docTipo, ter.docNum, ter.banco, ter.tipoCuenta, ter.cuenta,
        a.dir === 'in' ? (suma ? a.monto : null) : null,
        a.dir === 'out' ? (suma ? a.monto : null) : null,
        suma && a.costo > 0 ? a.costo : null,
        saldoTras.get(a) ?? null, a.moneda, a.estado,
        f?.numero ?? '', estadoDoc(f?.factura), f?.factura?.numero ?? '',
        String(a.tx.providerRef ?? a.tx.reference ?? a.tx.txHash ?? ''), String(a.tx.id),
      ]);
    }
    const saldoFinal = filasHoja.length ? (saldoTras.get(filasHoja[filasHoja.length - 1]) ?? saldoInicial) : saldoInicial;
    movimientos.push([null, 'Totales', '', '', '', '', '', '', totEntradas, totSalidas, totCostos, saldoFinal, moneda, '', '', '', '', '', '']);

    // ── 3 y 4. A quién se le envió y de quién se recibió: una fila por
    //    tercero, el gráfico de los 15 primeros y, si el periodo tiene más de
    //    un mes, cuánto por mes.
    const mesesPeriodo = (() => {
      if (periodo === 'mes') return [] as { y: number; m: number }[];
      const ini = periodo === 'anio' ? new Date(ahora.getFullYear(), 0, 1) : new Date(Number.isFinite(primerTs) ? primerTs : ahora.getTime());
      const out: { y: number; m: number }[] = [];
      for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= ahora; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push({ y: d.getFullYear(), m: d.getMonth() });
      return out.slice(-36);
    })();
    // En Histórico con más de 3 años el cuadro mes a mes muestra los últimos
    // 36: su total es el de ESOS meses (y lo dice), no el de toda la historia.
    const mesesRecortados = periodo === 'historico' && Number.isFinite(primerTs)
      && ((ahora.getFullYear() - new Date(primerTs).getFullYear()) * 12 + ahora.getMonth() - new Date(primerTs).getMonth() + 1) > 36;
    const hojaTerceros = (nombre: string, titulo: string, ters: Tercero[], dir: Dir): Hoja => {
      const F: CeldaX[][] = [], comb: string[] = [], alt: Record<number, number> = {};
      const conCostoT = dir === 'out' && conCosto;
      encabezado(F, alt, comb, titulo, `${ficha?.nombre ? `${ficha.nombre} · ` : ''}${periodoTxt} · ${moneda} · solo lo completado o en proceso`);
      F.push([]);
      const cab = ['Nombre', 'Tipo de documento', 'Documento', 'Banco', 'Tipo de cuenta', 'Cuenta / llave', 'Operaciones', `Total ${moneda}`, ...(conCostoT ? ['Costos de envío'] : []), '% del total', 'Primera', 'Última'];
      const colTot = 7;
      const rCab = F.length; F.push(cab.map(h => c(h, 'th'))); alt[rCab] = 30;
      const d0 = F.length, total = ters.reduce((s, t) => s + t.total, 0);
      const rTotal = d0 + ters.length;
      for (const t of ters) {
        const r = F.length;
        F.push([c(t.nombre, 'texto'), c(t.docTipo, 'texto'), c(t.docNum, 'texto'), c(t.banco, 'texto'), c(t.tipoCuenta, 'texto'), c(t.cuenta, 'texto'),
          c(t.n, 'entero'), c(t.total, sMon), ...(conCostoT ? [c(t.costos, sMon)] : []),
          { f: `IF(${refCelda(colTot, rTotal)}=0,0,${refCelda(colTot, r)}/${refCelda(colTot, rTotal)})`, v: total ? t.total / total : 0, s: 'pct' },
          c(new Date(t.primera), 'dia'), c(new Date(t.ultima), 'dia')]);
      }
      const h0 = F.length - 1;
      if (ters.length) {
        F.push([c('Total', 'totalTexto'), ...Array.from({ length: 5 }, () => c(null, 'totalTexto')),
          sumaCol(6, d0, h0, ters.reduce((s, t) => s + t.n, 0), 'totalEntero'), sumaCol(colTot, d0, h0, total, sTot),
          ...(conCostoT ? [sumaCol(8, d0, h0, ters.reduce((s, t) => s + t.costos, 0), sTot)] : []),
          { v: 1, s: 'totalPct' }, c(null, 'totalTexto'), c(null, 'totalTexto')]);
      } else F.push([c('Sin movimientos en el periodo.', 'nota')]);
      // El gráfico va debajo de la tabla, en filas reservadas: a la derecha
      // la hoja quedaba tan ancha que al imprimir todo salía diminuto.
      const graficos: Hoja['graficos'] = [];
      if (ters.length >= 2) {
        const k = Math.min(15, ters.length), altoG = Math.max(14, k + 6);
        F.push([]);
        graficos.push({
          tipo: 'barras', titulo: `${titulo} · ${k} principales (${moneda})`, serie: `Total ${moneda}`,
          colCategorias: 0, colValores: colTot, desdeFila: d0, hastaFila: d0 + k - 1,
          formato: fmtEje, color: dir === 'out' ? '15181A' : '22A35C', col: 0, fila: F.length, ancho: 8, alto: altoG,
        });
        for (let i = 0; i < altoG; i++) F.push([]);
      }
      // Cuánto por mes a cada tercero.
      if (mesesPeriodo.length > 1 && ters.length) {
        seccion(F, alt, `${dir === 'out' ? 'Enviado' : 'Recibido'} por mes${mesesRecortados ? ' · últimos 36 meses' : ''}`, mesesPeriodo.length + 3);
        F.push(['Nombre', 'Documento', ...mesesPeriodo.map(o => `${MESES[o.m]} ${o.y}`), 'Total'].map(h => c(h, 'th')));
        const dm = F.length;
        const delMes = (t: Tercero, o: { y: number; m: number }) => t.asientos.filter(a => { const d = new Date(a.ts); return d.getFullYear() === o.y && d.getMonth() === o.m; }).reduce((s, a) => s + a.monto, 0);
        let totalMeses = 0;
        for (const t of ters) {
          const r = F.length;
          const porMes = mesesPeriodo.map(o => delMes(t, o));
          const fila = porMes.reduce((s, v) => s + v, 0);
          totalMeses += fila;
          F.push([c(t.nombre, 'texto'), c([t.docTipo, t.docNum].filter(Boolean).join(' '), 'texto'), ...porMes.map(v => c(v || null, sMon)),
            { f: `SUM(${refCelda(2, r)}:${refCelda(mesesPeriodo.length + 1, r)})`, v: fila, s: sMon }]);
        }
        const hm = F.length - 1;
        F.push([c('Total', 'totalTexto'), c(null, 'totalTexto'), ...mesesPeriodo.map((o, i) => sumaCol(2 + i, dm, hm, ters.reduce((s, t) => s + delMes(t, o), 0), sTot)),
          sumaCol(mesesPeriodo.length + 2, dm, hm, totalMeses, sTot)]);
      }
      return {
        nombre, filas: F, combinar: comb, altos: alt, graficos, cabecera: null, fijar: 0, imprimirAncho: true,
        color: dir === 'out' ? '15181A' : '22A35C',
        filtro: ters.length ? `${refCelda(0, rCab)}:${refCelda(cab.length - 1, h0)}` : null,
        // Las columnas de los meses (de la C en adelante) comparten ancho con
        // la tabla de arriba: ninguna menos de 16, o los montos salen "###".
        anchos: Array.from({ length: Math.max(cab.length, mesesPeriodo.length > 1 ? mesesPeriodo.length + 3 : 0) }, (_, i) => {
          const base = [34, 14, 16, 22, 16, 22, 12, 18, ...(conCostoT ? [16] : []), 11, 12, 12][i] ?? 0;
          return mesesPeriodo.length > 1 && i >= 2 ? Math.max(base, 16) : base || 12;
        }),
      };
    };

    const rotArchivo = periodo === 'mes' ? `${mesY}-${String(mesM + 1).padStart(2, '0')}` : periodo;
    descargarXlsx(`lincoin-contabilidad-${moneda}-${rotArchivo}-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      hojaEstado,
      { nombre: 'Movimientos', filas: movimientos, anchos: [18, 16, 34, 16, 18, 22, 16, 22, 16, 16, 14, 18, 8, 12, 14, 22, 12, 30, 38] },
      hojaTerceros('Enviado a', 'A quién se le envió', enviadoA, 'out'),
      hojaTerceros('Recibido de', 'De quién se recibió', recibidoDe, 'in'),
    ]);
  };

  const rotPeriodo = periodo === 'mes' ? (esMesActual ? 'este mes' : rotMes) : periodo === 'anio' ? 'este año' : 'histórico';
  const rotAnt = periodo === 'mes' ? 'el mes anterior' : 'el año anterior';
  const deltaTxt = (d: number | null) => d == null ? (periodo === 'historico' ? 'Todo el historial' : `Sin ${rotAnt} para comparar`) : `${d > 0 ? '+' : ''}${d.toLocaleString('es-CO', { maximumFractionDigits: 1 })} % vs. ${rotAnt}`;
  const fecha = (ts: number) => new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const estadoColor = (s: string) => s === 'Completado' ? C.entra : s === 'Rechazado' || s === 'Fallido' ? C.tenue : C.medio;
  const seg = (act: boolean): React.CSSProperties => ({ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', color: act ? C.text : C.sub, background: act ? 'rgba(255,255,255,0.09)' : 'transparent', transition: 'background 120ms, color 120ms' });
  const kpi = (rot: string, valor: string, nota: string, notaColor = C.sub) => (
    <Tarjeta>
      <Rotulo>{rot}</Rotulo>
      <p style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 0', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valor}</p>
      <p style={{ fontSize: 12, margin: '4px 0 0', color: notaColor }}>{nota}</p>
    </Tarjeta>
  );

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. Periodo · moneda · CSV */}
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 12 }}>
        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
          <div className="flex" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: 3 }}>
            {([['mes', 'Mes'], ['anio', 'Este año'], ['historico', 'Histórico']] as [Periodo, string][]).map(([k, rot]) => (
              <button key={k} onClick={() => { setPeriodo(k); setLimite(25); }} style={seg(periodo === k)}>{rot}</button>
            ))}
          </div>
          {/* Qué mes: flechas para ir y venir y la lista para saltar directo. */}
          {periodo === 'mes' && (
            <div className="flex items-center" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: 3, gap: 2 }}>
              <button onClick={() => irAMes(opcionesMes[idxMes + 1])} disabled={idxMes < 0 || idxMes >= opcionesMes.length - 1}
                aria-label="Mes anterior" title="Mes anterior"
                style={{ ...seg(false), padding: '7px 11px', opacity: idxMes < 0 || idxMes >= opcionesMes.length - 1 ? 0.35 : 1 }}>‹</button>
              <select value={`${mesY}-${mesM}`} aria-label="Mes"
                onChange={e => { const [y, m] = e.target.value.split('-').map(Number); irAMes({ y, m }); }}
                style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: '#121413', border: 'none', borderRadius: 7, padding: '7px 8px', outline: 'none', cursor: 'pointer' }}>
                {opcionesMes.map(o => (
                  <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>
                    {`${MESES_L[o.m].charAt(0).toUpperCase()}${MESES_L[o.m].slice(1)} ${o.y}`}{o.y === ahora.getFullYear() && o.m === ahora.getMonth() ? ' · en curso' : ''}
                  </option>
                ))}
              </select>
              <button onClick={() => irAMes(opcionesMes[idxMes - 1])} disabled={idxMes <= 0}
                aria-label="Mes siguiente" title="Mes siguiente"
                style={{ ...seg(false), padding: '7px 11px', opacity: idxMes <= 0 ? 0.35 : 1 }}>›</button>
            </div>
          )}
          {hayCop && hayUsd && (
            <div className="flex" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: 3 }}>
              {(['COP', 'USD'] as Moneda[]).map(m => <button key={m} onClick={() => setMonedaSel(m)} style={seg(moneda === m)}>{m}</button>)}
            </div>
          )}
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          {facturacionActiva != null && (
            <button onClick={alternarAutomatica} disabled={cambiandoAuto}
              title={facturacionActiva ? 'La facturación automática está activa: cada operación completada emite su documento en Siigo. Tocá para pausar.' : 'La facturación automática está pausada: nada se emite solo. Tocá para activar (la configuración debe estar completa).'}
              style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 14px', borderRadius: 9, cursor: 'pointer', color: facturacionActiva ? C.entra : C.sub, background: facturacionActiva ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.05)', border: `1px solid ${facturacionActiva ? 'rgba(74,222,128,0.35)' : C.borde}`, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: cambiandoAuto ? 0.6 : 1 }}>
              <span style={{ width: 28, height: 16, borderRadius: 999, background: facturacionActiva ? C.entra : 'rgba(255,255,255,0.18)', position: 'relative', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 2, left: facturacionActiva ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#0C0E0D', transition: 'left .15s' }} />
              </span>
              {cambiandoAuto ? '…' : facturacionActiva ? 'Automática' : 'Automática apagada'}
            </button>
          )}
          {!soloLectura && (
            <button onClick={() => setContadorAbierto(true)} title="Dale acceso de solo lectura a tu contador: entra por Empresas → Contabilidad con su propio correo."
              style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 16px', borderRadius: 9, cursor: 'pointer', color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              className="hover:border-[rgba(255,255,255,0.22)] transition-colors">
              Contador
            </button>
          )}
          {!soloLectura && (
            <button onClick={() => setConfigAbierta(true)}
              style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 16px', borderRadius: 9, cursor: 'pointer', color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              className="hover:border-[rgba(255,255,255,0.22)] transition-colors">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: facturacionActiva ? C.entra : 'rgba(255,255,255,0.18)', flexShrink: 0 }} />
              Configuración
            </button>
          )}
          <button onClick={excel} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 18px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>Descargar Excel</button>
        </div>
      </div>
      {configAbierta && !soloLectura && <FacturacionConfig onCerrar={() => setConfigAbierta(false)} />}
      {dupAbierto && <DuplicadasModal empresaId={soloLectura ? userId : null} soloLectura={soloLectura} onCerrar={() => setDupAbierto(false)} onCambio={() => setFoliosVersion(v => v + 1)} />}
      {contadorAbierto && !soloLectura && <AccesoContadorModal onCerrar={() => setContadorAbierto(false)} />}
      {estadoAbierto && (
        <EstadoCuentaHoja estado={ec} ficha={ficha} periodoTxt={periodoTxt} desdeTxt={desdeTxt} hastaTxt={hastaTxt}
          folios={folios} enviadoA={enviadoA} recibidoDe={recibidoDe} onCerrar={() => setEstadoAbierto(false)} />
      )}
      {lote && cfgFact && (
        <EmisionLoteModal items={lote} cfg={cfgFact} periodoTxt={periodoTxt} vivo={vivo} lecturas={lecturas} esPropio={esPropio} onCerrar={() => { setLote(null); setLoteAbierto(false); setPulsoFolios(v => v + 1); }} onEncolado={() => setPulsoFolios(v => v + 1)} />
      )}
      {comisionPara && cfgFact && (
        <FacturaComisionModal asiento={comisionPara} cfg={cfgFact} onCerrar={() => setComisionPara(null)} onEmitida={() => { setComisionPara(null); setFoliosVersion(v => v + 1); }} />
      )}
      {/* Aviso: operaciones completadas sin comprobante = el aviso automático
          de la base (trigger) no llegó a la función para esas. El servidor
          las pone al día solo (crea el comprobante y, con la automática
          activa, emite); acá se dice y se ofrece hacerlo ya. */}
      {chequeo && chequeo.sinComprobante > 0 && (
        <div style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', fontFamily: FONT, fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>
          <b>{chequeo.sinComprobante} de tus últimas {chequeo.ultimos} operaciones completadas no tenían comprobante.</b> Para esas, el aviso automático de la base (trigger <code>trg_cuypay_notify_tx</code>) no llegó a la función. Se están poniendo al día ahora: se les crea el comprobante y, con la automática activa, se emite el documento (de a pocas por vez; recargá en un minuto).
          {' '}Si esto se repite en cada operación nueva, hay que revisar el trigger en Supabase (ver <code>supabase/migrations/2026_comprobantes.sql</code>, sección final).
          <button onClick={reconciliarAhora} disabled={reconciliando}
            style={{ marginLeft: 10, fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.borde}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', opacity: reconciliando ? 0.5 : 1 }}>
            {reconciliando ? 'Poniendo al día…' : 'Ponerse al día ahora'}
          </button>
          {reconciliadoMsg && <span style={{ display: 'block', marginTop: 6, color: C.sub }}>{reconciliadoMsg}</span>}
        </div>
      )}

      {/* 2. KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {kpi('RECIBIDO', fmtMon(recibido, moneda), deltaTxt(dRec), dRec != null && dRec > 0 ? C.entra : C.sub)}
        {kpi('ENVIADO', fmtMon(enviado, moneda), deltaTxt(dEnv))}
        {kpi('NETO', `${neto >= 0 ? '+' : '−'}${fmtMon(Math.abs(neto), moneda)}`, costosP > 0 ? `Ya resta ${fmtMon(costosP, moneda)} de costos de envío` : neto >= 0 ? 'Entró más de lo que salió' : 'Salió más de lo que entró')}
        {kpi('MOVIMIENTOS', String(nIn + nOut), `${nIn} ${nIn === 1 ? 'recibido' : 'recibidos'} · ${nOut} ${nOut === 1 ? 'enviado' : 'enviados'}`)}
      </div>

      {/* 2b. Estado de cuenta del periodo y, para la contadora, el titular. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <Tarjeta>
          <div className="flex items-start justify-between flex-wrap" style={{ gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <Rotulo>ESTADO DE CUENTA · {periodoTxt.toUpperCase()} · {moneda}</Rotulo>
              <p style={{ fontSize: 12, color: C.sub, margin: '5px 0 0' }}>Del {desdeTxt} al {hastaTxt}</p>
            </div>
            <button onClick={() => setEstadoAbierto(true)} className="lincoin-btn-white"
              style={{ fontFamily: FONT, fontWeight: 700, fontSize: 12.5, padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Ver estado de cuenta · PDF
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            {([
              ['Saldo inicial', fmtMon(ec.saldoInicial, moneda), C.text, false],
              [`(+) Entradas · ${ec.nEntradas}`, `+${fmtMon(ec.entradas, moneda)}`, C.entra, false],
              [`(−) Salidas · ${ec.nSalidas}`, `−${fmtMon(ec.salidas, moneda)}`, C.text, false],
              ...(moneda === 'COP' ? [[`(−) Costos de envío`, `−${fmtMon(ec.costos, moneda)}`, C.text, false]] : []),
              ['Saldo final', fmtMon(ec.saldoFinal, moneda), C.text, true],
            ] as [string, string, string, boolean][]).map(([k, v, col, fuerte]) => (
              <div key={k} className="flex items-center justify-between" style={{ gap: 12, padding: fuerte ? '10px 0 2px' : '7px 0', borderTop: `1px solid ${fuerte ? 'rgba(255,255,255,0.18)' : C.borde}` }}>
                <span style={{ fontSize: fuerte ? 13.5 : 12.5, color: fuerte ? C.text : C.sub, fontWeight: fuerte ? 800 : 500 }}>{k}</span>
                <span style={{ fontSize: fuerte ? 16 : 13, color: col, fontWeight: fuerte ? 800 : 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', letterSpacing: fuerte ? '-0.3px' : 0 }}>{v}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: C.tenue, margin: '10px 0 0', lineHeight: 1.5 }}>
            El saldo inicial suma todo lo anterior al periodo. {moneda === 'COP' ? 'Cada envío descuenta el monto y su costo. ' : ''}Lo rechazado no mueve el saldo{ec.nNoSuman ? ` (${ec.nNoSuman} en el periodo)` : ''}. El PDF trae cada movimiento con su saldo y a quién se le envió.
          </p>
        </Tarjeta>
        {soloLectura && ficha && (
          <Tarjeta>
            <Rotulo>DATOS DE LA EMPRESA</Rotulo>
            <div style={{ marginTop: 10 }}>
              {([
                ['Razón social', ficha.nombre],
                [ficha.tipoDocumento || 'NIT', ficha.nit ?? ''],
                ['Dirección', [ficha.direccion, ficha.ciudad, ficha.pais].filter(Boolean).join(', ')],
                ['Representante legal', [ficha.representante, ficha.representanteDoc].filter(Boolean).join(' · ')],
                ['Correo', ficha.email ?? ''],
                ['Teléfono', ficha.telefono ?? ''],
                ['ID Lincoin', ficha.idLincoin ?? ''],
                ['Cliente desde', ficha.clienteDesde ? fechaLarga(new Date(ficha.clienteDesde).getTime()) : ''],
              ] as [string, string][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex items-start justify-between" style={{ gap: 14, padding: '7px 0', borderTop: `1px solid ${C.borde}` }}>
                  <span style={{ fontSize: 12, color: C.sub, flexShrink: 0 }}>{k}</span>
                  <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word', minWidth: 0 }}>{v}</span>
                </div>
              ))}
            </div>
          </Tarjeta>
        )}
      </div>

      {/* 3. Gráfico + por tipo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <Barras cubos={cubos} moneda={moneda} titulo={periodo === 'mes' ? `MOVIMIENTOS POR DÍA · ${rotMes.toUpperCase()}` : 'MOVIMIENTOS POR MES'} />
        <Tarjeta>
          <Rotulo>POR TIPO · {rotPeriodo.toUpperCase()}</Rotulo>
          {porTipo.length === 0 ? <p style={{ fontSize: 12.5, color: C.tenue, margin: '14px 0 0' }}>Sin movimientos en el periodo.</p>
            : porTipo.map(([tipo, v], i) => (
              <div key={tipo} style={{ marginTop: i === 0 ? 12 : 10 }}>
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <span className="flex items-center" style={{ gap: 7, fontSize: 12.5, color: C.text }}><Swatch color={v.dir === 'in' ? C.entra : C.sale} />{tipo} <span style={{ color: C.tenue }}>· {v.n}</span></span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtMon(v.monto, moneda)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', marginTop: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, (v.monto / maxTipo) * 100)}%`, height: '100%', background: v.dir === 'in' ? C.entra : C.sale, opacity: v.dir === 'in' ? 1 : 0.85, borderRadius: 999 }} />
                </div>
              </div>
            ))}
        </Tarjeta>
      </div>

      {/* 3b. A quién se le envió / de quién se recibió, en el periodo. La
          barra de cada fila es su parte del total; al tocar una fila se ve
          cuánto se le envió mes a mes (12 meses) y cada operación. */}
      <Tarjeta style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '16px 20px 12px' }}>
          <div style={{ minWidth: 0 }}>
            <Rotulo>{vistaTer === 'out' ? 'A QUIÉN SE LE ENVIÓ' : 'DE QUIÉN SE RECIBIÓ'} · {periodoTxt.toUpperCase()} · {moneda}</Rotulo>
            <p style={{ fontSize: 12, color: C.sub, margin: '5px 0 0' }}>
              {listaTer.length === 0 ? 'Sin movimientos en el periodo.' : `${listaTer.length} ${listaTer.length === 1 ? 'tercero' : 'terceros'} · ${fmtMon(totalTer, moneda)} · toca uno para verlo mes a mes`}
            </p>
          </div>
          <div className="flex" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: 3 }}>
            {([['out', 'Enviado a'], ['in', 'Recibido de']] as [Dir, string][]).map(([k, rot]) => (
              <button key={k} onClick={() => { setVistaTer(k); setTerAbierto(null); setLimiteTer(10); }} style={seg(vistaTer === k)}>{rot}</button>
            ))}
          </div>
        </div>
        {listaTer.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr>{[vistaTer === 'out' ? 'BENEFICIARIO' : 'QUIÉN PAGÓ', 'OPERACIONES', vistaTer === 'out' ? 'ENVIADO' : 'RECIBIDO', '% DEL TOTAL', 'ÚLTIMA'].map((h, i) => <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i === 0 ? 'left' : 'right', padding: '8px 20px', borderBottom: `1px solid ${C.borde}`, borderTop: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>
                {listaTer.slice(0, limiteTer).map(t => {
                  const abierto = terAbierto === t.clave;
                  const color = vistaTer === 'out' ? C.sale : C.entra;
                  const det = [[t.docTipo, t.docNum].filter(Boolean).join(' '), [t.banco, t.tipoCuenta, t.cuenta].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
                  return (
                    <React.Fragment key={t.clave}>
                      <tr className="lincoin-fila-mov" onClick={() => setTerAbierto(abierto ? null : t.clave)} aria-expanded={abierto}
                        style={{ cursor: 'pointer', background: abierto ? 'rgba(255,255,255,0.03)' : undefined }}>
                        <td style={{ padding: '11px 20px', borderBottom: abierto ? 'none' : `1px solid ${C.borde}`, minWidth: 260 }}>
                          <p className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, gap: 7 }}>
                            <span style={{ fontSize: 10, color: C.tenue, width: 9, display: 'inline-block', transform: abierto ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▶</span>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380 }}>{t.nombre || '—'}</span>
                          </p>
                          {det && <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0 16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>{det}</p>}
                          <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.06)', margin: '7px 0 0 16px', overflow: 'hidden', maxWidth: 420 }}>
                            <div style={{ width: `${Math.max(2, (t.total / maxTer) * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
                          </div>
                        </td>
                        <td style={{ padding: '11px 20px', fontSize: 12.5, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: abierto ? 'none' : `1px solid ${C.borde}` }}>{t.n}</td>
                        <td style={{ padding: '11px 20px', fontSize: 13.5, fontWeight: 700, color: vistaTer === 'in' ? C.entra : C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderBottom: abierto ? 'none' : `1px solid ${C.borde}` }}>
                          {fmtMon(t.total, moneda)}
                          {t.costos > 0 && <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: C.tenue }}>+ {fmtMon(t.costos, moneda)} de costo</span>}
                        </td>
                        <td style={{ padding: '11px 20px', fontSize: 12.5, color: C.medio, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: abierto ? 'none' : `1px solid ${C.borde}` }}>{totalTer > 0 ? `${((t.total / totalTer) * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %` : '—'}</td>
                        <td style={{ padding: '11px 20px', fontSize: 12.5, color: C.medio, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: abierto ? 'none' : `1px solid ${C.borde}` }}>{new Date(t.ultima).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      </tr>
                      {abierto && serieTer && (
                        <tr>
                          <td colSpan={5} style={{ padding: '4px 20px 16px 36px', borderBottom: `1px solid ${C.borde}`, background: 'rgba(255,255,255,0.03)' }}>
                            <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 6 }}>
                              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>{vistaTer === 'out' ? 'ENVIADO' : 'RECIBIDO'} POR MES · ÚLTIMOS 12 MESES</p>
                              <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>12 meses: <b style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtMon(serieTer.doce, moneda)}</b> · desde el inicio: <b style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtMon(serieTer.historico, moneda)}</b> en {serieTer.nHistorico} {serieTer.nHistorico === 1 ? 'operación' : 'operaciones'}</p>
                            </div>
                            <Columnas puntos={serieTer.puntos} color={vistaTer === 'out' ? C.sale : C.entra} moneda={moneda} rotSerie={vistaTer === 'out' ? 'Enviado' : 'Recibido'} />
                            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '12px 0 4px' }}>OPERACIONES · {periodoTxt.toUpperCase()}</p>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <tbody>
                                {[...t.asientos].sort((x, y) => y.ts - x.ts).map((a, i) => (
                                  <tr key={`${a.tx.id}-${i}`}>
                                    <td style={{ padding: '6px 0', fontSize: 12, color: C.medio, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', borderTop: `1px solid ${C.borde}` }}>{fecha(a.ts)}</td>
                                    <td style={{ padding: '6px 12px', fontSize: 12, color: C.text, borderTop: `1px solid ${C.borde}` }}>{a.tipo}</td>
                                    <td style={{ padding: '6px 12px', fontSize: 12, color: C.tenue, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', borderTop: `1px solid ${C.borde}` }}>{folios[String(a.tx.id)]?.numero ?? ''}</td>
                                    <td style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', color: estadoColor(a.estado), whiteSpace: 'nowrap', borderTop: `1px solid ${C.borde}` }}>{a.estado.toUpperCase()}</td>
                                    <td style={{ padding: '6px 0', fontSize: 12.5, fontWeight: 700, color: a.dir === 'in' ? C.entra : C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderTop: `1px solid ${C.borde}` }}>
                                      {fmtMon(a.monto, moneda)}{a.costo > 0 && <span style={{ fontSize: 11, fontWeight: 500, color: C.tenue }}> + {fmtMon(a.costo, moneda)}</span>}
                                    </td>
                                    <td style={{ padding: '6px 0 6px 12px', textAlign: 'right', borderTop: `1px solid ${C.borde}` }}>
                                      {onVerMovimiento && <button onClick={() => onVerMovimiento(a.tx)} style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}>Ver</button>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {listaTer.length > limiteTer && (
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 20px', borderTop: `1px solid ${C.borde}` }}>
            <span style={{ fontSize: 12, color: C.sub }}>Mostrando {Math.min(limiteTer, listaTer.length)} de {listaTer.length}</span>
            <button onClick={() => setLimiteTer(l => l + 25)} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Ver más →</button>
          </div>
        )}
      </Tarjeta>

      {/* 4. Resumen por mes */}
      <Tarjeta style={{ padding: '18px 0 6px' }}>
        <div style={{ padding: '0 20px' }}><Rotulo>ÚLTIMOS 12 MESES · {moneda} · TOCA UN MES PARA VERLO</Rotulo></div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead><tr>{['MES', 'RECIBIDO', 'ENVIADO', 'NETO', 'MOVIMIENTOS'].map((h, i) => <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i === 0 ? 'left' : 'right', padding: '8px 20px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {meses12.map(m => { const vacio = m.movs === 0, col = vacio ? C.tenue : C.text, n = m.recibido - m.enviado, elegido = periodo === 'mes' && m.y === mesY && m.m === mesM; return (
                <tr key={m.rot} onClick={() => irAMes({ y: m.y, m: m.m })} title="Ver los movimientos de este mes"
                  style={{ cursor: 'pointer', background: elegido ? 'rgba(74,222,128,0.06)' : undefined }}>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, borderBottom: `1px solid ${C.borde}`, textTransform: 'capitalize' }}>{m.rot}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{m.recibido > 0 ? fmtMon(m.recibido, moneda) : '—'}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{m.enviado > 0 ? fmtMon(m.enviado, moneda) : '—'}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', fontWeight: 700 }}>{vacio ? '—' : `${n >= 0 ? '+' : '−'}${fmtMon(Math.abs(n), moneda)}`}</td>
                  <td style={{ padding: '9px 20px', fontSize: 12.5, color: col, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}` }}>{m.movs}</td>
                </tr>
              ); })}
              <tr>
                <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text }}>Total</td>
                {[meses12.reduce((s, m) => s + m.recibido, 0), meses12.reduce((s, m) => s + m.enviado, 0)].map((v, i) => <td key={i} style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtMon(v, moneda)}</td>)}
                {(() => { const n = meses12.reduce((s, m) => s + m.recibido - m.enviado, 0); return <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{`${n >= 0 ? '+' : '−'}${fmtMon(Math.abs(n), moneda)}`}</td>; })()}
                <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 800, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{meses12.reduce((s, m) => s + m.movs, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {/* 5. Movimientos */}
      <Tarjeta style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '14px 20px', borderBottom: `1px solid ${C.borde}` }}>
          <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
            <p style={{ fontSize: 14.5, fontWeight: 700, color: C.text, margin: '0 8px 0 0' }}>Movimientos</p>
            {([['todos', 'Todos'], ['in', 'Recibidos'], ['out', 'Enviados'], ['conv', 'Conversiones']] as const).map(([k, rot]) => { const act = filtroDir === k; return (
              <button key={k} onClick={() => { setFiltroDir(k); setLimite(25); }} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', color: act ? C.text : C.sub, background: act ? 'rgba(255,255,255,0.08)' : 'transparent', border: `1px solid ${act ? 'rgba(255,255,255,0.22)' : C.borde}` }}>{rot}</button>
            ); })}
            {/* Aparte de la dirección: se combina con ella (p. ej. Enviados
                sin factura). El número es lo que falta en lo filtrado. */}
            {foliosEstado === 'ok' && (
              <button onClick={() => { setSoloSinFactura(v => !v); setLimite(25); }} aria-pressed={soloSinFactura}
                title="Movimientos completados que se pueden facturar y todavía no tienen factura emitida"
                style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', marginLeft: 4, color: soloSinFactura ? C.text : C.sub, background: soloSinFactura ? 'rgba(74,222,128,0.10)' : 'transparent', border: `1px solid ${soloSinFactura ? 'rgba(74,222,128,0.40)' : C.borde}` }}>
                Sin factura <span style={{ color: soloSinFactura ? C.entra : C.tenue, fontVariantNumeric: 'tabular-nums' }}>· {nSinFactura}</span>
              </button>
            )}
          </div>
          <div className="flex items-center flex-wrap" style={{ gap: 8, maxWidth: '100%' }}>
            {/* La cola del lote trabaja en el servidor: se ve acá aunque se
                haya cerrado la ventana, y se puede detener. */}
            {enCola > 0 && !soloLectura && (
              <span className="flex items-center" style={{ gap: 8, fontSize: 12, color: C.sub, padding: '6px 4px' }} title="Lincoin está emitiendo estas facturas en segundo plano, una por una">
                <span style={{ width: 7, height: 7, borderRadius: 999, background: C.entra, display: 'inline-block' }} />
                Emitiendo · quedan {enCola}
                <button onClick={detenerCola} disabled={deteniendoCola} style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', opacity: deteniendoCola ? 0.5 : 1 }}>{deteniendoCola ? '…' : 'Detener'}</button>
              </span>
            )}
            {puedeLote && nLote > 0 && (
              <button onClick={() => { setLote(itemsLote()); setLoteAbierto(true); }}
                title="Emitir en Siigo, una por una, las facturas de los movimientos sin factura de lo que está filtrado"
                style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 9, padding: '9px 13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Emitir en lote · {nLote}
              </button>
            )}
            {((!soloLectura && !!cfgFact) || (soloLectura && Object.values(folios).some((f: any) => !!f?.factura?.numero))) && (
              <button onClick={() => setDupAbierto(true)}
                title="Busca en Siigo movimientos con más de una factura vigente y facturas que Lincoin no tiene registradas"
                style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Revisar duplicadas
              </button>
            )}
          <input value={busca} onChange={e => { setBusca(e.target.value); setLimite(25); }} placeholder="Buscar por contraparte, comprobante o referencia" style={{ fontFamily: FONT, fontSize: 13, color: C.text, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', outline: 'none', width: 300, maxWidth: '100%' }} />
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead><tr>{['FECHA', 'MOVIMIENTO', 'MONTO', 'ESTADO', 'COMPROBANTE', 'FACTURA', ''].map((h, i) => <th key={h || 'acc'} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.tenue, textAlign: i === 2 ? 'right' : 'left', padding: '9px 20px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {mostrados.length === 0 && <tr><td colSpan={7} style={{ padding: '18px 20px', fontSize: 12.5, color: C.tenue }}>{soloSinFactura && listaBase.length ? `Todo lo filtrado de ${periodoTxt} ya tiene factura (o no aplica).` : 'Sin movimientos que coincidan.'}</td></tr>}
              {mostrados.map((a, i) => {
                const rech = a.estado === 'Rechazado' || a.estado === 'Fallido';
                const f = folios[String(a.tx.id)];
                return (
                  <tr key={`${a.tx.id}-${a.dir}-${i}`} className="lincoin-fila-mov" style={{ cursor: onVerMovimiento ? 'pointer' : 'default' }} onClick={() => onVerMovimiento?.(a.tx)}>
                    <td style={{ padding: '11px 20px', fontSize: 12.5, color: C.medio, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fecha(a.ts)}</td>
                    <td style={{ padding: '11px 20px', borderBottom: `1px solid ${C.borde}`, minWidth: 220 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0 }}>{a.tipo}</p>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>{a.contraparte}</p>
                    </td>
                    <td style={{ padding: '11px 20px', fontSize: 13.5, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', color: rech ? C.tenue : a.dir === 'in' ? C.entra : C.text, textDecoration: rech ? 'line-through' : 'none' }}>{a.dir === 'in' ? '+' : '−'}{fmtMon(a.monto, a.moneda)}</td>
                    <td style={{ padding: '11px 20px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', borderBottom: `1px solid ${C.borde}`, color: estadoColor(a.estado), whiteSpace: 'nowrap' }}>{a.estado.toUpperCase()}</td>
                    <td style={{ padding: '11px 20px', fontSize: 12.5, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace', color: f ? C.text : C.tenue }} title={f ? (f.enviado ? 'Enviado por correo' : 'Emitido; el correo no salió') : undefined}>
                      {f ? f.numero : (a.estado === 'Completado' ? '—' : '')}
                    </td>
                    {/* FACTURA: lo que Siigo contestó, o por qué no se emitió.
                        El error va textual en el title y con "Reintentar". */}
                    <td style={{ padding: '11px 20px', fontSize: 12, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const fa = f?.factura;
                        const completado = a.estado === 'Completado';
                        const txId = String((a.tx as any)?.id ?? '');
                        // Sin documento y completado: se puede emitir a mano.
                        // Mientras no llegan los comprobantes no se sabe si ya
                        // hay factura: ofrecer «Emitir» ahí invitaba a emitirla
                        // dos veces (se veía "pendiente" en una ya emitida).
                        if (foliosEstado === 'cargando') return <span style={{ color: C.tenue }}>cargando…</span>;
                        // 'emitiendo' de más de 3 min = se cayó a mitad: se ofrece otra vez.
                        const emitiendoSiigo = fa?.estado === 'emitiendo' && (!fa.at || Date.now() - new Date(fa.at).getTime() < 180000);
                        if (emitiendoSiigo) return <span style={{ color: C.sub }} title="Siigo está procesando la factura">emitiendo…</span>;
                        if (fa?.estado === 'en_cola') return <span style={{ color: C.sub }} title={fa.error ?? 'En la cola del lote: Lincoin la emite en segundo plano'}>{/duplicad|esperar/i.test(fa.error ?? '') ? 'en espera…' : 'en cola…'}</span>;
                        if (!f || !fa?.estado || fa.estado === 'emitiendo') return (
                          <span className="flex items-center" style={{ gap: 6 }}>
                            <span style={{ color: C.tenue }}>{f && facturacionActiva ? 'pendiente' : '—'}</span>
                            {completado && facturacionActiva && txId && botonSegunTipo(a, txId)}
                          </span>
                        );
                        if (fa.estado === 'omitida' || fa.estado === 'pendiente' || fa.estado === 'anulada') return (
                          <span className="flex flex-col" style={{ gap: 3 }}>
                            <span className="flex items-center" style={{ gap: 6 }} title={fa.error ?? ''}>
                              {fa.estado === 'anulada'
                                ? <button onClick={() => onVerMovimiento?.(a.tx)} style={{ fontFamily: FONT, fontSize: 12, color: C.tenue, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'line-through' }}>{fa.tipo === 'DS' ? 'DS · ' : ''}{fa.numero ?? 'anulado'}</button>
                                : <span style={{ color: C.tenue }}>{fa.estado === 'omitida' ? 'no aplica' : fa.estado}</span>}
                              {fa.estado === 'anulada' && <span style={{ color: C.tenue, fontSize: 11 }}>anulado</span>}
                              {/* Anulada (en Siigo, con nota crédito): se vuelve a
                                  emitir al mismo cliente, con el cálculo vigente.
                                  Solo un envío: un depósito no lleva factura. */}
                              {fa.estado === 'anulada' && esComision && a.dir === 'out' && !esPropio(ordenanteDe(a.tx)?.identification) && completado && facturacionActiva && txId && !soloLectura
                                ? <button onClick={() => emitirMovimiento(txId)} disabled={emitiendo === txId}
                                    title="Emite una factura nueva al mismo cliente de la anulada: terceros por el valor completo + la comisión"
                                    style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: C.text, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', opacity: emitiendo === txId ? 0.5 : 1 }}>
                                    {emitiendo === txId ? '…' : 'Volver a emitir'}
                                  </button>
                                : completado && facturacionActiva && txId && botonSegunTipo(a, txId)}
                            </span>
                            {/* El porqué, a la vista: "no aplica" sin motivo obliga a adivinar. */}
                            {fa.estado === 'omitida' && fa.error && <span style={{ fontSize: 10.5, color: C.tenue, whiteSpace: 'normal', maxWidth: 260, lineHeight: 1.35 }}>{fa.error}</span>}
                          </span>
                        );
                        // "DS" delante cuando lo que salió fue un documento
                        // soporte, no una factura: son dos cosas distintas.
                        const rotulo = fa.tipo === 'DS' ? 'DS · ' : '';
                        // El número abre el detalle del movimiento, que
                        // muestra el documento completo (estado DIAN,
                        // CUFE/CUDS, ítems, PDF). Si Siigo dio un enlace
                        // público, además se abre directo.
                        if (fa.estado === 'emitida') return (
                          <span className="flex items-center" style={{ gap: 6 }}>
                            <button onClick={() => onVerMovimiento?.(a.tx)} title={`${fa.tipo === 'DS' ? 'Documento soporte' : 'Factura de venta'} · ver el documento`}
                              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: C.text, background: 'transparent', border: 'none', padding: 0, cursor: onVerMovimiento ? 'pointer' : 'default', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                              {rotulo}{fa.numero ?? 'emitida'}
                            </button>
                            {fa.url && <a href={fa.url} target="_blank" rel="noopener noreferrer" title="Abrir en Siigo" style={{ color: C.sub, fontSize: 11 }}>↗</a>}
                          </span>
                        );
                        if (fa.estado === 'error') return (
                          <span className="flex items-center" style={{ gap: 6 }} title={fa.error ?? ''}>
                            <span style={{ color: '#F87171', fontWeight: 700 }}>error</span>
                            {!soloLectura && <button onClick={() => reintentarFactura(f.folio)} disabled={reintentando === f.folio}
                              style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', opacity: reintentando === f.folio ? 0.5 : 1 }}>
                              {reintentando === f.folio ? '…' : 'Reintentar'}
                            </button>}
                          </span>
                        );
                        return <span style={{ color: C.tenue }} title={fa.error ?? ''}>{fa.estado === 'omitida' ? 'no aplica' : fa.estado}</span>;
                      })()}
                    </td>
                    <td style={{ padding: '11px 20px', borderBottom: `1px solid ${C.borde}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {onVerMovimiento && <button onClick={e => { e.stopPropagation(); onVerMovimiento(a.tx); }} style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }} className="hover:text-[#F4F4F2] hover:border-[rgba(255,255,255,0.22)] transition-colors">Ver</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 20px', borderTop: `1px solid ${C.borde}` }}>
          <span style={{ fontSize: 12, color: C.sub }}>Mostrando {mostrados.length} de {lista.length}</span>
          {lista.length > mostrados.length && <button onClick={() => setLimite(l => l + 50)} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Cargar más →</button>}
        </div>
      </Tarjeta>

      {/* 6. Notas */}
      <p style={{ fontSize: 12, color: C.tenue, margin: 0, lineHeight: 1.55 }}>
        Cuenta lo Completado y lo Procesando: la plata ya se movió. Lo rechazado se lista tachado y no suma. Una conversión es una salida en una moneda y una entrada en la otra.
        {foliosEstado === 'sin_tabla' && ' Los comprobantes automáticos todavía no están activos en esta cuenta (falta la migración 2026_comprobantes.sql).'}
        {foliosEstado === 'ok' && ' El comprobante de cada operación se emite solo, con número consecutivo, apenas la operación se completa, y llega por correo.'}
      </p>

      <style>{`
        .lincoin-fila-mov:hover td { background: ${C.hover}; }
        @media (max-width: 720px) { .lincoin-graf-barras { grid-column: span 1 !important; } }
      `}</style>
    </div>
  );
};
