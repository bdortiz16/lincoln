import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Users, Receipt, ArrowLeftRight, RefreshCw, Search, Download, ChevronLeft, AlertTriangle, Check, Power, Plug, X } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { descargarXlsx } from '../lib/xlsx';
import { AdminOtcSection } from './AdminOtcSection';

// ─────────────────────────────────────────────
// Contabilidad (admin de Empresas).
//
// Resumen: lo que se le cargó a los clientes, lo que convirtieron y lo que
// ganó Lincoin, por mes. Clientes: lo mismo por cliente, y al abrir uno, todo
// lo que hizo con la factura de cada operación. Facturación: el Siigo de
// Lincoin, que factura cada cargue y cada conversión (mandato: terceros +
// comisión con IVA incluido). Mesa OTC: la configuración de la mesa de
// siempre.
//
// Los números los calcula el servidor (admin-data contabilidad_resumen) con
// la misma cuenta que usa la factura: lo que se ve acá es lo que se factura.
// ─────────────────────────────────────────────

type Pestana = 'resumen' | 'clientes' | 'facturacion' | 'mesa';
type Periodo = 'todo' | 'mes' | 'mes_pasado' | '90d' | 'anio';

const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: 'mes', nombre: 'Este mes' },
  { id: 'mes_pasado', nombre: 'Mes pasado' },
  { id: '90d', nombre: 'Últimos 90 días' },
  { id: 'anio', nombre: 'Este año' },
  { id: 'todo', nombre: 'Todo' },
];

// Fechas en hora de Colombia (UTC−5): el mes contable es el de Bogotá.
function rango(p: Periodo): { desde?: string; hasta?: string } {
  if (p === 'todo') return {};
  const ahora = new Date(Date.now() - 5 * 3600_000);
  const y = ahora.getUTCFullYear(), m = ahora.getUTCMonth();
  const enBogota = (yy: number, mm: number, dd = 1) => new Date(Date.UTC(yy, mm, dd, 5)).toISOString();
  if (p === 'mes') return { desde: enBogota(y, m) };
  if (p === 'mes_pasado') return { desde: enBogota(y, m - 1), hasta: enBogota(y, m) };
  if (p === 'anio') return { desde: enBogota(y, 0) };
  return { desde: new Date(Date.now() - 90 * 86400_000).toISOString() };
}

const cop = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
};
const usd = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  return `${v.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
};
const fecha = (iso: unknown) => {
  const s = String(iso ?? '');
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const nombreMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, 15)).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Contabilidad es lo que factura Lincoin: cargues, conversiones y los ajustes
// que corrigen un cargue. Los envíos y pagos del cliente están en Clientes →
// ficha del cliente → Envíos y pagos.
const TIPO_TX: Record<string, string> = { load: 'Cargue', convert: 'Conversión', adjustment: 'Ajuste' };
const ESTADO_FACTURA: Record<string, { txt: string; cls: string }> = {
  emitida: { txt: 'Emitida', cls: 'bg-green-50 text-[#16A34A] border-green-200' },
  emitiendo: { txt: 'Emitiendo…', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pendiente: { txt: 'Pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  revision: { txt: 'Revisar utilidad', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  error: { txt: 'Error', cls: 'bg-red-50 text-red-700 border-red-200' },
  omitida: { txt: 'No aplica', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};
const FUENTE: Record<string, string> = { registrada: 'registrada', estimada: 'estimada', sin_dato: 'sin dato', manual: 'confirmada a mano' };

const leerPestana = (): Pestana => {
  try { const v = localStorage.getItem('lincoin_conta_tab'); if (v === 'resumen' || v === 'clientes' || v === 'facturacion' || v === 'mesa') return v; } catch { /* */ }
  return 'resumen';
};

const Kpi: React.FC<{ titulo: string; valor: string; detalle?: string; acento?: boolean }> = ({ titulo, valor, detalle, acento }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{titulo}</p>
    <p className={`text-lg sm:text-xl font-black mt-1 break-words ${acento ? 'text-[#16A34A]' : 'text-slate-800'}`}>{valor}</p>
    {detalle && <p className="text-[11px] text-slate-500 mt-0.5">{detalle}</p>}
  </div>
);

const Aviso: React.FC<{ tono?: 'error' | 'info'; children: React.ReactNode }> = ({ tono = 'info', children }) => (
  <div className={`rounded-xl border px-4 py-3 text-xs flex gap-2 items-start ${tono === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
    <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <div className="min-w-0">{children}</div>
  </div>
);

const EstadoFactura: React.FC<{ estado?: string | null }> = ({ estado }) => {
  if (!estado) return <span className="text-[10px] text-slate-400">Sin factura</span>;
  const e = ESTADO_FACTURA[estado] ?? { txt: estado, cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${e.cls}`}>{e.txt}</span>;
};

// ── Emitir una factura de Lincoin (con confirmación de la utilidad) ──
// La utilidad registrada se factura tal cual. Si es estimada o falta, se
// pide confirmarla: es lo que va a la DIAN como comisión.
const BotonFacturar: React.FC<{ txId: string; estado?: string | null; liq?: any; utilidadFila?: number | null; onHecho: (msg: string, ok: boolean) => void }> = ({ txId, estado, liq, utilidadFila, onHecho }) => {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  if (estado === 'emitida' || estado === 'emitiendo' || (estado === 'omitida' && liq && !liq.facturable)) return null;
  const fuente = liq?.fuente ?? null;
  const pideUtilidad = estado === 'revision' || (fuente != null && fuente !== 'registrada');
  const sugerida = Number(liq?.utilidadCop ?? utilidadFila ?? 0) || 0;
  const emitir = async (utilidad?: number) => {
    const total = utilidad != null && liq ? (liq.fijo === 'total' ? liq.totalCop : (liq.tercerosCop ?? 0) + utilidad) : liq?.totalCop;
    if (!window.confirm(`Se va a emitir la factura electrónica ante la DIAN${total ? ` por ${cop(total)}` : ''}${utilidad != null ? ` con una comisión de ${cop(utilidad)} (IVA incluido)` : ''}. ¿Seguir?`)) return;
    setEnviando(true);
    const r = await pedirAdmin({ action: 'fact_lincoin_emitir', transactionId: txId, ...(utilidad != null ? { utilidad } : {}) });
    setEnviando(false);
    if (r?.ok && r.estado === 'emitida') { setAbierto(false); onHecho(`Factura ${r.numero ?? ''} emitida.`, true); }
    else if (r?.ok) { setAbierto(false); onHecho(r.motivo ?? `Quedó en "${r.estado}".`, true); }
    else onHecho(r?.error ?? 'No se pudo emitir.', false);
  };
  if (abierto) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" placeholder="Utilidad COP"
          className="w-28 border border-slate-300 rounded-lg px-2 py-1 text-xs" />
        <button disabled={enviando} onClick={() => { const n = Number(valor.replace(/\./g, '').replace(',', '.')); if (n > 0) emitir(n); else onHecho('Escribí una utilidad mayor que cero.', false); }}
          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#16A34A] text-white disabled:opacity-50">{enviando ? 'Emitiendo…' : 'Emitir'}</button>
        <button onClick={() => setAbierto(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
      </div>
    );
  }
  return (
    <button disabled={enviando}
      onClick={() => { if (pideUtilidad) { setValor(sugerida > 0 ? String(Math.round(sugerida)) : ''); setAbierto(true); } else emitir(); }}
      className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-[#16A34A] text-[#16A34A] hover:bg-green-50 disabled:opacity-50 whitespace-nowrap">
      {enviando ? 'Emitiendo…' : pideUtilidad ? 'Confirmar utilidad' : estado === 'error' || estado === 'pendiente' ? 'Reintentar' : 'Facturar'}
    </button>
  );
};

// ── Resumen ─────────────────────────────────────────────────
const Resumen: React.FC<{ datos: any; cargando: boolean }> = ({ datos, cargando }) => {
  if (!datos) return <p className="text-sm text-slate-400">{cargando ? 'Cargando…' : 'Sin datos.'}</p>;
  const t = datos.totales ?? {};
  const f = datos.facturas ?? {};
  const utilidad = (t.utilidadCargues ?? 0) + (t.utilidadConversiones ?? 0);
  const meses: any[] = datos.meses ?? [];
  const maxU = Math.max(1, ...meses.map(m => (m.utilidadCargues ?? 0) + (m.utilidadConversiones ?? 0)));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi titulo="Cargado a clientes" valor={cop(t.cargadoCop)} detalle={`${t.cargues ?? 0} cargues · ${usd(t.usdCargado)} USDT`} />
        <Kpi titulo="Convertido" valor={cop(t.convertidoCop)} detalle={`${t.conversiones ?? 0} conversiones · ${usd(t.usdConvertido)} USD`} />
        <Kpi titulo="Utilidad Lincoin (neta)" valor={cop(utilidad)} acento detalle={t.enPerdida > 0
          ? `Ganancias ${cop(t.gananciaCop)} − pérdidas ${cop(Math.abs(t.perdidaCop))} (${t.enPerdida} en rojo)`
          : t.utilidadEstimada > 0 ? `${cop(t.utilidadEstimada)} estimada (mesa OTC)` : `Cargues ${cop(t.utilidadCargues)} · Conv. ${cop(t.utilidadConversiones)}`} />
        <Kpi titulo="Facturas Lincoin" valor={`${f.emitida ?? 0} emitidas`} detalle={`${t.porFacturar ?? 0} por facturar · ${f.error ?? 0} con error · ${f.revision ?? 0} por revisar`} />
      </div>
      {t.ajustes > 0 && (
        <Aviso>Hay {t.ajustes} ajuste{t.ajustes === 1 ? '' : 's'} (débito) por {cop(t.ajustadoCop)} sin vincular a un cargue. Si corrigen un cargue hecho por error, ábrelos en Clientes → el cliente → Ajustes y vincúlalos: así el cargue se anula o se corrige y la utilidad cuadra.</Aviso>
      )}
      {t.facturasDeAnulados > 0 && (
        <Aviso tono="error">{t.facturasDeAnulados} cargue{t.facturasDeAnulados === 1 ? '' : 's'} anulado{t.facturasDeAnulados === 1 ? '' : 's'} ya tenía{t.facturasDeAnulados === 1 ? '' : 'n'} factura emitida: anúlala en Siigo o haz la nota crédito.</Aviso>
      )}
      {t.sinUtilidad > 0 && (
        <Aviso>{t.sinUtilidad} operación{t.sinUtilidad === 1 ? '' : 'es'} no guardaron la utilidad (cargues viejos sin la contabilidad del USDT). No se facturan solas: en Clientes podés confirmar la utilidad de cada una.</Aviso>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5">Mes</th>
              <th className="text-right px-3 py-2.5">Cargues</th>
              <th className="text-right px-3 py-2.5">Cargado</th>
              <th className="text-right px-3 py-2.5">Conversiones</th>
              <th className="text-right px-3 py-2.5">Convertido</th>
              <th className="text-right px-3 py-2.5">Utilidad</th>
              <th className="px-3 py-2.5 w-36"></th>
              <th className="text-right px-4 py-2.5">Facturado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {meses.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">Sin cargues ni conversiones en el período.</td></tr>}
            {meses.map(m => {
              const u = (m.utilidadCargues ?? 0) + (m.utilidadConversiones ?? 0);
              return (
                <tr key={m.mes} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{nombreMes(m.mes)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{m.cargues}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{cop(m.cargadoCop)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{m.conversiones}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{cop(m.convertidoCop)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-[#16A34A]">{cop(u)}</td>
                  <td className="px-3 py-2.5"><div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#4ADE80]" style={{ width: `${Math.max(0, Math.min(100, u / maxU * 100))}%` }} /></div></td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{m.facturadas ? `${m.facturadas} · ${cop(m.facturadoCop)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Clientes ────────────────────────────────────────────────
const Clientes: React.FC<{ datos: any; cargando: boolean; periodo: Periodo; onAviso: (m: string, ok: boolean) => void }> = ({ datos, cargando, periodo, onAviso }) => {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<any | null>(null);
  const lista: any[] = datos?.clientes ?? [];
  const filtrados = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return lista;
    return lista.filter(c => String(c.nombre ?? '').toLowerCase().includes(n) || String(c.email ?? '').toLowerCase().includes(n) || String(c.documento ?? '').includes(n));
  }, [lista, q]);

  if (abierto) return <DetalleCliente cliente={abierto} periodo={periodo} onVolver={() => setAbierto(null)} onAviso={onAviso} />;

  const exportar = () => {
    descargarXlsx(`lincoin-clientes-${new Date().toISOString().slice(0, 10)}.xlsx`, [{
      nombre: 'Clientes',
      filas: [
        ['Cliente', 'Documento', 'Correo', 'Cargues', 'Cargado COP', 'USDT cargado', 'Utilidad cargues', 'Conversiones', 'Convertido COP', 'Utilidad conversiones', 'Facturas emitidas', 'Facturado COP', 'Por facturar', 'Última operación'],
        ...filtrados.map(c => [c.nombre, c.documento, c.email, c.cargues, c.cargadoCop, c.usdCargado, c.utilidadCargues, c.conversiones, c.convertidoCop, c.utilidadConversiones, c.facturadas, c.facturadoCop, c.porFacturar, c.ultima ? new Date(c.ultima) : null]),
      ],
    }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, correo o NIT"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-sm bg-white" />
        </div>
        <button onClick={exportar} disabled={!filtrados.length} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download size={14} /> Excel
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5">Cliente</th>
              <th className="text-right px-3 py-2.5">Cargues</th>
              <th className="text-right px-3 py-2.5">Cargado</th>
              <th className="text-right px-3 py-2.5">Conversiones</th>
              <th className="text-right px-3 py-2.5">Convertido</th>
              <th className="text-right px-3 py-2.5">Utilidad</th>
              <th className="text-right px-3 py-2.5">Facturas</th>
              <th className="text-right px-4 py-2.5">Última</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!filtrados.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">{cargando ? 'Cargando…' : 'Sin cargues ni conversiones en el período.'}</td></tr>}
            {filtrados.map(c => (
              <tr key={c.userId} onClick={() => setAbierto(c)} className="hover:bg-slate-50 cursor-pointer">
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-slate-800 truncate max-w-[240px]">{c.nombre}</p>
                  <p className="text-[10px] text-slate-400 truncate max-w-[240px]">{c.documento ? `${c.documento} · ` : ''}{c.email ?? ''}</p>
                </td>
                <td className="px-3 py-2.5 text-right text-slate-600">{c.cargues}</td>
                <td className="px-3 py-2.5 text-right">
                  <p className="font-semibold text-slate-800">{cop(c.cargadoCop)}</p>
                  {c.usdCargado > 0 && <p className="text-[10px] text-slate-400">{usd(c.usdCargado)} USDT</p>}
                  {c.ajustes > 0 && <p className="text-[10px] text-amber-700">{c.ajustes} ajuste{c.ajustes === 1 ? '' : 's'} sin vincular</p>}
                </td>
                <td className="px-3 py-2.5 text-right text-slate-600">{c.conversiones}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{cop(c.convertidoCop)}</td>
                <td className="px-3 py-2.5 text-right">
                  <p className="font-bold text-[#16A34A]">{cop((c.utilidadCargues ?? 0) + (c.utilidadConversiones ?? 0))}</p>
                  {c.enPerdida > 0 && <p className="text-[10px] text-red-600">incluye −{cop(Math.abs(c.perdidaCop)).replace('−', '')} en pérdida</p>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-slate-700">{c.facturadas}</span>
                  {c.porFacturar > 0 && <span className="text-amber-700"> · {c.porFacturar} por facturar</span>}
                  {c.facturasConError > 0 && <span className="text-red-600"> · {c.facturasConError} error</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">{fecha(c.ultima)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Tasa en COP por USD, sin decimales de más.
const tasa = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—';
};

// Vincular un débito (ajuste) al cargue que corrige. Las sugerencias las arma
// el servidor: mismo saldo, anterior al débito, y primero el que cuadra exacto.
const VincularAjuste: React.FC<{ fila: any; fechaDe: (id: string) => string | null; onHecho: (m: string, ok: boolean) => void }> = ({ fila, fechaDe, onHecho }) => {
  const sug: any[] = fila.sugerencias ?? [];
  const [elegido, setElegido] = useState<string>(sug.find(x => x.exacto)?.id ?? sug[0]?.id ?? '');
  const [enviando, setEnviando] = useState(false);
  const pedir = async (cargueId: string | null) => {
    setEnviando(true);
    const r = await pedirAdmin({ action: 'contabilidad_vincular_ajuste', ajusteId: fila.id, cargueId });
    setEnviando(false);
    if (r?.ok) onHecho(cargueId ? (r.aviso ? `Vinculado. ${r.aviso}` : r.anulado ? 'Vinculado: el cargue quedó anulado y ya no suma ni deja utilidad.' : 'Vinculado: el cargue quedó corregido.') : 'Ajuste desvinculado.', !r.aviso);
    else onHecho(r?.permisoDenegado ? 'Tu rol no permite vincular ajustes.' : (r?.error ?? 'No se pudo vincular.'), false);
  };
  if (fila.reversaDe) {
    const f = fechaDe(String(fila.reversaDe));
    return (
      <div className="space-y-1">
        <p className="text-[10px] text-slate-500">Revierte el cargue {f ? `del ${f}` : 'de otro período'}</p>
        <button disabled={enviando} onClick={() => { if (window.confirm('¿Desvincular este ajuste del cargue? El cargue vuelve a sumar con su utilidad.')) pedir(null); }}
          className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline disabled:opacity-50">Desvincular</button>
      </div>
    );
  }
  if (!fila.esDebito) return <p className="text-[10px] text-slate-400">Ajuste a favor del cliente</p>;
  if (!sug.length) return <p className="text-[10px] text-amber-700 max-w-[220px]">Sin vincular. No hay un cargue anterior de este saldo que lo cubra.</p>;
  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      <select value={elegido} onChange={e => setElegido(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-[11px] bg-white max-w-[230px]">
        {sug.map(x => (
          <option key={x.id} value={x.id}>
            {x.exacto ? '✓ ' : ''}Cargue {new Date(x.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} · {cop(x.credit)}{x.resta < x.credit ? ` (quedan ${cop(x.resta)})` : ''}
          </option>
        ))}
      </select>
      <button disabled={enviando || !elegido} onClick={() => pedir(elegido)}
        className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-[#16A34A] text-[#16A34A] hover:bg-green-50 disabled:opacity-50 whitespace-nowrap">
        {enviando ? '…' : 'Vincular'}
      </button>
    </div>
  );
};

const DetalleCliente: React.FC<{ cliente: any; periodo: Periodo; onVolver: () => void; onAviso: (m: string, ok: boolean) => void }> = ({ cliente, periodo, onVolver, onAviso }) => {
  const [datos, setDatos] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<'todo' | 'cargues' | 'conversiones' | 'ajustes' | 'perdida'>('todo');
  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const r = await pedirAdmin({ action: 'contabilidad_cliente', userId: cliente.userId, ...rango(periodo) });
    setCargando(false);
    if (r?.ok) setDatos(r); else setError(r?.error ?? 'No se pudo leer el detalle.');
  }, [cliente.userId, periodo]);
  useEffect(() => { cargar(); }, [cargar]);
  const c = datos?.cliente ?? cliente;
  const detalle: any[] = datos?.detalle ?? [];
  const vistos = detalle.filter(d => filtro === 'todo'
    || (filtro === 'cargues' && d.liq?.tipo === 'cargue')
    || (filtro === 'conversiones' && d.liq?.tipo === 'conversion')
    || (filtro === 'ajustes' && d.type === 'adjustment')
    || (filtro === 'perdida' && !d.liq?.anulado && Number(d.liq?.utilidadCop) < 0));
  const fechaDe = (id: string) => { const d = detalle.find(x => String(x.id) === id); return d ? new Date(d.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : null; };
  const aviso = (m: string, ok: boolean) => { onAviso(m, ok); cargar(); };

  // Los totales de lo que se está viendo. Un cargue anulado vale 0 y un
  // ajuste vinculado ya está restado dentro de su cargue: los ajustes que se
  // suman aparte son solo los SIN vincular. Las tasas son promedios
  // ponderados (pesos / USD), solo de las filas que tienen USD.
  const totalesDe = (filas: any[]) => {
    const t = { usd: 0, usdLlego: 0, recibido: 0, acreditado: 0, utilidad: 0, ventaPond: 0, usdVenta: 0, clientePond: 0, usdCliente: 0, ajustesSueltos: 0, nAjustesSueltos: 0 };
    for (const d of filas) {
      if (d.type === 'adjustment') { if (!d.reversaDe && d.esDebito) { t.ajustesSueltos += Number(d.amount) || 0; t.nAjustesSueltos++; } continue; }
      const l = d.liq; if (!l || l.anulado) continue;
      const u = l.usd ?? 0;
      t.usd += u; t.usdLlego += l.usdLlego ?? u;
      t.recibido += l.totalCop ?? l.tercerosCop ?? 0; t.acreditado += l.tercerosCop ?? 0; t.utilidad += l.utilidadCop ?? 0;
      // Promedio ponderado por los USDT de cada operación.
      if (u > 0 && l.tasaLincoin) { t.ventaPond += l.tasaLincoin * u; t.usdVenta += u; }
      if (u > 0 && l.tasaCliente) { t.clientePond += l.tasaCliente * u; t.usdCliente += u; }
    }
    return { ...t, tasaVenta: t.usdVenta ? t.ventaPond / t.usdVenta : null, tasaCliente: t.usdCliente ? t.clientePond / t.usdCliente : null };
  };
  const tot = useMemo(() => totalesDe(vistos), [vistos]);
  const totCargues = useMemo(() => totalesDe(detalle.filter(d => d.liq?.tipo === 'cargue')), [detalle]);

  const exportar = () => {
    const filaDe = (d: any) => {
      const l = d.liq;
      const estado = d.type === 'adjustment' ? (d.reversaDe ? 'Revierte un cargue' : 'Sin vincular') : l?.anulado ? 'Anulado' : l?.reversadoCop ? 'Corregido' : '';
      return [d.created_at ? new Date(d.created_at) : null, TIPO_TX[d.type] ?? d.type, estado,
        l?.usd ?? null, l?.usdLlego ?? null, l?.tasaLincoin ?? null, l ? (l.totalCop ?? null) : null, l?.tasaCliente ?? null,
        l ? (l.tercerosCop ?? null) : (d.type === 'adjustment' ? -(Number(d.amount) || 0) : null), l?.comisionBrebCop ?? null, l?.utilidadCop ?? null,
        l ? FUENTE[l.fuente] ?? l.fuente : '', d.currency, d.factura?.estado ?? '', d.factura?.numero ?? '', d.factura?.error ?? l?.nota ?? d.nota ?? ''];
    };
    descargarXlsx(`lincoin-${String(c.nombre ?? 'cliente').replace(/[^\w]+/g, '-').slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.xlsx`, [{
      nombre: 'Operaciones',
      filas: [
        ['Fecha', 'Tipo', 'Estado', 'USDT entró', 'USDT llegó', 'Tasa venta', 'Recibido COP', 'Tasa cliente', 'Acreditado COP', 'Comisión Bre-B COP', 'Utilidad COP', 'Utilidad', 'Saldo', 'Factura', 'Número', 'Detalle'],
        ...vistos.map(filaDe),
        ['TOTAL', '', '', tot.usd, tot.usdLlego, tot.tasaVenta, tot.recibido, tot.tasaCliente, tot.acreditado, null, tot.utilidad, '', '', '', '', tot.nAjustesSueltos ? `Ajustes sin vincular: -${tot.ajustesSueltos}` : ''],
      ],
    }]);
  };

  const util = (c.utilidadCargues ?? 0) + (c.utilidadConversiones ?? 0);
  const tasaVentaProm = totCargues.tasaVenta;
  const tasaClienteProm = totCargues.tasaCliente;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={onVolver} className="text-[11px] text-slate-400 hover:text-slate-600 font-bold mb-1 flex items-center gap-1"><ChevronLeft size={12} /> Todos los clientes</button>
          <h4 className="font-bold text-slate-800 text-base">{c.nombre}</h4>
          <p className="text-xs text-slate-500">{c.documento ? `${c.documento} · ` : ''}{c.email ?? ''}</p>
          <p className="text-[11px] text-slate-400 mt-1">Sus envíos y pagos están en Clientes → ficha del cliente → Envíos y pagos.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={cargar} disabled={cargando} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={13} className={cargando ? 'animate-spin' : ''} /> Actualizar</button>
          <button onClick={exportar} disabled={!detalle.length} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={13} /> Excel</button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi titulo="USDT que entró" valor={`${usd(c.usdCargado)} USDT`} detalle={`${c.cargues ?? 0} cargues${c.usdLlego && Math.abs(c.usdLlego - c.usdCargado) > 0.009 ? ` · llegaron ${usd(c.usdLlego)}` : ''}`} />
        <Kpi titulo="Recibido por la venta" valor={cop(c.cargadoTotalCop)} detalle={`Tasa promedio ${tasa(tasaVentaProm)}`} />
        <Kpi titulo="Acreditado al cliente" valor={cop(c.cargadoCop)} detalle={`Tasa promedio ${tasa(tasaClienteProm)}${c.comisionBrebCop ? ` · comisión Bre-B ${cop(c.comisionBrebCop)}` : ''}`} />
        <Kpi titulo="Utilidad Lincoin (neta)" valor={cop(util)} acento detalle={c.enPerdida > 0
          ? `Ganancias ${cop(c.gananciaCop)} − pérdidas ${cop(Math.abs(c.perdidaCop))} (${c.enPerdida} en rojo)`
          : `Cargues ${cop(c.utilidadCargues)}${c.conversiones ? ` · conversiones ${cop(c.utilidadConversiones)}` : ''}${c.utilidadEstimada > 0 ? ` · ${cop(c.utilidadEstimada)} estimada` : ''}`} />
        <Kpi titulo="Facturas Lincoin" valor={`${c.facturadas ?? 0} emitidas`} detalle={`${cop(c.facturadoCop)} facturado · ${c.porFacturar ?? 0} por facturar${c.facturasConError ? ` · ${c.facturasConError} con error` : ''}`} />
      </div>
      {c.conversiones > 0 && <p className="text-[11px] text-slate-500">Además: {c.conversiones} conversion{c.conversiones === 1 ? '' : 'es'} por {cop(c.convertidoCop)} ({usd(c.usdConvertido)} USD), con utilidad de {cop(c.utilidadConversiones)}.</p>}
      {c.enPerdida > 0 && (
        <Aviso tono="error">
          {c.enPerdida} operaci{c.enPerdida === 1 ? 'ón tiene' : 'ones tienen'} utilidad NEGATIVA por {cop(Math.abs(c.perdidaCop))}: se le acreditó al cliente más de lo que se recibió por la venta. Eso resta de la utilidad: ganancias {cop(c.gananciaCop)} − pérdidas {cop(Math.abs(c.perdidaCop))} = {cop(util)}.
          {' '}Si es un cargue errado que ya descontaste, vincula su ajuste (débito) y deja de restar; si los USDT o las tasas se escribieron mal, hay que corregir el cargue.
          {' '}<button onClick={() => setFiltro('perdida')} className="underline font-bold">Ver las que están en rojo</button>
        </Aviso>
      )}
      {c.ajustes > 0 && <Aviso>Hay {c.ajustes} ajuste{c.ajustes === 1 ? '' : 's'} (débito) sin vincular por {cop(c.ajustadoCop)}. Si corrigen un cargue hecho por error, vincúlalos abajo: así el cargue se anula o se corrige y la utilidad cuadra.</Aviso>}
      {c.anulados > 0 && <p className="text-[11px] text-slate-500">{c.anulados} cargue{c.anulados === 1 ? '' : 's'} anulado{c.anulados === 1 ? '' : 's'} con su ajuste: no suman ni dejan utilidad.</p>}
      {c.facturasDeAnulados > 0 && <Aviso tono="error">{c.facturasDeAnulados} cargue{c.facturasDeAnulados === 1 ? '' : 's'} anulado{c.facturasDeAnulados === 1 ? '' : 's'} ya tenía{c.facturasDeAnulados === 1 ? '' : 'n'} factura emitida. Anúlala en Siigo (o haz la nota crédito).</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex gap-1.5 flex-wrap">
        {([['todo', 'Todo'], ['cargues', 'Cargues'], ['conversiones', 'Conversiones'], ...((c.ajustes || c.ajustesVinculados) ? [['ajustes', 'Ajustes']] as const : []), ...(c.enPerdida ? [['perdida', `Con pérdida (${c.enPerdida})`]] as const : [])] as const).map(([k, n]) => (
          <button key={k} onClick={() => setFiltro(k)} className={`text-xs font-bold px-3 py-1.5 rounded-full border ${filtro === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{n}</button>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs min-w-[1180px]">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5">Fecha</th>
              <th className="text-left px-3 py-2.5">Operación</th>
              <th className="text-right px-3 py-2.5">USDT entró</th>
              <th className="text-right px-3 py-2.5">Tasa venta</th>
              <th className="text-right px-3 py-2.5">Recibido</th>
              <th className="text-right px-3 py-2.5">Tasa cliente</th>
              <th className="text-right px-3 py-2.5">Acreditado</th>
              <th className="text-right px-3 py-2.5">Utilidad</th>
              <th className="text-left px-3 py-2.5">Factura Lincoin</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!vistos.length && <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-400">{cargando ? 'Cargando…' : 'Nada en el período.'}</td></tr>}
            {vistos.map(d => {
              const l = d.liq;
              if (d.type === 'adjustment') return (
                <tr key={d.id} className="align-top" style={{ background: d.reversaDe ? 'rgba(255,255,255,0.02)' : 'rgba(251,191,36,0.05)' }}>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fecha(d.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-slate-700">Ajuste {d.esDebito ? '(débito)' : '(crédito)'}</p>
                    {d.nota && <p className="text-[10px] text-slate-400 max-w-[240px] break-words">{d.nota}</p>}
                  </td>
                  <td colSpan={4} className="px-3 py-2.5 text-[10px] text-slate-400">{d.reversaDe ? 'Ya está restado dentro del cargue que revierte.' : d.esDebito ? 'No suma en los totales del cliente hasta que se vincule.' : ''}</td>
                  <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: d.esDebito ? '#DC2626' : undefined }}>{d.esDebito ? '−' : ''}{cop(d.amount)}</td>
                  <td className="px-3 py-2.5"></td>
                  <td colSpan={2} className="px-3 py-2.5 text-right"><VincularAjuste fila={d} fechaDe={fechaDe} onHecho={aviso} /></td>
                </tr>
              );
              const anulado = !!l?.anulado;
              const o = l?.original;
              const tachado = anulado ? 'line-through text-slate-400' : '';
              return (
                <tr key={d.id} className={`align-top ${anulado ? 'opacity-70' : ''}`}>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fecha(d.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-slate-700">{TIPO_TX[d.type] ?? d.type}{d.ref ? ` · ${d.ref}` : ''}
                      {anulado && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-red-200 text-red-600">ANULADO</span>}
                      {!anulado && l?.reversadoCop ? <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-amber-300 text-amber-700">CORREGIDO</span> : null}
                    </p>
                    {d.nota && <p className="text-[10px] text-slate-400 max-w-[240px] break-words">{d.nota}</p>}
                    {(anulado || l?.reversadoCop) && <p className="text-[10px] text-slate-500 max-w-[240px] break-words">{l.nota}</p>}
                  </td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap ${tachado}`}>
                    <p className="font-semibold text-slate-800">{usd(anulado ? o?.usd : l?.usd)}</p>
                    {!anulado && l?.usdLlego != null && l?.usd != null && Math.abs(l.usdLlego - l.usd) > 0.009 && <p className="text-[10px] text-slate-400">llegaron {usd(l.usdLlego)}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-600">{tasa(l?.tasaLincoin)}</td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap font-semibold text-slate-800 ${tachado}`}>{cop(anulado ? o?.totalCop : l?.totalCop)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-600">{tasa(l?.tasaCliente)}</td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap ${tachado}`}>
                    <p className="font-semibold text-slate-800">{cop(anulado ? o?.tercerosCop : l?.tercerosCop)}</p>
                    {l?.comisionBrebCop ? <p className="text-[10px] text-slate-400">comisión Bre-B {cop(l.comisionBrebCop)}</p> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {anulado ? <p className={`font-bold ${tachado}`}>{cop(o?.utilidadCop)}</p> : (
                      <>
                        <p className={`font-bold ${l?.utilidadCop == null ? 'text-slate-400' : l.utilidadCop < 0 ? 'text-red-600' : 'text-[#16A34A]'}`}>{l?.utilidadCop != null ? cop(l.utilidadCop) : 'Sin dato'}</p>
                        <p className="text-[10px] text-slate-400">{l ? FUENTE[l.fuente] ?? l.fuente : ''}</p>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {l ? (
                      <div className="space-y-1">
                        {l.facturable ? <EstadoFactura estado={d.factura?.estado} /> : d.factura?.estado === 'emitida' ? <span className="text-[10px] font-bold text-red-600">Factura emitida: anúlala en Siigo</span> : <span className="text-[10px] text-slate-400">No aplica</span>}
                        {d.factura?.numero && <p className="text-[10px] font-semibold text-slate-600">{d.factura.numero}</p>}
                        {(d.factura?.error || (!l.facturable && !anulado && l.nota)) && <p className="text-[10px] text-slate-500 max-w-[220px] break-words">{d.factura?.error ?? l.nota}</p>}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {l?.facturable && <BotonFacturar txId={String(d.id)} estado={d.factura?.estado} liq={l} onHecho={aviso} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {vistos.some(d => d.liq) && (
            <tfoot className="bg-slate-50 border-t-2 border-slate-200">
              <tr className="font-bold text-slate-800">
                <td className="px-4 py-3" colSpan={2}>
                  TOTAL
                  <p className="text-[10px] font-normal text-slate-400">Sin anulados{tot.nAjustesSueltos ? ` · ${tot.nAjustesSueltos} ajuste${tot.nAjustesSueltos === 1 ? '' : 's'} sin vincular (−${cop(tot.ajustesSueltos)}) aparte` : ''}</p>
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap">{usd(tot.usd)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap text-slate-600">{tasa(tot.tasaVenta)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap">{cop(tot.recibido)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap text-slate-600">{tasa(tot.tasaCliente)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap">{cop(tot.acreditado)}</td>
                <td className={`px-3 py-3 text-right whitespace-nowrap ${tot.utilidad < 0 ? 'text-red-600' : 'text-[#16A34A]'}`}>{cop(tot.utilidad)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

// ── Facturación (el Siigo de Lincoin) ───────────────────────
const Facturacion: React.FC<{ onAviso: (m: string, ok: boolean) => void }> = ({ onAviso }) => {
  const [cfg, setCfg] = useState<any | null>(null);
  const [resumen, setResumen] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [accessKey, setAccessKey] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [facturas, setFacturas] = useState<any[]>([]);
  const [filtroEstado, setFiltroEstado] = useState('');

  const leer = useCallback(async () => {
    const r = await pedirAdmin({ action: 'fact_lincoin_get' });
    if (!r?.ok) { setError(r?.error ?? 'No se pudo leer la configuración.'); return; }
    setError(null);
    setCfg(r.config); setResumen(r.resumen ?? {});
    const c = r.config ?? {};
    setForm({
      username: c.username ?? '', partner_id: c.partner_id ?? '',
      document_id: c.document_id ?? '', seller_id: c.seller_id ?? '', payment_id: c.payment_id ?? '',
      item_terceros: c.item_terceros ?? '', item_comision: c.item_comision ?? '', iva_tax_id: c.iva_tax_id ?? '',
      desc_terceros: c.desc_terceros ?? '', desc_comision: c.desc_comision ?? '', observaciones: c.observaciones ?? '',
      stamp: c.stamp !== false, mail: c.mail !== false,
      operaciones: Array.isArray(c.operaciones) ? c.operaciones : ['cargue', 'conversion'],
      desde: c.desde ? String(c.desde).slice(0, 10) : '',
    });
  }, []);
  const listar = useCallback(async () => {
    const r = await pedirFacturas(filtroEstado);
    if (r?.ok) setFacturas(r.facturas ?? []);
  }, [filtroEstado]);
  useEffect(() => { leer(); }, [leer]);
  useEffect(() => { listar(); }, [listar]);

  const cat = cfg?.catalogos ?? null;
  const productos: any[] = cat?.productos ?? [];
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const guardar = async (extra: Record<string, unknown> = {}, etiqueta = 'guardar') => {
    setOcupado(etiqueta);
    const config: Record<string, unknown> = { ...form, desde: form.desde ? new Date(`${form.desde}T00:00:00-05:00`).toISOString() : null, ...extra };
    if (accessKey.trim()) config.access_key = accessKey;
    const r = await pedirAdmin({ action: 'fact_lincoin_set', config, ...(('activo' in extra) ? { cambiarActivo: true } : {}) });
    setOcupado(null);
    if (r?.ok) { setAccessKey(''); onAviso('activo' in extra ? (extra.activo ? 'Facturación automática activada.' : 'Facturación automática pausada.') : 'Configuración guardada.', true); await leer(); }
    else onAviso(r?.permisoDenegado ? 'Solo el dueño puede cambiar la configuración de Siigo.' : (r?.error ?? 'No se pudo guardar.'), false);
  };
  const probar = async () => {
    if (accessKey.trim() || form.username !== (cfg?.username ?? '')) await guardar({}, 'probar');
    setOcupado('probar');
    const r = await pedirAdmin({ action: 'fact_lincoin_probar' });
    setOcupado(null);
    if (r?.ok) { onAviso(r.aviso ? `Conectó, pero: ${r.aviso}` : 'Conexión con Siigo correcta. Ya podés elegir los datos de la factura.', !r.aviso); await leer(); }
    else onAviso(r?.error ?? 'No se pudo conectar.', false);
  };
  const alDia = async () => {
    setOcupado('aldia');
    const r = await pedirAdmin({ action: 'fact_lincoin_al_dia' });
    setOcupado(null);
    onAviso(r?.ok ? 'Se están emitiendo las pendientes. Recargá la lista en un minuto.' : (r?.error ?? 'No se pudo.'), !!r?.ok);
  };

  if (error && !cfg) return <Aviso tono="error">{error}</Aviso>;
  if (!cfg) return <p className="text-sm text-slate-400">Cargando…</p>;
  const sel = (k: string, opciones: { v: string | number; n: string }[], placeholder: string) => (
    <select value={String(form[k] ?? '')} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm bg-white">
      <option value="">{placeholder}</option>
      {opciones.map(o => <option key={String(o.v)} value={String(o.v)}>{o.n}</option>)}
    </select>
  );
  const campo = (titulo: string, hijo: React.ReactNode, ayuda?: string) => (
    <label className="block">
      <span className="text-[11px] font-bold text-slate-600">{titulo}</span>
      <div className="mt-1">{hijo}</div>
      {ayuda && <span className="text-[10px] text-slate-400">{ayuda}</span>}
    </label>
  );
  const prodOpts = productos.filter(p => p.active !== false).map(p => ({ v: p.code, n: `${p.code} · ${p.name}${(p.taxes ?? []).some((t: any) => Number(t.percentage) > 0) ? ` (${(p.taxes ?? []).filter((t: any) => Number(t.percentage) > 0).map((t: any) => `${t.name ?? 'IVA'} ${t.percentage}%`).join(', ')})` : ' (sin impuesto)'}` }));

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-bold text-slate-800 flex items-center gap-2"><Receipt size={16} className="text-[#16A34A]" /> Facturas de Lincoin en Siigo</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Por cada cargue y cada conversión completada se emite una factura de mandato al cliente: <b>ingresos recibidos para terceros</b> (lo que es del cliente, sin IVA) + <b>comisión de Lincoin</b> (la utilidad, con IVA incluido).
              Si la utilidad no quedó registrada o es estimada (mesa OTC), la factura espera a que la confirmes.
            </p>
          </div>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${cfg.activo ? 'bg-green-50 text-[#16A34A] border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{cfg.activo ? 'AUTOMÁTICA ACTIVA' : 'PAUSADA'}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
          {(['emitida', 'pendiente', 'revision', 'error', 'omitida'] as const).map(k => (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-bold uppercase">{ESTADO_FACTURA[k].txt}</p>
              <p className="text-base font-black text-slate-800">{resumen[k] ?? 0}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h5 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Plug size={15} className="text-slate-500" /> 1 · Conexión</h5>
        <p className="text-[11px] text-slate-500">El usuario y la access key de la API de Siigo de Lincoin se pegan acá. Quedan cifradas en el servidor y no se vuelven a mostrar.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {campo('Usuario de la API', <input value={form.username ?? ''} onChange={e => set('username', e.target.value)} autoComplete="off" className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />)}
          {campo('Access key', <input type="password" value={accessKey} onChange={e => setAccessKey(e.target.value)} autoComplete="new-password" placeholder={cfg.tieneAccessKey ? `Guardada (${cfg.access_key_pista?.largo ?? '?'} caracteres, …${cfg.access_key_pista?.fin ?? ''})` : 'Pegala acá'} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />, cfg.tieneAccessKey ? 'Dejala vacía para conservar la guardada.' : undefined)}
          {campo('Partner-Id', <input value={form.partner_id ?? ''} onChange={e => set('partner_id', e.target.value)} placeholder="Lincoin" className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => guardar({}, 'cred')} disabled={!!ocupado} className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 text-white disabled:opacity-50">{ocupado === 'cred' ? 'Guardando…' : 'Guardar'}</button>
          <button onClick={probar} disabled={!!ocupado} className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">{ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}</button>
          {cfg.ultimo_test_at && (
            <span className={`text-[11px] ${cfg.ultimo_test_ok ? 'text-[#16A34A]' : 'text-red-600'}`}>
              {cfg.ultimo_test_ok ? <Check size={12} className="inline mr-1" /> : null}
              Última prueba {fecha(cfg.ultimo_test_at)}: {cfg.ultimo_test_ok ? 'conectó' : 'falló'}{cfg.ultimo_error ? ` — ${cfg.ultimo_error}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className={`bg-white rounded-xl border border-slate-200 p-5 space-y-4 ${cat ? '' : 'opacity-60'}`}>
        <h5 className="font-bold text-slate-800 text-sm">2 · La factura</h5>
        {!cat && <p className="text-[11px] text-slate-500">Probá la conexión para traer de Siigo los tipos de factura, vendedores, formas de pago e ítems.</p>}
        <div className="grid sm:grid-cols-3 gap-3">
          {campo('Tipo de factura (FV)', sel('document_id', (cat?.documentos ?? []).map((d: any) => ({ v: d.id, n: `${d.code ? d.code + ' · ' : ''}${d.name}` })), 'Elegí…'))}
          {campo('Vendedor', sel('seller_id', (cat?.vendedores ?? []).filter((v: any) => v.activo !== false).map((v: any) => ({ v: v.id, n: v.nombre })), 'Elegí…'))}
          {campo('Forma de pago', sel('payment_id', (cat?.pagos ?? []).map((p: any) => ({ v: p.id, n: p.name })), 'Elegí…'))}
          {campo('Ítem ingresos para terceros', sel('item_terceros', prodOpts, 'Elegí…'), 'Va SIN IVA.')}
          {campo('Ítem comisión Lincoin', sel('item_comision', prodOpts, 'Elegí…'), 'Va con IVA incluido en la utilidad.')}
          {campo('IVA de la comisión (si el ítem no lo trae)', sel('iva_tax_id', (cat?.impuestos ?? []).filter((t: any) => Number(t.percentage) > 0).map((t: any) => ({ v: t.id, n: `${t.name} ${t.percentage}%` })), 'El del ítem'))}
          {campo('Descripción terceros', <input value={form.desc_terceros ?? ''} onChange={e => set('desc_terceros', e.target.value)} placeholder="Ingresos recibidos para terceros · {tipo} {fecha}" className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />)}
          {campo('Descripción comisión', <input value={form.desc_comision ?? ''} onChange={e => set('desc_comision', e.target.value)} placeholder="Comisión Lincoin · {tipo} {fecha}" className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />, 'Variables: {tipo} {fecha} {usd} {ref} {cliente}')}
          {campo('Observaciones', <input value={form.observaciones ?? ''} onChange={e => set('observaciones', e.target.value)} placeholder="Texto de mandato por defecto" className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />)}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.stamp} onChange={e => set('stamp', e.target.checked)} /> Enviar a la DIAN (factura electrónica)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.mail} onChange={e => set('mail', e.target.checked)} /> Mandar la factura al correo del cliente</label>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h5 className="font-bold text-slate-800 text-sm">3 · Cuándo se factura</h5>
        <div className="flex flex-wrap gap-4 text-xs text-slate-700">
          {[['cargue', 'Cada cargue'], ['conversion', 'Cada conversión']].map(([k, n]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={(form.operaciones ?? []).includes(k)} onChange={e => set('operaciones', e.target.checked ? Array.from(new Set([...(form.operaciones ?? []), k])) : (form.operaciones ?? []).filter((x: string) => x !== k))} /> {n}
            </label>
          ))}
        </div>
        <div className="max-w-xs">
          {campo('Facturar solas las operaciones desde', <input type="date" value={form.desde ?? ''} onChange={e => set('desde', e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />, 'Vacío = desde que se activa. Las anteriores se facturan a mano, una por una.')}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={() => guardar({}, 'guardar')} disabled={!!ocupado} className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 text-white disabled:opacity-50">{ocupado === 'guardar' ? 'Guardando…' : 'Guardar configuración'}</button>
          <button onClick={() => { if (cfg.activo || window.confirm('Desde ahora cada cargue y conversión completada va a emitir una factura electrónica ante la DIAN a nombre del cliente. ¿Activar?')) guardar({ activo: !cfg.activo }, 'activo'); }} disabled={!!ocupado}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50 ${cfg.activo ? 'border border-red-300 text-red-600 hover:bg-red-50' : 'bg-[#16A34A] text-white'}`}>
            <Power size={13} /> {ocupado === 'activo' ? '…' : cfg.activo ? 'Pausar automática' : 'Activar automática'}
          </button>
          {cfg.activo && <button onClick={alDia} disabled={!!ocupado} className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">{ocupado === 'aldia' ? 'Pidiendo…' : 'Emitir las que faltan'}</button>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
          <h5 className="font-bold text-slate-800 text-sm">Facturas</h5>
          <div className="flex items-center gap-2">
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">Todas</option>
              {Object.entries(ESTADO_FACTURA).map(([k, v]) => <option key={k} value={k}>{v.txt}</option>)}
            </select>
            <button onClick={() => { listar(); leer(); }} className="text-slate-500 hover:text-slate-700 p-1.5"><RefreshCw size={14} /></button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5">Operación</th>
                <th className="text-left px-3 py-2.5">Cliente</th>
                <th className="text-right px-3 py-2.5">Total</th>
                <th className="text-right px-3 py-2.5">Terceros</th>
                <th className="text-right px-3 py-2.5">Comisión</th>
                <th className="text-left px-3 py-2.5">Estado</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!facturas.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Todavía no hay facturas.</td></tr>}
              {facturas.map(f => (
                <tr key={f.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-slate-700">{f.tipo === 'cargue' ? 'Cargue' : 'Conversión'}</p>
                    <p className="text-[10px] text-slate-400">{fecha(f.operacion_at)}</p>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 max-w-[200px] truncate">{f.cliente ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{cop(f.total)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{cop(f.terceros)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <p className="font-bold text-[#16A34A]">{cop(f.utilidad)}</p>
                    {f.base != null && <p className="text-[10px] text-slate-400">base {cop(f.base)} + IVA {cop(f.iva)}</p>}
                    {f.utilidad_fuente && f.utilidad_fuente !== 'registrada' && <p className="text-[10px] text-amber-700">{FUENTE[f.utilidad_fuente] ?? f.utilidad_fuente}</p>}
                  </td>
                  <td className="px-3 py-2.5 space-y-1">
                    <EstadoFactura estado={f.estado} />
                    {f.numero && <p className="text-[10px] font-semibold text-slate-600">{f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="underline">{f.numero}</a> : f.numero}</p>}
                    {f.error && <p className="text-[10px] text-slate-500 max-w-[300px] break-words">{f.error}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <BotonFacturar txId={String(f.transaction_id)} estado={f.estado} utilidadFila={f.utilidad} liq={f.estado === 'revision' ? { fuente: f.utilidad_fuente, utilidadCop: f.utilidad, tercerosCop: f.terceros, totalCop: f.total, fijo: f.tipo === 'conversion' && f.terceros == null ? 'total' : 'terceros', facturable: true } : null}
                      onHecho={(m, ok) => { onAviso(m, ok); listar(); leer(); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

async function pedirFacturas(estado: string) {
  return pedirAdmin({ action: 'fact_lincoin_lista', limite: 500, ...(estado ? { estado } : {}) });
}

// ── Contenedor ──────────────────────────────────────────────
export const AdminContabilidad: React.FC = () => {
  const [pestana, setPestana] = useState<Pestana>(leerPestana);
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [datos, setDatos] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<{ m: string; ok: boolean } | null>(null);

  const cambiar = (p: Pestana) => { setPestana(p); try { localStorage.setItem('lincoin_conta_tab', p); } catch { /* */ } };
  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const r = await pedirAdmin({ action: 'contabilidad_resumen', ...rango(periodo) });
    setCargando(false);
    if (r?.ok) setDatos(r); else setError(r?.permisoDenegado ? 'Tu rol no permite ver la contabilidad.' : (r?.error ?? 'No se pudo leer la contabilidad.'));
  }, [periodo]);
  useEffect(() => { if (pestana === 'resumen' || pestana === 'clientes') cargar(); }, [cargar, pestana]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 6000); return () => clearTimeout(t); }, [aviso]);

  const exportar = () => {
    if (!datos) return;
    descargarXlsx(`lincoin-contabilidad-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        nombre: 'Por mes',
        filas: [
          ['Mes', 'Cargues', 'Cargado COP', 'USDT cargado', 'Utilidad cargues', 'Conversiones', 'Convertido COP', 'Utilidad conversiones', 'Utilidad estimada', 'Facturas emitidas', 'Facturado COP'],
          ...(datos.meses ?? []).map((m: any) => [m.mes, m.cargues, m.cargadoCop, m.usdCargado, m.utilidadCargues, m.conversiones, m.convertidoCop, m.utilidadConversiones, m.utilidadEstimada, m.facturadas, m.facturadoCop]),
        ],
      },
      {
        nombre: 'Por cliente',
        filas: [
          ['Cliente', 'Documento', 'Correo', 'Cargues', 'Cargado COP', 'Utilidad cargues', 'Conversiones', 'Convertido COP', 'Utilidad conversiones', 'Facturas emitidas', 'Facturado COP'],
          ...(datos.clientes ?? []).map((c: any) => [c.nombre, c.documento, c.email, c.cargues, c.cargadoCop, c.utilidadCargues, c.conversiones, c.convertidoCop, c.utilidadConversiones, c.facturadas, c.facturadoCop]),
        ],
      },
    ]);
  };

  const PESTANAS: { id: Pestana; nombre: string; icono: React.ElementType }[] = [
    { id: 'resumen', nombre: 'Resumen', icono: BarChart3 },
    { id: 'clientes', nombre: 'Clientes', icono: Users },
    { id: 'facturacion', nombre: 'Facturación Siigo', icono: Receipt },
    { id: 'mesa', nombre: 'Mesa OTC', icono: ArrowLeftRight },
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto max-w-full">
          {PESTANAS.map(p => (
            <button key={p.id} onClick={() => cambiar(p.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${pestana === p.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <p.icono size={14} className={pestana === p.id ? 'text-[#16A34A]' : ''} /> {p.nombre}
            </button>
          ))}
        </div>
        {(pestana === 'resumen' || pestana === 'clientes') && (
          <div className="flex items-center gap-2">
            <select value={periodo} onChange={e => setPeriodo(e.target.value as Periodo)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold bg-white text-slate-700">
              {PERIODOS.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <button onClick={cargar} disabled={cargando} className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50" title="Actualizar"><RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /></button>
            {pestana === 'resumen' && <button onClick={exportar} disabled={!datos} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={14} /> Excel</button>}
          </div>
        )}
      </div>

      {aviso && (
        <div className={`rounded-xl border px-4 py-2.5 text-xs flex items-start gap-2 ${aviso.ok ? 'bg-green-50 border-green-200 text-[#16A34A]' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {aviso.ok ? <Check size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
          <span className="flex-1 break-words">{aviso.m}</span>
          <button onClick={() => setAviso(null)} className="opacity-60 hover:opacity-100"><X size={13} /></button>
        </div>
      )}
      {(pestana === 'resumen' || pestana === 'clientes') && error && <Aviso tono="error">{error}</Aviso>}
      {(pestana === 'resumen' || pestana === 'clientes') && datos?.truncado && <Aviso>Hay más de 40.000 movimientos en el período: los totales cubren solo los más recientes. Elegí un período más corto.</Aviso>}
      {(pestana === 'resumen' || pestana === 'clientes') && datos && !datos.conFacturas && <Aviso>El estado de las facturas no se puede mostrar todavía: falta correr la migración 2026_zz9_facturacion_lincoin.sql.</Aviso>}

      {pestana === 'resumen' && <Resumen datos={datos} cargando={cargando} />}
      {pestana === 'clientes' && <Clientes datos={datos} cargando={cargando} periodo={periodo} onAviso={(m, ok) => { setAviso({ m, ok }); cargar(); }} />}
      {pestana === 'facturacion' && <Facturacion onAviso={(m, ok) => setAviso({ m, ok })} />}
      {pestana === 'mesa' && <AdminOtcSection />}
    </div>
  );
};
