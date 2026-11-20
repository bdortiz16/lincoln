import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, RefreshCw, Search, X } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { descargarXlsx, type CeldaX } from '../lib/xlsx';

// ─────────────────────────────────────────────────────────────
// Reportes → Auditoría.
//
// Antes era la lista de los últimos 200 movimientos que el panel tenía en
// memoria: sin fecha (salía vacía), sin cliente, sin el canal por donde salió
// la plata, sin el id del proveedor, y con un "ALERTA" en todo lo que pasara
// de 5.000 (en pesos, todo). No servía para auditar nada (pedido del dueño,
// 20 nov). Ahora todo sale del servidor (admin-data auditoria_movimientos),
// de la base entera y con filtros: por cada movimiento, el canal real
// (Mouv, Finity, Coinsenda Jero o Kaupaloki…), los ids del proveedor y de
// Lincoin, la contraparte, quién lo hizo, el resultado de la revisión de
// riesgo, el comprobante y, en el detalle, el historial y los datos técnicos
// tal como quedaron guardados. Todo se baja a Excel para un requerimiento.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413', base: '#070808',
  b1: 'rgba(255,255,255,0.08)', b2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)',
  verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export type FilaAudit = {
  id: string;
  fecha: string;
  actualizado: string | null;
  cliente: { id: string; nombre: string; nit: string | null; email: string | null };
  operador: { id: string | null; nombre: string | null; email: string | null; via: string | null } | null;
  tipo: string; tipoTxt: string; sentido: 'entra' | 'sale' | 'otro';
  monto: number; moneda: string; costo: number | null; costoProveedor: number | null;
  estado: string;
  canal: { clave: string; proveedor: string; cuenta: string | null; riel: string | null; etiqueta: string };
  ids: { proveedor: string | null; nuestra: string | null; e2e: string | null; otc: string | null; hash: string | null };
  contraparte: { nombre: string | null; doc: string | null; docTipo: string | null; banco: string | null; cuenta: string | null; tipoCuenta: string | null };
  motivo: string | null;
  motivoRechazo: string | null;
  riesgo: { nivel: string | null; detalle: string | null } | null;
  comprobante: { numero: string | null; factura: string | null; facturaEstado: string | null } | null;
  marcas: string[];
};
type Resumen = { n: number; entra: number; sale: number; porCanal: { clave: string; etiqueta: string; n: number; entra: number; sale: number }[]; truncado: boolean };
type Detalle = { fila: FilaAudit; raw: Record<string, unknown>; historial: { at: string; accion: string; quien: string | null; detalle: string | null }[] };

const CANALES: { v: string; t: string }[] = [
  { v: '', t: 'Todos los canales' },
  { v: 'mouv', t: 'Mouv · Cuenta 1 (Bre-B)' },
  { v: 'finity', t: 'Finity · Cuenta 2 (ACH y Bre-B)' },
  { v: 'coinsenda_jero', t: 'Coinsenda Jero · Cuenta 3' },
  { v: 'coinsenda_kaupaloki', t: 'Coinsenda Kaupaloki · Cuenta 4' },
  { v: 'otc', t: 'Mesa OTC' },
  { v: 'usdt', t: 'USDT (TRON)' },
  { v: 'admin', t: 'Cargues y ajustes del admin' },
  { v: 'interno', t: 'Entre cuentas Lincoin' },
  { v: 'otro', t: 'Otros' },
];
const ESTADOS: { v: string; t: string }[] = [
  { v: '', t: 'Todos los estados' },
  { v: 'completado', t: 'Completados' },
  { v: 'proceso', t: 'En proceso' },
  { v: 'rechazado', t: 'Rechazados, fallidos o devueltos' },
];
const SENTIDOS: { v: string; t: string }[] = [
  { v: '', t: 'Entradas y salidas' },
  { v: 'sale', t: 'Solo salidas' },
  { v: 'entra', t: 'Solo entradas' },
];

const hoyBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const restarDias = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const fechaHora = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s); if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const plata = (n: number, moneda = 'COP') => {
  const usd = /USD/i.test(moneda);
  return `${n < 0 ? '−' : ''}${usd ? 'US$' : '$'}${Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: usd ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const corto = (s: string | null | undefined, a = 10, b = 6) => !s ? '—' : s.length <= a + b + 1 ? s : `${s.slice(0, a)}…${s.slice(-b)}`;

const colorEstado = (e: string) => /complet/i.test(e) ? C.verde : /rechaz|fallid|devuel|anulad/i.test(e) ? C.rojo : C.ambar;
const colorRiesgo = (n: string | null | undefined) => !n ? C.tenue : /alto|bloque|block/i.test(n) ? C.rojo : /medio/i.test(n) ? C.ambar : C.verde;

const Copiar: React.FC<{ valor: string | null | undefined }> = ({ valor }) => {
  const [ok, setOk] = useState(false);
  if (!valor) return null;
  return (
    <button type="button" title="Copiar" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(valor).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }, () => {}); }}
      style={{ background: 'none', border: 'none', padding: 0, marginLeft: 6, cursor: 'pointer', color: ok ? C.verde : C.sub, verticalAlign: 'middle' }}>
      <Copy size={12} />
    </button>
  );
};

const selectE: React.CSSProperties = { fontFamily: FONT, fontSize: 12.5, color: C.text, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: '8px 10px', outline: 'none' };

export const AuditoriaMovimientos: React.FC = () => {
  const hoy = hoyBogota();
  const [desde, setDesde] = useState(restarDias(hoy, 30));
  const [hasta, setHasta] = useState(hoy);
  const [canal, setCanal] = useState('');
  const [estado, setEstado] = useState('');
  const [sentido, setSentido] = useState('');
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState<FilaAudit[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [siguiente, setSiguiente] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  const filtros = () => ({ desde, hasta, canal: canal || undefined, estado: estado || undefined, sentido: sentido || undefined, q: q.trim() || undefined });

  const buscar = async (offset = 0) => {
    if (desde > hasta) { setError('La fecha "desde" es posterior a "hasta".'); return; }
    setCargando(true); setError(null);
    const r = await pedirAdmin({ action: 'auditoria_movimientos', ...filtros(), offset, limite: 100 }).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setCargando(false);
    if (!r?.ok) { setError(String(r?.error ?? 'No se pudo leer la auditoría.')); return; }
    setFilas(f => offset ? [...f, ...(r.filas ?? [])] : (r.filas ?? []));
    if (!offset) setResumen(r.resumen ?? null);
    setSiguiente(typeof r.siguiente === 'number' ? r.siguiente : null);
  };
  useEffect(() => { buscar(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Excel: todo lo filtrado (hasta 5.000), no solo lo cargado en pantalla.
  const excel = async () => {
    setExportando(true); setError(null);
    const todas: FilaAudit[] = [];
    let off: number | null = 0;
    while (off != null && todas.length < 5000) {
      const r: any = await pedirAdmin({ action: 'auditoria_movimientos', ...filtros(), offset: off, limite: 500 }).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
      if (!r?.ok) { setExportando(false); setError(String(r?.error ?? 'No se pudo armar el Excel.')); return; }
      todas.push(...(r.filas ?? []));
      off = typeof r.siguiente === 'number' ? r.siguiente : null;
    }
    const cab = ['Fecha y hora (Bogotá)', 'Última actualización', 'Cliente', 'NIT / documento del cliente', 'Correo del cliente', 'Hecho por', 'Tipo', 'Sentido', 'Monto', 'Moneda', 'Costo cobrado', 'Costo del proveedor', 'Estado', 'Canal', 'Proveedor', 'Cuenta', 'Riel',
      'Id del proveedor', 'Referencia Lincoin enviada', 'End-to-end / CUS', 'Cierre OTC', 'Hash', 'Contraparte', 'Tipo doc. contraparte', 'Doc. contraparte', 'Banco', 'Tipo de cuenta', 'Cuenta / llave', 'Motivo', 'Motivo del rechazo',
      'Riesgo', 'Detalle del riesgo', 'Comprobante', 'Factura', 'Estado de la factura', 'Marcas', 'Id Lincoin'];
    const fecha = (s: string | null) => s ? new Date(s) : null;
    const filasX: CeldaX[][] = [cab, ...todas.map(f => [
      fecha(f.fecha), fecha(f.actualizado), f.cliente.nombre, f.cliente.nit ?? '', f.cliente.email ?? '',
      f.operador ? [f.operador.nombre, f.operador.email, f.operador.via].filter(Boolean).join(' · ') : '',
      f.tipoTxt, f.sentido === 'entra' ? 'Entrada' : f.sentido === 'sale' ? 'Salida' : '', f.monto, f.moneda, f.costo, f.costoProveedor, f.estado,
      f.canal.etiqueta, f.canal.proveedor, f.canal.cuenta ?? '', f.canal.riel ?? '',
      f.ids.proveedor ?? '', f.ids.nuestra ?? '', f.ids.e2e ?? '', f.ids.otc ?? '', f.ids.hash ?? '',
      f.contraparte.nombre ?? '', f.contraparte.docTipo ?? '', f.contraparte.doc ?? '', f.contraparte.banco ?? '', f.contraparte.tipoCuenta ?? '', f.contraparte.cuenta ?? '',
      f.motivo ?? '', f.motivoRechazo ?? '', f.riesgo?.nivel ?? '', f.riesgo?.detalle ?? '',
      f.comprobante?.numero ?? '', f.comprobante?.factura ?? '', f.comprobante?.facturaEstado ?? '', f.marcas.join(', '), f.id,
    ] as CeldaX[])];
    descargarXlsx(`lincoin-auditoria-${desde}-a-${hasta}.xlsx`, [{
      nombre: 'Auditoría', filas: filasX,
      anchos: [20, 20, 30, 18, 26, 30, 14, 10, 16, 10, 12, 12, 12, 30, 14, 12, 8, 30, 26, 30, 16, 30, 30, 10, 16, 20, 12, 24, 24, 34, 10, 34, 14, 14, 12, 24, 38],
    }]);
    setExportando(false);
  };

  const conFiltro = !!(canal || estado || sentido || q.trim());

  return (
    <div style={{ fontFamily: FONT, color: C.text, display: 'grid', gap: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 14, padding: '16px 18px' }}>
        <div className="flex items-start justify-between flex-wrap" style={{ gap: 10 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Auditoría de movimientos</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5, maxWidth: 720 }}>
              Cada movimiento con el canal por donde pasó, el id del proveedor y el de Lincoin, la contraparte, quién lo hizo y la revisión de riesgo. Tocá una fila para ver el historial y los datos técnicos guardados.
            </p>
          </div>
          <button onClick={excel} disabled={exportando || cargando} className="lincoin-btn-white"
            style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: exportando ? 0.6 : 1 }}>
            <Download size={14} /> {exportando ? 'Armando el Excel…' : 'Descargar Excel'}
          </button>
        </div>

        <form onSubmit={e => { e.preventDefault(); buscar(0); }} className="flex items-end flex-wrap" style={{ gap: 8, marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', color: C.sub }}>DESDE</span>
            <input type="date" value={desde} max={hoy} onChange={e => setDesde(e.target.value)} style={selectE} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', color: C.sub }}>HASTA</span>
            <input type="date" value={hasta} max={hoy} onChange={e => setHasta(e.target.value)} style={selectE} />
          </label>
          <select value={canal} onChange={e => setCanal(e.target.value)} style={selectE} aria-label="Canal">{CANALES.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
          <select value={estado} onChange={e => setEstado(e.target.value)} style={selectE} aria-label="Estado">{ESTADOS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
          <select value={sentido} onChange={e => setSentido(e.target.value)} style={selectE} aria-label="Sentido">{SENTIDOS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: C.sub }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Id Lincoin, id del proveedor, referencia, cliente, NIT, beneficiario…"
              style={{ ...selectE, width: '100%', paddingLeft: 30 }} />
          </div>
          <button type="submit" disabled={cargando}
            style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 9, padding: '9px 14px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} /> Buscar
          </button>
        </form>
        {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: '10px 0 0', lineHeight: 1.5 }}>{error}</p>}
      </div>

      {resumen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 12, padding: '12px 14px' }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', color: C.sub, margin: 0 }}>MOVIMIENTOS{conFiltro ? ' · FILTRADOS' : ''}</p>
            <p style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{resumen.n.toLocaleString('es-CO')}{resumen.truncado ? '+' : ''}</p>
            <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>Completado en pesos: entró {plata(resumen.entra)} · salió {plata(resumen.sale)}</p>
          </div>
          {resumen.porCanal.map(c => (
            <button key={c.clave} type="button" onClick={() => { setCanal(c.clave); }} title="Filtrar por este canal (y tocar Buscar)"
              style={{ textAlign: 'left', fontFamily: FONT, background: canal === c.clave ? 'rgba(255,255,255,0.05)' : C.card, border: `1px solid ${canal === c.clave ? C.b2 : C.b1}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', color: C.text }}>
              <p style={{ fontSize: 11.5, fontWeight: 700, margin: 0 }}>{c.etiqueta}</p>
              <p style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{c.n.toLocaleString('es-CO')}</p>
              <p style={{ fontSize: 11, color: C.sub, margin: '2px 0 0' }}>Entró {plata(c.entra)} · salió {plata(c.sale)}</p>
            </button>
          ))}
        </div>
      )}
      {resumen?.truncado && <p style={{ fontSize: 11.5, color: C.ambar, margin: 0 }}>El resumen cuenta los primeros 10.000 movimientos del filtro: acortá el rango de fechas para verlo completo.</p>}

      <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180, fontSize: 12.5 }}>
            <thead>
              <tr>
                {['FECHA Y HORA', 'CLIENTE', 'MOVIMIENTO', 'CANAL', 'CONTRAPARTE', 'MONTO', 'ESTADO', 'ID DEL PROVEEDOR', 'RIESGO'].map((h, i) => (
                  <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: C.tenue, textAlign: i === 5 ? 'right' : 'left', padding: '10px 14px', borderBottom: `1px solid ${C.b1}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: C.card }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!cargando && filas.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '18px 14px', color: C.sub }}>No hay movimientos con estos filtros.</td></tr>
              )}
              {filas.map(f => (
                <tr key={f.id} onClick={() => setAbierto(f.id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.b1}` }} className="hover:bg-white/[0.03]">
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: C.sub, fontVariantNumeric: 'tabular-nums' }}>{fechaHora(f.fecha)}</td>
                  <td style={{ padding: '10px 14px', maxWidth: 220 }}>
                    <span style={{ display: 'block', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.cliente.nombre}</span>
                    <span style={{ display: 'block', fontSize: 11, color: C.sub }}>{f.cliente.nit ? `NIT ${f.cliente.nit}` : f.cliente.email ?? ''}{f.operador?.nombre ? ` · por ${f.operador.nombre}` : ''}</span>
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'block' }}>{f.tipoTxt}</span>
                    {f.marcas.length > 0 && <span style={{ display: 'block', fontSize: 10.5, color: C.ambar }}>{f.marcas.join(' · ')}</span>}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'block', fontWeight: 700 }}>{f.canal.proveedor}</span>
                    <span style={{ display: 'block', fontSize: 11, color: C.sub }}>{[f.canal.cuenta, f.canal.riel].filter(Boolean).join(' · ') || '—'}</span>
                  </td>
                  <td style={{ padding: '10px 14px', maxWidth: 240 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.contraparte.nombre ?? '—'}</span>
                    <span style={{ display: 'block', fontSize: 11, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[f.contraparte.doc ? `${f.contraparte.docTipo ?? ''} ${f.contraparte.doc}`.trim() : null, f.contraparte.banco, f.contraparte.cuenta].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: f.sentido === 'entra' ? C.verde : C.text }}>
                    {f.sentido === 'sale' ? '−' : f.sentido === 'entra' ? '+' : ''}{plata(Math.abs(f.monto), f.moneda)}
                    {f.costo ? <span style={{ display: 'block', fontSize: 10.5, color: C.sub, fontWeight: 400 }}>costo {plata(f.costo)}</span> : null}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: colorEstado(f.estado), border: `1px solid ${colorEstado(f.estado)}55`, borderRadius: 999, padding: '2px 8px' }}>{f.estado.toUpperCase()}</span>
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontFamily: MONO, fontSize: 11.5, color: f.ids.proveedor ? C.text : C.tenue }}>
                    {corto(f.ids.proveedor, 12, 6)}<Copiar valor={f.ids.proveedor} />
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 11.5, fontWeight: 700, color: colorRiesgo(f.riesgo?.nivel) }}>{f.riesgo?.nivel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, padding: '10px 14px', borderTop: `1px solid ${C.b1}` }}>
          <span style={{ fontSize: 11.5, color: C.sub }}>{cargando ? 'Leyendo…' : `${filas.length.toLocaleString('es-CO')} en pantalla`}</span>
          {siguiente != null && (
            <button onClick={() => buscar(siguiente)} disabled={cargando}
              style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.text, background: 'transparent', border: `1px solid ${C.b2}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>
              Cargar 100 más
            </button>
          )}
        </div>
      </div>

      {abierto && <DetalleAuditoria id={abierto} onCerrar={() => setAbierto(null)} />}
    </div>
  );
};

// ── Detalle de un movimiento ──────────────────────────────────────
const Linea: React.FC<{ k: string; v: React.ReactNode; copiar?: string | null; mono?: boolean }> = ({ k, v, copiar, mono }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.b1}`, fontSize: 12.5 }}>
    <span style={{ color: C.sub }}>{k}</span>
    <span style={{ fontFamily: mono ? MONO : FONT, fontSize: mono ? 11.5 : 12.5, wordBreak: 'break-all' }}>{v ?? '—'}{copiar ? <Copiar valor={copiar} /> : null}</span>
  </div>
);
const Bloque: React.FC<{ t: string; children: React.ReactNode }> = ({ t, children }) => (
  <div style={{ marginTop: 16 }}>
    <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 4px' }}>{t}</p>
    {children}
  </div>
);

const DetalleAuditoria: React.FC<{ id: string; onCerrar: () => void }> = ({ id, onCerrar }) => {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verRaw, setVerRaw] = useState(false);
  useEffect(() => {
    let vivo = true;
    pedirAdmin({ action: 'auditoria_movimiento', id }).then((r: any) => {
      if (!vivo) return;
      if (!r?.ok) { setError(String(r?.error ?? 'No se pudo leer el movimiento.')); return; }
      setD(r as Detalle);
    }, (e: any) => { if (vivo) setError(String(e?.message ?? e)); });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', esc);
    return () => { vivo = false; window.removeEventListener('keydown', esc); };
  }, [id, onCerrar]);
  // Los datos técnicos se muestran como texto (React los escapa): nunca como HTML.
  const raw = useMemo(() => d ? JSON.stringify(d.raw, null, 2) : '', [d]);
  const f = d?.fila;
  return (
    <div className="fixed inset-0 z-[120] flex justify-end" style={{ background: 'rgba(4,5,5,0.7)' }} onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, height: '100%', overflowY: 'auto', background: C.card, borderLeft: `1px solid ${C.b2}`, padding: '18px 20px 28px', fontFamily: FONT, color: C.text }}>
        <div className="flex items-start justify-between" style={{ gap: 10 }}>
          <div>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>AUDITORÍA DEL MOVIMIENTO</p>
            <p style={{ fontSize: 16, fontWeight: 800, margin: '3px 0 0' }}>{f ? `${f.tipoTxt} · ${plata(Math.abs(f.monto), f.moneda)}` : 'Cargando…'}</p>
            {f && <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>{f.cliente.nombre} · {fechaHora(f.fecha)}</p>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {error && <p style={{ fontSize: 12.5, color: C.rojo, marginTop: 14 }}>{error}</p>}
        {f && d && (
          <>
            <Bloque t="MOVIMIENTO">
              <Linea k="Estado" v={<span style={{ color: colorEstado(f.estado), fontWeight: 700 }}>{f.estado}</span>} />
              {f.motivoRechazo && <Linea k="Motivo del rechazo" v={<span style={{ color: C.rojo }}>{f.motivoRechazo}</span>} />}
              <Linea k="Tipo" v={`${f.tipoTxt}${f.sentido === 'entra' ? ' · entrada' : f.sentido === 'sale' ? ' · salida' : ''}`} />
              <Linea k="Monto" v={`${plata(Math.abs(f.monto), f.moneda)} ${f.moneda}`} />
              {f.costo != null && <Linea k="Costo cobrado al cliente" v={plata(f.costo)} />}
              {f.costoProveedor != null && <Linea k="Costo del proveedor" v={plata(f.costoProveedor)} />}
              <Linea k="Creado" v={fechaHora(f.fecha)} />
              {f.actualizado && <Linea k="Última actualización" v={fechaHora(f.actualizado)} />}
              {f.motivo && <Linea k="Motivo / concepto" v={f.motivo} />}
              {f.marcas.length > 0 && <Linea k="Marcas" v={<span style={{ color: C.ambar }}>{f.marcas.join(' · ')}</span>} />}
            </Bloque>
            <Bloque t="CANAL Y PROVEEDOR">
              <Linea k="Canal" v={f.canal.etiqueta} />
              <Linea k="Proveedor" v={f.canal.proveedor} />
              {f.canal.cuenta && <Linea k="Cuenta" v={f.canal.cuenta} />}
              {f.canal.riel && <Linea k="Riel" v={f.canal.riel} />}
              <Linea k="Id del proveedor" v={f.ids.proveedor ?? 'No quedó guardado'} copiar={f.ids.proveedor} mono />
              {f.ids.nuestra && <Linea k="Referencia enviada" v={f.ids.nuestra} copiar={f.ids.nuestra} mono />}
              {f.ids.e2e && <Linea k="End-to-end / CUS" v={f.ids.e2e} copiar={f.ids.e2e} mono />}
              {f.ids.otc && <Linea k="Cierre OTC" v={f.ids.otc} copiar={f.ids.otc} mono />}
              {f.ids.hash && <Linea k="Hash" v={f.ids.hash} copiar={f.ids.hash} mono />}
              <Linea k="Id Lincoin" v={f.id} copiar={f.id} mono />
            </Bloque>
            <Bloque t="CONTRAPARTE">
              <Linea k={f.sentido === 'entra' ? 'Pagador' : 'Beneficiario'} v={f.contraparte.nombre} />
              {f.contraparte.doc && <Linea k="Documento" v={`${f.contraparte.docTipo ?? ''} ${f.contraparte.doc}`.trim()} copiar={f.contraparte.doc} />}
              {f.contraparte.banco && <Linea k="Banco" v={f.contraparte.banco} />}
              {f.contraparte.tipoCuenta && <Linea k="Tipo de cuenta" v={f.contraparte.tipoCuenta} />}
              {f.contraparte.cuenta && <Linea k="Cuenta / llave" v={f.contraparte.cuenta} copiar={f.contraparte.cuenta} mono />}
            </Bloque>
            <Bloque t="CLIENTE Y QUIÉN LO HIZO">
              <Linea k="Cliente" v={f.cliente.nombre} />
              {f.cliente.nit && <Linea k="NIT / documento" v={f.cliente.nit} copiar={f.cliente.nit} />}
              {f.cliente.email && <Linea k="Correo" v={f.cliente.email} />}
              <Linea k="Id del cliente" v={f.cliente.id} copiar={f.cliente.id} mono />
              <Linea k="Hecho por" v={f.operador ? [f.operador.nombre, f.operador.email, f.operador.via].filter(Boolean).join(' · ') : 'No quedó registrado'} />
            </Bloque>
            <Bloque t="RIESGO Y COMPROBANTE">
              <Linea k="Revisión de riesgo" v={f.riesgo?.nivel ? <span style={{ color: colorRiesgo(f.riesgo.nivel), fontWeight: 700 }}>{f.riesgo.nivel}</span> : 'Sin revisión guardada'} />
              {f.riesgo?.detalle && <Linea k="Detalle" v={f.riesgo.detalle} />}
              <Linea k="Comprobante" v={f.comprobante?.numero ?? 'Sin comprobante'} />
              {f.comprobante?.factura && <Linea k="Factura" v={`${f.comprobante.factura}${f.comprobante.facturaEstado ? ` · ${f.comprobante.facturaEstado}` : ''}`} />}
            </Bloque>
            <Bloque t="HISTORIAL">
              {d.historial.length === 0
                ? <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0' }}>No hay acciones del panel registradas sobre este movimiento.</p>
                : d.historial.map((h, i) => (
                  <div key={i} style={{ padding: '7px 0', borderBottom: `1px solid ${C.b1}`, fontSize: 12.5 }}>
                    <span style={{ color: C.sub, fontVariantNumeric: 'tabular-nums' }}>{fechaHora(h.at)}</span> · <strong>{h.accion}</strong>{h.quien ? ` · ${h.quien}` : ''}
                    {h.detalle && <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 2, wordBreak: 'break-word' }}>{h.detalle}</span>}
                  </div>
                ))}
            </Bloque>
            <Bloque t="DATOS TÉCNICOS GUARDADOS">
              <button onClick={() => setVerRaw(v => !v)} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.b1}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                {verRaw ? 'Ocultar' : 'Ver todo lo que quedó guardado'}
              </button>
              {verRaw && (
                <pre style={{ marginTop: 8, padding: 12, background: C.base, border: `1px solid ${C.b1}`, borderRadius: 10, fontFamily: MONO, fontSize: 11, color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 420, overflow: 'auto' }}>{raw}</pre>
              )}
            </Bloque>
          </>
        )}
      </div>
    </div>
  );
};
