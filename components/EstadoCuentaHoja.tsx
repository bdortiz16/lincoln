// ══════════════════════════════════════════════════════════════════
//  Estado de cuenta — la hoja que la contadora archiva.
//
//  Titular, saldo inicial, entradas, salidas, costos y saldo final del
//  periodo, cada movimiento con el saldo que dejó, y a quién se le envió y
//  de quién se recibió. Se ve en pantalla y "Descargar PDF" la imprime (el
//  navegador ofrece Guardar como PDF).
//
//  Fondo blanco: el logo va en #15181A con el punto #22A35C, sin cuadro.
//  Va en un portal sobre <body> con la clase lincoin-print-root: al imprimir,
//  index.css esconde con display:none todo hijo de <body> que no la tenga
//  (la app entera). Dentro de la app, la hoja quedaba escondida con ella y
//  el PDF salía en blanco. Así además corre por varias páginas.
// ══════════════════════════════════════════════════════════════════
import React from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { datosTercero, fmtMon, type EstadoCuenta, type FichaEmpresa, type Tercero } from './libroContable';

const FONT = 'Archivo, system-ui, sans-serif';
const P = { text: '#15181A', sub: '#5B625D', tenue: '#8A918C', linea: '#E3E5E2', suave: '#F4F5F3', verde: '#22A35C' };

type Props = {
  estado: EstadoCuenta;
  ficha: FichaEmpresa | null;
  periodoTxt: string;
  desdeTxt: string;
  hastaTxt: string;
  folios: Record<string, { numero: string }>;
  enviadoA: Tercero[];
  recibidoDe: Tercero[];
  onCerrar: () => void;
};

const num = (v: number, m: 'COP' | 'USD') => v.toLocaleString('es-CO', { minimumFractionDigits: m === 'COP' ? 0 : 2, maximumFractionDigits: m === 'COP' ? 0 : 2 });
const fechaHora = (ts: number) => new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fechaCorta = (ts: number) => new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

const th: React.CSSProperties = { fontSize: 8.5, fontWeight: 800, letterSpacing: '0.8px', color: P.sub, textAlign: 'left', padding: '7px 6px', borderBottom: `1.5px solid ${P.text}`, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { fontSize: 9.5, color: P.text, padding: '6px 6px', borderBottom: `1px solid ${P.linea}`, verticalAlign: 'top' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

const Seccion: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '1.4px', color: P.sub, margin: '22px 0 6px' }}>{children}</p>
);

const TablaTerceros: React.FC<{ lista: Tercero[]; moneda: 'COP' | 'USD'; titulo: string; total: number }> = ({ lista, moneda, titulo, total }) => (
  <div className="lincoin-ec-bloque">
    <Seccion>{titulo}</Seccion>
    {lista.length === 0 ? <p style={{ fontSize: 10, color: P.tenue, margin: 0 }}>Sin movimientos en el periodo.</p> : (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>NOMBRE</th><th style={th}>DOCUMENTO</th><th style={th}>BANCO · CUENTA</th>
          <th style={{ ...th, textAlign: 'right' }}>OPER.</th><th style={{ ...th, textAlign: 'right' }}>TOTAL {moneda}</th><th style={{ ...th, textAlign: 'right' }}>%</th><th style={{ ...th, textAlign: 'right' }}>ÚLTIMA</th>
        </tr></thead>
        <tbody>
          {lista.map(t => (
            <tr key={t.clave} className="lincoin-ec-fila">
              <td style={{ ...td, fontWeight: 700 }}>{t.nombre || '—'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{[t.docTipo, t.docNum].filter(Boolean).join(' ') || '—'}</td>
              <td style={td}>{[t.banco, t.tipoCuenta, t.cuenta].filter(Boolean).join(' · ') || '—'}</td>
              <td style={tdNum}>{t.n}</td>
              <td style={{ ...tdNum, fontWeight: 700 }}>{num(t.total, moneda)}</td>
              <td style={tdNum}>{total > 0 ? `${((t.total / total) * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %` : ''}</td>
              <td style={tdNum}>{fechaCorta(t.ultima)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, fontWeight: 800, borderBottom: 'none' }} colSpan={3}>Total</td>
            <td style={{ ...tdNum, fontWeight: 800, borderBottom: 'none' }}>{lista.reduce((s, t) => s + t.n, 0)}</td>
            <td style={{ ...tdNum, fontWeight: 800, borderBottom: 'none' }}>{num(lista.reduce((s, t) => s + t.total, 0), moneda)}</td>
            <td style={{ ...tdNum, borderBottom: 'none' }} colSpan={2} />
          </tr>
        </tbody>
      </table>
    )}
  </div>
);

export const EstadoCuentaHoja: React.FC<Props> = ({ estado: e, ficha, periodoTxt, desdeTxt, hastaTxt, folios, enviadoA, recibidoDe, onCerrar }) => {
  const m = e.moneda;
  const nombreArchivo = `Lincoin - Estado de cuenta - ${ficha?.nombre || 'cuenta'} - ${periodoTxt} - ${m}`.replace(/[\\/:*?"<>|]/g, '');
  const imprimir = () => {
    // El nombre del PDF sale del título de la página.
    const antes = document.title;
    document.title = nombreArchivo;
    const volver = () => { document.title = antes; window.removeEventListener('afterprint', volver); };
    window.addEventListener('afterprint', volver);
    window.print();
    setTimeout(volver, 4000);
  };
  const titular: [string, string][] = ficha ? [
    ['Titular', ficha.nombre],
    [ficha.tipoDocumento || 'Documento', ficha.nit ?? ''],
    ['Dirección', [ficha.direccion, ficha.ciudad, ficha.pais].filter(Boolean).join(', ')],
    ['Representante legal', [ficha.representante, ficha.representanteDoc].filter(Boolean).join(' · ')],
    ['Correo', ficha.email ?? ''],
    ['Teléfono', ficha.telefono ?? ''],
    ['ID Lincoin', ficha.idLincoin ?? ''],
  ] : [];
  const resumen: [string, string, boolean][] = [
    [`Saldo inicial · ${desdeTxt}`, fmtMon(e.saldoInicial, m), false],
    [`(+) Entradas · ${e.nEntradas}`, fmtMon(e.entradas, m), false],
    [`(−) Salidas · ${e.nSalidas}`, fmtMon(e.salidas, m), false],
    ...(m === 'COP' ? [[`(−) Costos de envío`, fmtMon(e.costos, m), false] as [string, string, boolean]] : []),
    [`Saldo final · ${hastaTxt}`, fmtMon(e.saldoFinal, m), true],
  ];
  const conCosto = m === 'COP';

  return createPortal(
    <div className="lincoin-ec-capa lincoin-print-root" onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(4,5,4,0.88)', overflowY: 'auto', padding: '20px 12px', fontFamily: FONT }}>
      <div onClick={ev => ev.stopPropagation()} style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="lincoin-ec-barra flex items-center justify-end" style={{ gap: 8, marginBottom: 10 }}>
          <button onClick={imprimir} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={14} /> Descargar PDF</button>
          <button onClick={onCerrar} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '9px 14px', borderRadius: 9, cursor: 'pointer', color: '#F4F4F2', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><X size={14} /> Cerrar</button>
        </div>
        <div className="lincoin-ec" style={{ background: '#FFFFFF', color: P.text, borderRadius: 10, padding: '32px 34px 28px', fontFamily: FONT }}>
          {/* Encabezado */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `2px solid ${P.text}` }}>
            <div>
              <p style={{ fontFamily: FONT, fontWeight: 800, fontSize: 22, letterSpacing: '-0.6px', color: P.text, margin: 0, lineHeight: 1 }}>Lincoin<span style={{ color: P.verde }}>.</span></p>
              <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', margin: '14px 0 0' }}>Estado de cuenta</p>
              <p style={{ fontSize: 11, color: P.sub, margin: '3px 0 0' }}>{periodoTxt} · {m === 'COP' ? 'Pesos colombianos (COP)' : 'Dólares (USD)'}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '1.2px', color: P.sub, margin: 0 }}>SALDO FINAL</p>
              <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px', margin: '3px 0 0', fontVariantNumeric: 'tabular-nums' }}>{fmtMon(e.saldoFinal, m)}</p>
              <p style={{ fontSize: 9.5, color: P.sub, margin: '6px 0 0' }}>Del {desdeTxt} al {hastaTxt}</p>
              <p style={{ fontSize: 9.5, color: P.sub, margin: '2px 0 0' }}>Generado el {fechaHora(Date.now())}</p>
            </div>
          </div>

          {/* Titular y resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 28px' }}>
            {titular.length > 0 && (
              <div>
                <Seccion>TITULAR</Seccion>
                {titular.filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '5px 0', borderTop: `1px solid ${P.linea}` }}>
                    <span style={{ fontSize: 10, color: P.sub, flexShrink: 0 }}>{k}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
            <div>
              <Seccion>RESUMEN DEL PERIODO</Seccion>
              {resumen.map(([k, v, fuerte]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: fuerte ? '7px 0' : '5px 0', borderTop: `${fuerte ? 1.5 : 1}px solid ${fuerte ? P.text : P.linea}` }}>
                  <span style={{ fontSize: fuerte ? 11 : 10, color: fuerte ? P.text : P.sub, fontWeight: fuerte ? 800 : 400 }}>{k}</span>
                  <span style={{ fontSize: fuerte ? 11 : 10, fontWeight: fuerte ? 800 : 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</span>
                </div>
              ))}
              {e.nNoSuman > 0 && <p style={{ fontSize: 9, color: P.tenue, margin: '6px 0 0' }}>{e.nNoSuman} {e.nNoSuman === 1 ? 'operación rechazada o pendiente aparece' : 'operaciones rechazadas o pendientes aparecen'} en el detalle sin mover el saldo.</p>}
            </div>
          </div>

          {/* Movimientos con saldo */}
          <Seccion>MOVIMIENTOS</Seccion>
          <div className="lincoin-ec-tabla" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr>
                <th style={th}>FECHA</th><th style={th}>CONCEPTO</th><th style={th}>TERCERO</th><th style={th}>COMPROBANTE</th>
                <th style={{ ...th, textAlign: 'right' }}>ENTRADA</th><th style={{ ...th, textAlign: 'right' }}>SALIDA</th>
                {conCosto && <th style={{ ...th, textAlign: 'right' }}>COSTO</th>}
                <th style={{ ...th, textAlign: 'right' }}>SALDO</th>
              </tr></thead>
              <tbody>
                <tr className="lincoin-ec-fila">
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{desdeTxt}</td>
                  <td style={{ ...td, fontWeight: 700 }} colSpan={conCosto ? 6 : 5}>Saldo inicial</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{num(e.saldoInicial, m)}</td>
                </tr>
                {e.filas.map((f, i) => {
                  const a = f.a;
                  const ter = datosTercero(a.tx, a.contraparte);
                  const noSuma = f.entrada == null && f.salida == null;
                  const det = [[ter.docTipo, ter.docNum].filter(Boolean).join(' '), [ter.banco, ter.cuenta].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
                  return (
                    <tr key={`${a.tx.id}-${a.dir}-${i}`} className="lincoin-ec-fila" style={{ color: noSuma ? P.tenue : P.text }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'inherit' }}>{fechaHora(a.ts)}</td>
                      <td style={{ ...td, color: 'inherit' }}>
                        <span style={{ fontWeight: 700 }}>{a.tipo}</span>
                        {noSuma && <span style={{ display: 'block', fontSize: 8.5 }}>{a.estado} · no mueve el saldo</span>}
                      </td>
                      <td style={{ ...td, color: 'inherit' }}>
                        {a.tipo === 'Conversión' || a.tipo === 'Ajuste' ? a.contraparte : (ter.nombre || a.contraparte || '—')}
                        {det && a.tipo !== 'Conversión' && a.tipo !== 'Ajuste' && <span style={{ display: 'block', fontSize: 8.5, color: P.sub }}>{det}</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace', fontSize: 9, color: 'inherit' }}>{folios[String(a.tx.id)]?.numero ?? ''}</td>
                      <td style={{ ...tdNum, color: noSuma ? 'inherit' : P.verde, fontWeight: 600 }}>{f.entrada != null ? num(f.entrada, m) : ''}</td>
                      <td style={{ ...tdNum, color: 'inherit', fontWeight: 600 }}>{f.salida != null ? num(f.salida, m) : ''}</td>
                      {conCosto && <td style={{ ...tdNum, color: 'inherit' }}>{f.costo != null ? num(f.costo, m) : ''}</td>}
                      <td style={{ ...tdNum, color: 'inherit', fontWeight: 600 }}>{num(f.saldo, m)}</td>
                    </tr>
                  );
                })}
                {e.filas.length === 0 && <tr><td style={{ ...td, color: P.tenue }} colSpan={conCosto ? 8 : 7}>Sin movimientos en el periodo.</td></tr>}
                <tr>
                  <td style={{ ...td, fontWeight: 800, borderBottom: 'none', borderTop: `1.5px solid ${P.text}` }} colSpan={4}>Totales del periodo</td>
                  <td style={{ ...tdNum, fontWeight: 800, borderBottom: 'none', borderTop: `1.5px solid ${P.text}` }}>{num(e.entradas, m)}</td>
                  <td style={{ ...tdNum, fontWeight: 800, borderBottom: 'none', borderTop: `1.5px solid ${P.text}` }}>{num(e.salidas, m)}</td>
                  {conCosto && <td style={{ ...tdNum, fontWeight: 800, borderBottom: 'none', borderTop: `1.5px solid ${P.text}` }}>{num(e.costos, m)}</td>}
                  <td style={{ ...tdNum, fontWeight: 800, borderBottom: 'none', borderTop: `1.5px solid ${P.text}` }}>{num(e.saldoFinal, m)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <TablaTerceros lista={enviadoA} moneda={m} titulo="A QUIÉN SE LE ENVIÓ" total={enviadoA.reduce((s, t) => s + t.total, 0)} />
          <TablaTerceros lista={recibidoDe} moneda={m} titulo="DE QUIÉN SE RECIBIÓ" total={recibidoDe.reduce((s, t) => s + t.total, 0)} />

          <p style={{ fontSize: 8.5, color: P.sub, margin: '24px 0 0', lineHeight: 1.55, paddingTop: 10, borderTop: `1px solid ${P.linea}` }}>
            Este estado de cuenta resume los movimientos registrados en la cuenta Lincoin del titular durante el periodo indicado.
            Suma lo completado y lo que está en proceso; lo rechazado se lista y no mueve el saldo. Una conversión es una salida
            en una moneda y una entrada en la otra. El saldo inicial es la suma de todos los movimientos anteriores al periodo,
            desde el primero en Lincoin. {conCosto ? 'El costo de cada envío se descuenta del saldo junto con el monto enviado. ' : ''}
            Lincoin no es un banco y este documento no es un extracto bancario.
          </p>
        </div>
      </div>
      <style>{`
        @media print {
          @page { size: letter; margin: 12mm; }
          body > *:not(.lincoin-ec-capa) { display: none !important; }
          html, body { background: #fff !important; }
          .lincoin-ec-capa { position: static !important; inset: auto !important; background: #fff !important; padding: 0 !important; overflow: visible !important; }
          .lincoin-ec-capa > div { max-width: none !important; }
          .lincoin-ec { border-radius: 0 !important; padding: 0 !important; }
          .lincoin-ec-barra { display: none !important; }
          .lincoin-ec-tabla { overflow: visible !important; }
          .lincoin-ec table { min-width: 0 !important; }
          .lincoin-ec thead { display: table-header-group; }
          .lincoin-ec-fila { break-inside: avoid; page-break-inside: avoid; }
          .lincoin-ec * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>,
    document.body,
  );
};
