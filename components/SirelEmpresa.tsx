import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { llamarFuncion } from '../lib/edge';
import { descargarXlsx, type Hoja } from '../lib/xlsx';
import { celdaCsv } from '../lib/csv';

// ─────────────────────────────────────────────
// Compliance → SIREL (de la empresa).
//
// Pedido del dueño (2026-11): una empresa que también reporta a la UIAF
// (por ejemplo, porque es PSAV) encuentra aquí sus transacciones hechas por
// Lincoin en el mes o el día, con quién pagó o a quién se le pagó, listas para
// su reporte en SIREL (Reportes Objetivos). Lincoin no lo envía por ella: se
// lo deja armado, lo descarga y anota su radicado cuando lo sube.
//
// El servidor arma las filas (admin-data sirel_mis_transacciones). Lo que no
// está guardado sale vacío y la fila lo dice; no se completa a ojo.
// ─────────────────────────────────────────────

const C = { fondo: '#0C0E0D', caja: '#121413', borde: 'rgba(255,255,255,0.09)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', ambar: '#FBBF24', rojo: '#F87171' };
const TARJ: React.CSSProperties = { background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 18 };
const BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: '#F4F4F2', color: '#15181A', whiteSpace: 'nowrap' };
const BTN2: React.CSSProperties = { ...BTN, background: 'rgba(255,255,255,0.05)', color: C.texto, border: '1px solid rgba(255,255,255,0.12)' };
const INP: React.CSSProperties = { height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', padding: '0 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' };

const cop = (n: unknown) => n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('es-CO')}`;
const cant = (n: unknown) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 6 });
const fechaHora = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
// Para las descargas: AAAA-MM-DD HH:MM en hora de Bogotá.
const fechaPlana = (iso: unknown) => { const t = Date.parse(String(iso ?? '')); return isNaN(t) ? '' : new Date(t - 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' '); };
const corto = (s: unknown, n = 10) => { const t = String(s ?? ''); return t.length > n * 2 + 1 ? `${t.slice(0, n)}…${t.slice(-6)}` : t; };
const hoyBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const mesAnterior = () => { const d = new Date(Date.now() - 5 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

const ETIQUETA: Record<string, string> = {
  cobro: 'Cobro recibido', pago: 'Pago enviado', recarga: 'Recarga de saldo',
  av_deposito: 'Depósito de activo virtual', av_retiro: 'Retiro de activo virtual',
  av_venta: 'Venta de activo virtual', av_compra: 'Compra de activo virtual',
};
const COLOR: Record<string, string> = { cobro: C.verde, pago: C.texto, recarga: C.sub };
const TIPO_ENVIO: Record<string, string> = { transacciones: 'Reporte de transacciones', ausencia_transacciones: 'Ausencia de transacciones' };

const Chip: React.FC<{ c: string; children: React.ReactNode }> = ({ c, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, color: c, background: `${c}14`, border: `1px solid ${c}40`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{children}</span>
);

export const SirelEmpresa: React.FC<{ userId?: string; nombreEmpresa?: string }> = ({ userId, nombreEmpresa }) => {
  const [periodo, setPeriodo] = useState<'mes' | 'dia'>('mes');
  const [mes, setMes] = useState(mesAnterior());
  const [dia, setDia] = useState(hoyBogota());
  const [vista, setVista] = useState<'movimientos' | 'contrapartes' | 'envios'>('movimientos');
  const [q, setQ] = useState('');
  const [datos, setDatos] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState<null | { tipo: string; filas: number }>(null);
  const [radicado, setRadicado] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errReg, setErrReg] = useState<string | null>(null);

  const fecha = periodo === 'mes' ? `${mes}-01` : dia;
  const cargar = useCallback(async () => {
    if (!userId) return;
    setCargando(true); setError(null);
    const r = await llamarFuncion('admin-data', { action: 'sirel_mis_transacciones', userId, periodo, fecha });
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo armar el período.'); return; }
    setDatos(r);
  }, [userId, periodo, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const movs: any[] = datos?.movimientos ?? [];
  const contras: any[] = datos?.contrapartes ?? [];
  const clave: string = datos?.clavePeriodo ?? (periodo === 'mes' ? mes : dia);
  const texto = q.trim().toLowerCase();
  const coincide = (...v: unknown[]) => !texto || v.some(x => String(x ?? '').toLowerCase().includes(texto));
  const movsVista = useMemo(() => movs.filter(m => coincide(m.contraparteNombre, m.contraparteDoc, m.contraparteCuenta, m.referencia, m.hash)), [movs, texto]);
  const contrasVista = useMemo(() => contras.filter(c => coincide(c.nombre, c.documento, c.cuenta)), [contras, texto]);
  const enviado = (datos?.envios ?? []).find((e: any) => String(e.periodo).startsWith(clave) && (e.tipo === 'transacciones' || e.tipo === 'ausencia_transacciones'));

  // ── Descargas ──────────────────────────────
  const COL_MOV = ['Fecha (Bogotá)', 'Tipo', 'Medio', 'Moneda', 'Monto', 'Valor COP', 'Contraparte', 'Tipo doc. contraparte', 'Documento contraparte', 'Banco contraparte', 'Llave / cuenta / wallet', 'Referencia', 'Activo virtual', 'Red', 'Hash', 'Falta', 'Id Lincoin'];
  const filaMov = (m: any) => [fechaPlana(m.fecha), ETIQUETA[m.tipo] ?? m.tipo, m.medio, m.moneda, m.monto, m.montoCop ?? '', m.contraparteNombre ?? '', m.contraparteTipoDoc ?? '', m.contraparteDoc ?? '', m.contraparteBanco ?? '', m.contraparteCuenta ?? '', m.referencia ?? '', m.activo ?? '', m.red ?? '', m.hash ?? '', (m.faltan ?? []).join(' · '), m.id];
  const COL_CON = ['Contraparte', 'Tipo doc.', 'Documento', 'Banco', 'Llave / cuenta / wallet', 'Operaciones', 'Recibido COP', 'Enviado COP', 'Primera', 'Última'];
  const filaCon = (c: any) => [c.nombre ?? (c.cuenta ? 'Wallet' : ''), c.tipoDoc ?? '', c.documento ?? '', c.banco ?? '', c.cuenta ?? '', c.operaciones, Math.round(c.recibidoCop), Math.round(c.enviadoCop), fechaPlana(c.primera), fechaPlana(c.ultima)];
  const nombreBase = `SIREL_${(nombreEmpresa || 'empresa').replace(/[^\w]+/g, '_').slice(0, 30)}_${clave}`;
  const excel = () => {
    const hojas: Hoja[] = [
      { nombre: 'Transacciones', filas: [COL_MOV, ...movsVista.map(filaMov)] },
      { nombre: 'Contrapartes', filas: [COL_CON, ...contrasVista.map(filaCon)] },
    ];
    const av = movsVista.filter(m => String(m.tipo).startsWith('av_'));
    if (av.length) hojas.push({ nombre: 'Activos virtuales', filas: [COL_MOV, ...av.map(filaMov)] });
    descargarXlsx(`${nombreBase}.xlsx`, hojas);
  };
  const csv = () => {
    const [cols, filas] = vista === 'contrapartes' ? [COL_CON, contrasVista.map(filaCon)] : [COL_MOV, movsVista.map(filaMov)];
    const t = '﻿' + [cols, ...filas].map(f => f.map(celdaCsv).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${nombreBase}_${vista}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const guardarEnvio = async () => {
    if (!registrar || !userId) return;
    setGuardando(true); setErrReg(null);
    const r = await llamarFuncion('admin-data', { action: 'sirel_mis_envios', userId, tipo: registrar.tipo, periodo: clave, radicado, filas: registrar.filas });
    setGuardando(false);
    if (!r?.ok) { setErrReg(r?.error ?? 'No se pudo guardar.'); return; }
    setRegistrar(null); setRadicado(''); cargar();
  };

  const res = datos?.resumen;
  return (
    <div style={{ ...TARJ, padding: '20px 22px', color: C.texto }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 620 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '1.6px', color: C.sub }}>SIREL · UIAF</p>
          <p style={{ margin: '6px 0 0', fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px' }}>Tu reporte de transacciones</p>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: C.sub, lineHeight: 1.55 }}>
            Si tu empresa reporta a la UIAF, aquí están tus transacciones hechas por Lincoin y sus contrapartes. Descárgalas, súbelas en SIREL (Reportes Objetivos) y anota tu radicado. Lincoin no envía este reporte por ti.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', padding: 3, borderRadius: 10, background: C.caja, border: `1px solid ${C.borde}` }}>
            {(['mes', 'dia'] as const).map(p => (
              <button key={p} onClick={() => setPeriodo(p)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: periodo === p ? '#F4F4F2' : 'transparent', color: periodo === p ? '#15181A' : C.sub }}>{p === 'mes' ? 'Mes' : 'Día'}</button>
            ))}
          </div>
          {periodo === 'mes'
            ? <input type="month" value={mes} max={hoyBogota().slice(0, 7)} onChange={e => e.target.value && setMes(e.target.value)} aria-label="Mes" style={INP} />
            : <input type="date" value={dia} max={hoyBogota()} onChange={e => e.target.value && setDia(e.target.value)} aria-label="Día" style={INP} />}
        </div>
      </div>

      {error && <p style={{ margin: '14px 0 0', fontSize: 13, color: C.rojo }}>{error}</p>}
      {!datos && !error && <p style={{ margin: '14px 0 0', fontSize: 13, color: C.sub }}>{cargando ? 'Armando el período…' : ''}</p>}

      {datos && res && (
        <>
          {/* Cifras del período. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 16 }}>
            {[
              [String(res.movimientos), 'Transacciones', res.conFaltantes ? `${res.conFaltantes} con datos incompletos` : 'Todas con sus datos'],
              [cop(res.cobrosCop), 'Cobros recibidos', `${res.cobros} cobro(s)`],
              [cop(res.pagosCop), 'Pagos enviados', `${res.pagos} pago(s)`],
              [String(res.contrapartes), 'Contrapartes', res.activosVirtuales ? `${res.activosVirtuales} operación(es) con activos virtuales` : 'Sin activos virtuales'],
            ].map(([v, t, s]) => (
              <div key={t} style={{ background: C.caja, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '13px 15px' }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px' }}>{v}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 700 }}>{t}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: res.conFaltantes && t === 'Transacciones' ? '#FCD34D' : C.sub }}>{s}</p>
              </div>
            ))}
          </div>

          {/* ¿Ya se subió este período? */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: C.caja, border: `1px solid ${enviado ? 'rgba(74,222,128,0.3)' : C.borde}`, borderRadius: 14, padding: '12px 15px' }}>
            <span style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: enviado ? C.texto : C.sub }}>
              {enviado
                ? <>✓ {TIPO_ENVIO[enviado.tipo] ?? enviado.tipo} de {clave} anotado · radicado <b>{enviado.radicado}</b> · {fechaHora(enviado.at)}</>
                : movs.length
                  ? <>Cuando subas el reporte de {clave} en SIREL, anota aquí el radicado.</>
                  : <>No hubo transacciones en {clave}: si te corresponde, en SIREL va el reporte de ausencia (Reportes de Ausencia).</>}
            </span>
            {!enviado && <button onClick={() => { setRegistrar({ tipo: movs.length ? 'transacciones' : 'ausencia_transacciones', filas: movs.length }); setErrReg(null); }} style={{ ...BTN2, height: 32 }}>Ya lo subí</button>}
          </div>
          {registrar && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: C.caja, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '12px 15px' }}>
              <span style={{ fontSize: 12.5, color: C.sub }}>{TIPO_ENVIO[registrar.tipo]} · {clave}</span>
              <input autoFocus value={radicado} onChange={e => setRadicado(e.target.value)} placeholder="Número de radicado de SIREL" aria-label="Número de radicado" style={{ ...INP, flex: 1, minWidth: 200 }} />
              <button onClick={guardarEnvio} disabled={guardando || radicado.trim().length < 3} style={{ ...BTN, height: 34, opacity: guardando || radicado.trim().length < 3 ? 0.4 : 1 }}>{guardando ? 'Guardando…' : 'Guardar'}</button>
              <button onClick={() => setRegistrar(null)} style={{ ...BTN2, height: 34 }}>Cancelar</button>
              {errReg && <p style={{ flexBasis: '100%', margin: 0, fontSize: 12, color: C.rojo }}>{errReg}</p>}
            </div>
          )}

          {/* Tablas. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {([['movimientos', `Transacciones · ${movs.length}`], ['contrapartes', `Contrapartes · ${contras.length}`], ['envios', `Radicados · ${(datos.envios ?? []).length}`]] as const).map(([k, t]) => (
                <button key={k} onClick={() => setVista(k)} style={{ height: 32, padding: '0 13px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, whiteSpace: 'nowrap', fontWeight: vista === k ? 700 : 600, color: vista === k ? C.texto : C.sub, background: vista === k ? 'rgba(255,255,255,0.08)' : 'transparent', border: `1px solid ${vista === k ? 'rgba(255,255,255,0.18)' : C.borde}` }}>{t}</button>
              ))}
            </div>
            {vista !== 'envios' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, documento…" aria-label="Buscar" style={{ ...INP, width: 210 }} />
                <button onClick={excel} disabled={!movs.length} style={{ ...BTN, opacity: movs.length ? 1 : 0.4 }}>Descargar Excel</button>
                <button onClick={csv} disabled={!movs.length} style={{ ...BTN2, opacity: movs.length ? 1 : 0.4 }}>CSV</button>
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, border: `1px solid ${C.borde}`, borderRadius: 14, overflow: 'hidden' }}>
            {vista === 'movimientos' && (movsVista.length === 0
              ? <p style={{ padding: 18, margin: 0, color: C.sub, fontSize: 13 }}>{q ? 'Nada con esa búsqueda.' : 'No hubo transacciones en el período.'}</p>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 820 }}>
                    <thead><tr style={{ color: C.tenue, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'left' }}>
                      {['Fecha', 'Tipo', 'Monto', 'Contraparte', 'Banco · cuenta', 'Falta'].map(h => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {movsVista.slice(0, 400).map(m => (
                        <tr key={m.id} style={{ borderTop: `1px solid ${C.borde}` }}>
                          <td style={{ padding: '10px 14px', color: C.sub, whiteSpace: 'nowrap' }}>{fechaHora(m.fecha)}</td>
                          <td style={{ padding: '10px 14px' }}><span style={{ display: 'block', fontWeight: 700, color: COLOR[m.tipo] ?? C.texto }}>{ETIQUETA[m.tipo] ?? m.tipo}</span><span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{m.medio}</span></td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700 }}>{m.moneda === 'COP' ? cop(m.monto) : `${cant(m.monto)} ${m.moneda}`}{m.moneda !== 'COP' && m.montoCop != null && <span style={{ display: 'block', color: C.sub, fontSize: 11.5, fontWeight: 500 }}>{cop(m.montoCop)}</span>}</td>
                          <td style={{ padding: '10px 14px' }}><span style={{ display: 'block', fontWeight: 600 }}>{m.contraparteNombre ?? (m.tipo === 'recarga' ? 'Tu empresa' : '—')}</span>{m.contraparteDoc && <span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{m.contraparteTipoDoc ?? ''} {m.contraparteDoc}</span>}</td>
                          <td style={{ padding: '10px 14px', color: C.sub, fontSize: 11.5 }} title={m.contraparteCuenta ?? ''}>{m.contraparteBanco ?? ''}{m.contraparteCuenta ? <span style={{ display: 'block', fontFamily: 'ui-monospace, monospace' }}>{corto(m.contraparteCuenta)}</span> : null}{m.hash ? <span style={{ display: 'block', fontFamily: 'ui-monospace, monospace' }}>hash {corto(m.hash, 8)}</span> : null}</td>
                          <td style={{ padding: '10px 14px' }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.faltan.length ? m.faltan.map((f: string) => <Chip key={f} c={C.ambar}>{f}</Chip>) : <Chip c={C.verde}>Completo</Chip>}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {movsVista.length > 400 && <p style={{ padding: '10px 14px', margin: 0, fontSize: 12, color: C.sub }}>Se muestran 400 de {movsVista.length.toLocaleString('es-CO')}. La descarga las trae todas.</p>}
                </div>)}

            {vista === 'contrapartes' && (contrasVista.length === 0
              ? <p style={{ padding: 18, margin: 0, color: C.sub, fontSize: 13 }}>{q ? 'Nada con esa búsqueda.' : 'Sin contrapartes en el período.'}</p>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                    <thead><tr style={{ color: C.tenue, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'left' }}>
                      {['Contraparte', 'Operaciones', 'Te pagó', 'Le pagaste'].map(h => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {contrasVista.slice(0, 400).map((c, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.borde}` }}>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ display: 'block', fontWeight: 700 }}>{c.nombre ?? (c.cuenta ? 'Wallet' : '—')}</span>
                            <span style={{ display: 'block', color: c.documento || c.nombre === 'Lincoin' || (!c.nombre && c.cuenta) ? C.sub : '#FCD34D', fontSize: 11.5, fontFamily: !c.nombre && c.cuenta ? 'ui-monospace, monospace' : undefined }} title={c.cuenta ?? ''}>
                              {c.documento ? `${c.tipoDoc ?? ''} ${c.documento}` : c.nombre === 'Lincoin' ? 'Compra o venta de activos virtuales' : !c.nombre && c.cuenta ? corto(c.cuenta) : 'Sin documento guardado'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>{c.operaciones}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: c.recibidoCop ? C.verde : C.tenue }}>{c.recibidoCop ? cop(c.recibidoCop) : '—'}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: c.enviadoCop ? C.texto : C.tenue }}>{c.enviadoCop ? cop(c.enviadoCop) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>)}

            {vista === 'envios' && ((datos.envios ?? []).length === 0
              ? <p style={{ padding: 18, margin: 0, color: C.sub, fontSize: 13 }}>Todavía no has anotado ningún radicado.</p>
              : (datos.envios as any[]).map((e, i) => (
                <div key={e.id} style={{ padding: '11px 15px', borderTop: i ? `1px solid ${C.borde}` : 'none' }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{TIPO_ENVIO[e.tipo] ?? e.tipo} · {e.periodo}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.sub }}>Radicado {e.radicado}{e.filas != null ? ` · ${e.filas} registros` : ''} · {fechaHora(e.at)}</span>
                </div>
              )))}
          </div>
          <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0', lineHeight: 1.5 }}>
            Solo transacciones completadas, en hora de Bogotá. Si a un cobro le falta el documento de quien pagó es porque el banco no lo envió. El archivo con el formato exacto de la UIAF se arma con su anexo técnico; este Excel trae los datos para llenarlo.
          </p>
        </>
      )}
    </div>
  );
};
