import React, { useEffect, useMemo, useState } from 'react';
import { ShieldAlert, RefreshCw, FileText, Send, ChevronDown, Search, Download } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────────────────────
// AdminCompliance — la bandeja de cumplimiento.
//
// Un veredicto guardado en el perfil de cada usuario no sirve de nada si
// nadie lo mira. Acá se juntan todos los beneficiarios de todas las cuentas
// y se separan los que piden atención de los que están en orden.
//
// EL ORDEN NO ES ALFABÉTICO NI CRONOLÓGICO, ES POR GRAVEDAD.
// Primero lo que ya está frenando una operación —una identidad que no
// corresponde, un documento cancelado, un riesgo alto—, después lo que está
// a la espera.
//
// QUIÉN CONSULTÓ. Cada caso dice qué cuenta inscribió a esa persona, con su
// razón social, su NIT y su correo. Sin eso no se puede armar un reporte a la
// UIAF: un ROS necesita nombrar al reportante, no un id interno. Y la
// concentración —una misma empresa inscribiendo a varias personas de riesgo
// alto— no es mala suerte, es el patrón que se reporta.
//
// SIN SEMÁFORO. Los rojos y amarillos hacían que todo pareciera una alarma y
// en una semana se dejan de ver. El estado se lee, no se colorea: verde solo
// para lo que está en orden.
// ─────────────────────────────────────────────────────────────

const C = {
  doc: '#070808', card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', greenB: 'rgba(74,222,128,0.3)',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';

const call = (body: any) => llamarFuncion('tusdatos', body);

// Cada alerta con su nombre en claro y qué significa. `fuerte` marca lo que
// está frenando una operación ahora mismo — se distingue por el borde, no
// por el color.
const ALERTA: Record<string, { texto: string; explica: string; fuerte?: boolean }> = {
  nombre_no_coincide: { texto: 'NOMBRE INCORRECTO', fuerte: true, explica: 'El nombre inscrito no es el del documento. No se sabe a quién se le estaría transfiriendo.' },
  documento_no_vigente: { texto: 'DOCUMENTO NO VIGENTE', fuerte: true, explica: 'La cédula está cancelada. Revisa el motivo: muerte y suplantación son las señales más graves.' },
  riesgo_alto: { texto: 'RIESGO ALTO', fuerte: true, explica: 'Hallazgos de riesgo alto en las fuentes consultadas.' },
  riesgo_medio: { texto: 'RIESGO MEDIO', explica: 'Hallazgos de riesgo medio. Requiere una decisión: aprobar o dejar bloqueado.' },
  sin_validar: { texto: 'SIN VALIDAR', explica: 'No se pudo validar el documento, así que no se sabe de quién son los antecedentes. No bloquea.' },
  consulta_fallida: { texto: 'CONSULTA FALLIDA', explica: 'La consulta no se completó. No bloquea; conviene volver a lanzarla.' },
  sin_autorizacion: { texto: 'SIN AUTORIZACIÓN', explica: 'El titular del documento no autoriza la consulta de su información. Es un derecho suyo y no bloquea.' },
  en_curso: { texto: 'EN CURSO', explica: 'La consulta está corriendo. Suele tardar cerca de un minuto.' },
};

const fmt = (n: number) => Number(n || 0).toLocaleString('es-CO');
const hace = (iso?: string | null) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `hace ${d} d` : `hace ${Math.floor(d / 30)} meses`;
};
// El documento se enmascara: en una pantalla que alguien puede estar mirando
// por encima del hombro no hace falta la cédula completa para reconocer un caso.
const mask = (d?: string | null) => {
  const s = String(d ?? '');
  return s.length > 4 ? `···${s.slice(-4)}` : (s || '—');
};

const Pill: React.FC<{ children: React.ReactNode; tono?: 'ok' | 'fuerte' | 'suave'; titulo?: string }> = ({ children, tono = 'suave', titulo }) => (
  <span title={titulo} style={{
    display: 'inline-block', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px',
    padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    border: `1px solid ${tono === 'ok' ? C.greenB : tono === 'fuerte' ? 'rgba(255,255,255,0.2)' : C.border2}`,
    color: tono === 'ok' ? C.green : tono === 'fuerte' ? C.text : C.sub,
  }}>{children}</span>
);

const Toggle: React.FC<{ on: boolean; onChange: () => void; label: string }> = ({ on, onChange, label }) => (
  <button onClick={onChange} role="switch" aria-checked={on} aria-label={label}
    style={{
      width: 36, height: 20, borderRadius: 999, flexShrink: 0, border: 'none', cursor: 'pointer',
      background: on ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)',
      position: 'relative', transition: 'background 150ms',
    }}>
    <span style={{
      position: 'absolute', top: 3, left: on ? 19 : 3, width: 14, height: 14, borderRadius: '50%',
      background: on ? C.green : C.sub, transition: 'left 150ms',
    }} />
  </button>
);

export const AdminCompliance: React.FC = () => {
  const [datos, setDatos] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [filtro, setFiltro] = useState<string>('todo');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [verHallazgos, setVerHallazgos] = useState<string | null>(null);
  const [decidiendo, setDecidiendo] = useState<{ caso: any; decision: 'aprobar' | 'mantener' } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    setBusy(true);
    const d = await call({ action: 'compliance' }).catch(() => null);
    setDatos(d ?? { error: 'Sin respuesta.' });
    setBusy(false);
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const verPdf = async (c: any) => {
    if (!c.reportId) return;
    setMsg(null);
    const r = await call({ action: 'pdf', userId: c.userId, reportId: c.reportId });
    if (!r?.ok) { setMsg({ ok: false, texto: r?.motivo ?? 'No se pudo abrir el reporte.' }); return; }
    try {
      const bin = atob(r.pdf);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setMsg({ ok: false, texto: 'No se pudo abrir el reporte.' }); }
  };

  const mandarAKumplo = async (c: any) => {
    setMsg(null);
    const r = await call({ action: 'enviar_kumplo', userId: c.userId, documento: c.esTitular ? '' : c.documento });
    setMsg({ ok: !!r?.ok, texto: r?.ok ? 'Enviado a Kumplo.' : (r?.motivo ?? r?.respuesta ?? 'No se pudo enviar.') });
    if (r?.ok) cargar();
  };

  const reintentar = async (c: any) => {
    setMsg(null);
    const r = await call({ action: 'reintentar', userId: c.userId, documento: c.esTitular ? '' : c.documento });
    setMsg({ ok: !!r?.ok, texto: r?.ok ? 'Consulta relanzada.' : (r?.motivo ?? 'No se pudo relanzar.') });
    if (r?.ok) cargar();
  };

  const confirmarDecision = async () => {
    if (!decidiendo || guardando) return;
    if (!motivo.trim()) { setMsg({ ok: false, texto: 'Escribe por qué tomas esta decisión.' }); return; }
    setGuardando(true);
    const r = await call({
      action: 'decidir', userId: decidiendo.caso.userId,
      documento: decidiendo.caso.documento, decision: decidiendo.decision, motivo: motivo.trim(),
    });
    setGuardando(false);
    if (!r?.ok) { setMsg({ ok: false, texto: r?.error ?? 'No se pudo guardar la decisión.' }); return; }
    setDecidiendo(null); setMotivo('');
    setMsg({ ok: true, texto: 'Decisión guardada y registrada en auditoría.' });
    cargar();
  };

  // ── Exportar para el reporte ──────────────────────────────────────────
  // Un CSV con la empresa que consultó, la persona consultada, el veredicto y
  // la fecha. Es lo que hace falta para armar un ROS: sin la columna del
  // reportante, el archivo no sirve.
  const exportar = () => {
    const casos: any[] = datos?.casos ?? [];
    const col = [
      'empresa_razon_social', 'empresa_tipo_documento', 'empresa_documento', 'empresa_correo',
      'empresa_tipo_cuenta', 'empresa_pais', 'empresa_cliente_desde',
      'persona_nombre_inscrito', 'persona_nombre_documento', 'persona_tipo_documento', 'persona_documento',
      'alerta', 'categoria_riesgo', 'hallazgos_altos', 'hallazgos_medios', 'hallazgos_bajos',
      'nombre_coincide', 'documento_vigente', 'operable', 'motivo_bloqueo',
      'id_reporte_tusdatos', 'fecha_consulta', 'enviado_a_kumplo',
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const filas = casos.map(c => [
      c.cliente?.nombre, c.cliente?.tipoDocumento, c.cliente?.documento, c.cliente?.email,
      c.cliente?.tipo, c.cliente?.pais, c.cliente?.desde,
      c.nombreInscrito, c.nombreReal, c.tipoDocumento, c.documento,
      ALERTA[c.alerta]?.texto ?? c.alerta, c.categoria, c.altos, c.medios, c.bajos,
      c.nombreCoincide, c.documentoVigente, c.operable, c.bloqueo,
      c.reportId, c.at, c.enviadoAKumplo,
    ].map(esc).join(';'));
    // Punto y coma y BOM: es lo que abre bien Excel en español.
    const csv = '﻿' + [col.join(';'), ...filas].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `lincoin-cumplimiento-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setMsg({ ok: true, texto: `Exportados ${casos.length} casos con la empresa que consultó cada uno.` });
  };

  const casos: any[] = datos?.casos ?? [];
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return casos.filter(c => {
      if (filtro !== 'todo' && c.alerta !== filtro) return false;
      if (!t) return true;
      return [c.nombreInscrito, c.nombreReal, c.documento, c.cliente?.nombre, c.cliente?.email, c.cliente?.documento]
        .some(v => String(v ?? '').toLowerCase().includes(t));
    });
  }, [casos, filtro, q]);

  if (!datos) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>
        Cargando los casos de cumplimiento…
      </div>
    );
  }
  if (datos.error) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>
        {datos.error}
      </div>
    );
  }

  const r = datos.resumen ?? {};
  const porCliente: any[] = datos.porCliente ?? [];
  const maxAltos = Math.max(1, ...porCliente.map(p => p.altos || 0));

  const stats: { k: string; n: number; t: string; ok?: boolean }[] = [
    { k: 'todo', n: r.bloqueados ?? 0, t: 'Bloqueados' },
    { k: 'nombre_no_coincide', n: r.nombreNoCoincide ?? 0, t: 'Identidad no corresponde' },
    { k: 'riesgo_alto', n: r.alto ?? 0, t: 'Riesgo alto' },
    { k: 'riesgo_medio', n: r.medio ?? 0, t: 'Riesgo medio en revisión' },
    { k: 'en_curso', n: r.enCurso ?? 0, t: 'En curso (reintento)' },
    { k: 'en_orden', n: r.enOrden ?? 0, t: 'En orden', ok: true },
  ];

  const chips: { k: string; t: string }[] = [
    { k: 'todo', t: 'Todo' },
    { k: 'nombre_no_coincide', t: 'Nombre incorrecto' },
    { k: 'riesgo_alto', t: 'Riesgo alto' },
    { k: 'riesgo_medio', t: 'Riesgo medio' },
    { k: 'en_curso', t: 'En curso' },
  ];
  const cuenta = (k: string) => k === 'todo' ? casos.length : casos.filter(c => c.alerta === k).length;

  return (
    <div style={{ fontFamily: FONT, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
      <style>{`
        .cmp-foco:focus-visible { outline: 2px solid rgba(74,222,128,0.5); outline-offset: 2px; }
      `}</style>

      {/* ══ COLA DE CASOS ══ */}
      <div style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Topbar */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0, color: C.text }}>
                <ShieldAlert size={17} color={C.sub} /> Cumplimiento
                <Pill tono="ok"><span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: C.green, marginRight: 5 }} />SISTEMA ONLINE</Pill>
              </p>
              <p style={{ color: C.sub, fontSize: 12, margin: '6px 0 0', maxWidth: 620, lineHeight: 1.55 }}>
                Todo lo que se inscribe pasa por acá. Primero se valida que el nombre corresponda al
                documento; después, los antecedentes. Lo que no está en orden aparece arriba.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={exportar} className="cmp-foco hover:bg-white/[0.09] transition-colors"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, padding: '8px 13px', borderRadius: 9 }}>
                <Download size={13} /> Exportar reporte
              </button>
              <button onClick={cargar} disabled={busy} className="cmp-foco hover:opacity-90 transition-opacity"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#0A0A0A', background: C.text, border: 'none', padding: '8px 13px', borderRadius: 9, opacity: busy ? 0.6 : 1 }}>
                <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>
          </div>
        </div>

        {msg && (
          <div style={{ background: C.card, border: `1px solid ${msg.ok ? C.greenB : C.border2}`, borderRadius: 11, padding: '10px 13px', fontSize: 12.5, color: msg.ok ? C.green : C.text }}>
            {msg.texto}
          </div>
        )}

        {/* Stats — filtran la cola */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {stats.map(s => {
            const activo = filtro === s.k;
            return (
              <button key={s.t} onClick={() => setFiltro(s.k === 'en_orden' ? 'todo' : s.k)} className="cmp-foco hover:bg-white/[0.03] transition-colors"
                style={{
                  textAlign: 'left', background: C.card, borderRadius: 12, padding: '13px 15px', cursor: 'pointer',
                  border: `1px solid ${s.ok ? 'rgba(74,222,128,0.25)' : activo ? 'rgba(255,255,255,0.22)' : C.border}`,
                }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: s.ok ? C.green : C.text, margin: 0, lineHeight: 1.1 }}>{fmt(s.n)}</p>
                <p style={{ fontSize: 11.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.35 }}>{s.t}</p>
              </button>
            );
          })}
        </div>

        {/* Filtros + buscador */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
          {chips.map(ch => (
            <button key={ch.k} onClick={() => setFiltro(ch.k)} className="cmp-foco transition-colors"
              style={{
                fontSize: 11.5, fontWeight: 600, padding: '6px 11px', borderRadius: 999,
                border: `1px solid ${filtro === ch.k ? 'rgba(255,255,255,0.2)' : C.border}`,
                background: filtro === ch.k ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: filtro === ch.k ? C.text : C.sub,
              }}>
              {ch.t} <span style={{ color: C.dim }}>{cuenta(ch.k)}</span>
            </button>
          ))}
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.sub }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, documento o cliente…" className="cmp-foco"
              style={{ width: '100%', height: 34, paddingLeft: 32, paddingRight: 10, borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 12.5, outline: 'none', fontFamily: FONT }} />
          </div>
        </div>

        {/* Lista */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          {visibles.length === 0 && (
            <p style={{ padding: 20, fontSize: 12.5, color: C.sub, margin: 0 }}>
              {casos.length === 0 ? 'No hay casos que revisar. Todo lo inscrito está en orden.' : 'Ningún caso coincide con este filtro.'}
            </p>
          )}
          {visibles.map((c, i) => {
            const a = ALERTA[c.alerta] ?? { texto: String(c.alerta ?? '').toUpperCase(), explica: '' };
            const id = `${c.userId}:${c.documento}`;
            const ab = abierto === id;
            return (
              <div key={id + i} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.border}` }}>
                <button onClick={() => { setAbierto(ab ? null : id); setVerHallazgos(null); }} className="cmp-foco hover:bg-white/[0.02] transition-colors"
                  style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>
                      {c.nombreInscrito || c.nombreReal || 'Sin nombre'}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.sub, fontFamily: MONO, marginTop: 2 }}>
                      {c.tipoDocumento} {mask(c.documento)}{c.cliente?.pais ? ` · ${c.cliente.pais}` : ''}
                    </span>
                    {/* La trazabilidad: qué cuenta inscribió a esta persona. */}
                    <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 4, lineHeight: 1.4 }}>
                      Inscrito por <span style={{ color: C.text, fontWeight: 600, textDecoration: 'underline' }}>{c.cliente?.nombre ?? c.titular}</span>
                      {c.cliente?.email ? ` · ${c.cliente.email}` : ''} · {hace(c.at)}
                    </span>
                  </span>
                  <Pill tono={a.fuerte ? 'fuerte' : 'suave'} titulo={a.explica}>{a.texto}</Pill>
                  <ChevronDown size={15} style={{ color: C.sub, flexShrink: 0, transform: ab ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                </button>

                {ab && (
                  <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                    {/* Hallazgos */}
                    <div style={{ background: C.elev, border: `1px solid ${C.border}`, borderRadius: 11, padding: '12px 14px' }}>
                      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>HALLAZGOS TUSDATOS</p>
                      <p style={{ fontSize: 12, color: C.text, margin: '8px 0 0', lineHeight: 1.55 }}>
                        {c.nombreCoincide === false
                          ? `El nombre inscrito no corresponde al documento. Según la Registraduría la cédula pertenece a ${c.nombreReal ?? 'otra persona'}.`
                          : c.documentoVigente === false
                            ? `El documento no está vigente${c.estadoDocumento ? `: ${c.estadoDocumento}` : ''}.`
                            : c.alerta === 'consulta_fallida' || c.alerta === 'en_curso'
                              ? 'La consulta no ha terminado — sigue en reintento automático. No se aprueba con datos parciales.'
                              : a.explica}
                      </p>
                      {(c.altos || c.medios || c.bajos) ? (
                        <p style={{ fontSize: 11.5, color: C.sub, margin: '8px 0 0' }}>
                          {c.altos} altos · {c.medios} medios · {c.bajos} bajos
                        </p>
                      ) : null}
                      {Array.isArray(c.hallazgos) && c.hallazgos.length > 0 && (
                        <>
                          <button onClick={() => setVerHallazgos(verHallazgos === id ? null : id)} className="cmp-foco"
                            style={{ fontSize: 11.5, fontWeight: 600, color: C.text, background: 'transparent', border: 'none', padding: '8px 0 0', textDecoration: 'underline', cursor: 'pointer' }}>
                            {verHallazgos === id ? 'Ocultar detalle' : `Ver detalle · ${c.hallazgos.length}`}
                          </button>
                          {verHallazgos === id && (
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                              {c.hallazgos.slice(0, 12).map((h: any, k: number) => (
                                <div key={k} style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.45 }}>
                                  <span style={{ color: C.text }}>{String(h?.nivel ?? '').toUpperCase()}</span> · {h?.texto ?? ''}
                                  {h?.fuente ? <span style={{ display: 'block', color: C.dim, fontFamily: MONO, fontSize: 10.5 }}>{h.fuente}</span> : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {c.reportId && (
                        <button onClick={() => verPdf(c)} className="cmp-foco"
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: C.text, background: 'transparent', border: 'none', padding: '9px 0 0', textDecoration: 'underline', cursor: 'pointer' }}>
                          <FileText size={12} /> Ver reporte PDF completo
                        </button>
                      )}
                    </div>

                    {/* Quién lo inscribió — lo que hace falta para el reporte */}
                    <div style={{ background: C.elev, border: `1px solid ${C.border}`, borderRadius: 11, padding: '12px 14px' }}>
                      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>EMPRESA QUE CONSULTÓ</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: '8px 0 0' }}>{c.cliente?.nombre ?? c.titular}</p>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {[
                          ['Tipo de cuenta', c.cliente?.tipo === 'empresa' ? 'Empresa' : 'Personal'],
                          [c.cliente?.tipoDocumento ?? 'Documento', c.cliente?.documento ?? '—'],
                          ['Correo', c.cliente?.email ?? '—'],
                          ['País', c.cliente?.pais ?? '—'],
                          ['Cliente desde', c.cliente?.desde ? new Date(c.cliente.desde).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'],
                        ].map(([l, v]) => (
                          <div key={String(l)} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <span style={{ fontSize: 11.5, color: C.sub, flexShrink: 0 }}>{l}</span>
                            <span style={{ fontSize: 11.5, color: C.text, fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</span>
                          </div>
                        ))}
                      </div>
                      {(() => {
                        const h = porCliente.find(p => p.id === c.cliente?.id);
                        if (!h) return null;
                        return (
                          <p style={{ fontSize: 11.5, color: C.sub, margin: '9px 0 0', lineHeight: 1.45 }}>
                            {h.inscritos} inscritos · <span style={{ color: C.text, fontWeight: 600 }}>{h.altos} de riesgo alto</span> · {h.bloqueados} bloqueados
                          </p>
                        );
                      })()}
                    </div>

                    {/* Acciones */}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button onClick={() => { setDecidiendo({ caso: c, decision: 'aprobar' }); setMotivo(''); }} className="cmp-foco hover:opacity-90 transition-opacity"
                          style={{ fontSize: 12.5, fontWeight: 700, color: '#0A0A0A', background: C.text, border: 'none', padding: '8px 14px', borderRadius: 9 }}>
                          Aprobar
                        </button>
                        <button onClick={() => { setDecidiendo({ caso: c, decision: 'mantener' }); setMotivo(''); }} className="cmp-foco hover:bg-white/[0.09] transition-colors"
                          style={{ fontSize: 12.5, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, padding: '8px 14px', borderRadius: 9 }}>
                          Mantener bloqueado
                        </button>
                        <button onClick={() => reintentar(c)} className="cmp-foco hover:bg-white/[0.09] transition-colors"
                          style={{ fontSize: 12.5, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, padding: '8px 14px', borderRadius: 9 }}>
                          Reintentar consulta
                        </button>
                        <button onClick={() => mandarAKumplo(c)} className="cmp-foco hover:bg-white/[0.09] transition-colors"
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}`, padding: '8px 14px', borderRadius: 9 }}>
                          <Send size={12} /> Enviar a Kumplo
                        </button>
                      </div>
                      <p style={{ fontSize: 11, color: C.dim, margin: '8px 0 0' }}>Toda decisión queda en auditoría con tu usuario.</p>
                      {c.decisionManual && (
                        <p style={{ fontSize: 11.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.45 }}>
                          Última decisión: <span style={{ color: C.text }}>{c.decisionManual.decision === 'aprobar' ? 'aprobado' : 'mantenido bloqueado'}</span> {hace(c.decisionManual.at)} — {c.decisionManual.motivo}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {visibles.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.border}`, padding: '11px 16px', fontSize: 11.5, color: C.sub }}>
              {visibles.length} casos mostrados · {casos.length} en la bandeja
              {(r.total ?? 0) > casos.length ? ` · ${fmt(r.total)} revisados en total` : ''}
            </div>
          )}
        </div>
      </div>

      {/* ══ PANEL DERECHO ══ */}
      <div style={{ flex: '1 1 320px', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Riesgo alto por cliente */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '15px 17px' }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0 }}>Riesgo alto por cliente</p>
          <p style={{ fontSize: 11.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.5 }}>
            Qué cuenta inscribió a las personas marcadas. Concentración alta = señal de alerta,
            y es la columna que pide un reporte a la UIAF.
          </p>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {porCliente.length === 0 && (
              <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>Ninguna cuenta tiene inscripciones de riesgo alto.</p>
            )}
            {porCliente.slice(0, 8).map(p => (
              <div key={p.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.email ?? '—'} · {p.tipo === 'empresa' ? 'Empresa' : 'Personal'}
                    </span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.text, flexShrink: 0 }}>{p.altos}</span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.07)', marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((p.altos / maxAltos) * 100)}%`, background: 'rgba(244,244,242,0.7)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Revisión manual */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '15px 17px' }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0 }}>Revisión manual</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            {[
              ['En cola', fmt((r.medio ?? 0) + (r.alto ?? 0)), false],
              ['Sin decidir aún', fmt(casos.filter(c => !c.decisionManual).length), false],
              ['Ya decididos', fmt(casos.filter(c => c.decisionManual).length), true],
              ['En orden', fmt(r.enOrden ?? 0), true],
            ].map(([l, v, ok]) => (
              <div key={String(l)}>
                <p style={{ fontSize: 19, fontWeight: 800, color: ok ? C.green : C.text, margin: 0 }}>{v}</p>
                <p style={{ fontSize: 11, color: C.sub, margin: '3px 0 0' }}>{l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Reglas automáticas — se leen del servidor, no se inventan */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '15px 17px' }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0 }}>Reglas automáticas</p>
          <p style={{ fontSize: 11.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.5 }}>
            Se configuran en Admin → TusDatos, donde además se pide código al correo para bajarlas.
            Acá se ven para saber con qué reglas está corriendo la bandeja.
          </p>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {[
              ['Impedir la transferencia con veredicto negativo', datos.reglas?.bloquear !== false],
              ['Bloquear solo el riesgo alto — el medio va a revisión', !!datos.reglas?.soloBloquearAlto],
              ['Avisar al canal de Cumplimiento en cada bloqueo', !!datos.reglas?.avisarCanal],
            ].map(([l, on]) => (
              <div key={String(l)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12, color: C.sub, lineHeight: 1.45 }}>{l}</span>
                <Toggle on={!!on} onChange={() => setMsg({ ok: false, texto: 'Estas reglas se cambian en Admin → TusDatos: allí queda el registro de quién las bajó.' })} label={String(l)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ Confirmar decisión ══ */}
      {decidiendo && (
        <div onClick={() => !guardando && setDecidiendo(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,4,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
            style={{ width: '100%', maxWidth: 460, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
            <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>
              {decidiendo.decision === 'aprobar' ? '¿Aprobar a esta persona?' : '¿Mantenerla bloqueada?'}
            </p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '7px 0 0', lineHeight: 1.55 }}>
              {decidiendo.caso.nombreInscrito || decidiendo.caso.nombreReal} · {decidiendo.caso.tipoDocumento} {mask(decidiendo.caso.documento)}
              <br />Inscrita por {decidiendo.caso.cliente?.nombre ?? decidiendo.caso.titular}.
              {decidiendo.decision === 'aprobar'
                ? ' Al aprobarla se podrá volver a transferirle, con el veredicto del sistema en contra.'
                : ' Seguirá sin poder recibir transferencias.'}
            </p>
            <label style={{ display: 'block', marginTop: 14 }}>
              <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginBottom: 5 }}>Por qué tomas esta decisión</span>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} autoFocus className="cmp-foco"
                placeholder="Queda guardado con tu usuario y la fecha."
                style={{ width: '100%', padding: '9px 11px', borderRadius: 9, background: C.doc, border: `1px solid ${C.border2}`, color: C.text, fontSize: 12.5, fontFamily: FONT, outline: 'none', resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
              <button onClick={() => setDecidiendo(null)} disabled={guardando} className="cmp-foco hover:bg-white/[0.09] transition-colors"
                style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.055)', border: `1px solid ${C.border2}` }}>
                Cancelar
              </button>
              <button onClick={confirmarDecision} disabled={guardando || !motivo.trim()} className="cmp-foco hover:opacity-90 transition-opacity"
                style={{ flex: 1.3, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, color: '#0A0A0A', background: C.text, border: 'none', opacity: (guardando || !motivo.trim()) ? 0.5 : 1, cursor: (guardando || !motivo.trim()) ? 'not-allowed' : 'pointer' }}>
                {guardando ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
