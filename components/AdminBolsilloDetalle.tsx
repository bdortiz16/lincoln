// Detalle de la Billetera al tocar una tarjeta (23 nov, pedido del dueño):
// "al darle clic en los bolsillos debe mostrar en dónde está comprometido el
// saldo, una ventana, y lo mismo en Lincoin utilidades".
//
//  · BolsilloDetalle: de qué clientes es el saldo "comprometido" de una bolsa
//    (Mouv, Finity, Coinsenda Jero o Kaupaloki). Es la suma de sus saldos en
//    ese riel: la plata que la bolsa del proveedor tiene que cubrir.
//  · LincoinUtilidadesDetalle: cómo se arma la parte de Lincoin en cada bolsa
//    (apertura + utilidad de los cargues + de los cierres OTC − retiros ±
//    movimientos externos), y cada operación que la movió.
//
// Van en un portal sobre <body>: dentro de la Billetera un contenedor animado
// recortaba las ventanas (mismo caso que el reporte de AML y KYT).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, RefreshCw, Search, ChevronRight, ArrowLeft } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { descargarXlsx, type CeldaX } from '../lib/xlsx';

const C = {
  base: '#070808', carbon: '#0C0E0D', elevado: '#121413', texto: '#F4F4F2', sub: '#878E88',
  tenue: 'rgba(244,244,242,0.45)', borde: 'rgba(255,255,255,0.08)', borde2: 'rgba(255,255,255,0.12)', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24',
};
const cop = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CO')}`;
const fechaCorta = (d: string | null | undefined) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const hoy = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const ROL: Record<string, string> = { business: 'Empresa', operador: 'Operador', operator: 'Operador', contador: 'Contador', persona: 'Persona', user: 'Usuario' };

// ── El marco común de las dos ventanas ──
const Ventana: React.FC<{ titulo: React.ReactNode; sub: string; onCerrar: () => void; acciones?: React.ReactNode; children: React.ReactNode }> = ({ titulo, sub, onCerrar, acciones, children }) => {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);
  return createPortal(
    <div role="dialog" aria-modal="true" onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(4,5,5,0.78)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', overflowY: 'auto', fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 1080, margin: '24px auto', padding: '0 16px', boxSizing: 'border-box' }}>
        <div style={{ borderRadius: 18, border: `1px solid ${C.borde2}`, padding: '18px 20px', color: C.texto,
          background: 'radial-gradient(circle at 92% 0%, rgba(74,222,128,0.12), transparent 40%), linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)' }}>
          {/* Con varios botones, en celular bajan a su fila: si no, el título
              quedaba de una palabra por línea. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: C.sub, textTransform: 'uppercase' }}>Billetera · detalle</p>
              <h2 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>{titulo}</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>{sub}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
              {acciones}
              <button type="button" onClick={onCerrar} aria-label="Cerrar"
                style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.borde2}`, background: 'transparent', color: C.sub, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
};

const Kpi: React.FC<{ rotulo: string; valor: string; pie?: string; color?: string }> = ({ rotulo, valor, pie, color }) => (
  <div style={{ background: C.carbon, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '14px 16px', minWidth: 0 }}>
    <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: C.sub, textTransform: 'uppercase' }}>{rotulo}</p>
    <p style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px', color: color ?? C.texto, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valor}</p>
    {pie && <p style={{ margin: '3px 0 0', fontSize: 11.5, color: C.sub }}>{pie}</p>}
  </div>
);

const Caja: React.FC<{ titulo: string; sub?: string; der?: React.ReactNode; children: React.ReactNode }> = ({ titulo, sub, der, children }) => (
  <div style={{ background: C.carbon, border: `1px solid ${C.borde}`, borderRadius: 16, padding: '16px 18px' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.texto }}>{titulo}</p>
        {sub && <p style={{ margin: '3px 0 0', fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{sub}</p>}
      </div>
      {der}
    </div>
    {children}
  </div>
);

const BOTON: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' };
const TH: React.CSSProperties = { padding: '8px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: C.sub, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borde}` };
const TD: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: C.texto, borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' };
const NUM: React.CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

const Buscador: React.FC<{ valor: string; onCambio: (v: string) => void; placeholder: string }> = ({ valor, onCambio, placeholder }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 11px', borderRadius: 10, border: `1px solid ${C.borde2}`, background: C.base, minWidth: 220 }}>
    <Search size={14} style={{ color: C.sub, flexShrink: 0 }} />
    <input value={valor} onChange={e => onCambio(e.target.value)} placeholder={placeholder}
      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.texto, fontSize: 12.5, fontFamily: 'inherit', minWidth: 0 }} />
  </label>
);

// ═════════════════════════════════════════════════════════════
// 1) Un bolsillo: de quién es el saldo comprometido.
// ═════════════════════════════════════════════════════════════
export const BolsilloDetalle: React.FC<{ riel: string; nombre: string; bolsa: number | null; onCerrar: () => void }> = ({ riel, nombre, bolsa, onCerrar }) => {
  const [d, setD] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');
  // El cliente abierto: sus movimientos en este bolsillo (24 nov, el dueño:
  // "al seleccionar la empresa debe salir los cargues para verificar que sí
  // estén bien").
  const [sel, setSel] = useState<{ userId: string; cliente: string; email: string | null; saldo: number } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await pedirAdmin({ action: 'bolsillo_detalle', riel });
    setD(r);
    setCargando(false);
  }, [riel]);
  useEffect(() => { cargar(); }, [cargar]);

  const clientes: any[] = d?.ok ? d.clientes ?? [] : [];
  const total = Number(d?.total ?? 0);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? clientes.filter(c => `${c.cliente} ${c.email ?? ''}`.toLowerCase().includes(t)) : clientes;
  }, [clientes, q]);
  const maximo = clientes.reduce((m, c) => Math.max(m, Math.abs(c.saldo)), 0) || 1;
  const disponible = bolsa != null ? bolsa - total : null;

  const excel = () => {
    const filas: CeldaX[][] = [
      ['Cliente', 'Correo', 'Tipo', 'Saldo', '% del comprometido', 'Bloqueado'],
      ...clientes.map(c => [c.cliente, c.email ?? '', ROL[c.rol] ?? c.rol ?? '', { v: c.saldo, s: 'cop' }, { v: total ? c.saldo / total : 0, s: 'pct' }, c.bloqueado ? 'Sí' : ''] as CeldaX[]),
      [{ v: 'Total comprometido', s: 'totalTexto' }, '', '', { v: total, s: 'totalCop' }, { v: 1, s: 'totalPct' }, ''],
    ];
    descargarXlsx(`lincoin-comprometido-${nombre.toLowerCase().replace(/\s+/g, '-')}-${hoy()}.xlsx`, [
      { nombre: 'Comprometido', filas, anchos: [36, 32, 14, 18, 18, 12] },
    ]);
  };

  if (sel) return <MovimientosBolsillo riel={riel} nombre={nombre} cliente={sel} onVolver={() => setSel(null)} onCerrar={onCerrar} />;

  return (
    <Ventana titulo={<>{nombre} · saldo comprometido</>} onCerrar={onCerrar}
      sub="De quién es el saldo que esta bolsa tiene que cubrir: la suma de lo que cada cliente tiene en este bolsillo. Lo que sobra es de Lincoin."
      acciones={<>
        <button type="button" onClick={cargar} disabled={cargando} style={{ ...BOTON, background: 'transparent', border: `1px solid ${C.borde2}`, color: C.texto, opacity: cargando ? 0.6 : 1 }}>
          <RefreshCw size={14} className={cargando ? 'animate-spin' : undefined} /> Actualizar
        </button>
        <button type="button" onClick={excel} disabled={!clientes.length} style={{ ...BOTON, background: C.verde, border: 'none', color: '#0C0E0D', opacity: clientes.length ? 1 : 0.5 }}>
          <Download size={14} /> Excel
        </button>
      </>}>
      {cargando && !d && <p style={{ color: C.sub, fontSize: 13 }}>Cargando…</p>}
      {d && !d.ok && <p style={{ color: C.rojo, fontSize: 13 }}>{d.error ?? 'No se pudo leer el bolsillo.'}</p>}
      {d?.ok && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <Kpi rotulo="Bolsa en el proveedor" valor={bolsa != null ? cop(bolsa) : '—'} pie="Lo que hay hoy en la cuenta" />
            <Kpi rotulo="Comprometido" valor={cop(total)} pie={`${d.cantidad} ${d.cantidad === 1 ? 'cliente' : 'clientes'} con saldo`} />
            <Kpi rotulo={disponible != null && disponible < 0 ? 'Faltante' : 'Disponible'} valor={disponible != null ? cop(disponible) : '—'}
              color={disponible != null && disponible < 0 ? C.rojo : C.verde}
              pie={disponible != null && disponible < 0 ? 'La bolsa no cubre lo que se les debe' : 'Bolsa − comprometido'} />
          </div>
          {d.negativos > 0 && (
            <p style={{ margin: 0, fontSize: 12.5, color: C.ambar }}>
              {d.negativos} {d.negativos === 1 ? 'cliente tiene' : 'clientes tienen'} saldo negativo en este bolsillo: restan del comprometido. Revísalos.
            </p>
          )}
          <Caja titulo="Clientes con saldo en este bolsillo" sub="Ordenados de mayor a menor saldo. Toca un cliente para ver sus cargues y movimientos en este bolsillo y comprobar su saldo."
            der={<Buscador valor={q} onCambio={setQ} placeholder="Buscar cliente o correo" />}>
            {filtrados.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>{clientes.length ? 'Ningún cliente coincide con la búsqueda.' : 'Ningún cliente tiene saldo en este bolsillo.'}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={TH}>Cliente</th><th style={TH}>Tipo</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Saldo</th><th style={{ ...TH, textAlign: 'right' }}>% del comprometido</th>
                  </tr></thead>
                  <tbody>
                    {filtrados.map(c => (
                      <tr key={c.userId} onClick={() => setSel({ userId: c.userId, cliente: c.cliente, email: c.email ?? null, saldo: Number(c.saldo) || 0 })}
                        title="Ver los cargues y movimientos de este cliente en este bolsillo"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                        <td style={TD}>
                          <span style={{ fontWeight: 700 }}>{c.cliente}</span>
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: C.verde, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2 }}>Ver movimientos <ChevronRight size={12} /></span>
                          {c.bloqueado && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: C.rojo }}>BLOQUEADO</span>}
                          <span style={{ display: 'block', fontSize: 11, color: C.tenue }}>{c.email ?? ''}</span>
                          <span style={{ display: 'block', marginTop: 5, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.06)', maxWidth: 220 }}>
                            <span style={{ display: 'block', height: 3, borderRadius: 3, width: `${Math.max(2, Math.abs(c.saldo) / maximo * 100)}%`, background: c.saldo < 0 ? C.rojo : C.verde }} />
                          </span>
                        </td>
                        <td style={{ ...TD, color: C.sub }}>{ROL[c.rol] ?? c.rol ?? '—'}</td>
                        <td style={{ ...NUM, fontWeight: 700, color: c.saldo < 0 ? C.rojo : C.texto }}>{cop(c.saldo)}</td>
                        <td style={{ ...NUM, color: C.sub }}>{total ? (Math.abs(c.saldo / total * 100) < 0.05 ? '0 %' : `${(c.saldo / total * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td style={{ ...TD, fontWeight: 800 }} colSpan={2}>Total comprometido</td>
                    <td style={{ ...NUM, fontWeight: 800 }}>{cop(total)}</td>
                    <td style={{ ...NUM, color: C.sub }}>100 %</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </Caja>
        </>
      )}
    </Ventana>
  );
};

// ═════════════════════════════════════════════════════════════
// 1b) Un cliente en un bolsillo: sus cargues y movimientos, y si cuadran.
// ═════════════════════════════════════════════════════════════
// El dueño (24 nov) sentía que un cierre OTC de 69 millones no se le había
// sumado a una empresa en Finity, y no había cómo comprobarlo: el detalle del
// bolsillo solo decía el saldo. Aquí sale cada movimiento que tocó ese
// bolsillo con lo que sumó o restó (el servidor decide el efecto, igual que
// cuando se movió la plata) y el saldo acumulado; arriba, la suma de todos
// contra el saldo guardado. Si no cuadran, la diferencia es plata que se
// movió sin dejar un movimiento (o al revés), y se ve cuánta es.
const CLASE: Record<string, { l: string; c: string }> = {
  cargue: { l: 'Cargue', c: C.verde }, otc: { l: 'Cierre OTC', c: C.verde }, recaudo: { l: 'Recaudo', c: C.verde },
  ajuste: { l: 'Ajuste', c: C.ambar }, envio: { l: 'Envío', c: C.rojo }, conversion: { l: 'Conversión', c: C.texto },
  traslado: { l: 'Entre cuentas', c: C.texto }, otro: { l: 'Otro', c: C.sub },
};
type Filtro = 'todos' | 'cargues' | 'entradas' | 'salidas';

const MovimientosBolsillo: React.FC<{ riel: string; nombre: string; cliente: { userId: string; cliente: string; email: string | null; saldo: number }; onVolver: () => void; onCerrar: () => void }> = ({ riel, nombre, cliente, onVolver, onCerrar }) => {
  const [d, setD] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [verSinEfecto, setVerSinEfecto] = useState(false);
  const [q, setQ] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setD(await pedirAdmin({ action: 'bolsillo_cliente', riel, userId: cliente.userId }));
    setCargando(false);
  }, [riel, cliente.userId]);
  useEffect(() => { cargar(); }, [cargar]);

  // El saldo acumulado se arma del más viejo al más nuevo con lo que movió
  // cada uno; la tabla va del más nuevo al más viejo.
  const filas: any[] = useMemo(() => {
    const movs: any[] = d?.ok ? [...(d.movimientos ?? [])] : [];
    movs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || String(a.id).localeCompare(String(b.id)));
    let acum = 0;
    const conSaldo = movs.map(m => { acum += Number(m.efecto) || 0; return { ...m, despues: acum }; });
    return conSaldo.reverse();
  }, [d]);
  const vista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas.filter(m => {
      const ef = Number(m.efecto) || 0;
      if (!verSinEfecto && !ef) return false;
      if (filtro === 'cargues' && !['cargue', 'otc', 'recaudo', 'ajuste'].includes(m.clase)) return false;
      if (filtro === 'entradas' && !(ef > 0)) return false;
      if (filtro === 'salidas' && !(ef < 0)) return false;
      return !t || `${m.titulo ?? ''} ${m.detalle ?? ''} ${m.ref ?? ''} ${m.estado ?? ''}`.toLowerCase().includes(t);
    });
  }, [filas, filtro, verSinEfecto, q]);

  const guardado = d?.ok ? Number(d.saldoGuardado ?? cliente.saldo) : cliente.saldo;
  const suma = d?.ok ? Number(d.suma ?? 0) : 0;
  const dif = Math.round((guardado - suma) * 100) / 100;
  const cuadra = Math.abs(dif) < 1;
  const entradas = filas.reduce((a, m) => a + Math.max(0, Number(m.efecto) || 0), 0);
  const salidas = filas.reduce((a, m) => a + Math.min(0, Number(m.efecto) || 0), 0);
  const sinEfecto = filas.filter(m => !(Number(m.efecto) || 0)).length;

  const excel = () => {
    const hoja: CeldaX[][] = [
      ['Fecha', 'Tipo', 'Movimiento', 'Detalle', 'Estado', 'Entra', 'Sale', 'Saldo después', 'Nota', 'Id'],
      ...filas.map(m => {
        const ef = Number(m.efecto) || 0;
        return [new Date(m.at), CLASE[m.clase]?.l ?? m.clase, m.titulo ?? '', [m.ref, m.detalle].filter(Boolean).join(' · '), m.estado ?? '',
          ef > 0 ? { v: ef, s: 'cop' } : '', ef < 0 ? { v: -ef, s: 'cop' } : '', { v: m.despues, s: 'cop' }, m.nota ?? '', String(m.id)] as CeldaX[];
      }),
      [{ v: 'Suma de los movimientos', s: 'totalTexto' }, '', '', '', '', { v: entradas, s: 'totalCop' }, { v: -salidas, s: 'totalCop' }, { v: suma, s: 'totalCop' }, '', ''],
      [{ v: 'Saldo guardado', s: 'totalTexto' }, '', '', '', '', '', '', { v: guardado, s: 'totalCop' }, '', ''],
      [{ v: 'Diferencia (guardado − suma)', s: 'totalTexto' }, '', '', '', '', '', '', { v: dif, s: 'totalCop' }, '', ''],
    ];
    const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);
    descargarXlsx(`lincoin-${slug(nombre)}-${slug(cliente.cliente)}-${hoy()}.xlsx`, [
      { nombre: 'Movimientos', filas: hoja, anchos: [20, 14, 34, 40, 14, 16, 16, 18, 40, 38] },
    ]);
  };

  const CHIP = (k: Filtro, l: string) => (
    <button key={k} type="button" onClick={() => setFiltro(k)}
      style={{ height: 30, padding: '0 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
        border: `1px solid ${filtro === k ? C.texto : C.borde2}`, background: filtro === k ? C.texto : 'transparent', color: filtro === k ? '#0C0E0D' : C.texto }}>
      {l}
    </button>
  );

  return (
    <Ventana titulo={<>{cliente.cliente} · {nombre}</>} onCerrar={onCerrar}
      sub={`Cada cargue y movimiento que tocó este bolsillo, con lo que sumó o restó y el saldo que quedó después. Arriba, si la suma cuadra con el saldo guardado.${cliente.email ? ` · ${cliente.email}` : ''}`}
      acciones={<>
        <button type="button" onClick={onVolver} style={{ ...BOTON, background: 'transparent', border: `1px solid ${C.borde2}`, color: C.texto }}>
          <ArrowLeft size={14} /> Clientes
        </button>
        <button type="button" onClick={cargar} disabled={cargando} style={{ ...BOTON, background: 'transparent', border: `1px solid ${C.borde2}`, color: C.texto, opacity: cargando ? 0.6 : 1 }}>
          <RefreshCw size={14} className={cargando ? 'animate-spin' : undefined} /> Actualizar
        </button>
        <button type="button" onClick={excel} disabled={!filas.length} style={{ ...BOTON, background: C.verde, border: 'none', color: '#0C0E0D', opacity: filas.length ? 1 : 0.5 }}>
          <Download size={14} /> Excel
        </button>
      </>}>
      {cargando && !d && <p style={{ color: C.sub, fontSize: 13 }}>Trayendo los movimientos…</p>}
      {d && !d.ok && <p style={{ color: C.rojo, fontSize: 13 }}>{d.error ?? 'No se pudieron leer los movimientos.'}</p>}
      {d?.ok && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <Kpi rotulo="Saldo guardado" valor={cop(guardado)} pie={`Lo que tiene hoy en ${nombre}`} />
            <Kpi rotulo="Suma de los movimientos" valor={cop(suma)} pie={`Entró ${cop(entradas)} · salió ${cop(-salidas)}`} />
            <Kpi rotulo={cuadra ? 'Cuadra' : 'Diferencia'} valor={cuadra ? 'Sí' : cop(dif)} color={cuadra ? C.verde : C.ambar}
              pie={cuadra ? 'El saldo es la suma de sus movimientos' : dif > 0 ? 'El saldo tiene más que la suma de sus movimientos' : 'El saldo tiene menos que la suma de sus movimientos'} />
          </div>
          {!cuadra && (
            <p style={{ margin: 0, fontSize: 12.5, color: C.ambar, lineHeight: 1.55 }}>
              La diferencia es plata que entró o salió de este bolsillo sin un movimiento que la explique (o un movimiento que no la movió).
              Revisa los cargues y ajustes cerca de cuando empezó el descuadre: la columna «Saldo después» muestra el saldo que dan los movimientos en cada momento.
            </p>
          )}
          {d.inciertos > 0 && (
            <p style={{ margin: 0, fontSize: 12.5, color: C.ambar }}>
              {d.inciertos} {d.inciertos === 1 ? 'movimiento está marcado' : 'movimientos están marcados'} como incierto (un crédito o una devolución sin confirmar): la suma los toma como quedaron registrados.
            </p>
          )}
          {d.operador && <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>Es un operador: cuando le falta saldo para un envío, se cubre desde su Saldo Lincoin u otra cuenta sin un movimiento aparte. Una diferencia puede venir de ahí.</p>}
          {d.comprasLeidas === false && <p style={{ margin: 0, fontSize: 12.5, color: C.ambar }}>No se pudieron leer sus compras de consultas AML y KYT: si pagó alguna con este saldo, falta en la suma.</p>}
          {d.truncado && <p style={{ margin: 0, fontSize: 12.5, color: C.ambar }}>El historial pasa del tope que se lee de una vez: la suma no incluye los movimientos más viejos.</p>}
          <Caja titulo={`Movimientos en ${nombre} · ${vista.length}`}
            sub={`Del más reciente al más viejo.${sinEfecto ? ` ${sinEfecto} ${sinEfecto === 1 ? 'movimiento no movió' : 'movimientos no movieron'} este saldo (rechazados, devueltos, solo registro…).` : ''}`}
            der={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {CHIP('todos', 'Todos')}{CHIP('cargues', 'Cargues')}{CHIP('entradas', 'Entradas')}{CHIP('salidas', 'Salidas')}
              {sinEfecto > 0 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
                  <input type="checkbox" checked={verSinEfecto} onChange={e => setVerSinEfecto(e.target.checked)} /> Ver los que no movieron saldo
                </label>
              )}
              <Buscador valor={q} onCambio={setQ} placeholder="Referencia, beneficiario o nota" />
            </div>}>
            {vista.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>Sin movimientos para mostrar.</p> : (
              <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead style={{ position: 'sticky', top: 0, background: C.carbon }}><tr>
                    <th style={TH}>Fecha</th><th style={TH}>Movimiento</th><th style={TH}>Estado</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Entra</th><th style={{ ...TH, textAlign: 'right' }}>Sale</th><th style={{ ...TH, textAlign: 'right' }}>Saldo después</th>
                  </tr></thead>
                  <tbody>
                    {vista.map(m => {
                      const ef = Number(m.efecto) || 0;
                      const cl = CLASE[m.clase] ?? CLASE.otro;
                      return (
                        <tr key={m.id} style={{ opacity: ef ? 1 : 0.55 }}>
                          <td style={{ ...TD, color: C.sub, whiteSpace: 'nowrap' }}>{fechaCorta(m.at)}</td>
                          <td style={TD}>
                            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 999, border: `1px solid ${cl.c}59`, color: cl.c, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{cl.l}</span>
                            <span style={{ marginLeft: 7, fontWeight: 700 }}>{m.titulo}</span>
                            {(m.detalle || m.ref) && <span style={{ display: 'block', fontSize: 11, color: C.tenue, marginTop: 2 }}>{[m.ref, m.detalle].filter(Boolean).join(' · ')}</span>}
                            {m.nota && <span style={{ display: 'block', fontSize: 11, color: !ef || m.incierto ? C.ambar : C.tenue, marginTop: 2 }}>{m.nota}</span>}
                          </td>
                          <td style={{ ...TD, color: C.sub, whiteSpace: 'nowrap' }}>{m.estado ?? '—'}</td>
                          <td style={{ ...NUM, color: C.verde, fontWeight: 700 }}>{ef > 0 ? `+${cop(ef)}` : ''}</td>
                          <td style={{ ...NUM, color: C.rojo, fontWeight: 700 }}>{ef < 0 ? `−${cop(-ef)}` : ''}</td>
                          <td style={{ ...NUM, color: m.despues < 0 ? C.rojo : C.texto }}>{cop(m.despues)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Caja>
        </>
      )}
    </Ventana>
  );
};

// ═════════════════════════════════════════════════════════════
// 2) Lincoin · utilidades: cómo se arma, por bolsa y por operación.
// ═════════════════════════════════════════════════════════════
const TIPO_OP: Record<string, { l: string; c: string }> = {
  cargue: { l: 'Cargue', c: C.texto }, otc: { l: 'Cierre OTC', c: C.texto },
  retiro: { l: 'Retiro', c: C.rojo }, egreso: { l: 'Egreso', c: C.rojo }, ingreso: { l: 'Ingreso', c: C.verde }, aporte: { l: 'Aporte', c: C.verde },
};

export const LincoinUtilidadesDetalle: React.FC<{ onCerrar: () => void; nombreBolsa: (p: string) => string }> = ({ onCerrar, nombreBolsa }) => {
  const [d, setD] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [bolsa, setBolsa] = useState<string>('todas');
  const [q, setQ] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setD(await pedirAdmin({ action: 'lincoin_utilidades_detalle' }));
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const provs: any[] = d?.ok ? (d.proveedores ?? []).filter((p: any) => p.apertura) : [];
  const fila = (p: any) => {
    const otc = Number(p.otcDesdeApertura ?? 0);
    return { nombre: nombreBolsa(p.proveedor), proveedor: p.proveedor, apertura: Number(p.apertura?.lincoin ?? 0), cargues: Number(p.utilidadDesdeApertura ?? 0) - otc, otc, retiros: Number(p.retirosDesdeApertura ?? 0), externos: Number(p.externosDesdeApertura ?? 0), esperado: Number(p.lincoinEsperado ?? 0), desde: p.apertura?.at ?? null };
  };
  const filas = provs.map(fila);
  const tot = filas.reduce((a, f) => ({ apertura: a.apertura + f.apertura, cargues: a.cargues + f.cargues, otc: a.otc + f.otc, retiros: a.retiros + f.retiros, externos: a.externos + f.externos, esperado: a.esperado + f.esperado }),
    { apertura: 0, cargues: 0, otc: 0, retiros: 0, externos: 0, esperado: 0 });

  const ops: any[] = d?.ok ? d.ops ?? [] : [];
  const sinTasa: any[] = d?.ok ? d.sinTasa ?? [] : [];
  const opsVista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ops.filter(o => (bolsa === 'todas' || o.proveedor === bolsa)
      && (!t || `${o.cliente ?? ''} ${o.ref ?? ''} ${o.descripcion ?? ''}`.toLowerCase().includes(t)));
  }, [ops, bolsa, q]);
  const sumaVista = opsVista.reduce((a, o) => a + Number(o.utilidad || 0), 0);

  const excel = () => {
    const resumen: CeldaX[][] = [
      ['Bolsa', 'Apertura (de Lincoin)', '+ Utilidad cargues', '+ Utilidad cierres OTC', '− Retiros', '± Externos', '= Lincoin esperado', 'Desde'],
      ...filas.map(f => [f.nombre, { v: f.apertura, s: 'cop' }, { v: f.cargues, s: 'cop' }, { v: f.otc, s: 'cop' }, { v: f.retiros, s: 'cop' }, { v: f.externos, s: 'cop' }, { v: f.esperado, s: 'cop' }, f.desde ? new Date(f.desde) : ''] as CeldaX[]),
      [{ v: 'Total', s: 'totalTexto' }, { v: tot.apertura, s: 'totalCop' }, { v: tot.cargues, s: 'totalCop' }, { v: tot.otc, s: 'totalCop' }, { v: tot.retiros, s: 'totalCop' }, { v: tot.externos, s: 'totalCop' }, { v: tot.esperado, s: 'totalCop' }, ''],
    ];
    const hojaOps: CeldaX[][] = [
      ['Fecha', 'Tipo', 'Bolsa', 'Cliente / descripción', 'Referencia', 'Monto', 'Utilidad para Lincoin', 'Tasa cliente', 'Tasa de venta'],
      ...ops.map(o => [new Date(o.at), TIPO_OP[o.tipo]?.l ?? o.tipo, nombreBolsa(o.proveedor), o.cliente ?? o.descripcion ?? '', o.ref ?? '', { v: o.monto, s: 'cop' }, { v: o.utilidad, s: 'cop' }, o.tasaCliente ?? '', o.tasaVenta ?? ''] as CeldaX[]),
    ];
    const hojaSin: CeldaX[][] = [
      ['Fecha', 'Cierre', 'Cliente', 'Bolsa', 'Acreditado (COP)', 'USDT', 'Tasa cliente'],
      ...sinTasa.map(o => [new Date(o.at), o.ref ?? '', o.cliente ?? '', nombreBolsa(o.proveedor), { v: o.monto, s: 'cop' }, o.usdt, o.tasaCliente ?? ''] as CeldaX[]),
    ];
    descargarXlsx(`lincoin-utilidades-${hoy()}.xlsx`, [
      { nombre: 'Por bolsa', filas: resumen, anchos: [22, 20, 18, 22, 14, 14, 20, 20] },
      { nombre: 'Operaciones', filas: hojaOps, anchos: [20, 14, 20, 36, 16, 16, 20, 14, 14] },
      { nombre: 'Cierres sin tasa', filas: hojaSin, anchos: [20, 16, 34, 20, 18, 12, 14] },
    ]);
  };

  const COLS = ['Apertura', '+ Cargues', '+ Cierres OTC', '− Retiros', '± Externos', '= Lincoin'];

  return (
    <Ventana onCerrar={onCerrar}
      titulo={<>Lincoin<span style={{ color: C.verde }}>.</span> · utilidades</>}
      sub="Lo que es de Lincoin en cada bolsa: con qué abrió la caja, lo que dejaron los cargues y los cierres de la mesa OTC, menos lo que se retiró, más o menos los movimientos externos."
      acciones={<>
        <button type="button" onClick={cargar} disabled={cargando} style={{ ...BOTON, background: 'transparent', border: `1px solid ${C.borde2}`, color: C.texto, opacity: cargando ? 0.6 : 1 }}>
          <RefreshCw size={14} className={cargando ? 'animate-spin' : undefined} /> Actualizar
        </button>
        <button type="button" onClick={excel} disabled={!d?.ok} style={{ ...BOTON, background: C.verde, border: 'none', color: '#0C0E0D', opacity: d?.ok ? 1 : 0.5 }}>
          <Download size={14} /> Excel
        </button>
      </>}>
      {cargando && !d && <p style={{ color: C.sub, fontSize: 13 }}>Cargando…</p>}
      {d && !d.ok && <p style={{ color: C.rojo, fontSize: 13 }}>{d.error ?? 'No se pudo leer la caja.'}</p>}
      {d?.ok && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <Kpi rotulo="Lincoin esperado" valor={cop(tot.esperado)} pie="Suma de las bolsas" color={tot.esperado < 0 ? C.rojo : C.texto} />
            <Kpi rotulo="Utilidad cargues" valor={cop(tot.cargues)} color={tot.cargues < 0 ? C.rojo : C.verde} />
            <Kpi rotulo="Utilidad cierres OTC" valor={cop(tot.otc)} color={tot.otc < 0 ? C.rojo : C.verde}
              pie={sinTasa.length ? `${sinTasa.length} ${sinTasa.length === 1 ? 'cierre' : 'cierres'} sin tasa de venta` : 'Con la tasa de venta de cada cierre'} />
            <Kpi rotulo="Retiros" valor={cop(tot.retiros)} pie={tot.externos ? `Externos ${cop(tot.externos)}` : undefined} />
          </div>

          <Caja titulo="Por bolsa" sub="Cada bolsa cuenta desde su apertura de caja.">
            {filas.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>La caja todavía no se ha abierto.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Bolsa</th>{COLS.map(c => <th key={c} style={{ ...TH, textAlign: 'right' }}>{c}</th>)}</tr></thead>
                  <tbody>
                    {filas.map(f => (
                      <tr key={f.proveedor}>
                        <td style={TD}><span style={{ fontWeight: 700 }}>{f.nombre}</span><span style={{ display: 'block', fontSize: 11, color: C.tenue }}>desde {fechaCorta(f.desde)}</span></td>
                        <td style={NUM}>{cop(f.apertura)}</td>
                        <td style={{ ...NUM, color: f.cargues < 0 ? C.rojo : f.cargues > 0 ? C.verde : C.sub }}>{cop(f.cargues)}</td>
                        <td style={{ ...NUM, color: f.otc < 0 ? C.rojo : f.otc > 0 ? C.verde : C.sub }}>{cop(f.otc)}</td>
                        <td style={{ ...NUM, color: f.retiros ? C.rojo : C.sub }}>{f.retiros ? `−${cop(f.retiros)}` : cop(0)}</td>
                        <td style={{ ...NUM, color: C.sub }}>{cop(f.externos)}</td>
                        <td style={{ ...NUM, fontWeight: 800, color: f.esperado < 0 ? C.rojo : C.texto }}>{cop(f.esperado)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td style={{ ...TD, fontWeight: 800 }}>Total</td>
                    <td style={{ ...NUM, fontWeight: 800 }}>{cop(tot.apertura)}</td>
                    <td style={{ ...NUM, fontWeight: 800 }}>{cop(tot.cargues)}</td>
                    <td style={{ ...NUM, fontWeight: 800 }}>{cop(tot.otc)}</td>
                    <td style={{ ...NUM, fontWeight: 800 }}>{tot.retiros ? `−${cop(tot.retiros)}` : cop(0)}</td>
                    <td style={{ ...NUM, fontWeight: 800 }}>{cop(tot.externos)}</td>
                    <td style={{ ...NUM, fontWeight: 800 }}>{cop(tot.esperado)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </Caja>

          {sinTasa.length > 0 && (
            <Caja titulo={`Cierres OTC sin tasa de venta · ${sinTasa.length}`}
              sub="No suman a la utilidad: falta la tasa a la que se vendieron los USDT. Regístrala en Cierres OTC → el cierre → «Registrar tasa».">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Fecha</th><th style={TH}>Cierre</th><th style={TH}>Cliente</th><th style={TH}>Bolsa</th><th style={{ ...TH, textAlign: 'right' }}>Acreditado</th></tr></thead>
                  <tbody>
                    {sinTasa.map(o => (
                      <tr key={o.id}>
                        <td style={{ ...TD, color: C.sub, whiteSpace: 'nowrap' }}>{fechaCorta(o.at)}</td>
                        <td style={{ ...TD, fontFamily: 'ui-monospace, monospace' }}>{o.ref}</td>
                        <td style={TD}>{o.cliente}</td>
                        <td style={{ ...TD, color: C.sub }}>{nombreBolsa(o.proveedor)}</td>
                        <td style={NUM}>{cop(o.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Caja>
          )}

          <Caja titulo="Operaciones" sub="Cada cargue, cierre OTC y movimiento de Lincoin que movió la utilidad, del más reciente al más viejo."
            der={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {['todas', ...filas.map(f => f.proveedor)].map(p => (
                <button key={p} type="button" onClick={() => setBolsa(p)}
                  style={{ height: 30, padding: '0 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                    border: `1px solid ${bolsa === p ? C.texto : C.borde2}`, background: bolsa === p ? C.texto : 'transparent', color: bolsa === p ? '#0C0E0D' : C.texto }}>
                  {p === 'todas' ? 'Todas' : nombreBolsa(p)}
                </button>
              ))}
              <Buscador valor={q} onCambio={setQ} placeholder="Cliente, cierre o descripción" />
            </div>}>
            {opsVista.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>Sin operaciones para mostrar.</p> : (
              <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: C.carbon }}><tr>
                    <th style={TH}>Fecha</th><th style={TH}>Tipo</th><th style={TH}>Bolsa</th><th style={TH}>Cliente / descripción</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={{ ...TH, textAlign: 'right' }}>Utilidad</th>
                  </tr></thead>
                  <tbody>
                    {opsVista.map(o => (
                      <tr key={`${o.tipo}-${o.id}`}>
                        <td style={{ ...TD, color: C.sub, whiteSpace: 'nowrap' }}>{fechaCorta(o.at)}</td>
                        <td style={{ ...TD, whiteSpace: 'nowrap', color: TIPO_OP[o.tipo]?.c ?? C.texto, fontWeight: 700 }}>
                          {TIPO_OP[o.tipo]?.l ?? o.tipo}{o.ref ? <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: C.tenue, fontFamily: 'ui-monospace, monospace' }}>{o.ref}</span> : null}
                        </td>
                        <td style={{ ...TD, color: C.sub, whiteSpace: 'nowrap' }}>{nombreBolsa(o.proveedor)}</td>
                        <td style={TD}>
                          {o.cliente ?? o.descripcion ?? '—'}
                          {o.tipo === 'otc' && o.tasaVenta ? <span style={{ display: 'block', fontSize: 11, color: C.tenue }}>cliente {Number(o.tasaCliente).toLocaleString('es-CO', { maximumFractionDigits: 2 })} · vendido a {Number(o.tasaVenta).toLocaleString('es-CO', { maximumFractionDigits: 2 })}</span> : null}
                          {o.tipo === 'cargue' && o.sinContabilidad ? <span style={{ display: 'block', fontSize: 11, color: C.ambar }}>sin contabilidad: no suma utilidad</span> : null}
                        </td>
                        <td style={NUM}>{cop(o.monto)}</td>
                        <td style={{ ...NUM, fontWeight: 800, color: o.utilidad < 0 ? C.rojo : o.utilidad > 0 ? C.verde : C.sub }}>{o.utilidad > 0 ? '+' : ''}{cop(o.utilidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td style={{ ...TD, fontWeight: 800 }} colSpan={5}>Suma de lo que se ve{bolsa !== 'todas' ? ` · ${nombreBolsa(bolsa)}` : ''}</td>
                    <td style={{ ...NUM, fontWeight: 800, color: sumaVista < 0 ? C.rojo : C.verde }}>{sumaVista > 0 ? '+' : ''}{cop(sumaVista)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
            {d.opsTruncadas && <p style={{ margin: '8px 0 0', fontSize: 11.5, color: C.ambar }}>Se muestran las 3.000 más recientes; el Excel trae las mismas.</p>}
          </Caja>
        </>
      )}
    </Ventana>
  );
};
