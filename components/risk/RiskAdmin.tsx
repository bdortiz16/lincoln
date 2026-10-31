// Admin · Lincoin Risk Ventas. Tres vistas:
//   Resumen       → lo que importa de un vistazo: caja, cobertura, ventas y
//                   ganancia, con las acciones a la mano (reponer, ajustar).
//   Clientes      → buscar una empresa y abrir su detalle (movimientos,
//                   compras) con el ajuste ahí mismo.
//   Configuración → precio y reglas, con la vista previa de cómo lo ve el
//                   cliente. Nada fijo en el código.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { llamar, C, LBL, INP, BTN, BTN2, TARJETA, pesos } from './RiskCliente';

const n = (x: number) => Math.round(x).toLocaleString('es-CO');
const ESTILOS = `
@keyframes ra-entra { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes ra-panel { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }
.ra-entra { animation: ra-entra .25s ease-out both }
.ra-fila:hover { background: rgba(255,255,255,0.035) }
`;

const Panel: React.FC<{ titulo: string; abierto: boolean; cerrar: () => void; children: React.ReactNode }> = ({ titulo, abierto, cerrar, children }) => {
  useEffect(() => { if (!abierto) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && cerrar(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [abierto, cerrar]);
  if (!abierto) return null;
  return (
    <div onClick={cerrar} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(4,5,4,0.6)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={titulo} style={{ width: 'min(480px, 100vw)', height: '100%', background: C.fondo, borderLeft: `1px solid ${C.borde}`, display: 'flex', flexDirection: 'column', animation: 'ra-panel .22s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.borde}` }}>
          <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{titulo}</p>
          <button onClick={cerrar} aria-label="Cerrar" style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${C.borde}`, background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>{children}</div>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ l: string; v: React.ReactNode; c?: string; sub?: React.ReactNode }> = ({ l, v, c, sub }) => (
  <div className="ra-entra" style={{ ...TARJETA, padding: '16px 18px' }}>
    <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>{l}</p>
    <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.6px', margin: '6px 0 0', color: c ?? C.texto }}>{v}</p>
    {sub && <p style={{ fontSize: 12, color: C.tenue, margin: '4px 0 0' }}>{sub}</p>}
  </div>
);

// Barra de cobertura: caja disponible contra lo que los clientes ya pagaron.
const Cobertura: React.FC<{ disponibles: number; pendientes: number; minimoPct: number }> = ({ disponibles, pendientes, minimoPct }) => {
  const pct = pendientes ? Math.round((disponibles / pendientes) * 100) : null;
  const ok = pct === null || pct >= minimoPct;
  const ancho = pct === null ? 100 : Math.min(100, (pct / Math.max(minimoPct * 1.5, 1)) * 100);
  const marca = Math.min(100, (minimoPct / Math.max(minimoPct * 1.5, 1)) * 100);
  return (
    <div style={{ ...TARJETA, padding: '18px 20px', border: `1px solid ${ok ? 'rgba(255,255,255,0.10)' : 'rgba(248,113,113,0.4)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{ok ? 'La caja cubre lo vendido' : 'Hay que reponer la caja'}</p>
        <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>{pct === null ? 'Sin consultas pendientes de clientes' : `Cobertura ${pct}% · mínimo ${minimoPct}%`}</p>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 999, background: C.elevado, marginTop: 14, overflow: 'hidden' }}>
        <div style={{ width: `${ancho}%`, height: '100%', borderRadius: 999, background: ok ? C.verde : C.rojo, transition: 'width .5s ease' }} />
        <div title="Mínimo" style={{ position: 'absolute', top: -2, bottom: -2, left: `${marca}%`, width: 2, background: 'rgba(255,255,255,0.5)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
        <span><b style={{ color: C.texto }}>{n(disponibles)}</b> disponibles en caja</span>
        <span><b style={{ color: C.texto }}>{n(pendientes)}</b> pagadas por clientes sin usar</span>
      </div>
    </div>
  );
};

export const RiskAdmin: React.FC = () => {
  const [vista, setVista] = useState<'resumen' | 'clientes' | 'config'>('resumen');
  const [d, setD] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [toast, setToast] = useState<{ ok: boolean; t: string } | null>(null);
  const [panel, setPanel] = useState<null | 'proveedor' | { cliente: string }>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [buscar, setBuscar] = useState('');
  const [prov, setProv] = useState({ unidades: '', costoTotal: '', nota: '' });
  const [aj, setAj] = useState({ cantidad: '', motivo: '' });

  const [falla, setFalla] = useState<string | null>(null);
  // Sin la sesión con segundo factor la función responde 403: se dice, en
  // vez de quedarse en "Cargando…".
  const cargar = useCallback(async () => {
    const r = await llamar('admin_risk_resumen');
    if (!r?.ok) { setFalla(r?.error ?? r?.motivo ?? 'No se pudo cargar Lincoin Risk · Ventas.'); return; }
    setFalla(null); setD(r); setCfg((c: any) => c ?? r.config);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  const abrirCliente = async (uid: string) => { setPanel({ cliente: uid }); setCliente(await llamar('admin_risk_cliente', { cliente: uid })); };
  const cambiosPendientes = useMemo(() => d && cfg && JSON.stringify(cfg) !== JSON.stringify(d.config), [d, cfg]);

  if (falla) return <p style={{ color: C.rojo, padding: 20 }}>{falla}</p>;
  if (!d || !cfg) return <p style={{ color: C.sub, padding: 20 }}>Cargando…</p>;
  const precioCliente = Number(cfg.precioPorConsulta) || 0, ivaCliente = Number(cfg.ivaPct) || 0, minimo = Number(cfg.minimoCompra) || 0;
  const totalMinimo = Math.round(minimo * precioCliente * (1 + ivaCliente / 100));
  const margenUnit = precioCliente - (d.caja.costoUnit || 0);
  const clientes = d.clientes.filter((c: any) => !buscar || c.nombre.toLowerCase().includes(buscar.toLowerCase()));

  const registrarProveedor = async () => {
    const r = await llamar('admin_risk_compra_proveedor', { unidades: Number(prov.unidades), costoTotal: Number(prov.costoTotal), nota: prov.nota });
    if (!r?.ok) return setToast({ ok: false, t: r?.motivo ?? 'No se pudo registrar.' });
    setToast({ ok: true, t: `Caja repuesta: +${n(Number(prov.unidades))} consultas.` }); setProv({ unidades: '', costoTotal: '', nota: '' }); setPanel(null); cargar();
  };
  const ajustar = async (uid: string) => {
    const r = await llamar('admin_risk_ajuste', { cliente: uid, cantidad: Number(aj.cantidad), motivo: aj.motivo });
    if (!r?.ok) return setToast({ ok: false, t: r?.motivo ?? 'No se pudo ajustar.' });
    setToast({ ok: true, t: `Ajuste aplicado. Nuevo saldo: ${n(r.saldo)}.` }); setAj({ cantidad: '', motivo: '' }); abrirCliente(uid); cargar();
  };
  const guardar = async () => {
    const r = await llamar('admin_risk_config', { config: cfg });
    if (!r?.ok) return setToast({ ok: false, t: r?.motivo ?? 'No se pudo guardar.' });
    setToast({ ok: true, t: 'Configuración guardada. Los clientes ya ven el nuevo precio.' }); setD((x: any) => ({ ...x, config: r.config })); setCfg(r.config);
  };

  return (
    <div style={{ maxWidth: 1000, margin: '18px auto 60px', padding: '0 4px' }}>
      <style>{ESTILOS}</style>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.7px', margin: 0 }}>Lincoin Risk · Ventas</h1>
          <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>Caja de consultas, ventas a empresas y precio.</p>
        </div>
        <button onClick={() => setPanel('proveedor')} style={BTN}>+ Reponer caja</button>
      </div>

      <div role="tablist" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: C.elevado, border: `1px solid ${C.borde}`, margin: '20px 0 16px' }}>
        {([['resumen', 'Resumen'], ['clientes', `Clientes · ${d.clientes.length}`], ['config', 'Configuración']] as const).map(([k, t]) => (
          <button key={k} onClick={() => setVista(k)} style={{ padding: '7px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: vista === k ? '#F4F4F2' : 'transparent', color: vista === k ? '#15181A' : C.sub }}>
            {t}{k === 'config' && cambiosPendientes ? ' •' : ''}
          </button>
        ))}
      </div>

      {vista === 'resumen' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Cobertura disponibles={d.caja.disponibles} pendientes={d.pendientesClientes} minimoPct={cfg.avisoCajaCoberturaPct} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Kpi l="Ganancia" v={pesos(d.ventas.ganancia)} c={d.ventas.ganancia >= 0 ? C.verde : C.rojo} sub={`Ingresos ${pesos(d.ventas.ingresos)} − costo ${pesos(d.ventas.costoVendidas)}`} />
            <Kpi l="Consultas vendidas" v={n(d.ventas.vendidas)} sub={`${n(d.ventas.usadasClientes)} ya usadas`} />
            <Kpi l="Margen por consulta" v={pesos(margenUnit)} c={margenUnit >= 0 ? C.texto : C.rojo} sub={`Vendes a ${pesos(precioCliente)} · cuesta ${pesos(d.caja.costoUnit)}`} />
            <Kpi l="Caja" v={n(d.caja.disponibles)} sub={d.saldoSarblock != null ? `Saldo real en el proveedor: ${n(d.saldoSarblock)}` : `${n(d.caja.compradas)} compradas`} />
          </div>
          <div style={{ ...TARJETA, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Los que más compran</p>
              <button onClick={() => setVista('clientes')} style={{ background: 'none', border: 'none', color: C.sub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Ver todos ›</button>
            </div>
            {d.clientes.length === 0 ? <p style={{ fontSize: 13, color: C.sub, margin: '12px 0 0' }}>Todavía no hay ventas.</p>
              : d.clientes.slice(0, 5).map((c: any) => (
                <button key={c.uid} onClick={() => abrirCliente(c.uid)} className="ra-fila" style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: '11px 6px', background: 'transparent', border: 'none', borderTop: `1px solid ${C.borde}`, color: C.texto, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginTop: 8 }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{c.nombre}</span>
                  <span style={{ fontSize: 12.5, color: C.sub }}>{n(c.compradas)} compradas</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: c.saldo <= cfg.avisoClienteConsultas ? C.ambar : C.texto, minWidth: 90, textAlign: 'right' }}>{n(c.saldo)} disponibles</span>
                  <span style={{ color: C.tenue }}>›</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {vista === 'clientes' && (
        <div style={{ ...TARJETA, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.borde}` }}>
            <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar empresa" style={{ ...INP, background: 'transparent', border: 'none', padding: '6px 2px' }} />
          </div>
          {clientes.length === 0 ? <p style={{ padding: 18, fontSize: 13, color: C.sub, margin: 0 }}>{d.clientes.length ? 'Ninguna empresa con ese nombre.' : 'Todavía no hay empresas con compras.'}</p>
            : clientes.map((c: any, i: number) => (
              <button key={c.uid} onClick={() => abrirCliente(c.uid)} className="ra-fila ra-entra" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', alignItems: 'center', gap: 12, width: '100%', padding: '13px 18px', background: 'transparent', border: 'none', borderTop: i ? `1px solid ${C.borde}` : 'none', color: C.texto, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.nombre}<span style={{ display: 'block', fontSize: 11.5, color: C.sub, fontWeight: 500 }}>Última compra {c.ultimaCompra ? new Date(c.ultimaCompra).toLocaleDateString('es-CO') : '—'}</span></span>
                <span style={{ fontSize: 12.5 }}><span style={{ color: C.sub, display: 'block', fontSize: 11 }}>Disponibles</span><b style={{ color: c.saldo <= cfg.avisoClienteConsultas ? C.ambar : C.texto }}>{n(c.saldo)}</b></span>
                <span style={{ fontSize: 12.5 }}><span style={{ color: C.sub, display: 'block', fontSize: 11 }}>Compradas</span>{n(c.compradas)}</span>
                <span style={{ fontSize: 12.5 }}><span style={{ color: C.sub, display: 'block', fontSize: 11 }}>Pagado</span>{pesos(c.pagado)}</span>
                <span style={{ color: C.tenue }}>›</span>
              </button>
            ))}
        </div>
      )}

      {vista === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <div style={{ ...TARJETA, padding: '18px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={LBL}>Precio por consulta</label><input value={cfg.precioPorConsulta} onChange={e => setCfg({ ...cfg, precioPorConsulta: e.target.value })} style={INP} inputMode="numeric" /></div>
              <div><label style={LBL}>IVA %</label><input value={cfg.ivaPct} onChange={e => setCfg({ ...cfg, ivaPct: e.target.value })} style={INP} inputMode="numeric" /></div>
              <div><label style={LBL}>Compra mínima</label><input value={cfg.minimoCompra} onChange={e => setCfg({ ...cfg, minimoCompra: e.target.value })} style={INP} inputMode="numeric" /></div>
              <div><label style={LBL}>Avisar al cliente con ≤</label><input value={cfg.avisoClienteConsultas} onChange={e => setCfg({ ...cfg, avisoClienteConsultas: e.target.value })} style={INP} inputMode="numeric" /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={LBL}>Vigencia de cada consulta (días)</label><input value={cfg.vigenciaDias} onChange={e => setCfg({ ...cfg, vigenciaDias: e.target.value })} style={INP} inputMode="numeric" />
                <p style={{ fontSize: 11.5, color: C.tenue, margin: '5px 0 0' }}>Mientras esté vigente, buscar a la misma persona no usa otra consulta. Por defecto 90 días (3 meses).</p></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={LBL}>Cobertura mínima de la caja %</label><input value={cfg.avisoCajaCoberturaPct} onChange={e => setCfg({ ...cfg, avisoCajaCoberturaPct: e.target.value })} style={INP} inputMode="numeric" />
                <p style={{ fontSize: 11.5, color: C.tenue, margin: '5px 0 0' }}>Te avisamos si la caja no alcanza para este % de lo que los clientes ya pagaron.</p></div>
            </div>
            <p style={{ ...LBL, marginTop: 18 }}>Medios de pago</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {Object.entries(cfg.bolsillos).map(([k, v]: any) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 13px', borderRadius: 12, background: C.elevado, border: `1px solid ${C.borde}`, cursor: 'pointer' }}>
                  <span style={{ fontSize: 13 }}>{v.etiqueta}{k === 'COP_COINCENDA' ? <span style={{ color: C.tenue }}> · próximamente</span> : null}</span>
                  <input type="checkbox" checked={v.activo} onChange={e => setCfg({ ...cfg, bolsillos: { ...cfg.bolsillos, [k]: { ...v, activo: e.target.checked } } })} style={{ width: 18, height: 18, accentColor: '#4ADE80' }} />
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 13px', borderRadius: 12, background: C.elevado, border: `1px solid ${C.borde}`, cursor: 'pointer' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Venta de consultas activa</span>
                <input type="checkbox" checked={cfg.activo} onChange={e => setCfg({ ...cfg, activo: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#4ADE80' }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
              <button onClick={guardar} disabled={!cambiosPendientes} style={{ ...BTN, opacity: cambiosPendientes ? 1 : 0.4 }}>Guardar cambios</button>
              {cambiosPendientes && <button onClick={() => setCfg(d.config)} style={BTN2}>Descartar</button>}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ ...TARJETA, padding: '16px 18px' }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.3px', color: C.sub, margin: 0 }}>ASÍ LO VE EL CLIENTE</p>
              <p style={{ fontSize: 13, color: C.sub, margin: '10px 0 0' }}>Paquete mínimo</p>
              <p style={{ fontSize: 24, fontWeight: 800, margin: '2px 0 0' }}>{n(minimo)} consultas</p>
              <p style={{ fontSize: 14, fontWeight: 700, margin: '4px 0 0' }}>{pesos(totalMinimo)}{ivaCliente ? <span style={{ color: C.sub, fontWeight: 500 }}> con IVA</span> : null}</p>
              <p style={{ fontSize: 12, color: C.tenue, margin: '8px 0 0' }}>{pesos(precioCliente)} por consulta · {Object.values(cfg.bolsillos).filter((b: any) => b.activo).length} medios de pago</p>
            </div>
            <div style={{ ...TARJETA, padding: '16px 18px' }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.3px', color: C.sub, margin: 0 }}>TU MARGEN</p>
              <p style={{ fontSize: 24, fontWeight: 800, margin: '8px 0 0', color: margenUnit >= 0 ? C.verde : C.rojo }}>{pesos(margenUnit)} <span style={{ fontSize: 13, color: C.sub, fontWeight: 500 }}>por consulta</span></p>
              <p style={{ fontSize: 12, color: C.tenue, margin: '4px 0 0' }}>Costo promedio de la caja: {pesos(d.caja.costoUnit)}. Las consultas que salen del padrón no tienen costo.</p>
            </div>
          </div>
        </div>
      )}

      <Panel titulo="Reponer caja" abierto={panel === 'proveedor'} cerrar={() => setPanel(null)}>
        <p style={{ fontSize: 13, color: C.sub, margin: '0 0 16px' }}>Registra las consultas que Lincoin compró al proveedor. El costo por consulta se recalcula solo.</p>
        <div style={{ display: 'grid', gap: 12 }}>
          <div><label style={LBL}>Consultas compradas</label><input autoFocus value={prov.unidades} onChange={e => setProv({ ...prov, unidades: e.target.value })} style={INP} inputMode="numeric" placeholder="10000" /></div>
          <div><label style={LBL}>Costo total (COP)</label><input value={prov.costoTotal} onChange={e => setProv({ ...prov, costoTotal: e.target.value })} style={INP} inputMode="numeric" placeholder="10000000" /></div>
          {Number(prov.unidades) > 0 && Number(prov.costoTotal) > 0 && <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>Costo por consulta: <b style={{ color: C.texto }}>{pesos(Number(prov.costoTotal) / Number(prov.unidades))}</b></p>}
          <div><label style={LBL}>Nota</label><input value={prov.nota} onChange={e => setProv({ ...prov, nota: e.target.value })} style={INP} placeholder="Plan business de noviembre" /></div>
          <button onClick={registrarProveedor} disabled={!(Number(prov.unidades) > 0)} style={{ ...BTN, opacity: Number(prov.unidades) > 0 ? 1 : 0.4 }}>Registrar compra</button>
        </div>
        {d.comprasProveedor.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <p style={{ ...LBL }}>Compras anteriores</p>
            {d.comprasProveedor.map((c: any) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '8px 0', borderTop: `1px solid ${C.borde}` }}>
                <span>{new Date(c.at).toLocaleDateString('es-CO')} · {n(c.unidades)}{c.nota ? ` · ${c.nota}` : ''}</span><span style={{ color: C.sub }}>{pesos(c.costoTotal)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel titulo={cliente?.nombre ?? 'Cliente'} abierto={typeof panel === 'object' && panel !== null} cerrar={() => { setPanel(null); setCliente(null); setAj({ cantidad: '', motivo: '' }); }}>
        {!cliente ? <p style={{ color: C.sub, fontSize: 13 }}>Cargando…</p> : (
          <div className="ra-entra">
            <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>Consultas disponibles</p>
            <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.8px', margin: '2px 0 0' }}>{n(cliente.saldo)}</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '2px 0 0' }}>{cliente.consultas} consultas hechas · {cliente.compras.length} compras</p>
            <div style={{ background: C.elevado, borderRadius: 12, padding: '14px', marginTop: 18 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 10px' }}>Ajustar saldo</p>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {['+50', '+100', '-10'].map(x => <button key={x} onClick={() => setAj({ ...aj, cantidad: x })} style={{ ...BTN2, height: 30, fontSize: 12, padding: '0 10px' }}>{x}</button>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8 }}>
                <input value={aj.cantidad} onChange={e => setAj({ ...aj, cantidad: e.target.value })} placeholder="+/−" style={INP} />
                <input value={aj.motivo} onChange={e => setAj({ ...aj, motivo: e.target.value })} placeholder="Motivo (queda registrado)" style={INP} />
              </div>
              <button onClick={() => typeof panel === 'object' && panel && ajustar(panel.cliente)} disabled={!Number(aj.cantidad) || !aj.motivo.trim()} style={{ ...BTN, width: '100%', marginTop: 10, opacity: Number(aj.cantidad) && aj.motivo.trim() ? 1 : 0.4 }}>Aplicar ajuste</button>
            </div>
            <p style={{ ...LBL, marginTop: 22 }}>Movimientos</p>
            {cliente.movimientos.length === 0 ? <p style={{ fontSize: 13, color: C.sub }}>Sin movimientos.</p> : cliente.movimientos.map((m: any) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.borde}`, fontSize: 12.5 }}>
                <span><span style={{ display: 'block' }}>{m.detalle ?? m.tipo}</span><span style={{ color: C.tenue, fontSize: 11.5 }}>{new Date(m.at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}{m.por ? ` · ${m.por}` : ''}</span></span>
                <span style={{ fontWeight: 700, color: m.cantidad > 0 ? C.verde : C.texto, whiteSpace: 'nowrap' }}>{m.cantidad > 0 ? '+' : ''}{n(m.cantidad)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {toast && (
        <div className="ra-entra" style={{ position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 60, background: C.elevado, border: `1px solid ${toast.ok ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)'}`, borderRadius: 12, padding: '11px 16px', fontSize: 13, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
          {toast.t}
        </div>
      )}
    </div>
  );
};
