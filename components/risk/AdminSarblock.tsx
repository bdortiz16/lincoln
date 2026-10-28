// Admin · Sarblock — todo lo de Sarblock en una pestaña de Cumplimiento:
//   Ventas      → Lincoin Risk prepago: caja, clientes, precio y ajustes.
//   Consultas   → el historial de Lincoin Risk de TODAS las empresas, con su
//                 detalle y el PDF. Abrir un detalle queda en la auditoría.
//   Búsquedas   → cada vez que una empresa buscó a alguien.
//   AML         → la verificación de beneficiarios: encendido, bloqueo, tope
//                 diario y los créditos que quedan en Sarblock.
// Lincoin Risk (consultas manuales) y la AML de beneficiarios son cosas
// distintas: solo comparten la cuenta de Sarblock.
import React, { useCallback, useEffect, useState } from 'react';
import { llamar, C, LBL, INP, BTN, BTN2, TARJETA, ESTILOS, GRUPO, TIPOS, Vence, Punto, Panel, Resultado, hace } from './RiskCliente';
import { RiskAdmin } from './RiskAdmin';

type Vista = 'ventas' | 'consultas' | 'busquedas' | 'aml';
const VISTAS: [Vista, string][] = [['ventas', 'Ventas'], ['consultas', 'Consultas'], ['busquedas', 'Búsquedas'], ['aml', 'AML de beneficiarios']];
const RESULTADO: Record<string, { t: string; c: string }> = {
  nueva: { t: 'Consulta nueva', c: C.texto }, existente: { t: 'Ya estaba consultada', c: C.sub },
  renovada: { t: 'Consulta renovada', c: C.verde }, sin_saldo: { t: 'Sin consultas disponibles', c: C.ambar },
};
const fecha = (d: string) => new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const SEL: React.CSSProperties = { ...INP, width: 'auto', padding: '7px 10px', fontSize: 12.5, borderRadius: 999 };

const Paginas: React.FC<{ d: any; ir: (p: number) => void }> = ({ d, ir }) => d && d.paginas > 1 ? (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: `1px solid ${C.borde}`, fontSize: 12.5, color: C.sub }}>
    <span>{d.total.toLocaleString('es-CO')} en total · página {d.pagina} de {d.paginas}</span>
    <span style={{ display: 'flex', gap: 8 }}>
      <button disabled={d.pagina <= 1} onClick={() => ir(d.pagina - 1)} style={{ ...BTN2, height: 32, opacity: d.pagina <= 1 ? 0.4 : 1 }}>‹ Anterior</button>
      <button disabled={d.pagina >= d.paginas} onClick={() => ir(d.pagina + 1)} style={{ ...BTN2, height: 32, opacity: d.pagina >= d.paginas ? 0.4 : 1 }}>Siguiente ›</button>
    </span>
  </div>
) : null;

// ── Historial (consultas o búsquedas) de todas las empresas ─────────────
const Historial: React.FC<{ tipo: 'consultas' | 'busquedas'; clientes: { uid: string; nombre: string }[]; abrir: (id: string) => void }> = ({ tipo, clientes, abrir }) => {
  const [f, setF] = useState({ q: '', cliente: '', nivel: '', riesgo: '', origen: '', resultado: '', desde: '', hasta: '' });
  const [pagina, setPagina] = useState(1);
  const [d, setD] = useState<any>(null);
  const cargar = useCallback(async () => {
    setD(null);
    setD(await llamar(tipo === 'consultas' ? 'admin_risk_consultas' : 'admin_risk_busquedas', { ...f, pagina }));
  }, [tipo, f, pagina]);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);
  const set = (k: string, v: string) => { setPagina(1); setF(x => ({ ...x, [k]: v })); };

  return (
    <div style={{ ...TARJETA, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.borde}`, display: 'grid', gap: 10 }}>
        <input value={f.q} onChange={e => set('q', e.target.value)} placeholder="Buscar por nombre o documento" style={INP} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={f.cliente} onChange={e => set('cliente', e.target.value)} style={SEL}>
            <option value="">Todas las empresas</option>
            {clientes.map(c => <option key={c.uid} value={c.uid}>{c.nombre}</option>)}
          </select>
          {tipo === 'consultas' ? (<>
            <select value={f.nivel} onChange={e => set('nivel', e.target.value)} style={SEL}>
              <option value="">Todos los niveles</option><option value="alto">Alto</option><option value="medio">Medio</option><option value="bajo">Bajo</option>
            </select>
            <select value={f.riesgo} onChange={e => set('riesgo', e.target.value)} style={SEL}>
              <option value="">Todos los riesgos</option>
              {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
            <select value={f.origen} onChange={e => set('origen', e.target.value)} style={SEL}>
              <option value="">Sarblock y padrón</option><option value="sarblock">Consulta a Sarblock</option><option value="padron">Del padrón (sin costo)</option>
            </select>
          </>) : (
            <select value={f.resultado} onChange={e => set('resultado', e.target.value)} style={SEL}>
              <option value="">Todos los resultados</option>
              {Object.entries(RESULTADO).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
            </select>
          )}
          <span style={{ fontSize: 12, color: C.sub, marginLeft: 4 }}>Desde</span>
          <input type="date" value={f.desde} onChange={e => set('desde', e.target.value)} style={{ ...SEL, colorScheme: 'dark' }} />
          <span style={{ fontSize: 12, color: C.sub }}>hasta</span>
          <input type="date" value={f.hasta} onChange={e => set('hasta', e.target.value)} style={{ ...SEL, colorScheme: 'dark' }} />
        </div>
      </div>

      {!d ? <p style={{ padding: 18, color: C.sub, fontSize: 13, margin: 0 }}>Cargando…</p>
        : !d.ok ? <p style={{ padding: 18, color: C.rojo, fontSize: 13, margin: 0 }}>{d.error ?? d.motivo ?? 'No se pudo cargar.'}</p>
        : d.filas.length === 0 ? <p style={{ padding: '28px 18px', textAlign: 'center', color: C.sub, fontSize: 13, margin: 0 }}>Nada con esos filtros.</p>
        : tipo === 'consultas' ? d.filas.map((c: any, i: number) => {
          const g = GRUPO[c.grupo];
          const estado = c.estado === 'consultando' ? 'Consultando…' : c.estado === 'fallida' ? 'Fallida (devuelta)' : null;
          return (
            <button key={c.id} onClick={() => c.estado === 'lista' && abrir(c.id)} className="lr-fila"
              style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 14, padding: '12px 18px', background: 'transparent', border: 'none', borderTop: i ? `1px solid ${C.borde}` : 'none', color: C.texto, cursor: c.estado === 'lista' ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nombreOficial || c.nombreEscrito || 'Sin nombre'}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.sub, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.tipoDocumento} {c.documento} · <b style={{ color: C.texto, fontWeight: 600 }}>{c.empresa}</b>{c.por ? ` · ${c.por}` : ''} · {fecha(c.at)}{c.deCache ? ' · del padrón' : ''}
                </span>
              </span>
              {estado ? <span style={{ fontSize: 12, color: C.sub }}>{estado}</span> : <>
                {(c.riesgos ?? []).filter((r: string) => r !== 'ninguno').slice(0, 2).map((r: string) => (
                  <span key={r} style={{ fontSize: 11, color: C.texto, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap' }}>{TIPOS[r] ?? r}</span>
                ))}
                <Vence v={c.vence} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: g.c, minWidth: 54 }}><Punto c={g.c} tam={7} />{g.t}</span>
              </>}
            </button>
          );
        }) : d.filas.map((b: any, i: number) => {
          const r = RESULTADO[b.resultado] ?? { t: b.resultado, c: C.sub };
          return (
            <button key={b.id} onClick={() => b.consultaId && abrir(b.consultaId)} disabled={!b.consultaId} className="lr-fila"
              style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 14, padding: '12px 18px', background: 'transparent', border: 'none', borderTop: i ? `1px solid ${C.borde}` : 'none', color: C.texto, cursor: b.consultaId ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <Punto c={r.c} tam={8} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{b.nombre || `${b.tipoDocumento} ${b.documento}`}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.sub }}>{b.tipoDocumento} {b.documento} · <b style={{ color: C.texto, fontWeight: 600 }}>{b.empresa}</b>{b.por ? ` · ${b.por}` : ''} · {fecha(b.at)}</span>
              </span>
              <span style={{ fontSize: 12, color: r.c, whiteSpace: 'nowrap' }}>{r.t}</span>
            </button>
          );
        })}
      {d?.ok && <Paginas d={d} ir={setPagina} />}
    </div>
  );
};

// ── AML de beneficiarios (sarblock_config) ──────────────────────────────
const Aml: React.FC = () => {
  const [cfg, setCfg] = useState<any>(null);
  const [orig, setOrig] = useState<string>('');
  const [extra, setExtra] = useState<{ credencial?: string; saldo?: number | null }>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    (async () => {
      const r = await llamar('config_get');
      if (!r?.ok) { setMsg({ ok: false, t: r?.error ?? 'No se pudo leer la configuración.' }); return; }
      const c = { ...r.config, cuentas: (r.config.soloEstosUsuarios ?? []).join('\n') };
      setCfg(c); setOrig(JSON.stringify(c));
      setExtra({ credencial: r.credencial });
    })();
  }, []);
  if (!cfg) return msg ? <p style={{ color: C.rojo, fontSize: 13 }}>{msg.t}</p> : <p style={{ color: C.sub, fontSize: 13 }}>Cargando…</p>;
  const cambios = JSON.stringify(cfg) !== orig;
  const guardar = async () => {
    const { cuentas, ...resto } = cfg;
    const r = await llamar('config_set', { config: { ...resto, topeDiario: Math.max(1, Math.floor(Number(resto.topeDiario) || 200)),
      soloEstosUsuarios: String(cuentas ?? '').split(/[\s,]+/).map((x: string) => x.trim()).filter(Boolean) } });
    if (!r?.ok) return setMsg({ ok: false, t: r?.error ?? 'No se pudo guardar.' });
    const c = { ...r.config, cuentas: (r.config.soloEstosUsuarios ?? []).join('\n') };
    setCfg(c); setOrig(JSON.stringify(c)); setMsg({ ok: true, t: 'Configuración guardada.' });
  };
  const Interruptor = ({ k, t, sub }: { k: string; t: string; sub: string }) => (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, background: C.elevado, border: `1px solid ${C.borde}`, cursor: 'pointer' }}>
      <span><span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{t}</span><span style={{ display: 'block', fontSize: 12, color: C.sub, marginTop: 2 }}>{sub}</span></span>
      <input type="checkbox" checked={!!cfg[k]} onChange={e => setCfg({ ...cfg, [k]: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#4ADE80' }} />
    </label>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
      <div style={{ ...TARJETA, padding: '18px 20px', display: 'grid', gap: 10 }}>
        <Interruptor k="activo" t="Verificación con Sarblock activa" sub="Apagada, los beneficiarios nuevos no se consultan." />
        <Interruptor k="bloquear" t="Bloquear envíos según el resultado" sub="Sin resultado o con veredicto que no permite operar, no sale plata." />
        <Interruptor k="soloBloquearAlto" t="Bloquear solo riesgo alto" sub="El riesgo medio queda a la vista, pero deja enviar." />
        <div><label style={LBL}>Tope diario de consultas pagadas por cuenta</label>
          <input value={cfg.topeDiario} onChange={e => setCfg({ ...cfg, topeDiario: e.target.value })} style={INP} inputMode="numeric" /></div>
        <div><label style={LBL}>Solo estas cuentas (vacío = todas)</label>
          <textarea value={cfg.cuentas} onChange={e => setCfg({ ...cfg, cuentas: e.target.value })} rows={3} placeholder="Un id de cuenta por línea" style={{ ...INP, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button onClick={guardar} disabled={!cambios} style={{ ...BTN, opacity: cambios ? 1 : 0.4 }}>Guardar cambios</button>
          {msg && <span style={{ fontSize: 12.5, color: msg.ok ? C.verde : C.rojo }}>{msg.t}</span>}
        </div>
      </div>
      <div style={{ ...TARJETA, padding: '18px 20px' }}>
        <p style={LBL}>Créditos</p>
        <p style={{ fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.5 }}>Los de arriba los comparten la AML de beneficiarios y Lincoin Risk. Las consultas que salen del padrón no gastan créditos.</p>
        <p style={{ fontSize: 12, color: extra.credencial === 'configurada' ? C.sub : C.rojo, margin: '12px 0 0' }}>
          Credencial: {extra.credencial === 'configurada' ? 'configurada' : 'falta SARBLOCK_ORG_API_KEY'}
        </p>
      </div>
    </div>
  );
};

// ── Créditos que quedan en Sarblock (arriba, en todas las vistas) ────────
const Creditos: React.FC = () => {
  const [u, setU] = useState<any>(null);
  const cargar = useCallback(async () => { setU(await llamar('admin_sarblock_uso')); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  if (!u) return <div style={{ ...TARJETA, padding: '16px 20px', marginBottom: 16, color: C.sub, fontSize: 13 }}>Leyendo créditos de Sarblock…</div>;
  if (!u.ok) return <div style={{ ...TARJETA, padding: '16px 20px', marginBottom: 16, color: C.rojo, fontSize: 13 }}>{u.motivo ?? u.error ?? 'No se pudo leer el consumo.'}</div>;
  const pct = u.incluidas ? Math.min(100, Math.round((u.consumidas / u.incluidas) * 100)) : 0;
  const bajo = u.incluidas ? u.quedan / u.incluidas <= 0.15 : u.quedan <= 50;
  const dias = u.renueva ? Math.max(0, Math.ceil((Date.parse(u.renueva) - Date.now()) / 86400_000)) : null;
  const n = (x: number) => Number(x || 0).toLocaleString('es-CO');
  return (
    <div style={{ ...TARJETA, padding: '18px 20px', marginBottom: 16, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ minWidth: 170 }}>
        <p style={LBL}>Créditos en Sarblock</p>
        <p style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.8px', margin: 0, color: bajo ? C.ambar : C.texto }}>{n(u.quedan)}</p>
        <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>consultas disponibles{u.adicionales ? ` · ${n(u.adicionales)} adicionales` : ''}</p>
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.sub, marginBottom: 6 }}>
          <span>Usadas <b style={{ color: C.texto }}>{n(u.consumidas)}</b> de {n(u.incluidas)} del plan{u.reservadas ? ` · ${n(u.reservadas)} en curso` : ''}</span>
          <span>{pct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: C.elevado, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: bajo ? C.ambar : C.verde, transition: 'width .4s' }} />
        </div>
        <p style={{ fontSize: 12, color: C.sub, margin: '8px 0 0' }}>
          Este periodo: <b style={{ color: C.texto }}>{n(u.enAml)}</b> en AML de beneficiarios · <b style={{ color: C.texto }}>{n(u.enRisk)}</b> en Lincoin Risk
          {u.renueva ? ` · se renueva el ${new Date(u.renueva).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}${dias != null ? ` (en ${dias} días)` : ''}` : ''}
        </p>
        {bajo && <p style={{ fontSize: 12, color: C.ambar, margin: '6px 0 0' }}>Quedan pocos créditos: compra un paquete en Sarblock y regístralo en Ventas › Reponer caja.</p>}
      </div>
      <button onClick={cargar} style={{ ...BTN2, height: 36 }}>Actualizar</button>
    </div>
  );
};

export const AdminSarblock: React.FC = () => {
  const [vista, setVista] = useState<Vista>('ventas');
  const [clientes, setClientes] = useState<{ uid: string; nombre: string }[]>([]);
  const [detalle, setDetalle] = useState<any>(null);
  useEffect(() => { llamar('admin_risk_resumen').then(r => r?.ok && setClientes(r.clientes ?? [])); }, []);
  const abrir = async (id: string) => { const r = await llamar('admin_risk_ver', { consultaId: id }); if (r?.ok) setDetalle(r.consulta); };

  return (
    <div style={{ fontFamily: "'Archivo', system-ui, sans-serif", color: C.texto }}>
      <style>{ESTILOS}</style>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', margin: 0 }}>Sarblock</h1>
          <p style={{ fontSize: 13, color: C.sub, margin: '4px 0 0' }}>Lincoin Risk (ventas e historiales de todas las empresas) y la AML de beneficiarios.</p>
        </div>
        <div role="tablist" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: C.elevado, border: `1px solid ${C.borde}`, flexWrap: 'wrap' }}>
          {VISTAS.map(([k, t]) => (
            <button key={k} role="tab" aria-selected={vista === k} onClick={() => setVista(k)}
              style={{ padding: '7px 15px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: vista === k ? '#F4F4F2' : 'transparent', color: vista === k ? '#15181A' : C.sub }}>{t}</button>
          ))}
        </div>
      </div>

      <Creditos />
      {vista === 'ventas' && <RiskAdmin />}
      {vista === 'consultas' && <Historial key="c" tipo="consultas" clientes={clientes} abrir={abrir} />}
      {vista === 'busquedas' && <Historial key="b" tipo="busquedas" clientes={clientes} abrir={abrir} />}
      {vista === 'aml' && <Aml />}
      {(vista === 'consultas' || vista === 'busquedas') && (
        <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0' }}>Abrir el detalle de una consulta queda registrado en la auditoría. El historial no se puede borrar.</p>
      )}

      <Panel titulo={detalle ? `Consulta · ${detalle.empresa?.nombre || 'empresa'}` : 'Consulta'} abierto={!!detalle} cerrar={() => setDetalle(null)} ancho={560}>
        {detalle && <>
          <div style={{ padding: '12px 20px', fontSize: 12.5, color: C.sub, borderBottom: `1px solid ${C.borde}` }}>
            Consultada por <b style={{ color: C.texto }}>{detalle.por || 'usuario'}</b> de {detalle.empresa?.nombre || 'la empresa'} · {hace(detalle.at)}{detalle.deCache ? ' · salió del padrón' : ''}
          </div>
          <Resultado consulta={detalle} compacto />
        </>}
      </Panel>
    </div>
  );
};
