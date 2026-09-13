import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, FileText, Send } from 'lucide-react';

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
// a la espera. Una bandeja donde lo urgente aparece mezclado con lo rutinario
// se deja de revisar en una semana.
//
// Lo que se ve acá es informativo. El veredicto lo escribe el servidor y no
// se puede cambiar desde el navegador.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
const tokenOf = () => {
  try {
    const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) return d.access_token as string; }
  } catch { /* */ }
  return null;
};
const call = async (body: any) => {
  const r = await fetch(`${SURL}/functions/v1/tusdatos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
    body: JSON.stringify(body),
  });
  const t = await r.text().catch(() => '');
  try { return JSON.parse(t); } catch { /* */ }
  if (r.status === 404) return { error: 'El servicio de antecedentes todavía no está publicado.' };
  return { error: `El servidor respondió ${r.status}` };
};

// Cada alerta con su nombre en claro y su peso visual. El rojo se reserva
// para lo que de verdad frena una operación.
const ALERTA: Record<string, { texto: string; color: string; borde: string; explica: string }> = {
  nombre_no_coincide: { texto: 'NOMBRE INCORRECTO', color: C.red, borde: 'rgba(248,113,113,0.32)', explica: 'El nombre inscrito no es el del documento. No se sabe a quién se le estaría transfiriendo.' },
  documento_no_vigente: { texto: 'DOCUMENTO NO VIGENTE', color: C.red, borde: 'rgba(248,113,113,0.32)', explica: 'La cédula está cancelada. Revisa el motivo: muerte y suplantación son las señales más graves.' },
  riesgo_alto: { texto: 'RIESGO ALTO', color: C.red, borde: 'rgba(248,113,113,0.32)', explica: 'Hallazgos de riesgo alto en las fuentes consultadas.' },
  riesgo_medio: { texto: 'RIESGO MEDIO', color: C.amber, borde: 'rgba(251,191,36,0.32)', explica: 'Hallazgos de riesgo medio. Requiere una decisión: aprobar o dejar bloqueado.' },
  sin_validar: { texto: 'SIN VALIDAR', color: C.sub, borde: C.border2, explica: 'No se pudo validar el documento, así que no se sabe de quién son los antecedentes. No bloquea.' },
  consulta_fallida: { texto: 'CONSULTA FALLIDA', color: C.sub, borde: C.border2, explica: 'La consulta no se completó. No bloquea; conviene volver a lanzarla.' },
  sin_autorizacion: { texto: 'SIN AUTORIZACIÓN', color: C.sub, borde: C.border2, explica: 'El titular del documento no autoriza la consulta de su información. Es un derecho suyo y no bloquea.' },
  en_curso: { texto: 'EN CURSO', color: C.sub, borde: C.border2, explica: 'La consulta está corriendo. Suele tardar cerca de un minuto.' },
};

export const AdminCompliance: React.FC = () => {
  const [datos, setDatos] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [filtro, setFiltro] = useState<string>('todo');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [verTodo, setVerTodo] = useState<string | null>(null);

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

  if (!datos) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>
        Cargando los casos de cumplimiento…
      </div>
    );
  }
  if (datos.error) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.amber, fontSize: 13 }}>
        {datos.error}
      </div>
    );
  }

  const r = datos.resumen ?? {};
  const casos: any[] = datos.casos ?? [];
  const visibles = filtro === 'todo' ? casos : casos.filter(c => c.alerta === filtro);

  const tarjeta: React.CSSProperties = { background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, fontFamily: FONT, color: C.text };
  const chip = (activo: boolean): React.CSSProperties => ({
    border: `1px solid ${activo ? 'rgba(74,222,128,0.4)' : C.border2}`,
    background: activo ? 'rgba(74,222,128,0.08)' : 'transparent',
    color: activo ? C.text : C.sub,
    borderRadius: 999, padding: '6px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Resumen */}
      <div style={tarjeta}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
              <ShieldAlert size={17} color={r.bloqueados > 0 ? C.red : C.green} /> Compliance
            </p>
            <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 620, lineHeight: 1.55 }}>
              Todo lo que se inscribe pasa por acá. Primero se valida que el nombre corresponda al
              documento; después, los antecedentes. Lo que no está en orden aparece arriba.
            </p>
          </div>
          <button onClick={cargar} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, opacity: busy ? 0.55 : 1 }}>
            <RefreshCw size={13} /> {busy ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 16 }}>
          {[
            { l: 'Bloqueados', v: r.bloqueados ?? 0, c: (r.bloqueados ?? 0) > 0 ? C.red : C.sub },
            { l: 'Identidad no corresponde', v: r.nombreNoCoincide ?? 0, c: (r.nombreNoCoincide ?? 0) > 0 ? C.red : C.sub },
            { l: 'Documento no vigente', v: r.documentoNoVigente ?? 0, c: (r.documentoNoVigente ?? 0) > 0 ? C.red : C.sub },
            { l: 'Riesgo alto', v: r.alto ?? 0, c: (r.alto ?? 0) > 0 ? C.red : C.sub },
            { l: 'Riesgo medio', v: r.medio ?? 0, c: (r.medio ?? 0) > 0 ? C.amber : C.sub },
            { l: 'En curso', v: r.enCurso ?? 0, c: C.sub },
            { l: 'En orden', v: r.enOrden ?? 0, c: C.green },
          ].map(x => (
            <div key={x.l} style={{ background: C.elev, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: x.c, margin: 0, letterSpacing: '-0.5px' }}>{x.v}</p>
              <p style={{ fontSize: 11, color: C.sub, margin: '2px 0 0', lineHeight: 1.35 }}>{x.l}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 15 }}>
          <button onClick={() => setFiltro('todo')} style={chip(filtro === 'todo')}>Todo · {casos.length}</button>
          {Object.keys(ALERTA).map(k => {
            const n = casos.filter(c => c.alerta === k).length;
            if (!n) return null;
            return <button key={k} onClick={() => setFiltro(k)} style={chip(filtro === k)}>{ALERTA[k].texto} · {n}</button>;
          })}
        </div>

        {msg && <p style={{ marginTop: 12, fontSize: 12.5, color: msg.ok ? C.green : C.red }}>{msg.texto}</p>}
      </div>

      {/* Los casos */}
      <div style={{ ...tarjeta, padding: 0, overflow: 'hidden' }}>
        {visibles.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>No hay casos que revisar</p>
            <p style={{ color: C.sub, fontSize: 12.5, marginTop: 4 }}>
              {casos.length === 0 ? 'Todo lo inscrito pasó la verificación.' : 'Ninguno coincide con el filtro.'}
            </p>
          </div>
        ) : visibles.map(c => {
          const a = ALERTA[c.alerta] ?? ALERTA.en_curso;
          const id = `${c.userId}:${c.documento}`;
          const open = abierto === id;
          return (
            <div key={id} style={{ borderTop: `1px solid ${C.border}` }}>
              <button onClick={() => setAbierto(open ? null : id)}
                style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '14px 18px', cursor: 'pointer', fontFamily: FONT }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>
                      {c.nombreInscrito || c.nombreReal || 'Sin nombre'}
                      {c.esTitular && <span style={{ color: C.dim, fontSize: 11, fontWeight: 600 }}> · titular</span>}
                    </p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', fontFamily: MONO }}>
                      {c.tipoDocumento} {c.documento} · cuenta de {c.titular}
                    </p>
                  </div>
                  <span style={{ border: `1px solid ${a.borde}`, color: a.color, borderRadius: 999, padding: '4px 10px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                    {/* El "· BLOQUEADO" sale del veredicto guardado, no de la
                        etiqueta: si el panel está en modo observación y el
                        riesgo alto no frena nada, la insignia no lo dice. */}
                    {a.texto}{c.operable === false ? ' · BLOQUEADO' : ''}
                  </span>
                </div>
              </button>

              {open && (
                <div style={{ padding: '0 18px 16px' }}>
                  <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.6 }}>{a.explica}</p>

                  {/* El contraste que importa: lo que escribieron y lo que
                      dice el documento, uno al lado del otro. */}
                  {c.nombreCoincide === false && (
                    <div style={{ marginTop: 11, background: C.elev, border: '1px solid rgba(248,113,113,0.24)', borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div><p style={{ fontSize: 10.5, color: C.sub, margin: 0, letterSpacing: '1px' }}>SE INSCRIBIÓ COMO</p>
                          <p style={{ fontSize: 13.5, color: C.text, fontWeight: 700, margin: '3px 0 0' }}>{c.nombreInscrito || '—'}</p></div>
                        <div><p style={{ fontSize: 10.5, color: C.sub, margin: 0, letterSpacing: '1px' }}>DICE EL DOCUMENTO</p>
                          <p style={{ fontSize: 13.5, color: C.red, fontWeight: 700, margin: '3px 0 0' }}>{c.nombreReal || '—'}</p></div>
                      </div>
                    </div>
                  )}

                  {c.documentoVigente === false && (
                    <p style={{ fontSize: 12.5, color: C.red, marginTop: 10, lineHeight: 1.5 }}>
                      Estado del documento: <b>{c.estadoDocumento || 'no vigente'}</b>
                    </p>
                  )}

                  {/* El porqué, no solo el cuánto. Es lo que hace falta para
                      decidir si se aprueba o se deja bloqueado. */}
                  {Array.isArray(c.hallazgos) && c.hallazgos.length > 0 && (() => {
                    // Mismo criterio que en la ficha del beneficiario: los
                    // hallazgos vienen numerados ("proceso civil 002", "003"…)
                    // y listarlos uno por uno llena la pantalla sin decir nada
                    // nuevo. Se agrupan, y plegado solo se ven los ALTOS.
                    const limpiar = (t: string) => String(t).replace(/\s*\d{1,3}\s*$/, '').trim();
                    const grupos: any[] = [];
                    const porClave = new Map<string, any>();
                    for (const h of c.hallazgos) {
                      const texto = limpiar(h.texto || h.codigo);
                      const cl = `${h.nivel}|${texto}`;
                      if (porClave.has(cl)) { porClave.get(cl).n += 1; continue; }
                      const g = { ...h, texto, n: 1 };
                      porClave.set(cl, g); grupos.push(g);
                    }
                    const altos = grupos.filter(g => g.nivel === 'alto');
                    const abiertos = verTodo === id;
                    const visibles = abiertos ? grupos : altos;
                    const ocultos = grupos.length - altos.length;
                    return (
                      <div style={{ marginTop: 11, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 11, padding: '12px 13px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: C.sub, margin: 0 }}>QUÉ SE ENCONTRÓ</p>
                          {ocultos > 0 && (
                            <button onClick={() => setVerTodo(abiertos ? null : id)}
                              style={{ background: 'transparent', border: 'none', color: C.sub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, padding: 0 }}>
                              {abiertos ? 'Ocultar' : `Ver detalle · ${grupos.length}`}
                            </button>
                          )}
                        </div>
                        <div style={{ maxHeight: abiertos ? 240 : undefined, overflowY: abiertos ? 'auto' : undefined }}>
                          {visibles.map((h: any, i: number) => (
                            <div key={`${h.codigo}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
                              <span style={{
                                flexShrink: 0, marginTop: 1, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.5px',
                                border: `1px solid ${h.nivel === 'alto' ? 'rgba(248,113,113,0.32)' : 'rgba(251,191,36,0.32)'}`,
                                color: h.nivel === 'alto' ? C.red : C.amber, borderRadius: 999, padding: '2px 7px',
                              }}>{h.nivel === 'alto' ? 'ALTO' : 'MEDIO'}</span>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <p style={{ fontSize: 12, color: C.text, margin: 0, lineHeight: 1.45 }}>
                                  {h.texto}{h.n > 1 && <span style={{ color: C.sub, fontWeight: 700 }}> ×{h.n}</span>}
                                </p>
                                {h.fuente && <p style={{ fontSize: 10.5, color: C.dim, margin: '1px 0 0' }}>{h.fuente}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                        {!abiertos && ocultos > 0 && (
                          <p style={{ fontSize: 11.5, color: C.dim, margin: '9px 0 0', lineHeight: 1.5 }}>
                            {altos.length > 0 ? 'Y ' : ''}{ocultos} tipo{ocultos === 1 ? '' : 's'} de hallazgo de riesgo medio.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
                    {[
                      { l: 'Categoría', v: c.categoria ?? '—' },
                      { l: 'Puede operar', v: c.operable === false ? 'No' : c.operable === true ? 'Sí' : 'Sin definir' },
                      { l: 'Hallazgos', v: `${c.altos} alto · ${c.medios} medio · ${c.bajos} bajo` },
                      { l: 'En Kumplo', v: c.enviadoAKumplo ? 'Enviado' : 'No enviado' },
                    ].map(x => (
                      <div key={x.l}>
                        <p style={{ fontSize: 10.5, color: C.sub, margin: 0, letterSpacing: '0.8px' }}>{x.l.toUpperCase()}</p>
                        <p style={{ fontSize: 12.5, color: C.text, margin: '2px 0 0', fontWeight: 600 }}>{x.v}</p>
                      </div>
                    ))}
                  </div>

                  {c.at && (
                    <p style={{ fontSize: 11, color: C.dim, marginTop: 10 }}>
                      Consultado: {new Date(c.at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    {c.reportId && (
                      <button onClick={() => verPdf(c)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                        <FileText size={12} /> Ver el reporte
                      </button>
                    )}
                    {c.reportId && (
                      <button onClick={() => mandarAKumplo(c)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border2}`, color: C.sub, borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                        <Send size={12} /> Enviar a Kumplo
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
