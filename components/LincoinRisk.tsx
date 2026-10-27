// Lincoin Risk — consulta manual de antecedentes de una persona o empresa.
//
// La empresa consulta a alguien SIN inscribirlo como beneficiario. Primero se
// mira el padrón Lincoin Risk (resultados de Sarblock compartidos entre
// cuentas, vigentes 90 días): si está, sale sin costo. Si no, la función
// sarblock consulta y el resultado queda en el padrón para la próxima.
// No hay historial: al salir de la pantalla el resultado se va.
import React, { useEffect, useRef, useState } from 'react';
import { llamarFuncion } from '../lib/edge';
import { useDatabase } from '../context/DatabaseContext';

const C = { base: '#070808', fondo: '#0C0E0D', elevado: '#121413', borde: 'rgba(255,255,255,0.08)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', ambar: '#FBBF24', rojo: '#F87171' };
const LBL: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, textTransform: 'uppercase', display: 'block', marginBottom: 6 };
const INP: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.elevado, border: '1px solid rgba(255,255,255,0.11)', borderRadius: 10, padding: '11px 12px', color: C.texto, fontSize: 13.5, fontFamily: 'inherit', outline: 'none' };

const IconoRisk = ({ tam = 16, color = 'currentColor' }: { tam?: number; color?: string }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v5c0 4.2-2.8 7.9-7 9-4.2-1.1-7-4.8-7-9V6l7-3z" /><circle cx="11.5" cy="11" r="2.6" /><path d="M13.4 12.9l2.1 2.1" />
  </svg>
);

const VEREDICTO = (f: any) => {
  if (f.nombreCoincide === false) return { t: 'NOMBRE NO CORRESPONDE', c: C.rojo, txt: f.bloqueo };
  if (f.operable === false || f.categoria === 'alto') return { t: 'RIESGO ALTO', c: C.rojo, txt: f.bloqueo || 'No se recomienda operar con esta persona.' };
  if (f.categoria === 'medio') return { t: 'RIESGO MEDIO', c: C.ambar, txt: f.bloqueo || 'Hallazgos que conviene revisar antes de operar.' };
  if (f.categoria === 'sin_validar') return { t: 'IDENTIDAD SIN VALIDAR', c: C.ambar, txt: 'No se pudo contrastar el documento con la fuente oficial. Revisa el número.' };
  if (f.categoria === 'bajo') return { t: 'RIESGO BAJO', c: C.verde, txt: 'Sin coincidencias restrictivas.' };
  return { t: 'SIN HALLAZGOS', c: C.verde, txt: 'No se encontraron antecedentes en las fuentes consultadas.' };
};

export const LincoinRisk: React.FC = () => {
  const { currentUser } = useDatabase();
  const llamar = (action: string, extra: Record<string, unknown> = {}) =>
    llamarFuncion('sarblock', { action, userId: currentUser?.id, ...extra }, 60000);
  const [tipo, setTipo] = useState<'natural' | 'juridica'>('natural');
  const [form, setForm] = useState({ tipoDocumento: 'CC', documento: '', nombre: '', autorizado: false });
  const [fase, setFase] = useState<'form' | 'consultando' | 'resultado'>('form');
  const [res, setRes] = useState<{ ficha: any; deCache?: boolean; consultadoAt?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState(false);
  const sondeo = useRef<number | null>(null);
  useEffect(() => () => { if (sondeo.current) clearInterval(sondeo.current); }, []);

  const juridica = tipo === 'juridica';
  const puede = form.documento.trim().length >= 5 && form.autorizado && (!juridica || form.nombre.trim().length >= 3);

  const consultar = async () => {
    setError(null); setRes(null); setFase('consultando');
    const r = await llamar('risk_consultar', { tipoPersona: tipo, ...form });
    if (!r?.ok) { setError(r?.motivo ?? r?.error ?? 'No se pudo consultar.'); setFase('form'); return; }
    if (!r.enCurso) { setRes(r); setFase('resultado'); return; }
    // La consulta tarda cerca de un minuto: se pregunta cada 4 s.
    sondeo.current = window.setInterval(async () => {
      const x = await llamar('risk_resultado', { checkId: r.checkId, nombre: form.nombre });
      if (x?.ok && !x.enCurso) { if (sondeo.current) clearInterval(sondeo.current); setRes(x); setFase('resultado'); }
      if (!x?.ok) { if (sondeo.current) clearInterval(sondeo.current); setError(x?.motivo ?? 'No se pudo leer el resultado.'); setFase('form'); }
    }, 4000);
  };
  const nueva = () => { setFase('form'); setRes(null); setError(null); setForm({ tipoDocumento: 'CC', documento: '', nombre: '', autorizado: false }); };

  const f = res?.ficha;
  const v = f ? VEREDICTO(f) : null;
  const cat: any[] = f?.sarblock?.catalog ?? [];
  const consultadas = cat.filter((e: any) => e.status !== 'SKIPPED' && e.status !== 'NOT_SCHEDULED').length;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '8px 0 40px', fontFamily: "'Archivo', system-ui, sans-serif", color: C.texto }}>
      <main>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconoRisk tam={22} color={C.texto} />
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', margin: 0 }}>Lincoin Risk</h1>
        </div>
        <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 22px', lineHeight: 1.55, maxWidth: 560 }}>
          Consulta los antecedentes de una persona o empresa antes de operar con ella: listas restrictivas, PEP, procesos judiciales y prensa adversa.
        </p>

        {/* Formulario */}
        <div style={{ background: C.fondo, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '18px 20px 20px' }}>
          <div role="tablist" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: C.elevado, border: `1px solid ${C.borde}`, marginBottom: 18 }}>
            {(['natural', 'juridica'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tipo === t} disabled={fase === 'consultando'}
                onClick={() => { setTipo(t); setForm(fm => ({ ...fm, tipoDocumento: t === 'juridica' ? 'NIT' : 'CC' })); }}
                style={{ padding: '7px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                  background: tipo === t ? '#F4F4F2' : 'transparent', color: tipo === t ? '#15181A' : C.sub }}>
                {t === 'natural' ? 'Persona natural' : 'Empresa (NIT)'}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: juridica ? '1fr' : '150px 1fr', gap: 12 }}>
            {!juridica && (
              <div><label style={LBL}>Tipo</label>
                <select value={form.tipoDocumento} onChange={e => setForm({ ...form, tipoDocumento: e.target.value })} style={INP} disabled={fase !== 'form'}>
                  <option value="CC">CC · Cédula</option><option value="CE">CE · Extranjería</option>
                  <option value="PPT">PPT</option><option value="PP">Pasaporte</option>
                </select></div>
            )}
            <div><label style={LBL}>{juridica ? 'NIT' : 'Número de documento'}</label>
              <input value={form.documento} onChange={e => setForm({ ...form, documento: e.target.value })} style={INP} inputMode="numeric"
                placeholder={juridica ? '901799579-5' : '1020304050'} disabled={fase !== 'form'} /></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={LBL}>{juridica ? 'Razón social *' : 'Nombre completo (opcional)'}</label>
            <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={INP} disabled={fase !== 'form'}
              placeholder={juridica ? 'Como aparece en el RUT' : 'Como aparece en el documento'} />
            {!juridica && <p style={{ fontSize: 11.5, color: C.tenue, margin: '5px 0 0' }}>Con el nombre comprobamos que el documento sea de esa persona.</p>}
          </div>

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 16, fontSize: 12.5, color: C.sub, lineHeight: 1.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.autorizado} onChange={e => setForm({ ...form, autorizado: e.target.checked })} disabled={fase !== 'form'}
              style={{ width: 16, height: 16, marginTop: 1, accentColor: '#4ADE80', flexShrink: 0 }} />
            Declaro que tengo autorización del titular o una finalidad legítima (debida diligencia) para consultar estos datos.
          </label>

          {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: '12px 0 0' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
            {fase === 'resultado'
              ? <button onClick={nueva} style={{ height: 44, borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: 'none', background: '#F4F4F2', color: '#15181A', padding: '0 20px', cursor: 'pointer' }}>Nueva consulta</button>
              : <button onClick={consultar} disabled={!puede || fase === 'consultando'}
                  style={{ height: 44, borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: 'none', background: '#F4F4F2', color: '#15181A', padding: '0 20px', cursor: puede ? 'pointer' : 'not-allowed', opacity: puede && fase !== 'consultando' ? 1 : 0.45 }}>
                  {fase === 'consultando' ? 'Consultando…' : 'Consultar'}
                </button>}
          </div>
        </div>

        {fase === 'consultando' && (
          <div style={{ marginTop: 14, background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '16px 18px', fontSize: 13, color: C.sub }}>
            Consultando más de 25 fuentes oficiales e internacionales. Suele tardar alrededor de un minuto; puedes esperar aquí.
          </div>
        )}

        {/* Resultado */}
        {fase === 'resultado' && f && v && (
          <div style={{ marginTop: 14, background: C.fondo, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 15px', borderBottom: `1px solid ${C.borde}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: '-0.3px', margin: 0 }}>{f.nombreReal || form.nombre || 'Sin nombre'}</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{f.tipoDocumento} {f.documento}</p>
                </div>
                <span style={{ fontSize: 11, color: C.sub, border: `1px solid ${C.borde}`, borderRadius: 999, padding: '4px 10px' }}>
                  {res?.deCache ? `Consulta del ${new Date(res.consultadoAt!).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })} · sin costo` : 'Consulta nueva'}
                </span>
              </div>
              <div style={{ marginTop: 12, border: `1px solid ${v.c}55`, borderLeft: `3px solid ${v.c}`, borderRadius: 10, padding: '11px 13px', background: C.elevado }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: v.c, margin: 0 }}>{v.t}</p>
                <p style={{ fontSize: 12.5, color: C.texto, margin: '4px 0 0', lineHeight: 1.5 }}>{v.txt}</p>
              </div>
            </div>
            <div style={{ padding: '6px 20px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
                {[{ n: consultadas, l: 'Fuentes consultadas' }, { n: f.altos ?? 0, l: 'Hallazgos altos', c: (f.altos ?? 0) > 0 ? C.rojo : undefined }, { n: f.medios ?? 0, l: 'Para revisar', c: (f.medios ?? 0) > 0 ? C.ambar : undefined }].map(x => (
                  <div key={x.l} style={{ background: C.elevado, border: `1px solid ${C.borde}`, borderRadius: 10, padding: '10px 12px' }}>
                    <p style={{ fontSize: 19, fontWeight: 800, margin: 0, color: x.c ?? C.texto }}>{x.n}</p>
                    <p style={{ fontSize: 10.5, color: C.sub, margin: '2px 0 0' }}>{x.l}</p>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: '18px 0 6px' }}>POR QUÉ</p>
              {(f.hallazgos ?? []).length === 0
                ? <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>Ninguna regla de riesgo se activó.</p>
                : (f.hallazgos as any[]).slice(0, 6).map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 7 }}>
                    <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 700, borderRadius: 999, padding: '2px 7px', border: `1px solid ${h.nivel === 'alto' ? 'rgba(248,113,113,0.32)' : 'rgba(251,191,36,0.32)'}`, color: h.nivel === 'alto' ? C.rojo : C.ambar }}>{h.nivel === 'alto' ? 'ALTO' : 'MEDIO'}</span>
                    <span style={{ fontSize: 12, color: C.texto, lineHeight: 1.45 }}>{h.texto}</span>
                  </div>
                ))}
              {(f.hallazgos ?? []).length > 6 && <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>Y {(f.hallazgos as any[]).length - 6} más en el reporte.</p>}
              <p style={{ fontSize: 11, color: C.tenue, margin: '16px 0 0', lineHeight: 1.5 }}>
                Este resultado no queda guardado en tu cuenta. Descarga el reporte si necesitas conservarlo para tu debida diligencia.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 9, padding: '14px 20px 18px', borderTop: `1px solid ${C.borde}` }}>
              <button onClick={async () => { setPdf(true); try { const { descargarReporteLincoin } = await import('./reporte/ReporteLincoin'); await descargarReporteLincoin(f); } catch { setError('No se pudo generar el reporte.'); } finally { setPdf(false); } }} disabled={pdf}
                style={{ height: 44, borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: 'none', background: '#F4F4F2', color: '#15181A', padding: '0 20px', cursor: 'pointer', opacity: pdf ? 0.55 : 1 }}>
                {pdf ? 'Generando…' : 'Descargar reporte PDF'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
