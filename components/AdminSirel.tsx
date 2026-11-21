import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, FileText, Check, AlertTriangle, Send, X } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { descargarXlsx, type Hoja } from '../lib/xlsx';
import { celdaCsv } from '../lib/csv';

// ─────────────────────────────────────────────
// Cumplimiento → SIREL (UIAF).
//
// Pedido del dueño (2026-11): un panel que entregue lo que hay que reportar a
// la UIAF por SIREL de las operaciones con activos virtuales hechas a través
// de Lincoin — primero las empresas (clientes), después todas sus
// transacciones — para que el oficial lo descargue y lo suba él mismo.
//
// El servidor (admin-data sirel_periodo, reglas en sirel.ts) arma las filas
// del mes o del día. Nada se completa a ojo: lo que no está guardado sale
// vacío y la fila dice qué falta. Lo que se sube a SIREL se anota acá con el
// radicado, para saber qué período quedó reportado.
// ─────────────────────────────────────────────

const C = { fondo: '#0C0E0D', caja: '#121413', borde: 'rgba(255,255,255,0.09)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24' };
const TARJ: React.CSSProperties = { background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 16 };
const BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: '#F4F4F2', color: '#15181A' };
const BTN2: React.CSSProperties = { ...BTN, background: 'rgba(255,255,255,0.05)', color: C.texto, border: `1px solid rgba(255,255,255,0.12)` };
const INP: React.CSSProperties = { height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', padding: '0 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' };

const usd = (n: unknown) => n == null ? '—' : `US$${Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cop = (n: unknown) => n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('es-CO')}`;
const cant = (n: unknown) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 6 });
const fechaHora = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
// Para las descargas: AAAA-MM-DD HH:MM en hora de Bogotá (ordena y se lee igual en cualquier Excel).
const fechaPlana = (iso: unknown) => { const t = Date.parse(String(iso ?? '')); return isNaN(t) ? '' : new Date(t - 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' '); };
const fechaCorta = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }); };
const corto = (s: unknown, n = 10) => { const t = String(s ?? ''); return t.length > n * 2 + 1 ? `${t.slice(0, n)}…${t.slice(-6)}` : t; };
const docLegible = (tipo: unknown, doc: unknown, dv?: unknown) => doc ? `${tipo ?? ''} ${doc}${dv != null && String(tipo) === 'NIT' ? `-${dv}` : ''}`.trim() : '—';

const TIPO_OP: Record<string, string> = { deposito: 'Depósito', retiro: 'Retiro / envío', venta: 'Venta (recibe COP)', compra: 'Compra (paga COP)' };
const TIPO_ENVIO: Record<string, string> = {
  clientes: 'Reporte de clientes', transacciones: 'Reporte de transacciones', ausencia_transacciones: 'Ausencia de transacciones',
  ros: 'ROS (operación sospechosa)', ausencia_ros: 'Ausencia de ROS',
};
const hoyBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const mesAnterior = () => { const d = new Date(Date.now() - 5 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

const Chip: React.FC<{ c: string; children: React.ReactNode; title?: string }> = ({ c, children, title }) => (
  <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: c, background: `${c}14`, border: `1px solid ${c}40`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{children}</span>
);

// ── Registrar un envío a SIREL ───────────────────────────────
const RegistrarEnvio: React.FC<{ tipo: string; periodo: string; filas?: number; onCerrar: () => void; onListo: () => void }> = ({ tipo, periodo, filas, onCerrar, onListo }) => {
  const [radicado, setRadicado] = useState('');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setOcupado(true); setError(null);
    const r = await pedirAdmin({ action: 'sirel_registrar_envio', tipo, periodo, radicado, filas, nota });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo guardar.'); return; }
    onListo();
  };
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,4,0.65)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Registrar envío a SIREL" style={{ ...TARJ, width: 'min(440px, 100%)', padding: 22, background: C.caja }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.texto }}>{TIPO_ENVIO[tipo]}</p>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 12.5, color: C.sub }}>Período {periodo}{filas != null ? ` · ${filas.toLocaleString('es-CO')} registros` : ''}. Anótalo cuando ya lo hayas subido en SIREL.</p>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.6px' }}>NÚMERO DE RADICADO DE SIREL</label>
        <input autoFocus value={radicado} onChange={e => setRadicado(e.target.value)} placeholder="El que te dio SIREL al cargar" style={{ ...INP, width: '100%', boxSizing: 'border-box', marginTop: 6 }} />
        <label style={{ display: 'block', marginTop: 12, fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.6px' }}>NOTA (OPCIONAL)</label>
        <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} style={{ ...INP, height: 'auto', padding: '8px 11px', width: '100%', boxSizing: 'border-box', marginTop: 6, resize: 'vertical' }} />
        {error && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: C.rojo }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCerrar} style={BTN2}>Cancelar</button>
          <button onClick={guardar} disabled={ocupado || radicado.trim().length < 3} style={{ ...BTN, opacity: ocupado || radicado.trim().length < 3 ? 0.4 : 1 }}><Check size={14} /> {ocupado ? 'Guardando…' : 'Registrar envío'}</button>
        </div>
      </div>
    </div>
  );
};

export const AdminSirel: React.FC = () => {
  const [periodo, setPeriodo] = useState<'mes' | 'dia'>('mes');
  const [mes, setMes] = useState(mesAnterior());
  const [dia, setDia] = useState(hoyBogota());
  const [umbral, setUmbral] = useState(150);
  const [vista, setVista] = useState<'clientes' | 'transacciones' | 'envios'>('clientes');
  const [soloConOps, setSoloConOps] = useState(false);
  const [q, setQ] = useState('');
  const [datos, setDatos] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState<null | { tipo: string; filas?: number }>(null);

  const fecha = periodo === 'mes' ? `${mes}-01` : dia;
  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const r = await pedirAdmin({ action: 'sirel_periodo', periodo, fecha });
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo armar el período.'); return; }
    setDatos(r);
  }, [periodo, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const clientes: any[] = datos?.clientes ?? [];
  const ops: any[] = datos?.operaciones ?? [];
  const envios: any[] = datos?.envios ?? [];
  const clave: string = datos?.clavePeriodo ?? (periodo === 'mes' ? mes : dia);
  const texto = q.trim().toLowerCase();
  const coincide = (...v: unknown[]) => !texto || v.some(x => String(x ?? '').toLowerCase().includes(texto));
  const clientesVista = useMemo(() => clientes.filter(c => (!soloConOps || c.operaciones > 0) && coincide(c.nombre, c.documento, c.correo)), [clientes, soloConOps, texto]);
  const opsVista = useMemo(() => ops.filter(o => coincide(o.clienteNombre, o.clienteDoc, o.walletContraparte, o.hash, o.referencia)), [ops, texto]);
  // Por cliente: lo que suma en el período (para ver quién pasa el umbral sumando varias).
  const sumaPorCliente = useMemo(() => { const m = new Map<string, number>(); for (const o of ops) m.set(o.userId, (m.get(o.userId) ?? 0) + (o.valorUsd ?? 0)); return m; }, [ops]);
  const sobre = ops.filter(o => (o.valorUsd ?? 0) >= umbral).length;
  const clientesSuman = Array.from(sumaPorCliente.values()).filter(v => v >= umbral).length;
  const enviado = (tipo: string) => envios.find(e => e.tipo === tipo && String(e.periodo).startsWith(clave));

  // ── Descargas ──────────────────────────────
  const COL_CLI = ['Tipo de persona', 'Tipo de documento', 'Número de documento', 'DV', 'Razón social / nombre', 'País', 'Código municipio (DANE)', 'Municipio', 'Departamento', 'Dirección', 'Teléfono', 'Correo', 'Representante legal', 'Tipo doc. representante', 'Documento representante', 'Fecha de vinculación', 'Estado', 'Operaciones con AV en el período', 'Valor USD en el período', 'Falta'];
  const filaCli = (c: any) => [c.tipoPersona === 'juridica' ? 'Jurídica' : 'Natural', c.tipoDocumento, c.documento ?? '', c.dv ?? '', c.nombre ?? '', c.pais ?? '', c.municipioCodigo ?? '', c.municipio ?? '', c.departamento ?? '', c.direccion ?? '', c.telefono ?? '', c.correo ?? '', c.repNombre ?? '', c.repTipoDoc ?? '', c.repDocumento ?? '', fechaPlana(c.vinculadoAt).slice(0, 10), c.estado, c.operaciones, c.usdPeriodo, (c.faltan ?? []).join(' · ')];
  const COL_OPS = ['Fecha (Bogotá)', 'Tipo de operación', 'Cliente', 'Tipo doc. cliente', 'Documento cliente', 'Activo virtual', 'Red', 'Cantidad', 'Valor USD', 'Valor COP', 'Tasa COP', 'Wallet del cliente', 'Wallet contraparte', 'Hash de la transacción', 'Traza del proveedor', 'Referencia', 'Origen', `≥ USD ${umbral}`, 'Falta', 'Id Lincoin'];
  const filaOp = (o: any) => [fechaPlana(o.fecha), TIPO_OP[o.tipo] ?? o.tipo, o.clienteNombre ?? '', o.clienteTipoDoc ?? '', o.clienteDoc ?? '', o.activo, o.red ?? '', o.cantidad, o.valorUsd ?? '', o.valorCop ?? '', o.tasaCop ?? '', o.walletCliente ?? '', o.walletContraparte ?? '', o.hash ?? '', o.traza ?? '', o.referencia ?? '', o.origen, (o.valorUsd ?? 0) >= umbral ? 'Sí' : 'No', (o.faltan ?? []).join(' · '), o.id];
  const nombreBase = `SIREL_${clave}`;
  const excel = () => {
    const hojas: Hoja[] = [
      { nombre: 'Clientes', filas: [COL_CLI, ...clientesVista.map(filaCli)] },
      { nombre: 'Transacciones AV', filas: [COL_OPS, ...opsVista.map(filaOp)] },
    ];
    descargarXlsx(`${nombreBase}.xlsx`, hojas);
  };
  const csv = (cols: string[], filas: any[][], nombre: string) => {
    const t = '﻿' + [cols, ...filas].map(f => f.map(celdaCsv).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const estadoReporte = (tipo: string, titulo: string, detalle: string, filas?: number) => {
    const e = enviado(tipo);
    return (
      <div style={{ ...TARJ, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: e ? 'rgba(74,222,128,0.3)' : C.borde }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: e ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.1)', color: e ? C.verde : C.ambar, flexShrink: 0 }}>{e ? <Check size={15} /> : <AlertTriangle size={14} />}</span>
        <span style={{ flex: 1, minWidth: 180 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.texto }}>{titulo}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 1 }}>{e ? `Enviado ${fechaHora(e.at)} · radicado ${e.radicado}${e.por?.nombre || e.por?.email ? ` · ${e.por.nombre || e.por.email}` : ''}` : detalle}</span>
        </span>
        {!e && <button onClick={() => setRegistrar({ tipo, filas })} style={{ ...BTN2, height: 32 }}><Send size={13} /> Ya lo envié</button>}
      </div>
    );
  };

  return (
    <div style={{ color: C.texto, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <div style={{ ...TARJ, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 640 }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px' }}>SIREL · UIAF</p>
            <p style={{ margin: '5px 0 0', fontSize: 12.5, color: C.sub, lineHeight: 1.55 }}>
              Lo que se reporta a la UIAF de las operaciones con activos virtuales hechas a través de Lincoin: primero los clientes (empresas) y luego todas sus transacciones. Descárgalo, súbelo en SIREL con tu usuario y anota aquí el radicado.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div role="tablist" style={{ display: 'inline-flex', padding: 3, borderRadius: 10, background: C.caja, border: `1px solid ${C.borde}` }}>
              {(['mes', 'dia'] as const).map(p => (
                <button key={p} onClick={() => setPeriodo(p)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: periodo === p ? '#F4F4F2' : 'transparent', color: periodo === p ? '#15181A' : C.sub }}>{p === 'mes' ? 'Mes' : 'Día'}</button>
              ))}
            </div>
            {periodo === 'mes'
              ? <input type="month" value={mes} max={hoyBogota().slice(0, 7)} onChange={e => e.target.value && setMes(e.target.value)} aria-label="Mes" style={INP} />
              : <input type="date" value={dia} max={hoyBogota()} onChange={e => e.target.value && setDia(e.target.value)} aria-label="Día" style={INP} />}
            <button onClick={cargar} disabled={cargando} style={BTN2}><RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar</button>
          </div>
        </div>
      </div>

      {error && <div style={{ ...TARJ, marginTop: 12, padding: '12px 16px', borderColor: 'rgba(248,113,113,0.35)', color: C.rojo, fontSize: 13 }}>{error}</div>}
      {!datos && !error && <p style={{ color: C.sub, fontSize: 13, padding: 16 }}>Armando el período…</p>}

      {datos && (
        <>
          {datos.truncado && <div style={{ ...TARJ, marginTop: 12, padding: '10px 16px', borderColor: 'rgba(251,191,36,0.35)', color: C.ambar, fontSize: 12.5 }}>El período tiene demasiados movimientos y se cortó la lectura: elige un período más corto (por día).</div>}

          {/* Qué falta enviar del período. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginTop: 12 }}>
            {estadoReporte('clientes', 'Reporte de clientes', `${clientes.length.toLocaleString('es-CO')} clientes para reportar`, clientes.length)}
            {ops.length > 0
              ? estadoReporte('transacciones', 'Reporte de transacciones', `${ops.length.toLocaleString('es-CO')} operaciones con activos virtuales`, ops.length)
              : estadoReporte('ausencia_transacciones', 'Ausencia de transacciones', 'No hubo operaciones con activos virtuales en el período: va el reporte de ausencia', 0)}
            <div style={{ ...TARJ, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.06)', color: C.sub, flexShrink: 0 }}><FileText size={14} /></span>
              <span style={{ flex: 1, minWidth: 180 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>ROS (operaciones sospechosas)</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 1 }}>Se envían apenas se detectan, sin importar el monto. Los candidatos están en la Bandeja de casos. {envios.filter(e => e.tipo === 'ros').length ? `${envios.filter(e => e.tipo === 'ros').length} enviado(s) este mes.` : ''}</span>
              </span>
              <button onClick={() => setRegistrar({ tipo: 'ros' })} style={{ ...BTN2, height: 32 }}><Send size={13} /> Anotar ROS</button>
              <button onClick={() => setRegistrar({ tipo: 'ausencia_ros' })} style={{ ...BTN2, height: 32 }}>Anotar ausencia</button>
            </div>
          </div>

          {/* Cifras del período. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
            {[
              [datos.resumen.clientes.toLocaleString('es-CO'), 'Clientes', `${datos.resumen.clientesConOperaciones} operaron con activos virtuales`],
              [datos.resumen.operaciones.toLocaleString('es-CO'), 'Operaciones con AV', `${datos.resumen.porTipo.deposito} dep. · ${datos.resumen.porTipo.retiro} ret. · ${datos.resumen.porTipo.venta} ventas · ${datos.resumen.porTipo.compra} compras`],
              [usd(datos.resumen.totalUsd), 'Valor total', 'USDT y USDC a 1 dólar'],
              [String(sobre), `Iguales o mayores a USD ${umbral}`, `${clientesSuman} cliente(s) suman ≥ USD ${umbral} en el período`],
            ].map(([v, t, s]) => (
              <div key={t} style={{ ...TARJ, padding: '14px 16px' }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px' }}>{v}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 700 }}>{t}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub }}>{s}</p>
              </div>
            ))}
          </div>

          {/* Lo que falta en los datos, en una línea. */}
          {(datos.resumen.clientesConFaltantes > 0 || datos.resumen.operacionesConFaltantes > 0) && (
            <div style={{ ...TARJ, marginTop: 12, padding: '11px 16px', borderColor: 'rgba(251,191,36,0.3)', fontSize: 12.5, color: '#FCD34D', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{datos.resumen.clientesConFaltantes} cliente(s) y {datos.resumen.operacionesConFaltantes} operación(es) tienen datos que no están guardados (cada fila dice cuáles). Complétalos antes de subir, o súbelos con lo que hay si SIREL lo admite. El CIIU (actividad económica) no lo guardamos de ninguna empresa.</span>
            </div>
          )}

          {/* Tablas. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {([['clientes', `Clientes · ${clientes.length}`], ['transacciones', `Transacciones · ${ops.length}`], ['envios', `Envíos · ${(datos.enviosRecientes ?? []).length}`]] as const).map(([k, t]) => (
                <button key={k} onClick={() => setVista(k)} style={{ height: 32, padding: '0 13px', whiteSpace: 'nowrap', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: vista === k ? 700 : 600, color: vista === k ? C.texto : C.sub, background: vista === k ? 'rgba(255,255,255,0.08)' : 'transparent', border: `1px solid ${vista === k ? 'rgba(255,255,255,0.18)' : C.borde}` }}>{t}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {vista !== 'envios' && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, documento, wallet…" aria-label="Buscar" style={{ ...INP, width: 230 }} />}
              {vista === 'transacciones' && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub }}>Umbral USD
                  <input type="number" min={0} value={umbral} onChange={e => setUmbral(Math.max(0, Number(e.target.value) || 0))} style={{ ...INP, width: 80 }} />
                </label>
              )}
              {vista === 'clientes' && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
                  <input type="checkbox" checked={soloConOps} onChange={e => setSoloConOps(e.target.checked)} style={{ accentColor: '#4ADE80' }} /> Solo los que operaron
                </label>
              )}
              {vista !== 'envios' && <>
                <button onClick={excel} style={BTN}><Download size={14} /> Excel (clientes + transacciones)</button>
                <button onClick={() => vista === 'clientes' ? csv(COL_CLI, clientesVista.map(filaCli), `${nombreBase}_clientes.csv`) : csv(COL_OPS, opsVista.map(filaOp), `${nombreBase}_transacciones.csv`)} style={BTN2}>CSV</button>
              </>}
            </div>
          </div>

          <div style={{ ...TARJ, marginTop: 10, overflow: 'hidden' }}>
            {vista === 'clientes' && (clientesVista.length === 0
              ? <p style={{ padding: 20, margin: 0, color: C.sub, fontSize: 13 }}>{q || soloConOps ? 'Nada con ese filtro.' : 'No hay clientes vinculados.'}</p>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
                    <thead><tr style={{ color: C.tenue, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'left' }}>
                      {['Cliente', 'Municipio', 'Representante legal', 'Vinculado', 'En el período', 'Falta'].map(h => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {clientesVista.slice(0, 500).map(c => (
                        <tr key={c.userId} style={{ borderTop: `1px solid ${C.borde}` }}>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ display: 'block', fontWeight: 700 }}>{c.nombre ?? '—'}</span>
                            <span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{docLegible(c.tipoDocumento, c.documento, c.dv)} · {c.tipoPersona === 'juridica' ? 'Jurídica' : 'Natural'}{c.estado !== 'activo' ? ` · ${c.estado === 'bloqueado' ? 'bloqueado' : 'sin verificar'}` : ''}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: c.municipioCodigo ? C.texto : C.sub }}>{c.municipio ?? '—'}{c.municipioCodigo ? <span style={{ color: C.sub }}> · {c.municipioCodigo}</span> : null}</td>
                          <td style={{ padding: '10px 14px' }}>{c.repNombre ?? (c.tipoPersona === 'juridica' ? '—' : 'No aplica')}{c.repDocumento ? <span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{c.repTipoDoc ?? ''} {c.repDocumento}</span> : null}</td>
                          <td style={{ padding: '10px 14px', color: C.sub, whiteSpace: 'nowrap' }}>{fechaCorta(c.vinculadoAt)}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{c.operaciones ? <>{c.operaciones} op. · {usd(c.usdPeriodo)}</> : <span style={{ color: C.tenue }}>Sin operaciones</span>}</td>
                          <td style={{ padding: '10px 14px' }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{c.faltan.length ? c.faltan.map((f: string) => <Chip key={f} c={C.ambar}>{f}</Chip>) : <Chip c={C.verde}>Completo</Chip>}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {clientesVista.length > 500 && <p style={{ padding: '10px 14px', margin: 0, fontSize: 12, color: C.sub }}>Se muestran 500 de {clientesVista.length.toLocaleString('es-CO')}. La descarga los trae todos.</p>}
                </div>)}

            {vista === 'transacciones' && (opsVista.length === 0
              ? <p style={{ padding: 20, margin: 0, color: C.sub, fontSize: 13 }}>{q ? 'Nada con esa búsqueda.' : 'No hubo operaciones con activos virtuales en el período.'}</p>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 980 }}>
                    <thead><tr style={{ color: C.tenue, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'left' }}>
                      {['Fecha', 'Cliente', 'Operación', 'Cantidad', 'USD · COP', 'Contraparte', 'Hash', 'Falta'].map(h => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {opsVista.slice(0, 500).map(o => {
                        const grande = (o.valorUsd ?? 0) >= umbral;
                        return (
                          <tr key={o.id} style={{ borderTop: `1px solid ${C.borde}` }}>
                            <td style={{ padding: '10px 14px', color: C.sub, whiteSpace: 'nowrap' }}>{fechaHora(o.fecha)}</td>
                            <td style={{ padding: '10px 14px' }}><span style={{ display: 'block', fontWeight: 700 }}>{o.clienteNombre ?? '—'}</span><span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{o.clienteTipoDoc ?? ''} {o.clienteDoc ?? ''}</span></td>
                            <td style={{ padding: '10px 14px' }}><span style={{ display: 'block' }}>{TIPO_OP[o.tipo] ?? o.tipo}</span><span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{o.origen}{o.referencia ? ` · ${o.referencia}` : ''}</span></td>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}><b>{cant(o.cantidad)} {o.activo}</b><span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{o.red ?? 'Red sin dato'}</span></td>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{usd(o.valorUsd)}{grande && <Chip c={C.verde}>≥ {umbral}</Chip>}</span>
                              {o.valorCop != null && <span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{cop(o.valorCop)}{o.tasaCop ? ` · tasa ${cop(o.tasaCop)}` : ''}</span>}
                            </td>
                            <td style={{ padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }} title={o.walletContraparte ?? ''}>{o.walletContraparte ? corto(o.walletContraparte) : <span style={{ color: C.tenue, fontFamily: 'inherit' }}>—</span>}</td>
                            <td style={{ padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }} title={o.hash ?? o.traza ?? ''}>{o.hash ? corto(o.hash) : o.traza ? <span style={{ color: C.sub }}>traza {corto(o.traza, 6)}</span> : <span style={{ color: C.tenue }}>—</span>}</td>
                            <td style={{ padding: '10px 14px' }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{o.faltan.length ? o.faltan.map((f: string) => <Chip key={f} c={C.ambar}>{f}</Chip>) : <Chip c={C.verde}>Completo</Chip>}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {opsVista.length > 500 && <p style={{ padding: '10px 14px', margin: 0, fontSize: 12, color: C.sub }}>Se muestran 500 de {opsVista.length.toLocaleString('es-CO')}. La descarga las trae todas.</p>}
                </div>)}

            {vista === 'envios' && ((datos.enviosRecientes ?? []).length === 0
              ? <p style={{ padding: 20, margin: 0, color: C.sub, fontSize: 13 }}>Todavía no se ha anotado ningún envío a SIREL.</p>
              : (datos.enviosRecientes as any[]).map((e, i) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? `1px solid ${C.borde}` : 'none', flexWrap: 'wrap' }}>
                  <Check size={14} style={{ color: C.verde, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 220 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{TIPO_ENVIO[e.tipo] ?? e.tipo} · {e.periodo}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.sub }}>Radicado {e.radicado}{e.filas != null ? ` · ${Number(e.filas).toLocaleString('es-CO')} registros` : ''} · {fechaHora(e.at)}{e.por?.nombre || e.por?.email ? ` · ${e.por.nombre || e.por.email}` : ''}{e.nota ? ` · ${e.nota}` : ''}</span>
                  </span>
                </div>
              )))}
          </div>
          <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0', lineHeight: 1.5 }}>
            USDT y USDC se valoran a 1 dólar; el saldo en USD de Lincoin es USDT. El hash de los envíos por GasFree no se guarda con el movimiento: la fila trae la traza del proveedor y el hash se consulta en Tesorería. Fechas en hora de Bogotá.
          </p>
        </>
      )}

      {registrar && <RegistrarEnvio tipo={registrar.tipo} periodo={clave} filas={registrar.filas} onCerrar={() => setRegistrar(null)} onListo={() => { setRegistrar(null); cargar(); }} />}
    </div>
  );
};
