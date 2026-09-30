// ══════════════════════════════════════════════════════════════════
//  Detalle de un movimiento — portal del contador
//
//  Lo que un contador necesita para soportar el asiento: el movimiento
//  (monto, contraparte, cuenta, referencia, motivo), el comprobante Lincoin
//  con su número, y el documento que se emitió en Siigo (factura de venta o
//  documento soporte) con su número, estado DIAN, CUFE/CUDS e ítems.
//
//  Se pinta primero con la fila del comprobante que ya llegó con los datos
//  de la empresa (instantáneo) y después se refresca con la consulta a
//  Siigo, que trae el estado DIAN al día. Solo lectura: nada se emite acá.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { X, Copy, FileText, ExternalLink, Download } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';
const C = { tarjeta: '#0C0E0D', caja: 'rgba(255,255,255,0.02)', borde: 'rgba(255,255,255,0.09)', linea: 'rgba(255,255,255,0.06)', text: '#F4F4F2', sub: '#878E88', verde: '#4ADE80', rojo: '#F87171' };

const ENTRA = new Set(['load', 'pay_received', 'referral_payout', 'otc_deposit', 'deposit', 'deposito']);
const TIPOS: Record<string, string> = { dispersion: 'Envío', send: 'Envío', transfer: 'Envío', load: 'Depósito', pay_received: 'Pago recibido', convert: 'Conversión', otc_deposit: 'Depósito', otc_withdraw: 'Retiro', referral_payout: 'Pago de referido', withdraw: 'Retiro' };

const monedaDe = (c: any) => String(c ?? '').split('_')[0];
const fmt = (v: any, cur: any) => `${Number(v ?? 0).toLocaleString('es-CO', { maximumFractionDigits: String(cur ?? '').startsWith('COP') ? 0 : 2 })} ${monedaDe(cur)}`;
const fechaLarga = (v: any) => { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fechaCorta = (v: any) => { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); };
const corta = (s: string, a = 10, b = 8) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

type Fila = { label: string; value: string; mono?: boolean; copy?: string; color?: string };

const Filas: React.FC<{ filas: Fila[]; copiar: (t: string) => void }> = ({ filas, copiar }) => (
  <div>
    {filas.map((r, i) => (
      <div key={r.label} className="flex items-start justify-between" style={{ gap: 14, padding: '9px 0', borderTop: i > 0 ? `1px solid ${C.linea}` : 'none' }}>
        <span style={{ fontSize: 12.5, color: C.sub, flexShrink: 0 }}>{r.label}</span>
        <span className="flex items-center" style={{ gap: 6, minWidth: 0, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: r.color ?? C.text, fontFamily: r.mono ? MONO : FONT, textAlign: 'right', wordBreak: 'break-word' }}>{r.value}</span>
          {r.copy && <button onClick={() => copiar(r.copy!)} title="Copiar" style={{ flexShrink: 0, background: 'transparent', border: 'none', padding: 2, cursor: 'pointer', display: 'inline-flex' }}><Copy size={12} color={C.sub} /></button>}
        </span>
      </div>
    ))}
  </div>
);

const Seccion: React.FC<{ titulo: string; derecha?: React.ReactNode; children: React.ReactNode }> = ({ titulo, derecha, children }) => (
  <div style={{ marginTop: 14, border: `1px solid ${C.borde}`, borderRadius: 12, background: C.caja, padding: '12px 14px' }}>
    <div className="flex items-center justify-between" style={{ gap: 10, marginBottom: 4 }}>
      <span className="flex items-center" style={{ gap: 7, fontSize: 12.5, fontWeight: 700, color: C.text }}><FileText size={14} color={C.sub} /> {titulo}</span>
      {derecha}
    </div>
    {children}
  </div>
);

const Pastilla: React.FC<{ texto: string; color: string; borde: string }> = ({ texto, color, borde }) => (
  <span style={{ border: `1px solid ${borde}`, color, fontSize: 9.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', letterSpacing: 0.3 }}>{texto}</span>
);

export const ContadorDetalleMovimiento: React.FC<{ tx: any; comprobante: any | null; empresaId: string; onCerrar: () => void }> = ({ tx, comprobante, empresaId, onCerrar }) => {
  const [consulta, setConsulta] = useState<{ estado: 'cargando' | 'ok' | 'error'; documento?: any; comprobante?: any; error?: string }>({ estado: 'cargando' });
  const [pdfBajando, setPdfBajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [crudaAbierta, setCrudaAbierta] = useState(false);

  useEffect(() => {
    let vivo = true;
    llamarFuncion('facturacion', { action: 'documento', transactionId: String(tx.id), empresaId }, 30000)
      .then((r: any) => { if (vivo) setConsulta(r?.ok ? { estado: 'ok', documento: r.documento ?? null, comprobante: r.comprobante ?? null } : { estado: 'error', error: String(r?.error ?? 'sin respuesta') }); })
      .catch((e: any) => { if (vivo) setConsulta({ estado: 'error', error: String(e?.message ?? e) }); });
    return () => { vivo = false; };
  }, [tx.id, empresaId]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);

  const copiar = (t: string) => { navigator.clipboard.writeText(t).then(() => { setAviso('Copiado'); setTimeout(() => setAviso(null), 1500); }).catch(() => {}); };

  const descargarPdf = async (nombre: string) => {
    setPdfBajando(true); setAviso(null);
    try {
      const r = await llamarFuncion('facturacion', { action: 'documento_pdf', transactionId: String(tx.id), empresaId }, 45000);
      if (!r?.ok || !r.base64) { setAviso(String(r?.error ?? 'Siigo no entregó el PDF.')); return; }
      const bin = atob(String(r.base64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = String(r.nombre ?? nombre);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e: any) { setAviso(`No se pudo descargar el PDF: ${String(e?.message ?? e)}`); }
    finally { setPdfBajando(false); }
  };

  // ── El movimiento ──
  const rd = tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {};
  const v = (k: string) => tx[k] ?? rd[k];
  const tipo = String(tx.type ?? '');
  const entra = ENTRA.has(tipo);
  const st = String(tx.status ?? '');
  const pill = st === 'Completado' ? { t: entra ? 'ACREDITADO' : 'COMPLETADO', c: C.verde, b: 'rgba(74,222,128,0.3)' }
    : st === 'Rechazado' || st === 'Fallido' ? { t: st.toUpperCase(), c: C.rojo, b: 'rgba(248,113,113,0.35)' }
    : { t: (st || 'PENDIENTE').toUpperCase(), c: 'rgba(244,244,242,0.7)', b: 'rgba(255,255,255,0.14)' };
  const dest = (v('recipient') && typeof v('recipient') === 'object') ? v('recipient') : {};
  const contraparte = String(v('beneficiary') ?? dest.holderName ?? v('beneficiaryName') ?? v('counterpartyName') ?? v('senderName') ?? v('pagador') ?? v('recipientName') ?? '').trim();
  const docNum = String(v('documentNumber') ?? dest.documentNumber ?? dest.docNumber ?? '').trim();
  const docTipo = String(v('documentType') ?? dest.documentType ?? dest.docType ?? '').trim();
  const cuenta = String(v('account') ?? dest.key ?? dest.accountNumber ?? '').trim();
  const banco = String(v('bank') ?? dest.bankName ?? '').split('·')[0].trim();
  const riel = tx.currency === 'COP_BREB' ? 'Bre-B' : tx.currency === 'COP_ACH' ? 'ACH · Colombia' : '';
  const ref = String(v('providerRef') ?? v('providerTraceId') ?? v('reference') ?? v('txHash') ?? '').trim();
  const motivoPago = String(v('motivo') ?? v('reason') ?? '').trim();
  const nota = String(v('note') ?? v('description') ?? '').trim();
  const fee = Number(v('feeCop') ?? 0);
  const motivoRechazo = (st === 'Rechazado' || st === 'Fallido')
    ? [v('providerError'), v('errorMessage'), v('rejectReason'), typeof v('error') === 'string' ? v('error') : null]
        .map(x => (typeof x === 'string' ? x.trim() : '')).find(x => x && !/[{}\[\]]|http\s*\d|status\s*code/i.test(x)) ?? null
    : null;

  const filasMov: Fila[] = [
    { label: 'Tipo', value: TIPOS[tipo] ?? (tipo || '—') },
    ...(riel ? [{ label: 'Riel', value: riel }] : []),
    ...(contraparte ? [{ label: entra ? 'Pagador' : 'Beneficiario', value: contraparte }] : []),
    ...(docNum ? [{ label: 'Documento', value: `${docTipo || 'CC'} ${docNum}`, mono: true, copy: docNum }] : []),
    ...(banco ? [{ label: 'Banco', value: banco }] : []),
    ...(cuenta ? [{ label: tx.currency === 'COP_BREB' ? 'Llave destino' : 'Cuenta destino', value: cuenta, mono: true, copy: cuenta }] : []),
    ...(motivoPago ? [{ label: 'Motivo del pago', value: motivoPago }] : []),
    ...(nota && nota !== motivoPago ? [{ label: 'Nota', value: nota }] : []),
    ...(!entra && fee > 0 ? [{ label: 'Costo del envío', value: `${fmt(fee, 'COP')}` }] : []),
    ...(ref ? [{ label: 'Referencia de la operación', value: corta(ref, 12, 8), mono: true, copy: ref }] : []),
    { label: 'Id Lincoin', value: corta(String(tx.id), 8, 6), mono: true, copy: String(tx.id) },
  ];

  // ── Comprobante y documento: primero la fila local, luego Siigo ──
  const c = comprobante;
  const compNumero = consulta.comprobante?.numero ?? c?.numero ?? null;
  const compEmitido = consulta.comprobante?.emitido_at ?? c?.emitido_at ?? null;

  const docApi = consulta.estado === 'ok' ? consulta.documento : null;
  const det = c?.factura_detalle ?? {};
  const respLocal = det?.respuesta ?? det?.respuesta_creacion ?? null;
  const doc = docApi ?? (c?.factura_estado ? {
    estado: c.factura_estado, tipo: c.factura_tipo === 'DS' ? 'DS' : 'FV', numero: c.factura_numero ?? null,
    cufe: c.factura_cufe ?? null, url: c.factura_url ?? null, error: c.factura_error ?? null, fecha: c.factura_at ?? null,
    siigo: respLocal ? {
      total: respLocal.total ?? null,
      stamp: respLocal.stamp ?? null,
      contraparte: (respLocal.supplier ?? respLocal.customer) ? { identification: (respLocal.supplier ?? respLocal.customer).identification ?? null, name: (respLocal.supplier ?? respLocal.customer).name ?? null } : null,
      items: Array.isArray(respLocal.items) ? respLocal.items : [],
    } : null,
    enviado: det?.enviado ? { items: Array.isArray(det.enviado.items) ? det.enviado.items : [], total: Array.isArray(det.enviado.payments) ? det.enviado.payments.reduce((s: number, p: any) => s + (Number(p.value) || 0), 0) : null } : null,
    rechazo_dian: Array.isArray(det?.rechazo_dian) ? { mensajes: det.rechazo_dian, aviso: null } : null,
    pdf_api: c.factura_tipo !== 'DS',
  } : null);

  const esDS = doc?.tipo === 'DS';
  const tituloDoc = esDS ? 'Documento soporte' : 'Factura de venta';
  const sg = doc?.siigo ?? null;
  const sello = sg?.stamp?.status ? String(sg.stamp.status) : '';
  const rechDian = /reject|rechaz|error|fail/i.test(sello);
  const cude = String(doc?.cufe || sg?.stamp?.cufe || sg?.stamp?.cude || '');
  const conDoc = doc?.estado === 'emitida' || doc?.estado === 'anulada';
  const nombreContra = Array.isArray(sg?.contraparte?.name) ? sg.contraparte.name.join(' ') : sg?.contraparte?.name;
  const filasDoc: Fila[] = [];
  if (doc && conDoc) {
    filasDoc.push({ label: 'Número', value: String(doc.numero ?? '—'), mono: true, copy: doc.numero ? String(doc.numero) : undefined });
    if (doc.fecha) filasDoc.push({ label: 'Fecha de emisión', value: fechaCorta(doc.fecha) });
    if (nombreContra || sg?.contraparte?.identification) filasDoc.push({ label: esDS ? 'Proveedor' : 'Cliente', value: [nombreContra, sg?.contraparte?.identification ? `NIT/CC ${sg.contraparte.identification}` : ''].filter(Boolean).join(' · ') });
    if (sg?.total != null && Number(sg.total) > 0) filasDoc.push({ label: 'Total del documento', value: fmt(sg.total, 'COP') });
    else if (doc.enviado?.total != null) filasDoc.push({ label: 'Total del documento', value: fmt(doc.enviado.total, 'COP') });
    if (sello) filasDoc.push({ label: 'Estado DIAN', value: rechDian ? `Rechazado (${sello})` : sello, color: /accept|acept|approv/i.test(sello) ? C.verde : rechDian ? C.rojo : undefined });
    if (cude) filasDoc.push({ label: esDS ? 'CUDS' : 'CUFE', value: corta(cude, 12, 10), mono: true, copy: cude });
    if (sg?.stamp?.observations) filasDoc.push({ label: 'Observaciones DIAN', value: String(sg.stamp.observations) });
  }
  const pillDoc = !doc ? null
    : doc.estado === 'emitida' ? (rechDian ? { t: 'RECHAZADO POR LA DIAN', c: C.rojo, b: 'rgba(248,113,113,0.35)' } : { t: 'EMITIDO', c: C.verde, b: 'rgba(74,222,128,0.3)' })
    : doc.estado === 'anulada' ? { t: 'ANULADO', c: C.sub, b: 'rgba(255,255,255,0.14)' }
    : doc.estado === 'error' ? { t: 'NO SE EMITIÓ', c: C.rojo, b: 'rgba(248,113,113,0.35)' }
    : doc.estado === 'omitida' ? { t: 'NO APLICA', c: C.sub, b: 'rgba(255,255,255,0.14)' }
    : { t: String(doc.estado).toUpperCase(), c: 'rgba(244,244,242,0.7)', b: 'rgba(255,255,255,0.14)' };
  const items: any[] = (Array.isArray(sg?.items) && sg.items.length ? sg.items : Array.isArray(doc?.enviado?.items) ? doc.enviado.items : []);
  const rechazoMsgs: string[] = Array.isArray(doc?.rechazo_dian?.mensajes) ? doc.rechazo_dian.mensajes : [];

  const partes = fmt(tx.amount, tx.currency);

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(4,5,4,0.85)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 16, fontFamily: FONT }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', background: C.tarjeta, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18 }}>
        <div className="flex items-center justify-between" style={{ padding: '18px 22px 12px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>Detalle del {entra ? 'ingreso' : tipo === 'convert' ? 'movimiento' : 'envío'}</span>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={13} color={C.sub} /></button>
        </div>

        <div style={{ textAlign: 'center', padding: '2px 22px 18px', borderBottom: `1px solid ${C.borde}` }}>
          <p style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1.1px', color: entra ? C.verde : C.text, margin: 0, textDecoration: pill.c === C.rojo ? 'line-through' : 'none' }}>{entra ? '+' : '−'}{partes}</p>
          <p style={{ fontSize: 12.5, color: C.sub, margin: '6px 0 0' }}>{fechaLarga(tx.createdAt)}</p>
          <span style={{ display: 'inline-block', marginTop: 10 }}><Pastilla texto={pill.t} color={pill.c} borde={pill.b} /></span>
        </div>

        <div style={{ padding: '14px 22px 22px' }}>
          {motivoRechazo !== null || st === 'Rechazado' || st === 'Fallido' ? (
            <div style={{ border: '1px solid rgba(248,113,113,0.35)', borderRadius: 12, background: 'rgba(248,113,113,0.06)', padding: '11px 14px', marginBottom: 12 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: C.rojo, letterSpacing: 0.4, margin: 0 }}>MOTIVO DEL RECHAZO</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '4px 0 0', lineHeight: 1.45 }}>{motivoRechazo ?? 'El operador del riel no entregó el motivo.'}</p>
            </div>
          ) : null}

          <Filas filas={filasMov} copiar={copiar} />

          {/* Comprobante Lincoin */}
          <Seccion titulo="Comprobante Lincoin" derecha={compNumero ? <Pastilla texto="EMITIDO" color={C.verde} borde="rgba(74,222,128,0.3)" /> : undefined}>
            {compNumero ? (
              <Filas copiar={copiar} filas={[
                { label: 'Número', value: String(compNumero), mono: true, copy: String(compNumero) },
                ...(compEmitido ? [{ label: 'Emitido', value: fechaLarga(compEmitido) }] : []),
                ...(c?.enviado_at ? [{ label: 'Enviado por correo', value: `${fechaCorta(c.enviado_at)}${c.correo ? ` · ${c.correo}` : ''}` }] : []),
              ]} />
            ) : (
              <p style={{ fontSize: 12, color: C.sub, margin: '6px 0 2px', lineHeight: 1.5 }}>
                {st === 'Completado' ? 'Este movimiento todavía no tiene comprobante.' : 'El comprobante se emite cuando la operación queda completada.'}
              </p>
            )}
          </Seccion>

          {/* Documento en Siigo: factura de venta o documento soporte */}
          <Seccion titulo={doc ? tituloDoc : 'Factura o documento soporte'} derecha={pillDoc ? <Pastilla texto={pillDoc.t} color={pillDoc.c} borde={pillDoc.b} /> : undefined}>
            {!doc && consulta.estado === 'cargando' && <p style={{ fontSize: 12, color: C.sub, margin: '6px 0 2px' }}>Consultando…</p>}
            {!doc && consulta.estado !== 'cargando' && (
              <p style={{ fontSize: 12, color: C.sub, margin: '6px 0 2px', lineHeight: 1.5 }}>No se emitió factura ni documento soporte para este movimiento.</p>
            )}
            {doc && <Filas filas={filasDoc} copiar={copiar} />}
            {doc && conDoc && items.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.linea}` }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: C.sub, letterSpacing: 0.4, margin: '0 0 4px' }}>ÍTEMS</p>
                {items.map((it: any, i: number) => {
                  const valor = it.total != null ? Number(it.total) : it.price != null ? Number(it.price) * Number(it.quantity ?? 1) : null;
                  const imp = Array.isArray(it.taxes) && it.taxes.length ? ` · ${it.taxes.map((t: any) => t.name || `${t.percentage}%`).join(', ')}` : '';
                  return (
                    <div key={i} className="flex items-start justify-between" style={{ gap: 10, padding: '3px 0' }}>
                      <span style={{ fontSize: 12, color: C.sub, minWidth: 0 }}>{it.code ? `${it.code} · ` : ''}{it.description || ''}{imp}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: 'nowrap' }}>{valor != null ? fmt(valor, 'COP') : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {doc && conDoc && rechDian && (
              <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.linea}` }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: C.rojo, letterSpacing: 0.4, margin: '0 0 3px' }}>MOTIVO DEL RECHAZO (DIAN)</p>
                {rechazoMsgs.length > 0
                  ? rechazoMsgs.map((m, i) => <p key={i} style={{ fontSize: 12, color: C.text, lineHeight: 1.45, margin: '2px 0' }}>{m}</p>)
                  : <p style={{ fontSize: 12, color: C.sub, lineHeight: 1.45, margin: 0 }}>{doc.rechazo_dian?.aviso ?? `Se ve en Siigo Nube: ${esDS ? 'Compras → Documento soporte' : 'Ventas → Facturas'} → ${doc.numero ?? ''} → Ver inconsistencias.`}</p>}
              </div>
            )}
            {doc && (doc.estado === 'error' || doc.estado === 'omitida' || doc.estado === 'anulada') && doc.error && (
              <p style={{ fontSize: 12, color: doc.estado === 'error' ? C.rojo : C.sub, lineHeight: 1.45, margin: '8px 0 0' }}>{doc.error}</p>
            )}
            {doc?.estado === 'emitida' && (doc.url || doc.pdf_api) && (
              <div className="flex" style={{ gap: 8, marginTop: 10 }}>
                {doc.url && <a href={doc.url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center" style={{ gap: 6, padding: '9px 0', borderRadius: 9, fontSize: 12, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.11)', textDecoration: 'none' }}><ExternalLink size={13} /> Ver documento</a>}
                {doc.pdf_api && (
                  <button onClick={() => descargarPdf(`${doc.numero ?? tituloDoc}.pdf`)} disabled={pdfBajando} className="flex-1 flex items-center justify-center"
                    style={{ gap: 6, padding: '9px 0', borderRadius: 9, fontSize: 12, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.11)', cursor: 'pointer', fontFamily: FONT, opacity: pdfBajando ? 0.6 : 1 }}>
                    <Download size={13} /> {pdfBajando ? 'Pidiendo el PDF…' : 'Descargar PDF'}
                  </button>
                )}
              </div>
            )}
            {doc?.estado === 'emitida' && esDS && !doc.url && (
              <p style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.45, margin: '8px 0 0' }}>El PDF del documento soporte se descarga en Siigo Nube: Compras → Documento soporte → {doc.numero ?? ''}.</p>
            )}
            {docApi?.respuesta_cruda && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setCrudaAbierta(x => !x)} style={{ fontSize: 11, color: C.sub, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, fontFamily: FONT }}>{crudaAbierta ? 'Ocultar' : 'Ver'} la respuesta de Siigo completa</button>
                {crudaAbierta && <pre style={{ marginTop: 6, fontSize: 10, color: C.sub, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 8, fontFamily: MONO }}>{(() => { try { return JSON.stringify(JSON.parse(docApi.respuesta_cruda), null, 1); } catch { return docApi.respuesta_cruda; } })()}</pre>}
              </div>
            )}
            {docApi?.aviso && <p style={{ fontSize: 11, color: C.sub, lineHeight: 1.45, margin: '8px 0 0' }}>{docApi.aviso}</p>}
          </Seccion>

          {aviso && <p style={{ fontSize: 12, color: aviso === 'Copiado' ? C.verde : C.rojo, margin: '12px 0 0', lineHeight: 1.45 }}>{aviso}</p>}
        </div>
      </div>
    </div>
  );
};
