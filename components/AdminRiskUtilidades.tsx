// Reporte de las utilidades de AML y KYT (23 nov, pedido del dueño): al tocar
// la tarjeta "Utilidades · AML y KYT" de la Billetera se abre esto, con todo
// ordenado: cuánto entró por cada bolsillo (Mouv, Finity, Coinsenda Jero,
// Kaupaloki y Saldo Lincoin), cuánto por cliente, por mes, y cuántas
// consultas se usaron de AML y cuántas de KYT.
//
// La plata entra por COMPRAS de paquetes, y una consulta comprada sirve igual
// para AML que para KYT. Partir los pesos entre AML y KYT sería inventar un
// número; por eso el dinero va por bolsillo, cliente y mes, y AML/KYT van en
// consultas usadas. La pantalla lo dice para que nadie lo lea al revés.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, RefreshCw, Search, ShieldCheck, Wallet, Users, ScanSearch } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { descargarXlsx, type CeldaX } from '../lib/xlsx';

const C = {
  base: '#070808', carbon: '#0C0E0D', elevado: '#121413', texto: '#F4F4F2', sub: '#878E88',
  tenue: 'rgba(244,244,242,0.45)', borde: 'rgba(255,255,255,0.08)', borde2: 'rgba(255,255,255,0.12)', verde: '#4ADE80',
};
// Los cinco bolsillos de donde se puede pagar un paquete, en el orden de la
// Billetera. Se muestran siempre, aunque estén en cero: un bolsillo que no
// aparece se lee como "no se revisó".
const BOLSILLOS: { codigo: string; nombre: string; detalle: string }[] = [
  { codigo: 'COP_BREB', nombre: 'Mouv', detalle: 'Bre-B y ACH' },
  { codigo: 'COP_ACH', nombre: 'Finity', detalle: 'Bre-B y ACH' },
  { codigo: 'COP_C3', nombre: 'Coinsenda Jero', detalle: 'Cuenta 3' },
  { codigo: 'COP_C4', nombre: 'Coinsenda Kaupaloki', detalle: 'Cuenta 4' },
  { codigo: 'COP', nombre: 'Saldo Lincoin', detalle: 'Saldo general' },
];
const nombreBolsillo = (c: string) => BOLSILLOS.find(b => b.codigo === c)?.nombre ?? c;

const cop = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const ent = (n: number) => Math.round(Number(n) || 0).toLocaleString('es-CO');
const pct = (n: number, de: number) => (de > 0 ? `${(n / de * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %` : '—');
const fecha = (iso: string | null) => {
  if (!iso) return '—';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (m: string) => { const [a, n] = m.split('-'); return `${MESES[Number(n) - 1] ?? n} ${a}`; };

// Los días se cuentan en Bogotá (el servidor también).
const hoyBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
type Periodo = 'todo' | 'mes' | 'anterior' | 'rango';
function rangoDe(p: Periodo, desde: string, hasta: string): { desde: string | null; hasta: string | null } {
  const hoy = hoyBogota();
  if (p === 'mes') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  if (p === 'anterior') {
    const [a, m] = hoy.split('-').map(Number);
    const ini = new Date(Date.UTC(m === 1 ? a - 1 : a, m === 1 ? 11 : m - 2, 1));
    const fin = new Date(Date.UTC(a, m - 1, 0));
    return { desde: ini.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
  }
  if (p === 'rango') return { desde: desde || null, hasta: hasta || null };
  return { desde: null, hasta: null };
}

const Seccion: React.FC<{ n: string; titulo: string; icono: React.ReactNode; nota?: React.ReactNode; children: React.ReactNode }> = ({ n, titulo, icono, nota, children }) => (
  <section style={{ background: C.carbon, border: `1px solid ${C.borde2}`, borderRadius: 16, padding: '18px 18px 16px', minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub }}>{n}</span>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(74,222,128,0.12)', color: C.verde, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icono}</span>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.texto, letterSpacing: '-0.2px' }}>{titulo}</h3>
    </div>
    {nota && <p style={{ margin: '8px 0 0', fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{nota}</p>}
    <div style={{ marginTop: 14 }}>{children}</div>
  </section>
);

const Kpi: React.FC<{ k: string; v: string; pie?: string; verde?: boolean }> = ({ k, v, pie, verde }) => (
  <div style={{ background: C.carbon, border: `1px solid ${C.borde2}`, borderRadius: 14, padding: '13px 15px', minWidth: 0 }}>
    <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', color: C.sub, textTransform: 'uppercase' }}>{k}</p>
    <p style={{ margin: '5px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', color: verde ? C.verde : C.texto, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</p>
    {pie && <p style={{ margin: '2px 0 0', fontSize: 11.5, color: C.tenue, lineHeight: 1.4 }}>{pie}</p>}
  </div>
);

// Tabla con scroll horizontal PROPIO: en el celular la tabla se desliza, la
// página no.
const Tabla: React.FC<{ cab: { t: string; der?: boolean }[]; children: React.ReactNode; pie?: React.ReactNode; ancho?: number }> = ({ cab, children, pie, ancho = 560 }) => (
  <div style={{ overflowX: 'auto', border: `1px solid ${C.borde}`, borderRadius: 12 }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: ancho }}>
      <thead>
        <tr style={{ background: C.elevado }}>
          {cab.map(c => (
            <th key={c.t} style={{ textAlign: c.der ? 'right' : 'left', padding: '9px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.8px', color: C.sub, textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borde}` }}>{c.t}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
      {pie && <tfoot>{pie}</tfoot>}
    </table>
  </div>
);
const td = (der?: boolean, fuerte?: boolean): React.CSSProperties => ({
  padding: '10px 12px', textAlign: der ? 'right' : 'left', color: fuerte ? C.texto : C.sub, fontWeight: fuerte ? 700 : 500,
  borderTop: `1px solid ${C.borde}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
});
const tdPie = (der?: boolean): React.CSSProperties => ({ ...td(der, true), background: C.elevado, borderTop: `1px solid ${C.borde2}` });

export const AdminRiskUtilidades: React.FC<{ onCerrar: () => void }> = ({ onCerrar }) => {
  const [periodo, setPeriodo] = useState<Periodo>('todo');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [d, setD] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [verCompras, setVerCompras] = useState(50);

  const rango = useMemo(() => rangoDe(periodo, desde, hasta), [periodo, desde, hasta]);
  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const r = await pedirAdmin({ action: 'risk_utilidades_detalle', ...rango });
      if (r?.ok) setD(r); else setError(r?.error ?? 'No se pudo leer el reporte.');
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo leer el reporte.');
    }
    setCargando(false);
  }, [rango]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const t = d?.totales ?? {};
  const totalUsadas = Number(t.usadasAml ?? 0) + Number(t.usadasKyt ?? 0);
  const bolsillos = BOLSILLOS.map(b => {
    const x = (d?.porBolsillo ?? []).find((y: any) => y.codigo === b.codigo);
    return { ...b, total: x?.total ?? 0, subtotal: x?.subtotal ?? 0, iva: x?.iva ?? 0, compras: x?.compras ?? 0, consultas: x?.consultas ?? 0, clientes: x?.clientes ?? 0 };
  });
  // Un bolsillo raro (escrito a mano o viejo) también se ve, al final.
  const otros = (d?.porBolsillo ?? []).filter((y: any) => !BOLSILLOS.some(b => b.codigo === y.codigo));
  const maxBolsillo = Math.max(1, ...bolsillos.map(b => b.total), ...otros.map((o: any) => o.total));
  const clientes: any[] = (d?.porCliente ?? []).filter((c: any) => {
    const q = buscar.trim().toLowerCase();
    return !q || String(c.cliente).toLowerCase().includes(q) || String(c.email ?? '').toLowerCase().includes(q);
  });

  const textoPeriodo = rango.desde || rango.hasta
    ? `${rango.desde ?? 'el inicio'} a ${rango.hasta ?? 'hoy'}`
    : 'desde el inicio';

  const excel = () => {
    if (!d) return;
    const tit = (s: string): CeldaX => ({ v: s, s: 'titulo' });
    const resumen: CeldaX[][] = [
      [{ v: 'Lincoin', marca: true }],
      [tit('Utilidades · AML y KYT')],
      [{ v: `Período: ${textoPeriodo} (días de Bogotá)`, s: 'nota' }],
      [],
      [{ v: 'Concepto', s: 'th' }, { v: 'Valor', s: 'th' }],
      ['Ingresos (con IVA)', { v: t.total, s: 'cop' }],
      ['Subtotal', { v: t.subtotal, s: 'cop' }],
      ['IVA', { v: t.iva, s: 'cop' }],
      ['Compras', { v: t.compras, s: 'entero' }],
      ['Clientes que compraron', { v: t.clientes, s: 'entero' }],
      ['Consultas vendidas', { v: t.consultasVendidas, s: 'entero' }],
      ['Consultas usadas · AML', { v: t.usadasAml, s: 'entero' }],
      ['Consultas usadas · KYT', { v: t.usadasKyt, s: 'entero' }],
      ['Consultas devueltas (fallidas)', { v: t.devueltas, s: 'entero' }],
      ['Consultas cargadas a mano (no son ingreso)', { v: t.ajustes, s: 'entero' }],
      [],
      [{ v: 'Una consulta comprada sirve igual para AML y KYT: el dinero va por bolsillo, cliente y mes; AML y KYT, en consultas usadas.', s: 'nota' }],
    ];
    const hojaBols: CeldaX[][] = [
      ['Bolsillo', 'Ingresos', 'Subtotal', 'IVA', '% del total', 'Compras', 'Consultas', 'Clientes'],
      ...[...bolsillos, ...otros.map((o: any) => ({ ...o, nombre: o.bolsillo }))].map((b: any) => [
        b.nombre, { v: b.total, s: 'cop' }, { v: b.subtotal, s: 'cop' }, { v: b.iva, s: 'cop' },
        { v: t.total > 0 ? b.total / t.total : 0, s: 'pct' }, { v: b.compras, s: 'entero' }, { v: b.consultas, s: 'entero' }, { v: b.clientes, s: 'entero' },
      ] as CeldaX[]),
      [{ v: 'Total', s: 'totalTexto' }, { v: t.total, s: 'totalCop' }, { v: t.subtotal, s: 'totalCop' }, { v: t.iva, s: 'totalCop' }, { v: 1, s: 'totalPct' }, { v: t.compras, s: 'totalEntero' }, { v: t.consultasVendidas, s: 'totalEntero' }, { v: t.clientes, s: 'totalEntero' }],
    ];
    const hojaCli: CeldaX[][] = [
      ['Cliente', 'Correo', 'Pagó', ...BOLSILLOS.map(b => b.nombre), 'Compras', 'Consultas compradas', 'Usadas AML', 'Usadas KYT', 'Devueltas', 'Cargadas a mano', 'Saldo de consultas hoy', 'Última compra'],
      ...(d.porCliente ?? []).map((c: any) => [
        c.cliente, c.email ?? '', { v: c.total, s: 'cop' }, ...BOLSILLOS.map(b => ({ v: c.porBolsillo?.[b.codigo] ?? 0, s: 'cop' } as CeldaX)),
        { v: c.compras, s: 'entero' }, { v: c.consultas, s: 'entero' }, { v: c.usadasAml, s: 'entero' }, { v: c.usadasKyt, s: 'entero' },
        { v: c.devueltas, s: 'entero' }, { v: c.ajustes, s: 'entero' }, { v: c.saldoHoy, s: 'entero' }, c.ultimaCompra ? new Date(c.ultimaCompra) : '',
      ] as CeldaX[]),
    ];
    const hojaMes: CeldaX[][] = [
      ['Mes', 'Ingresos', 'Compras', 'Consultas vendidas', 'Usadas AML', 'Usadas KYT'],
      ...(d.porMes ?? []).map((m: any) => [nombreMes(m.mes), { v: m.total, s: 'cop' }, { v: m.compras, s: 'entero' }, { v: m.consultas, s: 'entero' }, { v: m.usadasAml, s: 'entero' }, { v: m.usadasKyt, s: 'entero' }] as CeldaX[]),
    ];
    const hojaCompras: CeldaX[][] = [
      ['Fecha', 'Cliente', 'Bolsillo', 'Consultas', 'Precio unitario', 'Subtotal', 'IVA', 'Total', 'Compró'],
      ...(d.compras ?? []).map((c: any) => [new Date(c.at), c.cliente, c.bolsilloNombre, { v: c.cantidad, s: 'entero' }, { v: c.precioUnit, s: 'cop' }, { v: c.subtotal, s: 'cop' }, { v: c.iva, s: 'cop' }, { v: c.total, s: 'cop' }, c.por ?? ''] as CeldaX[]),
    ];
    descargarXlsx(`lincoin-utilidades-aml-kyt-${rango.desde ?? 'inicio'}-a-${rango.hasta ?? hoyBogota()}.xlsx`, [
      { nombre: 'Resumen', filas: resumen, cabecera: 4, anchos: [44, 18], filtro: null },
      { nombre: 'Por bolsillo', filas: hojaBols, anchos: [24, 16, 16, 14, 12, 10, 12, 10] },
      { nombre: 'Por cliente', filas: hojaCli, anchos: [34, 30, 14, 12, 12, 16, 20, 14, 10, 18, 12, 12, 10, 16, 20, 18] },
      { nombre: 'Por mes', filas: hojaMes, anchos: [18, 16, 10, 18, 12, 12] },
      { nombre: 'Compras', filas: hojaCompras, anchos: [20, 34, 22, 10, 14, 14, 12, 14, 24] },
    ]);
  };

  const chip = (activo: boolean): React.CSSProperties => ({
    border: activo ? 'none' : `1px solid ${C.borde2}`, background: activo ? C.texto : 'transparent', color: activo ? C.carbon : C.sub,
    borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  });
  const inputFecha: React.CSSProperties = {
    background: C.base, border: `1px solid ${C.borde2}`, borderRadius: 9, color: C.texto, padding: '6px 9px', fontSize: 12.5, fontFamily: 'inherit', colorScheme: 'dark',
  };

  // En un portal sobre <body>: dentro de la Billetera, un contenedor con
  // animación (transform) volvía `position: fixed` relativo a él y el reporte
  // salía recortado por la izquierda, debajo del menú lateral (23 nov).
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Utilidades de AML y KYT"
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(4,5,5,0.78)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', overflowY: 'auto', fontFamily: "'Archivo', system-ui, sans-serif" }}
      onClick={onCerrar}>
      <style>{`
        .ru-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .ru-dos { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
        .ru-fila:hover td { background: rgba(255,255,255,0.025); }
        @media (max-width: 900px) { .ru-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ru-dos { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
      <div onClick={e => e.stopPropagation()}
        style={{ maxWidth: 1180, margin: '24px auto', padding: '0 16px 32px', boxSizing: 'border-box', color: C.texto }}>
        {/* Cabecera */}
        <div style={{ borderRadius: 18, padding: '18px 20px', border: `1px solid ${C.borde2}`, background: 'radial-gradient(circle at 90% 0%, rgba(74,222,128,0.14), transparent 45%), linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: C.sub }}>BILLETERA · REPORTE</p>
              <h2 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={20} style={{ color: C.verde, flexShrink: 0 }} /> Utilidades · AML y KYT
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.sub }}>Lo que los clientes pagaron por consultas de Lincoin Risk, {textoPeriodo}.</p>
            </div>
            <button onClick={onCerrar} aria-label="Cerrar"
              style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${C.borde2}`, background: 'transparent', color: C.sub, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <X size={17} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {([['todo', 'Todo'], ['mes', 'Este mes'], ['anterior', 'Mes anterior'], ['rango', 'Fechas…']] as [Periodo, string][]).map(([p, l]) => (
              <button key={p} onClick={() => setPeriodo(p)} style={chip(periodo === p)}>{l}</button>
            ))}
            {periodo === 'rango' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputFecha} aria-label="Desde" />
                <span style={{ fontSize: 12, color: C.sub }}>a</span>
                <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputFecha} aria-label="Hasta" />
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={cargar} disabled={cargando} title="Actualizar"
              style={{ ...chip(false), display: 'inline-flex', alignItems: 'center', gap: 6, color: C.texto }}>
              <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button onClick={excel} disabled={!d}
              style={{ ...chip(false), display: 'inline-flex', alignItems: 'center', gap: 6, color: C.carbon, background: C.verde, border: 'none', opacity: d ? 1 : 0.5 }}>
              <Download size={13} /> Excel
            </button>
          </div>
        </div>

        {error && (
          <p style={{ margin: '14px 0 0', padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.07)', color: '#F87171', fontSize: 13 }}>{error}</p>
        )}
        {!d && cargando && <p style={{ margin: '24px 0', textAlign: 'center', color: C.sub, fontSize: 13 }}>Cargando el reporte…</p>}

        {d && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14, opacity: cargando ? 0.6 : 1, transition: 'opacity .15s' }}>
            {/* Cifras del período */}
            <div className="ru-kpis">
              <Kpi k="Ingresos" v={cop(t.total)} pie={`Subtotal ${cop(t.subtotal)} · IVA ${cop(t.iva)}`} verde={t.total > 0} />
              <Kpi k="Compras" v={ent(t.compras)} pie={`${ent(t.clientes)} ${t.clientes === 1 ? 'cliente' : 'clientes'} · ${ent(t.consultasVendidas)} consultas vendidas`} />
              <Kpi k="Usadas · AML" v={ent(t.usadasAml)} pie={`${pct(t.usadasAml, totalUsadas)} de las usadas · personas y empresas`} />
              <Kpi k="Usadas · KYT" v={ent(t.usadasKyt)} pie={`${pct(t.usadasKyt, totalUsadas)} de las usadas · wallets`} />
            </div>
            {(t.ajustes !== 0 || t.devueltas > 0) && (
              <p style={{ margin: 0, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                {t.ajustes !== 0 && <>Consultas cargadas a mano en el período: <b style={{ color: C.texto }}>{ent(t.ajustes)}</b> (no son ingreso). </>}
                {t.devueltas > 0 && <>Devueltas por consultas fallidas: <b style={{ color: C.texto }}>{ent(t.devueltas)}</b> (ya restadas de las usadas).</>}
              </p>
            )}

            {/* 01 · Por bolsillo */}
            <Seccion n="01" titulo="Por bolsillo" icono={<Wallet size={15} />}
              nota="De qué bolsillo del cliente se descontó cada compra. Esa plata se queda en la bolsa de ese riel.">
              <Tabla cab={[{ t: 'Bolsillo' }, { t: 'Ingresos', der: true }, { t: '%', der: true }, { t: 'Compras', der: true }, { t: 'Consultas', der: true }, { t: 'Clientes', der: true }]}
                pie={<tr>
                  <td style={tdPie()}>Total</td><td style={tdPie(true)}>{cop(t.total)}</td><td style={tdPie(true)}>{t.total > 0 ? '100 %' : '—'}</td>
                  <td style={tdPie(true)}>{ent(t.compras)}</td><td style={tdPie(true)}>{ent(t.consultasVendidas)}</td><td style={tdPie(true)}>{ent(t.clientes)}</td>
                </tr>}>
                {[...bolsillos, ...otros.map((o: any) => ({ ...o, nombre: o.bolsillo, detalle: 'Otro' }))].map((b: any) => (
                  <tr key={b.codigo} className="ru-fila">
                    <td style={td(false, true)}>
                      <span style={{ display: 'block' }}>{b.nombre}</span>
                      <span style={{ display: 'block', fontSize: 11, color: C.tenue, fontWeight: 500 }}>{b.detalle}</span>
                      <span style={{ display: 'block', marginTop: 6, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', width: 160, maxWidth: '100%' }}>
                        <span style={{ display: 'block', height: 4, borderRadius: 99, background: C.verde, width: `${Math.round(b.total / maxBolsillo * 100)}%` }} />
                      </span>
                    </td>
                    <td style={td(true, b.total > 0)}>{cop(b.total)}</td>
                    <td style={td(true)}>{pct(b.total, t.total)}</td>
                    <td style={td(true)}>{ent(b.compras)}</td>
                    <td style={td(true)}>{ent(b.consultas)}</td>
                    <td style={td(true)}>{ent(b.clientes)}</td>
                  </tr>
                ))}
              </Tabla>
            </Seccion>

            {/* 02 · AML y KYT  ·  03 · Por mes */}
            <div className="ru-dos">
              <Seccion n="02" titulo="AML y KYT" icono={<ScanSearch size={15} />}
                nota="Una consulta comprada sirve igual para las dos: aquí va cuántas se usaron de cada una, no pesos.">
                {(['aml', 'kyt'] as const).map(k => {
                  const n = k === 'aml' ? Number(t.usadasAml ?? 0) : Number(t.usadasKyt ?? 0);
                  return (
                    <div key={k} style={{ padding: '10px 0', borderTop: k === 'kyt' ? `1px solid ${C.borde}` : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{k === 'aml' ? 'AML · personas y empresas' : 'KYT · wallets'}</span>
                        <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{ent(n)} <span style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>{pct(n, totalUsadas)}</span></span>
                      </div>
                      <span style={{ display: 'block', marginTop: 7, height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.06)' }}>
                        <span style={{ display: 'block', height: 6, borderRadius: 99, background: k === 'aml' ? C.verde : '#A3E9BD', width: totalUsadas > 0 ? `${Math.round(n / totalUsadas * 100)}%` : '0%' }} />
                      </span>
                    </div>
                  );
                })}
                <p style={{ margin: '8px 0 0', fontSize: 12, color: C.sub }}>
                  Vendidas en el período: <b style={{ color: C.texto }}>{ent(t.consultasVendidas)}</b> · usadas: <b style={{ color: C.texto }}>{ent(totalUsadas)}</b>
                </p>
              </Seccion>

              <Seccion n="03" titulo="Por mes" icono={<RefreshCw size={15} />}>
                {(d.porMes ?? []).length === 0
                  ? <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>Sin movimientos en el período.</p>
                  : (
                    <Tabla ancho={340} cab={[{ t: 'Mes' }, { t: 'Ingresos', der: true }, { t: 'Compras', der: true }, { t: 'AML', der: true }, { t: 'KYT', der: true }]}>
                      {(d.porMes ?? []).map((m: any) => (
                        <tr key={m.mes} className="ru-fila">
                          <td style={td(false, true)}>{nombreMes(m.mes)}</td>
                          <td style={td(true, m.total > 0)}>{cop(m.total)}</td>
                          <td style={td(true)}>{ent(m.compras)}</td>
                          <td style={td(true)}>{ent(m.usadasAml)}</td>
                          <td style={td(true)}>{ent(m.usadasKyt)}</td>
                        </tr>
                      ))}
                    </Tabla>
                  )}
              </Seccion>
            </div>

            {/* 04 · Por cliente */}
            <Seccion n="04" titulo="Por cliente" icono={<Users size={15} />}
              nota="Lo que pagó cada cliente, de qué bolsillo, y cuántas consultas usó de AML y de KYT. Ordenado por lo que pagó.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, background: C.base, border: `1px solid ${C.borde2}`, borderRadius: 10, padding: '0 11px', maxWidth: 360 }}>
                <Search size={14} style={{ color: C.sub, flexShrink: 0 }} />
                <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar cliente o correo…"
                  style={{ flex: 1, minWidth: 0, background: C.base, border: 'none', outline: 'none', color: C.texto, fontSize: 13, padding: '9px 0', fontFamily: 'inherit' }} />
              </div>
              {clientes.length === 0
                ? <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>{buscar ? 'Ningún cliente coincide.' : 'Sin clientes en el período.'}</p>
                : (
                  <Tabla cab={[{ t: 'Cliente' }, { t: 'Pagó', der: true }, { t: 'De qué bolsillo' }, { t: 'Compradas', der: true }, { t: 'AML', der: true }, { t: 'KYT', der: true }, { t: 'A mano', der: true }, { t: 'Saldo hoy', der: true }]}>
                    {clientes.map(c => (
                      <tr key={c.userId} className="ru-fila">
                        <td style={{ ...td(false, true), whiteSpace: 'normal', minWidth: 180 }}>
                          <span style={{ display: 'block' }}>{c.cliente}</span>
                          {c.email && <span style={{ display: 'block', fontSize: 11, color: C.tenue, fontWeight: 500 }}>{c.email}</span>}
                        </td>
                        <td style={td(true, c.total > 0)}>{cop(c.total)}</td>
                        <td style={{ ...td(), whiteSpace: 'normal', minWidth: 160 }}>
                          {Object.keys(c.porBolsillo ?? {}).length === 0 ? <span style={{ color: C.tenue }}>—</span>
                            : Object.entries(c.porBolsillo).map(([b, v]) => (
                              <span key={b} style={{ display: 'inline-block', margin: '0 5px 4px 0', fontSize: 11, fontWeight: 600, color: C.texto, border: `1px solid ${C.borde2}`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                                {nombreBolsillo(b)} {cop(Number(v))}
                              </span>
                            ))}
                        </td>
                        <td style={td(true)}>{ent(c.consultas)}</td>
                        <td style={td(true, c.usadasAml > 0)}>{ent(c.usadasAml)}</td>
                        <td style={td(true, c.usadasKyt > 0)}>{ent(c.usadasKyt)}</td>
                        <td style={td(true)}>{c.ajustes ? ent(c.ajustes) : '—'}</td>
                        <td style={td(true)}>{ent(c.saldoHoy)}</td>
                      </tr>
                    ))}
                  </Tabla>
                )}
            </Seccion>

            {/* 05 · Compras */}
            <Seccion n="05" titulo="Compras" icono={<Download size={15} />}
              nota={d.comprasTruncadas ? 'Se muestran las 2.000 más recientes; el Excel trae las mismas.' : 'Cada compra de paquete, la más reciente primero.'}>
              {(d.compras ?? []).length === 0
                ? <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>Sin compras en el período.</p>
                : (
                  <>
                    <Tabla cab={[{ t: 'Fecha' }, { t: 'Cliente' }, { t: 'Bolsillo' }, { t: 'Consultas', der: true }, { t: 'Precio', der: true }, { t: 'IVA', der: true }, { t: 'Total', der: true }]}>
                      {(d.compras ?? []).slice(0, verCompras).map((c: any) => (
                        <tr key={c.id} className="ru-fila">
                          <td style={td()}>{fecha(c.at)}</td>
                          <td style={{ ...td(false, true), whiteSpace: 'normal', minWidth: 160 }}>{c.cliente}{c.por ? <span style={{ display: 'block', fontSize: 11, color: C.tenue, fontWeight: 500 }}>Compró: {c.por}</span> : null}</td>
                          <td style={td()}>{c.bolsilloNombre}</td>
                          <td style={td(true)}>{ent(c.cantidad)}</td>
                          <td style={td(true)}>{cop(c.precioUnit)}</td>
                          <td style={td(true)}>{cop(c.iva)}</td>
                          <td style={td(true, true)}>{cop(c.total)}</td>
                        </tr>
                      ))}
                    </Tabla>
                    {(d.compras ?? []).length > verCompras && (
                      <button onClick={() => setVerCompras(v => v + 100)}
                        style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: C.verde, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Ver más ({ent((d.compras ?? []).length - verCompras)} restantes)
                      </button>
                    )}
                  </>
                )}
            </Seccion>
          </div>
        )}
      </div>
    </div>
  , document.body);
};
