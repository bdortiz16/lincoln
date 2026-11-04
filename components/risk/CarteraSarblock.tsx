// Admin · Sarblock · Cartera — nuestras cuentas verificadas como CLIENTES en
// Sarblock y sus beneficiarios bajo cada una (sarblock/cartera.ts).
//
// Dar de alta una cuenta cobra una consulta (el screening de alta); por eso
// cada alta se confirma y el lote va de a 20 como mucho. Registrar los
// beneficiarios usa la AML que ya se pagó, y las personas consultadas en
// Lincoin Risk entran como clientes con su misma consulta.
import React, { useCallback, useEffect, useState } from 'react';
import { llamar, C, INP, BTN, BTN2, TARJETA, hace } from './RiskCliente';

const FASE: Record<string, { t: string; c: string }> = {
  screening: { t: 'Revisando en listas', c: C.ambar },
  expediente: { t: 'Cliente · KYB por completar', c: C.verde },
  enviado: { t: 'Cliente · KYB enviado', c: C.verde },
  requiere_info: { t: 'Cliente · piden más datos', c: C.ambar },
  aprobado: { t: 'Cliente · KYB aprobado', c: C.verde },
  rechazado: { t: 'KYB rechazado', c: C.rojo },
  bloqueado: { t: 'Bloqueado en Sarblock', c: C.rojo },
  error: { t: 'Con error', c: C.rojo },
};
const SEL: React.CSSProperties = { ...INP, width: 'auto', padding: '7px 10px', fontSize: 12.5, borderRadius: 999 };

const Config: React.FC = () => {
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { llamar('cartera_config_get').then(r => r?.ok ? setCfg(r.config) : setMsg({ ok: false, t: r?.error ?? 'No se pudo leer la configuración.' })); }, []);
  if (!cfg) return msg ? <p style={{ color: C.rojo, fontSize: 13 }}>{msg.t}</p> : null;
  const cambiar = async (k: string, v: boolean) => {
    const r = await llamar('cartera_config_set', { config: { [k]: v } });
    if (!r?.ok) return setMsg({ ok: false, t: r?.motivo ?? r?.error ?? 'No se pudo guardar.' });
    setCfg(r.config); setMsg({ ok: true, t: 'Guardado.' });
  };
  const Interruptor = ({ k, t, sub }: { k: string; t: string; sub: string }) => (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, background: C.elevado, border: `1px solid ${C.borde}`, cursor: 'pointer' }}>
      <span><span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{t}</span><span style={{ display: 'block', fontSize: 12, color: C.sub, marginTop: 2 }}>{sub}</span></span>
      <input type="checkbox" checked={!!cfg[k]} onChange={e => cambiar(k, e.target.checked)} style={{ width: 18, height: 18, accentColor: '#4ADE80' }} />
    </label>
  );
  return (
    <div style={{ ...TARJETA, padding: '18px 20px', display: 'grid', gap: 10, marginBottom: 16 }}>
      <Interruptor k="activo" t="Cartera en Sarblock activa" sub="Apagada, no se crea nada en Sarblock: ni clientes ni beneficiarios." />
      <Interruptor k="beneficiarios" t="Registrar beneficiarios solos" sub="Al terminar la AML de un beneficiario, queda bajo su empresa en Sarblock. Usa la consulta ya pagada." />
      <Interruptor k="risk" t="Consultados en Lincoin Risk como clientes" sub="Cada persona o empresa consultada queda en Clientes de Sarblock con su misma consulta. Entran a la cartera que se reporta a la UIAF." />
      <Interruptor k="altaAutomatica" t="Dar de alta solas las cuentas nuevas"
        sub={`Cada cuenta verificada creada desde que se enciende gasta una consulta.${cfg.altaDesde ? ` Encendida desde el ${new Date(cfg.altaDesde).toLocaleDateString('es-CO', { dateStyle: 'medium' })}.` : ''}`} />
      {msg && <span style={{ fontSize: 12.5, color: msg.ok ? C.verde : C.rojo }}>{msg.t}</span>}
    </div>
  );
};

export const CarteraSarblock: React.FC = () => {
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState<{ q: string; filtro: string; pagina: number }>({ q: '', filtro: '', pagina: 1 });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; t: string } | null>(null);
  const [lote, setLote] = useState('5');
  const cargar = useCallback(async () => setD(await llamar('cartera_lista', f)), [f]);
  useEffect(() => { cargar(); }, [cargar]);

  const alta = async (u: any) => {
    const paga = !u.sarblock;
    if (paga && !window.confirm(`Dar de alta a ${u.nombre} en Sarblock gasta una consulta. ¿Seguir?`)) return;
    setOcupado(u.id); setAviso(null);
    const r = await llamar(paga ? 'cartera_alta' : 'cartera_avanzar', { userId: u.id, confirmado: true });
    setOcupado(null);
    setAviso(r?.ok
      ? { ok: true, t: `${u.nombre}: ${FASE[r.fase]?.t ?? r.fase}${r.registrados ? ` · ${r.registrados} beneficiario(s) registrados` : ''}${r.error ? ` · ${r.error}` : ''}` }
      : { ok: false, t: r?.motivo ?? r?.error ?? 'No se pudo.' });
    cargar();
  };
  const pasarRisk = async () => {
    setOcupado('risk'); setAviso(null);
    const r = await llamar('cartera_risk_lote');
    setOcupado(null);
    setAviso(r?.ok
      ? { ok: !r.fallidos, t: `Lincoin Risk: ${r.registrados} nuevos en Clientes${r.existian ? ` · ${r.existian} ya estaban` : ''}${r.fallidos ? ` · ${r.fallidos} que Sarblock no aceptó` : ''} (de ${r.revisadas} revisadas).` }
      : { ok: false, t: r?.motivo ?? r?.error ?? 'No se pudo.' });
  };
  const altaLote = async () => {
    const n = Math.max(1, Math.min(20, Math.floor(Number(lote) || 0)));
    if (!window.confirm(`Dar de alta hasta ${n} cuentas que aún no están en Sarblock gasta hasta ${n} consultas. ¿Seguir?`)) return;
    setOcupado('lote'); setAviso(null);
    const r = await llamar('cartera_alta_lote', { cantidad: n, confirmado: true });
    setOcupado(null);
    setAviso(r?.ok
      ? { ok: !r.errores?.length, t: `Lanzadas ${r.lanzadas}${r.omitidas ? ` · ${r.omitidas} sin datos completos` : ''}${r.errores?.length ? ` · ${r.errores.length} con error` : ''}.` }
      : { ok: false, t: r?.motivo ?? r?.error ?? 'No se pudo.' });
    cargar();
  };

  return (
    <div>
      <Config />
      <div style={{ ...TARJETA, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${C.borde}` }}>
          <input value={f.q} onChange={e => setF({ ...f, q: e.target.value, pagina: 1 })} placeholder="Buscar por nombre, NIT, documento o correo" style={{ ...INP, flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13 }} />
          <select value={f.filtro} onChange={e => setF({ ...f, filtro: e.target.value, pagina: 1 })} style={SEL}>
            <option value="">Todas las verificadas</option>
            <option value="sin">Aún no en Sarblock</option>
            <option value="con">Ya en Sarblock</option>
          </select>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={lote} onChange={e => setLote(e.target.value)} inputMode="numeric" style={{ ...INP, width: 56, padding: '8px 10px', fontSize: 13 }} aria-label="Cuántas cuentas" />
            <button onClick={pasarRisk} disabled={!!ocupado} title="No gasta consultas" style={{ ...BTN2, height: 36, fontSize: 12.5, opacity: ocupado ? 0.5 : 1 }}>{ocupado === 'risk' ? 'Pasando…' : 'Pasar consultas de Risk'}</button>
            <button onClick={altaLote} disabled={!!ocupado} style={{ ...BTN, height: 36, fontSize: 12.5, opacity: ocupado ? 0.5 : 1 }}>{ocupado === 'lote' ? 'Dando de alta…' : 'Dar de alta en lote'}</button>
          </span>
        </div>
        {aviso && <p style={{ margin: 0, padding: '10px 18px', fontSize: 12.5, color: aviso.ok ? C.verde : C.ambar, borderBottom: `1px solid ${C.borde}` }}>{aviso.t}</p>}
        {!d ? <p style={{ padding: 18, color: C.sub, fontSize: 13, margin: 0 }}>Cargando…</p>
          : !d.ok ? <p style={{ padding: 18, color: C.rojo, fontSize: 13, margin: 0 }}>{d.motivo ?? d.error}</p>
          : !d.filas.length ? <p style={{ padding: 18, color: C.sub, fontSize: 13, margin: 0 }}>No hay cuentas con ese filtro.</p>
          : d.filas.map((u: any) => {
            const fs = u.sarblock ? FASE[u.sarblock.fase] ?? { t: u.sarblock.fase, c: C.sub } : null;
            return (
              <div key={u.id} style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '12px 18px', borderBottom: `1px solid ${C.borde}` }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nombre}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: C.sub }}>
                    {u.tipo === 'juridica' ? 'NIT' : 'Doc.'} {u.documento ?? '—'}
                    {u.sarblock?.nivel ? ` · ${u.sarblock.nivel}` : ''}
                    {u.beneficiarios.registrados ? ` · ${u.beneficiarios.registrados} beneficiario(s)` : ''}
                    {u.beneficiarios.conError ? ` · ${u.beneficiarios.conError} con error` : ''}
                    {u.sarblock?.actualizado ? ` · ${hace(u.sarblock.actualizado)}` : ''}
                  </p>
                  {(u.sarblock?.error || u.faltaDato) && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.ambar }}>{u.sarblock?.error ?? u.faltaDato}</p>}
                </div>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: fs?.c ?? C.tenue }}>{fs?.t ?? 'No está en Sarblock'}</span>
                  {!u.faltaDato && (
                    <button onClick={() => alta(u)} disabled={!!ocupado} style={{ ...BTN2, height: 32, fontSize: 12, padding: '0 12px', opacity: ocupado ? 0.5 : 1 }}>
                      {ocupado === u.id ? '…' : u.sarblock ? 'Actualizar' : 'Dar de alta'}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        {d?.ok && d.paginas > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', fontSize: 12.5, color: C.sub }}>
            <span>{d.total.toLocaleString('es-CO')} cuentas · página {d.pagina} de {d.paginas}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button disabled={d.pagina <= 1} onClick={() => setF({ ...f, pagina: d.pagina - 1 })} style={{ ...BTN2, height: 32, opacity: d.pagina <= 1 ? 0.4 : 1 }}>‹ Anterior</button>
              <button disabled={d.pagina >= d.paginas} onClick={() => setF({ ...f, pagina: d.pagina + 1 })} style={{ ...BTN2, height: 32, opacity: d.pagina >= d.paginas ? 0.4 : 1 }}>Siguiente ›</button>
            </span>
          </div>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0' }}>
        Dar de alta gasta una consulta por cuenta. El expediente KYB queda en borrador en Sarblock con lo que ya sabemos; cumplimiento lo completa allá. Las consultas de Lincoin Risk entran con su misma consulta, sin gastar otra; las de hace más de 3 meses Sarblock ya no las acepta.
      </p>
    </div>
  );
};
