import React, { useEffect, useRef, useState } from 'react';
import { Database, RefreshCw, Search, ChevronDown, Trash2, FileDown } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────────────────────
// Lincoin Risk — el padrón de consultas de antecedentes.
//
// Cada consulta de antecedentes se paga (hoy a Sarblock; antes a TusDatos,
// que ya no se usa). El veredicto se guardaba dentro
// de la cuenta que lo pidió, así que si INVERSIONES consulta a Juan Pérez y
// mañana MEXITECH inscribe al mismo Juan Pérez, se pagaba otra vez por
// exactamente el mismo dato.
//
// Acá vive UNA ficha por documento, compartida por todas las cuentas. Antes
// de gastar un crédito se mira este padrón.
//
// POR DOCUMENTO, NUNCA POR NOMBRE. Dos personas se llaman igual y una misma
// persona se escribe de cinco formas. El documento es lo único que identifica.
//
// Lo que se comparte son los ANTECEDENTES —que son de la persona y no cambian
// según quién pregunte— y el nombre real del documento. Si el nombre que
// escribió el cliente coincide se sigue calculando por inscripción: una
// empresa pudo escribirlo bien y otra mal.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', greenB: 'rgba(74,222,128,0.3)',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';

const cop = (n: number) => `${Math.round(n || 0).toLocaleString('es-CO')} COP`;
const num = (n: number) => Number(n || 0).toLocaleString('es-CO');
const fecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const mask = (d?: string | null) => {
  const s = String(d ?? '');
  return s.length > 4 ? `···${s.slice(-4)}` : (s || '—');
};

const CAT: Record<string, { t: string; fuerte?: boolean; ok?: boolean }> = {
  alto: { t: 'RIESGO ALTO', fuerte: true },
  medio: { t: 'RIESGO MEDIO' },
  bajo: { t: 'RIESGO BAJO', ok: true },
  ninguno: { t: 'SIN HALLAZGOS', ok: true },
  informativo: { t: 'INFORMATIVO', ok: true },
  sin_validar: { t: 'SIN VALIDAR' },
};

export const AdminLincoinRisk: React.FC = () => {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  // Un error de búsqueda ya no reemplaza la pantalla entera: se avisa arriba
  // y se mantiene lo último que sí cargó (y el buscador, para corregir).
  const [aviso, setAviso] = useState<{ ok: boolean; t: string } | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  // Ventana propia para confirmar (antes: confirm()/prompt() del navegador,
  // que dicen "lincoin.me dice" y no se ven como el panel).
  const [confirmar, setConfirmar] = useState<{ tipo: 'una'; p: any } | { tipo: 'todas' } | { tipo: 'reconsultar'; p: any } | null>(null);
  const [escrito, setEscrito] = useState('');
  const turno = useRef(0);

  const cargar = async (buscar = q) => {
    const mio = ++turno.current;
    setBusy(true);
    const r = await llamarFuncion('tusdatos', { action: 'risk', q: buscar }).catch(() => null);
    if (mio !== turno.current) return;   // llegó tarde: ya se pidió otra búsqueda
    setBusy(false);
    if (!r || r.error) {
      if (!d) setD(r ?? { error: 'Sin respuesta.' });
      else setAviso({ ok: false, t: `No se pudo buscar: ${r?.error ?? 'sin respuesta del servidor'}.` });
      return;
    }
    setAviso(null);
    setD(r);
  };
  useEffect(() => { cargar(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // Busca solo mientras se escribe (con una pausa corta), sin tener que
  // apretar Enter.
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    const t = setTimeout(() => cargar(q), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const borrarUna = async (p: any) => {
    setConfirmar(null);
    const id = `${p.tipoDocumento}:${p.documento}`;
    setBorrando(id);
    const r = await llamarFuncion('tusdatos', { action: 'risk_borrar', tipoDocumento: p.tipoDocumento, documento: p.documento }).catch(() => null);
    setBorrando(null);
    if (!r?.ok) { setAviso({ ok: false, t: r?.error ?? 'No se pudo eliminar.' }); return; }
    setAviso({ ok: true, t: 'Consulta eliminada del padrón.' });
    setAbierto(null);
    cargar();
  };
  // El PDF de la consulta. Una ficha de Sarblock arma el reporte completo con
  // marca Lincoin (el mismo que baja la cuenta que la consultó). Una de la
  // época de TusDatos —que ya no se usa, y cuyo PDF vence— baja el resumen con
  // marca Lincoin de lo que quedó guardado. Se pide al tocar el botón: el
  // listado no trae la ficha completa (pesa).
  const [pdfDe, setPdfDe] = useState<string | null>(null);
  const descargarPdf = async (p: any) => {
    const id = `${p.tipoDocumento}:${p.documento}`;
    if (pdfDe) return;
    setPdfDe(id);
    try {
      if (p.pdf === 'lincoin') {
        const r = await llamarFuncion('tusdatos', { action: 'risk_ficha', tipoDocumento: p.tipoDocumento, documento: p.documento }).catch(() => null);
        if (!r?.ok || !r.ficha) { setAviso({ ok: false, t: r?.error ?? 'No se pudo leer la ficha de esa consulta.' }); return; }
        const { descargarReporteLincoin } = await import('./reporte/ReporteLincoin');
        await descargarReporteLincoin({
          ...r.ficha,
          documento: r.ficha.documento ?? p.documento, tipoDocumento: r.ficha.tipoDocumento ?? p.tipoDocumento,
          ...(r.empresa?.nombre ? { empresa: r.empresa } : {}), consultadoAt: r.ficha.consultadoAt ?? r.consultadoAt ?? p.consultadoAt,
        });
        return;
      }
      if (p.pdf === 'resumen' || p.pdf === 'tusdatos') {
        const f = await llamarFuncion('tusdatos', { action: 'risk_ficha', tipoDocumento: p.tipoDocumento, documento: p.documento }).catch(() => null);
        if (!f?.ok || !f.resumen) { setAviso({ ok: false, t: f?.error ?? 'No se pudo leer la consulta.' }); return; }
        const { descargarReporteLincoin } = await import('./reporte/ReporteLincoin');
        await descargarReporteLincoin({ ...f.resumen, ...(f.empresa?.nombre ? { empresa: f.empresa } : {}), consultadoAt: f.consultadoAt ?? p.consultadoAt, at: f.consultadoAt ?? p.consultadoAt });
        return;
      }
      setAviso({ ok: false, t: 'Esta consulta no tiene PDF guardado.' });
    } catch {
      setAviso({ ok: false, t: 'No se pudo generar el PDF. Vuelve a intentarlo.' });
    } finally { setPdfDe(null); }
  };

  // Volver a consultar en Sarblock una ficha vieja de TusDatos (sin detalle).
  // Se paga una consulta; el resultado actualiza la ficha del beneficiario en
  // la cuenta que la tiene y el padrón, y desde ahí el PDF sale completo.
  const [reconsultando, setReconsultando] = useState<string | null>(null);
  const reconsultar = async (p: any) => {
    setConfirmar(null);
    const id = `${p.tipoDocumento}:${p.documento}`;
    setReconsultando(id);
    const r = await llamarFuncion('sarblock', { action: 'admin_risk_reconsultar', tipoDocumento: p.tipoDocumento, documento: p.documento }, 60000).catch(() => null);
    setReconsultando(null);
    if (!r?.ok) { setAviso({ ok: false, t: r?.motivo ?? r?.error ?? 'No se pudo volver a consultar.' }); return; }
    setAviso({ ok: true, t: r.checkId
      ? `Consulta enviada a Sarblock${r.cuentaNombre ? ` por la cuenta de ${r.cuentaNombre}` : ''}. El resultado llega en uno o dos minutos: toca «Actualizar» y luego «Descargar PDF» para el reporte completo.`
      : r.yaExistia ? 'Esa ficha ya tenía un resultado vigente; no se volvió a consultar.'
      : 'Consulta actualizada. Toca «Actualizar» para ver el resultado.' });
  };

  const borrarTodas = async () => {
    if (escrito.trim() !== 'ELIMINAR') return;
    setConfirmar(null); setEscrito('');
    setBorrando('*');
    const r = await llamarFuncion('tusdatos', { action: 'risk_borrar', todos: true, confirmacion: 'ELIMINAR' }).catch(() => null);
    setBorrando(null);
    if (!r?.ok) { setAviso({ ok: false, t: r?.error ?? 'No se pudo eliminar.' }); return; }
    setAviso({ ok: true, t: `Padrón vaciado${r.borradas != null ? `: ${r.borradas} consultas eliminadas` : ''}.` });
    setQ('');
    cargar('');
  };

  if (!d) {
    return <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>Cargando el padrón…</div>;
  }
  if (d.error) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13, lineHeight: 1.6 }}>
        {d.error}
        {/* "No se encuentra la tabla" tiene TRES causas que se leen igual: la
            migración no se corrió, la tabla no tiene permiso para el servidor,
            o el servidor está mirando OTRA base. La tercera es la que costó
            más de encontrar, porque no se veía desde ninguna pantalla: por eso
            ahora el servidor dice a qué base le preguntó. */}
        {d.base ? (
          <p style={{ marginTop: 10, color: C.sub, fontSize: 12 }}>
            El servidor le preguntó a la base{' '}
            <b style={{ color: C.text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{d.base}…</b>{' '}
            — comprobá que sea la misma donde corriste la migración.
          </p>
        ) : null}
        <p style={{ marginTop: 8, color: C.dim, fontSize: 12 }}>
          Si dice que no encuentra la tabla: puede faltar la migración del padrón,
          puede que la tabla exista sin permiso para el servidor, o puede que el
          servidor esté consultando otra base. Las tres se leen igual. Comprobalo
          antes de volver a correr nada.
        </p>
      </div>
    );
  }

  const r = d.resumen ?? {};
  const personas: any[] = d.personas ?? [];

  return (
    <div style={{ fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Cabecera */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0, color: C.text }}>
              <Database size={16} color={C.sub} /> Lincoin Risk
            </p>
            <p style={{ color: C.sub, fontSize: 12, margin: '6px 0 0', maxWidth: 680, lineHeight: 1.55 }}>
              Una ficha por documento, compartida por todas las cuentas. Antes de pagarle una consulta
              a Sarblock se mira acá: si otra empresa ya consultó a esa persona y el dato sigue vigente,
              se reutiliza. Se busca <b style={{ color: C.text }}>por documento</b>, nunca por nombre.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => { setEscrito(''); setConfirmar({ tipo: 'todas' }); }} disabled={busy || borrando !== null}
              className="hover:bg-white/[0.09] transition-colors"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, padding: '8px 13px', borderRadius: 9, opacity: borrando === '*' ? 0.6 : 1 }}>
              <Trash2 size={13} /> {borrando === '*' ? 'Eliminando…' : 'Eliminar todas'}
            </button>
            <button onClick={() => cargar()} disabled={busy}
              className="hover:opacity-90 transition-opacity"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#0A0A0A', background: C.text, border: 'none', padding: '8px 13px', borderRadius: 9, opacity: busy ? 0.6 : 1 }}>
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Actualizar
            </button>
          </div>
        </div>
        {d.config && (
          <p style={{ fontSize: 11.5, color: C.dim, margin: '10px 0 0' }}>
            {d.config.activo
              ? `Activo · un resultado vale ${d.config.dias} días; pasados, se vuelve a consultar.`
              : 'Apagado — ahora mismo cada inscripción paga su propia consulta.'}
          </p>
        )}
      </div>

      {/* El ahorro, que es el punto */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          { n: r.ahorroCop != null ? cop(r.ahorroCop) : num(r.consultasAhorradas ?? 0), t: r.ahorroCop != null ? `${num(r.consultasAhorradas ?? 0)} consultas que no se pagaron` : 'Consultas que no se pagaron', ok: true },
          { n: num(r.personas ?? 0), t: 'Personas en el padrón' },
          { n: r.gastoCop != null ? cop(r.gastoCop) : num(r.consultasPagadas ?? 0), t: r.gastoCop != null ? `${num(r.consultasPagadas ?? 0)} consultas pagadas` : 'Consultas pagadas' },
          { n: num(r.alto ?? 0), t: 'De riesgo alto' },
          { n: num(r.limpios ?? 0), t: 'Sin hallazgos o riesgo bajo', ok: true },
        ].map(s => (
          <div key={s.t} style={{ background: C.card, border: `1px solid ${s.ok ? 'rgba(74,222,128,0.25)' : C.border}`, borderRadius: 12, padding: '13px 15px' }}>
            <p style={{ fontSize: s.n.length > 12 ? 17 : 21, fontWeight: 800, color: s.ok ? C.green : C.text, margin: 0, lineHeight: 1.15 }}>{s.n}</p>
            <p style={{ fontSize: 11.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.35 }}>{s.t}</p>
          </div>
        ))}
      </div>

      {aviso && (
        <div role="status" style={{ background: C.card, border: `1px solid ${aviso.ok ? C.greenB : C.border2}`, borderRadius: 11, padding: '10px 13px', fontSize: 12.5, color: aviso.ok ? C.green : C.text }}>
          {aviso.t}
        </div>
      )}

      {/* Buscador: documento (también NIT con o sin dígito de verificación) o nombre */}
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.sub }} />
        <input value={q}
          onChange={e => setQ(e.target.value.slice(0, 80))}
          onKeyDown={e => { if (e.key === 'Enter') cargar(); }}
          placeholder="Buscar por documento o nombre…"
          style={{ width: '100%', height: 38, paddingLeft: 34, paddingRight: 12, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, outline: 'none', fontFamily: FONT }} />
      </div>

      {/* El padrón */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        {personas.length === 0 && (
          <p style={{ padding: 20, fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.6 }}>
            {q
              ? 'No hay nadie en el padrón con ese documento o nombre. La próxima vez que alguien lo inscriba se consultará y quedará acá.'
              : 'El padrón está vacío. Se va llenando solo con cada consulta que se hace.'}
          </p>
        )}
        {personas.map((p, i) => {
          const id = `${p.tipoDocumento}:${p.documento}`;
          const ab = abierto === id;
          const c = CAT[String(p.categoria ?? '')] ?? { t: String(p.categoria ?? 'SIN RESULTADO').toUpperCase() };
          return (
            <div key={id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.border}` }}>
              <button onClick={() => setAbierto(ab ? null : id)}
                className="hover:bg-white/[0.02] transition-colors"
                style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>
                    {p.nombreReal || 'Sin nombre en el documento'}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.sub, fontFamily: MONO, marginTop: 2 }}>
                    {p.tipoDocumento} {mask(p.documento)}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 4, lineHeight: 1.4 }}>
                    Consultado {fecha(p.consultadoAt)}
                    {p.vecesReutilizado > 0 && <> · <b style={{ color: C.green }}>reutilizado {p.vecesReutilizado} {p.vecesReutilizado === 1 ? 'vez' : 'veces'}</b></>}
                    {p.empresas > 1 && ` · ${p.empresas} empresas`}
                    {p.fuente === 'monitoreo' && ' · actualizado por monitoreo'}
                  </span>
                </span>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 999,
                  whiteSpace: 'nowrap', flexShrink: 0,
                  border: `1px solid ${c.ok ? C.greenB : c.fuerte ? 'rgba(255,255,255,0.2)' : C.border2}`,
                  color: c.ok ? C.green : c.fuerte ? C.text : C.sub,
                }}>{c.t}</span>
                <ChevronDown size={15} style={{ color: C.sub, flexShrink: 0, transform: ab ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
              </button>

              {ab && (
                <div style={{ padding: '0 16px 16px' }}>
                  <div style={{ background: C.elev, border: `1px solid ${C.border}`, borderRadius: 11, padding: '12px 14px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                      {[
                        ['Hallazgos', `${p.altos ?? 0} altos · ${p.medios ?? 0} medios · ${p.bajos ?? 0} bajos`],
                        ['Documento', p.documentoVigente === false ? `No vigente${p.estadoDocumento ? `: ${p.estadoDocumento}` : ''}` : 'Vigente'],
                        ['Última actualización', fecha(p.actualizadoAt)],
                        ['Consultas pagadas', `${p.vecesConsultado ?? 1}${r.costoUnitario ? ` · ${cop((p.vecesConsultado ?? 1) * r.costoUnitario)}` : ''}`],
                        ['Consultas ahorradas', `${p.vecesReutilizado ?? 0}${r.costoUnitario ? ` · ${cop((p.vecesReutilizado ?? 0) * r.costoUnitario)}` : ''}`],
                        ['Proveedor', p.deSarblock || p.pdf === 'lincoin' ? 'Sarblock' : 'TusDatos (consulta vieja)'],
                      ].map(([l, v]) => (
                        <div key={String(l)}>
                          <p style={{ fontSize: 10.5, color: C.sub, margin: 0 }}>{l}</p>
                          <p style={{ fontSize: 12.5, color: C.text, fontWeight: 600, margin: '2px 0 0' }}>{v}</p>
                        </div>
                      ))}
                    </div>
                    {/* Quién la consultó o la inscribió, en orden: la primera
                        pagó la consulta que creó la ficha; las demás la
                        reutilizaron (o la volvieron a consultar al vencerse). */}
                    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                      <p style={{ fontSize: 10.5, color: C.sub, margin: '0 0 6px' }}>Clientes que la consultaron o inscribieron</p>
                      {Array.isArray(p.consultantes) && p.consultantes.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {p.consultantes.map((e: any, k: number) => (
                            <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                              <span style={{ color: C.text, fontWeight: 600, overflowWrap: 'anywhere' }}>{e.nombre}</span>
                              <span style={{ fontSize: 11, color: C.sub }}>
                                {[e.tipo, e.nit ? `NIT ${e.nit}` : ''].filter(Boolean).join(' · ')}
                              </span>
                              {k === 0 && (
                                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.4px', padding: '2px 7px', borderRadius: 999, border: `1px solid ${C.greenB}`, color: C.green }}>
                                  PAGÓ LA CONSULTA
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: 12, color: C.dim, margin: 0 }}>
                          {p.fuente === 'monitoreo' ? 'La creó el monitoreo; ninguna cuenta la ha usado todavía.' : 'Sin registro de qué cuenta la pidió.'}
                        </p>
                      )}
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                      {(p.pdf === 'tusdatos' || p.pdf === 'resumen') && (
                        <button onClick={() => setConfirmar({ tipo: 'reconsultar', p })} disabled={reconsultando !== null}
                          className="hover:bg-white/[0.09] transition-colors"
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, padding: '7px 12px', borderRadius: 9, opacity: reconsultando === id ? 0.6 : 1 }}>
                          <RefreshCw size={12} className={reconsultando === id ? 'animate-spin' : ''} /> {reconsultando === id ? 'Consultando…' : 'Consultar de nuevo con detalle completo'}
                        </button>
                      )}
                      {p.pdf && (
                        <button onClick={() => descargarPdf(p)} disabled={pdfDe !== null}
                          className="hover:opacity-90 transition-opacity"
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#0A0A0A', background: C.text, border: 'none', padding: '7px 12px', borderRadius: 9, opacity: pdfDe === id ? 0.6 : 1, cursor: pdfDe ? 'default' : 'pointer' }}>
                          <FileDown size={12} /> {pdfDe === id ? 'Generando PDF…' : 'Descargar PDF'}
                        </button>
                      )}
                      <button onClick={() => setConfirmar({ tipo: 'una', p })} disabled={borrando !== null}
                        className="hover:bg-white/[0.09] transition-colors"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, padding: '7px 12px', borderRadius: 9, opacity: borrando === id ? 0.6 : 1 }}>
                        <Trash2 size={12} /> {borrando === id ? 'Eliminando…' : 'Eliminar del padrón'}
                      </button>
                    </div>
                    {Array.isArray(p.hallazgos) && p.hallazgos.length > 0 && (
                      <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {p.hallazgos.slice(0, 10).map((h: any, k: number) => (
                          <div key={k} style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.45 }}>
                            <span style={{ color: C.text }}>{String(h?.nivel ?? '').toUpperCase()}</span> · {h?.texto ?? ''}
                            {h?.fuente ? <span style={{ display: 'block', color: C.dim, fontFamily: MONO, fontSize: 10.5 }}>{h.fuente}</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {personas.length > 0 && (
          <div style={{ borderTop: `1px solid ${C.border}`, padding: '11px 16px', fontSize: 11.5, color: C.sub }}>
            {personas.length} de {num(r.personas ?? personas.length)} personas
          </div>
        )}
      </div>
      {/* ══ Confirmar eliminación ══ */}
      {confirmar && (
        <div onClick={() => setConfirmar(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,4,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
            onKeyDown={e => { if (e.key === 'Escape') setConfirmar(null); }}
            style={{ width: '100%', maxWidth: 460, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.055)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {confirmar.tipo === 'reconsultar' ? <RefreshCw size={16} color={C.text} /> : <Trash2 size={16} color={C.text} />}
              </span>
              <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>
                {confirmar.tipo === 'una' ? '¿Eliminar del padrón?' : confirmar.tipo === 'reconsultar' ? '¿Consultar de nuevo con detalle completo?' : '¿Eliminar todas las consultas?'}
              </p>
            </div>

            {confirmar.tipo === 'reconsultar' ? (
              <>
                <div style={{ marginTop: 14, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 11, padding: '11px 13px' }}>
                  <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, overflowWrap: 'anywhere' }}>{confirmar.p.nombreReal || 'Sin nombre en el documento'}</p>
                  <p style={{ fontSize: 11.5, color: C.sub, fontFamily: MONO, margin: '3px 0 0' }}>{confirmar.p.tipoDocumento} {confirmar.p.documento}</p>
                </div>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '12px 0 0', lineHeight: 1.55 }}>
                  Esta ficha es de una consulta vieja, de cuando se usaba TusDatos: solo quedó el resumen. Se consulta en Sarblock para tener el
                  <b style={{ color: C.text }}> reporte completo, fuente por fuente</b>. <b style={{ color: C.text }}>Se paga una consulta de Sarblock.</b>
                </p>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '8px 0 0', lineHeight: 1.55 }}>
                  Se hace por la cuenta que la tiene entre sus beneficiarios{Array.isArray(confirmar.p.consultantes) && confirmar.p.consultantes[0] ? <> (primero se intenta <b style={{ color: C.text }}>{confirmar.p.consultantes[0].nombre}</b>)</> : null}.
                  El resultado nuevo reemplaza el veredicto de ese beneficiario: si sale algo más grave, puede quedar bloqueado.
                </p>
              </>
            ) : confirmar.tipo === 'una' ? (
              <>
                <div style={{ marginTop: 14, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 11, padding: '11px 13px' }}>
                  <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, overflowWrap: 'anywhere' }}>{confirmar.p.nombreReal || 'Sin nombre en el documento'}</p>
                  <p style={{ fontSize: 11.5, color: C.sub, fontFamily: MONO, margin: '3px 0 0' }}>{confirmar.p.tipoDocumento} {confirmar.p.documento}</p>
                </div>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '12px 0 0', lineHeight: 1.55 }}>
                  La próxima vez que alguien la inscriba o se reintente su consulta, se le volverá a consultar en Sarblock y se paga la consulta.
                  Lo que ya quedó guardado en cada cuenta no cambia.
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '12px 0 0', lineHeight: 1.55 }}>
                  Se eliminan las <b style={{ color: C.text }}>{num(r.personas ?? 0)}</b> consultas del padrón. Desde ahí, cada persona se vuelve a consultar
                  en Sarblock (y se paga) la próxima vez que se inscriba. Lo que ya quedó guardado en cada cuenta no cambia.
                </p>
                <label style={{ display: 'block', marginTop: 14 }}>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginBottom: 5 }}>Para confirmar escribe <b style={{ color: C.text }}>ELIMINAR</b></span>
                  <input value={escrito} onChange={e => setEscrito(e.target.value)} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter' && escrito.trim() === 'ELIMINAR') borrarTodas(); }}
                    style={{ width: '100%', height: 38, padding: '0 11px', borderRadius: 9, background: C.elev, border: `1px solid ${C.border2}`, color: C.text, fontSize: 13, fontFamily: MONO, outline: 'none' }} />
                </label>
              </>
            )}

            <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
              <button onClick={() => setConfirmar(null)} autoFocus={confirmar.tipo !== 'todas'}
                className="hover:bg-white/[0.09] transition-colors"
                style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, cursor: 'pointer' }}>
                Cancelar
              </button>
              {(() => {
                const listo = confirmar.tipo === 'una' || confirmar.tipo === 'reconsultar' || escrito.trim() === 'ELIMINAR';
                return (
                  <button disabled={!listo}
                    onClick={() => { if (confirmar.tipo === 'una') borrarUna(confirmar.p); else if (confirmar.tipo === 'reconsultar') reconsultar(confirmar.p); else borrarTodas(); }}
                    className="hover:opacity-90 transition-opacity"
                    style={{ flex: 1.3, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, color: '#0A0A0A', background: C.text, border: 'none', opacity: listo ? 1 : 0.4, cursor: listo ? 'pointer' : 'not-allowed' }}>
                    {confirmar.tipo === 'una' ? 'Eliminar' : confirmar.tipo === 'reconsultar' ? 'Consultar (se paga)' : 'Eliminar todas'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
